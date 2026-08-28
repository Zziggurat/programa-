import type { OrigenDatoFisico } from '../modelo/fisica.js';
import { CERO, Complejo, dividir, magnitud, restar, sumar } from './complejos.js';
import { resolverSistemaComplejo } from './algebra.js';
import { resolverRedFisica } from './solver.js';
import { TOLERANCIAS_FISICA } from './tolerancias.js';
import type { DiagnosticoFisica, RedFisica } from './tipos.js';

export type TipoFallaFisica = 'L_N' | 'L_L' | 'L_PE' | 'TRIFASICA' | 'CONDUCTOR_ABIERTO'
	| 'NEUTRO_ABIERTO' | 'RESISTENCIA_ANORMAL';

export interface FallaFisicaRuntime {
	id: string;
	tipo: TipoFallaFisica;
	nodoA?: string;
	nodoB?: string;
	ramaId?: string;
	zFallaOhm?: Complejo;
	resistenciaAdicionalOhm?: number;
}

export interface ResultadoFallaFisica {
	id: string;
	tipo: TipoFallaFisica;
	nodoA?: string;
	nodoB?: string;
	vPrefallaV?: Complejo;
	zTheveninOhm?: Complejo;
	zFallaOhm?: Complejo;
	iccA?: Complejo;
	origen: OrigenDatoFisico;
	diagnosticos: DiagnosticoFisica[];
	/** La proteccion ya abrio, pero se conserva el calculo prospectivo del instante de disparo. */
	despejada?: boolean;
}

export const IMPEDANCIA_FALLA_FRANCA_OHM: Complejo = Object.freeze({ re: 0.001, im: 0 });

export function aplicarAlteracionesSerieTopologia(red: RedFisica, fallas: readonly FallaFisicaRuntime[]): RedFisica {
	const abiertas = new Set(fallas.filter((f) => f.tipo === 'CONDUCTOR_ABIERTO' || f.tipo === 'NEUTRO_ABIERTO').map((f) => f.ramaId));
	const resistencias = new Map(fallas.filter((f) => f.tipo === 'RESISTENCIA_ANORMAL' && f.ramaId)
		.map((f) => [f.ramaId!, Math.max(0, f.resistenciaAdicionalOhm ?? 0)]));
	return {
		...red,
		ramas: red.ramas.filter((r) => !abiertas.has(r.id)).map((r) => ({
			...r, zOhm: { re: r.zOhm.re + (resistencias.get(r.id) ?? 0), im: r.zOhm.im },
		})),
	};
}

/** Aplica también los cortocircuitos como ramas reales para que sus corrientes atraviesen equipos. */
export function aplicarFallosTopologia(red: RedFisica, fallas: readonly FallaFisicaRuntime[]): RedFisica {
	const serie = aplicarAlteracionesSerieTopologia(red, fallas);
	const cortos = fallas.flatMap((f) => {
		if (!['L_N', 'L_L', 'L_PE', 'TRIFASICA'].includes(f.tipo) || !f.nodoA || !f.nodoB) return [];
		return [{ id: `falla:${f.id}`, de: f.nodoA, a: f.nodoB,
			zOhm: f.zFallaOhm ?? IMPEDANCIA_FALLA_FRANCA_OHM,
			tipo: 'OTRO' as const, origen: 'INYECTADO' as const }];
	});
	return { ...serie, ramas: [...serie.ramas, ...cortos] };
}

