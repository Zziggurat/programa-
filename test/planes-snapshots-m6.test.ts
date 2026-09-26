import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { asignarPlanesAutomaticos } from '../app/escena3d.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { BackendPersistenciaMemoria, RepositorioProyectosCore } from '../src/persistencia/index.js';

test('CAB-24: snapshots densos retienen veinte revisiones, restauran planes e aislan otro tablero', async (t) => {
	const proyecto = EJEMPLOS.find((e) => /estrella-triángulo/i.test(e.titulo))!.crear();
	delete proyecto.esEjemplo;
	proyecto.nombre = 'Denso A';
	assert.equal(proyecto.conductores.length, 61);
	assert.equal(asignarPlanesAutomaticos(proyecto), 59);
	const planes = new Map(proyecto.conductores.map((c) => [c.id, c.planRutaAutomatica]));
	let secuencia = 0;
	const backend = new BackendPersistenciaMemoria();
	const repositorio = new RepositorioProyectosCore(backend, {
		crearId: () => `cab24-${String(++secuencia).padStart(3, '0')}`,
		reloj: () => new Date(Date.UTC(2026, 0, 1, 0, 0, secuencia)),
	});
	const a = await repositorio.crear({ proyecto });
	const proyectoB = crearProyecto('Tablero B');
	proyectoB.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyectoB.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	const b = await repositorio.crear({ proyecto: proyectoB });
	const snapshotB = await repositorio.crearSnapshot(b.id);
	const primeroA = await repositorio.crearSnapshot(a.id);
	const bytesDocumento = Buffer.byteLength(JSON.stringify(a.proyecto));
	for (let i = 1; i < 20; i++) await repositorio.crearSnapshot(a.id);
	const original = await repositorio.listarSnapshots(a.id);
	assert.equal(original.length, 20);
	assert.ok(original.some((s) => s.id === primeroA.id));
	assert.ok(original.every((s) => s.proyecto.conductores.filter((c) => c.planRutaAutomatica).length === 59));

	const editado = structuredClone(a.proyecto);
	editado.datos = { ...editado.datos, cliente: 'Revisión nueva' };
	const a2 = await repositorio.guardar(a.id, { revisionEsperada: a.revision, proyecto: editado });
	await repositorio.crearSnapshot(a.id);
	const retenidos = await repositorio.listarSnapshots(a.id);
	assert.equal(retenidos.length, 20);
	assert.ok(!retenidos.some((s) => s.id === primeroA.id), 'se retira el más antiguo, no un plan al azar');
	const anterior = retenidos.find((s) => s.proyecto.datos?.cliente !== 'Revisión nueva');
	assert.ok(anterior);
	const restaurado = await repositorio.restaurarSnapshot(a.id, anterior.id, a2.revision);
	assert.equal(restaurado.proyecto.datos?.cliente, undefined);
	for (const c of restaurado.proyecto.conductores) assert.deepEqual(c.planRutaAutomatica, planes.get(c.id), c.id);
	assert.deepEqual((await repositorio.listarSnapshots(b.id)).map((s) => s.id), [snapshotB.id]);
	assert.equal((await repositorio.abrir(b.id)).proyecto.nombre, 'Tablero B');
	assert.equal((await repositorio.listarSnapshots(a.id)).length, 20,
		'el snapshot previo a restaurar también respeta la retención');
	const bytesRetenidos = (await repositorio.listarSnapshots(a.id))
		.reduce((total, s) => total + Buffer.byteLength(JSON.stringify(s.proyecto)), 0);
	t.diagnostic(`Documento denso ${bytesDocumento} bytes JSON; veinte snapshots ${bytesRetenidos} bytes JSON, sin incluir overhead IndexedDB ni assets.`);
});
