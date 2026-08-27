import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	LISTA_PERFILES_BASE, construirComportamientoPerfil, rolesDesdeComportamiento,
	type TerminalPerfilComponente,
} from '../src/componentes/perfiles-base.js';
import {
	FORMATO_COMPONENTE_PERSONALIZADO, VERSION_COMPONENTE_PERSONALIZADO,
	instanciarComponentePersonalizado, type DefinicionComponentePersonalizado,
} from '../src/componentes/personalizados.js';
import { resolverComportamiento } from '../src/modelo/comportamiento.js';
import type { TipoDispositivo } from '../src/modelo/tipos.js';
import { contactosCerrados } from '../src/motores/simulacion.js';

const TIPOS: TipoDispositivo[] = [
	'plc', 'fuente', 'transformador', 'contactor', 'rele', 'disyuntor', 'guardamotor',
	'diferencial', 'fusible', 'seccionador', 'variador', 'motor', 'pulsador', 'selector',
	'piloto', 'sensor', 'valvula', 'resistencia', 'condensador', 'bornero', 'cable', 'otro',
];

const t = (id: string, rol: TerminalPerfilComponente['rol'], grupo?: string): TerminalPerfilComponente => ({
	id, rol, grupo, tipo: 'control', u: 0.5, v: 0.5,
});

test('el catálogo base cubre exactamente los 22 tipos y declara fidelidad honesta', () => {
	assert.deepEqual(LISTA_PERFILES_BASE.map((p) => p.id).sort(), TIPOS.sort());
	for (const p of LISTA_PERFILES_BASE) {
		assert.match(p.fidelidad.nivel, /^(completa-v4|completa-v3|completa-v2|completa-v1|parcial|sin-comportamiento)$/);
		assert.ok(p.fidelidad.participacion.length > 5);
		assert.ok(p.fidelidad.limitacion.length > 5);
	}
});

test('un contactor importado usa roles explícitos, no imagen ni nomenclatura IEC', () => {
	const terminales = [
		t('coil-in', 'bobina-entrada'), t('coil-out', 'bobina-retorno'),
		t('power-a', 'polo-entrada', 'P1'), t('power-b', 'polo-salida', 'P1'),
		t('common', 'contacto-comun', 'AUX'), t('normally-open', 'contacto-na', 'AUX'),
	];
	const resultado = construirComportamientoPerfil('contactor', terminales);
	assert.deepEqual(resultado.errores, []);
	assert.equal(resultado.comportamiento?.clase, 'contactos-electromagneticos');
	const ahora = '2026-08-23T12:00:00.000Z';
	const definicion: DefinicionComponentePersonalizado = {
		formato: FORMATO_COMPONENTE_PERSONALIZADO, version: VERSION_COMPONENTE_PERSONALIZADO,
		id: 'custom-k', revision: 1, nombre: 'K importado', creadoEn: ahora, modificadoEn: ahora,
		tipoDispositivo: 'contactor', dimensiones: { anchoMm: 40, altoMm: 70, fondoMm: 60 },
		assetId: `sha256:${'b'.repeat(64)}`,
		terminales: terminales.map(({ id, tipo, u, v }) => ({ id, tipo, u, v })),
		comportamiento: resultado.comportamiento!,
	};
	const d = instanciarComponentePersonalizado(definicion, 'K7', { imagenResuelta: 'blob:k7' });
	assert.deepEqual(resolverComportamiento(d), resultado.comportamiento);
	assert.deepEqual(contactosCerrados(d, {}, true).sort(), [
		['common', 'normally-open'], ['power-a', 'power-b'],
	].sort());
});

test('la construcción por grupos es estable al invertir el array', () => {
	const terminales = [
		t('z1', 'bobina-entrada'), t('z2', 'bobina-retorno'),
		t('b-in', 'polo-entrada', 'dos'), t('b-out', 'polo-salida', 'dos'),
		t('a-in', 'polo-entrada', 'uno'), t('a-out', 'polo-salida', 'uno'),
	];
	const a = construirComportamientoPerfil('contactor', terminales);
	const b = construirComportamientoPerfil('contactor', [...terminales].reverse());
	assert.deepEqual(a, b);
});

