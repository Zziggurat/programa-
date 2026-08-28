import assert from 'node:assert/strict';
import test from 'node:test';
import { resolverLazo420, resolverSenal010 } from '../src/fisica/analogicas.js';

const cerca = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));

test('V5 4-20 mA: 24 V, burden 250 ohm y cable viable conservan 20 mA', () => {
	const r = resolverLazo420({ corrienteDemandadaMA: 20, tensionDisponibleV: 24,
		tensionMinimaTransmisorV: 12, resistenciaCableOhm: 20, burdenOhm: 250 });
	cerca(r.corrienteMA!, 20);
	cerca(r.tensionBurdenV, 5);
	cerca(r.caidaCableV, 0.4);
	cerca(r.tensionTransmisorV!, 18.6);
	assert.equal(r.calidad, 'NORMAL');
});

test('V5 4-20 mA: burden excesivo limita corriente y degrada calidad sin romper live zero', () => {
	const r = resolverLazo420({ corrienteDemandadaMA: 20, tensionDisponibleV: 24,
		tensionMinimaTransmisorV: 12, resistenciaCableOhm: 100, burdenOhm: 1000 });
	assert.ok(r.corrienteMA! < 20);
	assert.equal(r.calidad, 'COMPLIANCE_INSUFICIENTE');
	const liveZero = resolverLazo420({ corrienteDemandadaMA: 4, tensionDisponibleV: 24,
		tensionMinimaTransmisorV: 12, resistenciaCableOhm: 100, burdenOhm: 250 });
	cerca(liveZero.corrienteMA!, 4);
});

test('V5 0-10 V: impedancia de entrada carga una salida no ideal', () => {
	const sano = resolverSenal010({ tensionDemandadaV: 10, resistenciaSalidaOhm: 100, resistenciaEntradaOhm: 100_000 });
	assert.equal(sano.calidad, 'NORMAL');
	assert.ok(sano.tensionV! > 9.9);
	const cargado = resolverSenal010({ tensionDemandadaV: 10, resistenciaSalidaOhm: 1000, resistenciaEntradaOhm: 1000 });
	cerca(cargado.tensionV!, 5);
	assert.equal(cargado.calidad, 'CARGA_EXCESIVA');
});
