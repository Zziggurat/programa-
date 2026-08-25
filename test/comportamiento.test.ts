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

test('la matriz de fidelidad v4 cubre exactamente los 22 TipoDispositivo', () => {
	assert.equal(MATRIZ_FIDELIDAD_SIMULACION.version, 4);
	assert.deepEqual(Object.keys(MATRIZ_FIDELIDAD_SIMULACION.tipos).sort(), [...TIPOS].sort());
	for (const tipo of TIPOS) {
		assert.match(MATRIZ_FIDELIDAD_SIMULACION.tipos[tipo].nivel,
			/^(completa-v3|completa-v2|completa-v1|parcial|sin-comportamiento)$/);
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

test('sensor, protección y pasivo importados ejecutan el perfil aunque su carcasa sea otro', () => {
	const proteccion: Dispositivo = {
		id: 'q-importado', tipo: 'otro',
		bornes: ['entrada', 'salida', 'alarma-comun', 'alarma-nc', 'alarma-na'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'proteccion', rearmable: true,
			polos: [{ entrada: 'entrada', salida: 'salida' }],
			contactos: [
				{ entrada: 'alarma-comun', salida: 'alarma-nc', reposo: 'cerrado', funcion: 'auxiliar' },
				{ entrada: 'alarma-comun', salida: 'alarma-na', reposo: 'abierto', funcion: 'auxiliar' },
			],
		},
	};
	assert.deepEqual(contactosCerrados(proteccion, {}, false), [
		['entrada', 'salida'], ['alarma-comun', 'alarma-nc'],
	]);
	assert.deepEqual(contactosCerrados(proteccion, { disparado: true }, false), [
		['alarma-comun', 'alarma-na'],
	]);
	assert.deepEqual(contactosCerrados(proteccion, { cerrado: false }, false), [
		['alarma-comun', 'alarma-na'],
	], 'abrir manualmente la protección no conmutó su contacto de estado');

	const sensor: Dispositivo = {
		id: 'b-importado', tipo: 'otro',
		bornes: ['positivo', 'cero', 'salida', 'seco-comun', 'seco-na'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'sensor',
			alimentacion: { entrada: 'positivo', retorno: 'cero' },
			salidaDigital: { borne: 'salida', tomaDe: 'positivo' },
			contactos: [{
				entrada: 'seco-comun', salida: 'seco-na', reposo: 'abierto', funcion: 'auxiliar',
			}],
		},
	};
	assert.deepEqual(contactosCerrados(sensor, {}, false), []);
	assert.deepEqual(contactosCerrados(sensor, { activo: true }, false), [
		['seco-comun', 'seco-na'], ['positivo', 'salida'],
	]);

	const pasivo: Dispositivo = {
		id: 'x-importado', tipo: 'otro', bornes: [{ id: 'a' }, { id: 'b' }],
		comportamiento: { version: 1, clase: 'pasivo', conexiones: [{ entrada: 'a', salida: 'b' }] },
	};
	assert.deepEqual(contactosCerrados(pasivo, {}, false), [['a', 'b']]);
	assert.deepEqual(contactosCerrados({
		...pasivo, puentesInternos: [['a', 'b']],
		comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'no verificado' },
	}, {}, false), [], 'un perfil explícitamente inerte cayó al puente legacy');

	const termicoLegacy: Dispositivo = {
		id: 'f-legacy', tipo: 'rele',
		bornes: ['1', '2', '3', '4', '5', '6', '95', '96', '97', '98'].map((id) => ({ id })),
	};
	assert.deepEqual(contactosCerrados(termicoLegacy, {}, false), [
		['1', '2'], ['3', '4'], ['5', '6'], ['95', '96'],
	]);
	assert.deepEqual(contactosCerrados(termicoLegacy, { disparado: true }, false), [['97', '98']],
		'el adaptador de perfil perdió los auxiliares 95-96/97-98 del térmico legacy');

	const sensorLegacy: Dispositivo = {
		id: 'b-legacy', tipo: 'sensor', bornes: [{ id: '1' }, { id: '2' }],
	};
	assert.deepEqual(contactosCerrados(sensorLegacy, {}, false), []);
	assert.deepEqual(contactosCerrados(sensorLegacy, { activo: true }, false), [['1', '2']],
		'el adaptador de perfil perdió el contacto NA 1/2 de campo legacy');
});

test('un bornero legacy no conecta pares numerados sin un puente explícito', () => {
	const bornes = ['1', '2', '3', '4'].map((id) => ({ id, etiqueta: id, tipo: 'control' as const }));
	const bornero: Dispositivo = { id: 'x1', tipo: 'bornero', bornes };
	assert.deepEqual(contactosCerrados(bornero, {}, false), []);
	assert.deepEqual(contactosCerrados({ ...bornero, puentesInternos: [['1', '2']] }, {}, false), [['1', '2']]);
});

test('una protección importada participa en corriente, sobrecarga y cortocircuito por su perfil', () => {
	const proteccion: Dispositivo = {
		id: 'q-custom', tipo: 'otro', corrienteNominal: 1, curvaDisparo: 'B',
		bornes: [{ id: 'linea' }, { id: 'carga' }],
		comportamiento: {
			version: 1, clase: 'proteccion', rearmable: true, contactos: [],
			polos: [{ entrada: 'linea', salida: 'carga' }],
		},
	};
	const p = base24V();
	p.dispositivos.push(proteccion, {
		id: 'r-carga', tipo: 'resistencia', tensionNominal: 24, corrienteNominal: 8,
		bornes: [{ id: 'X1' }, { id: 'X2' }],
	});
	p.conductores = [
		cable('sob-1', ['red', 'L'], ['q-custom', 'linea']),
		cable('sob-2', ['q-custom', 'carga'], ['r-carga', 'X1']),
		cable('sob-3', ['r-carga', 'X2'], ['red', 'N']),
	];
	const sobrecarga = simular(p);
	assert.ok((sobrecarga.cargaPorAparato.get('q-custom')?.corriente ?? 0) >= 8);
	assert.equal(sobrecarga.disparos.some((d) => d.dispositivoId === 'q-custom'
		&& d.motivo === 'sobrecarga'), true);
	const invertido = structuredClone(p);
	invertido.dispositivos.reverse();
	invertido.conductores.reverse();
	const sobrecargaInvertida = simular(invertido);
	assert.deepEqual(
		sobrecargaInvertida.disparos.map((d) => `${d.dispositivoId}:${d.motivo}`).sort(),
		sobrecarga.disparos.map((d) => `${d.dispositivoId}:${d.motivo}`).sort(),
		'invertir dispositivos/conductores cambió el disparo perfilado',
	);

	const corto = base24V();
	corto.dispositivos.push(proteccion);
	corto.conductores = [
		cable('cc-1', ['red', 'L'], ['q-custom', 'linea']),
		cable('cc-2', ['q-custom', 'carga'], ['red', 'N']),
	];
	const resultadoCorto = simular(corto);
	assert.equal(resultadoCorto.cortocircuitos.some((f) =>
		f.proteccionesAguasArriba.includes('q-custom')), true,
	'el corto aguas abajo no se atribuyó a la protección perfilada');
	assert.equal(resultadoCorto.disparos.some((d) => d.dispositivoId === 'q-custom'
		&& d.motivo === 'cortocircuito'), true);

	const rele: Dispositivo = {
		id: 'k-aux', tipo: 'rele', corrienteNominal: 0.01,
		bornes: ['A1', 'A2', '13', '14'].map((id) => ({ id })),
	};
	assert.equal(resolverComportamiento(rele)?.clase, 'contactos-electromagneticos');
	const corteManual: Dispositivo = {
		...proteccion, id: 's-corte', tipo: 'seccionador', corrienteNominal: 0.01,
	};
	assert.equal(resolverComportamiento(corteManual)?.clase, 'proteccion');
	const sinCarga = base24V();
	sinCarga.dispositivos.push(rele, corteManual);
	const resultadoSinCarga = simular(sinCarga);
	assert.equal(resultadoSinCarga.disparos.some((d) => d.dispositivoId === rele.id
		|| d.dispositivoId === corteManual.id), false,
		'un relé común o un seccionador se degradó a protección automática por `tipo`');
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
		...['hn-polo', 'hn-na', 'hn-nc', 'hi-polo', 'hi-na', 'hi-nc'].map((id) => ({
			id, tipo: 'piloto' as const, tensionNominal: 24,
			bornes: [{ id: 'X1' }, { id: 'X2' }],
		})),
	];
	p.dispositivos.push(nativo, CONTACTOR_IMPORTADO, ...pilotos);
	p.conductores = [
		cable('c1', ['red', 'L'], ['kn', 'A1']), cable('c2', ['kn', 'A2'], ['red', 'N']),
		cable('c3', ['red', 'L'], ['kn', '1']), cable('c4', ['kn', '2'], ['hn-polo', 'X1']), cable('c5', ['hn-polo', 'X2'], ['red', 'N']),
		cable('c6', ['red', 'L'], ['ki', 'coil+']), cable('c7', ['ki', 'coil-'], ['red', 'N']),
		cable('c8', ['red', 'L'], ['ki', 'line']), cable('c9', ['ki', 'load'], ['hi-polo', 'X1']), cable('c10', ['hi-polo', 'X2'], ['red', 'N']),
		cable('c11', ['red', 'L'], ['kn', '13']), cable('c12', ['kn', '14'], ['hn-na', 'X1']), cable('c13', ['hn-na', 'X2'], ['red', 'N']),
		cable('c14', ['red', 'L'], ['kn', '21']), cable('c15', ['kn', '22'], ['hn-nc', 'X1']), cable('c16', ['hn-nc', 'X2'], ['red', 'N']),
		cable('c17', ['red', 'L'], ['ki', 'common-no']), cable('c18', ['ki', 'no'], ['hi-na', 'X1']), cable('c19', ['hi-na', 'X2'], ['red', 'N']),
		cable('c20', ['red', 'L'], ['ki', 'common-nc']), cable('c21', ['ki', 'nc'], ['hi-nc', 'X1']), cable('c22', ['hi-nc', 'X2'], ['red', 'N']),
	];
	const reposo = structuredClone(p);
	reposo.conductores = reposo.conductores.filter((c) => c.id !== 'c1' && c.id !== 'c6');
	const r0 = simular(reposo);
	assert.equal(r0.activos.has('hn-nc'), true, 'el NC nativo no condujo en reposo');
	assert.equal(r0.activos.has('hi-nc'), true, 'el NC importado no condujo en reposo');
	for (const id of ['hn-polo', 'hn-na', 'hi-polo', 'hi-na']) assert.equal(r0.activos.has(id), false, `${id} condujo en reposo`);

	const r = simular(p);
	assert.ok(r.activos.has('kn'), 'la bobina nativa no entró');
	assert.ok(r.activos.has('ki'), 'la bobina importada no entró');
	for (const id of ['hn-polo', 'hn-na', 'hi-polo', 'hi-na']) assert.ok(r.activos.has(id), `${id} no condujo en trabajo`);
	assert.equal(r.activos.has('hn-nc'), false, 'el NC nativo no abrió en trabajo');
	assert.equal(r.activos.has('hi-nc'), false, 'el NC importado no abrió en trabajo');
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
		{
			id: 'x-custom', tipo: 'otro', bornes: [{ id: 'entrada' }, { id: 'salida' }],
			comportamiento: {
				version: 1, clase: 'pasivo', conexiones: [{ entrada: 'entrada', salida: 'salida' }],
			},
		},
	);
	p.conductores = [
		cable('c1', ['red', 'L'], ['a1', '+24']), cable('c2', ['red', 'N'], ['a1', '0V']),
		cable('c3', ['b1', 'S'], ['x-custom', 'entrada']),
		cable('c4', ['x-custom', 'salida'], ['a1', 'UI1']),
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

	const sinRun = tableroVariador(false);
	r = simular(sinRun, { vfd: { valor: 10 } }, r.activos, { ahora: 6000, memoria });
	assert.equal(r.variadores[0].run, false);
	assert.equal(r.variadores[0].frecuenciaHz, 40);
	assert.equal(r.variadores[0].estado, 'decel', 'el VFD no anunció DECEL mientras aún entregaba frecuencia');
	assert.equal(r.activos.has('motor'), true, 'la salida U/V/W desapareció antes de acabar la desaceleración');

	r = simular(sinRun, { vfd: { valor: 10 } }, r.activos, { ahora: 11000, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 0);
	assert.equal(r.variadores[0].estado, 'listo');
	assert.equal(r.activos.has('motor'), false, 'el motor siguió alimentado después de llegar a 0 Hz');
});

test('la referencia del variador llega desde una AO cableada, sin leer el modelo interno', () => {
	const p = tableroVariador();
	p.dispositivos.push(
		{
			id: 'plc', tipo: 'plc', rangoSalidaAnalogica: [0, 10],
			bornes: ['+24', '0V', 'AO1', 'AOC'].map((id) => ({ id, tipo: 'control' as const })),
		},
		{
			id: 'x-custom', tipo: 'otro', bornes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
			comportamiento: { version: 1, clase: 'pasivo', conexiones: [
				{ entrada: 'a', salida: 'b' }, { entrada: 'c', salida: 'd' },
			] },
		},
	);
	p.conductores.push(
		cable('plc-p', ['red', 'L'], ['plc', '+24']), cable('plc-n', ['red', 'N'], ['plc', '0V']),
		cable('ref-a', ['plc', 'AO1'], ['x-custom', 'a']),
		cable('ref-b', ['x-custom', 'b'], ['vfd', 'SPEED']),
	);
	let r = simular(p, { plc: { analogicas: { AO1: 60 } } });
	assert.equal(r.variadores[0].referenciaPorcentaje, 0,
		'una señal analógica sin su común se aceptó como referencia válida');
	p.conductores.push(
		cable('ref-com-a', ['plc', 'AOC'], ['x-custom', 'c']),
		cable('ref-com-b', ['x-custom', 'd'], ['vfd', 'ACOM']),
	);
	r = simular(p, { plc: { analogicas: { AO1: 60 } } });
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

test('una carga importada sin corriente de placa conserva el supuesto y texto de su perfil', () => {
	const p = base24V();
	p.dispositivos.push(
		{
			id: 'h-nativo', tipo: 'piloto', bornes: [{ id: 'X1' }, { id: 'X2' }],
		},
		{
			id: 'h-importado', tipo: 'otro', imagen: 'data:image/png;base64,AA==',
			bornes: [{ id: 'positivo' }, { id: 'retorno' }],
			comportamiento: {
				version: 1, clase: 'carga',
				alimentacion: { fases: ['positivo'], retornos: ['retorno'], fasesMinimas: 1 },
				efecto: 'luz',
			},
		},
	);
	p.conductores = [
		cable('n-l', ['red', 'L'], ['h-nativo', 'X1']), cable('n-n', ['red', 'N'], ['h-nativo', 'X2']),
		cable('i-l', ['red', 'L'], ['h-importado', 'positivo']),
		cable('i-n', ['red', 'N'], ['h-importado', 'retorno']),
	];
	const r = simular(p);
	const consumos = new Map(r.consumos.map((c) => [c.dispositivoId, c.corriente]));
	assert.equal(consumos.get('h-nativo'), 0.02);
	assert.equal(consumos.get('h-importado'), consumos.get('h-nativo'),
		'la carcasa `otro` cambió la corriente supuesta del mismo perfil luminoso');
	const textos = new Map(r.funcionando.map((f) => [f.dispositivoId, f.que]));
	assert.match(textos.get('h-nativo') ?? '', /^encendido/);
	assert.equal(textos.get('h-importado'), textos.get('h-nativo'),
		'la carcasa visual cambió la descripción funcional de la misma carga');
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
