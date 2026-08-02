/**
 * De lo DIBUJADO en el plano al EJE de la instalación.
 *
 * En un plano de climatización un conducto no se dibuja con una línea por el medio: se dibuja por
 * sus DOS LADOS, más las piezas, las reducciones y las rejillas. Al leer cada polilínea de esas
 * capas como si fuera el eje de un conducto salía lo que se veía en el 3D: cientos de trozos
 * sueltos que no conectaban con nada —568 fragmentos de inyección de 1,3 m de mediana y 681 de
 * extracción de 42 cm— y las rejillas convertidas en estrellas de colores.
 *
 * Aquí se hace lo que haría cualquiera mirando el plano: se buscan los dos lados de cada conducto
 * y se traza el eje por el medio. Con una ventaja de propina: el ancho deja de ser una constante
 * supuesta —hoy TODO lo de inyección se daba por 600 mm— y pasa a ser el que mide el plano en ese
 * tramo concreto.
 *
 * No sabe nada de Three.js ni del DXF: entra geometría y sale geometría, para poder probarlo.
 */

export interface Punto2 { x: number; y: number }

/** Un trazo dibujado en el plano: la polilínea tal cual viene de la capa. */
export interface TrazoDibujado {
	sistema: string;
	z: number;
	/** Ancho de proyecto de ese sistema; se usa solo si el plano no deja medirlo. */
	ancho: number;
	alto: number;
	puntos: [number, number][];
}

/** Un eje ya resuelto: por dónde va de verdad la instalación y cuánto mide de ancho. */
export interface EjeInstalacion {
	sistema: string;
	z: number;
	ancho: number;
	alto: number;
	puntos: [number, number][];
	/** true si el ancho se midió entre los dos lados; false si es el de proyecto. */
	anchoMedido: boolean;
}

interface Segmento { a: Punto2; b: Punto2; largo: number }

const TOL = 1;                 // mm: dos puntos más cerca que esto son el mismo
/*
 * mm: dos puntas más cerca que esto se dan por la misma unión.
 *
 * No es un número puesto a ojo. El eje de cada tramo se saca del TROZO EN QUE SE PISAN sus dos
 * lados, así que en cada codo y en cada pieza el eje se corta un poco antes de llegar: medido en
 * la cubierta, las puntas de dos tramos seguidos quedan a 165 mm de mediana, y con 60 no se cosía
 * absolutamente nada. Con 350 se une la inmensa mayoría sin llegar a saltar de un conducto al de
 * al lado, que en esta cubierta nunca están tan cerca.
 */
const UNION = 350;

const dist = (p: Punto2, q: Punto2): number => Math.hypot(p.x - q.x, p.y - q.y);

/** Trocea las polilíneas en segmentos rectos, quitando los repetidos del dibujo. */
function segmentosDe(trazos: TrazoDibujado[]): Segmento[] {
	const vistos = new Set<string>();
	const out: Segmento[] = [];
	for (const t of trazos) {
		for (let i = 1; i < t.puntos.length; i++) {
			const a = { x: t.puntos[i - 1][0], y: t.puntos[i - 1][1] };
			const b = { x: t.puntos[i][0], y: t.puntos[i][1] };
			const largo = dist(a, b);
			if (largo < TOL) continue;
			// La misma línea aparece repetida en el DXF (copias, capas duplicadas): se cuenta una
			// vez, y da igual en qué sentido esté dibujada.
			const k1 = `${a.x.toFixed(1)},${a.y.toFixed(1)}|${b.x.toFixed(1)},${b.y.toFixed(1)}`;
			const k2 = `${b.x.toFixed(1)},${b.y.toFixed(1)}|${a.x.toFixed(1)},${a.y.toFixed(1)}`;
			if (vistos.has(k1) || vistos.has(k2)) continue;
			vistos.add(k1);
			out.push({ a, b, largo });
		}
	}
	return out;
}

/**
 * ¿Son estos dos segmentos los dos lados del mismo conducto?
 *
 * Tienen que ser paralelos, estar a una separación creíble para una instalación y —esto es lo que
 * de verdad los distingue de dos conductos distintos que van en paralelo por el pasillo— pisarse
 * a lo largo: los dos lados de un conducto recorren el mismo tramo, no van uno detrás del otro.
 *
 * Devuelve el eje del trozo compartido y el ancho medido, o undefined si no son pareja.
 */
