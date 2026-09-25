import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureFallosIndustriales } from '../ejemplo/fixtures-simulacion-v2.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { crearInformeIngenieriaV7 } from '../src/ingenieria/documentacion.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { generarInformeHTML } from '../src/motores/documentacion.js';
import { revisarTablero } from '../src/motores/revision.js';

function tableroMultivista(): Proyecto {
	const km1 = structuredClone(fixtureFallosIndustriales().dispositivos.find((d) => d.id === 'km1')!);
	const p = crearProyecto('Red documental multivista');
	p.hojas = [
		{ id: 'potencia', numero: 1, titulo: 'Fuerza' },
		{ id: 'mando', numero: 2, titulo: 'Maniobra' },
	];
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [
		km1,
		{ id: 'xp', tipo: 'bornero', bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'xm', tipo: 'bornero', bornes: [{ id: 'X1' }] },
	];
	p.conductores = [
		{ id: 'c-potencia', de: { dispositivoId: 'km1', borneId: '1/L1' }, a: { dispositivoId: 'xp', borneId: 'X1' } },
		{ id: 'c-mando', de: { dispositivoId: 'km1', borneId: 'A1' }, a: { dispositivoId: 'xm', borneId: 'X1' } },
		{ id: 'c-entre-hojas', de: { dispositivoId: 'km1', borneId: '13' }, a: { dispositivoId: 'xp', borneId: 'X2' } },
	];
	p.esquema = { representaciones: [
		{ id: 'km1-polos', dispositivoId: 'km1', hojaId: 'potencia', posicion: { columna: 4, fila: 3 },
			parte: { tipo: 'contactos', pares: [{ entrada: '1/L1', salida: '2/T1' }] } },
		{ id: 'km1-bobina', dispositivoId: 'km1', hojaId: 'mando', posicion: { columna: 3, fila: 5 },
			parte: { tipo: 'bobina' } },
		{ id: 'km1-aux', dispositivoId: 'km1', hojaId: 'mando', posicion: { columna: 6, fila: 3 },
			parte: { tipo: 'contactos', pares: [{ entrada: '13', salida: '14' }] } },
		{ id: 'xp-completo', dispositivoId: 'xp', hojaId: 'potencia', posicion: { columna: 7, fila: 4 },
			parte: { tipo: 'completa' } },
		{ id: 'xm-completo', dispositivoId: 'xm', hojaId: 'mando', posicion: { columna: 7, fila: 4 },
			parte: { tipo: 'completa' } },
	] };
	return p;
}

test('DOC-02: tres vistas de un contactor no duplican BOM ni cables en la red documental', () => {
	const p = tableroMultivista();
	const revision = revisarTablero(p);
	const simbolosKm1 = revision.hojasEsquema.flatMap((h) => h.simbolos)
		.filter((s) => s.dispositivoId === 'km1');
	assert.deepEqual(simbolosKm1.map((s) => s.representacionId),
		['km1-polos', 'km1-bobina', 'km1-aux']);
	assert.equal(revision.referencias.indice.filter((x) => x.dispositivoId === 'km1').length, 1);
	assert.equal(revision.posicionesEsquema.get('km1'), '2.3');
	assert.equal(revision.ficha.aparatos.total, 3);
	assert.equal(revision.ficha.conductores.total, 3);
	assert.equal(revision.bom.reduce((total, fila) => total + fila.cantidad, 0), p.dispositivos.length);
	assert.equal(revision.bom.flatMap((fila) => fila.designaciones).filter((id) => id === '-KM1').length, 1);
	assert.deepEqual(revision.listaConductores.map((fila) => [fila.de, fila.a]).sort(), [
		['-KM1:1/L1', 'xp:X1'], ['-KM1:13', 'xp:X2'], ['-KM1:A1', 'xm:X1'],
	].sort());
	assert.equal(revision.listaConductores.length, p.conductores.length);
	assert.deepEqual(revision.hojasEsquema.flatMap((h) => h.hilos.map((x) => x.conductorId)).sort(),
		['c-mando', 'c-potencia']);
	assert.deepEqual(revision.hojasEsquema.flatMap((h) => h.referencias)
		.filter((x) => x.tipo === 'enlace').map((x) => x.conductorId),
		['c-entre-hojas', 'c-entre-hojas']);
	const html = generarInformeHTML(revision);
	assert.match(html, /Hojas: 2\. Dispositivos: 3\. Conductores: 3\./);
	const bomHtml = html.split('<h2>2. Lista de materiales</h2>')[1]
		?.split('<h2>3. Índice de dispositivos</h2>')[0];
	const conductoresHtml = html.split('<h2>5. Lista de conductores</h2>')[1]
		?.split('<h3>Desglose de longitudes por conductor</h3>')[0];
	assert.ok(bomHtml && conductoresHtml);
	assert.equal((bomHtml.match(/-KM1/g) ?? []).length, 1, 'la BOM HTML contiene un contactor');
	assert.equal((conductoresHtml.match(/<tr>/g) ?? []).length, 4, 'cabecera y tres cables reales');
	for (const extremo of ['-KM1:1/L1', '-KM1:A1', '-KM1:13', 'xp:X1', 'xp:X2', 'xm:X1']) {
		assert.ok(conductoresHtml.includes(extremo), `${extremo} falta en la lista HTML`);
	}
	const ingenieria = crearInformeIngenieriaV7({ proyecto: p, analisis: ejecutarIngenieria({ proyecto: p }),
		trazabilidad: { projectId: 'TEST_EFIMERO', buildId: 'TEST', generadoEn: '2026-01-01T00:00:00.000Z' } });
	assert.equal(ingenieria.bom.reduce((total, fila) => total + fila.cantidad, 0), 3);
	assert.equal(ingenieria.bom.flatMap((fila) => fila.designaciones).filter((id) => id === '-KM1').length, 1);
	assert.deepEqual(ingenieria.conductores.map((fila) => fila.id),
		['c-entre-hojas', 'c-mando', 'c-potencia']);
	assert.deepEqual(ingenieria.conductores.map((fila) =>
		[fila.id, fila.deDispositivo, fila.deTerminal, fila.aDispositivo, fila.aTerminal]), [
		['c-entre-hojas', 'km1', '13', 'xp', 'X2'],
		['c-mando', 'km1', 'A1', 'xm', 'X1'],
		['c-potencia', 'km1', '1/L1', 'xp', 'X1'],
	]);
	assert.deepEqual(ingenieria.terminales.find((fila) => fila.borneroId === 'xp' && fila.borneId === 'X2')?.conexiones,
		[{ conductorId: 'c-entre-hojas', dispositivoId: 'km1', borneId: '13' }]);
});
