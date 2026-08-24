import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import {
	cambiarFalloRuntime, fallosCompatibles, type TipoFalloRuntime,
} from '../src/motores/fallos-runtime.js';
import { memoriaVacia, simular } from '../src/motores/simulacion.js';

const proteccion = (
	funcion: Extract<ComportamientoSimulacion, { clase: 'proteccion' }>['funcion'],
	tipo: Dispositivo['tipo'] = 'otro',
): Dispositivo => ({
	id: `p-${funcion}`, tipo,
	bornes: ['I', 'O'].map((id) => ({ id })),
	comportamiento: {
		version: 1, clase: 'proteccion', rearmable: funcion !== 'fusible', funcion,
		polos: [{ entrada: 'I', salida: 'O' }], contactos: [],
	},
});

test('fallos runtime: las opciones dependen del perfil funcional, no de marca, imagen o id', () => {
	const motor: Dispositivo = {
		id: 'foto-arbitraria', tipo: 'otro', imagen: 'asset://imagen',
		bornes: ['a', 'b', 'c'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'carga', efecto: 'giro',
			alimentacion: { fases: ['a', 'b', 'c'], retornos: [], fasesMinimas: 3 },
		},
	};
	assert.deepEqual(fallosCompatibles(motor), [
		'sobrecarga', 'motor-bloqueado', 'perdida-fase', 'subtension', 'sobretension',
	]);
	assert.deepEqual(fallosCompatibles(proteccion('diferencial')), ['fuga-tierra']);
	assert.deepEqual(fallosCompatibles(proteccion('fusible')), ['sobrecarga', 'cortocircuito']);
});

test('fallos runtime: activar y quitar una condición no muta ni se serializa en Proyecto', () => {
	const inicial: { activo: boolean; fallos?: TipoFalloRuntime[] } = { activo: true };
	const conFallo = cambiarFalloRuntime(inicial, 'sobrecarga', true);
	assert.deepEqual(inicial, { activo: true });
	assert.deepEqual(conFallo, { activo: true, fallos: ['sobrecarga'] });
	assert.deepEqual(cambiarFalloRuntime(conFallo, 'sobrecarga', false), { activo: true });

	const proyecto = crearProyecto('Runtime separado');
	proyecto.dispositivos = [proteccion('termico')];
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyecto.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	const cargado = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	assert.equal(JSON.stringify(cargado).includes('fallos'), false);
	assert.equal(
		(cargado.dispositivos[0].comportamiento as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>).funcion,
		'termico',
	);
});

test('perfiles V1 antiguos conservan compatibilidad y reciben capacidad legacy solo si es inequívoca', () => {
	const fusible = proteccion(undefined, 'fusible');
	delete (fusible.comportamiento as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>).funcion;
	assert.deepEqual(fallosCompatibles(fusible), ['sobrecarga', 'cortocircuito']);

	const ambiguo = proteccion(undefined, 'otro');
	delete (ambiguo.comportamiento as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>).funcion;
	assert.deepEqual(fallosCompatibles(ambiguo), [], 'un perfil antiguo ambiguo no debe inventar mecanismo');
});

const cable = (id: string, de: [string, string], a: [string, string]): Conductor => ({
	id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] },
});

function tableroMotorV2(): Proyecto {
	const p = crearProyecto('Motor V2');
	p.opciones = { ...p.opciones, frecuenciaHz: 50 };
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Red trifásica', tensionNominal: 400,
			bornes: ['L1', 'L2', 'L3'].map((id) => ({ id, tipo: 'L' as const })),
		},
		{
			id: 'motor', tipo: 'otro', imagen: 'asset://motor-importado', tensionNominal: 400, corrienteNominal: 4,
			bornes: ['U', 'V', 'W'].map((id) => ({ id, tipo: 'L' as const })),
			comportamiento: {
				version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U', 'V', 'W'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 2, tiempoParadaS: 4 },
			},
		},
	];
	p.conductores = [
		cable('c1', ['red', 'L1'], ['motor', 'U']), cable('c2', ['red', 'L2'], ['motor', 'V']),
		cable('c3', ['red', 'L3'], ['motor', 'W']),
	];
	return p;
}

test('motor V2: la transición usa reloj, acelera y desacelera sin depender del FPS', () => {
	const p = tableroMotorV2();
	const memoria = memoriaVacia();
	let r = simular(p, {}, undefined, { ahora: 0, memoria });
	assert.equal(r.motores[0].estado, 'arrancando');
	assert.equal(r.motores[0].velocidadActual, 0);
	r = simular(p, {}, r.activos, { ahora: 1000, memoria });
	assert.equal(r.motores[0].velocidadActual, 0.5);
	r = simular(p, {}, r.activos, { ahora: 2000, memoria });
	assert.equal(r.motores[0].estado, 'marcha');
	assert.equal(r.motores[0].velocidadActual, 1);
	assert.equal(r.motores[0].rpmSincronas, 1500);
	assert.equal(r.motores[0].rpmOrigen, 'estimado');

	const sinRed = { ...p, conductores: [] };
	r = simular(sinRed, {}, r.activos, { ahora: 3000, memoria });
	assert.equal(r.motores[0].estado, 'desacelerando');
	assert.equal(r.motores[0].velocidadActual, 0.75);
	r = simular(sinRed, {}, r.activos, { ahora: 6000, memoria });
	assert.equal(r.motores[0].estado, 'detenido');
	assert.equal(r.motores[0].velocidadActual, 0);
});

test('motor V2: pérdida de fase real o inyectada es FALLO, no marcha sana', () => {
	const p = tableroMotorV2();
	p.conductores.pop();
	let r = simular(p);
	assert.equal(r.motores[0].estado, 'falla');
	assert.equal(r.motores[0].motivoFalla, 'perdida-fase');
	assert.equal(r.motores[0].fasesPresentes, 2);

	r = simular(tableroMotorV2(), { motor: { fallos: ['perdida-fase'] } });
	assert.equal(r.motores[0].estado, 'falla');
	assert.equal(r.motores[0].motivoFalla, 'perdida-fase');
});

test('motor V2: sin polos publica velocidad relativa y no inventa RPM', () => {
	const p = tableroMotorV2();
	const motor = p.dispositivos.find((d) => d.id === 'motor')!;
	if (motor.comportamiento?.clase === 'carga') delete motor.comportamiento.dinamicaMotor;
	const r = simular(p);
	assert.equal(r.motores[0].velocidadPorcentaje, 100);
	assert.equal(r.motores[0].rpmEstimada, undefined);
	assert.equal(r.motores[0].rpmOrigen, 'no-disponible');
});
