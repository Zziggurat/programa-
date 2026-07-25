/**
 * Tests de la geometría de los cables (recorrido ortogonal estilo Tinkercad).
 * Blindan el arreglo del bug por el que arrastrar un punto «se comía» una coordenada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	Banda, corredoresLibres, distPuntoSegmento, orthogonalize, Punto, rutaAutomatica,
} from '../app/geometria-cables.js';

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

/* ------------------------ Corredores libres y ruta automática ------------------------ */

test('corredoresLibres: devuelve las franjas sin aparatos y fusiona las solapadas', () => {
	const ocupadas: Banda[] = [{ y0: 20, y1: 60 }, { y0: 50, y1: 90 }, { y0: 150, y1: 180 }];
	const libres = corredoresLibres(ocupadas, 0, 250);
	// Libres esperados: 0-20, 90-150, 180-250 (las dos primeras ocupadas se fusionan en 20-90).
	assert.deepEqual(libres, [{ y0: 0, y1: 20 }, { y0: 90, y1: 150 }, { y0: 180, y1: 250 }]);
});

test('corredoresLibres: descarta franjas más finas que el mínimo', () => {
	const libres = corredoresLibres([{ y0: 10, y1: 100 }], 0, 200, 20);
	assert.deepEqual(libres, [{ y0: 100, y1: 200 }]); // la franja 0-10 es demasiado fina
});

test('corredoresLibres: sin aparatos, todo el alto es un corredor', () => {
	assert.deepEqual(corredoresLibres([], 0, 120), [{ y0: 0, y1: 120 }]);
});

test('rutaAutomatica: pasa por un corredor libre, no por encima de un aparato', () => {
	const ocupadas: Banda[] = [{ y0: 40, y1: 120 }];           // aparato entre 40 y 120
	const corredores = corredoresLibres(ocupadas, 0, 300);
	const r = rutaAutomatica({ x: 10, y: 30 }, { x: 200, y: 200 }, corredores, 0);
	assert.equal(r.length, 2, 'dos codos: baja, recorre el corredor y sube');
	assert.equal(r[0].y, r[1].y, 'el tramo intermedio es horizontal');
	const dentroDelAparato = r[0].y > 40 && r[0].y < 120;
	assert.ok(!dentroDelAparato, `el corredor ${r[0].y} no debe caer sobre el aparato (40-120)`);
});

test('rutaAutomatica: cables paralelos toman carriles distintos (no se solapan)', () => {
	const corredores = corredoresLibres([], 0, 200);
	const ys = [0, 1, 2, 3].map((k) => rutaAutomatica({ x: 0, y: 10 }, { x: 100, y: 190 }, corredores, k)[0].y);
	assert.equal(new Set(ys).size, ys.length, `cada carril debe tener su altura: ${ys.join(',')}`);
});

test('rutaAutomatica: bornes en la misma vertical no meten codos', () => {
	const corredores = corredoresLibres([], 0, 200);
	assert.deepEqual(rutaAutomatica({ x: 50, y: 10 }, { x: 50, y: 150 }, corredores, 0), []);
});
