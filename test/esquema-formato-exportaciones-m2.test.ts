import assert from 'node:assert/strict';
import test from 'node:test';
import { hojaASvg } from '../app/esquema-svg.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

// El módulo PDF prepara la descarga observando el DOM al cargarse. Solo generamos un Blob.
Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [] },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { esquemaComoBlob } = await import('../app/esquema-pdf.js');

test('folios M2 A2/A3 mixtos conservan tamaño físico en SVG y cada página PDF', async () => {
	const proyecto = crearProyecto('Planos mixtos');
	proyecto.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	proyecto.hojas = [
		{ id: 'bornes', numero: 2, titulo: 'Bornes A3' },
		{ id: 'potencia', numero: 1, titulo: 'Potencia A2', formatoPapel: 'A2' },
	];
	proyecto.esquema = { representaciones: [] };
	const reabierto = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	const hojas = montarEsquema(reabierto, calcularPotenciales(reabierto));
	assert.deepEqual(hojas.map((h) => [h.id, h.anchoMm, h.altoMm]), [
		['potencia', 594, 420], ['bornes', 420, 297],
	]);
	assert.match(hojaASvg(hojas[0]), /viewBox="0 0 594 420"/);
	assert.match(hojaASvg(hojas[1]), /viewBox="0 0 420 297"/);
	const pdf = Buffer.from(await esquemaComoBlob(hojas, reabierto.nombre).arrayBuffer()).toString('latin1');
	const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
		.map((m) => [Number(m[1]), Number(m[2])]);
	assert.equal(boxes.length, 2, 'cada página PDF debe declarar su propio MediaBox');
	const ptPorMm = 72 / 25.4;
	for (const [i, [w, h]] of boxes.entries()) {
		assert.ok(Math.abs(w / ptPorMm - hojas[i].anchoMm) < 0.02, `ancho PDF página ${i + 1}`);
		assert.ok(Math.abs(h / ptPorMm - hojas[i].altoMm) < 0.02, `alto PDF página ${i + 1}`);
	}
});
