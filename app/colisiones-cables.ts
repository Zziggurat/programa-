/**
 * ¿SE TOCAN DOS CABLES DE VERDAD?
 *
 * El reparto de cables decidía los conflictos con esta función, en `geometria-cables.ts`:
 *
 *     if (a.horizontal !== b.horizontal) return 0;   // «se cruzan, no se montan»
 *     if (Math.abs(a.fijo - b.fijo) > tolerancia) return 0;
 *
 * Dos reglas que suenan razonables y que juntas dejan pasar casi todo:
 *
 *   · UN CRUCE VALE CERO. Un tramo horizontal contra uno vertical se declara no conflictivo por
 *     construcción. Como el repartidor busca el sitio con menos choque, le sale gratis meter
 *     veinte cables en la capa de atrás mientras ninguno vaya PARALELO a otro: todos los cruces
 *     perpendiculares le salen a coste cero. Y dos cables de la misma capa tienen exactamente la
 *     misma z, así que cada uno de esos cruces gratis es una intersección física.
 *
 *   · EL GROSOR NO EXISTE. La tolerancia son 3 mm entre ejes. Un conductor de 6 mm² tiene 3 mm de
 *     radio: dos de ellos necesitan 6 mm entre ejes para no tocarse. A 3,5 mm el reparto dice
 *     «sin conflicto» y hay dos milímetros y medio de tubo metidos uno dentro de otro.
 *
 * Y hay dos cosas más que ni llegaban a esa función: los codos se redondean DESPUÉS de reservar
 * el sitio (el arco se come hasta 5 mm hacia dentro de la esquina), y la rampa de profundidad
 * —la que hace que el cable salga del borne a la cota del borne y suba a su carril— atraviesa por
 * el camino la profundidad de todas las capas que tiene por debajo.
 *
 * Este módulo mide lo que de verdad hay: la distancia mínima entre los DOS RECORRIDOS
 * TRIDIMENSIONALES ya suavizados, con sus radios. Es geometría pura, sin Three.js, para poder
 * usarla en tres sitios a la vez: el repartidor la usa para elegir sitio, el dibujo pinta
 * exactamente esos mismos puntos, y las pruebas miden sobre eso mismo.
 */
import { Punto3 } from './geometria-cables.js';

export type { Punto3 };

/** Un conductor ya resuelto, con el recorrido que se va a dibujar y su radio. */
export interface Trazo {
	id: string;
	radio: number;
	puntos: Punto3[];
	/** Los dos bornes a los que va, como `aparato:borne`. */
	bornes?: [string, string];
	/** Dónde están esos bornes, para saber si un contacto es el del propio tornillo. */
	extremos?: [Punto3, Punto3];
	/** Los sólidos de los aparatos a los que este cable va conectado. */
	propios?: string[];
}

/** Dónde y cuánto se acercan (o se meten) dos cables. */
export interface Conflicto {
	a: string;
	b: string;
	/** Separación entre superficies: negativa si los tubos se penetran. */
	holgura: number;
	/** Distancia entre ejes en ese punto. */
	distanciaEjes: number;
	/** Punto medio del acercamiento, en mm de modelo. */
	donde: Punto3;
}

/**
 * A qué distancia de un borne compartido se deja de exigir holgura.
 *
 * Dos cables que van al MISMO tornillo tienen que juntarse: es lo que pasa en el tablero de
 * verdad, y bajo la cabeza de un tornillo caben dos punteras. Exigirles aire ahí sería pedir algo
 * físicamente imposible, y el repartidor se pasaría la vida buscando un sitio que no existe. Lo
 * que sí se exige es que se junten SOLO ahí: pasado este radio, cada uno por su lado.
 */
const RADIO_BORNE = 14;

/** Largo físico de la zona de salida: coincide con el radio mínimo del primer codo. */
export function radioZonaSalidaBorne(radioCable: number): number {
	return 10 + radioCable * 4;
}

const resta = (p: Punto3, q: Punto3): Punto3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const punto = (p: Punto3, q: Punto3): number => p.x * q.x + p.y * q.y + p.z * q.z;

/**
 * Distancia mínima entre los segmentos p0→p1 y q0→q1, y el punto medio del acercamiento.
 *
 * Es el cálculo exacto de segmento contra segmento, no de punto contra segmento ni de extremo
 * contra extremo. Importa que sea el exacto: dos cables que se cruzan en aspa tienen sus cuatro
 * extremos lejísimos unos de otros y el punto donde se tocan está en mitad de los dos.
 */
