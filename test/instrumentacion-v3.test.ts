import test from 'node:test';
import assert from 'node:assert/strict';

import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { memoriaVacia, simular } from '../src/motores/simulacion.js';

const cable = (id: string, de: [string, string], a: [string, string]): Conductor => ({
	id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] },
});

const fuente24 = (): Dispositivo => ({
	id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Acometida 24 VDC', tensionNominal: 24,
	bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
});

const transmisor = (unidad: 'V' | 'mA' = 'mA', tipo: Dispositivo['tipo'] = 'sensor'): Dispositivo => ({
	id: 'tt1', tipo, imagen: tipo === 'otro' ? 'asset://transmisor' : undefined,
	designacion: '-BT1', bornes: ['+24', '0V', 'OUT'].map((id) => ({ id, tipo: id === 'OUT' ? 'senal' : 'control' })),
	comportamiento: {
		version: 1, clase: 'sensor', contactos: [], alimentacion: { entrada: '+24', retorno: '0V' },
		transmisor: {
			modoConexion: '3-hilos', modoSalida: 'activa',
			salida: { borne: 'OUT', comun: '0V', unidad, rango: unidad === 'V' ? [0, 10] : [4, 20] },
			variable: { magnitud: 'temperatura', unidad: '°C', minimo: 0, maximo: 100 },
		},
	},
});

const plc = (unidad: 'V' | 'mA' = 'mA', tipo: Dispositivo['tipo'] = 'plc'): Dispositivo => ({
	id: 'plc1', tipo, imagen: tipo === 'otro' ? 'asset://plc' : undefined, designacion: '-A1',
	bornes: ['+24', '0V', 'AI1', 'AIC', 'AO1', 'AOC'].map((id) => ({ id, tipo: /AI|AO/.test(id) ? 'senal' : 'control' })),
	programa: 'AO1 = 0 a 10 según AI1 de 0 a 100',
	comportamiento: {
		version: 1, clase: 'controlador', alimentacion: { entradas: ['+24'], retornos: ['0V'] },
		salidasDigitales: [],
		entradasAnalogicas: [{
			borne: 'AI1', comun: 'AIC', unidad, rango: unidad === 'V' ? [0, 10] : [4, 20],
			modoEntrada: 'pasiva', variable: { magnitud: 'temperatura', unidad: '°C', minimo: 0, maximo: 100 },
		}],
		salidasAnalogicas: [{ borne: 'AO1', referencia: 'AOC', unidad: 'V', rango: [0, 10] }],
	},
});

function tableroInstrumentacion(unidad: 'V' | 'mA' = 'mA'): Proyecto {
	const p = crearProyecto(`Instrumentación ${unidad}`);
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Instrumentación' }];
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [fuente24(), transmisor(unidad), plc(unidad)];
	p.conductores = [
		cable('c1', ['red', 'L'], ['tt1', '+24']), cable('c2', ['red', 'N'], ['tt1', '0V']),
		cable('c3', ['red', 'L'], ['plc1', '+24']), cable('c4', ['red', 'N'], ['plc1', '0V']),
		cable('c5', ['tt1', 'OUT'], ['plc1', 'AI1']), cable('c6', ['tt1', '0V'], ['plc1', 'AIC']),
	];
	return p;
}

test('transmisor 4–20 mA: variable física → señal → AI escalada', () => {
	const r = simular(tableroInstrumentacion('mA'), { tt1: { valor: 50 } });
	assert.equal(r.sensoresAnalogicos[0].variable.valor, 50);
	assert.equal(r.sensoresAnalogicos[0].senal.valorElectrico, 12);
	assert.equal(r.sensoresAnalogicos[0].senal.calidad, 'normal');
	assert.equal(r.entradasAnalogicas[0].senal.valorElectrico, 12);
	assert.equal(r.entradasAnalogicas[0].valorIngenieria, 50);
	assert.equal(r.controladores[0].sondas.AI1, 50);
});

test('sensor 0–10 V necesita alimentación y conserva unidades reales', () => {
	const p = tableroInstrumentacion('V');
	const sano = simular(p, { tt1: { valor: 50 } });
	assert.equal(sano.entradasAnalogicas[0].senal.valorElectrico, 5);
	assert.equal(sano.entradasAnalogicas[0].senal.unidadElectrica, 'V');
	p.conductores = p.conductores.filter((c) => c.id !== 'c1');
	const apagado = simular(p, { tt1: { valor: 50 } });
	assert.equal(apagado.entradasAnalogicas[0].senal.calidad, 'sin-alimentacion');
	assert.equal(apagado.controladores[0].sondas.AI1, undefined);
});

test('un lazo abierto invalida la AI: no entrega mágicamente el último valor', () => {
	const p = tableroInstrumentacion();
	const inyectado = simular(p, { tt1: { valor: 50, fallos: ['circuito-analogico-abierto'] } });
	assert.equal(inyectado.entradasAnalogicas[0].senal.calidad, 'circuito-abierto');
	assert.equal(inyectado.entradasAnalogicas[0].valorIngenieria, undefined);
	assert.equal(inyectado.controladores[0].sondas.AI1, undefined);
	p.conductores = p.conductores.filter((c) => c.id !== 'c5');
	const fisico = simular(p, { tt1: { valor: 50 } });
	assert.equal(fisico.entradasAnalogicas[0].senal.calidad, 'circuito-abierto');
});

