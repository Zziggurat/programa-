/**
 * Sesión de documentos del editor.
 *
 * Este módulo no conoce el DOM, Three.js ni IndexedDB. Su única frontera física es
 * `RepositorioProyectos`; el editor aporta `aplicarProyecto`, una operación atómica que intenta
 * montar un proyecto en pantalla y lanza sin dejarlo a medias si no puede hacerlo.
 *
 * Las reglas que protege son deliberadamente estrictas:
 *
 *  - cada guardado lleva la revisión que realmente está abierta;
 *  - las escrituras van de una en una y una ráfaga conserva solo su última generación;
 *  - el objeto que se guarda se fotografía al programarlo, no cuando termine la escritura;
 *  - cambiar de documento espera a que el anterior esté guardado;
 *  - el nuevo id no se publica como activo hasta que el proyecto se haya aplicado con éxito;
 *  - un ejemplo es una vista efímera y nunca se manda a la cola de guardado.
 */
import type { Proyecto } from '../src/modelo/tipos.js';
import type {
	DocumentoProyecto,
	RepositorioProyectos,
	ResumenProyecto,
	ResultadoMigracionLegacy,
	SnapshotProyecto,
} from '../src/persistencia/tipos.js';
import { ProyectoNoEncontrado } from '../src/persistencia/tipos.js';

export type OrigenAplicacionProyecto =
	| 'inicializacion'
	| 'crear'
	| 'abrir'
	| 'duplicar'
	| 'eliminar'
	| 'ejemplo'
	| 'volver'
	| 'copiar-ejemplo'
	| 'renombrar'
	| 'restaurar';

export interface ContextoAplicacionProyecto {
	origen: OrigenAplicacionProyecto;
	/** Ausente únicamente en una vista efímera de ejemplo. */
	documentoId?: string;
	ejemplo: boolean;
	/**
	 * La aplicación no debe autoguardar desde dentro del montaje. El gestor confirma identidad y
	 * revisión después de que este callback termine.
	 */
	guardarAlFinal: false;
}

export type AplicarProyecto = (
	proyecto: Proyecto,
	contexto: ContextoAplicacionProyecto,
) => void | Promise<void>;

export type EstadoGuardadoDocumento =
	| {
		estado: 'guardando';
		documentoId: string;
		generacion: number;
	}
	| {
		estado: 'guardado';
		documentoId: string;
		generacion: number;
		modificadoEn: string;
	}
	| {
		estado: 'error';
		documentoId: string;
		generacion: number;
		error: unknown;
	};

export interface OpcionesGestorDocumentos {
	repositorio: RepositorioProyectos;
	aplicarProyecto: AplicarProyecto;
	/** Se usa solo cuando la biblioteca no contiene ningún documento recuperable. */
	crearProyectoInicial: () => Proyecto;
	alCambiarEstado?: (estado: EstadoGuardadoDocumento) => void;
	/** Reloj inyectable para decidir si corresponde una versión de recuperación. */
	reloj?: () => Date;
	/** Cinco minutos de forma predeterminada; nunca se crea un snapshot por cada edición. */
	intervaloSnapshotMs?: number;
	/** Un fallo de recuperación no convierte un guardado ya confirmado en fallido. */
	alErrorRecuperacion?: (error: unknown) => void;
}

export interface ResultadoInicializacionDocumentos {
	documento: DocumentoProyecto;
	migracion: ResultadoMigracionLegacy;
}

export interface OpcionesDuplicarDocumento {
	/** Duplicar desde la biblioteca no tiene por qué cambiar el tablero en pantalla. */
	activar?: boolean;
}

interface GuardadoPendiente {
	documentoId: string;
	generacion: number;
	proyecto: Proyecto;
}

interface VistaAnterior {
	proyecto: Proyecto;
	contexto: ContextoAplicacionProyecto;
}

const clonar = <T>(valor: T): T => structuredClone(valor);

