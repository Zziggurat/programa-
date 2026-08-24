import type { Proyecto } from '../modelo/tipos.js';
import type {
	DefinicionComponentePersonalizado,
	PaqueteProyectoPortatil,
} from '../componentes/personalizados.js';

export const ALMACENES_PERSISTENCIA = [
	'projects',
	'assets',
	'customComponents',
	'snapshots',
	'metadata',
	'recovery',
] as const;

export type AlmacenPersistencia = typeof ALMACENES_PERSISTENCIA[number];
export type ModoTransaccion = 'readonly' | 'readwrite';

export interface TransaccionPersistencia {
	obtener<T>(almacen: AlmacenPersistencia, clave: string): Promise<T | undefined>;
	guardar<T>(almacen: AlmacenPersistencia, clave: string, valor: T): Promise<void>;
	eliminar(almacen: AlmacenPersistencia, clave: string): Promise<void>;
	listar<T>(almacen: AlmacenPersistencia): Promise<T[]>;
}

/** Frontera mínima que permite probar el repositorio sin depender del navegador. */
export interface BackendPersistencia {
	transaccion<T>(
		almacenes: readonly AlmacenPersistencia[],
		modo: ModoTransaccion,
		trabajo: (tx: TransaccionPersistencia) => Promise<T>,
	): Promise<T>;
}

export type EstadoDocumento = 'normal' | 'requiere-revision';

export interface DocumentoProyecto {
	id: string;
	nombre: string;
	creadoEn: string;
	modificadoEn: string;
	ultimoAcceso: string;
	revision: number;
	estado: EstadoDocumento;
	proyecto: Proyecto;
}

export type ResumenProyecto = Omit<DocumentoProyecto, 'proyecto'>;

export type MotivoSnapshot =
	| 'manual'
	| 'apertura'
	| 'periodico'
	| 'antes-de-restaurar'
	| 'migracion-legacy'
	| 'importacion-paquete';

export interface SnapshotProyecto {
	id: string;
	projectId: string;
	creadoEn: string;
	motivo: MotivoSnapshot;
	revisionOrigen: number;
	proyecto: Proyecto;
}

export interface AssetPersistido {
	id: string;
	mime: string;
	tamano: number;
	creadoEn: string;
	bytes: Uint8Array;
}

export interface MetadataProyectoActivo {
	id: 'active-project';
	projectId: string;
	actualizadoEn: string;
}

/** Contenido editable; identidad, revisión y fechas pertenecen al repositorio. */
export type ContenidoComponentePersonalizado = Omit<
	DefinicionComponentePersonalizado,
	'id' | 'revision' | 'creadoEn' | 'modificadoEn' | 'formato' | 'version'
>;

export interface OpcionesCrearComponentePersonalizado {
	id?: string;
	definicion: ContenidoComponentePersonalizado;
}

export interface OpcionesActualizarComponentePersonalizado {
	revisionEsperada: number;
	definicion: ContenidoComponentePersonalizado;
}

export interface RecuperacionLegacy {
	id: string;
	fuente: 'legacy-autosave';
	fingerprint: string;
	creadoEn: string;
	raw: string;
	motivo?: string;
}

export type EstadoMigracionLegacy = 'migrado' | 'reparable' | 'cuarentena';

export interface MarcadorMigracionLegacy {
	id: string;
	fingerprint: string;
	estado: EstadoMigracionLegacy;
	creadoEn: string;
	projectId?: string;
	recoveryId: string;
	arreglos: string[];
}

export type ResultadoMigracionLegacy =
	| { estado: 'sin-dato' }
	| { estado: 'ya-migrado'; marcador: MarcadorMigracionLegacy }
	| { estado: EstadoMigracionLegacy; marcador: MarcadorMigracionLegacy };

export interface OpcionesCrearProyecto {
	id?: string;
	nombre?: string;
	proyecto: Proyecto;
}

export interface OpcionesGuardarProyecto {
	revisionEsperada: number;
	proyecto: Proyecto;
	/** Confirmación explícita de la persona para abandonar `requiere-revision`. */
	aceptarReparacion?: boolean;
}

export interface OpcionesRepositorio {
	maxSnapshotsPorProyecto?: number;
	reloj?: () => Date;
	crearId?: () => string;
	sha256?: (bytes: Uint8Array) => Promise<string>;
}

