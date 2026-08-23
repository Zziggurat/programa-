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
import type { ComportamientoSimulacion } from './comportamiento.js';

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

/**
 * De qué LADO de una fuente o un transformador está un borne.
 *
 * Existe porque la simulación lo adivinaba por el NOMBRE del borne: buscaba los ids `+V`/`S1` y
 * `-V`/`S2` y con eso decidía dónde nacía el secundario. Los aparatos del catálogo se llaman así,
 * pero el tablero que arma el puente desde la Planta 3D usa `+24` y `0V` —que es como vienen
 * rotuladas las fuentes de 24 V CC de verdad—, así que su secundario no existía para la
 * simulación: el PLC, los borneros y las máquinas quedaban sin tensión.
 *
 * Un id es un rótulo; esto es una declaración eléctrica.
 */
export type LadoFuente = 'primario' | 'secundario+' | 'secundario-';

/** Punto de conexión de un dispositivo (pin/borne). En un bornero, cada borna es un Borne. */
export interface Borne {
	id: string;              // único dentro del dispositivo, p. ej. "L1", "A1", "13"
	tipo?: TipoBorne;
	/**
	 * Solo en fuentes y transformadores: de qué lado está este borne. Si no se declara, la
	 * simulación lo deduce del id como hacía antes, para no romper lo ya guardado.
	 */
	lado?: LadoFuente;
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
	/** Contrato eléctrico ejecutable. Si existe, manda sobre las heurísticas legacy por tipo/IEC. */
	comportamiento?: ComportamientoSimulacion;
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
	 * COLOR DE SEÑALIZACIÓN de un piloto, un pulsador o un selector: `rojo`, `verde`, `ambar`,
	 * `azul`, `blanco` — o un `#rrggbb` si hace falta uno concreto.
	 *
	 * Es dato del APARATO y no del dibujo, y por eso vive aquí y no en la escena. IEC 60073 le da
	 * significado a cada uno —rojo es falla o parada, verde es marcha, ámbar es aviso— así que el
	 * color de un piloto es tan parte de su definición como su tensión: cambiarlo cambia lo que el
	 * tablero le dice a quien lo mira, y tiene que sobrevivir a guardar y volver a abrir.
	 */
	colorSenal?: string;
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
	/**
	 * Rango de las SALIDAS ANALÓGICAS de un controlador, en voltios: `[0, 10]`, `[2, 10]`…
	 *
	 * Tercera auditoría, TS3-P1-02. Sin este dato, una salida analógica no se puede simular: un
	 * 50 % no es nada hasta que se sabe entre qué y qué. Si falta, se supone 0-10 V —lo más común
	 * en clima— y el motor lo declara como supuesto, que es distinto de saberlo.
	 */
	rangoSalidaAnalogica?: [number, number];
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
	 * Puntos de paso manuales (mm sobre la placa) para ordenar el cable a mano. Si está vacío, el
	 * cable lo rutea el repartidor.
	 *
	 * LA `z` ES OPCIONAL, Y ESO ES LO QUE PERMITE METER UN CABLE EN UNA CANALETA A MANO.
	 *
	 * Antes el trazado era solo `{x, y}`: el usuario decía por dónde pasaba el cable mirando el
	 * tablero de frente, y la profundidad la elegía el repartidor, la misma para todos los puntos.
	 * Con eso un cable peinado a mano no podía entrar en un ducto ni cambiar de plano en mitad del
	 * recorrido, por mucho que el ruteo automático sí supiera hacerlo. Un punto SIN `z` se comporta
	 * exactamente igual que antes —el repartidor le busca capa—, así que los proyectos guardados
	 * siguen abriéndose y viéndose como estaban.
	 */
	trazado?: { x: number; y: number; z?: number }[];
	/**
	 * A QUÉ PARTE DE LA INSTALACIÓN PERTENECE EL CONDUCTOR.
	 *
	 * En un tablero real no todo el cable es el mismo cable, y la diferencia no es estética: el
	 * cableado interno se tiende rígido y peinado en canaleta, el de puerta va flexible y con
	 * lazo de servicio, el de campo NO se dibuja dentro del armario porque lo trae el instalador
	 * y muere en una bornera, y el de protección tiene su propia identidad —verde-amarillo,
	 * continuidad propia— y no viaja dentro del mazo de mando.
	 *
	 * Es OPCIONAL a propósito. Si falta, `claseDeConductor` la deduce de la naturaleza eléctrica
	 * de los bornes y de dónde están sus dos extremos, que es información que el proyecto ya
	 * tiene; guardarla sirve para el caso en que el usuario quiera decidir el tendido físico. Un
	 * borne declarado PE siempre conserva prioridad: no se puede convertir protección en mando o
	 * campo mediante una preferencia geométrica.
	 */
	clase?: ClaseConductor;
}

