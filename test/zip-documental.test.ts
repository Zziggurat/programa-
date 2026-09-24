import assert from 'node:assert/strict';
import test from 'node:test';
import {
	crearZipDocumental,
	LIMITE_ARCHIVO_ZIP_DOCUMENTAL,
	LIMITE_ENTRADA_ZIP_DOCUMENTAL,
	LIMITE_ENTRADAS_ZIP_DOCUMENTAL,
	normalizarRutaZipDocumental,
} from '../src/modelo/zip-documental.js';

// Lector de pruebas independiente: recorre EOCD, directorio central y cabeceras
// locales. Comprueba los bytes y el CRC sin usar ninguna función del escritor.
function leerZipStore(zip: Uint8Array): Map<string, { bytes: Uint8Array; crc: number; hora: number; dia: number }> {
	const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const u16 = (p: number): number => v.getUint16(p, true);
	const u32 = (p: number): number => v.getUint32(p, true);
	const fin = zip.length - 22;
	assert.equal(u32(fin), 0x06054b50, 'EOCD estándar sin comentario');
	assert.equal(u16(fin + 4), 0, 'no multidisco');
	assert.equal(u16(fin + 6), 0, 'no multidisco');
	assert.equal(u16(fin + 8), u16(fin + 10), 'conteo consistente');
	assert.equal(u16(fin + 20), 0, 'sin comentario');
	const cuenta = u16(fin + 10);
	const inicioCentral = u32(fin + 16);
	const finCentral = inicioCentral + u32(fin + 12);
	assert.equal(finCentral, fin, 'directorio central termina en EOCD');
	const archivos = new Map<string, { bytes: Uint8Array; crc: number; hora: number; dia: number }>();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let p = inicioCentral;
	for (let i = 0; i < cuenta; i++) {
		assert.equal(u32(p), 0x02014b50, 'firma de entrada central');
		assert.equal(u16(p + 8), 0x0800, 'nombre UTF-8');
		assert.equal(u16(p + 10), 0, 'sin compresión');
		const hora = u16(p + 12);
		const dia = u16(p + 14);
		const crc = u32(p + 16);
		const longitud = u32(p + 20);
		assert.equal(u32(p + 24), longitud, 'STORE mantiene tamaño original');
		const largoNombre = u16(p + 28);
		const largoExtra = u16(p + 30);
		const largoComentario = u16(p + 32);
		const nombreBytes = zip.subarray(p + 46, p + 46 + largoNombre);
		const ruta = decoder.decode(nombreBytes);
		const local = u32(p + 42);
		assert.equal(u32(local), 0x04034b50, 'firma local');
		assert.equal(u16(local + 6), 0x0800);
		assert.equal(u16(local + 8), 0);
		assert.equal(u16(local + 10), hora);
		assert.equal(u16(local + 12), dia);
		assert.equal(u32(local + 14), crc);
		assert.equal(u32(local + 18), longitud);
		assert.equal(u32(local + 22), longitud);
		assert.equal(u16(local + 26), largoNombre);
		const largoExtraLocal = u16(local + 28);
		assert.deepEqual(zip.subarray(local + 30, local + 30 + largoNombre), nombreBytes);
		const inicioDatos = local + 30 + largoNombre + largoExtraLocal;
		const bytes = zip.subarray(inicioDatos, inicioDatos + longitud);
		assert.equal(bytes.length, longitud);
		// Algoritmo bit a bit independiente de la tabla del escritor.
		let calculado = 0xffffffff;
		for (const byte of bytes) {
			calculado ^= byte;
			for (let b = 0; b < 8; b++) calculado = calculado & 1
				? (calculado >>> 1) ^ 0xedb88320 : calculado >>> 1;
		}
		assert.equal((calculado ^ 0xffffffff) >>> 0, crc, `CRC de ${ruta}`);
		archivos.set(ruta, { bytes, crc, hora, dia });
		p += 46 + largoNombre + largoExtra + largoComentario;
	}
	assert.equal(p, finCentral, 'recorrido central exacto');
	return archivos;
}

