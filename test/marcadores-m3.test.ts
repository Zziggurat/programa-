import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { aCSV } from '../src/modelo/csv.js';
import { prepararMarcadores } from '../src/motores/marcadores.js';
import { tiraDeExtremosConductores } from '../src/motores/etiquetas.js';

function proyectoDeRotulos(): Proyecto {
	const p = crearProyecto('Marcadores');
	p.dispositivos = [
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [
			{ id: '2', tipo: 'control' }, { id: '1', tipo: 'control' },
		] },
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', descripcion: 'Contactor', bornes: [
			{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
		] },
	];
	p.conductores = [
		{ id: 'w2', numero: '42', de: { dispositivoId: 'x1', borneId: '2' },
			a: { dispositivoId: 'km1', borneId: 'A2' } },
		{ id: 'w1', numero: '41', de: { dispositivoId: 'x1', borneId: '1' },
			a: { dispositivoId: 'km1', borneId: 'A1' } },
	];
	return p;
}

test('DOC-04: cada hilo produce dos marcadores distintos con el mismo identificador', () => {
	const p = proyectoDeRotulos();
	const marcadores = prepararMarcadores(p);
	const extremos = marcadores.filter((m) => m.tipo === 'extremo-conductor');
	assert.equal(extremos.length, 2 * p.conductores.length);
	for (const conductor of p.conductores) {
		const dos = extremos.filter((m) => m.entidadId === conductor.id);
		assert.deepEqual(dos.map((m) => m.lado), ['de', 'a']);
		assert.deepEqual(dos.map((m) => m.principal), [conductor.numero, conductor.numero]);
		assert.deepEqual(dos.map((m) => m.cantidad), [1, 1]);
		assert.notDeepEqual(dos.map((m) => [m.campos.destinoDispositivo, m.campos.destinoBorne])[0],
			[dos[1].campos.destinoDispositivo, dos[1].campos.destinoBorne]);
	}
	assert.deepEqual(tiraDeExtremosConductores(p).etiquetas.map((e) => e.principal), ['41', '41', '42', '42']);
	assert.equal(marcadores.filter((m) => m.tipo === 'aparato').length, 2);
	const bornes = marcadores.filter((m) => m.tipo === 'borne');
	assert.equal(bornes.length, 4, 'incluye bornes del contactor, no solo de la regleta');
	assert.equal(bornes.filter((m) => m.ubicacionBorne === 'BORNERA').length, 2);
	assert.equal(bornes.filter((m) => m.ubicacionBorne === 'APARATO').length, 2);
	assert.deepEqual(bornes.filter((m) => m.dispositivoId === 'km1').map((m) => m.borneId), ['A1', 'A2']);
});

test('DOC-04: el borne de aparato usa rótulo visible sin perder ID y no se multiplica por hilos', () => {
	const p = proyectoDeRotulos();
	p.dispositivos[1].bornes[0].rotulo = 'Bobina +';
	p.conductores.push({ id: 'w3', de: { dispositivoId: 'x1', borneId: '2' },
		a: { dispositivoId: 'km1', borneId: 'A1' } });
	const marcadores = prepararMarcadores(p);
	const borne = marcadores.find((m) => m.tipo === 'borne' && m.dispositivoId === 'km1' && m.borneId === 'A1');
	assert.ok(borne);
	assert.equal(borne.ubicacionBorne, 'APARATO');
	assert.equal(borne.campos.identificador, 'A1', 'el ID eléctrico sigue separado del texto visible');
	assert.equal(borne.principal, 'Bobina +');
	assert.equal(marcadores.filter((m) => m.tipo === 'borne' && m.dispositivoId === 'km1' && m.borneId === 'A1').length, 1);
	assert.equal(marcadores.filter((m) => m.tipo === 'extremo-conductor').length, 6);
	assert.equal(tiraDeExtremosConductores(p).etiquetas.length, 6,
		'la tira PDF no imprime automáticamente las etiquetas de todos los bornes');
});

test('DOC-04: orden de arrays y vistas no cambian marcadores físicos', () => {
	const p = proyectoDeRotulos();
	const base = prepararMarcadores(p);
	p.dispositivos.reverse();
	p.dispositivos.forEach((d) => d.bornes.reverse());
	p.conductores.reverse();
	p.esquema = { representaciones: [
		{ id: 'km-mando', dispositivoId: 'km1', hojaId: 'h1', posicion: { columna: 1, fila: 1 }, parte: { tipo: 'completa' } },
		{ id: 'km-potencia', dispositivoId: 'km1', hojaId: 'h2', posicion: { columna: 1, fila: 1 }, parte: { tipo: 'completa' } },
	] };
	assert.deepEqual(prepararMarcadores(p), base);
});

test('DOC-04: mapeo de campos y cantidad expresan copias sin duplicar extremos', () => {
	const p = proyectoDeRotulos();
	const marcadores = prepararMarcadores(p, {
		mapeo: { 'extremo-conductor': { principal: 'numeroConductor', secundaria: 'borne' } },
		copias: { 'extremo-conductor': 3 },
	});
	const extremos = marcadores.filter((m) => m.tipo === 'extremo-conductor');
	assert.equal(extremos.length, 4);
	assert.deepEqual(extremos.filter((m) => m.entidadId === 'w1').map((m) => [m.principal, m.secundaria, m.cantidad]),
		[['41', '1', 3], ['41', 'A1', 3]]);
	assert.ok(extremos.every((m) => m.campoPrincipal === 'numeroConductor' && m.campoSecundario === 'borne'));
	assert.throws(() => prepararMarcadores(p, { copias: { 'extremo-conductor': 0 } }), /cantidad de copias/);
});

test('DOC-04: CSV seguro conserva texto hostil dentro de campos separados', () => {
	const p = proyectoDeRotulos();
	p.conductores[0].numero = '=HYPERLINK("https://ejemplo.invalid/?x=1;2")';
	p.dispositivos[0].designacion = '-X;1:tab';
	p.dispositivos[0].bornes[0].id = '2:aux;3';
	p.conductores[0].de.borneId = '2:aux;3';
	const extremo = prepararMarcadores(p).find((m) => m.tipo === 'extremo-conductor' && m.entidadId === 'w2' && m.lado === 'a')!;
	assert.equal(extremo.campos.destinoDispositivo, '-X;1:tab');
	assert.equal(extremo.campos.destinoBorne, '2:aux;3');
	const csv = aCSV([['Tipo', 'Número', 'Destino dispositivo', 'Destino borne', 'Texto principal', 'Cantidad'],
		[extremo.tipo, extremo.campos.numeroConductor, extremo.campos.destinoDispositivo,
			extremo.campos.destinoBorne, extremo.principal, extremo.cantidad]]);
	assert.match(csv, /'=?HYPERLINK/);
	assert.match(csv, /"'-X;1:tab";"2:aux;3";/);
	assert.match(csv, /;1$/);
	assert.equal(extremo.principal, p.conductores[0].numero,
		'la impresora recibe el campo identificado, sin unirlo accidentalmente al destino');
});
