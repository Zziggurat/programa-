/**
 * Motor de ruteo físico de cables por canaletas.
 *
 * Modela las canaletas del gabinete como un grafo (extremos + intersecciones + puntos
 * de entrada) y rutea cada conductor con Dijkstra:
 *   aparato → bajada a la canaleta más cercana → recorrido por canaletas → subida al destino.
 * Devuelve longitudes reales (con reserva configurable) y la ocupación de cada canaleta.
 *
 * QElectroTech no tiene nada de esto: su Conductor::length() son píxeles de esquema.
 */
import { Canaleta, Colocacion, Proyecto } from '../modelo/tipos.js';
import { opcionesDe } from '../modelo/proyecto.js';

export interface Punto { x: number; y: number }

export interface RutaConductor {
	conductorId: string;
	/** Longitud total en mm, incluida la reserva y las puntas. */
	longitudMm: number;
	/** Polilínea completa: aparato origen → canaletas → aparato destino. */
	camino: Punto[];
	canaletasUsadas: string[];
}

export interface OcupacionCanaleta {
	canaletaId: string;
	/** Suma de secciones de los conductores que la atraviesan (mm²). */
	seccionOcupadaMm2: number;
	/** Sección útil de la canaleta (mm²). */
	seccionUtilMm2: number;
	/** 0..1 respecto del máximo recomendado. */
	ocupacion: number;
	excedida: boolean;
}

export interface ResultadoRuteo {
	rutas: RutaConductor[];
	ocupaciones: OcupacionCanaleta[];
	avisos: string[];
}

interface Nodo { id: number; p: Punto }
interface Arista { a: number; b: number; peso: number; canaletaId: string }

const distancia = (p: Punto, q: Punto) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);

function extremos(c: Canaleta): [Punto, Punto] {
	return c.orientacion === 'h'
		? [{ x: c.x, y: c.y }, { x: c.x + c.largo, y: c.y }]
		: [{ x: c.x, y: c.y }, { x: c.x, y: c.y + c.largo }];
}

/** Proyección de p sobre el eje de la canaleta, acotada a sus extremos. */
function proyectar(c: Canaleta, p: Punto): Punto {
	if (c.orientacion === 'h') {
		return { x: Math.min(Math.max(p.x, c.x), c.x + c.largo), y: c.y };
	}
	return { x: c.x, y: Math.min(Math.max(p.y, c.y), c.y + c.largo) };
}

/** Punto de cruce entre dos canaletas (sobre sus ejes), si se tocan. */
function interseccion(a: Canaleta, b: Canaleta, tolerancia: number): Punto | undefined {
	if (a.orientacion === b.orientacion) return undefined;
	const h = a.orientacion === 'h' ? a : b;
	const v = a.orientacion === 'h' ? b : a;
	const cruzaX = v.x >= h.x - tolerancia && v.x <= h.x + h.largo + tolerancia;
	const cruzaY = h.y >= v.y - tolerancia && h.y <= v.y + v.largo + tolerancia;
	return cruzaX && cruzaY ? { x: v.x, y: h.y } : undefined;
}

function centro(col: Colocacion): Punto {
	return { x: col.x + col.ancho / 2, y: col.y + col.alto / 2 };
}

/**
 * Grafo de canaletas: cada canaleta aporta sus extremos, las intersecciones con otras y
 * los puntos extra solicitados (entradas de aparatos); los nodos consecutivos de una misma
 * canaleta quedan unidos por aristas con el peso de la distancia entre ellos.
 */
