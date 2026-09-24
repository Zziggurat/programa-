import assert from 'node:assert/strict';
import test from 'node:test';
import { crearZipDeRevisionDocumental } from '../src/modelo/manifiesto-paquete-documental.js';

const decodificador = new TextDecoder();

function entradasLocales(zip: Uint8Array): Map<string, Uint8Array> {
	const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const archivos = new Map<string, Uint8Array>();
	let offset = 0;
	while (offset + 30 <= zip.length && vista.getUint32(offset, true) === 0x04034b50) {
		const tamaño = vista.getUint32(offset + 18, true);
		const nombreLongitud = vista.getUint16(offset + 26, true);
		const extraLongitud = vista.getUint16(offset + 28, true);
		const nombre = decodificador.decode(zip.subarray(offset + 30, offset + 30 + nombreLongitud));
		const inicio = offset + 30 + nombreLongitud + extraLongitud;
		archivos.set(nombre, zip.subarray(inicio, inicio + tamaño));
		offset = inicio + tamaño;
	}
	return archivos;
}

const procedencia = { estado: 'confirmado' as const, projectId: 'tablero-A',
	revisionRepositorio: 7, buildId: 'DEV-1.0.0', generadoEn: '2026-09-24T00:00:00.000Z' };

test('el paquete tiene una sola procedencia y hashes de los bytes realmente archivados', async () => {
	const entrada = { proyecto: 'Tablero A', procedencia, archivos: [
		{ ruta: 'planos/hoja.svg', contenido: '<svg/>', mime: 'image/svg+xml' },
		{ ruta: 'tablas/bom.csv', contenido: 'abc', mime: 'text/csv' },
	] };
	const { zip, manifiesto } = await crearZipDeRevisionDocumental(entrada);
	const locales = entradasLocales(zip);
	assert.equal(locales.size, 3);
	assert.equal(decodificador.decode(locales.get('tablas/bom.csv')), 'abc');
	assert.deepEqual(JSON.parse(decodificador.decode(locales.get('manifiesto.json'))), manifiesto);
	assert.deepEqual(manifiesto.procedencia, procedencia);
	assert.equal(manifiesto.archivos.find((f) => f.ruta === 'tablas/bom.csv')?.sha256,
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	assert.equal(manifiesto.archivos.find((f) => f.ruta === 'planos/hoja.svg')?.bytes, 6);
	const invertido = await crearZipDeRevisionDocumental({ ...entrada, archivos: [...entrada.archivos].reverse() });
	assert.deepEqual(invertido.zip, zip, 'el orden de arrays no cambia el entregable');
});

test('rechaza nombres duplicados, traversal y manifiesto provisto por terceros', async () => {
	const base = { proyecto: 'Tablero A', procedencia };
	await assert.rejects(() => crearZipDeRevisionDocumental({ ...base, archivos: [
		{ ruta: 'A.csv', contenido: '1', mime: 'text/csv' },
		{ ruta: 'a.csv', contenido: '2', mime: 'text/csv' },
	] }), /duplicada/i);
	await assert.rejects(() => crearZipDeRevisionDocumental({ ...base, archivos: [
		{ ruta: '../fuera.csv', contenido: '1', mime: 'text/csv' },
	] }), /Traversal/i);
	await assert.rejects(() => crearZipDeRevisionDocumental({ ...base, archivos: [
		{ ruta: 'MANIFIESTO.JSON', contenido: '{}', mime: 'application/json' },
	] }), /reservada/i);
});