/** Impedancia vista entre dos nodos, suprimiendo fuentes independientes. */
export function impedanciaThevenin(red: RedFisica, nodoA: string, nodoB: string): {
	z?: Complejo; origen: OrigenDatoFisico; diagnosticos: DiagnosticoFisica[];
} {
	const diagnosticos: DiagnosticoFisica[] = [];
	if (!red.nodos.some((n) => n.id === nodoA) || !red.nodos.some((n) => n.id === nodoB)) return {
		origen: 'NO_MODELADO', diagnosticos: [{ codigo: 'CONFIGURACION_INVALIDA', mensaje: 'El punto de falla no existe' }],
	};
	const sinZ = red.fuentes.filter((f) => !f.zInternaOhm);
	if (sinZ.length) return {
		origen: 'NO_MODELADO', diagnosticos: [{ codigo: 'ICC_NO_DISPONIBLE',
			mensaje: `Falta impedancia interna en ${sinZ.map((f) => f.id).join(', ')}`, elementos: sinZ.map((f) => f.id) }],
	};
	const referencias = new Set(red.nodos.filter((n) => n.referencia).map((n) => n.id));
	const variables = red.nodos.map((n) => n.id).filter((id) => !referencias.has(id)).sort((a, b) => a.localeCompare(b));
	const indice = new Map(variables.map((id, i) => [id, i]));
	const g = Array.from({ length: variables.length }, () => Array.from({ length: variables.length }, () => ({ ...CERO })));
	const b = Array.from({ length: variables.length }, () => ({ ...CERO }));
	const agregar = (destino: Complejo, valor: Complejo) => { destino.re += valor.re; destino.im += valor.im; };
	const estampar = (de: string, a: string, z: Complejo) => {
		if (magnitud(z) <= TOLERANCIAS_FISICA.cero) return;
		const y = dividir({ re: 1, im: 0 }, z);
		for (const [propio, otro] of [[de, a], [a, de]] as const) {
			const i = indice.get(propio); if (i === undefined) continue;
			agregar(g[i][i], y);
			const j = indice.get(otro); if (j !== undefined) agregar(g[i][j], { re: -y.re, im: -y.im });
		}
	};
	for (const r of red.ramas) estampar(r.de, r.a, r.zOhm);
	for (const f of red.fuentes) if (f.zInternaOhm) estampar(f.de, f.a, f.zInternaOhm);
	for (const c of red.cargas) if (c.modelo === 'CONSTANT_Z') estampar(c.de, c.a, c.zOhm);
	const ia = indice.get(nodoA); const ib = indice.get(nodoB);
	if (ia !== undefined) agregar(b[ia], { re: 1, im: 0 });
	if (ib !== undefined) agregar(b[ib], { re: -1, im: 0 });
	try {
		const v = resolverSistemaComplejo(g, b);
		const va = ia === undefined ? CERO : v[ia]; const vb = ib === undefined ? CERO : v[ib];
		const origen: OrigenDatoFisico = red.fuentes.every((f) => f.origenImpedancia === 'CONFIGURADO') ? 'CALCULADO' : 'ESTIMADO';
		return { z: restar(va, vb), origen, diagnosticos };
	} catch (e) {
		return { origen: 'NO_MODELADO', diagnosticos: [{ codigo: 'ICC_NO_DISPONIBLE', mensaje: (e as Error).message }] };
	}
}

export function resolverFalla(redOriginal: RedFisica, falla: FallaFisicaRuntime): ResultadoFallaFisica {
	const red = aplicarAlteracionesSerieTopologia(redOriginal, [falla]);
	if (falla.tipo === 'CONDUCTOR_ABIERTO' || falla.tipo === 'NEUTRO_ABIERTO' || falla.tipo === 'RESISTENCIA_ANORMAL') return {
		id: falla.id, tipo: falla.tipo, origen: 'INYECTADO', diagnosticos: [],
	};
	if (!falla.nodoA || !falla.nodoB) return { id: falla.id, tipo: falla.tipo, origen: 'NO_MODELADO',
		diagnosticos: [{ codigo: 'CONFIGURACION_INVALIDA', mensaje: 'La falla necesita dos nodos' }] };
	const prefalla = resolverRedFisica(red);
	const va = prefalla.nodos.get(falla.nodoA)?.tensionV;
	const vb = prefalla.nodos.get(falla.nodoB)?.tensionV;
	const th = impedanciaThevenin(red, falla.nodoA, falla.nodoB);
	const zFallaOhm = falla.zFallaOhm ?? IMPEDANCIA_FALLA_FRANCA_OHM;
	if (!va || !vb || !th.z) return {
		id: falla.id, tipo: falla.tipo, nodoA: falla.nodoA, nodoB: falla.nodoB,
		vPrefallaV: va && vb ? restar(va, vb) : undefined, zFallaOhm,
		origen: 'NO_MODELADO', diagnosticos: [...prefalla.diagnosticos, ...th.diagnosticos],
	};
	const vPrefallaV = restar(va, vb);
	const total = sumar(th.z, zFallaOhm);
	if (magnitud(total) <= TOLERANCIAS_FISICA.cero) return { id: falla.id, tipo: falla.tipo,
		nodoA: falla.nodoA, nodoB: falla.nodoB, vPrefallaV, zTheveninOhm: th.z, zFallaOhm,
		origen: 'NO_MODELADO', diagnosticos: [{ codigo: 'ICC_NO_DISPONIBLE', mensaje: 'Impedancia total de falla nula' }] };
	return {
		id: falla.id, tipo: falla.tipo, nodoA: falla.nodoA, nodoB: falla.nodoB, vPrefallaV,
		zTheveninOhm: th.z, zFallaOhm, iccA: dividir(vPrefallaV, total),
		origen: th.origen, diagnosticos: [{ codigo: 'FALLA', mensaje: `Falla ${falla.tipo} inyectada entre ${falla.nodoA} y ${falla.nodoB}` }],
	};
}
