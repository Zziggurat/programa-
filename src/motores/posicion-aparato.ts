import type { Dispositivo, Gabinete } from '../modelo/tipos.js';
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { evaluarCompatibilidadMontaje } from '../componentes/montaje.js';

export interface PosicionAparato { x: number; y: number }
export type ResultadoPosicionAparato = { ok: true; valor: PosicionAparato & { cambio: boolean } }
	| { ok: false; motivo: string };

const EPS = 1e-6;
const HOLGURA_MM = 3;
const error = (motivo: string): ResultadoPosicionAparato => ({ ok: false, motivo });

/** Plan en coordenadas de placa. Un anclaje DIN permite avanzar sobre su eje, no despegarse. */
export function planPosicionAparato(
	g: Gabinete, dispositivos: readonly Dispositivo[], dispositivoId: string,
	posicion: PosicionAparato,
): ResultadoPosicionAparato {
	const candidatos = g.colocaciones.filter((c) => c.dispositivoId === dispositivoId);
	const aparatos = dispositivos.filter((d) => d.id === dispositivoId);
	if (candidatos.length !== 1 || aparatos.length !== 1)
		return error('La colocación y el aparato deben existir de forma unívoca.');
	const col = candidatos[0], d = aparatos[0];
	if (col.montaje === 'puerta') return error('Esta edición usa coordenadas de placa, no de puerta.');
	const { x, y } = posicion;
	if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0)
		return error('X/Y deben ser milímetros finitos y no negativos.');
	if (x + col.ancho > g.ancho + EPS || y + col.alto > g.alto + EPS)
		return error('La huella del aparato saldría de la placa.');
	if (d.montajeComponente?.metodo === 'riel-din' && !col.rielId)
		return error('El componente declara riel DIN pero su colocación no tiene anclaje.');
	if (d.montajeComponente?.metodo === 'atornillado-placa' && col.rielId)
		return error('Un componente de placa atornillada no puede conservar rielId.');
	if (col.rielId) {
		const rieles = g.rieles.filter((r) => r.id === col.rielId);
		if (rieles.length !== 1) return error('El anclaje DIN no existe de forma unívoca.');
		const r = rieles[0], vertical = r.orientacion === 'v';
		if (Math.abs((vertical ? x : y) - (vertical ? col.x : col.y)) > EPS)
			return error(`El aparato está anclado a ${r.id}: solo puede moverse por el eje ${vertical ? 'Y' : 'X'}.`);
		if (vertical ? y < r.y - EPS || y + col.alto > r.y + r.largo + EPS
			: x < r.x - EPS || x + col.ancho > r.x + r.largo + EPS)
			return error(`El aparato quedaría fuera del largo útil de ${r.id}.`);
	}
	if (!esReferenciaVisualInerte(d)) {
		const porId = new Map(dispositivos.map((item) => [item.id, item]));
		for (const otra of [...g.colocaciones].sort((a, b) => a.dispositivoId < b.dispositivoId ? -1 : a.dispositivoId > b.dispositivoId ? 1 : 0)) {
			if (otra.dispositivoId === dispositivoId || otra.montaje === 'puerta'
				|| (porId.get(otra.dispositivoId) && esReferenciaVisualInerte(porId.get(otra.dispositivoId)!))) continue;
			if (x + col.ancho + HOLGURA_MM > otra.x && otra.x + otra.ancho + HOLGURA_MM > x
				&& y + col.alto + HOLGURA_MM > otra.y && otra.y + otra.alto + HOLGURA_MM > y)
				return error(`La huella invadiría la holgura de ${otra.dispositivoId}.`);
		}
	}
	if (d.componentePersonalizado) {
		const compatibilidad = evaluarCompatibilidadMontaje({ anchoMm: col.ancho, altoMm: col.alto,
			fondoMm: d.profundidad ?? 0 }, d.montajeComponente, g, { ...col, x, y });
		if (compatibilidad.estado === 'NO_CABE') return error(compatibilidad.motivos.join(' '));
	}
	return { ok: true, valor: { x, y, cambio: x !== col.x || y !== col.y } };
}
