import assert from 'node:assert/strict';
import test from 'node:test';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { montarEsquema, type HojaEsq } from '../src/motores/esquema.js';
import { proyectarEstadoEsquema } from '../src/motores/estado-esquema-simulacion.js';
import { simular } from '../src/motores/simulacion.js';
import { claveBorne } from '../src/modelo/proyecto.js';

function arranqueDirecto() {
	const ejemplo = EJEMPLOS.find((e) => e.id === 'arranque-directo');
	assert.ok(ejemplo);
	const proyecto = ejemplo.crear();
	numerarDispositivos(proyecto);
	const hojas = montarEsquema(proyecto, calcularPotenciales(proyecto));
	const motor = proyecto.dispositivos.find((d) => d.tipo === 'motor');
	const marcha = proyecto.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''));
	const km = proyecto.dispositivos.find((d) => d.tipo === 'contactor');
	assert.ok(motor && marcha && km);
	const hoja = hojas.find((h) => h.simbolos.some((s) => s.dispositivoId === motor.id));
	assert.ok(hoja);
	return { proyecto, hoja, motor, marcha, km };
}

const hilo = (hoja: HojaEsq, id: string) => {
	const original = hoja.hilos.find((h) => h.conductorId === id);
	assert.ok(original, `el hilo ${id} no está en esta hoja`);
	return original;
};

test('START/STOP: solo el resultado real indica actividad y conductores vivos', () => {
	const { proyecto, hoja, motor, marcha, km } = arranqueDirecto();
	const parado = simular(proyecto);
	const arrancado = simular(proyecto, { [marcha.id]: { activo: true } });
	const detenido = simular(proyecto, { [proyecto.dispositivos.find((d) => /PARO/i.test(d.descripcion ?? ''))!.id]:
		{ activo: true } }, arrancado.activos);
	assert.equal(parado.activos.has(km.id), false);
	assert.equal(arrancado.activos.has(km.id), true);
	assert.equal(detenido.activos.has(km.id), false);
	const antes = proyectarEstadoEsquema({ proyecto, hoja, energizado: true, resultado: parado });
	const marchaEstado = proyectarEstadoEsquema({ proyecto, hoja, energizado: true, resultado: arrancado });
	const paroEstado = proyectarEstadoEsquema({ proyecto, hoja, energizado: true, resultado: detenido });
	const aparato = (proyeccion: typeof antes) => proyeccion.aparatos.find((a) => a.dispositivoId === motor.id);
	assert.equal(antes.modo, 'simulacion');
	assert.deepEqual(aparato(antes)?.funcion, { tipo: 'motor', estado: parado.motores.find((m) => m.dispositivoId === motor.id)?.estado });
	assert.deepEqual(aparato(marchaEstado)?.funcion,
		{ tipo: 'motor', estado: arrancado.motores.find((m) => m.dispositivoId === motor.id)?.estado });
	assert.deepEqual(aparato(paroEstado)?.funcion,
		{ tipo: 'motor', estado: detenido.motores.find((m) => m.dispositivoId === motor.id)?.estado });
	const cambio = marchaEstado.hilos.find((h) => h.estado === 'vivo'
		&& antes.hilos.find((otro) => otro.conductorId === h.conductorId)?.estado === 'no-registrado-vivo'
		&& paroEstado.hilos.find((otro) => otro.conductorId === h.conductorId)?.estado === 'no-registrado-vivo');
	assert.ok(cambio, 'START/STOP no cambiaron ningún hilo de la hoja del motor');
	assert.ok(arrancado.conductoresVivos.has(cambio.conductorId));
	assert.equal(paroEstado.hilos.find((h) => h.conductorId === cambio.conductorId)?.estado,
		'no-registrado-vivo');
	assert.ok(hilo(hoja, cambio.conductorId));
});

test('diseño, ausencia de snapshot e inestabilidad no se convierten en tensión por el número del hilo', () => {
	const { proyecto, hoja, marcha } = arranqueDirecto();
	const arrancado = simular(proyecto, { [marcha.id]: { activo: true } });
	const diseno = proyectarEstadoEsquema({ proyecto, hoja, energizado: false, resultado: arrancado });
	const sinSnapshot = proyectarEstadoEsquema({ proyecto, hoja, energizado: true });
	const inestable = proyectarEstadoEsquema({ proyecto, hoja, energizado: true,
		resultado: { ...arrancado, oscila: true } });
	assert.equal(diseno.modo, 'diseno');
	assert.ok(diseno.hilos.every((h) => h.estado === 'no-aplica'));
	assert.ok(diseno.aparatos.every((a) => a.actividad === 'no-aplica' && a.bornesConTension.length === 0));
	for (const proyeccion of [sinSnapshot, inestable]) {
		assert.ok(proyeccion.hilos.every((h) => h.estado === 'desconocido'));
		assert.ok(proyeccion.aparatos.every((a) => a.actividad === 'desconocida'
			&& a.bornesConTension.length === 0 && a.funcion === undefined));
	}
	assert.equal(sinSnapshot.modo, 'simulacion-sin-snapshot');
	assert.equal(inestable.modo, 'simulacion-inestable');
});

