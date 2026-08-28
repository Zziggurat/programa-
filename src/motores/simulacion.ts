/**
 * Simulación del tablero: dar tensión y ver el circuito funcionar.
 *
 * Nace de una frase de quien probó el programa: *«no sé cómo dar play para energizar y ver los
 * circuitos funcionando»*, y de la pregunta que vino detrás: *«¿sabes cómo hacer que dé energía y
 * se prenda una ampolleta o un motor?»*. Esto es eso.
 *
 * POR QUÉ ES UN MOTOR APARTE Y NO UNA AMPLIACIÓN DE `potenciales.ts`
 *
 * El motor de potenciales trata los puentes internos de un aparato como uniones PERMANENTES: para
 * él, los dos lados de un automático son el mismo nudo. Eso está bien y es a propósito —así se
 * propaga la tensión por el esquema y R3 puede detectar un cortocircuito L-N—, pero para simular
 * es justo lo contrario de lo que hace falta: aquí un contacto está abierto o cerrado, y el paso
 * de la corriente DEPENDE de su estado.
 *
 * CÓMO FUNCIONA
 *
 * 1. Se parte de las fuentes: los bornes de la acometida y de los secundarios de fuentes y
 *    transformadores, cada uno con su tensión y su papel (fase o retorno).
 * 2. Con el estado actual de cada aparato se decide qué contactos conducen.
 * 3. Se propaga la tensión por conductores y contactos cerrados: qué bornes quedan vivos.
 * 4. Con eso se recalcula qué bobinas están alimentadas… lo que cambia sus contactos, lo que
 *    cambia la propagación. Así que se REPITE hasta que nada cambia (punto fijo).
 *
 * El paso 4 no es un adorno: es lo que hace que funcione el ENCLAVAMIENTO. En un arranque
 * directo, el contactor se mantiene a través de su propio contacto auxiliar — un lazo de
 * realimentación. Sin iterar, al soltar el pulsador de marcha el motor se pararía, que es
 * precisamente lo que el enclavamiento evita en la realidad.
 *
 * ADEMÁS DE QUÉ FUNCIONA, CUÁNTO CUESTA Y QUÉ SALTA
 *
 * Saber que una lámpara se enciende está bien, pero un tablero se dimensiona con números. Así que
 * la propagación se hace fuente por fuente y guardando de dónde viene cada borne, y con ese árbol
 * salen tres cosas más:
 *
 *  - LA INTENSIDAD de cada rama: la corriente de una carga la lleva entera todo lo que hay entre
 *    ella y la fuente, así que sumando rama a rama se sabe qué pasa por cada cable y por cada
 *    protección, y a qué porcentaje de su calibre va cada una.
 *  - LOS CORTOCIRCUITOS: aquí una carga no une sus dos bornes, así que si desde una fase se llega
 *    al neutro (o a otra fase) es que están unidos sin carga por medio. Eso es una falta, y se
 *    sabe además qué protecciones la ven.
 *  - EL DISPARO: con la corriente y el calibre se lee la curva del aparato y se dice si dispara y
 *    en cuánto tiempo. Cablear mal ahora tiene la consecuencia que tiene en un tablero real.
 *
 * Y los relés pueden ser TEMPORIZADOS, a la conexión o a la desconexión, que es lo que hace falta
 * para una estrella-triángulo o para el arranque escalonado de una UMA.
 *
 * LOS CONTROLADORES EJECUTAN SCANS, no pasadas del punto fijo. La red converge usando la última
 * imagen de salidas publicada; después todos los PLC capturan a la vez sus entradas, ejecutan una
 * vez y publican sus salidas atómicamente. Así un enclavamiento eléctrico puede converger sin que
 * TON, contadores o flancos avancen varias veces en el mismo scan. `plc-runtime.ts` ejecuta la IR
 * tipada V4 y adapta los programas históricos de `logica.ts`.
 *
 * Lo que esto sigue sin ser: no resuelve la red con impedancias, y el programa del controlador es
 * un DSL propio, no IEC 61131-3. El PID es funcional y determinista, pero no incluye un modelo
 * físico del proceso. Las corrientes son las de empleo declaradas, no un cálculo de cortocircuito.
 */
