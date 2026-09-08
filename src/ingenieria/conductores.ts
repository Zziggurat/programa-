import { magnitud } from '../fisica/complejos.js';
import {
	simularFisicaProyecto, type ContextoTopologiaFisica, type ResultadoConductorProyectoFisica,
} from '../fisica/topologia-proyecto.js';
import type { CriteriosCircuitoIngenieria } from '../modelo/ingenieria.js';
import type { Proyecto } from '../modelo/tipos.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import { resolverAmpacidadTecnica } from '../datos-tecnicos/ampacidad.js';
import { evaluarCoordinacionIbInIz, resolverCriteriosTecnicos } from '../datos-tecnicos/criterios.js';
import { resolverProyectoTecnico } from '../datos-tecnicos/resolver.js';
import { descubrirCircuitos, type CircuitoIngenieria } from './circuitos.js';
import { analizarProspectivaProtecciones } from './prospectiva.js';
import type {
	ContextoValidacionIngenieria, EngineeringRule, EstadoValidacionIngenieria, ResultadoReglaIngenieria,
} from './validacion.js';

const tolerancia = (a: number, b: number) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const excede = (valor: number, maximo: number) => valor - maximo > tolerancia(valor, maximo);

function base(c: CircuitoIngenieria, code: ResultadoReglaIngenieria['code'], conductorId: string,
	status: EstadoValidacionIngenieria, title: string, description: string): ResultadoReglaIngenieria {
	return { code, category: 'CABLE', severity: status === 'FAIL' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO',
		status, title, description, circuitId: c.id, evidence: [],
		relatedEntities: [{ tipo: 'CIRCUIT', id: c.id }, ...(conductorId ? [{ tipo: 'CONDUCTOR' as const, id: conductorId }] : [])],
		provenance: 'CALCULADO', missingData: [], remediationHints: [] };
}

function resultadoCaida(c: CircuitoIngenieria, id: string, f: ResultadoConductorProyectoFisica | undefined): ResultadoReglaIngenieria {
	const max = c.criterios?.maxVoltageDropPercent;
	if (!f?.caidaPct && f?.caidaPct !== 0) {
		const r = base(c, 'TS-CABLE-VOLTAGE-DROP-DATA', id, 'INDETERMINATE', 'Caída de tensión no disponible',
			'PhysicsEngine no publicó una caída porcentual para este conductor.');
		r.provenance = 'NO_DISPONIBLE'; r.missingData = ['tensión de referencia o resultado físico del conductor']; return r;
	}
	if (max === undefined) {
		const r = base(c, 'TS-CABLE-VOLTAGE-DROP-CRITERION', id, 'INDETERMINATE', 'Criterio de caída no configurado',
			`La caída calculada es ${f.caidaPct.toFixed(3)} %, pero el proyecto no declara un máximo.`);
		r.evidence = [{ codigo: 'DELTA_V_PCT', descripcion: 'Caída del conductor', valor: f.caidaPct, unidad: '%', origen: 'CALCULADO' },
			{ codigo: 'LONGITUD', descripcion: 'Longitud eléctrica', valor: f.longitudM, unidad: 'm', origen: f.origenLongitud }];
		r.provenance = f.origenLongitud; r.missingData = ['maxVoltageDropPercent'];
		r.remediationHints = ['Configurar un criterio del proyecto o circuito si se desea declarar cumplimiento.']; return r;
	}
	const falla = excede(f.caidaPct, max); const r = base(c, 'TS-CABLE-VOLTAGE-DROP', id, falla ? 'FAIL' : 'PASS',
		falla ? 'Caída superior al criterio configurado' : 'Caída dentro del criterio configurado',
		`Caída ${f.caidaPct.toFixed(3)} % frente al máximo configurado ${max} %.`);
	r.evidence = [{ codigo: 'DELTA_V_PCT', descripcion: 'Caída del conductor', valor: f.caidaPct, unidad: '%', origen: 'CALCULADO' },
		{ codigo: 'SECCION', descripcion: 'Sección', valor: f.seccionMm2, unidad: 'mm²', origen: f.origenSeccion },
		{ codigo: 'LONGITUD', descripcion: 'Longitud eléctrica', valor: f.longitudM, unidad: 'm', origen: f.origenLongitud }];
	r.criterion = { descripcion: 'Máxima caída configurada', valor: max, unidad: '%', origen: 'CONFIGURADO' };
	if (falla) r.remediationHints = ['Evaluar una sección mayor o revisar longitud, carga y criterio configurado.'];
	return r;
}

