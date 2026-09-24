import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	PASOS_ASISTENTE_COMPONENTE, calcularRecorteImagen, pasoAdyacenteComponente,
	tamanoPngDerivado, carcasaConservadaEnRevision, seleccionarPlantillaCarcasa,
} from '../app/ui-componentes-personalizados.js';
import { leerComponentePortatil } from '../src/componentes/portatil.js';

test('el asistente recorre una sola edición de identidad a revisión sin salir de sus límites', () => {
	assert.deepEqual(PASOS_ASISTENTE_COMPONENTE.map(({ id }) => id), [
		'identidad', 'funcion', 'bornes', 'dimensiones', 'apariencia', 'revision',
	]);
	assert.equal(pasoAdyacenteComponente('identidad', -1), 'identidad');
	assert.equal(pasoAdyacenteComponente('revision', 1), 'revision');
	for (let i = 0; i < PASOS_ASISTENTE_COMPONENTE.length - 1; i++) {
		assert.equal(pasoAdyacenteComponente(PASOS_ASISTENTE_COMPONENTE[i].id, 1),
			PASOS_ASISTENTE_COMPONENTE[i + 1].id);
		assert.equal(pasoAdyacenteComponente(PASOS_ASISTENTE_COMPONENTE[i + 1].id, -1),
			PASOS_ASISTENTE_COMPONENTE[i].id);
	}
});

test('recortar y escalar la foto conserva el marco y limita la resolución', () => {
	assert.deepEqual(calcularRecorteImagen(400, 200,
		{ escalaPct: 100, horizontalPct: 50, verticalPct: 50 }),
		{ x: 0, y: 0, ancho: 400, alto: 200 });
	assert.deepEqual(calcularRecorteImagen(400, 200,
		{ escalaPct: 200, horizontalPct: 50, verticalPct: 50 }),
		{ x: 100, y: 50, ancho: 200, alto: 100 });
	assert.deepEqual(calcularRecorteImagen(400, 200,
		{ escalaPct: 200, horizontalPct: 0, verticalPct: 100 }),
		{ x: 0, y: 100, ancho: 200, alto: 100 });
	const salida = tamanoPngDerivado({ x: 0, y: 0, ancho: 4000, alto: 2000 }, 45, 80);
	assert.deepEqual(salida, { ancho: 1125, alto: 2000 });
	assert.deepEqual(tamanoPngDerivado({ x: 0, y: 0, ancho: 1, alto: 1 }, 45, 80),
		{ ancho: 36, alto: 64 });
});

test('el recorte rechaza porcentajes, fuentes y proporciones que exceden los límites', () => {
	assert.throws(() => calcularRecorteImagen(5000, 5000,
		{ escalaPct: 100, horizontalPct: 50, verticalPct: 50 }), /24 megapíxeles/);
	assert.throws(() => calcularRecorteImagen(100, 100,
		{ escalaPct: Infinity, horizontalPct: 50, verticalPct: 50 }), /escala/);
	assert.throws(() => calcularRecorteImagen(100, 100,
		{ escalaPct: 200, horizontalPct: -1, verticalPct: 50 }), /encuadres/);
	assert.throws(() => tamanoPngDerivado({ x: 0, y: 0, ancho: 100, alto: 100 }, 1, 10_000),
		/2000 píxeles|proporción física/);
});

test('una revisión fotográfica conserva intacta la carcasa fijada', () => {
	const original = { carcasa: { plantilla: 'modulo-din', acabado: 'grafito' } } as const;
	const nueva = carcasaConservadaEnRevision(original);
	assert.deepEqual(nueva, original);
	assert.notStrictEqual(nueva.carcasa, original.carcasa);
	assert.deepEqual(carcasaConservadaEnRevision(undefined), {});
});

test('plantilla de carcasa solo cambia por elección explícita, con acabado visible', () => {
	const original = { carcasa: { plantilla: 'modulo-din', acabado: 'grafito' } } as const;
	const revision = carcasaConservadaEnRevision(original).carcasa;
	assert.deepEqual(revision, original.carcasa);
	const otraPlantilla = seleccionarPlantillaCarcasa(revision, 'caja-industrial');
	assert.deepEqual(otraPlantilla, { plantilla: 'caja-industrial', acabado: 'grafito' });
	assert.deepEqual(original.carcasa, { plantilla: 'modulo-din', acabado: 'grafito' });
	assert.deepEqual(seleccionarPlantillaCarcasa(undefined, 'modulo-din'),
		{ plantilla: 'modulo-din', acabado: 'gris-claro' });
	assert.equal(seleccionarPlantillaCarcasa(otraPlantilla, ''), undefined);
	assert.equal(seleccionarPlantillaCarcasa(undefined, ''), undefined);
});

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xQAAAAASUVORK5CYII=';
const ASSET_ID = `sha256:${createHash('sha256').update(Buffer.from(PNG_BASE64, 'base64')).digest('hex')}`;
const paquete = (montaje?: unknown) => ({
	formato: 'tablero-studio-componente-portatil', version: 1,
	definicion: {
		formato: 'tablero-studio-componente', version: 1, id: 'cmp-placa', revision: 2,
		nombre: 'Equipo de placa', creadoEn: '2026-09-22T00:00:00.000Z',
		modificadoEn: '2026-09-22T00:00:00.000Z', tipoDispositivo: 'piloto',
		dimensiones: { anchoMm: 40, altoMm: 50, fondoMm: 30 },
		...(montaje === undefined ? {} : { montaje }),
		assetId: ASSET_ID, terminales: [],
		comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'prueba mecánica' },
	},
	asset: { id: ASSET_ID, mime: 'image/png', base64: PNG_BASE64 },
});

test('archivo individual conserva montaje declarado y no inventa montaje legacy', async () => {
	const placa = { metodo: 'atornillado-placa', anclajes: [{ xMm: 7, yMm: 8, diametroMm: 3 }] };
	assert.deepEqual((await leerComponentePortatil(JSON.stringify(paquete(placa)))).definicion.montaje, placa);
	assert.deepEqual((await leerComponentePortatil(JSON.stringify(paquete({ metodo: 'riel-din' })))).definicion.montaje,
		{ metodo: 'riel-din' });
	assert.equal((await leerComponentePortatil(JSON.stringify(paquete()))).definicion.montaje, undefined);
	await assert.rejects(leerComponentePortatil(JSON.stringify(paquete({ metodo: 'atornillado-placa',
		anclajes: [{ xMm: 70, yMm: 8 }] }))), /anclaje/);
});
