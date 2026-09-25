/**
 * Recorrido editorial M2. No modifica Proyecto ni representa longitud física de cable.
 * Los extremos son anclajes eléctricos existentes; los desvíos solo evitan tinta ambigua
 * y cajas de aparatos en el papel. Si no hay candidato seguro, el llamador conserva el
 * recorrido previo y su diagnóstico: nunca dibujar una conexión inventada a otro borne.
 */
import type { HojaEsq, HiloEsq, PuntoEsq, SimboloEsq } from './esquema.js';

interface Rectangulo { x0: number; x1: number; y0: number; y1: number }
interface Limites { x0: number; x1: number; y0: number; y1: number; superior: number; inferior: number }

const EPS = 1e-6;
/** Separación de tinta y cajas en milímetros de plano, no una cota física de cable. */
const HOLGURA_GRAFICA_MM = 3;
const SEPARACION_TINTA_MM = 2.5;
const GIRO_EQUIVALENTE_MM = 5;
const COSTE_SOLAPE_POR_MM = 30;

const eq = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const igual = (a: PuntoEsq, b: PuntoEsq): boolean => eq(a.x, b.x) && eq(a.y, b.y);
const punto = (x: number, y: number): PuntoEsq => ({ x, y });

function rectangulo(s: SimboloEsq): Rectangulo {
	return { x0: s.x, x1: s.x + s.ancho, y0: s.y, y1: s.y + s.alto };
}

/** Un borde/borne se puede tocar; atravesar el interior de la caja no. */
function atraviesaCaja(a: PuntoEsq, b: PuntoEsq, r: Rectangulo,
	holguraParalelaMm = HOLGURA_GRAFICA_MM): boolean {
	if (eq(a.x, b.x)) {
		const juntoAlCostado = eq(a.x, r.x0) || eq(a.x, r.x1)
			|| holguraParalelaMm > 0 && (Math.abs(a.x - r.x0) < holguraParalelaMm - EPS
				|| Math.abs(a.x - r.x1) < holguraParalelaMm - EPS);
		const dentro = a.x > r.x0 + EPS && a.x < r.x1 - EPS;
		return (dentro || juntoAlCostado)
			&& Math.max(a.y, b.y) > r.y0 + EPS && Math.min(a.y, b.y) < r.y1 - EPS;
	}
	if (eq(a.y, b.y)) {
		const juntoAlBorde = eq(a.y, r.y0) || eq(a.y, r.y1)
			|| holguraParalelaMm > 0 && (Math.abs(a.y - r.y0) < holguraParalelaMm - EPS
				|| Math.abs(a.y - r.y1) < holguraParalelaMm - EPS);
		const dentro = a.y > r.y0 + EPS && a.y < r.y1 - EPS;
		return (dentro || juntoAlBorde)
			&& Math.max(a.x, b.x) > r.x0 + EPS && Math.min(a.x, b.x) < r.x1 - EPS;
	}
	// Solo los abanicos cortos de 45° en un borne compartido pueden ser diagonales.
	// Comprobar el interior real de la caja, no su holgura paralela.
	const dx = b.x - a.x, dy = b.y - a.y;
	const tx = [(r.x0 + EPS - a.x) / dx, (r.x1 - EPS - a.x) / dx].sort((x, y) => x - y);
	const ty = [(r.y0 + EPS - a.y) / dy, (r.y1 - EPS - a.y) / dy].sort((x, y) => x - y);
	return Math.min(1, tx[1], ty[1]) > Math.max(0, tx[0], ty[0]) + EPS;
}

