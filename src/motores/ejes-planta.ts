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
	/**
	 * true si esto no es un tramo de conducto sino una PIEZA: una transición, una compuerta o un
	 * acoplamiento flexible, que el plano dibuja EN ASPA —dos diagonales cortas que se cruzan—.
	 *
	 * Son 129 de los 398 recorridos de esta cubierta, 149 m: un tercio de lo que se estaba
	 * dibujando como conducto. Y al dibujarlas como conducto salían dos palos cruzándose en el
	 * aire junto a cada máquina, que es lo que hacía que la instalación pareciera rota.
	 */
	pieza?: boolean;
	/**
	 * A QUÉ ACCESORIO pertenece esta diagonal. Tercera auditoría, TS3-P2-07.
	 *
	 * Un aspa son dos diagonales y UNA pieza. Sin esto, el visor dibujaba una caja por diagonal
	 * —129 cajas en esta cubierta— y el metrado sumaba las dos como si fueran dos accesorios. Las
	 * diagonales del mismo cruce comparten número, así que se puede dibujar y contar una vez.
	 */
	accesorio?: number;
}

interface Segmento { a: Punto2; b: Punto2; largo: number }

const TOL = 1;                 // mm: dos puntos más cerca que esto son el mismo
/*
 * mm: dos puntas más cerca que esto se dan por la misma unión.
 *
 * No es un número puesto a ojo. El eje de cada tramo se saca del TROZO EN QUE SE PISAN sus dos
 * lados, así que en cada codo y en cada pieza el eje se corta un poco antes de llegar: medido en
 * la cubierta, las puntas de dos tramos seguidos quedan a 165 mm de mediana, y con 60 no se cosía
 * absolutamente nada.
 *
 * Subirlo tiene trampa, y se comprobó: cuanto más alto, menos trozos sueltos se ven —parece más
 * limpio— pero empieza a saltar de un conducto al de al lado e inventar metros que no existen. Se
 * mide contrastando los metros de eje que salen con los DIBUJADOS en el plano, que dan un suelo
 * fiable: un conducto dibujado por sus dos lados tiene que dar un eje de la mitad de lo dibujado.
 *
 *   umbral   inyección                  extracción
 *     350    156 recorridos, 491 m      149 recorridos, 253 m   ← aquí
 *     650    136 recorridos, 506 m      149 recorridos, 264 m
 *     800    129 recorridos, 510 m      146 recorridos, 264 m
 *
 * De 350 a 650 la inyección solo baja 20 recorridos y a cambio se inventa 15 m, y la extracción no
 * mejora nada y se inventa 11 m. No sale a cuenta: lo que de verdad quitó los trozos sueltos no fue
 * subir esto, sino coser los dos montones juntos y no equivocarse de vecino.
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

/** Un tramo de eje listo para coserse. `medido` dice si su ancho salió del plano o es el de proyecto. */
export interface TramoEje {
	a: Punto2;
	b: Punto2;
	ancho: number;
	/** True si el ancho se midió entre los dos lados dibujados; false si es el de proyecto. */
	medido?: boolean;
}

/**
 * Encadena tramos sueltos en recorridos: los que se tocan por la punta se cosen en uno.
 *
 * SE COSE TODO JUNTO, medido y no medido. Antes se cosía en dos montones —los conductos a los que
 * se les encontraron los dos lados por un lado, las líneas sueltas por otro— y los dos montones no
 * se tocaban nunca. En la cubierta del aeropuerto eso dejaba 272 puntas de conducto con otra a
 * menos de 35 cm que era IMPOSIBLE unir, porque su vecina estaba en el otro montón: un ramal cuyo
 * tramo central sí se midió y cuyas puntas no salía partido en tres por construcción. De ahí que
 * la inyección saliera en 235 trocitos de dos metros de media.
 */
