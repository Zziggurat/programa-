import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	DefinicionComponentePersonalizado,
	actualizarDefinicionComponente,
	crearPaqueteProyecto,
	instanciarComponentePersonalizado,
	leerPaqueteProyecto,
	sugerirRolesIEC,
	validarDefinicionComponente,
} from '../src/componentes/personalizados.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { generarFichaTablero } from '../src/motores/ficha-tablero.js';

const definicionContactor = (): DefinicionComponentePersonalizado => ({
	formato: 'tablero-studio-componente',
	version: 1,
	id: 'cmp-k1',
	revision: 1,
	nombre: 'Contactor de imagen',
	fabricante: 'Ejemplo',
	referencia: 'K-IMG',
	creadoEn: '2026-08-23T10:00:00.000Z',
	modificadoEn: '2026-08-23T10:00:00.000Z',
	tipoDispositivo: 'contactor',
	dimensiones: { anchoMm: 45, altoMm: 85, fondoMm: 75 },
	assetId: `sha256:${'a'.repeat(64)}`,
	terminales: [
		{ id: 'A1', tipo: 'control', u: 0.15, v: 0.85 },
		{ id: 'A2', tipo: 'control', u: 0.85, v: 0.85 },
		{ id: 'L1', tipo: 'L', u: 0.2, v: 0.08 },
		{ id: 'T1', tipo: 'L', u: 0.2, v: 0.55 },
		{ id: 'L2', tipo: 'L', u: 0.5, v: 0.08 },
		{ id: 'T2', tipo: 'L', u: 0.5, v: 0.55 },
		{ id: 'L3', tipo: 'L', u: 0.8, v: 0.08 },
		{ id: 'T3', tipo: 'L', u: 0.8, v: 0.55 },
		{ id: '13', tipo: 'control', u: 0.12, v: 0.35 },
		{ id: '14', tipo: 'control', u: 0.12, v: 0.48 },
		{ id: '21', tipo: 'control', u: 0.88, v: 0.35 },
		{ id: '22', tipo: 'control', u: 0.88, v: 0.48 },
	],
	comportamiento: {
		version: 1,
		clase: 'contactos-electromagneticos',
		bobina: { entrada: 'A1', retorno: 'A2' },
		polos: [
			{ entrada: 'L1', salida: 'T1' },
			{ entrada: 'L2', salida: 'T2' },
			{ entrada: 'L3', salida: 'T3' },
		],
		contactos: [
			{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' },
			{ entrada: '21', salida: '22', reposo: 'cerrado', funcion: 'auxiliar' },
		],
	},
	parametros: { tensionV: 24, corrienteA: 9 },
});

test('un contactor personalizado completo valida sin inferir su función desde la imagen', () => {
	assert.deepEqual(validarDefinicionComponente(definicionContactor()), []);
});

test('el asistente rechaza perfiles eléctricos incoherentes con errores comprensibles', () => {
	const d = definicionContactor();
	assert.equal(d.comportamiento.clase, 'contactos-electromagneticos');
	if (d.comportamiento.clase !== 'contactos-electromagneticos') return;
	d.comportamiento.bobina.retorno = 'A1';
	d.comportamiento.polos[0].entrada = 'A1';
	d.terminales[2].id = 'A1';
	const errores = validarDefinicionComponente(d);
	assert.ok(errores.some((e) => /repetido/i.test(e)), errores.join(' | '));
	assert.ok(errores.some((e) => /mismo borne/i.test(e)), errores.join(' | '));
	assert.ok(errores.some((e) => /bobina y contacto\/polo/i.test(e)), errores.join(' | '));
});

test('las sugerencias IEC nunca convierten GND, 0V o COM en PE', () => {
	const terminales = [
		{ id: 'GND', tipo: 'control' as const },
		{ id: '0V', tipo: 'control' as const },
		{ id: 'COM', tipo: 'senal' as const },
		{ id: 'PE', tipo: 'PE' as const },
	];
	const antes = structuredClone(terminales);
	const sugerencias = sugerirRolesIEC(terminales);
	assert.deepEqual(terminales, antes, 'sugerir no debe mutar ni confirmar roles');
	for (const id of ['GND', '0V', 'COM']) {
		assert.equal(sugerencias.find((s) => s.terminalId === id)?.rol, 'comun');
	}
	assert.equal(sugerencias.find((s) => s.terminalId === 'PE')?.rol, 'proteccion');
});

test('colocar una definición toma un snapshot estable del perfil y los terminales', () => {
	const d = definicionContactor();
	const colocado = instanciarComponentePersonalizado(d, 'k-colocado', {
		imagenResuelta: 'data:image/png;base64,AQID',
	});
	d.terminales[0].id = 'CAMBIADO';
	assert.equal(d.comportamiento.clase, 'contactos-electromagneticos');
	if (d.comportamiento.clase === 'contactos-electromagneticos') d.comportamiento.bobina.entrada = 'CAMBIADO';
	assert.equal(colocado.bornes[0].id, 'A1');
	assert.equal(colocado.comportamiento?.clase, 'contactos-electromagneticos');
	assert.equal(colocado.comportamiento?.clase === 'contactos-electromagneticos'
		? colocado.comportamiento.bobina.entrada : '', 'A1');
	assert.deepEqual(colocado.componentePersonalizado, { definicionId: 'cmp-k1', revision: 1 });
	assert.match(colocado.assetId, /^sha256:/);
	assert.equal(colocado.profundidad, 75, 'la envolvente física conserva el fondo declarado');
});

test('una imagen con perfil es aparato; una imagen legacy sin perfil sigue siendo referencia inerte', () => {
	const personalizado = instanciarComponentePersonalizado(definicionContactor(), 'k-img');
	assert.equal(esReferenciaVisualInerte(personalizado), false);
	assert.equal(esReferenciaVisualInerte({
		id: 'foto', tipo: 'otro', bornes: [], imagen: 'data:image/png;base64,AQID', campo: true,
	}), true);

	const proyecto = crearProyecto('Apariencia no es semántica');
	proyecto.gabinete = {
		ancho: 400, alto: 500, rieles: [], canaletas: [],
		colocaciones: [{ dispositivoId: personalizado.id, x: 10, y: 10, ancho: 45, alto: 85 }],
	};
	proyecto.dispositivos = [personalizado];
	assert.equal(generarFichaTablero(proyecto).aparatos.total, 1,
		'un aparato importado no puede desaparecer de la ficha por tener asset de imagen');
});

test('editar la biblioteca crea una revisión nueva sin alterar la definición anterior', () => {
	const original = definicionContactor();
	const editada = actualizarDefinicionComponente(original, { nombre: 'Contactor revisado' },
		'2026-08-23T11:00:00.000Z');
	assert.equal(original.revision, 1);
	assert.equal(original.nombre, 'Contactor de imagen');
	assert.equal(editada.revision, 2);
	assert.equal(editada.nombre, 'Contactor revisado');
});

test('el paquete portátil conserva proyecto, perfil, procedencia y asset requerido', () => {
	const definicion = definicionContactor();
	const colocado = instanciarComponentePersonalizado(definicion, 'k-colocado');
	const proyecto = crearProyecto('Portátil');
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyecto.gabinete = {
		ancho: 400, alto: 500, rieles: [], canaletas: [],
		colocaciones: [{ dispositivoId: colocado.id, x: 20, y: 30, ancho: 45, alto: 85 }],
	};
	proyecto.dispositivos = [colocado];
	const asset = { id: definicion.assetId, mime: 'image/png' as const, base64: 'AQID' };
	const paquete = crearPaqueteProyecto(proyecto, [asset], [definicion]);
	const releido = leerPaqueteProyecto(JSON.stringify(paquete));
	const recuperado = releido.proyecto.dispositivos[0];
	assert.equal(recuperado.assetId, definicion.assetId);
	assert.deepEqual(recuperado.componentePersonalizado, { definicionId: definicion.id, revision: 1 });
	assert.equal(recuperado.comportamiento?.clase, 'contactos-electromagneticos');
	assert.equal(releido.assets[0].base64, 'AQID');
	assert.throws(() => crearPaqueteProyecto(proyecto, [], [definicion]), /Falta el asset/);
});