export interface RepositorioProyectos {
	crear(opciones: OpcionesCrearProyecto): Promise<DocumentoProyecto>;
	guardar(id: string, opciones: OpcionesGuardarProyecto): Promise<DocumentoProyecto>;
	abrir(id: string): Promise<DocumentoProyecto>;
	listar(): Promise<ResumenProyecto[]>;
	duplicar(id: string, nombre?: string): Promise<DocumentoProyecto>;
	renombrar(id: string, nombre: string, revisionEsperada: number): Promise<DocumentoProyecto>;
	eliminar(id: string, revisionEsperada: number): Promise<void>;
	/** Elimina un proyecto y publica otro como activo dentro de la misma transacción. */
	eliminarYActivar(id: string, revisionEsperada: number, reemplazoId: string): Promise<void>;
	crearSnapshot(id: string, motivo?: MotivoSnapshot): Promise<SnapshotProyecto>;
	listarSnapshots(id: string): Promise<SnapshotProyecto[]>;
	restaurarSnapshot(id: string, snapshotId: string, revisionEsperada: number): Promise<DocumentoProyecto>;
	guardarAsset(mime: string, bytes: Uint8Array): Promise<AssetPersistido>;
	abrirAsset(id: string): Promise<AssetPersistido | undefined>;
	obtenerProyectoActivo(): Promise<string | undefined>;
	marcarProyectoActivo(projectId: string | undefined): Promise<void>;
	crearComponente(
		opciones: OpcionesCrearComponentePersonalizado,
	): Promise<DefinicionComponentePersonalizado>;
	abrirComponente(id: string): Promise<DefinicionComponentePersonalizado>;
	listarComponentes(): Promise<DefinicionComponentePersonalizado[]>;
	actualizarComponente(
		id: string,
		opciones: OpcionesActualizarComponentePersonalizado,
	): Promise<DefinicionComponentePersonalizado>;
	duplicarComponente(id: string, nombre?: string): Promise<DefinicionComponentePersonalizado>;
	eliminarComponente(id: string, revisionEsperada: number): Promise<void>;
	exportarPaquete(projectId: string): Promise<PaqueteProyectoPortatil>;
	importarPaquete(paquete: PaqueteProyectoPortatil, nombre?: string): Promise<DocumentoProyecto>;
	listarRecuperaciones(): Promise<RecuperacionLegacy[]>;
	migrarAutosaveLegacy(raw: string | null | undefined): Promise<ResultadoMigracionLegacy>;
}

export class ProyectoPersistenciaInvalido extends Error {
	constructor(mensaje: string, readonly causa?: unknown) {
		super(mensaje);
		this.name = 'ProyectoPersistenciaInvalido';
	}
}

export class ConflictoRevision extends Error {
	constructor(
		readonly projectId: string,
		readonly revisionEsperada: number,
		readonly revisionActual: number,
	) {
		super(`Conflicto al guardar ${projectId}: se esperaba la revisión ${revisionEsperada} y existe la ${revisionActual}.`);
		this.name = 'ConflictoRevision';
	}
}

export class ProyectoNoEncontrado extends Error {
	constructor(readonly projectId: string) {
		super(`No existe el proyecto ${projectId}.`);
		this.name = 'ProyectoNoEncontrado';
	}
}

export class ComponentePersonalizadoInvalido extends Error {
	constructor(mensaje: string, readonly errores: string[] = []) {
		super(mensaje);
		this.name = 'ComponentePersonalizadoInvalido';
	}
}

export class ComponentePersonalizadoNoEncontrado extends Error {
	constructor(readonly componenteId: string) {
		super(`No existe el componente personalizado ${componenteId}.`);
		this.name = 'ComponentePersonalizadoNoEncontrado';
	}
}

export class ConflictoRevisionComponente extends Error {
	constructor(
		readonly componenteId: string,
		readonly revisionEsperada: number,
		readonly revisionActual: number,
	) {
		super(
			`Conflicto al guardar el componente ${componenteId}: se esperaba la revisión `
			+ `${revisionEsperada} y existe la ${revisionActual}.`,
		);
		this.name = 'ConflictoRevisionComponente';
	}
}
