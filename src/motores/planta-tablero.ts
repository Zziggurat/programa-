/**
 * DEL MUNDO AL TABLERO: convertir las máquinas que se han elegido en la cubierta en el tablero de
 * control que las gobierna.
 *
 * Es el puente entre las dos herramientas del programa, y la razón de que el visor 3D valga para
 * trabajar y no solo para mirar. En la cubierta se eligen las máquinas —«estas cuatro UMAs son
 * las de mi tablero»— y de ahí sale, ya armado: la bornera de señales con una borna por hilo y su
 * rótulo, el controlador con las entradas y salidas que hacen falta, la alimentación, y el
 * cableado entre todo ello. Lo que se hacía a mano en una hoja de cálculo, y mal.
 *
 * QUÉ ES Y QUÉ NO ES. Es un PUNTO DE PARTIDA sacado del plano, no un tablero terminado: el
 * controlador es genérico —se cambia luego por el del proyecto—, las secciones son las de una
 * instalación de señal normal, y las máquinas que el plano no rotula con sus puntos no aportan
 * nada porque no hay nada que aportar. Todo eso queda dicho en las notas del resultado, para que
 * quien lo reciba sepa qué ha hecho el programa y qué le toca a él.
 */
import { Conductor, Dispositivo, Proyecto } from '../modelo/tipos.js';
import { crearProyecto } from '../modelo/proyecto.js';
import { EquipoPlanta, Infraestructura, PuntoBMS } from '../modelo/infraestructura.js';

/* ------------------------------ Clasificar las señales ------------------------------ */

/** Familia de E/S del controlador a la que va un punto del BMS. */
export type FamiliaES = 'UI' | 'DI' | 'AO' | 'DO' | 'bus';

export const FAMILIAS: Record<FamiliaES, { nombre: string; comun: string; color: string; seccion: number }> = {
	UI: { nombre: 'Entradas universales (sondas)', comun: 'UIC', color: 'blanco', seccion: 0.5 },
	DI: { nombre: 'Entradas digitales (estados y alarmas)', comun: 'DIC', color: 'gris', seccion: 0.75 },
	AO: { nombre: 'Salidas analógicas (válvulas y compuertas)', comun: 'AOC', color: 'naranjo', seccion: 0.75 },
	DO: { nombre: 'Salidas digitales (marcha/paro)', comun: 'DOC', color: 'violeta', seccion: 0.75 },
	bus: { nombre: 'Bus de comunicación', comun: 'SHLD', color: 'azul', seccion: 0.5 },
};

/**
 * A qué familia de E/S va un punto, por la clase que le puso el extractor del plano.
 *
 * Una sonda de temperatura y una entrada de alarma no se cablean igual ni ocupan el mismo tipo de
 * terminal, y confundirlas es lo que hace que después no quepan las señales en el controlador.
 */
export function familiaDePunto(p: PuntoBMS): FamiliaES {
	const c = p.clase.toLowerCase();
	if (c.includes('entrada') && c.includes('anal')) return 'UI';
	if (c.includes('entrada')) return 'DI';
	if (c.includes('salida') && c.includes('anal')) return 'AO';
	if (c.includes('salida')) return 'DO';
	return 'bus';   // «red» y «controlador»: van al bus, no a una E/S
}

/** Cuántos puntos de cada familia hay en un conjunto de máquinas. */
export function contarES(equipos: EquipoPlanta[]): Record<FamiliaES, number> {
	const n: Record<FamiliaES, number> = { UI: 0, DI: 0, AO: 0, DO: 0, bus: 0 };
	for (const e of equipos) for (const p of e.puntos) n[familiaDePunto(p)]++;
	return n;
}

/* -------------------------------- La lista de señales -------------------------------- */

/** Una línea de la lista de señales: un hilo que sale de una máquina y entra al tablero. */
export interface Senal {
	tag: string;
	sigla: string;
	que: string;
	familia: FamiliaES;
	/** Terminal del controlador al que va (UI1, DO3…). */
	terminal: string;
	/** Nº de borna de la bornera de esa máquina. */
	borna: string;
	/** Nº de borna del común que le acompaña. */
	bornaComun: string;
	seccion: number;
}

/**
 * La lista de señales de un conjunto de máquinas: qué hilo va de dónde a dónde.
 *
 * Se reparten los terminales del controlador POR FAMILIA y en el orden en que salen las máquinas,
 * que es como se cablea de verdad: todas las sondas juntas, todas las válvulas juntas. Así la
 * bornera queda ordenada y el que conecta no anda saltando de un lado a otro de la regleta.
 */
