/** ScenarioEngine V7: BASE + overlay tipado = resultado temporal reproducible. */
import { magnitud } from '../fisica/complejos.js';
import type { ContextoTopologiaFisica } from '../fisica/topologia-proyecto.js';
import type { ConfiguracionCargaFisica, ConfiguracionMotorFisico } from '../modelo/fisica.js';
import type { CriteriosCircuitoIngenieria } from '../modelo/ingenieria.js';
import type { Proyecto } from '../modelo/tipos.js';
import { ejecutarIngenieria, REGLAS_INGENIERIA_V7 } from './engine.js';
import type { EngineeringIssue, EngineeringRule } from './validacion.js';

export type ParcheEscenarioIngenieria =
	| { tipo: 'SECCION_CONDUCTOR'; conductorId: string; seccionMm2: number }
	| { tipo: 'CRITERIO_CAIDA'; circuitoId?: string; maxVoltageDropPercent: number }
	| { tipo: 'PROTECCION'; dispositivoId: string; inA?: number; curva?: string;
		capacidadCorte?: { icnKA?: number; icuKA?: number; icsKA?: number } }
	| { tipo: 'ASIGNACION_FASE'; conductorId: string; fuenteId: string; fase: 'L1' | 'L2' | 'L3' }
	| { tipo: 'CARGA'; dispositivoId: string; cambios: Partial<Pick<ConfiguracionCargaFisica,
		'rOhm' | 'xOhm' | 'corrienteA' | 'factorPotencia' | 'pW' | 'qVar'>> }
	| { tipo: 'MOTOR'; dispositivoId: string; cambios: Partial<Pick<ConfiguracionMotorFisico,
		'potenciaMecanicaNominalW' | 'tensionNominalV' | 'frecuenciaHz' | 'corrienteNominalA' | 'factorServicio'>> };

export interface DefinicionEscenarioIngenieria {
	id: string;
	nombre: string;
	parches: readonly ParcheEscenarioIngenieria[];
}

export interface IndicadoresEscenarioIngenieria {
	conductores: Record<string, { corrienteA: number; caidaV: number; caidaPct?: number; perdidaW: number }>;
	protecciones: Record<string, { corrienteA: number; inA?: number; region: string }>;
	potenciaPerdidasW: number;
	iccMaxA?: number;
	desequilibrioMaxPct?: number;
	corrienteNeutroMaxA?: number;
	selectividad: string[];
	issues: { fail: number; warning: number; indeterminate: number };
}

export interface DeltaEscenarioIngenieria {
	conductores: Record<string, { corrienteA: number; caidaV: number; caidaPct?: number; perdidaW: number }>;
	protecciones: Record<string, { corrienteA: number; inA?: number; regionAntes: string; regionDespues: string }>;
	potenciaPerdidasW: number;
	iccMaxA?: number;
	desequilibrioMaxPct?: number;
	corrienteNeutroMaxA?: number;
	selectividadNueva: string[];
	selectividadResuelta: string[];
	issuesNuevos: string[];
	issuesResueltos: string[];
}

export interface ResultadoAlternativaEscenario {
	escenario: DefinicionEscenarioIngenieria;
	serializacion: string;
	proyecto: Proyecto;
	analisis: ReturnType<typeof ejecutarIngenieria>;
	indicadores: IndicadoresEscenarioIngenieria;
	delta: DeltaEscenarioIngenieria;
}

export interface ResultadoEscenariosIngenieria {
	base: { analisis: ReturnType<typeof ejecutarIngenieria>; indicadores: IndicadoresEscenarioIngenieria };
	alternativas: ResultadoAlternativaEscenario[];
}

const finitoPositivo = (v: number, etiqueta: string) => {
	if (!Number.isFinite(v) || v <= 0) throw new Error(`VALOR_ESCENARIO_INVALIDO:${etiqueta}`); return v;
};
const finitoNoNegativo = (v: number, etiqueta: string) => {
	if (!Number.isFinite(v) || v < 0) throw new Error(`VALOR_ESCENARIO_INVALIDO:${etiqueta}`); return v;
};