import { Conductor, Dispositivo, Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import {
	ComportamientoSimulacion, EntradaAnalogicaSimulacion, ReferenciaAnalogicaSimulacion,
	TransmisorAnalogicoSimulacion, resolverComportamiento,
} from '../modelo/comportamiento.js';
import {
	CalidadSenalAnalogica, RangoSenalAnalogica, SenalAnalogica, escalarSenalAIngenieria,
	senalDesdeVariableFisica, senalInvalida, valorElectricoDesdeNormalizado,
} from '../modelo/senal-analogica.js';
import type { ConfiguracionProgramaPLC, ImagenEntradasPLC, OrdenesRuntimePLC, RuntimePLC } from '../modelo/programa-plc.js';
import { FalloRuntimeActivo, OrigenMagnitudSimulacion, TipoFalloRuntime, tieneFallo } from './fallos-runtime.js';
import { claveBorne } from '../modelo/proyecto.js';
import { tensionSecundariaDe } from './tensiones.js';
import {
	EsperaLogica, LecturaControlador, MemoriaLogica, ReglaLogica, esperasDe, evaluar, leerPrograma,
	clonarMemoriaLogica, memoriaLogicaVacia, salidasActivas, valoresAnalogicos,
} from './logica.js';
import { compilarProgramaPLC, type IOProgramaPLC, type ProgramaPLCCompilado } from './plc-compilador.js';
import { actualizarRuntimePLC, configLegacyPLC, crearRuntimePLC, esperasLegacyPLC } from './plc-runtime.js';
import { simularFisicaProyecto, type ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import type { FallaFisicaRuntime } from '../fisica/fallas.js';

/** Estado que el usuario controla de cada aparato. */
export interface EstadoAparato {
	/** Protecciones y seccionadores: si está armado (cerrado) o abierto. Por defecto, cerrado. */
	cerrado?: boolean;
	/** Protecciones: disparado por una falta. Un aparato disparado no conduce aunque esté armado. */
	disparado?: boolean;
	/** Pulsadores y sensores: activado ahora mismo (pulsado, detectando). */
	activo?: boolean;
	/** Selectores mantenidos: posición estable, numerada desde 0. */
	posicion?: number;
	/** Variadores y electrónica: fallo activo que inhibe la salida. */
	fallo?: boolean;
	/** Condiciones de ensayo de esta sesión. Nunca se serializan dentro de Proyecto. */
	fallos?: TipoFalloRuntime[];
	/** Fallas electricas cuantitativas V5. Son runtime y nunca se serializan en Proyecto. */
	fallasFisicas?: FallaFisicaRuntime[];
	/** Pulso runtime de reset para equipos con fallo enclavado. */
	resetFallo?: boolean;
	/** Acciones de un solo ciclo; la UI las consume al actualizar el runtime. */
	rearmeSolicitado?: boolean;
	reemplazoFusibleSolicitado?: boolean;
	/** Salidas DIGITALES de un controlador que el usuario fuerza a ON, por su id de borne. */
	salidas?: string[];
	/**
	 * Salidas ANALÓGICAS forzadas a mano, en % de su rango: `{ AO1: 50 }`.
	 *
	 * Tercera auditoría, TS3-P1-02. Antes una AO se forzaba metiéndola en `salidas`, y el motor
	 * la trataba como un contacto: cerraba `AO1`↔`AOC` y el borne salía «vivo, 24 V, papel
	 * retorno». Eso no es una salida 0-10 V: es un binario, y en pantalla daba la impresión de
	 * que el lazo de la válvula estaba bien cuando no se había simulado nada de él.
	 *
	 * Una salida analógica no está encendida ni apagada: está en 3,4 V. Va por su lado.
	 */
	analogicas?: Record<string, number>;
	/** Órdenes, fuerzas y depuración efímeras del PLC. Nunca forman parte de Proyecto. */
	plc?: OrdenesRuntimePLC;
	/**
	 * Lo que marca una sonda analógica: grados, bar, %… Es el número con el que el programa del
	 * controlador compara («UI1 > 24»), y lo mueve quien simula girando el mando de la sonda.
	 */
	valor?: number;
}

export type EstadoTablero = Record<string, EstadoAparato>;

/**
 * MEMORIA DE LOS TEMPORIZADORES entre una simulación y la siguiente.
 *
 * Un temporizador no es una función del estado actual: depende de CUÁNDO cambió la cosa. Aquí se
 * guarda, por relé, el instante en que su bobina pasó a estar alimentada o dejó de estarlo, y con
 * eso y el reloj se decide si ya le tocaba conmutar. Vive fuera del motor —lo lleva quien simula—
 * porque el motor tiene que poder llamarse mil veces sin efectos colaterales.
 */
export interface MemoriaTiempos {
	/** Instante (ms) en que la bobina de cada relé se alimentó por última vez. */
	desdeConectado: Record<string, number>;
	/** Instante (ms) en que dejó de estarlo. */
	desdeSoltado: Record<string, number>;
	/** Relés cuya temporización ya se cumplió: sus contactos están conmutados. */
	cumplidos: string[];
	/** Frecuencia efectiva y último instante confirmado de cada variador. */
	variadores?: Record<string, {
		frecuenciaHz: number; actualizadoEn: number;
		referenciaPorcentaje?: number;
		falloEnclavado?: boolean; runBloqueadoHastaSoltar?: boolean;
		motivoFalla?: EstadoVariador['motivoFalla'];
	}>;
	/** Velocidad mecánica relativa. Es runtime y no modifica datos de placa ni el Proyecto. */
	motores?: Record<string, { velocidadRelativa: number; actualizadoEn: number }>;
	/** Integrador térmico simplificado de protecciones; 0 frío, 1 umbral de disparo. */
	protecciones?: Record<string, { cargaTermica: number; actualizadoEn: number }>;
	/** Posición mecánica de actuadores; runtime temporal, nunca parte del Proyecto. */
	actuadores?: Record<string, { posicion: number; actualizadoEn: number }>;
	/** Memoria por PLC: scan, imagen de proceso, bloques, RETAIN de sesión, alarmas y fuerzas. */
	controladores?: Record<string, RuntimePLC>;
}

export function memoriaVacia(): MemoriaTiempos {
	return {
		desdeConectado: {}, desdeSoltado: {}, cumplidos: [], variadores: {}, motores: {}, protecciones: {}, actuadores: {}, controladores: {},
	};
}

export interface EstadoVariador {
	dispositivoId: string;
	designacion: string;
	estado: 'sin-alimentacion' | 'listo' | 'marcha' | 'decel' | 'falla';
	alimentado: boolean;
	falloEnclavado: boolean;
	resetPermitido: boolean;
	runBloqueadoHastaSoltar: boolean;
	motivoFalla?: 'fallo-externo' | 'perdida-fase' | 'subtension' | 'sobrecarga' | 'fallo-declarado'
		| 'perdida-referencia';
	run: boolean;
	habilitado: boolean;
	referenciaPorcentaje: number;
	calidadReferencia: CalidadSenalAnalogica;
	referenciaElectrica?: SenalAnalogica;
	frecuenciaNominalHz: number;
	frecuenciaObjetivoHz: number;
	frecuenciaHz: number;
}

/**
 * Estado funcional mínimo de un motor durante una sesión de simulación.
 *
 * La corriente y la duración de arranque son estimaciones genéricas, no datos de placa ni un
 * modelo electromecánico. El runtime vive en `MemoriaTiempos`; nunca se persiste en `Proyecto`.
 */
export interface EstadoMotor {
	dispositivoId: string;
	designacion: string;
	estado: 'detenido' | 'arrancando' | 'marcha' | 'desacelerando' | 'falla';
	alimentado: boolean;
	/** Fases distintas exigidas por el perfil funcional, no por la carcasa ni por `tipo`. */
	fasesRequeridas: 1 | 3;
	/** Orígenes de fase distintos que llegan ahora a los bornes declarados por el perfil. */
	fasesPresentes: number;
	/** Tensión efectiva calculada por la misma regla que alimenta los diagnósticos del tablero. */
	tensionRecibidaV?: number;
	/** Tensión de placa persistida; si falta, el simulador no inventa una validación. */
	tensionNominalV?: number;
	/** Ausente cuando no hay tensión de placa o todavía no puede medirse la alimentación. */
	tensionCorrecta?: boolean;
	/** Fracción 0..1 de la duración estimada de arranque. */
	progresoArranque: number;
	/** Frecuencia eléctrica que manda sobre el motor; calculada de red o de la salida VFD. */
	frecuenciaElectricaHz: number;
	/** Velocidad mecánica 0..1 respecto de la frecuencia nominal del proyecto/perfil. */
	velocidadObjetivo: number;
	velocidadActual: number;
	velocidadPorcentaje: number;
	/** Solo existe si el perfil declara polos magnéticos. */
	rpmSincronas?: number;
	rpmEstimada?: number;
	rpmOrigen: OrigenMagnitudSimulacion | 'no-disponible';
	/** Corriente nominal declarada o estimada para el aparato. */
	corrienteNominalA: number;
	/** True cuando faltó corriente de placa y se usó el supuesto genérico del perfil de motor. */
	corrienteNominalEstimada: boolean;
	/** Corriente funcional usada para describir este estado; la punta sigue siendo estimada. */
	corrienteEstimadaA: number;
	/** Duración genérica estimada del transitorio de arranque. */
	duracionArranqueEstimadaS: number;
	/** Solo existe para un fallo runtime explícito; no se deduce silenciosamente de una etiqueta. */
	motivoFalla?: 'fallo-declarado' | 'disparo-declarado' | 'perdida-fase' | 'subtension'
		| 'sobretension' | 'sobrecarga' | 'motor-bloqueado';
}

export interface EstadoProteccion {
	dispositivoId: string;
	designacion: string;
	funcion: 'termico' | 'termomagnetico' | 'fusible' | 'diferencial' | 'seccionamiento' | 'no-declarada';
	estado: 'abierto' | 'cerrado' | 'calentando' | 'disparado' | 'fundido';
	rearmable: boolean;
	cargaTermica: number;
	causa?: 'sobrecarga' | 'cortocircuito' | 'perdida-fase' | 'fuga-tierra' | 'manual';
	origen?: OrigenMagnitudSimulacion;
}

export interface EstadoSensorAnalogico {
	dispositivoId: string;
	designacion: string;
	modoConexion: '2-hilos' | '3-hilos';
	variable: { magnitud: string; unidad: string; valor: number };
	senal: SenalAnalogica;
}

export interface EstadoEntradaAnalogica {
	dispositivoId: string;
	designacion: string;
	borne: string;
	senal: SenalAnalogica;
	valorIngenieria?: number;
	magnitud: string;
	unidad: string;
}

export interface EstadoActuador {
	dispositivoId: string;
	designacion: string;
	tipo: 'on-off' | 'modulante';
	estado: 'cerrada' | 'abriendo' | 'abierta' | 'cerrando' | 'detenida' | 'falla';
	posicionObjetivo: number;
	posicionActual: number;
	calidadMando: CalidadSenalAnalogica;
	feedback?: SenalAnalogica;
}

/** Lo que hay que saber de un temporizador para enseñarlo: cuánto lleva y cuánto le falta. */
export interface CuentaAtras {
	dispositivoId: string;
	designacion: string;
	tipo: 'trabajo' | 'reposo';
	/** Segundos que faltan para que conmute. 0 si ya conmutó. */
	restan: number;
	total: number;
	/** True si está contando ahora mismo. */
	contando: boolean;
}

export interface BorneVivo {
	/** Tensión respecto al retorno de su circuito, en V. */
	tension: number;
	/** Si es el lado activo (fase, +V) o el de retorno (neutro, 0 V). */
	papel: 'fase' | 'retorno';
	/**
	 * De qué borne de origen viene la tensión ("red::L2"), no solo si es fase o retorno.
	 *
	 * Hace falta para dos cosas distintas: saber si a un motor trifásico le llegan TRES fases
	 * distintas —si le llegara la misma por los tres bornes no giraría, y con `papel` a secas no
	 * se ve la diferencia— y poder decir de qué fase cuelga cada carga monofásica, que es la base
	 * del equilibrado de fases.
	 */
	fuente: string;
	/** True si viene de un sistema trifásico: entonces `tension` es la compuesta. */
	trifasica: boolean;
}

/** Lo que consume una carga cuando está funcionando, y de qué fase cuelga. */
export interface Consumo {
	dispositivoId: string;
	designacion: string;
	/** Intensidad de empleo, en A. */
	corriente: number;
	/** Bornes de fase por los que entra (para repartir la corriente entre las fases). */
	fases: string[];
}

/** Un cortocircuito detectado: dos potenciales distintos unidos sin carga por medio. */
export interface Cortocircuito {
	/** Clave del borne donde se tocan. */
	clave: string;
	/** Descripción legible: «fase L1 con el neutro», «fase L1 con fase L2». */
	que: string;
	/** Protecciones que ven la falta, de la más cercana a la más lejana. */
	proteccionesAguasArriba: string[];
}

/** Una protección que ha disparado en esta simulación, y por qué. */
export interface Disparo {
	dispositivoId: string;
	designacion: string;
	motivo: 'cortocircuito' | 'sobrecarga';
	/** Corriente que la hizo disparar, en A. */
	corriente: number;
	/** Calibre del aparato, en A. */
	nominal: number;
	/** Tiempo estimado de disparo según su curva, en segundos. */
	segundos: number;
	/** False en un fusible: hace falta sustituirlo, no pulsar rearme. */
	rearmable: boolean;
	explicacion: string;
}

/** Carga que soporta un aparato de corte: cuánto pasa por él y cuánto aguanta. */
export interface CargaAparato {
	dispositivoId: string;
	designacion: string;
	corriente: number;
	nominal?: number;
	/** Porcentaje del calibre. Por encima de 100 está sobrecargado. */
	porcentaje?: number;
}

export interface ResultadoSimulacion {
	/** Bornes con tensión, por clave "dispositivo::borne". */
	vivos: Map<string, BorneVivo>;
	/** Conductores que están llevando tensión, por id. */
	conductoresVivos: Set<string>;
	/** Aparatos que están HACIENDO algo: bobina metida, lámpara encendida, motor girando. */
	activos: Set<string>;
	/** Qué se ve funcionando, en palabras, para contárselo al usuario. */
	funcionando: { dispositivoId: string; designacion: string; que: string }[];
	/** Por qué algo NO funciona, cuando se puede decir. */
	avisos: string[];
	/** Nº de pasadas hasta estabilizarse. Si llega al tope, el circuito oscila. */
	pasadas: number;
	/** True si el circuito no llegó a un estado estable (p. ej. un relé que se autoexcita y corta). */
	oscila: boolean;
	/**
	 * Hay tensión y el tablero está sano, pero todavía nadie ha accionado nada.
	 *
	 * NO es una avería: es el estado normal justo después de energizar, igual que un tablero de
	 * verdad con el automático subido y el motor parado. Va como bandera y no solo como texto
	 * porque hay que poder distinguirlo de una avería SIN leer la frase: la prueba de los ejemplos
	 * filtraba por las palabras del aviso y, al reescribirlo, cantó siete averías donde no había
	 * ninguna. Un dato que se mira no se puede quedar desfasado; una frase, sí.
	 */
	sinAccionar: boolean;

	/* --------- Lo que consume el tablero de verdad --------- */
	/** Cargas en marcha con su intensidad. */
	consumos: Consumo[];
	/** Intensidad que lleva cada conductor, en A. */
	corrientePorConductor: Map<string, number>;
	/** Intensidad que atraviesa cada aparato de corte, con su calibre. */
	cargaPorAparato: Map<string, CargaAparato>;
	/** Intensidad total que entra por la acometida, en A. */
	corrienteTotal: number;
	/** Cortocircuitos vistos en el circuito tal como está cableado. */
	cortocircuitos: Cortocircuito[];
	/** Protecciones que disparan por esta situación. */
	disparos: Disparo[];
	/**
	 * Lo que marca cada SALIDA ANALÓGICA del programa de un controlador, por «aparato::borne».
	 *
	 * Va aparte de `activos` porque una salida analógica no está encendida ni apagada: está en
	 * 3,4 V. Meterla entre las encendidas obligaría a quien lo lea a adivinar si un cero quiere
	 * decir «apagada» o «abierta el 0 %», que no es lo mismo delante de una válvula.
	 */
	analogicas: Map<string, number>;
	/**
	 * Lo mismo, en VOLTIOS y contra su común: `{ voltios: 5, referencia: 'AOC' }`.
	 *
	 * Tercera auditoría, TS3-P1-02. `analogicas` guarda el valor lógico que calcula el programa
	 * —un 50 %—, y eso no se puede enseñar como si fuera el estado de un hilo. Esto es lo que de
	 * verdad hay en el borne, que es lo que se mide con un multímetro en la obra.
	 */
	salidasAnalogicas: Map<string, {
		valor: number; unidad: 'V' | 'mA'; voltios?: number;
		referencia?: string; rango: [number, number]; supuesto: boolean; senal: SenalAnalogica;
	}>;
	/** Temporizadores contando ahora mismo, para poder enseñar la cuenta atrás. */
	temporizadores: CuentaAtras[];
	/** Consumos que están recibiendo una tensión distinta de la suya. */
	tensionesEquivocadas: TensionEquivocada[];
	/** Punta de arranque de los motores en marcha y si la protección la aguanta. */
	arranques: Arranque[];
	/** Lo que están haciendo los controladores programados del tablero. */
	controladores: EstadoControlador[];
	/** Estado funcional de cada variador con perfil ejecutable. */
	variadores: EstadoVariador[];
	/** Estado contractual de las cargas cuyo perfil declara efecto de giro. */
	motores: EstadoMotor[];
	/** Estado mecánico/térmico de cada protección ejecutable. */
	protecciones: EstadoProteccion[];
	/** Fallos activos, con procedencia explícita. */
	fallos: (FalloRuntimeActivo & { dispositivoId: string; designacion: string })[];
	/** Posición 0..100 de cargas modulantes, por id de aparato. */
	posicionesCargas: Map<string, number>;
	/** Cadena física→eléctrica de transmisores con perfil V3. */
	sensoresAnalogicos: EstadoSensorAnalogico[];
	/** Lecturas AI brutas, escaladas y con calidad. */
	entradasAnalogicas: EstadoEntradaAnalogica[];
	/** Estado mecánico de válvulas/actuadores V3. */
	actuadores: EstadoActuador[];
	/** Capa cuantitativa V5 derivada de la misma topologia funcional. */
	fisica: ResultadoFisicaElectrica;
}

/** Lo que hace un controlador con su programa: qué lee, qué enciende y qué está esperando. */
export interface EstadoControlador {
	dispositivoId: string;
	designacion: string;
	/** Nº de renglones del programa que se han podido leer. */
	reglas: number;
	/** Entradas con tensión ahora mismo. */
	entradas: string[];
	/** Valor de cada sonda cableada, por borne. */
	sondas: Record<string, number>;
	/** AI con señal bruta, escalado y calidad; las inválidas no entran en `sondas`. */
	entradasAnalogicas: EstadoEntradaAnalogica[];
	/** Salidas que el programa tiene encendidas. */
	salidas: string[];
	/** Salidas esperando su retardo o sostenidas por su tiempo mínimo. */
	esperas: EsperaLogica[];
	/** Renglones que no se han podido leer, con su explicación. */
	errores: string[];
	/** Renglón a renglón: qué pide cada uno y si se está cumpliendo AHORA. */
	renglones: RenglonEnMarcha[];
	/** Estado del runtime V4; el visual no mantiene una segunda verdad. */
	estado: RuntimePLC['estado'];
	pausado: boolean;
	scan: number;
	periodoScanMs: number;
	primerScan: boolean;
	duracionUltimoScanMs: number;
	variables: Record<string, boolean | number>;
	salidasAnalogicas: Record<string, number>;
	temporizadores: RuntimePLC['temporizadores'];
	contadores: RuntimePLC['contadores'];
	secuencias: RuntimePLC['secuencias'];
	detalleSecuencias: RuntimePLC['detalleSecuencias'];
	alarmas: RuntimePLC['alarmas'];
	interlocks: RuntimePLC['interlocks'];
	diagnosticos: RuntimePLC['diagnosticos'];
	/** Watch table tipada: alias lógico, canal físico, valor, calidad y fuerza proceden del runtime. */
	tags: EstadoTagPLC[];
	pids: RuntimePLC['pids'];
	forzadas: string[];
	eventos: RuntimePLC['eventos'];
	io: IOProgramaPLC;
}

export interface EstadoTagPLC {
	nombre: string;
	tipo: 'BOOL' | 'REAL';
	clase: 'DI' | 'DO' | 'AI' | 'AO' | 'MEM';
	borne?: string;
	valor: boolean | number;
	calidad?: CalidadSenalAnalogica;
	origen?: string;
	forzada: boolean;
}

/**
 * Un renglón del programa visto en marcha.
 *
 * Es la respuesta a la única pregunta que se hace de verdad delante de un tablero que no arranca:
 * «¿por qué no entra DO1?». Con `pide` se ve si la CONDICIÓN se cumple, y con `encendida` si la
 * salida está de verdad dada — y cuando no coinciden, la culpa es de un tiempo, que sale en
 * `esperas`. Sin esto había que deducirlo mirando entradas sueltas.
 */
export interface RenglonEnMarcha {
	salida: string;
	/** El renglón tal como está escrito, para poder señalarlo en la ficha. */
	fuente: string;
	/** True si la condición se cumple en este instante. */
	pide: boolean;
	/** True si la salida está encendida (puede diferir de `pide`: retardo o tiempo mínimo). */
	encendida: boolean;
}

/** Una carga alimentada a una tensión que no es la suya. */
export interface TensionEquivocada {
	dispositivoId: string;
	designacion: string;
	/** Tensión que le está llegando, en V. */
	recibe: number;
	/** Tensión para la que está hecha, en V. */
	suya: number;
	que: string;
}

/**
 * La PUNTA DE ARRANQUE de un motor: los primeros segundos, un motor de jaula pide del orden de
 * seis veces su corriente nominal. No es un detalle académico: es lo que decide si el automático
 * salta cada vez que arranca la máquina, que es la avería más común y la más molesta de buscar.
 */
export interface Arranque {
	dispositivoId: string;
	designacion: string;
	/** Corriente nominal del motor, en A. */
	nominal: number;
	/** Punta estimada al arrancar EN DIRECTO, en A. */
	punta: number;
	/** Veces la nominal. Es la del arranque directo: con estrella-triángulo o arrancador es menor. */
	veces: number;
	/** Duración genérica estimada durante la que se considera la punta. */
	duracionEstimadaS: number;
	/** Protecciones que ven esa punta y qué hacen con ella. */
	protecciones: { designacion: string; calibre: number; disparaEnS?: number }[];
	/** True si alguna protección dispararía durante el arranque. */
	saltaAlArrancar: boolean;
}

/** Aparatos cuyos puentes internos son CONTACTOS y por tanto dependen de su estado. */
const CONMUTA: Set<TipoDispositivo> = new Set([
	'disyuntor', 'diferencial', 'seccionador', 'guardamotor', 'fusible', 'contactor', 'rele',
]);

/** Un aparato que consume y por tanto «se ve» funcionando. */
const CONSUME: Set<TipoDispositivo> = new Set([
	'motor', 'valvula', 'resistencia', 'piloto', 'condensador',
]);

/**
 * Capacidades de corte que todavía no están discriminadas dentro del perfil `proteccion`.
 * El perfil decide primero; el tipo solo separa las excepciones honestas que el contrato v1 aún
 * agrupa: un seccionador no dispara y un diferencial v1 no calcula sobrecorriente ni residual.
 */
function protegeSobrecorriente(d: Dispositivo): boolean {
	return resolverComportamiento(d)?.clase === 'proteccion'
		&& d.tipo !== 'seccionador' && d.tipo !== 'diferencial';
}

function protegeCortocircuito(d: Dispositivo): boolean {
	return protegeSobrecorriente(d) && d.tipo !== 'rele';
}

const MAX_PASADAS = 24;

/**
 * Veces la corriente nominal que pide un motor de jaula al arrancar en directo, y cuánto dura.
 *
 * Seis veces es el orden de magnitud de un motor asíncrono normal (IEC 60034 da entre 5 y 8 según
 * la clase de arranque); tres segundos es lo que tarda en coger vueltas una carga corriente. No
 * son los de un motor concreto —eso está en su placa— pero sí los que hacen ver el problema.
 */
const VECES_ARRANQUE = 6;
/** Sobrecarga severa inyectada para ensayo; no es una corriente calculada ni un dato de placa. */
const VECES_SOBRECARGA_INYECTADA = 4;
const SEGUNDOS_ARRANQUE = 3;
const SEGUNDOS_PARADA = 2;
const TOLERANCIA_TENSION = 0.1;

/**
 * Tensión que le está llegando de verdad a un consumo.
 *
 * Entre fase y retorno es la de la fuente. Entre DOS O MÁS FASES distintas es la compuesta, que
 * es √3 veces la de fase: un motor al que le falta una fase sigue teniendo 380 V entre las otras
 * dos, aunque no cumpla sus tres fases requeridas. Confundir ambos diagnósticos ocultaría justo la
 * pérdida de fase que hay que enseñar.
 */
function tensionDeEmpleo(d: Dispositivo, vivos: Map<string, BorneVivo>): number | undefined {
	const perfil = resolverComportamiento(d);
	const bornesAlimentacion = perfil?.clase === 'carga'
		? new Set([...perfil.alimentacion.fases, ...perfil.alimentacion.retornos]) : undefined;
	const conTension = d.bornes
		.filter((b) => b.tipo !== 'PE' && (!bornesAlimentacion || bornesAlimentacion.has(b.id)))
		.map((b) => vivos.get(`${d.id}::${b.id}`))
		.filter((v): v is BorneVivo => !!v);
	if (conTension.length === 0) return undefined;
	const fases = conTension.filter((v) => v.papel === 'fase');
	if (fases.length === 0) return undefined;
	const distintas = new Set(fases.map((v) => v.fuente));
	const sistema = Math.max(...fases.map((v) => v.tension));
	// Entre dos o más fases se trabaja a la tensión COMPUESTA, que es la declarada del sistema.
	if (distintas.size >= 2) return sistema;
	// Entre una fase y el neutro de una red trifásica se trabaja a la SIMPLE: 380/√3 = 220. Por
	// eso el circuito de mando de 220 V de un tablero trifásico está bien, y decir lo contrario
	// sería mandar a alguien a revisar un cableado impecable.
	if (fases[0].trifasica) return Math.round(sistema / Math.sqrt(3));
	return sistema;
}

/* --------------------------- Contactos de cada aparato --------------------------- */

/**
 * Pares de bornes que conducen entre sí AHORA, según el tipo de aparato y su estado.
 *
 * La numeración IEC 60947-5-1 lleva la información dentro: el segundo dígito de un contacto
 * auxiliar dice si es abierto o cerrado en reposo (…1-…2 es NC, …3-…4 es NA), y 95-96 es el
 * contacto de alarma de un relé térmico. Leerlo de ahí permite simular todo el catálogo sin
 * declarar los contactos aparato por aparato, que es como lo lee un electricista en el esquema.
 */
export function contactosCerrados(d: Dispositivo, estado: EstadoAparato, bobinaMetida: boolean): [string, string][] {
	const pares: [string, string][] = [];
	const idsBornes = new Set(d.bornes.map((b) => b.id));
	const comportamiento = resolverComportamiento(d);

	// Un perfil explícito no depende ni de la carcasa 3D ni de la serigrafía. Este camino también
	// recibe a los contactores legacy a través del adaptador IEC de `resolverComportamiento`.
	if (comportamiento?.clase === 'contactos-electromagneticos') {
		if (bobinaMetida) {
			for (const p of comportamiento.polos) pares.push([p.entrada, p.salida]);
		}
		for (const c of comportamiento.contactos) {
			const cerrado = c.reposo === 'cerrado' ? !bobinaMetida : bobinaMetida;
			if (cerrado) pares.push([c.entrada, c.salida]);
		}
		return pares;
	}
	if (comportamiento?.clase === 'mando' && d.rol?.tipo === 'esclavo') {
		for (const c of comportamiento.contactos) {
			const cerrado = c.reposo === 'cerrado' ? !bobinaMetida : bobinaMetida;
			if (cerrado) pares.push([c.entrada, c.salida]);
		}
		return pares;
	}
	if (comportamiento?.clase === 'mando') {
		const posicionPedida = estado.posicion ?? (estado.activo === true ? 1 : comportamiento.reposo);
		const posicion = Math.max(0, Math.min(comportamiento.posiciones - 1, Math.trunc(posicionPedida)));
		const accionado = posicion !== comportamiento.reposo;
		for (const c of comportamiento.contactos) {
			const cerrado = c.cerradoEn
				? c.cerradoEn.includes(posicion)
				: (c.reposo === 'cerrado' ? !accionado : accionado);
			if (cerrado) pares.push([c.entrada, c.salida]);
		}
		return pares;
	}
	if (comportamiento?.clase === 'proteccion') {
		const accionada = estado.cerrado === false || estado.disparado === true;
		if (!accionada) {
			for (const p of comportamiento.polos) pares.push([p.entrada, p.salida]);
		}
		for (const c of comportamiento.contactos) {
			const cerrado = c.reposo === 'cerrado' ? !accionada : accionada;
			if (cerrado) pares.push([c.entrada, c.salida]);
		}
		return pares;
	}
	if (comportamiento?.clase === 'sensor') {
		const activo = estado.activo === true;
		for (const c of comportamiento.contactos) {
			const cerrado = c.reposo === 'cerrado' ? !activo : activo;
			if (cerrado) pares.push([c.entrada, c.salida]);
		}
		if (activo && comportamiento.salidaDigital) {
			pares.push([comportamiento.salidaDigital.tomaDe, comportamiento.salidaDigital.borne]);
		}
		return pares;
	}
	if (comportamiento?.clase === 'pasivo') {
		return comportamiento.conexiones.map((p) => [p.entrada, p.salida]);
	}
	if (comportamiento?.clase === 'sin-comportamiento') return pares;

	if (CONMUTA.has(d.tipo)) {
		// Un relé TÉRMICO se declara como «rele» pero no se parece en nada a un relé auxiliar: no
		// tiene bobina, va intercalado en la potencia del motor y sus polos conducen siempre salvo
		// que haya disparado. Lo que conmuta es su contacto de alarma 95-96. Se distingue por tener
		// el 95 y no tener bobina. Tratarlo como un relé con bobina dejaba el motor sin tensión.
		const esTermico = d.tipo === 'rele' && idsBornes.has('95') && !idsBornes.has('A1');
		// Protecciones y seccionadores: sus polos conducen si el aparato está armado y no ha
		// disparado. `cerrado` sin declarar cuenta como armado: un tablero recién energizado tiene
		// sus protecciones subidas.
		const esProteccion = esTermico || (d.tipo !== 'contactor' && d.tipo !== 'rele');
		const conduce = esProteccion
			? estado.cerrado !== false && !estado.disparado
			: bobinaMetida;
		if (conduce) {
			for (const [a, b] of polosDe(d)) pares.push([a, b]);
		}
		// Contactos auxiliares: NA cierra al activarse, NC abre al activarse. En un térmico lo que
		// «activa» los auxiliares es el disparo, no una bobina.
		const activado = esTermico ? estado.disparado === true : (esProteccion ? false : bobinaMetida);
		for (const par of contactosAuxiliaresIEC(d)) {
			if (par.tipo === 'NA' ? activado : !activado) pares.push([par.comun, par.salida]);
		}
		// El contacto de alarma de un relé térmico: NC que se abre cuando el térmico dispara.
		if (idsBornes.has('95') && idsBornes.has('96') && !estado.disparado) pares.push(['95', '96']);
		if (idsBornes.has('97') && idsBornes.has('98') && estado.disparado) pares.push(['97', '98']);
		return pares;
	}

	// Pulsadores, selectores y sensores: contactos secos que el usuario acciona.
	if (d.tipo === 'pulsador' || d.tipo === 'selector' || d.tipo === 'sensor') {
		const activado = estado.activo === true;
		const iec = contactosAuxiliaresIEC(d);
		for (const par of iec) {
			if (par.tipo === 'NA' ? activado : !activado) pares.push([par.comun, par.salida]);
		}
		// Un contacto de campo se declara muchas veces con sus bornes numerados a secas —una boya,
		// un presostato, un final de carrera: bornes «1» y «2»— y entonces no hay numeración IEC de
		// la que sacar si es abierto o cerrado. Se toma como ABIERTO en reposo, que es lo que es un
		// contacto de campo salvo que se diga lo contrario. Para un NC, númbralo 11-12 como en el
		// catálogo y se respeta.
		if (iec.length === 0 && activado) {
			for (const [a, b] of polosDe(d)) pares.push([a, b]);
		}
		// Un detector de tres hilos no es un contacto: entrega tensión por su salida cuando
		// detecta, tomándola de su propia alimentación.
		const alim = d.bornes.find((b) => b.id === '+24' || b.id === '+')?.id;
		const senal = d.bornes.find((b) => b.tipo === 'senal')?.id;
		if (alim && senal && activado) pares.push([alim, senal]);
		return pares;
	}

	// Todo lo demás (borneros, fuentes, transformadores, controladores, consumos) pasa por sus
	// puentes internos tal cual: son uniones de verdad, no contactos.
	for (const [a, b] of d.puentesInternos ?? []) pares.push([a, b]);
	// Un controlador cierra las salidas que pide su PROGRAMA, más las que el usuario fuerce a
	// mano. `salidas` llega ya resuelta: la calcula el motor en cada pasada de la simulación.
	if (comportamiento?.clase === 'controlador' && estado.salidas?.length) {
		for (const s of estado.salidas) {
			if (!idsBornes.has(s)) continue;
			/*
			 * UNA SALIDA ANALÓGICA NO ES UN CONTACTO. Tercera auditoría, TS3-P1-02.
			 *
			 * Este mismo mecanismo cerraba `AO1`↔`AOC` y dejaba la AO «viva a 24 V»: el mando de
			 * una válvula proporcional presentado como un hilo binario. Lo comprobó la auditoría:
			 * `AO1 = {tension:24, papel:"retorno", fuente:"g1::0V"}`.
			 *
			 * Las analógicas van por `estado.analogicas`, en % de su rango, y salen del motor como
			 * voltios contra su común — no como tensión de red propagada por el circuito.
			 */
			if (esSalidaAnalogicaDe(d, s)) continue;
			const comun = comunDeSalida(d, s, idsBornes);
			if (comun) pares.push([comun, s]);
		}
	}
	return pares;
}

/**
 * Contra qué borne cierra una salida de controlador.
 *
 * Una salida de un DDC no cierra contra la alimentación del aparato: cierra contra **el común de
 * su bloque**. En un Excel, el triac de `DO1` está entre `DOC` y `DO1`, y el 0-10 V de `AO1` se
 * mide contra `AOC`. Eran terminales distintos y el programa buscaba uno solo:
 *
 * ```ts
 * const comun = d.bornes.find((b) => b.id === '+24' || b.id === '+V')?.id;
 * ```
 *
 * El controlador que arma el puente desde la Planta se llama `24V~` / `24V COM` —como se rotula
 * un DDC de verdad—, así que ese `find` no encontraba nada y NINGUNA salida cerraba: forzando
 * `DO1` y `AO1` quedaban vivos los dos bornes de alimentación y cero bornas del bornero y cero
 * puntos de campo. El tablero parecía energizado y su circuito funcional no operaba.
 *
 * Se busca por FAMILIA —`DO1`→`DOC`, `AO3`→`AOC`, `UI2`→`UIC`—, que es el modelo real, y solo si
 * el aparato no declara común de bloque se recurre al de antes, que es como está descrito el
 * LOGO! del catálogo: sus relés van comunados a `+24` por dentro.
 */
/**
 * ¿Este borne es una salida ANALÓGICA? Por el rótulo, que es como se llaman en todos los DDC.
 *
 * `AO1`, `AO2`… (analog output) y `Y1`, `Y2`… (la nomenclatura de válvula de Honeywell). Lo que no
 * es analógico —`DO`, `Q`— sigue siendo un contacto y se comporta como tal.
 */
export function esSalidaAnalogica(borne: string): boolean {
	return /^(AO|Y)\d+$/.test(borne);
}

/** El perfil explícito manda; la regex queda únicamente como compatibilidad de proyectos legacy. */
function esSalidaAnalogicaDe(d: Dispositivo, borne: string): boolean {
	const c = resolverComportamiento(d);
	if (c?.clase === 'controlador') return c.salidasAnalogicas.some((s) => s.borne === borne);
	return esSalidaAnalogica(borne);
}

/** Rango de una salida analógica, en voltios, si el aparato no declara otro. */
export const RANGO_AO_POR_DEFECTO: [number, number] = [0, 10];

/**
 * Lo que ENTREGA una salida analógica: su valor en voltios y contra qué borne se mide.
 *
 * Es lo que faltaba. Un 0-10 V no es «vivo» ni «muerto»: son 0, 5 o 10 voltios respecto de su
 * común, y sin decir respecto de qué, el número no significa nada. `rangoSalidaAnalogica` deja
 * declararlo por aparato —hay DDC de 2-10 V y de 4-20 mA—; sin declarar, se supone 0-10 V, que
 * es lo más común en clima, y se dice que se ha supuesto.
 */
export function salidaAnalogicaEn(
	d: Dispositivo, borne: string, porcentaje: number,
): { valor: number; unidad: 'V' | 'mA'; voltios?: number; referencia: string | undefined;
	rango: [number, number]; supuesto: boolean; senal: SenalAnalogica } {
	const declarado = d.rangoSalidaAnalogica;
	const perfil = resolverComportamiento(d);
	const salida = perfil?.clase === 'controlador'
		? perfil.salidasAnalogicas.find((s) => s.borne === borne) : undefined;
	const rango = salida?.rango ?? declarado ?? RANGO_AO_POR_DEFECTO;
	const unidad = salida?.unidad ?? 'V';
	const pct = Math.max(0, Math.min(100, porcentaje));
	const valor = Math.round((rango[0] + (rango[1] - rango[0]) * (pct / 100)) * 100) / 100;
	const idsBornes = new Set(d.bornes.map((b) => b.id));
	return {
		valor, unidad, ...(unidad === 'V' ? { voltios: valor } : {}),
		referencia: salida?.referencia ?? comunDeSalida(d, borne, idsBornes),
		rango,
		supuesto: !salida && !declarado,
		senal: {
			tipo: unidad === 'V' ? 'tension' : 'corriente', unidadElectrica: unidad,
			valorElectrico: valor, valorNormalizado: pct / 100,
			calidad: 'normal', origen: !salida && !declarado ? 'estimado' : 'calculado',
		},
	};
}

function comunDeSalida(d: Dispositivo, salida: string, idsBornes: Set<string>): string | undefined {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase === 'controlador') {
		return perfil.salidasDigitales.find((s) => s.borne === salida)?.comun
			?? perfil.salidasAnalogicas.find((s) => s.borne === salida)?.referencia;
	}
	const familia = `${salida.replace(/\d+$/, '')}C`;
	if (familia !== salida && idsBornes.has(familia)) return familia;
	return d.bornes.find((b) => b.id === '+24' || b.id === '+V')?.id;
}

interface ContactoIEC { comun: string; salida: string; tipo: 'NA' | 'NC' }

/**
 * Contactos auxiliares deducidos de la numeración IEC.
 *
 * El segundo dígito dice la función: 1 y 2 son el cerrado en reposo (NC), 3 y 4 el abierto (NA).
 * El primero es el número de contacto. Con eso salen los tres casos que existen de verdad:
 *
 *   11-12            un NC suelto
 *   13-14            un NA suelto
 *   11-12-14         un CONMUTADO: 11 es el común, 12 el NC y 14 el NA (los relés enchufables)
 *   11-12 + 13-14    dos contactos independientes, uno NC y otro NA
 *
 * La diferencia entre los dos últimos está en si existe el 13: si está, el 13-14 es su propio
 * contacto; si no está y hay un 14, ese 14 comparte común con el 11 y es un conmutado.
 */
export function contactosAuxiliaresIEC(d: Dispositivo): ContactoIEC[] {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase === 'contactos-electromagneticos' || perfil?.clase === 'proteccion'
		|| perfil?.clase === 'mando' || perfil?.clase === 'sensor') {
		return perfil.contactos.map((c) => ({
			comun: c.entrada, salida: c.salida, tipo: c.reposo === 'abierto' ? 'NA' : 'NC',
		}));
	}
	const salida: ContactoIEC[] = [];
	const ids = new Set(d.bornes.map((b) => b.id));
	for (let g = 1; g <= 9; g++) {
		const comun = `${g}1`;
		const nc = `${g}2`;
		const naComun = `${g}3`;
		const na = `${g}4`;
		if (ids.has(comun) && ids.has(nc)) salida.push({ comun, salida: nc, tipo: 'NC' });
		if (ids.has(naComun) && ids.has(na)) {
			salida.push({ comun: naComun, salida: na, tipo: 'NA' });
		} else if (ids.has(na) && ids.has(comun)) {
			// Conmutado: el NA cuelga del mismo común que el NC.
			salida.push({ comun, salida: na, tipo: 'NA' });
		}
	}
	return salida;
}

