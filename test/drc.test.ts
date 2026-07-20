/**
 * Tests del motor DRC (detección de errores eléctricos).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { Hallazgo, verificarProyecto } from '../src/motores/drc.js';

function verificar(p: Proyecto): Hallazgo[] {
	return verificarProyecto(p, calcularPotenciales(p));
}

const reglas = (hs: Hallazgo[]) => hs.map((h) => h.regla);

test('R1: designaciones duplicadas', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'rele', designacion: '-K1', bornes: [] },
		{ id: 'b', tipo: 'rele', designacion: '-K1', bornes: [] },
	];
	assert.ok(reglas(verificar(p)).includes('R1-designacion-duplicada'));
});

test('R2: borne obligatorio sin conectar y dispositivo aislado', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', bornes: [{ id: '+24', tipo: 'control', obligatorio: true }] },
	];
	const r = reglas(verificar(p));
	assert.ok(r.includes('R2-borne-sin-conectar'));
	assert.ok(r.includes('R2-dispositivo-aislado'));
});

test('R3: cortocircuito L-N a través de un puente equivocado', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{
			id: 'x1', tipo: 'bornero',
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'N' }],
			puentes: [['1', '2']], // ¡puente entre fase y neutro!
		},
	];
	const errores = verificar(p).filter((h) => h.regla === 'R3-cortocircuito');
	assert.equal(errores.length, 1);
	assert.equal(errores[0].severidad, 'error');
});

test('R4: esclavo que apunta a un maestro inexistente', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'c', tipo: 'contactor', rol: { tipo: 'esclavo', maestroId: 'nope', contacto: 'NA' }, bornes: [] },
	];
	assert.ok(reglas(verificar(p)).includes('R4-esclavo-sin-maestro'));
});

test('R5: más conductores de los que admite el borne', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'rele', bornes: [{ id: 'A1', maxConductores: 2 }] },
		{ id: 'b', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }, { id: '3' }] },
	];
	p.conductores = ['1', '2', '3'].map((b, i) => ({
		id: `c${i}`,
		de: { dispositivoId: 'a', borneId: 'A1' },
		a: { dispositivoId: 'b', borneId: b },
		seccion: 1,
	}));
	const errores = verificar(p).filter((h) => h.regla === 'R5-exceso-conductores');
	assert.equal(errores.length, 1);
	assert.match(errores[0].mensaje, /3 conductores/);
});

test('R6: dispositivos con tensiones distintas en el mismo potencial', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', tensionNominal: 24, bornes: [{ id: '+', tipo: 'control' }] },
		{ id: 'b', tipo: 'piloto', tensionNominal: 220, bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'a', borneId: '+' }, a: { dispositivoId: 'b', borneId: '1' }, seccion: 1 },
	];
	assert.ok(reglas(verificar(p)).includes('R6-conflicto-tension'));
});

test('un circuito sano no produce errores', () => {
	const p = crearProyecto('t');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'h' }];
	p.dispositivos = [
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', hojaId: 'h1', posicion: { x: 0, y: 0 },
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{
			id: 'p1', tipo: 'piloto', designacion: '-P1', hojaId: 'h1', posicion: { x: 1, y: 0 },
			bornes: [{ id: '1', tipo: 'L' }],
		},
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'p1', borneId: '1' }, seccion: 1.5 },
	];
	const errores = verificar(p).filter((h) => h.severidad === 'error');
	// q1:2 queda libre pero no es obligatorio → sin errores (solo avisos).
	assert.deepEqual(errores, []);
});