/** Diagnóstico geométrico puro: orden estable y solo intersección de interiores. */
export function penetracionesDeSimbolos(hoja: Pick<HojaEsq, 'hilos' | 'simbolos'>):
	{ conductorId: string; segmento: number; dispositivoId: string }[] {
	const cajas = hoja.simbolos.map((s) => ({ id: s.dispositivoId, caja: rectangulo(s) }));
	const salida: { conductorId: string; segmento: number; dispositivoId: string }[] = [];
	for (const hilo of hoja.hilos) for (let segmento = 0; segmento + 1 < hilo.nodos.length; segmento++) {
		const a = hilo.nodos[segmento], b = hilo.nodos[segmento + 1];
		if (igual(a, b)) continue;
		for (const { id, caja } of cajas) if (atraviesaCaja(a, b, caja, 0))
			salida.push({ conductorId: hilo.conductorId, segmento, dispositivoId: id });
	}
	return salida.sort((a, b) => a.conductorId.localeCompare(b.conductorId)
		|| a.segmento - b.segmento || a.dispositivoId.localeCompare(b.dispositivoId));
}

function comprimir(nodos: PuntoEsq[]): PuntoEsq[] {
	const salida: PuntoEsq[] = [];
	for (const p of nodos) {
		if (salida.length && igual(salida[salida.length - 1], p)) continue;
		while (salida.length >= 2) {
			const a = salida[salida.length - 2], b = salida[salida.length - 1];
			if (!(eq(a.x, b.x) && eq(b.x, p.x) || eq(a.y, b.y) && eq(b.y, p.y))) break;
			salida.pop();
		}
		salida.push(p);
	}
	return salida;
}

function longitudSolapada(a: PuntoEsq, b: PuntoEsq, c: PuntoEsq, d: PuntoEsq): number {
	if (eq(a.x, b.x) && eq(c.x, d.x)) {
		const distancia = Math.abs(a.x - c.x);
		return distancia >= SEPARACION_TINTA_MM ? 0 :
			Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
				- Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)))
				* (1 - distancia / SEPARACION_TINTA_MM);
	}
	if (eq(a.y, b.y) && eq(c.y, d.y)) {
		const distancia = Math.abs(a.y - c.y);
		return distancia >= SEPARACION_TINTA_MM ? 0 :
			Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
				- Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)))
				* (1 - distancia / SEPARACION_TINTA_MM);
	}
	return 0;
}

function opcionesEje(valores: number[], minimo: number, maximo: number, centro: number): number[] {
	return [...new Set(valores.filter((v) => Number.isFinite(v) && v >= minimo && v <= maximo)
		.map((v) => Math.round(v * 1000) / 1000))]
		.sort((a, b) => Math.abs(a - centro) - Math.abs(b - centro) || a - b)
		.slice(0, 48);
}

/** Un pin en el borde debe abandonar primero SU caja, perpendicularmente al borde.
 * La cota es holgura de tinta en papel; no modifica el borne ni la ruta física. */
function salidaDeBorne(pin: PuntoEsq, borne: NonNullable<HiloEsq['bornes']>['de'] | undefined,
	simbolos: readonly SimboloEsq[]): PuntoEsq {
	if (!borne) return pin;
	const simbolo = simbolos.find((s) => s.dispositivoId === borne.dispositivoId
		&& s.pines.has(borne.borneId) && igual(s.pines.get(borne.borneId)!, pin));
	if (!simbolo) return pin;
	const caja = rectangulo(simbolo);
	if (eq(pin.x, caja.x0) && pin.y > caja.y0 + EPS && pin.y < caja.y1 - EPS)
		return punto(pin.x - HOLGURA_GRAFICA_MM, pin.y);
	if (eq(pin.x, caja.x1) && pin.y > caja.y0 + EPS && pin.y < caja.y1 - EPS)
		return punto(pin.x + HOLGURA_GRAFICA_MM, pin.y);
	if (eq(pin.y, caja.y0) && pin.x > caja.x0 + EPS && pin.x < caja.x1 - EPS)
		return punto(pin.x, pin.y - HOLGURA_GRAFICA_MM);
	if (eq(pin.y, caja.y1) && pin.x > caja.x0 + EPS && pin.x < caja.x1 - EPS)
		return punto(pin.x, pin.y + HOLGURA_GRAFICA_MM);
	return pin;
}

