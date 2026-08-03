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
	AjustesDossier, EstiloTrozo, SECCIONES_DOSSIER, TrozoTexto, altoDeLinea, altoDelTexto,
	aWinAnsi, bloquesEn, colorDossier, estiloDe, repartirEnLineas, saleSeccion, seccionesOrdenadas,
	textoPlano, tintaSobre,
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

/* ------------------- Personalización: quién firma y cómo se ve ------------------- */

test('el color del documento sale en componentes listos para el PDF', () => {
	assert.deepEqual(colorDossier({ color: '#ff8800' }), [255, 136, 0]);
	assert.deepEqual(colorDossier({ color: '#FF8800' }), [255, 136, 0], 'da igual mayúsculas');
});

test('un color imposible no rompe el dossier: se cae al azul de siempre', () => {
	const azul = colorDossier(undefined);
	assert.deepEqual(colorDossier({ color: 'rojo' }), azul);
	assert.deepEqual(colorDossier({ color: '#12345' }), azul, 'cinco dígitos no es un color');
	assert.deepEqual(colorDossier({}), azul);
});

test('la tinta de la cabecera se lee sobre CUALQUIER color corporativo', () => {
	// Con un corporativo amarillo, el blanco de siempre desaparecía.
	assert.deepEqual(tintaSobre([255, 214, 0]), [20, 24, 28], 'sobre amarillo, tinta oscura');
	assert.deepEqual(tintaSobre([43, 74, 111]), [255, 255, 255], 'sobre azul marino, tinta blanca');
	assert.deepEqual(tintaSobre([255, 255, 255]), [20, 24, 28]);
	assert.deepEqual(tintaSobre([0, 0, 0]), [255, 255, 255]);
});

test('sin orden guardado, los apartados salen en el orden del programa', () => {
	assert.deepEqual(
		seccionesOrdenadas(undefined).map((s) => s.id),
		SECCIONES_DOSSIER.map((s) => s.id),
	);
});

test('el orden guardado manda, y lo que no nombra se va detrás', () => {
	const ids = seccionesOrdenadas({ orden: ['bom', 'drc'] }).map((s) => s.id);
	assert.equal(ids[0], 'bom', 'lo primero que pidió');
	assert.equal(ids[1], 'drc');
	assert.equal(ids.length, SECCIONES_DOSSIER.length, 'no se pierde ningún apartado');
	const natural = SECCIONES_DOSSIER.map((s) => s.id).filter((id) => !['bom', 'drc'].includes(id));
	assert.deepEqual(ids.slice(2), natural, 'el resto conserva su orden natural');
});

test('un apartado NUEVO del programa no desaparece de un dossier viejo', () => {
	// El orden guardado el año pasado no conoce el apartado que se añadió después: tiene que salir
	// al final, no dejar de salir.
	const ids = seccionesOrdenadas({ orden: ['ficha', 'bom'] }).map((s) => s.id);
	for (const s of SECCIONES_DOSSIER) assert.ok(ids.includes(s.id), `${s.id} sigue en el documento`);
});

/* ------------- Lo que las fuentes del PDF saben escribir ------------- */

test('el texto normal pasa intacto, con acentos y todo', () => {
	assert.equal(aWinAnsi('Relé térmico 7–10 A (regulado a 8,5 A) · «señal»'),
		'Relé térmico 7–10 A (regulado a 8,5 A) · «señal»');
});

test('la flecha que rompía la tabla de componentes se escribe como se diría', () => {
	// El caso real: «Temporizador a la conexión, 6 s (estrella→triángulo)» reventaba la fila.
	assert.equal(aWinAnsi('estrella→triángulo'), 'estrella->triángulo');
});

test('los signos técnicos se traducen en vez de perderse', () => {
	assert.equal(aWinAnsi('≤ 10 Ω'), '<= 10 ohm');
	assert.equal(aWinAnsi('probado ✓'), 'probado OK');
	assert.equal(aWinAnsi('I ≥ 16 A'), 'I >= 16 A');
});

test('lo que no se puede escribir ni traducir se quita, no se deja romper el PDF', () => {
	const salida = aWinAnsi('Tablero 🔌 de cubierta 🏗️');
	assert.ok(salida.includes('Tablero') && salida.includes('de cubierta'), salida);
	assert.ok(!/[\u{1F000}-\u{1FAFF}]/u.test(salida), 'no queda ningún emoji');
});

test('nada de lo que devuelve puede romper la fuente del PDF', () => {
	const bruto = 'μΩ→✓ 25 °C ± 2 · «prueba» — final… 🔥 ㎡';
	for (const c of aWinAnsi(bruto)) {
		const code = c.codePointAt(0) ?? 0;
		const vale = code === 9 || code === 10 || (code >= 32 && code <= 126)
			|| (code >= 160 && code <= 255) || '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(c);
		assert.ok(vale, `«${c}» (U+${code.toString(16)}) no lo sabe escribir el PDF`);
	}
});
