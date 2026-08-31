/** Reglas V7 de compatibilidad entre perfiles persistentes explícitos. */
import { resolverLazo420, resolverSenal010, resistenciaCaminoAnalogico } from '../fisica/analogicas.js';
import { calcularPlacaMotor } from '../fisica/motores.js';
import { resolverComportamiento, type ComportamientoSimulacion } from '../modelo/comportamiento.js';
import type { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { verificarProyecto } from '../motores/drc.js';
import { calcularPotenciales } from '../motores/potenciales.js';
import type { CircuitoIngenieria } from './circuitos.js';
import type { EngineeringRule, ResultadoReglaIngenieria } from './validacion.js';

type Resultado = ResultadoReglaIngenieria;
type Estado = Resultado['status'];

class UnionFind {
	private padre = new Map<string, string>();
	raiz(x: string): string { const p = this.padre.get(x); if (!p) { this.padre.set(x, x); return x; }
		if (p === x) return x; const r = this.raiz(p); this.padre.set(x, r); return r; }
	unir(a: string, b: string) { const ra = this.raiz(a); const rb = this.raiz(b); if (ra !== rb) this.padre.set(rb, ra); }
}
const nodo = (d: string, b: string) => `${d}::${b}`;

function conectividadPasiva(proyecto: Proyecto): (a: string, b: string) => boolean {
	const uf = new UnionFind();
	for (const d of proyecto.dispositivos) {
		for (const b of d.bornes) uf.raiz(nodo(d.id, b.id));
		for (const p of d.puentesInternos ?? []) uf.unir(nodo(d.id, p[0]), nodo(d.id, p[1]));
		for (const grupo of d.puentes ?? []) for (const b of grupo.slice(1)) uf.unir(nodo(d.id, grupo[0]), nodo(d.id, b));
		const perfil = resolverComportamiento(d);
		if (perfil?.clase === 'pasivo') for (const p of perfil.conexiones) uf.unir(nodo(d.id, p.entrada), nodo(d.id, p.salida));
	}
	for (const c of proyecto.conductores) uf.unir(nodo(c.de.dispositivoId, c.de.borneId), nodo(c.a.dispositivoId, c.a.borneId));
	return (a, b) => uf.raiz(a) === uf.raiz(b);
}

const entidades = (ids: readonly string[]) => ids.map((id) => ({ tipo: 'DEVICE' as const, id }));
const peor = (estados: readonly Estado[]): Estado => {
	const orden: Estado[] = ['FAIL', 'WARNING', 'INDETERMINATE', 'PASS', 'NOT_APPLICABLE'];
	return orden.find((x) => estados.includes(x)) ?? 'NOT_APPLICABLE';
};

function resultadosDoBobina(proyecto: Proyecto): Resultado[] {
	const conectado = conectividadPasiva(proyecto); const salida: Resultado[] = [];
	const bobinas = proyecto.dispositivos.flatMap((d) => {
		const p = resolverComportamiento(d);
		return p?.clase === 'contactos-electromagneticos' ? [{ d, p }] : [];
	});
	for (const plc of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const p = resolverComportamiento(plc); if (p?.clase !== 'controlador') continue;
		for (const sd of [...p.salidasDigitales].sort((a, b) => a.borne.localeCompare(b.borne))) {
			for (const { d: carga, p: pc } of bobinas) {
				if (!conectado(nodo(plc.id, sd.borne), nodo(carga.id, pc.bobina.entrada))) continue;
				const so = sd.electrica; const bo = pc.bobina.electrica; const faltan: string[] = [];
				if (!so) faltan.push('datos eléctricos de salida digital');
				if (!bo) faltan.push('datos eléctricos de bobina');
				if (so && bo && so.corrienteMaxA === undefined) faltan.push('corriente máxima de salida');
				if (so && bo && bo.corrienteA === undefined) faltan.push('corriente de bobina');
				const estados: Estado[] = [];
				if (faltan.length) estados.push('INDETERMINATE');
				if (so && bo) {
					if (so.sistema !== bo.sistema || Math.abs(so.tensionV - bo.tensionNominalV) > Math.max(1, bo.tensionNominalV * 0.01)) estados.push('FAIL');
					else estados.push('PASS');
					if (so.corrienteMaxA !== undefined && bo.corrienteA !== undefined) estados.push(bo.corrienteA > so.corrienteMaxA ? 'FAIL' : 'PASS');
				}
				const status = peor(estados);
				salida.push({ code: 'TS-IO-DO-COIL', category: 'IO', severity: status === 'FAIL' ? 'ERROR' : 'INFO', status,
					title: 'Salida digital y bobina', description: status === 'FAIL'
						? 'Los límites eléctricos explícitos de la salida y la bobina no son compatibles.'
						: status === 'INDETERMINATE' ? 'La conexión existe, pero faltan datos para validar su carga eléctrica.'
							: 'La salida digital puede alimentar la bobina según los datos explícitos.',
					evidence: [
						...(so ? [{ codigo: 'DO_V', descripcion: `${so.tipoSalida} ${so.sistema}`, valor: so.tensionV, unidad: 'V', origen: 'CONFIGURADO' as const }] : []),
						...(so?.corrienteMaxA !== undefined ? [{ codigo: 'DO_IMAX', descripcion: 'Corriente máxima de salida', valor: so.corrienteMaxA, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
						...(bo ? [{ codigo: 'COIL_V', descripcion: `Bobina ${bo.sistema}`, valor: bo.tensionNominalV, unidad: 'V', origen: 'CONFIGURADO' as const }] : []),
						...(bo?.corrienteA !== undefined ? [{ codigo: 'COIL_I', descripcion: 'Consumo de bobina', valor: bo.corrienteA, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
					], relatedEntities: entidades([plc.id, carga.id]), provenance: faltan.length ? 'NO_DISPONIBLE' : 'CONFIGURADO',
					criterion: { descripcion: 'Compatibilidad nominal explícita del perfil', origen: 'MODELO_V7' }, missingData: faltan,
					remediationHints: status === 'FAIL' ? ['Revisar interfaz o relé intermedio; V7 no lo inserta automáticamente.'] : [],
				});
			}
		}
	}
	return salida;
}

function fuenteCircuito(proyecto: Proyecto, circuito: CircuitoIngenieria): Dispositivo | undefined {
	return proyecto.dispositivos.find((d) => d.id === circuito.fuenteId);
}

function resultadosTensionFrecuencia(proyecto: Proyecto, circuitos: readonly CircuitoIngenieria[]): Resultado[] {
	const salida: Resultado[] = [];
	for (const c of circuitos) {
		const fuente = fuenteCircuito(proyecto, c); const fs = fuente?.fisica?.fuente;
		if (!fs) continue;
		for (const id of c.cargas) {
			const d = proyecto.dispositivos.find((x) => x.id === id); if (!d) continue;
			const motor = d.fisica?.motor; const vfd = d.fisica?.vfd;
			const tension = motor?.tensionNominalV ?? vfd?.tensionEntradaNominalV ?? d.tensionNominal;
			const frecuencia = motor?.frecuenciaHz;
			if (tension === undefined && frecuencia === undefined) continue;
			const faltan = tension === undefined ? ['tensión nominal del equipo'] : [];
			const incompatTension = tension !== undefined
				&& Math.abs(fs.tensionNominalV - tension) > Math.max(1, tension * 0.01);
			const incompatFrecuencia = frecuencia !== undefined && fs.frecuenciaHz !== undefined
				&& Math.abs(frecuencia - fs.frecuenciaHz) > 0.01;
			if (frecuencia !== undefined && fs.frecuenciaHz === undefined) faltan.push('frecuencia de fuente');
			const status: Estado = incompatTension || incompatFrecuencia ? 'FAIL' : faltan.length ? 'INDETERMINATE' : 'PASS';
			salida.push({ code: 'TS-EQUIPMENT-SUPPLY', category: 'CIRCUIT', severity: status === 'FAIL' ? 'ERROR' : 'INFO', status,
				title: 'Alimentación nominal del equipo', description: status === 'FAIL'
					? 'La fuente y el equipo declaran tensión o frecuencia nominal incompatibles.'
					: status === 'PASS' ? 'La alimentación coincide con los valores nominales explícitos.' : 'Faltan datos para validar la alimentación.',
				circuitId: c.id, evidence: [
					{ codigo: 'SOURCE_V', descripcion: 'Tensión nominal de fuente', valor: fs.tensionNominalV, unidad: 'V', origen: 'CONFIGURADO' },
					...(tension !== undefined ? [{ codigo: 'LOAD_V', descripcion: 'Tensión nominal del equipo', valor: tension, unidad: 'V', origen: 'CONFIGURADO' as const }] : []),
					...(fs.frecuenciaHz !== undefined ? [{ codigo: 'SOURCE_F', descripcion: 'Frecuencia de fuente', valor: fs.frecuenciaHz, unidad: 'Hz', origen: 'CONFIGURADO' as const }] : []),
					...(frecuencia !== undefined ? [{ codigo: 'LOAD_F', descripcion: 'Frecuencia nominal del equipo', valor: frecuencia, unidad: 'Hz', origen: 'CONFIGURADO' as const }] : []),
				], relatedEntities: entidades([fuente!.id, d.id]), provenance: faltan.length ? 'NO_DISPONIBLE' : 'CONFIGURADO',
				criterion: { descripcion: 'Valores nominales explícitos; no se presume operación multirango', origen: 'MODELO_V7' }, missingData: faltan,
				remediationHints: status === 'FAIL' ? ['Revisar la selección o declarar explícitamente el rango admitido en una futura extensión del perfil.'] : [],
			});
		}
	}
	return salida;
}

function resultadosMotorVfd(proyecto: Proyecto, circuitos: readonly CircuitoIngenieria[], fisica: Parameters<EngineeringRule['evaluate']>[0]['fisica']): Resultado[] {
	const salida: Resultado[] = [];
	for (const motor of [...proyecto.dispositivos].filter((d) => d.tipo === 'motor').sort((a, b) => a.id.localeCompare(b.id))) {
		const config = motor.fisica?.motor; const circuito = circuitos.find((c) => c.cargas.includes(motor.id));
		if (!config) {
			salida.push({ code: 'TS-MOTOR-PLATE-MISSING', category: 'MOTOR', severity: 'INFO', status: 'INDETERMINATE',
				title: 'Placa de motor incompleta', description: 'El motor no declara perfil físico de placa V6.', circuitId: circuito?.id,
				evidence: [], relatedEntities: entidades([motor.id]), provenance: 'NO_DISPONIBLE', missingData: ['perfil físico de motor'],
				remediationHints: ['Completar potencia, tensión, frecuencia, fases, eficiencia y factor de potencia.'] }); continue;
		}
		const diagnosticos = fisica?.motores.get(motor.id)?.diagnosticos ?? calcularPlacaMotor(config).diagnosticos;
		for (const d of diagnosticos) salida.push({ code: `TS-MOTOR-${d.codigo}`, category: 'MOTOR', severity: 'WARNING', status: 'WARNING',
			title: 'Coherencia de placa del motor', description: d.mensaje, circuitId: circuito?.id,
			evidence: [{ codigo: d.codigo, descripcion: d.mensaje, origen: d.origen }], relatedEntities: entidades([motor.id]), provenance: d.origen,
			criterion: { descripcion: 'Modelo de placa V6', origen: 'MODELO_V7' }, missingData: [], remediationHints: ['Revisar los datos de placa configurados.'] });
		const fuente = circuito ? fuenteCircuito(proyecto, circuito) : undefined;
		const vfd = fuente?.fisica?.vfd; if (!vfd) continue;
		const placa = calcularPlacaMotor(config); const faltan: string[] = [];
		if (vfd.corrienteNominalA === undefined && vfd.limiteCorrienteA === undefined) faltan.push('corriente nominal/límite VFD');
		const iVfd = vfd.corrienteNominalA ?? vfd.limiteCorrienteA;
		const incompat = vfd.potenciaNominalW < config.potenciaMecanicaNominalW
			|| vfd.tensionSalidaMaxV + 1e-9 < config.tensionNominalV
			|| vfd.frecuenciaMaxHz + 1e-9 < config.frecuenciaHz
			|| iVfd !== undefined && iVfd + 1e-9 < placa.corrienteNominalUsadaA;
		const status: Estado = incompat ? 'FAIL' : faltan.length ? 'INDETERMINATE' : 'PASS';
		salida.push({ code: 'TS-VFD-MOTOR-COMPATIBILITY', category: 'VFD', severity: incompat ? 'ERROR' : 'INFO', status,
			title: 'Compatibilidad VFD y motor', description: incompat
				? 'Al menos un límite explícito del VFD es inferior a la demanda nominal del motor.'
				: faltan.length ? 'La relación VFD/motor es parcialmente evaluable; falta un límite de corriente.'
					: 'Los límites V/f, potencia y corriente configurados cubren la placa del motor.', circuitId: circuito?.id,
			evidence: [
				{ codigo: 'VFD_P', descripcion: 'Potencia nominal VFD', valor: vfd.potenciaNominalW, unidad: 'W', origen: 'CONFIGURADO' },
				{ codigo: 'MOTOR_P', descripcion: 'Potencia mecánica nominal motor', valor: config.potenciaMecanicaNominalW, unidad: 'W', origen: 'CONFIGURADO' },
				{ codigo: 'MOTOR_I', descripcion: 'Corriente nominal usada por V6', valor: placa.corrienteNominalUsadaA, unidad: 'A', origen: config.corrienteNominalA ? 'CONFIGURADO' : 'CALCULADO' },
				...(iVfd !== undefined ? [{ codigo: 'VFD_I', descripcion: 'Corriente disponible VFD', valor: iVfd, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
			], relatedEntities: entidades([fuente!.id, motor.id]), provenance: faltan.length ? 'NO_DISPONIBLE' : 'CALCULADO',
			criterion: { descripcion: 'Comparación de límites declarados; no certifica dimensionamiento', origen: 'MODELO_V7' }, missingData: faltan,
			remediationHints: incompat ? ['Revisar selección del VFD y datos de placa; consultar requisitos del fabricante.'] : [],
		});
	}
	return salida;
}

interface FuenteAnalogica {
	dispositivo: Dispositivo; borne: string; comun: string; unidad: 'V' | 'mA'; rango: [number, number]; modo: 'activa' | 'pasiva';
}

function fuentesAnalogicas(proyecto: Proyecto): FuenteAnalogica[] {
	return proyecto.dispositivos.flatMap((d): FuenteAnalogica[] => {
		const p = resolverComportamiento(d);
		if (p?.clase === 'controlador') return p.salidasAnalogicas.map((x) => ({ dispositivo: d, borne: x.borne,
			comun: x.referencia, unidad: x.unidad, rango: x.rango, modo: 'activa' }));
		if (p?.clase === 'sensor' && p.transmisor) return [{ dispositivo: d, borne: p.transmisor.salida.borne,
			comun: p.transmisor.salida.comun, unidad: p.transmisor.salida.unidad, rango: p.transmisor.salida.rango,
			modo: p.transmisor.modoSalida }];
		return [];
	});
}

function resultadosAnalogicos(proyecto: Proyecto, fisica: Parameters<EngineeringRule['evaluate']>[0]['fisica']): Resultado[] {
	const conectado = conectividadPasiva(proyecto); const fuentes = fuentesAnalogicas(proyecto); const salida: Resultado[] = [];
	for (const plc of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const p = resolverComportamiento(plc); if (p?.clase !== 'controlador') continue;
		for (const ai of p.entradasAnalogicas ?? []) {
			const fuente = fuentes.find((f) => conectado(nodo(plc.id, ai.borne), nodo(f.dispositivo.id, f.borne)));
			if (!fuente) continue;
			const tipoIncompatible = fuente.unidad !== ai.unidad;
			const modoIncompatible = fuente.modo === 'activa' && ai.modoEntrada === 'activa';
			const rangoDiferente = fuente.unidad === ai.unidad && (fuente.rango[0] !== ai.rango[0] || fuente.rango[1] !== ai.rango[1]);
			let status: Estado = tipoIncompatible || modoIncompatible ? 'FAIL' : rangoDiferente ? 'WARNING' : 'PASS';
			const faltan: string[] = [];
			let calidad: string | undefined;
			if (!tipoIncompatible && !modoIncompatible) {
				const configF = fuente.dispositivo.fisica?.analogica; const configI = plc.fisica?.analogica;
				const ida = resistenciaCaminoAnalogico(proyecto, nodo(fuente.dispositivo.id, fuente.borne), nodo(plc.id, ai.borne));
				const vuelta = resistenciaCaminoAnalogico(proyecto, nodo(fuente.dispositivo.id, fuente.comun), nodo(plc.id, ai.comun));
				const rCable = ida.ohm !== undefined && vuelta.ohm !== undefined ? ida.ohm + vuelta.ohm : undefined;
				if (ai.unidad === 'mA') {
					if (configF?.tensionComplianceV === undefined) faltan.push('tensión de compliance');
					if (configF?.tensionMinimaTransmisorV === undefined) faltan.push('tensión mínima del transmisor');
					if (configI?.burdenOhm === undefined) faltan.push('burden de entrada');
					if (rCable === undefined) faltan.push('resistencia/longitud de cable');
					if (!faltan.length) calidad = resolverLazo420({ corrienteDemandadaMA: fuente.rango[1],
						tensionDisponibleV: configF!.tensionComplianceV!, tensionMinimaTransmisorV: configF!.tensionMinimaTransmisorV!,
						resistenciaCableOhm: rCable!, burdenOhm: configI!.burdenOhm! }).calidad;
				} else {
					if (configF?.resistenciaSalidaOhm === undefined) faltan.push('resistencia de salida');
					if (configI?.burdenOhm === undefined) faltan.push('impedancia de entrada');
					if (!faltan.length) calidad = resolverSenal010({ tensionDemandadaV: fuente.rango[1],
						resistenciaSalidaOhm: configF!.resistenciaSalidaOhm! + (rCable ?? 0), resistenciaEntradaOhm: configI!.burdenOhm! }).calidad;
				}
				const runtime = fisica?.lazosAnalogicos.find((x) => x.fuenteId === fuente.dispositivo.id && x.entradaId === nodo(plc.id, ai.borne));
				if (runtime) calidad = runtime.calidad;
				if (calidad && calidad !== 'NORMAL') status = 'FAIL'; else if (faltan.length && status === 'PASS') status = 'INDETERMINATE';
			}
			salida.push({ code: 'TS-ANALOG-COMPATIBILITY', category: 'ANALOG', severity: status === 'FAIL' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO', status,
				title: 'Compatibilidad de lazo analógico', description: status === 'FAIL' ? 'Tipo, modo o compliance del lazo es incompatible.'
					: status === 'WARNING' ? 'El tipo coincide, pero los rangos eléctricos no son iguales.'
						: status === 'INDETERMINATE' ? 'El lazo está conectado, pero faltan parámetros físicos para validar su margen.' : 'El lazo es compatible según perfiles y física declarada.',
				evidence: [
					{ codigo: 'SOURCE_RANGE', descripcion: `Salida ${fuente.unidad}`, valor: `${fuente.rango[0]}..${fuente.rango[1]}`, origen: 'CONFIGURADO' },
					{ codigo: 'INPUT_RANGE', descripcion: `Entrada ${ai.unidad}`, valor: `${ai.rango[0]}..${ai.rango[1]}`, origen: 'CONFIGURADO' },
					...(calidad ? [{ codigo: 'LOOP_QUALITY', descripcion: 'Resultado físico del lazo', valor: calidad, origen: 'CALCULADO' as const }] : []),
				], relatedEntities: entidades([fuente.dispositivo.id, plc.id]), provenance: faltan.length ? 'NO_DISPONIBLE' : 'CALCULADO',
				criterion: { descripcion: 'Perfiles explícitos y solver analógico V5/V6', origen: 'MODELO_V7' }, missingData: faltan,
				remediationHints: status === 'FAIL' ? ['Corregir tipo/rango o el margen de compliance del lazo.'] : [],
			});
		}
	}
	return salida;
}

function resultadosPe(proyecto: Proyecto): Resultado[] {
	const conPe = proyecto.dispositivos.filter((d) => d.bornes.some((b) => b.tipo === 'PE'));
	if (!conPe.length) return [{ code: 'TS-PE-NOT-APPLICABLE', category: 'PE', severity: 'INFO', status: 'NOT_APPLICABLE',
		title: 'Sin bornes PE declarados', description: 'No hay equipos con borne PE explícito que validar.', evidence: [],
		relatedEntities: [{ tipo: 'PROJECT', id: proyecto.nombre }], provenance: 'NO_DISPONIBLE', missingData: [], remediationHints: [] }];
	const hallazgos = verificarProyecto(proyecto, calcularPotenciales(proyecto))
		.filter((h) => h.regla === 'R11-sin-tierra' || h.regla === 'R16-tierra-mas-fina-que-la-fase');
	const afectados = new Set(hallazgos.flatMap((h) => h.dispositivoId ? [h.dispositivoId] : []));
	const conectado = conectividadPasiva(proyecto);
	const referencias = proyecto.dispositivos.flatMap((d) => d.fisica?.fuente?.referenciaPe
		? [nodo(d.id, d.fisica.fuente.referenciaPe)] : []);
	return [
		...hallazgos.map((h): Resultado => ({ code: h.regla === 'R11-sin-tierra' ? 'TS-PE-DISCONNECTED' : 'TS-PE-SECTION',
			category: 'PE', severity: 'ERROR', status: 'FAIL', title: 'Protección PE', description: h.mensaje,
			evidence: [{ codigo: h.regla, descripcion: h.mensaje, origen: 'CALCULADO' }],
			relatedEntities: [
				...(h.dispositivoId ? [{ tipo: 'DEVICE' as const, id: h.dispositivoId }] : []),
				...(h.conductorId ? [{ tipo: 'CONDUCTOR' as const, id: h.conductorId }] : []),
			], provenance: 'CALCULADO', criterion: { descripcion: 'Hallazgo elevado desde DRC existente', origen: 'MODELO_V7' }, missingData: [],
			remediationHints: ['Revisar continuidad y sección del conductor de protección.'] })),
		...conPe.filter((d) => !afectados.has(d.id)).map((d): Resultado => {
			const tieneReferencia = d.bornes.filter((b) => b.tipo === 'PE')
				.some((b) => referencias.some((r) => conectado(nodo(d.id, b.id), r)));
			return { code: tieneReferencia ? 'TS-PE-PATH' : 'TS-PE-REFERENCE-MISSING', category: 'PE', severity: 'INFO',
				status: tieneReferencia ? 'PASS' : 'INDETERMINATE', title: tieneReferencia ? 'Camino PE explícito' : 'Referencia PE no demostrada',
				description: tieneReferencia
					? 'El borne PE conectado alcanza una referencia PE declarada por la fuente física.'
					: 'El borne no está aislado, pero el modelo no permite demostrar que su red PE alcance una referencia explícita.',
				evidence: [{ codigo: 'DRC_R11_R16', descripcion: 'Reglas PE existentes sin hallazgo', origen: 'CALCULADO' }],
				relatedEntities: entidades([d.id]), provenance: tieneReferencia ? 'CALCULADO' : 'NO_DISPONIBLE',
				criterion: { descripcion: 'DRC R11/R16 y referenciaPe persistente', origen: 'MODELO_V7' },
				missingData: tieneReferencia ? [] : ['camino hasta una referencia PE explícita'],
				remediationHints: tieneReferencia ? [] : ['Declarar referenciaPe en la fuente física o completar el camino de protección.'] };
		}),
	];
}

export const REGLA_COMPATIBILIDAD_EQUIPOS: EngineeringRule = {
	code: 'TS-EQUIPMENT-COMPATIBILITY', category: 'CIRCUIT', scope: 'PROJECT',
	evaluate(contexto) {
		const resultados = [
			...resultadosDoBobina(contexto.proyecto),
			...resultadosTensionFrecuencia(contexto.proyecto, contexto.circuitos),
			...resultadosMotorVfd(contexto.proyecto, contexto.circuitos, contexto.fisica),
			...resultadosAnalogicos(contexto.proyecto, contexto.fisica),
			...resultadosPe(contexto.proyecto),
		];
		return resultados.length ? resultados : [{ code: 'TS-EQUIPMENT-NONE', category: 'CIRCUIT', severity: 'INFO', status: 'NOT_APPLICABLE',
			title: 'Sin compatibilidades evaluables', description: 'No hay pares de equipos con perfiles explícitos compatibles con estas reglas.',
			evidence: [], relatedEntities: [{ tipo: 'PROJECT', id: contexto.proyecto.nombre }], provenance: 'NO_DISPONIBLE', missingData: [], remediationHints: [] }];
	},
};
