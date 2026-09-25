import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { planCopiarAparatoConVista } from '../src/motores/copiar-representacion-esquema.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

function fixture(): Proyecto {
	const p = crearProyecto('Copia M2');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }, { id: 'h2', numero: 2, titulo: 'Auxiliar' }];
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'ps', x: 30, y: 40, ancho: 35, alto: 30 },
		{ dispositivoId: 'x1', x: 90, y: 40, ancho: 35, alto: 30 },
	] };
	p.dispositivos = [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'ps', borneId: '+24' },
		a: { dispositivoId: 'x1', borneId: '1' } }];
	p.esquema = { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'h1',
			posicion: { columna: 3, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'h1',
			posicion: { columna: 7, fila: 5 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

const ids = { dispositivoId: 'ps-copia', vistaId: 'ps-copia-vista' };
const destino = { hojaId: 'h1', columna: 4, fila: 3 };

test('ESQ-05: pegar una vista completa propone un aparato nuevo sin copiar la conexión', () => {
	const p = fixture();
	const antes = JSON.stringify(p);
	const plan = planCopiarAparatoConVista(p, 'ps-vista', destino, ids);
	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(JSON.stringify(p), antes, 'la propuesta no muta el documento');
	assert.equal(plan.origenDispositivoId, 'ps');
	assert.deepEqual(plan.nuevaVista, { id: 'ps-copia-vista', dispositivoId: 'ps-copia',
		hojaId: 'h1', posicion: { columna: 4, fila: 3 }, parte: { tipo: 'completa' } });
	const copia = structuredClone(p.dispositivos[0]); copia.id = plan.nuevoDispositivoId;
	p.dispositivos.push(copia);
	p.esquema!.representaciones!.push(plan.nuevaVista);
	p.gabinete!.colocaciones.push({ dispositivoId: copia.id, x: 140, y: 40, ancho: 35, alto: 30 });
	assert.deepEqual(p.conductores.map((c) => c.id), ['c1']);
	assert.equal(p.conductores.some((c) => c.de.dispositivoId === copia.id || c.a.dispositivoId === copia.id), false);
	const hoja = montarEsquema(p, calcularPotenciales(p)).find((h) => h.id === 'h1');
	assert.equal(hoja?.simbolos.find((s) => s.representacionId === plan.nuevaVista.id)?.pines.size, 2);
	const reabierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(reabierto.diagnosticos, []);
	assert.equal(reabierto.proyecto.esquema?.representaciones?.length, 3);
	assert.equal(JSON.stringify(reabierto.proyecto.conductores), JSON.stringify(p.conductores),
		'el codec puede añadir propiedades opcionales undefined, pero no cambia la conexión persistente');
});

test('ESQ-05: duplicar solo la vista del mismo aparato sería ambiguo y se rechaza al leer', () => {
	const p = fixture();
	p.esquema!.representaciones!.push({ ...p.esquema!.representaciones![0], id: 'duplicada',
		posicion: { columna: 4, fila: 3 } });
	const leido = cargarProyecto(JSON.stringify(p));
	assert.ok(leido.diagnosticos.some((d) => /borne estaba dibujado en varias vistas/.test(d.motivo)));
	assert.equal(leido.proyecto.esquema?.representaciones?.some((r) => r.dispositivoId === 'ps'), false);
});

test('ESQ-05: destino, caja, IDs, ejemplo y origen parcial se validan antes de mutar', () => {
	const p = fixture();
	const probar = (documento: Proyecto, origen = 'ps-vista', lugar = destino,
		identidades = ids) => planCopiarAparatoConVista(documento, origen, lugar, identidades);
	assert.equal(probar(p).ok, true);
	assert.equal(probar(p, 'ps-vista', { ...destino, columna: 3, fila: 3 }).ok, false);
	assert.equal(probar(p, 'ps-vista', { ...destino, columna: 0 }).ok, false);
	assert.equal(probar(p, 'ps-vista', { ...destino, columna: 7, fila: 5 }).ok, false);
	assert.equal(probar(p, 'ps-vista', destino, { ...ids, dispositivoId: 'ps' }).ok, false);
	assert.equal(probar({ ...p, esEjemplo: true }).ok, false);
	const parcial = fixture();
	parcial.esquema!.representaciones![0] = { ...parcial.esquema!.representaciones![0], parte: { tipo: 'bobina' } };
	assert.equal(probar(parcial).ok, false);
	const sinColocacion = fixture(); sinColocacion.gabinete!.colocaciones.shift();
	assert.equal(probar(sinColocacion).ok, false);
	const puerta = fixture(); puerta.gabinete!.colocaciones[0].montaje = 'puerta';
	assert.match((probar(puerta) as { motivo: string }).motivo, /puerta/);
});

test('ESQ-05: invertir arrays no cambia la propuesta ni su ubicación', () => {
	const p = fixture();
	const invertido = fixture();
	invertido.hojas.reverse(); invertido.dispositivos.reverse();
	invertido.gabinete!.colocaciones.reverse(); invertido.esquema!.representaciones!.reverse();
	assert.deepEqual(planCopiarAparatoConVista(p, 'ps-vista', destino, ids),
		planCopiarAparatoConVista(invertido, 'ps-vista', destino, ids));
});
