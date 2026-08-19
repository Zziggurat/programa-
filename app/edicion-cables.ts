/**
 * LAS REGLAS DE LA EDICIÓN MANUAL DE UN CABLE, separadas de la pantalla.
 *
 * Viven aquí y no en `main.ts` por una razón práctica: `main.ts` arranca la aplicación entera al
 * importarse —crea el renderer, se engancha al DOM, carga el proyecto— así que nada de lo que hay
 * dentro se puede probar sin un navegador. Estas dos reglas son aritmética pura y son justo las
 * que no pueden fallar, así que salen fuera y entran en la suite.
 */

/** Los tres ejes del modelo, en milímetros sobre la placa. */
export type Eje = 'x' | 'y' | 'z';

/** Dónde estaba el punto cuando el usuario bloqueó el eje. */
export interface Bloqueo {
	eje: Eje;
	ancla: { x: number; y: number; z?: number };
}

/**
 * DEVUELVE A SU SITIO LOS EJES QUE EL USUARIO HA DICHO QUE NO SE TOCAN.
 *
 * Se aplica AL FINAL de mover un punto, después del recorte al área de cableado, del alineado con
 * los vecinos y del encaje en la canaleta. Cualquiera de esos tres mueve coordenadas por su cuenta
 * y con buen criterio; el problema es que si el bloqueo se aplicara antes que ellos, cualquiera de
 * los tres podría deshacerlo y el bloqueo sería una sugerencia.
 *
 * «Bloqueo Z» quiere decir que X e Y valen EXACTAMENTE lo que valían, no aproximadamente.
 */
export function respetarBloqueo(
	p: { x: number; y: number; z?: number }, bloqueo?: Bloqueo,
): { x: number; y: number; z?: number } {
	if (!bloqueo) return p;
	const a = bloqueo.ancla;
	if (bloqueo.eje === 'z') return { x: a.x, y: a.y, z: p.z };
	if (bloqueo.eje === 'x') return { x: p.x, y: a.y, z: a.z };
	return { x: a.x, y: p.y, z: a.z };
}

/**
 * SOBRE QUÉ PLANO SE ARRASTRA, SEGÚN DÓNDE ESTÉ LA CÁMARA.
 *
 * Un ratón sabe de dos ejes y el tablero tiene tres. La regla es una sola: se arrastra sobre el
 * plano que MÁS DE FRENTE le quede al ojo, porque es el único sobre el que el cursor y el punto se
 * mueven a la vez. Proyectar siempre sobre el plano de la placa —que es lo que se hacía— funciona
 * de frente y se rompe de lado: ahí el plano se ve de canto, el rayo lo corta casi en paralelo y
 * un píxel de ratón desplaza el punto centímetros.
 *
 *   `mira`     hacia dónde apunta la cámara, en coordenadas de escena
 *   `forzar`   verdadero cuando el usuario pide profundidad explícitamente (Mayúsculas o eje Z)
 *
 * Devuelve la normal del plano de arrastre. 0,55 ≈ 57° respecto a la placa: por encima la cámara
 * todavía la mira lo bastante de frente para que X/Y sea preciso, por debajo conviene cambiar.
 */
export function normalDeArrastre(
	mira: { x: number; y: number; z: number }, forzar: boolean,
): { x: number; y: number; z: number } {
	const deLado = forzar || Math.abs(mira.z) < 0.55;
	if (!deLado) return { x: 0, y: 0, z: 1 };
	return Math.abs(mira.x) >= Math.abs(mira.y) ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
}

/* ==================================================================================
 * DÓNDE ESTÁ EL CABLE DE VERDAD
 *
 * El recorrido dibujado de un cable es una polilínea densa en 3D. Todo lo que el ratón hace con
 * un cable —ponerle el tirador encima, meterle una unión, decidir si el puntero está sobre él—
 * se contesta con esa polilínea y con nada más. Antes cada cosa lo suponía por su cuenta (una
 * profundidad fija para el tirador, un plano de proyección para la unión, un tubo invisible para
 * la selección) y de ahí salía el «el punto no está donde se ve».
 * ================================================================================== */