function resultadoPerdida(c: CircuitoIngenieria, id: string, f: ResultadoConductorProyectoFisica | undefined): ResultadoReglaIngenieria[] {
	const r: ResultadoReglaIngenieria[] = []; const maxW = c.criterios?.maxLossW;
	if (maxW !== undefined) {
		if (!f) { const x = base(c, 'TS-CABLE-LOSS-DATA', id, 'INDETERMINATE', 'Pérdida no disponible', 'Falta el resultado físico del conductor.');
			x.provenance = 'NO_DISPONIBLE'; x.missingData = ['resultado físico del conductor']; r.push(x); }
		else { const falla = excede(f.perdidaW, maxW); const x = base(c, 'TS-CABLE-LOSS', id, falla ? 'FAIL' : 'PASS',
			falla ? 'Pérdida superior al criterio configurado' : 'Pérdida dentro del criterio configurado',
			`Pérdida ${f.perdidaW.toFixed(3)} W frente al máximo configurado ${maxW} W.`);
			x.evidence = [{ codigo: 'P_LOSS', descripcion: 'Pérdida I²R', valor: f.perdidaW, unidad: 'W', origen: 'CALCULADO' }];
			x.criterion = { descripcion: 'Máxima pérdida configurada', valor: maxW, unidad: 'W', origen: 'CONFIGURADO' }; r.push(x); }
	}
	if (c.criterios?.maxLossPercent !== undefined) {
		const x = base(c, 'TS-CABLE-LOSS-PERCENT-DATA', id, 'INDETERMINATE', 'Porcentaje de pérdidas no evaluable todavía',
			'La pérdida del conductor existe, pero falta una frontera de potencia inequívoca del circuito para calcular su porcentaje.');
		x.provenance = 'NO_DISPONIBLE'; x.missingData = ['potencia de entrada del circuito sin doble conteo'];
		x.criterion = { descripcion: 'Máximo porcentaje de pérdidas configurado', valor: c.criterios.maxLossPercent,
			unidad: '%', origen: 'CONFIGURADO' }; r.push(x);
	}
	return r;
}

function resultadoAmpacidad(c: CircuitoIngenieria, id: string, f: ResultadoConductorProyectoFisica | undefined): ResultadoReglaIngenieria {
	const perfil = c.criterios?.ampacityProfile;
	if (!perfil) {
		const r = base(c, 'TS-CABLE-AMPACITY-DATA', id, 'INDETERMINATE', 'Ampacidad no modelada',
			'No se configuró una tabla técnica de capacidad de corriente; V7 no incorpora una tabla normativa implícita.');
		r.provenance = 'NO_MODELADO'; r.missingData = ['ampacityProfile'];
		r.remediationHints = ['Configurar una tabla técnica aplicable y documentar su fuente.']; return r;
	}
	if (!f) { const r = base(c, 'TS-CABLE-AMPACITY-DATA', id, 'INDETERMINATE', 'Corriente del conductor no disponible',
		'No existe resultado físico para compararlo con la tabla configurada.'); r.provenance = 'NO_DISPONIBLE';
		r.missingData = ['resultado físico del conductor']; return r; }
	const punto = perfil.puntos.find((p) => Math.abs(p.seccionMm2 - f.seccionMm2) <= tolerancia(p.seccionMm2, f.seccionMm2));
	if (!punto) { const r = base(c, 'TS-CABLE-AMPACITY-DATA', id, 'INDETERMINATE', 'Sección ausente en la tabla configurada',
		`La tabla ${perfil.nombre} no contiene ${f.seccionMm2} mm².`); r.provenance = 'NO_DISPONIBLE';
		r.missingData = [`ampacidad para ${f.seccionMm2} mm²`]; return r; }
	const falla = excede(f.corrienteA, punto.corrienteMaxA); const r = base(c, 'TS-CABLE-AMPACITY', id, falla ? 'FAIL' : 'PASS',
		falla ? 'Corriente superior a la tabla configurada' : 'Corriente dentro de la tabla configurada',
		`${f.corrienteA.toFixed(3)} A frente a ${punto.corrienteMaxA} A de ${perfil.nombre}.`);
	r.evidence = [{ codigo: 'I', descripcion: 'Corriente calculada', valor: f.corrienteA, unidad: 'A', origen: 'CALCULADO' },
		{ codigo: 'SECCION', descripcion: 'Sección', valor: f.seccionMm2, unidad: 'mm²', origen: f.origenSeccion },
		{ codigo: 'TABLE_SOURCE', descripcion: perfil.fuente, valor: perfil.nombre, origen: 'CONFIGURADO' }];
	r.criterion = { descripcion: `Tabla configurada ${perfil.nombre}`, valor: punto.corrienteMaxA, unidad: 'A', origen: 'CONFIGURADO' };
	return r;
}

