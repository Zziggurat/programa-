import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ComportamientoSimulacion, MATRIZ_FIDELIDAD_SIMULACION, resolverComportamiento,
	validarComportamiento,
} from '../src/modelo/comportamiento.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { Conductor, Dispositivo, Proyecto, TipoDispositivo } from '../src/modelo/tipos.js';
import { contactosCerrados, simular } from '../src/motores/simulacion.js';

const TIPOS: TipoDispositivo[] = [
	'plc', 'fuente', 'transformador', 'contactor', 'rele', 'disyuntor', 'guardamotor',
	'diferencial', 'fusible', 'seccionador', 'variador', 'motor', 'pulsador', 'selector',
	'piloto', 'sensor', 'valvula', 'resistencia', 'condensador', 'bornero', 'cable', 'otro',
];

const PERFIL_CONTACTOR: ComportamientoSimulacion = {
	version: 1,
	clase: 'contactos-electromagneticos',
	bobina: { entrada: 'coil+', retorno: 'coil-' },
	polos: [{ entrada: 'line', salida: 'load' }],
	contactos: [
		{ entrada: 'common-no', salida: 'no', reposo: 'abierto', funcion: 'auxiliar' },
		{ entrada: 'common-nc', salida: 'nc', reposo: 'cerrado', funcion: 'auxiliar' },
	],
};

const CONTACTOR_IMPORTADO: Dispositivo = {
	id: 'ki', tipo: 'contactor', imagen: 'data:image/png;base64,iVBORw0KGgo=',
	bornes: ['coil+', 'coil-', 'line', 'load', 'common-no', 'no', 'common-nc', 'nc'].map((id) => ({ id })),
	comportamiento: PERFIL_CONTACTOR,
};

const cable = (id: string, de: [string, string], a: [string, string]): Conductor => ({
	id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] },
});

const base24V = (): Proyecto => {
	const p = crearProyecto('Perfil de simulación');
	p.dispositivos = [{
		id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Acometida 24 V', tensionNominal: 24,
		bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
	}];
	return p;
};

test('la matriz de fidelidad es v1 y cubre exactamente los 22 TipoDispositivo', () => {
	assert.equal(MATRIZ_FIDELIDAD_SIMULACION.version, 1);
	assert.deepEqual(Object.keys(MATRIZ_FIDELIDAD_SIMULACION.tipos).sort(), [...TIPOS].sort());
	for (const tipo of TIPOS) {
		assert.match(MATRIZ_FIDELIDAD_SIMULACION.tipos[tipo].nivel, /^(simulado|parcial|sin-comportamiento)$/);
	}
});

test('el validador comprueba todos los roles contra bornes reales', () => {
	assert.deepEqual(validarComportamiento(CONTACTOR_IMPORTADO), []);
	const roto: Dispositivo = {
		...CONTACTOR_IMPORTADO,
		comportamiento: {
			...PERFIL_CONTACTOR,
			bobina: { entrada: 'borne-que-no-existe', retorno: 'coil-' },
		},
	};
	assert.match(validarComportamiento(roto).join('\n'), /borne inexistente.*borne-que-no-existe/i);
	assert.equal(resolverComportamiento(roto), undefined,
		'un perfil explícito inválido no debe caer silenciosamente a la heurística de contactor');
});

test('el perfil explícito manda sobre tipo/IEC y la imagen legacy sin perfil queda inerte', () => {
	const conOtroTipo = { ...CONTACTOR_IMPORTADO, tipo: 'otro' as const };
	assert.equal(resolverComportamiento(conOtroTipo)?.clase, 'contactos-electromagneticos');
	assert.equal(resolverComportamiento({ ...CONTACTOR_IMPORTADO, comportamiento: undefined }), undefined);
	assert.deepEqual(contactosCerrados(conOtroTipo, {}, false), [['common-nc', 'nc']]);
	assert.deepEqual(contactosCerrados(conOtroTipo, {}, true), [['line', 'load'], ['common-no', 'no']]);
});

