/** Reglas V7 de compatibilidad entre perfiles persistentes explícitos. */
import { resolverLazo420, resolverSenal010, resistenciaCaminoAnalogico } from '../fisica/analogicas.js';
import { calcularPlacaMotor } from '../fisica/motores.js';
import { resolverComportamiento, type ComportamientoSimulacion } from '../modelo/comportamiento.js';
import type { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { verificarProyecto } from '../motores/drc.js';
import { calcularPotenciales } from '../motores/potenciales.js';
import type { CircuitoIngenieria } from './circuitos.js';
import type { ContextoValidacionIngenieria, EngineeringRule, ResultadoReglaIngenieria } from './validacion.js';
import { resolverProyectoTecnico, type ResultadoProyectoTecnico } from '../datos-tecnicos/resolver.js';
import type { CampoTecnico } from '../datos-tecnicos/campos.js';
import { evaluarCondicionesTecnicas } from '../datos-tecnicos/condiciones.js';
import { indexarRevisiones, verificarRevision } from '../datos-tecnicos/hash.js';
import { claveRevision, type ReferenciaTecnica } from '../datos-tecnicos/tipos.js';

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

interface CargaSalidaDigital {
	dispositivoId: string;
	entradas: readonly string[];
	corrienteA?: number;
	corrienteLlamadaA?: number;
}

function dato(tecnica: ResultadoProyectoTecnico | undefined, id: string, campo: CampoTecnico, canal?: string) {
	const d = tecnica?.resoluciones.find(r => r.entidad === 'DEVICE' && r.entidadId === id && r.campo === campo && r.canal === canal);
	return d?.estado === 'RESOLVED' ? d.dato?.valor : undefined;
}
const numeroDato = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** Solo consumos declarados: no se deduce I=P/V ni se cuenta cada cable como otra carga. */
function cargasSalidasDigitales(proyecto: Proyecto, tecnica?: ResultadoProyectoTecnico): CargaSalidaDigital[] {
	return [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id)).flatMap((d): CargaSalidaDigital[] => {
		const p = resolverComportamiento(d); let entradas: readonly string[] = [];
		let corriente = d.corrienteNominal;
		if (p?.clase === 'contactos-electromagneticos') {
			entradas = [p.bobina.entrada]; corriente = p.bobina.electrica?.corrienteA;
		} else if (p?.clase === 'carga') {
			entradas = p.alimentacion.fases;
			if (corriente === undefined && d.fisica?.carga?.modelo === 'CONSTANT_I') corriente = d.fisica.carga.corrienteA;
		} else if (p?.clase === 'sensor' && p.alimentacion) entradas = [p.alimentacion.entrada];
		else if (p?.clase === 'controlador') entradas = p.alimentacion.entradas;
		else if (p?.clase === 'fuente' && p.primario) entradas = p.primario.entradas;
		else if (p?.clase === 'variador') entradas = p.alimentacion.fases;
		if (!entradas.length) return [];
		if (tecnica?.problemas.some(x => x.entidad === 'DEVICE' && x.entidadId === d.id)) corriente = undefined;
		return [{ dispositivoId: d.id, entradas, corrienteA: numeroDato(corriente),
			corrienteLlamadaA: numeroDato(dato(tecnica, d.id, 'bobina.corrienteLlamadaA')) }];
	});
}

