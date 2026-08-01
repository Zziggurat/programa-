/**
 * Tests del levantamiento: el parte de obra y las tiradas medidas en la cubierta.
 *
 * Lo que se prueba aquí no es dibujo, es el papel que uno se lleva: que los metros se agrupan
 * como se pide el cable, que un parte guardado a medias se puede volver a abrir, y que lo que
 * nadie ha tocado cuenta como pendiente y no desaparece de la cuenta.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Infraestructura } from '../src/modelo/infraestructura.js';
import {
	Tirada, avanceObra, estadosPorTag, leerLevantamiento, levantamientoVacio, listaDePedido,
	parteDeObraCSV, tiradasCSV,
} from '../src/motores/levantamiento.js';

const planta = (tags: string[]): Infraestructura => ({
	nombre: 'Cubierta de prueba',
	origen: { archivo: 'prueba.dwg', capas: [] },
	zona: { x0: 0, y0: 0, x1: 1000, y1: 1000 },
	equipos: tags.map((tag, i) => ({
		tag, tagSeguro: true, tipo: i % 2 ? 'vex' : 'uma',
		x: 0, y: 0, ancho: 2000, fondo: 1000,
		controlador: 'XL50_CH8_17', enTablero: false,
		puntos: [{ sigla: 'VAF', que: 'Ventilador en marcha', clase: 'DI' }],
	})),
	trazas: [],
} as unknown as Infraestructura);

const tirada = (t: Partial<Tirada>): Tirada => ({
	id: t.id ?? 'x', nombre: t.nombre ?? 'Tirada', metros: t.metros ?? 10,
	recorrido: t.recorrido ?? 9, seccion: t.seccion ?? 2.5, conductores: t.conductores ?? 4,
	fecha: '2026-08-01T10:00:00.000Z', desde: t.desde, hasta: t.hasta,
});

/* ------------------------------ La lista de pedido ------------------------------ */

test('el cable se pide por manguera: se agrupa por hilos Y sección', () => {
	// Nadie pide «120 metros de 2,5»: pide «120 metros de 4×2,5». Un 3×2,5 y un 4×2,5 son dos
	// carretes distintos aunque la sección sea la misma.
	const lista = listaDePedido([
		tirada({ conductores: 4, seccion: 2.5, metros: 40 }),
		tirada({ conductores: 4, seccion: 2.5, metros: 22 }),
		tirada({ conductores: 3, seccion: 2.5, metros: 15 }),
		tirada({ conductores: 2, seccion: 0.75, metros: 30 }),
	]);
	assert.deepEqual(lista.map((f) => [f.cable, f.metros, f.tiradas]), [
		['2 × 0,75 mm²', 30, 1],
		['3 × 2,5 mm²', 15, 1],
		['4 × 2,5 mm²', 62, 2],
	]);
});

test('los metros se redondean HACIA ARRIBA: el cable se corta entero', () => {
	const lista = listaDePedido([tirada({ metros: 12.2 }), tirada({ metros: 7.5 })]);
	assert.equal(lista[0].metros, 20, 'pedir 19,7 m deja la última tirada corta');
});

test('sin tiradas no hay nada que pedir', () => {
	assert.deepEqual(listaDePedido([]), []);
});

/* -------------------------------- El parte de obra -------------------------------- */

test('lo que nadie ha tocado cuenta como pendiente, no desaparece', () => {
	const inf = planta(['UMA-1', 'UMA-2', 'VEX-1']);
	const l = levantamientoVacio();
	l.notas['UMA-1'] = { tag: 'UMA-1', estado: 'probado', nota: '', fecha: '2026-08-01' };
	const avance = avanceObra(l, inf);
	const de = (e: string) => avance.find((a) => a.estado === e)!.cuantos;
	assert.equal(de('probado'), 1);
	assert.equal(de('pendiente'), 2, 'las dos sin anotar tienen que seguir contando');
	assert.equal(avance.reduce((s, a) => s + a.cuantos, 0), inf.equipos.length);
});

