/**
 * Segunda auditoría, TS2-P3-01. Los ids se hacían con `Date.now().toString(36)`, a veces con un
 * `Math.random()` de cuatro cifras detrás. En un clic suelto no chocan; duplicando dos aparatos
 * dentro del mismo milisegundo, o pegando un grupo entero de golpe, sí pueden. Y un id repetido no
 * da un error: da un cable conectado al aparato equivocado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { idUnico, idsRepetidos } from '../src/modelo/ids.js';

test('mil ids seguidos, sin dejar respirar al reloj, no repiten ninguno', () => {
	const ids = Array.from({ length: 1000 }, () => idUnico('d'));
	assert.equal(new Set(ids).size, 1000);
	assert.ok(ids.every((x) => x.startsWith('d')), 'y todos llevan su prefijo');
});

test('el generador de antes SÍ repetía dentro del mismo milisegundo', () => {
	// No se prueba el código nuevo: se prueba que el problema era real, para que el arreglo no
	// parezca una precaución inventada. Con el reloj congelado, `Date.now()` da lo mismo mil veces.
	const comoAntes = (): string => `d${(1_700_000_000_000).toString(36)}${Math.floor(Math.random() * 1e4)}`;
	const viejos = Array.from({ length: 1000 }, comoAntes);
	assert.ok(new Set(viejos).size < 1000,
		'con 10.000 combinaciones y 1.000 tiradas, el cumpleaños dice que choca casi seguro');
});

test('los ids repetidos de un archivo se pueden detectar', () => {
	assert.deepEqual(idsRepetidos([{ id: 'a' }, { id: 'b' }, { id: 'a' }]), ['a']);
	assert.deepEqual(idsRepetidos([{ id: 'a' }, { id: 'b' }]), []);
});
