/**
 * Tests del dossier editable: qué apartados salen, y sobre todo el REPARTO DEL TEXTO EN LÍNEAS,
 * que es donde está la lógica de verdad — cortar un párrafo donde cabe sabiendo que dentro hay
 * trozos en negrita, en cursiva, de otro tamaño y de otra fuente.
 *
 * Se mide con una regla de mentira (cada carácter mide lo mismo) a propósito: así se comprueba el
 * reparto y no la métrica de una fuente concreta, que es cosa del PDF.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	AjustesDossier, EstiloTrozo, TrozoTexto, altoDeLinea, altoDelTexto, bloquesEn, estiloDe,
	repartirEnLineas, saleSeccion, textoPlano,
} from '../src/modelo/dossier.js';

/** Regla de mentira: 2 mm por carácter, y el doble si el tamaño es el doble. */
const regla = (texto: string, e: EstiloTrozo): number => texto.length * 2 * (e.tam / 10);

const lineasDe = (ls: ReturnType<typeof repartirEnLineas>): string[] =>
	ls.map((l) => l.trozos.map((t) => t.texto).join('').trimEnd());

/* --------------------------------- Apartados --------------------------------- */

test('por defecto salen todos los apartados', () => {
	for (const id of ['ficha', 'bom', 'termico', 'anexo']) {
		assert.equal(saleSeccion(undefined, id), true, `${id} no sale sin haberlo apagado`);
	}
});

test('un apartado se puede quitar', () => {
	const a: AjustesDossier = { secciones: { bom: false } };
	assert.equal(saleSeccion(a, 'bom'), false);
	assert.equal(saleSeccion(a, 'ficha'), true, 'apagar uno no apaga los demás');
});

test('la verificación y la procedencia NO se pueden quitar', () => {
	// Entregar un dossier escondiendo si el tablero tiene faltas es justo lo que no debe poderse.
	const a: AjustesDossier = { secciones: { drc: false, procedencia: false } };
	assert.equal(saleSeccion(a, 'drc'), true, 'se ha podido esconder la verificación');
	assert.equal(saleSeccion(a, 'procedencia'), true);
});

test('los bloques van a donde se les dice', () => {
	const a: AjustesDossier = {
		bloques: [
			{ id: '1', tipo: 'texto', donde: 'portada', trozos: [{ texto: 'A' }] },
			{ id: '2', tipo: 'texto', donde: 'final', trozos: [{ texto: 'B' }] },
			{ id: '3', tipo: 'imagen', donde: 'portada', imagen: 'data:,' },
		],
	};
	assert.deepEqual(bloquesEn(a, 'portada').map((b) => b.id), ['1', '3']);
	assert.deepEqual(bloquesEn(a, 'final').map((b) => b.id), ['2']);
	assert.deepEqual(bloquesEn(a, 'principio'), []);
	assert.deepEqual(bloquesEn(undefined, 'portada'), []);
});

/* ---------------------------------- Formato ---------------------------------- */

test('el formato del trozo manda sobre el del bloque, y el del bloque sobre el de la casa', () => {
	assert.deepEqual(estiloDe({ texto: 'x' }), { negrita: false, cursiva: false, tam: 10, fuente: 'helvetica' });
	assert.deepEqual(estiloDe({ texto: 'x' }, { tam: 14, fuente: 'times' }),
		{ negrita: false, cursiva: false, tam: 14, fuente: 'times' });
	assert.deepEqual(estiloDe({ texto: 'x', negrita: true, tam: 22 }, { tam: 14 }),
		{ negrita: true, cursiva: false, tam: 22, fuente: 'helvetica' });
});

test('una línea es más alta cuanto mayor es la letra', () => {
	assert.ok(altoDeLinea(22) > altoDeLinea(10));
	assert.ok(altoDeLinea(10) > 3 && altoDeLinea(10) < 6, `${altoDeLinea(10)} mm para 10 pt`);
});

/* ------------------------------ Reparto en líneas ------------------------------ */

test('un texto corto cabe en una línea', () => {
	const l = repartirEnLineas([{ texto: 'hola mundo' }], 100, regla);
	assert.equal(l.length, 1);
	assert.deepEqual(lineasDe(l), ['hola mundo']);
});