function errorCompuesto(mensaje: string, causa: unknown, rollback: unknown): Error {
	const error = new Error(mensaje, { cause: causa });
	(error as Error & { rollback?: unknown }).rollback = rollback;
	return error;
}

/**
 * Orquestador de una sola sesión de edición. Una instancia representa el documento que la página
 * tiene abierto; crear otra instancia sobre el mismo repositorio equivale a recargar la página.
 */
export class GestorDocumentos {
	private readonly repositorio: RepositorioProyectos;
	private readonly aplicarProyecto: AplicarProyecto;
	private readonly crearProyectoInicial: () => Proyecto;
	private readonly alCambiarEstado?: (estado: EstadoGuardadoDocumento) => void;
	private readonly reloj: () => Date;
	private readonly intervaloSnapshotMs: number;
	private readonly alErrorRecuperacion?: (error: unknown) => void;

	private actual?: DocumentoProyecto;
	private ejemplo?: Proyecto;
	private pendiente?: GuardadoPendiente;
	private drenaje?: Promise<void>;
	private ultimoFallo?: { trabajo: GuardadoPendiente; error: unknown };
	/** Cabecera del último snapshot; evita recorrer el store completo después de cada edición. */
	private readonly ultimoSnapshotPorProyecto = new Map<string, SnapshotProyecto | null>();
	private generacion = 0;
	private generacionGuardada = 0;
	private cerrado = false;
	private inicializado = false;

	constructor(opciones: OpcionesGestorDocumentos) {
		this.repositorio = opciones.repositorio;
		this.aplicarProyecto = opciones.aplicarProyecto;
		this.crearProyectoInicial = opciones.crearProyectoInicial;
		this.alCambiarEstado = opciones.alCambiarEstado;
		this.reloj = opciones.reloj ?? (() => new Date());
		this.intervaloSnapshotMs = Math.max(0, opciones.intervaloSnapshotMs ?? 5 * 60_000);
		this.alErrorRecuperacion = opciones.alErrorRecuperacion;
	}

	/** Copia del sobre activo; modificar lo devuelto no modifica la revisión de la sesión. */
	documentoActivo(): DocumentoProyecto | undefined {
		return this.actual ? clonar(this.actual) : undefined;
	}

	/** Biblioteca ordenada por el repositorio; no expone el contenido pesado de cada proyecto. */
	listar(): Promise<ResumenProyecto[]> {
		this.comprobarInicializado();
		return this.repositorio.listar();
	}

	/** Versiones de recuperación del documento real, aun cuando la UI esté mostrando un ejemplo. */
	async listarSnapshots(): Promise<SnapshotProyecto[]> {
		this.comprobarInicializado();
		const snapshots = await this.repositorio.listarSnapshots(this.actual!.id);
		this.ultimoSnapshotPorProyecto.set(this.actual!.id, snapshots[0] ?? null);
		return snapshots;
	}

	estaMostrandoEjemplo(): boolean {
		return this.ejemplo !== undefined;
	}

	private comprobarAbierto(): void {
		if (this.cerrado) throw new Error('El gestor de documentos ya está cerrado.');
	}

	private comprobarInicializado(): void {
		this.comprobarAbierto();
		if (!this.inicializado || !this.actual) {
			throw new Error('El gestor de documentos todavía no fue inicializado.');
		}
	}

	private emitir(estado: EstadoGuardadoDocumento): void {
		try {
			this.alCambiarEstado?.(estado);
		} catch {
			// Pintar un indicador nunca puede convertir un guardado correcto en uno fallido.
		}
	}

	private emitirGuardado(documento = this.actual): void {
		if (!documento) return;
		this.emitir({
			estado: 'guardado',
			documentoId: documento.id,
			generacion: this.generacionGuardada,
			modificadoEn: documento.modificadoEn,
		});
	}

	private vistaActual(): VistaAnterior | undefined {
		if (this.ejemplo) {
			return {
				proyecto: clonar(this.ejemplo),
				contexto: { origen: 'ejemplo', ejemplo: true, guardarAlFinal: false },
			};
		}
		if (!this.actual) return undefined;
		return {
			proyecto: clonar(this.actual.proyecto),
			contexto: {
				origen: 'volver', documentoId: this.actual.id, ejemplo: false, guardarAlFinal: false,
			},
		};
	}

