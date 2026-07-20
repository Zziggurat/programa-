/**
 * Tests del modelo físico: ruteo por canaletas, sincronización y plan de borneros.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { sincronizarEsquemaGabinete } from '../src/motores/sincronizacion.js';
import { generarPlanBorneros } from '../src/motores/bornes.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores } from '../src/motores/numeracion.js';

/** Dos aparatos sobre una canaleta horizontal, unidos por una vertical. */
function proyectoFisico(): Proyecto {
	const p = crearProyecto('t', { reservaCable: 0, extraPorConexionMm: 0 });
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', bornes: [{ id: '1' }] },
		{ id: 'b', tipo: 'rele', bornes: [{ id: '1' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'a', borneId: '1' }, a: { dispositivoId: 'b', borneId: '1' }, seccion: 1.5 },
	];
	p.gabinete = {
		ancho: 400,
		alto: 400,
		rieles: [],
		canaletas: [
			{ id: 'h1', x: 0, y: 100, largo: 300, orientacion: 'h', ancho: 40, alto: 40 },
			{ id: 'v1', x: 300, y: 100, largo: 200, orientacion: 'v', ancho: 40, alto: 40 },
			{ id: 'h2', x: 0, y: 300, largo: 300, orientacion: 'h', ancho: 40, alto: 40 },
		],
		colocaciones: [
			// Centro (50,50): entrada en h1 en (50,100), bajada 50 mm.
			{ dispositivoId: 'a', x: 30, y: 30, ancho: 40, alto: 40 },
			// Centro (50,350): entrada en h2 en (50,300), bajada 50 mm.
			{ dispositivoId: 'b', x: 30, y: 330, ancho: 40, alto: 40 },
		],
	};
	return p;
}

test('ruteo: longitud exacta por el camino de canaletas', () => {
	const p = proyectoFisico();
	const r = rutearConductores(p);
	assert.equal(r.rutas.length, 1);
	const ruta = r.rutas[0];
	// 50 (bajada) + 250 (h1 hasta x=300) + 200 (v1) + 250 (h2 de vuelta) + 50 (subida) = 800
	assert.equal(ruta.longitudMm, 800);
	assert.deepEqual(ruta.canaletasUsadas.sort(), ['h1', 'h2', 'v1']);
});

test('ruteo: reserva y extra por conexión se suman a la longitud', () => {
	const p = proyectoFisico();
	p.opciones = { reservaCable: 0.1, extraPorConexionMm: 100 };
	const r = rutearConductores(p);
	// 800 × 1.1 + 2 × 100 = 1080
	assert.equal(r.rutas[0].longitudMm, 1080);
});

test('ruteo: avisa cuando un dispositivo no está colocado', () => {
	const p = proyectoFisico();
	p.gabinete!.colocaciones.pop();
	const r = rutearConductores(p);
	assert.equal(r.rutas.length, 0);
	assert.equal(r.avisos.length, 1);
	assert.match(r.avisos[0], /"b" no está colocado/);
});

test('sincronización: detecta faltantes, sobrantes y solapes', () => {
	const p = proyectoFisico();
	p.dispositivos.push({ id: 'nuevo', tipo: 'rele', designacion: '-K9', bornes: [] });
	p.gabinete!.colocaciones.push({ dispositivoId: 'fantasma', x: 0, y: 0, ancho: 10, alto: 10 });
	p.gabinete!.colocaciones.push({ dispositivoId: 'a2', x: 35, y: 35, ancho: 40, alto: 40 });
	p.dispositivos.push({ id: 'a2', tipo: 'rele', bornes: [] });

	const s = sincronizarEsquemaGabinete(p);
	assert.equal(s.sincronizado, false);
	assert.ok(s.faltanEnGabinete.includes('-K9'));
	assert.ok(s.sobranEnGabinete.includes('fantasma'));
	assert.ok(s.solapes.some(([x, y]) => (x === 'a' && y === 'a2') || (x === 'a2' && y === 'a')));
});

test('sincronización: un gabinete completo queda sincronizado', () => {
	const p = proyectoFisico();
	assert.equal(sincronizarEsquemaGabinete(p).sincronizado, true);
});

test('plan de bornero: lados interno/externo, puentes y número de conductor', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{
			id: 'x1', tipo: 'bornero', designacion: '-X1',
			bornes: [{ id: '1' }, { id: '2' }, { id: '3' }],
			puentes: [['1', '2']],
		},
		{ id: 'a1', tipo: 'plc', designacion: '-A1', bornes: [{ id: 'DO1' }] },
		{ id: 'm1', tipo: 'motor', designacion: '-M1', campo: true, bornes: [{ id: 'U' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'a1', borneId: 'DO1' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 1 },
		{ id: 'c2', de: { dispositivoId: 'x1', borneId: '2' }, a: { dispositivoId: 'm1', borneId: 'U' }, seccion: 1 },
	];
	const potenciales = calcularPotenciales(p);
	numerarConductores(p, potenciales);
	const [plan] = generarPlanBorneros(p, potenciales);

	assert.equal(plan.designacion, '-X1');
	const f1 = plan.filas.find((f) => f.borna === '1')!;
	const f2 = plan.filas.find((f) => f.borna === '2')!;
	const f3 = plan.filas.find((f) => f.borna === '3')!;
	assert.deepEqual(f1.internas, ['-A1:DO1']);
	assert.deepEqual(f1.puenteCon, ['2']);
	assert.deepEqual(f2.externas, ['-M1:U']);
	// c1 y c2 comparten potencial vía puente → mismo número en ambas filas.
	assert.equal(f1.numeroConductor, f2.numeroConductor);
	assert.ok(f3.avisos.includes('borna sin uso'));
});
