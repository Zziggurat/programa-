import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ComportamientoSimulacion, MATRIZ_FIDELIDAD_SIMULACION, resolverComportamiento,
	validarComportamiento,
} from '../src/modelo/comportamiento.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { Conductor, Dispositivo, Proyecto, TipoDispositivo } from '../src/modelo/tipos.js';
import { contactosCerrados, memoriaVacia, simular } from '../src/motores/simulacion.js';

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

test('la matriz de fidelidad v2 cubre exactamente los 22 TipoDispositivo', () => {
	assert.equal(MATRIZ_FIDELIDAD_SIMULACION.version, 2);
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

const PERFIL_VARIADOR: ComportamientoSimulacion = {
	version: 1,
	clase: 'variador',
	alimentacion: { fases: ['LINE'], retornos: ['NEUTRAL'], fasesMinimas: 1 },
	mando: { run: 'START', habilitacion: 'ENABLE' },
	referencia: { borne: 'SPEED', comun: 'ACOM', unidad: 'V', rango: [0, 10] },
	salida: { u: 'MOTOR-A', v: 'MOTOR-B', w: 'MOTOR-C', tensionV: 400 },
	frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 },
};

function tableroVariador(run = true, enable = true): Proyecto {
	const p = crearProyecto('Variador funcional');
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Red 220 V', tensionNominal: 220,
			bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{
			id: 'vfd', tipo: 'variador', comportamiento: PERFIL_VARIADOR,
			bornes: ['LINE', 'NEUTRAL', 'START', 'ENABLE', 'SPEED', 'ACOM', 'MOTOR-A', 'MOTOR-B', 'MOTOR-C']
				.map((id) => ({ id })),
		},
		{
			id: 'motor', tipo: 'motor', polos: 3, tensionNominal: 400, corrienteNominal: 2,
			bornes: ['U1', 'V1', 'W1'].map((id) => ({ id, tipo: 'L' as const })),
		},
	];
	p.conductores = [
		cable('p1', ['red', 'L'], ['vfd', 'LINE']), cable('p2', ['red', 'N'], ['vfd', 'NEUTRAL']),
		cable('m1', ['vfd', 'MOTOR-A'], ['motor', 'U1']), cable('m2', ['vfd', 'MOTOR-B'], ['motor', 'V1']),
		cable('m3', ['vfd', 'MOTOR-C'], ['motor', 'W1']),
	];
	if (run) p.conductores.push(cable('run', ['red', 'L'], ['vfd', 'START']));
	if (enable) p.conductores.push(cable('enable', ['red', 'L'], ['vfd', 'ENABLE']));
	return p;
}

test('el cargador conserva el perfil completo del variador sin aceptar roles fantasma', () => {
	const p = tableroVariador();
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	const cargado = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(cargado.proyecto.dispositivos.find((d) => d.id === 'vfd')?.comportamiento, PERFIL_VARIADOR);

	const bruto = JSON.parse(JSON.stringify(p)) as Proyecto;
	const perfil = bruto.dispositivos.find((d) => d.id === 'vfd')!.comportamiento as Extract<ComportamientoSimulacion, { clase: 'variador' }>;
	perfil.salida.u = 'fantasma';
	const reparado = cargarProyecto(JSON.stringify(bruto));
	assert.equal(reparado.proyecto.dispositivos.find((d) => d.id === 'vfd')?.comportamiento, undefined);
	assert.ok(reparado.diagnosticos.some((d) => /comportamiento$/.test(d.ruta) && /fantasma/.test(d.motivo)));
});

test('el adaptador legacy reconoce un variador por terminales convencionales, no por su id o marca', () => {
	const legacy: Dispositivo = {
		id: 'equipo-arbitrario', tipo: 'variador', fabricante: 'Sin marca', tensionNominal: 230,
		bornes: [
			{ id: 'L1', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'U', tipo: 'L' },
			{ id: 'V', tipo: 'L' }, { id: 'W', tipo: 'L' }, { id: 'DI1' }, { id: 'AI1' }, { id: '0V' },
		],
	};
	const perfil = resolverComportamiento(legacy);
	assert.equal(perfil?.clase, 'variador');
	assert.deepEqual(perfil?.clase === 'variador' ? perfil.salida : undefined,
		{ u: 'U', v: 'V', w: 'W', tensionV: 230 });
});

test('variador v1: sin potencia, listo, marcha y falla son estados distintos', () => {
	const sinPotencia = tableroVariador();
	sinPotencia.conductores = sinPotencia.conductores.filter((c) => !c.id.startsWith('p'));
	let r = simular(sinPotencia, { vfd: { valor: 5 } });
	assert.equal(r.variadores[0].estado, 'sin-alimentacion');
	assert.equal(r.activos.has('motor'), false);

	r = simular(tableroVariador(false), { vfd: { valor: 5 } });
	assert.equal(r.variadores[0].estado, 'listo');
	assert.equal(r.variadores[0].frecuenciaHz, 0);

	r = simular(tableroVariador(), { vfd: { valor: 5 } });
	assert.equal(r.variadores[0].estado, 'marcha');
	assert.equal(r.variadores[0].referenciaPorcentaje, 50);
	assert.equal(r.variadores[0].frecuenciaHz, 25);
	assert.ok(r.activos.has('motor'), 'U/V/W del variador no alimentaron el motor');
	for (const borne of ['MOTOR-A', 'MOTOR-B', 'MOTOR-C']) assert.ok(r.vivos.has(`vfd::${borne}`));

	r = simular(tableroVariador(), { vfd: { valor: 5, fallo: true } });
	assert.equal(r.variadores[0].estado, 'falla');
	assert.equal(r.variadores[0].frecuenciaHz, 0);
	assert.equal(r.activos.has('motor'), false);
});

