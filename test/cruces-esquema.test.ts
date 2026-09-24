import assert from 'node:assert/strict';
import test from 'node:test';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { crucesSinUnion, nudosPorBorne, tramosVisiblesDeHilo } from '../src/motores/cruces-esquema.js';
import { montarEsquema, type HiloEsq } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { simular } from '../src/motores/simulacion.js';
import { hojaASvg } from '../app/esquema-svg.js';

const hilo = (conductorId: string, ...nodos: HiloEsq['nodos']): HiloEsq => ({ conductorId, nodos });

test('dos hilos que se cruzan en sus interiores producen un cruce gráfico, no un nudo', () => {
	const horizontal = hilo('c-a', { x: 10, y: 50 }, { x: 90, y: 50 });
	const vertical = hilo('c-b', { x: 50, y: 10 }, { x: 50, y: 90 });
	const esperado = [{ punto: { x: 50, y: 50 },
		porEncima: { conductorId: 'c-a', segmento: 0 },
		porDebajo: { conductorId: 'c-b', segmento: 0 } }];
	assert.deepEqual(crucesSinUnion({ hilos: [horizontal, vertical] }), esperado);
	assert.deepEqual(crucesSinUnion({ hilos: [vertical, horizontal] }), esperado,
		'el orden de creación no decide la prioridad de dibujo');
	assert.deepEqual(horizontal.nodos, [{ x: 10, y: 50 }, { x: 90, y: 50 }],
		'el análisis no altera la ruta del hilo');
});

test('no confunde tramos disjuntos, paralelos, solape o autorcruce con un cruce puntual', () => {
	const base = hilo('c-a', { x: 10, y: 50 }, { x: 90, y: 50 });
	for (const otro of [
		hilo('c-b', { x: 91, y: 10 }, { x: 91, y: 90 }),
		hilo('c-b', { x: 30, y: 55 }, { x: 70, y: 55 }),
		hilo('c-b', { x: 30, y: 50 }, { x: 70, y: 50 }),
		hilo('c-b', { x: NaN, y: 0 }, { x: 50, y: 90 }),
	]) {
		assert.deepEqual(crucesSinUnion({ hilos: [base, otro] }), []);
	}
	assert.deepEqual(crucesSinUnion({ hilos: [hilo('c-a',
		{ x: 10, y: 50 }, { x: 90, y: 50 }, { x: 50, y: 10 }, { x: 50, y: 90 })] }), [],
		'una polilínea puede cruzarse consigo misma sin crear un segundo conductor');
});

test('una T de bornes distintos corta el trazo continuo y conserva el extremo aislado en SVG y agarre', () => {
	const continuo: HiloEsq = { ...hilo('z-continuo', { x: 10, y: 50 }, { x: 90, y: 50 }),
		bornes: { de: { dispositivoId: 'red', borneId: 'L' },
			a: { dispositivoId: 'carga', borneId: 'L' } } };
	const rama: HiloEsq = { ...hilo('a-rama', { x: 50, y: 50 }, { x: 50, y: 90 }),
		bornes: { de: { dispositivoId: 'aislado', borneId: 'X1' },
			a: { dispositivoId: 'destino', borneId: 'X1' } } };
	const hoja = { id: 'h', numero: 1, titulo: 'T aislada', anchoMm: 420, altoMm: 297,
		columnas: 10, simbolos: [], referencias: [], hilos: [continuo, rama] };
	const esperado = [{ punto: { x: 50, y: 50 },
		porEncima: { conductorId: 'a-rama', segmento: 0 },
		porDebajo: { conductorId: 'z-continuo', segmento: 0 } }];
	assert.deepEqual(crucesSinUnion(hoja), esperado,
		'el tramo continuo pierde tinta aunque su ID tenga prioridad anterior');
	assert.deepEqual(crucesSinUnion({ hilos: [...hoja.hilos].reverse() }), esperado);
	assert.deepEqual(tramosVisiblesDeHilo(continuo, esperado).map((t) => [t.a.x, t.b.x]),
		[[10, 49], [51, 90]]);
	assert.deepEqual(nudosPorBorne(hoja), []);
	const svg = hojaASvg(hoja, { interactivo: true });
	const grupo = svg.match(/<g data-conductor="z-continuo" class="hilo"[^>]*>(.*?)<\/g>/)?.[1];
	assert.ok(grupo);
	assert.equal((grupo.match(/d="M10 50 L49 50 M51 50 L90 50"/g) ?? []).length, 2,
		'la tinta y el hit-target dejan el mismo hueco alrededor del extremo');
	assert.doesNotMatch(svg, /<circle cx="50" cy="50" r="0\.9"/);
});

