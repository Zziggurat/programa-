import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepositorioDatosTecnicos } from '../src/datos-tecnicos/repositorio.js';
import { congelarSubconjunto, crearPaqueteTecnico, indexarRevisiones, leerPaqueteTecnico, publicarRevision, verificarRevision } from '../src/datos-tecnicos/hash.js';
import { DatosTecnicosInvalidos, LIMITES_TECNICOS } from '../src/datos-tecnicos/schema.js';
import { claveRevision, referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { BackendPersistenciaMemoria } from '../src/persistencia/memoria.js';
import { RepositorioProyectosCore } from '../src/persistencia/repositorio.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import type { BackendPersistencia, TransaccionPersistencia } from '../src/persistencia/tipos.js';
import { curvaTecnica, productoTecnico, proyectoConProductoTecnico } from './helpers/datos-tecnicos.js';

function entorno() {
	const backend = new BackendPersistenciaMemoria();
	return { backend, repositorio: new RepositorioDatosTecnicos(backend) };
}

test('V8 repositorio importa idempotentemente y devuelve copias defensivas', async () => {
	const { repositorio } = entorno(); const p = productoTecnico(); const ref = referenciaTecnica(p);
	assert.deepEqual(await repositorio.importar([p]), { nuevas: 1, existentes: 0 });
	assert.deepEqual(await repositorio.importar([structuredClone(p)]), { nuevas: 0, existentes: 1 });
	p.nombre = 'Mutación ajena';
	const abierto = (await repositorio.obtener(ref))!;
	assert.equal(abierto.nombre, 'Fixture producto-prueba'); abierto.nombre = 'Otra mutación ajena';
	const listado = await repositorio.listar(); listado[0].nombre = 'Lista modificada';
	assert.equal((await repositorio.obtener(ref))!.nombre, 'Fixture producto-prueba');
	assert.equal((await repositorio.listar()).length, 1);
	assert.equal(await repositorio.obtener({ ...ref, hash: `sha256:${'f'.repeat(64)}` }), undefined);
});

test('V8 misma revisión con contenido diferente se rechaza y revierte otras revisiones del lote', async () => {
	const { repositorio } = entorno(); const original = productoTecnico();
	await repositorio.importar([original]);
	const cambiado = structuredClone(original); cambiado.campos[0].valor = 3;
	const revisionConflicto = publicarRevision(cambiado);
	const adicional = productoTecnico({ id: 'adicional' });
	await assert.rejects(repositorio.importar([adicional, revisionConflicto]), /CONFLICT/);
	assert.equal((await repositorio.listar()).length, 1);
	assert.deepEqual(await repositorio.obtener(referenciaTecnica(original)), original);
	assert.equal(await repositorio.obtener(referenciaTecnica(adicional)), undefined);
});

test('V8 revisión nueva y revisión retirada son objetos nuevos; proyectos fijados no cambian', async () => {
	const { repositorio } = entorno(); const r1 = productoTecnico();
	const r2 = productoTecnico({ revision: 2, estado: 'RETIRADA', campos: [{ ...r1.campos[0], valor: 3 }] });
	await repositorio.importar([r1, r2]);
	assert.deepEqual(await repositorio.obtener(referenciaTecnica(r1)), r1);
	assert.deepEqual(await repositorio.obtener(referenciaTecnica(r2)), r2);
	const congeladoA = congelarSubconjunto([referenciaTecnica(r1)], await repositorio.listar());
	const congeladoB = congelarSubconjunto([referenciaTecnica(r2)], await repositorio.listar());
	assert.equal(congeladoA[0].revision, 1); assert.equal(congeladoB[0].revision, 2);
	assert.notEqual(congeladoA[0].hash, congeladoB[0].hash);
});

test('V8 identidad comercial repetida no fusiona catálogos ni variantes diferentes', async () => {
	const { repositorio } = entorno();
	const a = productoTecnico({ fabricanteDeclarado: 'Fabricante sintético A', referenciaComercial: 'X100' });
	const b = productoTecnico({ catalogo: { id: 'otro-catalogo', nombre: 'Otro catálogo sintético' }, fabricanteDeclarado: 'Fabricante sintético B', referenciaComercial: 'X100', variante: 'DC 24 V' });
	await repositorio.importar([a, b]);
	assert.equal((await repositorio.listar()).length, 2);
	assert.equal((await repositorio.obtener(referenciaTecnica(a)))!.catalogo.id, a.catalogo.id);
	assert.equal((await repositorio.obtener(referenciaTecnica(b)))!.catalogo.id, b.catalogo.id);
});

test('V8 quota simulado revierte el lote completo conservando biblioteca anterior', async () => {
	const { repositorio, backend } = entorno(); const original = productoTecnico();
	await repositorio.importar([original]);
	backend.fallarProximaTransaccion(new DOMException('Sin espacio', 'QuotaExceededError'));
	await assert.rejects(repositorio.importar([productoTecnico({ id: 'nuevo-a' }), productoTecnico({ id: 'nuevo-b' })]), { name: 'QuotaExceededError' });
	assert.deepEqual(await repositorio.listar(), [original]);
});

test('V8 cancelar antes de importar no escribe ningún registro', async () => {
	const { repositorio, backend } = entorno(); const controller = new AbortController(); controller.abort();
	await assert.rejects(repositorio.importar([productoTecnico()], { signal: controller.signal }), { name: 'AbortError' });
	assert.equal(await backend.contar('technicalData'), 0);
});

test('V8 cancelar desde progreso interrumpe validación antes de persistencia', async () => {
	const { repositorio, backend } = entorno(); const controller = new AbortController(); const progreso: number[] = [];
	const lote = Array.from({ length: 101 }, (_, i) => productoTecnico({ id: `producto-${i}` }));
	await assert.rejects(repositorio.importar(lote, { signal: controller.signal,
		progreso: (n, total) => { progreso.push(n); assert.equal(total, 101); controller.abort(); },
	}), { name: 'AbortError' });
	assert.deepEqual(progreso, [100]);
	assert.equal(await backend.contar('technicalData'), 0);
});

test('V8 cancelar durante una escritura aborta también registros ya preparados', async () => {
	const memoria = new BackendPersistenciaMemoria(); const controller = new AbortController(); let escrituras = 0;
	const backend: BackendPersistencia = {
		transaccion: (almacenes, modo, trabajo) => memoria.transaccion(almacenes, modo, async tx => {
			const observado: TransaccionPersistencia = { ...tx,
				guardar: async (almacen, clave, valor) => {
					await tx.guardar(almacen, clave, valor); escrituras++; controller.abort();
				},
			};
			return trabajo(observado);
		}),
	};
	const repositorio = new RepositorioDatosTecnicos(backend);
	await assert.rejects(repositorio.importar([productoTecnico(), productoTecnico({ id: 'segundo' })], { signal: controller.signal }), { name: 'AbortError' });
	assert.equal(escrituras, 1);
	assert.equal(await memoria.contar('technicalData'), 0);
});

test('V8 hash incorrecto o dependencia rota no altera la biblioteca', async () => {
	const { repositorio, backend } = entorno();
	const alterado = productoTecnico(); alterado.campos[0].valor = 99;
	await assert.rejects(repositorio.importar([alterado]), /Integridad/);
	const curva = curvaTecnica(); const dependiente = productoTecnico({ curva: referenciaTecnica(curva) });
	await assert.rejects(repositorio.importar([dependiente]), /MISSING/);
	assert.equal(await backend.contar('technicalData'), 0);
	await repositorio.importar([dependiente, curva]);
	assert.equal((await repositorio.listar()).length, 2);
});

test('V8 borrar catálogo global no rompe subconjunto congelado portable ni otro catálogo', async () => {
	const { repositorio } = entorno(); const curva = curvaTecnica(); const producto = productoTecnico({ curva: referenciaTecnica(curva) });
	const ajeno = productoTecnico({ catalogo: { id: 'ajeno', nombre: 'No borrar' } });
	await repositorio.importar([producto, curva, ajeno]);
	const congelado = congelarSubconjunto([referenciaTecnica(producto)], await repositorio.listar());
	const archivo = JSON.stringify(crearPaqueteTecnico(congelado));
	await repositorio.eliminarCatalogo(producto.catalogo.id);
	assert.deepEqual(await repositorio.listar(), [ajeno]);
	const indice = indexarRevisiones(congelado);
	assert.deepEqual(indice.get(claveRevision(referenciaTecnica(producto))), producto);
	assert.doesNotThrow(() => congelado.forEach(verificarRevision));
	const limpio = entorno(); const recibido = leerPaqueteTecnico(archivo);
	await limpio.repositorio.importar(recibido.revisiones);
	assert.deepEqual(await limpio.repositorio.obtener(referenciaTecnica(producto)), producto);
	assert.equal((await limpio.repositorio.listar()).length, 2);
});

test('V8 importar fuente declarada no crea evidencia humana y exportar no la filtra', async () => {
	const origen = entorno(); const producto = productoTecnico({ fabricanteDeclarado: 'Marca declarada por archivo',
		procedencia: { origen: 'DOCUMENTAL', referencia: 'Documento declarado no corroborado' } });
	await origen.repositorio.importar([producto]);
	assert.equal(await origen.repositorio.revisionHumana(producto.hash), undefined);
	const evidencia = { hash: producto.hash, estado: 'REVISADO' as const, responsable: 'Revisor local',
		evidencia: 'Comparación manual de campos sintéticos', fecha: '2026-09-07T12:00:00Z' };
	await origen.repositorio.registrarRevisionHumana(evidencia);
	assert.deepEqual(await origen.repositorio.revisionHumana(producto.hash), evidencia);
	const paquete = crearPaqueteTecnico(await origen.repositorio.listar()); const exportado = JSON.stringify(paquete);
	assert.equal(exportado.includes('Revisor local'), false);
	const destino = entorno(); await destino.repositorio.importar(leerPaqueteTecnico(exportado).revisiones);
	assert.equal(await destino.repositorio.revisionHumana(producto.hash), undefined);
});

test('V8 borradores de identidades con separadores no colisionan', async () => {
	const { repositorio } = entorno();
	const primero = productoTecnico({ catalogo: { id: 'a:b', nombre: 'Catálogo A:B' }, id: 'c' });
	const segundo = productoTecnico({ catalogo: { id: 'a', nombre: 'Catálogo A' }, id: 'b:c' });
	await repositorio.guardarBorrador(primero); await repositorio.guardarBorrador(segundo);
	assert.equal((await repositorio.listarBorradores()).length, 2);
});

test('V8 guardar borrador no modifica revisión ya publicada', async () => {
	const { repositorio } = entorno(); const original = productoTecnico(); await repositorio.importar([original]);
	const borrador = structuredClone(original); borrador.campos[0].valor = 9;
	await repositorio.guardarBorrador(borrador);
	assert.deepEqual(await repositorio.obtener(referenciaTecnica(original)), original);
	assert.equal((await repositorio.listarBorradores())[0].campos[0].valor, 9);
});

test('V8 import directo del repositorio también respeta límite de revisiones', async () => {
	const { repositorio, backend } = entorno(); const r = productoTecnico();
	await assert.rejects(repositorio.importar(Array(LIMITES_TECNICOS.revisiones + 1).fill(r)), DatosTecnicosInvalidos);
	assert.equal(await backend.contar('technicalData'), 0);
});

test('V8 borrador con campos inesperados o números inválidos se rechaza sin almacenarlo', async () => {
	const { repositorio, backend } = entorno();
	const inesperado = Object.assign(productoTecnico(), { ejecutar: 'globalThis.alert(1)' });
	await assert.rejects(repositorio.guardarBorrador(inesperado), DatosTecnicosInvalidos);
	const invalido = productoTecnico(); invalido.campos[0].valor = NaN;
	await assert.rejects(repositorio.guardarBorrador(invalido), DatosTecnicosInvalidos);
	assert.equal(await backend.contar('technicalData'), 0);
});

test('V8 una revisión almacenada corrupta no puede dar éxito idempotente por conservar el hash nominal', async () => {
	const { repositorio, backend } = entorno(); const original = productoTecnico();
	await repositorio.importar([original]);
	const clave = claveRevision(referenciaTecnica(original)); const corrupta = structuredClone(original);
	corrupta.campos[0].valor = 999;
	await backend.transaccion(['technicalData'], 'readwrite', tx => tx.guardar('technicalData', clave,
		{ clave, tipo: 'REVISION', revision: corrupta }));
	await assert.rejects(repositorio.importar([original]), /Integridad|CONFLICT/);
	const crudo = await backend.transaccion(['technicalData'], 'readonly', tx => tx.obtener<{ revision: typeof original }>('technicalData', clave));
	assert.equal(crudo!.revision.campos[0].valor, 999, 'no se sobrescribe silenciosamente evidencia corrupta');
});

test('V8 dos proyectos/snapshots fijan revisiones independientes y el portable resuelve sin catálogo', async () => {
	const { backend, repositorio } = entorno(); const proyectos = new RepositorioProyectosCore(backend);
	const r1 = productoTecnico(); const r2 = productoTecnico({ revision: 2, campos: [{ ...r1.campos[0], valor: 3 }] });
	await repositorio.importar([r1, r2]);
	const proyectoA = proyectoConProductoTecnico(r1); proyectoA.nombre = 'Proyecto A r1';
	const proyectoB = proyectoConProductoTecnico(r2); proyectoB.nombre = 'Proyecto B r2';
	const a = await proyectos.crear({ proyecto: proyectoA }); const b = await proyectos.crear({ proyecto: proyectoB });
	const snapshotA = await proyectos.crearSnapshot(a.id); const snapshotB = await proyectos.crearSnapshot(b.id);
	await repositorio.eliminarCatalogo(r1.catalogo.id);
	const reabrirA = await proyectos.abrir(a.id); const reabrirB = await proyectos.abrir(b.id);
	const icu = (p: typeof proyectoA) => resolverProyectoTecnico(p).resoluciones.find(r => r.campo === 'proteccion.Icu')!.dato!.valor;
	assert.equal(icu(reabrirA.proyecto), 6); assert.equal(icu(reabrirB.proyecto), 3);
	assert.equal(snapshotA.proyecto.datosTecnicos!.revisiones[0].revision, 1);
	assert.equal(snapshotB.proyecto.datosTecnicos!.revisiones[0].revision, 2);
	const paquete = await proyectos.exportarPaquete(a.id);
	const limpio = entorno(); const proyectosLimpios = new RepositorioProyectosCore(limpio.backend);
	const recibido = await proyectosLimpios.importarPaquete(paquete);
	assert.equal((await limpio.repositorio.listar()).length, 0, 'ningún catálogo global es necesario');
	assert.equal(icu(recibido.proyecto), 6);
	assert.deepEqual(recibido.proyecto.datosTecnicos, reabrirA.proyecto.datosTecnicos);
	assert.equal(recibido.proyecto.datosTecnicos!.revisiones[0].procedencia.origen, 'SINTETICO');
});
