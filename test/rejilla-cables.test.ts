import assert from 'node:assert/strict';
import test from 'node:test';

import { RejillaCables, Trazo } from '../app/colisiones-cables.js';

const trazo = (id: string, y: number): Trazo => ({
	id, radio: 1.5,
	puntos: [{ x: 0, y, z: 50 }, { x: 100, y, z: 50 }],
});

const entradas = (rejilla: RejillaCables): { total: number; obsoletas: number } => {
	const interna = rejilla as unknown as {
		casillas: Map<string, { clave: string }[]>;
		vigentes: Set<string>;
	};
	const barras = [...interna.casillas.values()].flat();
	return { total: barras.length, obsoletas: barras.filter((b) => !interna.vigentes.has(b.clave)).length };
};

test('retirar libera las celdas del tendido y no deja barras obsoletas', () => {
	const rejilla = new RejillaCables();
	const clave = rejilla.anadir(trazo('a', 0));
	assert.ok(entradas(rejilla).total > 0);
	assert.ok(rejilla.peorConflicto(trazo('consulta', 2), 1.2));
	rejilla.retirar(clave);
	assert.deepEqual(entradas(rejilla), { total: 0, obsoletas: 0 });
	assert.equal(rejilla.peorConflicto(trazo('consulta', 2), 1.2), undefined);
	rejilla.retirar(clave); // retirar dos veces no toca un tendido nuevo
	assert.deepEqual(entradas(rejilla), { total: 0, obsoletas: 0 });
});

test('add/retirar/add conserva orden y resultado exacto frente a una rejilla nueva', () => {
	const rejilla = new RejillaCables();
	const a = trazo('a', 0), b = trazo('b', 5), c = trazo('c', 10);
	rejilla.anadir(a);
	const claveB = rejilla.anadir(b);
	rejilla.anadir(c);
	rejilla.retirar(claveB);
	const bNueva = trazo('b', 20);
	rejilla.anadir(bNueva);
	const fresca = new RejillaCables();
	fresca.anadir(a);
	fresca.anadir(c);
	fresca.anadir(bNueva);
	assert.deepEqual(rejilla.peorConflicto(trazo('consulta', 2), 1.2),
		fresca.peorConflicto(trazo('consulta', 2), 1.2));
	assert.equal(entradas(rejilla).obsoletas, 0);
	assert.deepEqual(entradas(rejilla), entradas(fresca));
});

test('poda AABB conserva contacto justo dentro del margen y tangencia del límite', () => {
	const rejilla = new RejillaCables();
	rejilla.anadir(trazo('base', 0));
	// Dos radios de 1,5 mm y margen de 1,2 mm: el límite entre ejes es 4,2 mm.
	const dentro = rejilla.peorConflicto(trazo('dentro', 4.199), 1.2);
	assert.ok(dentro);
	assert.equal(dentro.b, 'base');
	assert.ok(dentro.holgura < 1.2);
	assert.equal(rejilla.peorConflicto(trazo('tangente', 4.2), 1.2), undefined);
	assert.equal(rejilla.peorConflicto(trazo('fuera', 4.201), 1.2), undefined);
});

test('cajas 3D que se solapan no ocultan el cruce real de dos segmentos', () => {
	const rejilla = new RejillaCables();
	rejilla.anadir(trazo('horizontal', 0));
	const vertical: Trazo = { id: 'vertical', radio: 1.5, puntos: [
		{ x: 50, y: -10, z: 50 }, { x: 50, y: 10, z: 50 },
	] };
	const cruce = rejilla.peorConflicto(vertical, 1.2);
	assert.ok(cruce);
	assert.equal(cruce.holgura, -3);
	assert.deepEqual(cruce.donde, { x: 50, y: 0, z: 50 });
});

test('sello multicíelda se renueva entre consultas, al reemplazar tendidos y al desbordar', () => {
	const rejilla = new RejillaCables(12); // una barra de 100 mm atraviesa varias celdas
	const clave = rejilla.anadir(trazo('a', 0));
	const consulta = trazo('consulta', 2);
	const esperado = rejilla.peorConflicto(consulta, 1.2);
	assert.ok(esperado);
	for (let i = 0; i < 5; i++) assert.deepEqual(rejilla.peorConflicto(consulta, 1.2), esperado);
	rejilla.retirar(clave);
	assert.equal(rejilla.peorConflicto(consulta, 1.2), undefined);
	rejilla.anadir(trazo('a', 0));
	assert.deepEqual(rejilla.peorConflicto(consulta, 1.2), esperado);
	const interna = rejilla as unknown as {
		visita: number;
		casillas: Map<string, { vistoEn: number }[]>;
	};
	// Peor caso: marcas viejas iguales al valor que reaparecerá tras volver a 1.
	for (const lista of interna.casillas.values()) for (const barra of lista) barra.vistoEn = 1;
	interna.visita = Number.MAX_SAFE_INTEGER;
	assert.deepEqual(rejilla.peorConflicto(consulta, 1.2), esperado);
	assert.equal(interna.visita, 1);
});
