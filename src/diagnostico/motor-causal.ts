import type { Proyecto } from '../modelo/tipos.js';
import type { ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import { magnitud } from '../fisica/complejos.js';

export type ClasificacionDiagnostico = 'ROOT_CAUSE' | 'CONSEQUENCE' | 'SECONDARY_EFFECT'
	| 'UNRELATED' | 'INDETERMINATE';
export type ConfianzaDiagnostico = 'CONFIRMADO' | 'ALTA' | 'MEDIA' | 'BAJA' | 'INDETERMINADA';
export type EstadoHipotesis = 'SOSTENIDA' | 'DESCARTADA' | 'INDETERMINADA';

export type CodigoDiagnosticoIndustrial = 'OPERACION_NORMAL' | 'CONTACTO_RESISTIVO' | 'CAIDA_TENSION'
	| 'DESEQUILIBRIO' | 'RIESGO_TERMICO' | 'ROTOR_BLOQUEADO' | 'PERDIDA_FASE'
	| 'CONDUCTOR_ABIERTO_PROBABLE' | 'FALTA_ALIMENTACION' | 'MOTOR_NO_DESARROLLA_VELOCIDAD'
	| 'VFD_SUBTENSION_ENTRADA' | 'VFD_SALIDA_INHIBIDA' | 'TRANSFORMADOR_SOBRECARGADO'
	| 'TRANSFORMADOR_BAJA_TENSION_SECUNDARIA' | 'CORRIENTE_RESIDUAL' | 'FUGA_TIERRA_PROBABLE'
	| 'DIFERENCIAL_ACTUADO';

export interface EvidenciaDiagnostico {
	codigo: string;
	descripcion: string;
	valor?: number;
	unidad?: string;
	origen: 'CALCULADO' | 'CONFIGURADO' | 'ESTIMADO' | 'OBSERVADO';
}

export interface HallazgoDiagnostico {
	id: string;
	codigo: CodigoDiagnosticoIndustrial;
	equipoId?: string;
	clasificacion: ClasificacionDiagnostico;
	confianza: ConfianzaDiagnostico;
	estado: EstadoHipotesis;
	resumen: string;
	evidencias: EvidenciaDiagnostico[];
}

export interface AristaCausalDiagnostico { causaId: string; efectoId: string }

export interface ResultadoDiagnosticoIndustrial {
	hallazgos: HallazgoDiagnostico[];
	aristas: AristaCausalDiagnostico[];
	advertencias: string[];
}

export interface EstadoMotorObservable {
	dispositivoId: string;
	estado: string;
	alimentado: boolean;
	fasesPresentes: number;
	fasesRequeridas: number;
	velocidadActual: number;
	rpmEstimada?: number;
	corrienteNominalA: number;
}

export interface EstadoVfdObservable { dispositivoId: string; estado: string; run: boolean }

export interface ContextoDiagnosticoIndustrial {
	proyecto: Proyecto;
	fisica: ResultadoFisicaElectrica;
	motores?: readonly EstadoMotorObservable[];
	variadores?: readonly EstadoVfdObservable[];
	equipoId?: string;
}

const redondear = (v: number, decimales = 3): number => Math.round(v * 10 ** decimales) / 10 ** decimales;

export function validarGrafoCausal(aristas: readonly AristaCausalDiagnostico[]): string[] {
	const vecinos = new Map<string, string[]>();
	for (const a of aristas) { const lista = vecinos.get(a.causaId) ?? []; lista.push(a.efectoId); vecinos.set(a.causaId, lista); }
	const visitando = new Set<string>(); const listos = new Set<string>(); const errores: string[] = [];
	const visitar = (id: string) => {
		if (visitando.has(id)) { errores.push(`CICLO_CAUSAL:${id}`); return; }
		if (listos.has(id)) return; visitando.add(id);
		for (const sig of vecinos.get(id) ?? []) visitar(sig);
		visitando.delete(id); listos.add(id);
	};
	for (const id of [...vecinos.keys()].sort()) visitar(id);
	return [...new Set(errores)].sort();
}

export function diagnosticarProyecto(contexto: ContextoDiagnosticoIndustrial): ResultadoDiagnosticoIndustrial {
	const { proyecto, fisica, equipoId } = contexto;
	const hallazgos: HallazgoDiagnostico[] = []; const aristas: AristaCausalDiagnostico[] = [];
	const raicesContacto: { id: string; equipoId: string }[] = [];
	const agregar = (h: HallazgoDiagnostico, causaId?: string) => {
		if (!equipoId || h.equipoId === equipoId || h.equipoId === undefined) {
			h.evidencias.sort((a, b) => a.codigo.localeCompare(b.codigo)); hallazgos.push(h);
			if (causaId) aristas.push({ causaId, efectoId: h.id });
		}
	};

	/* Un contacto interno sano se modela en micro-ohmios. La causa se infiere de ΔV/I y pérdida
	 * local resueltos, nunca del tipo de falla que pudo haberlos originado. */
	for (const c of [...fisica.contactos.values()].sort((a, b) => a.ramaId.localeCompare(b.ramaId))) {
		if (!(c.corrienteA >= 0.05 && (c.resistenciaEfectivaOhm ?? 0) >= 0.05 && c.caidaV >= 0.25)) continue;
		const rootId = `diag:contacto-resistivo:${c.ramaId}`;
		raicesContacto.push({ id: rootId, equipoId: c.dispositivoId });
		agregar({ id: rootId, codigo: 'CONTACTO_RESISTIVO', equipoId: c.dispositivoId,
			clasificacion: 'ROOT_CAUSE', confianza: c.perdidaW >= 1 ? 'CONFIRMADO' : 'ALTA', estado: 'SOSTENIDA',
			resumen: `Caída y resistencia anormales en ${c.terminales.join('–')}.`, evidencias: [
				{ codigo: 'CONTACTO_CERRADO', descripcion: `${c.ramaId} pertenece a la topología conductora resuelta.`, origen: 'OBSERVADO' },
				{ codigo: 'DELTA_V', descripcion: 'Caída localizada a través del contacto.', valor: redondear(c.caidaV), unidad: 'V', origen: 'CALCULADO' },
				{ codigo: 'R_EFECTIVA', descripcion: 'Resistencia derivada de ΔV/I.', valor: redondear(c.resistenciaEfectivaOhm ?? 0), unidad: 'Ω', origen: 'CALCULADO' },
				{ codigo: 'PERDIDA_LOCAL', descripcion: 'Pérdida I²R localizada.', valor: redondear(c.perdidaW), unidad: 'W', origen: 'CALCULADO' },
			] });
		agregar({ id: `${rootId}:drop`, codigo: 'CAIDA_TENSION', equipoId: c.dispositivoId,
			clasificacion: 'CONSEQUENCE', confianza: 'CONFIRMADO', estado: 'SOSTENIDA', resumen: 'Caída de tensión localizada.',
			evidencias: [{ codigo: 'DELTA_V', descripcion: 'Tensión medida entre ambos lados.', valor: redondear(c.caidaV), unidad: 'V', origen: 'CALCULADO' }] }, rootId);
		agregar({ id: `${rootId}:thermal`, codigo: 'RIESGO_TERMICO', equipoId: c.dispositivoId,
			clasificacion: 'SECONDARY_EFFECT', confianza: c.perdidaW >= 1 ? 'ALTA' : 'MEDIA', estado: 'SOSTENIDA',
			resumen: 'Pérdida resistiva localizada con posible calentamiento.',
			evidencias: [{ codigo: 'PERDIDA_LOCAL', descripcion: 'Potencia disipada en el punto.', valor: redondear(c.perdidaW), unidad: 'W', origen: 'CALCULADO' }] }, rootId);
	}

	for (const sistema of [...fisica.trifasicos.values()].sort((a, b) => a.sistemaId.localeCompare(b.sistemaId))) {
		if (!sistema.superaUmbral) continue;
		agregar({ id: `diag:desequilibrio:${sistema.sistemaId}`, codigo: 'DESEQUILIBRIO', equipoId: sistema.sistemaId,
			clasificacion: 'CONSEQUENCE', confianza: 'CONFIRMADO', estado: 'SOSTENIDA', resumen: 'Desequilibrio superior al umbral de ingeniería configurado.', evidencias: [
				{ codigo: 'I_UNBALANCE', descripcion: sistema.metrica, valor: redondear(sistema.desequilibrioCorrientePct), unidad: '%', origen: 'CALCULADO' },
				{ codigo: 'V_UNBALANCE', descripcion: sistema.metrica, valor: redondear(sistema.desequilibrioTensionPct), unidad: '%', origen: 'CALCULADO' },
			] });
		for (const root of raicesContacto) agregar({ id: `${root.id}:unbalance:${sistema.sistemaId}`, codigo: 'DESEQUILIBRIO',
			equipoId: root.equipoId, clasificacion: 'CONSEQUENCE', confianza: 'MEDIA', estado: 'SOSTENIDA',
			resumen: 'El desequilibrio aguas abajo es coherente con la caída localizada; no prueba por sí solo causalidad exclusiva.', evidencias: [
				{ codigo: 'I_UNBALANCE', descripcion: sistema.metrica, valor: redondear(sistema.desequilibrioCorrientePct), unidad: '%', origen: 'CALCULADO' },
				{ codigo: 'V_UNBALANCE', descripcion: sistema.metrica, valor: redondear(sistema.desequilibrioTensionPct), unidad: '%', origen: 'CALCULADO' },
			] }, root.id);
	}

	for (const m of [...fisica.motores.values()].sort((a, b) => a.dispositivoId.localeCompare(b.dispositivoId))) {
		const d = proyecto.dispositivos.find((x) => x.id === m.dispositivoId); const cfg = d?.fisica?.motor;
		const funcional = contexto.motores?.find((x) => x.dispositivoId === m.dispositivoId);
		const ratioI = m.corrienteNominalUsadaA > 0 ? m.corrienteA / m.corrienteNominalUsadaA : 0;
		const rpm = m.rpm ?? funcional?.rpmEstimada ?? 0;
		const tensionSana = !!cfg && m.tensionV >= cfg.tensionNominalV * (cfg.umbralSubtension ?? 0.9);
		if (rpm <= 1 && ratioI >= 4 && tensionSana) {
			const rootId = `diag:rotor:${m.dispositivoId}`;
			agregar({ id: rootId, codigo: 'ROTOR_BLOQUEADO', equipoId: m.dispositivoId,
				clasificacion: 'ROOT_CAUSE', confianza: 'ALTA', estado: 'SOSTENIDA', resumen: 'El motor recibe tensión y corriente elevada, pero no desarrolla velocidad.', evidencias: [
					{ codigo: 'I_SOBRE_IN', descripcion: 'Relación de corriente respecto de placa.', valor: redondear(ratioI, 2), unidad: '×In', origen: 'CALCULADO' },
					{ codigo: 'RPM', descripcion: 'Velocidad observable.', valor: redondear(rpm), unidad: 'rpm', origen: 'CALCULADO' },
					{ codigo: 'V_MOTOR', descripcion: 'Tensión en bornes.', valor: redondear(m.tensionV), unidad: 'V', origen: 'CALCULADO' },
				] });
			agregar({ id: `${rootId}:alimentacion-descartada`, codigo: 'FALTA_ALIMENTACION', equipoId: m.dispositivoId,
				clasificacion: 'UNRELATED', confianza: 'ALTA', estado: 'DESCARTADA', resumen: 'La falta total de alimentación no explica el síntoma.',
				evidencias: [{ codigo: 'V_MOTOR', descripcion: 'Tensión próxima a placa presente.', valor: redondear(m.tensionV), unidad: 'V', origen: 'CALCULADO' }] });
			agregar({ id: `${rootId}:thermal`, codigo: 'RIESGO_TERMICO', equipoId: m.dispositivoId,
				clasificacion: 'CONSEQUENCE', confianza: 'ALTA', estado: 'SOSTENIDA', resumen: 'Corriente elevada sin velocidad útil.',
				evidencias: [{ codigo: 'I_SOBRE_IN', descripcion: 'Sobrecorriente respecto de placa.', valor: redondear(ratioI, 2), unidad: '×In', origen: 'CALCULADO' }] }, rootId);
		}
		const perdida = m.diagnosticos.some((x) => x.codigo === 'PERDIDA_FASE') || (funcional && funcional.fasesPresentes < funcional.fasesRequeridas);
		if (perdida) {
			const incidentes = proyecto.conductores.filter((c) => c.de.dispositivoId === m.dispositivoId || c.a.dispositivoId === m.dispositivoId);
			const ausente = incidentes.find((c) => !fisica.conductores.has(c.id));
			const codigo: CodigoDiagnosticoIndustrial = ausente ? 'CONDUCTOR_ABIERTO_PROBABLE' : 'PERDIDA_FASE';
			agregar({ id: `diag:phase-loss:${m.dispositivoId}`, codigo, equipoId: m.dispositivoId,
				clasificacion: 'ROOT_CAUSE', confianza: ausente ? 'ALTA' : 'MEDIA', estado: 'SOSTENIDA', resumen: ausente
					? `El conductor ${ausente.id} no participa en la red resuelta.` : 'Existe pérdida de fase, pero la ubicación no es inequívoca.', evidencias: [
					{ codigo: 'FASES_PRESENTES', descripcion: 'Fases físicamente presentes.', valor: funcional?.fasesPresentes, unidad: `/ ${funcional?.fasesRequeridas ?? cfg?.fases ?? 3}`, origen: 'CALCULADO' },
					...(ausente ? [{ codigo: 'RAMA_AUSENTE', descripcion: ausente.id, origen: 'OBSERVADO' as const }] : []),
				] });
		}
		if (rpm <= 1 && ratioI < 0.5 && !perdida) {
			const evidencias = [{ codigo: 'RPM', descripcion: 'El motor no desarrolla velocidad.', valor: redondear(rpm), unidad: 'rpm', origen: 'CALCULADO' as const },
				{ codigo: 'I_BAJA', descripcion: 'La corriente no distingue mando abierto de falta de alimentación.', valor: redondear(ratioI, 2), unidad: '×In', origen: 'CALCULADO' as const }];
			for (const [sufijo, codigo] of [['supply', 'FALTA_ALIMENTACION'], ['command', 'MOTOR_NO_DESARROLLA_VELOCIDAD']] as const) agregar({
				id: `diag:ambiguous:${m.dispositivoId}:${sufijo}`, codigo, equipoId: m.dispositivoId,
				clasificacion: 'INDETERMINATE', confianza: 'INDETERMINADA', estado: 'INDETERMINADA',
				resumen: 'Los síntomas admiten más de una causa; se requieren mediciones aguas arriba.', evidencias: [...evidencias],
			});
		}
	}

	for (const [id, v] of [...fisica.variadores].sort(([a], [b]) => a.localeCompare(b))) {
		const cfg = proyecto.dispositivos.find((d) => d.id === id)?.fisica?.vfd; if (!cfg) continue;
		const umbral = cfg.tensionEntradaNominalV * (cfg.umbralSubtension ?? 0.85);
		if (v.tensionEntradaV > 0 && v.tensionEntradaV < umbral) {
			const rootId = `diag:vfd-undervoltage:${id}`;
			const caidasEntrada = proyecto.conductores.filter((c) => c.de.dispositivoId === id || c.a.dispositivoId === id)
				.map((c) => fisica.conductores.get(c.id)?.caidaV).filter((x): x is number => x !== undefined);
			agregar({ id: rootId, codigo: 'VFD_SUBTENSION_ENTRADA', equipoId: id, clasificacion: 'ROOT_CAUSE',
				confianza: 'ALTA', estado: 'SOSTENIDA', resumen: 'Tensión de entrada inferior al umbral configurado.', evidencias: [
					{ codigo: 'V_INPUT', descripcion: 'Tensión de entrada resuelta.', valor: redondear(v.tensionEntradaV), unidad: 'V', origen: 'CALCULADO' },
					{ codigo: 'V_THRESHOLD', descripcion: 'Umbral derivado del perfil.', valor: redondear(umbral), unidad: 'V', origen: 'CONFIGURADO' },
					...(caidasEntrada.length ? [{ codigo: 'V_DROP_UPSTREAM', descripcion: 'Mayor caída en conductor conectado al VFD.',
						valor: redondear(Math.max(...caidasEntrada)), unidad: 'V', origen: 'CALCULADO' as const }] : []),
				] });
			if (v.potenciaSalidaW <= 1e-6) agregar({ id: `${rootId}:output`, codigo: 'VFD_SALIDA_INHIBIDA', equipoId: id,
				clasificacion: 'CONSEQUENCE', confianza: 'CONFIRMADO', estado: 'SOSTENIDA', resumen: 'La salida de potencia está inhibida.',
				evidencias: [{ codigo: 'P_OUTPUT', descripcion: 'Potencia de salida.', valor: redondear(v.potenciaSalidaW), unidad: 'W', origen: 'CALCULADO' }] }, rootId);
		}
	}

	for (const [ramaId, t] of [...fisica.red.transformadores].sort(([a], [b]) => a.localeCompare(b))) {
		const id = ramaId.replace(/^transformador:/, ''); const cfg = proyecto.dispositivos.find((d) => d.id === id)?.fisica?.transformador;
		if (!cfg) continue;
		if ((t.cargaPct ?? 0) > 100) agregar({ id: `diag:trafo-overload:${id}`, codigo: 'TRANSFORMADOR_SOBRECARGADO', equipoId: id,
			clasificacion: 'ROOT_CAUSE', confianza: 'ALTA', estado: 'SOSTENIDA', resumen: 'La potencia aparente supera la placa configurada.', evidencias: [
				{ codigo: 'LOAD_PCT', descripcion: 'Carga aparente respecto de placa.', valor: redondear(t.cargaPct ?? 0), unidad: '%', origen: 'CALCULADO' },
				{ codigo: 'RATING', descripcion: 'Potencia nominal.', valor: cfg.potenciaVA, unidad: 'VA', origen: 'CONFIGURADO' },
				{ codigo: 'V_PRIMARY', descripcion: 'Tensión primaria resuelta.', valor: redondear(magnitud(t.tensionPrimariaV)), unidad: 'V', origen: 'CALCULADO' },
				{ codigo: 'V_SECONDARY', descripcion: 'Tensión secundaria resuelta.', valor: redondear(magnitud(t.tensionSecundariaV)), unidad: 'V', origen: 'CALCULADO' },
				{ codigo: 'RATIO', descripcion: 'Relación configurada Vp/Vs.', valor: redondear(cfg.primarioV / cfg.secundarioV), origen: 'CONFIGURADO' },
				...(cfg.impedanciaPct !== undefined ? [{ codigo: 'Z_PCT', descripcion: 'Impedancia porcentual configurada.',
					valor: cfg.impedanciaPct, unidad: '%', origen: 'CONFIGURADO' as const }] : []),
			] });
		if ((t.regulacionPct ?? 0) > 10) agregar({ id: `diag:trafo-drop:${id}`, codigo: 'TRANSFORMADOR_BAJA_TENSION_SECUNDARIA', equipoId: id,
			clasificacion: 'CONSEQUENCE', confianza: 'ALTA', estado: 'SOSTENIDA', resumen: 'Regulación estimada superior al 10 %.', evidencias: [
				{ codigo: 'REGULATION', descripcion: 'Regulación desde el modelo acoplado.', valor: redondear(t.regulacionPct ?? 0), unidad: '%', origen: 'CALCULADO' },
				{ codigo: 'V_SECONDARY', descripcion: 'Tensión secundaria resuelta.', valor: redondear(magnitud(t.tensionSecundariaV)), unidad: 'V', origen: 'CALCULADO' },
			] });
	}

	for (const [id, p] of [...fisica.protecciones].sort(([a], [b]) => a.localeCompare(b))) {
		if (p.corrienteResidualA === undefined || p.corrienteResidualNominalA === undefined
			|| p.corrienteResidualA < p.corrienteResidualNominalA) continue;
		const pe = proyecto.conductores.filter((c) => {
			const borne = (extremo: typeof c.de) => proyecto.dispositivos.find((d) => d.id === extremo.dispositivoId)?.bornes.find((b) => b.id === extremo.borneId);
			return borne(c.de)?.tipo === 'PE' || borne(c.a)?.tipo === 'PE';
		}).map((c) => fisica.conductores.get(c.id)?.corrienteA ?? 0).filter((i) => i > 1e-6);
		const rootId = `diag:residual:${id}`;
		const sistema = [...fisica.trifasicos.values()].sort((a, b) => a.sistemaId.localeCompare(b.sistemaId))[0];
		const evidenciaFases: EvidenciaDiagnostico[] = sistema ? [
			...sistema.corrientesFaseA.map((i, indice) => ({ codigo: `IL${indice + 1}`, descripcion: 'Corriente de fase fasorial.',
				valor: redondear(magnitud(i)), unidad: 'A', origen: 'CALCULADO' as const })),
			{ codigo: 'IN', descripcion: 'Suma fasorial de neutro.', valor: redondear(magnitud(sistema.corrienteNeutroA)), unidad: 'A', origen: 'CALCULADO' },
		] : [];
		agregar({ id: rootId, codigo: pe.length ? 'FUGA_TIERRA_PROBABLE' : 'CORRIENTE_RESIDUAL', equipoId: id,
			clasificacion: 'ROOT_CAUSE', confianza: pe.length ? 'ALTA' : 'MEDIA', estado: 'SOSTENIDA', resumen: pe.length
				? 'Corriente residual con circulación observable por PE.' : 'Corriente residual elevada; el camino de fuga no es inequívoco.', evidencias: [
				{ codigo: 'I_DELTA', descripcion: 'Suma residual fasorial.', valor: redondear(p.corrienteResidualA), unidad: 'A', origen: 'CALCULADO' },
				{ codigo: 'I_DELTA_N', descripcion: 'Umbral configurado.', valor: redondear(p.corrienteResidualNominalA), unidad: 'A', origen: 'CONFIGURADO' },
				...evidenciaFases,
				...(pe.length ? [{ codigo: 'I_PE', descripcion: 'Corriente observable en conductor PE.', valor: redondear(Math.max(...pe)), unidad: 'A', origen: 'CALCULADO' as const }] : []),
			] });
		agregar({ id: `${rootId}:trip`, codigo: 'DIFERENCIAL_ACTUADO', equipoId: id, clasificacion: 'CONSEQUENCE',
			confianza: p.estadoResidual === 'ACTUACION' ? 'CONFIRMADO' : 'ALTA', estado: 'SOSTENIDA', resumen: 'El umbral diferencial se alcanza.',
			evidencias: [{ codigo: 'RCD_STATE', descripcion: p.estadoResidual ?? 'NO_DISPONIBLE', origen: 'OBSERVADO' }] }, rootId);
	}

	if (equipoId && !hallazgos.some((h) => h.equipoId === equipoId && h.estado === 'SOSTENIDA')) agregar({
		id: `diag:healthy:${equipoId}`, codigo: 'OPERACION_NORMAL', equipoId, clasificacion: 'UNRELATED',
		confianza: 'MEDIA', estado: 'SOSTENIDA', resumen: 'No se observan patrones V6 suficientes para declarar una falla.', evidencias: [
			{ codigo: 'SIN_PATRON', descripcion: 'Las magnitudes disponibles no superan reglas de diagnóstico.', origen: 'OBSERVADO' },
		],
	});
	hallazgos.sort((a, b) => a.id.localeCompare(b.id)); aristas.sort((a, b) => `${a.causaId}>${a.efectoId}`.localeCompare(`${b.causaId}>${b.efectoId}`));
	return { hallazgos, aristas, advertencias: validarGrafoCausal(aristas) };
}
