import type { Proyecto } from './tipos.js';
import { firmaFuentePlanRuta, geometriaDelPlanRuta } from './plan-ruta-automatica.js';
import { cajaDeGabinete } from './proyecto.js';
import { anclajeCampo, aparatosDeCampo } from './entradas-campo.js';

export interface PuntoRutaDependiente { x: number; y: number }
type Caja = { x0: number; x1: number; y0: number; y1: number };

/**
 * Huellas cuya geometría puede afectar físicamente una ruta ya asignada.
 * Es conservador: un falso positivo pide revisión; un falso negativo dibuja una
 * ruta vieja atravesando una pieza nueva. Cada punto automático está muestreado
 * densamente, pero se examinan también los tramos entre muestras.
 */
function cercaDeRuta(caja: Caja, puntos: readonly PuntoRutaDependiente[], margen: number): boolean {
	for (let i = 0; i < puntos.length; i++) {
		const a = puntos[i], b = puntos[Math.min(i + 1, puntos.length - 1)];
		if (Math.max(a.x, b.x) >= caja.x0 - margen && Math.min(a.x, b.x) <= caja.x1 + margen
			&& Math.max(a.y, b.y) >= caja.y0 - margen && Math.min(a.y, b.y) <= caja.y1 + margen) return true;
	}
	return false;
}

/** Firma estable del entorno local, independiente del orden de arrays del proyecto. */
export function firmaEntornoRutaAutomatica(
	proyecto: Proyecto, puntos: readonly PuntoRutaDependiente[], radio: number,
): string {
	const g = proyecto.gabinete;
	if (!g) return 'SIN_GABINETE';
	const margen = radio + 12;
	const cerca = (caja: Caja): boolean => cercaDeRuta(caja, puntos, margen);
	const aparatos = g.colocaciones.filter((c) => cerca({ x0: c.x, x1: c.x + c.ancho,
		y0: c.y, y1: c.y + c.alto }))
		.map((c) => {
			const d = proyecto.dispositivos.find((x) => x.id === c.dispositivoId);
			return [c.dispositivoId, c.x, c.y, c.ancho, c.alto, c.z, c.montaje,
				d?.profundidad, d?.bornes.map((b) => [b.id, b.u, b.v]), d?.terminales,
				Boolean(d?.imagen), Boolean(d?.componentePersonalizado)];
		}).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	const canaletas = g.canaletas.filter((c) => c.orientacion === 'h'
		? cerca({ x0: c.x, x1: c.x + c.largo, y0: c.y - c.ancho / 2, y1: c.y + c.ancho / 2 })
		: cerca({ x0: c.x - c.ancho / 2, x1: c.x + c.ancho / 2, y0: c.y, y1: c.y + c.largo }))
		.map((c) => [c.id, c.x, c.y, c.largo, c.orientacion, c.ancho, c.alto])
		.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	const rieles = g.rieles.filter((r) => r.orientacion !== 'v'
		? cerca({ x0: r.x, x1: r.x + r.largo, y0: r.y - 17.5, y1: r.y + 17.5 })
		: cerca({ x0: r.x - 17.5, x1: r.x + 17.5, y0: r.y, y1: r.y + r.largo }))
		.map((r) => [r.id, r.x, r.y, r.largo, r.orientacion ?? 'h'])
		.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	// Declarar los mismos valores que antes eran implícitos no altera la caja física.
	const caja = cajaDeGabinete(g);
	const entradas = (g.entradas ?? []).map((e) => [e.id, e.cara, e.x])
		.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
	return JSON.stringify([aparatos, canaletas, rieles, g.ancho, g.alto,
		caja.ancho, caja.alto, caja.profundidad, g.caja?.bisagras ?? 'izquierda',
		g.mazoPuerta?.desdeBisagra ?? 26, entradas]);
}

/** Detecta solo planes activos afectados; el plan viejo se preserva para revisión/Undo. */
export function idsDePlanesObsoletos(proyecto: Proyecto): string[] {
	const campo = new Map(aparatosDeCampo(proyecto).map((d) => [d.id, d]));
	const anclajeCampoCambiado = (ref: { dispositivoId: string; borneId: string },
		anterior: readonly number[]): boolean => {
		const d = campo.get(ref.dispositivoId);
		if (!d) return false; // los montados se cubren por la firma local de huellas
		const actual = anclajeCampo(proyecto, d, ref.borneId);
		return !actual || actual.x !== anterior[0] || actual.y !== anterior[1] || actual.z !== anterior[2];
	};
	return proyecto.conductores.filter((c) => {
		const plan = c.planRutaAutomatica;
		return !!plan && c.estadoRutaFisica !== 'pendiente'
			&& (plan.fuente !== firmaFuentePlanRuta(c)
				|| anclajeCampoCambiado(c.de, plan.de) || anclajeCampoCambiado(c.a, plan.a)
				|| plan.entorno !== firmaEntornoRutaAutomatica(proyecto,
					geometriaDelPlanRuta(plan).puntos, plan.radio));
	}).map((c) => c.id).sort();
}

/** Nunca recalcula ni reemplaza el recorrido: marca la conexión física como pendiente. */
export function marcarPlanesObsoletosPendientes(proyecto: Proyecto): string[] {
	const ids = idsDePlanesObsoletos(proyecto);
	const afectados = new Set(ids);
	for (const c of proyecto.conductores) if (afectados.has(c.id)) c.estadoRutaFisica = 'pendiente';
	return ids;
}
