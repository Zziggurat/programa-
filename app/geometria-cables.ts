/**
 * Geometría pura de los recorridos de cable (sin dependencias de Three.js), para poder
 * probarla de forma aislada. La usan tanto la escena 3D como la interacción del editor.
 */

export interface Punto { x: number; y: number }

/** Punto del recorrido ya en el espacio: la profundidad es tan real como el resto. */
export interface Punto3 { x: number; y: number; z: number }

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

/** Rectángulo (mm de modelo) donde se puede tender cable. */
export interface Area { x0: number; x1: number; y0: number; y1: number }

/**
 * Encierra un punto de cable dentro del área donde de verdad se puede tender.
 *
 * Sin esto una unión se podía arrastrar A DONDE FUERA: en una placa de 400×500 acabó a 159 mm
 * por fuera, con el cable estirado hacia el vacío y el tirador lejos de la vista. Los aparatos
 * llevan su recorte desde siempre; los puntos de quiebre de los cables no lo tenían.
 */
export function dentroDelArea(p: Punto, area: Area): Punto {
	return {
		x: Math.min(Math.max(p.x, area.x0), area.x1),
		y: Math.min(Math.max(p.y, area.y0), area.y1),
	};
}

/** Rectángulo que ocupa un aparato en la placa (mm de modelo). */
export interface Huella { x: number; y: number; ancho: number; alto: number }

/**
 * Saca un punto de cable de encima de un aparato, por el lado que quede más cerca.
 *
 * En un tablero de verdad un hilo no cruza por la cara de un automático: lo rodea. El ruteo
 * automático ya lo respeta —solo usa corredores libres—, pero un punto puesto A MANO no lo
 * respetaba de dos maneras: se podía arrastrar encima de un aparato, y —peor— se quedaba donde
 * estaba cuando el aparato se movía DEBAJO de él más tarde, así que peinabas el cable, corrías
 * el guardamotor dos centímetros y el cable te quedaba cruzando por encima sin haberlo tocado.
 *
 * Se repasa dos veces porque salir de una huella puede meter el punto en la de al lado.
 */
