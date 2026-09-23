/** Contrato mecánico mínimo de componentes propios: geometría declarada, no certificación de montaje. */
import type { Colocacion, Gabinete, MontajeComponente } from '../modelo/tipos.js';

export type EstadoCompatibilidadMontaje = 'NO_CABE' | 'NO_EVALUABLE' | 'GEOMETRIA_COMPATIBLE';
export interface CompatibilidadMontaje {
	estado: EstadoCompatibilidadMontaje;
	motivos: string[];
}

type Dimensiones = { anchoMm: number; altoMm: number; fondoMm: number };
const objeto = (valor: unknown): valor is Record<string, unknown> =>
	typeof valor === 'object' && valor !== null && !Array.isArray(valor);
const numeroNoNegativo = (valor: unknown): valor is number =>
	typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;

/** Lista blanca y límites de recursos para importaciones; un anclaje desconocido no se inventa. */
export function validarMontajeDeclarado(montaje: unknown, dimensiones?: Dimensiones): string[] {
	if (montaje === undefined) return [];
	if (!objeto(montaje) || !['riel-din', 'atornillado-placa'].includes(String(montaje.metodo))) {
		return ['el método de montaje debe ser riel DIN o placa atornillada'];
	}
	if (montaje.anclajes === undefined) return [];
	if (!Array.isArray(montaje.anclajes) || montaje.anclajes.length > 64) {
		return ['los anclajes deben ser una lista de hasta 64 posiciones'];
	}
	const errores: string[] = [];
	for (const [i, anclaje] of montaje.anclajes.entries()) {
		if (!objeto(anclaje) || !numeroNoNegativo(anclaje.xMm) || !numeroNoNegativo(anclaje.yMm)
			|| dimensiones !== undefined && (anclaje.xMm > dimensiones.anchoMm || anclaje.yMm > dimensiones.altoMm)
			|| anclaje.diametroMm !== undefined
				&& (typeof anclaje.diametroMm !== 'number' || !Number.isFinite(anclaje.diametroMm) || anclaje.diametroMm <= 0)) {
			errores.push(`anclaje ${i + 1}: coordenadas/diámetro fuera de la envolvente declarada`);
		}
	}
	return errores;
}

/** El cargador usa esta lista blanca para no conservar propiedades ajenas en un Proyecto. */
export function leerMontajeDeclarado(valor: unknown, dimensiones?: Dimensiones): MontajeComponente | undefined {
	if (validarMontajeDeclarado(valor, dimensiones).length || !objeto(valor)) return undefined;
	return {
		metodo: valor.metodo as MontajeComponente['metodo'],
		...(valor.anclajes === undefined ? {} : { anclajes: (valor.anclajes as Record<string, unknown>[]).map((a) => ({
			xMm: a.xMm as number, yMm: a.yMm as number,
			...(a.diametroMm === undefined ? {} : { diametroMm: a.diametroMm as number }),
		})) }),
	};
}

const solapan = (a: Pick<Colocacion, 'x' | 'y' | 'ancho' | 'alto'>,
	b: Pick<Colocacion, 'x' | 'y' | 'ancho' | 'alto'>): boolean =>
	a.x < b.x + b.ancho && a.x + a.ancho > b.x
	&& a.y < b.y + b.alto && a.y + a.alto > b.y;

/**
 * Prueba solo hechos representados por el modelo. No conoce patrón/perforación real de la placa,
 * clip DIN del fabricante ni holgura de cableado: GEOMETRIA_COMPATIBLE nunca significa aprobado.
 */