/** Demanda declarada por cargas de todos los trayectos que usan el tramo, no corriente instantánea. */
function demandaTramo(ctx: ContextoValidacionIngenieria, id: string): { ibA?: number; faltantes: string[]; cargas: string[] } {
	const circuitos = ctx.circuitos.filter(c => c.conductores.includes(id));
	const cargas = [...new Set(circuitos.flatMap(c => c.trayectos.filter(t => t.conductores.includes(id))
		.flatMap(t => c.cargas.filter(carga => t.dispositivos.includes(carga)))))].sort();
	const faltantes: string[] = []; let total = 0;
	if (!cargas.length) faltantes.push('cargas aguas abajo identificadas por trayecto');
	if (circuitos.some(c => c.estadoTopologia !== 'INEQUIVOCA')) faltantes.push('topología inequívoca de la demanda del tramo');
	for (const carga of cargas) {
		if (ctx.tecnica?.problemas.some(p => p.entidad === 'DEVICE' && p.entidadId === carga)) {
			faltantes.push(`datos técnicos de carga ${carga} sin resolver`); continue;
		}
		const d = ctx.proyecto.dispositivos.find(d => d.id === carga), p = d && resolverComportamiento(d);
		const corriente = p?.clase === 'contactos-electromagneticos' ? p.bobina.electrica?.corrienteA
			: ctx.fisica?.motores.get(carga)?.corrienteNominalUsadaA ?? d?.corrienteNominal
				?? (d?.fisica?.carga?.modelo === 'CONSTANT_I' ? d.fisica.carga.corrienteA : undefined);
		if (corriente === undefined || !Number.isFinite(corriente) || corriente < 0) faltantes.push(`corriente de diseño de ${carga}`);
		else total += corriente;
	}
	return { ibA: faltantes.length ? undefined : total, faltantes, cargas };
}

/** Protección más próxima antes del segmento: todos los trayectos deben coincidir. */
function proteccionTramo(ctx: ContextoValidacionIngenieria, id: string): string | undefined {
	const conductor = ctx.proyecto.conductores.find(c => c.id === id); if (!conductor) return undefined;
	const extremos = [conductor.de, conductor.a].map(b => `${b.dispositivoId}::${b.borneId}`);
	const candidatas = new Set<string>(); let sin = false;
	for (const c of ctx.circuitos.filter(c => c.conductores.includes(id))) {
		if (c.estadoTopologia !== 'INEQUIVOCA') return undefined;
		for (const t of c.trayectos.filter(t => t.conductores.includes(id))) {
			const i = t.nodos.findIndex((n, i) => extremos.includes(n) && extremos.includes(t.nodos[i + 1]));
			if (i < 0) { sin = true; continue; }
			let anterior: string | undefined;
			for (let j = 0; j < i; j++) {
				const dispositivo = dispositivoNodo(t.nodos[j]);
				if (dispositivo === dispositivoNodo(t.nodos[j + 1]) && c.protecciones.includes(dispositivo)) anterior = dispositivo;
			}
			if (anterior) candidatas.add(anterior); else sin = true;
		}
	}
	return !sin && candidatas.size === 1 ? [...candidatas][0] : undefined;
}

