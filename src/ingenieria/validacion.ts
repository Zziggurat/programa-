import type { ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import type { Proyecto } from '../modelo/tipos.js';
import { descubrirCircuitos, type CircuitoIngenieria } from './circuitos.js';

export type EstadoValidacionIngenieria = 'PASS' | 'WARNING' | 'FAIL' | 'INDETERMINATE' | 'NOT_APPLICABLE';
export type SeveridadIngenieria = 'ERROR' | 'WARNING' | 'INFO';
export type ProcedenciaIngenieria = OrigenDatoFisico | 'NO_DISPONIBLE';
export type CategoriaIngenieria =
	| 'CIRCUIT' | 'CABLE' | 'PROTECTION' | 'COORDINATION' | 'POWER' | 'PHASE'
	| 'MOTOR' | 'VFD' | 'IO' | 'ANALOG' | 'PE' | 'DOCUMENTATION';
export type CodigoReglaIngenieria = `TS-${string}`;

export interface EvidenciaIngenieria {
	codigo: string;
	descripcion: string;
	valor?: number | string | boolean;
	unidad?: string;
	origen: ProcedenciaIngenieria;
}

export interface EntidadRelacionadaIngenieria {
	tipo: 'PROJECT' | 'CIRCUIT' | 'DEVICE' | 'CONDUCTOR' | 'TERMINAL' | 'SIGNAL';
	id: string;
}

export interface CriterioIngenieria {
	descripcion: string;
	valor?: number | string;
	unidad?: string;
	origen: 'CONFIGURADO' | 'MODELO_V7';
}

export interface ResultadoReglaIngenieria {
	code: CodigoReglaIngenieria;
	category: CategoriaIngenieria;
	severity: SeveridadIngenieria;
	status: EstadoValidacionIngenieria;
	title: string;
	description: string;
	circuitId?: string;
	evidence: EvidenciaIngenieria[];
	relatedEntities: EntidadRelacionadaIngenieria[];
	provenance: ProcedenciaIngenieria;
	criterion?: CriterioIngenieria;
	missingData: string[];
	remediationHints: string[];
}

export interface EngineeringIssue extends ResultadoReglaIngenieria { id: string }

export interface ContextoValidacionIngenieria {
	proyecto: Proyecto;
	circuitos: readonly CircuitoIngenieria[];
	fisica?: ResultadoFisicaElectrica;
}

export interface EngineeringRule {
	code: CodigoReglaIngenieria;
	category: CategoriaIngenieria;
	scope: 'PROJECT' | 'CIRCUIT' | 'ENTITY';
	evaluate(context: ContextoValidacionIngenieria): readonly ResultadoReglaIngenieria[];
}

export interface ResultadoValidacionIngenieria {
	circuitos: readonly CircuitoIngenieria[];
	resultados: ResultadoReglaIngenieria[];
	issues: EngineeringIssue[];
	resumen: {
		pass: number;
		warning: number;
		fail: number;
		indeterminate: number;
		notApplicable: number;
		errores: number;
		advertencias: number;
		informacion: number;
	};
}

const ORDEN_ESTADO: Record<EstadoValidacionIngenieria, number> = {
	FAIL: 0, WARNING: 1, INDETERMINATE: 2, PASS: 3, NOT_APPLICABLE: 4,
};
const ORDEN_SEVERIDAD: Record<SeveridadIngenieria, number> = { ERROR: 0, WARNING: 1, INFO: 2 };

const unicoOrdenado = (v: readonly string[]): string[] => [...new Set(v)].sort((a, b) => a.localeCompare(b));
const entidadesOrdenadas = (v: readonly EntidadRelacionadaIngenieria[]): EntidadRelacionadaIngenieria[] => {
	const m = new Map(v.map((x) => [`${x.tipo}\u0000${x.id}`, x]));
	return [...m.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.id.localeCompare(b.id));
};
const evidenciasOrdenadas = (v: readonly EvidenciaIngenieria[]): EvidenciaIngenieria[] => {
	const firma = (x: EvidenciaIngenieria) => `${x.codigo}\u0000${x.descripcion}\u0000${String(x.valor)}\u0000${x.unidad ?? ''}\u0000${x.origen}`;
	const m = new Map(v.map((x) => [firma(x), x])); return [...m.values()].sort((a, b) => firma(a).localeCompare(firma(b)));
};

function firmaResultado(r: ResultadoReglaIngenieria): string {
	const entidades = entidadesOrdenadas(r.relatedEntities).map((x) => `${x.tipo}:${x.id}`).join('|');
	return `${r.code}\u0000${r.circuitId ?? ''}\u0000${entidades}`;
}

function normalizar(r: ResultadoReglaIngenieria): ResultadoReglaIngenieria {
	if (!r.code.startsWith('TS-')) throw new Error(`Código de regla de ingeniería inválido: ${r.code}`);
	return { ...r, evidence: evidenciasOrdenadas(r.evidence), relatedEntities: entidadesOrdenadas(r.relatedEntities),
		missingData: unicoOrdenado(r.missingData), remediationHints: unicoOrdenado(r.remediationHints) };
}

function deduplicar(resultados: readonly ResultadoReglaIngenieria[]): ResultadoReglaIngenieria[] {
	const porFirma = new Map<string, ResultadoReglaIngenieria>();
	for (const original of resultados.map(normalizar)) {
		const firma = firmaResultado(original); const anterior = porFirma.get(firma);
		if (!anterior) { porFirma.set(firma, original); continue; }
		const principal = ORDEN_ESTADO[original.status] < ORDEN_ESTADO[anterior.status] ? original : anterior;
		porFirma.set(firma, { ...principal,
			severity: ORDEN_SEVERIDAD[original.severity] < ORDEN_SEVERIDAD[anterior.severity] ? original.severity : anterior.severity,
			evidence: evidenciasOrdenadas([...anterior.evidence, ...original.evidence]),
			relatedEntities: entidadesOrdenadas([...anterior.relatedEntities, ...original.relatedEntities]),
			missingData: unicoOrdenado([...anterior.missingData, ...original.missingData]),
			remediationHints: unicoOrdenado([...anterior.remediationHints, ...original.remediationHints]),
		});
	}
	return [...porFirma.values()].sort((a, b) => ORDEN_ESTADO[a.status] - ORDEN_ESTADO[b.status]
		|| a.category.localeCompare(b.category) || a.code.localeCompare(b.code)
		|| (a.circuitId ?? '').localeCompare(b.circuitId ?? '') || firmaResultado(a).localeCompare(firmaResultado(b)));
}

function resultadoTopologia(c: CircuitoIngenieria): ResultadoReglaIngenieria {
	const relatedEntities: EntidadRelacionadaIngenieria[] = [
		{ tipo: 'CIRCUIT', id: c.id }, ...c.fuentes.map((id) => ({ tipo: 'DEVICE' as const, id })),
		...c.cargas.map((id) => ({ tipo: 'DEVICE' as const, id })),
	];
	if (c.estadoTopologia === 'SIN_FUENTE') return {
		code: 'TS-CIRCUIT-SOURCE-MISSING', category: 'CIRCUIT', severity: 'INFO', status: 'INDETERMINATE',
		title: 'Circuito sin fuente identificable', description: 'No existe una raíz eléctrica explícita alcanzable; no se fuerza una orientación.',
		circuitId: c.id, evidence: [], relatedEntities, provenance: 'NO_DISPONIBLE', criterion: { descripcion: 'Topología derivada de perfiles explícitos', origen: 'MODELO_V7' },
		missingData: ['fuente o raíz eléctrica explícita'], remediationHints: ['Declarar el perfil de fuente o revisar la conectividad del circuito.'],
	};
	if (c.estadoTopologia === 'AMBIGUA') return {
		code: 'TS-CIRCUIT-AMBIGUOUS', category: 'CIRCUIT', severity: 'WARNING', status: 'WARNING',
		title: 'Topología eléctrica ambigua', description: 'La red contiene múltiples fuentes o caminos equivalentes y no se representa como un árbol inequívoco.',
		circuitId: c.id, evidence: c.ambiguedades.map((x) => ({ codigo: x.split(':')[0], descripcion: x, origen: 'CALCULADO' })),
		relatedEntities, provenance: 'CALCULADO', criterion: { descripcion: 'Orientación única del circuito', origen: 'MODELO_V7' },
		missingData: [], remediationHints: ['Revisar backfeed, puentes o fuentes múltiples antes de interpretar aguas arriba/abajo.'],
	};
	return {
		code: 'TS-CIRCUIT-TOPOLOGY', category: 'CIRCUIT', severity: 'INFO', status: 'PASS',
		title: 'Topología orientable', description: 'La carga posee una única fuente alcanzable y caminos deterministas.', circuitId: c.id,
		evidence: [{ codigo: 'SOURCE', descripcion: 'Fuente única alcanzable', valor: c.fuenteId, origen: 'CALCULADO' }],
		relatedEntities, provenance: 'CALCULADO', criterion: { descripcion: 'Orientación única del circuito', origen: 'MODELO_V7' },
		missingData: [], remediationHints: [],
	};
}

export const REGLA_TOPOLOGIA_CIRCUITOS: EngineeringRule = {
	code: 'TS-CIRCUIT-TOPOLOGY', category: 'CIRCUIT', scope: 'CIRCUIT',
	evaluate(contexto) {
		if (!contexto.circuitos.length) return [{
			code: 'TS-CIRCUIT-NONE', category: 'CIRCUIT', severity: 'INFO', status: 'NOT_APPLICABLE',
			title: 'Sin circuitos evaluables', description: 'El proyecto no contiene cargas con perfil eléctrico evaluable.',
			evidence: [], relatedEntities: [{ tipo: 'PROJECT', id: contexto.proyecto.nombre }], provenance: 'NO_DISPONIBLE',
			missingData: [], remediationHints: [],
		}];
		return contexto.circuitos.map(resultadoTopologia);
	},
};

export function validarIngenieria(entrada: {
	proyecto: Proyecto;
	fisica?: ResultadoFisicaElectrica;
	circuitos?: readonly CircuitoIngenieria[];
	reglas?: readonly EngineeringRule[];
}): ResultadoValidacionIngenieria {
	const circuitos = entrada.circuitos ?? descubrirCircuitos(entrada.proyecto).circuitos;
	const contexto: ContextoValidacionIngenieria = { proyecto: entrada.proyecto, circuitos, fisica: entrada.fisica };
	const reglas = [...(entrada.reglas ?? [REGLA_TOPOLOGIA_CIRCUITOS])]
		.sort((a, b) => a.code.localeCompare(b.code) || a.scope.localeCompare(b.scope));
	const resultados = deduplicar(reglas.flatMap((r) => r.evaluate(contexto)));
	const issues = resultados.filter((r) => ['FAIL', 'WARNING', 'INDETERMINATE'].includes(r.status))
		.map((r) => ({ ...r, id: firmaResultado(r).replace(/\u0000/g, ':') }));
	const contar = (status: EstadoValidacionIngenieria) => resultados.filter((r) => r.status === status).length;
	return { circuitos, resultados, issues, resumen: {
		pass: contar('PASS'), warning: contar('WARNING'), fail: contar('FAIL'), indeterminate: contar('INDETERMINATE'),
		notApplicable: contar('NOT_APPLICABLE'), errores: issues.filter((x) => x.severity === 'ERROR').length,
		advertencias: issues.filter((x) => x.severity === 'WARNING').length,
		informacion: issues.filter((x) => x.severity === 'INFO').length,
	} };
}
