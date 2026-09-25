/**
 * Edición numérica de un riel DIN. La identidad `rielId` es un anclaje mecánico:
 * mover el soporte sin sus colocaciones rompería el modelo aunque el 3D pareciera sano.
 * Esta propuesta es pura; la UI la aplica en una sola transacción/Undo.
 */
import type { Dispositivo, Gabinete } from '../modelo/tipos.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';

export interface MedidasRiel { x: number; y: number; largo: number }
export interface PlanMedidasRiel {
	rielId: string;
	medidas: MedidasRiel;
	aparatos: { dispositivoId: string; x: number; y: number }[];
	cambio: boolean;
}
export type ResultadoMedidasRiel = { ok: true; valor: PlanMedidasRiel }
	| { ok: false; motivo: string };

const EPS = 1e-6;
/** La misma holgura mínima entre huellas de la edición de la placa. */
const HOLGURA_APARATO_MM = 3;
const error = (motivo: string): ResultadoMedidasRiel => ({ ok: false, motivo });

/** Rechaza datos imposibles y choques antes de crear historia o modificar el Proyecto. */
export function planMedidasRiel(
	g: Gabinete, dispositivos: readonly Dispositivo[], rielId: string, medidas: MedidasRiel,
): ResultadoMedidasRiel {
	const encontrados = g.rieles.filter((r) => r.id === rielId);
	if (encontrados.length !== 1) return error('El riel no existe de forma unívoca.');
	const r = encontrados[0];
	if (![medidas.x, medidas.y, medidas.largo].every(Number.isFinite)
		|| medidas.x < 0 || medidas.y < 0 || medidas.largo < 60)
		return error('X, Y y largo deben ser milímetros finitos, no negativos; largo mínimo 60 mm.');
	const vertical = r.orientacion === 'v';
	if (medidas.x + (vertical ? 0 : medidas.largo) > g.ancho + EPS
		|| medidas.y + (vertical ? medidas.largo : 0) > g.alto + EPS)
		return error('El riel completo debe caber dentro de la placa.');
	const dx = medidas.x - r.x, dy = medidas.y - r.y;
	const sujetas = g.colocaciones.filter((c) => c.rielId === rielId)
		.sort((a, b) => a.dispositivoId < b.dispositivoId ? -1 : a.dispositivoId > b.dispositivoId ? 1 : 0);
	const ids = new Set<string>();
	for (const c of sujetas) {
		if (ids.has(c.dispositivoId)) return error('Hay colocaciones duplicadas en el mismo riel.');
		ids.add(c.dispositivoId);
	}
	const aparatos = sujetas.map((c) => ({ dispositivoId: c.dispositivoId,
		x: c.x + dx, y: c.y + dy }));
	const ubicacion = new Map(aparatos.map((c) => [c.dispositivoId, c]));
	const porId = new Map(dispositivos.map((d) => [d.id, d]));
	const inerte = (id: string): boolean => {
		const d = porId.get(id);
		return d ? esReferenciaVisualInerte(d) : false;
	};
	for (const c of sujetas) {
		if (!porId.has(c.dispositivoId))
			return error(`La colocación ${c.dispositivoId} no tiene aparato eléctrico.`);
		const nueva = ubicacion.get(c.dispositivoId)!;
		if (nueva.x < -EPS || nueva.y < -EPS
			|| nueva.x + c.ancho > g.ancho + EPS || nueva.y + c.alto > g.alto + EPS)
			return error(`El aparato ${c.dispositivoId} saldría de la placa.`);
		if (vertical
			? nueva.y < medidas.y - EPS || nueva.y + c.alto > medidas.y + medidas.largo + EPS
			: nueva.x < medidas.x - EPS || nueva.x + c.ancho > medidas.x + medidas.largo + EPS)
			return error(`El aparato ${c.dispositivoId} quedaría fuera del largo útil del riel.`);
		if (inerte(c.dispositivoId)) continue;
		for (const otra of g.colocaciones) {
			if (otra.dispositivoId === c.dispositivoId || otra.montaje === 'puerta'
				|| inerte(otra.dispositivoId)) continue;
			const p = ubicacion.get(otra.dispositivoId) ?? otra;
			if (nueva.x + c.ancho + HOLGURA_APARATO_MM > p.x
				&& p.x + otra.ancho + HOLGURA_APARATO_MM > nueva.x
				&& nueva.y + c.alto + HOLGURA_APARATO_MM > p.y
				&& p.y + otra.alto + HOLGURA_APARATO_MM > nueva.y)
				return error(`El aparato ${c.dispositivoId} invadiría la holgura de ${otra.dispositivoId}.`);
		}
	}
	return { ok: true, valor: { rielId, medidas: { ...medidas }, aparatos,
		cambio: dx !== 0 || dy !== 0 || medidas.largo !== r.largo } };
}
