/**
 * LA CANALETA COMO INFRAESTRUCTURA, NO COMO ESTORBO.
 *
 * Hasta ahora una canaleta era, para el ruteo, una caja maciza que había que esquivar: los cables
 * pasaban por delante y el tablero acababa con una cortina de conductores tapando los aparatos.
 * Un tablero de verdad se cablea al revés — los tramos largos van DENTRO del ducto y solo se ve
 * salir el hilo junto a su borne—, así que aquí se describe la canaleta por lo que de verdad es:
 * unas partes sólidas, un interior por el que se puede circular, y unos accesos concretos.
 *
 * Los números salen de cómo se CONSTRUYE la canaleta en `construirCanaleta`, no de cómo se
 * declara, y por eso las constantes viven aquí y las importa el constructor. Ya me costó una vez:
 * la huella la tenía modelada corrida medio ancho porque el grupo se coloca CENTRADO en la
 * coordenada declarada, y estuve midiendo invasiones contra una caja que no era el ducto.
 *
 *   base (fondo)   z 0…2            sólido, toda la huella
 *   zócalo         z 2…10           sólido, continuo: por debajo de 10 mm NO se entra
 *   dientes        z 10…alto        sólidos, 6 mm de ancho cada 12 mm
 *   ranuras        z 10…alto        HUECO de 6 mm entre dientes: el único acceso
 *   tapa           z alto…alto+2    sólido
 *   interior útil  |t−centro| < ancho/2 − 2,  z 2…alto
 *
 * Y el dato que hace que todo esto encaje: los bornes están a 46 mm de profundidad y las ranuras
 * van de 10 a `alto`. Un cable puede salir del tornillo y entrar por una ranura a su misma
 * profundidad, sin rodeos, y una vez dentro viaja por detrás de la cara de los aparatos.
 */
import { Canaleta } from '../src/modelo/tipos.js';

/** Espesor de las paredes y del fondo, en mm. */
export const ESPESOR = 2;
/** Ancho de cada diente y de cada ranura, en mm. */
export const DIENTE = 6;
export const RANURA = 6;
/** Altura del zócalo continuo del que nacen los dientes: por debajo no hay acceso. */
export const ZOCALO = 8;
/** Espesor de la tapa. */
export const TAPA = 2;

export interface Caja2D { x0: number; x1: number; y0: number; y1: number }

/**
 * Un tramo de la red: una canaleta con todo lo que hace falta para rutear por ella.
 *
 * `eje` es la coordenada que corre a lo largo del ducto y `cruz` la transversal, para poder
 * escribir el ruteo una sola vez en vez de duplicarlo para horizontales y verticales.
 */
export interface Tramo {
	id: string;
	esH: boolean;
	/** Huella exterior completa (la que ocupa en la placa). */
	huella: Caja2D;
	/** Recorrido a lo largo del ducto, en mm de modelo. */
	desde: number;
	hasta: number;
	/** Centro transversal y semiancho del INTERIOR útil (sin contar el grosor de las paredes). */
	centro: number;
	semiancho: number;
	/** Profundidades entre las que se puede circular: del fondo a la cara inferior de la tapa. */
	zMin: number;
	zMax: number;
	/** Centros de las ranuras, en coordenada de eje. Son los únicos accesos válidos. */
	ranuras: number[];
}

/** Dos tramos que se cruzan y el volumen donde comparten interior. */
export interface Cruce {
	a: string;
	b: string;
	zona: Caja2D;
}

/** Coordenada de eje (a lo largo) y transversal de un punto, según la orientación del tramo. */
export const ejeDe = (t: Tramo, x: number, y: number): number => (t.esH ? x : y);
export const cruzDe = (t: Tramo, x: number, y: number): number => (t.esH ? y : x);
/** Vuelve a (x, y) desde coordenadas de tramo. */
export const puntoDe = (t: Tramo, eje: number, cruz: number): { x: number; y: number } =>
	(t.esH ? { x: eje, y: cruz } : { x: cruz, y: eje });

/**
 * LA HUELLA REAL, sacada de cómo se construye y no de cómo se declara.
 *
 * `construirCanaleta` coloca el grupo CENTRADO en la coordenada transversal declarada: una
 * canaleta horizontal puesta en `y` ocupa de `y − ancho/2` a `y + ancho/2`, no de `y` a
 * `y + ancho`.
 */
export function huellaCanaleta(c: Canaleta): Caja2D {
	const esH = c.orientacion === 'h';
	const largoX = esH ? c.largo : c.ancho;
	const largoY = esH ? c.ancho : c.largo;
	const cx = c.x + (esH ? c.largo / 2 : 0);
	const cy = c.y + (esH ? 0 : c.largo / 2);
	return { x0: cx - largoX / 2, x1: cx + largoX / 2, y0: cy - largoY / 2, y1: cy + largoY / 2 };
}

/**
 * Dónde están los DIENTES de una canaleta, en coordenada de eje: centro y semiancho de cada uno.
 *
 * Es exactamente el reparto que hace `construirCanaleta`, y por eso lo comparten los dos: si el
 * dibujo pusiera los dientes en un sitio y el ruteo los buscara en otro, los cables entrarían
 * atravesando plástico y las pruebas dirían que todo está bien.
 */
