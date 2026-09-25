import assert from 'node:assert/strict';
import test from 'node:test';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { proyectarReferenciasEsquemaM2 } from '../src/motores/referencias-esquema-m2.js';

function tablero(): Proyecto {
	const p = crearProyecto('Referencias E/S');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [
		{ id: 'alimentacion', numero: 1, titulo: 'Alimentación' },
		{ id: 'plc', numero: 2, titulo: 'Controlador' },
		{ id: 'terminales', numero: 3, titulo: 'Bornes' },
	];
	p.dispositivos = [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }],
			comportamiento: { version: 1, clase: 'fuente', salidas: [
				{ borne: '+24', papel: 'fase', tensionV: 24 }, { borne: '0V', papel: 'retorno', tensionV: 0 },
			] } },
		{ id: 'plc1', tipo: 'plc', designacion: '-A1',
			bornes: ['+24', '0V', 'DI1', 'DO1', 'DOC'].map((id) => ({ id,
				...(id === 'DI1' ? { rotulo: 'AO55' } : {}) })),
			comportamiento: { version: 1, clase: 'controlador',
				alimentacion: { entradas: ['+24'], retornos: ['0V'] },
				salidasDigitales: [{ borne: 'DO1', comun: 'DOC' }], salidasAnalogicas: [] },
			programaPLC: { version: 1, lenguaje: 'tablerostudio-plc-v4', FUENTE: '',
				etiquetas: [{ nombre: 'ENTRADA', tipo: 'BOOL', io: { clase: 'DI', borne: 'DI1' } }] } },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1',
			bornes: [{ id: '1' }, { id: '2' }] },
	];
	p.conductores = [
		{ id: 'w-feed', de: { dispositivoId: 'ps', borneId: '+24' },
			a: { dispositivoId: 'plc1', borneId: '+24' } },
		{ id: 'w-di', de: { dispositivoId: 'plc1', borneId: 'DI1' },
			a: { dispositivoId: 'x1', borneId: '1' } },
		{ id: 'w-do', de: { dispositivoId: 'plc1', borneId: 'DO1' },
			a: { dispositivoId: 'x1', borneId: '2' } },
	];
	p.esquema = { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'alimentacion',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'plc-vista', dispositivoId: 'plc1', hojaId: 'plc',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'terminales',
			posicion: { columna: 6, fila: 4 }, parte: { tipo: 'completa' } },
	] };
	return p;
}

const proyectar = (p: Proyecto) =>
	proyectarReferenciasEsquemaM2(p, montarEsquema(p, calcularPotenciales(p)));

test('ESQ-08: canal PLC y terminal real conservan clase, extremo y ubicación de ambas hojas', () => {
	const p = tablero();
	const antes = JSON.stringify(p);
	const r = proyectar(p);
	assert.equal(JSON.stringify(p), antes, 'la proyección no modifica el Proyecto');
	assert.deepEqual(r.canales.map((x) => [x.canalBorneId, x.clase, x.conductorId,
		x.canal.hojaId, x.canal.numeroHoja, x.canal.columna,
		x.terminal.dispositivoId, x.terminal.borneId, x.terminal.ubicacion.hojaId,
		x.terminal.ubicacion.numeroHoja, x.terminal.ubicacion.columna]), [
		['DI1', 'DI', 'w-di', 'plc', 2, 4, 'x1', '1', 'terminales', 3, 6],
		['DO1', 'DO', 'w-do', 'plc', 2, 4, 'x1', '2', 'terminales', 3, 6],
	]);
	assert.equal(r.canales[0].origen, 'ETIQUETA_EXPLICITA');
	assert.equal(r.canales[0].calidad, 'NO_VERIFICADA');
	assert.equal(r.canales[0].clase, 'DI', 'el rótulo AO55 no convierte DI1 en AO');
	assert.deepEqual(r.diagnosticos, []);
});

test('ESQ-08: circuito/hoja usa trayecto identificado y no atribuye la bornera al circuito PLC', () => {
	const r = proyectar(tablero());
	const c = r.circuitos.find((x) => x.circuitoId.includes('plc1'))!;
	assert.equal(c.estadoTopologia, 'INEQUIVOCA');
	assert.equal(c.alcance, 'TRAYECTOS_ALIMENTACION_IDENTIFICADOS');
	assert.deepEqual(c.conductores, ['w-feed']);
	assert.deepEqual(c.hojas, [{ id: 'alimentacion', numero: 1 }, { id: 'plc', numero: 2 }]);
	assert.deepEqual(c.conductoresSinAncla, []);
	assert.equal(c.hojas.some((h) => h.id === 'terminales'), false,
		'la conexión de E/S no pertenece necesariamente al trayecto de alimentación descubierto');
});

