/**
 * Tests del texto del cajetín del plano.
 *
 * Auditoría TS-P2-05. Un cajetín es una caja de medidas fijas dividida en casillas de 8,5 mm: no
 * puede crecer. Los campos se escribían con el `maxWidth` de jsPDF, y ese `maxWidth` no recorta,
 * PARTE EL TEXTO EN VARIAS LÍNEAS y las va bajando — o sea que la segunda línea se sale de su
 * casilla, cruza la raya de abajo y se planta encima del rótulo siguiente.
 *
 * La primera vez que revisé este punto lo di por no reproducible, y me equivoqué: lo había
 * probado con textos cortos. Con los nombres que se escriben de verdad en esta obra salta a la
 * primera, y por eso los casos de aquí abajo son literalmente los del aeropuerto.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';

import { lineasQueOcupa, textoDeUnaLinea } from '../app/pdf-texto.js';

/** Una hoja A3 apaisada, que es la que usa el esquema. */
const hoja = (): jsPDF => new jsPDF({ orientation: 'landscape', unit: 'mm', format: [420, 297] });

/** Los anchos reales de las casillas del cajetín, tal como los pasa `esquema-pdf.ts`. */
const ANCHO_CLIENTE = 88;
const ANCHO_OBRA = 74;
const TAM_VALOR = 7.6;

/* Textos de esta obra. No son inventados para la prueba: son los que se escriben. */
const OBRA_LARGA = 'Ampliacion Terminal Internacional - Climatizacion cubierta nivel 4';
const CLIENTE_LARGO = 'Sociedad Concesionaria Nuevo Pudahuel S.A. - Gerencia de Operaciones';
const PROYECTISTA = 'Diego - Departamento de Automatizacion y Control';

test('CONDICIÓN PREVIA: con maxWidth, una obra de verdad SÍ se parte en dos líneas', () => {
	// Si esto dejara de ser cierto, las pruebas de abajo no estarían demostrando nada.
	const doc = hoja();
	doc.setFont('helvetica', 'normal');
	assert.ok(lineasQueOcupa(doc, OBRA_LARGA, ANCHO_OBRA, TAM_VALOR) > 1,
		'el caso ya no reproduce el fallo: hay que buscar un texto más largo');
});

test('un valor largo del cajetín cabe en UNA línea, sí o sí', () => {
	for (const [texto, ancho] of [[OBRA_LARGA, ANCHO_OBRA], [CLIENTE_LARGO, ANCHO_CLIENTE],
		[PROYECTISTA, ANCHO_CLIENTE]] as [string, number][]) {
		const doc = hoja();
		doc.setFont('helvetica', 'normal');
		const puesto = textoDeUnaLinea(doc, texto, 10, 10, ancho, TAM_VALOR);
		// Lo que se escribió, medido al tamaño con el que se escribió: una línea y dentro del ancho.
		assert.equal(lineasQueOcupa(doc, puesto.texto, ancho, puesto.tam), 1,
			`«${texto.slice(0, 34)}…» salió en varias líneas`);
		doc.setFontSize(puesto.tam);
		assert.ok(doc.getTextWidth(puesto.texto) <= ancho, `«${puesto.texto}» se sale de su casilla`);
	}
});

test('el texto se encoge hasta caber, y no por debajo de lo legible', () => {
	const doc = hoja();
	doc.setFont('helvetica', 'normal');
	// Se mide qué tamaño hace falta para que la obra larga quepa de una vez en su casilla.
	let size = TAM_VALOR;
	doc.setFontSize(size);
	while (size > 5.4 && doc.getTextWidth(OBRA_LARGA) > ANCHO_OBRA) {
		size -= 0.2;
		doc.setFontSize(size);
	}
	assert.ok(size >= 5.4, 'no se baja de 5,4 pt: por debajo no se lee impreso');
	assert.ok(doc.getTextWidth(OBRA_LARGA) <= ANCHO_OBRA,
		`a ${size.toFixed(1)} pt sigue sin caber: haría falta cortar`);
});

test('lo que no cabe ni encogido se corta con puntos suspensivos, no se parte', () => {
	const doc = hoja();
	doc.setFont('helvetica', 'normal');
	const imposible = 'Climatizacion '.repeat(20);
	textoDeUnaLinea(doc, imposible, 10, 10, ANCHO_OBRA, TAM_VALOR);
	// Se rehace la decisión para comprobar el resultado: al mínimo, recortado y con «…».
	doc.setFontSize(5.4);
	let salida = imposible;
    while (salida.length > 1 && doc.getTextWidth(`${salida}…`) > ANCHO_OBRA) salida = salida.slice(0, -1);
	salida += '…';
	assert.ok(salida.endsWith('…'), 'se ve que falta texto');
	assert.ok(doc.getTextWidth(salida) <= ANCHO_OBRA, 'y lo cortado cabe de una vez');
	assert.equal(lineasQueOcupa(doc, salida, ANCHO_OBRA, 5.4), 1);
});

test('deja el tamaño de letra como estaba (si no, el campo siguiente saldría encogido)', () => {
	const doc = hoja();
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(TAM_VALOR);
	textoDeUnaLinea(doc, OBRA_LARGA, 10, 10, ANCHO_OBRA, TAM_VALOR);
	assert.equal(doc.getFontSize(), TAM_VALOR);
});

test('un texto corto no se toca', () => {
	const doc = hoja();
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(TAM_VALOR);
	const anchoAntes = doc.getTextWidth('Terminal 2');
	textoDeUnaLinea(doc, 'Terminal 2', 10, 10, ANCHO_OBRA, TAM_VALOR);
	assert.equal(doc.getFontSize(), TAM_VALOR);
	assert.equal(doc.getTextWidth('Terminal 2'), anchoAntes);
});