test('transmisor de 2 hilos comprueba alimentación y retorno del lazo', () => {
	const p = crearProyecto('Lazo de dos hilos');
	const tx: Dispositivo = {
		id: 'tx2', tipo: 'sensor', bornes: [{ id: 'LOOP+' }, { id: 'LOOP-' }],
		comportamiento: {
			version: 1, clase: 'sensor', contactos: [], transmisor: {
				modoConexion: '2-hilos', modoSalida: 'pasiva',
				salida: { borne: 'LOOP-', comun: 'LOOP+', unidad: 'mA', rango: [4, 20] },
				variable: { magnitud: 'presion', unidad: 'bar', minimo: 0, maximo: 10 },
			},
		},
	};
	const ai = plc('mA');
	p.dispositivos = [fuente24(), tx, ai];
	p.conductores = [
		cable('l1', ['red', 'L'], ['tx2', 'LOOP+']), cable('l2', ['tx2', 'LOOP-'], ['plc1', 'AI1']),
		cable('l3', ['plc1', 'AIC'], ['red', 'N']), cable('l4', ['red', 'L'], ['plc1', '+24']),
		cable('l5', ['red', 'N'], ['plc1', '0V']),
	];
	const sano = simular(p, { tx2: { valor: 5 } });
	assert.equal(sano.entradasAnalogicas[0].senal.valorElectrico, 12);
	assert.equal(sano.entradasAnalogicas[0].valorIngenieria, 50);
	p.conductores = p.conductores.filter((c) => c.id !== 'l3');
	assert.equal(simular(p, { tx2: { valor: 5 } }).entradasAnalogicas[0].senal.calidad, 'circuito-abierto');
});

test('salida activa contra entrada activa se diagnostica como configuración incompatible', () => {
	const p = tableroInstrumentacion();
	const c = p.dispositivos.find((d) => d.id === 'plc1')!.comportamiento as Extract<ComportamientoSimulacion, { clase: 'controlador' }>;
	c.entradasAnalogicas![0].modoEntrada = 'activa';
	assert.equal(simular(p, { tt1: { valor: 50 } }).entradasAnalogicas[0].senal.calidad, 'senal-invalida');
});

test('perfiles importados reproducen transmisor y AI nativos después de guardar/cargar', () => {
	const nativo = tableroInstrumentacion();
	const importado = tableroInstrumentacion();
	importado.dispositivos[1] = transmisor('mA', 'otro');
	importado.dispositivos[2] = plc('mA', 'otro');
	const cargado = cargarProyecto(JSON.stringify(importado)).proyecto;
	const a = simular(nativo, { tt1: { valor: 75 } }).entradasAnalogicas[0];
	const b = simular(cargado, { tt1: { valor: 75 } }).entradasAnalogicas[0];
	assert.deepEqual({ mA: b.senal.valorElectrico, valor: b.valorIngenieria, calidad: b.senal.calidad },
		{ mA: a.senal.valorElectrico, valor: a.valorIngenieria, calidad: a.senal.calidad });
});

test('válvula modulante avanza con reloj, aplica fail-safe y publica feedback', () => {
	const p = tableroInstrumentacion();
	const valvula: Dispositivo = {
		id: 'yv1', tipo: 'valvula', designacion: '-YV1',
		bornes: ['+24', '0V', 'Y', 'M', 'FB', 'FBC'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'carga', efecto: 'movimiento',
			alimentacion: { fases: ['+24'], retornos: ['0V'], fasesMinimas: 1 },
			mandoAnalogico: { borne: 'Y', comun: 'M', unidad: 'V', rango: [0, 10] },
			dinamicaActuador: {
				tipo: 'modulante', tiempoAperturaS: 10, tiempoCierreS: 10, failSafe: 'cerrar',
				feedback: { borne: 'FB', comun: 'FBC', unidad: 'mA', rango: [4, 20] },
			},
		},
	};
	p.dispositivos.push(valvula);
	p.conductores.push(
		cable('v1', ['red', 'L'], ['yv1', '+24']), cable('v2', ['red', 'N'], ['yv1', '0V']),
		cable('v3', ['plc1', 'AO1'], ['yv1', 'Y']), cable('v4', ['plc1', 'AOC'], ['yv1', 'M']),
	);
	const memoria = memoriaVacia();
	const estado = { tt1: { valor: 50 } };
	const inicio = simular(p, estado, undefined, { ahora: 0, memoria });
	assert.equal(inicio.actuadores[0].posicionObjetivo, 50);
	assert.equal(inicio.actuadores[0].posicionActual, 0);
	const mitad = simular(p, estado, undefined, { ahora: 2500, memoria });
	assert.equal(mitad.actuadores[0].estado, 'abriendo');
	assert.equal(mitad.actuadores[0].posicionActual, 25);
	assert.equal(mitad.actuadores[0].feedback?.valorElectrico, 8);
	const fallo = simular(p, { ...estado, yv1: { fallos: ['circuito-analogico-abierto'] } }, undefined,
		{ ahora: 3750, memoria });
	assert.equal(fallo.actuadores[0].posicionObjetivo, 0);
	assert.equal(fallo.actuadores[0].posicionActual, 12.5);
	assert.equal(fallo.actuadores[0].estado, 'cerrando');
});

