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
 * LOS CONTROLADORES EJECUTAN SU PROGRAMA. Un PLC del tablero ya no es un adorno: se le escribe la
 * maniobra en renglones —«DO1 = DI1 Y NO DI2 retardo 5»— y sus salidas se encienden solas dentro
 * del mismo punto fijo que todo lo demás. Tiene que ser dentro, y no antes: una salida del
 * controlador mueve un contactor, y el contacto de ese contactor puede ser justo la entrada que el
 * programa está mirando. El lenguaje está en `logica.ts`.
 *
 * Lo que esto sigue sin ser: no resuelve la red con impedancias, y el programa del controlador es
 * lógica con tiempos, no IEC 61131-3 —no hay bloques de función ni PID—. Las corrientes son las de
 * empleo declaradas, no el resultado de un cálculo de cortocircuito.
 */
import { Conductor, Dispositivo, Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import { claveBorne } from '../modelo/proyecto.js';
import {
	EsperaLogica, LecturaControlador, MemoriaLogica, ReglaLogica, esperasDe, evaluar, leerPrograma,
	memoriaLogicaVacia, salidasActivas, valoresAnalogicos,
} from './logica.js';

/** Estado que el usuario controla de cada aparato. */
export interface EstadoAparato {
	/** Protecciones y seccionadores: si está armado (cerrado) o abierto. Por defecto, cerrado. */
	cerrado?: boolean;
	/** Protecciones: disparado por una falta. Un aparato disparado no conduce aunque esté armado. */
	disparado?: boolean;
	/** Pulsadores y sensores: activado ahora mismo (pulsado, detectando). */
	activo?: boolean;
	/** Salidas de un controlador que el usuario fuerza a ON, por su id de borne. */
	salidas?: string[];
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
}

export function memoriaVacia(): MemoriaTiempos {
	return { desdeConectado: {}, desdeSoltado: {}, cumplidos: [] };
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
	/** Temporizadores contando ahora mismo, para poder enseñar la cuenta atrás. */
	temporizadores: CuentaAtras[];
	/** Consumos que están recibiendo una tensión distinta de la suya. */
	tensionesEquivocadas: TensionEquivocada[];
	/** Punta de arranque de los motores en marcha y si la protección la aguanta. */
	arranques: Arranque[];
	/** Lo que están haciendo los controladores programados del tablero. */
	controladores: EstadoControlador[];
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
	/** Salidas que el programa tiene encendidas. */
	salidas: string[];
	/** Salidas esperando su retardo o sostenidas por su tiempo mínimo. */
	esperas: EsperaLogica[];
	/** Renglones que no se han podido leer, con su explicación. */
	errores: string[];
	/** Renglón a renglón: qué pide cada uno y si se está cumpliendo AHORA. */
	renglones: RenglonEnMarcha[];
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

const MAX_PASADAS = 24;

/**
 * Veces la corriente nominal que pide un motor de jaula al arrancar en directo, y cuánto dura.
 *
 * Seis veces es el orden de magnitud de un motor asíncrono normal (IEC 60034 da entre 5 y 8 según
 * la clase de arranque); tres segundos es lo que tarda en coger vueltas una carga corriente. No
 * son los de un motor concreto —eso está en su placa— pero sí los que hacen ver el problema.
 */
const VECES_ARRANQUE = 6;
const SEGUNDOS_ARRANQUE = 3;

/**
 * Tensión que le está llegando de verdad a un consumo.
 *
 * Entre fase y retorno es la de la fuente. Entre TRES FASES distintas es la compuesta, que es √3
 * veces la de fase: un motor conectado a las tres fases de una red de 220 V por fase trabaja a
 * 380, y confundirlo sería decirle a alguien que su motor de 380 está mal conectado cuando está
 * perfecto.
 */
function tensionDeEmpleo(d: Dispositivo, vivos: Map<string, BorneVivo>): number | undefined {
	const conTension = d.bornes
		.filter((b) => b.tipo !== 'PE')
		.map((b) => vivos.get(`${d.id}::${b.id}`))
		.filter((v): v is BorneVivo => !!v);
	if (conTension.length === 0) return undefined;
	const fases = conTension.filter((v) => v.papel === 'fase');
	if (fases.length === 0) return undefined;
	const distintas = new Set(fases.map((v) => v.fuente));
	const sistema = Math.max(...fases.map((v) => v.tension));
	// Entre tres fases se trabaja a la tensión COMPUESTA, que es la declarada del sistema.
	if (distintas.size >= 3) return sistema;
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
	if (d.tipo === 'plc' && estado.salidas?.length) {
		const comun = d.bornes.find((b) => b.id === '+24' || b.id === '+V')?.id;
		if (comun) for (const s of estado.salidas) if (idsBornes.has(s)) pares.push([comun, s]);
	}
	return pares;
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
		if (d.imagen) continue;
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
			const mas = d.bornes.find((b) => b.id === '+V' || b.id === 'S1');
			const menos = d.bornes.find((b) => b.id === '-V' || b.id === 'S2');
			// El secundario de un transformador de mando o de una fuente es monofásico.
			if (mas) fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: mas.id }), tension, papel: 'fase', trifasica: false });
			if (menos) fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: menos.id }), tension, papel: 'retorno', trifasica: false });
		}
	}
	return fuentes;
}

