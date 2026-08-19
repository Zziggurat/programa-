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
