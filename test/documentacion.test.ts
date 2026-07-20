/**
 * Tests del motor de documentación (BOM, CSV) sobre el proyecto de ejemplo completo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { aCSV, bomACSV, generarBOM, generarListaConductores } from '../src/motores/documentacion.js';
import { rutearConductores } from '../src/motores/ruteo.js';

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
	assert.equal(csv, '"a;b";"con ""comillas""";normal');
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
