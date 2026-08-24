import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { Dispositivo } from '../src/modelo/tipos.js';
import {
	cambiarFalloRuntime, fallosCompatibles, type TipoFalloRuntime,
} from '../src/motores/fallos-runtime.js';

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