/**
 * Polos de potencia de un aparato de corte.
 *
 * Si el aparato los declara (`puentesInternos`), se usan. Pero la mayoría del catálogo no lo hace
 * —un automático se describe con sus bornes 1, 2, 3, 4 y ya— y sin esto no conduciría nada: el
 * tablero se quedaría muerto al energizar. Se deducen entonces de la convención de siempre:
 * impares arriba, pares abajo, y cada polo es la pareja consecutiva (1-2, 3-4, 5-6).
 *
 * Con un tope: en IEC 60947-1 los polos de potencia llegan hasta el 7-8 (cuatro polos). Del 11 en
 * adelante son BLOQUES AUXILIARES —11-12 es un NC, 13-14 un NA—, y tomarlos por polos ponía a un
 * relé auxiliar a conducir por su contacto de reposo justo cuando la bobina estaba metida, o sea
 * al revés de como funciona. Por eso se descarta todo borne que ya sea un contacto IEC.
 */
export function polosDe(d: Dispositivo): [string, string][] {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase === 'contactos-electromagneticos' || perfil?.clase === 'proteccion') {
		return perfil.polos.map((p) => [p.entrada, p.salida]);
	}
	if (d.puentesInternos?.length) return d.puentesInternos.map(([a, b]) => [a, b] as [string, string]);
	const ids = new Set(d.bornes.map((b) => b.id));
	const auxiliares = new Set<string>();
	for (const c of contactosAuxiliaresIEC(d)) { auxiliares.add(c.comun); auxiliares.add(c.salida); }
	const pares: [string, string][] = [];
	// Bornes numerados a secas: 1-2, 3-4, 5-6, 7-8.
	for (let i = 1; i <= 7; i += 2) {
		const a = String(i);
		const b = String(i + 1);
		if (ids.has(a) && ids.has(b) && !auxiliares.has(a) && !auxiliares.has(b)) pares.push([a, b]);
	}
	// Estilo contactor: 1/L1 entra y 2/T1 sale.
	for (let i = 1; i <= 3; i++) {
		const entra = `${i * 2 - 1}/L${i}`;
		const sale = `${i * 2}/T${i}`;
		if (ids.has(entra) && ids.has(sale)) pares.push([entra, sale]);
	}
	// Un diferencial numera el neutro aparte (N1-N2 o N-N).
	if (ids.has('N1') && ids.has('N2')) pares.push(['N1', 'N2']);
	return pares;
}

/* ------------------------------- Fuentes de tensión ------------------------------- */

interface Fuente {
	clave: string;
	/** Tensión declarada del sistema. En trifásica es la COMPUESTA (entre fases). */
	tension: number;
	papel: 'fase' | 'retorno';
	/** True si su origen reparte tres fases: entonces `tension` es compuesta y fase-neutro es /√3. */
	trifasica: boolean;
}

/**
 * De dónde entra la tensión al tablero. Dos sitios: la acometida (los bornes de un aparato de
 * campo que reparte L/N) y el secundario de cada fuente o transformador, que crea su propio
 * circuito de mando a otra tensión.
 */
function fuentesDe(proyecto: Proyecto): Fuente[] {
	const fuentes: Fuente[] = [];
	for (const d of proyecto.dispositivos) {
		const comportamiento = resolverComportamiento(d);
		if (!comportamiento || comportamiento.clase === 'sin-comportamiento') continue;
		if (d.comportamiento && comportamiento.clase === 'fuente') {
			const trifasica = comportamiento.salidas.filter((s) => s.papel === 'fase').length >= 3;
			for (const s of comportamiento.salidas) {
				fuentes.push({ clave: `${d.id}::${s.borne}`, tension: s.tensionV, papel: s.papel, trifasica });
			}
			continue;
		}
		// Acometida: un aparato de campo sin nada aguas arriba que tiene fases y neutro.
		const esAcometida = d.campo && d.bornes.some((b) => b.tipo === 'L')
			&& (d.clase === 'W' || /acometida|red|alimentaci/i.test(d.descripcion ?? ''));
		if (esAcometida) {
			const tension = d.tensionNominal ?? 220;
			const trifasica = d.bornes.filter((b) => b.tipo === 'L').length >= 3;
			for (const b of d.bornes) {
				if (b.tipo === 'L') fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: b.id }), tension, papel: 'fase', trifasica });
				if (b.tipo === 'N') fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: b.id }), tension, papel: 'retorno', trifasica });
			}
		}
		// Secundario de una fuente o un transformador: su salida es una fuente nueva, pero SOLO si
		// su primario está alimentado. Eso lo resuelve la iteración; aquí solo se declara.
		if (d.tipo === 'fuente' || d.tipo === 'transformador') {
			const tension = tensionSecundariaDe(d);
			/*
			 * El secundario se busca por el LADO DECLARADO del borne; solo si nadie lo declara se
			 * recurre al id, para no romper los proyectos ya guardados.
			 *
			 * Buscar `+V`/`S1` y `-V`/`S2` a secas dejaba fuera cualquier fuente rotulada de otra
			 * manera. El tablero que arma el puente desde la Planta usa `+24` y `0V` —como vienen
			 * rotuladas las fuentes de 24 V CC de verdad—, así que su secundario no existía para la
			 * simulación y el PLC, los cuatro borneros y las máquinas quedaban sin tensión.
			 */
			const mas = d.bornes.find((b) => b.lado === 'secundario+')
				?? d.bornes.find((b) => !b.lado && (b.id === '+V' || b.id === 'S1'));
			const menos = d.bornes.find((b) => b.lado === 'secundario-')
				?? d.bornes.find((b) => !b.lado && (b.id === '-V' || b.id === 'S2'));
			// El secundario de un transformador de mando o de una fuente es monofásico.
			if (mas) fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: mas.id }), tension, papel: 'fase', trifasica: false });
			if (menos) fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: menos.id }), tension, papel: 'retorno', trifasica: false });
		}
	}
	return fuentes;
}

/*
 * `tensionSecundariaDe` vive en `tensiones.ts`: la necesitan tanto la simulación como el motor de
 * potenciales, y este último no puede arrastrar la simulación entera solo para preguntar a cuánto
 * está el secundario de una fuente. Se reexporta para no cambiarle el sitio a quien ya la usa.
 */
export { tensionSecundariaDe } from './tensiones.js';

/** ¿Está alimentado el primario de esta fuente/transformador? */
function primarioAlimentado(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const perfil = resolverComportamiento(d);
	const declarada = perfil?.clase === 'fuente' ? perfil.primario : undefined;
	const entradas = declarada
		? d.bornes.filter((b) => declarada.entradas.includes(b.id))
		: d.bornes.filter((b) => b.tipo === 'L' || b.id === 'P1' || b.id === 'L');
	const retornos = declarada
		? d.bornes.filter((b) => declarada.retornos.includes(b.id))
		: d.bornes.filter((b) => b.tipo === 'N' || b.id === 'P2');
	const hayFase = entradas.some((b) => vivos.get(claveBorne({ dispositivoId: d.id, borneId: b.id }))?.papel === 'fase');
	const hayRetorno = retornos.some((b) => vivos.has(claveBorne({ dispositivoId: d.id, borneId: b.id })));
	return hayFase && hayRetorno;
}

/**
 * La DSL expresa una rampa en la unidad física de la salida (V en el perfil v1), mientras que el
 * estado forzado y `ResultadoSimulacion.analogicas` usan siempre 0..100 %. Esta frontera explícita
 * evita que una consigna de 5 V se vuelva a convertir como si fuera 5 % (= 0,5 V).
 */
function porcentajeDeSalidaFisica(d: Dispositivo, borne: string, valor: number): number {
	const perfil = resolverComportamiento(d);
	const declarada = perfil?.clase === 'controlador'
		? perfil.salidasAnalogicas.find((s) => s.borne === borne)?.rango : undefined;
	const [min, max] = declarada ?? d.rangoSalidaAnalogica ?? RANGO_AO_POR_DEFECTO;
	if (max === min) return 0;
	return Math.max(0, Math.min(100, ((valor - min) / (max - min)) * 100));
}

/** Un controlador solo ejecuta/entrega salidas si recibe una diferencia de potencial. */
function controladorAlimentado(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'controlador') return false;
	const entradas = perfil.alimentacion.entradas.map((id) => vivos.get(`${d.id}::${id}`)).filter((v): v is BorneVivo => !!v);
	const retornos = perfil.alimentacion.retornos.map((id) => vivos.get(`${d.id}::${id}`)).filter((v): v is BorneVivo => !!v);
	return entradas.some((a) => retornos.some((b) => a.papel !== b.papel));
}

/** Un sensor alimentado solo puede entregar señal si recibe fase/+ y su retorno. */
function sensorAlimentado(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'sensor' || !perfil.alimentacion) return true;
	const entrada = vivos.get(`${d.id}::${perfil.alimentacion.entrada}`);
	const retorno = vivos.get(`${d.id}::${perfil.alimentacion.retorno}`);
	return entrada?.papel === 'fase' && retorno?.papel === 'retorno';
}

/** Bornes unidos por una entidad pasiva; nunca atraviesa contactos ni cargas. */
function bornesDePaso(d: Dispositivo, borne: string): string[] {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'pasivo') return [];
	const salida = new Set<string>();
	for (const par of perfil.conexiones) {
		if (par.entrada === borne) salida.add(par.salida);
		else if (par.salida === borne) salida.add(par.entrada);
	}
	// Los peines de borna son conexiones instaladas en el proyecto, no parte de la definición del
	// aparato. Se aplican también a un bornero personalizado con perfil pasivo.
	for (const grupo of d.puentes ?? []) {
		if (!grupo.includes(borne)) continue;
		for (const otro of grupo) if (otro !== borne) salida.add(otro);
	}
	return [...salida];
}

type PerfilVariador = Extract<ComportamientoSimulacion, { clase: 'variador' }>;

function alimentacionCompleta(
	d: Dispositivo,
	alimentacion: { fases: string[]; retornos: string[]; fasesMinimas: 1 | 3 },
	vivos: Map<string, BorneVivo>,
): boolean {
	const fases = alimentacion.fases.map((id) => vivos.get(`${d.id}::${id}`))
		.filter((v): v is BorneVivo => v?.papel === 'fase');
	const fuentes = new Set(fases.map((v) => v.fuente));
	if (alimentacion.fasesMinimas === 3) return fuentes.size >= 3;
	const retornos = alimentacion.retornos.map((id) => vivos.get(`${d.id}::${id}`))
		.filter((v): v is BorneVivo => !!v);
	return fases.length > 0 && retornos.some((r) => fases.some((f) => r.papel !== f.papel));
}

/** Busca una AO por el cable de señal, atravesando únicamente entidades pasivas y sus puentes. */
function valorAnalogicoCableadoA(
	dispositivoId: string,
	borneId: string,
	comunId: string,
	proyecto: Proyecto,
	vivos: Map<string, BorneVivo>,
	analogicas: ReadonlyMap<string, number>,
	unidades: 'V' | 'mA' | 'porcentaje',
): number | undefined {
	const inicio = `${dispositivoId}::${borneId}`;
	const vistos = new Set<string>([inicio]);
	const cola = [inicio];
	const porId = new Map(proyecto.dispositivos.map((x) => [x.id, x]));
	while (cola.length && vistos.size < 400) {
		const aqui = cola.shift()!;
		const [dueño, borne] = aqui.split('::');
		if (dueño !== dispositivoId) {
			const pct = analogicas.get(aqui);
			const origen = porId.get(dueño);
			if (pct !== undefined && origen && controladorAlimentado(origen, vivos)
				&& esSalidaAnalogicaDe(origen, borne)) {
				const salida = salidaAnalogicaEn(origen, borne, pct);
				const comunConectado = salida.referencia !== undefined && hayContinuidadPasiva(
					`${dispositivoId}::${comunId}`, `${dueño}::${salida.referencia}`, proyecto, porId,
				);
				if (comunConectado && (unidades === 'porcentaje' || unidades === salida.unidad)) {
					return unidades === 'porcentaje' ? pct : salida.valor;
				}
			}
			if (!origen) continue;
			const pasos = bornesDePaso(origen, borne);
			if (!pasos.length && resolverComportamiento(origen)?.clase !== 'pasivo') continue;
			for (const otro of pasos) {
				const clave = `${dueño}::${otro}`;
				if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
			}
		}
		for (const c of proyecto.conductores) {
			const mio = c.de.dispositivoId === dueño && c.de.borneId === borne;
			const suyo = c.a.dispositivoId === dueño && c.a.borneId === borne;
			if (!mio && !suyo) continue;
			const otro = mio ? c.a : c.de;
			const clave = `${otro.dispositivoId}::${otro.borneId}`;
			if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
		}
	}
	return undefined;
}

/**
 * Comprueba la continuidad del segundo hilo de una señal sin atravesar contactos ni aparatos.
 * La referencia puede pasar por bornas/puentes, exactamente igual que el hilo de señal.
 */
function hayContinuidadPasiva(
	desde: string,
	hasta: string,
	proyecto: Proyecto,
	porId = new Map(proyecto.dispositivos.map((x) => [x.id, x])),
): boolean {
	if (desde === hasta) return true;
	const vistos = new Set<string>([desde]);
	const cola = [desde];
	while (cola.length && vistos.size < 400) {
		const aqui = cola.shift()!;
		const [dueño, borne] = aqui.split('::');
		const dispositivo = porId.get(dueño);
		if (dispositivo && resolverComportamiento(dispositivo)?.clase === 'pasivo') {
			for (const otro of bornesDePaso(dispositivo, borne)) {
				const clave = `${dueño}::${otro}`;
				if (clave === hasta) return true;
				if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
			}
		}
		for (const c of proyecto.conductores) {
			const mio = c.de.dispositivoId === dueño && c.de.borneId === borne;
			const suyo = c.a.dispositivoId === dueño && c.a.borneId === borne;
			if (!mio && !suyo) continue;
			const otro = mio ? c.a : c.de;
			const clave = `${otro.dispositivoId}::${otro.borneId}`;
			if (clave === hasta) return true;
			if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
		}
	}
	return false;
}

interface LecturaReferenciaAnalogica {
	porcentaje: number;
	calidad: CalidadSenalAnalogica;
	senal?: SenalAnalogica;
}