test('relé temporizado y fusible conservan semántica específica', () => {
	const rele = construirComportamientoPerfil('rele', [
		t('c1', 'bobina-entrada'), t('c2', 'bobina-retorno'),
		t('x', 'contacto-comun', 'aux'), t('y', 'contacto-nc', 'aux'),
	], { temporizacionTipo: 'trabajo', retardoSegundos: 2.5 });
	assert.deepEqual(rele.errores, []);
	assert.deepEqual(rele.propiedades.temporizacion, { tipo: 'trabajo', segundos: 2.5 });
	const fusible = construirComportamientoPerfil('fusible', [
		t('f-in', 'polo-entrada', 'f'), t('f-out', 'polo-salida', 'f'),
	], { rearmable: true });
	assert.equal(fusible.comportamiento?.clase, 'proteccion');
	assert.equal(fusible.comportamiento?.clase === 'proteccion' && fusible.comportamiento.rearmable, false);
	const ahora = '2026-08-23T12:30:00.000Z';
	const definicion: DefinicionComponentePersonalizado = {
		formato: FORMATO_COMPONENTE_PERSONALIZADO, version: VERSION_COMPONENTE_PERSONALIZADO,
		id: 'timer-custom', revision: 1, nombre: 'Temporizador', creadoEn: ahora, modificadoEn: ahora,
		tipoDispositivo: 'rele', dimensiones: { anchoMm: 22.5, altoMm: 80, fondoMm: 60 },
		assetId: `sha256:${'c'.repeat(64)}`,
		terminales: [t('c1', 'sin-asignar'), t('c2', 'sin-asignar'), t('x', 'sin-asignar'), t('y', 'sin-asignar')]
			.map(({ id, tipo, u, v }) => ({ id, tipo, u, v })),
		comportamiento: rele.comportamiento!, parametros: { temporizacion: rele.propiedades.temporizacion },
	};
	assert.deepEqual(instanciarComponentePersonalizado(definicion, 'KT9').temporizacion,
		{ tipo: 'trabajo', segundos: 2.5 });
});

test('selector de tres posiciones codifica cada salida sin depender del rótulo', () => {
	const resultado = construirComportamientoPerfil('selector', [
		t('com', 'contacto-comun', 'leva'), t('izq', 'contacto-posicion-1', 'leva'),
		t('der', 'contacto-posicion-2', 'leva'),
	], { posiciones: 3, reposo: 0 });
	assert.deepEqual(resultado.errores, []);
	assert.equal(resultado.comportamiento?.clase, 'mando');
	assert.deepEqual(resultado.comportamiento?.clase === 'mando'
		? Object.fromEntries(resultado.comportamiento.contactos.map((c) => [c.salida, c.cerradoEn])) : {},
	{ izq: [1], der: [2] });
	const reconstruidos = rolesDesdeComportamiento(
		[['com', 0.1], ['izq', 0.5], ['der', 0.9]].map(([id, u]) => ({ id: String(id), u: Number(u), v: 0.5 })),
		resultado.comportamiento!,
	);
	assert.equal(reconstruidos.find((x) => x.id === 'izq')?.rol, 'contacto-posicion-1');
	assert.equal(reconstruidos.find((x) => x.id === 'der')?.rol, 'contacto-posicion-2');
});

test('fuente, controlador, sensor, variador y válvula producen contratos validados', () => {
	const casos = [
		construirComportamientoPerfil('fuente', [
			t('pri+', 'alimentacion-entrada'), t('pri-', 'alimentacion-retorno'),
			t('sec+', 'salida-fase'), t('sec-', 'salida-retorno'),
		], { tensionSalidaV: 24 }),
		construirComportamientoPerfil('plc', [
			t('p+', 'alimentacion-entrada'), t('p-', 'alimentacion-retorno'),
			t('out', 'salida-digital', 'q'), t('out-common', 'comun-digital', 'q'),
			t('ao', 'salida-analogica', 'a'), t('ao-common', 'comun-analogico', 'a'),
		], { referenciaMin: 0, referenciaMax: 10, programa: 'out = entrada' }),
		construirComportamientoPerfil('sensor', [
			t('s+', 'alimentacion-entrada'), t('s-', 'alimentacion-retorno'), t('signal', 'senal-digital'),
		], { rangoSondaMin: -20, rangoSondaMax: 80, unidadSonda: '°C' }),
		construirComportamientoPerfil('variador', [
			t('l1', 'alimentacion-entrada'), t('n', 'alimentacion-retorno'), t('go', 'mando-run'),
			t('ref', 'referencia-analogica'), t('ref-common', 'comun-analogico'),
			t('motor-u', 'salida-u'), t('motor-v', 'salida-v'), t('motor-w', 'salida-w'),
		], { fasesMinimas: 1, frecuenciaMaxHz: 60, rampaHzS: 5 }),
		construirComportamientoPerfil('valvula', [
			t('power', 'carga-fase'), t('zero', 'carga-retorno'),
			t('command', 'referencia-analogica'), t('command-common', 'comun-analogico'),
		], { unidadReferencia: 'V', referenciaMin: 2, referenciaMax: 10 }),
	];
	for (const caso of casos) assert.deepEqual(caso.errores, [], caso.errores.join(' | '));
});

