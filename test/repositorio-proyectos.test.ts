import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import {
	crearPaqueteProyecto,
	instanciarComponentePersonalizado,
	leerPaqueteProyecto,
} from '../src/componentes/personalizados.js';
import type { PaqueteProyectoPortatil } from '../src/componentes/personalizados.js';
import type { ContenidoComponentePersonalizado } from '../src/persistencia/index.js';
import {
	ALMACENES_PERSISTENCIA,
	BackendPersistenciaMemoria,
	ComponentePersonalizadoDuplicado,
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

async function imagenImportable(bytes: Uint8Array, mime = 'image/png') {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer));
	const id = `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	return { id, mime, bytes };
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

async function paquetePortable(): Promise<PaqueteProyectoPortatil> {
	const { repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/png', new Uint8Array([21, 22, 23, 24, 25]));
	const definicion = await repositorio.crearComponente({
		id: 'cmp-portable',
		definicion: contenidoComponente(asset.id, 'Componente portable'),
	});
	const proyecto = proyectoValido('Proyecto portable');
	proyecto.dispositivos[0].assetId = asset.id;
	proyecto.dispositivos[0].componentePersonalizado = {
		definicionId: definicion.id,
		revision: definicion.revision,
	};
	const documento = await repositorio.crear({ proyecto });
	return repositorio.exportarPaquete(documento.id);
}

test('el esquema conserva los almacenes V1/V8 y añade revisiones custom sin sustituirlos', () => {
	assert.deepEqual(ALMACENES_PERSISTENCIA, [
		'projects', 'assets', 'customComponents', 'snapshots', 'metadata', 'recovery', 'technicalData',
		'customComponentRevisions',
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

test('eliminar y activar es una sola transacción para proyecto, snapshots y marcador', async () => {
	const { backend, repositorio } = entorno();
	const a = await repositorio.crear({ proyecto: proyectoValido('A') });
	const b = await repositorio.crear({ proyecto: proyectoValido('B') });
	await repositorio.crearSnapshot(a.id, 'manual');
	await repositorio.marcarProyectoActivo(a.id);
	backend.fallarProximaTransaccion(new Error('fallo atómico simulado'));
	await assert.rejects(repositorio.eliminarYActivar(a.id, a.revision, b.id), /fallo atómico simulado/);
	assert.equal((await repositorio.abrir(a.id)).id, a.id);
	assert.equal((await repositorio.abrir(b.id)).id, b.id);
	assert.equal((await repositorio.listarSnapshots(a.id)).length, 1);
	assert.equal(await repositorio.obtenerProyectoActivo(), a.id);

	await repositorio.eliminarYActivar(a.id, a.revision, b.id);
	await assert.rejects(repositorio.abrir(a.id), ProyectoNoEncontrado);
	assert.equal(await backend.contar('snapshots'), 0);
	assert.equal(await repositorio.obtenerProyectoActivo(), b.id);
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
	assert.equal((await repositorio.abrirRevisionComponente(creado.id, 1)).nombre, 'Sensor propio');
	assert.equal((await repositorio.abrirRevisionComponente(creado.id, 2)).nombre, 'Sensor revisado');
});

test('la revisión colocada r1 se exporta intacta aunque la biblioteca esté en r2', async () => {
	const { repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/png', new Uint8Array([40, 41, 42]));
	const r1 = await repositorio.crearComponente({ id: 'cmp-fijo', definicion: contenidoComponente(asset.id) });
	const colocado = instanciarComponentePersonalizado(r1, 'd1');
	const proyecto = proyectoValido('Revisión fija');
	proyecto.dispositivos = [colocado];
	proyecto.gabinete!.colocaciones = [{ dispositivoId: colocado.id, x: 20, y: 20, ancho: 30, alto: 45 }];
	const documento = await repositorio.crear({ proyecto });
	const r2 = await repositorio.actualizarComponente(r1.id, {
		revisionEsperada: 1, definicion: contenidoComponente(asset.id, 'Sensor cambiado'),
	});
	assert.equal(r2.revision, 2);
	assert.equal((await repositorio.abrir(documento.id)).proyecto.dispositivos[0].descripcion, r1.descripcion ?? r1.nombre);
	const paquete = await repositorio.exportarPaquete(documento.id);
	assert.deepEqual(paquete.componentes, [r1]);
	const limpio = entorno().repositorio;
	const importado = await limpio.importarPaquete(paquete);
	assert.equal((await limpio.abrirRevisionComponente(r1.id, 1)).nombre, r1.nombre);
	assert.equal(importado.proyecto.dispositivos[0].componentePersonalizado?.revision, 1);
});

test('paquete V2 porta dos revisiones del mismo ID con assets distintos y conserva V1 para casos simples', async () => {
	const { repositorio } = entorno();
	const asset1 = await repositorio.guardarAsset('image/png', new Uint8Array([43, 44, 45]));
	const asset2 = await repositorio.guardarAsset('image/png', new Uint8Array([46, 47, 48]));
	const r1 = await repositorio.crearComponente({ id: 'cmp-doble', definicion: contenidoComponente(asset1.id) });
	const r2 = await repositorio.actualizarComponente(r1.id, {
		revisionEsperada: 1, definicion: contenidoComponente(asset2.id, 'Sensor r2'),
	});
	const proyecto = proyectoValido('Dos revisiones');
	proyecto.dispositivos = [instanciarComponentePersonalizado(r2, 'd2'), instanciarComponentePersonalizado(r1, 'd1')];
	proyecto.gabinete!.colocaciones = [
		{ dispositivoId: 'd1', x: 20, y: 20, ancho: 30, alto: 45 },
		{ dispositivoId: 'd2', x: 70, y: 20, ancho: 30, alto: 45 },
	];
	const documento = await repositorio.crear({ proyecto });
	const paquete = await repositorio.exportarPaquete(documento.id);
	assert.equal(paquete.version, 2);
	assert.deepEqual(paquete.componentes, [r1, r2], 'orden canónico por identidad y revisión');
	assert.deepEqual(paquete.assets.map((asset) => asset.id).sort(), [asset1.id, asset2.id].sort());
	assert.deepEqual(paquete.proyecto.dispositivos.map((dispositivo) => dispositivo.componentePersonalizado?.revision), [2, 1]);
	const leido = leerPaqueteProyecto(JSON.stringify(paquete));
	const { backend: limpioBackend, repositorio: limpio } = entorno();
	const importado = await limpio.importarPaquete(leido);
	assert.deepEqual(importado.proyecto.dispositivos.map((dispositivo) => dispositivo.componentePersonalizado?.revision), [2, 1]);
	assert.deepEqual(await limpio.abrirRevisionComponente(r1.id, 1), r1);
	assert.deepEqual(await limpio.abrirRevisionComponente(r1.id, 2), r2);
	assert.deepEqual(await limpio.abrirComponente(r1.id), r2, 'una identidad nueva publica su última revisión');
	assert.equal(await limpioBackend.contar('customComponentRevisions'), 2);
	assert.equal(await limpioBackend.contar('assets'), 2);
	assert.equal((await limpio.exportarPaquete(importado.id)).version, 2);
	const invertido = structuredClone(leido);
	invertido.componentes.reverse();
	const otro = entorno().repositorio;
	const importadoInvertido = await otro.importarPaquete(invertido);
	assert.deepEqual(await otro.abrirComponente(r1.id), r2);
	assert.equal((await otro.exportarPaquete(importadoInvertido.id)).version, 2);

	const { backend: conLocalBackend, repositorio: conLocal } = entorno();
	await conLocal.guardarAsset('image/png', new Uint8Array([43, 44, 45]));
	await conLocal.crearComponente({ id: r1.id, definicion: contenidoComponente(asset1.id) });
	await assert.rejects(conLocal.importarPaquete(leido), /posterior.*adopción explícita/);
	assert.equal(await conLocalBackend.contar('projects'), 0);
	assert.equal(await conLocalBackend.contar('customComponentRevisions'), 1);
	assert.equal(await conLocalBackend.contar('assets'), 1, 'el asset r2 no queda publicado tras rollback');

	const { backend: conConflictoBackend, repositorio: conConflicto } = entorno();
	await conConflicto.guardarAsset('image/png', new Uint8Array([43, 44, 45]));
	await conConflicto.crearComponente({ id: r1.id, definicion: contenidoComponente(asset1.id) });
	await conConflicto.actualizarComponente(r1.id, {
		revisionEsperada: 1, definicion: contenidoComponente(asset1.id, 'Otra r2 local'),
	});
	await assert.rejects(conConflicto.importarPaquete(leido), /Colisión del componente.*r2/);
	assert.equal((await conConflicto.abrirComponente(r1.id)).nombre, 'Otra r2 local');
	assert.equal(await conConflictoBackend.contar('projects'), 0);
	assert.equal(await conConflictoBackend.contar('assets'), 1);
	assert.equal(await conConflictoBackend.contar('customComponentRevisions'), 2);

	const { backend: borradoBackend, repositorio: borrado } = entorno();
	await borrado.guardarAsset('image/png', new Uint8Array([43, 44, 45]));
	const eliminado = await borrado.crearComponente({ id: r1.id, definicion: contenidoComponente(asset1.id) });
	await borrado.eliminarComponente(eliminado.id, eliminado.revision);
	const documentoHistorico = await borrado.importarPaquete(leido);
	assert.equal((await borrado.listarComponentes()).length, 0, 'importar no republica la identidad eliminada');
	assert.deepEqual(await borrado.abrirRevisionComponente(r1.id, 2), r2);
	assert.equal(await borradoBackend.contar('customComponentRevisions'), 2);
	assert.equal((await borrado.exportarPaquete(documentoHistorico.id)).version, 2);
});

test('borrar de Mis Componentes no destruye la revisión colocada ni reutiliza su identidad', async () => {
	const { repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/png', new Uint8Array([46, 47, 48]));
	const r1 = await repositorio.crearComponente({ id: 'cmp-borrado', definicion: contenidoComponente(asset.id) });
	const proyecto = proyectoValido('Histórico');
	proyecto.dispositivos = [instanciarComponentePersonalizado(r1, 'd1')];
	proyecto.gabinete!.colocaciones = [{ dispositivoId: 'd1', x: 20, y: 20, ancho: 30, alto: 45 }];
	const documento = await repositorio.crear({ proyecto });
	await repositorio.eliminarComponente(r1.id, r1.revision);
	assert.equal((await repositorio.listarComponentes()).length, 0);
	assert.deepEqual(await repositorio.abrirRevisionComponente(r1.id, 1), r1);
	assert.deepEqual((await repositorio.exportarPaquete(documento.id)).componentes, [r1]);
	await assert.rejects(repositorio.crearComponente({ id: r1.id, definicion: contenidoComponente(asset.id) }),
		ComponentePersonalizadoDuplicado);
});

test('fallo transaccional al actualizar deja latest y archivo de revisiones en r1', async () => {
	const { backend, repositorio } = entorno();
	const asset = await repositorio.guardarAsset('image/png', new Uint8Array([49, 50, 51]));
	const r1 = await repositorio.crearComponente({ definicion: contenidoComponente(asset.id) });
	backend.fallarProximaTransaccion(new Error('fallo compuesto'));
	await assert.rejects(repositorio.actualizarComponente(r1.id, {
		revisionEsperada: 1, definicion: contenidoComponente(asset.id, 'No publicado'),
	}), /fallo compuesto/);
	assert.equal((await repositorio.abrirComponente(r1.id)).revision, 1);
	assert.equal(await backend.contar('customComponentRevisions'), 1);
	await assert.rejects(repositorio.abrirRevisionComponente(r1.id, 2), /No existe/);
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

test('importar componente confirma asset, definición e histórico juntos y cancelar duplicado no deja asset', async () => {
	const { backend, repositorio } = entorno();
	const primera = await imagenImportable(new Uint8Array([10, 11, 12]));
	const segunda = await imagenImportable(new Uint8Array([20, 21, 22]));
	const original = await repositorio.importarComponenteConAsset({
		id: 'cmp-importado', definicion: contenidoComponente(primera.id), asset: primera,
	});
	assert.equal(original.revision, 1);
	assert.deepEqual((await repositorio.abrirAsset(primera.id))?.bytes, primera.bytes);
	assert.deepEqual(await repositorio.abrirRevisionComponente(original.id, 1), original);

	await assert.rejects(repositorio.importarComponenteConAsset({
		id: original.id, definicion: contenidoComponente(segunda.id), asset: segunda,
	}), ComponentePersonalizadoDuplicado);
	assert.equal(await repositorio.abrirAsset(segunda.id), undefined);
	assert.equal(await backend.contar('assets'), 1);
	assert.equal(await backend.contar('customComponentRevisions'), 1);

	const copia = await repositorio.importarComponenteConAsset({
		definicion: contenidoComponente(segunda.id, 'Copia explícita'), asset: segunda,
	});
	assert.notEqual(copia.id, original.id);
	assert.equal(copia.revision, 1);
	assert.deepEqual((await repositorio.abrirAsset(segunda.id))?.bytes, segunda.bytes);
	assert.equal(await backend.contar('assets'), 2);
	assert.equal(await backend.contar('customComponents'), 2);
});

test('importar componente rechaza SHA falso, asset ajeno y colisión sin escrituras parciales', async () => {
	const { backend, repositorio } = entorno();
	const asset = await imagenImportable(new Uint8Array([33, 34, 35]));
	const falso = { ...asset, id: `sha256:${'f'.repeat(64)}` };
	await assert.rejects(repositorio.importarComponenteConAsset({
		definicion: contenidoComponente(falso.id), asset: falso,
	}), /SHA-256/);
	await assert.rejects(repositorio.importarComponenteConAsset({
		definicion: contenidoComponente(`sha256:${'0'.repeat(64)}`), asset,
	}), /no corresponde/);
	assert.equal(await backend.contar('assets'), 0);
	assert.equal(await backend.contar('customComponents'), 0);

	await backend.transaccion(['assets'], 'readwrite', async (tx) => {
		await tx.guardar('assets', asset.id, {
			id: asset.id, mime: asset.mime, tamano: 1,
			creadoEn: '2026-01-01T00:00:00.000Z', bytes: new Uint8Array([99]),
		});
	});
	await assert.rejects(repositorio.importarComponenteConAsset({
		definicion: contenidoComponente(asset.id), asset,
	}), /Colisión del asset/);
	assert.equal(await backend.contar('assets'), 1);
	assert.equal(await backend.contar('customComponents'), 0);
	assert.equal(await backend.contar('customComponentRevisions'), 0);
});

test('fallo físico al importar componente revierte asset y definición en una transacción', async () => {
	const { backend, repositorio } = entorno();
	const asset = await imagenImportable(new Uint8Array([44, 45, 46]));
	backend.fallarProximaTransaccion(new Error('almacenamiento indisponible'));
	await assert.rejects(repositorio.importarComponenteConAsset({
		definicion: contenidoComponente(asset.id), asset,
	}), /almacenamiento indisponible/);
	for (const almacen of ['assets', 'customComponents', 'customComponentRevisions'] as const) {
		assert.equal(await backend.contar(almacen), 0, almacen);
	}
});

test('export/import portable hace roundtrip autosuficiente y acepta contenido idéntico existente', async () => {
	const paquete = await paquetePortable();
	assert.equal(paquete.assets.length, 1);
	assert.equal(paquete.componentes.length, 1);
	assert.equal(paquete.proyecto.dispositivos[0].assetId, paquete.assets[0].id);
	assert.ok(!JSON.stringify(paquete).includes('Buffer'));

	const { backend, repositorio } = entorno();
	const primero = await repositorio.importarPaquete(paquete, 'Copia recibida');
	assert.equal(primero.nombre, 'Copia recibida');
	assert.equal((await repositorio.abrirAsset(paquete.assets[0].id))!.tamano, 5);
	assert.deepEqual(await repositorio.abrirComponente('cmp-portable'), paquete.componentes[0]);
	assert.equal((await repositorio.listarSnapshots(primero.id))[0].motivo, 'importacion-paquete');
	assert.equal(await repositorio.obtenerProyectoActivo(), undefined, 'importar no activa antes de renderizar');

	const segundo = await repositorio.importarPaquete(paquete);
	assert.notEqual(segundo.id, primero.id);
	assert.equal(await backend.contar('projects'), 2);
	assert.equal(await backend.contar('assets'), 1);
	assert.equal(await backend.contar('customComponents'), 1);
	assert.equal(await backend.contar('customComponentRevisions'), 1);
	assert.equal(await backend.contar('snapshots'), 2);
});

test('importar una revisión histórica no desplaza la definición vigente local', async () => {
	const paquete = await paquetePortable();
	const { repositorio } = entorno();
	const asset = paquete.assets[0];
	const bytes = Uint8Array.from(globalThis.atob(asset.base64), (c) => c.charCodeAt(0));
	await repositorio.guardarAsset(asset.mime, bytes);
	const r1 = await repositorio.crearComponente({
		id: 'cmp-portable', definicion: contenidoComponente(asset.id, 'Componente portable'),
	});
	const r2 = await repositorio.actualizarComponente(r1.id, {
		revisionEsperada: 1, definicion: contenidoComponente(asset.id, 'Revisión local nueva'),
	});
	await repositorio.importarPaquete(paquete);
	assert.equal((await repositorio.abrirComponente(r1.id)).revision, r2.revision);
	assert.deepEqual(await repositorio.abrirRevisionComponente(r1.id, 1), paquete.componentes[0]);
	assert.equal((await repositorio.listarComponentes()).length, 1);
});

test('importar no republica una definición borrada ni adopta una revisión posterior automáticamente', async () => {
	const paquete = await paquetePortable();
	const { repositorio } = entorno();
	const asset = paquete.assets[0];
	const bytes = Uint8Array.from(globalThis.atob(asset.base64), (c) => c.charCodeAt(0));
	await repositorio.guardarAsset(asset.mime, bytes);
	const r1 = await repositorio.crearComponente({
		id: 'cmp-portable', definicion: contenidoComponente(asset.id, 'Componente portable'),
	});
	await repositorio.eliminarComponente(r1.id, 1);
	await repositorio.importarPaquete(paquete);
	assert.equal((await repositorio.listarComponentes()).length, 0);

	const { repositorio: destinoPosterior, backend } = entorno();
	await destinoPosterior.guardarAsset(asset.mime, bytes);
	const local = await destinoPosterior.crearComponente({
		id: 'cmp-portable', definicion: contenidoComponente(asset.id, 'Biblioteca local r1'),
	});
	const posterior = structuredClone(paquete);
	posterior.componentes[0].revision = 2;
	posterior.proyecto.dispositivos[0].componentePersonalizado!.revision = 2;
	await assert.rejects(destinoPosterior.importarPaquete(posterior), /posterior.*adopción explícita/);
	assert.equal((await destinoPosterior.abrirComponente(local.id)).revision, 1);
	assert.equal(await backend.contar('projects'), 0);
	assert.equal(await backend.contar('customComponentRevisions'), 1);
});

test('importar rechaza procedencia incompleta o revisión incorrecta antes de escribir', async () => {
	const paquete = await paquetePortable();
	const { repositorio, backend } = entorno();
	const ausente = structuredClone(paquete);
	ausente.componentes = [];
	await assert.rejects(repositorio.importarPaquete(ausente), /no contiene la revisión 1/);
	const distinta = structuredClone(paquete);
	distinta.componentes[0].revision = 2;
	await assert.rejects(repositorio.importarPaquete(distinta), /no contiene la revisión 1/);
	assert.equal(await backend.contar('projects'), 0);
	assert.equal(await backend.contar('customComponentRevisions'), 0);
});

test('import rechaza paquete incompleto y hash falso antes de abrir una transacción', async () => {
	const paquete = await paquetePortable();
	const { backend, repositorio } = entorno();
	const incompleto = structuredClone(paquete);
	incompleto.assets = [];
	await assert.rejects(repositorio.importarPaquete(incompleto), /paquete portable no es válido/i);

	const hashFalso = structuredClone(paquete);
	hashFalso.assets[0].base64 = 'AQID';
	await assert.rejects(repositorio.importarPaquete(hashFalso), /SHA-256/i);
	assert.equal(await backend.contar('projects'), 0);
	assert.equal(await backend.contar('assets'), 0);
	assert.equal(await backend.contar('customComponents'), 0);
	assert.equal(await backend.contar('snapshots'), 0);
});

test('el codec exige también los assets usados directamente por instancias del proyecto', () => {
	const proyecto = proyectoValido('Asset de instancia');
	proyecto.dispositivos[0].assetId = `sha256:${'a'.repeat(64)}`;
	assert.throws(
		() => crearPaqueteProyecto(proyecto, [], []),
		/falta el asset.*usado por el aparato/i,
	);
});

test('fallo físico al importar revierte proyecto, asset, componente y snapshot juntos', async () => {
	const paquete = await paquetePortable();
	const { backend, repositorio } = entorno();
	backend.fallarProximaTransaccion(new Error('fallo import simulado'));
	await assert.rejects(repositorio.importarPaquete(paquete), /fallo import simulado/);
	for (const almacen of ['projects', 'assets', 'customComponents', 'customComponentRevisions', 'snapshots'] as const) {
		assert.equal(await backend.contar(almacen), 0, `${almacen} quedó publicado a medias`);
	}
});

test('import rechaza una definición con el mismo ID y distinto contenido sin pisarla', async () => {
	const paquete = await paquetePortable();
	const { backend, repositorio } = entorno();
	const asset = paquete.assets[0];
	const bytes = Uint8Array.from(globalThis.atob(asset.base64), (caracter) => caracter.charCodeAt(0));
	await repositorio.guardarAsset(asset.mime, bytes);
	const conflictivo = await repositorio.crearComponente({
		id: paquete.componentes[0].id,
		definicion: contenidoComponente(asset.id, 'Definición local distinta'),
	});

	await assert.rejects(repositorio.importarPaquete(paquete), /Colisión del componente/);
	assert.equal((await repositorio.abrirComponente(conflictivo.id)).nombre, 'Definición local distinta');
	assert.equal(await backend.contar('projects'), 0);
	assert.equal(await backend.contar('snapshots'), 0);
});

test('import rechaza un asset con el mismo hash nominal pero bytes almacenados distintos', async () => {
	const paquete = await paquetePortable();
	const { backend, repositorio } = entorno();
	const asset = paquete.assets[0];
	await backend.transaccion(['assets'], 'readwrite', async (tx) => {
		await tx.guardar('assets', asset.id, {
			id: asset.id,
			mime: asset.mime,
			tamano: 1,
			creadoEn: '2026-01-01T00:00:00.000Z',
			bytes: new Uint8Array([255]),
		});
	});

	await assert.rejects(repositorio.importarPaquete(paquete), /Colisión del asset/);
	assert.equal(await backend.contar('projects'), 0);
	assert.equal(await backend.contar('customComponents'), 0);
	assert.equal(await backend.contar('snapshots'), 0);
});
