import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	PASOS_ASISTENTE_COMPONENTE, pasoAdyacenteComponente,
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
