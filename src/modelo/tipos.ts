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
import { AjustesDossier } from './dossier.js';

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
	/**
	 * Sección máxima (mm²) que admite el tornillo de este borne, de la ficha del aparato.
	 *
	 * Cuenta tanto como el número de hilos: un 6 mm² no entra en una borna UT 2,5 por mucho que
	 * el cálculo diga que hace falta un 6, y eso se descubre con el tablero ya montado y el cable
	 * ya cortado. Si no se declara, el DRC no supone nada.
	 */
	seccionMaxMm2?: number;
	/** Posición relativa (0..1) del pin sobre la imagen de un dispositivo de referencia. */
	u?: number;
	v?: number;
}

/** Borde del aparato por el que asoma una bornera. */
export type LadoAparato = 'arriba' | 'abajo' | 'izquierda' | 'derecha';

/**
 * Bornera física de un aparato: un bloque de terminales situado en un borde concreto.
 *
 * Es lo que permite describir un equipo REAL (un controlador, un módulo de E/S) sin
 * modelarlo a mano: basta declarar dónde están sus borneras y qué bornes lleva cada una,
 * con los rótulos serigrafiados del fabricante. Con eso el modelo 3D dibuja los conectores
 * en su sitio y el cable sale exactamente del terminal que toca.
 */