	private async aplicarConRollback(
		proyecto: Proyecto,
		contexto: ContextoAplicacionProyecto,
		anterior = this.vistaActual(),
	): Promise<void> {
		try {
			await this.aplicarProyecto(clonar(proyecto), contexto);
		} catch (error) {
			// El callback se contrata como atómico, pero volver a aplicar la vista anterior también
			// protege a integraciones futuras que fallen después de tocar estado superficial.
			if (anterior) {
				try {
					await this.aplicarProyecto(clonar(anterior.proyecto), anterior.contexto);
				} catch (rollback) {
					throw errorCompuesto('Falló aplicar el proyecto y también restaurar la vista anterior.', error, rollback);
				}
			}
			throw error;
		}
	}

	/**
	 * Migra primero la copia antigua y solo después decide qué documento abrir. Un marcador activo
	 * huérfano se limpia; un documento corrupto, en cambio, se propaga para que recuperación pueda
	 * intervenir en vez de abrir silenciosamente otro tablero.
	 */
	async inicializar(autosaveLegacy?: string | null): Promise<ResultadoInicializacionDocumentos> {
		this.comprobarAbierto();
		if (this.inicializado) throw new Error('El gestor de documentos ya fue inicializado.');

		const migracion = await this.repositorio.migrarAutosaveLegacy(autosaveLegacy);
		let idActivo = await this.repositorio.obtenerProyectoActivo();
		let documento: DocumentoProyecto | undefined;
		if (idActivo) {
			try {
				documento = await this.repositorio.abrir(idActivo);
			} catch (error) {
				if (!(error instanceof ProyectoNoEncontrado)) throw error;
				await this.repositorio.marcarProyectoActivo(undefined);
				idActivo = undefined;
			}
		}

		const idMigrado = migracion.estado === 'migrado' || migracion.estado === 'reparable'
			|| migracion.estado === 'ya-migrado'
			? migracion.marcador.projectId : undefined;
		if (!documento && idMigrado) documento = await this.repositorio.abrir(idMigrado);
		if (!documento) {
			const primero = (await this.repositorio.listar())[0];
			if (primero) documento = await this.repositorio.abrir(primero.id);
		}
		if (!documento) documento = await this.repositorio.crear({ proyecto: clonar(this.crearProyectoInicial()) });

		await this.aplicarProyecto(clonar(documento.proyecto), {
			origen: 'inicializacion', documentoId: documento.id, ejemplo: false, guardarAlFinal: false,
		});
		// Incluso si había un marcador, se escribe DESPUÉS del montaje; si el callback lanza no se
		// publica como activo un documento que esta versión de la UI no pudo mostrar.
		await this.repositorio.marcarProyectoActivo(documento.id);
		this.actual = documento;
		this.inicializado = true;
		this.emitirGuardado(documento);
		await this.intentarSnapshot(() => this.crearSnapshotModeradoDe(documento, false, 'apertura'));
		return { documento: clonar(documento), migracion };
	}

	/**
	 * Programa el estado visible AHORA. Las llamadas de la misma ráfaga se fusionan y la última
	 * gana; si ya hay una escritura en curso, se conserva a lo sumo una siguiente.
	 *
	 * En un ejemplo devuelve `undefined`: recalcular una vista de estudio no puede escribir sobre
	 * el último documento de la persona.
	 */
	programarGuardado(proyecto: Proyecto): number | undefined {
		this.comprobarInicializado();
		if (this.ejemplo) return undefined;
		const documentoId = this.actual!.id;
		const generacion = ++this.generacion;
		this.pendiente = { documentoId, generacion, proyecto: clonar(proyecto) };
		this.ultimoFallo = undefined;
		this.emitir({ estado: 'guardando', documentoId, generacion });
		this.asegurarDrenaje();
		return generacion;
	}

