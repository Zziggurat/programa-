import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dispositivo } from '../src/modelo/tipos.js';
import { identidadParaCopia } from '../src/modelo/identidad-copia.js';

const contactor = (id: string, designacion?: string, numero?: number): Dispositivo => ({
	id, tipo: 'contactor', bornes: [{ id: 'A1' }, { id: 'A2' }], designacion, numero,
});

test('una designación legacy sin numero también reserva su secuencia visible', () => {
	const original = contactor('km1', '-KM1');
	assert.deepEqual(identidadParaCopia(original, [original]), { numero: 2, designacion: '-KM2' });
	assert.equal(original.numero, undefined, 'no se modifica la fuente');
});

test('la copia respeta números persistidos, ceros de formato y rótulos ocupados', () => {
	const original = contactor('km1', '=M+T-KM01');
	const lista = [original, contactor('km2', '=M+T-KM02', 2),
		contactor('km3', '=M+T-KM04'), contactor('km4', 'otro', 3)];
	assert.deepEqual(identidadParaCopia(original, lista), { numero: 5, designacion: '=M+T-KM05' });
	assert.deepEqual(identidadParaCopia(original, [...lista].reverse()),
		identidadParaCopia(original, lista), 'el orden de arrays no asigna la identidad');
});

test('sin designación explícita se usa la clase sin publicar un número desnudo', () => {
	const original = contactor('km1');
	assert.deepEqual(identidadParaCopia(original, [original]), { numero: 1, designacion: '-K1' });
	const conRotuloSinNumero = contactor('km0', 'KM');
	assert.deepEqual(identidadParaCopia(conRotuloSinNumero, [conRotuloSinNumero]),
		{ numero: 1, designacion: 'KM1' });
});