/**
 * Las cuatro clases de cable de un tablero. No es una taxonomía normativa: es la distinción
 * mínima que cambia cómo se tiende, cómo se dibuja y quién lo monta.
 */
export type ClaseConductor = 'interno' | 'puerta' | 'campo' | 'proteccion';

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
	/**
	 * SOBRE QUÉ SUPERFICIE VA MONTADO. Por defecto, la placa de montaje del fondo.
	 *
	 * Con `puerta`, `x` e `y` se miden en milímetros desde la esquina SUPERIOR IZQUIERDA de la
	 * hoja vista de frente, igual que en la placa se miden desde la suya. Es el único dato que
	 * distingue un piloto de puerta de uno de placa: el aparato, sus bornes y su comportamiento
	 * eléctrico son exactamente los mismos.
	 */
	montaje?: 'placa' | 'puerta';
}

/**
 * Un rótulo del frontal: una placa grabada, un aviso o una simple leyenda bajo un mando.
 *
 * El texto es un texto, no una imagen: se dibuja con el mismo atlas de serigrafía que ya usan los
 * bornes y los aparatos, así que dos rótulos que digan «MARCHA» comparten celda y no cuesta nada
 * tener cuarenta. Cambiar lo que dice una placa es cambiar esta cadena.
 */
export interface RotuloFrontal {
	id: string;
	/** Lo que dice. Los saltos de línea se respetan; si no los trae, se parte solo por palabras. */
	texto: string;
	/** Posición en mm desde la esquina superior izquierda de la superficie donde va montado. */
	x: number;
	y: number;
	/** Altura de la letra en mm. Una leyenda de mando ronda los 4 mm; un aviso, los 8. */
	alto?: number;
	/**
	 * Cómo está hecho:
	 *  · `grabado` — letras directamente sobre la chapa, sin placa. Lo normal bajo un piloto.
	 *  · `placa`   — placa de plástico atornillada, con su fondo claro. Para identificar circuitos.
	 *  · `aviso`   — placa de seguridad, fondo amarillo y borde negro. Riesgo eléctrico.
	 */
	estilo?: 'grabado' | 'placa' | 'aviso';
	/** Sobre qué superficie va. Hoy solo la puerta; el campo existe para no tener que migrarlo. */
	montaje?: 'puerta';
	/** Ancho máximo en mm antes de partir el texto en varias líneas. */
	ancho?: number;
}

/** Cómo se resuelve el paso de un cable por la chapa. */
export type TipoEntrada = 'prensaestopas' | 'placa-pasacables' | 'conduit';

/**
 * UNA ENTRADA DE CABLE EN LA ENVOLVENTE: el prensaestopas, la placa pasacables o el conduit por
 * donde el cable de campo cruza la chapa. No es un aparato —no tiene bornes ni sale en el
 * esquema— pero sí es material, sí ocupa sitio y sí decide por dónde llega la acometida.
 */
export interface EntradaCable {
	id: string;
	/** En qué cara de la envolvente está. Lo normal, y por eso el valor por defecto, es abajo. */
	cara: 'inferior' | 'superior' | 'izquierda' | 'derecha';
	/**
	 * Posición sobre esa cara, en mm. `x` corre a lo largo de la cara vista de frente y `y` a lo
	 * ancho —en las caras horizontales es la profundidad, en las verticales la altura—.
	 */
	x: number;
	y: number;
	tipo: TipoEntrada;
	/** Diámetro del agujero en la chapa, en mm. */
	diametro?: number;
	/** Rosca del prensaestopas, tal como se pide al proveedor: M16, M20, M25… */
	rosca?: string;
	nombre?: string;
}

