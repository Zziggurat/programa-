/**
 * LA CANALETA, ¿ESTÁ LLENA O MAL APROVECHADA?
 *
 * Estas comprobaciones vigilan el modelo de capacidad, no el reparto: que sepa distinguir un ducto
 * vacío de uno lleno, que cuente el hueco por geometría y no por carriles, y que la recomendación
 * de tamaño crezca con el cableado en vez de salir de una tabla fija.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ESPESOR, RedCanaletas, tramoDe } from '../app/canaletas-red.js';
import {
	auditarTramo, medidaRecomendada, seccionNecesaria,
} from '../app/capacidad-canaletas.js';

const CANALETA = { id: 'c1', orientacion: 'h' as const, x: 0, y: 100, largo: 300, ancho: 40, alto: 60 };

/** Un cable recto a lo largo del ducto, a la altura y transversal que se le diga. */
const tendido = (id: string, radio: number, y: number, z: number) => ({
	id, radio, puntos: [{ x: 0, y, z }, { x: 300, y, z }],
});

test('un ducto vacío tiene sitio para el cable más gordo', () => {
	const a = auditarTramo(tramoDe(CANALETA), [], 3);
	assert.equal(a.estado, 'libre');
	assert.ok(a.radioLibreMinimo >= 3, `hueco ${a.radioLibreMinimo}`);
});

test('el hueco se mide por geometría, no por carriles: entre dos cables separados todavía cabe uno', () => {
	/*
	 * Es la comprobación que da sentido al módulo. Dos cables a 20 mm uno de otro dejan un hueco
	 * de sobra para un tercero, aunque el router no tenga ninguna posición discreta ahí en medio.
	 * Si esto fallara, «lleno» significaría «se me acabaron los carriles», que es justo lo que no
	 * se quería medir.
	 */
	const a = auditarTramo(tramoDe(CANALETA), [
		tendido('a', 3, 90, 20), tendido('b', 3, 110, 20),
	], 3);
	assert.ok(a.radioLibreMinimo >= 3, `queda hueco para Ø${(a.radioLibreMinimo * 2).toFixed(1)}`);
});

test('un ducto de verdad lleno se declara saturado', () => {
	// Rejilla apretada de cables gordos: ya no cabe ni el más fino.
	const cables = [];
	for (let y = 85; y <= 115; y += 7.5) {
		for (let z = 6; z <= 56; z += 7.5) cables.push(tendido(`c${y}-${z}`, 3, y, z));
	}
	const a = auditarTramo(tramoDe(CANALETA), cables, 3);
	assert.equal(a.estado, 'saturada');
	assert.ok(a.ocupacionMaxima > 0.35, `ocupación ${a.ocupacionMaxima}`);
});

test('la sección necesaria crece con el cableado y la medida recomendada la cubre', () => {
	const pocos = seccionNecesaria([1.4, 1.4, 1.4]);
	const muchos = seccionNecesaria(Array.from({ length: 30 }, () => 3));
	assert.ok(muchos > pocos * 10, `${muchos} frente a ${pocos}`);
	const medida = medidaRecomendada(muchos, 3, ESPESOR);
	assert.ok(medida, 'hay una medida que da esa sección');
	assert.ok((medida!.ancho - 2 * ESPESOR) * (medida!.alto - ESPESOR) >= muchos);
	// Y la boca tiene que dejar pasar el cable más gordo, o la medida no sirve de nada.
	assert.ok(medida!.ancho - 2 * ESPESOR >= 3 * 2);
});

test('una canaleta con sitio dentro pero sin ranuras libres NO se llama llena', () => {
	/*
	 * La distinción que pedía la fase: el ducto va casi vacío —dos cables— pero los dos han
	 * entrado por la única ranura que tiene, así que no admite un tercero. Eso es una entrada
	 * congestionada, no una canaleta llena, y el motivo tiene que decirlo.
	 */
	const corta = { ...CANALETA, largo: 40 };   // da para dos dientes, o sea una sola ranura
	const t = tramoDe(corta);
	assert.equal(t.ranuras.length, 1);
	const boca = t.ranuras[0];
	const entra = (id: string) => ({
		id, radio: 3,
		puntos: [
			{ x: boca, y: 70, z: 46 }, { x: boca, y: 118, z: 46 }, { x: boca, y: 118, z: 20 },
		],
	});
	const a = auditarTramo(t, [entra('a'), entra('b')], 3);
	assert.equal(a.ranurasSaturadas, 1);
	assert.match(a.motivo, /ranura/);
});

test('el router encuentra la ruta horizontal → vertical → horizontal', () => {
	/*
	 * LA BARRERA CONTRA LA LIMITACIÓN QUE COSTÓ TRES FASES DESCUBRIR.
	 *
	 * Durante mucho tiempo el generador sólo componía recorridos de uno o dos ductos, y como
	 * ningún tablero de la biblioteca lo dejaba ver a las claras, la limitación pasó desapercibida
	 * hasta que se midió que las canaletas iban al 3 % de su capacidad mientras los cables
	 * pasaban por delante. Este escenario es el mínimo que la delata: dos horizontales que NO se
	 * tocan entre sí, unidas sólo por una vertical, y un cable que tiene que ir de una a otra.
	 *
	 * No depende de ningún ejemplo de la biblioteca: si alguien vuelve a limitar el router a dos
	 * tramos, esto se pone rojo.
	 */
	const canaletas = [
		{ id: 'h1', orientacion: 'h' as const, x: 0, y: 100, largo: 400, ancho: 40, alto: 60 },
		{ id: 'h2', orientacion: 'h' as const, x: 0, y: 400, largo: 400, ancho: 40, alto: 60 },
		{ id: 'v1', orientacion: 'v' as const, x: 200, y: 80, largo: 340, ancho: 40, alto: 60 },
	];
	const red = new RedCanaletas(canaletas);
	// La topología tiene que ver las dos uniones y ninguna entre las horizontales.
	assert.ok(red.cruceEntre('h1', 'v1'), 'h1 se cruza con la vertical');
	assert.ok(red.cruceEntre('h2', 'v1'), 'h2 se cruza con la vertical');
	assert.ok(!red.cruceEntre('h1', 'h2'), 'las dos horizontales no se tocan');
	// Y el camino entre ellas tiene que existir pasando por la vertical: tres tramos.
	const ruta = red.camino('h1', 'h2');
	assert.deepEqual(ruta, ['h1', 'v1', 'h2']);
});
