import assert from 'node:assert/strict';
import test from 'node:test';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto, RefBorne } from '../src/modelo/tipos.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

// La propuesta es pura; el módulo de UI comparte importación con diálogos que observan el DOM.
Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [] },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { proponerConductorPendiente } = await import('../app/ui-esquema.js');

const de: RefBorne = { dispositivoId: 'xp', borneId: 'X1' };
const a: RefBorne = { dispositivoId: 'xm', borneId: 'Y1' };

function proyectoDosHojas(): Proyecto {
	const p = crearProyecto('Conexión eléctrica pendiente');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	];
	p.dispositivos = [
		{ id: 'xp', tipo: 'bornero', bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'xm', tipo: 'bornero', bornes: [{ id: 'Y1' }] },
	];
	p.esquema = { representaciones: [
		{ id: 'xp-vista', dispositivoId: 'xp', hojaId: 'potencia',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'xm-vista', dispositivoId: 'xm', hojaId: 'mando',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

const montar = (p: Proyecto) => montarEsquema(p, calcularPotenciales(p));

test('M2 propone un único conductor eléctrico entre hojas sin atributos físicos implícitos', () => {
	const p = proyectoDosHojas();
	const antes = JSON.stringify(p);
	const plan = proponerConductorPendiente(p, montar(p), de, a);
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.deepEqual(plan.valor, { de, a, estadoRutaFisica: 'pendiente' });
	assert.equal(JSON.stringify(p), antes, 'previsualizar no crea conductor ni entrada de undo');
	p.conductores.push({ id: 'c-pendiente', ...plan.valor });
	const hojas = montar(p);
	assert.equal(hojas.flatMap((h) => h.hilos).filter((h) => h.conductorId === 'c-pendiente').length, 0);
	assert.deepEqual(hojas.map((h) => h.referencias.filter((r) => r.conductorId === 'c-pendiente'
		&& r.tipo === 'enlace').length), [1, 1]);
	const cargado = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(cargado.diagnosticos, []);
	// El cargador asigna `undefined` a opcionales; el JSON persistido sigue sin datos físicos.
	assert.deepEqual(JSON.parse(JSON.stringify(cargado.proyecto.conductores.find((c) => c.id === 'c-pendiente'))),
		{ id: 'c-pendiente', de, a, estadoRutaFisica: 'pendiente' });
});

test('legacy, vista vacía, borne borrado o anclaje ambiguo no crean una conexión', () => {
	const p = proyectoDosHojas();
	p.esquema = undefined;
	assert.equal(proponerConductorPendiente(p, montar(p), de, a).ok, false);
	p.esquema = { representaciones: [] };
	assert.equal(proponerConductorPendiente(p, montar(p), de, a).ok, false);
	const sinBorne = proyectoDosHojas();
	sinBorne.dispositivos[1].bornes = [];
	assert.equal(proponerConductorPendiente(sinBorne, montar(sinBorne), de, a).ok, false);
	const ambiguo = proyectoDosHojas();
	ambiguo.esquema!.representaciones!.push({ id: 'xp-duplicada', dispositivoId: 'xp', hojaId: 'mando',
		posicion: { columna: 5, fila: 3 }, parte: { tipo: 'completa' } });
	const antes = JSON.stringify(ambiguo);
	const plan = proponerConductorPendiente(ambiguo, montar(ambiguo), de, a);
	assert.equal(plan.ok, false);
	if (!plan.ok) assert.match(plan.motivo, /única|ambig/i);
	assert.equal(JSON.stringify(ambiguo), antes);
});

test('un borne consigo mismo y duplicados en ambos sentidos no mutan el proyecto', () => {
	const p = proyectoDosHojas();
	assert.equal(proponerConductorPendiente(p, montar(p), de, de).ok, false);
	p.conductores.push({ id: 'c-existente', de, a });
	const antes = JSON.stringify(p);
	assert.equal(proponerConductorPendiente(p, montar(p), de, a).ok, false);
	assert.equal(proponerConductorPendiente(p, montar(p), a, de).ok, false);
	assert.equal(JSON.stringify(p), antes);
});
