import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import {
	aplicarMovimientoRepresentacion, previsualizarMovimientoRepresentacion,
} from '../src/motores/mover-representacion-esquema.js';

function proyectoM2(): Proyecto {
	const p = crearProyecto('Mover vista M2');
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Potencia', columnas: 6 },
		{ id: 'mando', numero: 2, titulo: 'Mando', columnas: 4 },
	];
	p.dispositivos = [
		{ id: 'q1', tipo: 'seccionador', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'km1', tipo: 'contactor', bornes: [{ id: 'A1' }, { id: 'A2' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'q1', borneId: '2' },
		a: { dispositivoId: 'km1', borneId: 'A1' } }];
	p.esquema = { representaciones: [
		{ id: 'vista-q1', dispositivoId: 'q1', hojaId: 'potencia',
			posicion: { columna: 2, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'vista-km1', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 1, fila: 3 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

test('previsualiza puro y aplica una vez en otra hoja preservando identidad y grafo', () => {
	const p = proyectoM2();
	const antes = JSON.stringify(p);
	const lista = p.esquema!.representaciones!;
	const otraVista = lista[1];
	const grafo = { dispositivos: p.dispositivos, conductores: p.conductores };
	const plan = previsualizarMovimientoRepresentacion(p, 'vista-q1',
		{ hojaId: 'mando', columna: 4, fila: 8 });
	assert.equal(plan.ok, true, !plan.ok ? plan.motivo : undefined);
	if (!plan.ok) return;
	assert.equal(plan.noOp, false);
	assert.deepEqual(plan.origen, { hojaId: 'potencia', columna: 2, fila: 3 });
	assert.deepEqual(plan.destino, { hojaId: 'mando', columna: 4, fila: 8 });
	assert.equal(JSON.stringify(p), antes);
	aplicarMovimientoRepresentacion(p, plan);
	assert.notEqual(p.esquema!.representaciones, lista);
	assert.equal(p.esquema!.representaciones![1], otraVista);
	assert.deepEqual(p.esquema!.representaciones![0], {
		id: 'vista-q1', dispositivoId: 'q1', hojaId: 'mando',
		posicion: { columna: 4, fila: 8 }, parte: { tipo: 'completa' },
	});
	assert.deepEqual(lista[0].posicion, { columna: 2, fila: 3 });
	assert.equal(p.dispositivos, grafo.dispositivos);
	assert.equal(p.conductores, grafo.conductores);
	assert.deepEqual(JSON.parse(JSON.stringify(p)).conductores, JSON.parse(antes).conductores);
	assert.throws(() => aplicarMovimientoRepresentacion(p, plan), /cambió/);
});

test('la misma casilla es no-op aun al confirmar', () => {
	const p = proyectoM2();
	const lista = p.esquema!.representaciones!;
	const antes = JSON.stringify(p);
	const plan = previsualizarMovimientoRepresentacion(p, 'vista-q1',
		{ hojaId: 'potencia', columna: 2, fila: 3 });
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(plan.noOp, true);
	aplicarMovimientoRepresentacion(p, plan);
	assert.equal(p.esquema!.representaciones, lista);
	assert.equal(JSON.stringify(p), antes);
});

test('rechaza hoja, vista o aparato ambiguos y casillas ocupadas/fuera de rejilla', () => {
	const p = proyectoM2();
	const previo = JSON.stringify(p);
	const destino = { hojaId: 'mando', columna: 2, fila: 3 };
	assert.equal(previsualizarMovimientoRepresentacion(p, 'perdida', destino).ok, false);
	assert.equal(previsualizarMovimientoRepresentacion(p, 'vista-q1',
		{ ...destino, hojaId: 'ausente' }).ok, false);
	for (const posicion of [
		{ hojaId: 'mando', columna: 1, fila: 3 },
		{ hojaId: 'mando', columna: 5, fila: 3 },
		{ hojaId: 'mando', columna: 0, fila: 3 },
		{ hojaId: 'mando', columna: 2, fila: 9 },
		{ hojaId: 'mando', columna: 2.5, fila: 3 },
	]) assert.equal(previsualizarMovimientoRepresentacion(p, 'vista-q1', posicion).ok, false);
	assert.equal(JSON.stringify(p), previo);
	p.esquema!.representaciones!.push({ ...p.esquema!.representaciones![0] });
	assert.equal(previsualizarMovimientoRepresentacion(p, 'vista-q1', destino).ok, false);
	p.esquema!.representaciones!.pop();
	p.hojas.push({ ...p.hojas[1] });
	assert.equal(previsualizarMovimientoRepresentacion(p, 'vista-q1', destino).ok, false);
	p.hojas.pop();
	p.dispositivos.push({ ...p.dispositivos[0] });
	assert.equal(previsualizarMovimientoRepresentacion(p, 'vista-q1', destino).ok, false);
	p.dispositivos.pop();
	p.esEjemplo = true;
	assert.equal(previsualizarMovimientoRepresentacion(p, 'vista-q1', destino).ok, false);
});

test('plan obsoleto o fabricado no cambia el proyecto', () => {
	for (const cambiar of [
		(p: Proyecto) => { p.hojas[1].columnas = 5; },
		(p: Proyecto) => { p.esquema!.representaciones!.push({
			id: 'intrusa', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 4, fila: 8 }, parte: { tipo: 'completa' },
		}); },
		(p: Proyecto) => { p.esquema!.representaciones!.reverse(); },
	]) {
		const p = proyectoM2();
		const plan = previsualizarMovimientoRepresentacion(p, 'vista-q1',
			{ hojaId: 'mando', columna: 4, fila: 8 });
		assert.equal(plan.ok, true);
		if (!plan.ok) continue;
		cambiar(p);
		const antes = JSON.stringify(p);
		assert.throws(() => aplicarMovimientoRepresentacion(p, plan), /cambió/);
		assert.equal(JSON.stringify(p), antes);
	}
	const p = proyectoM2();
	const plan = previsualizarMovimientoRepresentacion(p, 'vista-q1',
		{ hojaId: 'mando', columna: 4, fila: 8 });
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.throws(() => aplicarMovimientoRepresentacion(proyectoM2(), plan), /cambió/);
	assert.throws(() => aplicarMovimientoRepresentacion(p, { ...plan }), /cambió/);
});
