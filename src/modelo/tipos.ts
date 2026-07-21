/**
 * Modelo de datos de TableroStudio.
 *
 * Principios (ver docs/analisis-qelectrotech.md):
 *  - El modelo es puro (JSON serializable), sin dependencia de ninguna librería gráfica.
 *  - Identidad por id estable; los enlaces entre objetos son por id.
 *  - El rol lógico (maestro/esclavo/bornero) es un dato del dispositivo, no del dibujo.
 *  - Unidades físicas del gabinete en milímetros; secciones en mm².
 */

/** Letra de clase según IEC 81346-2 (p. ej. K = contactores/relés, Q = maniobra de potencia). */
export type LetraClase =
	| 'A' | 'B' | 'C' | 'E' | 'F' | 'G' | 'K' | 'M' | 'P'
	| 'Q' | 'R' | 'S' | 'T' | 'U' | 'W' | 'X' | 'Y';

/** Tipos de aparato conocidos, con su letra IEC por defecto (se puede forzar con `clase`). */
export type TipoDispositivo =
	| 'plc' | 'fuente' | 'transformador' | 'contactor' | 'rele'
	| 'disyuntor' | 'guardamotor' | 'diferencial' | 'fusible' | 'seccionador'
	| 'variador' | 'motor' | 'pulsador' | 'selector' | 'piloto'
	| 'sensor' | 'valvula' | 'resistencia' | 'condensador'
	| 'bornero' | 'cable' | 'otro';

export const CLASE_POR_TIPO: Record<TipoDispositivo, LetraClase> = {
	plc: 'A',
	fuente: 'G',
	transformador: 'T',
	contactor: 'K',
	rele: 'K',
	disyuntor: 'Q',
	guardamotor: 'Q',
	seccionador: 'Q',
	diferencial: 'F',
	fusible: 'F',
	variador: 'U',
	motor: 'M',
	pulsador: 'S',
	selector: 'S',
	piloto: 'P',
	sensor: 'B',
	valvula: 'Y',
	resistencia: 'R',
	condensador: 'C',
	bornero: 'X',
	cable: 'W',
	otro: 'E',
};

/** Naturaleza eléctrica de un punto de conexión; la usa el DRC y la numeración de potenciales. */
export type TipoBorne = 'L' | 'N' | 'PE' | 'control' | 'senal' | 'otro';

/** Punto de conexión de un dispositivo (pin/borne). En un bornero, cada borna es un Borne. */
export interface Borne {
	id: string;              // único dentro del dispositivo, p. ej. "L1", "A1", "13"
	tipo?: TipoBorne;
	/** Si es true, el DRC marca error cuando queda sin conductor. */
	obligatorio?: boolean;
	/** Máximo de conductores admitidos en este punto (por defecto 2). */
	maxConductores?: number;
	/** Posición relativa (0..1) del pin sobre la imagen de un dispositivo de referencia. */
	u?: number;
	v?: number;
}

/** Rol lógico para referencias cruzadas (equivalente a Master/Slave de QElectroTech). */
export type Rol =
	| { tipo: 'maestro' }
	| { tipo: 'esclavo'; maestroId: string; contacto: 'NA' | 'NC' | 'potencia' };

export interface Posicion { x: number; y: number }

export interface Dispositivo {
	id: string;
	tipo: TipoDispositivo;
	/** Fuerza la letra IEC (si no, se usa CLASE_POR_TIPO[tipo]). */
	clase?: LetraClase;
	/** Número de secuencia asignado por el motor de numeración (K"1"). */
	numero?: number;
	/** Designación completa calculada, p. ej. "=ALIM+TAB1-K1". */
	designacion?: string;
	/** Si es true, la renumeración masiva no toca numero/designacion (idea de QET). */
	congelado?: boolean;
	/** Aspecto función de IEC 81346 (=). */
	funcion?: string;
	/** Aspecto ubicación de IEC 81346 (+). */
	ubicacion?: string;
	descripcion?: string;
	fabricante?: string;
	referencia?: string;
	/** Tensión nominal de trabajo en voltios (para el DRC). */
	tensionNominal?: number;
	/** True si el aparato está fuera del gabinete (campo): motores, sensores, etc. */
	campo?: boolean;
	/**
	 * Imagen de referencia (data URL). Si está presente, el dispositivo se dibuja como
	 * la imagen con sus pines (bornes con u,v) en vez de un modelo 3D; sirve para cablear
	 * de forma visual cualquier foto (un gabinete, un controlador, un motor…).
	 */
	imagen?: string;
	/** Hoja del esquema donde está dibujado. */
	hojaId?: string;
	/** Posición en la hoja, en coordenadas de rejilla (columna/fila continuas). */
	posicion?: Posicion;
	bornes: Borne[];
	/** Pares de bornes unidos internamente (paso directo), p. ej. entrada/salida de una borna. */
	puentesInternos?: [string, string][];
	/** Grupos de bornas puenteadas de un bornero, por id de borne. */
	puentes?: string[][];
	rol?: Rol;
}

