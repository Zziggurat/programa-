import assert from 'node:assert/strict';
import { test } from 'node:test';

import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import {
	aplicarAlineacionRepresentaciones, previsualizarAlineacionRepresentaciones,
} from '../src/motores/alinear-representaciones-esquema.js';
import { planActivacionRepresentaciones } from '../src/motores/crear-representaciones-esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function proyectoM2(): Proyecto {
	const p = crearProyecto('Alinear vistas M2');
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Potencia', columnas: 8 },
		{ id: 'mando', numero: 2, titulo: 'Mando', columnas: 6 },
	];
	p.dispositivos = [
		{ id: 'a', tipo: 'seccionador', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'b', tipo: 'contactor', bornes: [{ id: 'A1' }, { id: 'A2' }] },
		{ id: 'c', tipo: 'piloto', bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'd', tipo: 'fusible', bornes: [{ id: '1' }, { id: '2' }] },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'a', borneId: '2' },
		a: { dispositivoId: 'b', borneId: 'A1' } }];
	p.esquema = { representaciones: [
		{ id: 'vista-a', dispositivoId: 'a', hojaId: 'potencia',
			posicion: { columna: 1, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'vista-b', dispositivoId: 'b', hojaId: 'potencia',
			posicion: { columna: 3, fila: 4 }, parte: { tipo: 'completa' } },
		{ id: 'vista-c', dispositivoId: 'c', hojaId: 'potencia',
			posicion: { columna: 5, fila: 6 }, parte: { tipo: 'completa' } },
		{ id: 'vista-d', dispositivoId: 'd', hojaId: 'potencia',
			posicion: { columna: 7, fila: 8 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

function posiciones(p: Proyecto): Record<string, string> {
	return Object.fromEntries((p.esquema?.representaciones ?? [])
		.map((r) => [r.id, `${r.hojaId}:${r.posicion.columna}:${r.posicion.fila}`]));
}

test('alineación por fila: propuesta pura, una sustitución y grafo intacto tras serialización', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	const lista = p.esquema!.representaciones!;
	const ajena = lista[3];
	const grafo = { aparatos: p.dispositivos, conductores: p.conductores };
	const plan = previsualizarAlineacionRepresentaciones(p,
		['vista-c', 'vista-a', 'vista-b'], 'vista-b', 'fila');
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.equal(plan.hojaId, 'potencia');
	assert.equal(plan.noOp, false);
	assert.deepEqual(plan.cambios.map((c) => c.vistaId), ['vista-a', 'vista-b', 'vista-c']);
	assert.deepEqual(plan.cambios.map((c) => c.despues.fila), [4, 4, 4]);
	assert.equal(JSON.stringify(p), antes);
	aplicarAlineacionRepresentaciones(p, plan);
	assert.notEqual(p.esquema!.representaciones, lista);
	assert.equal(p.esquema!.representaciones![3], ajena);
	assert.deepEqual(posiciones(p), {
		'vista-a': 'potencia:1:4', 'vista-b': 'potencia:3:4',
		'vista-c': 'potencia:5:4', 'vista-d': 'potencia:7:8',
	});
	assert.equal(p.dispositivos, grafo.aparatos);
	assert.equal(p.conductores, grafo.conductores);
	assert.deepEqual(posiciones(JSON.parse(JSON.stringify(p)) as Proyecto), posiciones(p));
	assert.throws(() => aplicarAlineacionRepresentaciones(p, plan), /cambió/);
});

test('mismo resultado al invertir las listas y el orden de IDs solicitados', () => {
	const a = proyectoM2();
	const b = proyectoM2();
	b.esquema!.representaciones!.reverse();
	b.dispositivos.reverse();
	b.hojas.reverse();
	const planA = previsualizarAlineacionRepresentaciones(a,
		['vista-a', 'vista-b', 'vista-c'], 'vista-b', 'columna');
	const planB = previsualizarAlineacionRepresentaciones(b,
		['vista-c', 'vista-b', 'vista-a'], 'vista-b', 'columna');
	assert.equal(planA.ok, true, !planA.ok ? planA.motivo : undefined);
	assert.equal(planB.ok, true, !planB.ok ? planB.motivo : undefined);
	if (!planA.ok || !planB.ok) return;
	assert.deepEqual(planA.cambios, planB.cambios);
	aplicarAlineacionRepresentaciones(a, planA);
	aplicarAlineacionRepresentaciones(b, planB);
	assert.deepEqual(posiciones(a), posiciones(b));
	assert.deepEqual(posiciones(a), {
		'vista-a': 'potencia:3:2', 'vista-b': 'potencia:3:4',
		'vista-c': 'potencia:3:6', 'vista-d': 'potencia:7:8',
	});
});

test('el resumen del plan ordena IDs por código, sin depender del locale del navegador', () => {
	const p = proyectoM2();
	p.esquema!.representaciones![0].id = 'vista-Z';
	p.esquema!.representaciones![1].id = 'vista-a';
	p.esquema!.representaciones![2].id = 'vista-b';
	const plan = previsualizarAlineacionRepresentaciones(p,
		['vista-b', 'vista-a', 'vista-Z'], 'vista-a', 'fila');
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.deepEqual(plan.cambios.map((c) => c.vistaId), ['vista-Z', 'vista-a', 'vista-b']);
});

test('sin cambio no reemplaza la lista ni crea diferencia persistente', () => {
	const p = proyectoM2();
	p.esquema!.representaciones![1].posicion.fila = 2;
	const lista = p.esquema!.representaciones!;
	const antes = JSON.stringify(p);
	const plan = previsualizarAlineacionRepresentaciones(p,
		['vista-b', 'vista-a'], 'vista-a', 'fila');
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.equal(plan.noOp, true);
	aplicarAlineacionRepresentaciones(p, plan);
	assert.equal(p.esquema!.representaciones, lista);
	assert.equal(JSON.stringify(p), antes);
});

test('rechaza destinos duplicados u ocupados sin aplicar una parte del grupo', () => {
	const duplicados = proyectoM2();
	duplicados.esquema!.representaciones![1].posicion.columna = 1;
	const previo = JSON.stringify(duplicados);
	const planD = previsualizarAlineacionRepresentaciones(duplicados,
		['vista-a', 'vista-b'], 'vista-a', 'fila');
	assert.equal(planD.ok, false);
	if (!planD.ok) assert.match(planD.motivo, /misma casilla/);
	assert.equal(JSON.stringify(duplicados), previo);

	const ocupados = proyectoM2();
	ocupados.esquema!.representaciones![3].posicion = { columna: 1, fila: 4 };
	const antes = JSON.stringify(ocupados);
	const planO = previsualizarAlineacionRepresentaciones(ocupados,
		['vista-a', 'vista-b'], 'vista-a', 'columna');
	assert.equal(planO.ok, false);
	if (!planO.ok) assert.match(planO.motivo, /ya tiene otra vista/);
	assert.equal(JSON.stringify(ocupados), antes);
});

test('la casilla distinta no autoriza un solape nuevo de bloques altos', () => {
	const p = proyectoM2();
	p.dispositivos[1] = { id: 'b', tipo: 'plc',
		bornes: Array.from({ length: 20 }, (_, i) => ({ id: `I${i}` })) };
	p.esquema!.representaciones![0].posicion = { columna: 1, fila: 4 };
	p.esquema!.representaciones![1].posicion = { columna: 3, fila: 5 };
	const previo = JSON.stringify(p);
	const plan = previsualizarAlineacionRepresentaciones(p,
		['vista-a', 'vista-b'], 'vista-a', 'columna');
	assert.equal(plan.ok, false);
	if (!plan.ok) assert.match(plan.motivo, /superpondría las cajas/);
	assert.equal(JSON.stringify(p), previo);
});

test('un plan obsoleto, ajeno o fabricado no altera el proyecto', () => {
	for (const cambiar of [
		(p: Proyecto) => { p.hojas[0].columnas = 9; },
		(p: Proyecto) => { p.esquema!.representaciones!.reverse(); },
		(p: Proyecto) => { p.conductores.push({ id: 'w2', de: { dispositivoId: 'c', borneId: 'X1' },
			a: { dispositivoId: 'd', borneId: '1' } }); },
	]) {
		const p = proyectoM2();
		const plan = previsualizarAlineacionRepresentaciones(p,
			['vista-a', 'vista-b'], 'vista-b', 'fila');
		assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
		if (!plan.ok) continue;
		cambiar(p);
		const antes = JSON.stringify(p);
		assert.throws(() => aplicarAlineacionRepresentaciones(p, plan), /cambió/);
		assert.equal(JSON.stringify(p), antes);
	}
	const p = proyectoM2();
	const plan = previsualizarAlineacionRepresentaciones(p,
		['vista-a', 'vista-b'], 'vista-b', 'fila');
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.throws(() => aplicarAlineacionRepresentaciones(proyectoM2(), plan), /cambió/);
	assert.throws(() => aplicarAlineacionRepresentaciones(p, { ...plan }), /cambió/);
});

test('valida selección, hoja, rejilla, lectura y existencia de aparatos', () => {
	const p = proyectoM2();
	const elegir = (ids: string[], ancla = 'vista-a') =>
		previsualizarAlineacionRepresentaciones(p, ids, ancla, 'fila');
	for (const ids of [[], ['vista-a'], ['vista-a', 'vista-a'], ['vista-a', 'perdida'],
		Array.from({ length: 65 }, (_, i) => `v${i}`)]) {
		assert.equal(elegir(ids).ok, false);
	}
	assert.equal(elegir(['vista-a', 'vista-b'], 'vista-c').ok, false);
	p.esquema!.representaciones![1].hojaId = 'mando';
	assert.equal(elegir(['vista-a', 'vista-b']).ok, false);
	p.esquema!.representaciones![1].hojaId = 'potencia';
	p.esquema!.representaciones![1].posicion.columna = 9;
	assert.equal(elegir(['vista-a', 'vista-b']).ok, false);
	p.esquema!.representaciones![1].posicion.columna = 3;
	p.dispositivos.splice(1, 1);
	assert.equal(elegir(['vista-a', 'vista-b']).ok, false);
	p.esEjemplo = true;
	assert.equal(elegir(['vista-a', 'vista-b']).ok, false);
	const malformado = proyectoM2();
	(malformado.esquema!.representaciones as unknown[]).push(null);
	assert.equal(previsualizarAlineacionRepresentaciones(malformado,
		['vista-a', 'vista-b'], 'vista-a', 'fila').ok, false);
});

test('arranque directo: Q1 y KM1 admiten alineación de columna sin caja nueva superpuesta', () => {
	const ejemplo = EJEMPLOS.find((x) => x.id === 'arranque-directo');
	assert.ok(ejemplo);
	const p = ejemplo.crear();
	p.esEjemplo = false;
	const activacion = planActivacionRepresentaciones(p, calcularPotenciales(p));
	assert.equal(activacion.ok, true, !activacion.ok ? activacion.motivo : undefined);
	if (!activacion.ok) return;
	p.hojas = activacion.valor.hojas;
	p.esquema = { ...p.esquema, representaciones: activacion.valor.representaciones };
	const q1 = p.esquema.representaciones!.find((r) => r.dispositivoId === 'q1');
	const km1 = p.esquema.representaciones!.find((r) => r.dispositivoId === 'km1');
	assert.ok(q1 && km1);
	const plan = previsualizarAlineacionRepresentaciones(p, [q1.id, km1.id], km1.id, 'columna');
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.equal(plan.noOp, false);
	const antes = p.conductores;
	aplicarAlineacionRepresentaciones(p, plan);
	assert.equal(p.conductores, antes);
	assert.equal(p.esquema.representaciones!.find((r) => r.id === q1.id)?.posicion.columna,
		p.esquema.representaciones!.find((r) => r.id === km1.id)?.posicion.columna);
});
