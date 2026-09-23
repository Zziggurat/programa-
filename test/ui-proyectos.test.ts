import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filtrarTableros } from '../app/busqueda-proyectos.js';
import { ejecutarAccionBiblioteca } from '../app/acciones-biblioteca.js';

const tableros = Object.freeze([
	Object.freeze({ id: 'doc-bomba-001', nombre: 'Bomba de extracción', revision: 4 }),
	Object.freeze({ id: 'doc-control-002', nombre: 'Tablero de control', revision: 2 }),
	Object.freeze({ id: 'doc-reserva-003', nombre: 'Reserva', revision: 1 }),
]);

test('Mis tableros busca nombre sin depender de mayúsculas ni acentos', () => {
	assert.deepEqual(filtrarTableros(tableros, '  BOMBA extraccion  '), [tableros[0]]);
});

test('Mis tableros busca identidad y revisión sin cargar documentos', () => {
	assert.deepEqual(filtrarTableros(tableros, 'control r2'), [tableros[1]]);
	assert.deepEqual(filtrarTableros(tableros, 'DOC-RESERVA'), [tableros[2]]);
	assert.deepEqual(filtrarTableros(tableros, 'revisión 4'), [tableros[0]]);
});

test('Mis tableros conserva el orden y distingue lista vacía de cero coincidencias', () => {
	assert.deepEqual(filtrarTableros(tableros, ' '), tableros);
	assert.deepEqual(filtrarTableros(tableros, 'sin coincidencias'), []);
	assert.equal(tableros[0].nombre, 'Bomba de extracción');
});

test('la biblioteca captura un rechazo de almacenamiento sin dejar una promesa sin manejar', async () => {
	const error = new Error('IndexedDB indisponible');
	const recibidos: unknown[] = [];
	assert.equal(await ejecutarAccionBiblioteca(async () => { throw error; }, (e) => recibidos.push(e)), false);
	assert.equal(await ejecutarAccionBiblioteca(async () => {}, (e) => recibidos.push(e)), true);
	assert.deepEqual(recibidos, [error]);
});
