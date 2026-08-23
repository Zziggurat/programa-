import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	GestorDocumentos,
	type AplicarProyecto,
	type EstadoGuardadoDocumento,
} from '../app/gestor-documentos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import {
	BackendPersistenciaMemoria,
	ConflictoRevision,
	RepositorioProyectosCore,
} from '../src/persistencia/index.js';
import type {
	DocumentoProyecto,
	OpcionesGuardarProyecto,
} from '../src/persistencia/index.js';

function proyectoValido(nombre = 'Tablero A'): Proyecto {
	const proyecto = crearProyecto(nombre);
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyecto.gabinete = {
		ancho: 600,
		alto: 800,
		rieles: [],
		canaletas: [],
		colocaciones: [{ dispositivoId: 'q1', x: 20, y: 20, ancho: 18, alto: 85 }],
	};
	proyecto.dispositivos = [{
		id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: [{ id: '1', tipo: 'L' }],
	}];
	return proyecto;
}

interface Diferido {
	promesa: Promise<void>;
	resolver: () => void;
}

function diferido(): Diferido {
	let resolver!: () => void;
	const promesa = new Promise<void>((resolve) => { resolver = resolve; });
	return { promesa, resolver };
}

class RepositorioInstrumentado extends RepositorioProyectosCore {
	readonly guardados: { id: string; opciones: OpcionesGuardarProyecto }[] = [];
	bloquearSiguienteGuardado?: Diferido;
	guardadoBloqueado?: () => void;
	fallarSiguienteMarcador?: Error;

	override async guardar(
		id: string,
		opciones: OpcionesGuardarProyecto,
	): Promise<DocumentoProyecto> {
		this.guardados.push({ id, opciones: structuredClone(opciones) });
		const bloqueo = this.bloquearSiguienteGuardado;
		if (bloqueo) {
			this.bloquearSiguienteGuardado = undefined;
			this.guardadoBloqueado?.();
			await bloqueo.promesa;
		}
		return super.guardar(id, opciones);
	}

	override async marcarProyectoActivo(projectId: string | undefined): Promise<void> {
		if (this.fallarSiguienteMarcador) {
			const error = this.fallarSiguienteMarcador;
			this.fallarSiguienteMarcador = undefined;
			throw error;
		}
		return super.marcarProyectoActivo(projectId);
	}
}

interface Entorno {
	backend: BackendPersistenciaMemoria;
	repositorio: RepositorioInstrumentado;
	estados: EstadoGuardadoDocumento[];
	aplicados: { proyecto: Proyecto; origen: string; documentoId?: string }[];
	gestor: GestorDocumentos;
	pantalla: () => Proyecto | undefined;
}

function entorno(opciones: {
	aplicarProyecto?: AplicarProyecto;
	reloj?: () => Date;
	intervaloSnapshotMs?: number;
} = {}): Entorno {
	const backend = new BackendPersistenciaMemoria();
	let secuencia = 0;
	const reloj = opciones.reloj ?? (() => new Date('2026-01-01T12:00:00.000Z'));
	const repositorio = new RepositorioInstrumentado(backend, {
		crearId: () => `id-${String(++secuencia).padStart(3, '0')}`,
		reloj,
	});
	const estados: EstadoGuardadoDocumento[] = [];
	const aplicados: Entorno['aplicados'] = [];
	let pantalla: Proyecto | undefined;
	const aplicarBase: AplicarProyecto = async (proyecto, contexto) => {
		await opciones.aplicarProyecto?.(proyecto, contexto);
		pantalla = structuredClone(proyecto);
		aplicados.push({
			proyecto: structuredClone(proyecto),
			origen: contexto.origen,
			documentoId: contexto.documentoId,
		});
	};
	const gestor = new GestorDocumentos({
		repositorio,
		aplicarProyecto: aplicarBase,
		crearProyectoInicial: () => proyectoValido('Mi tablero'),
		alCambiarEstado: (estado) => estados.push(estado),
		reloj,
		intervaloSnapshotMs: opciones.intervaloSnapshotMs,
	});
	return { backend, repositorio, estados, aplicados, gestor, pantalla: () => pantalla };
}

