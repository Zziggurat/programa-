import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dxfDePlaca } from '../app/exportaciones.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { ProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';

const confirmado: ProcedenciaDocumento = {
	estado: 'confirmado', projectId: 'repo-placa-7', revisionRepositorio: 12,
	buildId: 'build-DOC-01', generadoEn: '2026-09-24T03:00:00.000Z',
};

test('DOC-01 placa DXF distingue revisión guardada/editorial sin cambiar la placa', () => {
	const proyecto = crearProyecto('Placa documental');
	proyecto.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	proyecto.datos = { revision: 'ED-B', fecha: '2026-09-01' };
	const sinContexto = dxfDePlaca(proyecto);
	const dxf = dxfDePlaca(proyecto, confirmado);
	assert.match(dxf, /999\nProject ID repo-placa-7 \| Revision repositorio 12\n/);
	assert.match(dxf, /999\nGenerado 2026-09-24T03:00:00\.000Z \| Build ID build-DOC-01\n/);
	assert.match(dxf, /Revision editorial ED-B \| Fecha editorial 2026-09-01/);
	assert.match(dxf, /Alcance: placa de montaje/);
	assert.match(dxf, /ruta fisica pendiente/);
	for (const tipo of ['LINE', 'CIRCLE']) {
		const contar = (s: string) => [...s.matchAll(new RegExp(`^0\\n${tipo}$`, 'gm'))].length;
		assert.equal(contar(dxf), contar(sinContexto), `${tipo} no cambia por metadatos`);
	}
	assert.equal((dxf.match(/^0\nEOF$/gm) ?? []).length, 1);
});

test('DOC-01 placa DXF efímera y texto hostil no inyectan grupos R12', () => {
	const proyecto = crearProyecto('Placa\n0\nEOF');
	proyecto.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	const dxf = dxfDePlaca(proyecto, {
		estado: 'efimero', motivo: 'ejemplo', buildId: 'DEV-1', generadoEn: '2026-09-24T03:00:00Z',
	});
	assert.match(dxf, /Ejemplo efimero/);
	assert.match(dxf, /Project ID No asignado \| Revision repositorio No asignada/);
	assert.equal((dxf.match(/^0\nEOF$/gm) ?? []).length, 1);
	const lineas = dxf.trimEnd().split('\n');
	assert.equal(lineas.length % 2, 0);
	for (let i = 0; i < lineas.length; i += 2) assert.match(lineas[i], /^\d+$/);
});