export function evaluarCompatibilidadMontaje(
	dimensiones: Dimensiones, montaje: MontajeComponente | undefined,
	gabinete: Gabinete, colocacion: Colocacion,
): CompatibilidadMontaje {
	const noCabe: string[] = [];
	if (colocacion.montaje === 'puerta') noCabe.push('El método declarado no admite montaje en puerta.');
	if (colocacion.x < 0 || colocacion.y < 0 || colocacion.x + colocacion.ancho > gabinete.ancho
		|| colocacion.y + colocacion.alto > gabinete.alto) noCabe.push('La huella sale de la placa útil.');
	if (colocacion.ancho < dimensiones.anchoMm || colocacion.alto < dimensiones.altoMm) {
		noCabe.push('La colocación es menor que la envolvente declarada.');
	}
	if (gabinete.caja && dimensiones.fondoMm > gabinete.caja.profundidad) {
		noCabe.push('La profundidad declarada supera la profundidad total de la caja.');
	}
	for (const otra of gabinete.colocaciones) {
		if (otra === colocacion || otra.dispositivoId === colocacion.dispositivoId
			|| (otra.montaje ?? 'placa') !== (colocacion.montaje ?? 'placa')) continue;
		if (solapan(colocacion, otra)) { noCabe.push(`La huella se solapa con ${otra.dispositivoId}.`); break; }
	}
	if (montaje?.metodo === 'riel-din') {
		if (!colocacion.rielId || !gabinete.rieles.some((r) => r.id === colocacion.rielId)) {
			noCabe.push('Falta el riel DIN declarado para esta colocación.');
		}
	} else if (montaje?.metodo === 'atornillado-placa' && colocacion.rielId) {
		noCabe.push('La colocación se ancló a un riel, pero el componente declara placa atornillada.');
	}
	if (montaje?.metodo === 'atornillado-placa') {
		for (const canaleta of gabinete.canaletas) {
			const horizontal = canaleta.orientacion === 'h';
			if (solapan(colocacion, { x: canaleta.x, y: canaleta.y,
				ancho: horizontal ? canaleta.largo : canaleta.ancho,
				alto: horizontal ? canaleta.ancho : canaleta.largo })) {
				noCabe.push(`La huella invade la canaleta ${canaleta.id}.`); break;
			}
		}
		// El modelo solo declara riel DIN; su perfil transversal nominal es de 35 mm.
		for (const riel of gabinete.rieles) {
			const vertical = riel.orientacion === 'v';
			if (solapan(colocacion, { x: vertical ? riel.x - 17.5 : riel.x,
				y: vertical ? riel.y : riel.y - 17.5,
				ancho: vertical ? 35 : riel.largo, alto: vertical ? riel.largo : 35 })) {
				noCabe.push(`La huella invade el riel ${riel.id}.`); break;
			}
		}
	}
	if (noCabe.length) return { estado: 'NO_CABE', motivos: noCabe };
	if (!montaje) return { estado: 'NO_EVALUABLE', motivos: ['El método de montaje no está declarado; la colocación es ilustrativa.'] };
	if (montaje.metodo === 'atornillado-placa' && !montaje.anclajes?.length) {
		return { estado: 'NO_EVALUABLE', motivos: ['No se declararon centros de fijación para la placa.'] };
	}
	return { estado: 'GEOMETRIA_COMPATIBLE', motivos: [
		'Envolvente y superficie modeladas compatibles; fijaciones reales y holguras requieren verificación humana.',
	] };
}

/** Propuesta determinista de huella libre para un componente de placa, sin mover ningún aparato. */
export function buscarColocacionPlaca(
	dimensiones: Dimensiones, montaje: MontajeComponente,
	gabinete: Gabinete, dispositivoId: string,
): Colocacion | undefined {
	if (montaje.metodo !== 'atornillado-placa') return undefined;
	const xs = new Set([0, 8]);
	const ys = new Set([0, 8]);
	for (const c of gabinete.colocaciones) { xs.add(c.x + c.ancho + 8); ys.add(c.y + c.alto + 8); }
	for (const c of gabinete.canaletas) {
		xs.add(c.x + (c.orientacion === 'h' ? c.largo : c.ancho) + 8);
		ys.add(c.y + (c.orientacion === 'h' ? c.ancho : c.largo) + 8);
	}
	for (const r of gabinete.rieles) {
		xs.add((r.orientacion === 'v' ? r.x + 17.5 : r.x + r.largo) + 8);
		ys.add((r.orientacion === 'v' ? r.y + r.largo : r.y + 17.5) + 8);
	}
	const ordenX = [...xs].sort((a, b) => a - b);
	for (const y of [...ys].sort((a, b) => a - b)) {
		for (const x of ordenX) {
			const col = { dispositivoId, x, y, ancho: dimensiones.anchoMm, alto: dimensiones.altoMm };
			if (evaluarCompatibilidadMontaje(dimensiones, montaje, gabinete, col).estado !== 'NO_CABE') return col;
		}
	}
	return undefined;
}
