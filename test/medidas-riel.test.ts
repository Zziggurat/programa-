import assert from 'node:assert/strict';
import test from 'node:test';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Colocacion } from '../src/modelo/tipos.js';
import { planMedidasRiel } from '../src/motores/medidas-riel.js';

const proyecto = () => EJEMPLOS.find((e) => e.id === 'arranque-directo')!.crear();

test('edición numérica del riel propone exactamente el mismo delta para todos sus aparatos', () => {
	const p = proyecto(), g = p.gabinete!;
	const antes = JSON.stringify(p);
	const r = g.rieles.find((x) => x.id === 'r1')!;
	const plan = planMedidasRiel(g, p.dispositivos, r.id,
		{ x: r.x + 5, y: r.y + 20, largo: r.largo });
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(plan.valor.cambio, true);
	assert.equal(plan.valor.aparatos.length, 4);
	for (const a of plan.valor.aparatos) {
		const origen = g.colocaciones.find((c) => c.dispositivoId === a.dispositivoId)!;
		assert.equal(a.x - origen.x, 5);
		assert.equal(a.y - origen.y, 20);
	}
	assert.equal(JSON.stringify(p), antes, 'planificar no muta Proyecto ni crea un Undo');
	const invertido = structuredClone(p);
	invertido.dispositivos.reverse();
	invertido.gabinete!.colocaciones.reverse();
	assert.deepEqual(planMedidasRiel(invertido.gabinete!, invertido.dispositivos, r.id,
		{ x: r.x + 5, y: r.y + 20, largo: r.largo }), plan);
});

test('acortar el riel no deja el último clip fuera; mover sobre otros aparatos se rechaza', () => {
	const p = proyecto(), g = p.gabinete!;
	const r = g.rieles.find((x) => x.id === 'r1')!;
	const acortar = planMedidasRiel(g, p.dispositivos, r.id,
		{ x: r.x, y: r.y, largo: 190 });
	assert.equal(acortar.ok, false);
	assert.match(!acortar.ok ? acortar.motivo : '', /largo útil/);
	const choque = planMedidasRiel(g, p.dispositivos, r.id,
		{ x: r.x, y: r.y + 195, largo: r.largo });
	assert.equal(choque.ok, false);
	assert.match(!choque.ok ? choque.motivo : '', /holgura/);
});

test('fuera de placa, NaN, riel ambiguo y no-op no crean una posición falsa', () => {
	const p = proyecto(), g = p.gabinete!;
	const r = g.rieles[0];
	for (const medidas of [
		{ x: Number.NaN, y: r.y, largo: r.largo },
		{ x: -1, y: r.y, largo: r.largo },
		{ x: r.x, y: r.y, largo: 59 },
		{ x: g.ancho, y: r.y, largo: r.largo },
	]) assert.equal(planMedidasRiel(g, p.dispositivos, r.id, medidas).ok, false);
	assert.equal(planMedidasRiel(g, p.dispositivos, 'no-existe', r).ok, false);
	const duplicado = structuredClone(g);
	duplicado.rieles.push({ ...r });
	assert.equal(planMedidasRiel(duplicado, p.dispositivos, r.id, r).ok, false);
	const noop = planMedidasRiel(g, p.dispositivos, r.id, r);
	assert.equal(noop.ok, true);
	if (noop.ok) assert.equal(noop.valor.cambio, false);
});

test('aplicar la propuesta conserva rielId y posiciones al guardar/cargar', () => {
	const p = proyecto(), g = p.gabinete!;
	const plan = planMedidasRiel(g, p.dispositivos, 'r1', { x: 35, y: 100, largo: 335 });
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	Object.assign(g.rieles.find((r) => r.id === plan.valor.rielId)!, plan.valor.medidas);
	for (const a of plan.valor.aparatos)
		Object.assign(g.colocaciones.find((c) => c.dispositivoId === a.dispositivoId)!,
			{ x: a.x, y: a.y });
	const leido = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(leido.gabinete?.rieles.find((r) => r.id === 'r1'),
		{ ...g.rieles.find((r) => r.id === 'r1'), orientacion: 'h' },
		'el cargador normaliza la orientación horizontal implícita sin cambiar las medidas');
	for (const a of plan.valor.aparatos) {
		const col: Colocacion | undefined = leido.gabinete?.colocaciones.find((c) => c.dispositivoId === a.dispositivoId);
		assert.deepEqual({ x: col?.x, y: col?.y, rielId: col?.rielId },
			{ x: a.x, y: a.y, rielId: 'r1' });
	}
});

test('un riel vertical conserva el eje de anclaje y valida su largo útil', () => {
	const p = proyecto(), g = p.gabinete!;
	const r = g.rieles.find((x) => x.id === 'r1')!;
	const col = g.colocaciones.find((c) => c.rielId === r.id)!;
	g.rieles = [r];
	g.colocaciones = [col];
	Object.assign(r, { orientacion: 'v' as const, x: 100, y: 100, largo: 300 });
	Object.assign(col, { x: 100, y: 100 });
	const plan = planMedidasRiel(g, p.dispositivos, r.id,
		{ x: 105, y: 115, largo: 260 });
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.deepEqual(plan.valor.aparatos, [{ dispositivoId: col.dispositivoId, x: 105, y: 115 }]);
	assert.equal(planMedidasRiel(g, p.dispositivos, r.id,
		{ x: 105, y: 115, largo: 60 }).ok, false);
});
