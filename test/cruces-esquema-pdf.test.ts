import assert from 'node:assert/strict';
import test from 'node:test';
import type { HojaEsq } from '../src/motores/esquema.js';

// El exportador usa el gestor de descargas del navegador; aquí solo se captura su Blob.
let archivo: Blob | undefined;
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

const hoja: HojaEsq = {
	id: 'h', numero: 1, titulo: 'Cruce', anchoMm: 420, altoMm: 297, columnas: 10,
	simbolos: [], referencias: [],
	hilos: [
		{ conductorId: 'a', nodos: [{ x: 10, y: 50 }, { x: 90, y: 50 }] },
		{ conductorId: 'b', nodos: [{ x: 50, y: 10 }, { x: 50, y: 90 }] },
	],
};

test('el PDF A3 conserva el cruce no unido como dos subtramos vectoriales', async () => {
	const crearUrl = URL.createObjectURL;
	const temporizador = globalThis.setTimeout;
	try {
		URL.createObjectURL = (blob: Blob | MediaSource) => {
			assert.ok(blob instanceof Blob);
			archivo = blob;
			return 'blob:qa-cruce';
		};
		// La descarga real revoca el URL después de 20 s; en QA no se crea un URL real.
		globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
			ms === 20_000 ? 0 : temporizador(fn, ms, ...args)) as typeof setTimeout;
		await exportarEsquemaPDF([hoja], 'Prueba cruce', 'cruce.pdf');
	} finally {
		URL.createObjectURL = crearUrl;
		globalThis.setTimeout = temporizador;
	}
	assert.ok(archivo, 'no se produjo el PDF');
	const pdf = Buffer.from(await archivo.arrayBuffer()).toString('latin1');
	assert.match(pdf, /^%PDF-/);
	const flujo = pdf.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)?.[1];
	assert.ok(flujo, 'jsPDF no produjo un flujo vectorial legible');
	const lineas = [...flujo.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l\s+S/g)]
		.map((m) => m.slice(1).map(Number));
	const unidad = 72 / 25.4;
	const tiene = (x1: number, y1: number, x2: number, y2: number): boolean => lineas.some((l) =>
		Math.abs(l[0] - x1 * unidad) < 0.05
		&& Math.abs(l[1] - (hoja.altoMm - y1) * unidad) < 0.05
		&& Math.abs(l[2] - x2 * unidad) < 0.05
		&& Math.abs(l[3] - (hoja.altoMm - y2) * unidad) < 0.05);
	assert.ok(tiene(50, 10, 50, 49), 'faltó el tramo superior del conductor inferior');
	assert.ok(tiene(50, 51, 50, 90), 'faltó el tramo inferior después del hueco');
	assert.ok(!tiene(50, 10, 50, 90), 'el exportador cerró de nuevo el hueco del cruce');
});

test('el PDF separa el hilo aislado de un punto de unión de otro borne', async () => {
	const borne = { dispositivoId: 'xp', borneId: 'X1' };
	const conNudo: HojaEsq = { ...hoja, hilos: [
		{ conductorId: 'rama-1', nodos: [{ x: 50, y: 50 }, { x: 70, y: 30 }],
			bornes: { de: borne, a: { dispositivoId: 'a', borneId: 'X1' } } },
		{ conductorId: 'rama-2', nodos: [{ x: 50, y: 50 }, { x: 70, y: 70 }],
			bornes: { de: borne, a: { dispositivoId: 'b', borneId: 'X1' } } },
		{ conductorId: 'aislado', nodos: [{ x: 20, y: 50 }, { x: 80, y: 50 }] },
	] };
	archivo = undefined;
	const crearUrl = URL.createObjectURL;
	const temporizador = globalThis.setTimeout;
	try {
		URL.createObjectURL = (blob: Blob | MediaSource) => { archivo = blob as Blob; return 'blob:qa-nudo'; };
		globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
			ms === 20_000 ? 0 : temporizador(fn, ms, ...args)) as typeof setTimeout;
		await exportarEsquemaPDF([conNudo], 'Prueba nudo', 'nudo.pdf');
	} finally {
		URL.createObjectURL = crearUrl;
		globalThis.setTimeout = temporizador;
	}
	const capturado = archivo as Blob | undefined;
	assert.ok(capturado);
	const pdf = Buffer.from(await capturado.arrayBuffer()).toString('latin1');
	const flujo = pdf.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)?.[1];
	assert.ok(flujo);
	const lineas = [...flujo.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l\s+S/g)]
		.map((m) => m.slice(1).map(Number));
	const unidad = 72 / 25.4;
	const tiene = (x1: number, x2: number): boolean => lineas.some((l) =>
		Math.abs(l[0] - x1 * unidad) < 0.05
		&& Math.abs(l[1] - (hoja.altoMm - 50) * unidad) < 0.05
		&& Math.abs(l[2] - x2 * unidad) < 0.05
		&& Math.abs(l[3] - (hoja.altoMm - 50) * unidad) < 0.05);
	assert.ok(tiene(20, 48.4), 'faltó tramo antes del punto ajeno');
	assert.ok(tiene(51.6, 80), 'faltó tramo después del punto ajeno');
	assert.equal(tiene(20, 80), false, 'el PDF volvió a cerrar el hueco');
});

test('el PDF A3 recorta la línea continua de una T de bornes independientes', async () => {
	const conT: HojaEsq = { ...hoja, hilos: [
		{ conductorId: 'z-continuo', nodos: [{ x: 10, y: 50 }, { x: 90, y: 50 }],
			bornes: { de: { dispositivoId: 'red', borneId: 'L' },
				a: { dispositivoId: 'carga', borneId: 'L' } } },
		{ conductorId: 'a-rama', nodos: [{ x: 50, y: 50 }, { x: 50, y: 90 }],
			bornes: { de: { dispositivoId: 'aislado', borneId: 'X1' },
				a: { dispositivoId: 'destino', borneId: 'X1' } } },
	] };
	archivo = undefined;
	const crearUrl = URL.createObjectURL;
	const temporizador = globalThis.setTimeout;
	try {
		URL.createObjectURL = (blob: Blob | MediaSource) => { archivo = blob as Blob; return 'blob:qa-t'; };
		globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) =>
			ms === 20_000 ? 0 : temporizador(fn, ms, ...args)) as typeof setTimeout;
		await exportarEsquemaPDF([conT], 'Prueba T', 't.pdf');
	} finally {
		URL.createObjectURL = crearUrl;
		globalThis.setTimeout = temporizador;
	}
	const capturado = archivo as Blob | undefined;
	assert.ok(capturado);
	const flujo = Buffer.from(await capturado.arrayBuffer()).toString('latin1')
		.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)?.[1];
	assert.ok(flujo);
	const lineas = [...flujo.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l\s+S/g)]
		.map((m) => m.slice(1).map(Number));
	const unidad = 72 / 25.4;
	const tiene = (x1: number, x2: number): boolean => lineas.some((l) =>
		Math.abs(l[0] - x1 * unidad) < 0.05
		&& Math.abs(l[1] - (hoja.altoMm - 50) * unidad) < 0.05
		&& Math.abs(l[2] - x2 * unidad) < 0.05
		&& Math.abs(l[3] - (hoja.altoMm - 50) * unidad) < 0.05);
	assert.ok(tiene(10, 49));
	assert.ok(tiene(51, 90));
	assert.equal(tiene(10, 90), false, 'PDF no debe aparentar una conexión en T');
});
