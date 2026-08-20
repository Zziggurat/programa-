/**
 * LAS AYUDAS DEL FRONTAL AYUDAN, Y NADA MÁS.
 *
 * Es la misma regla que se peleó en los cables, aplicada a la otra cara del tablero: el usuario
 * coloca y el programa no recoloca. Estas pruebas fijan las dos mitades de esa frase —que la ayuda
 * hace algo útil cuando se le pide, y que no hace absolutamente nada cuando no— porque una ayuda
 * que se cuela es indistinguible de un fallo y solo se descubre a los tres tableros.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
	alinearFrontal, dentroDeLaHoja, imantarEnFrontal, PiezaFrontal, repartirFrontal,
} from '../app/edicion-frontal.js';

const pieza = (id: string, x: number, y: number, ancho = 22, alto = 22): PiezaFrontal =>
	({ id, clase: 'aparato', x, y, ancho, alto });

const SIN_AYUDAS = { imantar: false, tolerancia: 4 };
const CON_AYUDAS = { imantar: true, tolerancia: 4 };

test('con Alt no se toca ni una décima', () => {
	// `imantar: false` es lo que pone la tecla Alt. Con un vecino a un pelo y la rejilla encendida,
	// el punto tiene que salir EXACTAMENTE como entró.
	const r = imantarEnFrontal(
		{ x: 251.4, y: 69.6 }, [pieza('hr', 250, 70)], { ...SIN_AYUDAS, rejilla: 5 },
	);
	assert.equal(r.x, 251.4);
	assert.equal(r.y, 69.6);
	assert.equal(r.guias.length, 0, 'sin ayudas no puede haber guías');
});

test('manda el vecino antes que la rejilla', () => {
	/*
	 * Alinearse con la pieza de al lado es lo que uno quiere de verdad —tres pilotos a la misma
	 * altura— y la rejilla es la red de fondo. Con la rejilla primero, un vecino que no cayera en
	 * ella no se podría igualar NUNCA, que es justo el caso de un tablero heredado.
	 */
	const vecino = pieza('hr', 247, 70);       // 247 no es múltiplo de 5
	const r = imantarEnFrontal({ x: 249, y: 300 }, [vecino], { ...CON_AYUDAS, rejilla: 5 });
	assert.equal(r.x, 247, 'debería haberse igualado al vecino, no a la rejilla');
	assert.equal(r.y, 300, '300 ya está en la rejilla');
	assert.ok(r.guias.some((g) => g.eje === 'x' && g.con === 'hr'), 'falta la guía del vecino');
});

test('lejos de todo, la rejilla; y se dice que ha sido la rejilla', () => {
	const r = imantarEnFrontal({ x: 253, y: 68 }, [pieza('hr', 100, 400)], { ...CON_AYUDAS, rejilla: 10 });
	assert.equal(r.x, 250);
	assert.equal(r.y, 70);
	assert.ok(r.guias.every((g) => g.con === 'rejilla'));
});

test('el imantado no alcanza más allá de su tolerancia', () => {
	// A seis milímetros con tolerancia de cuatro, el vecino no pinta nada: el usuario está
	// colocando la pieza en otro sitio y no hay que adivinarle la intención.
	const r = imantarEnFrontal({ x: 256, y: 300 }, [pieza('hr', 250, 300)], CON_AYUDAS);
	assert.equal(r.x, 256);
});

test('el borde de la hoja se impone siempre, hasta con Alt', () => {
	/*
	 * No es una ayuda: fuera de la chapa no hay dónde hacer el taladro. Por eso `dentroDeLaHoja`
	 * es una función aparte de `imantarEnFrontal` y quien mueve las piezas la aplica SIEMPRE,
	 * lleve Alt apretado o no.
	 */
	const hoja = { ancho: 660, alto: 660 };
	const p = pieza('hx', 0, 0, 30, 30);
	assert.deepEqual(dentroDeLaHoja({ x: -50, y: -50 }, p, hoja), { x: 21, y: 21 });
	assert.deepEqual(dentroDeLaHoja({ x: 900, y: 900 }, p, hoja), { x: 639, y: 639 });
	// Y en medio no lo toca.
	assert.deepEqual(dentroDeLaHoja({ x: 330, y: 200 }, p, hoja), { x: 330, y: 200 });
});

test('alinear mueve solo lo que cambia', () => {
	const piezas = [pieza('a', 100, 50), pieza('b', 140, 62), pieza('c', 180, 50)];
	const cambios = alinearFrontal(piezas, 'centroY');
	// a y c ya estaban a 50; el centro de los tres es 54, así que se mueven los tres... salvo que
	// alguno ya coincida. Lo que importa es que NADIE que no cambie aparezca en el mapa.
	for (const [id, v] of cambios) {
		const original = piezas.find((p) => p.id === id)!;
		assert.notEqual(v.y, original.y, `${id} está en la lista de cambios y no cambia`);
	}
	// Con una sola pieza no hay nada con qué alinear: no se toca.
	assert.equal(alinearFrontal([pieza('a', 100, 50)], 'izquierda').size, 0);
});

test('alinear por un borde usa el borde, no el centro', () => {
	// Dos piezas de anchos distintos alineadas a la izquierda tienen que compartir CANTO, y por
	// tanto centros distintos. Alinear centros cuando se pidió cantos es el fallo clásico.
	const anchas = [pieza('a', 100, 50, 20, 20), pieza('b', 200, 50, 60, 20)];
	const cambios = alinearFrontal(anchas, 'izquierda');
	const b = cambios.get('b')!;
	assert.equal(b.x - 30, 100 - 10, 'los cantos izquierdos no coinciden');
});

test('repartir deja los extremos donde están y iguala las separaciones', () => {
	const piezas = [pieza('a', 100, 50), pieza('b', 137, 50), pieza('c', 190, 50), pieza('d', 400, 50)];
	const cambios = repartirFrontal(piezas, 'x');
	assert.ok(!cambios.has('a') && !cambios.has('d'), 'los extremos fijan el tramo y no se mueven');
	const b = cambios.get('b')!.x;
	const c = cambios.get('c')!.x;
	assert.equal(b, 200);
	assert.equal(c, 300);
	// Y con menos de tres no hay nada que repartir.
	assert.equal(repartirFrontal([pieza('a', 0, 0), pieza('b', 10, 0)], 'x').size, 0);
});
