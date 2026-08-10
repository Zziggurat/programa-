/**
 * IDENTIFICADORES QUE NO DEPENDEN DEL RELOJ.
 *
 * Segunda auditoría, TS2-P3-01. Por todo el programa había ids hechos con
 * `Date.now().toString(36)`, a veces con un `Math.random()` de cuatro cifras detrás. En un clic
 * suelto no choca nunca; en dos aparatos duplicados dentro del mismo milisegundo, o pegando un
 * grupo entero de golpe, sí puede. Y un id repetido no da un error: da un cable que se conecta al
 * aparato equivocado, o una borna que desaparece al fundirse con otra. De los fallos que cuesta
 * creer cuando pasan.
 *
 * `crypto.randomUUID()` existe en todos los navegadores que abren este programa y en Node desde la
 * 19. La reserva es para un `file://` en un navegador viejo, donde `crypto` puede no estar en un
 * contexto no seguro; ahí se usa `getRandomValues`, y solo si tampoco está se cae al azar de
 * antes, que es lo que había.
 */

/** Un identificador único, con el prefijo que lo hace legible en el archivo (`d`, `c`, `img`…). */
export function idUnico(prefijo: string): string {
	const c = (globalThis as { crypto?: Crypto }).crypto;
	if (c?.randomUUID) return `${prefijo}${c.randomUUID().replace(/-/g, '').slice(0, 12)}`;
	if (c?.getRandomValues) {
		const b = c.getRandomValues(new Uint8Array(6));
		return `${prefijo}${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
	}
	// Sin `crypto` no queda nada mejor que lo de antes; al menos se dice aquí y no en diez sitios.
	return `${prefijo}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * ¿Hay ids repetidos en una lista? Devuelve los que se repiten.
 *
 * Comprobar es tan importante como generar bien: un archivo puede venir de otra versión, de un
 * pegado o de una fusión a mano, y ahí los ids no los hemos puesto nosotros.
 */
export function idsRepetidos(items: { id: string }[]): string[] {
	const vistos = new Set<string>();
	const repes = new Set<string>();
	for (const x of items) {
		if (vistos.has(x.id)) repes.add(x.id);
		vistos.add(x.id);
	}
	return [...repes];
}