test('un texto largo se corta por espacios, no por la mitad de una palabra', () => {
	const l = repartirEnLineas([{ texto: 'uno dos tres cuatro cinco' }], 20, regla);
	assert.ok(l.length > 1, 'no ha cortado');
	for (const linea of lineasDe(l)) {
		assert.ok(!linea.startsWith(' '), `«${linea}» empieza con espacio`);
	}
	assert.equal(lineasDe(l).join(' '), 'uno dos tres cuatro cinco', 'se ha perdido o duplicado texto');
});

test('una palabra que no cabe ni ella sola se deja sobresalir, no se parte', () => {
	// Partir una referencia de catálogo por la mitad la vuelve ilegible; una línea larga se ve.
	const l = repartirEnLineas([{ texto: 'a LC1D09BD-ABCDEFGHIJK b' }], 10, regla);
	assert.ok(lineasDe(l).includes('LC1D09BD-ABCDEFGHIJK'),
		`se ha partido la palabra: ${JSON.stringify(lineasDe(l))}`);
});

test('el salto de línea que escribe una persona se respeta', () => {
	const l = repartirEnLineas([{ texto: 'primera\nsegunda' }], 500, regla);
	assert.deepEqual(lineasDe(l), ['primera', 'segunda']);
});

test('y una línea en blanco entre párrafos también', () => {
	const l = repartirEnLineas([{ texto: 'uno\n\ndos' }], 500, regla);
	assert.deepEqual(lineasDe(l), ['uno', '', 'dos']);
});

test('los formatos se mantienen al repartir: la negrita sigue en negrita', () => {
	const trozos: TrozoTexto[] = [
		{ texto: 'normal ' },
		{ texto: 'GRUESO', negrita: true },
		{ texto: ' y cursiva', cursiva: true },
	];
	const l = repartirEnLineas(trozos, 500, regla);
	assert.equal(l.length, 1);
	const grueso = l[0].trozos.find((t) => t.texto.includes('GRUESO'));
	assert.ok(grueso?.estilo.negrita, 'la negrita se perdió');
	assert.ok(l[0].trozos.some((t) => t.estilo.cursiva), 'la cursiva se perdió');
	assert.ok(l[0].trozos.some((t) => !t.estilo.negrita && !t.estilo.cursiva), 'todo salió con formato');
});

test('una línea con letra grande y pequeña mezcladas es tan alta como la mayor', () => {
	const l = repartirEnLineas([{ texto: 'pequeño ' }, { texto: 'GRANDE', tam: 28 }], 500, regla);
	assert.equal(l.length, 1);
	assert.equal(l[0].alto, altoDeLinea(28), 'la línea se queda a la altura de la letra pequeña');
});

test('el texto en 28 puntos ocupa menos palabras por línea que en 10', () => {
	const texto = 'uno dos tres cuatro cinco seis siete ocho';
	const chico = repartirEnLineas([{ texto }], 60, regla);
	const grande = repartirEnLineas([{ texto, tam: 28 }], 60, regla);
	assert.ok(grande.length > chico.length,
		`10 pt: ${chico.length} líneas, 28 pt: ${grande.length}`);
});

test('un texto vacío no produce líneas', () => {
	assert.deepEqual(repartirEnLineas([], 100, regla), []);
	assert.deepEqual(repartirEnLineas([{ texto: '' }], 100, regla), []);
});

test('el alto total es la suma de las líneas', () => {
	const l = repartirEnLineas([{ texto: 'uno dos tres cuatro cinco seis' }], 20, regla);
	assert.equal(altoDelTexto(l), l.reduce((s, x) => s + x.alto, 0));
	assert.ok(altoDelTexto(l) > 0);
});

test('nada de lo escrito se pierde por el camino, con cualquier ancho', () => {
	// La prueba que de verdad importa: si el reparto se come una palabra, el cliente recibe un
	// documento con una frase mutilada y nadie se entera hasta que es tarde.
	const trozos: TrozoTexto[] = [
		{ texto: 'Tablero de climatización ' },
		{ texto: 'UMA-3-343', negrita: true },
		{ texto: ' con controlador Honeywell XL50 y bornera de 24 señales.' },
	];
	const esperado = textoPlano(trozos).replace(/\s+/g, ' ').trim();
	for (const ancho of [15, 30, 60, 120, 400]) {
		const salida = lineasDe(repartirEnLineas(trozos, ancho, regla)).join(' ').replace(/\s+/g, ' ').trim();
		assert.equal(salida, esperado, `con ${ancho} mm de ancho el texto sale distinto`);
	}
});
