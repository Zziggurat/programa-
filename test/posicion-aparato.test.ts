import assert from 'node:assert/strict';
import test from 'node:test';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { planPosicionAparato } from '../src/motores/posicion-aparato.js';

const proyecto = () => EJEMPLOS.find((e) => e.id === 'arranque-directo')!.crear();

test('un aparato anclado avanza solo por su eje DIN y conserva identidad tras guardar/cargar', () => {
	const p = proyecto(), g = p.gabinete!;
	const col = g.colocaciones.find((c) => c.dispositivoId === 'q1')!;
	const plan = planPosicionAparato(g, p.dispositivos, col.dispositivoId,
		{ x: col.x + 5.5, y: col.y });
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(plan.valor.cambio, true);
	const invertido = structuredClone(p);
	invertido.dispositivos.reverse(); invertido.gabinete!.colocaciones.reverse();
	assert.deepEqual(planPosicionAparato(invertido.gabinete!, invertido.dispositivos,
		col.dispositivoId, { x: col.x + 5.5, y: col.y }), plan);
	Object.assign(col, { x: plan.valor.x, y: plan.valor.y });
	const leido = cargarProyecto(JSON.stringify(p)).proyecto;
	const persistida = leido.gabinete?.colocaciones.find((c) => c.dispositivoId === col.dispositivoId);
	assert.deepEqual({ x: persistida?.x, y: persistida?.y, rielId: persistida?.rielId },
		{ x: col.x, y: col.y, rielId: col.rielId });
	assert.equal(planPosicionAparato(g, p.dispositivos, col.dispositivoId,
		{ x: col.x, y: col.y }).ok, true);
});

test('no despega un aparato del riel, no crea choque ni permite salir de la placa', () => {
	const p = proyecto(), g = p.gabinete!;
	const col = g.colocaciones.find((c) => c.dispositivoId === 'q1')!;
	for (const [pos, motivo] of [
		[{ x: col.x, y: col.y + 10 }, /anclado/],
		[{ x: 100, y: col.y }, /holgura/],
		[{ x: 370, y: col.y }, /placa/],
		[{ x: -1, y: col.y }, /no negativos/],
		[{ x: Number.NaN, y: col.y }, /finitos/],
	] as const) {
		const plan = planPosicionAparato(g, p.dispositivos, col.dispositivoId, pos);
		assert.equal(plan.ok, false);
		if (!plan.ok) assert.match(plan.motivo, motivo);
	}
});

test('un riel vertical limita Y y no permite modificar el eje X', () => {
	const p = proyecto(), g = p.gabinete!;
	const r = g.rieles.find((item) => item.id === 'r1')!;
	const col = g.colocaciones.find((c) => c.dispositivoId === 'q1')!;
	g.rieles = [r]; g.colocaciones = [col];
	Object.assign(r, { orientacion: 'v' as const, x: 100, y: 100, largo: 250 });
	Object.assign(col, { x: 77.5, y: 120 });
	assert.equal(planPosicionAparato(g, p.dispositivos, col.dispositivoId,
		{ x: col.x, y: col.y + 20 }).ok, true);
	assert.equal(planPosicionAparato(g, p.dispositivos, col.dispositivoId,
		{ x: col.x + 1, y: col.y }).ok, false);
	assert.equal(planPosicionAparato(g, p.dispositivos, col.dispositivoId,
		{ x: col.x, y: 300 }).ok, false);
});

test('placa atornillada sin riel se mueve libremente y un clip DIN sin riel se rechaza', () => {
	const p = proyecto(), g = p.gabinete!;
	const d = p.dispositivos.find((item) => item.id === 'q1')!;
	const col = g.colocaciones.find((c) => c.dispositivoId === d.id)!;
	g.rieles = []; g.canaletas = []; g.colocaciones = [col];
	delete col.rielId;
	Object.assign(col, { x: 20, y: 20 });
	d.montajeComponente = { metodo: 'atornillado-placa', anclajes: [
		{ xMm: 5, yMm: 5 }, { xMm: 40, yMm: 80 },
	] };
	assert.equal(planPosicionAparato(g, p.dispositivos, d.id, { x: 60, y: 50 }).ok, true);
	d.montajeComponente = { metodo: 'riel-din' };
	assert.equal(planPosicionAparato(g, p.dispositivos, d.id, { x: 60, y: 50 }).ok, false);
	col.montaje = 'puerta';
	assert.match((() => {
		const r = planPosicionAparato(g, p.dispositivos, d.id, { x: 60, y: 50 });
		return r.ok ? '' : r.motivo;
	})(), /puerta/);
});