/**
 * Qué tensión reparte el secundario de un transformador o de una fuente.
 *
 * Antes esto devolvía 24 SIEMPRE —la expresión era `d.tensionNominal === 220 ? 24 : 24`, que da
 * 24 mire por donde se mire—, así que un transformador de mando de 380/110 V se simulaba como si
 * sacara 24. Ahora manda el dato declarado; si no lo hay, se lee de la descripción, que es donde
 * de verdad está escrito en casi todos los catálogos («Transformador 220/24 V 3 A»); y si tampoco,
 * se supone 24, que es lo más común en control.
 */
export function tensionSecundariaDe(d: Dispositivo): number {
	if (d.tensionSecundariaV && d.tensionSecundariaV > 0) return d.tensionSecundariaV;
	const m = /(\d{2,4})\s*\/\s*(\d{1,4})\s*V/i.exec(d.descripcion ?? '');
	if (m) {
		const secundario = Number(m[2]);
		if (secundario > 0 && secundario < Number(m[1])) return secundario;
	}
	return 24;
}

/** ¿Está alimentado el primario de esta fuente/transformador? */
function primarioAlimentado(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const entradas = d.bornes.filter((b) => b.tipo === 'L' || b.id === 'P1' || b.id === 'L');
	const retornos = d.bornes.filter((b) => b.tipo === 'N' || b.id === 'P2');
	const hayFase = entradas.some((b) => vivos.get(claveBorne({ dispositivoId: d.id, borneId: b.id }))?.papel === 'fase');
	const hayRetorno = retornos.some((b) => vivos.has(claveBorne({ dispositivoId: d.id, borneId: b.id })));
	return hayFase && hayRetorno;
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
): LecturaControlador {
	const activos = new Set<string>();
	const valores: Record<string, number> = {};
	for (const b of d.bornes) {
		if (vivos.has(`${d.id}::${b.id}`)) activos.add(b.id);
		if (esBorneDeAlimentacion(b)) continue;
		const v = sondaCableadaA(d.id, b.id, proyecto, estado);
		if (v !== undefined) valores[b.id] = v;
	}
	return { activos, valores, salidasPrevias };
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

/**
 * Qué sonda hay al final del hilo de esta entrada, ATRAVESANDO LOS BORNEROS.
 *
 * Antes esto miraba solo el aparato que había al otro lado del conductor, y en un tablero de
 * verdad al otro lado NUNCA hay una sonda: hay una borna. Todo lo que va a campo pasa por el
 * bornero —para eso está—, así que el controlador se quedaba sin lectura en cuanto el tablero se
 * cableaba como se cablea. Ahora se sigue el hilo de borna en borna, incluidos los puentes del
 * peine, hasta dar con un aparato que entregue un número.
 *
 * Solo se atraviesan borneros: un contacto o una bobina en medio cortan la búsqueda, porque
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
			if (porId.get(dueño)?.tipo !== 'bornero') continue;
			for (const grupo of porId.get(dueño)?.puentes ?? []) {
				if (!grupo.includes(borne)) continue;
				for (const otro of grupo) {
					const clave = `${dueño}::${otro}`;
					if (!vistos.has(clave)) { vistos.add(clave); cola.push(clave); }
				}
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
	const aparatos = proyecto.dispositivos.filter((d) => !d.imagen);
	const fuentes = fuentesDe(proyecto);

	/*
	 * EL PROGRAMA DE LOS CONTROLADORES.
	 *
	 * Se lee una vez y se EJECUTA dentro del punto fijo, no antes: una salida del controlador
	 * mueve un contactor, el contactor cierra un contacto, y ese contacto puede ser justo la
	 * entrada que el programa está mirando. Resolverlo fuera del bucle dejaría el controlador
	 * viendo el tablero de la pasada anterior.
	 */
	const programas = new Map<string, ReglaLogica[]>();
	const erroresPrograma: string[] = [];
	for (const d of aparatos) {
		if (d.tipo !== 'plc' || !d.programa?.trim()) continue;
		const leido = leerPrograma(d.programa);
		programas.set(d.id, leido.reglas);
		for (const e of leido.errores) {
			erroresPrograma.push(`${d.designacion ?? d.id}, renglón ${e.linea}: ${e.que} («${e.texto}»)`);
		}
	}
	const memoriaLogica = reloj?.logica ?? memoriaLogicaVacia();
	/*
	 * Las salidas del programa son ESTADO del circuito, igual que una bobina metida, y viajan por
	 * el mismo sitio: `activos`, con la clave «plc::DO1». Sin esto un programa que se realimenta
	 * —«DO1 = (DI1 O DO1) Y NO DI2», el enclavamiento hecho en el controlador y no con relés— se
	 * caía al soltar la marcha, porque cada llamada empezaba sin saber qué había encendido antes.
	 */
	const salidasDePrograma = new Map<string, Set<string>>();
	for (const id of programas.keys()) {
		const previas = new Set<string>();
		for (const clave of activosPrevios ?? []) {
			if (clave.startsWith(`${id}::`)) previas.add(clave.slice(id.length + 2));
		}
		salidasDePrograma.set(id, previas);
	}
	const esperasPrograma: (EsperaLogica & { dispositivoId: string; designacion: string })[] = [];

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
	let prop: Propagacion = { vivos, alcances: [], conductorEntre: new Map() };

	while (pasadas < MAX_PASADAS && !estable) {
		pasadas++;
		prop = propagar(proyecto, aparatos, fuentes, estado, activos, vivos, conmutados, salidasDePrograma);
		const nuevosVivos = prop.vivos;
		// Los controladores leen su tablero y deciden sus salidas ANTES de la siguiente pasada.
		for (const [id, reglas] of programas) {
			const d = aparatos.find((x) => x.id === id)!;
			const lectura = leerControlador(d, proyecto, nuevosVivos, estado,
				salidasDePrograma.get(id) ?? new Set());
			salidasDePrograma.set(id, salidasActivas(reglas, lectura,
				reloj ? { ahora: reloj.ahora, memoria: memoriaLogica } : undefined));
			// Y lo que valen sus salidas analógicas: la apertura de una válvula, la velocidad de un
			// variador. No encienden nada, así que no entran en la propagación.
			for (const [borne, v] of Object.entries(valoresAnalogicos(reglas, lectura))) {
				analogicas.set(`${id}::${borne}`, v);
			}
		}
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
		estable = igualesClaves(vivos, nuevosVivos) && igualesConjuntos(activos, nuevosActivos);
		vivos = nuevosVivos;
		activos = nuevosActivos;
	}

	// Lo que se VE funcionando: consumos con tensión en sus dos extremos, y bobinas metidas.
	const funcionando: ResultadoSimulacion['funcionando'] = [];
	const avisos: string[] = [];
	const consumos: Consumo[] = [];
	for (const d of aparatos) {
		const etiqueta = d.designacion ?? d.id;
		if (CONSUME.has(d.tipo)) {
			if (tieneCircuitoCompleto(d, vivos)) {
				activos.add(d.id);
				const corriente = corrienteDe(d);
				funcionando.push({
					dispositivoId: d.id,
					designacion: etiqueta,
					que: `${queHace(d)} · ${formatearA(corriente)}`,
				});
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

	/* ---- Lo que consume el tablero: intensidades por rama, faltas y disparos ---- */
	const { porConductor, porAparato } = repartirCorrientes(consumos, prop);
	const cortocircuitos = buscarCortocircuitos(prop, aparatos);
	const cargaPorAparato = new Map<string, CargaAparato>();
	const disparos: Disparo[] = [];
	const PROTEGE = new Set<TipoDispositivo>(['disyuntor', 'diferencial', 'guardamotor', 'fusible', 'rele']);
	for (const d of aparatos) {
		const corriente = porAparato.get(d.id) ?? 0;
		if (corriente === 0 && !PROTEGE.has(d.tipo)) continue;
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
		if (PROTEGE.has(d.tipo) && nominal && estado[d.id]?.disparado !== true) {
			const segundos = tiempoDeDisparo(corriente, nominal, d.curvaDisparo);
			if (segundos !== undefined) {
				disparos.push({
					dispositivoId: d.id,
					designacion: d.designacion ?? d.id,
					motivo: 'sobrecarga',
					corriente: Math.round(corriente * 100) / 100,
					nominal,
					segundos,
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
		avisos.push('Hay tensión en el tablero pero nada está funcionando todavía. Pulsa un pulsador de '
			+ 'marcha, o cierra el contacto que alimenta la bobina.');
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
		if (Math.abs(recibe - d.tensionNominal) / d.tensionNominal <= 0.1) continue;
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
		if (d.tipo !== 'motor' || !c.corriente) continue;
		const punta = Math.round(c.corriente * VECES_ARRANQUE * 10) / 10;
		const protecciones: Arranque['protecciones'] = [];
		for (const carga of cargaPorAparato.values()) {
			if (carga.nominal === undefined || carga.corriente < c.corriente - 1e-9) continue;
			const p = aparatos.find((x) => x.id === carga.dispositivoId)!;
			if (!PROTEGE.has(p.tipo)) continue;
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
	for (const [id, reglas] of programas) {
		const d = aparatos.find((x) => x.id === id)!;
		const lectura = leerControlador(d, proyecto, vivos, estado, salidasDePrograma.get(id) ?? new Set());
		const mios = erroresPrograma.filter((e) => e.startsWith(`${d.designacion ?? d.id},`));
		controladores.push({
			dispositivoId: id,
			designacion: d.designacion ?? id,
			reglas: reglas.length,
			entradas: [...lectura.activos].sort(),
			sondas: lectura.valores,
			salidas: [...(salidasDePrograma.get(id) ?? [])].sort(),
			esperas: esperasDe(reglas, lectura, reloj ? { ahora: reloj.ahora, memoria: memoriaLogica } : undefined),
			errores: mios,
			renglones: reglas.map((r) => ({
				salida: r.salida,
				fuente: r.fuente,
				pide: evaluar(r.cuando, lectura),
				encendida: salidasDePrograma.get(id)?.has(r.salida) ?? false,
			})),
		});
	}
	for (const e of erroresPrograma) avisos.push(`📝 ${e}`);

	const conductoresVivos = new Set<string>();
	for (const c of proyecto.conductores) {
		if (vivos.has(claveBorne(c.de)) && vivos.has(claveBorne(c.a))) conductoresVivos.add(c.id);
	}

	const corrienteTotal = consumos.reduce((s, c) => s + c.corriente, 0);

	return {
		vivos, conductoresVivos, activos, funcionando, avisos, analogicas,
		pasadas, oscila: !estable,
		consumos,
		corrientePorConductor: porConductor,
		cargaPorAparato,
		corrienteTotal: Math.round(corrienteTotal * 100) / 100,
		cortocircuitos,
		disparos,
		tensionesEquivocadas,
		arranques,
		controladores,
		temporizadores: cuentasAtras(aparatos, activos, reloj),
	};
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
		const conSalidas = delPrograma?.size
			? { ...suyo, salidas: [...new Set([...(suyo.salidas ?? []), ...delPrograma])] }
			: suyo;
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
	}

	// Una fuente secundaria solo cuenta si su primario está alimentado en la pasada anterior: así
	// el 24 V aparece después del 220, como en la realidad.
	const activas = fuentes.filter((f) => {
		const dueño = f.clave.split('::')[0];
		const d = aparatos.find((x) => x.id === dueño);
		return !(d && (d.tipo === 'fuente' || d.tipo === 'transformador') && !primarioAlimentado(d, vivosPrevios));
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
	if (d.tipo !== 'contactor' && d.tipo !== 'rele') return false;
	const a1 = vivos.get(`${d.id}::A1`);
	const a2 = vivos.get(`${d.id}::A2`);
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
	switch (d.tipo) {
		case 'motor': return 3.5;
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
	const ES_PROTECCION = new Set<TipoDispositivo>(['disyuntor', 'diferencial', 'guardamotor', 'fusible']);
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
			if (d && ES_PROTECCION.has(d.tipo) && !salida.includes(d.id)) salida.push(d.id);
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
