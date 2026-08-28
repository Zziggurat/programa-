import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proyecto } from '../src/modelo/tipos.js';
import { actualizarProteccionesRuntime, memoriaVacia, simular, type EstadoTablero } from '../src/motores/simulacion.js';

function fixture(): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Fixture V5 — caída de tensión', hojas: [],
		dispositivos: [
			{ id: 'red', tipo: 'otro', descripcion: 'Fuente V5', tensionNominal: 230, bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' },
			], fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, frecuenciaHz: 50,
				referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.05, xOhm: 0 } } },
			{ id: 'q1', tipo: 'disyuntor', corrienteNominal: 16, curvaDisparo: 'C', bornes: [
				{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' },
			], fisica: { version: 1, proteccion: { inA: 16, curva: 'C' } } },
			{ id: 'r1', tipo: 'resistencia', tensionNominal: 230, bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' },
			], fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } } },
		],
		conductores: [
			{ id: 'w1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'q1', borneId: '1' }, seccion: 2.5,
				fisica: { material: 'COBRE', longitudManualM: 20 } },
			{ id: 'w2', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'r1', borneId: 'L' }, seccion: 2.5,
				fisica: { material: 'COBRE', longitudManualM: 20 } },
			{ id: 'w3', de: { dispositivoId: 'red', borneId: 'N' }, a: { dispositivoId: 'r1', borneId: 'N' }, seccion: 2.5,
				fisica: { material: 'COBRE', longitudManualM: 20 } },
		],
	};
}

test('V5 integrado: la topologia funcional alimenta el mismo solver cuantitativo', () => {
	const r = simular(fixture());
	assert.equal(r.fisica.activo, true);
	assert.equal(r.fisica.red.metricas.convergio, true);
	const carga = r.fisica.red.cargas.get('carga:r1:0')!;
	assert.ok(carga.potenciaVA.re > 2200 && carga.potenciaVA.re < 2300);
	assert.ok(r.fisica.conductores.get('w2')!.corrienteA > 9);
	assert.ok(r.fisica.conductores.get('w2')!.caidaV > 0);
	assert.ok(r.fisica.red.potenciaPerdidasW > 0);
	assert.ok(Math.abs(r.fisica.red.metricas.errorBalanceW) < 0.1);
	assert.equal(r.fisica.protecciones.get('q1')!.evaluacion.region, 'NORMAL');
});

test('V5 integrado: una falla L-N usa el camino real y dispara la proteccion sin doble tiempo', () => {
	const p = fixture();
	const estado: EstadoTablero = { r1: { fallasFisicas: [{ id: 'cc-r1', tipo: 'L_N', nodoA: 'r1::L', nodoB: 'r1::N' }] } };
	const memoria = memoriaVacia();
	const r = simular(p, estado, undefined, { ahora: 1000, memoria });
	const falla = r.fisica.fallas[0];
	// Tres tramos de 20 m limitan deliberadamente la Icc a unos cientos de amperios.
	assert.ok(falla.iccA && Math.hypot(falla.iccA.re, falla.iccA.im) > 100);
	assert.equal(r.fisica.protecciones.get('q1')!.evaluacion.region, 'INSTANTANEA');
	const paso = actualizarProteccionesRuntime(p, estado, r, 1000, memoria);
	assert.equal(paso.estado.q1.disparado, true);
	assert.equal(paso.eventos[0].causa, 'cortocircuito');
	const abierto = simular(p, paso.estado, r.activos, { ahora: 1000, memoria });
	assert.equal(abierto.fisica.protecciones.get('q1')!.corrienteA, 0);
});

test('V5 integrado: un proyecto V4 sin perfiles fisicos no paga solver ni cambia resultados', () => {
	const p = fixture();
	for (const d of p.dispositivos) delete d.fisica;
	for (const c of p.conductores) delete c.fisica;
	const r = simular(p);
	assert.equal(r.fisica.activo, false);
	assert.equal(r.fisica.red.metricas.iteraciones, 0);
});
