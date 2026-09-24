import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5 } from '../ejemplo/fixtures-fisica-v5.js';
import {
	bomIngenieriaACsv, conductoresIngenieriaACsv, crearInformeIngenieriaV7,
	datosTecnicosIngenieriaACsv,
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

test('ESQ-02: conexión pendiente sigue en lista eléctrica, sin longitud ni cantidad de material', () => {
	const p = fixtureDocumentacion();
	const base = p.conductores.find((c) => c.id === 'w-q-x')!;
	p.conductores.push({ ...structuredClone(base), id: 'w-pendiente',
		de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'x1', borneId: '1' },
		fisica: { material: 'COBRE' }, estadoRutaFisica: 'pendiente' });
	const a = analizar(p);
	const fisico = a.fisica.conductores.get('w-q-x')!;
	assert.ok(fisico);
	// Incluso un snapshot de runtime obsoleto/externo no puede atribuirle metros.
	a.fisica.conductores.set('w-pendiente', { ...fisico, conductorId: 'w-pendiente',
		longitudM: 999, origenLongitud: 'INYECTADO' });
	const filas = generarListaConductoresIngenieria(p, a);
	const pendiente = filas.find((x) => x.id === 'w-pendiente')!;
	assert.deepEqual([pendiente.deDispositivo, pendiente.deTerminal, pendiente.aDispositivo, pendiente.aTerminal],
		['q1', '1', 'x1', '1']);
	assert.equal(pendiente.estadoRutaFisica, 'pendiente');
	assert.equal(pendiente.longitudM, undefined);
	assert.equal(pendiente.origenLongitud, 'NO_DISPONIBLE');
	const total = totalizarConductores(filas);
	assert.equal(total.reduce((n, g) => n + g.cantidad, 0), filas.length - 1);
	const marron = total.find((x) => x.color === 'marrón' && x.seccionMm2 === 2.5)!;
	assert.equal(marron.cantidad, 3);
	assert.equal(marron.longitudTotalM, 40);
	const informe = crearInformeIngenieriaV7({ proyecto: p, analisis: a, trazabilidad });
	assert.ok(informe.conductores.some((x) => x.id === 'w-pendiente'));
	assert.equal(informe.totalesConductores.reduce((n, g) => n + g.cantidad, 0), filas.length - 1);
	assert.match(conductoresIngenieriaACsv(informe.conductores), /w-pendiente[^\n]*NO_DISPONIBLE/);
	assert.match(conductoresIngenieriaACsv(informe.conductores, informe), /w-pendiente[^\n]*PENDIENTE — sin tendido/);
	assert.match(informeIngenieriaV7AHtml(informe), /PENDIENTE — sin tendido/);
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
	assert.match(html, /Sin procedencia confirmada/, 'el contexto legado no se presenta como revisión confirmada');
});

test('DOC-01: JSON, HTML y cuatro CSV comparten procedencia confirmada, alcance y fecha', () => {
	const p = fixtureDocumentacion();
	const procedencia = { estado: 'confirmado' as const, projectId: '=PROYECTO-HOSTIL', revisionRepositorio: 17,
		buildId: 'BUILD-DOC-01', generadoEn: '2026-09-24T12:00:00.000Z' };
	const i = crearInformeIngenieriaV7({ proyecto: p, analisis: analizar(p),
		trazabilidad: { projectId: procedencia.projectId, revision: procedencia.revisionRepositorio,
			buildId: procedencia.buildId, generadoEn: procedencia.generadoEn, procedencia } });
	const json = JSON.parse(informeIngenieriaV7AJson(i));
	assert.deepEqual(json.trazabilidad.procedencia, procedencia);
	assert.match(json.alcance, /no certificación normativa/);
	const html = informeIngenieriaV7AHtml(i);
	assert.match(html, /Revisión confirmada/); assert.match(html, /Revisión de repositorio<\/b><span>17/);
	assert.match(html, /BUILD-DOC-01/); assert.match(html, /2026-09-24T12:00:00.000Z/);
	const csvs = [bomIngenieriaACsv(i.bom, i), conductoresIngenieriaACsv(i.conductores, i),
		terminalesIngenieriaACsv(i.terminales, i), datosTecnicosIngenieriaACsv(i)];
	for (const csv of csvs) {
		assert.equal(csv.charCodeAt(0), 0xfeff);
		assert.match(csv, /Estado documental;Project ID;Revisión repositorio;Generado en;Build ID;Alcance;Tipo fila/);
		assert.match(csv, /Revisión confirmada;'=PROYECTO-HOSTIL;17;2026-09-24T12:00:00.000Z;BUILD-DOC-01/);
		assert.match(csv, /Ingeniería V7|Datos técnicos V8/);
	}
	assert.match(csvs[3]!, /;META$/, 'un CSV técnico sin resoluciones conserva metadatos sin inventar datos');
});

test('DOC-01: ejemplo efímero no publica ID ni revisión de repositorio confirmados', () => {
	const p = fixtureDocumentacion(); p.esEjemplo = true;
	const procedencia = { estado: 'efimero' as const, motivo: 'ejemplo' as const,
		buildId: 'BUILD-EJEMPLO', generadoEn: '2026-09-24T12:00:00.000Z' };
	const i = crearInformeIngenieriaV7({ proyecto: p, analisis: analizar(p), trazabilidad: {
		projectId: 'EJEMPLO_EFIMERO', buildId: procedencia.buildId, generadoEn: procedencia.generadoEn, procedencia,
	} });
	assert.match(informeIngenieriaV7AHtml(i), /Ejemplo efímero/);
	assert.match(informeIngenieriaV7AHtml(i), /Project ID confirmado<\/b><span>No asignado/);
	assert.match(bomIngenieriaACsv(i.bom, i), /Ejemplo efímero;No asignado;No asignada/);
	assert.doesNotMatch(bomIngenieriaACsv(i.bom, i), /EJEMPLO_EFIMERO/);
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