function resultadosAmpacidadTecnica(ctx: ContextoValidacionIngenieria, c: CircuitoIngenieria, id: string,
	f: ResultadoConductorProyectoFisica | undefined): ResultadoReglaIngenieria[] {
	const seccion = f?.seccionMm2 ?? ctx.proyecto.conductores.find(x => x.id === id)?.seccion;
	const amp = resolverAmpacidadTecnica(ctx.proyecto.datosTecnicos, id, seccion), demanda = demandaTramo(ctx, id);
	const erroresTramo = ctx.tecnica?.problemas.filter(p => p.entidad === 'CONDUCTOR' && p.entidadId === id) ?? [];
	if (erroresTramo.length) { amp.estado = 'CONFLICT'; amp.izA = undefined; amp.motivos.push(...erroresTramo.map(p => p.motivo)); }
	const disponible = amp.estado === 'RESOLVED' && amp.izA !== undefined;
	const falla = disponible && demanda.ibA !== undefined && excede(demanda.ibA, amp.izA!);
	const r = base(c, 'TS-CABLE-AMPACITY', id, falla ? 'FAIL' : disponible && demanda.ibA !== undefined ? 'PASS' : 'INDETERMINATE',
		'Corriente de diseño frente a ampacidad', 'Comprobación parcial Ib ≤ Iz; no sustituye la coordinación Ib ≤ In ≤ Iz.');
	r.missingData = [...amp.faltantes, ...amp.motivos, ...demanda.faltantes];
	r.evidence = [{ codigo: 'AMPACITY_STATE', descripcion: [...amp.motivos, ...amp.advertencias].join(' '), valor: amp.estado, origen: 'CONFIGURADO' },
		{ codigo: 'AMPACITY_LOADS', descripcion: 'Cargas asociadas al tramo; sin asumir corriente cero en reposo', valor: demanda.cargas.join(', '), origen: 'CALCULADO' },
		...(demanda.ibA !== undefined ? [{ codigo: 'IB', descripcion: 'Suma de demanda nominal declarada', valor: demanda.ibA, unidad: 'A', origen: 'CALCULADO' as const }] : []),
		...(f ? [{ codigo: 'I_OPERATING', descripcion: 'Corriente instantánea separada de Ib', valor: f.corrienteA, unidad: 'A', origen: 'CALCULADO' as const }] : []),
		...(amp.izBaseA !== undefined ? [{ codigo: 'IZ_BASE', descripcion: 'Capacidad de las filas base seleccionadas', valor: amp.izBaseA, unidad: 'A', origen: 'CONFIGURADO' as const }] : []),
		...(amp.izA !== undefined ? [{ codigo: 'IZ', descripcion: amp.transformaciones.join(' '), valor: amp.izA, unidad: 'A', origen: 'CALCULADO' as const }] : []),
		...amp.filasBase.map((fila, i) => ({ codigo: `AMPACITY_ROW_${i}`, descripcion: 'Fila exacta de cálculo', valor: JSON.stringify(fila), origen: 'CONFIGURADO' as const })),
		...amp.factoresAplicados.map(factor => ({ codigo: `AMPACITY_FACTOR_${factor.id}`, descripcion: `${factor.dimension}; entrada ${factor.entrada}; ${factor.politica}`, valor: factor.factor, origen: 'CALCULADO' as const })),
	];
	if (amp.referencia) r.evidence.push({ codigo: 'AMPACITY_REFERENCE', descripcion: `${amp.procedencia?.origen}: ${amp.procedencia?.referencia}`,
		valor: `${amp.referencia.catalogoId}/${amp.referencia.id}@${amp.referencia.revision}#${amp.referencia.hash}`, origen: 'CONFIGURADO' });
	r.provenance = disponible ? 'CALCULADO' : 'NO_DISPONIBLE';
	const proteccionId = proteccionTramo(ctx, id), proteccion = ctx.proyecto.dispositivos.find(d => d.id === proteccionId);
	const errorProteccion = ctx.tecnica?.problemas.some(p => p.entidad === 'DEVICE' && p.entidadId === proteccionId)
		|| ctx.tecnica?.resoluciones.some(r => r.entidad === 'DEVICE' && r.entidadId === proteccionId && r.campo === 'proteccion.inA' && r.estado !== 'RESOLVED');
	const inA = errorProteccion ? undefined : proteccion?.fisica?.proteccion?.inA ?? proteccion?.corrienteNominal;
	const criterio = resolverCriteriosTecnicos(ctx.proyecto.datosTecnicos, c.id, c.criterios).parametros.coordinarIbInIz;
	const coord = evaluarCoordinacionIbInIz({ criterio, ibA: demanda.ibA, inA, izA: disponible ? amp.izA : undefined });
	const rc = base(c, 'TS-CABLE-IB-IN-IZ', id, coord.estado, 'Coordinación Ib ≤ In ≤ Iz', coord.motivos.join(' '));
	rc.evidence = structuredClone(r.evidence); rc.missingData = [...coord.faltantes, ...(!proteccionId ? ['protección aguas arriba inequívoca del tramo'] : [])];
	if (proteccionId) rc.relatedEntities.push({ tipo: 'DEVICE', id: proteccionId });
	if (inA !== undefined) rc.evidence.push({ codigo: 'IN', descripcion: `Calibre de la protección aguas arriba ${proteccionId}`, valor: inA, unidad: 'A', origen: 'CONFIGURADO' });
	rc.evidence.push({ codigo: 'COORDINATION_CRITERION', descripcion: criterio.motivos.join(' '), valor: JSON.stringify(criterio.decision ?? criterio.estado), origen: 'CONFIGURADO' });
	rc.criterion = { descripcion: `Criterio de coordinación ${criterio.origen ?? 'ausente'}`, origen: 'CONFIGURADO' };
	return [r, rc];
}

