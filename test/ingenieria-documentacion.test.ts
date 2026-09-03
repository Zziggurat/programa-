import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5 } from '../ejemplo/fixtures-fisica-v5.js';
import {
	bomIngenieriaACsv, conductoresIngenieriaACsv, crearInformeIngenieriaV7,
	generarBomIngenieria, generarListaConductoresIngenieria, generarListaTerminalesIngenieria,
	informeIngenieriaV7AHtml, informeIngenieriaV7AJson, terminalesIngenieriaACsv, totalizarConductores,
} from '../src/ingenieria/documentacion.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import type { Proyecto } from '../src/modelo/tipos.js';

const conexionesCerradas = new Map([['q1', [['1', '2']] as const]]);
const trazabilidad = { projectId: 'project-42', revision: 7, snapshotId: 'snapshot-6',
	buildId: 'BUILD-V7-FIJO', generadoEn: '2026-08-31T12:34:56.000Z' };

function fixtureDocumentacion(): Proyecto {
	const p = fixtureCaidaTensionV5();
	p.nombre = '<script>alert(1)</script> & Ingeniería';
	p.dispositivos.find((d) => d.id === 'q1')!.fabricante = 'Fabricante documentado';
	p.dispositivos.find((d) => d.id === 'q1')!.referencia = '=REF-SEGURA';
	p.dispositivos.push({ id: 'x1', tipo: 'bornero', designacion: '-X1', descripcion: 'Distribución',
		bornes: [{ id: '1', tipo: 'L', maxConductores: 4 }] });
	const original = p.conductores.find((c) => c.id === 'w-fase-carga')!;
	p.conductores = p.conductores.filter((c) => c !== original).concat([
		{ ...structuredClone(original), id: 'w-q-x', a: { dispositivoId: 'x1', borneId: '1' },
			fisica: { ...structuredClone(original.fisica), longitudManualM: 8 } },
		{ ...structuredClone(original), id: 'w-x-r', de: { dispositivoId: 'x1', borneId: '1' },
			fisica: { ...structuredClone(original.fisica), longitudManualM: 12 } },
	]);
	p.ingenieria = { version: 1, circuitos: {} };
	return p;
}

function analizar(p: Proyecto) {
	return ejecutarIngenieria({ proyecto: p, contextoFisico: { conexionesCerradas } });
}

