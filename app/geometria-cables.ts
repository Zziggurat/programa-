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

/** Corredor más natural para ir de `a` a `b`: el que queda ENTRE los dos bornes y más centrado. */
export function mejorCorredor(a: Punto, b: Punto, corredores: Banda[]): Banda | undefined {
	const yMedio = (a.y + b.y) / 2;
	const lo = Math.min(a.y, b.y);
	const hi = Math.max(a.y, b.y);
	let mejor: Banda | undefined;
	let mejorCoste = Infinity;
	for (const c of corredores) {
		const centro = (c.y0 + c.y1) / 2;
		const coste = Math.abs(centro - yMedio) + (centro >= lo && centro <= hi ? 0 : 1000);
		if (coste < mejorCoste) { mejorCoste = coste; mejor = c; }
	}
	return mejor;
}

/**
 * Alturas (mm) de los carriles de un corredor, ORDENADAS del centro hacia los bordes: un cable
 * solo va por el medio del pasillo, y los siguientes se van abriendo a los lados como en un
 * peinado de tablero real.
 */
export function carrilesDe(banda: Banda, paso = 7): number[] {
	const util = Math.max(6, banda.y1 - banda.y0 - 10);
	const n = Math.max(1, Math.min(10, Math.floor(util / paso)));
	const centro = (banda.y0 + banda.y1) / 2;
	if (n === 1) return [Math.round(centro)];
	const ys: { y: number; d: number }[] = [];
	for (let i = 0; i < n; i++) {
		ys.push({ y: Math.round(centro - util / 2 + (i * util) / (n - 1)), d: Math.abs(i - (n - 1) / 2) });
	}
	return ys.sort((p, q) => p.d - q.d).map((p) => p.y);
}

/**
 * Ruta automática ortogonal entre dos bornes: sale en vertical de cada borne, recorre un
 * CORREDOR LIBRE (sin aparatos encima) y baja/sube al destino. Cada cable toma un carril
 * distinto dentro del corredor para que los paralelos no se solapen.
 * Devuelve solo los puntos intermedios (los extremos los pone quien dibuja).
 */
export function rutaAutomatica(a: Punto, b: Punto, corredores: Banda[], carril: number): Punto[] {
	if (Math.abs(a.x - b.x) < 2) return []; // misma vertical: tramo recto, sin codos
	const mejor = mejorCorredor(a, b, corredores);
	if (!mejor) {
		const y = Math.round((a.y + b.y) / 2);
		return [{ x: a.x, y }, { x: b.x, y }];
	}
	const ys = carrilesDe(mejor);
	const y = ys[((carril % ys.length) + ys.length) % ys.length];
	return [{ x: a.x, y }, { x: b.x, y }];
}

/** Un trozo recto ya tendido: horizontal a la altura `fijo`, o vertical en la abscisa `fijo`. */
interface Reserva { horizontal: boolean; fijo: number; desde: number; hasta: number }

/** Milímetros en que dos trozos rectos van montados uno sobre otro (0 si no se tocan). */
function montados(a: Reserva, b: Reserva, tolerancia: number): number {
	if (a.horizontal !== b.horizontal) return 0;         // se cruzan, no se montan
	if (Math.abs(a.fijo - b.fijo) > tolerancia) return 0;
	return Math.max(0, Math.min(a.hasta, b.hasta) - Math.max(a.desde, b.desde));
}

/**
 * Repartidor de carriles: reparte los cables por el tablero de forma que NINGUNO quede montado
 * encima de otro. A diferencia de `rutaAutomatica` (que reparte a ciegas por número de cable),
 * este lleva la cuenta de qué trozos están ya tendidos y le busca a cada cable un sitio libre.
 * Dos cables solo comparten altura si van por zonas del tablero que no se pisan, que es
 * exactamente como se peina un tablero de verdad.
 *
 * Un sitio son DOS cosas: la altura del carril y la CAPA de profundidad. En un tablero de verdad,
 * cuando el pasillo se llena, los cables siguientes no se ponen encima de los que ya están: van
 * por delante, en una segunda capa. Aquí igual, y en ese orden: primero se llenan todos los
 * carriles de la capa de atrás —del centro del pasillo hacia los bordes, que es como se peina— y
 * solo cuando ninguno queda libre se empieza la capa siguiente.
 *
 * Y se reserva el RECORRIDO ENTERO, no solo el tramo del pasillo: la bajada del borne al carril y
 * la subida al otro borne son cable igual que el resto. Faltaban, y por eso dos cables que salían
 * de bornes casi en la misma vertical —los de un bornero al motor, sin ir más lejos— se bajaban
 * uno dentro de otro por mucho que luego cada uno cogiera su carril.
 *
 * Devuelve, para cada par de bornes, los puntos intermedios de su ruta y la capa que le ha tocado
 * (el dibujo la usa para separar los cables también en profundidad).
 */
