import assert from 'node:assert/strict';
import test from 'node:test';
import type { HojaEsq } from '../src/motores/esquema.js';
import { NOTA_SIMBOLOGIA_ESQUEMA } from '../src/motores/esquema.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { hojaASvg } = await import('../app/esquema-svg.js');
const { esquemaComoBlob } = await import('../app/esquema-pdf.js');
const hoja: HojaEsq = { id: 'h1', numero: 1, titulo: 'Mando', anchoMm: 420, altoMm: 297,
	columnas: 10, simbolos: [], hilos: [], referencias: [] };

test('ESQ-06: SVG y PDF no presentan la simbología genérica como certificación IEC', async () => {
	const svg = hojaASvg(hoja, { proyecto: 'Tablero' });
	const pdf = Buffer.from(await esquemaComoBlob([hoja], 'Tablero').arrayBuffer()).toString('latin1');
	assert.match(NOTA_SIMBOLOGIA_ESQUEMA, /No certifica normas ni fabricación/);
	assert.match(svg, /Simbología genérica del editor/);
	assert.match(svg, /No certifica normas ni fabricación/);
	assert.match(pdf, /No certifica normas ni fabricaci/);
	for (const salida of [svg, pdf]) {
		assert.doesNotMatch(salida, /Símbolos IEC 60617|Conjunto según IEC 61439/i);
	}
});