export function distanciaSegmentos(
	p0: Punto3, p1: Punto3, q0: Punto3, q1: Punto3,
): { d: number; donde: Punto3 } {
	const u = resta(p1, p0);
	const v = resta(q1, q0);
	const w = resta(p0, q0);
	const a = punto(u, u);
	const b = punto(u, v);
	const c = punto(v, v);
	const d = punto(u, w);
	const e = punto(v, w);
	const den = a * c - b * b;
	let s: number;
	let t: number;
	if (den < 1e-9) {
		// Paralelos: se ancla uno y se busca en el otro, que es el caso de dos cables que van
		// juntos por el mismo pasillo.
		s = 0;
		t = c > 1e-9 ? e / c : 0;
	} else {
		s = (b * e - c * d) / den;
		t = (a * e - b * d) / den;
	}
	s = Math.min(1, Math.max(0, s));
	t = Math.min(1, Math.max(0, t));
	// Recortar s o t deja al otro fuera de sitio: se recalcula sobre el segmento contrario.
	if (a > 1e-9) s = Math.min(1, Math.max(0, (b * t - d) / a));
	if (c > 1e-9) t = Math.min(1, Math.max(0, (b * s + e) / c));
	if (a > 1e-9) s = Math.min(1, Math.max(0, (b * t - d) / a));
	const pa = { x: p0.x + u.x * s, y: p0.y + u.y * s, z: p0.z + u.z * s };
	const pb = { x: q0.x + v.x * t, y: q0.y + v.y * t, z: q0.z + v.z * t };
	return {
		d: Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z),
		donde: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 },
	};
}

/**
 * Longitud durante la que dos polilíneas ocupan prácticamente el mismo eje 3D.
 *
 * Un cruce perpendicular puede tener distancia cero en un punto y no por eso ser una fusión.
 * Esta medida solo suma solape entre segmentos paralelos, a menos de `tolerancia` entre sus
 * rectas. Tampoco suma un extremo común sin longitud, que es justamente el caso legítimo de dos
 * conductores sujetos por el mismo tornillo.
 */
