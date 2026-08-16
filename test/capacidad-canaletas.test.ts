/**
 * LA CANALETA, ¿ESTÁ LLENA O MAL APROVECHADA?
 *
 * Estas comprobaciones vigilan el modelo de capacidad, no el reparto: que sepa distinguir un ducto
 * vacío de uno lleno, que cuente el hueco por geometría y no por carriles, y que la recomendación
 * de tamaño crezca con el cableado en vez de salir de una tabla fija.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ESPESOR, tramoDe } from '../app/canaletas-red.js';
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