test('inicializa desde legacy, lo monta y solo entonces confirma su identidad activa', async () => {
	const eventos: string[] = [];
	const backend = new BackendPersistenciaMemoria();
	let secuencia = 0;
	const repositorio = new RepositorioInstrumentado(backend, {
		crearId: () => `id-${++secuencia}`,
		reloj: () => new Date('2026-01-01T00:00:00.000Z'),
	});
	const gestor = new GestorDocumentos({
		repositorio,
		crearProyectoInicial: () => proyectoValido('No debe crearse'),
		aplicarProyecto: async (_proyecto, contexto) => {
			eventos.push(`aplicar:${contexto.origen}:${await repositorio.obtenerProyectoActivo() ?? 'ninguno'}`);
		},
	});
	const resultado = await gestor.inicializar(JSON.stringify(proyectoValido('Legacy')));

	assert.equal(resultado.migracion.estado, 'migrado');
	assert.equal(resultado.documento.proyecto.nombre, 'Legacy');
	assert.deepEqual(eventos, ['aplicar:inicializacion:ninguno']);
	assert.equal(await repositorio.obtenerProyectoActivo(), resultado.documento.id);
	assert.equal(gestor.documentoActivo()?.id, resultado.documento.id);
});

test('la cola fotografía entradas, coalesce una ráfaga y publica estados reales', async () => {
	const { gestor, repositorio, estados } = entorno();
	await gestor.inicializar();
	const base = gestor.documentoActivo()!.proyecto;
	const primera = structuredClone(base);
	primera.datos = { notas: 'intermedia' };
	const ultima = structuredClone(base);
	ultima.datos = { notas: 'última fotografía' };

	assert.equal(gestor.programarGuardado(primera), 1);
	assert.equal(gestor.programarGuardado(ultima), 2);
	ultima.datos.notas = 'mutación posterior ajena';
	await gestor.flush();

	assert.equal(repositorio.guardados.length, 1);
	assert.equal(repositorio.guardados[0].opciones.proyecto.datos?.notas, 'última fotografía');
	assert.equal((await repositorio.abrir(gestor.documentoActivo()!.id)).proyecto.datos?.notas, 'última fotografía');
	assert.deepEqual(estados.map((e) => [e.estado, e.generacion]), [
		['guardado', 0], ['guardando', 1], ['guardando', 2], ['guardado', 2],
	]);
});

test('una escritura en curso serializa revisiones y conserva solo la generación siguiente más nueva', async () => {
	const { gestor, repositorio } = entorno();
	await gestor.inicializar();
	const bloqueo = diferido();
	const iniciado = diferido();
	repositorio.bloquearSiguienteGuardado = bloqueo;
	repositorio.guardadoBloqueado = iniciado.resolver;

	const uno = gestor.documentoActivo()!.proyecto;
	uno.datos = { revision: '1' };
	gestor.programarGuardado(uno);
	await iniciado.promesa;
	const dos = structuredClone(uno);
	dos.datos!.revision = '2';
	gestor.programarGuardado(dos);
	const tres = structuredClone(dos);
	tres.datos!.revision = '3';
	gestor.programarGuardado(tres);
	let terminado = false;
	const vaciado = gestor.flush().then(() => { terminado = true; });
	await Promise.resolve();
	assert.equal(terminado, false);
	bloqueo.resolver();
	await vaciado;

	assert.equal(repositorio.guardados.length, 2);
	assert.deepEqual(repositorio.guardados.map((x) => x.opciones.proyecto.datos?.revision), ['1', '3']);
	assert.deepEqual(repositorio.guardados.map((x) => x.opciones.revisionEsperada), [1, 2]);
	assert.equal(gestor.documentoActivo()?.revision, 3);
});

test('A/B/C/A no mezcla contenido y conserva la revisión propia de cada documento', async () => {
	const { gestor, repositorio, pantalla } = entorno();
	const a = (await gestor.inicializar()).documento;
	const cambioA = gestor.documentoActivo()!.proyecto;
	cambioA.datos = { cliente: 'Solo A' };
	gestor.programarGuardado(cambioA);
	await gestor.flush();

	const b = await gestor.crear(proyectoValido('B'));
	const cambioB = b.proyecto;
	cambioB.datos = { obra: 'Solo B' };
	gestor.programarGuardado(cambioB);
	await gestor.flush();
	const c = await gestor.crear(proyectoValido('C'));
	const cambioC = c.proyecto;
	cambioC.datos = { notas: 'Solo C' };
	gestor.programarGuardado(cambioC);
	await gestor.flush();
	await gestor.abrir(a.id);

	assert.equal(pantalla()?.datos?.cliente, 'Solo A');
	assert.equal(pantalla()?.datos?.obra, undefined);
	assert.equal((await repositorio.abrir(b.id)).proyecto.datos?.obra, 'Solo B');
	assert.equal((await repositorio.abrir(c.id)).proyecto.datos?.notas, 'Solo C');
	assert.equal((await repositorio.abrir(a.id)).proyecto.datos?.cliente, 'Solo A');
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
});