export function longitudCoincidente3D(
	a: readonly Punto3[], b: readonly Punto3[], tolerancia = 0.5,
): number {
	let total = 0;
	for (let i = 1; i < a.length; i++) {
		const a0 = a[i - 1];
		const a1 = a[i];
		const ux = a1.x - a0.x, uy = a1.y - a0.y, uz = a1.z - a0.z;
		const la = Math.hypot(ux, uy, uz);
		if (la < 1e-9) continue;
		const nx = ux / la, ny = uy / la, nz = uz / la;
		for (let j = 1; j < b.length; j++) {
			const b0 = b[j - 1];
			const b1 = b[j];
			const vx = b1.x - b0.x, vy = b1.y - b0.y, vz = b1.z - b0.z;
			const lb = Math.hypot(vx, vy, vz);
			if (lb < 1e-9) continue;
			// Solo la misma dirección física; un cruce exacto se mide en otro diagnóstico.
			if (Math.abs((ux * vx + uy * vy + uz * vz) / (la * lb)) < 0.9999) continue;
			const wx = b0.x - a0.x, wy = b0.y - a0.y, wz = b0.z - a0.z;
			const proyeccion = wx * nx + wy * ny + wz * nz;
			const perpendicular = Math.hypot(
				wx - proyeccion * nx, wy - proyeccion * ny, wz - proyeccion * nz,
			);
			if (perpendicular >= tolerancia) continue;
			const t0 = proyeccion;
			const t1 = (b1.x - a0.x) * nx + (b1.y - a0.y) * ny + (b1.z - a0.z) * nz;
			const solape = Math.min(la, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
			if (solape > 0) total += solape;
		}
	}
	return total;
}

/** Un segmento del recorrido de un cable, con a quién pertenece y en qué tendido entró. */
interface Barra {
	id: string; clave: string; radio: number; p0: Punto3; p1: Punto3; trazo: Trazo;
	x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
	/** Última consulta/segmento que la evaluó; la barra puede figurar en varias celdas. */
	vistoEn: number;
}

/**
 * Si dos cables van al mismo tornillo, el contacto que se produce JUNTO a ese tornillo es
 * legítimo. Devuelve `true` cuando hay que perdonarlo.
 */
function esElPropioBorne(a: Trazo, b: Trazo, donde: Punto3): boolean {
	if (!a.bornes || !b.bornes || !a.extremos || !b.extremos) return false;
	for (let i = 0; i < 2; i++) {
		for (let j = 0; j < 2; j++) {
			if (a.bornes[i] !== b.bornes[j]) continue;
			const p = a.extremos[i];
			const zona = Math.max(RADIO_BORNE, radioZonaSalidaBorne(a.radio), radioZonaSalidaBorne(b.radio));
			if (Math.hypot(donde.x - p.x, donde.y - p.y, donde.z - p.z) <= zona) return true;
		}
	}
	return false;
}

/**
 * REJILLA ESPACIAL: para no comparar todos los cables contra todos.
 *
 * Un tablero de 52 conductores con setenta tramos cada uno son casi cuatro mil barras. Comparar
 * cada candidato contra todas ellas, para noventa sitios posibles y cincuenta y dos cables, es
 * exactamente el «cálculo absurdamente costoso» que hay que evitar. Con la rejilla, cada barra
 * solo se compara con las que caen en las casillas que toca.
 */
export class RejillaCables {
	private readonly casillas = new Map<string, Barra[]>();
	/** Celdas tocadas por cada tendido: permite retirar sus barras, no solo marcarlas obsoletas. */
	private readonly celdasPorTendido = new Map<string, Set<string>>();
	/**
	 * Qué tendidos siguen en pie.
	 *
	 * Recolocar un cable obliga a quitarlo de la rejilla, y borrarlo casilla por casilla sale caro.
	 * Cada tendido lleva una clave y un índice inverso de celdas. Al repararlo se quitan sus barras
	 * de esas celdas conservando el orden relativo de las demás: dejar solo una marca de baja
	 * acumulaba barras fantasma que cada candidato debía saltarse una y otra vez.
	 */
	private readonly vigentes = new Set<string>();
	private version = 0;
	private visita = 0;

	constructor(private readonly lado = 24) {}

	private clave(i: number, j: number, k: number): string { return `${i}|${j}|${k}`; }

	/** Casillas que toca una barra, con el margen de búsqueda ya sumado. */
	private *casillasDe(p0: Punto3, p1: Punto3, margen: number): Generator<string> {
		const i0 = Math.floor((Math.min(p0.x, p1.x) - margen) / this.lado);
		const i1 = Math.floor((Math.max(p0.x, p1.x) + margen) / this.lado);
		const j0 = Math.floor((Math.min(p0.y, p1.y) - margen) / this.lado);
		const j1 = Math.floor((Math.max(p0.y, p1.y) + margen) / this.lado);
		const k0 = Math.floor((Math.min(p0.z, p1.z) - margen) / this.lado);
		const k1 = Math.floor((Math.max(p0.z, p1.z) + margen) / this.lado);
		for (let i = i0; i <= i1; i++) {
			for (let j = j0; j <= j1; j++) {
				for (let k = k0; k <= k1; k++) yield this.clave(i, j, k);
			}
		}
	}

	/** Apunta un cable entero como ya tendido. Devuelve la clave con la que se puede retirar. */
	anadir(trazo: Trazo): string {
		const clave = `${trazo.id}#${this.version++}`;
		this.vigentes.add(clave);
		const celdas = new Set<string>();
		this.celdasPorTendido.set(clave, celdas);
		for (let n = 0; n < trazo.puntos.length - 1; n++) {
			const p0 = trazo.puntos[n], p1 = trazo.puntos[n + 1];
			const barra: Barra = {
				id: trazo.id, clave, radio: trazo.radio, p0, p1, trazo,
				x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x),
				y0: Math.min(p0.y, p1.y), y1: Math.max(p0.y, p1.y),
				z0: Math.min(p0.z, p1.z), z1: Math.max(p0.z, p1.z),
				vistoEn: 0,
			};
			for (const c of this.casillasDe(barra.p0, barra.p1, 0)) {
				celdas.add(c);
				const lista = this.casillas.get(c);
				if (lista) lista.push(barra); else this.casillas.set(c, [barra]);
			}
		}
		return clave;
	}

	/** Levanta un tendido sin alterar el orden de evaluación de las barras que siguen vigentes. */
	retirar(clave: string): void {
		if (!this.vigentes.delete(clave)) return;
		for (const celda of this.celdasPorTendido.get(clave) ?? []) {
			const lista = this.casillas.get(celda);
			if (!lista) continue;
			let escribir = 0;
			for (const barra of lista) if (barra.clave !== clave) lista[escribir++] = barra;
			if (escribir) lista.length = escribir;
			else this.casillas.delete(celda);
		}
		this.celdasPorTendido.delete(clave);
	}

	/**
	 * El PEOR acercamiento de un candidato contra todo lo ya tendido: el conflicto con menos
	 * holgura. Devuelve `undefined` si todo el mundo queda a más de `margen` de separación.
	 *
	 * `rendirse` es una poda, y es la que hace viable buscar sitio de verdad: cuando ya se tiene un
	 * candidato con cierta holgura, cualquier otro que la empeore no interesa, y en cuanto se ve
	 * que la empeora se puede dejar de mirar.
	 */
	peorConflicto(trazo: Trazo, margen: number, rendirse = -Infinity): Conflicto | undefined {
		let peor: Conflicto | undefined;
		for (let n = 0; n < trazo.puntos.length - 1; n++) {
			// Un sello por segmento equivale al Set que antes se vaciaba aquí. Cuando el
			// contador deja de poder representar enteros consecutivos, se limpian las
			// marcas vivas antes de reutilizar el 1; ocurre como máximo una vez por 2^53 consultas.
			if (this.visita === Number.MAX_SAFE_INTEGER) {
				for (const lista of this.casillas.values()) for (const barra of lista) barra.vistoEn = 0;
				this.visita = 0;
			}
			const visita = ++this.visita;
			const p0 = trazo.puntos[n];
			const p1 = trazo.puntos[n + 1];
			const x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x);
			const y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
			const z0 = Math.min(p0.z, p1.z), z1 = Math.max(p0.z, p1.z);
			const alcance = trazo.radio + margen + 8;
			for (const c of this.casillasDe(p0, p1, alcance)) {
				for (const barra of this.casillas.get(c) ?? []) {
					if (barra.id === trazo.id) continue;
					// `retirar` ya extrae físicamente el tendido; no quedan barras inactivas.
					if (barra.vistoEn === visita) continue;
					barra.vistoEn = visita;
					// Si las cajas de los segmentos se separan más que radios + margen
					// en cualquier eje, la distancia 3D exacta NO puede dar conflicto.
					// Estrictamente > conserva la tangencia para el cálculo original.
					const limite = trazo.radio + barra.radio + margen;
					if (barra.x0 - x1 > limite || x0 - barra.x1 > limite
						|| barra.y0 - y1 > limite || y0 - barra.y1 > limite
						|| barra.z0 - z1 > limite || z0 - barra.z1 > limite) continue;
					const { d, donde } = distanciaSegmentos(p0, p1, barra.p0, barra.p1);
					const holgura = d - trazo.radio - barra.radio;
					if (holgura >= margen) continue;
					// Dos hilos que van al mismo tornillo se juntan ahí, y está bien que lo hagan.
					if (esElPropioBorne(trazo, barra.trazo, donde)) continue;
					if (!peor || holgura < peor.holgura) {
						peor = { a: trazo.id, b: barra.id, holgura, distanciaEjes: d, donde };
						if (holgura <= rendirse) return peor;   // ya no puede ganar: se deja de mirar
					}
				}
			}
		}
		return peor;
	}
}