	private asegurarDrenaje(): void {
		if (this.drenaje || this.ultimoFallo || !this.pendiente) return;
		// La microtarea es intencional: varias mutaciones síncronas de una misma acción producen una
		// sola escritura con la fotografía final, no tres revisiones intermedias sin valor.
		this.drenaje = Promise.resolve()
			.then(() => this.drenarGuardados())
			.catch(() => undefined)
			.finally(() => {
				this.drenaje = undefined;
				if (this.pendiente && !this.ultimoFallo) this.asegurarDrenaje();
			});
	}

	private async drenarGuardados(): Promise<void> {
		while (this.pendiente && !this.ultimoFallo) {
			const trabajo = this.pendiente;
			this.pendiente = undefined;
			try {
				const base = this.actual;
				if (!base || base.id !== trabajo.documentoId) {
					throw new Error(`El guardado de ${trabajo.documentoId} ya no pertenece al documento abierto.`);
				}
				const guardado = await this.repositorio.guardar(base.id, {
					revisionEsperada: base.revision,
					proyecto: clonar(trabajo.proyecto),
				});
				this.actual = guardado;
				this.generacionGuardada = trabajo.generacion;
				if (!this.pendiente) this.emitirGuardado(guardado);
				await this.intentarSnapshot(() => this.crearSnapshotPeriodicoDe(guardado));
			} catch (error) {
				// Si mientras fallaba llegó una generación más nueva, ésa es la que interesa reintentar.
				// El cast hace explícita la posible mutación desde `programarGuardado` durante el `await`:
				// el análisis local de TypeScript solo ve la asignación a `undefined` de más arriba.
				const llegadaDuranteEscritura = this.pendiente as GuardadoPendiente | undefined;
				if (!llegadaDuranteEscritura || llegadaDuranteEscritura.generacion < trabajo.generacion) {
					this.pendiente = trabajo;
				}
				this.ultimoFallo = { trabajo, error };
				this.emitir({
					estado: 'error', documentoId: trabajo.documentoId,
					generacion: this.pendiente!.generacion, error,
				});
			}
		}
	}

	/** Espera hasta que no haya ninguna generación pendiente; propaga el fallo real de escritura. */
	async flush(): Promise<void> {
		this.comprobarInicializado();
		for (;;) {
			this.asegurarDrenaje();
			const enCurso = this.drenaje;
			if (enCurso) await enCurso;
			if (this.ultimoFallo) throw this.ultimoFallo.error;
			if (!this.pendiente && !this.drenaje) return;
		}
	}

	/** Reintenta la última fotografía pendiente; nunca inventa una revisión nueva. */
	async reintentarGuardado(): Promise<void> {
		this.comprobarInicializado();
		if (!this.ultimoFallo) return this.flush();
		this.ultimoFallo = undefined;
		if (this.pendiente) {
			this.emitir({
				estado: 'guardando', documentoId: this.pendiente.documentoId,
				generacion: this.pendiente.generacion,
			});
		}
		this.asegurarDrenaje();
		await this.flush();
	}

	private async crearSnapshotModeradoDe(
		documento: DocumentoProyecto,
		forzar = false,
		motivo: 'manual' | 'apertura' = 'manual',
	): Promise<SnapshotProyecto | undefined> {
		const ultimo = await this.ultimoSnapshotDe(documento.id);
		const edad = ultimo ? this.reloj().getTime() - Date.parse(ultimo.creadoEn) : Infinity;
		if (!forzar && ultimo && ultimo.revisionOrigen === documento.revision
			&& edad >= 0 && edad < this.intervaloSnapshotMs) return undefined;
		const creado = await this.repositorio.crearSnapshot(documento.id, motivo);
		this.ultimoSnapshotPorProyecto.set(documento.id, creado);
		return creado;
	}

