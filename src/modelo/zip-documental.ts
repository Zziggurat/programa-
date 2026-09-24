/**
 * ZIP32 sin compresión para entregables portátiles. No usa APIs de Node ni altera
 * el contenido de las entradas. Los límites también protegen al editor de una
 * reserva de memoria inesperada: este constructor materializa el ZIP completo.
 */
export const LIMITE_ENTRADAS_ZIP_DOCUMENTAL = 10_000;
export const LIMITE_ENTRADA_ZIP_DOCUMENTAL = 64 * 1024 * 1024;
export const LIMITE_ARCHIVO_ZIP_DOCUMENTAL = 128 * 1024 * 1024;

export interface EntradaZipDocumental {
	/** Ruta relativa dentro del ZIP; `\\` se normaliza a `/`. */
	ruta: string;
	contenido: string | Uint8Array;
	/** UTC; por defecto, la fecha fija 1980-01-01 para reproducibilidad. */
	fecha?: Date;
}

export interface OpcionesZipDocumental {
	/** UTC por defecto para todas las entradas sin fecha propia. */
	fecha?: Date;
}

const encoder = new TextEncoder();
const FECHA_FIJA = new Date('1980-01-01T00:00:00.000Z');
const RESERVADO_WINDOWS = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const INVALIDO_WINDOWS = /[<>:"|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/**
 * Canoniza una ruta relativa sin permitir traversal ni nombres ambiguos al
 * extraer en Windows. Nunca decodifica porcentajes ni interpreta rutas de URL.
 */
export function normalizarRutaZipDocumental(ruta: string): string {
	if (typeof ruta !== 'string' || !ruta) throw new Error('Ruta ZIP vacía o inválida');
	const separada = ruta.replace(/\\/g, '/');
	if (separada.startsWith('/') || separada.endsWith('/')) {
		throw new Error(`Ruta ZIP absoluta o de directorio no admitida: ${ruta}`);
	}
	const partes: string[] = [];
	for (const parteOriginal of separada.split('/')) {
		if (!parteOriginal || parteOriginal === '.') continue;
		if (parteOriginal === '..') throw new Error(`Traversal no permitido en ruta ZIP: ${ruta}`);
		const parte = parteOriginal.normalize('NFC');
		if (parte === '..' || INVALIDO_WINDOWS.test(parte) || /[. ]$/.test(parte) || RESERVADO_WINDOWS.test(parte)) {
			throw new Error(`Segmento no portable en ruta ZIP: ${ruta}`);
		}
		// TextEncoder sustituye los surrogate sueltos por U+FFFD: no permitir dos
		// nombres diferentes que acabarían con los mismos bytes dentro del ZIP.
		for (let i = 0; i < parte.length; i++) {
			const codigo = parte.charCodeAt(i);
			if (codigo >= 0xd800 && codigo <= 0xdbff) {
				const siguiente = parte.charCodeAt(++i);
				if (!(siguiente >= 0xdc00 && siguiente <= 0xdfff)) {
					throw new Error(`Unicode inválido en ruta ZIP: ${ruta}`);
				}
			} else if (codigo >= 0xdc00 && codigo <= 0xdfff) {
				throw new Error(`Unicode inválido en ruta ZIP: ${ruta}`);
			}
		}
		partes.push(parte);
	}
	if (!partes.length) throw new Error('Ruta ZIP vacía tras normalizar');
	return partes.join('/');
}

function fechaDos(fecha: Date): { hora: number; dia: number } {
	if (!(fecha instanceof Date) || !Number.isFinite(fecha.getTime())) {
		throw new Error('Fecha ZIP inválida');
	}
	const anio = fecha.getUTCFullYear();
	if (anio < 1980 || anio > 2107) throw new Error('Fecha ZIP fuera del rango DOS 1980–2107');
	return {
		hora: (fecha.getUTCHours() << 11) | (fecha.getUTCMinutes() << 5) | (fecha.getUTCSeconds() >> 1),
		dia: ((anio - 1980) << 9) | ((fecha.getUTCMonth() + 1) << 5) | fecha.getUTCDate(),
	};
}

const TABLA_CRC32 = new Uint32Array(256);
for (let i = 0; i < TABLA_CRC32.length; i++) {
	let valor = i;
	for (let b = 0; b < 8; b++) valor = valor & 1 ? (valor >>> 1) ^ 0xedb88320 : valor >>> 1;
	TABLA_CRC32[i] = valor >>> 0;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = TABLA_CRC32[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function compararBytes(a: Uint8Array, b: Uint8Array): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return a.length - b.length;
}

interface EntradaPreparada {
	ruta: string;
	nombre: Uint8Array;
	contenido: Uint8Array;
	crc: number;
	hora: number;
	dia: number;
	desplazamiento: number;
}

/**
 * Construye un ZIP32 estándar y determinista. Se ordena por bytes UTF-8, no por
 * locale; el directorio central y las cabeceras locales usan los mismos datos.
 * No admite ZIP64, compresión, enlaces, directorios ni cifrado.
 */
export function crearZipDocumental(
	entradas: readonly EntradaZipDocumental[],
	opciones: OpcionesZipDocumental = {},
): Uint8Array {
	if (!Array.isArray(entradas) || entradas.length > LIMITE_ENTRADAS_ZIP_DOCUMENTAL) {
		throw new Error(`ZIP documental admite como máximo ${LIMITE_ENTRADAS_ZIP_DOCUMENTAL} entradas`);
	}
	const fechaDefecto = opciones.fecha ?? FECHA_FIJA;
	const nombres = new Set<string>();
	const preparadas = entradas.map((entrada): EntradaPreparada => {
		const ruta = normalizarRutaZipDocumental(entrada.ruta);
		const clave = ruta.toLowerCase();
		if (nombres.has(clave)) throw new Error(`Entrada ZIP duplicada: ${ruta}`);
		nombres.add(clave);
		const nombre = encoder.encode(ruta);
		if (nombre.length > 0xffff) throw new Error(`Ruta ZIP demasiado larga: ${ruta}`);
		if (!(typeof entrada.contenido === 'string' || entrada.contenido instanceof Uint8Array)) {
			throw new Error(`Contenido ZIP inválido: ${ruta}`);
		}
		const contenido = typeof entrada.contenido === 'string'
			? encoder.encode(entrada.contenido) : entrada.contenido;
		if (contenido.byteLength > LIMITE_ENTRADA_ZIP_DOCUMENTAL) {
			throw new Error(`Entrada ZIP excede ${LIMITE_ENTRADA_ZIP_DOCUMENTAL} bytes: ${ruta}`);
		}
		const { hora, dia } = fechaDos(entrada.fecha ?? fechaDefecto);
		return { ruta, nombre, contenido, crc: crc32(contenido), hora, dia, desplazamiento: 0 };
	});
	preparadas.sort((a, b) => compararBytes(a.nombre, b.nombre));
	let inicioCentral = 0;
	let largoCentral = 0;
	for (const entrada of preparadas) {
		entrada.desplazamiento = inicioCentral;
		inicioCentral += 30 + entrada.nombre.length + entrada.contenido.byteLength;
		largoCentral += 46 + entrada.nombre.length;
		if (inicioCentral + largoCentral + 22 > LIMITE_ARCHIVO_ZIP_DOCUMENTAL) {
			throw new Error(`ZIP documental excede ${LIMITE_ARCHIVO_ZIP_DOCUMENTAL} bytes`);
		}
	}
	const salida = new Uint8Array(inicioCentral + largoCentral + 22);
	const vista = new DataView(salida.buffer);
	let p = 0;
	for (const entrada of preparadas) {
		vista.setUint32(p, 0x04034b50, true);
		vista.setUint16(p + 4, 20, true); // versión mínima: ZIP 2.0
		vista.setUint16(p + 6, 0x0800, true); // ruta UTF-8
		vista.setUint16(p + 8, 0, true); // STORE
		vista.setUint16(p + 10, entrada.hora, true);
		vista.setUint16(p + 12, entrada.dia, true);
		vista.setUint32(p + 14, entrada.crc, true);
		vista.setUint32(p + 18, entrada.contenido.byteLength, true);
		vista.setUint32(p + 22, entrada.contenido.byteLength, true);
		vista.setUint16(p + 26, entrada.nombre.length, true);
		vista.setUint16(p + 28, 0, true);
		p += 30;
		salida.set(entrada.nombre, p);
		p += entrada.nombre.length;
		salida.set(entrada.contenido, p);
		p += entrada.contenido.byteLength;
	}
	for (const entrada of preparadas) {
		vista.setUint32(p, 0x02014b50, true);
		vista.setUint16(p + 4, 0x0314, true); // host Unix, versión ZIP 2.0
		vista.setUint16(p + 6, 20, true);
		vista.setUint16(p + 8, 0x0800, true);
		vista.setUint16(p + 10, 0, true);
		vista.setUint16(p + 12, entrada.hora, true);
		vista.setUint16(p + 14, entrada.dia, true);
		vista.setUint32(p + 16, entrada.crc, true);
		vista.setUint32(p + 20, entrada.contenido.byteLength, true);
		vista.setUint32(p + 24, entrada.contenido.byteLength, true);
		vista.setUint16(p + 28, entrada.nombre.length, true);
		vista.setUint16(p + 30, 0, true);
		vista.setUint16(p + 32, 0, true);
		vista.setUint16(p + 34, 0, true);
		vista.setUint16(p + 36, 0, true);
		vista.setUint32(p + 38, (0o100644 << 16) >>> 0, true);
		vista.setUint32(p + 42, entrada.desplazamiento, true);
		p += 46;
		salida.set(entrada.nombre, p);
		p += entrada.nombre.length;
	}
	vista.setUint32(p, 0x06054b50, true);
	vista.setUint16(p + 4, 0, true);
	vista.setUint16(p + 6, 0, true);
	vista.setUint16(p + 8, preparadas.length, true);
	vista.setUint16(p + 10, preparadas.length, true);
	vista.setUint32(p + 12, largoCentral, true);
	vista.setUint32(p + 16, inicioCentral, true);
	vista.setUint16(p + 20, 0, true);
	return salida;
}
