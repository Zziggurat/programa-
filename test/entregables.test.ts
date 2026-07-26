/**
 * Tests de los entregables: rótulos de bornes y exportación a DXF. Son archivos que salen del
 * programa hacia una impresora o hacia AutoCAD, así que lo que se comprueba es que digan lo
 * correcto y que el formato sea el que esos programas esperan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores } from '../src/motores/numeracion.js';
import { tiraDeAparatos, tirasDeBorneros, todasLasTiras } from '../src/motores/etiquetas.js';
import { CAPAS, generarDXF, rectangulo, sinAcentos } from '../src/motores/dxf.js';

function conBornero(): Proyecto {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', descripcion: 'Bornero de fuerza', bornes: [
			{ id: '1', tipo: 'L' }, { id: '2', tipo: 'N' }, { id: 'PE', tipo: 'PE' },
		] },
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', descripcion: 'Contactor de bomba', bornes: [
			{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
		] },
		{ id: 'm1', tipo: 'motor', designacion: '-M1', descripcion: 'Motor 1.5 kW', campo: true, bornes: [{ id: 'U' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'x1', borneId: '1' }, a: { dispositivoId: 'km1', borneId: 'A1' }, seccion: 1.5 },
	];
	const pot = calcularPotenciales(p);
	numerarConductores(p, pot);
	return p;
}

/* -------------------------------- Rótulos -------------------------------- */

test('tirasDeBorneros: una tira por bornero, con una etiqueta por borna', () => {
	const tiras = tirasDeBorneros(conBornero());
	assert.equal(tiras.length, 1);
	assert.equal(tiras[0].titulo, '-X1');
	assert.deepEqual(tiras[0].etiquetas.map((e) => e.principal), ['1', '2', 'PE']);
});

test('tirasDeBorneros: la etiqueta dice a dónde va el hilo (que es para lo que sirve)', () => {
	const t = tirasDeBorneros(conBornero())[0];
	const borna1 = t.etiquetas.find((e) => e.principal === '1')!;
	assert.match(borna1.secundaria ?? '', /-KM1:A1/, `salió "${borna1.secundaria}"`);
});

test('tirasDeBorneros: la etiqueta lleva el número del hilo', () => {
	const t = tirasDeBorneros(conBornero())[0];
	assert.match(t.etiquetas.find((e) => e.principal === '1')?.secundaria ?? '', /hilo /);
});

test('tirasDeBorneros: una borna sin conectar sale igualmente (hay que rotularla)', () => {
	const t = tirasDeBorneros(conBornero())[0];
	const pe = t.etiquetas.find((e) => e.principal === 'PE')!;
	assert.ok(pe, 'la borna PE debe tener su etiqueta');
	assert.equal(pe.secundaria, undefined, 'sin conexión, sin línea secundaria inventada');
});

test('tiraDeAparatos: solo los del tablero, ordenados y con su descripción', () => {
	const t = tiraDeAparatos(conBornero());
	assert.deepEqual(t.etiquetas.map((e) => e.principal), ['-KM1', '-X1']);
	assert.equal(t.etiquetas[0].secundaria, 'Contactor de bomba');
	assert.ok(!t.etiquetas.some((e) => e.principal === '-M1'), 'el motor es de campo: no va en el tablero');
});

test('todasLasTiras: junta borneros y aparatos, sin tiras vacías', () => {
	const tiras = todasLasTiras(conBornero());
	assert.equal(tiras.length, 2);
	assert.ok(tiras.every((t) => t.etiquetas.length > 0));
});

test('todasLasTiras: un proyecto vacío no genera tiras (y no revienta)', () => {
	assert.deepEqual(todasLasTiras(crearProyecto('vacío')), []);
});

test('las imágenes de referencia no se rotulan', () => {
	const p = conBornero();
	p.dispositivos.push({ id: 'img', tipo: 'bornero', designacion: 'foto', imagen: 'data:,x', bornes: [{ id: 'p1' }] });
	assert.ok(!tirasDeBorneros(p).some((t) => t.titulo === 'foto'));
});