test('variador v1: ENABLE inhibe RUN y la rampa avanza una sola vez por tick', () => {
	const inhibido = simular(tableroVariador(true, false), { vfd: { valor: 10 } });
	assert.equal(inhibido.variadores[0].estado, 'listo');
	assert.equal(inhibido.variadores[0].habilitado, false);

	const p = tableroVariador();
	const memoria = memoriaVacia();
	let r = simular(p, { vfd: { valor: 10 } }, undefined, { ahora: 0, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 0, 'la primera evaluación no inventa tiempo transcurrido');
	r = simular(p, { vfd: { valor: 10 } }, r.activos, { ahora: 1000, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 10, 'una rampa de 10 Hz/s avanzó más de una vez dentro del punto fijo');
	r = simular(p, { vfd: { valor: 10 } }, r.activos, { ahora: 5000, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 50);
});

test('la referencia del variador llega desde una AO cableada, sin leer el modelo interno', () => {
	const p = tableroVariador();
	p.dispositivos.push({
		id: 'plc', tipo: 'plc', rangoSalidaAnalogica: [0, 10],
		bornes: ['+24', '0V', 'AO1', 'AOC'].map((id) => ({ id, tipo: 'control' as const })),
	});
	p.conductores.push(
		cable('plc-p', ['red', 'L'], ['plc', '+24']), cable('plc-n', ['red', 'N'], ['plc', '0V']),
		cable('ref', ['plc', 'AO1'], ['vfd', 'SPEED']), cable('ref-com', ['plc', 'AOC'], ['vfd', 'ACOM']),
	);
	const r = simular(p, { plc: { analogicas: { AO1: 60 } } });
	assert.equal(r.variadores[0].referenciaPorcentaje, 60);
	assert.equal(r.variadores[0].frecuenciaObjetivoHz, 30);
});

test('una válvula con perfil modulante expone posición 0-100 y cae a cero sin potencia', () => {
	const p = base24V();
	p.dispositivos.push(
		{
			id: 'plc', tipo: 'plc', bornes: ['+24', '0V', 'AO1', 'AOC'].map((id) => ({ id })),
		},
		{
			id: 'yv', tipo: 'valvula', bornes: ['P', 'N', 'Y', 'M'].map((id) => ({ id })),
			comportamiento: {
				version: 1, clase: 'carga', alimentacion: { fases: ['P'], retornos: ['N'], fasesMinimas: 1 },
				efecto: 'movimiento', mandoAnalogico: { borne: 'Y', comun: 'M', unidad: 'V', rango: [0, 10] },
			},
		},
	);
	p.conductores = [
		cable('p1', ['red', 'L'], ['plc', '+24']), cable('p2', ['red', 'N'], ['plc', '0V']),
		cable('v1', ['red', 'L'], ['yv', 'P']), cable('v2', ['red', 'N'], ['yv', 'N']),
		cable('a1', ['plc', 'AO1'], ['yv', 'Y']), cable('a2', ['plc', 'AOC'], ['yv', 'M']),
	];
	let r = simular(p, { plc: { analogicas: { AO1: 40 } } });
	assert.equal(r.posicionesCargas.get('yv'), 40);
	p.conductores = p.conductores.filter((c) => c.id !== 'v1');
	r = simular(p, { plc: { analogicas: { AO1: 40 } } });
	assert.equal(r.posicionesCargas.get('yv'), 0);
});

test('mando explícito: pulsador momentáneo y selector mantenido de tres posiciones', () => {
	const pulsador: Dispositivo = { id: 's1', tipo: 'pulsador', bornes: [{ id: '13' }, { id: '14' }] };
	const p = resolverComportamiento(pulsador);
	assert.equal(p?.clase === 'mando' ? p.modo : undefined, 'momentaneo');

	const selector: Dispositivo = {
		id: 's2', tipo: 'selector', bornes: ['C-L', 'L', 'C-R', 'R'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'mando', modo: 'mantenido', posiciones: 3, reposo: 1,
			contactos: [
				{ entrada: 'C-L', salida: 'L', reposo: 'abierto', funcion: 'auxiliar', cerradoEn: [0] },
				{ entrada: 'C-R', salida: 'R', reposo: 'abierto', funcion: 'auxiliar', cerradoEn: [2] },
			],
		},
	};
	assert.deepEqual(contactosCerrados(selector, { posicion: 0 }, false), [['C-L', 'L']]);
	assert.deepEqual(contactosCerrados(selector, { posicion: 1 }, false), []);
	assert.deepEqual(contactosCerrados(selector, { posicion: 2 }, false), [['C-R', 'R']]);
});

test('un fusible disparado es semánticamente no rearmable', () => {
	const p = base24V();
	const fusible: Dispositivo = {
		id: 'f1', tipo: 'fusible', corrienteNominal: 1, curvaDisparo: 'gG',
		bornes: [{ id: '1' }, { id: '2' }],
	};
	p.dispositivos.push(fusible, {
		id: 'r1', tipo: 'resistencia', corrienteNominal: 5, bornes: [{ id: 'X1' }, { id: 'X2' }],
	});
	p.conductores = [
		cable('c1', ['red', 'L'], ['f1', '1']), cable('c2', ['f1', '2'], ['r1', 'X1']),
		cable('c3', ['r1', 'X2'], ['red', 'N']),
	];
	const perfil = resolverComportamiento(fusible);
	assert.equal(perfil?.clase === 'proteccion' ? perfil.rearmable : undefined, false);
	const r = simular(p);
	assert.equal(r.disparos.find((d) => d.dispositivoId === 'f1')?.rearmable, false);
	assert.deepEqual(contactosCerrados(fusible, { disparado: true }, false), []);
});