/**
 * Todos los conflictos de un tablero, de peor a mejor. Es lo que mide la prueba y lo que enseña
 * el diagnóstico: qué pares de cables están a menos de la holgura pedida, cuánto se meten y dónde.
 */
export function conflictosDe(trazos: Trazo[], margen = 1.2): Conflicto[] {
	const rejilla = new RejillaCables();
	const salida: Conflicto[] = [];
	const yaMedidos = new Set<string>();
	for (const t of trazos) {
		const peor = rejilla.peorConflicto(t, margen);
		if (peor) {
			const clave = [peor.a, peor.b].sort().join('·');
			if (!yaMedidos.has(clave)) { yaMedidos.add(clave); salida.push(peor); }
		}
		rejilla.anadir(t);
	}
	return salida.sort((p, q) => p.holgura - q.holgura);
}

/**
 * Caja sólida del tablero por la que un cable no debería pasar: una canaleta, un aparato, el
 * carril. Las cotas van en mm de modelo, con la Y hacia abajo, como todo lo demás.
 */
export interface Solido {
	id: string;
	x0: number; x1: number;
	y0: number; y1: number;
	z0: number; z1: number;
}

const EJES_CAJA = ['x', 'y', 'z'] as const;

/** Intersección paramétrica del eje de un tramo con la caja dilatada por el radio del cable. */
function tramoInvadeCaja(a: Punto3, b: Punto3, s: Solido, radio: number): boolean {
	let entrada = 0;
	let salida = 1;
	for (const eje of EJES_CAJA) {
		const minimo = s[`${eje}0`] - radio;
		const maximo = s[`${eje}1`] + radio;
		const delta = b[eje] - a[eje];
		if (Math.abs(delta) < 1e-9) {
			if (a[eje] <= minimo || a[eje] >= maximo) return false;
			continue;
		}
		const t0 = (minimo - a[eje]) / delta;
		const t1 = (maximo - a[eje]) / delta;
		entrada = Math.max(entrada, Math.min(t0, t1));
		salida = Math.min(salida, Math.max(t0, t1));
		if (entrada >= salida) return false;
	}
	return entrada < salida;
}

