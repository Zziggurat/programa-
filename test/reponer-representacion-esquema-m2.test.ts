import assert from 'node:assert/strict';
import test from 'node:test';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { planReponerRepresentacion } from '../src/motores/crear-representaciones-esquema.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function fixture() {
	const p = crearProyecto('Reponer vista sin crear aparato');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Potencia', columnas: 8 },
		{ id: 'mando', numero: 2, titulo: 'Mando', columnas: 6 },
	];
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor' as const, bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'x1', tipo: 'bornero' as const, bornes: [{ id: '1' }] },
		{ id: 'foto', tipo: 'otro' as const, imagen: 'data:image/png;base64,AA==', bornes: [] },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'q1', borneId: '2' },
		a: { dispositivoId: 'x1', borneId: '1' }, estadoRutaFisica: 'pendiente' as const }];
	p.esquema = { representaciones: [{ id: 'vista-m2-1', dispositivoId: 'q1', hojaId: 'potencia',
		posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' as const } }] };
	return p;
}

test('reponer vista reutiliza aparato/borne/conexión y persiste al recargar', () => {
	const p = fixture();
	const antes = JSON.stringify(p);
	const plan = planReponerRepresentacion(p, 'x1', { hojaId: 'mando', columna: 3, fila: 4 });
	assert.equal(plan.ok, true);
	assert.equal(JSON.stringify(p), antes, 'la propuesta no muta el circuito ni el dibujo');
	if (!plan.ok) return;
	assert.deepEqual(plan.valor, { id: 'vista-m2-2', dispositivoId: 'x1', hojaId: 'mando',
		posicion: { columna: 3, fila: 4 }, parte: { tipo: 'completa' } });
	p.esquema!.representaciones!.push(plan.valor);
	const hojas = montarEsquema(p, calcularPotenciales(p));
	assert.equal(hojas.find((h) => h.id === 'mando')?.simbolos[0]?.dispositivoId, 'x1');
	assert.ok(!hojas.flatMap((h) => h.problemas ?? []).some((x) =>
		x.codigo === 'aparato-sin-representacion' && x.dispositivoId === 'x1'));
	assert.ok(!hojas.flatMap((h) => h.problemas ?? []).some((x) =>
		x.codigo === 'conexion-sin-ancla' && x.conductorId === 'w1'));
	assert.deepEqual(p.conductores.map((c) => c.id), ['w1']);
	const abierto = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(abierto.esquema?.representaciones, p.esquema?.representaciones);
	assert.equal(JSON.stringify(abierto.conductores), JSON.stringify(p.conductores));
});

test('reponer vista es determinista y rechaza duplicación, colisión, hoja ambigua y foto inerte', () => {
	const a = fixture();
	const destino = { hojaId: 'mando', columna: 3, fila: 4 };
	const plan = planReponerRepresentacion(a, 'x1', destino);
	a.dispositivos.reverse(); a.hojas.reverse();
	assert.deepEqual(planReponerRepresentacion(a, 'x1', destino), plan);
	assert.equal(planReponerRepresentacion(a, 'q1', destino).ok, false);
	assert.equal(planReponerRepresentacion(a, 'foto', destino).ok, false);
	assert.equal(planReponerRepresentacion(a, 'x1', { ...destino, hojaId: 'inexistente' }).ok, false);
	assert.equal(planReponerRepresentacion(a, 'x1', { ...destino, columna: 7 }).ok, false);
	assert.equal(planReponerRepresentacion(a, 'x1', { ...destino, fila: 9 }).ok, false);
	a.esquema!.representaciones!.push({ id: 'ocupada', dispositivoId: 'foto', hojaId: 'mando',
		posicion: { columna: 3, fila: 4 }, parte: { tipo: 'completa' } });
	assert.equal(planReponerRepresentacion(a, 'x1', destino).ok, false);
	a.hojas.push({ id: 'mando', numero: 3, titulo: 'Mando duplicado' });
	assert.equal(planReponerRepresentacion(a, 'x1', { ...destino, columna: 4 }).ok, false);
});
