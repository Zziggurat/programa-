import assert from 'node:assert/strict';
import test from 'node:test';
import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { dossierComoBlob } = await import('../app/pdf.js');

test('M3: acentos, comillas, saltos y marcadores hostiles quedan visibles e inertes en PDF real', async () => {
	const proyecto = tableroEjemplo();
	proyecto.nombre = 'Árbol "Q" <script>alert(7)</script>';
	proyecto.dispositivos[0].descripcion = 'Línea uno, "Q" y \'A\'\nLínea dos & <img src=x onerror=alert(7)>';
	const pdf = Buffer.from(await dossierComoBlob(proyecto).arrayBuffer()).toString('latin1');
	assert.match(pdf, /^%PDF-/, 'se produjo un PDF real, no HTML o un mock');

	// jsPDF emite aquí streams de contenido sin comprimir. Exigimos operadores de texto
	// visibles (BT/Tj/ET), no una coincidencia fácil en metadatos o en otro objeto PDF.
	const streams = [...pdf.matchAll(/\bstream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
	const texto = streams.filter((s) => s.includes('BT') && s.includes(' Tj'));
	assert.ok(texto.length > 0, 'el PDF contiene streams de texto renderizable');
	assert.ok(texto.some((s) => s.includes('(Árbol "Q" <script>alert\\(7\\)</script>) Tj')),
		'el título hostil con acento y comillas se dibuja como texto literal');
	const tablaBom = texto.find((s) => s.includes('(Línea uno, "Q" y \'A\') Tj'));
	assert.ok(tablaBom, 'la primera línea del aparato conserva acento y ambas clases de comillas');
	assert.ok(tablaBom.includes('(Línea dos & <img src=x onerror=alert\\(7\\)>) Tj'),
		'el marcador HTML hostil queda íntegro como texto en la segunda línea');
	assert.match(tablaBom, /\(Línea uno, "Q" y 'A'\) Tj\s*T\* \(Línea dos & <img src=x onerror=alert\\\(7\\\)>\) Tj/,
		'el salto de línea separa dos renglones visibles y no desaparece');
	// jsPDF añade /OpenAction [página /FitH] para encuadrar la primera página;
	// no es una acción ejecutable. Rechazamos tipos de acción y scripts reales.
	assert.ok(!/\/S\s*\/(?:JavaScript|Launch|URI|SubmitForm)\b|\/(?:JS|AA)\b/.test(pdf),
		'el texto no creó scripts, enlaces activos ni acciones ejecutables de PDF');
});