test('Gate H: BOM agrupa cantidades y conserva solo metadatos realmente declarados', () => {
	const p = fixtureDocumentacion();
	const a = generarBomIngenieria(p); const b = generarBomIngenieria(structuredClone(p));
	assert.deepEqual(a, b);
	assert.equal(a.find((x) => x.tipo === 'disyuntor')?.fabricante, 'Fabricante documentado');
	assert.equal(a.find((x) => x.tipo === 'disyuntor')?.referencia, '=REF-SEGURA');
	const carga = a.find((x) => x.tipo === 'resistencia')!;
	assert.equal(carga.cantidad, 1); assert.equal(carga.fabricante, undefined); assert.equal(carga.referencia, undefined);
	assert.ok(!JSON.stringify(carga).includes('GENÉRICO'), 'no se inventan fabricante ni referencia');
	assert.match(bomIngenieriaACsv(a), /'=REF-SEGURA/, 'CSV neutraliza fórmulas sin cambiar el modelo');
});

test('Gate H: lista de conductores conserva extremos, circuito, longitud y procedencia', () => {
	const p = fixtureDocumentacion(); const a = analizar(p);
	const filas = generarListaConductoresIngenieria(p, a);
	const tramo = filas.find((x) => x.id === 'w-q-x')!;
	assert.deepEqual([tramo.deDispositivo, tramo.deTerminal, tramo.aDispositivo, tramo.aTerminal], ['q1', '2', 'x1', '1']);
	assert.equal(tramo.longitudM, 8); assert.equal(tramo.origenLongitud, 'CONFIGURADO');
	assert.ok(tramo.circuitos.length > 0);
	const totales = totalizarConductores(filas);
	const marron = totales.find((x) => x.color === 'marrón' && x.seccionMm2 === 2.5)!;
	assert.equal(marron.cantidad, 3); assert.equal(marron.longitudTotalM, 40);
	assert.match(conductoresIngenieriaACsv(filas), /w-q-x/);
});

test('Gate H: borneras enumeran conexiones reales sin inventar nombres eléctricos', () => {
	const p = fixtureDocumentacion(); const filas = generarListaTerminalesIngenieria(p, analizar(p));
	assert.deepEqual(filas, [{ borneroId: 'x1', designacion: '-X1', borneId: '1', tipo: 'L', conexiones: [
		{ conductorId: 'w-q-x', dispositivoId: 'q1', borneId: '2' },
		{ conductorId: 'w-x-r', dispositivoId: 'r1', borneId: 'L' },
	], circuitos: filas[0]!.circuitos }]);
	assert.ok(filas[0]!.circuitos.length > 0); assert.doesNotMatch(JSON.stringify(filas), /fase de salida|potencial supuesto/i);
	assert.match(terminalesIngenieriaACsv(filas), /w-q-x:q1:2/);
});

test('Gate H: informe reúne trazabilidad, criterios, potencia, issues y diagnósticos sin mutar Proyecto', () => {
	const p = fixtureDocumentacion(); const antes = structuredClone(p); const analisis = analizar(p);
	const informe = crearInformeIngenieriaV7({ proyecto: p, analisis, trazabilidad });
	assert.equal(informe.formato, 'tablerostudio-informe-ingenieria');
	assert.deepEqual(informe.trazabilidad, trazabilidad); assert.equal(informe.proyecto.id, 'project-42');
	assert.ok(informe.circuitos.length > 0); assert.ok(informe.potencia.porCircuito.length > 0);
	assert.equal(informe.criterios?.version, 1); assert.ok(Array.isArray(informe.issues));
	assert.ok(Array.isArray(informe.datosFaltantes)); assert.ok(Array.isArray(informe.diagnosticosV6));
	assert.match(informe.leyenda, /No constituye certificación normativa/);
	assert.deepEqual(p, antes, 'documentar no persiste resultados ni estado de runtime');
});

test('Gate H: HTML autocontenido escapa contenido y publica límites', () => {
	const p = fixtureDocumentacion(); const informe = crearInformeIngenieriaV7({ proyecto: p, analisis: analizar(p), trazabilidad });
	const html = informeIngenieriaV7AHtml(informe);
	assert.match(html, /<!doctype html>/i); assert.doesNotMatch(html, /<script>alert/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.match(html, /BUILD-V7-FIJO/);
	assert.match(html, /NO_MODELADO y NO_DISPONIBLE/); assert.doesNotMatch(html, /<script\b|https?:\/\//i);
	assert.match(html, /<header class="cabecera">/); assert.match(html, /<section><h2>Resumen<\/h2>/);
	assert.match(html, /@page\{size:A4/); assert.match(html, /@media print/);
	assert.match(html, /break-inside:avoid-page/); assert.match(html, /tbody tr:nth-child\(even\)/);
});

test('Gate H: los tres CSV descargables declaran UTF-8 por bytes y conservan texto técnico', () => {
	const p = fixtureDocumentacion(); const informe = crearInformeIngenieriaV7({ proyecto: p, analisis: analizar(p), trazabilidad });
	const csvs = [bomIngenieriaACsv(informe.bom), conductoresIngenieriaACsv(informe.conductores), terminalesIngenieriaACsv(informe.terminales)];
	for (const csv of csvs) assert.deepEqual([...new TextEncoder().encode(csv).slice(0, 3)], [0xef, 0xbb, 0xbf]);
	assert.match(csvs[0]!, /Descripción/); assert.match(csvs[1]!, /Sección mm²/); assert.match(csvs[1]!, /marrón/);
	assert.match(csvs[2]!, /Designación/);
});

test('Gate H: misma entrada produce JSON, HTML y CSV byte-idénticos y orden estable', () => {
	const p = fixtureDocumentacion(); const a = analizar(p);
	const i1 = crearInformeIngenieriaV7({ proyecto: p, analisis: a, trazabilidad });
	const i2 = crearInformeIngenieriaV7({ proyecto: p, analisis: analizar(structuredClone(p)), trazabilidad });
	assert.equal(informeIngenieriaV7AJson(i1), informeIngenieriaV7AJson(i2));
	assert.equal(informeIngenieriaV7AHtml(i1), informeIngenieriaV7AHtml(i2));
	assert.equal(bomIngenieriaACsv(i1.bom), bomIngenieriaACsv(i2.bom));
	assert.equal(conductoresIngenieriaACsv(i1.conductores), conductoresIngenieriaACsv(i2.conductores));
	assert.equal(terminalesIngenieriaACsv(i1.terminales), terminalesIngenieriaACsv(i2.terminales));

	const invertido = structuredClone(p); invertido.dispositivos.reverse(); invertido.conductores.reverse();
	const ii = crearInformeIngenieriaV7({ proyecto: invertido, analisis: analizar(invertido), trazabilidad });
	assert.deepEqual(ii.bom, i1.bom); assert.deepEqual(ii.conductores, i1.conductores); assert.deepEqual(ii.terminales, i1.terminales);
});

test('Gate H: el informe es una fotografía separada y no introduce memoria dinámica en el diseño', () => {
	const p = fixtureDocumentacion(); const textoAntes = JSON.stringify(p);
	const informe = crearInformeIngenieriaV7({ proyecto: p, analisis: analizar(p), trazabilidad });
	informe.proyecto.nombre = 'alterado'; informe.bom[0]!.designaciones.push('MUTACIÓN');
	assert.equal(JSON.stringify(p), textoAntes);
	assert.doesNotMatch(JSON.stringify(p), /runtime|estadoSimulacion|resultadoIngenieria|EngineeringIssue/);
});