test('la proyección no muta modelo/hoja/runtime y no depende del orden de arrays', () => {
	const { proyecto, hoja, marcha } = arranqueDirecto();
	const resultado = simular(proyecto, { [marcha.id]: { activo: true } });
	const copiaProyecto = structuredClone(proyecto);
	const copiaHoja = structuredClone(hoja);
	const copiaResultado = structuredClone(resultado);
	const original = proyectarEstadoEsquema({ proyecto, hoja, energizado: true, resultado });
	assert.deepEqual(proyecto, copiaProyecto);
	assert.deepEqual(hoja, copiaHoja);
	assert.deepEqual(resultado, copiaResultado);
	const inversoProyecto = structuredClone(proyecto);
	inversoProyecto.dispositivos.reverse();
	inversoProyecto.conductores.reverse();
	for (const d of inversoProyecto.dispositivos) d.bornes.reverse();
	const inversaHoja = structuredClone(hoja);
	inversaHoja.hilos.reverse();
	inversaHoja.simbolos.reverse();
	assert.deepEqual(proyectarEstadoEsquema({ proyecto: inversoProyecto, hoja: inversaHoja,
		energizado: true, resultado }), original);
});

test('una vista huérfana queda desconocida; IDs visuales iguales no prueban frescura del snapshot', () => {
	const { proyecto, hoja, marcha, motor } = arranqueDirecto();
	const resultado = simular(proyecto, { [marcha.id]: { activo: true } });
	const modificado = structuredClone(proyecto);
	modificado.dispositivos = modificado.dispositivos.filter((d) => d.id !== motor.id);
	const proyeccion = proyectarEstadoEsquema({ proyecto: modificado, hoja, energizado: true, resultado });
	assert.equal(proyeccion.aparatos.find((a) => a.dispositivoId === motor.id)?.actividad, 'desconocida');
	// El resultado carece de projectId/hash: para una topología distinta con los mismos IDs
	// NO hay prueba de vigencia aquí. La integración debe invalidarlo al cambiar el proyecto.
});

test('cada representación ve solo sus pines; una identidad duplicada no gana por orden de array', () => {
	const { proyecto, marcha, km } = arranqueDirecto();
	const resultado = simular(proyecto, { [marcha.id]: { activo: true } });
	const borneVivo = km.bornes.find((b) => resultado.vivos.has(claveBorne({ dispositivoId: km.id, borneId: b.id })));
	assert.ok(borneVivo, 'el contactor no tiene un borne vivo en START');
	const borneOtro = km.bornes.find((b) => b.id !== borneVivo.id);
	assert.ok(borneOtro);
	const vista = (id: string, borneId: string): HojaEsq['simbolos'][number] => ({
		dispositivoId: km.id, representacionId: id, designacion: km.designacion ?? km.id,
		columna: 1, x: 0, y: 0, ancho: 10, alto: 10, trazos: [],
		pines: new Map([[borneId, { x: 0, y: 0 }]]),
	});
	const hoja = { hilos: [], simbolos: [vista('vista-viva', borneVivo.id), vista('vista-otra', borneOtro.id)] };
	const proyeccion = proyectarEstadoEsquema({ proyecto, hoja, energizado: true, resultado });
	assert.deepEqual(proyeccion.aparatos.find((a) => a.representacionId === 'vista-viva')?.bornesConTension,
		[borneVivo.id]);
	assert.ok(!proyeccion.aparatos.find((a) => a.representacionId === 'vista-otra')
		?.bornesConTension.includes(borneVivo.id));
	const hostil = structuredClone(proyecto);
	hostil.dispositivos.push(structuredClone(km));
	const a = proyectarEstadoEsquema({ proyecto: hostil, hoja, energizado: true, resultado });
	hostil.dispositivos.reverse();
	const b = proyectarEstadoEsquema({ proyecto: hostil, hoja, energizado: true, resultado });
	assert.deepEqual(a, b);
	assert.ok(a.aparatos.every((x) => x.actividad === 'desconocida' && !x.funcion));
});

test('referencia interhoja proyecta el mismo conductor vivo sin duplicar identidad', () => {
	const { proyecto, hoja, marcha } = arranqueDirecto();
	const resultado = simular(proyecto, { [marcha.id]: { activo: true } });
	const id = proyecto.conductores.find((c) => resultado.conductoresVivos.has(c.id))?.id;
	assert.ok(id);
	const referencia = { texto: 'otra hoja', p: { x: 10, y: 10 }, tipo: 'enlace' as const, conductorId: id };
	const soloReferencia = { hilos: [], simbolos: [], referencias: [referencia] };
	assert.deepEqual(proyectarEstadoEsquema({ proyecto, hoja: soloReferencia, energizado: true, resultado }).hilos,
		[{ conductorId: id, estado: 'vivo' }]);
	const repetido = { ...hoja, referencias: [...hoja.referencias, referencia] };
	const hilos = proyectarEstadoEsquema({ proyecto, hoja: repetido, energizado: true, resultado }).hilos;
	assert.equal(hilos.filter((h) => h.conductorId === id).length, 1);
});
