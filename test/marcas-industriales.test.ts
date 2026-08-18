/**
 * LA SERIGRAFÍA TIENE QUE DECIR LO QUE EL APARATO DECLARA.
 *
 * Estas pruebas no miran píxeles: protegen la LÓGICA de la que salen las marcas. El riesgo real
 * no es que un carácter se vea borroso —eso se mira con los ojos— sino que el dibujo y el modelo
 * se separen: que un contactor enseñe «1/L1» donde el cable se conecta a otro sitio, o que un
 * relé de interposición aparezca con una escala de tiempo que ese aparato no tiene. Un simulador
 * que enseña datos que no son los suyos es peor que uno que no enseña nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bornesGenericos } from '../app/dispositivos3d.js';
import { Dispositivo } from '../src/modelo/tipos.js';

const leer = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

function aparato(tipo: string, bornes: string[]): Dispositivo {
	return { id: 'x', tipo, bornes: bornes.map((id) => ({ id })) } as unknown as Dispositivo;
}

test('cada borne declarado tiene su punto, y con SU identificador', () => {
	// Los identificadores de un contactor no son decorativos: son los de la norma, y son los que
	// usa el cable. Si el reparto perdiera uno por el camino, quedaría un tornillo sin nombre.
	const km = aparato('contactor', ['1/L1', '3/L2', '5/L3', '2/T1', '4/T2', '6/T3', 'A1', 'A2', '13', '14']);
	const puntos = bornesGenericos(km, 45, 85);
	assert.equal(puntos.length, km.bornes.length, 'un punto por borne declarado');
	assert.deepEqual(
		[...puntos.map((p) => p.id)].sort(),
		[...km.bornes.map((b) => b.id)].sort(),
		'los identificadores dibujados son los del aparato, ni uno más ni uno menos',
	);
});

test('la numeración de una regleta sigue el orden de su definición', () => {
	const x1 = aparato('bornero', ['U1', 'V1', 'W1', 'U2', 'V2', 'W2', 'PE']);
	const puntos = [...bornesGenericos(x1, 90, 60)].sort((a, b) => a.dx - b.dx);
	assert.deepEqual(puntos.map((p) => p.id), x1.bornes.map((b) => b.id),
		'la borna número tres de la regleta es la tercera empezando por la izquierda');
});

test('la serigrafía se dibuja con el identificador del borne, no con un contador', () => {
	const modelos = leer('app/dispositivos3d.ts');
	assert.match(modelos, /marca\(p\.id,/,
		'el texto de la marca sale de borne.id: cualquier otra cosa sería un número inventado');
});

test('las marcas no interceptan el ratón', () => {
	// Un rótulo de dos milímetros pegado sobre un borne se pondría por delante del propio borne
	// en el raycast. Es la clase de detalle que no se nota hasta que no se puede cablear.
	assert.match(leer('app/marcas3d.ts'), /raycast = \(\) => \{\}/,
		'una marca serigrafiada nunca puede robarle el clic a la pieza que rotula');
});

test('el atlas comparte una sola textura entre todas las marcas', () => {
	const src = leer('app/marcas3d.ts');
	const creaciones = src.match(/new THREE\.CanvasTexture/g) ?? [];
	assert.equal(creaciones.length, 1, 'una textura para todo el programa, no una por rótulo');
});

test('solo lleva escala de tiempo el aparato que de verdad temporiza', () => {
	const modelos = leer('app/dispositivos3d.ts');
	assert.match(modelos, /releAux\(g, w, h, COLOR_TIPO\.rele, !!d\.temporizacion\)/,
		'un relé de interposición no tiene dial de tiempo: enseñarlo sería un mando que no existe');
});

test('un térmico se distingue por su rango de regulación, que es un dato real', () => {
	assert.match(leer('app/dispositivos3d.ts'), /d\.rangoRegulacionA\s*$/m,
		'el discriminante del térmico sale de la ficha del aparato, no de su nombre');
});