test('un conflicto detiene la transición y un error de almacenamiento conserva la fotografía para reintento', async () => {
	const { backend, gestor, repositorio, estados, pantalla } = entorno();
	const a = (await gestor.inicializar()).documento;
	const b = await repositorio.crear({ proyecto: proyectoValido('B') });
	const externo = structuredClone(a.proyecto);
	externo.datos = { obra: 'Edición externa' };
	await repositorio.guardar(a.id, { revisionEsperada: a.revision, proyecto: externo });
	const obsoleto = structuredClone(a.proyecto);
	obsoleto.datos = { obra: 'No debe ganar' };
	gestor.programarGuardado(obsoleto);

	await assert.rejects(gestor.flush(), ConflictoRevision);
	await assert.rejects(gestor.abrir(b.id), ConflictoRevision);
	assert.equal(gestor.documentoActivo()?.id, a.id);
	assert.equal(pantalla()?.nombre, 'Mi tablero');
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
	assert.equal(estados.at(-1)?.estado, 'error');

	// Un gestor nuevo representa la recarga que resuelve el conflicto; ahí se prueba además que un
	// fallo transitorio mantiene exactamente la fotografía pendiente para un reintento explícito.
	const segundo = new GestorDocumentos({
		repositorio,
		crearProyectoInicial: () => proyectoValido(),
		aplicarProyecto: () => undefined,
	});
	await segundo.inicializar();
	const pendiente = segundo.documentoActivo()!.proyecto;
	pendiente.datos = { notas: 'Fotografía recuperable' };
	backend.fallarProximaTransaccion(new Error('disco lleno simulado'));
	segundo.programarGuardado(pendiente);
	pendiente.datos.notas = 'mutación posterior';
	await assert.rejects(segundo.flush(), /disco lleno simulado/);
	await segundo.reintentarGuardado();
	assert.equal((await repositorio.abrir(a.id)).proyecto.datos?.notas, 'Fotografía recuperable');
});

test('fallar al montar B deja A guardado, visible y activo; B nunca se confirma', async () => {
	let repositorio!: RepositorioInstrumentado;
	let pantalla: Proyecto | undefined;
	let activoDuranteB: string | undefined;
	const e = entorno({
		aplicarProyecto: async (proyecto) => {
			if (proyecto.nombre === 'B') {
				activoDuranteB = await repositorio.obtenerProyectoActivo();
				throw new Error('render B falló');
			}
			pantalla = structuredClone(proyecto);
		},
	});
	repositorio = e.repositorio;
	const a = (await e.gestor.inicializar()).documento;
	const cambioA = a.proyecto;
	cambioA.datos = { cliente: 'A ya guardado' };
	e.gestor.programarGuardado(cambioA);
	const b = await repositorio.crear({ proyecto: proyectoValido('B') });

	await assert.rejects(e.gestor.abrir(b.id), /render B falló/);
	assert.equal((await repositorio.abrir(a.id)).proyecto.datos?.cliente, 'A ya guardado');
	assert.equal(activoDuranteB, a.id, 'B se publicó antes de que el montaje terminara');
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
	assert.equal(e.gestor.documentoActivo()?.id, a.id);
	assert.equal(pantalla?.datos?.cliente, 'A ya guardado');
});

test('si falla el marcador activo después del montaje, la vista y la identidad vuelven a A', async () => {
	const { gestor, repositorio, pantalla } = entorno();
	const a = (await gestor.inicializar()).documento;
	const b = await repositorio.crear({ proyecto: proyectoValido('B') });
	repositorio.fallarSiguienteMarcador = new Error('metadata no disponible');

	await assert.rejects(gestor.abrir(b.id), /metadata no disponible/);
	assert.equal(gestor.documentoActivo()?.id, a.id);
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
	assert.equal(pantalla()?.nombre, 'Mi tablero');
});

test('una recarga abre la identidad activa, no el documento más reciente por accidente', async () => {
	const { gestor, repositorio } = entorno();
	await gestor.inicializar();
	const b = await gestor.crear(proyectoValido('B'));
	await gestor.cerrar();
	// Crear C después no debe desplazar a B: listar lo verá reciente, pero el marcador manda.
	await repositorio.crear({ proyecto: proyectoValido('C no activa') });
	let recargado: Proyecto | undefined;
	const nuevaSesion = new GestorDocumentos({
		repositorio,
		crearProyectoInicial: () => proyectoValido('No debe crearse'),
		aplicarProyecto: (proyecto) => { recargado = structuredClone(proyecto); },
	});
	const resultado = await nuevaSesion.inicializar();

	assert.equal(resultado.documento.id, b.id);
	assert.equal(recargado?.nombre, 'B');
	assert.equal(await repositorio.obtenerProyectoActivo(), b.id);
});