/**
 * Lo que el usuario decide sobre el mazo de puerta. Cada campo sustituye a un valor que el
 * programa calcularía solo; ninguno es obligatorio.
 */
export interface AjustesMazo {
	/**
	 * Holgura EXTRA del lazo de servicio, en mm, sobre la que el programa calcula. Positiva da
	 * más panza —más cómodo de montar, peor de ordenar—; negativa la aprieta.
	 */
	holgura?: number;
	/** Cada cuántos mm se amarra el mazo a la chapa de la hoja. Por defecto, 110. */
	pasoSujecion?: number;
	/**
	 * A qué distancia del canto de bisagras entra el mazo en la hoja, en mm. Cuanto más cerca,
	 * menos se entera el cable de que la puerta se abre; por eso el valor propuesto es pequeño.
	 */
	desdeBisagra?: number;
}

export interface Gabinete {
	/** Dimensiones útiles de la placa de montaje, en mm. */
	ancho: number;
	alto: number;
	/**
	 * Caja envolvente (opcional): si falta, se asume placa + margen estándar.
	 *
	 * `bisagras` dice de qué lado abre la puerta mirando el armario de frente. Es una propiedad
	 * del armario, no del dibujo: en un cuadro montado contra una pared o al lado de una puerta,
	 * de qué lado abre lo decide el sitio, y a quien monta le importa.
	 */
	caja?: {
		ancho: number; alto: number; profundidad: number;
		bisagras?: 'izquierda' | 'derecha';
		/**
		 * LA TRENZA DE MASA DE LA HOJA. Une la puerta al cuerpo del armario para que la chapa de
		 * la puerta —que lleva aparatos con tensión detrás— no quede aislada del resto.
		 *
		 * ESTO NO ES UNA DECLARACIÓN DE CONFORMIDAD. TableroStudio es una herramienta de diseño:
		 * marcar la casilla dibuja la trenza, la cuenta en el material y deja constancia de la
		 * intención, y nada más. Que el conjunto cumpla depende del montaje real, de la sección,
		 * del punto de amarre y de la verificación en fábrica, y eso no lo puede firmar un
		 * programa.
		 */
		bonding?: { puesto?: boolean; seccion?: number };
	};
	/**
	 * POR DÓNDE ENTRA EL CABLE DE FUERA. La frontera entre lo que dibuja este programa y lo que
	 * trae el instalador: aquí acaba el cable de campo y empieza el tablero.
	 */
	entradas?: EntradaCable[];
	/**
	 * AJUSTES DEL MAZO DE PUERTA. Todos opcionales, y ésa es la idea: el programa PROPONE un
	 * mazo completo a partir de la geometría del armario, y estos campos son lo que el usuario
	 * DECIDE cambiar. Un campo ausente no es un cero, es «como tú lo veas»; no hay ningún
	 * solver que vuelva a mover lo que la persona ya movió.
	 */
	mazoPuerta?: AjustesMazo;
	/**
	 * SEÑALÉTICA DEL FRONTAL: las placas y los rótulos grabados de la puerta.
	 *
	 * No son aparatos y por eso no viven en `dispositivos`: una placa de «CUIDADO TABLERO
	 * ELÉCTRICO» no tiene bornes, no consume, no sale en el esquema y no debe ensuciar el listado
	 * de materiales eléctricos ni el DRC. Es señalización, y se guarda como lo que es.
	 */
	rotulos?: RotuloFrontal[];
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
	/**
	 * Este tablero es uno de los EJEMPLOS de la biblioteca: se mira, se energiza y se estudia,
	 * pero no se modifica.
	 *
	 * Un ejemplo que se puede editar deja de ser un ejemplo en cuanto alguien borra un cable sin
	 * querer, y no hay forma de recuperarlo. Con la marca puesta, `capturar()` veta toda mutación
	 * —ver `app/main.ts`— y el editor ofrece «Hacer una copia para trabajar», que la quita.
	 */
	esEjemplo?: boolean;
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
