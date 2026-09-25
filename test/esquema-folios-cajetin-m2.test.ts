import assert from 'node:assert/strict';
import test from 'node:test';
import { hojaASvg } from '../app/esquema-svg.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

// El módulo de descarga del PDF observa el DOM al importarse, aunque aquí solo generamos un Blob.
Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [] },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { esquemaComoBlob } = await import('../app/esquema-pdf.js');

function proyectoValido(nombre: string): ReturnType<typeof crearProyecto> {
	const proyecto = crearProyecto(nombre);
	proyecto.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	return proyecto;
}

test('folios M2 persistidos llevan título y clase opcional al SVG y PDF', async () => {
	const proyecto = proyectoValido('Tablero M2');
	proyecto.hojas = [
		{ id: 'control', numero: 1, titulo: 'Control central', clase: 'plc-io' },
		{ id: 'auxiliar', numero: 2, titulo: 'Auxiliar' },
	];
	proyecto.esquema = { representaciones: [] };
	const leido = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	const hojas = montarEsquema(leido, calcularPotenciales(leido));
	assert.deepEqual(hojas.map((h) => [h.id, h.titulo, h.clase]), [
		['control', 'Control central', 'plc-io'], ['auxiliar', 'Auxiliar', undefined],
	]);
	assert.equal(Object.hasOwn(hojas[1], 'clase'), false);
	const primero = hojaASvg(hojas[0], { proyecto: leido.nombre });
	const segundo = hojaASvg(hojas[1], { proyecto: leido.nombre });
	assert.match(primero, /Clase: PLC\/E\/S · Control central<\/text>/);
	assert.match(segundo, />Auxiliar<\/text>/);
	assert.doesNotMatch(segundo, /Clase:/);
	const pdf = Buffer.from(await esquemaComoBlob(hojas, leido.nombre).arrayBuffer()).toString('latin1');
	assert.match(pdf, /Clase: PLC\/E\/S/);
	assert.match(pdf, /Control central/);
	assert.match(pdf, /Auxiliar/);
});

test('montaje legacy no infiere clase del circuito ni del título', async () => {
	const proyecto = proyectoValido('Tablero anterior');
	proyecto.dispositivos.push({ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] });
	proyecto.esquema = { titulos: { 1: 'Mando legado' } };
	const leido = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	const hojas = montarEsquema(leido, calcularPotenciales(leido));
	assert.ok(hojas.length > 0);
	for (const hoja of hojas) {
		assert.equal(Object.hasOwn(hoja, 'clase'), false);
		assert.doesNotMatch(hojaASvg(hoja), /Clase:/);
	}
	const pdf = Buffer.from(await esquemaComoBlob(hojas, leido.nombre).arrayBuffer()).toString('latin1');
	assert.doesNotMatch(pdf, /Clase:/);
});

test('título hostil del folio queda como texto SVG escapado', () => {
	const proyecto = proyectoValido('Tablero M2');
	proyecto.hojas = [{ id: 'h', numero: 1, titulo: '<script onload="x">& cierre', clase: 'mando' }];
	proyecto.esquema = { representaciones: [] };
	const leido = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	const [hoja] = montarEsquema(leido, calcularPotenciales(leido));
	const svg = hojaASvg(hoja);
	assert.match(svg, /Clase: MANDO · &lt;script onload=&quot;x&quot;&gt;&amp; cierre<\/text>/);
	assert.doesNotMatch(svg, /<script|onload="x"/);
});