function leerReferenciaAnalogica(
	d: Dispositivo,
	referencia: ReferenciaAnalogicaSimulacion,
	proyecto: Proyecto,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
	analogicas: ReadonlyMap<string, number>,
	memoria?: MemoriaTiempos,
): LecturaReferenciaAnalogica {
	if (tieneFallo(estado[d.id], 'circuito-analogico-abierto') || tieneFallo(estado[d.id], 'perdida-referencia')) {
		const rango = rangoDeReferencia(referencia);
		return { porcentaje: 0, calidad: 'circuito-abierto',
			...(rango ? { senal: senalInvalida(rango, 'circuito-abierto', 'inyectado') } : {}) };
	}
	const directo = estado[d.id]?.valor;
	if (referencia.unidad === 'porcentaje') {
		const valor = Number.isFinite(directo) ? directo! : 0;
		const [min, max] = referencia.rango;
		if (max <= min) return { porcentaje: 0, calidad: 'senal-invalida' };
		return { porcentaje: Math.max(0, Math.min(100, ((valor - min) / (max - min)) * 100)), calidad: 'normal' };
	}
	const rango = rangoDeReferencia(referencia)!;
	let senal: SenalAnalogica | undefined;
	if (Number.isFinite(directo)) {
		const normalizado = (directo! - rango.minimo) / (rango.maximo - rango.minimo);
		senal = {
			tipo: rango.tipo, unidadElectrica: rango.unidad, valorElectrico: directo,
			valorNormalizado: normalizado,
			calidad: normalizado < 0 || normalizado > 1 ? 'fuera-de-rango' : 'normal', origen: 'inyectado',
		};
	} else {
		const porId = new Map(proyecto.dispositivos.map((x) => [x.id, x]));
		const fuente = fuentesAnalogicasDisponibles(proyecto, estado, vivos, memoria, analogicas).find((f) =>
			hayContinuidadPasiva(`${d.id}::${referencia.borne}`, `${f.dispositivo.id}::${f.borne}`, proyecto, porId));
		if (fuente && hayContinuidadPasiva(`${d.id}::${referencia.comun}`,
			`${fuente.dispositivo.id}::${fuente.comun}`, proyecto, porId)) senal = fuente.senal;
	}
	if (!senal) return { porcentaje: 0, calidad: 'circuito-abierto', senal: senalInvalida(rango, 'circuito-abierto') };
	if (senal.tipo !== rango.tipo || senal.unidadElectrica !== rango.unidad) {
		return { porcentaje: 0, calidad: 'senal-invalida', senal: senalInvalida(rango, 'senal-invalida') };
	}
	if (senal.calidad !== 'normal' || senal.valorElectrico === undefined) {
		return { porcentaje: 0, calidad: senal.calidad, senal };
	}
	const valor = senal.valorElectrico;
	const [min, max] = referencia.rango;
	if (max <= min) return { porcentaje: 0, calidad: 'senal-invalida', senal };
	return {
		porcentaje: Math.max(0, Math.min(100, ((valor - min) / (max - min)) * 100)),
		calidad: senal.calidad, senal,
	};
}

function porcentajeReferencia(
	d: Dispositivo,
	referencia: ReferenciaAnalogicaSimulacion,
	proyecto: Proyecto,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
	analogicas: ReadonlyMap<string, number>,
): number {
	return leerReferenciaAnalogica(d, referencia, proyecto, estado, vivos, analogicas).porcentaje;
}

function estadoVariador(
	d: Dispositivo,
	perfil: PerfilVariador,
	proyecto: Proyecto,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
	analogicas: ReadonlyMap<string, number>,
	reloj?: { ahora: number; memoria: MemoriaTiempos },
): EstadoVariador {
	const alimentado = alimentacionCompleta(d, perfil.alimentacion, vivos);
	const run = vivos.get(`${d.id}::${perfil.mando.run}`)?.papel === 'fase';
	const habilitado = !perfil.mando.habilitacion
		|| vivos.get(`${d.id}::${perfil.mando.habilitacion}`)?.papel === 'fase';
	const st = estado[d.id];
	const fasesPresentes = new Set(perfil.alimentacion.fases
		.map((id) => vivos.get(`${d.id}::${id}`))
		.filter((v): v is BorneVivo => v?.papel === 'fase')
		.map((v) => v.fuente)).size;
	const perdidaFaseFisica = perfil.alimentacion.fasesMinimas === 3
		&& fasesPresentes > 0 && fasesPresentes < 3;
	const anterior = reloj?.memoria.variadores?.[d.id];
	const lecturaReferencia = leerReferenciaAnalogica(
		d, perfil.referencia, proyecto, estado, vivos, analogicas, reloj?.memoria,
	);
	const politicaPerdida = perfil.referencia.perdidaSenal ?? 'detener';
	const referenciaValida = lecturaReferencia.calidad === 'normal';
	const referenciaPorcentaje = referenciaValida ? lecturaReferencia.porcentaje
		: politicaPerdida === 'mantener' ? anterior?.referenciaPorcentaje ?? 0 : 0;
	const motivoActual = st?.fallo === true || st?.disparado === true ? 'fallo-declarado' as const
		: tieneFallo(st, 'fallo-externo') ? 'fallo-externo' as const
			: tieneFallo(st, 'perdida-fase') || perdidaFaseFisica ? 'perdida-fase' as const
				: tieneFallo(st, 'subtension') ? 'subtension' as const
					: tieneFallo(st, 'sobrecarga') ? 'sobrecarga' as const
						: !referenciaValida && politicaPerdida === 'fallo' ? 'perdida-referencia' as const : undefined;
	let falloEnclavado = anterior?.falloEnclavado === true || motivoActual !== undefined;
	let runBloqueadoHastaSoltar = anterior?.runBloqueadoHastaSoltar === true;
	let motivoFalla = motivoActual ?? anterior?.motivoFalla;
	const resetPermitido = falloEnclavado && motivoActual === undefined && alimentado;
	if (st?.resetFallo && resetPermitido) {
		falloEnclavado = false;
		runBloqueadoHastaSoltar = true;
		motivoFalla = undefined;
	}
	if (!run) runBloqueadoHastaSoltar = false;
	const runEfectivo = run && !runBloqueadoHastaSoltar;
	const pedido = perfil.frecuencia.minimaHz
		+ (perfil.frecuencia.maximaHz - perfil.frecuencia.minimaHz) * referenciaPorcentaje / 100;
	const frecuenciaObjetivoHz = alimentado && habilitado && runEfectivo && !falloEnclavado ? pedido : 0;
	let frecuenciaHz = frecuenciaObjetivoHz;
	if (reloj) {
		if (!anterior) frecuenciaHz = 0;
		else {
			const dt = Math.max(0, reloj.ahora - anterior.actualizadoEn) / 1000;
			const maxCambio = perfil.frecuencia.rampaHzS * dt;
			const diferencia = frecuenciaObjetivoHz - anterior.frecuenciaHz;
			frecuenciaHz = anterior.frecuenciaHz + Math.sign(diferencia) * Math.min(Math.abs(diferencia), maxCambio);
		}
	}
	if (!alimentado || falloEnclavado) frecuenciaHz = 0;
	const entregaSalida = alimentado && !falloEnclavado && frecuenciaHz > 0;
	return {
		dispositivoId: d.id, designacion: d.designacion ?? d.id,
		estado: !alimentado ? 'sin-alimentacion' : falloEnclavado ? 'falla'
			: frecuenciaObjetivoHz < frecuenciaHz - 0.01 ? 'decel'
				: (runEfectivo && habilitado) || entregaSalida ? 'marcha' : 'listo',
		alimentado, falloEnclavado, resetPermitido, runBloqueadoHastaSoltar, motivoFalla,
		run, habilitado, referenciaPorcentaje: Math.round(referenciaPorcentaje * 100) / 100,
		calidadReferencia: lecturaReferencia.calidad,
		...(lecturaReferencia.senal ? { referenciaElectrica: lecturaReferencia.senal } : {}),
		frecuenciaNominalHz: perfil.frecuencia.maximaHz,
		frecuenciaObjetivoHz: Math.round(frecuenciaObjetivoHz * 100) / 100,
		frecuenciaHz: Math.round(frecuenciaHz * 100) / 100,
	};
}

function fuentesDeVariadores(
	aparatos: Dispositivo[], estados: EstadoVariador[],
): Fuente[] {
	const porId = new Map(estados.map((e) => [e.dispositivoId, e]));
	const salida: Fuente[] = [];
	for (const d of aparatos) {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase !== 'variador') continue;
		const e = porId.get(d.id);
		if (!e || !['marcha', 'decel'].includes(e.estado) || e.frecuenciaHz <= 0) continue;
		for (const borne of [perfil.salida.u, perfil.salida.v, perfil.salida.w]) {
			salida.push({ clave: `${d.id}::${borne}`, tension: perfil.salida.tensionV, papel: 'fase', trifasica: true });
		}
	}
	return salida;
}

/** Un motor lo define su contrato funcional, también cuando su imagen usa una carcasa `otro`. */
function esMotorFuncional(d: Dispositivo): boolean {
	const perfil = resolverComportamiento(d);
	return perfil?.clase === 'carga' && perfil.efecto === 'giro';
}

/**
 * Resuelve el estado mínimo del motor sin escribirlo en el Proyecto.
 *
 * Sin reloj se conserva el modo de cálculo instantáneo usado por informes y tests históricos. Con
 * reloj, `MemoriaTiempos` permite distinguir el transitorio estimado de tres segundos de la marcha.
 */
function estadoMotor(
	d: Dispositivo,
	vivos: Map<string, BorneVivo>,
	estado: EstadoTablero,
	variadores: readonly EstadoVariador[],
	frecuenciaRedHz: number,
	reloj?: { ahora: number; memoria: MemoriaTiempos },
): EstadoMotor {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'carga' || perfil.efecto !== 'giro') {
		throw new Error(`estadoMotor recibió un aparato sin perfil de giro: ${d.id}`);
	}
	const alimentacionCompletaAhora = tieneCircuitoCompleto(d, vivos);
	const nominal = corrienteDe(d);
	const fuentesPresentes = new Set(perfil.alimentacion.fases
		.map((id) => vivos.get(`${d.id}::${id}`))
		.filter((v): v is BorneVivo => v?.papel === 'fase')
		.map((v) => v.fuente));
	const tensionRecibidaV = tensionDeEmpleo(d, vivos);
	const tensionNominalV = d.tensionNominal && d.tensionNominal > 0 ? d.tensionNominal : undefined;
	const tensionCorrecta = tensionRecibidaV === undefined || tensionNominalV === undefined ? undefined
		: Math.abs(tensionRecibidaV - tensionNominalV) / tensionNominalV <= TOLERANCIA_TENSION;
	const st = estado[d.id];
	const perdidaFaseFisica = perfil.alimentacion.fasesMinimas === 3
		&& fuentesPresentes.size > 0 && fuentesPresentes.size < 3;
	const motivoFalla = st?.fallo === true ? 'fallo-declarado' as const
		: st?.disparado === true ? 'disparo-declarado' as const
			: tieneFallo(st, 'perdida-fase') || perdidaFaseFisica ? 'perdida-fase' as const
				: tieneFallo(st, 'subtension') ? 'subtension' as const
					: tieneFallo(st, 'sobretension') ? 'sobretension' as const
						: tieneFallo(st, 'motor-bloqueado') ? 'motor-bloqueado' as const
							: tieneFallo(st, 'sobrecarga') ? 'sobrecarga' as const : undefined;
	const alimentado = alimentacionCompletaAhora && !tieneFallo(st, 'perdida-fase');
	const idsVariador = new Set(perfil.alimentacion.fases
		.map((id) => vivos.get(`${d.id}::${id}`)?.fuente.split('::')[0])
		.filter((id): id is string => !!id && variadores.some((v) => v.dispositivoId === id)));
	const variador = idsVariador.size === 1
		? variadores.find((v) => v.dispositivoId === [...idsVariador][0]) : undefined;
	const frecuenciaElectricaHz = alimentado ? variador?.frecuenciaHz ?? frecuenciaRedHz : 0;
	const frecuenciaNominalHz = variador ? Math.max(1, variador.frecuenciaNominalHz)
		: Math.max(1, frecuenciaRedHz);
	const velocidadObjetivo = motivoFalla ? 0
		: Math.max(0, Math.min(1, frecuenciaElectricaHz / frecuenciaNominalHz));
	const dinamica = perfil.dinamicaMotor;
	const duracionArranqueS = dinamica?.tiempoArranqueS ?? SEGUNDOS_ARRANQUE;
	const duracionParadaS = dinamica?.tiempoParadaS ?? SEGUNDOS_PARADA;
	const polosMotor = dinamica?.polos;
	const rpmSincronas = polosMotor ? 120 * frecuenciaElectricaHz / polosMotor : undefined;
	const rpmMecanicas = (velocidad: number): number | undefined => polosMotor === undefined ? undefined
		: Math.round(120 * frecuenciaNominalHz / polosMotor * velocidad
			* (1 - (dinamica?.deslizamiento ?? 0)));
	const base = {
		dispositivoId: d.id,
		designacion: d.designacion ?? d.id,
		alimentado,
		fasesRequeridas: perfil.alimentacion.fasesMinimas,
		fasesPresentes: fuentesPresentes.size,
		tensionRecibidaV,
		tensionNominalV,
		tensionCorrecta,
		corrienteNominalA: nominal,
		corrienteNominalEstimada: !(d.corrienteNominal !== undefined && d.corrienteNominal > 0),
		duracionArranqueEstimadaS: duracionArranqueS,
		frecuenciaElectricaHz: Math.round(frecuenciaElectricaHz * 100) / 100,
		velocidadObjetivo,
		rpmSincronas: rpmSincronas === undefined ? undefined : Math.round(rpmSincronas),
		rpmOrigen: polosMotor ? 'estimado' as const : 'no-disponible' as const,
	};

	if (reloj) reloj.memoria.motores ??= {};
	if (!reloj) {
		const velocidadActual = motivoFalla || !alimentado ? 0 : velocidadObjetivo;
		return {
			...base,
			estado: motivoFalla ? 'falla' : alimentado ? 'marcha' : 'detenido',
			progresoArranque: velocidadActual,
			velocidadActual,
			velocidadPorcentaje: Math.round(velocidadActual * 1000) / 10,
			rpmEstimada: rpmMecanicas(velocidadActual),
			corrienteEstimadaA: motivoFalla ? corrienteFallaMotor(nominal, motivoFalla) : alimentado ? nominal : 0,
			motivoFalla,
		};
	}

	const memoria = reloj.memoria.motores!;
	const anterior = memoria[d.id] ?? { velocidadRelativa: 0, actualizadoEn: reloj.ahora };
	const dt = Math.max(0, reloj.ahora - anterior.actualizadoEn) / 1000;
	const sube = velocidadObjetivo > anterior.velocidadRelativa;
	const duracion = sube ? duracionArranqueS : duracionParadaS;
	const maxCambio = duracion > 0 ? dt / duracion : 1;
	const velocidadActual = anterior.velocidadRelativa + Math.sign(velocidadObjetivo - anterior.velocidadRelativa)
		* Math.min(Math.abs(velocidadObjetivo - anterior.velocidadRelativa), maxCambio);
	memoria[d.id] = { velocidadRelativa: velocidadActual, actualizadoEn: reloj.ahora };
	const progresoArranque = velocidadObjetivo > 0
		? Math.max(0, Math.min(1, velocidadActual / velocidadObjetivo)) : 0;
	const enTransicion = Math.abs(velocidadActual - velocidadObjetivo) > 0.001;
	const estadoMotor: EstadoMotor['estado'] = motivoFalla ? 'falla'
		: velocidadObjetivo > velocidadActual + 0.001 ? 'arrancando'
			: velocidadObjetivo < velocidadActual - 0.001 ? 'desacelerando'
				: velocidadActual > 0.001 ? 'marcha' : 'detenido';
	const corrienteEstimadaA = motivoFalla ? corrienteFallaMotor(nominal, motivoFalla)
		: estadoMotor === 'arrancando' ? Math.round(nominal * VECES_ARRANQUE * 10) / 10
			: alimentado ? nominal : 0;
	return {
		...base, estado: estadoMotor, progresoArranque,
		velocidadActual: Math.max(0, Math.min(1, velocidadActual)),
		velocidadPorcentaje: Math.round(Math.max(0, Math.min(1, velocidadActual)) * 1000) / 10,
		rpmEstimada: rpmMecanicas(velocidadActual),
		corrienteEstimadaA,
		motivoFalla,
		...(enTransicion ? {} : { velocidadActual: velocidadObjetivo }),
	};
}

function corrienteFallaMotor(nominal: number, motivo: EstadoMotor['motivoFalla']): number {
	if (motivo === 'motor-bloqueado') return Math.round(nominal * VECES_ARRANQUE * 10) / 10;
	if (motivo === 'sobrecarga') return Math.round(nominal * VECES_SOBRECARGA_INYECTADA * 10) / 10;
	if (motivo === 'perdida-fase') return Math.round(nominal * 1.5 * 10) / 10;
	return 0;
}

function estadoActuador(
	d: Dispositivo,
	perfil: Extract<ComportamientoSimulacion, { clase: 'carga' }>,
	proyecto: Proyecto,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
	analogicas: ReadonlyMap<string, number>,
	reloj?: { ahora: number; memoria: MemoriaTiempos },
): EstadoActuador {
	const dinamica = perfil.dinamicaActuador ?? {
		tipo: perfil.mandoAnalogico ? 'modulante' as const : 'on-off' as const,
		tiempoAperturaS: 0, tiempoCierreS: 0, failSafe: 'cerrar' as const,
	};
	const alimentado = tieneCircuitoCompleto(d, vivos);
	const lectura = perfil.mandoAnalogico && alimentado
		? leerReferenciaAnalogica(d, perfil.mandoAnalogico, proyecto, estado, vivos, analogicas, reloj?.memoria)
		: { porcentaje: alimentado ? 100 : 0,
			calidad: alimentado ? 'normal' as const : 'sin-alimentacion' as const };
	const anterior = reloj?.memoria.actuadores?.[d.id];
	const posicionAnterior = anterior?.posicion ?? 0;
	let posicionObjetivo = dinamica.tipo === 'on-off' ? (alimentado ? 100 : 0) : lectura.porcentaje;
	if (lectura.calidad !== 'normal') {
		posicionObjetivo = dinamica.failSafe === 'mantener' ? posicionAnterior
			: dinamica.failSafe === 'abrir' ? 100
				: dinamica.failSafe === 'posicion-segura' ? dinamica.posicionSegura ?? 0 : 0;
	}
	if (perfil.mandoAnalogico?.invertido) posicionObjetivo = 100 - posicionObjetivo;
	posicionObjetivo = Math.max(0, Math.min(100, posicionObjetivo));
	let posicionActual = posicionObjetivo;
	const atascado = tieneFallo(estado[d.id], 'actuador-atascado');
	if (reloj) {
		if (atascado) posicionActual = posicionAnterior;
		else if (!anterior) posicionActual = 0;
		else {
			const dt = Math.max(0, reloj.ahora - anterior.actualizadoEn) / 1000;
			const tiempo = posicionObjetivo >= posicionAnterior ? dinamica.tiempoAperturaS : dinamica.tiempoCierreS;
			const maxCambio = tiempo <= 0 ? 100 : 100 * dt / tiempo;
			const diferencia = posicionObjetivo - posicionAnterior;
			posicionActual = posicionAnterior + Math.sign(diferencia) * Math.min(Math.abs(diferencia), maxCambio);
		}
		reloj.memoria.actuadores ??= {};
		reloj.memoria.actuadores[d.id] = { posicion: posicionActual, actualizadoEn: reloj.ahora };
	}
	const delta = posicionObjetivo - posicionActual;
	const estadoActuador: EstadoActuador['estado'] = atascado ? 'falla'
		: delta > 0.01 ? 'abriendo' : delta < -0.01 ? 'cerrando'
			: posicionActual <= 0.01 ? 'cerrada' : posicionActual >= 99.99 ? 'abierta' : 'detenida';
	let feedback: SenalAnalogica | undefined;
	if (dinamica.feedback) {
		const rango = rangoDeReferencia(dinamica.feedback)!;
		const valor = valorElectricoDesdeNormalizado(posicionActual / 100, rango);
		feedback = valor.valor === undefined ? senalInvalida(rango, 'senal-invalida') : {
			tipo: rango.tipo, unidadElectrica: rango.unidad, valorElectrico: valor.valor,
			valorNormalizado: posicionActual / 100, calidad: 'normal', origen: 'calculado',
			valorFisico: posicionActual, magnitud: 'posicion', unidad: '%',
		};
	}
	return {
		dispositivoId: d.id, designacion: d.designacion ?? d.id, tipo: dinamica.tipo,
		estado: estadoActuador, posicionObjetivo: Math.round(posicionObjetivo * 100) / 100,
		posicionActual: Math.round(posicionActual * 100) / 100, calidadMando: lectura.calidad,
		...(feedback ? { feedback } : {}),
	};
}

