import { cargarProyecto } from '../modelo/cargar.js';
import type { Proyecto } from '../modelo/tipos.js';
import type {
	AssetPersistido,
	BackendPersistencia,
	DocumentoProyecto,
	MarcadorMigracionLegacy,
	MotivoSnapshot,
	OpcionesCrearProyecto,
	OpcionesGuardarProyecto,
	OpcionesRepositorio,
	RecuperacionLegacy,
	RepositorioProyectos,
	ResumenProyecto,
	ResultadoMigracionLegacy,
	SnapshotProyecto,
	TransaccionPersistencia,
} from './tipos.js';
import {
	ConflictoRevision,
	ProyectoNoEncontrado,
	ProyectoPersistenciaInvalido,
} from './tipos.js';

const MIME_ASSET = new Set(['image/png', 'image/jpeg', 'image/webp']);

function clonar<T>(valor: T): T {
	return structuredClone(valor);
}

function validarProyecto(proyecto: Proyecto, permitirReparacion = false): {
	proyecto: Proyecto;
	arreglos: string[];
} {
	try {
		const carga = cargarProyecto(JSON.stringify(proyecto));
		if (!permitirReparacion && carga.arreglos.length > 0) {
			throw new ProyectoPersistenciaInvalido(
				`El proyecto requeriría reparaciones antes de guardarse: ${carga.arreglos.join('; ')}`,
			);
		}
		return { proyecto: carga.proyecto, arreglos: carga.arreglos };
	} catch (error) {
		if (error instanceof ProyectoPersistenciaInvalido) throw error;
		throw new ProyectoPersistenciaInvalido('El proyecto no cumple el formato persistente.', error);
	}
}

function nombreValido(nombre: string): string {
	const limpio = nombre.trim();
	if (!limpio) throw new ProyectoPersistenciaInvalido('El nombre del proyecto no puede estar vacío.');
	return limpio.slice(0, 160);
}

function resumen(documento: DocumentoProyecto): ResumenProyecto {
	const { proyecto: _proyecto, ...salida } = documento;
	return salida;
}

