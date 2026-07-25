/**
 * Geometría pura de los recorridos de cable (sin dependencias de Three.js), para poder
 * probarla de forma aislada. La usan tanto la escena 3D como la interacción del editor.
 */

export interface Punto { x: number; y: number }

/**
 * Convierte una polilínea de nodos en un recorrido ORTOGONAL (solo tramos horizontales y
 * verticales, en ángulo recto), al estilo de los cables de Tinkercad.
 *
 * Entre cada par de nodos se inserta un codo con orientación CONSISTENTE (siempre primero en
 * vertical y luego en horizontal). Así cada nodo intermedio queda como una esquina real —entra
 * en horizontal y sale en vertical— y sus DOS coordenadas influyen en el recorrido. Si se
 * mezclaran orientaciones, dos tramos podrían quedar colineales y una coordenada del punto se
 * perdería, que era justo lo que hacía que arrastrar un punto se sintiera «buggeado».
 */
export function orthogonalize(nodos: Punto[]): Punto[] {
	if (nodos.length < 2) return nodos.slice();
	const salida: Punto[] = [nodos[0]];
	for (let i = 0; i < nodos.length - 1; i++) {
		const p = salida[salida.length - 1];
		const q = nodos[i + 1];
		if (Math.abs(p.x - q.x) < 1 || Math.abs(p.y - q.y) < 1) { salida.push(q); continue; } // ya alineado
		salida.push({ x: p.x, y: q.y }, q); // primero vertical (x=p.x), luego horizontal (y=q.y)
	}
	return salida;
}

/** Banda horizontal (franja de la placa entre dos alturas, en mm). */
export interface Banda { y0: number; y1: number }

/**
 * Corredores horizontales LIBRES (sin aparatos) dentro de [yMin, yMax]: el complemento de las
 * bandas ocupadas, ya fusionadas. Son los pasillos por donde puede correr un cable sin pasar
 * por encima de ningún aparato, igual que se cablea un tablero real.
 */
export function corredoresLibres(ocupadas: Banda[], yMin: number, yMax: number, minAlto = 14): Banda[] {
	const orden = ocupadas
		.map((b) => ({ y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1) }))
		.filter((b) => b.y1 > yMin && b.y0 < yMax)
		.sort((p, q) => p.y0 - q.y0);
	const fusionadas: Banda[] = [];
	for (const b of orden) {
		const ultima = fusionadas[fusionadas.length - 1];
		if (ultima && b.y0 <= ultima.y1) ultima.y1 = Math.max(ultima.y1, b.y1);
		else fusionadas.push({ ...b });
	}
	const libres: Banda[] = [];
	let y = yMin;
	for (const b of fusionadas) {
		if (b.y0 - y >= minAlto) libres.push({ y0: y, y1: b.y0 });
		y = Math.max(y, b.y1);
	}
	if (yMax - y >= minAlto) libres.push({ y0: y, y1: yMax });
	return libres;
}

/**
 * Ruta automática ortogonal entre dos bornes: sale en vertical de cada borne, recorre un
 * CORREDOR LIBRE (sin aparatos encima) y baja/sube al destino. Cada cable toma un carril
 * distinto dentro del corredor para que los paralelos no se solapen.
 * Devuelve solo los puntos intermedios (los extremos los pone quien dibuja).
 */
export function rutaAutomatica(a: Punto, b: Punto, corredores: Banda[], carril: number): Punto[] {
	if (Math.abs(a.x - b.x) < 2) return []; // misma vertical: tramo recto, sin codos
	const yMedio = (a.y + b.y) / 2;
	const lo = Math.min(a.y, b.y);
	const hi = Math.max(a.y, b.y);
	let mejor: Banda | undefined;
	let mejorCoste = Infinity;
	for (const c of corredores) {
		const centro = (c.y0 + c.y1) / 2;
		// Se prefiere un corredor que quede ENTRE los dos bornes (recorrido más corto y natural).
		const coste = Math.abs(centro - yMedio) + (centro >= lo && centro <= hi ? 0 : 1000);
		if (coste < mejorCoste) { mejorCoste = coste; mejor = c; }
	}
	if (!mejor) return [{ x: a.x, y: Math.round(yMedio) }, { x: b.x, y: Math.round(yMedio) }];
	const util = Math.max(6, mejor.y1 - mejor.y0 - 10);
	const n = Math.max(1, Math.min(10, Math.floor(util / 7)));
	const centro = (mejor.y0 + mejor.y1) / 2;
	const idx = ((carril % n) + n) % n;
	const y = Math.round(n === 1 ? centro : centro - util / 2 + (idx * util) / (n - 1));
	return [{ x: a.x, y }, { x: b.x, y }];
}

/** Tramo recto de un cable (horizontal o vertical) entre dos nodos consecutivos. */
export interface Tramo { a: Punto; b: Punto }

/** Trocea una polilínea en sus tramos rectos. */
export function tramos(nodos: Punto[]): Tramo[] {
	const out: Tramo[] = [];
	for (let i = 0; i < nodos.length - 1; i++) out.push({ a: nodos[i], b: nodos[i + 1] });
	return out;
}

/**
 * Longitud (mm) en la que dos recorridos van MONTADOS uno encima del otro: tramos paralelos
 * a menos de `tolerancia` mm que además se pisan. Es la medida de «cables amontonados»: en un
 * tablero bien hecho debe ser prácticamente cero.
 */
export function longitudSolapada(unos: Punto[], otros: Punto[], tolerancia = 3): number {
	let total = 0;
	for (const s of tramos(unos)) {
		const sh = Math.abs(s.a.y - s.b.y) < 0.5; // tramo horizontal
		const sv = Math.abs(s.a.x - s.b.x) < 0.5; // tramo vertical
		if (!sh && !sv) continue;
		for (const t of tramos(otros)) {
			const th = Math.abs(t.a.y - t.b.y) < 0.5;
			const tv = Math.abs(t.a.x - t.b.x) < 0.5;
			if (sh && th && Math.abs(s.a.y - t.a.y) <= tolerancia) {
				const i0 = Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
				const i1 = Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x));
				if (i1 > i0) total += i1 - i0;
			} else if (sv && tv && Math.abs(s.a.x - t.a.x) <= tolerancia) {
				const i0 = Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
				const i1 = Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y));
				if (i1 > i0) total += i1 - i0;
			}
		}
	}
	return total;
}

/** Distancia de un punto al segmento p-q (para saber en qué tramo del cable se hizo clic). */
export function distPuntoSegmento(x: number, y: number, p: Punto, q: Punto): number {
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const largo2 = dx * dx + dy * dy || 1;
	const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / largo2));
	return Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
}
