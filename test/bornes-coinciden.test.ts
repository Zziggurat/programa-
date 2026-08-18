/**
 * EL TORNILLO QUE SE VE Y EL PUNTO DEL QUE SALE EL CABLE SON EL MISMO.
 *
 * Este fallo estuvo meses a la vista sin que nadie lo llamara fallo, porque no rompe nada: el
 * programa arranca, los cables se dibujan y las pruebas pasan. Lo que pasaba es esto.
 *
 * `anclajeBorne()` enganchaba TODOS los cables a una profundidad fija de 46 mm. Mientras tanto,
 * cada modelo 3D pintaba su fila de bornes donde le venía bien:
 *
 *     disyuntor      prof - 14  =  60      contactor      prof - 16  =  68
 *     guardamotor    prof - 18  =  72      variador       prof - 12  = 108
 *     relé auxiliar             =  16      pulsador                  =   6
 *
 * O sea: el cable nacía a catorce milímetros por detrás del tornillo del que decía salir, y en el
 * pulsador a cuarenta. Y como esas profundidades caían DENTRO del cuerpo macizo del aparato, las
 * filas de bornes estaban sepultadas en el plástico: geometría que no se veía y que solo servía
 * para interpenetrar con la carcasa.
 *
 * Encima, el número de tornillos era inventado —«tres arriba y tres abajo» en el contactor— sin
 * mirar cuántos bornes tiene el aparato: uno de diez bornes enseñaba seis tornillos.
 *
 * La cura es que haya UNA función que diga dónde está cada borne, y que la usen los dos lados.
 * Aquí se comprueba que siga siendo así, porque la forma de romperlo es volver a escribir un
 * número a mano en cualquiera de los dos sitios.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dispositivo } from '../src/modelo/tipos.js';
import { bornesGenericos, Z_BORNE } from '../app/dispositivos3d.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (ruta: string): string => readFileSync(join(raiz, ruta), 'utf8');

const aparato = (tipo: string, bornes: string[]): Dispositivo => ({
	id: 'X1', tipo, etiqueta: '-X1',
	bornes: bornes.map((id) => ({ id, tipo: 'L' })),
} as unknown as Dispositivo);

test('cada borne del aparato tiene su punto, y no se repiten', () => {
	const d = aparato('contactor', ['1', '2', '3', '4', '5', '6', 'A1', 'A2']);
	const puntos = bornesGenericos(d, 45, 77);
	assert.equal(puntos.length, 8, 'salen tantos puntos como bornes tiene el aparato');
	assert.equal(new Set(puntos.map((p) => p.id)).size, 8, 'no se pierde ni se duplica ninguno');
	// Pares arriba, impares abajo: es el 1/3/5 contra 2/4/6 de toda la vida.
	const arriba = puntos.filter((p) => p.dy < 77 / 2).map((p) => p.id);
	assert.deepEqual(arriba, ['1', '3', '5', 'A1']);
});

test('los puntos caen dentro de la huella del aparato', () => {
	const d = aparato('disyuntor', ['1', '2', '3', '4', '5', '6']);
	for (const p of bornesGenericos(d, 54, 85)) {
		assert.ok(p.dx > 0 && p.dx < 54, `dx fuera de la huella: ${p.dx}`);
		assert.ok(p.dy > 0 && p.dy < 85, `dy fuera de la huella: ${p.dy}`);
	}
});

test('una bornera es una hilera, no dos filas', () => {
	// Con el reparto en dos filas, una regleta de doce bornas anclaba los cables en SEIS
	// posiciones a lo ancho, así que ninguno caía sobre su bloque: media regleta sin cables y
	// la otra media con dos por borna.
	const d = aparato('bornero', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
	const puntos = bornesGenericos(d, 120, 60);
	assert.equal(new Set(puntos.map((p) => p.dy)).size, 1, 'todas las bornas en la misma línea');
	assert.equal(new Set(puntos.map((p) => p.dx)).size, 12, 'cada borna en su propio bloque');
	const orden = [...puntos].sort((a, b) => a.dx - b.dx).map((p) => p.id);
	assert.deepEqual(orden, d.bornes.map((b) => b.id), 'el orden a lo ancho es el de la regleta');
});

test('un aparato sin bornes no inventa ninguno', () => {
	assert.deepEqual(bornesGenericos(aparato('otro', []), 40, 60), []);
});

test('el anclaje del cable usa la MISMA función que el dibujo', () => {
	const escena = leer('app/escena3d.ts');
	assert.match(escena, /bornesGenericos/,
		'anclajeBorne() tiene que preguntar dónde está el borne, no recalcularlo por su cuenta');
	assert.doesNotMatch(escena, /const arriba = idx % 2 === 0/,
		'el reparto en dos filas no puede estar copiado dentro del anclaje');
	// La cota de conexión es una sola y se importa; escrita a mano vuelve a poder desalinearse.
	assert.doesNotMatch(escena, /return \{ x[^}]*z: 4[46] \}/,
		'la profundidad del anclaje se escribe con Z_BORNE, no con un número suelto');
});

test('ningún modelo 3D pinta sus bornes a una profundidad propia', () => {
	const modelos = leer('app/dispositivos3d.ts');
	/*
	 * `filaBornes(g, n, ancho, y, z)` era la puerta por la que entraba el fallo: cada modelo le
	 * pasaba SU número de bornes y SU profundidad. Ya no existe; hay un solo camino, y pasa por
	 * la lista de bornes que el aparato tiene de verdad.
	 */
	assert.doesNotMatch(modelos, /function filaBornes/,
		'volver a tener una fila de bornes «a ojo» es volver a poder desalinearla del cable');
	// Lo que se vigila es que se le pase el APARATO, no la aridad exacta de la llamada: el
	// argumento de tinta se añadió al serigrafiar la numeración y no cambia de dónde salen los
	// bornes. Atar la prueba al texto literal la convertía en un guardián de la firma.
	assert.match(modelos, /dibujarBornesReales\(g, d, w, h[,)]/,
		'los bornes se dibujan a partir de los que el aparato tiene de verdad');
	// Y el único sitio que fija la profundidad del tornillo es la constante compartida.
	const conZ = modelos.match(/borneTornillo\([^)]*\)/g) ?? [];
	for (const llamada of conZ) {
		assert.ok(llamada.split(',').length - 1 <= 3, `borneTornillo con profundidad propia: ${llamada}`);
	}
});

test('la cota de conexión es la que esperan los dos lados', () => {
	// Si alguien la mueve, que sea a propósito: cambiarla desplaza el arranque de TODOS los cables.
	assert.equal(Z_BORNE, 46);
});