export function coserEjes(ejes: TramoEje[], union = UNION): {
	puntos: [number, number][]; ancho: number; medido: boolean;
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

	const salida: { puntos: [number, number][]; ancho: number; medido: boolean }[] = [];
	for (let i = 0; i < libres.length; i++) {
		if (libres[i].usado) continue;
		libres[i].usado = true;
		const cadena: Punto2[] = [libres[i].a, libres[i].b];
		const anchos: { ancho: number; medido: boolean }[] = [
			{ ancho: libres[i].ancho, medido: !!libres[i].medido },
		];
		// Se sigue por los dos extremos mientras haya con quién continuar.
		for (const alFinal of [true, false]) {
			for (;;) {
				const punta = alFinal ? cadena[cadena.length - 1] : cadena[0];
				/*
				 * De entre los candidatos se coge EL MÁS CERCANO, no el primero que aparezca.
				 *
				 * Con `.find()` mandaba el orden en que la rejilla devolvía los vecinos, que no es
				 * ningún orden: en un cruce donde concurren tres conductos, la costura enganchaba
				 * con el que tocara y el recorrido salía dando un salto raro en vez de seguir
				 * derecho. Se notaba en que el metraje total no bajaba de forma ordenada al subir
				 * el umbral, que es imposible si se cose bien.
				 */
				// Por dónde se venía al llegar a esta punta: hace falta para no aceptar horquillas.
				const previo = alFinal ? cadena[cadena.length - 2] : cadena[1];
				/*
				 * El más cercano de los candidatos, descartando los que SE CRUZAN con el tramo por
				 * el que se viene.
				 *
				 * Lo de cruzarse no es un detalle: dos rayas en aspa —una rejilla, una cota, el
				 * símbolo de una pieza— tienen las cuatro puntas cerca unas de otras, así que por
				 * cercanía se cosen entre sí y salen al 3D convertidas en un conducto que no
				 * existe. Y dos tramos del MISMO conducto no se cruzan nunca: van uno detrás del
				 * otro o doblan en codo, pero no se pisan.
				 */
				let vecino: number | undefined;
				let masCerca = union;
				for (const j of cerca(punta)) {
					if (libres[j].usado) continue;
					const cercaA = dist(libres[j].a, punta);
					const cercaB = dist(libres[j].b, punta);
					const d = Math.min(cercaA, cercaB);
					if (d >= masCerca) continue;
					if (previo && seCruzan(previo, punta, libres[j].a, libres[j].b)) continue;
					masCerca = d; vecino = j;
				}
				if (vecino === undefined) break;
				libres[vecino].usado = true;
				anchos.push({ ancho: libres[vecino].ancho, medido: !!libres[vecino].medido });
				// Se continúa por el extremo LEJANO del vecino: el cercano es el que se acaba de unir.
				const otro = dist(libres[vecino].a, punta) <= dist(libres[vecino].b, punta)
					? libres[vecino].b : libres[vecino].a;
				if (alFinal) cadena.push(otro); else cadena.unshift(otro);
			}
		}
		/*
		 * El ancho sale de los tramos MEDIDOS si los hay, y solo si no hay ninguno se usa el de
		 * proyecto. Promediarlo todo junto sería peor que no medir: en un ramal con dos tramos
		 * medidos de 200 y ocho puntas sin medir a las que se les puso el ancho de proyecto, el de
		 * proyecto ganaría la votación y se perdería justo el dato bueno.
		 */
		const medidos = anchos.filter((x) => x.medido);
		salida.push({
			puntos: cadena.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] as [number, number]),
			// De entre ellos, el más repetido: un conducto puede llevar una reducción por el camino,
			// pero lo que lo define es la sección con la que va.
			ancho: masRepetido((medidos.length ? medidos : anchos).map((x) => x.ancho)),
			medido: medidos.length > 0,
		});
	}
	return salida;
}

