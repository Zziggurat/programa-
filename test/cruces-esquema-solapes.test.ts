import assert from 'node:assert/strict';
import test from 'node:test';

import { dxfDeEsquema } from '../app/exportaciones.js';
import { hojaASvg } from '../app/esquema-svg.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { nudosPorBorne, solapesColinealesSinResolver, tramosSeleccionablesDeHilo,
	tramosVisiblesDeHilo } from '../src/motores/cruces-esquema.js';
import type { HiloEsq, HojaEsq } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { simular } from '../src/motores/simulacion.js';

const hilo = (conductorId: string, x1: number, x2: number): HiloEsq => ({
	conductorId, nodos: [{ x: x1, y: 50 }, { x: x2, y: 50 }],
});
const hoja = (...hilos: HiloEsq[]): HojaEsq => ({
	id: 'h', numero: 1, titulo: 'Solape aislado', anchoMm: 420, altoMm: 297,
	columnas: 10, simbolos: [], referencias: [], hilos,
});

test('solape parcial: detecta tramo real estable y conserva tinta; agarre solo en zonas inequívocas', () => {
	const a = hilo('a', 10, 90), b = hilo('b', 30, 70);
	const plano = hoja(a, b);
	const antes = JSON.stringify(plano);
	const solapes = solapesColinealesSinResolver(plano);
	assert.deepEqual(solapes, [{ primero: { conductorId: 'a', segmento: 0 },
		segundo: { conductorId: 'b', segmento: 0 },
		inicio: { x: 30, y: 50 }, fin: { x: 70, y: 50 }, longitudMm: 40, tipo: 'PARCIAL' }]);
	assert.deepEqual(solapesColinealesSinResolver(hoja(b, a)), solapes,
		'invertir el array no cambia diagnóstico ni prioridad');
	assert.deepEqual(tramosVisiblesDeHilo(a, []), [{ a: a.nodos[0], b: a.nodos[1], segmento: 0 }],
		'la tinta no se falsea con una separación inventada');
	assert.deepEqual(tramosSeleccionablesDeHilo(a, [], solapes)
		.map((t) => [t.a.x, t.b.x].map((x) => Math.round(x * 10) / 10)), [[10, 27.7], [72.3, 90]]);
	assert.deepEqual(tramosSeleccionablesDeHilo(b, [], solapes), [],
		'el conductor totalmente oculto por otro no gana por orden DOM');
	assert.equal(JSON.stringify(plano), antes, 'diagnosticar no muta la hoja');
	const svg = hojaASvg(plano, { interactivo: true });
	assert.match(svg, /SOLAPE SIN RESOLVER/);
	assert.match(svg, /<g data-conductor="b" class="hilo" tabindex="0" role="button"/,
		'el hilo ambiguo sigue disponible por teclado');
	assert.match(svg, /class="hilo-agarre" d=""/,
		'no queda un target de mouse que escoja por el orden SVG');
	assert.match(svg, /d="M10 50 L90 50"[^>]*pointer-events="none"/,
		'la tinta visible no captura clics sobre el tramo ambiguo');
});

test('solape total: ambos hilos pierden únicamente el hit-target ambiguo y el plano advierte', () => {
	const a = hilo('a', 10, 90), b = hilo('b', 10, 90);
	const plano = hoja(a, b);
	const solapes = solapesColinealesSinResolver(plano);
	assert.equal(solapes.length, 1);
	assert.equal(solapes[0].tipo, 'TOTAL');
	assert.equal(solapes[0].longitudMm, 80);
	assert.deepEqual(tramosSeleccionablesDeHilo(a, [], solapes), []);
	assert.deepEqual(tramosSeleccionablesDeHilo(b, [], solapes), []);
	const svg = hojaASvg(plano, { interactivo: true });
	assert.equal((svg.match(/class="hilo-agarre" d=""/g) ?? []).length, 2);
	assert.match(svg, /class="aviso-solape"/);
	assert.match(svg, /a\/b/);
	const dxf = dxfDeEsquema(plano);
	assert.match(dxf, /0\nTEXT\n8\nTEXTO\n/);
	assert.match(dxf, /SOLAPE SIN RESOLVER a\/b/);
	assert.doesNotMatch(dxf, /0\nCIRCLE\n8\nCABLES\n/,
		'ni siquiera el DXF convierte el solape en un nudo');
	assert.equal((dxf.match(/0\nLINE\n8\nCABLES\n/g) ?? []).length, 2,
		'el DXF conserva ambos tramos eléctricos sin desplazarlos');
});

