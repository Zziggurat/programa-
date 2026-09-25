import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { HojaEsq } from '../src/motores/esquema.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { dxfDeEsquema } = await import('../app/exportaciones.js');
const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');
const procedencia = { estado: 'confirmado' as const, projectId: 'folios-m2',
	revisionRepositorio: 3, buildId: 'TEST', generadoEn: '2026-09-25T12:00:00.000Z' };

test('ESQ-07: DXF R12 conserva título/clase editorial sin permitir inyección de grupos', () => {
	const hoja: HojaEsq = { id: 'mando', numero: 2,
		titulo: 'Control\n0\nLINE\n999\nFALSO', clase: 'mando',
		anchoMm: 420, altoMm: 297, columnas: 10, simbolos: [], hilos: [], referencias: [] };
	const dxf = dxfDeEsquema(hoja, { proyecto: 'Tablero A', totalHojas: 3, procedencia });
	assert.match(dxf, /Proyecto Tablero A \| Hoja 2 \/ 3 \| Clase: MANDO Control 0 LINE 999 FALSO/);
	assert.doesNotMatch(dxf, /Control\n0\nLINE/);
	assert.match(dxf, /Project ID folios-m2/);
	assert.match(dxf, /Alcance: esquema electrico; no certifica instalacion ni fabricacion/);
	const sinProcedencia = dxfDeEsquema(hoja, { proyecto: 'Tablero A', totalHojas: 3 });
	assert.match(sinProcedencia, /Hoja 2 \/ 3 \| Clase: MANDO/);
	assert.doesNotMatch(sinProcedencia, /Project ID folios-m2/);
});

test('ESQ-07: índice offline ordena folios M2 por número y escapa títulos hostiles', async () => {
	const p = crearProyecto('Paquete de folios');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'bornes', numero: 2, titulo: 'Bornes <img src=x onerror=alert(1)>', clase: 'bornes' },
		{ id: 'potencia', numero: 1, titulo: 'Potencia & fuerza', clase: 'potencia' },
	];
	p.esquema = { representaciones: [] };
	const antes = JSON.stringify(p);
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), antes, 'emitir el índice no toca Proyecto');
	const indice = String(archivos.find((a) => a.ruta === 'index.html')?.contenido ?? '');
	assert.ok(indice.indexOf('Potencia &amp; fuerza') < indice.indexOf('Bornes &lt;img'),
		'el orden editorial no depende del array');
	assert.match(indice, /<td>POTENCIA<\/td><td><code>potencia<\/code>/);
	assert.match(indice, /<td>BORNES<\/td><td><code>bornes<\/code>/);
	assert.doesNotMatch(indice, /<img src=x onerror=/);
	for (const numero of ['001', '002']) {
		const ruta = `esquema/hoja-${numero}.svg`;
		assert.ok(archivos.some((a) => a.ruta === ruta));
		assert.ok(indice.includes(`href="${ruta}"`));
	}
	const enlaces = [...indice.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
	assert.equal(enlaces.length, archivos.length - 1, 'cada pieza del paquete tiene exactamente un enlace');
	assert.deepEqual(enlaces.sort(), archivos.filter((a) => a.ruta !== 'index.html').map((a) => a.ruta).sort());
	const invertido = structuredClone(p);
	invertido.hojas.reverse();
	const archivosInvertidos = await crearArchivosPaqueteDocumental(invertido, procedencia);
	assert.equal(String(archivosInvertidos.find((a) => a.ruta === 'index.html')?.contenido ?? ''), indice);
});