export function fueraDeLaHuella(p: Punto, huellas: Huella[], margen = 4): Punto {
	let q = p;
	// Unas pocas vueltas bastan: cada una saca el punto de un bloque entero de aparatos.
	for (let vuelta = 0; vuelta < 4; vuelta++) {
		/*
		 * Se sale del BLOQUE, no de un aparato suelto, y esto no es un refinamiento: en un riel
		 * los aparatos van pegados unos a otros, con dos milímetros entre ellos. Saliendo de cada
		 * uno por separado, el punto rebotaba del primero al segundo y del segundo al primero sin
		 * salir nunca, porque entre los dos no cabe el margen.
		 */
		let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
		for (const h of huellas) {
			const a0 = h.x - margen; const a1 = h.x + h.ancho + margen;
			const b0 = h.y - margen; const b1 = h.y + h.alto + margen;
			if (q.x <= a0 || q.x >= a1 || q.y <= b0 || q.y >= b1) continue;
			x0 = Math.min(x0, a0); x1 = Math.max(x1, a1);
			y0 = Math.min(y0, b0); y1 = Math.max(y1, b1);
		}
		if (x0 === Infinity) break;   // ya está libre
		// El bloque CRECE con todo aparato que lo toque, en cadena. Si no, el de al lado se queda
		// fuera por medio milímetro y el punto sale de uno para meterse en el otro; en una fila de
		// riel eso es un bucle. Creciendo, el bloque acaba siendo la fila entera y la salida
		// barata pasa a ser por arriba o por abajo, que es por donde sale un cable de verdad.
		for (let crece = true; crece;) {
			crece = false;
			for (const h of huellas) {
				const a0 = h.x - margen; const a1 = h.x + h.ancho + margen;
				const b0 = h.y - margen; const b1 = h.y + h.alto + margen;
				if (a1 <= x0 || a0 >= x1 || b1 <= y0 || b0 >= y1) continue;   // no toca el bloque
				if (a0 < x0 || a1 > x1 || b0 < y0 || b1 > y1) {
					x0 = Math.min(x0, a0); x1 = Math.max(x1, a1);
					y0 = Math.min(y0, b0); y1 = Math.max(y1, b1);
					crece = true;
				}
			}
		}
		// Se sale por el lado más barato: el que menos desvía el cable de donde lo dejaste.
		const salidas = [
			{ d: q.x - x0, p: { x: x0, y: q.y } },
			{ d: x1 - q.x, p: { x: x1, y: q.y } },
			{ d: q.y - y0, p: { x: q.x, y: y0 } },
			{ d: y1 - q.y, p: { x: q.x, y: y1 } },
		].sort((a, b) => a.d - b.d);
		q = salidas[0].p;
	}
	return q;
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

/**
 * Redondea las esquinas de una polilínea 3D, arrastrando la profundidad.
 *
 * Es `redondearEsquinas` con la z a cuestas: el arco que sustituye a cada vértice interpola entre
 * la profundidad de entrada y la de salida. Hace falta porque desde que los cables entran y salen
 * de las canaletas, la profundidad ya no es una rampa entre los dos bornes: es un dato de cada
 * punto del recorrido —46 mm en el borne, la del carril dentro del ducto— y el suavizado tiene
 * que respetarla en vez de recalcularla.
 */
function redondear3D(nodos: Punto3[], radio: number, pasos = 6): { puntos: Punto3[]; arco: boolean[] } {
	if (nodos.length < 3) return { puntos: nodos.slice(), arco: nodos.map(() => false) };
	const salida: Punto3[] = [nodos[0]];
	/*
	 * Se apunta qué puntos nacieron de un codo. Hace falta más adelante: el filtro que quita puntos
	 * colineales los borraba, y un codo apretado —donde el radio pedido no cabe y el arco mide tres
	 * milímetros— se quedaba otra vez en esquina de pico. El filtro tiene una tolerancia en
	 * milímetros, y tres milímetros de arco caben dentro de ella; pero sobre un conductor de dos
	 * milímetros de radio eso no es «un punto que no dice nada», es la curva entera.
	 */
	const arco: boolean[] = [false];
	for (let i = 1; i < nodos.length - 1; i++) {
		const a = nodos[i - 1];
		const b = nodos[i];
		const c = nodos[i + 1];
		/*
		 * LAS DISTANCIAS SE MIDEN EN 3D, Y AQUÍ ESTABA EL CODO PINZADO.
		 *
		 * Se medían con `hypot(dx, dy)` —sin la z— pero la fracción que sale de ellas se aplica
		 * después al vector COMPLETO, profundidad incluida. Mientras todos los cables corrían por
		 * delante del tablero daba igual, porque la z apenas cambiaba a lo largo del recorrido. Desde
		 * que entran y salen de las canaletas hay codos que son un cambio PURO de profundidad: mismo
		 * x, mismo y, treinta milímetros de z. Para esta cuenta ese segmento medía CERO, así que el
		 * `continue` de abajo se llevaba el codo entero sin redondear y el tubo giraba en pico.
		 *
		 * Medido sobre un caso sintético de cambio de profundidad, la dirección del tubo giraba 90°
		 * de un tramo al siguiente. El ruteo no tenía la culpa —sus puntos eran razonables—: la
		 * deformación nacía aquí, al construir la malla.
		 */
		const d1 = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
		const d2 = Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z);
		const r = Math.min(radio, d1 / 2, d2 / 2);
		if (r < 1.5 || d1 < 1e-6 || d2 < 1e-6) { salida.push(b); arco.push(false); continue; }
		const t1 = r / d1;
		const t2 = r / d2;
		const p1 = { x: b.x + (a.x - b.x) * t1, y: b.y + (a.y - b.y) * t1, z: b.z + (a.z - b.z) * t1 };
		const p2 = { x: b.x + (c.x - b.x) * t2, y: b.y + (c.y - b.y) * t2, z: b.z + (c.z - b.z) * t2 };
		/*
		 * Los pasos del arco se reparten según lo que gire el codo, no a bulto.
		 *
		 * Con seis fijos, un codo suave sale sobrado y uno cerrado sale facetado: en el caso
		 * sintético del segmento corto —donde el radio pedido no cabe y hay que apretarlo— la
		 * dirección saltaba 36,9° de un trozo al siguiente, y eso se ve como una arista. Repartiendo
		 * por ángulo, cada trozo gira más o menos lo mismo en todos los codos.
		 */
		const giro = Math.acos(Math.min(1, Math.max(-1,
			((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + (a.z - b.z) * (c.z - b.z)) / (d1 * d2),
		)));
		const vuelta = Math.PI - giro;   // lo que se desvía de seguir recto
		const trozos = Math.min(14, Math.max(pasos, Math.ceil(vuelta / (Math.PI / 12))));
		salida.push(p1);
		arco.push(true);
		for (let k = 1; k < trozos; k++) {
			const t = k / trozos;
			const u = 1 - t;
			salida.push({
				x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x,
				y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y,
				z: u * u * p1.z + 2 * u * t * b.z + t * t * p2.z,
			});
			arco.push(true);
		}
		salida.push(p2);
		arco.push(true);
	}
	salida.push(nodos[nodos.length - 1]);
	arco.push(false);
	return { puntos: salida, arco };
}

/**
 * EL RECORRIDO QUE DE VERDAD SE VE, a partir de los puntos por los que tiene que pasar el cable.
 *
 * Esta función es la única fuente de verdad de la geometría del cableado: la usa el repartidor
 * para probar dónde cabe cada cable, sus puntos son los que dibuja la escena y son los que miden
 * las pruebas. Si las tres miran lo mismo, lo que se mide es lo que se ve.
 *
 * Antes recibía una polilínea plana y le inventaba la profundidad con una rampa entre los dos
 * bornes. Eso valía mientras todos los cables viajaran por delante del tablero; desde que entran
 * en las canaletas, la profundidad es un dato del recorrido —46 mm en el borne, la del carril
 * dentro del ducto, y el paso por la ranura entre medias— y quien la decide es el router.
 *
 *   `nodos`      los puntos por los que pasa, cada uno con su profundidad
 *   `radioCodo`  el radio mínimo de curvatura del conductor
 *   `sueloMin`   por debajo de qué profundidad no se puede ir en cada punto (lo que se cruza
 *                por fuera y no se puede atravesar)
 */
export function tenderCable(
	nodos: Punto3[], radioCodo: number, sueloMin?: (x: number, y: number, z: number) => number,
): Punto3[] {
	/*
	 * PRIMERO SE TIRAN LOS NODOS QUE NO SON UN NODO.
	 *
	 * En el estrella-triángulo hay 59 puntos EXACTAMENTE repetidos y 391 tramos de menos de medio
	 * milímetro sobre 3.786. Un tramo de longitud cero no tiene dirección, así que redondear una
	 * esquina contra él no significa nada: el arco sale disparado hacia donde diga el ruido, y con
	 * dos de esos seguidos el cable serpentea. Eso es lo que hacía que un conductor bajando a la
	 * canaleta se desviase hasta meterse encima del que ya corría por ella.
	 *
	 * Se colapsan antes de tocar nada más. No es un ajuste del ruteo: un punto a 0,2 mm del
	 * anterior describe el mismo recorrido, solo que sin decírselo a la geometría.
	 */
	/*
	 * 1,5 mm, y el número sale de medir, no de elegirlo bonito. Sobre los cinco tableros, peor par
	 * de cada uno (holgura negativa = tubos metidos uno en otro):
	 *
	 *              0,5 mm    1,5 mm    3,0 mm
	 *   directo    −0,46     −0,46     +0,92
	 *   e-t        −5,10     −2,80     −5,80
	 *   UMA        −2,82     −2,82     −3,18
	 *
	 * Con 0,5 se queda corto: el zigzag de un milímetro sigue ahí y el estrella-triángulo mete un
	 * conductor dentro de otro. Con 3,0 se pasa: empieza a tirar nodos que SÍ dicen algo y el
	 * recorrido cambia de sitio. Un punto medio milímetro por detrás del anterior describe el mismo
	 * camino; uno a tres milímetros ya puede ser una esquina de verdad.
	 */
	const MINIMO = 1.5;
	const limpios: Punto3[] = [nodos[0]];
	for (let i = 1; i < nodos.length; i++) {
		const a = limpios[limpios.length - 1];
		const b = nodos[i];
		if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) >= MINIMO) limpios.push(b);
	}
	// El último manda siempre: es el borne, y ahí no se negocia.
	const fin = nodos[nodos.length - 1];
	if (limpios.length < 2) limpios.push(fin);
	else limpios[limpios.length - 1] = fin;

	const { puntos: suave, arco: arcoSuave } = redondear3D(limpios, radioCodo);
	/*
	 * EL RECORRIDO SE PARTE EN TROZOS CORTOS, y esto no es un detalle: es lo que hace que la
	 * profundidad exista. Redondear solo mete vértices en las esquinas, así que una tirada recta
	 * de cuatrocientos milímetros sale como UN segmento con sus dos puntos pegados a los extremos,
	 * y cualquier perfil de profundidad calculado sobre esos dos puntos es una línea recta entre
	 * ellos. Con trozos de 8 mm, el perfil tiene dónde apoyarse.
	 */
	const PASO = 8;
	const denso: Punto3[] = [suave[0]];
	const enCodo: boolean[] = [arcoSuave[0]];
	for (let i = 1; i < suave.length; i++) {
		const trozos = Math.max(1, Math.ceil(
			Math.hypot(suave[i].x - suave[i - 1].x, suave[i].y - suave[i - 1].y, suave[i].z - suave[i - 1].z) / PASO,
		));
		for (let k = 1; k <= trozos; k++) {
			const u = k / trozos;
			denso.push({
				x: suave[i - 1].x + (suave[i].x - suave[i - 1].x) * u,
				y: suave[i - 1].y + (suave[i].y - suave[i - 1].y) * u,
				z: suave[i - 1].z + (suave[i].z - suave[i - 1].z) * u,
			});
			// Solo lo que va DE arco A arco es curva. Con «alguno de los dos» se protegía también la
			// tirada recta que muere en el codo, y un cable simple pasaba de nueve puntos a
			// veintinueve: puntos que no dicen nada y que luego hay que comparar contra los demás
			// cables uno por uno.
			enCodo.push(arcoSuave[i - 1] && arcoSuave[i]);
		}
	}

	const acumulado: number[] = [0];
	for (let i = 1; i < denso.length; i++) {
		acumulado.push(acumulado[i - 1] + Math.hypot(
			denso[i].x - denso[i - 1].x, denso[i].y - denso[i - 1].y, denso[i].z - denso[i - 1].z,
		));
	}
	const z = denso.map((q) => q.z);

	/*
	 * EL CABLE PASA POR DELANTE DE LO QUE NO PUEDE ATRAVESAR.
	 *
	 * `sueloMin` dice, para cada punto, por debajo de qué profundidad no se puede ir. Lo usan los
	 * tramos que cruzan una canaleta POR FUERA: si un cable no entra en ese ducto, tiene que pasar
	 * por encima de sus dedos y no a través de ellos. Los dos barridos limitan la pendiente para
	 * que trepe en vez de dar un escalón, y solo suben el perfil: lo levantado no se vuelve a
	 * hundir en el obstáculo.
	 */
	const levantado = new Array<boolean>(denso.length).fill(false);
	if (sueloMin) {
		for (let i = 0; i < denso.length; i++) {
			const suelo = sueloMin(denso[i].x, denso[i].y, denso[i].z);
			if (suelo > z[i]) { z[i] = suelo; levantado[i] = true; }
		}
		const PENDIENTE = 0.55;   // 29° de subida: lo que trepa un conductor sin pellizcarse
		for (let i = 1; i < z.length; i++) {
			z[i] = Math.max(z[i], z[i - 1] - PENDIENTE * (acumulado[i] - acumulado[i - 1]));
		}
		for (let i = z.length - 2; i >= 0; i--) {
			z[i] = Math.max(z[i], z[i + 1] - PENDIENTE * (acumulado[i + 1] - acumulado[i]));
		}
	}
	// Los dos extremos son el borne: ahí manda el tornillo, pase lo que pase.
	z[0] = nodos[0].z;
	z[z.length - 1] = nodos[nodos.length - 1].z;

	/*
	 * Y se quitan los puntos que no dicen nada: los que caen sobre la recta que une a sus vecinos.
	 * Partir cada 8 mm hace falta, pero dejarlo partido multiplica por tres los tramos que hay que
	 * comparar contra los demás cables. Un punto levantado por un obstáculo no se quita nunca.
	 */
	const salida: Punto3[] = [{ ...denso[0], z: z[0] }];
	for (let i = 1; i < denso.length - 1; i++) {
		const b = { x: denso[i].x, y: denso[i].y, z: z[i] };
		if (levantado[i] || levantado[i - 1] || levantado[i + 1] || enCodo[i]) { salida.push(b); continue; }
		const a = salida[salida.length - 1];
		const c = { x: denso[i + 1].x, y: denso[i + 1].y, z: z[i + 1] };
		const u = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
		const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
		const largoAC = Math.hypot(u.x, u.y, u.z) || 1;
		const fuera = Math.hypot(
			u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x,
		) / largoAC;
		if (fuera > 0.15) salida.push(b);
	}
	salida.push({ ...denso[denso.length - 1], z: z[z.length - 1] });
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
