/**
 * Geometría de las borneras de un aparato.
 *
 * Un aparato puede declarar sus borneras reales (`Dispositivo.terminales`). Este motor
 * traduce esa declaración a coordenadas en mm respecto de la esquina superior izquierda
 * de la huella del aparato, y es la ÚNICA fuente de verdad: la usan tanto el modelo 3D
 * (para dibujar los conectores) como el anclaje de los cables (para que salgan del
 * terminal correcto). Así el dibujo y el cableado no pueden desincronizarse.
 *
 * Convenio de ejes: x a la derecha, y hacia ABAJO (igual que el resto del modelo físico).
 */
import { BloqueTerminales, Dispositivo, LadoAparato } from '../modelo/tipos.js';

/** Distancia por defecto (mm) del eje de una bornera al borde del aparato. */
export const MARGEN_BORNERA = 6;

export interface PosicionTerminal {
	/** Desplazamiento en mm desde la esquina superior izquierda de la huella. */
	dx: number;
	dy: number;
	lado: LadoAparato;
	bloque: BloqueTerminales;
	/** Índice del terminal dentro de su bloque. */
	indice: number;
}

/** Extremos (fracción 0..1) que ocupa un bloque a lo largo de su lado. */
function tramo(b: BloqueTerminales): { desde: number; hasta: number } {
	const desde = Math.min(Math.max(b.desde ?? 0, 0), 1);
	const hasta = Math.min(Math.max(b.hasta ?? 1, 0), 1);
	return hasta > desde ? { desde, hasta } : { desde: 0, hasta: 1 };
}

/** Paso (mm) entre terminales consecutivos de un bloque, para dibujarlo a escala. */
export function pasoDelBloque(b: BloqueTerminales, ancho: number, alto: number): number {
	const largo = b.lado === 'arriba' || b.lado === 'abajo' ? ancho : alto;
	const { desde, hasta } = tramo(b);
	return ((hasta - desde) * largo) / Math.max(1, b.bornes.length);
}

/**
 * Posición de cada terminal declarado, indexada por id de borne.
 * Devuelve un mapa vacío si el aparato no declara borneras (entonces manda el reparto
 * automático en dos filas de `anclajeBorne`).
 */
export function posicionesDeTerminales(
	d: Dispositivo,
	ancho: number,
	alto: number,
): Map<string, PosicionTerminal> {
	const mapa = new Map<string, PosicionTerminal>();
	if (!d.terminales || d.terminales.length === 0) return mapa;
	for (const bloque of d.terminales) {
		const { desde, hasta } = tramo(bloque);
		const n = bloque.bornes.length;
		if (n === 0) continue;
		const margen = bloque.margen ?? MARGEN_BORNERA;
		const horizontal = bloque.lado === 'arriba' || bloque.lado === 'abajo';
		const largo = horizontal ? ancho : alto;
		for (let i = 0; i < n; i++) {
			const id = bloque.bornes[i];
			if (mapa.has(id)) continue; // el primer bloque que lo declara manda
			const t = (desde + ((i + 0.5) / n) * (hasta - desde)) * largo;
			const dx = horizontal ? t : bloque.lado === 'izquierda' ? margen : ancho - margen;
			const dy = horizontal ? (bloque.lado === 'arriba' ? margen : alto - margen) : t;
			mapa.set(id, { dx, dy, lado: bloque.lado, bloque, indice: i });
		}
	}
	return mapa;
}

/** Tope de terminales que se expanden de un rango, para que un dedazo no cuelgue la app. */
export const MAX_TERMINALES_BLOQUE = 64;

/**
 * Lee la lista de rótulos de una bornera tal y como la escribe una persona copiando de la
 * hoja de datos: separados por comas o por espacios, admitiendo rangos abreviados
 * (`UI1-8` o `UI1-UI8` → UI1…UI8).
 *
 * Si el texto lleva comas, se parte SOLO por comas: así "24V COM" o "MS/TP +" siguen siendo
 * un único terminal. Sin comas se parte por espacios, que es como se escribe una lista corta.
 */
export function leerRotulos(texto: string): string[] {
	const bruto = texto.includes(',') || texto.includes(';') || texto.includes('\n')
		? texto.split(/[,;\n]/)
		: texto.split(/\s+/);
	const salida: string[] = [];
	const vistos = new Set<string>();
	const anadir = (r: string): void => {
		const id = r.trim();
		if (!id || vistos.has(id) || salida.length >= MAX_TERMINALES_BLOQUE) return;
		vistos.add(id);
		salida.push(id);
	};
	for (const trozo of bruto) {
		const t = trozo.trim();
		if (!t) continue;
		// Rango abreviado: mismo prefijo (o ninguno al final) y dos números.
		const m = /^(\D*?)(\d+)\s*-\s*(\D*?)(\d+)$/.exec(t);
		if (m && (m[3] === '' || m[3] === m[1])) {
			const desde = Number(m[2]);
			const hasta = Number(m[4]);
			if (hasta >= desde && hasta - desde < MAX_TERMINALES_BLOQUE) {
				for (let i = desde; i <= hasta; i++) anadir(`${m[1]}${i}`);
				continue;
			}
		}
		anadir(t);
	}
	return salida;
}

/** Ancho mínimo (mm) que necesita la huella para que quepan todas las borneras declaradas. */
export function huellaMinima(d: Dispositivo, pasoMinimo = 5): { ancho: number; alto: number } {
	let ancho = 0;
	let alto = 0;
	// Varios bloques pueden compartir lado: lo que manda es el tramo más apretado.
	for (const b of d.terminales ?? []) {
		const { desde, hasta } = tramo(b);
		const necesario = (b.bornes.length * pasoMinimo) / Math.max(0.05, hasta - desde);
		if (b.lado === 'arriba' || b.lado === 'abajo') ancho = Math.max(ancho, necesario);
		else alto = Math.max(alto, necesario);
	}
	return { ancho: Math.ceil(ancho), alto: Math.ceil(alto) };
}