test('una T en vértice ajeno deja un único hueco continuo, sin depender del orden de nodos', () => {
	const continuo = hilo('z', { x: 10, y: 50 }, { x: 90, y: 50 });
	const quebrado = hilo('a', { x: 50, y: 10 }, { x: 50, y: 50 }, { x: 50, y: 90 });
	const cruces = crucesSinUnion({ hilos: [continuo, quebrado] });
	assert.deepEqual(tramosVisiblesDeHilo(continuo, cruces).map((t) => [t.a.x, t.b.x]),
		[[10, 49], [51, 90]]);
	assert.deepEqual(crucesSinUnion({ hilos: [quebrado, continuo] }), cruces);
});

test('varios cruces conservan resultado y prioridad al invertir el array de hilos', () => {
	const hilos = [
		hilo('z', { x: 30, y: 10 }, { x: 30, y: 90 }),
		hilo('b', { x: 10, y: 60 }, { x: 90, y: 60 }),
		hilo('a', { x: 10, y: 40 }, { x: 90, y: 40 }),
	];
	const a = crucesSinUnion({ hilos });
	assert.equal(a.length, 2);
	assert.deepEqual(a, crucesSinUnion({ hilos: [...hilos].reverse() }));
	assert.deepEqual(a.map((c) => [c.porEncima.conductorId, c.porDebajo.conductorId, c.punto.y]),
		[['a', 'z', 40], ['b', 'z', 60]]);
});

test('el mismo hueco de 2 mm sirve al trazo SVG y al agarre interactivo', () => {
	const horizontal = hilo('a', { x: 10, y: 50 }, { x: 90, y: 50 });
	const vertical = hilo('b', { x: 50, y: 10 }, { x: 50, y: 90 });
	const hoja = { id: 'h', numero: 1, titulo: 'Cruce', anchoMm: 420, altoMm: 297,
		columnas: 10, simbolos: [], referencias: [], hilos: [horizontal, vertical] };
	const cruces = crucesSinUnion(hoja);
	assert.deepEqual(tramosVisiblesDeHilo(vertical, cruces).map((t) => [t.a.y, t.b.y]),
		[[10, 49], [51, 90]]);
	const svg = hojaASvg(hoja, { interactivo: true });
	const grupo = svg.match(/<g data-conductor="b" class="hilo"[^>]*>(.*?)<\/g>/)?.[1];
	assert.ok(grupo);
	assert.equal((grupo.match(/d="M50 10 L50 49 M50 51 L50 90"/g) ?? []).length, 2,
		'la tinta y el hit-target comparten exactamente los mismos subtramos');
	assert.doesNotMatch(svg, /<circle cx="50" cy="50" r="0\.9"/,
		'el cruce no gana nudo por coincidir en la hoja');
	const exportado = hojaASvg(hoja);
	assert.match(exportado, /d="M50 10 L50 49 M50 51 L50 90"/);
	assert.doesNotMatch(exportado, /hilo-agarre|tabindex="0"/);
});

