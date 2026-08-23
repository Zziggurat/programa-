import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import type { ContenidoComponentePersonalizado } from '../src/persistencia/index.js';
import {
	ALMACENES_PERSISTENCIA,
	BackendPersistenciaMemoria,
	ComponentePersonalizadoInvalido,
	ConflictoRevision,
	ConflictoRevisionComponente,
	ProyectoNoEncontrado,
	ProyectoPersistenciaInvalido,
	RepositorioProyectosCore,
} from '../src/persistencia/index.js';

function proyectoValido(nombre = 'Tablero A'): Proyecto {
	const proyecto = crearProyecto(nombre);
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyecto.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	proyecto.dispositivos = [{
		id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: [{ id: '1', tipo: 'L' }],
	}];
	proyecto.gabinete.colocaciones = [
		{ dispositivoId: 'q1', x: 20, y: 20, ancho: 18, alto: 85 },
	];
	return proyecto;
}

function contenidoComponente(
	assetId: string,
	nombre = 'Sensor propio',
): ContenidoComponentePersonalizado {
	return {
		nombre,
		descripcion: 'Componente de prueba del repositorio',
		tipoDispositivo: 'otro',
		dimensiones: { anchoMm: 30, altoMm: 45, fondoMm: 20 },
		assetId,
		terminales: [{ id: 'S', tipo: 'senal', u: 0.5, v: 0.8 }],
		comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'Prueba de persistencia' },
	};
}

function entorno(maxSnapshotsPorProyecto = 20) {
	const backend = new BackendPersistenciaMemoria();
	let secuencia = 0;
	const repositorio = new RepositorioProyectosCore(backend, {
		maxSnapshotsPorProyecto,
		crearId: () => `id-${String(++secuencia).padStart(3, '0')}`,
		reloj: () => new Date(`2026-01-01T00:00:${String(secuencia).padStart(2, '0')}.000Z`),
	});
	return { backend, repositorio };
}

test('el esquema lógico contiene los seis almacenes permanentes', () => {
	assert.deepEqual(ALMACENES_PERSISTENCIA, [
		'projects', 'assets', 'customComponents', 'snapshots', 'metadata', 'recovery',
	]);
});

test('dos documentos A/B conservan identidad, contenido y revisión independientes', async () => {
	const { repositorio } = entorno();
	const a = await repositorio.crear({ proyecto: proyectoValido('A') });
	const b = await repositorio.crear({ proyecto: proyectoValido('B') });
	const cambiado = structuredClone(a.proyecto);
	cambiado.datos = { cliente: 'Cliente A' };
	const a2 = await repositorio.guardar(a.id, { proyecto: cambiado, revisionEsperada: a.revision });

	assert.equal(a2.id, a.id);
	assert.equal(a2.revision, 2);
	assert.equal((await repositorio.abrir(b.id)).proyecto.nombre, 'B');
	assert.equal((await repositorio.abrir(b.id)).revision, 1);
	assert.deepEqual((await repositorio.listar()).map((p) => p.id).sort(), [a.id, b.id].sort());
});

test('renombrar y duplicar actualizan el sobre y el Proyecto sin compartir identidad', async () => {
	const { repositorio } = entorno();
	const original = await repositorio.crear({ proyecto: proyectoValido('Original') });
	const renombrado = await repositorio.renombrar(original.id, 'Renombrado', original.revision);
	const copia = await repositorio.duplicar(original.id, 'Copia independiente');

	assert.equal(renombrado.nombre, 'Renombrado');
	assert.equal(renombrado.proyecto.nombre, 'Renombrado');
	assert.notEqual(copia.id, original.id);
	assert.equal(copia.revision, 1);
	assert.equal(copia.proyecto.nombre, 'Copia independiente');
	const copiaEditada = structuredClone(copia.proyecto);
	copiaEditada.datos = { obra: 'Solo la copia' };
	await repositorio.guardar(copia.id, { proyecto: copiaEditada, revisionEsperada: copia.revision });
	assert.equal((await repositorio.abrir(original.id)).proyecto.datos, undefined);
});

