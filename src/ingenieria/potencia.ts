/** Agregación de potencia V7 sobre los resultados de PhysicsEngine V5/V6. */
import { magnitud, sumar, type Complejo } from '../fisica/complejos.js';
import { simularFisicaProyecto, type ContextoTopologiaFisica, type ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import type { Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import { descubrirCircuitos, type CircuitoIngenieria } from './circuitos.js';
import type { EngineeringRule, ResultadoReglaIngenieria } from './validacion.js';

export type FronteraPotenciaCircuito = 'TABLERO' | 'VFD_DOWNSTREAM' | 'TRANSFORMER_SECONDARY';

export interface PotenciaComplejaIngenieria {
	pW: number;
	qVar: number;
	sVA: number;
	factorPotencia?: number;
	origen: OrigenDatoFisico | 'NO_DISPONIBLE';
}

export interface PotenciaCircuitoIngenieria extends PotenciaComplejaIngenieria {
	circuitoId: string;
	frontera: FronteraPotenciaCircuito;
	incluidaEnTotalTablero: boolean;
}

export interface PerdidasIngenieria {
	conductoresW: number;
	transformadoresW: number;
	variadoresW: number;
	otrasModeladasW: number;
	totalModeladoW: number;
	origen: OrigenDatoFisico | 'NO_DISPONIBLE';
}

export interface FasePotenciaIngenieria extends PotenciaComplejaIngenieria {
	fase: 'L1' | 'L2' | 'L3';
	corrienteA: number;
}

export interface BalanceFasesIngenieria {
	fuenteId: string;
	fases: [FasePotenciaIngenieria, FasePotenciaIngenieria, FasePotenciaIngenieria];
	corrienteNeutroA: number;
	desequilibrioCorrientePct: number;
	desequilibrioTensionPct: number;
	metrica: 'MAX_DESVIACION_MEDIA';
	criterioMaxPct?: number;
	superaCriterio?: boolean;
	origen: 'CALCULADO';
}

export interface ResumenPotenciaIngenieria {
	totalTablero: PotenciaComplejaIngenieria;
	porCircuito: PotenciaCircuitoIngenieria[];
	porTipoCarga: (PotenciaComplejaIngenieria & {
		tipo: TipoDispositivo;
		frontera: FronteraPotenciaCircuito;
		incluidaEnTotalTablero: boolean;
	})[];
	perdidas: PerdidasIngenieria;
	balances: BalanceFasesIngenieria[];
	/** Explicita la frontera usada; las fuentes internas se muestran por circuito, no se suman otra vez. */
	fronteraTotal: 'FUENTES_EXTERNAS_CONFIGURADAS';
}

const CERO: Complejo = { re: 0, im: 0 };
const potencia = (s: Complejo, origen: PotenciaComplejaIngenieria['origen']): PotenciaComplejaIngenieria => {
	const aparente = magnitud(s);
	return { pW: s.re, qVar: s.im, sVA: aparente,
		factorPotencia: aparente > 1e-9 ? s.re / aparente : undefined, origen };
};
const suma = (valores: readonly Complejo[]): Complejo => valores.reduce(sumar, CERO);

function fuentesExternas(proyecto: Proyecto, fisica: ResultadoFisicaElectrica): Complejo[] {
	const valores: Complejo[] = [];
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		for (let i = 0; i < (d.fisica?.fuente?.fases.length ?? 0); i++) {
			const resultado = fisica.red.fuentes.get(`fuente:${d.id}:${i}`);
			if (resultado) valores.push(resultado.potenciaEntregadaVA);
		}
	}
	return valores;
}

function fronteraCircuito(proyecto: Proyecto, circuito: CircuitoIngenieria): FronteraPotenciaCircuito {
	const fuente = proyecto.dispositivos.find((d) => d.id === circuito.fuenteId);
	if (fuente?.fisica?.vfd) return 'VFD_DOWNSTREAM';
	if (fuente?.fisica?.transformador) return 'TRANSFORMER_SECONDARY';
	return 'TABLERO';
}

function potenciaCircuito(
	proyecto: Proyecto,
	circuito: CircuitoIngenieria,
	fisica: ResultadoFisicaElectrica,
): PotenciaCircuitoIngenieria {
	const frontera = fronteraCircuito(proyecto, circuito);
	const cargaId = circuito.cargas[0];
	const carga = proyecto.dispositivos.find((d) => d.id === cargaId);
	let origen: PotenciaComplejaIngenieria['origen'] = 'CALCULADO';
	let valor: Complejo = CERO;
	if (carga?.fisica?.vfd) {
		const vfd = fisica.variadores.get(carga.id);
		valor = { re: vfd?.potenciaEntradaW ?? 0, im: 0 };
		origen = vfd?.origen ?? 'NO_DISPONIBLE';
	} else if (carga?.fisica?.transformador) {
		const t = fisica.red.transformadores.get(`transformador:${carga.id}`);
		valor = t?.potenciaEntradaVA ?? CERO; origen = t?.origen ?? 'NO_DISPONIBLE';
	} else {
		const resultados = [...fisica.red.cargas.values()].filter((x) => x.dispositivoId === cargaId);
		valor = suma(resultados.map((x) => x.potenciaVA));
		origen = resultados.length ? resultados.some((x) => x.origen === 'ESTIMADO') ? 'ESTIMADO' : 'CALCULADO' : 'NO_DISPONIBLE';
	}
	return { circuitoId: circuito.id, frontera, incluidaEnTotalTablero: frontera === 'TABLERO',
		...potencia(valor, origen) };
}

function balancesDe(proyecto: Proyecto, fisica: ResultadoFisicaElectrica): BalanceFasesIngenieria[] {
	const balances: BalanceFasesIngenieria[] = [];
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const config = d.fisica?.fuente; const analisis = fisica.trifasicos.get(d.id);
		if (config?.sistema !== 'AC_TRIFASICA' || !analisis) continue;
		const orden = { L1: 0, L2: 1, L3: 2 } as const;
		const indices = config.fases.map((f, indice) => ({ f, indice }))
			.filter((x): x is { f: typeof x.f & { fase: keyof typeof orden }; indice: number } => x.f.fase in orden)
			.sort((a, b) => orden[a.f.fase] - orden[b.f.fase]);
		if (indices.length !== 3) continue;
		const fases = indices.map(({ f, indice }, i): FasePotenciaIngenieria => ({
			fase: f.fase, corrienteA: magnitud(analisis.corrientesFaseA[i]),
			...potencia(fisica.red.fuentes.get(`fuente:${d.id}:${indice}`)?.potenciaEntregadaVA ?? CERO, 'CALCULADO'),
		})) as BalanceFasesIngenieria['fases'];
		const criterioMaxPct = proyecto.ingenieria?.criterios?.maxUnbalancePercent ?? config.umbralDesequilibrioPct;
		const peor = Math.max(analisis.desequilibrioCorrientePct, analisis.desequilibrioTensionPct);
		balances.push({ fuenteId: d.id, fases, corrienteNeutroA: magnitud(analisis.corrienteNeutroA),
			desequilibrioCorrientePct: analisis.desequilibrioCorrientePct,
			desequilibrioTensionPct: analisis.desequilibrioTensionPct, metrica: analisis.metrica,
			criterioMaxPct, superaCriterio: criterioMaxPct === undefined ? undefined : peor > criterioMaxPct,
			origen: 'CALCULADO' });
	}
	return balances;
}

