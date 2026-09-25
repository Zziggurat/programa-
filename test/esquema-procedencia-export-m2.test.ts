import assert from 'node:assert/strict';
import test from 'node:test';
import type { HojaEsq } from '../src/motores/esquema.js';
import { hojaASvg } from '../app/esquema-svg.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { esquemaComoBlob } = await import('../app/esquema-pdf.js');

const hoja: HojaEsq = { id: 'h1', numero: 1, titulo: 'Mando', anchoMm: 420, altoMm: 297,
	columnas: 10, hilos: [], referencias: [], simbolos: [{
		dispositivoId: 'd1', representacionId: 'r1', designacion: 'KM1', columna: 2,
		x: 80, y: 80, ancho: 12, alto: 20, trazos: [], pines: new Map(),
		plantilla: { id: 'bobina-local', familia: 'parte', origen: 'trazos-generados-en-editor',
			archivo: 'src/motores/esquema.ts', licenciaDeclarada: 'GPL-2.0-or-later',
			licenciaVerificada: false, conformidadNormativa: 'NO_VERIFICADA' },
	}] };

test('ESQ-06: SVG/PDF exportan procedencia sin presentar el símbolo como certificado', async () => {
	const svg = hojaASvg(hoja);
	assert.match(svg, /data-plantilla="bobina-local"/);
	assert.match(svg, /data-familia-simbolo="parte"/);
	assert.match(svg, /data-origen-simbolo="trazos-generados-en-editor"/);
	assert.match(svg, /data-licencia-declarada="GPL-2\.0-or-later"/);
	assert.match(svg, /data-licencia-verificada="no"/);
	assert.match(svg, /data-conformidad-normativa="NO_VERIFICADA"/);
	assert.match(svg, /no verificada por plantilla/);
	assert.doesNotMatch(svg, /certificado IEC|conforme IEC 60617/i);

	const pdf = Buffer.from(await esquemaComoBlob([hoja], 'Tablero').arrayBuffer()).toString('latin1');
	assert.match(pdf, /Plantillas de esquema locales/);
	assert.match(pdf, /bobina-local/);
	assert.match(pdf, /no verificada por plantilla/);
});

test('ESQ-06: metadatos derivados hostiles se escapan en atributos y texto SVG', () => {
	const hostil: HojaEsq = { ...hoja, simbolos: [{ ...hoja.simbolos[0],
		plantilla: { ...hoja.simbolos[0].plantilla!, id: 'x<&" onload="alert(1)' } }] };
	const svg = hojaASvg(hostil);
	assert.match(svg, /data-plantilla="x&lt;&amp;&quot; onload=&quot;alert\(1\)"/);
	assert.doesNotMatch(svg, /data-plantilla="x<&"|<script|onload="alert\(1\)"/);
});