function construirGrafo(
	canaletas: Canaleta[],
	puntosExtra: Map<string, Punto[]>, // canaletaId → puntos sobre su eje
) {
	const nodos: Nodo[] = [];
	const indice = new Map<string, number>(); // "x,y" → id de nodo
	const nodo = (p: Punto): number => {
		const clave = `${Math.round(p.x)},${Math.round(p.y)}`;
		const existente = indice.get(clave);
		if (existente !== undefined) return existente;
		const id = nodos.length;
		nodos.push({ id, p });
		indice.set(clave, id);
		return id;
	};

	const puntosPorCanaleta = new Map<string, Punto[]>();
	for (const c of canaletas) {
		const [e1, e2] = extremos(c);
		const lista: Punto[] = [e1, e2, ...(puntosExtra.get(c.id) ?? [])];
		for (const otra of canaletas) {
			if (otra.id === c.id) continue;
			const cruce = interseccion(c, otra, 1);
			if (cruce) lista.push(cruce);
		}
		puntosPorCanaleta.set(c.id, lista);
	}

	const aristas: Arista[] = [];
	for (const c of canaletas) {
		const lista = puntosPorCanaleta.get(c.id)!;
		const clave = c.orientacion === 'h' ? (p: Punto) => p.x : (p: Punto) => p.y;
		const ordenados = [...lista].sort((p, q) => clave(p) - clave(q));
		for (let i = 1; i < ordenados.length; i++) {
			const a = nodo(ordenados[i - 1]);
			const b = nodo(ordenados[i]);
			if (a === b) continue;
			aristas.push({ a, b, peso: distancia(ordenados[i - 1], ordenados[i]), canaletaId: c.id });
		}
	}
	return { nodos, aristas, nodo };
}

function dijkstra(
	aristas: Arista[],
	origen: number,
	destino: number,
): { camino: number[]; canaletas: string[]; longitud: number } | undefined {
	const ady = new Map<number, Arista[]>();
	for (const e of aristas) {
		(ady.get(e.a) ?? ady.set(e.a, []).get(e.a)!).push(e);
		(ady.get(e.b) ?? ady.set(e.b, []).get(e.b)!).push(e);
	}
	const dist = new Map<number, number>([[origen, 0]]);
	const previo = new Map<number, { nodo: number; canaleta: string }>();
	const pendientes = new Set<number>([origen]);
	const visitados = new Set<number>();

	while (pendientes.size > 0) {
		let u = -1;
		let mejor = Infinity;
		for (const n of pendientes) {
			const d = dist.get(n) ?? Infinity;
			if (d < mejor) {
				mejor = d;
				u = n;
			}
		}
		if (u === -1) break;
		pendientes.delete(u);
		visitados.add(u);
		if (u === destino) break;
		for (const e of ady.get(u) ?? []) {
			const v = e.a === u ? e.b : e.a;
			if (visitados.has(v)) continue;
			const nueva = (dist.get(u) ?? Infinity) + e.peso;
			if (nueva < (dist.get(v) ?? Infinity)) {
				dist.set(v, nueva);
				previo.set(v, { nodo: u, canaleta: e.canaletaId });
				pendientes.add(v);
			}
		}
	}

	if (!dist.has(destino) || dist.get(destino) === Infinity) return undefined;
	const camino: number[] = [destino];
	const canaletas: string[] = [];
	let actual = destino;
	while (actual !== origen) {
		const paso = previo.get(actual);
		if (!paso) return undefined;
		canaletas.unshift(paso.canaleta);
		actual = paso.nodo;
		camino.unshift(actual);
	}
	return { camino, canaletas: [...new Set(canaletas)], longitud: dist.get(destino)! };
}

