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

/** Lo que el usuario decide sobre el dossier, y que se guarda con el proyecto. */
export interface AjustesDossier {
	/** Apartados generados que salen. Si un id falta, sale (todo sale por defecto). */
	secciones?: Record<string, boolean>;
	/** Lo que añade quien firma: textos e imágenes. */
	bloques?: BloqueDossier[];
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
