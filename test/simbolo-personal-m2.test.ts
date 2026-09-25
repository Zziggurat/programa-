import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { instanciarComponentePersonalizado, actualizarDefinicionComponente,
	crearPaqueteProyecto, leerPaqueteProyecto, validarDefinicionComponente,
	type DefinicionComponentePersonalizado } from '../src/componentes/personalizados.js';
import { crearComponentePortatil, leerComponentePortatil } from '../src/componentes/portatil.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { leerSimboloEsquemaPersonal, type SimboloEsquemaPersonal } from '../src/modelo/simbolo-personal.js';
import { montarEsquema, simboloDe } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { hojaASvg } from '../app/esquema-svg.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { esquemaComoBlob } = await import('../app/esquema-pdf.js');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7xQAAAAASUVORK5CYII=', 'base64');
const assetId = `sha256:${createHash('sha256').update(png).digest('hex')}`;
const simbolo = (): SimboloEsquemaPersonal => ({ version: 1, forma: 'rombo', rotulo: 'R1',
	segmentos: [{ x1: -0.7, y1: 0, x2: 0.7, y2: 0 }],
	autorDeclarado: 'Taller local', licenciaDeclarada: 'Uso privado declarado' });
const definicion = (): DefinicionComponentePersonalizado => ({
	formato: 'tablero-studio-componente', version: 1, id: 'cmp-r1', revision: 1,
	nombre: 'Resistencia ilustrada', creadoEn: '2026-09-25T00:00:00.000Z',
	modificadoEn: '2026-09-25T00:00:00.000Z', tipoDispositivo: 'resistencia',
	dimensiones: { anchoMm: 35, altoMm: 45, fondoMm: 30 }, assetId,
	terminales: [{ id: 'L', tipo: 'L', u: .5, v: .1 }, { id: 'N', tipo: 'N', u: .5, v: .9 }],
	comportamiento: { version: 1, clase: 'carga',
		alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 }, efecto: 'calor' },
	simboloEsquema: simbolo(),
});

test('ESQ-06: dibujo personal cambia trazos, no identidad ni función eléctrica', () => {
	const d = definicion();
	assert.deepEqual(validarDefinicionComponente(d), []);
	const instancia = instanciarComponentePersonalizado(d, 'r1');
	assert.deepEqual(instancia.simboloEsquemaPersonal, d.simboloEsquema);
	assert.notEqual(instancia.simboloEsquemaPersonal, d.simboloEsquema);
	const geometria = simboloDe(instancia);
	assert.equal(geometria.plantilla.familia, 'personal');
	assert.equal(geometria.plantilla.origen, 'declaracion-usuario');
	assert.equal(geometria.plantilla.autorDeclarado, 'Taller local');
	assert.equal(geometria.plantilla.licenciaDeclarada, 'Uso privado declarado');
	assert.equal(geometria.plantilla.licenciaVerificada, false);
	assert.equal(geometria.plantilla.conformidadNormativa, 'NO_VERIFICADA');
	assert.deepEqual([...geometria.pines.keys()], ['L', 'N']);
	assert.ok(geometria.trazos.some((trazo) => trazo.tipo === 'texto' && trazo.texto === 'R1'));
	const legacy = { ...instancia, simboloEsquemaPersonal: undefined };
	assert.equal(simboloDe(legacy).plantilla.familia, 'generico');
	assert.deepEqual(instancia.comportamiento, legacy.comportamiento);
});