test('un borne eléctrico compartido conserva el nudo real pero no legitima 60 mm de solape gráfico', () => {
	const borne = { dispositivoId: 'X1', borneId: '1' };
	const a: HiloEsq = { ...hilo('a', 10, 90), bornes: { de: borne,
		a: { dispositivoId: 'Y1', borneId: '1' } } };
	const b: HiloEsq = { ...hilo('b', 10, 70), bornes: { de: borne,
		a: { dispositivoId: 'Y2', borneId: '1' } } };
	const plano = hoja(a, b);
	assert.deepEqual(nudosPorBorne(plano).map((n) => n.borne), [borne]);
	assert.deepEqual(solapesColinealesSinResolver(plano).map((s) => [s.longitudMm, s.tipo]),
		[[60, 'PARCIAL']], 'la unión real en el borne no resuelve una superposición larga');
	assert.match(hojaASvg(plano), /SOLAPE SIN RESOLVER/);
});

test('una salida común de 3 mm desde el mismo borne real no se denuncia como corredor fusionado', () => {
	const borne = { dispositivoId: 'X1', borneId: '1' };
	const a: HiloEsq = { conductorId: 'a', nodos: [{ x: 10, y: 10 }, { x: 10, y: 7 },
		{ x: 30, y: 7 }], bornes: { de: borne, a: { dispositivoId: 'Y1', borneId: '1' } } };
	const b: HiloEsq = { conductorId: 'b', nodos: [{ x: 10, y: 10 }, { x: 10, y: 7 },
		{ x: 20, y: 7 }], bornes: { de: borne, a: { dispositivoId: 'Y2', borneId: '1' } } };
	const solapes = solapesColinealesSinResolver(hoja(a, b));
	assert.equal(solapes.some((s) => s.longitudMm <= 3), false);
	assert.equal(solapes.some((s) => s.longitudMm > 3), true,
		'la salida común no justifica compartir después otros 10 mm de tinta');
});

test('detectar un solape eléctrico aislado no une potenciales ni modifica el proyecto físico', () => {
	const proyecto = crearProyecto('Solape sin unión');
	proyecto.dispositivos = [
		{ id: 'red', tipo: 'otro', clase: 'W', campo: true, tensionNominal: 220,
			bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }] },
		{ id: 'destino', tipo: 'piloto', bornes: [{ id: 'X1', tipo: 'control' }, { id: 'X2', tipo: 'control' }] },
		{ id: 'libre-a', tipo: 'bornero', bornes: [{ id: 'X1', tipo: 'control' }] },
		{ id: 'libre-b', tipo: 'bornero', bornes: [{ id: 'X1', tipo: 'control' }] },
	];
	proyecto.conductores = [
		{ id: 'alimentado', de: { dispositivoId: 'red', borneId: 'L' },
			a: { dispositivoId: 'destino', borneId: 'X1' } },
		{ id: 'aislado', de: { dispositivoId: 'libre-a', borneId: 'X1' },
			a: { dispositivoId: 'libre-b', borneId: 'X1' } },
	];
	const antes = JSON.stringify(proyecto);
	assert.equal(solapesColinealesSinResolver(hoja(hilo('alimentado', 10, 90),
		hilo('aislado', 30, 70))).length, 1);
	const potenciales = calcularPotenciales(proyecto);
	assert.notEqual(potenciales.porConductor.get('alimentado'), potenciales.porConductor.get('aislado'));
	const resultado = simular(proyecto);
	assert.equal(resultado.conductoresVivos.has('alimentado'), true);
	assert.equal(resultado.conductoresVivos.has('aislado'), false);
	assert.equal(JSON.stringify(proyecto), antes);
});
