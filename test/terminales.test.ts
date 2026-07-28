/**
 * Tests del motor de terminales: la geometría de las borneras declaradas por ficha de
 * datos. Es la única fuente de verdad compartida por el modelo 3D y el anclaje de los
 * cables, así que aquí se comprueba que las posiciones sean las que dice la ficha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Dispositivo } from '../src/modelo/tipos.js';
import {
	huellaMinima, leerRotulos, MARGEN_BORNERA, MAX_TERMINALES_BLOQUE, pasoDelBloque, posicionesDeTerminales,
} from '../src/motores/terminales.js';
import { bornesDeControlador, CONTROLADORES, naturalezaTerminal } from '../app/controladores.js';

const aparato = (terminales: Dispositivo['terminales']): Dispositivo => ({
	id: 'd1', tipo: 'plc', bornes: [], terminales,
});

test('sin borneras declaradas no impone ninguna posición', () => {
	assert.equal(posicionesDeTerminales(aparato(undefined), 100, 80).size, 0);
	assert.equal(posicionesDeTerminales(aparato([]), 100, 80).size, 0);
});

test('un bloque arriba reparte sus bornes a lo ancho, a la distancia del borde', () => {
	const d = aparato([{ lado: 'arriba', bornes: ['A', 'B', 'C', 'D'] }]);
	const p = posicionesDeTerminales(d, 100, 80);
	assert.deepEqual([...p.keys()], ['A', 'B', 'C', 'D']);
	// Centros de cuatro tramos de 25 mm: 12.5, 37.5, 62.5, 87.5.
	assert.deepEqual([...p.values()].map((x) => x.dx), [12.5, 37.5, 62.5, 87.5]);
	for (const t of p.values()) assert.equal(t.dy, MARGEN_BORNERA);
});

test('cada lado ancla en su borde y reparte por el eje que corresponde', () => {
	const d = aparato([
		{ lado: 'abajo', bornes: ['ab'] },
		{ lado: 'izquierda', bornes: ['iz'] },
		{ lado: 'derecha', bornes: ['de'] },
	]);
	const p = posicionesDeTerminales(d, 100, 80);
	assert.deepEqual(p.get('ab'), { ...p.get('ab')!, dx: 50, dy: 80 - MARGEN_BORNERA });
	assert.deepEqual(p.get('iz'), { ...p.get('iz')!, dx: MARGEN_BORNERA, dy: 40 });
	assert.deepEqual(p.get('de'), { ...p.get('de')!, dx: 100 - MARGEN_BORNERA, dy: 40 });
});

test('dos bloques en el mismo borde no se pisan', () => {
	const d = aparato([
		{ lado: 'arriba', desde: 0, hasta: 0.5, bornes: ['A', 'B'] },
		{ lado: 'arriba', desde: 0.5, hasta: 1, bornes: ['C', 'D'] },
	]);
	const p = posicionesDeTerminales(d, 100, 80);
	const xs = ['A', 'B', 'C', 'D'].map((k) => p.get(k)!.dx);
	assert.deepEqual(xs, [12.5, 37.5, 62.5, 87.5]);
	assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), 'las posiciones crecen sin solaparse');
});

test('un tramo inválido (hasta ≤ desde) no rompe: usa el lado entero', () => {
	const d = aparato([{ lado: 'arriba', desde: 0.8, hasta: 0.2, bornes: ['A', 'B'] }]);
	const p = posicionesDeTerminales(d, 100, 80);
	assert.deepEqual([...p.values()].map((x) => x.dx), [25, 75]);
});

test('un rótulo repetido en dos bloques lo gana el primero (no hay bornes ambiguos)', () => {
	const d = aparato([
		{ lado: 'arriba', bornes: ['COM'] },
		{ lado: 'abajo', bornes: ['COM'] },
	]);
	const p = posicionesDeTerminales(d, 100, 80);
	assert.equal(p.size, 1);
	assert.equal(p.get('COM')!.lado, 'arriba');
});

test('el paso del bloque es el largo del tramo repartido entre sus bornes', () => {
	assert.equal(pasoDelBloque({ lado: 'arriba', bornes: ['A', 'B', 'C', 'D'] }, 100, 80), 25);
	assert.equal(pasoDelBloque({ lado: 'izquierda', bornes: ['A', 'B'] }, 100, 80), 40);
	assert.equal(pasoDelBloque({ lado: 'arriba', desde: 0, hasta: 0.5, bornes: ['A'] }, 100, 80), 50);
});

test('la huella mínima crece con el bloque más apretado de cada eje', () => {
	const d = aparato([
		{ lado: 'arriba', desde: 0, hasta: 0.5, bornes: ['A', 'B', 'C', 'D'] }, // 4 bornes en medio lado
		{ lado: 'izquierda', bornes: ['E', 'F'] },
	]);
	const min = huellaMinima(d, 5);
	assert.equal(min.ancho, 40); // 4 × 5 mm / 0.5
	assert.equal(min.alto, 10);
});

/* --------------- Lectura de los rótulos de una bornera a medida --------------- */

test('lista simple separada por comas o por espacios', () => {
	assert.deepEqual(leerRotulos('UI1, UI2, UI3'), ['UI1', 'UI2', 'UI3']);
	assert.deepEqual(leerRotulos('A+ A- AS'), ['A+', 'A-', 'AS']);
	assert.deepEqual(leerRotulos('  '), []);
});