/** Un punto del recorrido, en milímetros de modelo. */
export interface P3 { x: number; y: number; z: number }

/** El punto del recorrido `densos` más cercano a `objetivo`, y por dónde cae. */
export interface EnRuta {
	/** El punto exacto sobre la polilínea (interpolado dentro del segmento). */
	punto: P3;
	/** Índice del vértice anterior del segmento que lo contiene. */
	indice: number;
	/** Posición dentro de ese segmento, de 0 a 1. Con `indice` da una posición continua. */
	t: number;
	/** Distancia del objetivo a la polilínea (mm). */
	distancia: number;
}

/**
 * Proyecta un punto sobre el recorrido dibujado.
 *
 * Si el objetivo trae `z` se mide en tres dimensiones; si no la trae —un punto de peinado que
 * todavía no tiene profundidad propia— se mide en planta y la profundidad se LEE del recorrido.
 * Ése es justo el caso que hacía falta: saber a qué altura está dibujado un punto que el usuario
 * nunca ha tocado en profundidad.
 */
export function proyectarEnPolilinea(
	densos: readonly P3[], objetivo: { x: number; y: number; z?: number },
): EnRuta | undefined {
	if (densos.length === 0) return undefined;
	if (densos.length === 1) {
		const p = densos[0];
		return { punto: { ...p }, indice: 0, t: 0, distancia: Math.hypot(p.x - objetivo.x, p.y - objetivo.y) };
	}
	const plano = objetivo.z === undefined;
	let mejor: EnRuta | undefined;
	for (let i = 0; i < densos.length - 1; i++) {
		const a = densos[i];
		const b = densos[i + 1];
		const dx = b.x - a.x, dy = b.y - a.y, dz = plano ? 0 : b.z - a.z;
		const len2 = dx * dx + dy * dy + dz * dz;
		const t = len2 === 0 ? 0 : Math.max(0, Math.min(1,
			((objetivo.x - a.x) * dx + (objetivo.y - a.y) * dy + (plano ? 0 : (objetivo.z! - a.z) * dz)) / len2));
		const punto = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + (b.z - a.z) * t };
		const d = plano
			? Math.hypot(punto.x - objetivo.x, punto.y - objetivo.y)
			: Math.hypot(punto.x - objetivo.x, punto.y - objetivo.y, punto.z - objetivo.z!);
		if (!mejor || d < mejor.distancia) mejor = { punto, indice: i, t, distancia: d };
	}
	return mejor;
}

/**
 * EN QUÉ POSICIÓN DEL PEINADO ENTRA UNA UNIÓN NUEVA.
 *
 * No se decide por la distancia en planta a cada tramo —que era lo que se hacía, y con la cámara
 * inclinada o con el cable metido en una canaleta elegía el tramo equivocado—, sino por el ORDEN
 * a lo largo del recorrido: se mira por dónde va el punto pinchado y cuántos puntos del peinado
 * quedan por detrás. Vale igual para un cable ruteado automáticamente, cuyo recorrido lleva más
 * nodos de los que el usuario puso.
 */
export function indiceDeInsercion(
	densos: readonly P3[], trazado: readonly { x: number; y: number; z?: number }[], avance: number,
): number {
	let n = 0;
	for (const q of trazado) {
		const en = proyectarEnPolilinea(densos, q);
		if (en && en.indice + en.t <= avance) n++;
	}
	return Math.min(n, trazado.length);
}

/**
 * Distancia de un punto a un segmento, en el plano. Se usa en PÍXELES, para que la tolerancia de
 * selección sea la misma esté el cable cerca o al fondo del tablero.
 */
export function distanciaASegmento(
	px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
	const dx = bx - ax, dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
