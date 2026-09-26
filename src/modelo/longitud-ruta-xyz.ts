/** Referencia espacial persistente para la política eléctrica explícita CAB-27.
 * El plan V4 contiene todos sus XYZ; M6 manual necesita los bornes y salidas resueltos
 * por la escena del snapshot. Sin esa medición no se sustituye por una distancia 2D. */
import type { Conductor } from './tipos.js';
import { longitudPlanRutaAutomaticaMm } from './plan-ruta-automatica.js';

export function longitudRutaXYZMm(c: Conductor,
	referenciasManualesMm?: ReadonlyMap<string, number>): number | undefined {
	if (c.estadoRutaFisica === 'pendiente') return undefined;
	const mm = c.planRutaAutomatica ? longitudPlanRutaAutomaticaMm(c.planRutaAutomatica)
		: c.rutaFisica ? referenciasManualesMm?.get(c.id) : undefined;
	return typeof mm === 'number' && Number.isFinite(mm) && mm > 0 ? mm : undefined;
}