test('ESQ-08: arrays invertidos y guardado/carga conservan IDs y referencias; reordenar hojas cambia solo números', () => {
	const p = tablero();
	const base = proyectar(p);
	const invertido = structuredClone(p);
	invertido.hojas.reverse(); invertido.dispositivos.reverse(); invertido.conductores.reverse();
	invertido.esquema!.representaciones!.reverse();
	assert.deepEqual(proyectar(invertido), base);
	assert.deepEqual(proyectar(cargarProyecto(JSON.stringify(p)).proyecto), base);
	const reordenado = structuredClone(p);
	reordenado.hojas.find((h) => h.id === 'plc')!.numero = 3;
	reordenado.hojas.find((h) => h.id === 'terminales')!.numero = 2;
	const nuevo = proyectar(reordenado);
	assert.equal(nuevo.canales[0].canal.hojaId, 'plc');
	assert.equal(nuevo.canales[0].canal.numeroHoja, 3);
	assert.equal(nuevo.canales[0].terminal.ubicacion.hojaId, 'terminales');
	assert.equal(nuevo.canales[0].terminal.ubicacion.numeroHoja, 2);
	assert.deepEqual(nuevo.circuitos.find((x) => x.circuitoId.includes('plc1'))!.hojas,
		[{ id: 'alimentacion', numero: 1 }, { id: 'plc', numero: 3 }]);
});

test('ESQ-08: anclajes duplicados o ausentes producen diagnóstico, nunca una página arbitraria', () => {
	const doble = tablero();
	doble.esquema!.representaciones!.push({ id: 'plc-duplicado', dispositivoId: 'plc1', hojaId: 'terminales',
		posicion: { columna: 8, fila: 2 }, parte: { tipo: 'completa' } });
	const rDoble = proyectar(doble);
	assert.equal(rDoble.canales.length, 0);
	assert.ok(rDoble.diagnosticos.some((d) => d.codigo === 'CANAL_ANCLA_AMBIGUA' && d.entidadId.includes('DI1')));
	assert.ok(rDoble.diagnosticos.some((d) => d.codigo === 'CIRCUITO_SIN_ANCLA' && d.conductorId === 'w-feed'));
	const sinBornero = tablero();
	sinBornero.esquema!.representaciones = sinBornero.esquema!.representaciones!.filter((x) => x.dispositivoId !== 'x1');
	const rSin = proyectar(sinBornero);
	assert.equal(rSin.canales.length, 0);
	assert.ok(rSin.diagnosticos.some((d) => d.codigo === 'TERMINAL_SIN_ANCLA' && d.conductorId === 'w-di'));
});

test('ESQ-08: perfil PLC inválido no cae a heurística ni fabrica referencias', () => {
	const p = tablero();
	const plc = p.dispositivos.find((d) => d.id === 'plc1')!;
	if (plc.comportamiento?.clase !== 'controlador') throw new Error('fixture sin controlador');
	plc.comportamiento.salidasDigitales[0].borne = 'DO_FANTASMA';
	const r = proyectar(p);
	assert.equal(r.canales.length, 0);
	assert.ok(r.diagnosticos.some((d) => d.codigo === 'IO_NO_VERIFICABLE' && d.entidadId.includes('plc1')));
});

test('ESQ-08: dos fuentes hacia el mismo circuito conservan las páginas y advierten topología ambigua', () => {
	const p = tablero();
	const segunda = structuredClone(p.dispositivos.find((d) => d.id === 'ps')!);
	segunda.id = 'ps2'; p.dispositivos.push(segunda);
	p.conductores.push({ id: 'w-feed2', de: { dispositivoId: 'ps2', borneId: '+24' },
		a: { dispositivoId: 'plc1', borneId: '+24' } });
	p.esquema!.representaciones!.push({ id: 'ps2-vista', dispositivoId: 'ps2', hojaId: 'alimentacion',
		posicion: { columna: 7, fila: 2 }, parte: { tipo: 'completa' } });
	const r = proyectar(p);
	const c = r.circuitos.find((x) => x.circuitoId.includes('plc1'))!;
	assert.equal(c.estadoTopologia, 'AMBIGUA');
	assert.deepEqual(c.conductores, ['w-feed', 'w-feed2']);
	assert.deepEqual(c.hojas, [{ id: 'alimentacion', numero: 1 }, { id: 'plc', numero: 2 }]);
	assert.ok(r.diagnosticos.some((d) => d.codigo === 'CIRCUITO_AMBIGUO' && d.entidadId === c.circuitoId));
});
