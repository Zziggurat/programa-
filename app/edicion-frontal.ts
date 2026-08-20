/**
 * LAS REGLAS DE COLOCAR COSAS EN EL FRONTAL, separadas de la pantalla.
 *
 * Aquí no hay Three.js ni DOM: solo aritmética sobre rectángulos en el plano de la puerta. Vive
 * fuera de `main.ts` por lo mismo que `edicion-cables`: `main.ts` arranca la aplicación entera al
 * importarse, así que nada de lo que hay dentro se puede probar sin un navegador, y esto —dónde
 * acaba exactamente una pieza cuando el usuario la suelta— es justo lo que no puede fallar.
 *
 * LA FILOSOFÍA ES LA MISMA QUE EN LOS CABLES: manda el usuario.
 *
 * Las ayudas actúan MIENTRAS se arrastra y nada más. No hay ninguna función aquí que recoloque
 * una pieza después de haberla soltado, ni que la mueva «para arreglarla». Lo único que se impone
 * es el borde de la hoja, porque fuera de la chapa no hay dónde taladrar.
 */

/** Una pieza montada en el frontal, con la huella que ocupa. Todo en mm. */
export interface PiezaFrontal {
	id: string;
	clase: 'aparato' | 'rotulo';
	/** Centro de la pieza, en mm desde la esquina superior izquierda de la hoja. */
	x: number;
	y: number;
	ancho: number;
	alto: number;
}

export interface AyudasFrontal {
	/** Paso de la rejilla en mm, o `undefined` si está apagada. */
	rejilla?: number;
	/** Con `false`, ninguna ayuda toca nada: colocación al milímetro (la tecla Alt). */
	imantar: boolean;
	/** A cuántos mm de un vecino se considera que el usuario quiere alinearse con él. */
	tolerancia: number;
}

/** Una guía que se enseña mientras dura el arrastre, para que el imantado no sea invisible. */
export interface Guia {
	eje: 'x' | 'y';
	valor: number;
	/** Con qué se ha alineado: `rejilla` o el id del vecino. */
	con: string;
}

export interface Colocado {
	x: number;
	y: number;
	guias: Guia[];
}

/**
 * IMANTA UNA POSICIÓN, y dice con qué.
 *
 * El orden importa: primero los VECINOS y luego la rejilla. Alinearse con la pieza de al lado es
 * lo que uno quiere de verdad —tres pilotos a la misma altura— y la rejilla es la red de fondo. Si
 * la rejilla fuera primero, un vecino que no cayera en la rejilla no se podría igualar nunca.
 *
 * Devuelve además las guías, porque una ayuda que mueve algo sin decirlo es indistinguible de un
 * fallo. Sin `imantar`, devuelve el punto tal cual y ninguna guía.
 */
export function imantarEnFrontal(
	punto: { x: number; y: number },
	vecinos: readonly PiezaFrontal[],
	ayudas: AyudasFrontal,
): Colocado {
	if (!ayudas.imantar) return { x: punto.x, y: punto.y, guias: [] };
	const guias: Guia[] = [];
	let { x, y } = punto;

	const masCerca = (valor: number, eje: 'x' | 'y'): PiezaFrontal | undefined => {
		let mejor: PiezaFrontal | undefined;
		let d = ayudas.tolerancia;
		for (const v of vecinos) {
			const dd = Math.abs((eje === 'x' ? v.x : v.y) - valor);
			if (dd <= d) { d = dd; mejor = v; }
		}
		return mejor;
	};

	const vx = masCerca(x, 'x');
	if (vx) { x = vx.x; guias.push({ eje: 'x', valor: x, con: vx.id }); }
	const vy = masCerca(y, 'y');
	if (vy) { y = vy.y; guias.push({ eje: 'y', valor: y, con: vy.id }); }

	if (ayudas.rejilla && ayudas.rejilla > 0) {
		if (!vx) { x = Math.round(x / ayudas.rejilla) * ayudas.rejilla; guias.push({ eje: 'x', valor: x, con: 'rejilla' }); }
		if (!vy) { y = Math.round(y / ayudas.rejilla) * ayudas.rejilla; guias.push({ eje: 'y', valor: y, con: 'rejilla' }); }
	}
	return { x, y, guias };
}

/**
 * Encierra la pieza en la hoja. Es lo ÚNICO que se impone pase lo que pase: fuera de la chapa no
 * hay dónde hacer el taladro. Ni siquiera Alt lo salta, porque no es una ayuda.
 */
export function dentroDeLaHoja(
	punto: { x: number; y: number },
	pieza: { ancho: number; alto: number },
	hoja: { ancho: number; alto: number },
	margen = 6,
): { x: number; y: number } {
	const mx = pieza.ancho / 2 + margen;
	const my = pieza.alto / 2 + margen;
	return {
		x: Math.min(Math.max(punto.x, mx), Math.max(mx, hoja.ancho - mx)),
		y: Math.min(Math.max(punto.y, my), Math.max(my, hoja.alto - my)),
	};
}