function proteccionRearmable(d: Dispositivo): boolean {
	const perfil = resolverComportamiento(d);
	return perfil?.clase === 'proteccion' ? perfil.rearmable : d.tipo !== 'fusible';
}

function rangoDeReferencia(referencia: Pick<ReferenciaAnalogicaSimulacion, 'unidad' | 'rango'>): RangoSenalAnalogica | undefined {
	if (referencia.unidad === 'porcentaje') return undefined;
	return {
		tipo: referencia.unidad === 'V' ? 'tension' : 'corriente',
		unidad: referencia.unidad,
		minimo: referencia.rango[0], maximo: referencia.rango[1],
	};
}

function senalDeTransmisor(
	d: Dispositivo,
	transmisor: TransmisorAnalogicoSimulacion,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
): SenalAnalogica {
	const rango = rangoDeReferencia(transmisor.salida)!;
	const st = estado[d.id];
	if (tieneFallo(st, 'fallo-sensor')) return senalInvalida(rango, 'fallo-sensor', 'inyectado');
	if (tieneFallo(st, 'circuito-analogico-abierto')) return senalInvalida(rango, 'circuito-abierto', 'inyectado');
	const alimentado = transmisor.modoConexion === '3-hilos'
		? sensorAlimentado(d, vivos)
		: vivos.get(`${d.id}::${transmisor.salida.comun}`)?.papel === 'fase';
	if (!alimentado) return senalInvalida(rango, 'sin-alimentacion', 'calculado');
	const { variable } = transmisor;
	const medio = variable.minimo + (variable.maximo - variable.minimo) / 2;
	const valor = tieneFallo(st, 'senal-fuera-rango')
		? variable.maximo + Math.abs(variable.maximo - variable.minimo) * 0.1
		: Number.isFinite(st?.valor) ? st!.valor! : medio;
	return senalDesdeVariableFisica(valor, variable, rango,
		tieneFallo(st, 'senal-fuera-rango') ? 'inyectado' : 'calculado');
}

interface FuenteAnalogicaCableada {
	dispositivo: Dispositivo;
	borne: string;
	comun: string;
	senal: SenalAnalogica;
	modoSalida: 'activa' | 'pasiva';
	modoConexion?: '2-hilos' | '3-hilos';
}

function fuentesAnalogicasDisponibles(
	proyecto: Proyecto,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
	memoria?: MemoriaTiempos,
	analogicas: ReadonlyMap<string, number> = new Map(),
): FuenteAnalogicaCableada[] {
	const fuentes: FuenteAnalogicaCableada[] = [];
	for (const d of proyecto.dispositivos) {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase === 'sensor' && perfil.transmisor) {
			fuentes.push({
				dispositivo: d, borne: perfil.transmisor.salida.borne, comun: perfil.transmisor.salida.comun,
				senal: senalDeTransmisor(d, perfil.transmisor, estado, vivos),
				modoSalida: perfil.transmisor.modoSalida, modoConexion: perfil.transmisor.modoConexion,
			});
		}
		if (perfil?.clase === 'carga' && perfil.dinamicaActuador?.feedback) {
			const feedback = perfil.dinamicaActuador.feedback;
			const rango = rangoDeReferencia(feedback)!;
			const posicion = memoria?.actuadores?.[d.id]?.posicion ?? 0;
			const valor = valorElectricoDesdeNormalizado(posicion / 100, rango);
			fuentes.push({
				dispositivo: d, borne: feedback.borne, comun: feedback.comun, modoSalida: 'activa',
				senal: valor.valor === undefined ? senalInvalida(rango, 'senal-invalida') : {
					tipo: rango.tipo, unidadElectrica: rango.unidad, valorElectrico: valor.valor,
					valorNormalizado: posicion / 100, calidad: 'normal', origen: 'calculado',
					valorFisico: posicion, magnitud: 'posicion', unidad: '%',
				},
			});
		}
		if (perfil?.clase === 'controlador' && controladorAlimentado(d, vivos)) {
			for (const salida of perfil.salidasAnalogicas) {
				const porcentaje = analogicas.get(`${d.id}::${salida.borne}`);
				if (porcentaje === undefined) continue;
				const fisica = salidaAnalogicaEn(d, salida.borne, porcentaje);
				fuentes.push({
					dispositivo: d, borne: salida.borne, comun: salida.referencia,
					senal: fisica.senal, modoSalida: 'activa',
				});
			}
		}
	}
	return fuentes;
}

function leerEntradaAnalogica(
	controlador: Dispositivo,
	entrada: EntradaAnalogicaSimulacion,
	proyecto: Proyecto,
	estado: EstadoTablero,
	vivos: Map<string, BorneVivo>,
	memoria?: MemoriaTiempos,
): EstadoEntradaAnalogica {
	const rango = rangoDeReferencia(entrada)!;
	const base = {
		dispositivoId: controlador.id, designacion: controlador.designacion ?? controlador.id,
		borne: entrada.borne, magnitud: entrada.variable.magnitud, unidad: entrada.variable.unidad,
	};
	if (!controladorAlimentado(controlador, vivos)) {
		return { ...base, senal: senalInvalida(rango, 'sin-alimentacion', 'calculado') };
	}
	if (tieneFallo(estado[controlador.id], 'circuito-analogico-abierto')) {
		return { ...base, senal: senalInvalida(rango, 'circuito-abierto', 'inyectado') };
	}
	const porId = new Map(proyecto.dispositivos.map((d) => [d.id, d]));
	const fuente = fuentesAnalogicasDisponibles(proyecto, estado, vivos, memoria).find((f) =>
		hayContinuidadPasiva(`${controlador.id}::${entrada.borne}`, `${f.dispositivo.id}::${f.borne}`, proyecto, porId));
	if (!fuente) return { ...base, senal: senalInvalida(rango, 'circuito-abierto', 'calculado') };
	if (fuente.senal.tipo !== rango.tipo || fuente.senal.unidadElectrica !== rango.unidad) {
		return { ...base, senal: senalInvalida(rango, 'senal-invalida', 'calculado') };
	}
	if (fuente.modoSalida === 'activa' && entrada.modoEntrada === 'activa') {
		return { ...base, senal: senalInvalida(rango, 'senal-invalida', 'calculado') };
	}
	if (fuente.modoSalida === 'pasiva' && entrada.modoEntrada === 'pasiva' && fuente.modoConexion !== '2-hilos') {
		return { ...base, senal: senalInvalida(rango, 'senal-invalida', 'calculado') };
	}
	const retornoCerrado = fuente.modoConexion === '2-hilos'
		? vivos.get(`${controlador.id}::${entrada.comun}`)?.papel === 'retorno'
			&& vivos.get(`${fuente.dispositivo.id}::${fuente.comun}`)?.papel === 'fase'
		: hayContinuidadPasiva(`${controlador.id}::${entrada.comun}`,
			`${fuente.dispositivo.id}::${fuente.comun}`, proyecto, porId);
	if (!retornoCerrado || fuente.senal.calidad === 'circuito-abierto') {
		return { ...base, senal: senalInvalida(rango, 'circuito-abierto', fuente.senal.origen) };
	}
	const escalado = escalarSenalAIngenieria(fuente.senal, rango, entrada.variable, { clamp: true });
	return {
		...base, senal: { ...fuente.senal, calidad: escalado.calidad },
		...(escalado.valor === undefined ? {} : { valorIngenieria: escalado.valor }),
	};
}

/**
 * Lo que un controlador VE de su tablero: qué entradas tienen tensión y qué marcan sus sondas.
 *
 * Una entrada digital está activa si a su borne le llega tensión, que es literalmente lo que ve un
 * DDC. Una analógica toma el valor de la SONDA QUE TIENE CABLEADA: no se inventa un número, se
 * busca de verdad qué aparato hay al otro lado del hilo, y si no hay ninguno la comparación no se
 * cumple —un controlador sin sonda no puede decidir por temperatura, y así se nota—.
 */
function leerControlador(
	d: Dispositivo,
	proyecto: Proyecto,
	vivos: Map<string, BorneVivo>,
	estado: EstadoTablero,
	salidasPrevias: Set<string>,
	memoria?: MemoriaTiempos,
): LecturaControlador & { entradasAnalogicas: EstadoEntradaAnalogica[] } {
	const activos = new Set<string>();
	const valores: Record<string, number> = {};
	const perfil = resolverComportamiento(d);
	const entradasAnalogicas = perfil?.clase === 'controlador'
		? (perfil.entradasAnalogicas ?? []).map((entrada) =>
			leerEntradaAnalogica(d, entrada, proyecto, estado, vivos, memoria)) : [];
	const reservados = perfil?.clase === 'controlador' ? new Set([
		...perfil.alimentacion.entradas, ...perfil.alimentacion.retornos,
		...perfil.salidasDigitales.flatMap((s) => [s.borne, s.comun]),
		...perfil.salidasAnalogicas.flatMap((s) => [s.borne, s.referencia]),
		...(perfil.entradasAnalogicas ?? []).flatMap((s) => [s.borne, s.comun]),
	]) : new Set<string>();
	for (const b of d.bornes) {
		const v3 = entradasAnalogicas.find((entrada) => entrada.borne === b.id);
		if (v3) {
			if (v3.senal.calidad === 'normal' && v3.valorIngenieria !== undefined) valores[b.id] = v3.valorIngenieria;
			continue;
		}
		if (!reservados.has(b.id) && vivos.get(`${d.id}::${b.id}`)?.papel === 'fase') activos.add(b.id);
		if (reservados.has(b.id) || esBorneDeAlimentacion(b)) continue;
		const v = sondaCableadaA(d.id, b.id, proyecto, estado);
		if (v !== undefined) valores[b.id] = v;
	}
	return { activos, valores, salidasPrevias, entradasAnalogicas };
}

const COMUNES = new Set(['+24', '0V', '+V', '-V', '+', '-', 'A1', 'A2', '24V', 'GND']);

/**
 * ¿Este borne del controlador es de alimentación y no de señal?
 *
 * Importa porque el 0 V es común a TODO: si se buscara la sonda también desde ahí, el común
 * acabaría «midiendo» la temperatura de retorno solo porque la sonda cierra por él.
 */
function esBorneDeAlimentacion(b: { id: string; tipo?: string }): boolean {
	return b.tipo === 'L' || b.tipo === 'N' || b.tipo === 'PE' || COMUNES.has(b.id);
}

interface ProgramaEnSimulacion {
	config: ConfiguracionProgramaPLC;
	compilado: ProgramaPLCCompilado;
	io: IOProgramaPLC;
}

const cacheProgramasPLC = new WeakMap<Dispositivo, { clave: string; programa: ProgramaEnSimulacion }>();

export function ioDeControlador(d: Dispositivo): IOProgramaPLC {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'controlador') return { DI: [], DO: [], AI: [], AO: [] };
	const reservados = new Set([
		...perfil.alimentacion.entradas, ...perfil.alimentacion.retornos,
		...perfil.salidasDigitales.flatMap((s) => [s.borne, s.comun]),
		...perfil.salidasAnalogicas.flatMap((s) => [s.borne, s.referencia]),
		...(perfil.entradasAnalogicas ?? []).flatMap((s) => [s.borne, s.comun]),
	]);
	return {
		DI: d.bornes.filter((b) => !reservados.has(b.id) && !esBorneDeAlimentacion(b)).map((b) => b.id),
		DO: perfil.salidasDigitales.map((s) => s.borne),
		AI: (perfil.entradasAnalogicas ?? []).map((s) => s.borne),
		AO: perfil.salidasAnalogicas.map((s) => s.borne),
	};
}

function programaDeControlador(d: Dispositivo): ProgramaEnSimulacion | undefined {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'controlador') return undefined;
	const config = d.programaPLC ?? (d.programa?.trim() ? configLegacyPLC(d.programa) : undefined);
	if (!config) return undefined;
	const io = ioDeControlador(d);
	const clave = JSON.stringify([config, io]);
	const cache = cacheProgramasPLC.get(d);
	if (cache?.clave === clave) return cache.programa;
	const programa = { config, io, compilado: compilarProgramaPLC(config, io) };
	cacheProgramasPLC.set(d, { clave, programa });
	return programa;
}

function imagenEntradasPLC(
	d: Dispositivo,
	programa: ProgramaEnSimulacion,
	lectura: ReturnType<typeof leerControlador>,
): ImagenEntradasPLC {
	const digitales: Record<string, boolean> = {};
	for (const borne of programa.io.DI) digitales[borne] = lectura.activos.has(borne);
	const analogicas: ImagenEntradasPLC['analogicas'] = {};
	for (const [borne, valor] of Object.entries(lectura.valores)) {
		analogicas[borne] = { valor, calidad: 'normal', origen: 'calculado' };
	}
	for (const entrada of lectura.entradasAnalogicas) {
		analogicas[entrada.borne] = {
			valor: entrada.valorIngenieria,
			calidad: entrada.senal.calidad,
			origen: entrada.senal.origen,
		};
	}
	/* Alias persistentes: la imagen conserva el borne y el nombre lógico. */
	for (const tag of Object.values(programa.compilado.etiquetas)) {
		if (tag.io?.clase === 'DI' && tag.nombre !== tag.io.borne.toUpperCase()) {
			digitales[tag.nombre] = digitales[tag.io.borne] ?? false;
		}
		if (tag.io?.clase === 'AI' && tag.nombre !== tag.io.borne.toUpperCase() && analogicas[tag.io.borne]) {
			analogicas[tag.nombre] = analogicas[tag.io.borne];
		}
	}
	void d;
	return { digitales, analogicas };
}

/**
 * Qué sonda hay al final del hilo de esta entrada, ATRAVESANDO ENTIDADES PASIVAS.
 *
 * Antes esto miraba solo el aparato que había al otro lado del conductor, y en un tablero de
 * verdad al otro lado NUNCA hay una sonda: hay una borna. Todo lo que va a campo pasa por el
 * bornero —para eso está—, así que el controlador se quedaba sin lectura en cuanto el tablero se
 * cableaba como se cablea. Ahora se sigue el hilo de borna en borna, incluidos los puentes del
 * peine, hasta dar con un aparato que entregue un número.
 *
 * Solo se atraviesan perfiles pasivos: un contacto o una bobina en medio cortan la búsqueda, porque
 * eléctricamente ya no es el mismo hilo de señal.
 */
function sondaCableadaA(
	dispositivoId: string,
	borneId: string,
	proyecto: Proyecto,
	estado: EstadoTablero,
): number | undefined {
	const inicio = `${dispositivoId}::${borneId}`;
	const vistos = new Set<string>([inicio]);
	const cola = [inicio];
	const porId = new Map(proyecto.dispositivos.map((x) => [x.id, x]));
	while (cola.length && vistos.size < 400) {
		const aqui = cola.shift()!;
		const [dueño, borne] = aqui.split('::');
		if (dueño !== dispositivoId) {
			const v = estado[dueño]?.valor;
			if (v !== undefined) return v;
			// Un bornero es un trozo de cable con tornillos: se sigue de largo. Cualquier otra cosa
			// (un relé, un contactor, una fuente) corta el hilo de señal.
			const paso = porId.get(dueño);
			if (!paso) continue;
			const vecinos = bornesDePaso(paso, borne);
			if (!vecinos.length && resolverComportamiento(paso)?.clase !== 'pasivo') continue;
			for (const otro of vecinos) {
				const clave = `${dueño}::${otro}`;
				if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
			}
		}
		for (const c of proyecto.conductores) {
			const mio = c.de.dispositivoId === dueño && c.de.borneId === borne;
			const suyo = c.a.dispositivoId === dueño && c.a.borneId === borne;
			if (!mio && !suyo) continue;
			const otro = mio ? c.a : c.de;
			const clave = `${otro.dispositivoId}::${otro.borneId}`;
			if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
		}
	}
	return undefined;
}

/* --------------------------------- La simulación --------------------------------- */

/**
 * Simula el tablero con los mandos en la posición que diga `estado`.
 *
 * `activosPrevios` es la MEMORIA del circuito: qué bobinas estaban metidas justo antes. No es un
 * detalle de implementación, es física. Un enclavamiento no crea un estado, lo mantiene: el
 * contactor se sostiene por su propio contacto auxiliar, y ese contacto solo está cerrado si el
 * contactor YA estaba cerrado. Si se simula siempre en frío, al soltar el pulsador de marcha el
 * motor se para — y si se le pasa el estado anterior, sigue girando, que es lo que hace de verdad.
 *
 * Sin este argumento el arranque en frío también sale bien: un tablero al que se le da tensión con
 * todo suelto no arranca solo. Las dos cosas tienen que ser ciertas a la vez.
 */
