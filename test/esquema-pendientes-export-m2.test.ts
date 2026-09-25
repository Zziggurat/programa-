import assert from 'node:assert/strict';
import test from 'node:test';

import { dxfDeEsquema } from '../app/exportaciones.js';
import { hojaASvg } from '../app/esquema-svg.js';
import type { HojaEsq } from '../src/motores/esquema.js';

// El módulo PDF comparte el gestor de descargas, aunque aquí solo construimos su Blob.
Object.assign(globalThis, {
	document: {
		documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} },
	},
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { esquemaComoBlob } = await import('../app/esquema-pdf.js');

const hoja: HojaEsq = {
	id: 'h1', numero: 1, titulo: 'Pendientes visibles', anchoMm: 420, altoMm: 297,
	columnas: 10, simbolos: [], hilos: [], referencias: [],
	problemas: [
		{ codigo: 'aparato-sin-representacion', dispositivoId: 'q1',
			mensaje: 'El aparato q1 no tiene vista' },
		{ codigo: 'conexion-sin-ancla', conductorId: 'w1',
			mensaje: 'El conductor w1 necesita dos anclas' },
	],
};

test('SVG/PDF/DXF exportados advierten aparatos y conexiones omitidos sin dibujar cables falsos', async () => {
	const svg = hojaASvg(hoja, { proyecto: 'Pendientes' });
	assert.match(svg, /class="aviso-pendientes-esquema"/);
	assert.match(svg, /PENDIENTES DE ESQUEMA 2: q1, w1/);
	assert.doesNotMatch(svg, /class="hilo"/);
	const pdf = Buffer.from(await esquemaComoBlob([hoja], 'Pendientes').arrayBuffer()).toString('latin1');
	assert.match(pdf, /^%PDF-/);
	assert.match(pdf, /PENDIENTES DE ESQUEMA 2: q1, w1/);
	const dxf = dxfDeEsquema(hoja);
	assert.match(dxf, /PENDIENTES DE ESQUEMA 2: q1, w1/);
	assert.match(dxf, /0\nTEXT\n8\nTEXTO\n/);
	assert.doesNotMatch(dxf, /0\nLINE\n8\nCABLES\n/);
});

test('la advertencia SVG trata los IDs como texto, no como marcado ejecutable', () => {
	const hostil: HojaEsq = { ...hoja, problemas: [{ codigo: 'aparato-sin-representacion',
		dispositivoId: '<script>&', mensaje: 'ID no confiable' }] };
	const svg = hojaASvg(hostil);
	assert.match(svg, /PENDIENTES DE ESQUEMA 1: &lt;script&gt;&amp;/);
	assert.doesNotMatch(svg, /<script>/);
});
