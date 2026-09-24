import assert from 'node:assert/strict';
import test from 'node:test';
import type { HojaEsq } from '../src/motores/esquema.js';

Object.assign(globalThis, {
	document: {
		documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} },
	},
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { exportarEsquemaPDF } = await import('../app/esquema-pdf.js');

test('DOC-01 PDF de esquema declara alcance y ruta pendiente de la revisión', async () => {
	const hoja: HojaEsq = { id: 'h', numero: 1, titulo: 'Documento', anchoMm: 420,
		altoMm: 297, columnas: 10, simbolos: [], hilos: [], referencias: [] };
	let archivo: Blob | undefined;
	const crearUrl = URL.createObjectURL;
	const temporizador = globalThis.setTimeout;
	try {
		URL.createObjectURL = (blob: Blob | MediaSource) => { archivo = blob as Blob; return 'blob:qa-doc'; };
		globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
			ms === 20_000 ? 0 : temporizador(fn, ms, ...args)) as typeof setTimeout;
		await exportarEsquemaPDF([hoja], 'Prueba documental', 'documental.pdf',
			{ revision: 'ED-A' }, { estado: 'confirmado', projectId: 'repo-1',
				revisionRepositorio: 7, buildId: 'qa-build', generadoEn: '2026-09-24T12:00:00.000Z' }, 3);
	} finally {
		URL.createObjectURL = crearUrl;
		globalThis.setTimeout = temporizador;
	}
	assert.ok(archivo);
	const pdf = Buffer.from(await archivo.arrayBuffer()).toString('latin1');
	assert.match(pdf, /Project ID repo-1/);
	assert.match(pdf, /Build ID qa-build/);
	assert.match(pdf, /Alcance: esquema/);
	assert.match(pdf, /pendientes del proyecto: 3/);
	assert.match(pdf, /Una ruta pendiente no define trayecto, longitud ni material/);
});