export function simular(
	proyecto: Proyecto,
	estado: EstadoTablero = {},
	activosPrevios?: ReadonlySet<string>,
	reloj?: { ahora: number; memoria: MemoriaTiempos; logica?: MemoriaLogica },
): ResultadoSimulacion {
	const aparatos = proyecto.dispositivos.filter((d) => {
		const perfil = resolverComportamiento(d);
		return !!perfil && perfil.clase !== 'sin-comportamiento';
	});
	const fuentes = fuentesDe(proyecto);

	/* Un PLC publica una imagen de salidas; el punto fijo eléctrico nunca ejecuta scans. */
	const programas = new Map<string, ProgramaEnSimulacion>();
	const runtimesPLC = new Map<string, RuntimePLC>();
	const erroresPrograma: string[] = [];
	for (const d of aparatos) {
		const programa = programaDeControlador(d);
		if (!programa) continue;
		programas.set(d.id, programa);
		const runtime = reloj?.memoria.controladores?.[d.id] ?? crearRuntimePLC(programa.compilado);
		if (!reloj) for (const clave of activosPrevios ?? []) {
			if (clave.startsWith(`${d.id}::`)) runtime.salidas.digitales[clave.slice(d.id.length + 2)] = true;
		}
		runtimesPLC.set(d.id, runtime);
		for (const e of programa.compilado.errores) erroresPrograma.push(
			`${d.designacion ?? d.id}, renglón ${e.linea}: ${e.mensaje} («${e.texto}»)`);
		for (const e of programa.compilado.legacy?.errores ?? []) erroresPrograma.push(
			`${d.designacion ?? d.id}, renglón ${e.linea}: ${e.que} («${e.texto}»)`);
	}
	/*
	 * Las salidas del programa son ESTADO del circuito, igual que una bobina metida, y viajan por
	 * el mismo sitio: `activos`, con la clave «plc::DO1». Sin esto un programa que se realimenta
	 * —«DO1 = (DI1 O DO1) Y NO DI2», el enclavamiento hecho en el controlador y no con relés— se
	 * caía al soltar la marcha, porque cada llamada empezaba sin saber qué había encendido antes.
	 */
	const salidasDePrograma = new Map<string, Set<string>>();
	for (const [id, runtime] of runtimesPLC) {
		salidasDePrograma.set(id, new Set(Object.entries(runtime.salidas.digitales)
			.filter(([, activa]) => activa).map(([borne]) => borne)));
	}

	let vivos = new Map<string, BorneVivo>();
	let activos = new Set<string>(activosPrevios ?? []);
	/*
	 * Qué relés tienen los contactos CONMUTADOS ahora mismo. En un relé instantáneo es lo mismo
	 * que tener la bobina alimentada; en uno temporizado, no: durante la cuenta atrás la bobina
	 * está metida y los contactos siguen en reposo. Por eso van separados.
	 */
	let conmutados = new Set<string>(activosPrevios ?? []);
	let pasadas = 0;
	let estable = false;
	const analogicas = new Map<string, number>();
	/*
	 * Las que fuerza el usuario a mano entran ANTES de la primera pasada: si no, el programa del
	 * controlador —que las recalcula cada vuelta— las pisaría, y forzar una salida a mano dejaría
	 * de servir para nada, que es justo lo que hace uno cuando quiere probar una válvula.
	 */
	for (const [id, e] of Object.entries(estado)) {
		for (const [borne, v] of Object.entries(e.analogicas ?? {})) {
			if (Number.isFinite(v)) analogicas.set(`${id}::${borne}`, v);
		}
	}
	for (const [id, runtime] of runtimesPLC) {
		const programa = programas.get(id)!;
		const d = aparatos.find((x) => x.id === id)!;
		for (const [borne, valor] of Object.entries(runtime.salidas.analogicas)) {
			if (estado[id]?.analogicas?.[borne] !== undefined) continue;
			analogicas.set(`${id}::${borne}`, programa.config.lenguaje === 'legacy'
				? porcentajeDeSalidaFisica(d, borne, valor) : valor);
		}
	}
	let prop: Propagacion = { vivos, alcances: [], conductorEntre: new Map() };
	let fuentesVariadores: Fuente[] = [];
	let variadoresEnFalla = new Set<string>();
	let scanPLCResuelto = false;

	/*
	 * LOS RETARDOS DEL PROGRAMA SE CUENTAN CON EL CIRCUITO YA RESUELTO, NO A MEDIO RESOLVER.
	 *
	 * Este bucle va estabilizando el tablero: en la primera pasada `vivos` está casi vacío y se va
	 * llenando pasada a pasada. Los controladores se consultan DENTRO del bucle, así que en esa
	 * primera pasada leen un tablero que todavía no es el de verdad: una entrada que sí tiene
	 * tensión aparece sin ella, la condición del renglón sale falsa... y `salidasActivas` borra el
	 * contador del retardo, porque para él la condición «ha dejado de cumplirse».
	 *
	 * A la pasada siguiente la condición vuelve a cumplirse y el contador arranca de cero. O sea
	 * que en cada llamada el reloj del retardo volvía a empezar y NUNCA llegaba a su tiempo.
	 * Medido en la UMA de la biblioteca: con la marcha pedida y la compuerta abierta desde el
	 * segundo 0, a los 60 segundos simulados el ventilador seguía parado, y `desdePedida` marcaba
	 * el instante actual en cada vuelta:
	 *
	 *     t=16.0s  salidasPrograma=[a1::DO2]  m1=false   desdePedida={"DO2":16000,"DO1":16000}
	 *
	 * Con eso, NINGÚN `retardo` ni `minimo` de un programa podía cumplirse jamás — y son la mitad
	 * de lo que hace un tablero de clima. El ejemplo de la UMA prometía «a los 8 segundos arranca
	 * el ventilador» y el ventilador no arrancaba nunca.
	 *
	 * Así que el bucle tantea sobre una COPIA, que se tira, y solo cuando el tablero se queda
	 * quieto se apunta el tiempo en la memoria de verdad. Si al apuntarlo cambia alguna salida
	 * —justo el instante en que vence un retardo— se da otra vuelta para que el circuito lo recoja.
	 */
	while (pasadas < MAX_PASADAS && !estable) {
		pasadas++;
		prop = propagar(proyecto, aparatos, [...fuentes, ...fuentesVariadores], estado, activos, vivos,
			conmutados, salidasDePrograma, variadoresEnFalla);
		const nuevosVivos = prop.vivos;
		const estadosVariadores = aparatos.flatMap((d) => {
			const perfil = resolverComportamiento(d);
			return perfil?.clase === 'variador'
				? [estadoVariador(d, perfil, proyecto, estado, nuevosVivos, analogicas, reloj)] : [];
		});
		const nuevosVariadoresEnFalla = new Set(estadosVariadores
			.filter((v) => v.estado === 'falla').map((v) => v.dispositivoId));
		const cambiaronContactosFallo = !igualesConjuntos(variadoresEnFalla, nuevosVariadoresEnFalla);
		variadoresEnFalla = nuevosVariadoresEnFalla;
		const nuevasFuentesVariadores = fuentesDeVariadores(aparatos, estadosVariadores);
		const cambiaronFuentesVariadores = !igualesConjuntos(
			new Set(fuentesVariadores.map((f) => f.clave)), new Set(nuevasFuentesVariadores.map((f) => f.clave)),
		);
		fuentesVariadores = nuevasFuentesVariadores;
		const nuevosActivos = new Set<string>();
		for (const d of aparatos) {
			if (bobinaAlimentada(d, nuevosVivos)) nuevosActivos.add(d.id);
		}
		// Las salidas del programa entran en el estado del circuito para que la siguiente llamada
		// las recuerde: son lo que sostiene un enclavamiento hecho en el controlador.
		for (const [id, salidas] of salidasDePrograma) {
			for (const s2 of salidas) nuevosActivos.add(`${id}::${s2}`);
		}
		conmutados = aplicarTemporizadores(aparatos, nuevosActivos, reloj);
		estable = igualesClaves(vivos, nuevosVivos) && igualesConjuntos(activos, nuevosActivos)
			&& !cambiaronFuentesVariadores && !cambiaronContactosFallo;
		vivos = nuevosVivos;
		activos = nuevosActivos;

		/*
		 * Solo con la red estable se congelan las entradas. Los runtimes se calculan todos contra esas
		 * capturas y se comprometen después juntos; el orden del array de aparatos no puede filtrarse.
		 */
		if (estable && !scanPLCResuelto && programas.size) {
			scanPLCResuelto = true;
			const capturas = [...programas].sort(([a], [b]) => a.localeCompare(b)).map(([id, programa]) => {
				const d = aparatos.find((x) => x.id === id)!;
				const lectura = leerControlador(d, proyecto, vivos, estado,
					salidasDePrograma.get(id) ?? new Set(), reloj?.memoria);
				return { id, d, programa, alimentado: controladorAlimentado(d, vivos), imagen: imagenEntradasPLC(d, programa, lectura) };
			});
			const actualizados = capturas.map((captura) => ({
				...captura,
				resultado: actualizarRuntimePLC(captura.programa.compilado, runtimesPLC.get(captura.id),
					captura.imagen, reloj?.ahora ?? 0, captura.alimentado, estado[captura.id]?.plc),
			}));
			let cambiaron = false;
			for (const { id, d, programa, resultado } of actualizados) {
				runtimesPLC.set(id, resultado.runtime);
				if (reloj) { reloj.memoria.controladores ??= {}; reloj.memoria.controladores[id] = resultado.runtime; }
				const nuevas = new Set(Object.entries(resultado.runtime.salidas.digitales)
					.filter(([, activa]) => activa).map(([borne]) => borne));
				if (!igualesConjuntos(salidasDePrograma.get(id) ?? new Set(), nuevas)) cambiaron = true;
				salidasDePrograma.set(id, nuevas);
				for (const [borne, valor] of Object.entries(resultado.runtime.salidas.analogicas)) {
					if (estado[id]?.analogicas?.[borne] !== undefined) continue;
					const pct = programa.config.lenguaje === 'legacy' ? porcentajeDeSalidaFisica(d, borne, valor) : valor;
					if (analogicas.get(`${id}::${borne}`) !== pct) cambiaron = true;
					analogicas.set(`${id}::${borne}`, pct);
				}
			}
			if (cambiaron) {
				estable = false;
				for (const [id, salidas] of salidasDePrograma) for (const salida of salidas) activos.add(`${id}::${salida}`);
			}
		}
	}

	// Lo que se VE funcionando: consumos con tensión en sus dos extremos, y bobinas metidas.
	const funcionando: ResultadoSimulacion['funcionando'] = [];
	const avisos: string[] = [];
	const consumos: Consumo[] = [];
	const variadores = aparatos.flatMap((d) => {
		const perfil = resolverComportamiento(d);
		return perfil?.clase === 'variador'
			? [estadoVariador(d, perfil, proyecto, estado, vivos, analogicas, reloj)] : [];
	});
	if (reloj) {
		reloj.memoria.variadores ??= {};
		for (const v of variadores) {
			reloj.memoria.variadores[v.dispositivoId] = {
				frecuenciaHz: v.frecuenciaHz, actualizadoEn: reloj.ahora,
				referenciaPorcentaje: v.referenciaPorcentaje,
				falloEnclavado: v.falloEnclavado,
				runBloqueadoHastaSoltar: v.runBloqueadoHastaSoltar,
				motivoFalla: v.motivoFalla,
			};
		}
	}
	for (const v of variadores) {
		if (v.estado !== 'marcha') continue;
		activos.add(v.dispositivoId);
		funcionando.push({
			dispositivoId: v.dispositivoId, designacion: v.designacion,
			que: `variador en marcha · ${v.frecuenciaHz.toFixed(1)} Hz`,
		});
	}
	const motores = aparatos.filter(esMotorFuncional)
		.map((d) => estadoMotor(d, vivos, estado, variadores, proyecto.opciones?.frecuenciaHz ?? 50, reloj));
	const motoresPorId = new Map(motores.map((motor) => [motor.dispositivoId, motor]));
	if (reloj?.memoria.motores) {
		const idsPresentes = new Set(motores.map((motor) => motor.dispositivoId));
		for (const id of Object.keys(reloj.memoria.motores)) {
			if (!idsPresentes.has(id)) delete reloj.memoria.motores[id];
		}
	}
	for (const d of aparatos) {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase === 'variador') continue;
		const etiqueta = d.designacion ?? d.id;
		if (CONSUME.has(d.tipo) || perfil?.clase === 'carga') {
			const motor = motoresPorId.get(d.id);
			if (motor?.estado === 'detenido') continue;
			if (tieneCircuitoCompleto(d, vivos)) {
				const corriente = motor?.corrienteEstimadaA && motor.estado === 'falla'
					? motor.corrienteEstimadaA : corrienteDe(d);
				if (motor?.estado !== 'falla') {
					activos.add(d.id);
					funcionando.push({
						dispositivoId: d.id,
						designacion: etiqueta,
						que: motor?.estado === 'arrancando'
							? `arrancando (${Math.round(motor.progresoArranque * 100)} %) · `
								+ `${formatearA(motor.corrienteEstimadaA)} estimados`
							: `${motor ? 'girando' : queHace(d)} · ${formatearA(corriente)}`,
					});
				}
				consumos.push({
					dispositivoId: d.id,
					designacion: etiqueta,
					corriente,
					fases: d.bornes
						.filter((b) => vivos.get(`${d.id}::${b.id}`)?.papel === 'fase')
						.map((b) => `${d.id}::${b.id}`),
				});
			}
		} else if (activos.has(d.id)) {
			const t = d.temporizacion;
			const espera = t?.tipo === 'trabajo' && !conmutados.has(d.id);
			funcionando.push({
				dispositivoId: d.id,
				designacion: etiqueta,
				que: espera ? `bobina alimentada, contando ${t!.segundos} s` : 'bobina alimentada, contactos cambiados',
			});
		} else if (conmutados.has(d.id)) {
			// Temporizado a la desconexión: la bobina ya no tiene tensión pero aguanta.
			funcionando.push({
				dispositivoId: d.id,
				designacion: etiqueta,
				que: `soltada la bobina, aguantando ${d.temporizacion?.segundos ?? 0} s`,
			});
		}
	}
	const actuadores = aparatos.flatMap((d) => {
		const perfil = resolverComportamiento(d);
		return perfil?.clase === 'carga' && perfil.efecto === 'movimiento'
			? [estadoActuador(d, perfil, proyecto, estado, vivos, analogicas, reloj)] : [];
	});
	const posicionesCargas = new Map(actuadores.map((a) => [a.dispositivoId, a.posicionActual]));
	const sensoresAnalogicos = aparatos.flatMap((d) => {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase !== 'sensor' || !perfil.transmisor) return [];
		const valor = Number.isFinite(estado[d.id]?.valor) ? estado[d.id]!.valor!
			: perfil.transmisor.variable.minimo
				+ (perfil.transmisor.variable.maximo - perfil.transmisor.variable.minimo) / 2;
		return [{
			dispositivoId: d.id, designacion: d.designacion ?? d.id,
			modoConexion: perfil.transmisor.modoConexion,
			variable: { magnitud: perfil.transmisor.variable.magnitud,
				unidad: perfil.transmisor.variable.unidad, valor },
			senal: senalDeTransmisor(d, perfil.transmisor, estado, vivos),
		} satisfies EstadoSensorAnalogico];
	});

	/* ---- Lo que consume el tablero: intensidades por rama, faltas y disparos ---- */
	const { porConductor, porAparato } = repartirCorrientes(consumos, prop);
	const cortocircuitos = buscarCortocircuitos(prop, aparatos);
	const cargaPorAparato = new Map<string, CargaAparato>();
	const disparos: Disparo[] = [];
	for (const d of aparatos) {
		const corriente = porAparato.get(d.id) ?? 0;
		if (corriente === 0 && !protegeSobrecorriente(d)) continue;
		const nominal = calibreDe(d);
		const carga: CargaAparato = {
			dispositivoId: d.id,
			designacion: d.designacion ?? d.id,
			corriente: Math.round(corriente * 100) / 100,
			nominal,
			porcentaje: nominal ? Math.round((corriente / nominal) * 100) : undefined,
		};
		cargaPorAparato.set(d.id, carga);
		// Sobrecarga: la protección ve más corriente de la que aguanta y acaba disparando.
		if (protegeSobrecorriente(d) && nominal && estado[d.id]?.disparado !== true) {
			const segundos = tiempoDeDisparo(corriente, nominal, d.curvaDisparo);
			if (segundos !== undefined) {
				disparos.push({
					dispositivoId: d.id,
					designacion: d.designacion ?? d.id,
					motivo: 'sobrecarga',
					corriente: Math.round(corriente * 100) / 100,
					nominal,
					segundos,
					rearmable: proteccionRearmable(d),
					explicacion: `${formatearA(corriente)} por un aparato de ${nominal} A `
						+ `(${Math.round((corriente / nominal) * 100)} % del calibre): dispara en `
						+ `${segundos < 1 ? 'menos de un segundo' : `${Math.round(segundos)} s`}.`,
				});
			}
		}
	}
	// Un cortocircuito lo dispara todo lo que lo ve, y de forma instantánea: no hay que esperar a
	// que la corriente calculada lo diga, porque aquí no hay impedancias con las que calcularla.
	for (const falta of cortocircuitos) {
		for (const id of falta.proteccionesAguasArriba.slice(0, 1)) {
			const d = aparatos.find((x) => x.id === id);
			if (!d || estado[id]?.disparado === true || disparos.some((x) => x.dispositivoId === id)) continue;
			disparos.push({
				dispositivoId: id,
				designacion: d.designacion ?? id,
				motivo: 'cortocircuito',
				corriente: Number.POSITIVE_INFINITY,
				nominal: calibreDe(d) ?? 0,
				segundos: 0.01,
				rearmable: proteccionRearmable(d),
				explicacion: `Cortocircuito: ${falta.que}. Corta al instante por el magnético.`,
			});
		}
	}

	if (fuentes.length === 0) {
		avisos.push('No hay por dónde entrar la tensión: al tablero le falta una acometida. Añade un '
			+ 'aparato de campo con bornes de fase y neutro (en el catálogo, cualquier ejemplo trae una).');
	} else if (vivos.size === 0) {
		avisos.push('La acometida está, pero no llega tensión a ningún sitio: revisa que los cables salgan '
			+ 'de sus bornes de fase y neutro.');
	} else if (funcionando.length === 0) {
		/*
		 * Que no funcione nada al energizar NO es un fallo: dar tensión no arranca la maniobra,
		 * igual que subir el automático de un tablero de verdad no pone el motor en marcha.
		 *
		 * El texto sí lo era. Decía «pulsa un pulsador de marcha», y en tres de los cinco ejemplos
		 * ese pulsador va en la PUERTA, no en el riel: no tiene cuerpo que pinchar en el 3D. Quien
		 * lo leía se quedaba buscando dentro del armario un botón que no estaba, y el tablero se
		 * quedaba energizado y muerto. Ahora manda al sitio donde el mando existe siempre.
		 */
		avisos.push('Hay tensión en el tablero pero todavía no funciona nada: falta accionar algo. '
			+ 'Tienes los mandos en la lista «Mandos» de este panel —los pulsadores de marcha y paro, '
			+ 'las boyas y las protecciones—, incluidos los que van en la puerta y no se ven dentro '
			+ 'del armario.');
	}

	/*
	 * TENSIÓN EQUIVOCADA. Un piloto de 24 V cableado al circuito de 220 «funciona» en cualquier
	 * simulación que solo mire si hay o no hay tensión —y se quema en el tablero de verdad—. Aquí
	 * se compara lo que le llega con lo que declara el aparato, que es lo que hace un electricista
	 * antes de dar tensión.
	 */
	const tensionesEquivocadas: TensionEquivocada[] = [];
	for (const c of consumos) {
		const d = aparatos.find((x) => x.id === c.dispositivoId)!;
		if (!d.tensionNominal) continue;
		const recibe = tensionDeEmpleo(d, vivos);
		if (recibe === undefined) continue;
		// Un 10 % de margen: 220/230 V y 380/400 V son la misma red, no un error de cableado.
		if (Math.abs(recibe - d.tensionNominal) / d.tensionNominal <= TOLERANCIA_TENSION) continue;
		const alta = recibe > d.tensionNominal;
		tensionesEquivocadas.push({
			dispositivoId: d.id,
			designacion: c.designacion,
			recibe,
			suya: d.tensionNominal,
			que: alta
				? `le llegan ${recibe} V y es de ${d.tensionNominal} V: se quema al dar tensión`
				: `le llegan ${recibe} V y necesita ${d.tensionNominal} V: no llegará a funcionar bien`,
		});
	}
	for (const t of tensionesEquivocadas) {
		avisos.unshift(`⚠️ ${t.designacion}: ${t.que}.`);
	}

	/*
	 * PUNTA DE ARRANQUE. Un motor de jaula pide del orden de seis veces su nominal durante los
	 * primeros segundos. Es la causa nº 1 de «el automático salta cada vez que arranca la máquina»,
	 * y se ve antes de montar nada sin más que leer la curva con la punta en vez de con la nominal.
	 */
	const arranques: Arranque[] = [];
	for (const c of consumos) {
		const d = aparatos.find((x) => x.id === c.dispositivoId)!;
		if (!esMotorFuncional(d) || !c.corriente) continue;
		const punta = Math.round(c.corriente * VECES_ARRANQUE * 10) / 10;
		const protecciones: Arranque['protecciones'] = [];
		for (const carga of cargaPorAparato.values()) {
			if (carga.nominal === undefined || carga.corriente < c.corriente - 1e-9) continue;
			const p = aparatos.find((x) => x.id === carga.dispositivoId)!;
			if (!protegeSobrecorriente(p)) continue;
			protecciones.push({
				designacion: carga.designacion,
				calibre: carga.nominal,
				disparaEnS: tiempoDeDisparo(punta, carga.nominal, p.curvaDisparo),
			});
		}
		arranques.push({
			dispositivoId: d.id,
			designacion: c.designacion,
			nominal: c.corriente,
			punta,
			veces: VECES_ARRANQUE,
			duracionEstimadaS: SEGUNDOS_ARRANQUE,
			protecciones,
			// Solo cuenta como problema si dispararía DENTRO del arranque: una curva térmica que
			// tarda un minuto no molesta a un arranque de tres segundos.
			saltaAlArrancar: protecciones.some((x) => x.disparaEnS !== undefined && x.disparaEnS <= SEGUNDOS_ARRANQUE),
		});
	}
	for (const a of arranques.filter((x) => x.saltaAlArrancar)) {
		const culpable = a.protecciones.find((x) => x.disparaEnS !== undefined && x.disparaEnS <= SEGUNDOS_ARRANQUE)!;
		avisos.push(`🚦 ${a.designacion} arrancando EN DIRECTO pide ${formatearA(a.punta)} `
			+ `(${a.veces} × ${formatearA(a.nominal)}) y ${culpable.designacion} dispararía a los `
			+ `${culpable.disparaEnS!.toFixed(2)} s: el motor no llegaría a arrancar. Sube la curva del `
			+ 'automático, pon un guardamotor, o arranca en estrella-triángulo.');
	}

	if (cortocircuitos.length) {
		avisos.unshift(`⚡ CORTOCIRCUITO: ${cortocircuitos[0].que}. `
			+ (cortocircuitos[0].proteccionesAguasArriba.length
				? 'Dispara la protección de cabecera.'
				: 'Y no hay ninguna protección delante que lo corte.'));
	}
	for (const d of disparos.filter((x) => x.motivo === 'sobrecarga')) {
		avisos.push(`🔥 ${d.designacion} sobrecargado: ${d.explicacion}`);
	}

	/* ---- Lo que están haciendo los controladores programados ---- */
	const controladores: EstadoControlador[] = [];
	for (const [id, programa] of programas) {
		const d = aparatos.find((x) => x.id === id)!;
		const lectura = leerControlador(d, proyecto, vivos, estado,
			salidasDePrograma.get(id) ?? new Set(), reloj?.memoria);
		const mios = erroresPrograma.filter((e) => e.startsWith(`${d.designacion ?? d.id},`));
		const runtime = runtimesPLC.get(id)!;
		const reglasLegacy = programa.compilado.legacy?.reglas ?? [];
		const lineas = programa.config.FUENTE.split(/\r?\n/);
		const asignaciones = programa.compilado.asignaciones.map((a) => ({
			salida: a.destino,
			fuente: lineas[a.linea - 1]?.trim() ?? a.destino,
			pide: programa.compilado.etiquetas[a.destino]?.tipo === 'BOOL'
				? runtime.salidas.digitales[programa.compilado.etiquetas[a.destino]?.io?.borne ?? a.destino] ?? false : true,
			encendida: runtime.salidas.digitales[programa.compilado.etiquetas[a.destino]?.io?.borne ?? a.destino] ?? false,
		}));
		const tags: EstadoTagPLC[] = Object.values(programa.compilado.etiquetas)
			.sort((a, b) => a.nombre.localeCompare(b.nombre))
			.map((tag) => {
				const clase = tag.io?.clase ?? 'MEM';
				const borne = tag.io?.borne;
				let valor: boolean | number = runtime.variables[tag.nombre] ?? (tag.tipo === 'BOOL' ? false : 0);
				let calidad: CalidadSenalAnalogica | undefined;
				let origen: string | undefined;
				if (clase === 'DI') valor = runtime.entradas.digitales[borne!] ?? false;
				if (clase === 'DO') valor = runtime.salidas.digitales[borne!] ?? false;
				if (clase === 'AI') {
					const ai = runtime.entradas.analogicas[borne!];
					valor = ai?.valor ?? Number.NaN; calidad = ai?.calidad; origen = ai?.origen;
				}
				if (clase === 'AO') valor = runtime.salidas.analogicas[borne!] ?? 0;
				if (clase === 'MEM' && tag.nombre.includes('.')) {
					const punto = tag.nombre.lastIndexOf('.'); const bloque = tag.nombre.slice(0, punto); const miembro = tag.nombre.slice(punto + 1);
					const timer = runtime.temporizadores[bloque]; const contador = runtime.contadores[bloque];
					if (timer && miembro === 'Q') valor = timer.Q;
					if (timer && miembro === 'ET') valor = timer.ET / 1000;
					if (contador && miembro === 'Q') valor = contador.Q;
					if (contador && miembro === 'CV') valor = contador.CV;
					if (runtime.secuencias[bloque] !== undefined) valor = runtime.secuencias[bloque] === miembro;
					if (bloque === 'ALARM' && runtime.alarmas[miembro]) valor = runtime.alarmas[miembro].activa;
				}
				return {
					nombre: tag.nombre, tipo: tag.tipo, clase, borne, valor, calidad, origen,
					forzada: clase !== 'MEM' && runtime.forzadas.includes(`${clase}:${borne}`),
				};
			});
		controladores.push({
			dispositivoId: id,
			designacion: d.designacion ?? id,
			reglas: reglasLegacy.length || programa.compilado.asignaciones.length + programa.compilado.setReset.length
				+ programa.compilado.temporizadores.length + programa.compilado.contadores.length
				+ programa.compilado.transiciones.length + programa.compilado.pids.length,
			entradas: Object.entries(runtime.entradas.digitales).filter(([, activa]) => activa).map(([borne]) => borne).sort(),
			sondas: Object.fromEntries(Object.entries(runtime.entradas.analogicas)
				.flatMap(([borne, valor]) => valor.valor === undefined ? [] : [[borne, valor.valor]])),
			entradasAnalogicas: lectura.entradasAnalogicas,
			salidas: Object.entries(runtime.salidas.digitales).filter(([, activa]) => activa).map(([borne]) => borne).sort(),
			esperas: esperasLegacyPLC(programa.compilado, runtime, reloj?.ahora ?? 0),
			errores: [...mios, ...runtime.errores],
			renglones: reglasLegacy.map((r) => ({
				salida: r.salida,
				fuente: r.fuente,
				pide: evaluar(r.cuando, {
					activos: new Set(Object.entries(runtime.entradas.digitales).filter(([, v]) => v).map(([k]) => k)),
					valores: Object.fromEntries(Object.entries(runtime.entradas.analogicas)
						.flatMap(([k, v]) => v.valor === undefined ? [] : [[k, v.valor]])),
					salidasPrevias: new Set(Object.entries(runtime.salidas.digitales).filter(([, v]) => v).map(([k]) => k)),
				}),
				encendida: salidasDePrograma.get(id)?.has(r.salida) ?? false,
			})).concat(asignaciones),
			estado: runtime.estado, pausado: runtime.pausado, scan: runtime.scan,
			periodoScanMs: programa.compilado.periodoScanMs,
			primerScan: runtime.primerScanPendiente, duracionUltimoScanMs: runtime.duracionUltimoScanMs,
			variables: runtime.variables, salidasAnalogicas: runtime.salidas.analogicas,
			temporizadores: runtime.temporizadores, contadores: runtime.contadores,
			secuencias: runtime.secuencias, detalleSecuencias: runtime.detalleSecuencias,
			alarmas: runtime.alarmas, interlocks: runtime.interlocks, diagnosticos: runtime.diagnosticos,
			tags, pids: runtime.pids,
			forzadas: runtime.forzadas, eventos: runtime.eventos, io: programa.io,
		});
	}
	for (const e of erroresPrograma) avisos.push(`📝 ${e}`);

	const conductoresVivos = new Set<string>();
	for (const c of proyecto.conductores) {
		if (vivos.has(claveBorne(c.de)) && vivos.has(claveBorne(c.a))) conductoresVivos.add(c.id);
	}

	const corrienteTotal = consumos.reduce((s, c) => s + c.corriente, 0);

	/*
	 * Y lo que de verdad hay en cada salida analógica: voltios contra su común.
	 *
	 * Es el número que se mide con un multímetro en el borne, y el que hace falta para saber si
	 * el lazo de una válvula está bien. Antes no existía: la AO salía «viva a 24 V» porque se la
	 * trataba como un contacto (TS3-P1-02).
	 */
	const salidasAnalogicas: ResultadoSimulacion['salidasAnalogicas'] = new Map();
	for (const [clave, pct] of analogicas) {
		const [id, borne] = clave.split('::');
		const d = aparatos.find((x) => x.id === id);
		if (!d || !controladorAlimentado(d, vivos) || !esSalidaAnalogicaDe(d, borne)) continue;
		const salida = salidaAnalogicaEn(d, borne, pct);
		if (controladores.find((c) => c.dispositivoId === id)?.forzadas.includes(`AO:${borne}`)) {
			salida.senal.origen = 'inyectado';
		}
		salidasAnalogicas.set(clave, salida);
	}

	const protecciones = estadosProtecciones(aparatos, estado, reloj?.memoria);
	const fallos = fallosActivos(aparatos, estado, motores, protecciones, variadores);
	const entradasAnalogicas = controladores.flatMap((controlador) => controlador.entradasAnalogicas);
	const conexionesFisicas = new Map<string, [string, string][]>();
	for (const d of aparatos) {
		const manda = d.rol?.tipo === 'esclavo' ? d.rol.maestroId : d.id;
		const base = d.rol?.tipo === 'esclavo' ? { ...(estado[d.rol.maestroId] ?? {}), ...(estado[d.id] ?? {}) } : estado[d.id] ?? {};
		const salidas = salidasDePrograma.get(d.id);
		const conSalidas = salidas?.size ? { ...base, salidas: [...new Set([...(base.salidas ?? []), ...salidas])] } : base;
		conexionesFisicas.set(d.id, contactosCerrados(d, conSalidas, conmutados.has(manda)));
	}
	const fisica = simularFisicaProyecto(proyecto, {
		conexionesCerradas: conexionesFisicas, bornesEnergizados: new Set(vivos.keys()),
		fallas: Object.values(estado).flatMap((s) => s.fallasFisicas ?? []),
	});
	return {
		vivos, conductoresVivos, activos, funcionando, avisos, analogicas, salidasAnalogicas,
		pasadas, oscila: !estable,
		sinAccionar: fuentes.length > 0 && vivos.size > 0 && funcionando.length === 0,
		consumos,
		corrientePorConductor: porConductor,
		cargaPorAparato,
		corrienteTotal: Math.round(corrienteTotal * 100) / 100,
		cortocircuitos,
		disparos,
		tensionesEquivocadas,
		arranques,
		controladores, variadores, motores, protecciones, fallos, posicionesCargas,
		sensoresAnalogicos, entradasAnalogicas, actuadores,
		fisica,
		temporizadores: cuentasAtras(aparatos, activos, reloj),
	};
}