export function rutearConductores(proyecto: Proyecto): ResultadoRuteo {
	const avisos: string[] = [];
	const rutas: RutaConductor[] = [];
	const gabinete = proyecto.gabinete;
	if (!gabinete) return { rutas, ocupaciones: [], avisos: ['El proyecto no tiene gabinete definido'] };
	if (gabinete.canaletas.length === 0) {
		return { rutas, ocupaciones: [], avisos: ['El gabinete no tiene canaletas'] };
	}
	const opciones = opcionesDe(proyecto);
	const colocacionDe = new Map(gabinete.colocaciones.map((c) => [c.dispositivoId, c]));

	// Punto de entrada de cada dispositivo colocado: proyección sobre su canaleta más cercana.
	interface Entrada { canaletaId: string; punto: Punto; bajada: number; centro: Punto }
	const entradaDe = new Map<string, Entrada>();
	for (const col of gabinete.colocaciones) {
		const c0 = centro(col);
		let mejor: Entrada | undefined;
		for (const can of gabinete.canaletas) {
			const punto = proyectar(can, c0);
			const bajada = distancia(c0, punto);
			if (!mejor || bajada < mejor.bajada) mejor = { canaletaId: can.id, punto, bajada, centro: c0 };
		}
		if (mejor) entradaDe.set(col.dispositivoId, mejor);
	}

	// Grafo único con todos los puntos de entrada insertados.
	const puntosExtra = new Map<string, Punto[]>();
	for (const e of entradaDe.values()) {
		(puntosExtra.get(e.canaletaId) ?? puntosExtra.set(e.canaletaId, []).get(e.canaletaId)!).push(e.punto);
	}
	const { nodos, aristas, nodo } = construirGrafo(gabinete.canaletas, puntosExtra);

	const seccionEnCanaleta = new Map<string, number>();

	const esCampo = new Map(proyecto.dispositivos.map((d) => [d.id, d.campo ?? false]));
	let conductoresDeCampo = 0;

	for (const conductor of proyecto.conductores) {
		// Los conductores hacia aparatos de campo salen del gabinete: su longitud no se
		// puede calcular desde la placa de montaje, así que no se rutean.
		if (esCampo.get(conductor.de.dispositivoId) || esCampo.get(conductor.a.dispositivoId)) {
			conductoresDeCampo += 1;
			continue;
		}
		const colDe = colocacionDe.get(conductor.de.dispositivoId);
		const colA = colocacionDe.get(conductor.a.dispositivoId);
		if (!colDe || !colA) {
			const faltante = !colDe ? conductor.de.dispositivoId : conductor.a.dispositivoId;
			avisos.push(`Conductor ${conductor.numero ?? conductor.id}: "${faltante}" no está colocado en el gabinete`);
			continue;
		}
		const e1 = entradaDe.get(conductor.de.dispositivoId)!;
		const e2 = entradaDe.get(conductor.a.dispositivoId)!;
		const resultado = dijkstra(aristas, nodo(e1.punto), nodo(e2.punto));
		if (!resultado) {
			avisos.push(`Conductor ${conductor.numero ?? conductor.id}: las canaletas no conectan origen y destino`);
			continue;
		}
		const base = e1.bajada + resultado.longitud + e2.bajada;
		const longitudMm = Math.ceil(base * (1 + opciones.reservaCable) + 2 * opciones.extraPorConexionMm);
		rutas.push({
			conductorId: conductor.id,
			longitudMm,
			camino: [e1.centro, ...resultado.camino.map((n) => nodos[n].p), e2.centro],
			canaletasUsadas: resultado.canaletas,
		});
		const seccion = conductor.seccion ?? 1.5;
		for (const canId of resultado.canaletas) {
			seccionEnCanaleta.set(canId, (seccionEnCanaleta.get(canId) ?? 0) + seccion);
		}
	}

	if (conductoresDeCampo > 0) {
		avisos.push(`${conductoresDeCampo} conductores van a aparatos de campo y no se rutean por canaleta`);
	}

	// Ocupación de canaletas: los cables reales ocupan más que su sección de cobre
	// (aislamiento + aire); factor práctico ×3 sobre la sección nominal.
	const ocupaciones: OcupacionCanaleta[] = gabinete.canaletas.map((can) => {
		const util = can.ancho * can.alto;
		const ocupada = (seccionEnCanaleta.get(can.id) ?? 0) * 3;
		const ocupacion = ocupada / (util * opciones.ocupacionMaxCanaleta);
		const excedida = ocupacion > 1;
		if (excedida) {
			avisos.push(`Canaleta ${can.id} sobrepasa el llenado recomendado (${Math.round(ocupacion * 100)} %)`);
		}
		return { canaletaId: can.id, seccionOcupadaMm2: ocupada, seccionUtilMm2: util, ocupacion, excedida };
	});

	return { rutas, ocupaciones, avisos };
}