function circuitoConCriterios(ctx: Pick<ContextoValidacionIngenieria, 'proyecto'>, c: CircuitoIngenieria): CircuitoIngenieria {
	if (!ctx.proyecto.datosTecnicos) return c;
	const efectivos = resolverCriteriosTecnicos(ctx.proyecto.datosTecnicos, c.id, c.criterios);
	const copia = { ...c, criterios: { ...c.criterios } };
	for (const k of ['maxVoltageDropPercent', 'maxLossW', 'maxLossPercent'] as const) {
		const d = efectivos.parametros[k];
		if (d.estado === 'RESOLVED' && d.decision?.modo === 'VALOR' && typeof d.decision.valor === 'number') copia.criterios[k] = d.decision.valor;
		else delete copia.criterios[k];
	}
	return copia;
}

function caidaSegunCriterio(ctx: Pick<ContextoValidacionIngenieria, 'proyecto'>, c: CircuitoIngenieria, id: string,
	f: ResultadoConductorProyectoFisica | undefined): ResultadoReglaIngenieria {
	if (ctx.proyecto.datosTecnicos) {
		const criterio = resolverCriteriosTecnicos(ctx.proyecto.datosTecnicos, c.id, c.criterios).parametros.maxVoltageDropPercent;
		if (criterio.estado === 'NOT_APPLICABLE') {
			const r = base(c, 'TS-CABLE-VOLTAGE-DROP-CRITERION', id, 'NOT_APPLICABLE', 'Criterio de caída no aplicado', criterio.motivos.join(' '));
			r.evidence = [{ codigo: 'VOLTAGE_CRITERION', descripcion: criterio.origen ?? '', valor: JSON.stringify(criterio.decision), origen: 'CONFIGURADO' }]; return r;
		}
	}
	return resultadoCaida(c, id, f);
}

export const REGLA_CONDUCTORES: EngineeringRule = {
	code: 'TS-CABLE-DESIGN', category: 'CABLE', scope: 'CIRCUIT',
	evaluate(contexto) {
		if (contexto.proyecto.datosTecnicos && !contexto.tecnica) { const tecnica = resolverProyectoTecnico(contexto.proyecto);
			contexto = { ...contexto, proyecto: tecnica.proyecto, tecnica }; }
		const salida: ResultadoReglaIngenieria[] = [];
		for (const original of contexto.circuitos) for (const id of original.conductores) {
			const c = circuitoConCriterios(contexto, original);
			const f = contexto.fisica?.conductores.get(id);
			salida.push(caidaSegunCriterio(contexto, c, id, f), ...(contexto.proyecto.datosTecnicos?.instalaciones.some(i => i.conductorId === id)
				? resultadosAmpacidadTecnica(contexto, c, id, f) : [resultadoAmpacidad(c, id, f)]), ...resultadoPerdida(c, id, f));
		}
		return salida;
	},
};

