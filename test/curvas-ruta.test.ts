import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redondearRutaConRadio } from '../src/modelo/curvas-ruta.js';
import { primerSolidoEnTramos, primerSolidoEnTramosDelNodo } from '../app/colisiones-cables.js';

test('CAB-25: un cuarto de circunferencia conserva extremos, tangencias y longitud analítica', () => {
	const ruta = redondearRutaConRadio([
		{ x: 0, y: 0, z: 20 }, { x: 50, y: 0, z: 20 }, { x: 50, y: 50, z: 20 },
	], 10);
	assert.deepEqual(ruta.codos, [{ indice: 1, estado: 'CURVO', radioMm: 10 }]);
	assert.deepEqual(ruta.puntos[0], { x: 0, y: 0, z: 20 });
	assert.deepEqual(ruta.puntos.at(-1), { x: 50, y: 50, z: 20 });
	assert.deepEqual(ruta.puntos[1], { x: 40, y: 0, z: 20 });
	assert.ok(Math.abs(ruta.puntos.at(-2)!.x - 50) < 1e-10);
	assert.ok(Math.abs(ruta.puntos.at(-2)!.y - 10) < 1e-10);
	assert.ok(Math.abs(ruta.longitudMm - (80 + 5 * Math.PI)) < 1e-10);
	assert.ok(ruta.puntos.every((p) => p.x >= 0 && p.x <= 50 && p.y >= 0 && p.y <= 50),
		'ninguna spline debe sobresalir del dominio de los tramos');
	assert.ok(ruta.puntos.some((p) => p.x > 40 && p.x < 50 && p.y > 0 && p.y < 10));
	for (const p of ruta.puntos.slice(2, -1)) {
		if (p.y > 0 && p.y < 10) assert.ok(Math.abs(Math.hypot(p.x - 40, p.y - 10) - 10) < 1e-8,
			'el eje muestreado debe pertenecer al círculo declarado');
	}
});

test('CAB-25: un giro en profundidad conserva el radio circular y no depende del plano XY', () => {
	const ruta = redondearRutaConRadio([
		{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, { x: 40, y: 0, z: 40 },
	], 8);
	assert.equal(ruta.codos[0].estado, 'CURVO');
	assert.ok(Math.abs(ruta.longitudMm - (64 + 4 * Math.PI)) < 1e-10);
	assert.ok(ruta.puntos.every((p) => p.y === 0 && p.x <= 40 && p.z >= 0 && p.z <= 40));
});

test('CAB-25: radio que no cabe no se reduce para fingir cumplimiento', () => {
	const ruta = redondearRutaConRadio([
		{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 20, z: 0 },
	], 10);
	assert.deepEqual(ruta.codos, [{ indice: 1, estado: 'SIN_ESPACIO' }]);
	assert.deepEqual(ruta.puntos, [
		{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5, y: 20, z: 0 },
	]);
	assert.equal(ruta.longitudMm, 25);
	const vecinos = redondearRutaConRadio([
		{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 },
		{ x: 30, y: 10, z: 0 }, { x: 60, y: 10, z: 0 },
	], 8);
	assert.deepEqual(vecinos.codos.map((c) => c.estado), ['SIN_ESPACIO', 'SIN_ESPACIO']);
});

test('CAB-25: rectas, retornos, puntos duplicados e insumos hostiles tienen resultado explícito', () => {
	const punto = (x: number) => ({ x, y: 0, z: 0 });
	assert.equal(redondearRutaConRadio([punto(0), punto(10), punto(20)], 8).codos[0].estado, 'RECTO');
	assert.equal(redondearRutaConRadio([punto(0), punto(10), punto(0)], 8).codos[0].estado, 'RETORNO');
	assert.equal(redondearRutaConRadio([punto(0), punto(0), punto(10)], 8).codos[0].estado, 'SIN_ESPACIO');
	for (const radio of [0, -1, Infinity, NaN, 501]) {
		assert.throws(() => redondearRutaConRadio([punto(0), punto(10)], radio), /RADIO_RUTA_INVALIDO/);
	}
	assert.throws(() => redondearRutaConRadio([punto(0), { x: NaN, y: 0, z: 0 }], 8),
		/RADIO_RUTA_INVALIDO/);
});

test('CAB-25: el diagnóstico local recorre todo el arco, no solo dos segmentos centrales', () => {
	const ruta = redondearRutaConRadio([
		{ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 50, y: 50, z: 0 },
	], 10);
	const [desde, hasta] = ruta.rangosVertices[1];
	const p = ruta.puntos[desde + 1];
	const obstaculo = { id: 'borde', x0: p.x - 0.05, x1: p.x + 0.05,
		y0: p.y - 0.05, y1: p.y + 0.05, z0: -1, z1: 1 };
	assert.ok(hasta - desde > 4);
	assert.equal(primerSolidoEnTramosDelNodo(ruta.puntos, ruta.indicesVertices[1], 0.01,
		[obstaculo]), undefined, 'la antigua ventana de dos tramos omitía este borde');
	assert.equal(primerSolidoEnTramos(ruta.puntos, desde, hasta, 0.01, [obstaculo])?.id,
		'borde', 'el arco entero debe participar en el diagnóstico mientras se arrastra');
});