test('un ejemplo es efímero: no guarda ni pisa el activo, permite volver o copiarlo', async () => {
	const { gestor, repositorio, pantalla } = entorno();
	const a = (await gestor.inicializar()).documento;
	const ejemplo = proyectoValido('Ejemplo didáctico');
	await gestor.mostrarEjemplo(ejemplo);
	ejemplo.nombre = 'Mutación exterior';
	assert.equal(gestor.estaMostrandoEjemplo(), true);
	assert.equal(pantalla()?.nombre, 'Ejemplo didáctico');
	assert.equal(pantalla()?.esEjemplo, true);
	assert.equal(gestor.programarGuardado(pantalla()!), undefined);
	await gestor.flush();
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
	assert.equal((await repositorio.abrir(a.id)).proyecto.nombre, 'Mi tablero');

	await gestor.volverAMiTablero();
	assert.equal(pantalla()?.nombre, 'Mi tablero');
	await gestor.mostrarEjemplo(proyectoValido('Ejemplo copiable'));
	const copia = await gestor.copiarEjemplo('Trabajo desde ejemplo');
	assert.notEqual(copia.id, a.id);
	assert.equal(copia.proyecto.nombre, 'Trabajo desde ejemplo');
	assert.equal(copia.proyecto.esEjemplo, undefined);
	assert.equal(await repositorio.obtenerProyectoActivo(), copia.id);
	assert.equal((await repositorio.abrir(a.id)).proyecto.nombre, 'Mi tablero');
});

test('los snapshots se crean en eventos moderados, no en cada cambio, y restaurar conserva recuperación', async () => {
	const { gestor, repositorio, pantalla } = entorno({ intervaloSnapshotMs: 60_000 });
	const a = (await gestor.inicializar()).documento;
	assert.equal((await repositorio.listarSnapshots(a.id)).length, 1, 'falta la versión al abrir');
	const editado = a.proyecto;
	editado.datos = { revision: 'B' };
	gestor.programarGuardado(editado);
	await gestor.flush();
	assert.equal((await repositorio.listarSnapshots(a.id)).length, 1,
		'un guardado inmediato creó otra versión de recuperación');

	const versionB = await gestor.crearSnapshotModerado();
	assert.ok(versionB);
	assert.equal(await gestor.crearSnapshotModerado(), undefined, 'duplicó el mismo evento/revisión');
	const editadoC = gestor.documentoActivo()!.proyecto;
	editadoC.datos!.revision = 'C';
	gestor.programarGuardado(editadoC);
	await gestor.flush();
	const restaurado = await gestor.restaurarSnapshot(versionB!.id);

	assert.equal(restaurado.proyecto.datos?.revision, 'B');
	assert.equal(pantalla()?.datos?.revision, 'B');
	assert.equal(restaurado.id, a.id);
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
	const snapshots = await repositorio.listarSnapshots(a.id);
	assert.ok(snapshots.some((s) => s.motivo === 'antes-de-restaurar'
		&& s.proyecto.datos?.revision === 'C'));
	assert.equal((await gestor.listar()).find((x) => x.id === a.id)?.revision, restaurado.revision);
});

test('el primer guardado posterior al intervalo crea snapshot periódico, no uno por edición', async () => {
	let ahora = Date.parse('2026-01-01T12:00:00.000Z');
	const { gestor, repositorio } = entorno({
		reloj: () => new Date(ahora), intervaloSnapshotMs: 60_000,
	});
	const a = (await gestor.inicializar()).documento;
	for (const nombre of ['B', 'C']) {
		const p = gestor.documentoActivo()!.proyecto; p.nombre = nombre;
		gestor.programarGuardado(p); await gestor.flush();
	}
	assert.equal((await repositorio.listarSnapshots(a.id)).length, 1);

	ahora += 61_000;
	const p = gestor.documentoActivo()!.proyecto; p.nombre = 'D';
	gestor.programarGuardado(p); await gestor.flush();
	const snapshots = await repositorio.listarSnapshots(a.id);
	assert.equal(snapshots.length, 2);
	assert.equal(snapshots[0].motivo, 'periodico');
	assert.equal(snapshots[0].proyecto.nombre, 'D');
});

