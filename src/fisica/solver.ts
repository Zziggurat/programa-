import {
	CERO, Complejo, conjugado, dividir, escalar, magnitud, multiplicar, polar, restar, sumar,
} from './complejos.js';
import { ErrorNumericoFisica, resolverSistemaComplejo } from './algebra.js';
import { TOLERANCIAS_FISICA } from './tolerancias.js';
import type {
	CargaRedFisica, DiagnosticoFisica, FuenteRedFisica, RedFisica, ResultadoCargaFisica,
	ResultadoFuenteFisica, ResultadoNodoFisica, ResultadoRamaFisica, ResultadoRedFisica,
} from './tipos.js';

export interface OpcionesSolverFisica {
	toleranciaV?: number;
	maxIteraciones?: number;
	damping?: number;
}

const ahora = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();
const agregar = (a: Complejo, b: Complejo): void => { a.re += b.re; a.im += b.im; };
const opuesto = (a: Complejo): Complejo => ({ re: -a.re, im: -a.im });
const impedanciaValida = (z: Complejo): boolean => Number.isFinite(z.re) && Number.isFinite(z.im)
	&& magnitud(z) > TOLERANCIAS_FISICA.cero;

function corrienteCarga(c: CargaRedFisica, v: Complejo): Complejo {
	if (c.modelo === 'CONSTANT_Z') return dividir(v, c.zOhm);
	if (c.modelo === 'CONSTANT_I') {
		const fp = Math.max(0, Math.min(1, c.factorPotencia ?? 1));
		return polar(c.corrienteA, Math.atan2(v.im, v.re) - Math.acos(fp));
	}
	const usada = magnitud(v) > 1e-3 ? v : polar(c.tensionNominalV, 0);
	return conjugado(dividir(c.potenciaVA, usada));
}

function idsValidos(red: RedFisica, diagnosticos: DiagnosticoFisica[]): string[] {
	const ids = [...new Set(red.nodos.map((n) => n.id))].sort((a, b) => a.localeCompare(b));
	const conocidos = new Set(ids);
	for (const e of [...red.ramas, ...red.fuentes, ...red.cargas]) {
		if (!conocidos.has(e.de) || !conocidos.has(e.a)) diagnosticos.push({
			codigo: 'CONFIGURACION_INVALIDA', mensaje: `${e.id} referencia un nodo inexistente`, elementos: [e.id],
		});
	}
	return ids;
}

/**
 * Solver nodal fasorial. Las fuentes con Z se estampan como Norton; una fuente sin Z fija la
 * tension solo cuando uno de sus terminales es una referencia. Las cargas I/PQ iteran sin
 * avanzar tiempo de simulacion.
 */
