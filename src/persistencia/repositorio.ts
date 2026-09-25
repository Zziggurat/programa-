import { cargarProyecto } from '../modelo/cargar.js';
import type { Proyecto } from '../modelo/tipos.js';
import { hashSnapshotTecnico } from '../datos-tecnicos/hash.js';
import {
	FORMATO_COMPONENTE_PERSONALIZADO,
	VERSION_COMPONENTE_PERSONALIZADO,
	crearPaqueteProyecto,
	leerPaqueteProyecto,
	revisionesRequeridasProyectoV2,
	validarDefinicionComponente,
} from '../componentes/personalizados.js';
import type {
	AssetPortatil,
	DefinicionComponentePersonalizado,
	PaqueteProyectoPortatil,
} from '../componentes/personalizados.js';
import type {
	AssetPersistido,
	BackendPersistencia,
	ContenidoComponentePersonalizado,
	DocumentoProyecto,
	MarcadorMigracionLegacy,
	MetadataProyectoActivo,
	MotivoSnapshot,
	OpcionesActualizarComponentePersonalizado,
	OpcionesArchivarRevisionDocumental,
	OpcionesCrearComponentePersonalizado,
	OpcionesImportarComponenteConAsset,
	OpcionesCrearProyecto,
	OpcionesGuardarProyecto,
	OpcionesRepositorio,
	RecuperacionLegacy,
	RepositorioProyectos,
	RevisionDocumentalArchivada,
	ResumenProyecto,
	ResultadoMigracionLegacy,
	SnapshotProyecto,
	TransaccionPersistencia,
} from './tipos.js';
import {
	ComponentePersonalizadoInvalido,
	ComponentePersonalizadoDuplicado,
	ComponentePersonalizadoNoEncontrado,
	ConflictoRevision,
	ConflictoRevisionComponente,
	ProyectoNoEncontrado,
	ProyectoPersistenciaInvalido,
} from './tipos.js';

const MIME_ASSET = new Set(['image/png', 'image/jpeg', 'image/webp']);
const CLAVE_PROYECTO_ACTIVO = 'active-project';
const HASH_SHA256 = /^sha256:[a-f0-9]{64}$/;

function hashDocumentalValido(valor: string, campo: string): string {
	if (!HASH_SHA256.test(valor)) {
		throw new ProyectoPersistenciaInvalido(`${campo} debe ser un SHA-256 hexadecimal canónico.`);
	}
	return valor;
}

/** Una revisión guardada admite varias emisiones con diferente hora/build, cada ZIP inmutable. */
const claveRevisionDocumental = (projectId: string, revision: number, sha256Paquete: string): string =>
	JSON.stringify([projectId, revision, sha256Paquete]);

function revisionDocumentalValida(revision: RevisionDocumentalArchivada): RevisionDocumentalArchivada {
	if (!revision || typeof revision.projectId !== 'string' || !revision.projectId
		|| !Number.isInteger(revision.revisionRepositorio) || revision.revisionRepositorio < 1
		|| revision.id !== claveRevisionDocumental(revision.projectId, revision.revisionRepositorio,
			revision.sha256Paquete)
		|| typeof revision.preparadaEn !== 'string' || !Number.isFinite(Date.parse(revision.preparadaEn))
		|| !['PREPARADA', 'ENTREGA_DECLARADA'].includes(revision.estado)
		|| (revision.estado === 'ENTREGA_DECLARADA' &&
			(typeof revision.entregaDeclaradaEn !== 'string' || !Number.isFinite(Date.parse(revision.entregaDeclaradaEn))))
		|| (revision.estado === 'PREPARADA' && revision.entregaDeclaradaEn !== undefined)) {
		throw new ProyectoPersistenciaInvalido('El archivo de revisión documental contiene identidad o estado inválidos.');
	}
	hashDocumentalValido(revision.sha256Proyecto, 'Hash del proyecto');
	hashDocumentalValido(revision.sha256Manifiesto, 'Hash del manifiesto');
	hashDocumentalValido(revision.sha256Paquete, 'Hash del paquete');
	const proyecto = validarProyecto(revision.proyecto).proyecto;
	if (hashSnapshotTecnico(proyecto) !== revision.sha256Proyecto) {
		throw new ProyectoPersistenciaInvalido(`El archivo documental ${revision.id} no conserva su contenido original.`);
	}
	return { ...revision, proyecto };
}

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