export function ladosDelMismoConducto(
	s: Segmento, t: Segmento, anchoMin: number, anchoMax: number,
): { a: Punto2; b: Punto2; ancho: number } | undefined {
	const ux = (s.b.x - s.a.x) / s.largo;
	const uy = (s.b.y - s.a.y) / s.largo;
	const vx = (t.b.x - t.a.x) / t.largo;
	const vy = (t.b.y - t.a.y) / t.largo;
	if (Math.abs(ux * vx + uy * vy) < 0.9995) return undefined;      // no son paralelos

	// Separación perpendicular entre las dos rectas.
	const px = t.a.x - s.a.x;
	const py = t.a.y - s.a.y;
	const separacion = Math.abs(-uy * px + ux * py);
	if (separacion < anchoMin || separacion > anchoMax) return undefined;

	// Trozo en que los dos se pisan, medido sobre la dirección de `s`.
	const t0 = ux * px + uy * py;
	const t1 = ux * (t.b.x - s.a.x) + uy * (t.b.y - s.a.y);
	const desde = Math.max(0, Math.min(t0, t1));
	const hasta = Math.min(s.largo, Math.max(t0, t1));
	// Se exige que compartan un tramo de verdad, no que se rocen por la punta.
	if (hasta - desde < Math.min(s.largo, t.largo) * 0.5) return undefined;

	// El eje va por el medio: sobre `s`, desplazado media separación hacia `t`.
	const haciaT = -uy * px + ux * py >= 0 ? 1 : -1;
	const nx = -uy * (separacion / 2) * haciaT;
	const ny = ux * (separacion / 2) * haciaT;
	return {
		a: { x: s.a.x + ux * desde + nx, y: s.a.y + uy * desde + ny },
		b: { x: s.a.x + ux * hasta + nx, y: s.a.y + uy * hasta + ny },
		ancho: separacion,
	};
}

/** Encadena ejes sueltos en recorridos: los que se tocan por la punta se cosen en uno. */
export function coserEjes(ejes: { a: Punto2; b: Punto2; ancho: number }[], union = UNION): {
	puntos: [number, number][]; ancho: number;
}[] {
	const libres = ejes.map((e) => ({ ...e, usado: false }));
	/*
	 * Rejilla para encontrar vecinos sin comparar todos contra todos. Se mira la casilla y LAS
	 * OCHO DE ALREDEDOR, que es el detalle que primero se me olvidó: dos puntas separadas quince
	 * milímetros pueden caer en casillas distintas y no se encontraban nunca, así que no se cosía
	 * casi nada y los conductos seguían saliendo troceados.
	 */
	const LADO = Math.max(40, union);
	const casilla = (p: Punto2): string => `${Math.round(p.x / LADO)},${Math.round(p.y / LADO)}`;
	const porPunta = new Map<string, number[]>();
	libres.forEach((e, i) => {
		for (const p of [e.a, e.b]) {
			const k = casilla(p);
			if (!porPunta.has(k)) porPunta.set(k, []);
			porPunta.get(k)!.push(i);
		}
	});
	const cerca = (p: Punto2): number[] => {
		const cx = Math.round(p.x / LADO);
		const cy = Math.round(p.y / LADO);
		const out: number[] = [];
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) out.push(...(porPunta.get(`${cx + dx},${cy + dy}`) ?? []));
		}
		return out;
	};

	const salida: { puntos: [number, number][]; ancho: number }[] = [];
	for (let i = 0; i < libres.length; i++) {
		if (libres[i].usado) continue;
		libres[i].usado = true;
		const cadena: Punto2[] = [libres[i].a, libres[i].b];
		const anchos = [libres[i].ancho];
		// Se sigue por los dos extremos mientras haya con quién continuar.
		for (const alFinal of [true, false]) {
			for (;;) {
				const punta = alFinal ? cadena[cadena.length - 1] : cadena[0];
				const vecino = cerca(punta)
					.find((j) => !libres[j].usado && (dist(libres[j].a, punta) < union || dist(libres[j].b, punta) < union));
				if (vecino === undefined) break;
				libres[vecino].usado = true;
				anchos.push(libres[vecino].ancho);
				const otro = dist(libres[vecino].a, punta) < union ? libres[vecino].b : libres[vecino].a;
				if (alFinal) cadena.push(otro); else cadena.unshift(otro);
			}
		}
		salida.push({
			puntos: cadena.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] as [number, number]),
			// El ancho del recorrido es el más repetido de sus tramos: un conducto puede llevar una
			// reducción por el camino, pero lo que lo define es la sección con la que va.
			ancho: masRepetido(anchos),
		});
	}
	return salida;
}

function masRepetido(valores: number[]): number {
	const cuenta = new Map<number, number>();
	for (const v of valores) {
		const k = Math.round(v / 25) * 25;      // se agrupan por 25 mm: el plano no es exacto
		cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
	}
	let mejor = valores[0];
	let masVeces = 0;
	for (const [k, n] of cuenta) if (n > masVeces) { masVeces = n; mejor = k; }
	return mejor;
}

/**
 * Saca los ejes de todas las instalaciones de un sistema.
 *
 * `largoMinimoSuelto` es el filtro de los detalles: un recorrido corto que no se cosió con nada es
 * una rejilla, una cota o el dibujo de una pieza —no un conducto— y no se lleva al 3D. Uno largo sí
 * se conserva aunque no se le encontraran los dos lados: hay instalaciones que el plano dibuja con
 * una sola línea, y perderlas sería peor que dibujarlas con el ancho de proyecto.
 *
 * El valor no está puesto a ojo, y ajustarlo tiene trampa: subiéndolo se ven menos trozos sueltos
 * y parece que ha quedado más limpio, pero lo que pasa es que se está borrando instalación. Se
 * calibró contra una cifra que no depende del gusto: el eje de una red dibujada por sus dos lados
 * tiene que medir LA MITAD de lo dibujado. En la cubierta del aeropuerto son 861 m de inyección y
 * 431 de extracción, o sea unos 430 y 215 de eje. Con 2.500 salían 205 y 85 —la mitad de la red
 * en la basura— y con 900 salen 444 y 233, que es justo lo que tiene que dar.
 */
