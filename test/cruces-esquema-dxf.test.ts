import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dxfDeEsquema } from '../app/exportaciones.js';
import type { HojaEsq } from '../src/motores/esquema.js';

test('ESQ-03 DXF conserva el mismo hueco sin unión que SVG y PDF', () => {
	const hoja: HojaEsq = { id: 'h', numero: 1, titulo: 'Cruce', anchoMm: 100, altoMm: 100,
		columnas: 2, simbolos: [], referencias: [], hilos: [
			{ conductorId: 'a', nodos: [{ x: 10, y: 50 }, { x: 90, y: 50 }] },
			{ conductorId: 'b', nodos: [{ x: 50, y: 10 }, { x: 50, y: 90 }] },
		] };
	const dxf = dxfDeEsquema(hoja);
	const entidades = dxf.split(/(?=^0\n(?:LINE|CIRCLE)\n)/m);
	const cables = entidades.filter((e) => e.startsWith('0\nLINE\n8\nCABLES\n'));
	assert.equal(cables.length, 3, 'uno horizontal y dos subtramos verticales');
	const datos = cables.map((e) => Object.fromEntries([...e.matchAll(/^(10|20|11|21)\n([^\n]+)/gm)]
		.map((m) => [m[1], Number(m[2])])));
	assert.deepEqual(datos.filter((e) => e['10'] === 50 && e['11'] === 50)
		.map((e) => [e['20'], e['21']]), [[90, 51], [49, 10]]);
	assert.doesNotMatch(dxf, /0\nCIRCLE\n8\nCABLES\n/, 'el cruce no agrega nudo');
});

test('ESQ-03 DXF aparta un conductor aislado del nudo de otro borne', () => {
	const borne = { dispositivoId: 'xp', borneId: 'X1' };
	const hoja: HojaEsq = { id: 'h', numero: 1, titulo: 'Nudo', anchoMm: 100, altoMm: 100,
		columnas: 2, simbolos: [], referencias: [], hilos: [
			{ conductorId: 'rama-1', nodos: [{ x: 50, y: 50 }, { x: 70, y: 30 }],
				bornes: { de: borne, a: { dispositivoId: 'a', borneId: 'X1' } } },
			{ conductorId: 'rama-2', nodos: [{ x: 50, y: 50 }, { x: 70, y: 70 }],
				bornes: { de: borne, a: { dispositivoId: 'b', borneId: 'X1' } } },
			{ conductorId: 'aislado', nodos: [{ x: 20, y: 50 }, { x: 80, y: 50 }] },
		] };
	const dxf = dxfDeEsquema(hoja);
	const cables = dxf.split(/(?=^0\n(?:LINE|CIRCLE)\n)/m)
		.filter((e) => e.startsWith('0\nLINE\n8\nCABLES\n'));
	const horizontales = cables.map((e) => Object.fromEntries([...e.matchAll(/^(10|20|11|21)\n([^\n]+)/gm)]
		.map((m) => [m[1], Number(m[2])]))).filter((e) => e['20'] === 50 && e['21'] === 50);
	assert.deepEqual(horizontales.map((e) => [e['10'], e['11']]), [[20, 48.4], [51.6, 80]]);
	assert.match(dxf, /0\nCIRCLE\n8\nCABLES\n10\n50\.000\n20\n50\.000\n/,
		'el borne compartido sí conserva su punto de unión');
});

test('ESQ-03 DXF conserva la interrupción de la línea continua en una T aislada', () => {
	const hoja: HojaEsq = { id: 'h', numero: 1, titulo: 'T aislada', anchoMm: 100, altoMm: 100,
		columnas: 2, simbolos: [], referencias: [], hilos: [
			{ conductorId: 'z-continuo', nodos: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
				bornes: { de: { dispositivoId: 'red', borneId: 'L' },
					a: { dispositivoId: 'carga', borneId: 'L' } } },
			{ conductorId: 'a-rama', nodos: [{ x: 50, y: 50 }, { x: 50, y: 90 }],
				bornes: { de: { dispositivoId: 'aislado', borneId: 'X1' },
					a: { dispositivoId: 'destino', borneId: 'X1' } } },
		] };
	const dxf = dxfDeEsquema(hoja);
	const cables = dxf.split(/(?=^0\n(?:LINE|CIRCLE)\n)/m)
		.filter((e) => e.startsWith('0\nLINE\n8\nCABLES\n'));
	const horizontales = cables.map((e) => Object.fromEntries([...e.matchAll(/^(10|20|11|21)\n([^\n]+)/gm)]
		.map((m) => [m[1], Number(m[2])]))).filter((e) => e['20'] === 50 && e['21'] === 50);
	assert.deepEqual(horizontales.map((e) => [e['10'], e['11']]), [[10, 49], [51, 90]]);
	assert.doesNotMatch(dxf, /0\nCIRCLE\n8\nCABLES\n/, 'una T sin borne común no tiene punto de unión');
});