function nombreComponenteValido(nombre: string): string {
	const limpio = nombre.trim();
	if (!limpio) throw new ComponentePersonalizadoInvalido('El nombre del componente no puede estar vacío.');
	return limpio.slice(0, 160);
}

function validarComponente(
	definicion: DefinicionComponentePersonalizado,
): DefinicionComponentePersonalizado {
	try {
		const copia = clonar(definicion);
		const errores = validarDefinicionComponente(copia);
		if (errores.length > 0) {
			throw new ComponentePersonalizadoInvalido(
				`El componente personalizado no es válido: ${errores.join('; ')}`,
				errores,
			);
		}
		return copia;
	} catch (error) {
		if (error instanceof ComponentePersonalizadoInvalido) throw error;
		throw new ComponentePersonalizadoInvalido(
			'El componente personalizado no cumple el contrato persistente.',
			[error instanceof Error ? error.message : String(error)],
		);
	}
}

function construirComponente(
	contenido: ContenidoComponentePersonalizado,
	id: string,
	revision: number,
	creadoEn: string,
	modificadoEn: string,
): DefinicionComponentePersonalizado {
	return validarComponente({
		...clonar(contenido),
		formato: FORMATO_COMPONENTE_PERSONALIZADO,
		version: VERSION_COMPONENTE_PERSONALIZADO,
		id,
		revision,
		nombre: nombreComponenteValido(contenido.nombre),
		creadoEn,
		modificadoEn,
	});
}

/** Base64 portable: funciona igual en navegador y Node moderno, sin acoplar el núcleo a Buffer. */
function bytesABase64(bytes: Uint8Array): string {
	let binario = '';
	const BLOQUE = 0x8000;
	for (let i = 0; i < bytes.length; i += BLOQUE) {
		binario += String.fromCharCode(...bytes.subarray(i, i + BLOQUE));
	}
	return globalThis.btoa(binario);
}

function base64ABytes(base64: string): Uint8Array {
	let binario: string;
	try {
		binario = globalThis.atob(base64);
	} catch (error) {
		throw new ProyectoPersistenciaInvalido('El paquete contiene un asset base64 corrupto.', error);
	}
	const bytes = new Uint8Array(binario.length);
	for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
	return bytes;
}

function bytesIguales(a: Uint8Array, b: Uint8Array): boolean {
	return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);
}

/** Igualdad de contenido independiente del orden de claves JSON; las listas sí conservan orden. */
function contenidoIgual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return Array.isArray(a) && Array.isArray(b) && a.length === b.length
			&& a.every((valor, i) => contenidoIgual(valor, b[i]));
	}
	if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
	// JSON no distingue una propiedad ausente de otra con `undefined`; el paquete tampoco debe.
	const clavesA = Object.keys(a).filter((clave) => (a as Record<string, unknown>)[clave] !== undefined).sort();
	const clavesB = Object.keys(b).filter((clave) => (b as Record<string, unknown>)[clave] !== undefined).sort();
	return clavesA.length === clavesB.length && clavesA.every((clave, i) =>
		clave === clavesB[i]
		&& contenidoIgual((a as Record<string, unknown>)[clave], (b as Record<string, unknown>)[clave]));
}

