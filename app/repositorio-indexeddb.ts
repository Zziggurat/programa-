import { RepositorioProyectosCore } from '../src/persistencia/repositorio.js';
import type {
	AlmacenPersistencia,
	BackendPersistencia,
	ModoTransaccion,
	OpcionesRepositorio,
	RepositorioProyectos,
	TransaccionPersistencia,
} from '../src/persistencia/tipos.js';
import { ALMACENES_PERSISTENCIA } from '../src/persistencia/tipos.js';

export const NOMBRE_BASE_PROYECTOS = 'tablerostudio-documentos';
export const VERSION_BASE_PROYECTOS = 1;

function esperarPeticion<T>(peticion: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		peticion.onsuccess = () => resolve(peticion.result);
		peticion.onerror = () => reject(peticion.error ?? new Error('IndexedDB rechazó una operación.'));
	});
}

function esperarTransaccion(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error ?? new Error('La transacción IndexedDB fue abortada.'));
		tx.onerror = () => reject(tx.error ?? new Error('La transacción IndexedDB falló.'));
	});
}

/** Adaptador físico; el dominio no conoce IDBRequest ni mantiene transacciones abiertas al hacer hash. */
export class BackendPersistenciaIndexedDB implements BackendPersistencia {
	constructor(readonly base: IDBDatabase) {}

	async transaccion<T>(
		almacenes: readonly AlmacenPersistencia[],
		modo: ModoTransaccion,
		trabajo: (tx: TransaccionPersistencia) => Promise<T>,
	): Promise<T> {
		const transaccion = this.base.transaction([...almacenes], modo);
		const fin = esperarTransaccion(transaccion);
		const adaptador: TransaccionPersistencia = {
			obtener: async <U>(almacen: AlmacenPersistencia, clave: string) =>
				esperarPeticion(transaccion.objectStore(almacen).get(clave)) as Promise<U | undefined>,
			guardar: async <U>(almacen: AlmacenPersistencia, clave: string, valor: U) => {
				await esperarPeticion(transaccion.objectStore(almacen).put(valor, clave));
			},
			eliminar: async (almacen, clave) => {
				await esperarPeticion(transaccion.objectStore(almacen).delete(clave));
			},
			listar: async <U>(almacen: AlmacenPersistencia) =>
				esperarPeticion(transaccion.objectStore(almacen).getAll()) as Promise<U[]>,
		};
		try {
			const resultado = await trabajo(adaptador);
			await fin;
			return resultado;
		} catch (error) {
			try { transaccion.abort(); } catch { /* ya terminó o ya fue abortada */ }
			// Consumir el rechazo de `fin`: la causa útil es la excepción del dominio.
			await fin.catch(() => undefined);
			throw error;
		}
	}
}

function crearEsquema(base: IDBDatabase): void {
	for (const nombre of ALMACENES_PERSISTENCIA) {
		if (!base.objectStoreNames.contains(nombre)) base.createObjectStore(nombre);
	}
}

export function abrirBaseProyectosIndexedDB(
	nombre = NOMBRE_BASE_PROYECTOS,
	fabrica: IDBFactory = globalThis.indexedDB,
): Promise<IDBDatabase> {
	if (!fabrica) return Promise.reject(new Error('IndexedDB no está disponible en este entorno.'));
	return new Promise((resolve, reject) => {
		let aperturaRechazada = false;
		const peticion = fabrica.open(nombre, VERSION_BASE_PROYECTOS);
		peticion.onupgradeneeded = () => crearEsquema(peticion.result);
		peticion.onsuccess = () => {
			const base = peticion.result;
			if (aperturaRechazada) {
				base.close();
				return;
			}
			base.onversionchange = () => base.close();
			resolve(base);
		};
		peticion.onerror = () => reject(peticion.error ?? new Error('No se pudo abrir IndexedDB.'));
		peticion.onblocked = () => {
			aperturaRechazada = true;
			reject(new Error('La actualización de IndexedDB está bloqueada por otra pestaña.'));
		};
	});
}

export interface RepositorioIndexedDBAbierto {
	repositorio: RepositorioProyectos;
	cerrar(): void;
}

/** Punto de construcción para la futura integración de UI; no toca localStorage ni el documento activo. */
export async function abrirRepositorioProyectosIndexedDB(
	opciones: OpcionesRepositorio & { nombreBase?: string; fabrica?: IDBFactory } = {},
): Promise<RepositorioIndexedDBAbierto> {
	const { nombreBase, fabrica, ...opcionesRepositorio } = opciones;
	const base = await abrirBaseProyectosIndexedDB(nombreBase, fabrica);
	return {
		repositorio: new RepositorioProyectosCore(new BackendPersistenciaIndexedDB(base), opcionesRepositorio),
		cerrar: () => base.close(),
	};
}
