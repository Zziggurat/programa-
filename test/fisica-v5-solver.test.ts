import assert from 'node:assert/strict';
import test from 'node:test';
import { complejo, faseDeg, magnitud } from '../src/fisica/complejos.js';
import { fuenteTrifasicaBalanceada, resolverRedFisica } from '../src/fisica/solver.js';
import type { RedFisica } from '../src/fisica/tipos.js';

const cerca = (actual: number, esperado: number, tol = 1e-5) =>
	assert.ok(Math.abs(actual - esperado) <= tol * Math.max(1, Math.abs(esperado)), `${actual} != ${esperado}`);

test('V5 solver: carga resistiva 230 V / 23 ohm produce 10 A y 2300 W', () => {
	const red: RedFisica = {
		nodos: [{ id: 'N', referencia: true }, { id: 'L' }], ramas: [],
		fuentes: [{ id: 'red', de: 'L', a: 'N', tensionV: complejo(230), origenImpedancia: 'NO_MODELADO' }],
		cargas: [{ id: 'r', de: 'L', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(23), origen: 'CONFIGURADO' }],
	};
	const r = resolverRedFisica(red);
	assert.equal(r.metricas.convergio, true);
	cerca(magnitud(r.cargas.get('r')!.corrienteA), 10);
	cerca(r.cargas.get('r')!.potenciaVA.re, 2300);
	cerca(r.potenciaFuentesW, 2300);
	cerca(r.metricas.errorBalanceW, 0);
});

test('V5 solver: impedancia de fuente y cable generan caida y perdidas coherentes', () => {
	const red: RedFisica = {
		nodos: [{ id: 'N', referencia: true }, { id: 'L' }, { id: 'CARGA' }],
		fuentes: [{ id: 'red', de: 'L', a: 'N', tensionV: complejo(230), zInternaOhm: complejo(1), origenImpedancia: 'CONFIGURADO' }],
		ramas: [{ id: 'cable', de: 'L', a: 'CARGA', zOhm: complejo(1), origen: 'CONFIGURADO' }],
		cargas: [{ id: 'r', de: 'CARGA', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(21) }],
	};
	const r = resolverRedFisica(red);
	// Serie total 23 ohm: 10 A, 10 V en cable, 100 W de perdida en cable.
	cerca(magnitud(r.ramas.get('cable')!.corrienteA), 10);
	cerca(magnitud(r.ramas.get('cable')!.caidaV), 10);
	cerca(r.ramas.get('cable')!.perdidaW, 100);
	cerca(magnitud(r.nodos.get('CARGA')!.tensionV!), 210);
	cerca(r.metricas.errorBalanceW, 0, 1e-4);
});

test('V5 solver: fases L1/L2/L3 tienen Vfase=Vlinea/sqrt(3) y 120 grados', () => {
	const fuentes = fuenteTrifasicaBalanceada({
		id: 'red', l1: 'L1', l2: 'L2', l3: 'L3', n: 'N', tensionLineaV: 400, frecuenciaHz: 60,
	});
	const red: RedFisica = {
		nodos: [{ id: 'N', referencia: true }, { id: 'L1' }, { id: 'L2' }, { id: 'L3' }], fuentes,
		ramas: [], cargas: [
			{ id: 'z1', de: 'L1', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(23) },
			{ id: 'z2', de: 'L2', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(23) },
			{ id: 'z3', de: 'L3', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(23) },
		],
	};
	const r = resolverRedFisica(red);
	for (const fase of ['L1', 'L2', 'L3']) cerca(magnitud(r.nodos.get(fase)!.tensionV!), 400 / Math.sqrt(3));
	cerca(faseDeg(r.nodos.get('L1')!.tensionV!), 0);
	cerca(faseDeg(r.nodos.get('L2')!.tensionV!), -120);
	cerca(faseDeg(r.nodos.get('L3')!.tensionV!), 120);
	assert.equal(fuentes[0].frecuenciaHz, 60);
});

