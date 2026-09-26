import type { PuntoFisico3D } from './ruta-fisica.js';

export type EstadoCodo = 'RECTO' | 'CURVO' | 'SIN_ESPACIO' | 'RETORNO' | 'NO_MODELADO';
export interface CodoDeRuta { indice: number; estado: EstadoCodo; radioMm?: number }
export interface RutaRedondeada {
	puntos: PuntoFisico3D[];
	/** Longitud analítica de rectas y arcos, no de la teselación de la malla. */
	longitudMm: number;
	/** Punto más próximo al vértice persistente para la edición y la inserción. */
	indicesVertices: number[];
	/** Índices de las muestras que representan cada vértice original (uno si no hay arco). */
	rangosVertices: [number, number][];
	codos: CodoDeRuta[];
}

interface Curva {
	entrada: PuntoFisico3D;
	salida: PuntoFisico3D;
	centro: PuntoFisico3D;
	radial: PuntoFisico3D;
	tangente: PuntoFisico3D;
	angulo: number;
	recorte: number;
}

const suma = (a: PuntoFisico3D, b: PuntoFisico3D, f = 1): PuntoFisico3D =>
	({ x: a.x + b.x * f, y: a.y + b.y * f, z: a.z + b.z * f });
const resta = (a: PuntoFisico3D, b: PuntoFisico3D): PuntoFisico3D =>
	({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const escalar = (a: PuntoFisico3D, b: PuntoFisico3D): number =>
	a.x * b.x + a.y * b.y + a.z * b.z;
const norma = (a: PuntoFisico3D): number => Math.hypot(a.x, a.y, a.z);
const unidad = (a: PuntoFisico3D, longitud: number): PuntoFisico3D =>
	({ x: a.x / longitud, y: a.y / longitud, z: a.z / longitud });

/**
 * Empalme circular 3D de radio declarado. No usa una spline ni reduce un radio que no cabe.
 * Las incidencias conservan el vértice literal y permiten advertir que el radio NO se cumple.
 * La ruta es la misma referencia para reparto, picking, dibujo y metraje geométrico.
 */
export function redondearRutaConRadio(
	vertices: readonly PuntoFisico3D[], radioMm: number, toleranciaMm = 0.1,
	indicesObjetivo?: ReadonlySet<number>,
): RutaRedondeada {
	if (!Number.isFinite(radioMm) || radioMm <= 0 || radioMm > 500
		|| !Number.isFinite(toleranciaMm) || toleranciaMm <= 0 || toleranciaMm > 1
		|| vertices.length < 2 || vertices.length > 132
		|| vertices.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) {
		throw new Error('RADIO_RUTA_INVALIDO');
	}
	const curvas: (Curva | undefined)[] = Array(vertices.length).fill(undefined);
	const codos: CodoDeRuta[] = [];
	for (let i = 1; i < vertices.length - 1; i++) {
		if (indicesObjetivo && !indicesObjetivo.has(i)) {
			codos.push({ indice: i, estado: 'NO_MODELADO' }); continue;
		}
		const a = vertices[i - 1], b = vertices[i], c = vertices[i + 1];
		const ab = resta(b, a), bc = resta(c, b);
		const d1 = norma(ab), d2 = norma(bc);
		if (d1 < 1e-9 || d2 < 1e-9) {
			codos.push({ indice: i, estado: 'SIN_ESPACIO' }); continue;
		}
		const u = unidad(ab, d1), v = unidad(bc, d2);
		const angulo = Math.acos(Math.max(-1, Math.min(1, escalar(u, v))));
		if (angulo < 1e-7) { codos.push({ indice: i, estado: 'RECTO' }); continue; }
		if (Math.PI - angulo < 1e-7) { codos.push({ indice: i, estado: 'RETORNO' }); continue; }
		const recorte = radioMm * Math.tan(angulo / 2);
		if (!Number.isFinite(recorte) || recorte > d1 + 1e-9 || recorte > d2 + 1e-9) {
			codos.push({ indice: i, estado: 'SIN_ESPACIO' }); continue;
		}
		const normal = unidad(suma(v, u, -Math.cos(angulo)), Math.sin(angulo));
		const entrada = suma(b, u, -recorte);
		curvas[i] = { entrada, salida: suma(b, v, recorte),
			centro: suma(entrada, normal, radioMm), radial: suma({ x: 0, y: 0, z: 0 }, normal, -1),
			tangente: u, angulo, recorte };
		codos.push({ indice: i, estado: 'CURVO', radioMm });
	}
	// Dos radios no pueden ocupar simultáneamente el mismo tramo. No se acortan a escondidas.
	for (let i = 1; i < vertices.length - 2; i++) {
		const izquierda = curvas[i], derecha = curvas[i + 1];
		if (!izquierda || !derecha) continue;
		if (izquierda.recorte + derecha.recorte > norma(resta(vertices[i + 1], vertices[i])) + 1e-9) {
			curvas[i] = undefined; curvas[i + 1] = undefined;
			codos[i - 1] = { indice: i, estado: 'SIN_ESPACIO' };
			codos[i] = { indice: i + 1, estado: 'SIN_ESPACIO' };
		}
	}
	const puntos: PuntoFisico3D[] = [];
	const indicesVertices: number[] = [];
	const rangosVertices: [number, number][] = [];
	let longitudMm = 0;
	const agregar = (p: PuntoFisico3D, arco = false): void => {
		const anterior = puntos[puntos.length - 1];
		if (anterior && norma(resta(p, anterior)) < 1e-9) return;
		if (anterior && !arco) longitudMm += norma(resta(p, anterior));
		puntos.push(p);
	};
	agregar(vertices[0]); indicesVertices.push(0); rangosVertices.push([0, 0]);
	for (let i = 1; i < vertices.length - 1; i++) {
		const curva = curvas[i];
		if (!curva) {
			agregar(vertices[i]); indicesVertices.push(puntos.length - 1);
			rangosVertices.push([puntos.length - 1, puntos.length - 1]); continue;
		}
		agregar(curva.entrada);
		const primerIndice = puntos.length - 1;
		const paso = Math.min(Math.PI / 18,
			2 * Math.acos(Math.max(-1, 1 - toleranciaMm / radioMm)));
		const trozos = Math.max(2, Math.ceil(curva.angulo / paso));
		for (let k = 1; k <= trozos; k++) {
			const t = curva.angulo * k / trozos;
			const p = suma(suma(curva.centro, curva.radial, radioMm * Math.cos(t)),
				curva.tangente, radioMm * Math.sin(t));
			agregar(k === trozos ? curva.salida : p, true);
		}
		longitudMm += radioMm * curva.angulo;
		indicesVertices.push(Math.round((primerIndice + puntos.length - 1) / 2));
		rangosVertices.push([primerIndice, puntos.length - 1]);
	}
	agregar(vertices[vertices.length - 1]); indicesVertices.push(puntos.length - 1);
	rangosVertices.push([puntos.length - 1, puntos.length - 1]);
	return { puntos, longitudMm, indicesVertices, rangosVertices, codos };
}