/** Busca un candidato corto y legible; no promete un autolayout universal. */
export function rutaOrtogonalM2(
	a: PuntoEsq, b: PuntoEsq, hoja: Pick<HojaEsq, 'simbolos' | 'anchoMm' | 'altoMm'>,
	rutasPrevias: readonly Pick<HiloEsq, 'nodos' | 'bornes'>[], limites: Limites,
	extremos?: HiloEsq['bornes'],
): PuntoEsq[] | undefined {
	if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return undefined;
	const cajas = hoja.simbolos.map(rectangulo);
	const desde = salidaDeBorne(a, extremos?.de, hoja.simbolos);
	const hasta = salidaDeBorne(b, extremos?.a, hoja.simbolos);
	const medioX = (desde.x + hasta.x) / 2, medioY = (desde.y + hasta.y) / 2;
	// Varios pines del mismo costado necesitan carriles sucesivos, no una única
	// vertical pegada a la caja. La separación repite la holgura gráfica de 3 mm.
	const carriles = (pin: PuntoEsq, salida: PuntoEsq, eje: 'x' | 'y'): number[] =>
		Array.from({ length: 4 }, (_, i) => salida[eje]
			+ Math.sign(salida[eje] - pin[eje]) * HOLGURA_GRAFICA_MM * (i + 1));
	const x = opcionesEje([desde.x, hasta.x, limites.x0, limites.x1,
		...carriles(a, desde, 'x'), ...carriles(b, hasta, 'x'),
		...cajas.flatMap((r) => [r.x0 - HOLGURA_GRAFICA_MM, r.x1 + HOLGURA_GRAFICA_MM])],
		limites.x0, limites.x1, medioX);
	const y = opcionesEje([desde.y, hasta.y, limites.superior, limites.inferior,
		...carriles(a, desde, 'y'), ...carriles(b, hasta, 'y'),
		...cajas.flatMap((r) => [r.y0 - HOLGURA_GRAFICA_MM, r.y1 + HOLGURA_GRAFICA_MM])],
		limites.y0, limites.y1, medioY);
	const salidasY = (v: number): number[] => Array.from({ length: 6 }, (_, indice) =>
		[indice + 1, -indice - 1].map((signo) => v + signo * HOLGURA_GRAFICA_MM)).flat();
	const cercaA = opcionesEje([desde.y, ...salidasY(desde.y),
		limites.superior, limites.inferior], limites.y0, limites.y1, desde.y);
	const cercaB = opcionesEje([hasta.y, ...salidasY(hasta.y),
		limites.superior, limites.inferior], limites.y0, limites.y1, hasta.y);
	let mejor: PuntoEsq[] | undefined;
	let costeMejor = Infinity;
	let solapeMejor = Infinity;
	let desempateMejor = '';
	const evaluar = (bruto: PuntoEsq[], permiteAbanico = false): void => {
		const nodos = comprimir(bruto);
		if (nodos.length < 2 || !igual(nodos[0], a) || !igual(nodos[nodos.length - 1], b)) return;
		let coste = GIRO_EQUIVALENTE_MM * Math.max(0, nodos.length - 2);
		let solape = 0;
		for (let i = 0; i + 1 < nodos.length; i++) {
			const u = nodos[i], v = nodos[i + 1];
			const ortogonal = eq(u.x, v.x) || eq(u.y, v.y);
			const abanico = permiteAbanico && (i === 0 || i + 2 === nodos.length)
				&& eq(Math.abs(u.x - v.x), HOLGURA_GRAFICA_MM)
				&& eq(Math.abs(u.y - v.y), HOLGURA_GRAFICA_MM);
			if (!ortogonal && !abanico) return;
			if (Math.min(u.x, v.x) < limites.x0 - EPS || Math.max(u.x, v.x) > limites.x1 + EPS
				|| Math.min(u.y, v.y) < limites.y0 - EPS || Math.max(u.y, v.y) > limites.y1 + EPS) return;
			if (cajas.some((r) => atraviesaCaja(u, v, r))) return;
			coste += Math.hypot(u.x - v.x, u.y - v.y);
			for (const previo of rutasPrevias) for (let j = 0; j + 1 < previo.nodos.length; j++)
				solape += longitudSolapada(u, v, previo.nodos[j], previo.nodos[j + 1]);
		}
		coste += COSTE_SOLAPE_POR_MM * solape;
		const desempate = nodos.map((p) => `${p.x},${p.y}`).join(';');
		if (coste < costeMejor - EPS || eq(coste, costeMejor) && desempate < desempateMejor) {
			mejor = nodos; costeMejor = coste; solapeMejor = solape; desempateMejor = desempate;
		}
	};
	if (eq(desde.x, hasta.x) || eq(desde.y, hasta.y)) evaluar([a, desde, hasta, b]);
	for (const columna of x) evaluar([a, desde, punto(columna, desde.y),
		punto(columna, hasta.y), hasta, b]);
	for (const fila of y) evaluar([a, desde, punto(desde.x, fila),
		punto(hasta.x, fila), hasta, b]);
	// Para extremos que miran hacia fuera, un solo corredor no basta: salir de cada
	// caja por separado y enlazar ambas salidas alrededor de los obstáculos.
	for (const columna of x) for (const filaA of cercaA) for (const filaB of cercaB)
		evaluar([a, desde, punto(desde.x, filaA), punto(columna, filaA), punto(columna, filaB),
			punto(hasta.x, filaB), hasta, b]);
	// Un borne compartido puede arrancar desde el mismo punto, pero no debe seguir
	// nueve o más milímetros sobre la misma tinta. Un escape de 3 mm a 45° separa
	// la rama inmediatamente; el resto vuelve al dibujo ortogonal.
	const base = mejor;
	if (base && solapeMejor > HOLGURA_GRAFICA_MM + EPS) {
		const compartir = (extremo: PuntoEsq): boolean => {
			const borne = igual(extremo, a) ? extremos?.de : extremos?.a;
			return !!borne && rutasPrevias.some((r) => r.nodos.length > 0
				&& ([
					[r.nodos[0], r.bornes?.de],
					[r.nodos[r.nodos.length - 1], r.bornes?.a],
				] as const).some(([punto, otro]) => igual(punto, extremo) && !!otro
					&& otro.dispositivoId === borne.dispositivoId && otro.borneId === borne.borneId));
		};
		const abanicos = (reversa: boolean): void => {
			const camino = reversa ? [...base].reverse() : base;
			const origen = camino[0], primerGiro = camino[1];
			if (!compartir(origen)) return;
			const dx = primerGiro.x - origen.x, dy = primerGiro.y - origen.y;
			const vertical = eq(dx, 0), horizontal = eq(dy, 0);
			if (!(vertical || horizontal) || Math.hypot(dx, dy) < HOLGURA_GRAFICA_MM + EPS) return;
			for (const lado of [-1, 1]) {
				const diagonal = vertical
					? punto(origen.x + lado * HOLGURA_GRAFICA_MM,
						origen.y + Math.sign(dy) * HOLGURA_GRAFICA_MM)
					: punto(origen.x + Math.sign(dx) * HOLGURA_GRAFICA_MM,
						origen.y + lado * HOLGURA_GRAFICA_MM);
				const paralelo = vertical ? punto(diagonal.x, primerGiro.y)
					: punto(primerGiro.x, diagonal.y);
				const candidato = [origen, diagonal, paralelo, ...camino.slice(1)];
				evaluar(reversa ? candidato.reverse() : candidato, true);
			}
		};
		abanicos(false);
		abanicos(true);
	}
	return mejor;
}
