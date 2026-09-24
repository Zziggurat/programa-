import assert from 'node:assert/strict';
import test from 'node:test';
import { hojaASvg } from '../app/esquema-svg.js';
import { dxfDeEsquema } from '../app/exportaciones.js';
import type { HojaEsq } from '../src/motores/esquema.js';
import type { ProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

// La preparación pura del documento comparte módulo con el panel; sus imports observan DOM.
Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [] },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { prepararHojaDocumental } = await import('../app/ui-esquema.js');

const hoja: HojaEsq = {
	id: 'h1', numero: 2, titulo: 'Mando', anchoMm: 420, altoMm: 297, columnas: 10,
	simbolos: [{ dispositivoId: 'km', designacion: '-KM<&"\n0\nEOF',
		columna: 2, x: 80, y: 80, ancho: 12, alto: 16,
		trazos: [{ tipo: 'texto', p: { x: 80, y: 80 }, texto: 'A1\n0\nEOF' }],
		pines: new Map() }],
	hilos: [{ conductorId: 'c1', nodos: [{ x: 40, y: 70 }, { x: 40, y: 110 }] }],
	referencias: [],
};

const confirmada: ProcedenciaDocumento = {
	estado: 'confirmado', projectId: 'repo<&"\n0\nEOF', revisionRepositorio: 17,
	buildId: 'build-123', generadoEn: '2026-09-24T12:00:00.000Z',
};

test('SVG exportado distingue revisión de repositorio de revisión editorial y declara límites físicos', () => {
	const svg = hojaASvg(hoja, { proyecto: 'Tablero <peligroso>',
		datos: { revision: 'B-7', fecha: '2026-09-01' }, totalHojas: 3,
		procedencia: confirmada, rutasPendientes: 2 });
	assert.match(svg, /Project ID repo&lt;&amp;&quot; 0 EOF/);
	assert.match(svg, /Revisión repositorio 17/);
	assert.match(svg, /REV\. ED\.<\/text>/);
	assert.match(svg, />B-7<\/text>/);
	assert.match(svg, /FECHA ED\./);
	assert.match(svg, /Build ID build-123/);
	assert.match(svg, /Rutas físicas pendientes del proyecto: 2/);
	assert.match(svg, /Una ruta pendiente no define trayecto, longitud ni material/);
	assert.doesNotMatch(svg, /<peligroso>|<script|onload=/);
	assert.doesNotMatch(svg, /tabindex="0"|class="hilo-agarre"/);
	assert.match(svg, /<path d="M40 70 L40 110"/, 'conserva trazo vectorial');
});

test('SVG efímero no inventa Project ID ni revisión confirmada', () => {
	const svg = hojaASvg(hoja, { procedencia: {
		estado: 'efimero', motivo: 'ejemplo', buildId: 'DEV-1', generadoEn: '2026-09-24T12:00:00Z',
	}, rutasPendientes: 0 });
	assert.match(svg, /Ejemplo efímero/);
	assert.match(svg, /Project ID No asignado/);
	assert.match(svg, /Revisión repositorio No asignada/);
	assert.match(svg, /Rutas físicas pendientes del proyecto: 0/);
});

test('SVG elimina controles XML hostiles de la procedencia sin interpretar etiquetas', () => {
	const svg = hojaASvg(hoja, { procedencia: { ...confirmada,
		projectId: 'id\u0001<script>alert(1)</script>' }, rutasPendientes: 0 });
	assert.doesNotMatch(svg, /\u0001|<script>|<\/script>/);
	assert.match(svg, /Project ID id&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('DXF R12 conserva entidades eléctricas, añade grupo 999 y texto de identidad sin inyección', () => {
	const base = dxfDeEsquema(hoja);
	const dxf = dxfDeEsquema(hoja, { proyecto: 'Tablero\n0\nEOF',
		datos: { revision: 'ED-4\n0\nLINE', fecha: '2026-09-01' }, totalHojas: 3,
		procedencia: confirmada, rutasPendientes: 2 });
	const pares = (archivo: string): [number, string][] => {
		const lineas = archivo.trimEnd().split('\n');
		assert.equal(lineas.length % 2, 0, 'cada grupo DXF conserva código/valor');
		const p: [number, string][] = [];
		for (let i = 0; i < lineas.length; i += 2) {
			assert.match(lineas[i], /^\d+$/);
			p.push([Number(lineas[i]), lineas[i + 1]]);
		}
		return p;
	};
	const original = pares(base);
	const emitido = pares(dxf);
	assert.equal(emitido.filter(([c, v]) => c === 0 && v === 'EOF').length, 1);
	assert.equal(emitido.filter(([c, v]) => c === 0 && v === 'LINE').length,
		original.filter(([c, v]) => c === 0 && v === 'LINE').length);
	assert.equal(emitido.filter(([c, v]) => c === 0 && v === 'CIRCLE').length,
		original.filter(([c, v]) => c === 0 && v === 'CIRCLE').length);
	assert.equal(emitido.filter(([c]) => c === 999).length, 6);
	assert.match(dxf, /999\nRevision confirmada \| Project ID repo<&" 0 EOF \| Revision repositorio 17\n/);
	assert.match(dxf, /1\nGenerado 2026-09-24T12:00:00\.000Z \| Build ID build-123\n/);
	assert.match(dxf, /999\nRevision editorial ED-4 0 LINE \| Fecha editorial 2026-09-01\n/);
	assert.match(dxf, /999\nRutas fisicas pendientes del proyecto: 2\. Sin trayecto, longitud ni material\./);
	assert.ok(!/[^\x00-\x7F]/.test(dxf), 'R12 conserva ASCII');
	assert.doesNotMatch(dxf, /\n0\nLINE\n0\nEOF\n/, 'texto hostil no genera entidades');
});

test('hoja descargable se monta desde copia consistente después del guardado confirmado', async () => {
	const p = crearProyecto('Antes');
	p.dispositivos.push({ id: 'x', tipo: 'bornero', bornes: [{ id: 'A' }] });
	const documento = await prepararHojaDocumental({ proyecto: () => p, nombreArchivo: () => 'Antes',
		obtenerProcedencia: async () => confirmada }, 0);
	assert.notEqual(documento.copia, p, 'no publica el modelo vivo');
	assert.equal(documento.copia.nombre, 'Antes');
	assert.equal(documento.hoja.numero, 1);
	assert.equal(documento.procedencia, confirmada);
	assert.equal(documento.rutasPendientes, 0);
});

test('hoja descargable rehúsa cambios durante flush, incluso otro proyecto de idénticos bytes', async () => {
	const inicial = crearProyecto('Antes');
	inicial.dispositivos.push({ id: 'x', tipo: 'bornero', bornes: [{ id: 'A' }] });
	let vivo = inicial;
	await assert.rejects(prepararHojaDocumental({ proyecto: () => vivo, nombreArchivo: () => 'Antes',
		obtenerProcedencia: async () => { vivo = structuredClone(inicial); return confirmada; } }, 0),
		/El proyecto cambió/);
	vivo = inicial;
	await assert.rejects(prepararHojaDocumental({ proyecto: () => vivo, nombreArchivo: () => 'Antes',
		obtenerProcedencia: async () => { vivo.nombre = 'Después'; return confirmada; } }, 0),
		/El proyecto cambió/);
});