/** Extremo de un conductor. */
export interface RefBorne {
	dispositivoId: string;
	borneId: string;
}

export interface Conductor {
	id: string;
	de: RefBorne;
	a: RefBorne;
	/** Sección en mm². */
	seccion?: number;
	color?: string;
	/** Número/etiqueta asignada por el motor de numeración (compartida por potencial). */
	numero?: string;
	congelado?: boolean;
}

/** Folio del esquema. Rejilla al estilo QET: columnas numeradas y filas con letra. */
export interface Hoja {
	id: string;
	numero: number;
	titulo: string;
	columnas?: number; // por defecto 10
	filas?: number;    // por defecto 6
}

/* ------------------------- Modelo físico del gabinete ------------------------- */

export type Orientacion = 'h' | 'v';

/** Canaleta (ducto) sobre la placa de montaje. Nace en (x,y) y corre `largo` mm. */
export interface Canaleta {
	id: string;
	x: number;
	y: number;
	largo: number;
	orientacion: Orientacion;
	/** Ancho exterior en mm (típico 40, 60, 80). */
	ancho: number;
	/** Altura/profundidad en mm. */
	alto: number;
}

/** Riel DIN horizontal. */
export interface Riel {
	id: string;
	x: number;
	y: number;
	largo: number;
}

/** Un dispositivo colocado sobre la placa de montaje. */
export interface Colocacion {
	dispositivoId: string;
	x: number;
	y: number;
	ancho: number;
	alto: number;
	rielId?: string;
}

export interface Gabinete {
	/** Dimensiones útiles de la placa de montaje, en mm. */
	ancho: number;
	alto: number;
	/** Caja envolvente (opcional): si falta, se asume placa + margen estándar. */
	caja?: { ancho: number; alto: number; profundidad: number };
	canaletas: Canaleta[];
	rieles: Riel[];
	colocaciones: Colocacion[];
}

/* --------------------------------- Proyecto --------------------------------- */

export interface OpcionesProyecto {
	/**
	 * Plantilla de designación IEC 81346. Variables: {funcion} {ubicacion} {clase} {n}.
	 * Los bloques entre corchetes se omiten si su variable está vacía.
	 */
	formatoDesignacion?: string; // por defecto "[={funcion}][+{ubicacion}]-{clase}{n}"
	/** Primer número de la secuencia de conductores de control. */
	inicioNumeracionConductores?: number; // por defecto 1
	/** Reserva de longitud de cable sobre la ruta calculada (0.15 = 15 %). */
	reservaCable?: number;
	/** mm extra por cada punta de cable (peinado y conexión). */
	extraPorConexionMm?: number;
	/** Porcentaje máximo de llenado de canaleta antes de avisar (0.45 = 45 %). */
	ocupacionMaxCanaleta?: number;
}

export interface Proyecto {
	formato: 'tablero-studio';
	version: 1;
	nombre: string;
	hojas: Hoja[];
	dispositivos: Dispositivo[];
	conductores: Conductor[];
	gabinete?: Gabinete;
	opciones?: OpcionesProyecto;
}

export const OPCIONES_POR_DEFECTO: Required<OpcionesProyecto> = {
	formatoDesignacion: '[={funcion}][+{ubicacion}]-{clase}{n}',
	inicioNumeracionConductores: 1,
	reservaCable: 0.15,
	extraPorConexionMm: 100,
	ocupacionMaxCanaleta: 0.45,
};
