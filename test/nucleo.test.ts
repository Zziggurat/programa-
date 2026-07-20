/**
 * Tests de potenciales, numeración y referencias cruzadas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { aplicarPlantilla, numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { generarReferencias } from '../src/motores/referencias.js';

function proyectoMinimo(): Proyecto {
	const p = crearProyecto('test');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.dispositivos = [
		{
			id: 'q1', tipo: 'disyuntor', hojaId: 'h1', posicion: { x: 1, y: 0 },
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{
			id: 'k1', tipo: 'contactor', rol: { tipo: 'maestro' }, hojaId: 'h1', posicion: { x: 2, y: 1 },
			bornes: [{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' }],
		},
		{
			id: 'k1c', tipo: 'contactor', rol: { tipo: 'esclavo', maestroId: 'k1', contacto: 'NA' },
			hojaId: 'h1', posicion: { x: 4, y: 2 },
			bornes: [{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' }],
		},
		{
			id: 'x1', tipo: 'bornero',
			bornes: [{ id: '1', tipo: 'control' }, { id: '2', tipo: 'control' }, { id: '3', tipo: 'control' }],
			puentes: [['1', '2']],
		},
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'k1', borneId: 'A1' }, seccion: 1.5 },
		{ id: 'c2', de: { dispositivoId: 'k1', borneId: 'A1' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 1.5 },
		{ id: 'c3', de: { dispositivoId: 'x1', borneId: '3' }, a: { dispositivoId: 'k1c', borneId: '13' }, seccion: 1.5 },
	];
	return p;
}

test('potenciales: conductores y puentes de bornero unen bornes en un mismo potencial', () => {
	const p = proyectoMinimo();
	const r = calcularPotenciales(p);

	const pot = r.porBorne.get('q1::2')!;
	// q1:2 — k1:A1 — x1:1 — (puente) — x1:2 comparten potencial.
	assert.ok(pot.bornes.includes('k1::A1'));
	assert.ok(pot.bornes.includes('x1::1'));
	assert.ok(pot.bornes.includes('x1::2'));
	// x1:3 es otra borna sin puente: potencial distinto.
	assert.notEqual(r.porBorne.get('x1::3'), pot);
	// c1 y c2 pertenecen al mismo potencial.
	assert.equal(r.porConductor.get('c1'), r.porConductor.get('c2'));
	assert.notEqual(r.porConductor.get('c1'), r.porConductor.get('c3'));
});

test('numeración: plantilla IEC 81346 con bloques opcionales', () => {
	const plantilla = '[={funcion}][+{ubicacion}]-{clase}{n}';
	assert.equal(aplicarPlantilla(plantilla, { clase: 'K', n: 1 }), '-K1');
	assert.equal(
		aplicarPlantilla(plantilla, { funcion: 'ALIM', ubicacion: 'TAB1', clase: 'Q', n: 2 }),
		'=ALIM+TAB1-Q2',
	);
});

test('numeración: secuencias por clase y congelamiento', () => {
	const p = proyectoMinimo();
	// k1c es esclavo pero también clase K: comparte secuencia con k1.
	numerarDispositivos(p);
	const q1 = p.dispositivos.find((d) => d.id === 'q1')!;
	const k1 = p.dispositivos.find((d) => d.id === 'k1')!;
	const k1c = p.dispositivos.find((d) => d.id === 'k1c')!;
	const x1 = p.dispositivos.find((d) => d.id === 'x1')!;
	assert.equal(q1.designacion, '-Q1');
	assert.equal(k1.designacion, '-K1');
	assert.equal(k1c.designacion, '-K2');
	assert.equal(x1.designacion, '-X1');

	// Congelar k1 con un número alto y renumerar: la secuencia lo respeta y no lo pisa.
	k1.numero = 7;
	k1.designacion = '-K7';
	k1.congelado = true;
	numerarDispositivos(p);
	assert.equal(k1.designacion, '-K7');
	assert.equal(k1c.designacion, '-K8');
});

test('numeración de conductores: un número por potencial', () => {
	const p = proyectoMinimo();
	const r = calcularPotenciales(p);
	numerarConductores(p, r);
	const c1 = p.conductores.find((c) => c.id === 'c1')!;
	const c2 = p.conductores.find((c) => c.id === 'c2')!;
	const c3 = p.conductores.find((c) => c.id === 'c3')!;
	assert.ok(c1.numero);
	assert.equal(c1.numero, c2.numero); // mismo potencial → mismo número
	assert.notEqual(c1.numero, c3.numero);
});

test('referencias cruzadas: el maestro lista sus contactos con posición', () => {
	const p = proyectoMinimo();
	numerarDispositivos(p);
	const r = generarReferencias(p);
	const x = r.cruzadas.find((c) => c.maestroId === 'k1')!;
	assert.equal(x.designacion, '-K1');
	assert.equal(x.contactos.length, 1);
	assert.equal(x.contactos[0].contacto, 'NA');
	assert.equal(x.contactos[0].posicion, '1.C5'); // hoja 1, fila C (y=2), columna 5 (x=4)
	assert.equal(r.maestroDeEsclavo.get('k1c')?.designacion, '-K1');
});