function estadosProtecciones(
	aparatos: readonly Dispositivo[],
	estado: EstadoTablero,
	memoria?: MemoriaTiempos,
): EstadoProteccion[] {
	return aparatos.flatMap((d) => {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase !== 'proteccion') return [];
		const st = estado[d.id] ?? {};
		const funcion = perfil.funcion ?? 'no-declarada';
		const cargaTermica = memoria?.protecciones?.[d.id]?.cargaTermica ?? 0;
		const disparado = st.disparado === true;
		const causa = tieneFallo(st, 'fuga-tierra') ? 'fuga-tierra' as const
			: tieneFallo(st, 'cortocircuito') ? 'cortocircuito' as const
				: tieneFallo(st, 'perdida-fase') ? 'perdida-fase' as const
					: tieneFallo(st, 'sobrecarga') ? 'sobrecarga' as const
						: disparado ? 'manual' as const : undefined;
		const abierto = st.cerrado === false;
		const estadoProteccion: EstadoProteccion['estado'] = disparado
			? funcion === 'fusible' ? 'fundido' : 'disparado'
			: abierto ? 'abierto' : cargaTermica > 0.001 ? 'calentando' : 'cerrado';
		return [{
			dispositivoId: d.id, designacion: d.designacion ?? d.id, funcion,
			estado: estadoProteccion, rearmable: perfil.rearmable,
			cargaTermica: Math.round(Math.max(0, Math.min(1, cargaTermica)) * 1000) / 1000,
			causa,
			origen: causa && causa !== 'manual' ? 'inyectado' : causa ? 'estimado' : undefined,
		}];
	});
}

function fallosActivos(
	aparatos: readonly Dispositivo[],
	estado: EstadoTablero,
	motores: readonly EstadoMotor[],
	protecciones: readonly EstadoProteccion[],
	variadores: readonly EstadoVariador[],
): (FalloRuntimeActivo & { dispositivoId: string; designacion: string })[] {
	const salida: (FalloRuntimeActivo & { dispositivoId: string; designacion: string })[] = [];
	for (const d of aparatos) for (const tipo of estado[d.id]?.fallos ?? []) {
		salida.push({
			dispositivoId: d.id, designacion: d.designacion ?? d.id, tipo,
			origen: 'inyectado', descripcion: `Condición inyectada para el ensayo: ${tipo}.`,
		});
	}
	for (const m of motores) if (m.motivoFalla === 'perdida-fase'
		&& !tieneFallo(estado[m.dispositivoId], 'perdida-fase')) {
		salida.push({
			dispositivoId: m.dispositivoId, designacion: m.designacion, tipo: 'perdida-fase',
			origen: 'calculado', descripcion: `${m.fasesPresentes}/${m.fasesRequeridas} fases eléctricamente distintas.`,
		});
	}
	for (const p of protecciones) if (p.estado === 'disparado' || p.estado === 'fundido') {
		salida.push({
			dispositivoId: p.dispositivoId, designacion: p.designacion,
			tipo: p.estado === 'fundido' ? 'fusible-fundido'
				: p.funcion === 'termico' ? 'termico-disparado' : 'proteccion-disparada',
			origen: p.origen ?? 'estimado', descripcion: p.causa ? `Actuó por ${p.causa}.` : 'Protección accionada.',
		});
	}
	for (const v of variadores) if (v.estado === 'falla') {
		const inyectado = v.motivoFalla === 'fallo-externo' || v.motivoFalla === 'subtension'
			|| v.motivoFalla === 'sobrecarga';
		salida.push({
			dispositivoId: v.dispositivoId, designacion: v.designacion, tipo: 'vfd-fault',
			origen: inyectado ? 'inyectado' : 'estimado',
			descripcion: v.motivoFalla
				? `El variador mantiene un FAULT de runtime por ${v.motivoFalla}.`
				: 'El variador mantiene un FAULT de runtime.',
		});
	}
	return salida;
}

export interface EventoProteccionRuntime {
	dispositivoId: string;
	designacion: string;
	estado: 'disparado' | 'fundido';
	causa: EstadoProteccion['causa'];
	origen: OrigenMagnitudSimulacion;
}

/**
 * Integra calentamiento/enfriamiento y devuelve el siguiente EstadoTablero runtime.
 * No modifica Proyecto. Un cortocircuito o una fuga inyectada actúan inmediatamente; una
 * sobrecarga usa la curva estimada que ya publica ResultadoSimulacion.
 */
export function actualizarProteccionesRuntime(
	proyecto: Proyecto,
	estado: EstadoTablero,
	resultado: ResultadoSimulacion,
	ahora: number,
	memoria: MemoriaTiempos,
): { estado: EstadoTablero; cambio: boolean; eventos: EventoProteccionRuntime[] } {
	memoria.protecciones ??= {};
	let siguiente = estado;
	let cambio = false;
	const eventos: EventoProteccionRuntime[] = [];
	const escribir = (id: string, st: EstadoAparato) => {
		if (siguiente === estado) siguiente = { ...estado };
		siguiente[id] = st; cambio = true;
	};
	for (const d of proyecto.dispositivos) {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase !== 'proteccion' || perfil.funcion === 'seccionamiento') continue;
		const st = siguiente[d.id] ?? {};
		let mem = memoria.protecciones[d.id] ?? { cargaTermica: 0, actualizadoEn: ahora };
		const dt = Math.max(0, ahora - mem.actualizadoEn) / 1000;
		if (st.rearmeSolicitado || st.reemplazoFusibleSolicitado) {
			mem = { cargaTermica: 0, actualizadoEn: ahora };
			const limpio = { ...st };
			delete limpio.rearmeSolicitado; delete limpio.reemplazoFusibleSolicitado;
			delete limpio.disparado; limpio.cerrado = true;
			escribir(d.id, limpio);
		}
		const estadoActual = siguiente[d.id] ?? st;
		const porCircuito = resultado.disparos.find((x) => x.dispositivoId === d.id);
		const porFisica = resultado.fisica.protecciones.get(d.id);
		const fuga = perfil.funcion === 'diferencial' && tieneFallo(estadoActual, 'fuga-tierra');
		const cortoInyectado = tieneFallo(estadoActual, 'cortocircuito');
		const sobrecargaInyectada = tieneFallo(estadoActual, 'sobrecarga')
			|| tieneFallo(estadoActual, 'perdida-fase');
		const cortoFisico = (porFisica?.fallas.length ?? 0) > 0;
		const instantaneo = fuga || cortoInyectado || porCircuito?.motivo === 'cortocircuito'
			|| (cortoFisico && porFisica?.evaluacion.region === 'INSTANTANEA');
		const ventanaFisica = porFisica?.evaluacion.tMaxS === undefined ? undefined
			: ((porFisica.evaluacion.tMinS ?? porFisica.evaluacion.tMaxS) + porFisica.evaluacion.tMaxS) / 2;
		const segundos = ventanaFisica ?? (porCircuito?.motivo === 'sobrecarga' ? porCircuito.segundos
			: sobrecargaInyectada ? 8 : undefined);
		let carga = mem.cargaTermica;
		if (instantaneo) carga = 1;
		else if (segundos !== undefined) carga = Math.min(1, carga + dt / Math.max(0.05, segundos));
		else carga = Math.max(0, carga - dt / 12);
		memoria.protecciones[d.id] = { cargaTermica: carga, actualizadoEn: ahora };
		if (carga < 1 || estadoActual.disparado) continue;
		const causa: EstadoProteccion['causa'] = fuga ? 'fuga-tierra'
			: cortoInyectado || cortoFisico || porCircuito?.motivo === 'cortocircuito' ? 'cortocircuito'
				: tieneFallo(estadoActual, 'perdida-fase') ? 'perdida-fase' : 'sobrecarga';
		escribir(d.id, { ...estadoActual, disparado: true });
		eventos.push({
			dispositivoId: d.id, designacion: d.designacion ?? d.id,
			estado: perfil.funcion === 'fusible' ? 'fundido' : 'disparado', causa,
			origen: fuga || cortoInyectado || sobrecargaInyectada ? 'inyectado' : 'estimado',
		});
	}
	return { estado: siguiente, cambio, eventos };
}

/** Calibre efectivo de un aparato de corte: el nominal, o el tope de su rango de regulación. */
function calibreDe(d: Dispositivo): number | undefined {
	if (d.corrienteNominal !== undefined && d.corrienteNominal > 0) return d.corrienteNominal;
	if (d.rangoRegulacionA?.length === 2) return d.rangoRegulacionA[1];
	return undefined;
}

/** Intensidad en palabras, con la precisión que tiene sentido leer. */
export function formatearA(a: number): string {
	if (!Number.isFinite(a)) return '∞';
	if (a >= 10) return `${a.toFixed(0)} A`;
	if (a >= 1) return `${a.toFixed(1)} A`;
	return `${(a * 1000).toFixed(0)} mA`;
}

/**
 * Hasta dónde llega UNA fuente, y por qué camino.
 *
 * Se propaga fuente por fuente en vez de todas a la vez, y guardando de qué borne viene cada
 * borne alcanzado. Eso cuesta una pasada por fuente —son cuatro o cinco— y a cambio da dos cosas
 * que antes no se podían saber:
 *
 *  - EL CAMINO DE LA CORRIENTE. Remontando los padres desde una carga hasta su fuente sale la
 *    rama entera: por qué cables va y qué protecciones atraviesa. Sin eso no hay forma de sumar
 *    intensidades ni de saber qué automático protege a qué.
 *  - LOS CORTOCIRCUITOS. Si un mismo borne lo alcanzan dos fuentes de distinto potencial —una
 *    fase y el neutro, o dos fases— es que están unidos sin carga por medio. Con una sola pasada
 *    conjunta esto era invisible: ganaba la primera que llegaba y la otra no se veía.
 */
interface Alcance {
	fuente: Fuente;
	/** Borne desde el que se llegó a cada borne. La fuente misma no tiene padre. */
	padre: Map<string, string | undefined>;
}

interface Propagacion {
	vivos: Map<string, BorneVivo>;
	alcances: Alcance[];
	/** borne → bornes vecinos por conductor, con el id del conductor que los une. */
	conductorEntre: Map<string, string>;
}

