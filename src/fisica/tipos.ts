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
	diagnosticos: DiagnosticoFisica[];
	potenciaCargasW: number;
	potenciaPerdidasW: number;
	potenciaFuentesW: number;
	metricas: MetricasSolverFisica;
}