test('el nudo solo aparece con dos hilos del mismo borne real, nunca por XY', () => {
	const común = { dispositivoId: 'xp', borneId: 'X1' };
	const primero = { ...hilo('c1', { x: 50, y: 50 }, { x: 90, y: 50 }),
		bornes: { de: común, a: { dispositivoId: 'a', borneId: 'X1' } } };
	const segundo = { ...hilo('c2', { x: 50, y: 50 }, { x: 50, y: 90 }),
		bornes: { de: común, a: { dispositivoId: 'b', borneId: 'X1' } } };
	assert.deepEqual(nudosPorBorne({ hilos: [primero, segundo] }), [{
		punto: { x: 50, y: 50 }, borne: común, conductores: ['c1', 'c2'],
	}]);
	const distinto = { ...segundo,
		bornes: { ...segundo.bornes, de: { dispositivoId: 'otro', borneId: 'X1' } } };
	assert.deepEqual(nudosPorBorne({ hilos: [primero, distinto] }), [],
		'dos aparatos dibujados sobre el mismo píxel no se conectan');
	const superpuesto = { ...hilo('c3', { x: 50, y: 50 }, { x: 15, y: 50 }),
		bornes: { de: { dispositivoId: 'otro', borneId: 'X1' }, a: { dispositivoId: 'c', borneId: 'X1' } } };
	assert.equal(nudosPorBorne({ hilos: [primero, segundo, superpuesto] }).length, 1,
		'el nudo real sigue siendo visible; el extremo ajeno debe recortarse');
});

test('un extremo de borne ajeno se aparta de un nudo real sin borrar su punto', () => {
	const común = { dispositivoId: 'xp', borneId: 'X1' };
	const hilos: HiloEsq[] = [
		{ ...hilo('rama-1', { x: 50, y: 50 }, { x: 70, y: 30 }),
			bornes: { de: común, a: { dispositivoId: 'a', borneId: 'X1' } } },
		{ ...hilo('rama-2', { x: 50, y: 50 }, { x: 70, y: 70 }),
			bornes: { de: común, a: { dispositivoId: 'b', borneId: 'X1' } } },
		{ ...hilo('ajeno', { x: 20, y: 50 }, { x: 50, y: 50 }),
			bornes: { de: { dispositivoId: 'z', borneId: 'X1' },
				a: { dispositivoId: 'otro', borneId: 'X1' } } },
	];
	const hoja = { id: 'h', numero: 1, titulo: 'Nudo y extremo ajeno', anchoMm: 420, altoMm: 297,
		columnas: 10, simbolos: [], referencias: [], hilos };
	const nudos = nudosPorBorne(hoja);
	assert.equal(nudos.length, 1);
	const cruces = crucesSinUnion(hoja);
	assert.ok(cruces.length >= 1);
	assert.ok(cruces.every((c) => c.porDebajo.conductorId === 'ajeno'));
	assert.deepEqual(tramosVisiblesDeHilo(hilos[2], cruces, 1, nudos)
		.map((t) => [t.a.x, Math.round(t.b.x * 10) / 10]), [[20, 48.4]]);
	assert.deepEqual(crucesSinUnion({ hilos: [...hilos].reverse() }), cruces);
	const svg = hojaASvg(hoja, { interactivo: true });
	const grupo = svg.match(/<g data-conductor="ajeno" class="hilo"[^>]*>(.*?)<\/g>/)?.[1];
	assert.ok(grupo);
	assert.equal((grupo.match(/d="M20 50 L48\.4 50"/g) ?? []).length, 2);
	assert.match(svg, /<circle cx="50" cy="50" r="0\.9"/);
});

