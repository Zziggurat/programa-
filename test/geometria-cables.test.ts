/**
 * Tests de la geometría de los cables (recorrido ortogonal estilo Tinkercad).
 * Blindan el arreglo del bug por el que arrastrar un punto «se comía» una coordenada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	Banda, carrilesDe, corredoresLibres, dentroDelArea, distPuntoSegmento,
	fueraDeLaHuella, longitudSolapada, orthogonalize, Punto, rutaAutomatica,
} from '../app/geometria-cables.js';
import { COLOR_CABLE, colorDeCable } from '../app/escena3d.js';

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

/* --------------------- Amontonamiento (cables montados unos sobre otros) --------------------- */

test('longitudSolapada: dos tramos horizontales encimados se miden', () => {
	const a: Punto[] = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
	const b: Punto[] = [{ x: 40, y: 50 }, { x: 200, y: 50 }];
	assert.equal(longitudSolapada(a, b), 60); // se pisan de x=40 a x=100
});

test('longitudSolapada: tramos separados o perpendiculares no cuentan', () => {
	const a: Punto[] = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
	assert.equal(longitudSolapada(a, [{ x: 0, y: 90 }, { x: 100, y: 90 }]), 0, 'separados en Y');
	assert.equal(longitudSolapada(a, [{ x: 50, y: 0 }, { x: 50, y: 100 }]), 0, 'perpendiculares (se cruzan)');
});

test('rutaAutomatica: cables en paralelo (bornes distintos) no quedan montados', () => {
	// Caso real: cinco cables que van de una fila de bornes a otra, cada uno desde su terminal.
	const corredores = corredoresLibres([], 0, 200);
	const rutas = [0, 1, 2, 3, 4].map((k) => {
		const a = { x: 20 + k * 25, y: 10 };   // bornes separados, como en un aparato real
		const b = { x: 200 + k * 25, y: 190 };
		return orthogonalize([a, ...rutaAutomatica(a, b, corredores, k), b]);
	});
	let solape = 0;
	for (let i = 0; i < rutas.length; i++) {
		for (let j = i + 1; j < rutas.length; j++) solape += longitudSolapada(rutas[i], rutas[j]);
	}
	assert.equal(solape, 0, `los cables no deben pisarse entre sí (solape ${solape} mm)`);
});

/* ---------------- Reparto por carriles: que ningún cable quede montado sobre otro ---------------- */

test('carrilesDe: los carriles salen del centro hacia los bordes y no se repiten', () => {
	const ys = carrilesDe({ y0: 0, y1: 100 });
	assert.ok(ys.length > 1, 'un corredor ancho tiene varios carriles');
	assert.equal(new Set(ys).size, ys.length, 'no hay carriles repetidos');
	// Con un número par de carriles no hay uno justo en el eje: vale el más cercano al centro.
	const paso = Math.abs(ys[0] - ys[1]);
	assert.ok(Math.abs(ys[0] - 50) <= paso, `el primer carril va por el centro (salió ${ys[0]})`);
	const d = ys.map((y) => Math.abs(y - 50));
	for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1] - 0.01, 'se van abriendo hacia los lados');
});

test('carrilesDe: un corredor estrecho da un único carril, por su centro', () => {
	assert.deepEqual(carrilesDe({ y0: 40, y1: 54 }), [47]);
});

test('dentroDelArea: una unión arrastrada lejos se queda en el borde, no en el vacío', () => {
	const area = { x0: -10, x1: 410, y0: -10, y1: 526 };
	assert.deepEqual(dentroDelArea({ x: 559, y: 239 }, area), { x: 410, y: 239 }, 'se sale por la derecha');
	assert.deepEqual(dentroDelArea({ x: -300, y: -900 }, area), { x: -10, y: -10 }, 'se sale por arriba a la izquierda');
	assert.deepEqual(dentroDelArea({ x: 200, y: 5000 }, area), { x: 200, y: 526 }, 'no baja de los prensaestopas');
});

