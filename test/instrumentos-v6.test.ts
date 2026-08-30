import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5, fixtureMotorTrifasicoV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { medirPinza, medirPotenciaCarga, medirResistenciaDirecta, medirTension, medirTrifasico } from '../src/fisica/instrumentos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';

function fixtureDc(): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Instrumento DC', hojas: [],
		dispositivos: [
			{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+', tipo: 'L' }, { id: '0V', tipo: 'N' }],
				fisica: { version: 1, fuente: { sistema: 'DC', tensionNominalV: 24, referencia: '0V',
					fases: [{ borne: '+', fase: 'L' }], rOhm: 0.01 } } },
			{ id: 'r', tipo: 'resistencia', bornes: [{ id: '+', tipo: 'L' }, { id: '0V', tipo: 'N' }],
				fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['+', '0V'], rOhm: 24 } } },
		],
		conductores: [
			{ id: 'wp', de: { dispositivoId: 'ps', borneId: '+' }, a: { dispositivoId: 'r', borneId: '+' },
				seccion: 1.5, fisica: { longitudManualM: 1 } },
			{ id: 'wn', de: { dispositivoId: 'r', borneId: '0V' }, a: { dispositivoId: 'ps', borneId: '0V' },
				seccion: 1.5, fisica: { longitudManualM: 1 } },
		],
	};
}

test('V6 instrumento: multimetro VAC y VDC leen los nodos resueltos y respetan el modo', () => {
	const ac = simularFisicaProyecto(fixtureCaidaTensionV5());
	const vac = medirTension(ac, 'red::L', 'red::N', 'VAC');
	assert.equal(vac.proveniencia, 'CALCULADA');
	assert.ok(vac.valor! > 225 && vac.valor! < 231);
	assert.equal(medirTension(ac, 'red::L', 'red::N', 'VDC').proveniencia, 'NO_DISPONIBLE');

	const dc = simularFisicaProyecto(fixtureDc());
	const vdc = medirTension(dc, 'ps::+', 'ps::0V', 'VDC');
	assert.equal(vdc.proveniencia, 'CALCULADA');
	assert.ok(vdc.valor! > 23.9 && vdc.valor! <= 24);
	assert.equal(medirTension(dc, 'ps::+', 'ps::0V', 'VAC').proveniencia, 'NO_DISPONIBLE');
});

test('V6 instrumento: ohmios se bloquea energizado y solo resuelve rama directa desenergizada', () => {
	const energizada = simularFisicaProyecto(fixtureDc());
	const bloqueada = medirResistenciaDirecta(energizada, 'ps::+', 'r::+');
	assert.equal(bloqueada.proveniencia, 'NO_DISPONIBLE');
	assert.match(bloqueada.detalle!, /BLOQUEADA/);

	const pasivo = fixtureDc();
	delete pasivo.dispositivos[0].fisica;
	const sinTension = simularFisicaProyecto(pasivo);
	const resistencia = medirResistenciaDirecta(sinTension, 'ps::+', 'r::+');
	assert.notEqual(resistencia.proveniencia, 'NO_DISPONIBLE');
	assert.ok(resistencia.valor! > 0 && resistencia.valor! < 0.1);
	assert.equal(medirResistenciaDirecta(sinTension, 'ps::+', 'ps::0V').proveniencia, 'NO_DISPONIBLE');
});

test('V6 instrumento: pinza y analizador P/Q/S/PF proyectan el mismo resultado fisico', () => {
	const fisica = simularFisicaProyecto(fixtureCaidaTensionV5());
	const pinza = medirPinza(fisica, 'w-fase-carga');
	const rama = fisica.red.ramas.get('conductor:w-fase-carga')!;
	assert.ok(Math.abs(pinza.valor! - Math.hypot(rama.corrienteA.re, rama.corrienteA.im)) < 1e-9);
	assert.match(pinza.sentido!, /q1::2.*r1::L/);
	assert.ok(Number.isFinite(pinza.faseDeg));

	const potencia = medirPotenciaCarga(fisica, 'carga:r1:0')!;
	const carga = fisica.red.cargas.get('carga:r1:0')!;
	assert.equal(potencia.p.valor, carga.potenciaVA.re);
	assert.equal(potencia.q.valor, carga.potenciaVA.im);
	assert.equal(potencia.s.valor, Math.hypot(carga.potenciaVA.re, carga.potenciaVA.im));
	assert.equal(potencia.pf.valor, carga.factorPotencia);
});

test('V6 instrumento: panel trifasico deriva lineas, fases, neutro y Fortescue del resultado', () => {
	const fisica = simularFisicaProyecto(fixtureMotorTrifasicoV5());
	const tres = medirTrifasico(fisica, 'red')!;
	assert.ok(tres.v12.valor! > 399 && tres.v12.valor! < 401);
	assert.ok(tres.v23.valor! > 399 && tres.v23.valor! < 401);
	assert.ok(tres.v31.valor! > 399 && tres.v31.valor! < 401);
	assert.ok(tres.secuenciaPositivaV.valor! > 229 && tres.secuenciaPositivaV.valor! < 231);
	assert.ok(tres.secuenciaNegativaV.valor! < 1e-6);
	assert.ok(tres.secuenciaCeroV.valor! < 1e-6);
	assert.equal(tres.in.unidad, 'A');
	assert.equal(tres.desequilibrioCorriente.detalle, 'MAX_DESVIACION_MEDIA');
});
