import test from 'node:test';
import assert from 'node:assert/strict';

import { compararPrioridadCable, PrioridadCable } from '../app/picking-cables.js';

const cable = (id: string, pixeles: number, radio: number, profundidad: number): PrioridadCable =>
	({ id, pixeles, radio, profundidad });

test('un tubo realmente señalado gana a una mera zona de tolerancia', () => {
	const visible = cable('visible', 2, 3, 120);
	const cercano = cable('cercano', 1, 0.5, 100);
	assert.ok(compararPrioridadCable(visible, cercano) < 0);
});

test('entre dos tubos bajo el puntero gana el segmento visible más frontal', () => {
	const delante = cable('delante', 2, 3, 100);
	const detras = cable('detras', 0.2, 3, 110);
	assert.ok(compararPrioridadCable(delante, detras) < 0);
});

test('la selección actual solo conserva un empate real', () => {
	const a = cable('a', 2, 3, 100);
	const b = cable('b', 2.05, 3, 100.1);
	assert.ok(compararPrioridadCable(a, b, 'b') > 0, 'el seleccionado conserva un empate subpíxel');
	const claramenteDelante = cable('a', 2, 3, 95);
	assert.ok(compararPrioridadCable(claramenteDelante, b, 'b') < 0,
		'el seleccionado no puede robar el clic a un cable realmente frontal');
});

test('el desempate final es estable aunque cambie el orden del array', () => {
	const candidatos = [cable('w18', 2, 3, 100), cable('w2', 2, 3, 100), cable('w11', 2, 3, 100)];
	const ids = candidatos.slice().sort(compararPrioridadCable).map((c) => c.id);
	const invertidos = candidatos.slice().reverse().sort(compararPrioridadCable).map((c) => c.id);
	assert.deepEqual(invertidos, ids);
	assert.deepEqual(ids, ['w11', 'w18', 'w2']);
});
