import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');

const procedencia = { estado: 'confirmado' as const, projectId: 'doc-123',
	revisionRepositorio: 8, buildId: 'BUILD-QA', generadoEn: '2026-09-24T12:00:00.000Z' };

test('DOC-02 compone un único snapshot sin duplicar un aparato multivista ni una conexión interhoja', async () => {
	const p = crearProyecto('<img src=x onerror=alert(1)> & Revisión');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }, { id: 'h2', numero: 2, titulo: 'Potencia' }];
	p.dispositivos = [
		{ id: 'km', tipo: 'contactor', designacion: '-KM1', descripcion: '=HYPERLINK("evil")',
			bornes: [{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' }] },
		{ id: 'x', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'km', borneId: 'A1' },
		a: { dispositivoId: 'x', borneId: '1' }, estadoRutaFisica: 'pendiente' }];
	p.esquema = { representaciones: [
		{ id: 'km-mando', dispositivoId: 'km', hojaId: 'h1', posicion: { columna: 2, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'km-potencia', dispositivoId: 'km', hojaId: 'h2', posicion: { columna: 2, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x', dispositivoId: 'x', hojaId: 'h2', posicion: { columna: 5, fila: 3 }, parte: { tipo: 'completa' } },
	] };
	const antes = JSON.stringify(p);
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), antes, 'la numeración y los informes no mutan el documento vivo');
	assert.equal(new Set(archivos.map((a) => a.ruta)).size, archivos.length);
	for (const ruta of ['index.html', 'esquema/hoja-001.svg', 'esquema/hoja-002.svg',
		'esquema/esquema.pdf', 'dossier/dossier.pdf', 'dossier/dossier.html',
		'ingenieria/informe.json', 'ingenieria/bom.csv', 'listas/aparatos.csv',
		'listas/conexiones.csv', 'listas/conductores.csv', 'listas/longitudes-conductores.csv', 'listas/borneros.csv',
		'listas/referencias-cruzadas.csv', 'listas/senales-io.csv', 'listas/marcadores.csv']) {
		assert.ok(archivos.some((a) => a.ruta === ruta), `falta ${ruta}`);
	}
	const texto = (ruta: string) => String(archivos.find((a) => a.ruta === ruta)?.contenido ?? '');
	const index = texto('index.html');
	assert.match(index, /Project ID<\/dt><dd>doc-123/);
	assert.match(index, /Revisión del repositorio<\/dt><dd>8/);
	assert.match(index, /BUILD-QA/);
	assert.match(index, /Borrador técnico/);
	assert.match(index, /1 conexiones con ruta física pendiente/);
	assert.doesNotMatch(index, /<img src=x/);
	assert.match(index, /&lt;img src=x/);
	assert.doesNotMatch(index, /<script\b|https?:\/\//i);
	const bom = texto('ingenieria/bom.csv');
	const informe = JSON.parse(texto('ingenieria/informe.json')) as {
		bom: { tipo: string; cantidad: number; designaciones: string[] }[];
	};
	const contactor = informe.bom.find((fila) => fila.tipo === 'contactor');
	assert.ok(contactor);
	assert.equal(contactor.cantidad, 1, 'dos vistas comparten un solo aparato BOM');
	assert.equal(contactor.designaciones.length, 1);
	assert.equal(bom.split(contactor.designaciones[0]).length - 1, 1);
	assert.match(bom, /'=HYPERLINK/);
	const conexiones = texto('listas/conexiones.csv');
	assert.equal((conexiones.match(/w1/g) ?? []).length, 1, 'el enlace interhoja no duplica conductor');
	assert.match(conexiones, /PENDIENTE/);
	const longitudes = texto('listas/longitudes-conductores.csv');
	const filaPendiente = longitudes.split('\n').find((fila) => fila.startsWith('w1;'))?.split(';');
	assert.ok(filaPendiente, 'la conexión eléctrica pendiente permanece listada');
	assert.equal(filaPendiente[1], 'PENDIENTE');
	assert.equal(filaPendiente[3], '', 'sin ruta 2D inventada');
	assert.equal(filaPendiente[11], '', 'sin propuesta de corte');
	assert.equal(filaPendiente[12], '', 'sin corte verificado');
	assert.match(longitudes, /Propuesta de corte estimada \(mm\)/);
	const marcadores = texto('listas/marcadores.csv');
	assert.match(marcadores, /Borne ID;Ubicación borne;Identificador/);
	assert.match(marcadores, /;APARATO;A1;/,
		'el CSV distingue terminal de aparato de bornera sin derivarlo de la imagen');
	assert.match(marcadores, /;BORNERA;1;/);
	assert.match(marcadores, /Campo principal;Texto principal;Campo secundario;Texto secundario;Cantidad/);
	assert.equal((marcadores.match(/extremo-conductor;w1;/g) ?? []).length, 2,
		'el paquete lleva una etiqueta por cada extremo real del conductor');
	assert.match(texto('ingenieria/informe.json'), /"projectId": "doc-123"/);
	assert.match(texto('esquema/hoja-001.svg'), /doc-123/);
	assert.match(Buffer.from(archivos.find((a) => a.ruta === 'esquema/esquema.pdf')!.contenido as Uint8Array)
		.toString('latin1'), /Project ID doc-123/);
});