/**
 * Suma el tablero una sola vez en su frontera de alimentación externa. VFD y transformadores
 * siguen visibles aguas abajo, pero sus salidas no se vuelven a añadir al total.
 */
export function resumirPotenciaIngenieria(entrada: {
	proyecto: Proyecto;
	fisica: ResultadoFisicaElectrica;
	circuitos?: readonly CircuitoIngenieria[];
}): ResumenPotenciaIngenieria {
	const circuitos = entrada.circuitos ?? descubrirCircuitos(entrada.proyecto).circuitos;
	const conductor = [...entrada.fisica.conductores.values()].reduce((s, x) => s + x.perdidaW, 0);
	const transformador = [...entrada.fisica.red.transformadores.values()].reduce((s, x) => s + x.perdidaCobreW, 0);
	const variador = [...entrada.fisica.variadores.values()].reduce((s, x) => s + x.perdidasW, 0);
	const otras = Math.max(0, entrada.fisica.red.potenciaPerdidasW - conductor - transformador);
	const totalPerdidas = conductor + transformador + variador + otras;
	const porCircuito = [...circuitos].sort((a, b) => a.id.localeCompare(b.id))
		.map((c) => potenciaCircuito(entrada.proyecto, c, entrada.fisica));
	const circuitosPorId = new Map(circuitos.map((c) => [c.id, c]));
	const grupos = new Map<string, { tipo: TipoDispositivo; frontera: FronteraPotenciaCircuito;
		incluidaEnTotalTablero: boolean; s: Complejo; origen: PotenciaComplejaIngenieria['origen'] }>();
	for (const c of porCircuito) {
		const cargaId = circuitosPorId.get(c.circuitoId)?.cargas[0];
		const tipo = entrada.proyecto.dispositivos.find((d) => d.id === cargaId)?.tipo ?? 'otro';
		const clave = `${tipo}\u0000${c.frontera}`; const anterior = grupos.get(clave);
		const s = { re: c.pW, im: c.qVar };
		if (anterior) { anterior.s = sumar(anterior.s, s); if (c.origen !== anterior.origen) anterior.origen = 'ESTIMADO'; }
		else grupos.set(clave, { tipo, frontera: c.frontera, incluidaEnTotalTablero: c.incluidaEnTotalTablero,
			s, origen: c.origen });
	}
	const externas = fuentesExternas(entrada.proyecto, entrada.fisica);
	return {
		totalTablero: potencia(suma(externas), externas.length ? 'CALCULADO' : 'NO_DISPONIBLE'),
		porCircuito,
		porTipoCarga: [...grupos.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.frontera.localeCompare(b.frontera))
			.map((g) => ({ tipo: g.tipo, frontera: g.frontera, incluidaEnTotalTablero: g.incluidaEnTotalTablero,
				...potencia(g.s, g.origen) })),
		perdidas: { conductoresW: conductor, transformadoresW: transformador, variadoresW: variador,
			otrasModeladasW: otras, totalModeladoW: totalPerdidas,
			origen: entrada.fisica.activo ? 'CALCULADO' : 'NO_DISPONIBLE' },
		balances: balancesDe(entrada.proyecto, entrada.fisica), fronteraTotal: 'FUENTES_EXTERNAS_CONFIGURADAS',
	};
}

