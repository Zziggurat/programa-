/** Regresiones rápidas de los vertical slices visibles de Instrumentación V3. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixtureInstrumentacionV3, fixtureReferenciaVfdV3 } from '../ejemplo/fixtures-simulacion-v3.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { memoriaVacia, type EstadoTablero, simular } from '../src/motores/simulacion.js';

const redondear = (valor: number | undefined): number | undefined =>
	valor === undefined ? undefined : Math.round(valor * 1000) / 1000;

test('fixture V3: 50 °C recorren físicamente 12 mA → AI 50 °C → AO 6 V → válvula 60 %', () => {
	const p = fixtureInstrumentacionV3();
	const memoria = memoriaVacia();
	const estado: EstadoTablero = { tt1: { valor: 50 } };
	const inicio = simular(p, estado, undefined, { ahora: 0, memoria });
	const ai = inicio.entradasAnalogicas.find((x) => x.borne === 'AI1')!;
	assert.deepEqual(
		{ mA: ai.senal.valorElectrico, calidad: ai.senal.calidad, celsius: ai.valorIngenieria },
		{ mA: 12, calidad: 'normal', celsius: 50 },
	);
	assert.deepEqual(
		{ valor: inicio.salidasAnalogicas.get('plc1::AO1')?.valor, unidad: inicio.salidasAnalogicas.get('plc1::AO1')?.unidad },
		{ valor: 6, unidad: 'V' },
	);
	assert.equal(inicio.actuadores[0].posicionObjetivo, 60);
	assert.equal(inicio.actuadores[0].posicionActual, 0);

	const enMovimiento = simular(p, estado, inicio.activos, { ahora: 3000, memoria });
	assert.equal(enMovimiento.actuadores[0].estado, 'abriendo');
	assert.equal(enMovimiento.actuadores[0].posicionActual, 30);
	assert.equal(enMovimiento.actuadores[0].feedback?.valorElectrico, 8.8);
	// El feedback es una fuente cableada independiente y aparece en AI2 en el ciclo estable siguiente.
	const feedback = simular(p, estado, enMovimiento.activos, { ahora: 3000, memoria })
		.entradasAnalogicas.find((x) => x.borne === 'AI2')!;
	assert.equal(feedback.senal.calidad, 'normal');
	assert.equal(redondear(feedback.valorIngenieria), 30);
});

test('fixture V3: los extremos 0/25/50/75/100 conservan unidades y ley de control', () => {
	const p = fixtureInstrumentacionV3();
	for (const valor of [0, 25, 50, 75, 100]) {
		const r = simular(p, { tt1: { valor } });
		const ai = r.entradasAnalogicas.find((x) => x.borne === 'AI1')!;
		assert.equal(ai.senal.valorElectrico, 4 + 0.16 * valor);
		assert.equal(ai.valorIngenieria, valor);
		assert.equal(ai.senal.unidadElectrica, 'mA');
	}
});

test('fixture V3: abrir el lazo elimina el valor de ingeniería y manda la válvula a fail-safe', () => {
	const p = fixtureInstrumentacionV3();
	const memoria = memoriaVacia();
	const normal: EstadoTablero = { tt1: { valor: 50 } };
	simular(p, normal, undefined, { ahora: 0, memoria });
	simular(p, normal, undefined, { ahora: 5000, memoria });
	const abierto: EstadoTablero = { tt1: { valor: 50, fallos: ['circuito-analogico-abierto'] } };
	const r = simular(p, abierto, undefined, { ahora: 6000, memoria });
	const ai = r.entradasAnalogicas.find((x) => x.borne === 'AI1')!;
	assert.equal(ai.senal.calidad, 'circuito-abierto');
	assert.equal(ai.valorIngenieria, undefined);
	assert.equal(r.controladores[0].sondas.AI1, undefined);
	assert.equal(r.actuadores[0].posicionObjetivo, 0);
	assert.equal(r.actuadores[0].estado, 'cerrando');
});

test('fixture VFD V3: 4/12/20 mA cableados dan 0/25/50 Hz y velocidad coherente', () => {
	for (const [referencia, mA, hz, velocidad] of [
		[0, 4, 0, 0], [50, 12, 25, 50], [100, 20, 50, 100],
	] as const) {
		const r = simular(fixtureReferenciaVfdV3(), { ref1: { valor: referencia }, 's-run': { posicion: 1 } });
		const vfd = r.variadores[0];
		assert.equal(vfd.referenciaElectrica?.valorElectrico, mA);
		assert.equal(vfd.calidadReferencia, 'normal');
		assert.equal(vfd.frecuenciaHz, hz);
		assert.equal(r.motores[0].velocidadPorcentaje, velocidad);
		assert.equal(r.motores[0].rpmEstimada, hz * 30);
	}
});

test('fixture VFD V3: la pérdida física de referencia entra en FAULT', () => {
	const p = fixtureReferenciaVfdV3();
	p.conductores = p.conductores.filter((c) => c.id !== 'w-ref-ai');
	const r = simular(p, { ref1: { valor: 50 }, 's-run': { posicion: 1 } });
	assert.equal(r.variadores[0].calidadReferencia, 'circuito-abierto');
	assert.equal(r.variadores[0].estado, 'falla');
	assert.equal(r.variadores[0].motivoFalla, 'perdida-referencia');
	assert.equal(r.motores[0].estado, 'detenido');
});

test('fixtures V3 persisten perfiles y recomputan el mismo resultado tras guardar/cargar', () => {
	for (const [crear, estado] of [
		[fixtureInstrumentacionV3, { tt1: { valor: 50 } }],
		[fixtureReferenciaVfdV3, { ref1: { valor: 50 }, 's-run': { posicion: 1 } }],
	] as const) {
		const original = crear();
		const cargado = cargarProyecto(JSON.stringify(original)).proyecto;
		const perfilesJson = (proyecto: Proyecto) => JSON.parse(JSON.stringify(
			proyecto.dispositivos.map((d) => [d.id, d.comportamiento]),
		));
		assert.deepEqual(perfilesJson(cargado), perfilesJson(original));
		assert.deepEqual(firma(cargado, estado), firma(original, estado));
		assert.equal(JSON.stringify(cargado).includes('"actuadores"'), false, 'se persistió estado dinámico');
	}
});

test('fixtures V3 son independientes del orden de dispositivos y conductores', () => {
	for (const [crear, estado] of [
		[fixtureInstrumentacionV3, { tt1: { valor: 50 } }],
		[fixtureReferenciaVfdV3, { ref1: { valor: 50 }, 's-run': { posicion: 1 } }],
	] as const) {
		const p = crear();
		const esperado = firma(p, estado);
		p.dispositivos.reverse();
		p.conductores.reverse();
		assert.deepEqual(firma(p, estado), esperado);
	}
});

function firma(p: Proyecto, estado: EstadoTablero) {
	const r = simular(p, estado);
	return {
		sensores: r.sensoresAnalogicos.map((x) => [x.designacion, redondear(x.senal.valorElectrico), x.senal.calidad]).sort(),
		entradas: r.entradasAnalogicas.map((x) => [x.designacion, x.borne, redondear(x.valorIngenieria), x.senal.calidad]).sort(),
		salidas: [...r.salidasAnalogicas].map(([k, x]) => [k, redondear(x.valor), x.unidad]).sort(),
		actuadores: r.actuadores.map((x) => [x.designacion, x.posicionObjetivo, x.posicionActual, x.calidadMando]).sort(),
		variadores: r.variadores.map((x) => [x.designacion, x.estado, x.frecuenciaHz, x.calidadReferencia]).sort(),
		motores: r.motores.map((x) => [x.designacion, x.estado, x.velocidadPorcentaje, x.rpmEstimada]).sort(),
	};
}