test('una revisión obsoleta produce conflicto y no pisa el documento nuevo', async () => {
	const { repositorio } = entorno();
	const inicial = await repositorio.crear({ proyecto: proyectoValido() });
	const primero = structuredClone(inicial.proyecto);
	primero.datos = { obra: 'Revisión vigente' };
	await repositorio.guardar(inicial.id, { proyecto: primero, revisionEsperada: 1 });

	const obsoleto = structuredClone(inicial.proyecto);
	obsoleto.datos = { obra: 'Revisión obsoleta' };
	await assert.rejects(
		repositorio.guardar(inicial.id, { proyecto: obsoleto, revisionEsperada: 1 }),
		(error) => error instanceof ConflictoRevision && error.revisionActual === 2,
	);
	assert.equal((await repositorio.abrir(inicial.id)).proyecto.datos?.obra, 'Revisión vigente');
});

test('todo Proyecto se valida antes de entrar y una entrada reparable no se guarda en silencio', async () => {
	const { repositorio } = entorno();
	const sinGabinete = proyectoValido();
	delete (sinGabinete as Partial<Proyecto>).gabinete;
	await assert.rejects(repositorio.crear({ proyecto: sinGabinete }), ProyectoPersistenciaInvalido);

	const reparable = proyectoValido();
	reparable.hojas = [];
	await assert.rejects(repositorio.crear({ proyecto: reparable }), ProyectoPersistenciaInvalido);
	assert.equal((await repositorio.listar()).length, 0);
});

test('snapshot, retención y restauración son transaccionales y dejan copia pre-restauración', async () => {
	const { repositorio } = entorno(2);
	const inicial = await repositorio.crear({ proyecto: proyectoValido('Inicial') });
	const primero = await repositorio.crearSnapshot(inicial.id);
	const cambiado = structuredClone(inicial.proyecto);
	cambiado.nombre = 'Cambiado';
	const revision2 = await repositorio.guardar(inicial.id, { proyecto: cambiado, revisionEsperada: 1 });
	await repositorio.crearSnapshot(inicial.id);

	const restaurado = await repositorio.restaurarSnapshot(inicial.id, primero.id, revision2.revision);
	assert.equal(restaurado.proyecto.nombre, 'Inicial');
	assert.equal(restaurado.revision, 3);
	const snapshots = await repositorio.listarSnapshots(inicial.id);
	assert.equal(snapshots.length, 2, 'la retención se aplica también al snapshot pre-restauración');
	assert.ok(snapshots.some((s) => s.motivo === 'antes-de-restaurar' && s.proyecto.nombre === 'Cambiado'));
});

test('eliminar exige revisión y borra sus snapshots sin afectar otro proyecto', async () => {
	const { repositorio } = entorno();
	const a = await repositorio.crear({ proyecto: proyectoValido('A') });
	const b = await repositorio.crear({ proyecto: proyectoValido('B') });
	await repositorio.crearSnapshot(a.id);
	await assert.rejects(repositorio.eliminar(a.id, 99), ConflictoRevision);
	await repositorio.eliminar(a.id, a.revision);
	await assert.rejects(repositorio.abrir(a.id), ProyectoNoEncontrado);
	assert.equal((await repositorio.abrir(b.id)).nombre, 'B');
});

test('assets iguales se deduplican por SHA-256 y sus bytes no comparten memoria', async () => {
	const { backend, repositorio } = entorno();
	const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
	const primero = await repositorio.guardarAsset('image/png', bytes);
	bytes[0] = 0;
	const segundo = await repositorio.guardarAsset('image/png', new Uint8Array([137, 80, 78, 71, 1, 2, 3]));

	assert.equal(primero.id, segundo.id);
	assert.match(primero.id, /^sha256:[a-f\d]{64}$/);
	assert.equal(await backend.contar('assets'), 1);
	assert.equal((await repositorio.abrirAsset(primero.id))!.bytes[0], 137);
});

test('la migración normal conserva raw, crea snapshot y es idempotente', async () => {
	const { backend, repositorio } = entorno();
	const raw = JSON.stringify(proyectoValido('Autosave legacy'));
	const primera = await repositorio.migrarAutosaveLegacy(raw);
	const repetida = await repositorio.migrarAutosaveLegacy(raw);

	assert.equal(primera.estado, 'migrado');
	assert.equal(repetida.estado, 'ya-migrado');
	assert.equal(await backend.contar('projects'), 1);
	assert.equal(await backend.contar('snapshots'), 1);
	assert.equal(await backend.contar('recovery'), 1);
	assert.equal((await repositorio.listarRecuperaciones())[0].raw, raw);
	assert.equal(repetida.marcador.projectId, primera.marcador.projectId);
});

