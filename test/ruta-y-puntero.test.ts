/**
 * EL CABLE QUE SE VE Y EL CABLE CON EL QUE TRABAJA EL RATÓN TIENEN QUE SER EL MISMO.
 *
 * Los tres fallos que Diego describe —«el punto aparece alejado del cable según el ángulo»,
 * «la unión se crea donde no toca» y «hago clic exactamente encima y no lo encuentra»— son el
 * mismo fallo contado tres veces: cada parte del editor SUPONÍA por dónde pasaba el cable en vez
 * de mirarlo. Aquí se prueba la aritmética que ahora lo mira, que es la que no puede fallar.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { distanciaASegmento, indiceDeInsercion, proyectarEnPolilinea } from '../app/edicion-cables.js';
import { tenderCable } from '../app/geometria-cables.js';

/** Un recorrido que sube, se mete a 30 mm de profundidad y vuelve a salir. */
const RECORRIDO = [
	{ x: 0, y: 0, z: 66 },
	{ x: 100, y: 0, z: 66 },
	{ x: 100, y: 0, z: 30 },
	{ x: 300, y: 0, z: 30 },
	{ x: 300, y: 0, z: 66 },
	{ x: 400, y: 0, z: 66 },
];

test('un punto sin profundidad lee la del recorrido, no una por defecto', () => {
	/*
	 * Éste es exactamente el caso del tirador descolocado: el punto de peinado dice «x=200, y=0» y
	 * el cable ahí corre por dentro de una canaleta, a 30 mm. Poniendo el tirador a una profundidad
	 * fija —55 mm, que es lo que se hacía— la bolita queda 25 mm por delante del cable, y con la
	 * cámara inclinada eso son centímetros de separación en pantalla.
	 */
	const en = proyectarEnPolilinea(RECORRIDO, { x: 200, y: 0 });
	assert.ok(en, 'el recorrido tiene puntos');
	assert.equal(en!.punto.z, 30, `el tirador se pondría a z=${en!.punto.z} y el cable va a 30`);
	assert.equal(en!.punto.x, 200);
});

test('con profundidad, la proyección distingue dos tramos que en planta se pisan', () => {
	// En planta, (100,0) pertenece a tres tramos distintos: solo la z dice a cuál.
	const arriba = proyectarEnPolilinea(RECORRIDO, { x: 100, y: 0, z: 66 });
	const abajo = proyectarEnPolilinea(RECORRIDO, { x: 100, y: 0, z: 30 });
	assert.equal(arriba!.distancia, 0);
	assert.equal(abajo!.distancia, 0);
	assert.ok(arriba!.indice < abajo!.indice, 'el punto de arriba va antes que el de abajo');
});

test('una unión nueva entra en el sitio que le toca del peinado', () => {
	const trazado = [{ x: 100, y: 0, z: 30 }, { x: 300, y: 0, z: 30 }];
	// Antes del primero, entre los dos, y después del segundo.
	const antes = proyectarEnPolilinea(RECORRIDO, { x: 50, y: 0, z: 66 })!;
	const enMedio = proyectarEnPolilinea(RECORRIDO, { x: 200, y: 0, z: 30 })!;
	const despues = proyectarEnPolilinea(RECORRIDO, { x: 350, y: 0, z: 66 })!;
	assert.equal(indiceDeInsercion(RECORRIDO, trazado, antes.indice + antes.t), 0);
	assert.equal(indiceDeInsercion(RECORRIDO, trazado, enMedio.indice + enMedio.t), 1);
	assert.equal(indiceDeInsercion(RECORRIDO, trazado, despues.indice + despues.t), 2);
});

test('la distancia al segmento es la del punto más cercano, no la del vértice', () => {
	assert.equal(distanciaASegmento(50, 10, 0, 0, 100, 0), 10);
	// Fuera del segmento manda el extremo.
	assert.equal(distanciaASegmento(-30, 0, 0, 0, 100, 0), 30);
});

test('un rodeo puesto a mano NO se borra; el temblor de dos milímetros sí', () => {
	/*
	 * La limpieza de idas y vueltas miraba solo el ÁNGULO, y con eso un rodeo de medio metro y un
	 * temblor de dos milímetros son la misma cosa: «un pliegue de 170°». Por esa puerta
	 * desaparecía un punto colocado a mano sobre un aparato —el cable subía a buscarlo y volvía a
	 * bajar—, y el recorrido acababa dibujado a 155 mm de donde el usuario lo había dejado.
	 */
	const conRodeo = tenderCable([
		{ x: 94, y: 626, z: 30 },
		{ x: 59, y: 90, z: 70 },   // el punto del usuario: sube 536 mm y vuelve a bajar
		{ x: 59, y: 243, z: 46 },
	], 12);
	const cerca = conRodeo.reduce((m, p) => Math.min(m, Math.hypot(p.x - 59, p.y - 90, p.z - 70)), Infinity);
	assert.ok(cerca < 20, `el rodeo del usuario se perdió: lo más cerca que pasa el cable son ${cerca.toFixed(0)} mm`);

	// Y lo que sí es basura de encadenar tramos calculados por separado se sigue tirando.
	const conTemblor = tenderCable([
		{ x: 0, y: 0, z: 46 },
		{ x: 100, y: 0, z: 46 },
		{ x: 98, y: 0, z: 46 },    // avanza y retrocede 2 mm: eso no es una esquina
		{ x: 98, y: 200, z: 46 },
	], 12);
	// Sin el vértice de vuelta atrás, ningún punto se pasa de x=100.
	assert.ok(
		conTemblor.every((p) => p.x <= 100.01),
		'el temblor de dos milímetros debería haberse limpiado',
	);
});
