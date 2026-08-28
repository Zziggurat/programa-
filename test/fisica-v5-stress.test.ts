import assert from 'node:assert/strict';
import test from 'node:test';
import { complejo, magnitud } from '../src/fisica/complejos.js';
import { resolverRedFisica } from '../src/fisica/solver.js';
import type { RedFisica } from '../src/fisica/tipos.js';

test('V5 stress focal: cientos de ramas convergen con KCL y balance acotados', () => {
	const cantidadNodos = 80;
	const red: RedFisica = {
		nodos: [{ id: 'N', referencia: true }, ...Array.from({ length: cantidadNodos }, (_, i) => ({ id: `L${i}` }))],
		fuentes: [{ id: 'red', de: 'L0', a: 'N', tensionV: complejo(230), zInternaOhm: complejo(0.02, 0.01),
			origenImpedancia: 'CONFIGURADO' }],
		ramas: [], cargas: [],
	};
	for (let i = 1; i < cantidadNodos; i++) for (let paralelo = 0; paralelo < 3; paralelo++) red.ramas.push({
		id: `w-${i}-${paralelo}`, de: `L${i - 1}`, a: `L${i}`, zOhm: complejo(0.02 + paralelo * 0.005, 0.002),
		origen: 'CONFIGURADO',
	});
	for (let i = 4; i < cantidadNodos; i += 5) red.cargas.push({
		id: `z-${i}`, de: `L${i}`, a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(120 + i), origen: 'CONFIGURADO',
	});
	const r = resolverRedFisica(red);
	assert.equal(red.ramas.length, 237);
	assert.equal(r.metricas.nodos, 81);
	assert.equal(r.metricas.convergio, true);
	assert.ok(r.metricas.iteraciones < 50);
	assert.ok(r.metricas.residuoKclA < 1e-3, `residuo KCL ${r.metricas.residuoKclA}`);
	assert.ok(Math.abs(r.metricas.errorBalanceW) < 0.5, `balance ${r.metricas.errorBalanceW} W`);
	assert.ok(r.metricas.tiempoMs < 5_000, `solver ${r.metricas.tiempoMs} ms`);
});

test('V5 invariante: dos conductores en paralelo reducen Req y comparten corriente', () => {
	const construir = (paralelos: number): RedFisica => ({
		nodos: [{ id: 'N', referencia: true }, { id: 'L' }, { id: 'X' }],
		fuentes: [{ id: 'red', de: 'L', a: 'N', tensionV: complejo(24), origenImpedancia: 'NO_MODELADO' }],
		ramas: Array.from({ length: paralelos }, (_, i) => ({ id: `w${i}`, de: 'L', a: 'X', zOhm: complejo(1) })),
		cargas: [{ id: 'z', de: 'X', a: 'N', modelo: 'CONSTANT_Z', zOhm: complejo(11) }],
	});
	const uno = resolverRedFisica(construir(1)); const dos = resolverRedFisica(construir(2));
	const iUno = magnitud(uno.ramas.get('w0')!.corrienteA);
	const iDosTotal = magnitud(dos.ramas.get('w0')!.corrienteA) + magnitud(dos.ramas.get('w1')!.corrienteA);
	assert.ok(iDosTotal > iUno);
	assert.ok(Math.abs(magnitud(dos.ramas.get('w0')!.corrienteA) - magnitud(dos.ramas.get('w1')!.corrienteA)) < 1e-9);
});
