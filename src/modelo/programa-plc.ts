import type { CalidadSenalAnalogica, OrigenSenalAnalogica } from './senal-analogica.js';

/** Lenguajes persistentes aceptados por el runtime. El formato legacy sigue siendo compatible. */
export type LenguajeProgramaPLC = 'tablerostudio-plc-v4' | 'legacy';

export type TipoDatoPLC = 'BOOL' | 'REAL';
export type ClaseIOPLC = 'DI' | 'DO' | 'AI' | 'AO';

/** Etiqueta persistente: nombre lógico y, opcionalmente, su borne físico. */
export interface EtiquetaPLC {
	nombre: string;
	tipo: TipoDatoPLC;
	io?: { clase: ClaseIOPLC; borne: string };
	inicial?: boolean | number;
	/** RETAIN conserva el valor durante una pérdida de alimentación de la misma sesión. */
	retain?: boolean;
	descripcion?: string;
}

/**
 * Configuración persistente del programa. No contiene imágenes de proceso, temporizadores,
 * contadores, alarmas, fuerzas ni ninguna otra memoria de ejecución.
 */
export interface ConfiguracionProgramaPLC {
	version: 1;
	lenguaje: LenguajeProgramaPLC;
	FUENTE: string;
	periodoScanMs?: number;
	modoInicial?: 'RUN' | 'STOP';
	etiquetas?: EtiquetaPLC[];
	limites?: {
		operacionesPorScan?: number;
		catchUpMaximo?: number;
	};
}

export interface ValorAnalogicoPLC {
	valor?: number;
	calidad: CalidadSenalAnalogica;
	origen: OrigenSenalAnalogica;
}

/** Imagen que el PLC congela al comienzo de un scan. */
export interface ImagenEntradasPLC {
	digitales: Record<string, boolean>;
	analogicas: Record<string, ValorAnalogicoPLC>;
}

/** Imagen publicada de forma atómica al final del scan. */
export interface ImagenSalidasPLC {
	digitales: Record<string, boolean>;
	analogicas: Record<string, number>;
}

/** Fuerzas de la sesión. Son runtime y nunca forman parte de Proyecto. */
export interface FuerzasPLC {
	DI?: Record<string, boolean>;
	DO?: Record<string, boolean>;
	AI?: Record<string, number>;
	AO?: Record<string, number>;
}

export type EstadoEjecucionPLC = 'SIN_ALIMENTACION' | 'STOP' | 'RUN' | 'FAULT';

export type SeveridadAlarmaPLC = 'INFO' | 'WARNING' | 'ALARM' | 'TRIP';

export interface EventoPLC {
	instanteMs: number;
	tipo: 'SCAN' | 'ESTADO' | 'ALARMA' | 'ACK' | 'RESET' | 'FUERZA' | 'FAULT';
	mensaje: string;
}

export interface EstadoAlarmaPLC {
	id: string;
	severidad: SeveridadAlarmaPLC;
	mensaje: string;
	activa: boolean;
	enclavada: boolean;
	reconocida: boolean;
	desdeMs?: number;
}

export interface DiagnosticoInterlockPLC {
	salida: string;
	mensaje: string;
	activo: boolean;
}

export interface EstadoTemporizadorPLC {
	tipo: 'TON' | 'TOF' | 'TP';
	IN: boolean;
	Q: boolean;
	PT: number;
	ET: number;
}

export interface EstadoContadorPLC {
	tipo: 'CTU' | 'CTD';
	CV: number;
	PV: number;
	Q: boolean;
	entradaAnterior: boolean;
}

export interface EstadoPIDPLC {
	salida: number;
	integral: number;
	errorAnterior: number;
	manual: boolean;
	saturado: boolean;
	calidadPV: CalidadSenalAnalogica;
}

/** Memoria de un PLC durante una sesión de simulación. */
export interface RuntimePLC {
	estado: EstadoEjecucionPLC;
	modoSolicitado: 'RUN' | 'STOP';
	pausado: boolean;
	primerScanPendiente: boolean;
	scan: number;
	ultimoScanMs?: number;
	proximoScanMs?: number;
	duracionUltimoScanMs: number;
	entradas: ImagenEntradasPLC;
	salidas: ImagenSalidasPLC;
	variables: Record<string, boolean | number>;
	temporizadores: Record<string, EstadoTemporizadorPLC>;
	contadores: Record<string, EstadoContadorPLC>;
	secuencias: Record<string, string>;
	alarmas: Record<string, EstadoAlarmaPLC>;
	pids: Record<string, EstadoPIDPLC>;
	flancos: Record<string, boolean>;
	interlocks: DiagnosticoInterlockPLC[];
	fuerzas: FuerzasPLC;
	forzadas: string[];
	errores: string[];
	eventos: EventoPLC[];
	/** Memoria aislada del adaptador legacy, por PLC. */
	legacy?: { desdePedida: Record<string, number>; desdeEncendida: Record<string, number> };
}

/** Órdenes efímeras procedentes de la UI de Energizar. */
export interface OrdenesRuntimePLC {
	modo?: 'RUN' | 'STOP';
	pausado?: boolean;
	paso?: boolean;
	reiniciar?: boolean;
	ackAlarmas?: string[];
	resetAlarmas?: string[];
	fuerzas?: FuerzasPLC;
}
