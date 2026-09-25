import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');
const procedencia = { estado: 'confirmado' as const, projectId: 'esq-08',
	revisionRepositorio: 2, buildId: 'TEST', generadoEn: '2026-09-24T12:00:00.000Z' };

function tablero(): Proyecto {
	const p = crearProyecto('Referencias de revisión');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [{ id: 'alimentacion', numero: 1, titulo: 'Alimentación' },
		{ id: 'plc', numero: 2, titulo: 'PLC' }, { id: 'terminales', numero: 3, titulo: 'Bornes' }];
	p.dispositivos = [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }],
			comportamiento: { version: 1, clase: 'fuente', salidas: [
				{ borne: '+24', papel: 'fase', tensionV: 24 },
				{ borne: '0V', papel: 'retorno', tensionV: 0 },
			] } },
		{ id: 'plc1', tipo: 'plc', bornes: ['+24', '0V', 'DI1'].map((id) => ({ id })),
			comportamiento: { version: 1, clase: 'controlador',
				alimentacion: { entradas: ['+24'], retornos: ['0V'] },
				salidasDigitales: [], salidasAnalogicas: [] },
			programaPLC: { version: 1, lenguaje: 'tablerostudio-plc-v4', FUENTE: '',
				etiquetas: [{ nombre: 'ENTRADA', tipo: 'BOOL', io: { clase: 'DI', borne: 'DI1' } }] } },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [
		{ id: 'w-feed', de: { dispositivoId: 'ps', borneId: '+24' },
			a: { dispositivoId: 'plc1', borneId: '+24' } },
		{ id: 'w-di', de: { dispositivoId: 'plc1', borneId: 'DI1' },
			a: { dispositivoId: 'x1', borneId: '1' } },
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

const contenido = (archivos: Awaited<ReturnType<typeof crearArchivosPaqueteDocumental>>, ruta: string) =>
	String(archivos.find((a) => a.ruta === ruta)?.contenido ?? '');

test('ESQ-08/DOC-02: paquete incluye canal/terminal y circuito/hojas sin atribuir retornos ni terminales ajenos', async () => {
	const p = tablero();
	const antes = JSON.stringify(p);
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), antes, 'emitir una revisión no modifica el proyecto vivo');
	const io = contenido(archivos, 'listas/referencias-plc-terminales.csv');
	assert.match(io, /plc1;DI1;DI;ETIQUETA_EXPLICITA;NO_VERIFICADA;w-di;plc;2;4;plc-vista;x1;1;terminales;3;6;x-vista/);
	const circuitos = contenido(archivos, 'listas/referencias-circuitos-hojas.csv');
	const filas = circuitos.split('\n').filter((f) => f.includes('w-feed'));
	assert.equal(filas.length, 2);
	assert.ok(filas.every((f) => f.includes('TRAYECTOS_ALIMENTACION_IDENTIFICADOS')));
	assert.ok(filas.some((f) => f.split(';')[6] === 'alimentacion' && f.split(';')[7] === '1'));
	assert.ok(filas.some((f) => f.split(';')[6] === 'plc' && f.split(';')[7] === '2'));
	assert.ok(filas.every((f) => f.split(';')[6] !== 'terminales'),
		'la bornera de señal no se presenta como trayecto de alimentación');
	assert.equal(archivos.some((a) => a.ruta === 'listas/referencias-esquema-diagnosticos.csv'), false);
	const invertido = structuredClone(p);
	invertido.hojas.reverse(); invertido.dispositivos.reverse(); invertido.conductores.reverse();
	invertido.esquema!.representaciones!.reverse();
	const archivosInvertidos = await crearArchivosPaqueteDocumental(invertido, procedencia);
	for (const ruta of ['listas/referencias-plc-terminales.csv', 'listas/referencias-circuitos-hojas.csv'])
		assert.equal(contenido(archivosInvertidos, ruta), contenido(archivos, ruta), ruta);
});

test('ESQ-08/DOC-02: anclaje ambiguo deja rastro diagnóstico y no inventa página para un canal', async () => {
	const p = tablero();
	p.esquema!.representaciones!.push({ id: 'plc-duplicado', dispositivoId: 'plc1', hojaId: 'terminales',
		posicion: { columna: 8, fila: 2 }, parte: { tipo: 'completa' } });
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.doesNotMatch(contenido(archivos, 'listas/referencias-plc-terminales.csv'), /;w-di;/);
	const diagnosticos = contenido(archivos, 'listas/referencias-esquema-diagnosticos.csv');
	assert.match(diagnosticos, /CANAL_ANCLA_AMBIGUA/);
	assert.match(diagnosticos, /CIRCUITO_SIN_ANCLA/);
	assert.ok(archivos.some((a) => a.ruta === 'listas/referencias-esquema-diagnosticos.csv'));
});
