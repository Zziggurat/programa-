/** Manifiesto de integridad de un paquete documental; no aprueba ni certifica el proyecto. */
import type { ProcedenciaDocumento } from './procedencia-documental.js';
import { crearZipDocumental, normalizarRutaZipDocumental } from './zip-documental.js';

export interface ArchivoPaqueteDocumental {
	ruta: string;
	contenido: string | Uint8Array;
	mime: string;
}

export interface ManifiestoPaqueteDocumental {
	formato: 'tablerostudio-paquete-documental';
	version: 1;
	proyecto: string;
	procedencia: ProcedenciaDocumento;
	alcance: string;
	limitaciones: string[];
	archivos: { ruta: string; mime: string; bytes: number; sha256: string }[];
}

const UTF8 = new TextEncoder();
const rutaReservada = 'manifiesto.json';

const hex = (bytes: Uint8Array): string => [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');

/**
 * Une archivos generados desde una sola copia del proyecto. Cada hash se refiere a los
 * bytes descargados, no a una cadena de texto reconstruida al abrirlos. El manifiesto
 * no se auto-hashea; esa circularidad impediría verificarlo.
 */
export async function crearZipDeRevisionDocumental(entrada: {
	proyecto: string;
	procedencia: ProcedenciaDocumento;
	archivos: readonly ArchivoPaqueteDocumental[];
	limitaciones?: readonly string[];
}): Promise<{ zip: Uint8Array; manifiesto: ManifiestoPaqueteDocumental }> {
	if (!entrada.archivos.length) throw new Error('El paquete documental no contiene archivos.');
	const vistos = new Set<string>();
	const archivos = entrada.archivos.map((archivo) => {
		const ruta = normalizarRutaZipDocumental(archivo.ruta);
		const clave = ruta.toLocaleLowerCase('en-US');
		if (clave === rutaReservada || vistos.has(clave))
			throw new Error(`Ruta duplicada o reservada en el paquete documental: ${ruta}`);
		vistos.add(clave);
		if (!archivo.mime.trim()) throw new Error(`El archivo ${ruta} no declara tipo MIME.`);
		return { ruta, mime: archivo.mime, contenido: typeof archivo.contenido === 'string'
			? UTF8.encode(archivo.contenido) : Uint8Array.from(archivo.contenido) };
	}).sort((a, b) => a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0);
	const fichas = await Promise.all(archivos.map(async ({ ruta, mime, contenido }) => ({
		ruta, mime, bytes: contenido.byteLength,
		sha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(contenido)))),
	})));
	const manifiesto: ManifiestoPaqueteDocumental = {
		formato: 'tablerostudio-paquete-documental', version: 1,
		proyecto: entrada.proyecto,
		procedencia: structuredClone(entrada.procedencia),
		alcance: 'Documentación eléctrica derivada de una sola revisión; no es certificación ni aprobación de fabricación.',
		limitaciones: [...(entrada.limitaciones ?? [])],
		archivos: fichas,
	};
	const zip = crearZipDocumental([...archivos.map(({ ruta, contenido }) => ({ ruta, contenido })),
		{ ruta: rutaReservada, contenido: JSON.stringify(manifiesto, null, 2) + '\n' }]);
	return { zip, manifiesto };
}
