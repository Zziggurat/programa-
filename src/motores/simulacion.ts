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
 * Lo que esto NO es: no calcula intensidades, ni tiempos de disparo, ni ejecuta el programa de un
 * PLC. Dice qué está con tensión y qué está funcionando, que es lo que se quiere ver.
 */
import { Conductor, Dispositivo, Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import { claveBorne } from '../modelo/proyecto.js';

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
}

export type EstadoTablero = Record<string, EstadoAparato>;

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
	// Un controlador cierra la salida que el usuario haya forzado, contra su propio común.
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
 */
export function polosDe(d: Dispositivo): [string, string][] {
	if (d.puentesInternos?.length) return d.puentesInternos.map(([a, b]) => [a, b] as [string, string]);
	const ids = new Set(d.bornes.map((b) => b.id));
	const pares: [string, string][] = [];
	// Bornes numerados a secas: 1-2, 3-4, 5-6…
	for (let i = 1; i <= 11; i += 2) {
		if (ids.has(String(i)) && ids.has(String(i + 1))) pares.push([String(i), String(i + 1)]);
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

interface Fuente { clave: string; tension: number; papel: 'fase' | 'retorno' }

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
			for (const b of d.bornes) {
				if (b.tipo === 'L') fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: b.id }), tension, papel: 'fase' });
				if (b.tipo === 'N') fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: b.id }), tension, papel: 'retorno' });
			}
		}
		// Secundario de una fuente o un transformador: su salida es una fuente nueva, pero SOLO si
		// su primario está alimentado. Eso lo resuelve la iteración; aquí solo se declara.
		if (d.tipo === 'fuente' || d.tipo === 'transformador') {
			const tension = d.tipo === 'fuente' ? 24 : (d.tensionNominal === 220 ? 24 : 24);
			const mas = d.bornes.find((b) => b.id === '+V' || b.id === 'S1');
			const menos = d.bornes.find((b) => b.id === '-V' || b.id === 'S2');
			if (mas) fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: mas.id }), tension, papel: 'fase' });
			if (menos) fuentes.push({ clave: claveBorne({ dispositivoId: d.id, borneId: menos.id }), tension, papel: 'retorno' });
		}
	}
	return fuentes;
}

/** ¿Está alimentado el primario de esta fuente/transformador? */
function primarioAlimentado(d: Dispositivo, vivos: Map<string, BorneVivo>): boolean {
	const entradas = d.bornes.filter((b) => b.tipo === 'L' || b.id === 'P1' || b.id === 'L');
	const retornos = d.bornes.filter((b) => b.tipo === 'N' || b.id === 'P2');
	const hayFase = entradas.some((b) => vivos.get(claveBorne({ dispositivoId: d.id, borneId: b.id }))?.papel === 'fase');
	const hayRetorno = retornos.some((b) => vivos.has(claveBorne({ dispositivoId: d.id, borneId: b.id })));
	return hayFase && hayRetorno;
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
): ResultadoSimulacion {
	const aparatos = proyecto.dispositivos.filter((d) => !d.imagen);
	const fuentes = fuentesDe(proyecto);

	let vivos = new Map<string, BorneVivo>();
	let activos = new Set<string>(activosPrevios ?? []);
	let pasadas = 0;
	let estable = false;

	while (pasadas < MAX_PASADAS && !estable) {
		pasadas++;
		const nuevosVivos = propagar(proyecto, aparatos, fuentes, estado, activos, vivos);
		const nuevosActivos = new Set<string>();
		for (const d of aparatos) {
			if (bobinaAlimentada(d, nuevosVivos)) nuevosActivos.add(d.id);
		}
		estable = igualesClaves(vivos, nuevosVivos) && igualesConjuntos(activos, nuevosActivos);
		vivos = nuevosVivos;
		activos = nuevosActivos;
	}

	// Lo que se VE funcionando: consumos con tensión en sus dos extremos, y bobinas metidas.
	const funcionando: ResultadoSimulacion['funcionando'] = [];
	const avisos: string[] = [];
	for (const d of aparatos) {
		const etiqueta = d.designacion ?? d.id;
		if (CONSUME.has(d.tipo)) {
			if (tieneCircuitoCompleto(d, vivos)) {
				activos.add(d.id);
				funcionando.push({ dispositivoId: d.id, designacion: etiqueta, que: queHace(d) });
			}
		} else if (activos.has(d.id)) {
			funcionando.push({ dispositivoId: d.id, designacion: etiqueta, que: 'bobina alimentada, contactos cambiados' });
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

	const conductoresVivos = new Set<string>();
	for (const c of proyecto.conductores) {
		if (vivos.has(claveBorne(c.de)) && vivos.has(claveBorne(c.a))) conductoresVivos.add(c.id);
	}

	return {
		vivos, conductoresVivos, activos, funcionando, avisos,
		pasadas, oscila: !estable,
	};
}

/** Una pasada de propagación con los contactos que corresponden al estado actual. */
function propagar(
	proyecto: Proyecto,
	aparatos: Dispositivo[],
	fuentes: Fuente[],
	estado: EstadoTablero,
	activos: Set<string>,
	vivosPrevios: Map<string, BorneVivo>,
): Map<string, BorneVivo> {
	// Grafo: borne ↔ borne por conductores, puentes de bornero y contactos cerrados.
	const vecinos = new Map<string, string[]>();
	const unir = (a: string, b: string) => {
		if (!vecinos.has(a)) vecinos.set(a, []);
		if (!vecinos.has(b)) vecinos.set(b, []);
		vecinos.get(a)!.push(b);
		vecinos.get(b)!.push(a);
	};
	for (const c of proyecto.conductores as Conductor[]) unir(claveBorne(c.de), claveBorne(c.a));
	for (const d of aparatos) {
		for (const grupo of d.puentes ?? []) {
			for (let i = 1; i < grupo.length; i++) unir(`${d.id}::${grupo[0]}`, `${d.id}::${grupo[i]}`);
		}
		for (const [a, b] of contactosCerrados(d, estado[d.id] ?? {}, activos.has(d.id))) {
			unir(`${d.id}::${a}`, `${d.id}::${b}`);
		}
	}

	// Anchura desde cada fuente. Una fuente secundaria solo cuenta si su primario está alimentado
	// en la pasada anterior: así el 24 V aparece después del 220, como en la realidad.
	const vivos = new Map<string, BorneVivo>();
	const cola: { clave: string; v: BorneVivo }[] = [];
	for (const f of fuentes) {
		const dueño = f.clave.split('::')[0];
		const d = aparatos.find((x) => x.id === dueño);
		if (d && (d.tipo === 'fuente' || d.tipo === 'transformador') && !primarioAlimentado(d, vivosPrevios)) continue;
		const v: BorneVivo = { tension: f.tension, papel: f.papel, fuente: f.clave };
		vivos.set(f.clave, v);
		cola.push({ clave: f.clave, v });
	}
	while (cola.length) {
		const { clave, v } = cola.shift()!;
		for (const sig of vecinos.get(clave) ?? []) {
			if (vivos.has(sig)) continue;
			vivos.set(sig, v);
			cola.push({ clave: sig, v });
		}
	}
	return vivos;
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