test('ZIP32 STORE es reproducible, ordenado por UTF-8, extraíble y conserva bytes/CRC', () => {
	const entradas = [
		{ ruta: 'z/último.txt', contenido: 'áéíóú' },
		{ ruta: 'a\\imagen.bin', contenido: new Uint8Array([0, 255, 80, 75, 0]) },
		{ ruta: 'b/crc.txt', contenido: '123456789' },
	];
	const zip = crearZipDocumental(entradas);
	assert.deepEqual(zip, crearZipDocumental([...entradas].reverse()), 'orden de entrada no afecta los bytes');
	const leidos = leerZipStore(zip);
	assert.deepEqual([...leidos.keys()], ['a/imagen.bin', 'b/crc.txt', 'z/último.txt']);
	assert.deepEqual(leidos.get('a/imagen.bin')?.bytes, new Uint8Array([0, 255, 80, 75, 0]));
	assert.equal(new TextDecoder().decode(leidos.get('z/último.txt')?.bytes), 'áéíóú');
	assert.equal(leidos.get('b/crc.txt')?.crc, 0xcbf43926);
	assert.equal(leidos.get('b/crc.txt')?.hora, 0);
	assert.equal(leidos.get('b/crc.txt')?.dia, 0x0021, '1980-01-01 UTC');
});

test('ZIP vacío y fecha propia admitida producen EOCD y sello DOS válido', () => {
	assert.equal(crearZipDocumental([]).length, 22);
	assert.equal(leerZipStore(crearZipDocumental([])).size, 0);
	const fecha = new Date('2026-09-24T12:34:57.000Z');
	const zip = crearZipDocumental([{ ruta: 'x.txt', contenido: 'x', fecha }]);
	const x = leerZipStore(zip).get('x.txt');
	assert.equal(x?.hora, (12 << 11) | (34 << 5) | 28, 'ZIP guarda segundos de dos en dos');
	assert.equal(x?.dia, ((2026 - 1980) << 9) | (9 << 5) | 24);
	assert.deepEqual(zip, crearZipDocumental([{ ruta: 'x.txt', contenido: 'x' }], { fecha }));
});

test('rutas canónicas rechazan traversal, absolutos y nombres no portables', () => {
	assert.equal(normalizarRutaZipDocumental('./planos//Planta\\Hoja.svg'), 'planos/Planta/Hoja.svg');
	for (const ruta of [
		'', '.', '../secreto', 'a/../../secreto', '/absoluta', '\\servidor\\recurso',
		'C:\\absoluta', 'a/', 'a/CON.txt', 'a/NUL', 'a/b.', 'a/b ', 'a/f:oo',
		'a/\u0001b', 'a/\u202E.txt', 'a/\ud800',
	]) {
		assert.throws(() => normalizarRutaZipDocumental(ruta), Error, JSON.stringify(ruta));
	}
	assert.throws(() => crearZipDocumental([
		{ ruta: 'e\u0301.txt', contenido: '1' }, { ruta: 'é.txt', contenido: '2' },
	]), /duplicada/);
	assert.throws(() => crearZipDocumental([
		{ ruta: 'Manual.TXT', contenido: '1' }, { ruta: 'manual.txt', contenido: '2' },
	]), /duplicada/);
});

test('límites de ZIP32 y memoria fallan antes de crear un archivo ambiguo', () => {
	assert.equal(LIMITE_ENTRADAS_ZIP_DOCUMENTAL, 10_000);
	assert.equal(LIMITE_ENTRADA_ZIP_DOCUMENTAL, 64 * 1024 * 1024);
	assert.equal(LIMITE_ARCHIVO_ZIP_DOCUMENTAL, 128 * 1024 * 1024);
	const muchas = Array.from({ length: LIMITE_ENTRADAS_ZIP_DOCUMENTAL + 1 }, (_, i) => ({
		ruta: `${i}.txt`, contenido: '',
	}));
	assert.throws(() => crearZipDocumental(muchas), /máximo/);
	assert.throws(() => crearZipDocumental([{ ruta: `${'n'.repeat(0x10000)}.txt`, contenido: '' }]), /demasiado larga/);
	assert.throws(() => crearZipDocumental([{ ruta: 'x', contenido: '', fecha: new Date('1979-12-31T23:59:59Z') }]), /rango DOS/);
	assert.throws(() => crearZipDocumental([{ ruta: 'x', contenido: '', fecha: new Date('2108-01-01T00:00:00Z') }]), /rango DOS/);
	assert.throws(() => crearZipDocumental([{ ruta: 'x', contenido: '', fecha: new Date(NaN) }]), /inválida/);
});