export interface AlternativaSeccionConductor {
	seccionMm2: number;
	resistenciaOhm?: number;
	corrienteA?: number;
	caidaV?: number;
	caidaPct?: number;
	perdidaW?: number;
	iccA?: number;
	origenIcc: 'CALCULADO' | 'ESTIMADO' | 'NO_MODELADO';
	estado: 'PASS' | 'FAIL' | 'INDETERMINATE';
	motivos: string[];
}

export interface ResultadoAlternativasSeccion {
	conductorId: string;
	circuitId?: string;
	baseSeccionMm2?: number;
	alternativas: AlternativaSeccionConductor[];
	recomendadaMm2?: number;
	explicacion: string;
}

function evaluarCriteriosAlternativa(a: Omit<AlternativaSeccionConductor, 'estado' | 'motivos'>,
	criterios: CriteriosCircuitoIngenieria | undefined): Pick<AlternativaSeccionConductor, 'estado' | 'motivos'> {
	const motivos: string[] = []; let indeterminada = false; let falla = false;
	if (!criterios || !Object.keys(criterios).length) { motivos.push('No hay criterios configurados.'); return { estado: 'INDETERMINATE', motivos }; }
	if (criterios.maxVoltageDropPercent !== undefined) {
		if (a.caidaPct === undefined) { indeterminada = true; motivos.push('Caída porcentual no disponible.'); }
		else if (excede(a.caidaPct, criterios.maxVoltageDropPercent)) { falla = true; motivos.push('Supera la caída máxima configurada.'); }
	}
	if (criterios.maxLossW !== undefined) {
		if (a.perdidaW === undefined) { indeterminada = true; motivos.push('Pérdida no disponible.'); }
		else if (excede(a.perdidaW, criterios.maxLossW)) { falla = true; motivos.push('Supera la pérdida máxima configurada.'); }
	}
	if (criterios.maxLossPercent !== undefined) { indeterminada = true; motivos.push('Porcentaje de pérdidas pendiente de frontera energética de circuito.'); }
	if (criterios.ampacityProfile) {
		const p = criterios.ampacityProfile.puntos.find((p) => Math.abs(p.seccionMm2 - a.seccionMm2) <= tolerancia(p.seccionMm2, a.seccionMm2));
		if (!p || a.corrienteA === undefined) { indeterminada = true; motivos.push('Ampacidad no disponible para la alternativa.'); }
		else if (excede(a.corrienteA, p.corrienteMaxA)) { falla = true; motivos.push('Supera la ampacidad configurada.'); }
	}
	return { estado: falla ? 'FAIL' : indeterminada ? 'INDETERMINATE' : 'PASS', motivos };
}