test('el extremo ajeno se aparta también si es colineal y no hay intersección puntual detectable', () => {
	const común = { dispositivoId: 'xp', borneId: 'X1' };
	const hilos: HiloEsq[] = [
		{ ...hilo('rama-1', { x: 50, y: 50 }, { x: 70, y: 50 }),
			bornes: { de: común, a: { dispositivoId: 'a', borneId: 'X1' } } },
		{ ...hilo('rama-2', { x: 50, y: 50 }, { x: 90, y: 50 }),
			bornes: { de: común, a: { dispositivoId: 'b', borneId: 'X1' } } },
		{ ...hilo('ajeno', { x: 20, y: 50 }, { x: 50, y: 50 }),
			bornes: { de: { dispositivoId: 'z', borneId: 'X1' },
				a: { dispositivoId: 'otro', borneId: 'X1' } } },
	];
	const hoja = { id: 'h', numero: 1, titulo: 'Nudo colineal', anchoMm: 420, altoMm: 297,
		columnas: 10, simbolos: [], referencias: [], hilos };
	const nudos = nudosPorBorne(hoja);
	assert.equal(nudos.length, 1);
	assert.deepEqual(crucesSinUnion(hoja), [], 'los solapes colineales aún no son cruces puntuales');
	assert.deepEqual(tramosVisiblesDeHilo(hilos[2], [], 1, nudos)
		.map((t) => [t.a.x, Math.round(t.b.x * 10) / 10]), [[20, 48.4]]);
	const svg = hojaASvg(hoja);
	assert.match(svg, /d="M20 50 L48\.4 50"/);
	assert.match(svg, /<circle cx="50" cy="50" r="0\.9"/);
});

test('dos grupos de bornes reales sobre el mismo punto no imprimen un nudo ambiguo', () => {
	const hilos: HiloEsq[] = [
		{ ...hilo('a1', { x: 50, y: 50 }, { x: 70, y: 30 }),
			bornes: { de: { dispositivoId: 'a', borneId: 'X1' }, a: { dispositivoId: 'x', borneId: 'X1' } } },
		{ ...hilo('a2', { x: 50, y: 50 }, { x: 70, y: 70 }),
			bornes: { de: { dispositivoId: 'a', borneId: 'X1' }, a: { dispositivoId: 'y', borneId: 'X1' } } },
		{ ...hilo('b1', { x: 50, y: 50 }, { x: 30, y: 30 }),
			bornes: { de: { dispositivoId: 'b', borneId: 'X1' }, a: { dispositivoId: 'z', borneId: 'X1' } } },
		{ ...hilo('b2', { x: 50, y: 50 }, { x: 30, y: 70 }),
			bornes: { de: { dispositivoId: 'b', borneId: 'X1' }, a: { dispositivoId: 'w', borneId: 'X1' } } },
	];
	assert.deepEqual(nudosPorBorne({ hilos }), []);
});

test('un conductor aislado que atraviesa un nudo real queda separado del punto, también en el agarre SVG', () => {
	const común = { dispositivoId: 'xp', borneId: 'X1' };
	const hilos: HiloEsq[] = [
		{ ...hilo('rama-1', { x: 50, y: 50 }, { x: 70, y: 30 }),
			bornes: { de: común, a: { dispositivoId: 'a', borneId: 'X1' } } },
		{ ...hilo('rama-2', { x: 50, y: 50 }, { x: 70, y: 70 }),
			bornes: { de: común, a: { dispositivoId: 'b', borneId: 'X1' } } },
		hilo('aislado', { x: 20, y: 50 }, { x: 80, y: 50 }),
	];
	const hoja = { id: 'h', numero: 1, titulo: 'Nudo superpuesto', anchoMm: 420, altoMm: 297,
		columnas: 10, simbolos: [], referencias: [], hilos };
	const nudos = nudosPorBorne(hoja);
	assert.equal(nudos.length, 1, 'el borne común sí exige punto de unión');
	assert.equal(crucesSinUnion(hoja).length, 2, 'el tramo continuo se aparta de ambos extremos del nudo');
	assert.deepEqual(tramosVisiblesDeHilo(hilos[2], crucesSinUnion(hoja), 1, nudos)
		.map((t) => [t.a.x, t.b.x].map((x) => Math.round(x * 100) / 100)),
		[[20, 48.4], [51.6, 80]], 'el conductor ajeno no puede parecer unido al punto negro');
	const svg = hojaASvg(hoja, { interactivo: true });
	const grupo = svg.match(/<g data-conductor="aislado" class="hilo"[^>]*>(.*?)<\/g>/)?.[1];
	assert.ok(grupo);
	assert.equal((grupo.match(/d="M20 50 L48\.4 50 M51\.6 50 L80 50"/g) ?? []).length, 2,
		'la tinta y la selección dejan el mismo hueco alrededor del nudo ajeno');
	assert.match(svg, /<circle cx="50" cy="50" r="0\.9"/,
		'las dos ramas del borne común sí conservan su unión');
});