test('legacy reparable queda marcado para revisión y el original no se altera', async () => {
	const { repositorio } = entorno();
	const reparable = proyectoValido('Reparable');
	reparable.hojas = [];
	const raw = JSON.stringify(reparable);
	const resultado = await repositorio.migrarAutosaveLegacy(raw);

	assert.equal(resultado.estado, 'reparable');
	assert.ok(resultado.marcador.arreglos.length > 0);
	const documento = await repositorio.abrir(resultado.marcador.projectId!);
	assert.equal(documento.estado, 'requiere-revision');
	assert.equal(documento.proyecto.hojas.length, 1);
	assert.equal((await repositorio.listarRecuperaciones())[0].raw, raw);
	const editado = structuredClone(documento.proyecto);
	editado.datos = { notas: 'Editado, pero todavía no aceptado explícitamente' };
	const guardado = await repositorio.guardar(documento.id, {
		proyecto: editado, revisionEsperada: documento.revision,
	});
	assert.equal(guardado.estado, 'requiere-revision', 'un autosave no debe aceptar una reparación');
	const aceptado = await repositorio.guardar(documento.id, {
		proyecto: guardado.proyecto, revisionEsperada: guardado.revision, aceptarReparacion: true,
	});
	assert.equal(aceptado.estado, 'normal');
});

test('legacy inválido va a cuarentena y repetirlo no crea basura adicional', async () => {
	const { backend, repositorio } = entorno();
	const raw = '{"formato":"tablero-studio"';
	const primera = await repositorio.migrarAutosaveLegacy(raw);
	const repetida = await repositorio.migrarAutosaveLegacy(raw);

	assert.equal(primera.estado, 'cuarentena');
	assert.equal(repetida.estado, 'ya-migrado');
	assert.equal(await backend.contar('projects'), 0);
	assert.equal(await backend.contar('recovery'), 1);
	assert.match((await repositorio.listarRecuperaciones())[0].motivo!, /JSON/i);
});

test('un fallo de transacción no deja migración parcial y el siguiente intento la repara', async () => {
	const { backend, repositorio } = entorno();
	const raw = JSON.stringify(proyectoValido('Recuperable tras fallo'));
	backend.fallarProximaTransaccion(new Error('disco lleno simulado'));
	await assert.rejects(repositorio.migrarAutosaveLegacy(raw), /disco lleno simulado/);
	for (const almacen of ['projects', 'snapshots', 'metadata', 'recovery'] as const) {
		assert.equal(await backend.contar(almacen), 0, `${almacen} quedó escrito a medias`);
	}

	const segundo = await repositorio.migrarAutosaveLegacy(raw);
	assert.equal(segundo.estado, 'migrado');
	assert.equal(await backend.contar('projects'), 1);
});

test('un registro actual corrupto no bloquea la biblioteca ni restaurar un snapshot válido', async () => {
	const { backend, repositorio } = entorno();
	const creado = await repositorio.crear({ proyecto: proyectoValido('Recuperable') });
	const snapshot = await repositorio.crearSnapshot(creado.id);
	await backend.transaccion(['projects'], 'readwrite', async (tx) => {
		const registro = await tx.obtener<Record<string, unknown>>('projects', creado.id);
		assert.ok(registro);
		await tx.guardar('projects', creado.id, { ...registro, proyecto: { formato: 'roto' } });
	});

	assert.equal((await repositorio.listar()).length, 1);
	await assert.rejects(repositorio.abrir(creado.id), ProyectoPersistenciaInvalido);
	const restaurado = await repositorio.restaurarSnapshot(creado.id, snapshot.id, creado.revision);
	assert.equal(restaurado.proyecto.nombre, 'Recuperable');
	assert.equal((await repositorio.abrir(creado.id)).proyecto.nombre, 'Recuperable');
});

test('metadata activa usa una frontera tipada y se limpia al eliminar el proyecto', async () => {
	const { repositorio } = entorno();
	assert.equal(await repositorio.obtenerProyectoActivo(), undefined);
	await assert.rejects(repositorio.marcarProyectoActivo('no-existe'), ProyectoNoEncontrado);
	const proyecto = await repositorio.crear({ proyecto: proyectoValido('Activo') });
	await repositorio.marcarProyectoActivo(proyecto.id);
	assert.equal(await repositorio.obtenerProyectoActivo(), proyecto.id);

	await repositorio.eliminar(proyecto.id, proyecto.revision);
	assert.equal(await repositorio.obtenerProyectoActivo(), undefined);
	await repositorio.marcarProyectoActivo(undefined);
	assert.equal(await repositorio.obtenerProyectoActivo(), undefined);
});

