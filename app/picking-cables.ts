/** Datos mínimos para ordenar dos recorridos ya medidos en espacio de pantalla. */
export interface PrioridadCable {
	id: string;
	pixeles: number;
	radio: number;
	profundidad: number;
}

const EMPATE_PIXEL = 0.15;
const EMPATE_PROFUNDIDAD = 0.25;

/**
 * Orden determinista del picking de cables.
 *
 * Primero manda estar realmente sobre el tubo visible. Dentro del tubo manda la superficie que
 * está delante; fuera, la distancia al eje en pantalla. La selección actual solo conserva el
 * cable cuando las medidas son indistinguibles, y el ID persistente cierra cualquier empate sin
 * depender del orden de construcción de las mallas o del array del proyecto.
 */
export function compararPrioridadCable(
	a: PrioridadCable, b: PrioridadCable, seleccionado?: string,
): number {
	const encimaA = a.pixeles <= a.radio;
	const encimaB = b.pixeles <= b.radio;
	if (encimaA !== encimaB) return encimaA ? -1 : 1;

	if (encimaA) {
		const profundidad = a.profundidad - b.profundidad;
		if (Math.abs(profundidad) > EMPATE_PROFUNDIDAD) return profundidad;
	} else {
		const pixeles = a.pixeles - b.pixeles;
		if (Math.abs(pixeles) > EMPATE_PIXEL) return pixeles;
	}

	const elegidoA = a.id === seleccionado;
	const elegidoB = b.id === seleccionado;
	if (elegidoA !== elegidoB) return elegidoA ? -1 : 1;

	const pixeles = a.pixeles - b.pixeles;
	if (Math.abs(pixeles) > EMPATE_PIXEL) return pixeles;
	const profundidad = a.profundidad - b.profundidad;
	if (Math.abs(profundidad) > EMPATE_PROFUNDIDAD) return profundidad;
	return a.id.localeCompare(b.id);
}
