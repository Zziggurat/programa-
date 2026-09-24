/**
 * Cruces gráficos de hilos en una hoja de esquema.
 *
 * Un punto donde se intersecan dos polilíneas NO altera la topología eléctrica: los
 * conductores siguen conectándose exclusivamente por sus bornes y puentes explícitos.
 * Esta información efímera sirve para dibujar un salto/hueco en SVG y PDF, nunca
 * para crear un conductor, un potencial o un nudo persistente.
 *
 * Se consideran intersecciones interiores y contactos puntuales en T o entre
 * extremos de bornes distintos. Los paralelos y solapes colineales necesitan
 * otras reglas gráficas y no se presentan como cruces puntuales.
 */
import type { HiloEsq, HojaEsq, PuntoEsq } from './esquema.js';
import type { RefBorne } from '../modelo/tipos.js';

export interface TramoCruceEsquema {
	conductorId: string;
	/** Índice del primer nodo del segmento dentro de `HiloEsq.nodos`. */
	segmento: number;
}

export interface CruceEsquema {
	punto: PuntoEsq;
	/** Prioridad de dibujo únicamente; no expresa conexión ni profundidad física. */
	porEncima: TramoCruceEsquema;
	porDebajo: TramoCruceEsquema;
}

export interface NudoEsquema {
	punto: PuntoEsq;
	borne: RefBorne;
	conductores: string[];
}

export interface TramoVisibleEsquema {
	a: PuntoEsq;
	b: PuntoEsq;
	segmento: number;
}

interface Segmento {
	conductorId: string;
	segmento: number;
	a: PuntoEsq;
	b: PuntoEsq;
	dx: number;
	dy: number;
	largo: number;
	borneA?: RefBorne;
	borneB?: RefBorne;
}

const TOLERANCIA_MM = 1e-6;
const TOLERANCIA_ANGULAR = 1e-12;

const cruz = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
const compararIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function segmentosDe(hilos: readonly HiloEsq[]): Segmento[] {
	const segmentos: Segmento[] = [];
	for (const hilo of hilos) {
		for (let i = 0; i + 1 < hilo.nodos.length; i++) {
			const a = hilo.nodos[i], b = hilo.nodos[i + 1];
			if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
			const dx = b.x - a.x, dy = b.y - a.y;
			const largo = Math.hypot(dx, dy);
			if (largo <= TOLERANCIA_MM) continue;
			segmentos.push({ conductorId: hilo.conductorId, segmento: i, a, b, dx, dy, largo,
				borneA: i === 0 ? hilo.bornes?.de : undefined,
				borneB: i + 1 === hilo.nodos.length - 1 ? hilo.bornes?.a : undefined });
		}
	}
	return segmentos.sort((a, b) => compararIds(a.conductorId, b.conductorId)
		|| a.segmento - b.segmento);
}

interface InterseccionPuntual {
	punto: PuntoEsq;
	ta: number;
	tb: number;
}

const esInterior = (t: number, largo: number): boolean =>
	t > TOLERANCIA_MM / largo && t < 1 - TOLERANCIA_MM / largo;

function interseccionPuntual(a: Segmento, b: Segmento): InterseccionPuntual | undefined {
	const denominador = cruz(a.dx, a.dy, b.dx, b.dy);
	if (Math.abs(denominador) <= TOLERANCIA_ANGULAR * a.largo * b.largo) return undefined;
	const px = b.a.x - a.a.x, py = b.a.y - a.a.y;
	const ta = cruz(px, py, b.dx, b.dy) / denominador;
	const tb = cruz(px, py, a.dx, a.dy) / denominador;
	// La tolerancia es una distancia de papel, no una fracción que cambie con el largo.
	if (ta < -TOLERANCIA_MM / a.largo || ta > 1 + TOLERANCIA_MM / a.largo
		|| tb < -TOLERANCIA_MM / b.largo || tb > 1 + TOLERANCIA_MM / b.largo) return undefined;
	const extremoA = ta <= TOLERANCIA_MM / a.largo ? a.a
		: ta >= 1 - TOLERANCIA_MM / a.largo ? a.b : undefined;
	const extremoB = tb <= TOLERANCIA_MM / b.largo ? b.a
		: tb >= 1 - TOLERANCIA_MM / b.largo ? b.b : undefined;
	return { punto: extremoA ?? extremoB ?? { x: a.a.x + ta * a.dx, y: a.a.y + ta * a.dy }, ta, tb };
}

function borneEnExtremo(segmento: Segmento, t: number): RefBorne | undefined {
	if (t <= TOLERANCIA_MM / segmento.largo) return segmento.borneA;
	if (t >= 1 - TOLERANCIA_MM / segmento.largo) return segmento.borneB;
	return undefined;
}

