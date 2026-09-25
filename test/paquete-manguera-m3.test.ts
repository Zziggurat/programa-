import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Tirada } from '../src/motores/levantamiento.js';
import { listaDePedido } from '../src/motores/levantamiento.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');

const procedencia = { estado: 'confirmado' as const, projectId: 'doc-manguera',
	revisionRepositorio: 3, buildId: 'BUILD-QA', generadoEn: '2026-09-24T12:00:00.000Z' };

test('DOC-02: 3×/4× de obra son metros de manguera, no siete metrajes de hilo del tablero', async () => {
	const tiradas: Tirada[] = [
		{ id: 't3', nombre: 'Manguera 3×2,5', metros: 12, recorrido: 11,
			seccion: 2.5, conductores: 3, fecha: '2026-09-24T12:00:00.000Z' },
		{ id: 't4', nombre: 'Manguera 4×2,5', metros: 20, recorrido: 19,
			seccion: 2.5, conductores: 4, fecha: '2026-09-24T12:00:00.000Z' },
	];
	assert.deepEqual(listaDePedido(tiradas).map((fila) => [fila.conductores, fila.metros]),
		[[3, 12], [4, 20]], 'el pedido suma metros por manguera, nunca por cada alma');

	const proyecto = crearProyecto('Conductores individuales');
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Conexiones' }];
	proyecto.dispositivos = ['origen', 'destino'].map((id) => ({
		id, tipo: 'bornero' as const, designacion: id,
		bornes: Array.from({ length: 7 }, (_, indice) => ({ id: String(indice + 1), tipo: 'control' as const })),
	}));
	proyecto.conductores = Array.from({ length: 7 }, (_, indice) => ({
		id: `w${indice + 1}`,
		de: { dispositivoId: 'origen', borneId: String(indice + 1) },
		a: { dispositivoId: 'destino', borneId: String(indice + 1) },
		seccion: 2.5,
		estadoRutaFisica: 'pendiente' as const,
	}));
	const antes = JSON.stringify(proyecto);
	const archivos = await crearArchivosPaqueteDocumental(proyecto, procedencia);
	assert.equal(JSON.stringify(proyecto), antes, 'el paquete no cambia el proyecto');
	const contenido = (ruta: string) => String(archivos.find((archivo) => archivo.ruta === ruta)?.contenido ?? '');
	const informe = JSON.parse(contenido('ingenieria/informe.json')) as {
		conductores: { id: string; longitudM?: number }[];
		totalesConductores: { cantidad: number; longitudTotalM?: number }[];
	};
	assert.equal(informe.conductores.length, 7, 'cada alma sigue siendo una conexión eléctrica individual');
	assert.ok(informe.conductores.every((conductor) => conductor.longitudM === undefined),
		'las rutas pendientes no fabrican metros de corte');
	assert.deepEqual(informe.totalesConductores, [], 'sin ruta física no se suma un falso metraje de cable');
	assert.equal((contenido('listas/conductores.csv').match(/^w[1-7];/gm) ?? []).length, 7);
	assert.match(contenido('listas/conductores.csv'),
		/Longitud m corresponde a la política eléctrica de Ingeniería, no a un corte verificado ni a metros de manguera multiconductora/);
	assert.ok(archivos.every((archivo) => !/mangueras|tiradas/i.test(archivo.ruta)),
		'el levantamiento de cubierta no pertenece a esta revisión de Proyecto');
});