test('el montaje legacy conserva los bornes reales de cada hilo sin cambiar el grafo', () => {
	const proyecto = crearProyecto('Nudo legítimo');
	proyecto.dispositivos = ['a', 'b', 'c'].map((id) => ({ id, tipo: 'bornero' as const,
		bornes: [{ id: 'X1' }] }));
	proyecto.conductores = [
		{ id: 'ab', de: { dispositivoId: 'a', borneId: 'X1' }, a: { dispositivoId: 'b', borneId: 'X1' } },
		{ id: 'ac', de: { dispositivoId: 'a', borneId: 'X1' }, a: { dispositivoId: 'c', borneId: 'X1' } },
	];
	const antes = JSON.stringify(proyecto);
	const hojas = montarEsquema(proyecto, calcularPotenciales(proyecto));
	const hilos = hojas.flatMap((hoja) => hoja.hilos);
	assert.equal(hilos.length, 2);
	assert.deepEqual(hilos.map((h) => h.bornes?.de), [proyecto.conductores[0].de, proyecto.conductores[1].de]);
	assert.deepEqual(hojas.flatMap(nudosPorBorne).map((nudo) => nudo.borne),
		[{ dispositivoId: 'a', borneId: 'X1' }]);
	assert.equal(JSON.stringify(proyecto), antes, 'la vista no añade puntos persistentes');
});

test('las representaciones M2 conservan un nudo real aunque el orden de conductores cambie', () => {
	const proyecto = crearProyecto('Nudo M2');
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Control' }];
	proyecto.dispositivos = ['a', 'b', 'c'].map((id) => ({ id, tipo: 'bornero' as const,
		bornes: [{ id: 'X1' }] }));
	proyecto.conductores = [
		{ id: 'ab', de: { dispositivoId: 'a', borneId: 'X1' }, a: { dispositivoId: 'b', borneId: 'X1' } },
		{ id: 'ac', de: { dispositivoId: 'a', borneId: 'X1' }, a: { dispositivoId: 'c', borneId: 'X1' } },
	];
	proyecto.esquema = { representaciones: ['a', 'b', 'c'].map((id, i) => ({
		id: `vista-${id}`, dispositivoId: id, hojaId: 'h1',
		posicion: { columna: i + 2, fila: 3 }, parte: { tipo: 'completa' as const },
	})) };
	const dibujar = () => {
		const hojas = montarEsquema(proyecto, calcularPotenciales(proyecto));
		assert.equal(hojas.length, 1);
		return nudosPorBorne(hojas[0]);
	};
	const nudos = dibujar();
	assert.equal(nudos.length, 1);
	assert.deepEqual(nudos[0].borne, { dispositivoId: 'a', borneId: 'X1' });
	proyecto.conductores.reverse();
	assert.deepEqual(dibujar(), nudos);
});

test('un cruce visual no energiza un conductor eléctricamente aislado', () => {
	const proyecto = crearProyecto('Cruce sin unión');
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
	const hoja = { hilos: [
		hilo('alimentado', { x: 10, y: 50 }, { x: 90, y: 50 }),
		hilo('aislado', { x: 50, y: 10 }, { x: 50, y: 90 }),
	] };
	assert.equal(crucesSinUnion(hoja).length, 1);
	const potenciales = calcularPotenciales(proyecto);
	assert.notEqual(potenciales.porConductor.get('alimentado'), potenciales.porConductor.get('aislado'));
	const resultado = simular(proyecto);
	assert.equal(resultado.conductoresVivos.has('alimentado'), true);
	assert.equal(resultado.conductoresVivos.has('aislado'), false,
		'compartir píxel en el esquema no conecta ni energiza el segundo conductor');
});