/** ¿Se cruzan de verdad los dos tramos? (Se tocan por la punta no cuenta: eso es una unión.) */
function seCruzan(p1: Punto2, p2: Punto2, p3: Punto2, p4: Punto2): boolean {
	const lado = (a: Punto2, b: Punto2, c: Punto2): number =>
		(b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	const d1 = lado(p3, p4, p1);
	const d2 = lado(p3, p4, p2);
	const d3 = lado(p1, p2, p3);
	const d4 = lado(p1, p2, p4);
	// Cada segmento tiene que dejar al otro con una punta a cada lado, y en sentido ESTRICTO: si
	// alguno da cero es que se tocan o son colineales, que es justo lo que sí se quiere coser.
	return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
		&& d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
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
 * Lo más ancho que se admite como «un conducto» al buscarle los dos lados.
 *
 * Hace falta un techo: sin él, dos cañerías de agua que corren en paralelo a metro y medio se
 * emparejaban entre sí y salía un «tubo» de 1.875 mm que no existe.
 *
 * PERO EL TECHO NO PUEDE SALIR DEL ANCHO DE PROYECTO. Era `ancho de proyecto × 3`, y ese ancho es
 * el de RESPALDO, o sea el del conducto más PEQUEÑO del sistema: para extracción son 200 mm, así
 * que el techo quedaba en 600. Y en la cubierta, el conducto de extracción de cada UMA está
 * dibujado por sus dos lados a 1.500 mm —medido en UMA-2-373 y en otras veintisiete máquinas—. Se
 * rechazaba por ancho, se quedaba sin medir y salía como trocitos sueltos alrededor de la máquina.
 *
 * Ahora el techo es FÍSICO y por familia: el aire va por conductos que en una cubierta llegan a
 * dos metros de ancho; el agua, la bandeja y el bus no. Contrastado con la vara de medir de esta
 * casa —el eje de una red dibujada por sus dos lados tiene que medir la MITAD de lo dibujado—,
 * mejora las dos:
 *
 *                   dibujado   eje esperado   con techo ×3   con techo físico
 *   inyección         861 m        431 m       491 m (+14 %)   453 m (+5 %)
 *   extracción        432 m        216 m       253 m (+17 %)   225 m (+4 %)
 *
 * Y los conductos de extracción con el ancho MEDIDO del plano, en vez de supuesto, pasan de 14 a
 * 28 de 139. Eso es lo que se buscaba: menos ancho inventado.
 *
 * LO QUE NO ARREGLA, y conviene que quede escrito para no volver a intentarlo por ahí: la
 * extracción sigue saliendo en trozos cortos alrededor de cada máquina —el 85 % por debajo de dos
 * metros, con cualquier techo—. No es el emparejado: es que el plano dibuja ahí tramos cortos de
 * verdad y piezas de transición EN ASPA, dos diagonales que se cruzan y que por tanto no son «dos
 * lados» de nada. Coserlas sería inventar conducto donde hay un accesorio.
 */
export function techoDeAncho(sistema: string, anchoDeProyecto: number): number {
	// Un conducto de aire de cubierta llega a 2 m de ancho; una cañería o una bandeja, no.
	if (sistema === 'inyeccion' || sistema === 'extraccion') return 1800;
	return Math.max(300, anchoDeProyecto * 3);
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
	{ anchoMin = 40, anchoMax = 0, largoMinimoSuelto = 900, union = UNION } = {},
): EjeInstalacion[] {
	if (trazos.length === 0) return [];
	const modelo = trazos[0];
	const techo = anchoMax || techoDeAncho(modelo.sistema, modelo.ancho);
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
	const sinPareja: TramoEje[] = segs
		.map((sg, i) => ({ sg, i }))
		.filter(({ i }) => !usado[i])
		.map(({ sg }) => ({ a: sg.a, b: sg.b, ancho: modelo.ancho, medido: false }));

	const largoDe = (pts: [number, number][]): number =>
		pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

	/*
	 * Los dos juntos, en una sola costura. Un ramal real llega con su tramo central dibujado por
	 * los dos lados —del que sí se saca el ancho— y sus puntas y codos dibujados con una raya
	 * sola; cosiéndolos por separado, ese ramal salía partido en tres trozos que no se tocaban.
	 */
	const medidos: TramoEje[] = ejes.map((e) => ({ ...e, medido: true }));
	const salida: EjeInstalacion[] = [];
	for (const c of coserEjes([...medidos, ...sinPareja], union)) {
		if (largoDe(c.puntos) < largoMinimoSuelto) continue;
		salida.push({
			sistema: modelo.sistema, z: modelo.z, puntos: c.puntos,
			ancho: c.medido ? c.ancho : modelo.ancho,
			anchoMedido: c.medido,
			alto: c.medido ? altoSegunElAncho(c.ancho) : modelo.alto,
		});
	}
	marcarPiezas(salida);
	return salida;
}

/**
 * Marca las PIEZAS: lo que el plano dibuja en aspa y no es un tramo de conducto.
 *
 * La costura ya sabe que dos tramos que se cruzan no son el mismo conducto y por eso no los une
 * (`seCruzan`). Lo que faltaba es la otra mitad: si al terminar quedan DOS recorridos cortos,
 * rectos y cruzados entre sí, eso no es que se haya perdido una costura — es una transición, una
 * compuerta o un acoplamiento flexible, que se dibujan con sus dos diagonales.
 *
 * Se comprobó en la cubierta: de los 66 recorridos cortos de inyección con una punta vecina a
 * menos de 350 mm —o sea, dentro del umbral de costura y aun así sin unir— los 32 que quedaban
 * son aspas, y las 32 estaban bien rechazadas. No había ni una costura perdida.
 *
 * No se BORRAN, porque están en un sitio real y son una pieza de verdad: se marcan, para que el
 * visor las dibuje como lo que son en vez de como dos palos cruzándose en el aire, y para que no
 * cuenten como metros de conducto.
 */
function marcarPiezas(ejes: EjeInstalacion[]): void {
	// Una pieza es corta y recta; un conducto que va a alguna parte, ni lo uno ni lo otro.
	const LARGO_MAXIMO_PIEZA = 3000;
	const candidatos = ejes
		.map((e, i) => ({ e, i }))
		.filter(({ e }) => e.puntos.length === 2
			&& Math.hypot(e.puntos[1][0] - e.puntos[0][0], e.puntos[1][1] - e.puntos[0][1]) < LARGO_MAXIMO_PIEZA);

	/*
	 * QUÉ DIAGONALES SON EL MISMO ACCESORIO. Tercera auditoría, TS3-P2-07.
	 *
	 * Marcar las dos diagonales y dibujar una caja por cada una daba 129 cajas para esta cubierta,
	 * y 129 no es el número de accesorios: un aspa son DOS diagonales y UNA sola pieza. El informe
	 * lo dijo así: «se observaron 129 cajas para un conjunto menor de cruces/componentes. No es una
	 * "pieza" agregada ni un metrado as-built».
	 *
	 * Se agrupan con un union-find sobre los cruces. Va por componente conexa a propósito: donde el
	 * plano dibuja tres o cuatro diagonales encadenadas —pasa en las transiciones con compuerta—
	 * eso sigue siendo UN accesorio, no dos y medio. Cada grupo recibe un número, y con él el visor
	 * dibuja una pieza por accesorio y el metrado cuenta accesorios en vez de diagonales.
	 */
	const padre = candidatos.map((_, i) => i);
	const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
	const unir = (a: number, b: number): void => { padre[raiz(a)] = raiz(b); };
	const cruzados = new Set<number>();

	for (let a = 0; a < candidatos.length; a++) {
		for (let b = a + 1; b < candidatos.length; b++) {
			const p = candidatos[a].e;
			const q = candidatos[b].e;
			if (!seCruzan(
				{ x: p.puntos[0][0], y: p.puntos[0][1] }, { x: p.puntos[1][0], y: p.puntos[1][1] },
				{ x: q.puntos[0][0], y: q.puntos[0][1] }, { x: q.puntos[1][0], y: q.puntos[1][1] },
			)) continue;
			cruzados.add(a); cruzados.add(b);
			unir(a, b);
		}
	}

	// Los números de accesorio salen correlativos: 0, 1, 2… y no los índices sueltos del union-find.
	const numeroDeRaiz = new Map<number, number>();
	for (const i of [...cruzados].sort((x, y) => x - y)) {
		const r = raiz(i);
		if (!numeroDeRaiz.has(r)) numeroDeRaiz.set(r, numeroDeRaiz.size);
		candidatos[i].e.pieza = true;
		candidatos[i].e.accesorio = numeroDeRaiz.get(r);
	}
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

/**
 * Metros de instalación DE VERDAD por sistema, separando conducto de accesorios.
 *
 * Hasta ahora la leyenda del visor sumaba las líneas DIBUJADAS, y un conducto dibujado por sus dos
 * lados cuenta dos veces. Los números que salían no eran metros de conducto sino metros de raya:
 *
 *   sistema        decía      es      de eso, piezas
 *   inyección      861 m    409 m         42 m
 *   extracción     432 m    118 m        107 m
 *   bandeja        129 m     73 m          0 m
 *   agua           371 m    330 m          0 m   (va con una sola línea: casi no cambia)
 *   bus            552 m    549 m          0 m
 *
 * Más del doble en inyección y casi cuatro veces en extracción. Quien mirase eso para hacerse una
 * idea de la instalación se llevaba una idea equivocada, y es de las cifras que se usan para
 * decidir cosas. Las piezas se cuentan aparte porque son accesorios, no metros de tirada.
 */
export function metrosDeInstalacion(trazos: TrazoDibujado[]): {
	sistema: string; metros: number; piezas: number; accesorios: number;
}[] {
	const largo = (p: [number, number][]): number =>
		p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
	const por = new Map<string, { metros: number; piezas: number; accesorios: Set<number> }>();
	for (const e of ejesDeLaPlanta(trazos)) {
		if (!por.has(e.sistema)) por.set(e.sistema, { metros: 0, piezas: 0, accesorios: new Set() });
		const acc = por.get(e.sistema)!;
		if (e.pieza) {
			acc.piezas += largo(e.puntos);
			/*
			 * Se cuentan ACCESORIOS, no diagonales. Tercera auditoría, TS3-P2-07: un aspa son dos
			 * diagonales y una sola pieza, y en esta cubierta las 129 diagonales son 48 piezas. Los
			 * metros de aspa siguen ahí porque dicen cuánto conducto NO son, pero para pedir
			 * material lo que hace falta es cuántas piezas hay.
			 */
			if (e.accesorio !== undefined) acc.accesorios.add(e.accesorio);
		} else acc.metros += largo(e.puntos);
	}
	return [...por]
		.map(([sistema, v]) => ({
			sistema,
			metros: Math.round(v.metros / 1000),
			piezas: Math.round(v.piezas / 1000),
			accesorios: v.accesorios.size,
		}))
		.sort((a, b) => b.metros - a.metros);
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
