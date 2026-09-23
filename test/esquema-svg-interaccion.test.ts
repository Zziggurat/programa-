import assert from 'node:assert/strict';
import test from 'node:test';
import { hojaASvg } from '../app/esquema-svg.js';
import { HojaEsq } from '../src/motores/esquema.js';

const hoja: HojaEsq = {
	id: 'esq1', numero: 1, titulo: 'Mando', anchoMm: 420, altoMm: 297, columnas: 10,
	simbolos: [], referencias: [],
	hilos: [{ conductorId: 'c1', nodos: [{ x: 50, y: 100 }, { x: 50, y: 140 }] }],
};

test('la vista interactiva conserva un solo ID de conductor y añade un agarre ancho', () => {
	const svg = hojaASvg(hoja, { interactivo: true, resaltadoConductor: 'c1' });
	assert.equal(svg.match(/data-conductor="c1"/g)?.length, 1);
	assert.match(svg, /<g data-conductor="c1" class="hilo" tabindex="0" role="button"/);
	assert.match(svg, /class="hilo-agarre"[^>]*stroke-width="4\.5" pointer-events="stroke"/);
	assert.match(svg, /stroke="#2ea3ff" stroke-width="1\.2"/);
});

test('el SVG exportado es vectorial limpio, sin agarres ni selección de edición', () => {
	const svg = hojaASvg(hoja);
	assert.match(svg, /data-conductor="c1"/);
	assert.doesNotMatch(svg, /hilo-agarre|tabindex="0"|role="button"|#2ea3ff/);
});

test('el ID hostil del conductor se escapa dentro de atributos SVG', () => {
	const conIdHostil: HojaEsq = {
		...hoja,
		hilos: [{ ...hoja.hilos[0], conductorId: 'c<&" onload="mal' }],
	};
	const svg = hojaASvg(conIdHostil, { interactivo: true });
	assert.match(svg, /data-conductor="c&lt;&amp;&quot; onload=&quot;mal"/);
	assert.doesNotMatch(svg, /data-conductor="c<&"/);
});