export function primerSolidoEnPunto(
	p: Punto3, radio: number, solidos: readonly Solido[], propios: readonly string[] = [],
): Solido | undefined {
	for (const s of solidos) {
		if (propios.includes(s.id)) continue;
		if (p.x > s.x0 - radio && p.x < s.x1 + radio
			&& p.y > s.y0 - radio && p.y < s.y1 + radio
			&& p.z > s.z0 - radio && p.z < s.z1 + radio) return s;
	}
	return undefined;
}

/** Vista previa acotada a los dos segmentos vecinos del nodo; no examina todos los cables. */
export function primerSolidoEnTramosDelNodo(
	puntos: readonly Punto3[], indice: number, radio: number, solidos: readonly Solido[], propios: readonly string[] = [],
): Solido | undefined {
	if (!Number.isInteger(indice) || indice < 0 || indice >= puntos.length || !Number.isFinite(radio) || radio < 0) return undefined;
	for (const s of solidos) {
		if (propios.includes(s.id)) continue;
		for (let tramo = Math.max(0, indice - 1); tramo <= Math.min(indice, puntos.length - 2); tramo++) {
			if (tramoInvadeCaja(puntos[tramo], puntos[tramo + 1], s, radio)) return s;
		}
	}
	return undefined;
}

/** Cuánto se mete un punto dentro de una caja (≤ 0 si está fuera). */
function penetracion(p: Punto3, s: Solido, radio: number): number {
	return Math.min(
		p.x - (s.x0 - radio), (s.x1 + radio) - p.x,
		p.y - (s.y0 - radio), (s.y1 + radio) - p.y,
		p.z - (s.z0 - radio), (s.z1 + radio) - p.z,
	);
}

/**
 * Cables que invaden un sólido. Se mira el EJE del cable contra la caja crecida con su radio, que
 * es lo mismo que mirar el tubo contra la caja y sale mucho más barato.
 *
 * Se muestrea a lo largo de cada tramo porque un tramo largo puede entrar y salir de una canaleta
 * sin que ninguno de sus dos extremos esté dentro. Y se perdona lo que cae junto a un borne: ahí
 * el hilo está en su tornillo, apoyado en el aparato, que es lo que tiene que hacer.
 */
export function invasionesDe(trazos: Trazo[], solidos: Solido[], paso = 3): Conflicto[] {
	const salida: Conflicto[] = [];
	for (const t of trazos) {
		let peor: Conflicto | undefined;
		for (let n = 0; n < t.puntos.length - 1; n++) {
			const p0 = t.puntos[n];
			const p1 = t.puntos[n + 1];
			const largo = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
			const trozos = Math.max(1, Math.ceil(largo / paso));
			for (let k = 0; k <= trozos; k++) {
				const u = k / trozos;
				const p = {
					x: p0.x + (p1.x - p0.x) * u,
					y: p0.y + (p1.y - p0.y) * u,
					z: p0.z + (p1.z - p0.z) * u,
				};
				const enUnBorne = t.extremos?.some(
					(q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) <= RADIO_BORNE,
				);
				if (enUnBorne) continue;
				for (const s of solidos) {
					/*
					 * EL CUERPO DEL APARATO AL QUE ESTE CABLE VA CONECTADO NO ES UNA INVASIÓN.
					 *
					 * Es el mismo principio que el de los dos hilos en un tornillo: un cable que
					 * sale de una bornera hacia el campo tiene que atravesar el sitio que ocupa la
					 * bornera, porque es de donde sale. La exención por cercanía al borne no
					 * alcanzaba: una bornera de 50 mm de fondo deja al hilo dentro de su caja
					 * treinta milímetros más allá del tornillo, y salían veinte «invasiones» de
					 * 12 mm que no eran ningún defecto. Lo que sí lo es —pasar por dentro del
					 * aparato del vecino— se sigue midiendo igual.
					 */
					if (t.propios?.includes(s.id)) continue;
					const dentro = penetracion(p, s, t.radio);
					if (dentro <= 0) continue;
					if (!peor || -dentro < peor.holgura) {
						peor = { a: t.id, b: s.id, holgura: -dentro, distanciaEjes: 0, donde: p };
					}
				}
			}
		}
		if (peor) salida.push(peor);
	}
	return salida.sort((p, q) => p.holgura - q.holgura);
}