test('el estado de cada máquina sale listo para colorear el 3D', () => {
	const l = levantamientoVacio();
	l.notas['UMA-1'] = { tag: 'UMA-1', estado: 'problema', nota: 'falta prensaestopas', fecha: '2026-08-01' };
	const m = estadosPorTag(l);
	assert.equal(m.get('UMA-1'), 'problema');
	assert.equal(m.get('UMA-9'), undefined, 'no se inventa un estado para lo que no está anotado');
});

/* --------------------------- Volver a abrir lo guardado --------------------------- */

test('un parte guardado se vuelve a abrir tal cual', () => {
	const original = levantamientoVacio();
	original.notas['UMA-1'] = { tag: 'UMA-1', estado: 'montado', nota: 'sin probar', fecha: '2026-07-30T09:00:00.000Z' };
	original.tiradas.push(tirada({ id: 't1', nombre: 'Tablero → UMA-1', metros: 38, conductores: 7, seccion: 1 }));
	const vuelta = leerLevantamiento(JSON.parse(JSON.stringify(original)));
	assert.deepEqual(vuelta, original);
});

test('un parte roto no impide abrir la herramienta: se salva lo que se pueda', () => {
	// Es la diferencia entre perder una anotación y perder la jornada entera.
	const l = leerLevantamiento({
		notas: {
			'UMA-1': { estado: 'inventado', nota: 'vale' },
			'UMA-2': 'esto no es una nota',
		},
		tiradas: [
			{ nombre: 'buena', metros: 20, seccion: 4, conductores: 3 },
			{ nombre: 'sin metros' },
			'ni esto',
		],
	});
	assert.equal(l.notas['UMA-1'].estado, 'pendiente', 'un estado que no existe se degrada, no rompe');
	assert.equal(l.notas['UMA-1'].nota, 'vale');
	assert.equal(l.notas['UMA-2'], undefined);
	assert.equal(l.tiradas.length, 1, 'una tirada sin metros no es una tirada');
	assert.equal(l.tiradas[0].nombre, 'buena');
});

test('cualquier cosa que no sea un levantamiento devuelve uno vacío', () => {
	for (const basura of [undefined, null, 7, 'texto', []]) {
		assert.deepEqual(leerLevantamiento(basura), levantamientoVacio());
	}
});

/* ---------------------------------- Llevárselo ---------------------------------- */

test('el parte en CSV lleva los datos del plano junto a lo anotado', () => {
	const inf = planta(['UMA-1', 'VEX-1']);
	const l = levantamientoVacio();
	l.notas['UMA-1'] = {
		tag: 'UMA-1', estado: 'problema', nota: 'falta el prensaestopas; ojo', fecha: '2026-08-01T10:00:00.000Z',
	};
	const texto = parteDeObraCSV(l, inf);
	const filas = texto.split('\n');
	assert.ok(filas[0].startsWith('Máquina;Tipo;Controlador'), filas[0]);
	assert.equal(filas.length, 2, 'solo se lista lo anotado, no las 129 máquinas');
	assert.ok(filas[1].includes('UMA-1;UMA;XL50_CH8_17;1;Con problema'), filas[1]);
	assert.ok(filas[1].includes('"falta el prensaestopas; ojo"'),
		'un punto y coma dentro de la nota tiene que ir entrecomillado o parte la columna');
	assert.ok(filas[1].endsWith('2026-08-01'));
});

test('el CSV de tiradas termina con la lista de cable a pedir', () => {
	const l = levantamientoVacio();
	l.tiradas.push(tirada({ nombre: 'A', metros: 30, desde: 'UMA-1', hasta: 'Tablero' }));
	l.tiradas.push(tirada({ nombre: 'B', metros: 12 }));
	const filas = tiradasCSV(l).split('\n');
	assert.ok(filas[1].startsWith('A;UMA-1;Tablero;4 x 2,5 mm2'), filas[1]);
	assert.ok(filas.includes('CABLE A PEDIR'));
	assert.equal(filas[filas.length - 1], '4 × 2,5 mm²;2;42');
});