function mismoBorne(a: RefBorne | undefined, b: RefBorne | undefined): boolean {
	return !!a && !!b && a.dispositivoId === b.dispositivoId && a.borneId === b.borneId;
}

/**
 * Deriva cruces gráficos puntuales de una hoja sin leer ni modificar `Proyecto`.
 * La prioridad visual por ID estable evita que invertir el array de hilos cambie
 * cuál deja un hueco; no significa que el conductor superior esté energizado.
 */
export function crucesSinUnion(hoja: Pick<HojaEsq, 'hilos'>): CruceEsquema[] {
	const segmentos = segmentosDe(hoja.hilos);
	const nudos = nudosPorBorne(hoja);
	const cruces: CruceEsquema[] = [];
	for (let i = 0; i < segmentos.length; i++) {
		const a = segmentos[i];
		for (let j = i + 1; j < segmentos.length; j++) {
			const b = segmentos[j];
			if (a.conductorId === b.conductorId) continue;
			// El descarte por caja evita cálculos de intersección para tramos lejanos.
			if (Math.max(a.a.x, a.b.x) + TOLERANCIA_MM < Math.min(b.a.x, b.b.x)
				|| Math.max(b.a.x, b.b.x) + TOLERANCIA_MM < Math.min(a.a.x, a.b.x)
				|| Math.max(a.a.y, a.b.y) + TOLERANCIA_MM < Math.min(b.a.y, b.b.y)
				|| Math.max(b.a.y, b.b.y) + TOLERANCIA_MM < Math.min(a.a.y, a.b.y)) continue;
			const interseccion = interseccionPuntual(a, b);
			if (!interseccion) continue;
			const { punto, ta, tb } = interseccion;
			const aInterior = esInterior(ta, a.largo), bInterior = esInterior(tb, b.largo);
			if (!aInterior && !bInterior && mismoBorne(borneEnExtremo(a, ta), borneEnExtremo(b, tb)))
				continue; // El borne real compartido permanece unido y puede llevar punto negro.
			const nudo = !aInterior && !bInterior ? nudos.find((n) =>
				Math.hypot(n.punto.x - punto.x, n.punto.y - punto.y) <= TOLERANCIA_MM) : undefined;
			const aEnNudo = nudo?.conductores.includes(a.conductorId) ?? false;
			const bEnNudo = nudo?.conductores.includes(b.conductorId) ?? false;
			// En T se corta siempre el trazo continuo. Entre dos extremos ajenos se
			// aparta el ajeno al nudo; de no haber nudo, desempata el ID estable.
			const debajo = aInterior !== bInterior ? (aInterior ? a : b)
				: aEnNudo !== bEnNudo ? (aEnNudo ? b : a) : b;
			const encima = debajo === a ? b : a;
			cruces.push({ punto,
				porEncima: { conductorId: encima.conductorId, segmento: encima.segmento },
				porDebajo: { conductorId: debajo.conductorId, segmento: debajo.segmento },
			});
		}
	}
	return cruces.sort((a, b) => compararIds(a.porEncima.conductorId, b.porEncima.conductorId)
		|| compararIds(a.porDebajo.conductorId, b.porDebajo.conductorId)
		|| a.punto.x - b.punto.x || a.punto.y - b.punto.y
		|| a.porEncima.segmento - b.porEncima.segmento
		|| a.porDebajo.segmento - b.porDebajo.segmento)
		.filter((cruce, i, ordenados) => i === 0 || !(cruce.punto.x === ordenados[i - 1].punto.x
			&& cruce.punto.y === ordenados[i - 1].punto.y
			&& cruce.porDebajo.conductorId === ordenados[i - 1].porDebajo.conductorId
			&& cruce.porDebajo.segmento === ordenados[i - 1].porDebajo.segmento
			&& cruce.porEncima.conductorId === ordenados[i - 1].porEncima.conductorId));
}

/**
 * Punto de unión REAL: al menos dos conductores distintos llegan al mismo borne.
 * Coincidir en x/y no basta. Si un borne distinto se superpone exactamente,
 * su extremo se aparta mediante `crucesSinUnion`, mientras el nudo real permanece.
 */