function propagar(
	proyecto: Proyecto,
	aparatos: Dispositivo[],
	fuentes: Fuente[],
	estado: EstadoTablero,
	activos: Set<string>,
	vivosPrevios: Map<string, BorneVivo>,
	conmutados: Set<string>,
	salidasDePrograma: ReadonlyMap<string, Set<string>> = new Map(),
	variadoresEnFalla: ReadonlySet<string> = new Set(),
): Propagacion {
	// Grafo: borne ↔ borne por conductores, puentes de bornero y contactos cerrados.
	const vecinos = new Map<string, string[]>();
	const conductorEntre = new Map<string, string>();
	const unir = (a: string, b: string, conductorId?: string) => {
		if (!vecinos.has(a)) vecinos.set(a, []);
		if (!vecinos.has(b)) vecinos.set(b, []);
		vecinos.get(a)!.push(b);
		vecinos.get(b)!.push(a);
		if (conductorId) {
			conductorEntre.set(`${a}>${b}`, conductorId);
			conductorEntre.set(`${b}>${a}`, conductorId);
		}
	};
	for (const c of proyecto.conductores as Conductor[]) unir(claveBorne(c.de), claveBorne(c.a), c.id);
	for (const d of aparatos) {
		for (const grupo of d.puentes ?? []) {
			for (let i = 1; i < grupo.length; i++) unir(`${d.id}::${grupo[0]}`, `${d.id}::${grupo[i]}`);
		}
		// Un controlador cierra lo que pide su programa MÁS lo que se haya forzado a mano: forzar
		// una salida es lo que hace un técnico para probar un actuador sin esperar a la maniobra.
		// Un bloque esclavo hereda el estado de su maestro (disparado, accionado, seccionado): es el
		// mismo aparato dibujado en dos sitios, no dos aparatos.
		const delMaestro = d.rol?.tipo === 'esclavo' ? estado[d.rol.maestroId] ?? {} : {};
		const suyo = { ...delMaestro, ...(estado[d.id] ?? {}) };
		const delPrograma = salidasDePrograma.get(d.id);
		let conSalidas = delPrograma?.size
			? { ...suyo, salidas: [...new Set([...(suyo.salidas ?? []), ...delPrograma])] }
			: suyo;
		// Forzar o recordar una salida no crea energía dentro de un controlador desconectado. Se usa
		// la pasada anterior porque este grafo es precisamente el que calculará la alimentación nueva.
		if (resolverComportamiento(d)?.clase === 'controlador' && !controladorAlimentado(d, vivosPrevios)) {
			conSalidas = { ...conSalidas, salidas: [] };
		}
		// Un detector alimentado no puede crear su salida activa solo porque el usuario marque que
		// está detectando. Su +V y su retorno deben existir en la pasada anterior; los contactos
		// secos, que no declaran alimentación, conservan su comportamiento mecánico.
		if (resolverComportamiento(d)?.clase === 'sensor' && !sensorAlimentado(d, vivosPrevios)) {
			conSalidas = { ...conSalidas, activo: false };
		}
		/*
		 * QUÉ BOBINA MANDA EN ESTE APARATO.
		 *
		 * Un BLOQUE DE CONTACTOS AUXILIARES no tiene bobina propia: se clipa encima de su contactor
		 * o de su relé y conmuta con él. En el modelo eso es el rol «esclavo», y aquí se le pregunta
		 * al MAESTRO. Sin esto un contacto auxiliar dibujado aparte no cerraba nunca —el bloque no
		 * tiene A1 ni A2, así que jamás aparecía en `conmutados`—, y toda maniobra hecha con un
		 * contacto suelto en otra hoja se quedaba muerta: es como se dibuja un esquema de verdad.
		 *
		 * Los contactos siguen a `conmutados` y no a la bobina: en un temporizado no es lo mismo.
		 */
		const manda = d.rol?.tipo === 'esclavo' ? d.rol.maestroId : d.id;
		for (const [a, b] of contactosCerrados(d, conSalidas, conmutados.has(manda))) {
			unir(`${d.id}::${a}`, `${d.id}::${b}`);
		}
		const perfil = resolverComportamiento(d);
		if (perfil?.clase === 'variador' && perfil.contactoFallo) {
			const enFalla = variadoresEnFalla.has(d.id);
			const cerrado = perfil.contactoFallo.reposo === 'cerrado' ? !enFalla : enFalla;
			if (cerrado) unir(`${d.id}::${perfil.contactoFallo.entrada}`,
				`${d.id}::${perfil.contactoFallo.salida}`);
		}
	}

	// Una fuente secundaria solo cuenta si su primario está alimentado en la pasada anterior: así
	// el 24 V aparece después del 220, como en la realidad.
	const activas = fuentes.filter((f) => {
		const dueño = f.clave.split('::')[0];
		const d = aparatos.find((x) => x.id === dueño);
		const perfil = d ? resolverComportamiento(d) : undefined;
		return !(d && perfil?.clase === 'fuente' && perfil.primario && !primarioAlimentado(d, vivosPrevios));
	});

	const alcances: Alcance[] = [];
	const vivos = new Map<string, BorneVivo>();
	for (const f of activas) {
		const padre = new Map<string, string | undefined>([[f.clave, undefined]]);
		const cola = [f.clave];
		while (cola.length) {
			const clave = cola.shift()!;
			for (const sig of vecinos.get(clave) ?? []) {
				if (padre.has(sig)) continue;
				padre.set(sig, clave);
				cola.push(sig);
			}
		}
		alcances.push({ fuente: f, padre });
		// `vivos` conserva su significado de siempre (una entrada por borne). Manda la fase sobre
		// el retorno: es lo que espera el resto del programa al pintar un cable «con tensión».
		for (const clave of padre.keys()) {
			const ya = vivos.get(clave);
			if (ya && !(ya.papel === 'retorno' && f.papel === 'fase')) continue;
			vivos.set(clave, { tension: f.tension, papel: f.papel, fuente: f.clave, trifasica: f.trifasica });
		}
	}
	return { vivos, alcances, conductorEntre };
}

/** ¿Tiene la bobina de este aparato tensión en A1 y retorno en A2? */
function bobinaAlimentada(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'contactos-electromagneticos') return false;
	const a1 = vivos.get(`${d.id}::${perfil.bobina.entrada}`);
	const a2 = vivos.get(`${d.id}::${perfil.bobina.retorno}`);
	if (!a1 || !a2) return false;
	// Hace falta diferencia de potencial: fase en un extremo y retorno en el otro.
	return a1.papel !== a2.papel;
}

/**
 * ¿Puede circular corriente por este consumo?
 *
 * Hay dos formas y las dos son igual de válidas, así que hay que contemplar las dos:
 *  - Monofásico: una fase por un extremo y el retorno por el otro.
 *  - Trifásico: TRES FASES DISTINTAS, sin neutro. Un motor de 380 V no tiene retorno, y pedirle
 *    uno era el error que lo dejaba parado aunque le llegaran las tres fases.
 *
 * Y tienen que ser fases distintas de verdad: si por los tres bornes entrara la misma, entre
 * ellos no hay diferencia de potencial y el motor no gira. Por eso se comparan las fuentes.
 */
function tieneCircuitoCompleto(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const perfil = resolverComportamiento(d);
	// Todo motor (nativo o importado) usa su contrato de fases. Para las demás cargas legacy se
	// conserva la lectura histórica de potenciales porque sus rótulos antiguos no siempre describen
	// roles; un perfil persistente explícito sí es fuente de verdad para cualquier carcasa.
	if (perfil?.clase === 'carga' && (d.comportamiento || perfil.efecto === 'giro')) {
		return alimentacionCompleta(d, perfil.alimentacion, vivos);
	}
	const conTension = d.bornes
		.filter((b) => b.tipo !== 'PE')
		.map((b) => vivos.get(`${d.id}::${b.id}`))
		.filter((v): v is BorneVivo => !!v);
	const fases = new Set(conTension.filter((v) => v.papel === 'fase').map((v) => v.fuente));
	const hayRetorno = conTension.some((v) => v.papel === 'retorno');
	return (fases.size >= 1 && hayRetorno) || fases.size >= 3;
}

/* ------------------------------- Temporizadores ------------------------------- */

/**
 * Decide qué relés tienen los contactos CONMUTADOS, contando el tiempo de los temporizados.
 *
 * Un relé normal conmuta en cuanto le entra tensión en la bobina, así que para él «bobina
 * alimentada» y «contactos conmutados» son lo mismo. Un temporizado no:
 *
 *  - A LA CONEXIÓN (trabajo): le entra tensión, empieza a contar y NO conmuta hasta que pasan
 *    sus segundos. Es el de la estrella-triángulo y el del arranque escalonado de una UMA.
 *  - A LA DESCONEXIÓN (reposo): conmuta al instante, y al quitarle la tensión AGUANTA sus
 *    segundos antes de soltar. Es el de la parada retardada de un extractor.
 *
 * Sin reloj —cuando se simula una sola vez, sin animación— los temporizados se comportan como
 * instantáneos: es lo razonable para responder «¿este circuito funciona?» sin esperar.
 */
function aplicarTemporizadores(
	aparatos: Dispositivo[],
	bobinasMetidas: Set<string>,
	reloj?: { ahora: number; memoria: MemoriaTiempos },
): Set<string> {
	if (!reloj) return new Set(bobinasMetidas);
	const { ahora, memoria } = reloj;
	const conmutados = new Set<string>();
	const cumplidos = new Set(memoria.cumplidos);
	for (const d of aparatos) {
		const metida = bobinasMetidas.has(d.id);
		const t = d.temporizacion;
		if (!t || t.segundos <= 0) {
			if (metida) conmutados.add(d.id);
			continue;
		}
		if (metida) {
			if (memoria.desdeConectado[d.id] === undefined) memoria.desdeConectado[d.id] = ahora;
			delete memoria.desdeSoltado[d.id];
			if (t.tipo === 'reposo') { conmutados.add(d.id); cumplidos.add(d.id); continue; }
			const llevaS = (ahora - memoria.desdeConectado[d.id]) / 1000;
			if (llevaS >= t.segundos) { conmutados.add(d.id); cumplidos.add(d.id); } else cumplidos.delete(d.id);
		} else {
			if (memoria.desdeSoltado[d.id] === undefined) memoria.desdeSoltado[d.id] = ahora;
			delete memoria.desdeConectado[d.id];
			if (t.tipo === 'trabajo') { cumplidos.delete(d.id); continue; }
			const llevaS = (ahora - memoria.desdeSoltado[d.id]) / 1000;
			if (llevaS < t.segundos) conmutados.add(d.id); else cumplidos.delete(d.id);
		}
	}
	memoria.cumplidos = [...cumplidos];
	return conmutados;
}

/** Cuentas atrás en marcha, para poder enseñarlas mientras corren. */
function cuentasAtras(
	aparatos: Dispositivo[],
	bobinasMetidas: Set<string>,
	reloj?: { ahora: number; memoria: MemoriaTiempos },
): CuentaAtras[] {
	if (!reloj) return [];
	const salida: CuentaAtras[] = [];
	for (const d of aparatos) {
		const t = d.temporizacion;
		if (!t || t.segundos <= 0) continue;
		const metida = bobinasMetidas.has(d.id);
		const inicio = metida ? reloj.memoria.desdeConectado[d.id] : reloj.memoria.desdeSoltado[d.id];
		const cuenta = (metida && t.tipo === 'trabajo') || (!metida && t.tipo === 'reposo');
		const llevaS = inicio === undefined ? 0 : (reloj.ahora - inicio) / 1000;
		salida.push({
			dispositivoId: d.id,
			designacion: d.designacion ?? d.id,
			tipo: t.tipo,
			restan: cuenta ? Math.max(0, Math.round((t.segundos - llevaS) * 10) / 10) : 0,
			total: t.segundos,
			contando: cuenta && llevaS < t.segundos,
		});
	}
	return salida;
}

/* --------------------------- Intensidades y faltas --------------------------- */

/**
 * Corriente que consume una carga en marcha, en A.
 *
 * Si la ficha del aparato la trae (`corrienteNominal`), esa manda: es la que puso el usuario o la
 * que viene del catálogo. Si no, se estima por el tipo, con valores de aparatos corrientes, para
 * que el balance no se quede en blanco — y quien quiera el número exacto lo escribe en la ficha.
 */
function corrienteDe(d: Dispositivo): number {
	if (d.corrienteNominal !== undefined && d.corrienteNominal > 0) return d.corrienteNominal;
	const perfil = resolverComportamiento(d);
	// El origen visual o el `tipo` de catálogo no puede cambiar el mismo supuesto funcional.
	// Los valores son exactamente los fallbacks legacy; solo cambia la fuente de verdad que elige
	// cuál corresponde cuando una imagen/importación declara un perfil explícito.
	if (perfil?.clase === 'carga') {
		switch (perfil.efecto) {
			case 'giro': return 3.5;
			case 'movimiento': return 0.3;
			case 'luz': return 0.02;
			case 'calor': return 6;
			case 'reactivo': return 0.5;
			case 'generico': return 0.1;
		}
	}
	switch (d.tipo) {
		case 'resistencia': return 6;
		case 'valvula': return 0.3;
		case 'piloto': return 0.02;
		case 'condensador': return 0.5;
		default: return 0.1;
	}
}

/**
 * Reparte la corriente de cada carga por el camino que recorre hasta su fuente.
 *
 * Un tablero es un árbol de ramas en paralelo colgando de la acometida, así que la corriente de
 * una carga la lleva ENTERA todo lo que hay entre ella y la fuente: sus cables, sus contactores y
 * sus protecciones. Sumando rama a rama sale lo que pasa por cada aparato, que es exactamente lo
 * que hay que saber para decir si un automático va sobrado o al límite.
 *
 * No es un cálculo de red con nudos y mallas —eso pide impedancias que un tablero no declara—,
 * pero para un cuadro de distribución es lo mismo, porque no hay caminos alternativos en paralelo.
 */
function repartirCorrientes(
	consumos: Consumo[],
	prop: Propagacion,
): { porConductor: Map<string, number>; porAparato: Map<string, number> } {
	const porConductor = new Map<string, number>();
	/*
	 * La corriente de un aparato se lleva POR FASE, no sumada.
	 *
	 * Un motor trifásico de 3,5 A hace pasar 3,5 A por cada polo de su guardamotor, no 10,5: cada
	 * polo lleva una fase. Sumar las tres daba el triple y hacía «disparar» aparatos que van
	 * sobrados. Así que se acumula por fase y al final se toma la peor, que es la que dimensiona
	 * el aparato — exactamente el criterio con el que se elige un calibre.
	 */
	const porFase = new Map<string, Map<string, number>>();
	const sumaFase = (aparato: string, fuente: string, a: number) => {
		if (!porFase.has(aparato)) porFase.set(aparato, new Map());
		const m = porFase.get(aparato)!;
		m.set(fuente, (m.get(fuente) ?? 0) + a);
	};

	for (const carga of consumos) {
		for (const alcance of prop.alcances) {
			// Solo cuenta el camino por la fase que de verdad alimenta a esta carga.
			for (const borne of carga.fases) {
				if (!alcance.padre.has(borne)) continue;
				let actual: string | undefined = borne;
				const visto = new Set<string>();
				while (actual && !visto.has(actual)) {
					visto.add(actual);
					const anterior: string | undefined = alcance.padre.get(actual);
					if (!anterior) break;
					const conductor = prop.conductorEntre.get(`${anterior}>${actual}`);
					if (conductor) porConductor.set(conductor, (porConductor.get(conductor) ?? 0) + carga.corriente);
					const dueñoA = actual.split('::')[0];
					const dueñoB = anterior.split('::')[0];
					// El aparato solo «lleva» la corriente si esta le entra por un borne y le sale
					// por otro: pasar de un borne suyo a otro suyo es atravesarlo.
					if (dueñoA === dueñoB && dueñoA !== carga.dispositivoId) {
						sumaFase(dueñoA, alcance.fuente.clave, carga.corriente);
					}
					actual = anterior;
				}
				break;   // una sola vez por carga y por fase alcanzada
			}
		}
	}
	const porAparato = new Map<string, number>();
	for (const [aparato, fases] of porFase) porAparato.set(aparato, Math.max(...fases.values()));
	return { porConductor, porAparato };
}

/**
 * Cortocircuitos: bornes a los que llegan dos potenciales distintos sin carga por medio.
 *
 * En este modelo una carga NO une sus dos bornes (un motor no es un puente), así que si a un
 * mismo punto llegan la fase y el neutro, o dos fases, es que están unidos por cable o por
 * contactos: eso es una falta, y en un tablero real dispara el automático de cabecera.
 */
function buscarCortocircuitos(prop: Propagacion, aparatos: Dispositivo[]): Cortocircuito[] {
	const faltas: Cortocircuito[] = [];
	const nombre = (clave: string): string => {
		const [id, borne] = clave.split('::');
		const d = aparatos.find((x) => x.id === id);
		return `${d?.designacion ?? id}:${borne}`;
	};
	const vistos = new Set<string>();
	for (let i = 0; i < prop.alcances.length; i++) {
		for (let j = i + 1; j < prop.alcances.length; j++) {
			const a = prop.alcances[i];
			const b = prop.alcances[j];
			// Dos tomas del mismo potencial (dos neutros del mismo transformador) no son falta.
			if (a.fuente.papel === b.fuente.papel && a.fuente.papel === 'retorno') continue;
			if (a.fuente.tension !== b.fuente.tension) continue;   // circuitos distintos (220 y 24)
			/*
			 * La falta existe cuando desde una fuente se llega a la OTRA. Y el camino que sigue la
			 * corriente de falta es justo ese: el que va de una a otra. Antes se buscaba «el primer
			 * borne común», que en un corto franco es la propia fuente —todo el trozo conductor lo
			 * es—, y remontando desde ahí no se cruzaba ninguna protección: la falta se detectaba
			 * pero no se sabía qué tenía que saltar.
			 */
			if (!a.padre.has(b.fuente.clave)) continue;
			const punto = b.fuente.clave;
			const clavePar = `${a.fuente.clave}|${b.fuente.clave}`;
			if (vistos.has(clavePar)) continue;
			vistos.add(clavePar);
			const que = a.fuente.papel !== b.fuente.papel
				? `${nombre(a.fuente.clave)} contra el retorno ${nombre(b.fuente.clave)}`
				: `${nombre(a.fuente.clave)} contra ${nombre(b.fuente.clave)} (dos fases)`;
			faltas.push({
				clave: punto,
				que,
				proteccionesAguasArriba: proteccionesEnCamino(a, punto, aparatos),
			});
		}
	}
	return faltas;
}

/** Protecciones que hay entre la fuente y un punto, de la más cercana al punto a la más lejana. */
function proteccionesEnCamino(alcance: Alcance, punto: string, aparatos: Dispositivo[]): string[] {
	const salida: string[] = [];
	const visto = new Set<string>();
	let actual: string | undefined = punto;
	while (actual && !visto.has(actual)) {
		visto.add(actual);
		const anterior: string | undefined = alcance.padre.get(actual);
		if (!anterior) break;
		const dueñoA = actual.split('::')[0];
		if (dueñoA === anterior.split('::')[0]) {
			const d = aparatos.find((x) => x.id === dueñoA);
			if (d && protegeCortocircuito(d) && !salida.includes(d.id)) salida.push(d.id);
		}
		actual = anterior;
	}
	return salida;
}

/**
 * Tiempo de disparo de una protección, en segundos, según su curva.
 *
 * Es la lectura de una curva tiempo-corriente de un magnetotérmico, simplificada a lo que hace
 * falta aquí: por debajo del calibre no dispara nunca; por encima del umbral magnético (la curva
 * B dispara a 3-5·In, la C a 5-10, la D a 10-20) corta en milisegundos; y entre medias es el
 * térmico, que tarda tanto más cuanto menos se pasa. No sustituye a la curva del fabricante —para
 * eso está la hoja de datos—, pero da el orden de magnitud correcto, que es de lo que se aprende.
 */
export function tiempoDeDisparo(corriente: number, nominal: number, curva?: string): number | undefined {
	if (nominal <= 0) return undefined;
	const veces = corriente / nominal;
	if (veces <= 1.13) return undefined;                 // corriente de no disparo convencional
	const magnetico = curva === 'B' ? 5 : curva === 'D' ? 20 : curva === 'gG' ? 8 : 10;
	if (veces >= magnetico) return 0.01;                 // corte magnético: instantáneo
	// Térmico: aproximación del tramo I²t de la curva convencional (1 h a 1,45·In).
	return Math.min(3600, 3600 / ((veces - 1) * (veces - 1) * 6.5));
}

function queHace(d: Dispositivo): string {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase === 'carga') {
		switch (perfil.efecto) {
			case 'giro': return 'girando';
			case 'movimiento': return 'abierta';
			case 'luz': return 'encendido';
			case 'calor': return 'calentando';
			case 'reactivo':
			case 'generico': return 'con tensión';
		}
	}
	switch (d.tipo) {
		case 'motor': return 'girando';
		case 'valvula': return 'abierta';
		case 'resistencia': return 'calentando';
		case 'piloto': return 'encendido';
		default: return 'con tensión';
	}
}

const igualesConjuntos = (a: Set<string>, b: Set<string>): boolean =>
	a.size === b.size && [...a].every((x) => b.has(x));

const igualesClaves = (a: Map<string, BorneVivo>, b: Map<string, BorneVivo>): boolean =>
	a.size === b.size && [...a.keys()].every((k) => b.has(k));