export function listaDeSenales(equipos: EquipoPlanta[]): Senal[] {
	const siguiente: Record<FamiliaES, number> = { UI: 0, DI: 0, AO: 0, DO: 0, bus: 0 };
	const senales: Senal[] = [];
	for (const e of equipos) {
		let borna = 0;
		for (const p of e.puntos) {
			const familia = familiaDePunto(p);
			if (familia === 'bus') continue;   // el bus no ocupa bornas de señal
			siguiente[familia]++;
			senales.push({
				tag: e.tag,
				sigla: p.sigla,
				que: p.que,
				familia,
				terminal: `${familia}${siguiente[familia]}`,
				borna: String(++borna),
				bornaComun: String(++borna),
				seccion: FAMILIAS[familia].seccion,
			});
		}
	}
	return senales;
}

/* ------------------------------- Armar el tablero ------------------------------- */

export interface ResultadoPuente {
	proyecto: Proyecto;
	senales: Senal[];
	/** Qué ha hecho el programa y qué NO: se enseña tal cual antes de aceptar. */
	notas: string[];
	/** Máquinas que se pedían y no aportan nada porque el plano no dibuja sus puntos. */
	sinPuntos: string[];
	bornas: number;
}

/** Redondea al tamaño de bloque en que se venden las E/S: 4, 8, 12, 16… */
const aBloque = (n: number): number => Math.max(4, Math.ceil(n / 4) * 4);

const CTRL_ANCHO = 138;
const CTRL_ALTO = 110;

/**
 * Arma el tablero de control de las máquinas elegidas.
 *
 * `tags` manda el orden: las máquinas salen en la bornera en el mismo orden en que se
 * seleccionaron, no en el que estaban en el archivo.
 */