function resultadoCargaCanal(plc: Dispositivo, sd: Extract<ComportamientoSimulacion, { clase: 'controlador' }>['salidasDigitales'][number],
	cargas: readonly CargaSalidaDigital[]): Resultado {
	const conocidas = cargas.filter((c) => c.corrienteA !== undefined);
	const corrienteA = conocidas.reduce((total, c) => total + c.corrienteA!, 0);
	const limite = sd.electrica?.corrienteMaxA;
	const limiteValido = limite !== undefined && Number.isFinite(limite) && limite >= 0;
	const faltan = cargas.filter((c) => c.corrienteA === undefined).map((c) => `corriente de carga ${c.dispositivoId}`);
	if (!limiteValido) faltan.push(`corriente máxima del canal ${plc.id}::${sd.borne}`);
	/* Una suma parcial ya excesiva demuestra FAIL; una suma parcial baja no demuestra PASS. */
	const sobrecarga = limiteValido && corrienteA - limite > 1e-9 * Math.max(1, corrienteA, limite);
	const status: Estado = sobrecarga ? 'FAIL' : faltan.length ? 'INDETERMINATE' : 'PASS';
	return { code: 'TS-IO-DO-CHANNEL-LOAD', category: 'IO', severity: sobrecarga ? 'ERROR' : 'INFO', status,
		title: `Carga total de salida ${plc.designacion ?? plc.id} / ${sd.borne}`,
		description: sobrecarga ? 'La suma de los consumos declarados supera la capacidad del canal.'
			: faltan.length ? 'Faltan consumos o capacidad: la suma conocida no permite aprobar el canal.'
				: 'La suma de los consumos declarados no supera el límite del canal, suponiendo todas las cargas simultáneas.',
		evidence: [{ codigo: 'CHANNEL_I_KNOWN', descripcion: 'Suma de consumos declarados; las cargas desconocidas no se suponen de consumo cero',
			valor: corrienteA, unidad: 'A', origen: 'CALCULADO' },
			{ codigo: 'CHANNEL_LOADS', descripcion: 'Cargas explícitas conectadas al canal', valor: cargas.length, origen: 'CALCULADO' },
			...(limiteValido ? [{ codigo: 'DO_IMAX', descripcion: 'Capacidad nominal del canal', valor: limite, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
			...conocidas.map((c) => ({ codigo: `LOAD_I:${c.dispositivoId}`, descripcion: `Consumo declarado de ${c.dispositivoId}`,
				valor: c.corrienteA, unidad: 'A', origen: 'CONFIGURADO' as const }))],
		relatedEntities: [...entidades([plc.id, ...cargas.map((c) => c.dispositivoId)]), { tipo: 'TERMINAL', id: nodo(plc.id, sd.borne) }],
		provenance: 'CALCULADO', criterion: { descripcion: 'Suma nominal simultánea por canal; no modela corriente de llamada ni capacidad de grupo', origen: 'MODELO_V7' },
		missingData: faltan, remediationHints: sobrecarga ? ['Revisar distribución de cargas o interfaz mediante relé intermedio.']
			: faltan.length ? ['Completar los consumos declarados y el límite de este canal.'] : [] };
}

function resultadosDoBobina(ctx: ContextoValidacionIngenieria): Resultado[] {
	const proyecto = ctx.proyecto, tecnica = ctx.tecnica;
	const conectado = conectividadPasiva(proyecto); const salida: Resultado[] = [];
	const cargas = cargasSalidasDigitales(proyecto, tecnica);
	const bobinas = proyecto.dispositivos.flatMap((d) => {
		const p = resolverComportamiento(d);
		return p?.clase === 'contactos-electromagneticos' ? [{ d, p }] : [];
	});
	for (const plc of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const p = resolverComportamiento(plc); if (p?.clase !== 'controlador') continue;
		const problemaPlc = tecnica?.problemas.some(x => x.entidad === 'DEVICE' && x.entidadId === plc.id);
		for (const sd of [...p.salidasDigitales].sort((a, b) => a.borne.localeCompare(b.borne))) {
			const conectadas = cargas.filter((c) => c.dispositivoId !== plc.id
				&& c.entradas.some((b) => conectado(nodo(plc.id, sd.borne), nodo(c.dispositivoId, b))));
			if (conectadas.length) salida.push(resultadoCargaCanal(plc, problemaPlc ? { ...sd, electrica: undefined } : sd, conectadas));
			if (conectadas.length && proyecto.datosTecnicos) salida.push(resultadoSumaIo({ plcId: plc.id, clave: `canal:${sd.borne}`,
				code: 'TS-IO-DO-CHANNEL-INRUSH', cargas: conectadas, llamada: true,
				limite: numeroDato(dato(tecnica, plc.id, 'plc.corrienteLlamadaMaxA', sd.borne)), motivos: [], canales: [sd.borne] }));
			for (const { d: carga, p: pc } of bobinas) {
				if (!conectado(nodo(plc.id, sd.borne), nodo(carga.id, pc.bobina.entrada))) continue;
				const so = sd.electrica; const bo = pc.bobina.electrica; const faltan: string[] = [];
				if (problemaPlc || tecnica?.problemas.some(x => x.entidad === 'DEVICE' && x.entidadId === carga.id)) faltan.push('revisión técnica de salida/bobina no resoluble');
				if (!so) faltan.push('datos eléctricos de salida digital');
				if (!bo) faltan.push('datos eléctricos de bobina');
				if (so && bo && so.corrienteMaxA === undefined) faltan.push('corriente máxima de salida');
				if (so && bo && bo.corrienteA === undefined) faltan.push('corriente de bobina');
				if (so && bo && (so.tensionV === undefined || bo.tensionNominalV === undefined || so.sistema === undefined || bo.sistema === undefined)) faltan.push('tensión/sistema explícitos de salida y bobina');
				const estados: Estado[] = [];
				if (faltan.length) estados.push('INDETERMINATE');
				const rango = dato(tecnica, carga.id, 'bobina.tensionRangoV');
				const rangoDeclarado = tecnica?.resoluciones.find(r => r.entidadId === carga.id && r.campo === 'bobina.tensionRangoV');
				if (rangoDeclarado && rangoDeclarado.estado !== 'RESOLVED') faltan.push('rango técnico aplicable de bobina');
				if (so && bo) {
					const tensionIncompatible = Array.isArray(rango) ? so.tensionV < rango[0] || so.tensionV > rango[1]
						: Math.abs(so.tensionV - bo.tensionNominalV) > Math.max(1, bo.tensionNominalV * 0.01);
					if (so.sistema !== undefined && bo.sistema !== undefined && so.sistema !== bo.sistema
						|| so.tensionV !== undefined && bo.tensionNominalV !== undefined && tensionIncompatible) estados.push('FAIL');
					else if (so.sistema !== undefined && bo.sistema !== undefined && so.tensionV !== undefined && bo.tensionNominalV !== undefined) estados.push('PASS');
					if (so.corrienteMaxA !== undefined && bo.corrienteA !== undefined) estados.push(bo.corrienteA > so.corrienteMaxA ? 'FAIL' : 'PASS');
					if (proyecto.datosTecnicos) {
						const tipoCarga = dato(tecnica, plc.id, 'plc.tipoCarga', sd.borne);
						if (tipoCarga === 'RESISTIVA') estados.push('FAIL');
						else if (tipoCarga !== 'INDUCTIVA') faltan.push('capacidad de la salida para carga inductiva');
						if (bo.sistema === 'AC') {
							const frecuencia = proyecto.datosTecnicos.vinculos.find(v => v.entidad === 'DEVICE' && v.entidadId === plc.id)?.condiciones.frecuenciaHz;
							if (typeof frecuencia !== 'number' || bo.frecuenciaHz === undefined) faltan.push('frecuencia explícita de salida AC y bobina');
							else if (Math.abs(frecuencia - bo.frecuenciaHz) > 0.01) estados.push('FAIL');
						}
					}
				}
				if (faltan.length) estados.push('INDETERMINATE');
				const status = peor(estados);
				salida.push({ code: 'TS-IO-DO-COIL', category: 'IO', severity: status === 'FAIL' ? 'ERROR' : 'INFO', status,
					title: 'Salida digital y bobina', description: status === 'FAIL'
						? 'Los límites eléctricos explícitos de la salida y la bobina no son compatibles.'
						: status === 'INDETERMINATE' ? 'La conexión existe, pero faltan datos para validar su carga eléctrica.'
							: 'Los datos nominales de salida y bobina son compatibles individualmente; revisar también la carga total del canal.',
					evidence: [
						...(so ? [{ codigo: 'DO_V', descripcion: `${so.tipoSalida} ${so.sistema}`, valor: so.tensionV, unidad: 'V', origen: 'CONFIGURADO' as const }] : []),
						...(so?.corrienteMaxA !== undefined ? [{ codigo: 'DO_IMAX', descripcion: 'Corriente máxima de salida', valor: so.corrienteMaxA, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
						...(bo ? [{ codigo: 'COIL_V', descripcion: `Bobina ${bo.sistema}`, valor: bo.tensionNominalV, unidad: 'V', origen: 'CONFIGURADO' as const }] : []),
						...(bo?.corrienteA !== undefined ? [{ codigo: 'COIL_I', descripcion: 'Consumo de bobina', valor: bo.corrienteA, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
						...(Array.isArray(rango) ? [{ codigo: 'COIL_V_RANGE', descripcion: 'Rango de tensión explícito resuelto', valor: `${rango[0]}..${rango[1]}`, unidad: 'V', origen: 'CONFIGURADO' as const }] : []),
					], relatedEntities: entidades([plc.id, carga.id]), provenance: faltan.length ? 'NO_DISPONIBLE' : 'CONFIGURADO',
					criterion: { descripcion: 'Compatibilidad nominal explícita del perfil', origen: 'MODELO_V7' }, missingData: faltan,
					remediationHints: status === 'FAIL' ? ['Revisar interfaz o relé intermedio; V7 no lo inserta automáticamente.'] : [],
				});
			}
		}
		if (proyecto.datosTecnicos) salida.push(...resultadosGruposIo(ctx, plc, cargas, conectado));
	}
	return salida;
}

function resultadoSumaIo(entrada: { plcId: string; clave: string; code: Resultado['code']; cargas: readonly CargaSalidaDigital[];
	llamada: boolean; limite?: number; motivos: string[]; canales: string[]; referencia?: ReferenciaTecnica; procedencia?: string }): Resultado {
	const propiedad = entrada.llamada ? 'corrienteLlamadaA' : 'corrienteA';
	const suma = entrada.cargas.reduce((s, c) => s + (c[propiedad] ?? 0), 0);
	const faltantes = [...entrada.motivos, ...entrada.cargas.filter(c => c[propiedad] === undefined).map(c => `${propiedad} de ${c.dispositivoId}`),
		...(entrada.limite === undefined ? [`capacidad ${entrada.llamada ? 'de llamada' : 'sostenida'}`] : [])];
	const falla = entrada.limite !== undefined && suma - entrada.limite > 1e-9 * Math.max(1, suma, entrada.limite);
	const status: Estado = falla ? 'FAIL' : faltantes.length ? 'INDETERMINATE' : 'PASS';
	return { code: entrada.code, category: 'IO', severity: falla ? 'ERROR' : 'INFO', status,
		title: `${entrada.llamada ? 'Llamada' : 'Carga sostenida'} ${entrada.clave}`,
		description: 'Suma simultánea de corrientes declaradas; los consumos desconocidos no se suponen cero. No modela una envolvente temporal de arranques.',
		evidence: [{ codigo: 'IO_KNOWN_SUM', descripcion: 'Suma conocida, no necesariamente suma completa', valor: suma, unidad: 'A', origen: 'CALCULADO' },
			{ codigo: 'IO_CHANNELS', descripcion: 'Identidades persistentes de canales', valor: [...entrada.canales].sort().join(', '), origen: 'CONFIGURADO' },
			...(entrada.limite !== undefined ? [{ codigo: 'IO_LIMIT', descripcion: 'Límite aplicable declarado', valor: entrada.limite, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
			...(entrada.referencia ? [{ codigo: 'IO_REFERENCE', descripcion: entrada.procedencia ?? '',
				valor: `${entrada.referencia.catalogoId}/${entrada.referencia.id}@${entrada.referencia.revision}#${entrada.referencia.hash}`, origen: 'CONFIGURADO' as const }] : [])],
		relatedEntities: [...entidades([entrada.plcId, ...entrada.cargas.map(c => c.dispositivoId)]),
			...entrada.canales.map(c => ({ tipo: 'TERMINAL' as const, id: nodo(entrada.plcId, c) }))],
		provenance: 'CALCULADO', missingData: faltantes, remediationHints: [],
		criterion: { descripcion: `Límite explícito ${entrada.llamada ? 'de llamada' : 'sostenido'} ${entrada.clave}`, origen: 'CONFIGURADO' } };
}

function resultadosGruposIo(ctx: ContextoValidacionIngenieria, plc: Dispositivo, cargas: CargaSalidaDigital[],
	conectado: (a: string, b: string) => boolean): Resultado[] {
	const cfg = ctx.proyecto.datosTecnicos!, vinculo = cfg.vinculos.find(v => v.entidad === 'DEVICE' && v.entidadId === plc.id);
	if (!vinculo) return [];
	const salida: Resultado[] = []; let revision;
	try { revision = indexarRevisiones(cfg.revisiones, false).get(claveRevision(vinculo.producto));
		if (!revision || revision.hash !== vinculo.producto.hash || revision.tipo !== 'PRODUCTO' || revision.familia !== 'PLC') throw new Error('Revisión PLC exacta ausente o incompatible.');
		verificarRevision(revision);
	} catch (e) { return [resultadoSumaIo({ plcId: plc.id, clave: 'grupos no resolubles', code: 'TS-IO-DO-GROUP-DATA', cargas: [],
		llamada: false, motivos: [String(e)], canales: [] })]; }
	const perfil = resolverComportamiento(plc); if (perfil?.clase !== 'controlador') return [];
	for (const grupo of [...(revision.gruposSalidas ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
		const condicion = evaluarCondicionesTecnicas({ declaradas: grupo.condiciones, actuales: vinculo.condiciones });
		const motivos = [...condicion.motivos];
		for (const canal of grupo.canales) if (!perfil.salidasDigitales.some(s => s.borne === canal)) motivos.push(`Canal ${canal} no existe en el perfil PLC.`);
		const conectadas = cargas.filter(c => c.dispositivoId !== plc.id && grupo.canales.some(canal =>
			c.entradas.some(b => conectado(nodo(plc.id, canal), nodo(c.dispositivoId, b)))));
		for (const carga of conectadas) if (grupo.canales.filter(canal => carga.entradas.some(b => conectado(nodo(plc.id, canal), nodo(carga.dispositivoId, b)))).length > 1)
			motivos.push(`Carga ${carga.dispositivoId} une varias salidas: reparto de corriente no modelado.`);
		for (const llamada of [false, true]) salida.push(resultadoSumaIo({ plcId: plc.id, clave: `grupo:${grupo.id}`,
			code: llamada ? 'TS-IO-DO-GROUP-INRUSH' : 'TS-IO-DO-GROUP-LOAD', cargas: conectadas, llamada,
			limite: condicion.estado === 'RESOLVED' ? llamada ? grupo.corrienteLlamadaMaxA : grupo.corrienteMaxA : undefined,
			motivos, canales: grupo.canales, referencia: vinculo.producto,
			procedencia: `${revision.procedencia.origen}: ${revision.procedencia.referencia}` }));
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
	for (const motor of [...proyecto.dispositivos].filter((d) => {
		const perfil = resolverComportamiento(d); return perfil?.clase === 'carga' && perfil.efecto === 'giro';
	}).sort((a, b) => a.id.localeCompare(b.id))) {
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
			const candidatas = fuentes.filter((f) => conectado(nodo(plc.id, ai.borne), nodo(f.dispositivo.id, f.borne)))
				.sort((a, b) => nodo(a.dispositivo.id, a.borne).localeCompare(nodo(b.dispositivo.id, b.borne)));
			if (candidatas.length > 1) {
				salida.push({ code: 'TS-ANALOG-SOURCES-AMBIGUOUS', category: 'ANALOG', severity: 'INFO', status: 'INDETERMINATE',
					title: 'Varias fuentes analógicas en la misma entrada', description: 'No se elige la primera fuente del array ni se declara compatible la suma no modelada.',
					evidence: [{ codigo: 'ANALOG_SOURCES', descripcion: 'Fuentes conectadas por señal', valor: candidatas.map(f => nodo(f.dispositivo.id, f.borne)).join(', '), origen: 'CALCULADO' }],
					relatedEntities: [...entidades([plc.id, ...candidatas.map(f => f.dispositivo.id)]), { tipo: 'TERMINAL', id: nodo(plc.id, ai.borne) }],
					provenance: 'NO_DISPONIBLE', missingData: ['fuente única de la entrada analógica'], remediationHints: ['Separar canales o declarar una interfaz sumadora modelada.'] });
				continue;
			}
			const fuente = candidatas[0];
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
					if (rCable === undefined) faltan.push('resistencia/longitud de cable');
					if (!faltan.length) calidad = resolverSenal010({ tensionDemandadaV: fuente.rango[1],
						resistenciaSalidaOhm: configF!.resistenciaSalidaOhm! + rCable!, resistenciaEntradaOhm: configI!.burdenOhm! }).calidad;
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
		if (contexto.proyecto.datosTecnicos && !contexto.tecnica) {
			const tecnica = resolverProyectoTecnico(contexto.proyecto); contexto = { ...contexto, proyecto: tecnica.proyecto, tecnica };
		}
		const resultados = [
			...resultadosDoBobina(contexto),
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
