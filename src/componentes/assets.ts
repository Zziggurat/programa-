import type { Proyecto } from '../modelo/tipos.js';

export interface AssetDeImagen {
	id: string;
	mime: string;
	bytes: Uint8Array;
}

export interface FabricaUrlAsset {
	crear(blob: Blob): string;
	revocar(url: string): void;
}

export interface ProyectoConAssets {
	proyecto: Proyecto;
	faltantes: string[];
	liberar(): void;
}

const clonar = <T>(valor: T): T => structuredClone(valor);

/**
 * Copia apta para IndexedDB: las instancias personalizadas conservan `assetId`, perfil y bornes,
 * pero no duplican la imagen resuelta. Una referencia legacy sin asset sigue siendo autocontenida.
 */
export function proyectoParaPersistir(proyecto: Proyecto): Proyecto {
	const copia = clonar(proyecto);
	for (const d of copia.dispositivos) if (d.assetId) delete d.imagen;
	return copia;
}

/**
 * Resuelve assets al abrir un documento sin contaminar el contenido persistente. Las URL son
 * pequeñas, revocables y sí pueden formar parte del historial runtime; nunca se escriben porque
 * `proyectoParaPersistir()` las elimina antes de entregar el documento al repositorio.
 */
export async function hidratarImagenesDeProyecto(
	proyectoPersistido: Proyecto,
	abrirAsset: (id: string) => Promise<AssetDeImagen | undefined>,
	fabrica: FabricaUrlAsset = {
		crear: (blob) => URL.createObjectURL(blob),
		revocar: (url) => URL.revokeObjectURL(url),
	},
): Promise<ProyectoConAssets> {
	const proyecto = clonar(proyectoPersistido);
	const urls: string[] = [];
	const faltantes = new Set<string>();
	const porId = new Map<string, Promise<AssetDeImagen | undefined>>();
	for (const d of proyecto.dispositivos) {
		if (!d.assetId) continue;
		let pendiente = porId.get(d.assetId);
		if (!pendiente) {
			pendiente = abrirAsset(d.assetId);
			porId.set(d.assetId, pendiente);
		}
		const asset = await pendiente;
		if (!asset) { faltantes.add(d.assetId); continue; }
		const bytes = Uint8Array.from(asset.bytes);
		const url = fabrica.crear(new Blob([bytes.buffer], { type: asset.mime }));
		urls.push(url);
		d.imagen = url;
	}
	let liberado = false;
	return {
		proyecto,
		faltantes: [...faltantes].sort(),
		liberar: () => {
			if (liberado) return;
			liberado = true;
			for (const url of urls) fabrica.revocar(url);
		},
	};
}

/** Base64 portable sin depender de Node/Buffer. */
export function bytesABase64(bytes: Uint8Array): string {
	let binario = '';
	const BLOQUE = 0x8000;
	for (let i = 0; i < bytes.length; i += BLOQUE) {
		binario += String.fromCharCode(...bytes.subarray(i, i + BLOQUE));
	}
	return btoa(binario);
}

export function base64ABytes(base64: string): Uint8Array {
	const binario = atob(base64);
	const bytes = new Uint8Array(binario.length);
	for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
	return bytes;
}