export function crearRepartidor(
	corredores: Banda[], holgura = 8, capas = 4, tolerancia = 3,
): (a: Punto, b: Punto) => { puntos: Punto[]; carril: number } {
	/** Lo ya tendido en cada capa de profundidad. */
	const tendido: Reserva[][] = Array.from({ length: capas }, () => []);
	/** Cuánto se monta un recorrido con lo que ya hay en esa capa. */
	const choque = (piezas: Reserva[], capa: number): number => {
		let total = 0;
		for (const p of piezas) for (const q of tendido[capa]) total += montados(p, q, tolerancia);
		return total;
	};
	const vertical = (x: number, y0: number, y1: number): Reserva =>
		({ horizontal: false, fijo: x, desde: Math.min(y0, y1), hasta: Math.max(y0, y1) });

	/** Elige capa para un recorrido que no admite carril (recta o sin corredor) y lo apunta. */
	const soloCapa = (piezas: Reserva[]): number => {
		let mejor = 0;
		let mejorChoque = Infinity;
		for (let capa = 0; capa < capas; capa++) {
			const c = choque(piezas, capa);
			if (c < mejorChoque) { mejorChoque = c; mejor = capa; }
			if (c === 0) break;
		}
		tendido[mejor].push(...piezas);
		return mejor;
	};

	return (a, b) => {
		// Misma vertical: tramo recto, sin codos. Aun así ocupa sitio y hay que apuntarlo.
		if (Math.abs(a.x - b.x) < 2) return { puntos: [], carril: soloCapa([vertical(a.x, a.y, b.y)]) };
		const corredor = mejorCorredor(a, b, corredores);
		if (!corredor) {
			const y = Math.round((a.y + b.y) / 2);
			const piezas = [
				vertical(a.x, a.y, y),
				{ horizontal: true, fijo: y, desde: Math.min(a.x, b.x), hasta: Math.max(a.x, b.x) },
				vertical(b.x, y, b.y),
			];
			return { puntos: [{ x: a.x, y }, { x: b.x, y }], carril: soloCapa(piezas) };
		}
		const carriles = carrilesDe(corredor);
		/** El recorrido completo si el cable fuera por el carril `y`. */
		const recorrido = (y: number): Reserva[] => [
			vertical(a.x, a.y, y),
			{
				horizontal: true, fijo: y,
				desde: Math.min(a.x, b.x) - holgura, hasta: Math.max(a.x, b.x) + holgura,
			},
			vertical(b.x, y, b.y),
		];
		/*
		 * Se busca sitio LIMPIO recorriendo capa por capa y, dentro de cada una, del centro del
		 * pasillo hacia fuera. Si no queda ninguno —tablero muy cargado— se coge el que MENOS se
		 * pise: al que peor le toca es al que menos estorba. Por turnos, que es lo que había antes
		 * de esto, volvían a montarse cables enteros unos encima de otros.
		 */
		let mejorY = carriles[0];
		let mejorCapa = 0;
		let mejorChoque = Infinity;
		buscar: for (let capa = 0; capa < capas; capa++) {
			for (const y of carriles) {
				const c = choque(recorrido(y), capa);
				if (c < mejorChoque) { mejorChoque = c; mejorY = y; mejorCapa = capa; }
				if (c === 0) break buscar;   // un sitio limpio ya no se puede mejorar
			}
		}
		tendido[mejorCapa].push(...recorrido(mejorY));
		return { puntos: [{ x: a.x, y: mejorY }, { x: b.x, y: mejorY }], carril: mejorCapa };
	};
}

/**
 * Redondea las esquinas de una polilínea: cada vértice se sustituye por un arco suave del
 * radio pedido. Un cable real nunca dobla en pico —tiene un radio mínimo de curvatura—, y
 * además así el tubo 3D no se «pellizca» ni se retuerce en los codos.
 */
export function redondearEsquinas(nodos: Punto[], radio = 14, pasos = 6): Punto[] {
	if (nodos.length < 3) return nodos.slice();
	const salida: Punto[] = [nodos[0]];
	for (let i = 1; i < nodos.length - 1; i++) {
		const a = nodos[i - 1];
		const b = nodos[i];
		const c = nodos[i + 1];
		const d1 = Math.hypot(b.x - a.x, b.y - a.y);
		const d2 = Math.hypot(c.x - b.x, c.y - b.y);
		// El radio nunca se come más de la mitad de cada tramo (si no, se deformaría el recorrido).
		const r = Math.min(radio, d1 / 2, d2 / 2);
		if (r < 1.5) { salida.push(b); continue; }
		const p1 = { x: b.x + ((a.x - b.x) / d1) * r, y: b.y + ((a.y - b.y) / d1) * r };
		const p2 = { x: b.x + ((c.x - b.x) / d2) * r, y: b.y + ((c.y - b.y) / d2) * r };
		salida.push(p1);
		for (let k = 1; k < pasos; k++) { // arco (Bézier cuadrática) con el vértice como control
			const t = k / pasos;
			const u = 1 - t;
			salida.push({
				x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x,
				y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y,
			});
		}
		salida.push(p2);
	}
	salida.push(nodos[nodos.length - 1]);
	return salida;
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