export interface ComparacionReasignacionFase {
	circuitoId: string;
	conductorId: string;
	faseOriginal: 'L1' | 'L2' | 'L3';
	faseAlternativa: 'L1' | 'L2' | 'L3';
	base: BalanceFasesIngenieria;
	alternativa: BalanceFasesIngenieria;
	deltaDesequilibrioCorrientePct: number;
	deltaCorrienteNeutroA: number;
	proyectoModificado: false;
	origen: 'INYECTADO';
}

/** Ensayo temporal y acotado de un ramal explícitamente marcado; nunca modifica el Proyecto. */
export function compararReasignacionFase(entrada: {
	proyecto: Proyecto;
	circuitoId: string;
	conductorId: string;
	nuevaFase: 'L1' | 'L2' | 'L3';
	contextoFisico?: ContextoTopologiaFisica;
}): ComparacionReasignacionFase {
	const circuitos = descubrirCircuitos(entrada.proyecto).circuitos;
	const circuito = circuitos.find((c) => c.id === entrada.circuitoId);
	if (!circuito) throw new Error(`CIRCUITO_NO_ENCONTRADO:${entrada.circuitoId}`);
	if (!circuito.metadatos?.conductoresReasignablesFase?.includes(entrada.conductorId)) {
		throw new Error(`CONDUCTOR_NO_REASIGNABLE:${entrada.conductorId}`);
	}
	const fuenteId = circuito.fuenteId;
	const fuente = entrada.proyecto.dispositivos.find((d) => d.id === fuenteId);
	const config = fuente?.fisica?.fuente;
	if (!fuente || config?.sistema !== 'AC_TRIFASICA') throw new Error(`FUENTE_NO_TRIFASICA:${fuenteId ?? ''}`);
	const conductor = entrada.proyecto.conductores.find((c) => c.id === entrada.conductorId);
	if (!conductor) throw new Error(`CONDUCTOR_NO_ENCONTRADO:${entrada.conductorId}`);
	const extremo = conductor.de.dispositivoId === fuente.id ? 'de'
		: conductor.a.dispositivoId === fuente.id ? 'a' : undefined;
	if (!extremo) throw new Error(`CONDUCTOR_NO_CONECTADO_A_FUENTE:${entrada.conductorId}`);
	const borneOriginal = conductor[extremo].borneId;
	const faseOriginal = config.fases.find((f) => f.borne === borneOriginal)?.fase;
	if (!faseOriginal || !['L1', 'L2', 'L3'].includes(faseOriginal)) throw new Error(`FASE_ORIGINAL_NO_IDENTIFICADA:${borneOriginal}`);
	const borneAlternativo = config.fases.find((f) => f.fase === entrada.nuevaFase)?.borne;
	if (!borneAlternativo) throw new Error(`FASE_ALTERNATIVA_NO_DISPONIBLE:${entrada.nuevaFase}`);
	const clon = structuredClone(entrada.proyecto);
	const conductorClon = clon.conductores.find((c) => c.id === entrada.conductorId)!;
	conductorClon[extremo].borneId = borneAlternativo;
	const baseFisica = simularFisicaProyecto(entrada.proyecto, entrada.contextoFisico);
	const alternativaFisica = simularFisicaProyecto(clon, entrada.contextoFisico);
	const base = balancesDe(entrada.proyecto, baseFisica).find((x) => x.fuenteId === fuente.id);
	const alternativa = balancesDe(clon, alternativaFisica).find((x) => x.fuenteId === fuente.id);
	if (!base || !alternativa) throw new Error(`BALANCE_NO_DISPONIBLE:${fuente.id}`);
	return { circuitoId: circuito.id, conductorId: conductor.id,
		faseOriginal: faseOriginal as 'L1' | 'L2' | 'L3', faseAlternativa: entrada.nuevaFase, base, alternativa,
		deltaDesequilibrioCorrientePct: alternativa.desequilibrioCorrientePct - base.desequilibrioCorrientePct,
		deltaCorrienteNeutroA: alternativa.corrienteNeutroA - base.corrienteNeutroA,
		proyectoModificado: false, origen: 'INYECTADO' };
}