export function nudosPorBorne(hoja: Pick<HojaEsq, 'hilos'>): NudoEsquema[] {
	type Extremo = { borne: RefBorne; punto: PuntoEsq; conductores: Set<string> };
	const porBorneYPunto = new Map<string, Extremo>();
	for (const hilo of hoja.hilos) {
		if (!hilo.bornes || hilo.nodos.length === 0) continue;
		for (const [borne, punto] of [
			[hilo.bornes.de, hilo.nodos[0]],
			[hilo.bornes.a, hilo.nodos[hilo.nodos.length - 1]],
		] as const) {
			if (![punto.x, punto.y].every(Number.isFinite)) continue;
			const claveBorne = JSON.stringify([borne.dispositivoId, borne.borneId]);
			const clavePunto = JSON.stringify([punto.x, punto.y]);
			const clave = JSON.stringify([claveBorne, clavePunto]);
			let entrada = porBorneYPunto.get(clave);
			if (!entrada) {
				entrada = { borne, punto, conductores: new Set() };
				porBorneYPunto.set(clave, entrada);
			}
			entrada.conductores.add(hilo.conductorId);
		}
	}
	const reales = [...porBorneYPunto.values()].filter((entrada) => entrada.conductores.size >= 2);
	const realesPorPunto = new Map<string, number>();
	for (const entrada of reales) {
		const clavePunto = JSON.stringify([entrada.punto.x, entrada.punto.y]);
		realesPorPunto.set(clavePunto, (realesPorPunto.get(clavePunto) ?? 0) + 1);
	}
	return reales
		.filter((entrada) => realesPorPunto.get(JSON.stringify([entrada.punto.x, entrada.punto.y])) === 1)
		.map((entrada) => ({ punto: entrada.punto, borne: entrada.borne,
			conductores: [...entrada.conductores].sort(compararIds) }))
		.sort((a, b) => a.punto.x - b.punto.x || a.punto.y - b.punto.y
			|| compararIds(a.borne.dispositivoId, b.borne.dispositivoId)
			|| compararIds(a.borne.borneId, b.borne.borneId));
}

/**
 * Recorta del hilo inferior un hueco de hasta 2 mm en cada cruce. SVG y PDF
 * consumen estos mismos tramos; el hit-target SVG puede usar exactamente el
 * mismo recorrido visible y así no seleccionar un conductor detrás del hueco.
 */
export function tramosVisiblesDeHilo(
	hilo: HiloEsq, cruces: readonly CruceEsquema[], semihuecoMm = 1,
	nudos: readonly NudoEsquema[] = [],
): TramoVisibleEsquema[] {
	const visibles: TramoVisibleEsquema[] = [];
	for (let segmento = 0; segmento + 1 < hilo.nodos.length; segmento++) {
		const a = hilo.nodos[segmento], b = hilo.nodos[segmento + 1];
		const dx = b.x - a.x, dy = b.y - a.y;
		const largo = Math.hypot(dx, dy);
		if (!(largo > TOLERANCIA_MM) || !Number.isFinite(largo)) continue;
		const huecosCruce = cruces
			.filter((c) => c.porDebajo.conductorId === hilo.conductorId && c.porDebajo.segmento === segmento)
			.map((c) => ({ punto: c.punto, semihueco: semihuecoMm }));
		// Un nudo válido puede coincidir con el interior de un tercer conductor AISLADO.
		// Separa ese trazo del punto negro; sin el hueco, el dibujo fingiría una unión triple.
		const huecosNudo = nudos
			.filter((nudo) => !nudo.conductores.includes(hilo.conductorId))
			.filter((nudo) => {
				const px = nudo.punto.x - a.x, py = nudo.punto.y - a.y;
				const t = (px * dx + py * dy) / (largo * largo);
				return Math.abs(cruz(px, py, dx, dy)) <= TOLERANCIA_MM * largo
					&& t >= -TOLERANCIA_MM / largo && t <= 1 + TOLERANCIA_MM / largo;
			})
			.map((nudo) => ({ punto: nudo.punto, semihueco: Math.max(semihuecoMm, 1.6) }));
		const huecos = [...huecosCruce, ...huecosNudo]
			.map(({ punto: centro, semihueco }) => {
				const t = ((centro.x - a.x) * dx + (centro.y - a.y) * dy) / (largo * largo);
				const semiancho = Math.max(0, semihueco) / largo;
				if (t <= TOLERANCIA_MM / largo)
					return [0, Math.min(Math.max(semiancho, 1.6 / largo), 0.45)] as const;
				if (t >= 1 - TOLERANCIA_MM / largo)
					return [Math.max(1 - Math.max(semiancho, 1.6 / largo), 0.55), 1] as const;
				const mitad = Math.min(semiancho, t * 0.45, (1 - t) * 0.45);
				return [t - mitad, t + mitad] as const;
			})
			.filter(([desde, hasta]) => Number.isFinite(desde) && Number.isFinite(hasta) && hasta > desde)
			.sort((a, b) => a[0] - b[0]);
		const punto = (t: number): PuntoEsq => ({ x: a.x + dx * t, y: a.y + dy * t });
		let desde = 0;
		for (const [inicio, fin] of huecos) {
			if (inicio > desde) visibles.push({ a: punto(desde), b: punto(inicio), segmento });
			desde = Math.max(desde, fin);
		}
		if (desde < 1) visibles.push({ a: punto(desde), b: punto(1), segmento });
	}
	return visibles;
}