test('ESQ-06: revisión de símbolo se fotografía; proyecto y plano SVG/PDF conservan procedencia', async () => {
	const d = definicion();
	const anterior = instanciarComponentePersonalizado(d, 'r1');
	const nueva = actualizarDefinicionComponente(d, { simboloEsquema: { ...simbolo(), forma: 'circulo' } });
	const posterior = instanciarComponentePersonalizado(nueva, 'r2');
	assert.equal(anterior.simboloEsquemaPersonal?.forma, 'rombo');
	assert.equal(posterior.simboloEsquemaPersonal?.forma, 'circulo');
	const p = crearProyecto('Símbolos personales');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }];
	p.gabinete = { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [anterior, posterior];
	p.esquema = { representaciones: [
		{ id: 'v1', dispositivoId: 'r1', hojaId: 'h1', posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'v2', dispositivoId: 'r2', hojaId: 'h1', posicion: { columna: 5, fila: 2 }, parte: { tipo: 'completa' } },
	] };
	const carga = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(carga.diagnosticos, []);
	assert.deepEqual(carga.proyecto.dispositivos.map((x) => x.simboloEsquemaPersonal?.forma), ['rombo', 'circulo']);
	const hoja = montarEsquema(carga.proyecto, calcularPotenciales(carga.proyecto))[0];
	assert.deepEqual(hoja.simbolos.map((s) => s.plantilla?.familia), ['personal', 'personal']);
	const svg = hojaASvg(hoja);
	assert.match(svg, /data-familia-simbolo="personal"/);
	assert.match(svg, /data-autor-declarado="Taller local"/);
	assert.match(svg, /data-licencia-verificada="no"/);
	const pdf = Buffer.from(await esquemaComoBlob([hoja], p.nombre).arrayBuffer()).toString('latin1');
	assert.match(pdf, /Procedencia declarada de s.mbolos personales/);
	assert.match(pdf, /Autor\/origen declarado: Taller local/);
	assert.match(pdf, /Licencia declarada: Uso privado declarado/);
	assert.match(pdf, /NO VERIFICADOS/);
	assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2);
});

test('ESQ-06: importación rechaza markup, coordenadas, claves y procedencia inválidas', () => {
	for (const valor of [
		{ ...simbolo(), svg: '<script>alert(1)</script>' },
		{ ...simbolo(), segmentos: [{ x1: -1.1, y1: 0, x2: 1, y2: 0 }] },
		{ ...simbolo(), segmentos: [{ x1: 0, y1: 0, x2: 0, y2: 0 }] },
		{ ...simbolo(), autorDeclarado: '' },
		{ ...simbolo(), licenciaDeclarada: 'GPL\n<script>' },
		{ ...simbolo(), segmentos: Array.from({ length: 33 }, () => simbolo().segmentos[0]) },
	]) assert.equal(leerSimboloEsquemaPersonal(valor), undefined);
	const p = crearProyecto('Hostil');
	p.gabinete = { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [instanciarComponentePersonalizado(definicion(), 'r1')];
	(p.dispositivos[0] as unknown as Record<string, unknown>).simboloEsquemaPersonal =
		{ ...simbolo(), svg: '<script>alert(1)</script>' };
	const carga = cargarProyecto(JSON.stringify(p));
	assert.equal(carga.proyecto.dispositivos[0].simboloEsquemaPersonal, undefined);
	assert.ok(carga.diagnosticos.some((x) => x.ruta === 'dispositivos[r1].simboloEsquemaPersonal'));
	assert.equal(simboloDe(carga.proyecto.dispositivos[0]).plantilla.familia, 'generico');
});

test('ESQ-06: paquetes V5 y .tscomp V4 preservan símbolo; versiones viejas rechazan degradación', async () => {
	const d = definicion();
	const p = crearProyecto('Paquete símbolo');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }];
	p.gabinete = { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [instanciarComponentePersonalizado(d, 'r1')];
	const assets = [{ id: assetId, mime: 'image/png' as const, base64: png.toString('base64') }];
	assert.throws(() => crearPaqueteProyecto(p, assets, [d], 4), /V5/);
	const paquete = crearPaqueteProyecto(p, assets, [d], 5);
	assert.equal(paquete.version, 5);
	assert.deepEqual(leerPaqueteProyecto(JSON.stringify(paquete)).proyecto.dispositivos[0].simboloEsquemaPersonal, simbolo());
	const archivo = await crearComponentePortatil(d, { id: assetId, mime: 'image/png', bytes: png });
	assert.equal(archivo.version, 4);
	assert.deepEqual((await leerComponentePortatil(JSON.stringify(archivo))).definicion.simboloEsquema, simbolo());
	const anterior = structuredClone(archivo); anterior.version = 3;
	await assert.rejects(leerComponentePortatil(JSON.stringify(anterior)), /V4/);
	const hostil = structuredClone(archivo);
	(hostil.definicion.simboloEsquema as unknown as Record<string, unknown>).href = 'file:///privado';
	await assert.rejects(leerComponentePortatil(JSON.stringify(hostil)), /símbolo personal/i);
});