function resultadoBalance(balance: BalanceFasesIngenieria): ResultadoReglaIngenieria {
	const tieneCriterio = balance.criterioMaxPct !== undefined;
	return {
		code: 'TS-PHASE-UNBALANCE', category: 'PHASE', severity: balance.superaCriterio ? 'WARNING' : 'INFO',
		status: !tieneCriterio ? 'INDETERMINATE' : balance.superaCriterio ? 'WARNING' : 'PASS',
		title: 'Balance de fases', description: tieneCriterio
			? 'La métrica fasorial calculada se compara con el criterio configurado.'
			: 'La métrica fasorial está calculada, pero no existe un criterio de aceptación configurado.',
		evidence: [
			{ codigo: 'UNBALANCE_I', descripcion: 'Máxima desviación de corriente respecto de la media', valor: balance.desequilibrioCorrientePct, unidad: '%', origen: 'CALCULADO' },
			{ codigo: 'NEUTRAL_I', descripcion: 'Corriente de neutro obtenida por suma fasorial', valor: balance.corrienteNeutroA, unidad: 'A', origen: 'CALCULADO' },
		], relatedEntities: [{ tipo: 'DEVICE', id: balance.fuenteId }], provenance: 'CALCULADO',
		criterion: tieneCriterio ? { descripcion: 'Desequilibrio máximo configurado', valor: balance.criterioMaxPct, unidad: '%', origen: 'CONFIGURADO' } : undefined,
		missingData: tieneCriterio ? [] : ['criterio máximo de desequilibrio'],
		remediationHints: balance.superaCriterio ? ['Comparar una reasignación temporal de cargas monofásicas marcadas como reasignables.'] : [],
	};
}

export const REGLA_POTENCIA_Y_BALANCE: EngineeringRule = {
	code: 'TS-POWER-SUMMARY', category: 'POWER', scope: 'PROJECT',
	evaluate(contexto) {
		if (!contexto.fisica?.activo) return [{
			code: 'TS-POWER-NOT-AVAILABLE', category: 'POWER', severity: 'INFO', status: 'INDETERMINATE',
			title: 'Potencia no disponible', description: 'PhysicsEngine no produjo un estado físico activo.',
			evidence: [], relatedEntities: [{ tipo: 'PROJECT', id: contexto.proyecto.nombre }], provenance: 'NO_DISPONIBLE',
			missingData: ['resultado físico energizado'], remediationHints: ['Ejecutar la simulación física con la topología operativa.'],
		}];
		const resumen = resumirPotenciaIngenieria({ proyecto: contexto.proyecto, fisica: contexto.fisica, circuitos: contexto.circuitos });
		const total: ResultadoReglaIngenieria = {
			code: 'TS-POWER-EXTERNAL-BOUNDARY', category: 'POWER', severity: 'INFO', status: 'PASS',
			title: 'Balance de potencia del tablero', description: 'El total se obtiene en fuentes externas; no suma nuevamente salidas VFD ni secundarios de transformador.',
			evidence: [
				{ codigo: 'P_TOTAL', descripcion: 'Potencia activa en frontera externa', valor: resumen.totalTablero.pW, unidad: 'W', origen: resumen.totalTablero.origen },
				{ codigo: 'Q_TOTAL', descripcion: 'Potencia reactiva en frontera externa', valor: resumen.totalTablero.qVar, unidad: 'var', origen: resumen.totalTablero.origen },
				{ codigo: 'LOSSES', descripcion: 'Pérdidas modeladas separadas', valor: resumen.perdidas.totalModeladoW, unidad: 'W', origen: resumen.perdidas.origen },
			], relatedEntities: [{ tipo: 'PROJECT', id: contexto.proyecto.nombre }], provenance: resumen.totalTablero.origen,
			criterion: { descripcion: 'Frontera de fuentes externas configuradas', origen: 'MODELO_V7' }, missingData: [], remediationHints: [],
		};
		return [total, ...resumen.balances.map(resultadoBalance)];
	},
};