function claveParche(p: ParcheEscenarioIngenieria): string {
	switch (p.tipo) {
		case 'SECCION_CONDUCTOR': return `${p.tipo}:${p.conductorId}`;
		case 'CRITERIO_CAIDA': return `${p.tipo}:${p.circuitoId ?? '@proyecto'}`;
		case 'PROTECCION': return `${p.tipo}:${p.dispositivoId}`;
		case 'ASIGNACION_FASE': return `${p.tipo}:${p.conductorId}`;
		case 'CARGA': return `${p.tipo}:${p.dispositivoId}`;
		case 'MOTOR': return `${p.tipo}:${p.dispositivoId}`;
	}
}

function parchesOrdenados(parches: readonly ParcheEscenarioIngenieria[]): ParcheEscenarioIngenieria[] {
	const salida = [...parches].sort((a, b) => claveParche(a).localeCompare(claveParche(b)));
	for (let i = 1; i < salida.length; i++) if (claveParche(salida[i - 1]) === claveParche(salida[i])) {
		throw new Error(`PARCHES_ESCENARIO_CONFLICTIVOS:${claveParche(salida[i])}`);
	}
	return salida;
}

function objetoEstable(valor: unknown): unknown {
	if (Array.isArray(valor)) return valor.map(objetoEstable);
	if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor as Record<string, unknown>)
		.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, objetoEstable(v)]));
	return valor;
}

export function serializarEscenario(escenario: DefinicionEscenarioIngenieria): string {
	return JSON.stringify(objetoEstable({ id: escenario.id, nombre: escenario.nombre,
		parches: parchesOrdenados(escenario.parches) }));
}

function metadatosCircuito(proyecto: Proyecto, circuitoId: string) {
	proyecto.ingenieria ??= { version: 1 };
	proyecto.ingenieria.circuitos ??= {};
	return proyecto.ingenieria.circuitos[circuitoId] ??= { version: 1 };
}

/** Aplica el overlay solamente a un clon. Los resultados físicos/validaciones nunca se persisten. */
export function proyectarEscenario(base: Proyecto, parches: readonly ParcheEscenarioIngenieria[]): Proyecto {
	const proyecto = structuredClone(base);
	for (const p of parchesOrdenados(parches)) switch (p.tipo) {
		case 'SECCION_CONDUCTOR': {
			const c = proyecto.conductores.find((x) => x.id === p.conductorId);
			if (!c) throw new Error(`CONDUCTOR_NO_ENCONTRADO:${p.conductorId}`);
			c.seccion = finitoPositivo(p.seccionMm2, 'seccionMm2'); break;
		}
		case 'CRITERIO_CAIDA': {
			const max = finitoNoNegativo(p.maxVoltageDropPercent, 'maxVoltageDropPercent');
			if (p.circuitoId) {
				const m = metadatosCircuito(proyecto, p.circuitoId); m.criterios = { ...m.criterios, maxVoltageDropPercent: max };
			} else {
				proyecto.ingenieria ??= { version: 1 };
				proyecto.ingenieria.criterios = { ...proyecto.ingenieria.criterios, maxVoltageDropPercent: max };
			}
			break;
		}
		case 'PROTECCION': {
			const d = proyecto.dispositivos.find((x) => x.id === p.dispositivoId);
			if (!d) throw new Error(`DISPOSITIVO_NO_ENCONTRADO:${p.dispositivoId}`);
			d.fisica ??= { version: 1 }; d.fisica.proteccion ??= {};
			if (p.inA !== undefined) d.fisica.proteccion.inA = finitoPositivo(p.inA, 'inA');
			if (p.curva !== undefined) d.fisica.proteccion.curva = p.curva.trim();
			if (p.capacidadCorte !== undefined) d.fisica.proteccion.capacidadCorte = structuredClone(p.capacidadCorte);
			break;
		}
		case 'ASIGNACION_FASE': {
			const d = proyecto.dispositivos.find((x) => x.id === p.fuenteId); const f = d?.fisica?.fuente;
			if (!d || f?.sistema !== 'AC_TRIFASICA') throw new Error(`FUENTE_NO_TRIFASICA:${p.fuenteId}`);
			const borne = f.fases.find((x) => x.fase === p.fase)?.borne;
			if (!borne) throw new Error(`FASE_NO_DISPONIBLE:${p.fase}`);
			const c = proyecto.conductores.find((x) => x.id === p.conductorId);
			if (!c) throw new Error(`CONDUCTOR_NO_ENCONTRADO:${p.conductorId}`);
			const extremo = c.de.dispositivoId === d.id ? c.de : c.a.dispositivoId === d.id ? c.a : undefined;
			if (!extremo) throw new Error(`CONDUCTOR_NO_CONECTADO_A_FUENTE:${p.conductorId}`);
			extremo.borneId = borne; break;
		}
		case 'CARGA': {
			const d = proyecto.dispositivos.find((x) => x.id === p.dispositivoId);
			if (!d?.fisica?.carga) throw new Error(`CARGA_FISICA_NO_ENCONTRADA:${p.dispositivoId}`);
			for (const [k, v] of Object.entries(p.cambios)) if (v !== undefined) {
				if (!Number.isFinite(v)) throw new Error(`VALOR_ESCENARIO_INVALIDO:${k}`);
				(d.fisica.carga as unknown as Record<string, number>)[k] = v;
			}
			break;
		}
		case 'MOTOR': {
			const d = proyecto.dispositivos.find((x) => x.id === p.dispositivoId);
			if (!d?.fisica?.motor) throw new Error(`MOTOR_FISICO_NO_ENCONTRADO:${p.dispositivoId}`);
			for (const [k, v] of Object.entries(p.cambios)) if (v !== undefined) {
				finitoPositivo(v, k); (d.fisica.motor as unknown as Record<string, number>)[k] = v;
			}
			break;
		}
	}
	return proyecto;
}

