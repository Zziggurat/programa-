/** Regresiones rápidas de los dos vertical slices visibles de Simulación Industrial V2. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixtureFallosIndustriales, fixtureVariadorV2 } from '../ejemplo/fixtures-simulacion-v2.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { cambiarFalloRuntime } from '../src/motores/fallos-runtime.js';
import {
	actualizarProteccionesRuntime, type EstadoTablero, memoriaVacia, type ResultadoSimulacion, simular,
} from '../src/motores/simulacion.js';

const activo = (r: ResultadoSimulacion, id: string) => r.activos.has(id);

test('fixture industrial V2: el térmico tira KM por 95-96, señaliza por 97-98 y no rearranca', () => {
	const p = fixtureFallosIndustriales();
	const memoria = memoriaVacia();
	let estado: EstadoTablero = {};
	let r = simular(p, estado, undefined, { ahora: 0, memoria });
	assert.equal(r.motores[0].estado, 'detenido');
	assert.equal(activo(r, 'km1'), false);
	assert.equal(activo(r, 'h-marcha'), false);
	assert.equal(activo(r, 'h-fallo'), false);

	// START momentáneo y enclavamiento exclusivamente por el auxiliar 13-14.
	estado = { s1: { activo: true } };
	r = simular(p, estado, r.activos, { ahora: 0, memoria });
	assert.equal(activo(r, 'km1'), true);
	assert.equal(activo(r, 'h-marcha'), true);
	estado = { s1: { activo: false } };
	r = simular(p, estado, r.activos, { ahora: 1000, memoria });
	assert.equal(activo(r, 'km1'), true, 'soltar START perdió el enclavamiento cableado');
	assert.equal(r.motores[0].estado, 'marcha');

	// La sobrecarga pertenece al motor; la corriente estimada viaja por el circuito hasta F2.
	estado = { ...estado, m1: cambiarFalloRuntime({}, 'sobrecarga', true) };
	r = simular(p, estado, r.activos, { ahora: 1100, memoria });
	const propuesta = r.disparos.find((x) => x.dispositivoId === 'f2');
	assert.ok(propuesta?.motivo === 'sobrecarga' && propuesta.segundos > 0,
		'la sobrecarga del motor no llegó al térmico por el camino eléctrico');
	actualizarProteccionesRuntime(p, estado, r, 1100, memoria);
	const mitad = actualizarProteccionesRuntime(p, estado, r, 1100 + propuesta.segundos * 500, memoria);
	assert.equal(mitad.cambio, false);
	assert.ok((memoria.protecciones?.f2.cargaTermica ?? 0) > 0.49,
		'el térmico no acumuló temperatura antes de disparar');
	const disparo = actualizarProteccionesRuntime(p, estado, r, 1100 + propuesta.segundos * 1000, memoria);
	assert.deepEqual(disparo.eventos.map((e) => [e.dispositivoId, e.causa]), [['f2', 'sobrecarga']]);
	estado = disparo.estado;
	r = simular(p, estado, r.activos, { ahora: 1100 + propuesta.segundos * 1000, memoria });
	assert.equal(activo(r, 'km1'), false, 'F2 disparó pero 95-96 no dejó caer KM1');
	assert.equal(activo(r, 'h-marcha'), false);
	assert.equal(activo(r, 'h-fallo'), true, '97-98 no encendió el piloto FALLO');

	// Retirar la causa y rearmar no fabrica una orden START.
	estado = {
		...estado,
		m1: cambiarFalloRuntime(estado.m1 ?? {}, 'sobrecarga', false),
		f2: { ...(estado.f2 ?? {}), rearmeSolicitado: true },
	};
	const rearmado = actualizarProteccionesRuntime(p, estado, r, 1200 + propuesta.segundos * 1000, memoria);
	estado = rearmado.estado;
	r = simular(p, estado, r.activos, { ahora: 1200 + propuesta.segundos * 1000, memoria });
	assert.equal(activo(r, 'h-fallo'), false);
	assert.equal(activo(r, 'km1'), false);
	assert.notEqual(r.motores[0].estado, 'marcha', 'el rearme arrancó el motor sin nueva orden');

	estado = { ...estado, s1: { activo: true } };
	r = simular(p, estado, r.activos, { ahora: 1300 + propuesta.segundos * 1000, memoria });
	assert.equal(activo(r, 'km1'), true, 'un nuevo START no restauró la maniobra');
});

test('fixture VFD V2: READY, rampa, 50→25 Hz, FAULT, RESET y nuevo RUN', () => {
	const p = fixtureVariadorV2();
	const memoria = memoriaVacia();
	let estado: EstadoTablero = { vfd: { valor: 10 }, 's-run': { posicion: 0 } };
	let r = simular(p, estado, undefined, { ahora: 0, memoria });
	assert.equal(r.variadores[0].estado, 'listo');
	assert.equal(r.motores[0].estado, 'detenido');

	estado = { ...estado, 's-run': { posicion: 1 } };
	r = simular(p, estado, r.activos, { ahora: 0, memoria });
	assert.equal(r.variadores[0].estado, 'marcha');
	r = simular(p, estado, r.activos, { ahora: 5000, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 50);
	assert.equal(r.motores[0].velocidadPorcentaje, 100);
	assert.equal(r.motores[0].rpmEstimada, 1500);

	estado = { ...estado, vfd: { valor: 5 } };
	r = simular(p, estado, r.activos, { ahora: 6000, memoria });
	assert.equal(r.variadores[0].estado, 'decel');
	assert.equal(r.variadores[0].frecuenciaHz, 40);
	r = simular(p, estado, r.activos, { ahora: 7500, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 25);
	assert.equal(r.motores[0].velocidadPorcentaje, 50);

	estado = { ...estado, vfd: { valor: 5, fallos: ['fallo-externo'] } };
	r = simular(p, estado, r.activos, { ahora: 7600, memoria });
	assert.equal(r.variadores[0].estado, 'falla');
	assert.equal(r.variadores[0].frecuenciaHz, 0);
	assert.equal(r.motores[0].estado, 'desacelerando');
	assert.equal(activo(r, 'h-fallo'), true, 'el contacto AL1-AL2 no siguió el FAULT enclavado');

	estado = { ...estado, vfd: { valor: 5 } };
	r = simular(p, estado, r.activos, { ahora: 8000, memoria });
	assert.equal(r.variadores[0].estado, 'falla');
	assert.equal(r.variadores[0].resetPermitido, true);
	estado = { ...estado, vfd: { valor: 5, resetFallo: true } };
	r = simular(p, estado, r.activos, { ahora: 8100, memoria });
	assert.equal(r.variadores[0].estado, 'listo');
	assert.equal(activo(r, 'h-fallo'), false);

	// RUN seguía alto al resetear: no puede rearrancar hasta soltarlo y volverlo a ordenar.
	estado = { ...estado, vfd: { valor: 5 }, 's-run': { posicion: 1 } };
	r = simular(p, estado, r.activos, { ahora: 8200, memoria });
	assert.equal(r.variadores[0].estado, 'listo');
	estado = { ...estado, 's-run': { posicion: 0 } };
	r = simular(p, estado, r.activos, { ahora: 8300, memoria });
	estado = { ...estado, 's-run': { posicion: 1 } };
	r = simular(p, estado, r.activos, { ahora: 8400, memoria });
	assert.equal(r.variadores[0].estado, 'marcha');
	assert.ok(r.variadores[0].frecuenciaHz > 0);
});

test('los fixtures V2 sobreviven guardar/cargar sin persistir memoria ni fallos runtime', () => {
	for (const crear of [fixtureFallosIndustriales, fixtureVariadorV2]) {
		const p = crear();
		const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
		const perfilesPersistentes = (proyecto: Proyecto) => JSON.parse(JSON.stringify(
			proyecto.dispositivos.map((d) => [d.id, d.comportamiento]),
		));
		assert.deepEqual(perfilesPersistentes(cargado), perfilesPersistentes(p));
		const json = JSON.stringify(cargado);
		assert.equal(json.includes('"falloEnclavado":'), false);
		assert.equal(json.includes('"cargaTermica":'), false);
		assert.equal(json.includes('"fallos":'), false);
	}
});

test('invertir dispositivos y conductores no altera el resultado funcional de los fixtures V2', () => {
	const firma = (p: Proyecto, estado: EstadoTablero) => {
		const r = simular(p, estado);
		return {
			activos: [...r.activos].sort(),
			motores: r.motores.map((m) => [m.estado, m.frecuenciaElectricaHz, m.velocidadPorcentaje]),
			variadores: r.variadores.map((v) => [v.estado, v.frecuenciaHz]),
		};
	};
	for (const [crear, estado] of [
		[fixtureFallosIndustriales, { s1: { activo: true } }],
		[fixtureVariadorV2, { vfd: { valor: 5 }, 's-run': { posicion: 1 } }],
	] as const) {
		const p = crear();
		const esperado = firma(p, estado);
		p.dispositivos.reverse();
		p.conductores.reverse();
		assert.deepEqual(firma(p, estado), esperado);
	}
});
