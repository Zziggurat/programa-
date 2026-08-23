import type {
	AlmacenPersistencia,
	BackendPersistencia,
	ModoTransaccion,
	TransaccionPersistencia,
} from './tipos.js';
import { ALMACENES_PERSISTENCIA } from './tipos.js';

type Tablas = Map<AlmacenPersistencia, Map<string, unknown>>;

function clonar<T>(valor: T): T {
	return structuredClone(valor);
}

function tablasVacias(): Tablas {
	return new Map(ALMACENES_PERSISTENCIA.map((nombre) => [nombre, new Map<string, unknown>()]));
}

function clonarTablas(origen: Tablas): Tablas {
	return new Map([...origen].map(([nombre, tabla]) => [
		nombre,
		new Map([...tabla].map(([clave, valor]) => [clave, clonar(valor)])),
	]));
}

/** Backend transaccional determinista para tests y ejecución sin IndexedDB. */
export class BackendPersistenciaMemoria implements BackendPersistencia {
	private tablas = tablasVacias();
	private cola: Promise<void> = Promise.resolve();
	private errorTrasProximaTransaccion: Error | undefined;

	/** Inyección de fallo útil para demostrar que una escritura compuesta es atómica. */
	fallarProximaTransaccion(error = new Error('Fallo de almacenamiento simulado')): void {
		this.errorTrasProximaTransaccion = error;
	}

	async contar(almacen: AlmacenPersistencia): Promise<number> {
		return this.transaccion([almacen], 'readonly', async (tx) => (await tx.listar(almacen)).length);
	}

	transaccion<T>(
		almacenes: readonly AlmacenPersistencia[],
		modo: ModoTransaccion,
		trabajo: (tx: TransaccionPersistencia) => Promise<T>,
	): Promise<T> {
		const ejecutar = async (): Promise<T> => {
			const tablasTrabajo = modo === 'readwrite' ? clonarTablas(this.tablas) : this.tablas;
			const permitidos = new Set(almacenes);
			const tabla = (almacen: AlmacenPersistencia): Map<string, unknown> => {
				if (!permitidos.has(almacen)) throw new Error(`El almacén ${almacen} no participa en la transacción.`);
				return tablasTrabajo.get(almacen)!;
			};
			const tx: TransaccionPersistencia = {
				obtener: async <U>(almacen: AlmacenPersistencia, clave: string) => {
					const valor = tabla(almacen).get(clave);
					return valor === undefined ? undefined : clonar(valor) as U;
				},
				guardar: async <U>(almacen: AlmacenPersistencia, clave: string, valor: U) => {
					if (modo !== 'readwrite') throw new Error('Una transacción de solo lectura no puede guardar.');
					tabla(almacen).set(clave, clonar(valor));
				},
				eliminar: async (almacen, clave) => {
					if (modo !== 'readwrite') throw new Error('Una transacción de solo lectura no puede eliminar.');
					tabla(almacen).delete(clave);
				},
				listar: async <U>(almacen: AlmacenPersistencia) => [...tabla(almacen).values()].map(clonar) as U[],
			};
			const resultado = await trabajo(tx);
			if (modo === 'readwrite' && this.errorTrasProximaTransaccion) {
				const error = this.errorTrasProximaTransaccion;
				this.errorTrasProximaTransaccion = undefined;
				throw error;
			}
			if (modo === 'readwrite') this.tablas = tablasTrabajo;
			return resultado;
		};

		const resultado = this.cola.then(ejecutar, ejecutar);
		this.cola = resultado.then(() => undefined, () => undefined);
		return resultado;
	}
}