	private async ultimoSnapshotDe(projectId: string): Promise<SnapshotProyecto | undefined> {
		if (this.ultimoSnapshotPorProyecto.has(projectId)) {
			return this.ultimoSnapshotPorProyecto.get(projectId) ?? undefined;
		}
		const ultimo = (await this.repositorio.listarSnapshots(projectId))[0];
		this.ultimoSnapshotPorProyecto.set(projectId, ultimo ?? null);
		return ultimo;
	}

	/**
	 * Se evalúa después de un guardado real. No usa un `setInterval`: sin cambios no hay una
	 * versión distinta que proteger; con cambios, el primer guardado posterior al intervalo crea
	 * una recuperación. La edad manda aunque haya cien revisiones intermedias.
	 */
	private async crearSnapshotPeriodicoDe(
		documento: DocumentoProyecto,
	): Promise<SnapshotProyecto | undefined> {
		const ultimo = await this.ultimoSnapshotDe(documento.id);
		const edad = ultimo ? this.reloj().getTime() - Date.parse(ultimo.creadoEn) : Infinity;
		if (ultimo && edad >= 0 && edad < this.intervaloSnapshotMs) return undefined;
		const creado = await this.repositorio.crearSnapshot(documento.id, 'periodico');
		this.ultimoSnapshotPorProyecto.set(documento.id, creado);
		return creado;
	}

	private async intentarSnapshot(
		trabajo: () => Promise<SnapshotProyecto | undefined>,
	): Promise<SnapshotProyecto | undefined> {
		try {
			return await trabajo();
		} catch (error) {
			// El documento ya se guardó o abrió correctamente. La recuperación es una segunda línea de
			// defensa y su fallo se informa, pero jamás se reintenta con una revisión obsoleta.
			try { this.alErrorRecuperacion?.(error); } catch { /* informar tampoco puede romper la sesión */ }
			return undefined;
		}
	}

	/** Punto explícito para eventos importantes; programar una edición nunca llama a este método. */
	async crearSnapshotModerado(forzar = false): Promise<SnapshotProyecto | undefined> {
		this.comprobarInicializado();
		if (this.ejemplo) return undefined;
		await this.flush();
		return this.crearSnapshotModeradoDe(this.actual!, forzar);
	}

	private async prepararSalida(): Promise<void> {
		await this.flush();
		// Una versión al abandonar el documento permite volver tras una edición grande, pero la
		// ventana temporal y la revisión impiden convertir cada navegación en un Git interno.
		await this.intentarSnapshot(() => this.crearSnapshotModeradoDe(this.actual!));
	}

	private async publicarDocumento(
		documento: DocumentoProyecto,
		origen: OrigenAplicacionProyecto,
		anterior = this.vistaActual(),
	): Promise<DocumentoProyecto> {
		const contexto: ContextoAplicacionProyecto = {
			origen, documentoId: documento.id, ejemplo: false, guardarAlFinal: false,
		};
		await this.aplicarConRollback(documento.proyecto, contexto, anterior);
		try {
			await this.repositorio.marcarProyectoActivo(documento.id);
		} catch (error) {
			if (anterior) {
				try {
					await this.aplicarProyecto(clonar(anterior.proyecto), anterior.contexto);
				} catch (rollback) {
					throw errorCompuesto('No se pudo confirmar el documento activo ni restaurar la vista anterior.', error, rollback);
				}
			}
			throw error;
		}
		this.actual = documento;
		this.ejemplo = undefined;
		this.pendiente = undefined;
		this.ultimoFallo = undefined;
		this.emitirGuardado(documento);
		await this.intentarSnapshot(() => this.crearSnapshotModeradoDe(documento, false, 'apertura'));
		return clonar(documento);
	}

