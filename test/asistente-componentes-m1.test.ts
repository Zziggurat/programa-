import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	PASOS_ASISTENTE_COMPONENTE, leerArchivoComponentePortatil, pasoAdyacenteComponente,
} from '../app/ui-componentes-personalizados.js';

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

const paquete = (montaje?: unknown) => ({
	formato: 'tablero-studio-componente-portatil', version: 1,
	definicion: {
		formato: 'tablero-studio-componente', version: 1, id: 'cmp-placa', revision: 2,
		nombre: 'Equipo de placa', creadoEn: '2026-09-22T00:00:00.000Z',
		modificadoEn: '2026-09-22T00:00:00.000Z', tipoDispositivo: 'piloto',
		dimensiones: { anchoMm: 40, altoMm: 50, fondoMm: 30 },
		...(montaje === undefined ? {} : { montaje }),
		assetId: `sha256:${'a'.repeat(64)}`, terminales: [],
		comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'prueba mecánica' },
	},
	asset: { id: `sha256:${'a'.repeat(64)}`, mime: 'image/png', base64: 'AQID' },
});

test('archivo individual conserva montaje declarado y no inventa montaje legacy', () => {
	const placa = { metodo: 'atornillado-placa', anclajes: [{ xMm: 7, yMm: 8, diametroMm: 3 }] };
	assert.deepEqual(leerArchivoComponentePortatil(paquete(placa)).definicion.montaje, placa);
	assert.deepEqual(leerArchivoComponentePortatil(paquete({ metodo: 'riel-din' })).definicion.montaje,
		{ metodo: 'riel-din' });
	assert.equal(leerArchivoComponentePortatil(paquete()).definicion.montaje, undefined);
	assert.throws(() => leerArchivoComponentePortatil(paquete({ metodo: 'atornillado-placa',
		anclajes: [{ xMm: 70, yMm: 8 }] })), /anclaje/);
});
