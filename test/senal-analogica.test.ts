import test from 'node:test';
import assert from 'node:assert/strict';
import {
	RANGO_0_10_V, RANGO_4_20_MA, escalarSenalAIngenieria, normalizarAnalogico,
	senalDesdeVariableFisica, senalInvalida, valorElectricoDesdeNormalizado,
} from '../src/modelo/senal-analogica.js';

const temperatura = { magnitud: 'temperatura', unidad: '°C', minimo: 0, maximo: 100 };

test('escalado común 0–10 V conserva voltios, normalizado y unidad física', () => {
	const senal = senalDesdeVariableFisica(50, temperatura, RANGO_0_10_V);
	assert.deepEqual(senal, {
		tipo: 'tension', unidadElectrica: 'V', valorElectrico: 5, valorNormalizado: 0.5,
		calidad: 'normal', origen: 'calculado', valorFisico: 50, magnitud: 'temperatura', unidad: '°C',
	});
	assert.equal(escalarSenalAIngenieria(senal, RANGO_0_10_V, temperatura).valor, 50);
});

test('4–20 mA conserva live zero: 4/12/20 mA son 0/50/100 %', () => {
	assert.equal(valorElectricoDesdeNormalizado(0, RANGO_4_20_MA).valor, 4);
	assert.equal(valorElectricoDesdeNormalizado(0.5, RANGO_4_20_MA).valor, 12);
	assert.equal(valorElectricoDesdeNormalizado(1, RANGO_4_20_MA).valor, 20);
	assert.equal(normalizarAnalogico(4, RANGO_4_20_MA).valor, 0);
	assert.equal(normalizarAnalogico(12, RANGO_4_20_MA).valor, 0.5);
	assert.equal(normalizarAnalogico(20, RANGO_4_20_MA).valor, 1);
	assert.equal(senalDesdeVariableFisica(50, temperatura, RANGO_4_20_MA).valorElectrico, 12);
});

test('AO 60 % produce 6 V o 13,6 mA sin confundir unidades', () => {
	assert.equal(valorElectricoDesdeNormalizado(0.6, RANGO_0_10_V).valor, 6);
	assert.ok(Math.abs(valorElectricoDesdeNormalizado(0.6, RANGO_4_20_MA).valor! - 13.6) < 1e-9);
});

test('fuera de rango conserva el bruto y clamp es una decisión explícita', () => {
	const sinClamp = normalizarAnalogico(22, RANGO_4_20_MA);
	assert.equal(sinClamp.normalizado, 1.125);
	assert.equal(sinClamp.valor, 1.125);
	assert.equal(sinClamp.calidad, 'fuera-de-rango');
	const conClamp = normalizarAnalogico(22, RANGO_4_20_MA, { clamp: true });
	assert.equal(conClamp.valor, 1);
	assert.equal(conClamp.clamped, true);
});

test('rangos invertidos son válidos y división por cero resulta inválida', () => {
	const invertido = { ...RANGO_0_10_V, minimo: 10, maximo: 0 };
	assert.equal(normalizarAnalogico(7.5, invertido).valor, 0.25);
	assert.equal(normalizarAnalogico(5, { ...RANGO_0_10_V, maximo: 0 }).calidad, 'senal-invalida');
});

test('la calidad eléctrica impide fabricar un valor de ingeniería', () => {
	for (const calidad of ['sin-alimentacion', 'circuito-abierto', 'fallo-sensor', 'senal-invalida'] as const) {
		const senal = senalInvalida(RANGO_4_20_MA, calidad, 'inyectado');
		const escalada = escalarSenalAIngenieria(senal, RANGO_4_20_MA, temperatura);
		assert.equal(escalada.valor, undefined);
		assert.equal(escalada.calidad, calidad);
	}
});

test('umbrales diagnósticos pertenecen al perfil y no presuponen una norma', () => {
	const rango = { ...RANGO_4_20_MA, diagnostico: { minimoValido: 3.6, maximoValido: 21 } };
	assert.equal(normalizarAnalogico(3.5, rango).calidad, 'under-range');
	assert.equal(normalizarAnalogico(21.5, rango).calidad, 'over-range');
});