export interface BloqueTerminales {
	/** Rótulo serigrafiado del bloque, p. ej. "UI1-UI8" o "24 VAC". */
	rotulo?: string;
	lado: LadoAparato;
	/** Ids de bornes en su orden real: de izquierda a derecha, o de arriba abajo en los lados. */
	bornes: string[];
	/** Distancia (mm) del eje de la fila al borde. Por defecto 6. */
	margen?: number;
	/** Fracción del lado (0..1) donde empieza el bloque; permite varios bloques en un borde. */
	desde?: number;
	/** Fracción del lado (0..1) donde termina. Por defecto 1. */
	hasta?: number;
	/** Color del conector (los fabricantes los codifican por función). */
	color?: string;
	/** True si la bornera es enchufable/extraíble (se dibuja como conector saliente). */
	extraible?: boolean;
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
	/**
	 * Corriente nominal en amperios. En una protección (automático, fusible, guardamotor) es su
	 * calibre In: con él se comprueba que el conductor aguas abajo esté de verdad protegido.
	 * En un consumo (motor, resistencia) es la corriente de empleo Ib.
	 */
	corrienteNominal?: number;
	/** Nº de polos de la protección o del consumo (1, 2, 3 o 4). Trifásico = 3 o más. */
	polos?: number;
	/**
	 * Tensión del SECUNDARIO de un transformador o de una fuente, en voltios. `tensionNominal` es
	 * la del primario —lo que le entra—, y sin este dato la simulación no sabe qué reparte.
	 * Si falta, se deduce de la descripción («Transformador 220/24 V») y si tampoco, se supone 24.
	 */
	tensionSecundariaV?: number;
	/**
	 * Poder de corte de una protección, en kA (Icu/Icn de la hoja del fabricante). Es lo que
	 * decide si el aparato aguanta el cortocircuito del sitio donde se instala: un automático
	 * de 6 kA en una acometida de 10 kA no corta, se destruye.
	 */
	poderCorteKA?: number;
	/**
	 * True cuando el poder de corte es el VALOR HABITUAL DE LA FAMILIA y no un dato leído de la
	 * hoja del fabricante. El DRC lo dice en su mensaje: un aparato puede acabar rechazado por un
	 * número que nadie ha confirmado, y quien firma tiene derecho a saberlo.
	 */
	poderCorteEstimado?: boolean;
	/** Potencia disipada en servicio, en W. Sirve para el balance térmico del gabinete. */
	disipacionW?: number;
	/**
	 * True cuando la disipación es una estimación y no un dato de catálogo. Sin esto el balance
	 * térmico contaría como «declarado por el fabricante» un número que se ha supuesto, y el
	 * porcentaje de fiabilidad que sale en el dossier sería falso.
	 */
	disipacionEstimada?: boolean;
	/**
	 * Curva de disparo de un automático (B, C, D, K, Z) o clase de un fusible (gG, aM). Es lo que
	 * decide cuánta punta de arranque aguanta sin disparar y, junto al calibre, si dos
	 * protecciones en serie son selectivas entre sí.
	 */
	curvaDisparo?: 'B' | 'C' | 'D' | 'K' | 'Z' | 'gG' | 'aM';
	/** Sensibilidad de un diferencial, en mA (30 = personas, 300 = incendio). */
	sensibilidadMA?: number;
	/**
	 * Clase de un diferencial según la forma de onda que es capaz de detectar. Con variadores o
	 * fuentes conmutadas aguas abajo, un AC puede quedarse ciego ante la corriente continua.
	 */
	claseDiferencial?: 'AC' | 'A' | 'F' | 'B';
	/** Rango de regulación de un guardamotor o relé térmico, en A: [mínimo, máximo]. */
	rangoRegulacionA?: [number, number];
	/**
	 * Rango de medida de una SONDA analógica: [mínimo, máximo] en su unidad.
	 *
	 * Es lo que separa una sonda de un contacto de campo. Un presostato de filtro sucio y una sonda
	 * de temperatura de retorno se declaran los dos como «sensor», pero el primero abre y cierra y
	 * el segundo entrega un número — y solo el segundo tiene sentido con un mando deslizante en la
	 * simulación. Sin este dato el programa tenía que adivinarlo, y le ponía un mando de −10 a 60 °C
	 * a un detector inductivo.
	 */
	rangoSonda?: [number, number];
	/** Unidad de lo que mide la sonda: °C, %HR, Pa, bar… Solo para enseñarla. */
	unidadSonda?: string;
	/**
	 * Temporización de un relé, si la tiene. Sin esto un relé conmuta al instante; con esto se
	 * pueden montar las maniobras que de verdad se usan: una estrella-triángulo, o el arranque
	 * escalonado de una UMA —primero abre la compuerta y unos segundos después arranca el
	 * ventilador—, que es justo lo que gobiernan los tableros de la cubierta.
	 *
	 *  - `trabajo` (a la conexión, TON): al alimentar la bobina espera `segundos` y CIERRA.
	 *  - `reposo`  (a la desconexión, TOF): al alimentarla actúa ya, y al quitarle tensión
	 *    aguanta `segundos` antes de soltar.
	 */
	temporizacion?: { tipo: 'trabajo' | 'reposo'; segundos: number };
	/** True si el aparato está fuera del gabinete (campo): motores, sensores, etc. */
	campo?: boolean;
	/**
	 * Imagen de referencia (data URL). Si está presente, el dispositivo se dibuja como
	 * la imagen con sus pines (bornes con u,v) en vez de un modelo 3D; sirve para cablear
	 * de forma visual cualquier foto (un gabinete, un controlador, un motor…).
	 */
	imagen?: string;
	/**
	 * Colocación MANUAL en el esquema: la columna y la fila donde quien dibuja ha decidido que
	 * va este aparato, arrastrándolo. Si falta, la decide el motor de esquema.
	 *
	 * Se guarda aparte de `posicion` a propósito: `posicion` es de dónde lo puso quien construyó
	 * el proyecto, y esto es una DECISIÓN DE DIBUJO que el usuario puede deshacer con «reordenar
	 * solo». Un esquema automático está bien para empezar, pero el que se entrega lo ordena una
	 * persona: agrupa la maniobra, separa lo que va a campo y deja hueco donde hará falta.
	 *
	 * La columna es GLOBAL —sigue de una hoja a la siguiente—, así que arrastrar un aparato más
	 * allá de la última columna de su hoja lo pasa a la hoja siguiente, que es lo que se espera.
	 */
	esquema?: { columna: number; fila: number };
	/** Hoja del esquema donde está dibujado. */
	hojaId?: string;
	/** Posición en la hoja, en coordenadas de rejilla (columna/fila continuas). */
	posicion?: Posicion;
	bornes: Borne[];
	/**
	 * Disposición física real de las borneras. Si está presente, manda sobre el reparto
	 * automático en dos filas: cada borne se ancla en el bloque y la posición que declara
	 * su ficha de datos (así el cable sale del terminal correcto de un equipo real).
	 */
	terminales?: BloqueTerminales[];
	/** Fondo del aparato en mm (dato de catálogo). Si falta, lo estima el modelo 3D. */
	profundidad?: number;
	/** Color real del cuerpo (#rrggbb). Si falta, se usa el color por tipo de aparato. */
	colorCuerpo?: string;
	/**
	 * PROGRAMA del controlador, un renglón por salida: «DO1 = DI1 Y NO DI2 retardo 5».
	 *
	 * Es lo que hace que un PLC del tablero deje de ser un adorno: sin esto sus salidas solo se
	 * encendían forzándolas a mano, y un tablero de clima es justo lo contrario —el controlador ES
	 * la maniobra—. El lenguaje está en `src/motores/logica.ts`.
	 */
	programa?: string;
	/** Rasgos visibles del frente del equipo (los dibuja el modelo 3D tal cual). */
	rasgosFrente?: { display?: boolean; leds?: number; puertosIP?: number; puertosRS485?: number };
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
	/**
	 * Puntos de paso manuales (mm sobre la placa) para ordenar el cable a mano cuando no
	 * va por canaleta. Si está vacío, el cable cuelga con una catenaria natural.
	 */
	trazado?: { x: number; y: number }[];
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

/** Riel DIN. Horizontal por defecto; puede colocarse vertical. */
export interface Riel {
	id: string;
	x: number;
	y: number;
	largo: number;
	orientacion?: Orientacion; // 'h' (por defecto) | 'v'
}

/** Un dispositivo colocado sobre la placa de montaje. */
export interface Colocacion {
	dispositivoId: string;
	x: number;
	y: number;
	ancho: number;
	alto: number;
	rielId?: string;
	/**
	 * Desplazamiento en profundidad (mm) respecto de la placa. Sirve sobre todo para las
	 * imágenes de referencia: negativo las manda al fondo (detrás de rieles y canaletas) y
	 * positivo las trae al frente, para que no queden tapadas.
	 */
	z?: number;
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

/**
 * Datos administrativos del proyecto: los que llevan el cajetín del plano y la portada del
 * dossier. Sin ellos el entregable sale anónimo, y un plano sin cliente ni revisión no se
 * puede seguir en obra.
 */
export interface DatosProyecto {
	cliente?: string;
	obra?: string;
	proyectista?: string;
	/**
	 * Fabricante del conjunto: quien lo arma y firma. IEC 61439-1 §6.1 lo exige en la placa de
	 * características junto con la designación de tipo; un tablero sin fabricante identificable
	 * no es un conjunto conforme, es una caja con aparatos dentro.
	 */
	fabricante?: string;
	/** Índice de revisión, p. ej. "A", "B", "0"… */
	revision?: string;
	/** Fecha del documento, en ISO (aaaa-mm-dd). */
	fecha?: string;
	/** Nota libre que sale en el dossier (condiciones, alcance…). */
	notas?: string;
}

export interface OpcionesProyecto {
	/**
	 * Corriente de cortocircuito presunta en la acometida, en kA. Es el dato del que depende
	 * si las protecciones elegidas aguantan: un automático con poder de corte menor que esto
	 * no interrumpe la falta, se destruye. Lo da la compañía o el cálculo de la instalación.
	 */
	iccPresuntaKA?: number;
	/** Temperatura ambiente de proyecto (°C), para el balance térmico del gabinete. */
	temperaturaAmbienteC?: number;
	/**
	 * Cómo queda instalado el armario. Decide cuántas caras disipan de verdad y por tanto la
	 * temperatura interior: el mismo tablero adosado a una pared o encajado entre otros dos no
	 * se calienta igual.
	 */
	montajeGabinete?: 'mural' | 'exento' | 'empotrado';
	/** Grado de protección de la envolvente (IEC 60529), p. ej. "IP54". Vacío = sin declarar. */
	gradoIP?: string;
	/** Régimen de neutro de la instalación aguas arriba. Vacío = sin declarar. */
	regimenNeutro?: '' | 'TN-S' | 'TN-C' | 'TN-C-S' | 'TT' | 'IT';
	/** Frecuencia asignada (Hz). */
	frecuenciaHz?: number;
	/** Corriente asignada del conjunto InA (A). 0 = sin declarar. */
	corrienteAsignadaA?: number;
	/**
	 * Dónde va instalado el conjunto. Va en la placa de características de IEC 61439-1 §6.1, y
	 * NO es un detalle: un tablero de cubierta está a la intemperie —sol, lluvia, viento— y eso
	 * cambia el grado IP que hay que exigir y el comportamiento térmico. Vacío = sin declarar, y
	 * entonces la placa dice «a declarar» en vez de suponer «interior».
	 */
	usoPrevisto?: '' | 'interior' | 'intemperie';
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
	/** Cliente, obra, proyectista y revisión (cajetín del plano y portada del dossier). */
	datos?: DatosProyecto;
	hojas: Hoja[];
	dispositivos: Dispositivo[];
	conductores: Conductor[];
	gabinete?: Gabinete;
	opciones?: OpcionesProyecto;
	/** Ajustes del dibujo del esquema que decide quien dibuja, no el motor. */
	esquema?: AjustesEsquema;
	/** Qué apartados lleva el dossier y qué le añade a mano quien lo firma. */
	dossier?: AjustesDossier;
}

/** Lo que se puede cambiar del esquema sin tocar el circuito. */
export interface AjustesEsquema {
	/** Columnas por hoja. Menos columnas = símbolos más anchos y más hojas. Por defecto 10. */
	columnasPorHoja?: number;
	/** Títulos propios de las hojas, por índice de hoja (1, 2, 3…). */
	titulos?: Record<string, string>;
}

export const OPCIONES_POR_DEFECTO: Required<OpcionesProyecto> = {
	formatoDesignacion: '[={funcion}][+{ubicacion}]-{clase}{n}',
	inicioNumeracionConductores: 1,
	reservaCable: 0.15,
	extraPorConexionMm: 100,
	ocupacionMaxCanaleta: 0.45,
	// 0 = no declarada: sin este dato no se puede comprobar el poder de corte, y el DRC lo dice.
	iccPresuntaKA: 0,
	temperaturaAmbienteC: 35,
	montajeGabinete: 'mural',
	// Vacío en vez de un valor cómodo: la placa de características prefiere decir «a declarar»
	// antes que afirmar un IP o un régimen de neutro que nadie ha comprobado.
	gradoIP: '',
	regimenNeutro: '',
	frecuenciaHz: 50,
	corrienteAsignadaA: 0,
	usoPrevisto: '',
};
