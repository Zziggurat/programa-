/**
 * El DOSSIER que se entrega al cliente: qué apartados lleva y qué le añade a mano quien lo firma.
 *
 * El dossier lo genera el programa desde el tablero —eso es lo que lo hace fiel—, pero un
 * documento que se entrega no es solo una volcada de datos: lleva una carta de presentación,
 * lleva las fotos que hagan falta, y a veces NO lleva algún apartado porque a ese cliente no le
 * interesa. Eso es lo que se guarda aquí.
 *
 * QUÉ VIVE EN EL NÚCLEO Y QUÉ NO. Aquí está el modelo y el REPARTO DEL TEXTO EN LÍNEAS, que es la
 * parte con lógica de verdad: cortar un párrafo donde cabe, sabiendo que dentro puede haber
 * trozos en negrita, en cursiva, de otro tamaño y de otra fuente, y que una palabra suelta puede
 * no caber ni ella sola. Lo que NO vive aquí es nada que sepa de jsPDF ni del DOM: el ancho de
 * cada palabra lo mide quien llama, y por eso esto se puede probar sin navegador.
 */

/** Las tres fuentes que trae el PDF sin incrustar nada: son las de siempre y pesan cero. */
export type FuenteDossier = 'helvetica' | 'times' | 'courier';

export const FUENTES: { id: FuenteDossier; nombre: string }[] = [
	{ id: 'helvetica', nombre: 'Helvetica (de palo seco)' },
	{ id: 'times', nombre: 'Times (con remates)' },
	{ id: 'courier', nombre: 'Courier (de máquina)' },
];

export const TAMANOS = [8, 9, 10, 11, 12, 14, 16, 18, 22, 28];

/** Un trozo de texto con su formato. Un párrafo es una lista de estos. */
export interface TrozoTexto {
	texto: string;
	negrita?: boolean;
	cursiva?: boolean;
	/** Tamaño en puntos. Si falta, el del bloque. */
	tam?: number;
	fuente?: FuenteDossier;
}

/** El formato de un trozo, ya resuelto (sin huecos). */
export interface EstiloTrozo {
	negrita: boolean;
	cursiva: boolean;
	tam: number;
	fuente: FuenteDossier;
}

/** Algo que el usuario añade al dossier: un texto suyo o una imagen. */
export interface BloqueDossier {
	id: string;
	tipo: 'texto' | 'imagen';
	/** Título del apartado, opcional. */
	titulo?: string;
	/** Contenido con formato (tipo 'texto'). */
	trozos?: TrozoTexto[];
	/** Imagen en data URL (tipo 'imagen'). */
	imagen?: string;
	/** Pie de foto. */
	pie?: string;
	/** Ancho de la imagen, en % del ancho útil de la página. */
	anchoPct?: number;
	/** Dónde va: en la portada, antes de los apartados generados, o al final. */
	donde: 'portada' | 'principio' | 'final';
}

/**
 * La empresa que FIRMA el dossier.
 *
 * Sin esto el documento sale rotulado «TableroStudio», que es el nombre de la herramienta y no le
 * dice nada al cliente. Un dossier se entrega en nombre de alguien: quien lo entrega pone aquí su
 * nombre, su logo y cómo localizarle, y eso es lo que aparece en la portada y en cada página.
 */
export interface EmpresaDossier {
	nombre?: string;
	/** Logo en data URL. Va pequeño en la cabecera de cada página y grande en la portada. */
	logo?: string;
	/** Cómo localizar a quien firma: teléfono, correo, web, RUT… Una línea. */
	contacto?: string;
}

/** Tamaños de papel. Carta es lo corriente en Chile; A4, en Europa. */
export type PapelDossier = 'a4' | 'carta';

export const PAPELES: { id: PapelDossier; nombre: string }[] = [
	{ id: 'a4', nombre: 'A4 (210 × 297 mm)' },
	{ id: 'carta', nombre: 'Carta (216 × 279 mm)' },
];