function tableroVfdAnalogico(perdidaSenal: 'detener' | 'mantener' | 'fallo' = 'detener', personalizado = false): Proyecto {
	const p = tableroInstrumentacion();
	const vfd: Dispositivo = {
		id: 'vfd1', tipo: personalizado ? 'otro' : 'variador', imagen: personalizado ? 'asset://vfd' : undefined,
		designacion: '-U1', bornes: ['L', 'N', 'RUN', 'AI1', 'COM', 'U', 'V', 'W'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'variador', alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 },
			mando: { run: 'RUN' },
			referencia: { borne: 'AI1', comun: 'COM', unidad: 'mA', rango: [4, 20], perdidaSenal },
			salida: { u: 'U', v: 'V', w: 'W', tensionV: 230 },
			frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 50 },
		},
	};
	p.dispositivos.push(vfd);
	p.conductores.push(
		cable('f1', ['red', 'L'], ['vfd1', 'L']), cable('f2', ['red', 'N'], ['vfd1', 'N']),
		cable('f3', ['red', 'L'], ['vfd1', 'RUN']), cable('f4', ['tt1', 'OUT'], ['vfd1', 'AI1']),
		cable('f5', ['tt1', '0V'], ['vfd1', 'COM']),
	);
	return p;
}

test('VFD recibe 4–20 mA cableados: 4/12/20 mA producen 0/25/50 Hz', () => {
	for (const [temperatura, esperado] of [[0, 0], [50, 25], [100, 50]] as const) {
		const r = simular(tableroVfdAnalogico(), { tt1: { valor: temperatura } });
		const vfd = r.variadores.find((v) => v.dispositivoId === 'vfd1')!;
		assert.equal(vfd.referenciaElectrica?.valorElectrico, 4 + temperatura * 0.16);
		assert.equal(vfd.frecuenciaHz, esperado);
		assert.equal(vfd.calidadReferencia, 'normal');
	}
});

test('pérdida de referencia VFD permite detener, mantener o entrar en FAULT según perfil', () => {
	const estadoNormal = { tt1: { valor: 50 } };
	const abierta = { tt1: { valor: 50, fallos: ['circuito-analogico-abierto' as const] } };
	const detenido = simular(tableroVfdAnalogico('detener'), abierta);
	assert.equal(detenido.variadores.at(-1)!.frecuenciaObjetivoHz, 0);
	assert.equal(detenido.variadores.at(-1)!.estado, 'marcha', 'el VFD conserva RUN pero ordena frecuencia segura cero');

	const memoria = memoriaVacia();
	simular(tableroVfdAnalogico('mantener'), estadoNormal, undefined, { ahora: 0, memoria });
	const mantiene = simular(tableroVfdAnalogico('mantener'), abierta, undefined, { ahora: 1000, memoria });
	assert.equal(mantiene.variadores.at(-1)!.referenciaPorcentaje, 50);
	assert.equal(mantiene.variadores.at(-1)!.falloEnclavado, false);

	const falla = simular(tableroVfdAnalogico('fallo'), abierta);
	assert.equal(falla.variadores.at(-1)!.estado, 'falla');
	assert.equal(falla.variadores.at(-1)!.motivoFalla, 'perdida-referencia');
});

test('AO de corriente conserva mA y un VFD personalizado recibe el mismo perfil', () => {
	const p = tableroInstrumentacion();
	const perfilPlc = p.dispositivos.find((d) => d.id === 'plc1')!.comportamiento as Extract<ComportamientoSimulacion, { clase: 'controlador' }>;
	perfilPlc.salidasAnalogicas[0] = { borne: 'AO1', referencia: 'AOC', unidad: 'mA', rango: [4, 20] };
	const ao = simular(p, { plc1: { analogicas: { AO1: 60 } } }).salidasAnalogicas.get('plc1::AO1')!;
	assert.equal(ao.valor, 13.6);
	assert.equal(ao.unidad, 'mA');
	assert.equal(ao.voltios, undefined);
	const nativo = simular(tableroVfdAnalogico('detener'), { tt1: { valor: 25 } }).variadores.at(-1)!;
	const importado = simular(tableroVfdAnalogico('detener', true), { tt1: { valor: 25 } }).variadores.at(-1)!;
	assert.deepEqual(
		{ ref: importado.referenciaPorcentaje, hz: importado.frecuenciaHz, calidad: importado.calidadReferencia },
		{ ref: nativo.referenciaPorcentaje, hz: nativo.frecuenciaHz, calidad: nativo.calidadReferencia },
	);
});