test('los roles incompletos fallan de forma explícita y nunca se completan por nombre IEC', () => {
	const resultado = construirComportamientoPerfil('contactor', [
		t('A1', 'sin-asignar'), t('A2', 'sin-asignar'), t('1/L1', 'polo-entrada', 'P'),
	]);
	assert.ok(resultado.errores.some((e) => /entrada de bobina/.test(e)));
	assert.ok(resultado.errores.some((e) => /retorno de bobina/.test(e)));
	assert.ok(resultado.errores.some((e) => /exactamente un extremo/.test(e)));
});

test('perfiles personalizados V3 conservan AI, transmisor, actuador y feedback por roles', () => {
	const sensor = construirComportamientoPerfil('sensor', [
		t('p', 'alimentacion-entrada'), t('n', 'alimentacion-retorno'),
		t('iout', 'salida-analogica'), t('icom', 'comun-analogico'),
	], {
		unidadReferencia: 'mA', modoTransmisor: '3-hilos', modoSalidaAnalogica: 'activa',
		magnitud: 'temperatura', rangoSondaMin: 0, rangoSondaMax: 100, unidadSonda: '°C',
	});
	assert.deepEqual(sensor.errores, []);
	assert.equal(sensor.comportamiento?.clase === 'sensor'
		&& sensor.comportamiento.transmisor?.salida.rango[0], 4);

	const plc = construirComportamientoPerfil('plc', [
		t('p', 'alimentacion-entrada'), t('n', 'alimentacion-retorno'),
		t('ai', 'entrada-analogica', 'ai1'), t('aic', 'referencia-entrada-analogica', 'ai1'),
		t('ao', 'salida-analogica', 'ao1'), t('aoc', 'comun-analogico', 'ao1'),
	], {
		unidadReferencia: 'mA', referenciaMin: 4, referenciaMax: 20,
		modoEntradaAnalogica: 'pasiva', magnitud: 'temperatura',
		rangoSondaMin: 0, rangoSondaMax: 100, unidadSonda: '°C',
	});
	assert.deepEqual(plc.errores, []);
	assert.equal(plc.comportamiento?.clase === 'controlador'
		&& plc.comportamiento.entradasAnalogicas?.[0].modoEntrada, 'pasiva');
	const roles = rolesDesdeComportamiento([
		'p', 'n', 'ai', 'aic', 'ao', 'aoc',
	].map((id) => ({ id, u: 0.5, v: 0.5 })), plc.comportamiento!);
	assert.equal(roles.find((x) => x.id === 'ai')?.rol, 'entrada-analogica');
	assert.equal(roles.find((x) => x.id === 'aic')?.rol, 'referencia-entrada-analogica');

	const valvula = construirComportamientoPerfil('valvula', [
		t('p', 'carga-fase'), t('n', 'carga-retorno'),
		t('y', 'referencia-analogica'), t('m', 'comun-analogico'),
		t('fb', 'salida-feedback'), t('fbc', 'comun-feedback'),
	], { unidadReferencia: 'V', referenciaMin: 0, referenciaMax: 10,
		tiempoAperturaS: 12, tiempoCierreS: 8, failSafe: 'posicion-segura', posicionSegura: 15 });
	assert.deepEqual(valvula.errores, []);
	assert.equal(valvula.comportamiento?.clase === 'carga'
		&& valvula.comportamiento.dinamicaActuador?.posicionSegura, 15);
});
