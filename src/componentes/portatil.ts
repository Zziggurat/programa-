/** Codec portable individual. No consulta IndexedDB ni publica nada en el catálogo técnico. */
import { base64ABytes, bytesABase64 } from './assets.js';
import {
	FORMATO_COMPONENTE_PERSONALIZADO, VERSION_COMPONENTE_PERSONALIZADO,
	validarDefinicionComponente, validarLimitesTerminales, validarSemanticaTerminales,
	type DefinicionComponentePersonalizado, type ParametrosNominalesComponente,
	type TerminalComponentePersonalizado,
} from './personalizados.js';
import { leerMontajeDeclarado, validarMontajeDeclarado } from './montaje.js';
import { leerComportamientoSimulacion } from '../modelo/comportamiento.js';
import type { TipoBorne, TipoDispositivo } from '../modelo/tipos.js';
import { inspeccionarDatosNoConfiables } from '../datos-tecnicos/schema.js';
import { PERFILES_BASE } from './perfiles-base.js';

export type MimeComponentePortatil = 'image/png' | 'image/jpeg' | 'image/webp';
export interface ArchivoComponentePortatil {
	formato: 'tablero-studio-componente-portatil';
	/** V2 es obligatorio si la definición lleva ficha técnica autocontenida. */
	version: 1 | 2;
	definicion: DefinicionComponentePersonalizado;
	asset: { id: string; mime: MimeComponentePortatil; base64: string };
}

export const MAX_TSCOMP_TEXTO = 64 * 1024 * 1024;
const MAX_TERMINALES = 4096;
const MIMES = new Set<MimeComponentePortatil>(['image/png', 'image/jpeg', 'image/webp']);
const TIPOS_BORNE = new Set<TipoBorne>(['L', 'N', 'PE', 'control', 'senal', 'otro']);
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const requerido = (v: unknown, campo: string): string => {
	if (typeof v !== 'string' || !v.trim()) throw new Error(`Falta ${campo}.`);
	return v.trim();
};
const opcional = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;
const rango = (v: unknown): [number, number] | undefined => Array.isArray(v) && v.length === 2
	&& v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1]] : undefined;
const exigirClaves = (objeto: Record<string, unknown>, claves: readonly string[], campo: string): void => {
	if (Object.keys(objeto).some((k) => !claves.includes(k))) throw new Error(`${campo}: campo desconocido.`);
};

