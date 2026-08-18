/**
 * EL MICROTEXTO IMPRESO SOBRE LAS PIEZAS: bornes, referencias y marcas de ajuste.
 *
 * Un aparato industrial no lleva su información en una etiqueta flotando delante: la lleva
 * SERIGRAFIADA sobre la carcasa, en tinta pequeña y junto a lo que nombra. Eso es lo que hace
 * este módulo, y el problema que resuelve es de coste: un tablero mediano tiene del orden de cien
 * bornes, y una textura por rótulo son cien lienzos, cien texturas y cien materiales.
 *
 * Aquí hay UNA textura para todo el programa. Es un atlas: una rejilla de celdas donde cada texto
 * distinto se dibuja una sola vez y se reutiliza —«A1» aparece en los tres contactores del
 * estrella-triángulo y ocupa una celda, no tres—. Cada marca es un plano con sus coordenadas de
 * textura apuntando a su celda, así que todas comparten material y la tarjeta las puede agrupar.
 *
 * Los glifos se dibujan BLANCOS sobre transparente a propósito: el color lo pone el material, que
 * multiplica. Con eso, la misma celda sirve para tinta oscura sobre una carcasa clara y para
 * tinta clara sobre un contactor negro, sin duplicar nada.
 */
import * as THREE from 'three';

const COLS = 8;
const FILAS = 32;
const CELDA_W = 128;
const CELDA_H = 32;

let lienzo: HTMLCanvasElement | undefined;
let textura: THREE.CanvasTexture | undefined;
const celdas = new Map<string, number>();

/** Ancho en píxeles que ocupó cada texto dentro de su celda. Sin esto no se puede recortar. */
const anchos = new Map<string, number>();
/** Altura nominal del texto en píxeles: la del tipo, no la de la celda. */
const ALTO_TEXTO = 22;

function atlas(): THREE.CanvasTexture {
	if (textura) return textura;
	lienzo = document.createElement('canvas');
	lienzo.width = COLS * CELDA_W;
	lienzo.height = FILAS * CELDA_H;
	textura = new THREE.CanvasTexture(lienzo);
	// Anisotropía alta: estos rótulos se miran casi siempre en oblicuo, que es donde un texto
	// pequeño se convierte en una mancha si el filtrado no la compensa.
	textura.anisotropy = 8;
	textura.colorSpace = THREE.SRGBColorSpace;
	return textura;
}

/** Reserva (o recupera) la celda de un texto y la dibuja si es nueva. */
function celdaDe(texto: string): number | undefined {
	const ya = celdas.get(texto);
	if (ya !== undefined) return ya;
	if (celdas.size >= COLS * FILAS) return undefined;   // atlas lleno: mejor sin marca que con basura
	const i = celdas.size;
	celdas.set(texto, i);
	const t = atlas();
	const ctx = lienzo!.getContext('2d')!;
	const x = (i % COLS) * CELDA_W;
	const y = Math.floor(i / COLS) * CELDA_H;
	ctx.clearRect(x, y, CELDA_W, CELDA_H);
	/*
	 * Tipografía técnica: condensada, sin gracias y con los dígitos de ancho fijo. Es la que llevan
	 * las serigrafías de aparamenta, y además la de ancho fijo hace que «1/L1» y «6/T3» ocupen lo
	 * mismo, con lo que una fila de bornes queda alineada sola.
	 */
	ctx.font = '600 21px ui-monospace, "SF Mono", "Roboto Mono", Menlo, Consolas, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = '#ffffff';
	const ancho = Math.min(ctx.measureText(texto).width, CELDA_W - 8);
	ctx.fillText(texto, x + CELDA_W / 2, y + CELDA_H / 2, CELDA_W - 8);
	anchos.set(texto, ancho + 4);   // dos píxeles de aire a cada lado, que el filtrado no corte
	t.needsUpdate = true;
	return i;
}

let tintaOscura: THREE.MeshStandardMaterial | undefined;
let tintaClara: THREE.MeshStandardMaterial | undefined;

/** El material de la tinta. Hay dos y se comparten: sobre carcasa clara y sobre carcasa oscura. */
function material(clara: boolean): THREE.MeshStandardMaterial {
	const guardado = clara ? tintaClara : tintaOscura;
	if (guardado) return guardado;
	const m = new THREE.MeshStandardMaterial({
		map: atlas(),
		color: clara ? 0xcfd3d6 : 0x33352f,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		// Sin `alphaTest` los bordes del glifo se mezclan con lo que haya detrás en el orden que
		// toque y el texto parpadea al girar. Con él, cada píxel está o no está.
		alphaTest: 0.35,
		// La tinta va PEGADA a la cara que rotula. Medio milímetro de separación real la haría
		// flotar al mirar en oblicuo, y sin separación ninguna pelearía con la cara por el buffer
		// de profundidad. El sesgo de polígono resuelve las dos cosas sin moverla de sitio.
		polygonOffset: true,
		polygonOffsetFactor: -4,
		polygonOffsetUnits: -4,
	});
	if (clara) tintaClara = m; else tintaOscura = m;
	return m;
}

/**
 * Una marca serigrafiada. `alto` es la altura del texto en milímetros de tablero —de 1,4 mm para
 * la numeración de un borne a 3 mm para una referencia—, y el ancho sale de lo que mida el texto.
 *
 * La malla NO intercepta el ratón. Es una decisión, no un descuido: un rótulo de dos milímetros
 * pegado sobre un borne se pondría por delante del propio borne en el raycast y robaría el clic
 * justo donde más falta hace acertar.
 */
export function marca(texto: string, alto: number, clara = false): THREE.Mesh | undefined {
	const i = celdaDe(texto);
	if (i === undefined) return undefined;
	/*
	 * SE RECORTA AL TEXTO, no a la celda.
	 *
	 * La celda mide 128 × 32 píxeles y un «A1» ocupa unos 26 de ancho: mapeando la celda entera, el
	 * glifo salía a un quinto del tamaño pedido y rodeado de transparencia, o sea, ilegible por
	 * mucho que se subiera la altura. Ahora las coordenadas de textura cubren solo el rectángulo
	 * que el texto ocupa de verdad, así que `alto` es la altura del GLIFO en milímetros y el ancho
	 * del plano sale de su proporción real.
	 */
	const anchoPx = anchos.get(texto) ?? ALTO_TEXTO;
	const fx = anchoPx / CELDA_W;
	const fy = ALTO_TEXTO / CELDA_H;
	const col = i % COLS;
	const fila = Math.floor(i / COLS);
	const u0 = (col + 0.5 - fx / 2) / COLS;
	const v0 = 1 - (fila + 0.5 + fy / 2) / FILAS;
	const geo = new THREE.PlaneGeometry(alto * (anchoPx / ALTO_TEXTO), alto);
	const uv = geo.attributes.uv as THREE.BufferAttribute;
	for (let k = 0; k < uv.count; k++) {
		uv.setXY(k, u0 + (uv.getX(k) * fx) / COLS, v0 + (uv.getY(k) * fy) / FILAS);
	}
	uv.needsUpdate = true;
	const m = new THREE.Mesh(geo, material(clara));
	m.raycast = () => {};
	m.userData.esMarca = true;
	m.userData.textoMarca = texto;
	m.userData.textoMarca = texto;
	return m;
}

/** Cuántos textos distintos lleva el atlas. Para las pruebas y para vigilar que no se desborde. */
export function textosEnAtlas(): number { return celdas.size; }