/** Una identidad puede tener varias fotografías; la clave no depende del orden de inserción. */
const claveRevisionComponente = (id: string, revision: number): string => JSON.stringify([id, revision]);

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

	private async componente(
		tx: TransaccionPersistencia,
		id: string,
	): Promise<DefinicionComponentePersonalizado> {
		const definicion = await tx.obtener<DefinicionComponentePersonalizado>('customComponents', id);
		if (!definicion) throw new ComponentePersonalizadoNoEncontrado(id);
		return validarComponente(definicion);
	}

	private async revisionComponente(
		tx: TransaccionPersistencia, id: string, revision: number,
	): Promise<DefinicionComponentePersonalizado | undefined> {
		const archivada = await tx.obtener<DefinicionComponentePersonalizado>(
			'customComponentRevisions', claveRevisionComponente(id, revision),
		);
		const vigente = await tx.obtener<DefinicionComponentePersonalizado>('customComponents', id);
		if (archivada) {
			if (vigente?.revision === revision && !contenidoIgual(archivada, vigente)) {
				throw new ComponentePersonalizadoInvalido(
					`La revisión ${revision} de ${id} difiere entre biblioteca y archivo inmutable.`,
				);
			}
			return validarComponente(archivada);
		}
		// Compatibilidad con una base antigua aún no migrada por otro backend.
		return vigente?.revision === revision ? validarComponente(vigente) : undefined;
	}

	private async archivarRevision(
		tx: TransaccionPersistencia, definicion: DefinicionComponentePersonalizado,
	): Promise<void> {
		const clave = claveRevisionComponente(definicion.id, definicion.revision);
		const anterior = await tx.obtener<DefinicionComponentePersonalizado>('customComponentRevisions', clave);
		if (anterior && !contenidoIgual(anterior, definicion)) {
			throw new ComponentePersonalizadoInvalido(
				`Colisión de la revisión inmutable ${definicion.id} r${definicion.revision}.`,
			);
		}
		if (!anterior) await tx.guardar('customComponentRevisions', clave, definicion);
	}

	private async existeIdentidadArchivada(tx: TransaccionPersistencia, id: string): Promise<boolean> {
		return (await tx.listar<DefinicionComponentePersonalizado>('customComponentRevisions'))
			.some((definicion) => definicion?.id === id);
	}

	private comprobarRevisionComponente(
		definicion: DefinicionComponentePersonalizado,
		esperada: number,
	): void {
		if (definicion.revision !== esperada) {
			throw new ConflictoRevisionComponente(definicion.id, esperada, definicion.revision);
		}
	}

	private async comprobarAssetComponente(
		tx: TransaccionPersistencia,
		assetId: string,
	): Promise<void> {
		if (!await tx.obtener<AssetPersistido>('assets', assetId)) {
			throw new ComponentePersonalizadoInvalido(
				`El componente referencia un asset inexistente: ${assetId}.`,
				[`falta el asset ${assetId}`],
			);
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
		await this.backend.transaccion(['projects', 'snapshots', 'metadata'], 'readwrite', async (tx) => {
			const documento = await this.registro(tx, id);
			this.comprobarRevision(documento, revisionEsperada);
			await tx.eliminar('projects', id);
			const snapshots = await tx.listar<SnapshotProyecto>('snapshots');
			for (const snapshot of snapshots) if (snapshot.projectId === id) await tx.eliminar('snapshots', snapshot.id);
			const activo = await tx.obtener<MetadataProyectoActivo>('metadata', CLAVE_PROYECTO_ACTIVO);
			if (activo?.projectId === id) {
				await tx.eliminar('metadata', CLAVE_PROYECTO_ACTIVO);
			}
		});
	}

	async eliminarYActivar(id: string, revisionEsperada: number, reemplazoId: string): Promise<void> {
		if (id === reemplazoId) throw new Error('El proyecto eliminado no puede ser su propio reemplazo.');
		const ahora = this.ahora();
		await this.backend.transaccion(['projects', 'snapshots', 'metadata'], 'readwrite', async (tx) => {
			const documento = await this.registro(tx, id);
			this.comprobarRevision(documento, revisionEsperada);
			await this.documento(tx, reemplazoId);
			await tx.eliminar('projects', id);
			const snapshots = await tx.listar<SnapshotProyecto>('snapshots');
			for (const snapshot of snapshots) {
				if (snapshot.projectId === id) await tx.eliminar('snapshots', snapshot.id);
			}
			const metadata: MetadataProyectoActivo = {
				id: CLAVE_PROYECTO_ACTIVO, projectId: reemplazoId, actualizadoEn: ahora,
			};
			await tx.guardar('metadata', CLAVE_PROYECTO_ACTIVO, metadata);
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

	/** DOC-03: sólo la revisión exacta persistida puede convertirse en línea base preparada. */
	async archivarRevisionDocumental(
		opciones: OpcionesArchivarRevisionDocumental,
	): Promise<RevisionDocumentalArchivada> {
		if (!opciones.projectId || !Number.isInteger(opciones.revisionEsperada)
			|| opciones.revisionEsperada < 1) {
			throw new ProyectoPersistenciaInvalido('Identidad o revisión documental inválida.');
		}
		hashDocumentalValido(opciones.sha256Manifiesto, 'Hash del manifiesto');
		hashDocumentalValido(opciones.sha256Paquete, 'Hash del paquete');
		const proyectoEntregado = validarProyecto(opciones.proyecto).proyecto;
		if (proyectoEntregado.esEjemplo) {
			throw new ProyectoPersistenciaInvalido('Un ejemplo efímero no puede archivarse como revisión confirmada.');
		}
		const sha256Proyecto = hashSnapshotTecnico(proyectoEntregado);
		const clave = claveRevisionDocumental(opciones.projectId, opciones.revisionEsperada,
			opciones.sha256Paquete);
		return this.backend.transaccion(['projects', 'documentaryRevisions'], 'readwrite', async (tx) => {
			const actual = await this.documento(tx, opciones.projectId);
			this.comprobarRevision(actual, opciones.revisionEsperada);
			if (hashSnapshotTecnico(actual.proyecto) !== sha256Proyecto) {
				throw new ProyectoPersistenciaInvalido(
					'El contenido que originó el paquete ya no coincide con la revisión persistida.',
				);
			}
			const emisiones = (await tx.listar<RevisionDocumentalArchivada>('documentaryRevisions'))
				.filter((r) => r.projectId === opciones.projectId
					&& r.revisionRepositorio === opciones.revisionEsperada)
				.map(revisionDocumentalValida);
			if (emisiones.some((r) => r.sha256Proyecto !== sha256Proyecto)) {
				throw new ProyectoPersistenciaInvalido(
					`La revisión ${opciones.revisionEsperada} del proyecto ya tiene otro contenido archivado.`,
				);
			}
			const anterior = await tx.obtener<RevisionDocumentalArchivada>('documentaryRevisions', clave);
			if (anterior) {
				const validado = revisionDocumentalValida(anterior);
				if (validado.sha256Manifiesto !== opciones.sha256Manifiesto
					|| validado.sha256Paquete !== opciones.sha256Paquete) {
					throw new ProyectoPersistenciaInvalido(
						`La revisión documental ${clave} ya tiene otro contenido o paquete inmutable.`,
					);
				}
				return clonar(validado);
			}
			const revision: RevisionDocumentalArchivada = {
				id: clave, projectId: opciones.projectId, revisionRepositorio: opciones.revisionEsperada,
				preparadaEn: this.ahora(), estado: 'PREPARADA', proyecto: clonar(proyectoEntregado),
				sha256Proyecto, sha256Manifiesto: opciones.sha256Manifiesto,
				sha256Paquete: opciones.sha256Paquete,
			};
			await tx.guardar('documentaryRevisions', clave, revision);
			return clonar(revision);
		});
	}

	async listarRevisionesDocumentales(projectId?: string): Promise<RevisionDocumentalArchivada[]> {
		return this.backend.transaccion(['documentaryRevisions'], 'readonly', async (tx) => {
			const todas = await tx.listar<RevisionDocumentalArchivada>('documentaryRevisions');
			return clonar(todas.filter((r) => projectId === undefined || r.projectId === projectId)
				.map(revisionDocumentalValida)
				.sort((a, b) => a.projectId.localeCompare(b.projectId)
					|| b.revisionRepositorio - a.revisionRepositorio
					|| b.preparadaEn.localeCompare(a.preparadaEn)
					|| a.sha256Paquete.localeCompare(b.sha256Paquete)));
		});
	}

	async abrirRevisionDocumental(
		projectId: string, revisionRepositorio: number, sha256Paquete: string,
	): Promise<RevisionDocumentalArchivada> {
		hashDocumentalValido(sha256Paquete, 'Hash del paquete');
		return this.backend.transaccion(['documentaryRevisions'], 'readonly', async (tx) => {
			const clave = claveRevisionDocumental(projectId, revisionRepositorio, sha256Paquete);
			const revision = await tx.obtener<RevisionDocumentalArchivada>('documentaryRevisions', clave);
			if (!revision) throw new ProyectoNoEncontrado(`revision-documental:${clave}`);
			return clonar(revisionDocumentalValida(revision));
		});
	}

	/** Declara entrega local sólo tras volver a cotejar el ZIP; no simula aceptación externa. */
	async confirmarEntregaRevisionDocumental(
		projectId: string, revisionRepositorio: number, sha256PaqueteVerificado: string,
	): Promise<RevisionDocumentalArchivada> {
		hashDocumentalValido(sha256PaqueteVerificado, 'Hash del paquete verificado');
		return this.backend.transaccion(['documentaryRevisions'], 'readwrite', async (tx) => {
			const clave = claveRevisionDocumental(projectId, revisionRepositorio, sha256PaqueteVerificado);
			const archivada = await tx.obtener<RevisionDocumentalArchivada>('documentaryRevisions', clave);
			if (!archivada) {
				const mismaRevision = (await tx.listar<RevisionDocumentalArchivada>('documentaryRevisions'))
					.some((r) => r.projectId === projectId && r.revisionRepositorio === revisionRepositorio);
				if (mismaRevision) throw new ProyectoPersistenciaInvalido(
					'El ZIP seleccionado no coincide con ninguna emisión preparada de esta revisión.',
				);
				throw new ProyectoNoEncontrado(`revision-documental:${clave}`);
			}
			const valida = revisionDocumentalValida(archivada);
			if (valida.sha256Paquete !== sha256PaqueteVerificado) {
				throw new ProyectoPersistenciaInvalido('El ZIP seleccionado no coincide con el paquete de revisión preparado.');
			}
			if (valida.estado === 'ENTREGA_DECLARADA') return clonar(valida);
			const confirmada: RevisionDocumentalArchivada = {
				...valida, estado: 'ENTREGA_DECLARADA', entregaDeclaradaEn: this.ahora(),
			};
			await tx.guardar('documentaryRevisions', clave, confirmada);
			return clonar(confirmada);
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

	async obtenerProyectoActivo(): Promise<string | undefined> {
		return this.backend.transaccion(['metadata'], 'readonly', async (tx) => {
			const metadata = await tx.obtener<MetadataProyectoActivo>('metadata', CLAVE_PROYECTO_ACTIVO);
			return metadata?.id === CLAVE_PROYECTO_ACTIVO && typeof metadata.projectId === 'string'
				? metadata.projectId : undefined;
		});
	}

	async marcarProyectoActivo(projectId: string | undefined): Promise<void> {
		return this.backend.transaccion(['projects', 'metadata'], 'readwrite', async (tx) => {
			if (projectId === undefined) {
				await tx.eliminar('metadata', CLAVE_PROYECTO_ACTIVO);
				return;
			}
			await this.documento(tx, projectId);
			const metadata: MetadataProyectoActivo = {
				id: CLAVE_PROYECTO_ACTIVO,
				projectId,
				actualizadoEn: this.ahora(),
			};
			await tx.guardar('metadata', CLAVE_PROYECTO_ACTIVO, metadata);
		});
	}

	async crearComponente(
		opciones: OpcionesCrearComponentePersonalizado,
	): Promise<DefinicionComponentePersonalizado> {
		const id = opciones.id ?? this.crearId();
		const ahora = this.ahora();
		const definicion = construirComponente(opciones.definicion, id, 1, ahora, ahora);
		return this.backend.transaccion(['customComponents', 'customComponentRevisions', 'assets'], 'readwrite', async (tx) => {
			if (await tx.obtener('customComponents', id) || await this.existeIdentidadArchivada(tx, id)) {
				throw new ComponentePersonalizadoDuplicado(id);
			}
			await this.comprobarAssetComponente(tx, definicion.assetId);
			await this.archivarRevision(tx, definicion);
			await tx.guardar('customComponents', id, definicion);
			return clonar(definicion);
		});
	}

	/** La identidad SHA y el contrato se validan antes de abrir IDB; las tres escrituras son atómicas. */
	async importarComponenteConAsset(
		opciones: OpcionesImportarComponenteConAsset,
	): Promise<DefinicionComponentePersonalizado> {
		const { asset } = opciones;
		if (!MIME_ASSET.has(asset.mime)) throw new ComponentePersonalizadoInvalido(`MIME no admitido: ${asset.mime}.`);
		const bytes = new Uint8Array(asset.bytes);
		if (!bytes.byteLength) throw new ComponentePersonalizadoInvalido('La imagen del componente está vacía.');
		const digest = (await this.sha256(bytes)).toLowerCase();
		if (!/^[a-f\d]{64}$/.test(digest) || asset.id !== `sha256:${digest}`) {
			throw new ComponentePersonalizadoInvalido(`El asset ${asset.id} no coincide con su contenido SHA-256.`);
		}
		if (opciones.definicion.assetId !== asset.id) {
			throw new ComponentePersonalizadoInvalido('La imagen no corresponde a la definición del componente.');
		}
		const id = opciones.id ?? this.crearId();
		const ahora = this.ahora();
		const definicion = construirComponente(opciones.definicion, id, 1, ahora, ahora);
		return this.backend.transaccion(
			['assets', 'customComponents', 'customComponentRevisions'], 'readwrite', async (tx) => {
				// Resolver la colisión antes de escribir el asset: cancelar «importar como copia» no deja basura.
				if (await tx.obtener('customComponents', id) || await this.existeIdentidadArchivada(tx, id)) {
					throw new ComponentePersonalizadoDuplicado(id);
				}
				const existente = await tx.obtener<AssetPersistido>('assets', asset.id);
				if (existente) {
					if (existente.mime !== asset.mime || !bytesIguales(existente.bytes, bytes)) {
						throw new ComponentePersonalizadoInvalido(
							`Colisión del asset ${asset.id}: la identidad existe con otro contenido.`,
						);
					}
				} else {
					await tx.guardar('assets', asset.id, {
						id: asset.id, mime: asset.mime, tamano: bytes.byteLength, creadoEn: ahora, bytes,
					} satisfies AssetPersistido);
				}
				await this.archivarRevision(tx, definicion);
				await tx.guardar('customComponents', id, definicion);
				return clonar(definicion);
			},
		);
	}

	async abrirComponente(id: string): Promise<DefinicionComponentePersonalizado> {
		return this.backend.transaccion(['customComponents'], 'readonly', async (tx) =>
			clonar(await this.componente(tx, id)));
	}

	async abrirRevisionComponente(id: string, revision: number): Promise<DefinicionComponentePersonalizado> {
		if (!Number.isInteger(revision) || revision < 1) {
			throw new ComponentePersonalizadoInvalido('La revisión solicitada no es válida.');
		}
		return this.backend.transaccion(['customComponents', 'customComponentRevisions'], 'readonly', async (tx) => {
			const definicion = await this.revisionComponente(tx, id, revision);
			if (!definicion) throw new ComponentePersonalizadoNoEncontrado(`${id} r${revision}`);
			return clonar(definicion);
		});
	}

	async listarComponentes(): Promise<DefinicionComponentePersonalizado[]> {
		return this.backend.transaccion(['customComponents'], 'readonly', async (tx) => {
			const definiciones = (await tx.listar<DefinicionComponentePersonalizado>('customComponents'))
				.map(validarComponente)
				.sort((a, b) => b.modificadoEn.localeCompare(a.modificadoEn) || a.id.localeCompare(b.id));
			return clonar(definiciones);
		});
	}

	async actualizarComponente(
		id: string,
		opciones: OpcionesActualizarComponentePersonalizado,
	): Promise<DefinicionComponentePersonalizado> {
		return this.backend.transaccion(['customComponents', 'customComponentRevisions', 'assets'], 'readwrite', async (tx) => {
			const anterior = await this.componente(tx, id);
			this.comprobarRevisionComponente(anterior, opciones.revisionEsperada);
			const actualizado = construirComponente(
				opciones.definicion, id, anterior.revision + 1, anterior.creadoEn, this.ahora(),
			);
			await this.comprobarAssetComponente(tx, actualizado.assetId);
			await this.archivarRevision(tx, anterior);
			await this.archivarRevision(tx, actualizado);
			await tx.guardar('customComponents', id, actualizado);
			return clonar(actualizado);
		});
	}

	async duplicarComponente(id: string, nuevoNombre?: string): Promise<DefinicionComponentePersonalizado> {
		const nuevoId = this.crearId();
		return this.backend.transaccion(['customComponents', 'customComponentRevisions', 'assets'], 'readwrite', async (tx) => {
			const original = await this.componente(tx, id);
			if (await tx.obtener('customComponents', nuevoId) || await this.existeIdentidadArchivada(tx, nuevoId)) {
				throw new ComponentePersonalizadoInvalido(`Ya existe un componente con la identidad ${nuevoId}.`);
			}
			const { id: _id, revision: _revision, creadoEn: _creadoEn, modificadoEn: _modificadoEn,
				formato: _formato, version: _version, ...contenido } = original;
			const nombre = nombreComponenteValido(nuevoNombre ?? `${original.nombre} (copia)`);
			const ahora = this.ahora();
			const copia = construirComponente({ ...contenido, nombre }, nuevoId, 1, ahora, ahora);
			await this.comprobarAssetComponente(tx, copia.assetId);
			await this.archivarRevision(tx, copia);
			await tx.guardar('customComponents', nuevoId, copia);
			return clonar(copia);
		});
	}

	async eliminarComponente(id: string, revisionEsperada: number): Promise<void> {
		await this.backend.transaccion(['customComponents', 'customComponentRevisions'], 'readwrite', async (tx) => {
			const definicion = await this.componente(tx, id);
			this.comprobarRevisionComponente(definicion, revisionEsperada);
			await this.archivarRevision(tx, definicion);
			await tx.eliminar('customComponents', id);
		});
	}

	async exportarPaquete(projectId: string): Promise<PaqueteProyectoPortatil> {
		const recogido = await this.backend.transaccion(
			['projects', 'assets', 'customComponents', 'customComponentRevisions'],
			'readonly',
			async (tx) => {
				const documento = await this.documento(tx, projectId);
				let requeridas: Map<string, { id: string; revision: number }>;
				try { requeridas = revisionesRequeridasProyectoV2(documento.proyecto); }
				catch (error) {
					throw new ProyectoPersistenciaInvalido(
						error instanceof Error ? error.message : String(error), error,
					);
				}
				const componentes: DefinicionComponentePersonalizado[] = [];
				for (const { id, revision } of [...requeridas.values()]
					.sort((a, b) => a.id.localeCompare(b.id) || a.revision - b.revision)) {
					const disponible = await this.revisionComponente(tx, id, revision);
					if (!disponible) {
						throw new ProyectoPersistenciaInvalido(
							`Falta la revisión ${revision} del componente ${id}; no puede exportarse un cierre portable verificable.`,
						);
					}
					componentes.push(disponible);
				}
				const idsAssets = new Set<string>();
				for (const dispositivo of documento.proyecto.dispositivos) {
					if (dispositivo.assetId) idsAssets.add(dispositivo.assetId);
				}
				for (const componente of componentes) idsAssets.add(componente.assetId);
				const assets: AssetPersistido[] = [];
				for (const id of [...idsAssets].sort()) {
					const asset = await tx.obtener<AssetPersistido>('assets', id);
					if (!asset) throw new ProyectoPersistenciaInvalido(`Falta el asset ${id} requerido por el paquete.`);
					assets.push(asset);
				}
				return { proyecto: documento.proyecto, componentes, assets };
			},
		);

		const assets: AssetPortatil[] = [];
		for (const asset of recogido.assets) {
			if (!MIME_ASSET.has(asset.mime)) {
				throw new ProyectoPersistenciaInvalido(`El asset ${asset.id} tiene un MIME no admitido.`);
			}
			const digest = (await this.sha256(asset.bytes)).toLowerCase();
			if (asset.id !== `sha256:${digest}`) {
				throw new ProyectoPersistenciaInvalido(`El contenido del asset ${asset.id} no coincide con su SHA-256.`);
			}
			assets.push({
				id: asset.id,
				mime: asset.mime as AssetPortatil['mime'],
				base64: bytesABase64(asset.bytes),
			});
		}
		const identidades = new Set<string>();
		const variasRevisiones = recogido.componentes.some(({ id }) => {
			if (identidades.has(id)) return true;
			identidades.add(id);
			return false;
		});
		const version = recogido.componentes.some((componente) => componente.simboloEsquema !== undefined)
			|| recogido.proyecto.dispositivos.some((dispositivo) => dispositivo.simboloEsquemaPersonal !== undefined)
			? 5 : recogido.componentes.some((componente) => componente.carcasa !== undefined)
			|| recogido.proyecto.dispositivos.some((dispositivo) => dispositivo.carcasaPersonalizada !== undefined)
			? 4 : recogido.componentes.some((componente) => componente.fichaTecnica !== undefined)
				? 3 : variasRevisiones ? 2 : 1;
		return crearPaqueteProyecto(recogido.proyecto, assets, recogido.componentes, version);
	}

	async importarPaquete(
		paquete: PaqueteProyectoPortatil,
		nuevoNombre?: string,
	): Promise<DocumentoProyecto> {
		let validado: PaqueteProyectoPortatil;
		try {
			// El mismo codec gobierna archivos leídos y objetos entregados por otras capas.
			validado = leerPaqueteProyecto(JSON.stringify(paquete));
		} catch (error) {
			if (error instanceof ProyectoPersistenciaInvalido) throw error;
			throw new ProyectoPersistenciaInvalido(
				`El paquete portable no es válido: ${error instanceof Error ? error.message : String(error)}`, error,
			);
		}

		// Decodificar y verificar hashes ANTES de abrir la transacción IndexedDB.
		const assets: AssetPersistido[] = [];
		for (const asset of validado.assets) {
			const bytes = base64ABytes(asset.base64);
			const digest = (await this.sha256(bytes)).toLowerCase();
			if (asset.id !== `sha256:${digest}`) {
				throw new ProyectoPersistenciaInvalido(
					`El asset ${asset.id} no coincide con su contenido SHA-256.`,
				);
			}
			assets.push({
				id: asset.id,
				mime: asset.mime,
				tamano: bytes.byteLength,
				creadoEn: this.ahora(),
				bytes,
			});
		}
		const componentes = validado.componentes.map(validarComponente);
		const componentesPorId = new Map<string, DefinicionComponentePersonalizado[]>();
		for (const componente of componentes) {
			const revisiones = componentesPorId.get(componente.id) ?? [];
			revisiones.push(componente);
			componentesPorId.set(componente.id, revisiones);
		}
		for (const revisiones of componentesPorId.values()) revisiones.sort((a, b) => a.revision - b.revision);
		const nombre = nombreValido(nuevoNombre ?? validado.proyecto.nombre);
		const proyecto = validarProyecto({ ...validado.proyecto, nombre }).proyecto;
		const id = this.crearId();
		const snapshotId = this.crearId();
		const ahora = this.ahora();
		const documento: DocumentoProyecto = {
			id,
			nombre,
			creadoEn: ahora,
			modificadoEn: ahora,
			ultimoAcceso: ahora,
			revision: 1,
			estado: 'normal',
			proyecto,
		};
		const snapshot: SnapshotProyecto = {
			id: snapshotId,
			projectId: id,
			creadoEn: ahora,
			motivo: 'importacion-paquete',
			revisionOrigen: 1,
			proyecto: clonar(proyecto),
		};

		return this.backend.transaccion(
			['projects', 'assets', 'customComponents', 'customComponentRevisions', 'snapshots'],
			'readwrite',
			async (tx) => {
				if (await tx.obtener('projects', id)) {
					throw new ProyectoPersistenciaInvalido(`Ya existe un proyecto con la identidad ${id}.`);
				}
				if (await tx.obtener('snapshots', snapshotId)) {
					throw new ProyectoPersistenciaInvalido(`Ya existe un snapshot con la identidad ${snapshotId}.`);
				}
				for (const asset of assets) {
					const existente = await tx.obtener<AssetPersistido>('assets', asset.id);
					if (existente) {
						if (existente.mime !== asset.mime || !bytesIguales(existente.bytes, asset.bytes)) {
							throw new ProyectoPersistenciaInvalido(
								`Colisión del asset ${asset.id}: la identidad existe con otro contenido.`,
							);
						}
					} else await tx.guardar('assets', asset.id, asset);
				}
				for (const [idComponente, revisiones] of componentesPorId) {
					const vigente = await tx.obtener<DefinicionComponentePersonalizado>('customComponents', idComponente);
					const teniaHistoriaSinPublicar = !vigente && await this.existeIdentidadArchivada(tx, idComponente);
					for (const componente of revisiones) {
						const archivada = await tx.obtener<DefinicionComponentePersonalizado>(
							'customComponentRevisions', claveRevisionComponente(idComponente, componente.revision),
						);
						if (archivada && !contenidoIgual(archivada, componente)) {
							throw new ProyectoPersistenciaInvalido(
								`Colisión del componente ${idComponente} r${componente.revision}: `
								+ 'la revisión inmutable existe con otro contenido.',
							);
						}
						if (vigente?.revision === componente.revision && !contenidoIgual(vigente, componente)) {
							throw new ProyectoPersistenciaInvalido(
								`Colisión del componente ${idComponente} r${componente.revision}: `
								+ 'la biblioteca vigente tiene otro contenido.',
							);
						}
						if (vigente && vigente.revision < componente.revision) {
							throw new ProyectoPersistenciaInvalido(
								`El paquete trae ${idComponente} r${componente.revision}, posterior a la revisión `
								+ `${vigente.revision} de la biblioteca local. Importarla requiere una adopción explícita.`,
							);
						}
						if (!archivada) await tx.guardar(
							'customComponentRevisions', claveRevisionComponente(idComponente, componente.revision), componente,
						);
					}
					// Importar un proyecto no altera una definición local vigente. Si la biblioteca
					// fue borrada pero conserva historia, tampoco la republica silenciosamente.
					if (!vigente && !teniaHistoriaSinPublicar) {
						await tx.guardar('customComponents', idComponente, revisiones[revisiones.length - 1]);
					}
				}
				await tx.guardar('projects', id, documento);
				await tx.guardar('snapshots', snapshotId, snapshot);
				return clonar(documento);
			},
		);
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