/* --------------------------- Alinear y repartir --------------------------- */

export type Alineacion = 'izquierda' | 'centroX' | 'derecha' | 'arriba' | 'centroY' | 'abajo';

/**
 * Alinea un grupo de piezas. La referencia es el borde extremo del conjunto —la más a la
 * izquierda manda al alinear a la izquierda— salvo al centrar, que usa el centro del conjunto.
 *
 * Devuelve solo lo que CAMBIA. Quien lo aplique sabe así qué tiene que mover, y una alineación que
 * no mueve nada no ensucia el historial de deshacer con un paso vacío.
 */
export function alinearFrontal(
	piezas: readonly PiezaFrontal[], como: Alineacion,
): Map<string, { x: number; y: number }> {
	const cambios = new Map<string, { x: number; y: number }>();
	if (piezas.length < 2) return cambios;

	const izq = Math.min(...piezas.map((p) => p.x - p.ancho / 2));
	const der = Math.max(...piezas.map((p) => p.x + p.ancho / 2));
	const arr = Math.min(...piezas.map((p) => p.y - p.alto / 2));
	const aba = Math.max(...piezas.map((p) => p.y + p.alto / 2));
	const cx = piezas.reduce((a, p) => a + p.x, 0) / piezas.length;
	const cy = piezas.reduce((a, p) => a + p.y, 0) / piezas.length;

	for (const p of piezas) {
		let { x, y } = p;
		switch (como) {
			case 'izquierda': x = izq + p.ancho / 2; break;
			case 'derecha': x = der - p.ancho / 2; break;
			case 'centroX': x = cx; break;
			case 'arriba': y = arr + p.alto / 2; break;
			case 'abajo': y = aba - p.alto / 2; break;
			case 'centroY': y = cy; break;
		}
		if (x !== p.x || y !== p.y) cambios.set(p.id, { x, y });
	}
	return cambios;
}

/**
 * REPARTIR: hay dos criterios y los dos son legítimos, así que están los dos.
 *
 *   `ejes`   la misma distancia entre CENTROS. Es el paso de taladrado, y es lo que se pide en un
 *            frontal: una fila de mandos se lee por dónde están sus ejes, no por sus embellecedores.
 *            Con piezas del mismo tamaño —el caso normal— los dos criterios dan lo mismo.
 *   `huecos` el mismo AIRE entre piezas. Es lo que se quiere cuando hay tamaños muy distintos: tres
 *            pilotos de 22 mm y una placa de 90 puestos a la misma distancia de eje dejan huecos
 *            desiguales y se ven torcidos.
 *
 * Los extremos no se mueven en ninguno de los dos: son los que fijan el tramo.
 */
export function repartirFrontal(
	piezas: readonly PiezaFrontal[], eje: 'x' | 'y', modo: 'ejes' | 'huecos' = 'ejes',
): Map<string, { x: number; y: number }> {
	const cambios = new Map<string, { x: number; y: number }>();
	if (piezas.length < 3) return cambios;
	const de = (p: PiezaFrontal) => (eje === 'x' ? p.x : p.y);
	const grueso = (p: PiezaFrontal) => (eje === 'x' ? p.ancho : p.alto);
	const orden = [...piezas].sort((a, b) => de(a) - de(b));
	const primero = orden[0];
	const ultimo = orden[orden.length - 1];

	const centros: number[] = [];
	if (modo === 'ejes') {
		const paso = (de(ultimo) - de(primero)) / (orden.length - 1);
		for (let i = 0; i < orden.length; i++) centros.push(de(primero) + paso * i);
	} else {
		// El aire disponible es el tramo entre los cantos interiores de los extremos, menos lo que
		// ocupan las piezas de en medio. Repartido entre los huecos que hay.
		const desde = de(primero) + grueso(primero) / 2;
		const hasta = de(ultimo) - grueso(ultimo) / 2;
		const ocupado = orden.slice(1, -1).reduce((a, p) => a + grueso(p), 0);
		const hueco = (hasta - desde - ocupado) / (orden.length - 1);
		centros.push(de(primero));
		let cursor = desde;
		for (let i = 1; i < orden.length - 1; i++) {
			cursor += hueco + grueso(orden[i]) / 2;
			centros.push(cursor);
			cursor += grueso(orden[i]) / 2;
		}
		centros.push(de(ultimo));
	}

	for (let i = 1; i < orden.length - 1; i++) {
		const p = orden[i];
		const v = Math.round(centros[i]);
		const nuevo = eje === 'x' ? { x: v, y: p.y } : { x: p.x, y: v };
		if (nuevo.x !== p.x || nuevo.y !== p.y) cambios.set(p.id, nuevo);
	}
	return cambios;
}