test('con comas NO se parte por espacios: "24V COM" es un solo terminal', () => {
	assert.deepEqual(leerRotulos('24V~, 24V COM, GND'), ['24V~', '24V COM', 'GND']);
});

test('expande rangos abreviados con y sin repetir el prefijo', () => {
	assert.deepEqual(leerRotulos('UI1-4'), ['UI1', 'UI2', 'UI3', 'UI4']);
	assert.deepEqual(leerRotulos('AO1-AO3'), ['AO1', 'AO2', 'AO3']);
	assert.deepEqual(leerRotulos('1-3'), ['1', '2', '3']);
	assert.deepEqual(leerRotulos('IN1-3, COM'), ['IN1', 'IN2', 'IN3', 'COM']);
});

test('no confunde un guion que no es un rango', () => {
	assert.deepEqual(leerRotulos('MS/TP+, MS/TP-, SHLD'), ['MS/TP+', 'MS/TP-', 'SHLD']);
	assert.deepEqual(leerRotulos('G-H, G-M, G-L'), ['G-H', 'G-M', 'G-L']);
	assert.deepEqual(leerRotulos('UI1-UO3'), ['UI1-UO3']); // prefijos distintos: no es un rango
});

test('no repite rótulos ni se dispara con un rango disparatado', () => {
	assert.deepEqual(leerRotulos('COM, COM, COM'), ['COM']);
	assert.deepEqual(leerRotulos('UI1-99999'), ['UI1-99999']); // se deja tal cual, no expande
	assert.ok(leerRotulos(Array.from({ length: 200 }, (_, i) => `T${i}`).join(',')).length
		=== MAX_TERMINALES_BLOQUE);
});

/* ------------------------- Fichas de controladores reales ------------------------- */

test('naturaleza de los terminales por su rótulo', () => {
	assert.equal(naturalezaTerminal('GND'), 'PE');
	assert.equal(naturalezaTerminal('PE'), 'PE');
	assert.equal(naturalezaTerminal('24V~'), 'control');
	assert.equal(naturalezaTerminal('24V COM'), 'control');
	assert.equal(naturalezaTerminal('G0'), 'control');
	assert.equal(naturalezaTerminal('G'), 'control');
	assert.equal(naturalezaTerminal('HOT'), 'control');
	assert.equal(naturalezaTerminal('UI1'), 'senal');
	assert.equal(naturalezaTerminal('MS/TP+'), 'senal');
	assert.equal(naturalezaTerminal('SHLD'), 'senal');
});

test('toda ficha de controlador es coherente y cabe en su propia huella', () => {
	assert.ok(CONTROLADORES.length >= 12, 'están los controladores del estudio de mercado');
	const ids = new Set<string>();
	for (const f of CONTROLADORES) {
		assert.ok(!ids.has(f.id), `id repetido: ${f.id}`);
		ids.add(f.id);
		assert.ok(f.ancho > 0 && f.alto > 0 && f.profundidad > 0, `${f.id}: medidas positivas`);
		assert.ok(f.bloques.length > 0, `${f.id}: declara al menos una bornera`);

		const d: Dispositivo = { id: f.id, tipo: 'plc', bornes: bornesDeControlador(f), terminales: f.bloques };
		// Todo borne del aparato tiene posición, y toda posición cae dentro de la huella.
		const p = posicionesDeTerminales(d, f.ancho, f.alto);
		assert.equal(p.size, d.bornes.length, `${f.id}: cada borne tiene su sitio`);
		for (const [id, t] of p) {
			assert.ok(t.dx >= 0 && t.dx <= f.ancho, `${f.id}/${id}: dentro del ancho`);
			assert.ok(t.dy >= 0 && t.dy <= f.alto, `${f.id}/${id}: dentro del alto`);
		}
		// Los terminales no pueden quedar tan juntos que no se puedan cablear.
		for (const b of f.bloques) {
			assert.ok(pasoDelBloque(b, f.ancho, f.alto) >= 4,
				`${f.id}: la bornera "${b.rotulo}" queda demasiado apretada`);
		}
		const min = huellaMinima(d, 4);
		assert.ok(f.ancho >= min.ancho && f.alto >= min.alto, `${f.id}: la huella da para sus borneras`);
	}
});

test('ninguna ficha repite un rótulo entre borneras', () => {
	// Un rótulo repetido se descartaría en silencio y el equipo saldría con menos terminales
	// de los que tiene: el fallo no se vería hasta intentar cablear el que falta.
	for (const f of CONTROLADORES) {
		const vistos = new Map<string, string | undefined>();
		for (const b of f.bloques) {
			for (const id of b.bornes) {
				assert.ok(!vistos.has(id),
					`${f.referencia}: el terminal "${id}" está en «${vistos.get(id)}» y en «${b.rotulo}»`);
				vistos.set(id, b.rotulo);
			}
		}
		assert.equal(bornesDeControlador(f).length, vistos.size, `${f.referencia}: no se pierde ningún terminal`);
	}
});

test('cada controlador declara de dónde salen sus medidas', () => {
	for (const f of CONTROLADORES) {
		assert.ok(f.medidas === 'hoja-de-datos' || f.medidas === 'nominal', f.id);
		assert.ok(f.fabricante && f.referencia, `${f.id}: marca y nº de pedido reales`);
	}
	// El equipo con el que trabaja el usuario (top 1 de Honeywell) va con medidas reales.
	const spyder = CONTROLADORES.find((f) => f.referencia === 'PUB6438S')!;
	assert.equal(spyder.medidas, 'hoja-de-datos');
});