export function resolverRedFisica(red: RedFisica, opciones: OpcionesSolverFisica = {}): ResultadoRedFisica {
	const inicio = ahora();
	const diagnosticos: DiagnosticoFisica[] = [];
	const ids = idsValidos(red, diagnosticos);
	const referencia = new Set(red.nodos.filter((n) => n.referencia).map((n) => n.id));
	if (!referencia.size) diagnosticos.push({ codigo: 'SIN_REFERENCIA', mensaje: 'La red no declara un nodo de referencia' });
	/*
	 * Resolver una unica matriz con islas flotantes vuelve singular tambien la parte sana. Se
	 * separan primero las componentes alcanzables desde una referencia: la red conectada conserva
	 * sus magnitudes y los nodos flotantes se publican expresamente SIN_REFERENCIA, nunca como 0 V.
	 */
	const vecinos = new Map<string, string[]>();
	const conectar = (de: string, a: string) => {
		(vecinos.get(de) ?? vecinos.set(de, []).get(de)!).push(a);
		(vecinos.get(a) ?? vecinos.set(a, []).get(a)!).push(de);
	};
	for (const e of [...red.ramas, ...red.fuentes, ...red.cargas]) conectar(e.de, e.a);
	const conReferencia = new Set<string>(referencia);
	const cola = [...referencia];
	while (cola.length) {
		const actual = cola.shift()!;
		for (const siguiente of vecinos.get(actual) ?? []) if (!conReferencia.has(siguiente)) {
			conReferencia.add(siguiente); cola.push(siguiente);
		}
	}
	const flotantes = ids.filter((id) => !conReferencia.has(id));
	if (flotantes.length) diagnosticos.push({ codigo: 'ISLA_FLOTANTE',
		mensaje: `${flotantes.length} nodos no tienen camino a una referencia electrica`, elementos: flotantes });

	const fijas = new Map<string, Complejo>();
	for (const id of referencia) fijas.set(id, CERO);
	const ideales = red.fuentes.filter((f) => !f.zInternaOhm);
	for (let vuelta = 0; vuelta <= ideales.length; vuelta++) for (const f of ideales) {
		const va = fijas.get(f.a); const vd = fijas.get(f.de);
		const propuesta = va ? sumar(va, f.tensionV) : vd ? restar(vd, f.tensionV) : undefined;
		const id = va ? f.de : vd ? f.a : undefined;
		if (!propuesta || !id) continue;
		const anterior = fijas.get(id);
		if (anterior && magnitud(restar(anterior, propuesta)) > TOLERANCIAS_FISICA.convergenciaV) {
			diagnosticos.push({ codigo: 'FUENTES_INCOMPATIBLES', mensaje: `Fuentes ideales incompatibles en ${id}`, elementos: [f.id] });
		} else fijas.set(id, propuesta);
	}
	for (const f of ideales) if (!fijas.has(f.de) || !fijas.has(f.a)) diagnosticos.push({
		codigo: 'FUENTES_PARALELAS_NO_MODELADAS', mensaje: `La fuente ideal ${f.id} no esta referenciada de forma resoluble`, elementos: [f.id],
	});

	const variables = ids.filter((id) => conReferencia.has(id) && !fijas.has(id));
	const indice = new Map(variables.map((id, i) => [id, i]));
	const tension = new Map<string, Complejo>([...fijas].map(([id, v]) => [id, { ...v }]));
	for (const id of variables) tension.set(id, CERO);
	const maxIteraciones = opciones.maxIteraciones ?? 50;
	const tolerancia = opciones.toleranciaV ?? TOLERANCIAS_FISICA.convergenciaV;
	const damping = opciones.damping ?? 0.7;
	let iteraciones = 0;
	let convergioNumerico = variables.length === 0;
	let residuoKclA = 0;
	let ultimaG: Complejo[][] = [];
	let ultimoB: Complejo[] = [];

	for (iteraciones = 1; variables.length && iteraciones <= maxIteraciones; iteraciones++) {
		const g = Array.from({ length: variables.length }, () => Array.from({ length: variables.length }, () => ({ ...CERO })));
		const b = Array.from({ length: variables.length }, () => ({ ...CERO }));
		const estamparAdmitancia = (de: string, a: string, y: Complejo) => {
			for (const [propio, otro] of [[de, a], [a, de]] as const) {
				const i = indice.get(propio); if (i === undefined) continue;
				agregar(g[i][i], y);
				const j = indice.get(otro);
				if (j !== undefined) agregar(g[i][j], opuesto(y));
				else agregar(b[i], multiplicar(y, tension.get(otro) ?? CERO));
			}
		};
		const estamparCorriente = (de: string, a: string, iCarga: Complejo) => {
			const i = indice.get(de); const j = indice.get(a);
			if (i !== undefined) agregar(b[i], opuesto(iCarga));
			if (j !== undefined) agregar(b[j], iCarga);
		};
		for (const r of red.ramas) if (impedanciaValida(r.zOhm)) estamparAdmitancia(r.de, r.a, dividir({ re: 1, im: 0 }, r.zOhm));
		for (const f of red.fuentes) if (f.zInternaOhm && impedanciaValida(f.zInternaOhm)) {
			const y = dividir({ re: 1, im: 0 }, f.zInternaOhm);
			estamparAdmitancia(f.de, f.a, y);
			const norton = multiplicar(f.tensionV, y);
			const i = indice.get(f.de); const j = indice.get(f.a);
			if (i !== undefined) agregar(b[i], norton);
			if (j !== undefined) agregar(b[j], opuesto(norton));
		}
		for (const c of red.cargas) {
			if (c.modelo === 'CONSTANT_Z') {
				if (impedanciaValida(c.zOhm)) estamparAdmitancia(c.de, c.a, dividir({ re: 1, im: 0 }, c.zOhm));
				else diagnosticos.push({ codigo: 'CONFIGURACION_INVALIDA', mensaje: `Carga ${c.id} con impedancia nula`, elementos: [c.id] });
			} else {
				const v = restar(tension.get(c.de) ?? CERO, tension.get(c.a) ?? CERO);
				estamparCorriente(c.de, c.a, corrienteCarga(c, v));
			}
		}
		ultimaG = g; ultimoB = b;
		let solucion: Complejo[];
		try { solucion = resolverSistemaComplejo(g, b); }
		catch (e) {
			const codigo = e instanceof ErrorNumericoFisica && e.codigo === 'MATRIZ_SINGULAR' ? 'MATRIZ_SINGULAR' : 'CONFIGURACION_INVALIDA';
			diagnosticos.push({ codigo, mensaje: (e as Error).message });
			break;
		}
		let cambio = 0;
		for (let i = 0; i < variables.length; i++) {
			const anterior = tension.get(variables[i]) ?? CERO;
			const nuevo = sumar(escalar(solucion[i], damping), escalar(anterior, 1 - damping));
			cambio = Math.max(cambio, magnitud(restar(nuevo, anterior)));
			tension.set(variables[i], nuevo);
		}
		if (cambio <= tolerancia) { convergioNumerico = true; break; }
	}
	if (!convergioNumerico && variables.length && !diagnosticos.some((d) => d.codigo === 'MATRIZ_SINGULAR')) diagnosticos.push({
		codigo: 'NO_CONVERGE', mensaje: `La red no convergio en ${maxIteraciones} iteraciones`,
	});
	if (ultimaG.length) for (let i = 0; i < variables.length; i++) {
		let suma = { ...CERO };
		for (let j = 0; j < variables.length; j++) agregar(suma, multiplicar(ultimaG[i][j], tension.get(variables[j]) ?? CERO));
		residuoKclA = Math.max(residuoKclA, magnitud(restar(suma, ultimoB[i])));
	}

	const nodos = new Map<string, ResultadoNodoFisica>();
	for (const id of ids) {
		const sinReferencia = !conReferencia.has(id);
		nodos.set(id, { id, tensionV: sinReferencia ? undefined : tension.get(id),
			calidad: sinReferencia ? 'SIN_REFERENCIA' : convergioNumerico ? 'VALIDA' : 'NO_CONVERGE',
			origen: sinReferencia || !convergioNumerico ? 'NO_MODELADO' : 'CALCULADO' });
	}

	const ramas = new Map<string, ResultadoRamaFisica>();
	let potenciaPerdidasW = 0;
	for (const r of red.ramas) {
		const caidaV = restar(tension.get(r.de) ?? CERO, tension.get(r.a) ?? CERO);
		const corrienteA = impedanciaValida(r.zOhm) ? dividir(caidaV, r.zOhm) : CERO;
		const perdidaW = magnitud(corrienteA) ** 2 * Math.max(0, r.zOhm.re);
		potenciaPerdidasW += perdidaW;
		ramas.set(r.id, { id: r.id, corrienteA, caidaV, perdidaW, origen: r.origen ?? 'CALCULADO' });
	}
	const cargas = new Map<string, ResultadoCargaFisica>();
	let potenciaCargasW = 0;
	for (const c of red.cargas) {
		const referenciada = conReferencia.has(c.de) && conReferencia.has(c.a);
		const v = referenciada ? restar(tension.get(c.de) ?? CERO, tension.get(c.a) ?? CERO) : CERO;
		const i = referenciada ? corrienteCarga(c, v) : CERO;
		const s = multiplicar(v, conjugado(i));
		potenciaCargasW += s.re;
		const aparente = magnitud(s);
		cargas.set(c.id, { id: c.id, tensionV: v, corrienteA: i, potenciaVA: s,
			factorPotencia: aparente > TOLERANCIAS_FISICA.cero ? Math.max(-1, Math.min(1, s.re / aparente)) : undefined,
			origen: referenciada ? c.origen ?? 'CALCULADO' : 'NO_MODELADO' });
	}

	const corrientePasivaDesde = (id: string): Complejo => {
		let total = { ...CERO };
		for (const r of red.ramas) {
			const rr = ramas.get(r.id)!;
			if (r.de === id) agregar(total, rr.corrienteA);
			if (r.a === id) agregar(total, opuesto(rr.corrienteA));
		}
		for (const c of red.cargas) {
			const cr = cargas.get(c.id)!;
			if (c.de === id) agregar(total, cr.corrienteA);
			if (c.a === id) agregar(total, opuesto(cr.corrienteA));
		}
		return total;
	};
	const fuentes = new Map<string, ResultadoFuenteFisica>();
	let potenciaFuentesW = 0;
	for (const f of red.fuentes) {
		const terminal = restar(tension.get(f.de) ?? CERO, tension.get(f.a) ?? CERO);
		const i = f.zInternaOhm && impedanciaValida(f.zInternaOhm)
			? dividir(restar(f.tensionV, terminal), f.zInternaOhm) : corrientePasivaDesde(f.de);
		const s = multiplicar(terminal, conjugado(i));
		potenciaFuentesW += s.re;
		fuentes.set(f.id, { id: f.id, tensionTerminalV: terminal, corrienteEntregadaA: i,
			potenciaEntregadaVA: s, origenImpedancia: f.origenImpedancia });
	}
	const errorBalanceW = potenciaFuentesW - potenciaCargasW - potenciaPerdidasW;
	return {
		nodos, ramas, cargas, fuentes, diagnosticos, potenciaCargasW, potenciaPerdidasW, potenciaFuentesW,
		metricas: { nodos: ids.length, ramas: red.ramas.length, iteraciones: Math.max(0, Math.min(iteraciones, maxIteraciones)),
			convergio: convergioNumerico && flotantes.length === 0, tiempoMs: ahora() - inicio, residuoKclA, errorBalanceW },
	};
}

export function fuenteTrifasicaBalanceada(datos: {
	id: string; l1: string; l2: string; l3: string; n: string; tensionLineaV: number; frecuenciaHz: number;
	zInternaOhm?: Complejo; origenImpedancia?: FuenteRedFisica['origenImpedancia'];
}): FuenteRedFisica[] {
	const faseNeutro = datos.tensionLineaV / Math.sqrt(3);
	return ([['L1', datos.l1, 0], ['L2', datos.l2, -120], ['L3', datos.l3, 120]] as const).map(([fase, de, grados]) => ({
		id: `${datos.id}:${fase}`, de, a: datos.n, tensionV: polar(faseNeutro, grados * Math.PI / 180),
		zInternaOhm: datos.zInternaOhm, origenImpedancia: datos.origenImpedancia ?? (datos.zInternaOhm ? 'CONFIGURADO' : 'NO_MODELADO'),
		frecuenciaHz: datos.frecuenciaHz,
	}));
}
