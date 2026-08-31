import { magnitud } from '../fisica/complejos.js';
import {
	simularFisicaProyecto, type ContextoTopologiaFisica, type ResultadoConductorProyectoFisica,
} from '../fisica/topologia-proyecto.js';
import type { CriteriosCircuitoIngenieria } from '../modelo/ingenieria.js';
import type { Proyecto } from '../modelo/tipos.js';
import { descubrirCircuitos, type CircuitoIngenieria } from './circuitos.js';
import type {
	EngineeringRule, EstadoValidacionIngenieria, ResultadoReglaIngenieria,
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

export const REGLA_CONDUCTORES: EngineeringRule = {
	code: 'TS-CABLE-DESIGN', category: 'CABLE', scope: 'CIRCUIT',
	evaluate(contexto) {
		const salida: ResultadoReglaIngenieria[] = [];
		for (const c of contexto.circuitos) for (const id of c.conductores) {
			const f = contexto.fisica?.conductores.get(id);
			salida.push(resultadoCaida(c, id, f), resultadoAmpacidad(c, id, f), ...resultadoPerdida(c, id, f));
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
	const original = entrada.proyecto.conductores.find((c) => c.id === entrada.conductorId);
	if (!original) throw new Error(`Conductor desconocido: ${entrada.conductorId}`);
	const circuitos = descubrirCircuitos(entrada.proyecto).circuitos.filter((c) => c.conductores.includes(original.id));
	const circuito = entrada.circuitId ? circuitos.find((c) => c.id === entrada.circuitId) : circuitos[0];
	const secciones = [...new Set(entrada.seccionesMm2.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
	const alternativas = secciones.map((seccionMm2): AlternativaSeccionConductor => {
		const seccionesMm2 = new Map([[original.id, seccionMm2]]);
		const fisica = simularFisicaProyecto(entrada.proyecto, { ...entrada.contextoFisico, seccionesMm2 });
		const f = fisica.conductores.get(original.id);
		let iccA: number | undefined; let origenIcc: AlternativaSeccionConductor['origenIcc'] = 'NO_MODELADO';
		const fuente = circuito?.fuenteId ? fisica.medicion.fuentes.find((x) => dispositivoNodo(x.de) === circuito.fuenteId) : undefined;
		if (fuente) {
			const conFalla = simularFisicaProyecto(entrada.proyecto, { ...entrada.contextoFisico, seccionesMm2,
				fallas: [{ id: `scenario-icc:${original.id}:${seccionMm2}`, tipo: 'L_N',
					nodoA: `${original.a.dispositivoId}::${original.a.borneId}`, nodoB: fuente.a }] });
			const falla = conFalla.fallas[0]; if (falla?.iccA) iccA = magnitud(falla.iccA);
			origenIcc = falla?.origen === 'CALCULADO' ? 'CALCULADO' : falla?.origen === 'ESTIMADO' ? 'ESTIMADO' : 'NO_MODELADO';
		}
		const parcial = { seccionMm2, resistenciaOhm: f?.rOhm, corrienteA: f?.corrienteA, caidaV: f?.caidaV,
			caidaPct: f?.caidaPct, perdidaW: f?.perdidaW, iccA, origenIcc };
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