/* ---------------------------------- DXF ---------------------------------- */

test('generarDXF: el archivo tiene la estructura que espera cualquier CAD', () => {
	const dxf = generarDXF([{ capa: 'PLACA', trazo: { tipo: 'linea', x1: 0, y1: 0, x2: 10, y2: 10 } }], 100);
	assert.match(dxf, /^0\nSECTION/, 'empieza por una sección');
	assert.match(dxf, /2\nHEADER/);
	assert.match(dxf, /2\nTABLES/);
	assert.match(dxf, /2\nENTITIES/);
	assert.match(dxf, /0\nEOF\n$/, 'y termina en EOF');
	assert.equal((dxf.match(/0\nSECTION/g) ?? []).length, 3);
	assert.equal((dxf.match(/0\nENDSEC/g) ?? []).length, 3, 'cada sección se cierra');
});

test('generarDXF: declara todas las capas con su color', () => {
	const dxf = generarDXF([], 100);
	for (const c of CAPAS) assert.match(dxf, new RegExp(`2\\n${c.nombre}\\n`), `falta la capa ${c.nombre}`);
});

test('generarDXF: las unidades quedan en milímetros', () => {
	assert.match(generarDXF([], 100), /9\n\$INSUNITS\n70\n4/);
});

test('generarDXF: invierte la Y (el modelo la tiene abajo; el CAD, arriba)', () => {
	const dxf = generarDXF([{ capa: 'PLACA', trazo: { tipo: 'linea', x1: 0, y1: 0, x2: 0, y2: 100 } }], 100);
	assert.match(dxf, /20\n100\.000/, 'y=0 del modelo → y=alto en CAD');
	assert.match(dxf, /21\n0\.000/, 'y=100 del modelo → y=0 en CAD');
});

test('generarDXF: escribe líneas, círculos y textos con sus códigos de grupo', () => {
	const dxf = generarDXF([
		{ capa: 'CABLES', trazo: { tipo: 'linea', x1: 1, y1: 2, x2: 3, y2: 4 } },
		{ capa: 'APARATOS', trazo: { tipo: 'circulo', x: 5, y: 6, r: 7 } },
		{ capa: 'TEXTO', trazo: { tipo: 'texto', x: 8, y: 9, texto: 'K1', alto: 3 } },
	], 50);
	assert.match(dxf, /0\nLINE\n8\nCABLES/);
	assert.match(dxf, /0\nCIRCLE\n8\nAPARATOS/);
	assert.match(dxf, /0\nTEXT\n8\nTEXTO/);
	assert.match(dxf, /40\n7\.000/, 'el radio del círculo');
	assert.match(dxf, /1\nK1\n/, 'el texto');
});

test('sinAcentos: el DXF R12 no admite acentos, así que se transliteran', () => {
	assert.equal(sinAcentos('Protección núm. 1'), 'Proteccion num. 1');
	assert.equal(sinAcentos('-Q1'), '-Q1', 'lo que ya es ASCII no se toca');
	assert.equal(sinAcentos('línea ×2 →'), 'linea 2 ');
});

test('rectangulo: se cierra sobre sí mismo (4 líneas que forman el contorno)', () => {
	const r = rectangulo('PLACA', 10, 20, 100, 50);
	assert.equal(r.length, 4);
	const puntos = r.map((e) => e.trazo as { x1: number; y1: number; x2: number; y2: number });
	assert.equal(puntos[3].x2, puntos[0].x1, 'la última línea vuelve al origen');
	assert.equal(puntos[3].y2, puntos[0].y1);
	for (let i = 0; i < 4; i++) {
		assert.equal(puntos[i].x2, puntos[(i + 1) % 4].x1, `el tramo ${i} enlaza con el siguiente`);
		assert.equal(puntos[i].y2, puntos[(i + 1) % 4].y1);
	}
});