test('una reparación legacy se acepta explícitamente y el raw original permanece recuperable', async () => {
	const { gestor, repositorio } = entorno();
	const legacy = proyectoValido('Legacy reparable');
	legacy.conductores.push({
		id: 'roto', de: { dispositivoId: 'q1', borneId: '1' },
		a: { dispositivoId: 'inexistente', borneId: 'X' }, seccion: 1,
	});
	const inicial = await gestor.inicializar(JSON.stringify(legacy));
	assert.equal(inicial.documento.estado, 'requiere-revision');
	const rawAntes = await repositorio.listarRecuperaciones();
	assert.equal(rawAntes.length, 1);

	const aceptado = await gestor.aceptarReparacion(inicial.documento.id);
	assert.equal(aceptado.estado, 'normal');
	assert.equal(gestor.documentoActivo()?.estado, 'normal');
	assert.equal((await repositorio.listarRecuperaciones())[0].raw, rawAntes[0].raw);
});

test('una versión que no se puede montar no altera contenido, revisión ni identidad activa', async () => {
	let bloquearRevisionA = false;
	let pantalla: Proyecto | undefined;
	const e = entorno({
		aplicarProyecto: (proyecto, contexto) => {
			if (bloquearRevisionA && contexto.origen === 'restaurar' && proyecto.datos?.revision === 'A') {
				throw new Error('geometría de recuperación no renderizable');
			}
			pantalla = structuredClone(proyecto);
		},
	});
	const inicial = (await e.gestor.inicializar()).documento;
	const revisionA = inicial.proyecto;
	revisionA.datos = { revision: 'A' };
	e.gestor.programarGuardado(revisionA);
	await e.gestor.flush();
	const snapshot = await e.gestor.crearSnapshotModerado(true);
	const revisionB = e.gestor.documentoActivo()!.proyecto;
	revisionB.datos!.revision = 'B';
	e.gestor.programarGuardado(revisionB);
	await e.gestor.flush();
	const antes = e.gestor.documentoActivo()!;
	bloquearRevisionA = true;

	await assert.rejects(e.gestor.restaurarSnapshot(snapshot!.id), /no renderizable/);
	const despues = await e.repositorio.abrir(inicial.id);
	assert.equal(despues.revision, antes.revision);
	assert.equal(despues.proyecto.datos?.revision, 'B');
	assert.equal(e.gestor.documentoActivo()?.revision, antes.revision);
	assert.equal(pantalla?.datos?.revision, 'B');
	assert.equal(await e.repositorio.obtenerProyectoActivo(), inicial.id);
});

test('duplicar, renombrar y eliminar respetan identidad y revisión de la biblioteca', async () => {
	const { gestor, repositorio, pantalla } = entorno();
	const a = (await gestor.inicializar()).documento;
	const copia = await gestor.duplicar(a.id, 'Copia inactiva');
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);
	const renombrada = await gestor.renombrar(copia.id, 'Biblioteca B');
	assert.equal(renombrada.proyecto.nombre, 'Biblioteca B');
	assert.equal(gestor.documentoActivo()?.id, a.id);
	await gestor.eliminar(copia.id);
	assert.equal((await gestor.listar()).some((x) => x.id === copia.id), false);

	const b = await gestor.crear(proyectoValido('Reemplazo B'));
	await gestor.abrir(a.id);
	await gestor.eliminar(a.id);
	assert.equal(gestor.documentoActivo()?.id, b.id);
	assert.equal(await repositorio.obtenerProyectoActivo(), b.id);
	assert.equal(pantalla()?.nombre, 'Reemplazo B');
});

test('cerrar espera el guardado pendiente y rechaza cualquier uso posterior', async () => {
	const { gestor, repositorio } = entorno();
	await gestor.inicializar();
	const bloqueo = diferido();
	const iniciado = diferido();
	repositorio.bloquearSiguienteGuardado = bloqueo;
	repositorio.guardadoBloqueado = iniciado.resolver;
	const proyecto = gestor.documentoActivo()!.proyecto;
	proyecto.datos = { notas: 'Debe llegar antes de cerrar' };
	gestor.programarGuardado(proyecto);
	await iniciado.promesa;
	let cerrado = false;
	const cierre = gestor.cerrar().then(() => { cerrado = true; });
	await Promise.resolve();
	assert.equal(cerrado, false);
	bloqueo.resolver();
	await cierre;

	assert.equal((await repositorio.abrir(gestor.documentoActivo()!.id)).proyecto.datos?.notas,
		'Debe llegar antes de cerrar');
	assert.throws(() => gestor.programarGuardado(proyecto), /cerrado/);
	await assert.rejects(gestor.flush(), /cerrado/);
});