	async crear(proyecto = this.crearProyectoInicial(), nombre?: string): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		await this.prepararSalida();
		const documento = await this.repositorio.crear({ proyecto: clonar(proyecto), nombre });
		return this.publicarDocumento(documento, 'crear');
	}

	async abrir(id: string): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		await this.prepararSalida();
		const documento = await this.repositorio.abrir(id);
		return this.publicarDocumento(documento, this.ejemplo && id === this.actual?.id ? 'volver' : 'abrir');
	}

	async duplicar(
		id: string,
		nombre?: string,
		opciones: OpcionesDuplicarDocumento = {},
	): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		if (id === this.actual!.id) await this.flush();
		const copia = await this.repositorio.duplicar(id, nombre);
		if (!opciones.activar) return copia;
		await this.prepararSalida();
		return this.publicarDocumento(copia, 'duplicar');
	}

	async renombrar(id: string, nombre: string): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		let base: DocumentoProyecto;
		if (id === this.actual!.id) {
			await this.flush();
			base = this.actual!;
		} else {
			base = await this.repositorio.abrir(id);
		}
		const renombrado = await this.repositorio.renombrar(id, nombre, base.revision);
		if (id !== this.actual!.id) return renombrado;
		this.actual = renombrado;
		if (!this.ejemplo) {
			await this.aplicarConRollback(renombrado.proyecto, {
				origen: 'renombrar', documentoId: id, ejemplo: false, guardarAlFinal: false,
			});
		}
		this.emitirGuardado(renombrado);
		return clonar(renombrado);
	}

	/**
	 * Confirma de forma explícita un documento legacy reparado. El raw original permanece en
	 * `recovery`; esta operación solo normaliza la revisión saneada que la persona ya inspeccionó.
	 */
	async aceptarReparacion(id: string): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		let base: DocumentoProyecto;
		if (id === this.actual!.id) {
			if (this.ejemplo) throw new Error('Vuelve a tu tablero antes de aceptar una reparación.');
			await this.flush();
			base = this.actual!;
		} else {
			base = await this.repositorio.abrir(id);
		}
		if (base.estado !== 'requiere-revision') return clonar(base);
		const aceptado = await this.repositorio.guardar(id, {
			revisionEsperada: base.revision,
			proyecto: clonar(base.proyecto),
			aceptarReparacion: true,
		});
		if (id === this.actual!.id) {
			this.actual = aceptado;
			this.emitirGuardado(aceptado);
		}
		return clonar(aceptado);
	}

	/**
	 * Restaura una versión del documento activo. El repositorio crea atómicamente el snapshot
	 * `antes-de-restaurar`; el gestor no añade otro ni permite que una edición pendiente quede por
	 * detrás de él en la historia.
	 */
	async restaurarSnapshot(snapshotId: string): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		if (this.ejemplo) throw new Error('No se puede restaurar una versión mientras se muestra un ejemplo.');
		await this.flush();
		const anterior = this.vistaActual()!;
		const snapshot = (await this.repositorio.listarSnapshots(this.actual!.id))
			.find((item) => item.id === snapshotId);
		if (!snapshot) throw new ProyectoNoEncontrado(`snapshot:${snapshotId}`);
		const contexto: ContextoAplicacionProyecto = {
			origen: 'restaurar', documentoId: this.actual!.id, ejemplo: false, guardarAlFinal: false,
		};

		// Se comprueba que la UI puede montar la versión ANTES de convertirla en el contenido actual.
		// Si después falla la transacción (conflicto/almacenamiento), se devuelve la pantalla a la
		// versión vigente. Así nunca queda una vista restaurada respaldada por una revisión antigua.
		await this.aplicarConRollback(snapshot.proyecto, contexto, anterior);
		let documento: DocumentoProyecto;
		try {
			documento = await this.repositorio.restaurarSnapshot(
				this.actual!.id,
				snapshotId,
				this.actual!.revision,
			);
		} catch (error) {
			try {
				await this.aplicarProyecto(clonar(anterior.proyecto), anterior.contexto);
			} catch (rollback) {
				throw errorCompuesto('Falló restaurar la versión y también devolver la vista anterior.', error, rollback);
			}
			throw error;
		}
		this.actual = documento;
		// `restaurarSnapshot` crea atómicamente otra versión (`antes-de-restaurar`). Se relee solo
		// cuando vuelva a hacer falta; no se adivina cuál ganó si el reloj tiene la misma marca.
		this.ultimoSnapshotPorProyecto.delete(documento.id);
		this.emitirGuardado(documento);
		return clonar(documento);
	}

	/**
	 * Eliminar el documento visible prepara y aplica primero un reemplazo. El marcador cambia solo
	 * después de que ese reemplazo se pueda mostrar; si borrar falla, marcador y vista vuelven al
	 * documento anterior.
	 */
	async eliminar(id: string): Promise<void> {
		this.comprobarInicializado();
		if (id !== this.actual!.id) {
			const documento = await this.repositorio.abrir(id);
			await this.repositorio.eliminar(id, documento.revision);
			this.ultimoSnapshotPorProyecto.delete(id);
			return;
		}

		await this.prepararSalida();
		const anteriorDocumento = this.actual!;
		const anteriorVista = this.vistaActual()!;
		const otro = (await this.repositorio.listar()).find((x) => x.id !== id);
		const reemplazo = otro
			? await this.repositorio.abrir(otro.id)
			: await this.repositorio.crear({ proyecto: clonar(this.crearProyectoInicial()) });
		const contexto: ContextoAplicacionProyecto = {
			origen: 'eliminar', documentoId: reemplazo.id, ejemplo: false, guardarAlFinal: false,
		};
		await this.aplicarConRollback(reemplazo.proyecto, contexto, anteriorVista);
		try {
			await this.repositorio.marcarProyectoActivo(reemplazo.id);
		} catch (error) {
			try {
				await this.aplicarProyecto(clonar(anteriorVista.proyecto), anteriorVista.contexto);
			} catch (rollback) {
				throw errorCompuesto(
					'No se pudo confirmar el reemplazo ni restaurar la vista anterior.', error, rollback,
				);
			}
			throw error;
		}
		try {
			await this.repositorio.eliminar(id, anteriorDocumento.revision);
		} catch (error) {
			try {
				await this.repositorio.marcarProyectoActivo(anteriorDocumento.id);
				await this.aplicarProyecto(clonar(anteriorVista.proyecto), anteriorVista.contexto);
			} catch (rollback) {
				throw errorCompuesto('Falló eliminar el documento y también restaurar la sesión anterior.', error, rollback);
			}
			throw error;
		}
		this.actual = reemplazo;
		this.ultimoSnapshotPorProyecto.delete(id);
		this.ejemplo = undefined;
		this.emitirGuardado(reemplazo);
	}

	/** Muestra una copia efímera de un ejemplo; el marcador del documento de la persona no cambia. */
	async mostrarEjemplo(proyecto: Proyecto): Promise<void> {
		this.comprobarInicializado();
		await this.prepararSalida();
		const ejemplo = clonar(proyecto);
		ejemplo.esEjemplo = true;
		await this.aplicarConRollback(ejemplo, {
			origen: 'ejemplo', ejemplo: true, guardarAlFinal: false,
		});
		this.ejemplo = ejemplo;
	}

	async volverAMiTablero(): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		if (!this.ejemplo) return clonar(this.actual!);
		return this.abrir(this.actual!.id);
	}

	/** Convierte el ejemplo visible en un documento nuevo; nunca modifica el documento anterior. */
	async copiarEjemplo(nombre?: string): Promise<DocumentoProyecto> {
		this.comprobarInicializado();
		if (!this.ejemplo) throw new Error('No hay ningún ejemplo abierto para copiar.');
		await this.prepararSalida();
		const copia = clonar(this.ejemplo);
		delete copia.esEjemplo;
		copia.nombre = nombre?.trim() || `Copia de ${copia.nombre}`;
		const documento = await this.repositorio.crear({ proyecto: copia, nombre: copia.nombre });
		return this.publicarDocumento(documento, 'copiar-ejemplo');
	}

	/** Punto de cierre de la página/escritorio. El propietario del repositorio lo cierra después. */
	async cerrar(): Promise<void> {
		this.comprobarInicializado();
		await this.flush();
		this.cerrado = true;
	}
}