function indicadores(analisis: ReturnType<typeof ejecutarIngenieria>): IndicadoresEscenarioIngenieria {
	const conductores = Object.fromEntries([...analisis.fisica.conductores].sort(([a], [b]) => a.localeCompare(b))
		.map(([id, x]) => [id, { corrienteA: x.corrienteA, caidaV: x.caidaV, caidaPct: x.caidaPct, perdidaW: x.perdidaW }]));
	const iccs = analisis.fisica.fallas.flatMap((f) => f.iccA ? [magnitud(f.iccA)] : []);
	const balances = analisis.potencia.balances;
	const protecciones = Object.fromEntries([...analisis.fisica.protecciones].sort(([a], [b]) => a.localeCompare(b))
		.map(([id, x]) => [id, { corrienteA: x.corrienteA, inA: x.inA, region: x.evaluacion.region }]));
	return { conductores, protecciones, potenciaPerdidasW: analisis.potencia.perdidas.totalModeladoW,
		iccMaxA: iccs.length ? Math.max(...iccs) : undefined,
		desequilibrioMaxPct: balances.length ? Math.max(...balances.map((b) => Math.max(b.desequilibrioCorrientePct, b.desequilibrioTensionPct))) : undefined,
		corrienteNeutroMaxA: balances.length ? Math.max(...balances.map((b) => b.corrienteNeutroA)) : undefined,
		selectividad: analisis.fisica.selectividad.map((x) => `${x.aguasArribaId}>${x.aguasAbajoId}:${x.clasificacion}`).sort(),
		issues: { fail: analisis.validacion.resumen.fail, warning: analisis.validacion.resumen.warning,
			indeterminate: analisis.validacion.resumen.indeterminate } };
}

const deltaOpcional = (a: number | undefined, b: number | undefined) => a === undefined || b === undefined ? undefined : b - a;
const idsIssues = (issues: readonly EngineeringIssue[]) => new Set(issues.map((x) => x.id));