export function tableroDesdeEquipos(
	inf: Infraestructura, tags: string[], nombre?: string,
): ResultadoPuente {
	const porTag = new Map(inf.equipos.map((e) => [e.tag, e]));
	const pedidos = tags.map((t) => porTag.get(t)).filter((e): e is EquipoPlanta => !!e);
	const sinPuntos = pedidos.filter((e) => e.puntos.length === 0).map((e) => e.tag);
	const equipos = pedidos.filter((e) => e.puntos.length > 0);
	const senales = listaDeSenales(equipos);
	const es = contarES(equipos);

	const titulo = nombre ?? (equipos.length === 1
		? `Tablero de control de ${equipos[0].tag}`
		: `Tablero de control · ${equipos.length} máquinas de la cubierta`);
	/*
	 * NO se declaran Icc, ambiente ni montaje.
	 *
	 * Estaban puestos —6 kA, 40 °C, mural— y no salen de ninguna parte: el plano no los trae y
	 * nadie los ha medido. Al declararlos, el DRC verificaba el poder de corte contra una Icc
	 * inventada y la placa de características los imprimía como si fueran datos del proyecto. Un
	 * supuesto del programa presentado como dato confirmado es peor que no tener el dato: sin él
	 * la placa dice «a declarar» y quien la firma sabe que le toca medirlo.
	 */
	const p = crearProyecto(titulo);
	p.datos = {
		obra: inf.nombre,
		notas: `Generado desde el plano ${inf.origen.archivo} con las máquinas: `
			+ `${equipos.map((e) => e.tag).join(', ')}.`,
	};
	p.hojas = [
		{ id: 'h1', numero: 1, titulo: 'Alimentación 220/24 V' },
		{ id: 'h2', numero: 2, titulo: 'Señales de campo' },
	];

	/* --- Alimentación: acometida, protección y fuente de 24 V --- */
	/*
	 * LA CARGA QUE SE CALCULA Y LA FUENTE QUE SE ELIGE SON DOS COSAS DISTINTAS.
	 *
	 * Tercera auditoría, TS3-P1-03. Antes se creaba SIEMPRE la misma fuente —referencia
	 * `STEP-PS/1AC/24DC/2.5`, que es un modelo de 2,5 A— y se le SOBRESCRIBÍA la corriente
	 * nominal con la carga estimada. Con las 120 máquinas de la cubierta salía esto:
	 *
	 *     referencia: STEP-PS/1AC/24DC/2.5   ·   corrienteNominal: 37 A
	 *
	 * El mismo aparato presentado a la vez como un modelo de 2,5 A y como uno de 37: catorce
	 * veces y media. Y no es un problema de rotulado. La lista de material lleva esa referencia,
	 * alguien la pide, y lo que llega no aguanta ni la décima parte de la carga.
	 *
	 * Ahora la carga estimada es un dato del proyecto —no la placa del componente— y la fuente se
	 * ELIGE de un catálogo real que cubra esa carga con su reserva. Si ninguna llega, se dice en
	 * las notas y el DRC lo marca: es mejor un tablero que declara que le falta fuente que uno
	 * que miente sobre la que lleva.
	 */
	const RESERVA_FUENTE = 1.25;   // 25 % de margen, que es lo que se deja en un cuadro de clima
	const consumoFuente = 0.15 + 0.05 * senales.length;     // el DDC más lo que cuelga de él
	const cargaConReserva = consumoFuente * RESERVA_FUENTE;
	/** Fuentes de carril DIN de 24 V CC que existen de verdad, de menor a mayor. */
	const CATALOGO_FUENTES: { referencia: string; amperios: number; disipacionW: number }[] = [
		{ referencia: 'STEP-PS/1AC/24DC/2.5', amperios: 2.5, disipacionW: 6 },
		{ referencia: 'STEP-PS/1AC/24DC/5', amperios: 5, disipacionW: 10 },
		{ referencia: 'QUINT4-PS/1AC/24DC/10', amperios: 10, disipacionW: 18 },
		{ referencia: 'QUINT4-PS/1AC/24DC/20', amperios: 20, disipacionW: 32 },
		{ referencia: 'QUINT4-PS/1AC/24DC/40', amperios: 40, disipacionW: 60 },
	];
	const elegida = CATALOGO_FUENTES.find((f) => f.amperios >= cargaConReserva);
	const fuente = elegida ?? CATALOGO_FUENTES[CATALOGO_FUENTES.length - 1];
	/** El automático de cabecera se dimensiona con la fuente, no con un 6 A fijo. */
	const calibreCabecera = [6, 10, 16].find((a) => a >= (fuente.amperios * 24 * 1.3) / 220 * 1.5) ?? 16;
	const dispositivos: Dispositivo[] = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 220 V + PE', campo: true,
			tensionNominal: 220, hojaId: 'h1',
			bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'PE', tipo: 'PE' }],
		},
		{
			id: 'q1', tipo: 'disyuntor',
			descripcion: `Automático 2P C${calibreCabecera} (protege el tablero)`,
			fabricante: 'Schneider Electric', referencia: `iC60N 2P C${calibreCabecera}`,
			tensionNominal: 220,
			corrienteNominal: calibreCabecera, curvaDisparo: 'C', poderCorteKA: 6, poderCorteEstimado: true,
			disipacionW: 2.5, disipacionEstimada: true, hojaId: 'h1',
			bornes: [
				{ id: '1', tipo: 'L', obligatorio: true }, { id: '2', tipo: 'L', obligatorio: true },
				{ id: '3', tipo: 'N', obligatorio: true }, { id: '4', tipo: 'N', obligatorio: true },
			],
		},
		{
			id: 'g1', tipo: 'fuente',
			descripcion: `Fuente 220 V / 24 V CC ${fuente.amperios} A`
				+ ` (carga estimada ${Math.round(consumoFuente * 100) / 100} A + 25 % de reserva)`,
			fabricante: 'Phoenix Contact', referencia: fuente.referencia,
			/*
			 * LAS DOS TENSIONES, DECLARADAS. Una fuente tiene primario y secundario, y aquí se
			 * declaraba solo `tensionNominal: 24`. Con eso, sus bornes L/N —que están a 220 y van
			 * atornillados a la salida del automático— se leían a 24, y el DRC avisaba de un
			 * «conflicto 24/220» en el tablero que el propio programa acababa de armar. La
			 * convención es la del catálogo: `tensionNominal` es la de ENTRADA.
			 */
			tensionNominal: 220, tensionSecundariaV: 24,
			// La corriente nominal es la DE LA PLACA del modelo elegido, no la carga calculada.
			corrienteNominal: fuente.amperios,
			disipacionW: fuente.disipacionW, disipacionEstimada: true, hojaId: 'h1',
			// El LADO va declarado. `+24` y `0V` son los rótulos de una fuente de 24 V CC de
			// verdad, pero la simulación buscaba el secundario por el id (`+V`/`-V`) y este no
			// existía para ella: el PLC, los cuatro borneros y las máquinas quedaban sin tensión
			// en un tablero que el propio programa acababa de armar.
			bornes: [
				{ id: 'L', tipo: 'L', obligatorio: true, lado: 'primario' },
				{ id: 'N', tipo: 'N', obligatorio: true, lado: 'primario' },
				{ id: 'PE', tipo: 'PE' },
				{ id: '+24', tipo: 'control', obligatorio: true, lado: 'secundario+' },
				{ id: '0V', tipo: 'control', obligatorio: true, lado: 'secundario-' },
			],
		},
	];

	/* --- El controlador, dimensionado por las señales que de verdad hay --- */
	const nUI = aBloque(es.UI);
	const nDI = aBloque(es.DI);
	const nAO = aBloque(es.AO);
	const nDO = aBloque(es.DO);
	const serie = (pre: string, n: number): { id: string; tipo: 'senal' }[] =>
		Array.from({ length: n }, (_, i) => ({ id: `${pre}${i + 1}`, tipo: 'senal' as const }));
	dispositivos.push({
		id: 'a1', tipo: 'plc',
		descripcion: `Controlador de campo ${nUI} UI · ${nDI} DI · ${nAO} AO · ${nDO} DO`,
		fabricante: 'Genérico', referencia: 'DDC-24V', tensionNominal: 24,
		corrienteNominal: 0.15, disipacionW: 5, disipacionEstimada: true, hojaId: 'h2',
		bornes: [
			{ id: '24V~', tipo: 'control', obligatorio: true },
			{ id: '24V COM', tipo: 'control', obligatorio: true },
			{ id: 'GND', tipo: 'PE' },
			{ id: 'MS/TP+', tipo: 'senal' }, { id: 'MS/TP-', tipo: 'senal' }, { id: 'SHLD', tipo: 'senal' },
			...serie('UI', nUI), { id: 'UIC', tipo: 'control' },
			...serie('DI', nDI), { id: 'DIC', tipo: 'control' },
			...serie('AO', nAO), { id: 'AOC', tipo: 'control' },
			...serie('DO', nDO), { id: 'DOC', tipo: 'control' },
		],
		/*
		 * LO QUE EL DDC TIENE PUENTEADO POR DENTRO.
		 *
		 * `UIC`, `DIC` y `AOC` no son terminales sueltos: son la referencia de señal del aparato,
		 * y por dentro cuelgan del común de 24 V. Sin declararlo, los comunes de las máquinas
		 * llegaban a un terminal que no estaba conectado a nada y ninguna señal tenía retorno.
		 *
		 * `DOC` NO va aquí a propósito: es el terminal por el que entra la tensión que conmutan
		 * los triacs, y se alimenta por fuera desde el vivo de 24 V (el cable está más abajo). Si
		 * se puentease aquí, el mando y su retorno quedarían en el mismo punto y la máquina no
		 * vería tensión entre sus dos bornas.
		 */
		puentesInternos: [['24V COM', 'UIC'], ['24V COM', 'DIC'], ['24V COM', 'AOC']]
			.filter(([, c]) => (c === 'UIC' && nUI) || (c === 'DIC' && nDI) || (c === 'AOC' && nAO))
			.map(([a, b]) => [a, b] as [string, string]),
		// El rango de las salidas analógicas, declarado: sin él, un 50 % no significa nada. Es lo
		// que permite decir «AO1 está a 5 V» en vez de «AO1 está viva». TS3-P1-02.
		rangoSalidaAnalogica: [0, 10],
		rasgosFrente: { display: false, leds: 4, puertosRS485: 1 },
		profundidad: 57,
	});

	/* --- Una bornera por máquina, con su rótulo y sus comunes puenteados --- */
	const conductores: Conductor[] = [];
	let nc = 0;
	const cable = (
		de: [string, string], a: [string, string], seccion: number, color: string,
	): void => {
		conductores.push({
			id: `w${++nc}`,
			de: { dispositivoId: de[0], borneId: de[1] },
			a: { dispositivoId: a[0], borneId: a[1] },
			seccion, color,
		});
	};

	cable(['red', 'L'], ['q1', '1'], 1.5, 'marrón');
	cable(['red', 'N'], ['q1', '3'], 1.5, 'azul');
	cable(['q1', '2'], ['g1', 'L'], 1.5, 'marrón');
	cable(['q1', '4'], ['g1', 'N'], 1.5, 'azul');
	cable(['red', 'PE'], ['g1', 'PE'], 1.5, 'verde/amarillo');
	cable(['g1', '+24'], ['a1', '24V~'], 1, 'rojo');
	cable(['g1', '0V'], ['a1', '24V COM'], 1, 'negro');
	// La masa del controlador NO se deja al aire: va a la tierra de la fuente. Un DDC sin GND
	// conectado lee las sondas con ruido y da lecturas que no son.
	// La tierra del controlador va con la misma sección que la fase que alimenta la fuente: un
	// conductor de protección no se adelgaza (IEC 60364-5-54), y el DRC lo comprueba.
	cable(['a1', 'GND'], ['g1', 'PE'], 1.5, 'verde/amarillo');

	/*
	 * BORNERA DE COMUNES. Una borna admite dos hilos, así que los comunes de cuatro máquinas no
	 * caben en el terminal UIC del controlador: se juntan en una regleta puenteada —un peine— y de
	 * ella sale UN hilo al controlador. Es exactamente lo que se hace en un tablero, y es lo que
	 * el DRC reclamaba al ver tres conductores en la misma borna.
	 */
	const ORDEN: FamiliaES[] = ['UI', 'DI', 'AO', 'DO'];
	/** Qué familias usa cada máquina: solo esas necesitan una borna en el peine. */
	const familiasDe = (tag: string): FamiliaES[] =>
		ORDEN.filter((f) => senales.some((s) => s.tag === tag && s.familia === f));
	const familiasUsadas = ORDEN.filter((f) => senales.some((s) => s.familia === f));
	/** Borna del peine que le toca a cada (familia, máquina). La última de cada peine, al DDC. */
	const bornaDelPeine = new Map<string, string>();
	let bornas = 0;
	if (familiasUsadas.length) {
		const bornesComunes: { id: string; tipo: 'control' }[] = [];
		const grupos: string[][] = [];
		for (const f of familiasUsadas) {
			const usan = equipos.filter((e) => familiasDe(e.tag).includes(f));
			// Una borna por máquina que use la familia, más la que sale al controlador.
			const ids = [...usan.map((_, i) => `${f}C${i + 1}`), `${f}C${usan.length + 1}`];
			usan.forEach((e, i) => bornaDelPeine.set(`${f}|${e.tag}`, ids[i]));
			bornaDelPeine.set(`${f}|`, ids[ids.length - 1]);
			grupos.push(ids);
			for (const id of ids) bornesComunes.push({ id, tipo: 'control' });
		}
		dispositivos.push({
			id: 'x0', tipo: 'bornero', descripcion: 'Comunes de señal (un peine por familia)',
			fabricante: 'Phoenix Contact', referencia: 'UT 2,5', hojaId: 'h2',
			bornes: bornesComunes, puentes: grupos,
		});
		bornas += bornesComunes.length;
		/*
		 * DÓNDE ACABA CADA PEINE. No todos van al mismo sitio, y tratarlos igual dejaba el circuito
		 * de mando sin cerrar:
		 *
		 * - UI, DI y AO son SEÑALES: su común es la referencia del controlador, y el peine sube al
		 *   terminal `UIC`/`DIC`/`AOC`, que por dentro cuelga del común de 24 V.
		 * - DO es MANDO: el triac saca tensión por `DO1` y la máquina tiene que devolverla al
		 *   COMÚN DE LA FUENTE, no al terminal por el que esa misma tensión entró. El peine de
		 *   los DO va, por tanto, a `g1::0V`, y `DOC` se alimenta del vivo de 24 V.
		 *
		 * Con el peine de DO atornillado a `DOC`, la ida y la vuelta del mando eran el mismo punto:
		 * la máquina no veía tensión entre sus dos bornas por mucho que el controlador cerrase.
		 */
		for (const f of familiasUsadas) {
			const destino: [string, string] = f === 'DO' ? ['g1', '0V'] : ['a1', FAMILIAS[f].comun];
			cable(['x0', bornaDelPeine.get(`${f}|`)!], destino, FAMILIAS[f].seccion, 'negro');
		}
		// El común de los triacs, alimentado del vivo de 24 V: es lo que conmutan las salidas.
		if (familiasUsadas.includes('DO')) cable(['g1', '+24'], ['a1', 'DOC'], FAMILIAS.DO.seccion, 'rojo');
	}

	equipos.forEach((e, i) => {
		const mias = senales.filter((s) => s.tag === e.tag);
		if (mias.length === 0) return;
		const borneroId = `x${i + 1}`;
		const campoId = `m${i + 1}`;
		// La máquina, tal cual está en la cubierta: un aparato de campo con un borne por señal.
		dispositivos.push({
			id: campoId, tipo: e.tipo === 'uma' ? 'otro' : 'motor', clase: e.tipo === 'uma' ? 'B' : 'M',
			descripcion: `${e.tag} · ${e.tipo === 'uma' ? 'manejadora de aire' : 'extractor'} en cubierta`,
			campo: true, tensionNominal: 24, hojaId: 'h2',
			bornes: mias.flatMap((s) => ([
				{ id: s.sigla, tipo: 'senal' as const },
				{ id: `${s.sigla}/C`, tipo: 'control' as const },
			])),
		});
		// Y su bornera: dos bornas por señal —hilo y común—, con los comunes puenteados POR FAMILIA.
		// No todos juntos: el común de las entradas analógicas y el de las salidas digitales son
		// terminales distintos del controlador, y unirlos aquí sería puentearlos por detrás.
		dispositivos.push({
			id: borneroId, tipo: 'bornero',
			descripcion: `Señales de ${e.tag}`,
			fabricante: 'Phoenix Contact', referencia: 'UT 2,5', hojaId: 'h2',
			bornes: mias.flatMap((s) => ([
				{ id: s.borna, tipo: 'senal' as const },
				{ id: s.bornaComun, tipo: 'control' as const },
			])),
			puentes: familiasDe(e.tag)
				.map((f) => mias.filter((s) => s.familia === f).map((s) => s.bornaComun))
				.filter((g) => g.length > 1),
		});
		bornas += mias.length * 2;
		for (const s of mias) {
			const col = FAMILIAS[s.familia].color;
			cable([campoId, s.sigla], [borneroId, s.borna], s.seccion, col);
			cable([campoId, `${s.sigla}/C`], [borneroId, s.bornaComun], s.seccion, 'negro');
			cable([borneroId, s.borna], ['a1', s.terminal], s.seccion, col);
		}
		// El común de cada familia sale UNA vez de la bornera de la máquina —para eso está el
		// puente— y va a su borna del peine de comunes, no directo al controlador.
		for (const familia of familiasDe(e.tag)) {
			const primera = mias.find((s) => s.familia === familia)!;
			cable([borneroId, primera.bornaComun], ['x0', bornaDelPeine.get(`${familia}|${e.tag}`)!],
				primera.seccion, 'negro');
		}
	});

	p.dispositivos = dispositivos;
	p.conductores = conductores;
	p.gabinete = armarGabinete(dispositivos, equipos.length);

	const notas = [
		`${equipos.length} máquina${equipos.length === 1 ? '' : 's'} · ${senales.length} señales · ${bornas} bornas.`,
		`Controlador dimensionado a ${nUI} UI, ${nDI} DI, ${nAO} AO y ${nDO} DO (hacen falta `
		+ `${es.UI}, ${es.DI}, ${es.AO} y ${es.DO}).`,
		'El controlador es GENÉRICO: cámbialo por el del proyecto en el catálogo, que las bornas '
		+ 'y el cableado se conservan.',
		'Las secciones son las de una instalación de señal (0,5 y 0,75 mm²) y la alimentación va a '
		+ '1,5 mm². Revisa la caída de tensión con las distancias reales de tu tirada.',
		'Quedan SIN DECLARAR la Icc presunta, la temperatura ambiente y el montaje del armario: '
		+ 'el plano no los trae y el programa no se los inventa. Ponlos en Archivo → Datos del '
		+ 'proyecto; de ellos dependen la verificación del poder de corte y el balance térmico.',
	];
	if (es.bus > 0) {
		notas.push(`${es.bus} punto${es.bus === 1 ? '' : 's'} del plano son de bus o de otro `
			+ 'controlador (LON, TCC): no ocupan bornas de señal y no se han cableado.');
	}
	if (sinPuntos.length) {
		notas.push(`Sin bornas para ${sinPuntos.join(', ')}: el plano no dibuja su diagrama de control.`);
	}
	if (inf.alturasSupuestas) {
		notas.push('Las posiciones del plano son de planta; las alturas del visor son de proyecto. '
			+ 'Eso no afecta a este tablero, pero sí a cualquier metraje que saques del 3D.');
	}
	/*
	 * Los supuestos de alimentación, DICHOS. Tercera auditoría, TS3-P1-03: el generador fijaba
	 * 220/24 V, un C6 y referencias comerciales exactas sin pedir antes datos de suministro,
	 * reserva ni criterio de protección. Se siguen suponiendo —hay que armar algo— pero ahora se
	 * dice cuáles son, para que quien firma sepa qué tiene que confirmar.
	 */
	notas.push(`Alimentación supuesta: 220 V monofásica, fuente de 24 V CC y automático de `
		+ `cabecera C${calibreCabecera}. Carga de señales estimada en `
		+ `${Math.round(consumoFuente * 100) / 100} A; con un 25 % de reserva se ha elegido una `
		+ `fuente de ${fuente.amperios} A. Confírmalo con el suministro real de la obra.`);
	if (!elegida) {
		notas.push(`⚠️ NINGUNA fuente del catálogo cubre los ${Math.round(cargaConReserva * 10) / 10} A `
			+ `que pide este conjunto. Se ha puesto la mayor (${fuente.amperios} A) y NO basta: `
			+ 'hay que repartir las máquinas en varios tableros o alimentarlas en grupos.');
	}
	return { proyecto: p, senales, notas, sinPuntos, bornas };
}