export function ejesDeSistema(
	trazos: TrazoDibujado[],
	{ anchoMin = 40, anchoMax = 0, largoMinimoSuelto = 900 } = {},
): EjeInstalacion[] {
	if (trazos.length === 0) return [];
	const modelo = trazos[0];
	// Lo que el plano llame conducto no puede ser diez veces más ancho de lo proyectado: sin este
	// techo, dos cañerías de agua que corren en paralelo a metro y medio se emparejaban entre sí y
	// salía un «tubo» de 1.875 mm que no existe.
	const techo = anchoMax || Math.max(300, modelo.ancho * 3);
	const segs = segmentosDe(trazos);
	const usado = new Array<boolean>(segs.length).fill(false);
	const ejes: { a: Punto2; b: Punto2; ancho: number }[] = [];

	// Se emparejan de mayor a menor: los lados largos de un conducto encuentran antes a su pareja
	// que un trocito de pieza, y así no se roban las parejas entre sí.
	const orden = segs.map((_, i) => i).sort((i, j) => segs[j].largo - segs[i].largo);
	for (const i of orden) {
		if (usado[i]) continue;
		let mejor: { j: number; eje: { a: Punto2; b: Punto2; ancho: number } } | undefined;
		for (const j of orden) {
			if (j === i || usado[j]) continue;
			const eje = ladosDelMismoConducto(segs[i], segs[j], anchoMin, techo);
			if (!eje) continue;
			// Entre varios candidatos manda el más estrecho: es el otro lado del mismo conducto,
			// no el de un conducto vecino que corre en paralelo más allá.
			if (!mejor || eje.ancho < mejor.eje.ancho) mejor = { j, eje };
		}
		if (!mejor) continue;
		usado[i] = true;
		usado[mejor.j] = true;
		ejes.push(mejor.eje);
	}

	/*
	 * SE COSE PRIMERO Y SE FILTRA DESPUÉS, no al revés.
	 *
	 * Un ramal de extracción viene dibujado como veinte trocitos de cuarenta centímetros. Midiendo
	 * cada trocito por separado todos son «detalle» y se tiran, y con ellos media instalación;
	 * cosidos son una tirada de ocho metros que salta a la vista. Se descarta por el largo del
	 * RECORRIDO ENTERO, que es lo que de verdad dice si eso es una instalación o una rejilla.
	 */
	const sinPareja = segs
		.map((sg, i) => ({ sg, i }))
		.filter(({ i }) => !usado[i])
		.map(({ sg }) => ({ a: sg.a, b: sg.b, ancho: modelo.ancho }));

	const largoDe = (pts: [number, number][]): number =>
		pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

	const salida: EjeInstalacion[] = [];
	for (const [lista, medido] of [[ejes, true], [sinPareja, false]] as const) {
		for (const c of coserEjes(lista)) {
			if (largoDe(c.puntos) < largoMinimoSuelto) continue;
			const ancho = medido ? c.ancho : modelo.ancho;
			salida.push({
				sistema: modelo.sistema, z: modelo.z, puntos: c.puntos, ancho, anchoMedido: medido,
				alto: medido ? altoSegunElAncho(ancho) : modelo.alto,
			});
		}
	}
	return salida;
}

/**
 * Alto de un conducto rectangular a partir de su ancho.
 *
 * El plano da el ancho —se ve en planta— pero no el alto, y ponerle uno fijo daba conductos más
 * altos que anchos, que no existen. La proporción sale del PROPIO PLANO: sus bloques de conducto
 * se llaman por su sección en pulgadas —16X8, 8X4, 22X10, 14X8, 22X12— y todos van en 2:1 o muy
 * cerca. Así que el alto es la mitad del ancho, con un mínimo para que un conducto fino siga
 * viéndose. (Los anchos medidos, por cierto, también son pulgadas: 200 mm son 8" y 355 son 14".)
 */
export function altoSegunElAncho(ancho: number): number {
	return Math.max(80, Math.round(ancho / 2));
}

/** Saca los ejes de TODO lo dibujado, sistema por sistema. */
export function ejesDeLaPlanta(trazos: TrazoDibujado[]): EjeInstalacion[] {
	const porSistema = new Map<string, TrazoDibujado[]>();
	for (const t of trazos) {
		if (!porSistema.has(t.sistema)) porSistema.set(t.sistema, []);
		porSistema.get(t.sistema)!.push(t);
	}
	const out: EjeInstalacion[] = [];
	for (const [, lista] of porSistema) out.push(...ejesDeSistema(lista));
	return out;
}
