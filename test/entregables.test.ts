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
import { nombreSeguroDeArchivo } from '../src/modelo/archivos.js';

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

/* ---- Validación como la haría un CAD al abrir el archivo ---- */

test('generarDXF: el archivo se parsea como pares (código, valor) sin descuadres', () => {
	const dxf = generarDXF([
		...rectangulo('PLACA', 0, 0, 380, 500),
		{ capa: 'RIELES', trazo: { tipo: 'linea', x1: 10, y1: 100, x2: 370, y2: 100 } },
		{ capa: 'APARATOS', trazo: { tipo: 'circulo', x: 100, y: 200, r: 12.5 } },
		{ capa: 'TEXTO', trazo: { tipo: 'texto', x: 20, y: 210, texto: '-Q1', alto: 4 } },
	], 500);

	const lineas = dxf.split('\n');
	assert.equal((lineas.length - 1) % 2, 0, 'cada código tiene que llevar su valor');
	const pares: [number, string][] = [];
	for (let i = 0; i + 1 < lineas.length; i += 2) {
		assert.match(lineas[i], /^-?\d+$/, `el código de la línea ${i} no es numérico`);
		pares.push([Number(lineas[i]), lineas[i + 1]]);
	}

	// Secciones bien abiertas y cerradas, sin anidar.
	let prof = 0;
	let maxProf = 0;
	for (const [cod, val] of pares) {
		if (cod === 0 && val === 'SECTION') { prof++; maxProf = Math.max(maxProf, prof); }
		if (cod === 0 && val === 'ENDSEC') prof--;
		assert.ok(prof >= 0, 'se cierra una sección que no estaba abierta');
	}
	assert.equal(prof, 0, 'quedan secciones sin cerrar');
	assert.equal(maxProf, 1, 'las secciones del DXF R12 no se anidan');
	assert.deepEqual(pares.at(-1), [0, 'EOF']);

	// Toda entidad declara su capa justo después, o el CAD la mete en la capa 0.
	for (let i = 0; i < pares.length; i++) {
		if (pares[i][0] === 0 && ['LINE', 'CIRCLE', 'TEXT'].includes(pares[i][1])) {
			assert.equal(pares[i + 1]?.[0], 8, `la entidad ${pares[i][1]} no declara capa`);
		}
	}
	// Ninguna coordenada puede ser basura.
	for (const [cod, val] of pares) {
		if ([10, 11, 20, 21, 30, 31, 40].includes(cod)) {
			assert.ok(Number.isFinite(Number(val)), `coordenada no numérica: ${cod}=${val}`);
		}
	}
});

test('generarDXF: nunca escribe caracteres que el DXF R12 no sepa representar', () => {
	const dxf = generarDXF([
		{ capa: 'TEXTO', trazo: { tipo: 'texto', x: 0, y: 0, texto: 'Ñandú «áéíóú» ±3° → protección', alto: 3 } },
	], 100);
	assert.ok(!/[^\x00-\x7F]/.test(dxf), 'se coló un carácter no ASCII');
	assert.ok(!/NaN|Infinity/.test(dxf));
	assert.match(dxf, /1\nNandu/, 'el texto se translitera, no se borra');
});

/* ------------------- Nombres de archivo de lo que se entrega ------------------- */

/**
 * El fallo que arreglan estas pruebas: un solo carácter fuera de ASCII en el atributo `download`
 * y el navegador TIRA EL NOMBRE ENTERO, guardando el archivo como «download» sin extensión.
 * Como los tableros se llaman «Climatización» o «Arranque estrella-triángulo», le pasaba a casi
 * todos los proyectos reales.
 */
test('las tildes se transliteran, no se borran: el nombre sigue leyéndose', () => {
	assert.equal(nombreSeguroDeArchivo('Climatización sala 3'), 'Climatizacion sala 3');
	assert.equal(nombreSeguroDeArchivo('Arranque estrella-triángulo'), 'Arranque estrella-triangulo');
	assert.equal(nombreSeguroDeArchivo('Diseño de la señal'), 'Diseno de la senal');
});

test('el nombre que sale es ASCII puro, que es lo que exige la descarga', () => {
	for (const bruto of [
		'Climatización', 'Tablero de distribución', 'UMA-3-343 · señales', 'Ñandú', 'Müller & Cía',
		'控制柜', 'Tablero 100 % útil',
	]) {
		const n = nombreSeguroDeArchivo(bruto);
		assert.ok(/^[A-Za-z0-9 ._-]*$/.test(n), `«${bruto}» → «${n}» no es ASCII seguro`);
		assert.ok(n.length > 0, `«${bruto}» se quedó sin nombre`);
	}
});

test('se quitan los caracteres que ningún sistema de archivos admite', () => {
	assert.equal(nombreSeguroDeArchivo('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
});

test('un nombre no puede acabar en punto ni en espacio (Windows lo rechaza)', () => {
	assert.equal(nombreSeguroDeArchivo('Tablero.'), 'Tablero');
	assert.equal(nombreSeguroDeArchivo('Tablero   '), 'Tablero');
});

test('un nombre imposible no deja el archivo sin nombre', () => {
	assert.equal(nombreSeguroDeArchivo('※※※'), 'tablero');
	assert.equal(nombreSeguroDeArchivo(''), 'tablero');
	assert.equal(nombreSeguroDeArchivo('   '), 'tablero');
});

test('los nombres largos se recortan, pero no a la nada', () => {
	const n = nombreSeguroDeArchivo('Tablero de climatización '.repeat(20));
	assert.ok(n.length <= 100, `${n.length} caracteres`);
	assert.ok(n.startsWith('Tablero de climatizacion'));
});

test('el DXF y la descarga comparten la misma transliteración', () => {
	// Si divergieran, el mismo tablero saldría con un nombre en el archivo y otro dentro del plano.
	assert.equal(sinAcentos('Climatización'), 'Climatizacion');
	assert.equal(nombreSeguroDeArchivo('Climatización'), 'Climatizacion');
});