test('V5 solver: carga PQ itera con limite y conserva balance', () => {
	const r = resolverRedFisica({
		nodos: [{ id: 'N', referencia: true }, { id: 'L' }], ramas: [],
		fuentes: [{ id: 'red', de: 'L', a: 'N', tensionV: complejo(230), zInternaOhm: complejo(0.2, 0.05), origenImpedancia: 'CONFIGURADO' }],
		cargas: [{ id: 'pq', de: 'L', a: 'N', modelo: 'CONSTANT_PQ', potenciaVA: complejo(2000, 600), tensionNominalV: 230 }],
	});
	assert.equal(r.metricas.convergio, true);
	assert.ok(r.metricas.iteraciones < 50);
	cerca(r.cargas.get('pq')!.potenciaVA.re, 2000, 1e-3);
	cerca(r.cargas.get('pq')!.potenciaVA.im, 600, 1e-3);
	assert.ok(Math.abs(r.metricas.errorBalanceW) < 0.1);
});

test('V5 solver: una isla sin referencia se degrada sin NaN ni bloqueo', () => {
	const r = resolverRedFisica({
		nodos: [{ id: 'A' }, { id: 'B' }], fuentes: [],
		ramas: [{ id: 'z', de: 'A', a: 'B', zOhm: complejo(10) }], cargas: [],
	});
	assert.equal(r.metricas.convergio, false);
	assert.ok(r.diagnosticos.some((d) => d.codigo === 'SIN_REFERENCIA'));
	assert.ok(r.diagnosticos.some((d) => d.codigo === 'ISLA_FLOTANTE'));
	assert.equal(r.nodos.get('A')!.calidad, 'SIN_REFERENCIA');
	assert.equal(r.nodos.get('A')!.tensionV, undefined);
	for (const rama of r.ramas.values()) assert.ok(Number.isFinite(rama.corrienteA.re));
});

test('V5 solver: una isla flotante no destruye las magnitudes de la isla referenciada', () => {
	const r = resolverRedFisica({
		nodos: [{ id: 'N', referencia: true }, { id: 'L' }, { id: 'A' }, { id: 'B' }],
		fuentes: [{ id: 'red', de: 'L', a: 'N', tensionV: complejo(24), origenImpedancia: 'NO_MODELADO' }],
		ramas: [{ id: 'flotante', de: 'A', a: 'B', zOhm: complejo(10) }],
		cargas: [{ id: 'carga', de: 'L', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(12) }],
	});
	cerca(magnitud(r.nodos.get('L')!.tensionV!), 24);
	cerca(magnitud(r.cargas.get('carga')!.corrienteA), 2);
	assert.equal(r.nodos.get('A')!.calidad, 'SIN_REFERENCIA');
	assert.equal(r.ramas.get('flotante')!.corrienteA.re, 0);
});

test('V5 solver: invertir arrays no cambia resultados', () => {
	const base: RedFisica = {
		nodos: [{ id: 'N', referencia: true }, { id: 'A' }, { id: 'B' }],
		fuentes: [{ id: 'f', de: 'A', a: 'N', tensionV: complejo(24), zInternaOhm: complejo(0.1), origenImpedancia: 'CONFIGURADO' }],
		ramas: [{ id: 'w', de: 'A', a: 'B', zOhm: complejo(0.2) }],
		cargas: [{ id: 'z', de: 'B', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(12) }],
	};
	const a = resolverRedFisica(base);
	const b = resolverRedFisica({ nodos: [...base.nodos].reverse(), ramas: [...base.ramas].reverse(),
		fuentes: [...base.fuentes].reverse(), cargas: [...base.cargas].reverse() });
	for (const id of ['N', 'A', 'B']) cerca(magnitud(a.nodos.get(id)!.tensionV!), magnitud(b.nodos.get(id)!.tensionV!));
});
