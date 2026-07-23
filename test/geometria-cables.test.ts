/**
 * Tests de la geometría de los cables (recorrido ortogonal estilo Tinkercad).
 * Blindan el arreglo del bug por el que arrastrar un punto «se comía» una coordenada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orthogonalize, distPuntoSegmento, Punto } from '../app/geometria-cables.js';

/** ¿Todos los tramos consecutivos son horizontales o verticales (nunca diagonales)? */
function esOrtogonal(pts: Punto[]): boolean {
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i];
		const b = pts[i + 1];
		if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) return false;
	}
	return true;
}

test('orthogonalize: dos puntos → recorrido ortogonal que conserva los extremos', () => {
	const r = orthogonalize([{ x: 0, y: 0 }, { x: 100, y: 50 }]);
	assert.ok(esOrtogonal(r));
	assert.deepEqual(r[0], { x: 0, y: 0 });
	assert.deepEqual(r.at(-1), { x: 100, y: 50 });
});

test('orthogonalize: un punto de quiebre es una esquina real y AMBAS coordenadas influyen', () => {
	const base = orthogonalize([{ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 100, y: 60 }]);
	assert.ok(esOrtogonal(base));
	assert.ok(base.some((p) => p.x === 40 && p.y === 30), 'el waypoint aparece como vértice');

	// El bug era que mover el punto en X no cambiaba el recorrido (dos tramos quedaban colineales).
	const movidoX = orthogonalize([{ x: 0, y: 0 }, { x: 70, y: 30 }, { x: 100, y: 60 }]);
	const movidoY = orthogonalize([{ x: 0, y: 0 }, { x: 40, y: 45 }, { x: 100, y: 60 }]);
	assert.notDeepEqual(base, movidoX, 'mover en X cambia el recorrido');
	assert.notDeepEqual(base, movidoY, 'mover en Y cambia el recorrido');
});

test('orthogonalize: varios puntos, todos presentes, ortogonal y sin NaN', () => {
	const wps: Punto[] = [{ x: 0, y: 0 }, { x: 30, y: 20 }, { x: 60, y: 80 }, { x: 90, y: 40 }, { x: 120, y: 100 }];
	const r = orthogonalize(wps);
	assert.ok(esOrtogonal(r));
	assert.ok(wps.every((w) => r.some((p) => p.x === w.x && p.y === w.y)));
	assert.ok(r.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('orthogonalize: puntos ya alineados no meten codos de más', () => {
	const r = orthogonalize([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 50 }]);
	assert.equal(r.length, 3);
	assert.ok(esOrtogonal(r));
});

test('distPuntoSegmento: distancia perpendicular y sobre el segmento', () => {
	assert.ok(Math.abs(distPuntoSegmento(5, 10, { x: 0, y: 0 }, { x: 10, y: 0 }) - 10) < 0.001);
	assert.ok(distPuntoSegmento(5, 0, { x: 0, y: 0 }, { x: 10, y: 0 }) < 0.001);
});
