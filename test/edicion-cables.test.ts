/**
 * BLOQUEAR UN EJE TIENE QUE BLOQUEARLO DE VERDAD.
 *
 * «Bloqueo Z» quiere decir que X e Y valen EXACTAMENTE lo que valían, no aproximadamente. Es la
 * diferencia entre poder decir «este tramo va treinta milímetros más adentro» y tener que aceptar
 * que además se ha corrido un poco de lado.
 *
 * Lo que hace esto difícil no es la aritmética, es el ORDEN. Al mover un punto pasan tres cosas
 * después de leer el ratón: se recorta al área de cableado, se alinea con los vecinos para que los
 * tramos queden rectos, y se encaja en la canaleta si hay una cerca. Las tres mueven coordenadas
 * por su cuenta y con buen criterio. Si el bloqueo se aplicara antes que ellas, cualquiera de las
 * tres podría deshacerlo y el bloqueo sería una sugerencia. Por eso va al final, y por eso se
 * prueba con valores que las tres habrían cambiado.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { normalDeArrastre, respetarBloqueo } from '../app/edicion-cables.js';

test('con Z bloqueada, X e Y no se mueven ni una décima', () => {
	const ancla = { x: 120, y: 340, z: 46 };
	// Lo que llega es un punto que el recorte, el alineado y el encaje ya han movido de sitio.
	const movido = { x: 187.4, y: 299.1, z: 18 };
	const r = respetarBloqueo(movido, { eje: 'z', ancla });
	assert.equal(r.x, 120, 'la X se ha movido con el eje Z bloqueado');
	assert.equal(r.y, 340, 'la Y se ha movido con el eje Z bloqueado');
	assert.equal(r.z, 18, 'la profundidad sí tiene que poder cambiar');
});

test('con X bloqueada solo cambia X, y con Y solo Y', () => {
	const ancla = { x: 100, y: 200, z: 46 };
	const movido = { x: 155, y: 260, z: 12 };
	const enX = respetarBloqueo(movido, { eje: 'x', ancla });
	assert.deepEqual(enX, { x: 155, y: 200, z: 46 });
	const enY = respetarBloqueo(movido, { eje: 'y', ancla });
	assert.deepEqual(enY, { x: 100, y: 260, z: 46 });
});

test('sin bloqueo el punto pasa tal cual', () => {
	const p = { x: 5, y: 6, z: 7 };
	assert.deepEqual(respetarBloqueo(p, undefined), p);
});

test('un punto sin profundidad sigue sin tenerla al bloquear X', () => {
	// Los peinados de siempre no llevan z, y bloquear un eje no puede inventársela: si apareciera,
	// el cable dejaría de depender de la capa que le busca el repartidor y cambiaría de sitio solo.
	const r = respetarBloqueo({ x: 9, y: 9 }, { eje: 'x', ancla: { x: 1, y: 2 } });
	assert.equal(r.z, undefined);
});

test('la cámara decide el plano de arrastre, y de lado es uno vertical', () => {
	// Mirando la placa de frente (la cámara apunta en −Z): se edita en X/Y.
	assert.deepEqual(normalDeArrastre({ x: 0, y: 0, z: -1 }, false), { x: 0, y: 0, z: 1 });
	// Desde el lateral (apunta en −X): el plano de la placa se vería de canto, así que se cambia.
	assert.deepEqual(normalDeArrastre({ x: -1, y: 0, z: 0 }, false), { x: 1, y: 0, z: 0 });
	// Desde arriba: el plano que queda de frente es el que contiene Y y Z.
	assert.deepEqual(normalDeArrastre({ x: 0, y: -1, z: 0.1 }, false), { x: 0, y: 1, z: 0 });
});

test('pedir profundidad fuerza el plano vertical aunque la cámara mire de frente', () => {
	/*
	 * Sin esto, pulsar Z mirando el tablero de frente no haría nada: en el plano de la placa la
	 * profundidad no cambia por definición, así que parecería que la tecla está rota.
	 */
	const n = normalDeArrastre({ x: 0, y: 0, z: -1 }, true);
	assert.notEqual(n.z, 1, 'de frente y pidiendo profundidad sigue usando el plano de la placa');
	assert.equal(n.x + n.y, 1, 'tiene que ser uno de los dos planos verticales');
});

test('el umbral de 0,55 está donde se dijo', () => {
	// Justo por encima: la cámara todavía mira la placa lo bastante de frente.
	assert.equal(normalDeArrastre({ x: 0.83, y: 0, z: -0.56 }, false).z, 1);
	// Justo por debajo: se pasa al plano vertical.
	assert.equal(normalDeArrastre({ x: 0.84, y: 0, z: -0.54 }, false).z, 0);
});