/** Azul del programa: el color por defecto del documento cuando nadie pone el suyo. */
export const COLOR_POR_DEFECTO = '#2b4a6f';

/** Lo que el usuario decide sobre el dossier, y que se guarda con el proyecto. */
export interface AjustesDossier {
	/** Apartados generados que salen. Si un id falta, sale (todo sale por defecto). */
	secciones?: Record<string, boolean>;
	/**
	 * Orden en que salen los apartados generados, por id. Los que no se nombren van detrás en su
	 * orden natural, así que añadir un apartado nuevo al programa nunca rompe un dossier guardado.
	 */
	orden?: string[];
	/** Lo que añade quien firma: textos e imágenes. */
	bloques?: BloqueDossier[];
	/** Quién firma el documento. */
	empresa?: EmpresaDossier;
	/** Color del documento en #rrggbb: cabeceras, títulos y filetes. */
	color?: string;
	/** Tamaño de papel. Por defecto A4. */
	papel?: PapelDossier;
}

/** El color del documento como componentes 0-255, listo para jsPDF. */
export function colorDossier(ajustes: AjustesDossier | undefined): [number, number, number] {
	const hex = ajustes?.color;
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return [43, 74, 111];
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

/**
 * Tinta que se lee sobre ese fondo: casi negro si el fondo es claro, blanco si es oscuro.
 *
 * Hace falta porque el color lo elige el usuario: con un corporativo amarillo, el texto blanco de
 * la cabecera desaparecía. Se usa la luminancia percibida, que pesa más el verde porque el ojo
 * también lo hace.
 */
export function tintaSobre(fondo: [number, number, number]): [number, number, number] {
	const luz = (fondo[0] * 299 + fondo[1] * 587 + fondo[2] * 114) / 1000;
	return luz > 150 ? [20, 24, 28] : [255, 255, 255];
}

/**
 * Los apartados que genera el programa, en el orden en que salen.
 *
 * `fijo` marca los que NO se pueden quitar: la procedencia de los datos y la verificación son lo
 * que hace defendible el documento. Quitar la verificación de un dossier sería entregarlo
 * escondiendo si el tablero tiene faltas, y el programa no va a ayudar a eso.
 */
export const SECCIONES_DOSSIER: { id: string; nombre: string; fijo?: boolean }[] = [
	{ id: 'procedencia', nombre: 'Procedencia de los datos', fijo: true },
	{ id: 'ficha', nombre: '1. Ficha del tablero' },
	{ id: 'placa', nombre: '2. Disposición de la placa' },
	{ id: 'bom', nombre: '3. Lista de materiales (BOM)' },
	{ id: 'aparatos', nombre: '4. Índice de aparatos' },
	{ id: 'conductores', nombre: '5. Lista de conductores' },
	{ id: 'referencias', nombre: '6. Referencias cruzadas' },
	{ id: 'termico', nombre: '7. Balance térmico' },
	{ id: 'drc', nombre: 'Verificación eléctrica (DRC)', fijo: true },
	{ id: 'anexo', nombre: 'Anexo A · Placa de características' },
];

/** ¿Sale este apartado? Todo sale salvo que se haya apagado a propósito, y los fijos siempre. */
export function saleSeccion(ajustes: AjustesDossier | undefined, id: string): boolean {
	if (SECCIONES_DOSSIER.find((s) => s.id === id)?.fijo) return true;
	return ajustes?.secciones?.[id] !== false;
}

/**
 * Los apartados en el orden en que los quiere quien firma.
 *
 * Los que el orden guardado no nombre se van detrás, conservando su orden natural. Así un dossier
 * guardado el año pasado sigue abriéndose bien cuando el programa estrena un apartado nuevo: ese
 * aparece al final en vez de desaparecer del documento sin que nadie se entere.
 */
export function seccionesOrdenadas(
	ajustes: AjustesDossier | undefined,
): typeof SECCIONES_DOSSIER {
	const orden = ajustes?.orden;
	if (!orden?.length) return [...SECCIONES_DOSSIER];
	const puesto = new Map(orden.map((id, i) => [id, i]));
	return [...SECCIONES_DOSSIER].sort((a, b) =>
		(puesto.get(a.id) ?? Infinity) - (puesto.get(b.id) ?? Infinity)
		|| SECCIONES_DOSSIER.indexOf(a) - SECCIONES_DOSSIER.indexOf(b));
}

/** Los bloques que van en un sitio concreto del dossier, en su orden. */
export function bloquesEn(
	ajustes: AjustesDossier | undefined, donde: BloqueDossier['donde'],
): BloqueDossier[] {
	return (ajustes?.bloques ?? []).filter((b) => b.donde === donde);
}

/* ------------------------- Reparto del texto en líneas ------------------------- */

const POR_DEFECTO: EstiloTrozo = { negrita: false, cursiva: false, tam: 10, fuente: 'helvetica' };

/** Resuelve el formato de un trozo contra el del bloque. */
export function estiloDe(t: TrozoTexto, base: Partial<EstiloTrozo> = {}): EstiloTrozo {
	return {
		negrita: t.negrita ?? base.negrita ?? POR_DEFECTO.negrita,
		cursiva: t.cursiva ?? base.cursiva ?? POR_DEFECTO.cursiva,
		tam: t.tam ?? base.tam ?? POR_DEFECTO.tam,
		fuente: t.fuente ?? base.fuente ?? POR_DEFECTO.fuente,
	};
}

/** Un trozo ya colocado en una línea, con su formato resuelto. */
export interface TrozoColocado {
	texto: string;
	estilo: EstiloTrozo;
	/** Ancho en mm, tal como lo midió quien llamó. */
	ancho: number;
}

export interface LineaTexto {
	trozos: TrozoColocado[];
	/** Alto de la línea en mm: lo marca el trozo más grande que lleve. */
	alto: number;
}

/** Cuánto ocupa de alto una línea de texto de `tam` puntos, en mm (interlineado 1,35). */
export function altoDeLinea(tam: number): number {
	return (tam * 0.3528) * 1.35;
}

/**
 * Reparte un párrafo con formato mezclado en líneas que caben en `anchoMm`.
 *
 * Corta por espacios, que es como se lee. Si una palabra sola no cabe —una referencia larga, una
 * URL— se deja sobresalir en su propia línea en vez de partirla por la mitad: partir una
 * referencia de catálogo la vuelve ilegible, y una línea larga se ve y se arregla.
 *
 * `medir` lo pone quien llama (jsPDF sabe medir con su fuente cargada); así esto no depende de
 * nada y se puede probar con una regla de mentira.
 */
export function repartirEnLineas(
	trozos: TrozoTexto[],
	anchoMm: number,
	medir: (texto: string, estilo: EstiloTrozo) => number,
	base: Partial<EstiloTrozo> = {},
): LineaTexto[] {
	const lineas: LineaTexto[] = [];
	let actual: TrozoColocado[] = [];
	let usado = 0;

	const cerrar = (): void => {
		if (actual.length === 0) return;
		const tam = Math.max(...actual.map((t) => t.estilo.tam));
		lineas.push({ trozos: actual, alto: altoDeLinea(tam) });
		actual = [];
		usado = 0;
	};

	for (const trozo of trozos) {
		const estilo = estiloDe(trozo, base);
		// Los saltos de línea explícitos mandan sobre el reparto: si alguien pulsó Intro, ahí va.
		const parrafos = trozo.texto.split('\n');
		parrafos.forEach((parrafo, i) => {
			if (i > 0) { cerrar(); if (parrafo === '') lineas.push({ trozos: [], alto: altoDeLinea(estilo.tam) }); }
			if (parrafo === '') return;
			/*
			 * Se separan PALABRAS y ESPACIOS como piezas distintas, no «palabra con su cola».
			 * Con la cola pegada se perdía el espacio que hay entre dos trozos de formato
			 * distinto —«…UMA-3-343» en negrita seguido de « con controlador…»— y el cliente
			 * recibía «UMA-3-343con controlador». Así el espacio es una pieza más: se queda si va
			 * en medio de una línea y se cae si queda al principio de la siguiente.
			 */
			for (const pieza of parrafo.match(/\s+|\S+/g) ?? []) {
				const ancho = medir(pieza, estilo);
				if (/^\s+$/.test(pieza)) {
					// Un espacio nunca obliga a saltar de línea, y al principio de una no pinta nada.
					if (usado > 0) { actual.push({ texto: pieza, estilo, ancho }); usado += ancho; }
					continue;
				}
				if (usado > 0 && usado + ancho > anchoMm) cerrar();
				actual.push({ texto: pieza, estilo, ancho });
				usado += ancho;
			}
		});
	}
	cerrar();
	return lineas;
}

/** Alto total en mm que ocuparía un párrafo repartido. */
export function altoDelTexto(lineas: LineaTexto[]): number {
	return lineas.reduce((s, l) => s + l.alto, 0);
}

/** Texto plano de unos trozos, para resúmenes y para las pruebas. */
export function textoPlano(trozos: TrozoTexto[] | undefined): string {
	return (trozos ?? []).map((t) => t.texto).join('');
}

/* ------------------------- Lo que las fuentes del PDF saben escribir ------------------------- */

/**
 * El dossier usa las tres fuentes que jsPDF trae de serie, que pesan cero pero solo saben escribir
 * WinAnsi (Latin-1 y poco más). Un carácter fuera de ahí no sale mal: sale ROTO —el texto aparece
 * estirado de lado a lado de la celda y cortado a la mitad—, porque además de no dibujarlo, la
 * medida del ancho deja de cuadrar con lo que se pinta.
 *
 * Se descubrió con un aparato del ejemplo cuya descripción es «Temporizador a la conexión, 6 s
 * (estrella→triángulo)»: esa flecha reventaba la fila entera de la tabla de componentes. Y no es
 * un caso raro —una flecha, un ✓, un Ω o un ≤ los escribe cualquiera al describir un aparato—.
 *
 * La alternativa sería incrustar una fuente Unicode, que son cientos de kB en un programa que se
 * entrega como UN archivo. Se prefiere traducir: lo que tiene equivalente se escribe como se diría
 * en un plano («->», «ohm», «<="»), y lo que no —los emojis— se quita. Un dossier se lee, no se
 * decora.
 */
const TRADUCCIONES: Record<string, string> = {
	'→': '->', '⇒': '=>', '←': '<-', '⇐': '<=', '↔': '<->', '↑': 'arriba', '↓': 'abajo',
	'✓': 'OK', '✔': 'OK', '✗': 'X', '✘': 'X', '✕': 'x',
	'≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '∞': 'inf.',
	'Ω': 'ohm', 'Δ': 'triangulo', 'δ': 'd', 'Φ': 'F', 'φ': 'f', 'π': 'pi', 'λ': 'lambda',
	'∅': 'diam.', '∙': '·', '‑': '-', '−': '-', '─': '-',
	'㎡': 'm2', '½': '1/2', '¼': '1/4', '¾': '3/4',
};

/** Los caracteres de 0x80 a 0x9F que WinAnsi SÍ tiene (los demás huecos de ese tramo no existen). */
const EXTRA_WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/**
 * Deja un texto en algo que las fuentes del PDF saben escribir.
 *
 * Lo que se puede decir de otra manera se traduce; lo que no, se quita. Nunca devuelve algo que el
 * PDF no pueda dibujar, que es justo el punto.
 */
export function aWinAnsi(texto: string): string {
	let salida = '';
	for (const c of texto) {
		const code = c.codePointAt(0) ?? 0;
		if (code === 9 || code === 10 || (code >= 32 && code <= 126)) { salida += c; continue; }
		if (code >= 160 && code <= 255) { salida += c; continue; }
		if (EXTRA_WINANSI.includes(c)) { salida += c; continue; }
		salida += TRADUCCIONES[c] ?? '';
	}
	return salida;
}