/**
 * Reparte los aparatos en la placa: alimentación arriba, controlador en medio y las borneras
 * abajo, con canaleta entre filas. No pretende ser el montaje definitivo —eso se ajusta en el
 * editor arrastrando— pero sí uno que quepa y que se entienda al abrirlo.
 */
function armarGabinete(dispositivos: Dispositivo[], cuantasMaquinas: number): Proyecto['gabinete'] {
	const borneros = dispositivos.filter((d) => d.tipo === 'bornero');
	// Una borna de 2,5 mm² mide 5,2 mm de ancho; se redondea a 6 con sus topes.
	const anchoBornero = (d: Dispositivo): number => Math.max(40, d.bornes.length * 6 + 20);
	const anchoBorneros = borneros.reduce((s, d) => s + anchoBornero(d) + 20, 0);
	const filasBorneros = Math.max(1, Math.ceil(anchoBorneros / 520));
	const ancho = Math.max(500, Math.min(800, anchoBorneros / filasBorneros + 80));
	const alto = 300 + filasBorneros * 170;

	const rieles = [
		{ id: 'r1', x: 30, y: 90, largo: ancho - 60 },
		{ id: 'r2', x: 30, y: 250, largo: ancho - 60 },
		...Array.from({ length: filasBorneros }, (_, i) => ({
			id: `r${i + 3}`, x: 30, y: 400 + i * 170, largo: ancho - 60,
		})),
	];
	const canaletas = [
		{ id: 'c1', x: 20, y: 165, largo: ancho - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
		{ id: 'c2', x: 20, y: 320, largo: ancho - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
		...Array.from({ length: filasBorneros }, (_, i) => ({
			id: `c${i + 3}`, x: 20, y: 470 + i * 170, largo: ancho - 40,
			orientacion: 'h' as const, ancho: 40, alto: 60,
		})),
	];

	const colocaciones = [
		{ dispositivoId: 'q1', x: 40, y: 50, ancho: 36, alto: 80, rielId: 'r1' },
		{ dispositivoId: 'g1', x: 110, y: 45, ancho: 55, alto: 90, rielId: 'r1' },
		{ dispositivoId: 'a1', x: 40, y: 250 - CTRL_ALTO / 2, ancho: CTRL_ANCHO, alto: CTRL_ALTO, rielId: 'r2' },
	];
	let x = 40;
	let fila = 0;
	for (const d of borneros) {
		const an = anchoBornero(d);
		if (x + an > ancho - 30 && fila < filasBorneros - 1) { fila++; x = 40; }
		colocaciones.push({
			dispositivoId: d.id, x, y: 400 + fila * 170 - 25, ancho: an, alto: 50,
			rielId: `r${fila + 3}`,
		});
		x += an + 20;
	}
	// Sin máquinas no hay borneras: la placa se queda con la alimentación y el controlador.
	return { ancho, alto: cuantasMaquinas ? alto : 400, rieles, canaletas, colocaciones };
}