export function dientesDe(c: Canaleta): number[] {
	const paso = DIENTE + RANURA;
	const n = Math.floor((c.largo - RANURA) / paso);
	if (n <= 0) return [];
	const centroEje = (c.orientacion === 'h' ? c.x : c.y) + c.largo / 2;
	const inicio = -((n - 1) * paso) / 2;
	return Array.from({ length: n }, (_, i) => centroEje + inicio + i * paso);
}

/** Centros de las ranuras: los huecos que quedan ENTRE dientes consecutivos. */
export function ranurasDe(c: Canaleta): number[] {
	const dientes = dientesDe(c);
	const salida: number[] = [];
	for (let i = 0; i + 1 < dientes.length; i++) salida.push((dientes[i] + dientes[i + 1]) / 2);
	return salida;
}

/** Convierte una canaleta del proyecto en un tramo de la red. */
export function tramoDe(c: Canaleta): Tramo {
	const esH = c.orientacion === 'h';
	return {
		id: c.id,
		esH,
		huella: huellaCanaleta(c),
		desde: esH ? c.x : c.y,
		hasta: (esH ? c.x : c.y) + c.largo,
		centro: esH ? c.y : c.x,
		semiancho: c.ancho / 2 - ESPESOR,
		zMin: ESPESOR,
		zMax: c.alto,
		ranuras: ranurasDe(c),
	};
}

/** ¿Se solapan dos huellas? Devuelve la zona común, o `undefined` si no se tocan. */
function solape(a: Caja2D, b: Caja2D): Caja2D | undefined {
	const zona = {
		x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1),
		y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1),
	};
	return zona.x1 > zona.x0 && zona.y1 > zona.y0 ? zona : undefined;
}

/**
 * LA RED: los tramos, sus cruces y por dónde se puede ir de uno a otro.
 *
 * Sin esto, el ruteo tendría que adivinar en cada paso si dos ductos están comunicados, y la
 * respuesta depende de geometría que solo conoce el constructor de la canaleta. Aquí se calcula
 * una vez y la comparten el dibujo —que abre las paredes justo en los cruces— y el router.
 */
export class RedCanaletas {
	readonly tramos: Tramo[];
	readonly cruces: Cruce[] = [];
	private readonly vecinos = new Map<string, string[]>();

	constructor(canaletas: Canaleta[]) {
		this.tramos = canaletas.map(tramoDe);
		for (let i = 0; i < this.tramos.length; i++) {
			for (let j = i + 1; j < this.tramos.length; j++) {
				const a = this.tramos[i];
				const b = this.tramos[j];
				const zona = solape(a.huella, b.huella);
				// Dos tramos en la misma dirección que se solapan no forman un cruce: se pisan, que
				// es un problema de disposición del tablero, no una unión por la que pasar.
				if (!zona || a.esH === b.esH) continue;
				this.cruces.push({ a: a.id, b: b.id, zona });
				this.vecinos.set(a.id, [...(this.vecinos.get(a.id) ?? []), b.id]);
				this.vecinos.set(b.id, [...(this.vecinos.get(b.id) ?? []), a.id]);
			}
		}
	}

	tramo(id: string): Tramo | undefined { return this.tramos.find((t) => t.id === id); }

	/** El cruce entre dos tramos, si lo hay. */
	cruceEntre(a: string, b: string): Cruce | undefined {
		return this.cruces.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
	}

	/** Zonas de este tramo que están ocupadas por un cruce, en coordenada de eje. */
	crucesDe(id: string): { desde: number; hasta: number; otro: string }[] {
		const t = this.tramo(id);
		if (!t) return [];
		return this.cruces
			.filter((c) => c.a === id || c.b === id)
			.map((c) => ({
				desde: t.esH ? c.zona.x0 : c.zona.y0,
				hasta: t.esH ? c.zona.x1 : c.zona.y1,
				otro: c.a === id ? c.b : c.a,
			}));
	}

	/**
	 * Camino más corto de un tramo a otro por la red, contando saltos. Devuelve la lista de tramos
	 * a recorrer, o `undefined` si no están comunicados. Es una anchura primero de toda la vida:
	 * la red de un tablero tiene cuatro o cinco tramos, no hace falta nada más listo.
	 */
	camino(desde: string, hasta: string): string[] | undefined {
		if (desde === hasta) return [desde];
		const previo = new Map<string, string>([[desde, desde]]);
		const cola = [desde];
		while (cola.length) {
			const actual = cola.shift()!;
			for (const v of this.vecinos.get(actual) ?? []) {
				if (previo.has(v)) continue;
				previo.set(v, actual);
				if (v === hasta) {
					const ruta = [v];
					for (let p = actual; p !== desde; p = previo.get(p)!) ruta.unshift(p);
					ruta.unshift(desde);
					return ruta;
				}
				cola.push(v);
			}
		}
		return undefined;
	}
}