/** Recalcula alternativas mediante PhysicsEngine sin escribir sobre el Proyecto. */
export function evaluarAlternativasSeccion(entrada: {
	proyecto: Proyecto;
	conductorId: string;
	seccionesMm2: readonly number[];
	circuitId?: string;
	contextoFisico?: Omit<ContextoTopologiaFisica, 'seccionesMm2'>;
}): ResultadoAlternativasSeccion {
	const tecnica = resolverProyectoTecnico(entrada.proyecto), proyecto = tecnica.proyecto;
	const original = proyecto.conductores.find((c) => c.id === entrada.conductorId);
	if (!original) throw new Error(`Conductor desconocido: ${entrada.conductorId}`);
	const circuitos = descubrirCircuitos(proyecto).circuitos.filter((c) => c.conductores.includes(original.id));
	if (proyecto.datosTecnicos) for (const c of circuitos) {
		const resueltos = resolverCriteriosTecnicos(proyecto.datosTecnicos, c.id, c.criterios); c.criterios = { ...c.criterios };
		for (const k of ['maxVoltageDropPercent', 'maxLossW', 'maxLossPercent'] as const) {
			const v = resueltos.parametros[k];
			if (v.estado === 'RESOLVED' && v.decision?.modo === 'VALOR' && typeof v.decision.valor === 'number') c.criterios[k] = v.decision.valor;
			else delete c.criterios[k];
		}
	}
	const circuito = entrada.circuitId ? circuitos.find((c) => c.id === entrada.circuitId)
		: proyecto.datosTecnicos && circuitos.length !== 1 ? undefined : circuitos[0];
	const secciones = [...new Set(entrada.seccionesMm2.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
	const alternativas = secciones.map((seccionMm2): AlternativaSeccionConductor => {
		const seccionesMm2 = new Map([[original.id, seccionMm2]]);
		const fisica = simularFisicaProyecto(proyecto, { ...entrada.contextoFisico, seccionesMm2 });
		const f = fisica.conductores.get(original.id);
		let iccA: number | undefined; let origenIcc: AlternativaSeccionConductor['origenIcc'] = 'NO_MODELADO';
		const fuente = circuito?.fuenteId ? fisica.medicion.fuentes.find((x) => dispositivoNodo(x.de) === circuito.fuenteId) : undefined;
		if (proyecto.datosTecnicos) {
			const proteccion = proteccionTramo({ proyecto, circuitos, fisica, tecnica }, original.id);
			const ensayo = proteccion ? analizarProspectivaProtecciones(proyecto, { ...entrada.contextoFisico, seccionesMm2 }).get(proteccion) : undefined;
			iccA = ensayo?.iccA; origenIcc = ensayo?.origen ?? 'NO_MODELADO';
		} else if (fuente) {
			const conFalla = simularFisicaProyecto(entrada.proyecto, { ...entrada.contextoFisico, seccionesMm2,
				fallas: [{ id: `scenario-icc:${original.id}:${seccionMm2}`, tipo: 'L_N',
					nodoA: `${original.a.dispositivoId}::${original.a.borneId}`, nodoB: fuente.a }] });
			const falla = conFalla.fallas[0]; if (falla?.iccA) iccA = magnitud(falla.iccA);
			origenIcc = falla?.origen === 'CALCULADO' ? 'CALCULADO' : falla?.origen === 'ESTIMADO' ? 'ESTIMADO' : 'NO_MODELADO';
		}
		const parcial = { seccionMm2, resistenciaOhm: f?.rOhm, corrienteA: f?.corrienteA, caidaV: f?.caidaV,
			caidaPct: f?.caidaPct, perdidaW: f?.perdidaW, iccA, origenIcc };
		if (proyecto.datosTecnicos?.instalaciones.some(i => i.conductorId === original.id)) {
			if (!circuito) return { ...parcial, estado: 'INDETERMINATE', motivos: ['Circuito ausente o ambiguo; elegir explícitamente el circuito de la alternativa.'] };
			const comprobaciones = [caidaSegunCriterio({ proyecto }, circuito, original.id, f), ...resultadoPerdida(circuito, original.id, f),
				...resultadosAmpacidadTecnica({ proyecto, circuitos, fisica, tecnica }, circuito, original.id, f)];
			const estado = comprobaciones.some(r => r.status === 'FAIL') ? 'FAIL'
				: comprobaciones.some(r => r.status === 'INDETERMINATE') ? 'INDETERMINATE' : 'PASS';
			return { ...parcial, estado, motivos: comprobaciones.filter(r => r.status !== 'PASS').map(r => `${r.title}: ${r.description} ${r.missingData.join(', ')}`) };
		}
		return { ...parcial, ...evaluarCriteriosAlternativa(parcial, circuito?.criterios) };
	});
	const recomendadaMm2 = alternativas.find((a) => a.estado === 'PASS')?.seccionMm2;
	return { conductorId: original.id, circuitId: circuito?.id, baseSeccionMm2: original.seccion,
		alternativas, recomendadaMm2,
		explicacion: recomendadaMm2 === undefined
			? 'Ninguna alternativa puede declararse conforme con todos los criterios modelados y configurados.'
			: `${recomendadaMm2} mm² es la menor alternativa evaluada que satisface los criterios modelados y configurados.`,
	};
}

const dispositivoNodo = (nodo: string): string => nodo.split('::')[0];