test('el cargador conserva un perfil válido y elimina uno que refiere bornes inexistentes', () => {
	const p = crearProyecto('Persistencia de comportamiento');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [CONTACTOR_IMPORTADO];
	const valido = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(valido.proyecto.dispositivos[0].comportamiento, PERFIL_CONTACTOR);
	assert.equal(valido.diagnosticos.some((d) => d.ruta.endsWith('.comportamiento')), false);

	const bruto = JSON.parse(JSON.stringify(p)) as Proyecto;
	const perfil = bruto.dispositivos[0].comportamiento as Extract<ComportamientoSimulacion, { clase: 'contactos-electromagneticos' }>;
	perfil.bobina.entrada = 'fantasma';
	const invalido = cargarProyecto(JSON.stringify(bruto));
	assert.equal(invalido.proyecto.dispositivos[0].comportamiento, undefined);
	assert.ok(invalido.diagnosticos.some((d) => d.ruta.endsWith('.comportamiento') && /fantasma/.test(d.motivo)));
});

test('un contactor importado con perfil conmuta igual que el contactor nativo', () => {
	const p = base24V();
	const nativo: Dispositivo = {
		id: 'kn', tipo: 'contactor', bornes: ['A1', 'A2', '1', '2', '13', '14', '21', '22'].map((id) => ({ id })),
	};
	const pilotos: Dispositivo[] = [
		{ id: 'hn', tipo: 'piloto', tensionNominal: 24, bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'hi', tipo: 'piloto', tensionNominal: 24, bornes: [{ id: 'X1' }, { id: 'X2' }] },
	];
	p.dispositivos.push(nativo, CONTACTOR_IMPORTADO, ...pilotos);
	p.conductores = [
		cable('c1', ['red', 'L'], ['kn', 'A1']), cable('c2', ['kn', 'A2'], ['red', 'N']),
		cable('c3', ['red', 'L'], ['kn', '1']), cable('c4', ['kn', '2'], ['hn', 'X1']), cable('c5', ['hn', 'X2'], ['red', 'N']),
		cable('c6', ['red', 'L'], ['ki', 'coil+']), cable('c7', ['ki', 'coil-'], ['red', 'N']),
		cable('c8', ['red', 'L'], ['ki', 'line']), cable('c9', ['ki', 'load'], ['hi', 'X1']), cable('c10', ['hi', 'X2'], ['red', 'N']),
	];
	const r = simular(p);
	assert.ok(r.activos.has('kn'), 'la bobina nativa no entró');
	assert.ok(r.activos.has('ki'), 'la bobina importada no entró');
	assert.ok(r.activos.has('hn'), 'el polo nativo no alimentó su carga');
	assert.ok(r.activos.has('hi'), 'el polo explícito importado no alimentó su carga');
});

test('un PLC desconectado no ejecuta el programa aunque su entrada tenga tensión', () => {
	const p = base24V();
	p.dispositivos.push({
		id: 'a1', tipo: 'plc', programa: 'DO1 = DI1',
		bornes: ['+24', '0V', 'DI1', 'DO1'].map((id) => ({ id, tipo: 'control' as const })),
	});
	// DI1 recibe una fase externa, pero +24/0V —la alimentación del PLC— no están cableados.
	p.conductores = [cable('c1', ['red', 'L'], ['a1', 'DI1'])];
	const r = simular(p);
	assert.equal(r.activos.has('a1::DO1'), false);
	assert.equal(r.controladores.length, 0, 'un PLC sin alimentación aparece como ejecutándose');
});

test('AO end-to-end: 5 V de la DSL son 50 % internos y 5 V físicos, no 0,5 V', () => {
	const p = base24V();
	p.dispositivos.push(
		{
			id: 'a1', tipo: 'plc', rangoSalidaAnalogica: [0, 10],
			programa: 'AO1 = 0 a 10 según UI1 de 0 a 100',
			bornes: ['+24', '0V', 'UI1', 'AO1', 'AOC'].map((id) => ({ id, tipo: 'control' as const })),
		},
		{ id: 'b1', tipo: 'sensor', bornes: [{ id: 'S', tipo: 'senal' }] },
	);
	p.conductores = [
		cable('c1', ['red', 'L'], ['a1', '+24']), cable('c2', ['red', 'N'], ['a1', '0V']),
		cable('c3', ['b1', 'S'], ['a1', 'UI1']),
	];
	const r = simular(p, { b1: { valor: 50 } });
	assert.equal(r.analogicas.get('a1::AO1'), 50);
	assert.equal(r.salidasAnalogicas.get('a1::AO1')?.voltios, 5);
	assert.equal(r.salidasAnalogicas.get('a1::AO1')?.referencia, 'AOC');
});