async function sha256Nativo(bytes: Uint8Array): Promise<string> {
	// Copia a un ArrayBuffer propio: WebCrypto del DOM no acepta un posible SharedArrayBuffer.
	const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Repositorio de documentos independiente de la UI y del mecanismo físico de almacenamiento.
 * La identidad y la revisión viven en el sobre; `Proyecto` conserva su formato de intercambio.
 */
export class RepositorioProyectosCore implements RepositorioProyectos {
	private readonly maxSnapshots: number;
	private readonly reloj: () => Date;
	private readonly crearId: () => string;
	private readonly sha256: (bytes: Uint8Array) => Promise<string>;

	constructor(private readonly backend: BackendPersistencia, opciones: OpcionesRepositorio = {}) {
		this.maxSnapshots = Math.max(1, Math.floor(opciones.maxSnapshotsPorProyecto ?? 20));
		this.reloj = opciones.reloj ?? (() => new Date());
		this.crearId = opciones.crearId ?? (() => globalThis.crypto.randomUUID());
		this.sha256 = opciones.sha256 ?? sha256Nativo;
	}

	private ahora(): string {
		return this.reloj().toISOString();
	}

	private async registro(tx: TransaccionPersistencia, id: string): Promise<DocumentoProyecto> {
		const guardado = await tx.obtener<DocumentoProyecto>('projects', id);
		if (!guardado) throw new ProyectoNoEncontrado(id);
		return guardado;
	}

	private async documento(tx: TransaccionPersistencia, id: string): Promise<DocumentoProyecto> {
		const guardado = await this.registro(tx, id);
		const { proyecto } = validarProyecto(guardado.proyecto);
		return { ...guardado, proyecto };
	}

	private comprobarRevision(documento: DocumentoProyecto, esperada: number): void {
		if (documento.revision !== esperada) {
			throw new ConflictoRevision(documento.id, esperada, documento.revision);
		}
	}

	async crear(opciones: OpcionesCrearProyecto): Promise<DocumentoProyecto> {
		const validado = validarProyecto(opciones.proyecto).proyecto;
		const id = opciones.id ?? this.crearId();
		const nombre = nombreValido(opciones.nombre ?? validado.nombre);
		const ahora = this.ahora();
		return this.backend.transaccion(['projects'], 'readwrite', async (tx) => {
			if (await tx.obtener('projects', id)) {
				throw new ProyectoPersistenciaInvalido(`Ya existe un proyecto con la identidad ${id}.`);
			}
			const documento: DocumentoProyecto = {
				id,
				nombre,
				creadoEn: ahora,
				modificadoEn: ahora,
				ultimoAcceso: ahora,
				revision: 1,
				estado: 'normal',
				proyecto: { ...validado, nombre },
			};
			await tx.guardar('projects', id, documento);
			return clonar(documento);
		});
	}

	async guardar(id: string, opciones: OpcionesGuardarProyecto): Promise<DocumentoProyecto> {
		const validado = validarProyecto(opciones.proyecto).proyecto;
		const ahora = this.ahora();
		return this.backend.transaccion(['projects'], 'readwrite', async (tx) => {
			const anterior = await this.documento(tx, id);
			this.comprobarRevision(anterior, opciones.revisionEsperada);
			const nombre = nombreValido(validado.nombre);
			const documento: DocumentoProyecto = {
				...anterior,
				nombre,
				modificadoEn: ahora,
				ultimoAcceso: ahora,
				revision: anterior.revision + 1,
				// Guardar no equivale a que una persona haya aceptado una reparación legacy.
				estado: opciones.aceptarReparacion ? 'normal' : anterior.estado,
				proyecto: { ...validado, nombre },
			};
			await tx.guardar('projects', id, documento);
			return clonar(documento);
		});
	}

	async abrir(id: string): Promise<DocumentoProyecto> {
		const ahora = this.ahora();
		return this.backend.transaccion(['projects'], 'readwrite', async (tx) => {
			const documento = await this.documento(tx, id);
			const abierto = { ...documento, ultimoAcceso: ahora };
			await tx.guardar('projects', id, abierto);
			return clonar(abierto);
		});
	}

	async listar(): Promise<ResumenProyecto[]> {
		return this.backend.transaccion(['projects'], 'readonly', async (tx) => {
			const documentos = await tx.listar<DocumentoProyecto>('projects');
			// La biblioteca debe seguir disponible aunque un único contenido se haya corrompido.
			// `ResumenProyecto` no expone Proyecto; la validación estricta ocurre al abrirlo.
			return documentos.map(resumen)
				.sort((a, b) => b.modificadoEn.localeCompare(a.modificadoEn) || a.id.localeCompare(b.id));
		});
	}

	async duplicar(id: string, nuevoNombre?: string): Promise<DocumentoProyecto> {
		const nuevoId = this.crearId();
		const ahora = this.ahora();
		return this.backend.transaccion(['projects'], 'readwrite', async (tx) => {
			const original = await this.documento(tx, id);
			if (await tx.obtener('projects', nuevoId)) {
				throw new ProyectoPersistenciaInvalido(`Ya existe un proyecto con la identidad ${nuevoId}.`);
			}
			const nombre = nombreValido(nuevoNombre ?? `${original.nombre} (copia)`);
			const copia: DocumentoProyecto = {
				id: nuevoId,
				nombre,
				creadoEn: ahora,
				modificadoEn: ahora,
				ultimoAcceso: ahora,
				revision: 1,
				estado: original.estado,
				proyecto: { ...clonar(original.proyecto), nombre },
			};
			validarProyecto(copia.proyecto);
			await tx.guardar('projects', nuevoId, copia);
			return clonar(copia);
		});
	}

	async renombrar(id: string, nuevoNombre: string, revisionEsperada: number): Promise<DocumentoProyecto> {
		const nombre = nombreValido(nuevoNombre);
		const ahora = this.ahora();
		return this.backend.transaccion(['projects'], 'readwrite', async (tx) => {
			const anterior = await this.documento(tx, id);
			this.comprobarRevision(anterior, revisionEsperada);
			const proyecto = { ...anterior.proyecto, nombre };
			validarProyecto(proyecto);
			const documento: DocumentoProyecto = {
				...anterior, nombre, proyecto, modificadoEn: ahora, ultimoAcceso: ahora,
				revision: anterior.revision + 1,
			};
			await tx.guardar('projects', id, documento);
			return clonar(documento);
		});
	}

	async eliminar(id: string, revisionEsperada: number): Promise<void> {
		await this.backend.transaccion(['projects', 'snapshots'], 'readwrite', async (tx) => {
			const documento = await this.registro(tx, id);
			this.comprobarRevision(documento, revisionEsperada);
			await tx.eliminar('projects', id);
			const snapshots = await tx.listar<SnapshotProyecto>('snapshots');
			for (const snapshot of snapshots) if (snapshot.projectId === id) await tx.eliminar('snapshots', snapshot.id);
		});
	}

	private async snapshotInterno(
		tx: TransaccionPersistencia,
		documento: DocumentoProyecto,
		motivo: MotivoSnapshot,
	): Promise<SnapshotProyecto> {
		const snapshot: SnapshotProyecto = {
			id: this.crearId(),
			projectId: documento.id,
			creadoEn: this.ahora(),
			motivo,
			revisionOrigen: documento.revision,
			proyecto: clonar(validarProyecto(documento.proyecto).proyecto),
		};
		await tx.guardar('snapshots', snapshot.id, snapshot);
		const todos = (await tx.listar<SnapshotProyecto>('snapshots'))
			.filter((item) => item.projectId === documento.id)
			.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id.localeCompare(a.id));
		for (const sobrante of todos.slice(this.maxSnapshots)) await tx.eliminar('snapshots', sobrante.id);
		return snapshot;
	}

	async crearSnapshot(id: string, motivo: MotivoSnapshot = 'manual'): Promise<SnapshotProyecto> {
		return this.backend.transaccion(['projects', 'snapshots'], 'readwrite', async (tx) => {
			const documento = await this.documento(tx, id);
			return clonar(await this.snapshotInterno(tx, documento, motivo));
		});
	}

	async listarSnapshots(id: string): Promise<SnapshotProyecto[]> {
		return this.backend.transaccion(['projects', 'snapshots'], 'readonly', async (tx) => {
			await this.registro(tx, id);
			const snapshots = (await tx.listar<SnapshotProyecto>('snapshots'))
				.filter((item) => item.projectId === id)
				.map((item) => ({ ...item, proyecto: validarProyecto(item.proyecto).proyecto }))
				.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id.localeCompare(a.id));
			return clonar(snapshots);
		});
	}

	async restaurarSnapshot(
		id: string,
		snapshotId: string,
		revisionEsperada: number,
	): Promise<DocumentoProyecto> {
		return this.backend.transaccion(['projects', 'snapshots'], 'readwrite', async (tx) => {
			// La restauración también es la salida de emergencia si el contenido actual se corrompió:
			// para comprobar la revisión basta el sobre; el snapshot sí se valida antes de publicarlo.
			const actual = await this.registro(tx, id);
			this.comprobarRevision(actual, revisionEsperada);
			const snapshot = await tx.obtener<SnapshotProyecto>('snapshots', snapshotId);
			if (!snapshot || snapshot.projectId !== id) throw new ProyectoNoEncontrado(`snapshot:${snapshotId}`);
			const proyecto = validarProyecto(snapshot.proyecto).proyecto;
			try {
				const actualValido = { ...actual, proyecto: validarProyecto(actual.proyecto).proyecto };
				await this.snapshotInterno(tx, actualValido, 'antes-de-restaurar');
			} catch (error) {
				if (!(error instanceof ProyectoPersistenciaInvalido)) throw error;
				// Nunca convertir contenido corrupto en un snapshot aparentemente recuperable.
			}
			const ahora = this.ahora();
			const restaurado: DocumentoProyecto = {
				...actual,
				nombre: proyecto.nombre,
				proyecto,
				revision: actual.revision + 1,
				modificadoEn: ahora,
				ultimoAcceso: ahora,
				estado: 'normal',
			};
			await tx.guardar('projects', id, restaurado);
			return clonar(restaurado);
		});
	}

	async guardarAsset(mime: string, bytes: Uint8Array): Promise<AssetPersistido> {
		if (!MIME_ASSET.has(mime)) throw new ProyectoPersistenciaInvalido(`Tipo de asset no admitido: ${mime}.`);
		if (bytes.byteLength === 0) throw new ProyectoPersistenciaInvalido('Un asset vacío no se puede guardar.');
		const digest = await this.sha256(bytes);
		if (!/^[a-f\d]{64}$/i.test(digest)) throw new Error('La función SHA-256 devolvió un identificador inválido.');
		const id = `sha256:${digest.toLowerCase()}`;
		return this.backend.transaccion(['assets'], 'readwrite', async (tx) => {
			const existente = await tx.obtener<AssetPersistido>('assets', id);
			if (existente) return clonar(existente);
			const asset: AssetPersistido = {
				id, mime, tamano: bytes.byteLength, creadoEn: this.ahora(), bytes: new Uint8Array(bytes),
			};
			await tx.guardar('assets', id, asset);
			return clonar(asset);
		});
	}

	async abrirAsset(id: string): Promise<AssetPersistido | undefined> {
		return this.backend.transaccion(['assets'], 'readonly', async (tx) => {
			const asset = await tx.obtener<AssetPersistido>('assets', id);
			return asset ? clonar(asset) : undefined;
		});
	}

	async listarRecuperaciones(): Promise<RecuperacionLegacy[]> {
		return this.backend.transaccion(['recovery'], 'readonly', async (tx) =>
			(await tx.listar<RecuperacionLegacy>('recovery'))
				.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || a.id.localeCompare(b.id)));
	}

	async migrarAutosaveLegacy(raw: string | null | undefined): Promise<ResultadoMigracionLegacy> {
		if (raw === null || raw === undefined || raw === '') return { estado: 'sin-dato' };
		const digest = (await this.sha256(new TextEncoder().encode(raw))).toLowerCase();
		if (!/^[a-f\d]{64}$/.test(digest)) throw new Error('La función SHA-256 devolvió un identificador inválido.');
		const fingerprint = `sha256:${digest}`;
		const markerId = `legacy-autosave:${fingerprint}`;
		const recoveryId = `legacy-autosave:${fingerprint}`;
		const ahora = this.ahora();
		let carga: ReturnType<typeof cargarProyecto> | undefined;
		let motivo: string | undefined;
		try {
			carga = cargarProyecto(raw);
		} catch (error) {
			motivo = error instanceof Error ? error.message : String(error);
		}

		return this.backend.transaccion(
			['projects', 'snapshots', 'metadata', 'recovery'],
			'readwrite',
			async (tx) => {
				const ya = await tx.obtener<MarcadorMigracionLegacy>('metadata', markerId);
				if (ya) return { estado: 'ya-migrado', marcador: clonar(ya) };
				const recovery: RecuperacionLegacy = {
					id: recoveryId,
					fuente: 'legacy-autosave',
					fingerprint,
					creadoEn: ahora,
					raw,
					...(motivo ? { motivo } : {}),
				};
				await tx.guardar('recovery', recoveryId, recovery);

				if (!carga) {
					const marcador: MarcadorMigracionLegacy = {
						id: markerId, fingerprint, estado: 'cuarentena', creadoEn: ahora,
						recoveryId, arreglos: [],
					};
					await tx.guardar('metadata', markerId, marcador);
					return { estado: 'cuarentena', marcador: clonar(marcador) };
				}

				// `cargarProyecto` ya validó y saneó el documento. La copia cruda queda intacta en recovery.
				const projectId = `legacy-${digest.slice(0, 32)}`;
				const estado = carga.arreglos.length > 0 ? 'reparable' as const : 'migrado' as const;
				const documento: DocumentoProyecto = {
					id: projectId,
					nombre: carga.proyecto.nombre,
					creadoEn: ahora,
					modificadoEn: ahora,
					ultimoAcceso: ahora,
					revision: 1,
					estado: estado === 'reparable' ? 'requiere-revision' : 'normal',
					proyecto: validarProyecto(carga.proyecto).proyecto,
				};
				await tx.guardar('projects', projectId, documento);
				const snapshot: SnapshotProyecto = {
					id: `migracion-${digest}`,
					projectId,
					creadoEn: ahora,
					motivo: 'migracion-legacy',
					revisionOrigen: 1,
					proyecto: clonar(documento.proyecto),
				};
				await tx.guardar('snapshots', snapshot.id, snapshot);
				const marcador: MarcadorMigracionLegacy = {
					id: markerId, fingerprint, estado, creadoEn: ahora,
					projectId, recoveryId, arreglos: [...carga.arreglos],
				};
				await tx.guardar('metadata', markerId, marcador);
				return { estado, marcador: clonar(marcador) };
			},
		);
	}
}
