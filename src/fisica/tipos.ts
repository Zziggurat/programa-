import type { OrigenDatoFisico } from '../modelo/fisica.js';
import type { Complejo } from './complejos.js';

export type CodigoDiagnosticoFisica = 'SIN_REFERENCIA' | 'ISLA_FLOTANTE' | 'MATRIZ_SINGULAR'
	| 'NO_CONVERGE' | 'FUENTES_INCOMPATIBLES' | 'FUENTES_PARALELAS_NO_MODELADAS'
	| 'CONFIGURACION_INVALIDA' | 'CIRCUITO_ABIERTO' | 'ICC_NO_DISPONIBLE'
	| 'CAIDA_TENSION' | 'COMPLIANCE_4_20' | 'POSIBLE_NO_SELECTIVIDAD' | 'FALLA';

export interface DiagnosticoFisica {
	codigo: CodigoDiagnosticoFisica;
	mensaje: string;
	elementos?: string[];
}

export interface NodoRedFisica { id: string; referencia?: boolean }

export interface RamaRedFisica {
	id: string;
	de: string;
	a: string;
	zOhm: Complejo;
	tipo?: 'CONDUCTOR' | 'CONTACTO' | 'PROTECCION' | 'TRANSFORMADOR' | 'OTRO';
	conductorId?: string;
	dispositivoId?: string;
	origen?: OrigenDatoFisico;
}

export interface FuenteRedFisica {
	id: string;
	de: string;
	a: string;
	tensionV: Complejo;
	/** Ausente significa fuente ideal para tension, pero Icc no disponible. */
	zInternaOhm?: Complejo;
	origenImpedancia: OrigenDatoFisico;
	frecuenciaHz?: number;
}

export interface TransformadorRedFisica {
	id: string;
	primarioDe: string;
	primarioA: string;
	secundarioDe: string;
	secundarioA: string;
	/** Np/Ns = Vp/Vs. */
	relacion: number;
	/** Impedancia serie referida al primario. */
	zSeriePrimarioOhm: Complejo;
	potenciaNominalVA?: number;
	origen: OrigenDatoFisico;
}

export type CargaRedFisica = {
	id: string; de: string; a: string; modelo: 'CONSTANT_Z'; zOhm: Complejo; dispositivoId?: string; origen?: OrigenDatoFisico;
} | {
	id: string; de: string; a: string; modelo: 'CONSTANT_I'; corrienteA: number; factorPotencia?: number; dispositivoId?: string; origen?: OrigenDatoFisico;
} | {
	id: string; de: string; a: string; modelo: 'CONSTANT_PQ'; potenciaVA: Complejo; tensionNominalV: number; dispositivoId?: string; origen?: OrigenDatoFisico;
};

export interface RedFisica {
	nodos: NodoRedFisica[];
	ramas: RamaRedFisica[];
	fuentes: FuenteRedFisica[];
	cargas: CargaRedFisica[];
	transformadores?: TransformadorRedFisica[];
}

export interface ResultadoNodoFisica {
	id: string;
	tensionV?: Complejo;
	calidad: 'VALIDA' | 'SIN_REFERENCIA' | 'NO_CONVERGE';
	origen: OrigenDatoFisico;
}

export interface ResultadoRamaFisica {
	id: string;
	corrienteA: Complejo;
	caidaV: Complejo;
	perdidaW: number;
	origen: OrigenDatoFisico;
}

export interface ResultadoCargaFisica {
	id: string;
	/** Identidad persistente de la carga; evita inferirla analizando el id técnico de la rama. */
	dispositivoId?: string;
	tensionV: Complejo;
	corrienteA: Complejo;
	potenciaVA: Complejo;
	factorPotencia?: number;
	origen: OrigenDatoFisico;
}

export interface ResultadoFuenteFisica {
	id: string;
	tensionTerminalV: Complejo;
	corrienteEntregadaA: Complejo;
	potenciaEntregadaVA: Complejo;
	origenImpedancia: OrigenDatoFisico;
}

export interface ResultadoTransformadorFisica {
	id: string;
	tensionPrimariaV: Complejo;
	tensionSecundariaV: Complejo;
	corrientePrimariaA: Complejo;
	corrienteSecundariaA: Complejo;
	potenciaEntradaVA: Complejo;
	potenciaSalidaVA: Complejo;
	perdidaCobreW: number;
	eficiencia?: number;
	regulacionPct?: number;
	cargaPct?: number;
	origen: OrigenDatoFisico;
}

export interface MetricasSolverFisica {
	nodos: number;
	ramas: number;
	iteraciones: number;
	convergio: boolean;
	tiempoMs: number;
	residuoKclA: number;
	errorBalanceW: number;
}

export interface ResultadoRedFisica {
	nodos: Map<string, ResultadoNodoFisica>;
	ramas: Map<string, ResultadoRamaFisica>;
	cargas: Map<string, ResultadoCargaFisica>;
	fuentes: Map<string, ResultadoFuenteFisica>;
	transformadores: Map<string, ResultadoTransformadorFisica>;
	diagnosticos: DiagnosticoFisica[];
	potenciaCargasW: number;
	potenciaPerdidasW: number;
	potenciaFuentesW: number;
	metricas: MetricasSolverFisica;
}