test('biblioteca custom crea, abre y lista definiciones con clonación defensiva', async () => {
	const { backend, repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/png', new Uint8Array([1, 2, 3, 4]));
	const contenido = contenidoComponente(asset.id);
	const creado = await repositorio.crearComponente({ definicion: contenido });
	contenido.nombre = 'Mutación exterior';
	contenido.terminales[0].id = 'MUTADO';
	creado.nombre = 'Mutación de la respuesta';
	creado.terminales[0].id = 'MUTADO-2';

	const abierto = await repositorio.abrirComponente(creado.id);
	assert.equal(abierto.nombre, 'Sensor propio');
	assert.equal(abierto.terminales[0].id, 'S');
	assert.equal(abierto.revision, 1);
	const lista = await repositorio.listarComponentes();
	assert.equal(lista.length, 1);
	lista[0].nombre = 'Tampoco debe entrar';
	assert.equal((await repositorio.abrirComponente(creado.id)).nombre, 'Sensor propio');
	assert.equal(await backend.contar('customComponents'), 1);
});

test('actualizar custom exige revisión y un fallo no pisa la versión vigente', async () => {
	const { repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/png', new Uint8Array([5, 6, 7]));
	const creado = await repositorio.crearComponente({ definicion: contenidoComponente(asset.id) });
	const actualizado = await repositorio.actualizarComponente(creado.id, {
		revisionEsperada: 1,
		definicion: contenidoComponente(asset.id, 'Sensor revisado'),
	});
	assert.equal(actualizado.id, creado.id);
	assert.equal(actualizado.revision, 2);
	assert.equal(actualizado.creadoEn, creado.creadoEn);

	await assert.rejects(
		repositorio.actualizarComponente(creado.id, {
			revisionEsperada: 1,
			definicion: contenidoComponente(asset.id, 'Edición obsoleta'),
		}),
		(error) => error instanceof ConflictoRevisionComponente && error.revisionActual === 2,
	);
	assert.equal((await repositorio.abrirComponente(creado.id)).nombre, 'Sensor revisado');

	const assetFantasma = contenidoComponente('sha256:no-existe', 'Asset ausente');
	await assert.rejects(
		repositorio.actualizarComponente(creado.id, { revisionEsperada: 2, definicion: assetFantasma }),
		ComponentePersonalizadoInvalido,
	);
	assert.equal((await repositorio.abrirComponente(creado.id)).revision, 2);
});

test('duplicar custom crea identidad/revisión nuevas y eliminar también detecta conflictos', async () => {
	const { repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/webp', new Uint8Array([8, 9, 10]));
	const original = await repositorio.crearComponente({ definicion: contenidoComponente(asset.id, 'Original') });
	const copia = await repositorio.duplicarComponente(original.id, 'Copia');
	assert.notEqual(copia.id, original.id);
	assert.equal(copia.revision, 1);
	assert.equal(copia.nombre, 'Copia');
	assert.equal(copia.assetId, original.assetId);

	await assert.rejects(repositorio.eliminarComponente(original.id, 99), ConflictoRevisionComponente);
	await repositorio.eliminarComponente(original.id, original.revision);
	assert.equal((await repositorio.listarComponentes()).length, 1);
	assert.equal((await repositorio.abrirComponente(copia.id)).nombre, 'Copia');
});

test('una definición custom inválida o sin asset nunca entra a la biblioteca', async () => {
	const { backend, repositorio } = entorno();
	const sinAsset = contenidoComponente('sha256:ausente');
	await assert.rejects(repositorio.crearComponente({ definicion: sinAsset }), ComponentePersonalizadoInvalido);
	const asset = await repositorio.guardarAsset('image/jpeg', new Uint8Array([11, 12, 13]));
	const dimensionesInvalidas = contenidoComponente(asset.id);
	dimensionesInvalidas.dimensiones.anchoMm = 0;
	await assert.rejects(
		repositorio.crearComponente({ definicion: dimensionesInvalidas }),
		ComponentePersonalizadoInvalido,
	);
	assert.equal(await backend.contar('customComponents'), 0);
});
