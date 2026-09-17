import type { ContextoTopologiaFisica } from '../fisica/topologia-proyecto.js';
import type { ejecutarIngenieria } from '../ingenieria/engine.js';
import type { CondicionesTecnicas, ReferenciaTecnica, RevisionTecnica } from '../datos-tecnicos/tipos.js';
import type { Proyecto } from '../modelo/tipos.js';

export type CambioPermitidoDiseno = 'SECCION' | 'PROTECCION';
export type EstadoCandidatoDiseno = 'FACTIBLE' | 'INVIABLE' | 'INDETERMINADO' | 'ERROR';
export type EstadoCoberturaDiseno = 'EXHAUSTIVA' | 'LIMITADA' | 'CANCELADA' | 'ERROR';
export type PreferenciaDiseno = 'MENOS_CAMBIOS' | 'MENOR_SECCION_TOTAL' | 'MENOR_IN' | 'MENOR_PERDIDA';

export interface SolicitudDisenoAsistido {
	version: 1;
	id: string;
	nombre: string;
	circuitoId: string;
	conductores: string[];
	proteccionId?: string;
	cambiosPermitidos: CambioPermitidoDiseno[];
	seccionesPermitidasMm2?: number[];
	proteccionesPermitidas?: ReferenciaTecnica[];
	condicionesProteccion?: CondicionesTecnicas;
	preferencias?: PreferenciaDiseno[];
	presupuesto?: { maxCandidatos?: number; maxMs?: number; lote?: number };
}

export type CambioPlanDiseno =
	| { tipo: 'SECCION'; conductorId: string; seccionMm2: number }
	| { tipo: 'PROTECCION'; dispositivoId: string; referencia: ReferenciaTecnica };

export interface PlanDisenoAsistido {
	version: 1;
	id: string;
	tipo: 'BASE' | 'SECCION' | 'PROTECCION' | 'COMBINADO';
	cambios: CambioPlanDiseno[];
}

export interface SnapshotDisenoAsistido {
	version: 1;
	hash: string;
	hashBase: string;
	proyecto: Proyecto;
	solicitud: SolicitudDisenoAsistido;
	revisiones: RevisionTecnica[];
	contextoFisico?: ContextoTopologiaFisica;
}

export interface OpcionDisenoExcluida {
	tipo: CambioPermitidoDiseno;
	identidad: string;
	motivo: string;
}

export interface EspacioOpcionesDiseno {
	seccionesMm2: number[];
	protecciones: ReferenciaTecnica[];
	excluidas: OpcionDisenoExcluida[];
}

export interface ObligacionDiseno {
	id: string;
	estado: 'CUMPLE' | 'INCUMPLE' | 'INDETERMINADA';
	descripcion: string;
	evidencia: string[];
}

export interface MetricasDiseno {
	cambios: number;
	seccionTotalMm2?: number;
	proteccionInA?: number;
	perdidaW?: number;
	iccProspectivaA?: number;
	fallos: number;
	indeterminados: number;
}

export interface ResultadoCandidatoDiseno {
	plan: PlanDisenoAsistido;
	hashPlan: string;
	estado: EstadoCandidatoDiseno;
	analisis?: ReturnType<typeof ejecutarIngenieria>;
	proyecto?: Proyecto;
	obligaciones: ObligacionDiseno[];
	metricas: MetricasDiseno;
	limitaciones: string[];
	error?: string;
	pareto: boolean;
	orden: number;
}

export interface ResultadoDisenoAsistido {
	version: 1;
	snapshotHash: string;
	cobertura: EstadoCoberturaDiseno;
	motivoCobertura: string;
	generados: number;
	evaluados: number;
	totalEstimado: number;
	duracionMs: number;
	excluidas: OpcionDisenoExcluida[];
	resultados: ResultadoCandidatoDiseno[];
}

export interface ProgresoDisenoAsistido {
	fase: 'PREPARANDO' | 'EVALUANDO' | 'ORDENANDO' | 'TERMINADO';
	generados: number;
	evaluados: number;
	totalEstimado: number;
	transcurridoMs: number;
}

export interface PreviewAplicacionDiseno {
	version: 1;
	snapshotHash: string;
	hashBase: string;
	hashCandidato: string;
	plan: PlanDisenoAsistido;
	candidato: Proyecto;
	cambios: CambioPlanDiseno[];
}