test('dentroDelArea: un punto que ya está dentro no se toca', () => {
	const area = { x0: -10, x1: 410, y0: -10, y1: 526 };
	assert.deepEqual(dentroDelArea({ x: 120, y: 300 }, area), { x: 120, y: 300 });
});

test('fueraDeLaHuella: un punto encima de un aparato sale por el lado más cercano', () => {
	const h = [{ x: 100, y: 100, ancho: 100, alto: 50 }];
	// Muy pegado al borde izquierdo → sale por la izquierda.
	assert.deepEqual(fueraDeLaHuella({ x: 105, y: 120 }, h, 4), { x: 96, y: 120 });
	// Muy pegado al borde de arriba → sale por arriba.
	assert.deepEqual(fueraDeLaHuella({ x: 150, y: 103 }, h, 4), { x: 150, y: 96 });
	// Muy pegado al de abajo → sale por abajo.
	assert.deepEqual(fueraDeLaHuella({ x: 150, y: 148 }, h, 4), { x: 150, y: 154 });
});

test('fueraDeLaHuella: un punto que no está encima de nada no se toca', () => {
	const h = [{ x: 100, y: 100, ancho: 100, alto: 50 }];
	assert.deepEqual(fueraDeLaHuella({ x: 300, y: 300 }, h, 4), { x: 300, y: 300 });
	assert.deepEqual(fueraDeLaHuella({ x: 150, y: 300 }, h, 4), { x: 150, y: 300 });
});

test('fueraDeLaHuella: salir de un aparato no puede dejarte dentro del de al lado', () => {
	// Dos aparatos pegados: el hueco entre ellos es más estrecho que el margen.
	const h = [
		{ x: 100, y: 100, ancho: 50, alto: 50 },
		{ x: 152, y: 100, ancho: 50, alto: 50 },
	];
	const q = fueraDeLaHuella({ x: 148, y: 120 }, h, 4);
	const dentroDe = (r: { x: number; y: number; ancho: number; alto: number }) => q.x > r.x - 4 && q.x < r.x + r.ancho + 4 && q.y > r.y - 4 && q.y < r.y + r.alto + 4;
	assert.equal(h.some(dentroDe), false, `el punto ${JSON.stringify(q)} sigue encima de un aparato`);
});

/*
 * EL COLOR DE UN CABLE SALE DE LA TABLA, NO DE `Object.prototype`.
 *
 * `COLOR_CABLE[c.color]` a pelo tiene una trampa fácil de pasar por alto: el color viene del
 * archivo como texto libre y la tabla es un objeto literal, así que hereda de `Object.prototype`.
 * Con `color: "constructor"` la búsqueda devuelve una FUNCIÓN, no `undefined`, así que se cuela por
 * el `?? 0x…` y llega a `hexColor(fn)`, que hace `fn.toString(16)`: el código fuente de la función
 * metido en un `style="background:…"`.
 *
 * No es una inyección —de ahí no sale una comilla— pero es una búsqueda sobre un dato de entrada
 * que devuelve algo que no es un color, y es el patrón que persiguen TS3-P1-01 y TS3-P1-04.
 */

test('colorDeCable: los colores de la tabla salen tal cual', () => {
	assert.equal(colorDeCable('azul'), COLOR_CABLE['azul']);
	assert.equal(colorDeCable('verde/amarillo'), COLOR_CABLE['verde/amarillo']);
});

test('colorDeCable: un color desconocido cae al de por defecto', () => {
	assert.equal(colorDeCable('fucsia'), 0x546e7a);
	assert.equal(colorDeCable(undefined), 0x546e7a);
	assert.equal(colorDeCable(''), 0x546e7a);
	assert.equal(colorDeCable('fucsia', 0x888888), 0x888888);
});

test('colorDeCable: una clave de Object.prototype NO devuelve una función', () => {
	for (const veneno of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
		const c = colorDeCable(veneno);
		assert.equal(typeof c, 'number', `«${veneno}» devolvió ${typeof c}, no un número`);
		assert.equal(c, 0x546e7a, `«${veneno}» tiene que caer al color por defecto`);
	}
});