function delta(base: IndicadoresEscenarioIngenieria, alternativa: IndicadoresEscenarioIngenieria,
	issuesBase: readonly EngineeringIssue[], issuesAlternativa: readonly EngineeringIssue[]): DeltaEscenarioIngenieria {
	const conductores: DeltaEscenarioIngenieria['conductores'] = {};
	for (const id of [...new Set([...Object.keys(base.conductores), ...Object.keys(alternativa.conductores)])].sort()) {
		const a = base.conductores[id]; const b = alternativa.conductores[id]; if (!a || !b) continue;
		conductores[id] = { corrienteA: b.corrienteA - a.corrienteA, caidaV: b.caidaV - a.caidaV,
			caidaPct: deltaOpcional(a.caidaPct, b.caidaPct), perdidaW: b.perdidaW - a.perdidaW };
	}
	const protecciones: DeltaEscenarioIngenieria['protecciones'] = {};
	for (const id of [...new Set([...Object.keys(base.protecciones), ...Object.keys(alternativa.protecciones)])].sort()) {
		const a = base.protecciones[id]; const b = alternativa.protecciones[id]; if (!a || !b) continue;
		protecciones[id] = { corrienteA: b.corrienteA - a.corrienteA, inA: deltaOpcional(a.inA, b.inA),
			regionAntes: a.region, regionDespues: b.region };
	}
	const ib = idsIssues(issuesBase); const ia = idsIssues(issuesAlternativa);
	const sb = new Set(base.selectividad); const sa = new Set(alternativa.selectividad);
	return { conductores, protecciones, potenciaPerdidasW: alternativa.potenciaPerdidasW - base.potenciaPerdidasW,
		iccMaxA: deltaOpcional(base.iccMaxA, alternativa.iccMaxA),
		desequilibrioMaxPct: deltaOpcional(base.desequilibrioMaxPct, alternativa.desequilibrioMaxPct),
		corrienteNeutroMaxA: deltaOpcional(base.corrienteNeutroMaxA, alternativa.corrienteNeutroMaxA),
		selectividadNueva: [...sa].filter((x) => !sb.has(x)).sort(), selectividadResuelta: [...sb].filter((x) => !sa.has(x)).sort(),
		issuesNuevos: [...ia].filter((x) => !ib.has(x)).sort(), issuesResueltos: [...ib].filter((x) => !ia.has(x)).sort() };
}

export function evaluarEscenarios(entrada: {
	proyecto: Proyecto;
	alternativas: readonly DefinicionEscenarioIngenieria[];
	contextoFisico?: ContextoTopologiaFisica;
	reglas?: readonly EngineeringRule[];
}): ResultadoEscenariosIngenieria {
	const reglas = entrada.reglas ?? REGLAS_INGENIERIA_V7;
	const analisisBase = ejecutarIngenieria({ proyecto: entrada.proyecto, contextoFisico: entrada.contextoFisico, reglas });
	const indicadoresBase = indicadores(analisisBase);
	const ids = new Set<string>();
	const alternativas = [...entrada.alternativas].sort((a, b) => a.id.localeCompare(b.id)).map((escenario): ResultadoAlternativaEscenario => {
		if (!escenario.id.trim() || ids.has(escenario.id)) throw new Error(`ESCENARIO_ID_INVALIDO:${escenario.id}`); ids.add(escenario.id);
		const proyecto = proyectarEscenario(entrada.proyecto, escenario.parches);
		const analisis = ejecutarIngenieria({ proyecto, contextoFisico: entrada.contextoFisico, reglas });
		const indic = indicadores(analisis);
		return { escenario: { ...escenario, parches: parchesOrdenados(escenario.parches) }, serializacion: serializarEscenario(escenario),
			proyecto, analisis, indicadores: indic,
			delta: delta(indicadoresBase, indic, analisisBase.validacion.issues, analisis.validacion.issues) };
	});
	return { base: { analisis: analisisBase, indicadores: indicadoresBase }, alternativas };
}

/**
 * La base nunca se modifica. El candidato solo se entrega si `persistir` finaliza; un rechazo deja
 * al llamador con el mismo Proyecto y permite que su repositorio transaccional haga rollback.
 */
export async function aplicarEscenarioTransaccional(entrada: {
	proyecto: Proyecto;
	escenario: DefinicionEscenarioIngenieria;
	persistir: (candidato: Proyecto) => Promise<void> | void;
}): Promise<Proyecto> {
	const candidato = proyectarEscenario(entrada.proyecto, entrada.escenario.parches);
	await entrada.persistir(candidato);
	return candidato;
}