function validarDefinicionSegura(d: unknown): asserts d is DefinicionComponentePersonalizado {
	if (!esObjeto(d) || !esObjeto(d.dimensiones) || !Array.isArray(d.terminales)
		|| !esObjeto(d.comportamiento) || d.terminales.length > MAX_TERMINALES) {
		throw new Error('La definición del componente está incompleta o excede el límite de terminales.');
	}
	try {
		const errores = validarDefinicionComponente(d as unknown as DefinicionComponentePersonalizado);
		if (errores.length) throw new Error(errores.join('; '));
	} catch (error) {
		throw new Error(`Definición inválida: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Reconstruye únicamente campos declarados; V1 puede tener metadatos ajenos inocuos. */
function leerDefinicion(bruto: unknown, version: 1 | 2): DefinicionComponentePersonalizado {
	if (!esObjeto(bruto) || !esObjeto(bruto.dimensiones) || !Array.isArray(bruto.terminales)
		|| bruto.terminales.length > MAX_TERMINALES || !Number.isInteger(bruto.revision)
		|| bruto.formato !== FORMATO_COMPONENTE_PERSONALIZADO
		|| bruto.version !== VERSION_COMPONENTE_PERSONALIZADO) {
		throw new Error('La definición del componente está incompleta o no es compatible.');
	}
	inspeccionarDatosNoConfiables(bruto);
	if (version === 1 && bruto.fichaTecnica !== undefined) {
		throw new Error('Una ficha técnica exige .tscomp V2; V1 no puede descartarla silenciosamente.');
	}
	if (version === 2) {
		exigirClaves(bruto, ['formato', 'version', 'id', 'revision', 'nombre', 'fabricante', 'referencia',
			'descripcion', 'creadoEn', 'modificadoEn', 'tipoDispositivo', 'dimensiones', 'montaje', 'assetId',
			'terminales', 'bloquesTerminales', 'comportamiento', 'parametros', 'fichaTecnica'], 'Definición V2');
		exigirClaves(bruto.dimensiones, ['anchoMm', 'altoMm', 'fondoMm'], 'Dimensiones V2');
		if (esObjeto(bruto.montaje)) {
			exigirClaves(bruto.montaje, ['metodo', 'anclajes'], 'Montaje V2');
			if (Array.isArray(bruto.montaje.anclajes)) for (const anclaje of bruto.montaje.anclajes) {
				if (esObjeto(anclaje)) exigirClaves(anclaje, ['xMm', 'yMm', 'diametroMm'], 'Anclaje V2');
			}
		}
		if (bruto.fichaTecnica === undefined) throw new Error('Un .tscomp V2 requiere una ficha técnica exacta.');
	}
	const tipo = requerido(bruto.tipoDispositivo, 'el perfil') as TipoDispositivo;
	if (!Object.hasOwn(PERFILES_BASE, tipo)) throw new Error(`Perfil no reconocido: ${tipo}.`);
	const comportamiento = leerComportamientoSimulacion(bruto.comportamiento);
	if (!comportamiento) throw new Error('El comportamiento del componente no es válido.');
	const terminales: TerminalComponentePersonalizado[] = bruto.terminales.map((t: unknown, i: number) => {
		if (!esObjeto(t) || typeof t.id !== 'string' || typeof t.u !== 'number' || typeof t.v !== 'number') {
			throw new Error(`Terminal ${i + 1} no válido.`);
		}
		if (version === 2) exigirClaves(t, ['id', 'rotulo', 'tipo', 'u', 'v', 'lado', 'obligatorio',
			'maxConductores', 'seccionMaxMm2'], `Terminal ${t.id}`);
		if (t.tipo !== undefined && !TIPOS_BORNE.has(t.tipo as TipoBorne)) throw new Error(`Terminal ${t.id}: naturaleza eléctrica no reconocida.`);
		const errores = [...validarLimitesTerminales([{ id: t.id, maxConductores: t.maxConductores,
			seccionMaxMm2: t.seccionMaxMm2 }]),
			...validarSemanticaTerminales([{ id: t.id, lado: t.lado, obligatorio: t.obligatorio }])];
		if (errores.length) throw new Error(errores.join('; '));
		return { id: t.id, u: t.u, v: t.v,
			...(t.rotulo !== undefined ? { rotulo: t.rotulo as string } : {}),
			...(t.tipo !== undefined ? { tipo: t.tipo as TipoBorne } : {}),
			...(t.lado !== undefined ? { lado: t.lado as TerminalComponentePersonalizado['lado'] } : {}),
			...(t.obligatorio !== undefined ? { obligatorio: t.obligatorio as boolean } : {}),
			...(t.maxConductores !== undefined ? { maxConductores: t.maxConductores as number } : {}),
			...(t.seccionMaxMm2 !== undefined ? { seccionMaxMm2: t.seccionMaxMm2 as number } : {}),
		};
	});
	let parametros: ParametrosNominalesComponente | undefined;
	if (bruto.parametros !== undefined) {
		if (!esObjeto(bruto.parametros)) throw new Error('Los parámetros no son un objeto.');
		const p = bruto.parametros; parametros = {};
		if (version === 2) exigirClaves(p, ['tensionV', 'corrienteA', 'potenciaW',
			'frecuenciaHz', 'temporizacion', 'programa', 'unidadSonda', 'rangoSonda',
			'rangoSalidaAnalogica'], 'Parámetros V2');
		for (const clave of ['tensionV', 'corrienteA', 'potenciaW', 'frecuenciaHz'] as const) {
			if (p[clave] !== undefined) {
				if (typeof p[clave] !== 'number' || !Number.isFinite(p[clave])) throw new Error(`Parámetro ${clave} inválido.`);
				parametros[clave] = p[clave] as number;
			}
		}
		if (p.temporizacion !== undefined) {
			if (!esObjeto(p.temporizacion) || !['trabajo', 'reposo'].includes(String(p.temporizacion.tipo))
				|| typeof p.temporizacion.segundos !== 'number' || !Number.isFinite(p.temporizacion.segundos)) {
				throw new Error('Temporización inválida.');
			}
			if (version === 2) exigirClaves(p.temporizacion, ['tipo', 'segundos'], 'Temporización V2');
			parametros.temporizacion = { tipo: p.temporizacion.tipo as 'trabajo' | 'reposo', segundos: p.temporizacion.segundos };
		}
		if (opcional(p.programa)) parametros.programa = opcional(p.programa);
		if (opcional(p.unidadSonda)) parametros.unidadSonda = opcional(p.unidadSonda);
		if (p.rangoSonda !== undefined && !rango(p.rangoSonda)) throw new Error('Rango de sonda inválido.');
		if (p.rangoSalidaAnalogica !== undefined && !rango(p.rangoSalidaAnalogica)) throw new Error('Rango de salida analógica inválido.');
		if (rango(p.rangoSonda)) parametros.rangoSonda = rango(p.rangoSonda);
		if (rango(p.rangoSalidaAnalogica)) parametros.rangoSalidaAnalogica = rango(p.rangoSalidaAnalogica);
	}
	const dimensiones = {
		anchoMm: bruto.dimensiones.anchoMm as number,
		altoMm: bruto.dimensiones.altoMm as number,
		fondoMm: bruto.dimensiones.fondoMm as number,
	};
	const erroresMontaje = validarMontajeDeclarado(bruto.montaje, dimensiones);
	if (erroresMontaje.length) throw new Error(erroresMontaje.join('; '));
	const montaje = leerMontajeDeclarado(bruto.montaje, dimensiones);
	const definicion: DefinicionComponentePersonalizado = {
		formato: FORMATO_COMPONENTE_PERSONALIZADO, version: VERSION_COMPONENTE_PERSONALIZADO,
		id: requerido(bruto.id, 'la identidad'), revision: bruto.revision as number,
		nombre: requerido(bruto.nombre, 'el nombre'), creadoEn: requerido(bruto.creadoEn, 'la fecha de creación'),
		modificadoEn: requerido(bruto.modificadoEn, 'la fecha de modificación'),
		...(opcional(bruto.fabricante) ? { fabricante: opcional(bruto.fabricante) } : {}),
		...(opcional(bruto.referencia) ? { referencia: opcional(bruto.referencia) } : {}),
		...(opcional(bruto.descripcion) ? { descripcion: opcional(bruto.descripcion) } : {}), tipoDispositivo: tipo,
		dimensiones, ...(montaje ? { montaje } : {}),
		assetId: requerido(bruto.assetId, 'el asset'), terminales, comportamiento,
		...(bruto.bloquesTerminales !== undefined
			? { bloquesTerminales: structuredClone(bruto.bloquesTerminales) as DefinicionComponentePersonalizado['bloquesTerminales'] }
			: {}),
		...(parametros ? { parametros } : {}),
		...(version === 2 ? { fichaTecnica: structuredClone(bruto.fichaTecnica) as DefinicionComponentePersonalizado['fichaTecnica'] } : {}),
	};
	validarDefinicionSegura(definicion);
	return definicion;
}

function firmaImagen(mime: MimeComponentePortatil, bytes: Uint8Array): boolean {
	const coincide = (offset: number, firma: number[]) => firma.every((b, i) => bytes[offset + i] === b);
	if (mime === 'image/png') return coincide(0, [137, 80, 78, 71, 13, 10, 26, 10]);
	if (mime === 'image/jpeg') return coincide(0, [255, 216, 255]);
	return coincide(0, [82, 73, 70, 70]) && coincide(8, [87, 69, 66, 80]);
}

async function verificarAsset(asset: ArchivoComponentePortatil['asset'], assetId: string): Promise<Uint8Array> {
	if (!/^sha256:[a-f0-9]{64}$/.test(asset.id) || asset.id !== assetId || !MIMES.has(asset.mime)
		|| !asset.base64 || asset.base64.length > MAX_TSCOMP_TEXTO
		|| !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) throw new Error('Asset portátil, MIME o identidad inválidos.');
	let bytes: Uint8Array;
	try { bytes = base64ABytes(asset.base64); } catch { throw new Error('Base64 del asset inválido.'); }
	if (!bytes.length || bytesABase64(bytes) !== asset.base64 || !firmaImagen(asset.mime, bytes)) {
		throw new Error('El asset no contiene una imagen PNG/JPEG/WebP con MIME coherente.');
	}
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
	const id = `sha256:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
	if (id !== asset.id) throw new Error(`El contenido del asset ${asset.id} no coincide con su SHA-256.`);
	return bytes;
}

/** Parser no mutante de V1/V2. Toda validación sucede antes de cualquier transacción IDB. */
export async function leerComponentePortatil(textoJson: string): Promise<ArchivoComponentePortatil> {
	if (textoJson.length > MAX_TSCOMP_TEXTO) throw new Error('El componente supera el límite de 64 MiB de texto.');
	let bruto: unknown;
	try { bruto = JSON.parse(textoJson); } catch { throw new Error('JSON del componente inválido.'); }
	if (!esObjeto(bruto) || bruto.formato !== 'tablero-studio-componente-portatil'
		|| (bruto.version !== 1 && bruto.version !== 2) || !esObjeto(bruto.asset)) {
		throw new Error('Formato de componente portable no compatible.');
	}
	const version = bruto.version;
	if (version === 2 && Object.keys(bruto).some((k) => !['formato', 'version', 'definicion', 'asset'].includes(k))) {
		throw new Error('El archivo V2 incluye campos desconocidos.');
	}
	const definicion = leerDefinicion(bruto.definicion, version);
	const asset = bruto.asset;
	if (version === 2 && Object.keys(asset).some((k) => !['id', 'mime', 'base64'].includes(k))) {
		throw new Error('El asset V2 incluye campos desconocidos.');
	}
	const limpio = { id: requerido(asset.id, 'la identidad del asset'),
		mime: requerido(asset.mime, 'el MIME') as MimeComponentePortatil,
		base64: requerido(asset.base64, 'el contenido del asset') };
	await verificarAsset(limpio, definicion.assetId);
	return { formato: 'tablero-studio-componente-portatil', version, definicion, asset: limpio };
}

export async function leerComponentePortatilDesdeArchivo(archivo: Pick<Blob, 'size' | 'text'>): Promise<ArchivoComponentePortatil> {
	if (archivo.size > MAX_TSCOMP_TEXTO) throw new Error('El componente supera el límite de importación de 64 MiB.');
	return leerComponentePortatil(await archivo.text());
}

/** Exportar tampoco confía en un registro local corrupto. La función no escribe almacenamiento. */
export async function crearComponentePortatil(definicion: DefinicionComponentePersonalizado,
	asset: { id: string; mime: string; bytes: Uint8Array }): Promise<ArchivoComponentePortatil> {
	validarDefinicionSegura(definicion);
	if (!MIMES.has(asset.mime as MimeComponentePortatil)) throw new Error(`MIME no admitido: ${asset.mime}.`);
	if (asset.bytes.length * 4 / 3 > MAX_TSCOMP_TEXTO) throw new Error('La imagen supera el límite portable de 64 MiB.');
	const limpio = { id: asset.id, mime: asset.mime as MimeComponentePortatil, base64: bytesABase64(asset.bytes) };
	await verificarAsset(limpio, definicion.assetId);
	const version = definicion.fichaTecnica === undefined ? 1 : 2;
	const paquete: ArchivoComponentePortatil = { formato: 'tablero-studio-componente-portatil', version,
		definicion: structuredClone(definicion), asset: limpio };
	if (JSON.stringify(paquete).length > MAX_TSCOMP_TEXTO) throw new Error('El componente supera el límite portable de 64 MiB.');
	return paquete;
}
