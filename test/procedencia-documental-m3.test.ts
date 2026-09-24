import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { resumenProcedenciaDocumento, vistaPreviaVigente,
	type ProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';
import { generarInformeHTML } from '../src/motores/documentacion.js';
import { generarListaConductores } from '../src/motores/documentacion.js';
import { generarFichaTablero } from '../src/motores/ficha-tablero.js';
import { revisarTablero } from '../src/motores/revision.js';

const confirmada: ProcedenciaDocumento = {
	estado: 'confirmado', projectId: 'P-9<&', revisionRepositorio: 7,
	buildId: 'build-XYZ', generadoEn: '2026-09-23T12:34:56.000Z',
};

test('DOC-01: el HTML separa ID/revisión confirmados, revisión editorial, fecha y Build ID', () => {
	const p = crearProyecto('Tablero documental');
	p.datos = { revision: 'ED-C', fecha: '2024-11-02' };
	const html = generarInformeHTML(revisarTablero(p), confirmada);
	assert.match(html, /<dt>Project ID<\/dt><dd>P-9&lt;&amp;<\/dd>/);
	assert.match(html, /<dt>Revisión del repositorio<\/dt><dd>7<\/dd>/);
	assert.match(html, /<dt>Revisión editorial<\/dt><dd>ED-C<\/dd>/);
	assert.match(html, /<dt>Fecha editorial<\/dt><dd>2024-11-02<\/dd>/);
	assert.match(html, /<dt>Generado<\/dt><dd>2026-09-23T12:34:56.000Z<\/dd>/);
	assert.match(html, /<dt>Build ID<\/dt><dd>build-XYZ<\/dd>/);
	assert.doesNotMatch(html, /snapshotId/i, 'un snapshot no confirmado no se atribuye al dossier');
});

test('DOC-01: ejemplos y ausencia de procedencia no reciben ID ni revisión inventados', () => {
	const efimero = resumenProcedenciaDocumento({ estado: 'efimero', motivo: 'ejemplo',
		buildId: 'build-ejemplo', generadoEn: '2026-09-23T12:34:56.000Z' });
	assert.equal(efimero.estado, 'Ejemplo efímero');
	assert.equal(efimero.projectId, 'No asignado');
	assert.equal(efimero.revisionRepositorio, 'No asignada');
	const sinContexto = resumenProcedenciaDocumento();
	assert.equal(sinContexto.projectId, 'No disponible');
	assert.equal(sinContexto.revisionRepositorio, 'No disponible');
});

test('DOC-01: descarga reutiliza bytes de preview y una edición invalida esa preview', async () => {
	const blob = new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255])],
		{ type: 'application/pdf' });
	const vista = { firma: '{"nombre":"A"}', blob, nombre: 'A', procedencia: confirmada };
	const vigente = vistaPreviaVigente(vista, '{"nombre":"A"}', confirmada);
	assert.strictEqual(vigente, vista);
	assert.strictEqual(vigente.blob, blob, 'no se regenera un segundo PDF al descargar');
	assert.deepEqual(new Uint8Array(await vigente.blob.arrayBuffer()),
		new Uint8Array(await blob.arrayBuffer()));
	assert.equal(vistaPreviaVigente(vista, '{"nombre":"B"}', confirmada), undefined);
	assert.equal(vistaPreviaVigente(vista, '{"nombre":"A"}', { ...confirmada, projectId: 'otro' }), undefined);
	assert.equal(vistaPreviaVigente(vista, '{"nombre":"A"}', { ...confirmada, revisionRepositorio: 8 }), undefined);
});

test('M3/M2: conexión pendiente cuenta eléctricamente sin convertirse en cable material', () => {
	const p = crearProyecto('Ruta física pendiente');
	p.dispositivos = [
		{ id: 'a', tipo: 'bornero', bornes: [{ id: '1' }] },
		{ id: 'b', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{ id: 'c', de: { dispositivoId: 'a', borneId: '1' },
		a: { dispositivoId: 'b', borneId: '1' }, seccion: 2.5, estadoRutaFisica: 'pendiente' }];
	const ruteoForzado = { rutas: [{ conductorId: 'c', longitudMm: 15_000 }] };
	const ficha = generarFichaTablero(p, ruteoForzado as Parameters<typeof generarFichaTablero>[1]);
	const [fila] = generarListaConductores(p, ruteoForzado as Parameters<typeof generarListaConductores>[1]);
	assert.equal(ficha.conductores.total, 1);
	assert.equal(ficha.conductores.pendientesRuta, 1);
	assert.equal(ficha.conductores.longitudTotalMm, 0);
	assert.deepEqual(ficha.conductores.porSeccion, []);
	assert.equal(fila.pendienteRuta, true);
	assert.equal(fila.longitudMm, undefined);
	const html = generarInformeHTML(revisarTablero(structuredClone(p)));
	assert.match(html, /Ruta física pendiente/);
});
