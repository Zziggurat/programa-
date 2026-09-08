import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureMotorPlacaV6, fixtureTransformadorV6, fixtureVfdMotorV6 } from '../ejemplo/fixtures-fisica-v6.js';
import { resolverComportamiento } from '../src/modelo/comportamiento.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { publicarRevision } from '../src/datos-tecnicos/hash.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { claveDato, referenciaTecnica, type DatoTecnico, type FamiliaTecnica, type RevisionCurvaTecnica } from '../src/datos-tecnicos/tipos.js';
import { magnitud } from '../src/fisica/complejos.js';
import { CURVAS_PROTECCION_GENERICAS, evaluarCurva } from '../src/fisica/protecciones.js';
import { perfilCurvaProteccionDispositivo, simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { actualizarProteccionesRuntime, memoriaVacia, simular, type EstadoTablero } from '../src/motores/simulacion.js';
import { curvaTecnica, datoTecnico, productoTecnico } from './helpers/datos-tecnicos.js';

function vincular(p: Proyecto, id: string, familia: FamiliaTecnica, campos: DatoTecnico[], curva?: RevisionCurvaTecnica) {
	const producto = productoTecnico({ id: `producto-${id}`, familia, campos,
		...(curva ? { curva: referenciaTecnica(curva) } : {}) });
	p.datosTecnicos ??= { version: 1, revisiones: [], vinculos: [], instalaciones: [] };
	p.datosTecnicos.revisiones.push(producto, ...(curva ? [curva] : []));
	p.datosTecnicos.vinculos.push({ entidad: 'DEVICE', entidadId: id, producto: referenciaTecnica(producto),
		condiciones: { sistema: 'AC', tensionV: 230 },
		decisiones: Object.fromEntries(campos.map(d => [claveDato(d), { modo: 'CATALOGO' as const }])) });
	return producto;
}
const cerca = (actual: number, esperado: number, error = 1e-8) =>
	assert.ok(Math.abs(actual - esperado) <= error * Math.max(1, Math.abs(esperado)), `${actual} ≠ ${esperado}`);

function todasFinitas(valor: unknown, camino = 'resultado'): void {
	if (typeof valor === 'number') assert.ok(Number.isFinite(valor), `${camino}: ${valor}`);
	else if (valor instanceof Map) for (const [k, v] of valor) todasFinitas(v, `${camino}.${k}`);
	else if (valor && typeof valor === 'object') for (const [k, v] of Object.entries(valor)) todasFinitas(v, `${camino}.${k}`);
}

test('V8 runtime: proyección común no muta diseño, no cachea el original mutable y reconoce su snapshot efectivo', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'm1', 'MOTOR', [datoTecnico('motor.corrienteNominalA', 7, 'A')]);
	const texto = JSON.stringify(p); const a = resolverProyectoTecnico(p);
	assert.equal(a.proyecto.dispositivos.find(d => d.id === 'm1')!.fisica!.motor!.corrienteNominalA, 7);
	assert.equal(resolverProyectoTecnico(a.proyecto), a);
	assert.equal(JSON.stringify(p), texto);
	p.datosTecnicos!.vinculos[0].decisiones['motor.corrienteNominalA@'] = {
		modo: 'OVERRIDE', dato: datoTecnico('motor.corrienteNominalA', 9, 'A'),
	};
	const b = resolverProyectoTecnico(p);
	assert.notEqual(b.proyecto, a.proyecto);
	assert.equal(b.proyecto.dispositivos.find(d => d.id === 'm1')!.corrienteNominal, 9);
	assert.equal(a.proyecto.dispositivos.find(d => d.id === 'm1')!.corrienteNominal, 7);
});

test('V8 runtime: motor vinculado consume In, potencia, polos, rpm y arranque desde la misma placa', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'm1', 'MOTOR', [datoTecnico('motor.corrienteNominalA', 7, 'A'),
		datoTecnico('motor.potenciaMecanicaNominalW', 2200, 'W'), datoTecnico('motor.polos', 8, '1'),
		datoTecnico('motor.rpmNominal', 725, 'rpm'), datoTecnico('motor.tiempoArranqueS', 4, 's')]);
	const texto = JSON.stringify(p); const memoria = memoriaVacia(); const estado = { 's-run': { activo: true } };
	const a = simular(p, estado, undefined, { ahora: 0, memoria });
	const b = simular(p, estado, a.activos, { ahora: 2000, memoria });
	assert.equal(b.motores[0].corrienteNominalA, 7);
	assert.equal(b.fisica.motores.get('m1')!.corrienteNominalUsadaA, 7);
	assert.equal(b.motores[0].duracionArranqueEstimadaS, 4);
	cerca(b.motores[0].progresoArranque, .5);
	assert.equal(b.motores[0].rpmSincronas, 750);
	assert.equal(b.motores[0].rpmEstimada, 363);
	const repetida = simular(resolverProyectoTecnico(p).proyecto, estado, b.activos, { ahora: 2000, memoria });
	assert.equal(repetida.motores[0].progresoArranque, b.motores[0].progresoArranque);
	assert.equal(repetida.motores[0].rpmEstimada, b.motores[0].rpmEstimada);
	assert.equal(JSON.stringify(p), texto);
	todasFinitas(b);
});

test('V8 runtime: motor personalizado y nativo equivalentes tras cargar y reordenar revisiones/dispositivos', () => {
	const nativo = fixtureMotorPlacaV6();
	vincular(nativo, 'm1', 'MOTOR', [datoTecnico('motor.corrienteNominalA', 6, 'A')]);
	const custom = cargarProyecto(JSON.stringify(nativo)).proyecto;
	const motor = custom.dispositivos.find(d => d.id === 'm1')!;
	motor.comportamiento = structuredClone(resolverComportamiento(motor)!);
	motor.tipo = 'otro'; motor.imagen = 'asset://imagen-no-elige-comportamiento';
	custom.dispositivos.reverse(); custom.conductores.reverse(); custom.datosTecnicos!.revisiones.reverse();
	const ejecutar = (p: Proyecto) => simular(p, { 's-run': { activo: true } });
	const a = ejecutar(nativo), b = ejecutar(custom);
	assert.deepEqual(a.motores, b.motores);
	cerca(a.fisica.motores.get('m1')!.corrienteA, b.fisica.motores.get('m1')!.corrienteA);
	assert.equal(b.fisica.motores.get('m1')!.corrienteNominalUsadaA, 6);
});

test('V8 runtime: VFD vinculado alinea frecuencia y tensión funcional con PhysicsEngine', () => {
	const p = fixtureVfdMotorV6();
	vincular(p, 'vfd', 'VFD', [datoTecnico('vfd.frecuenciaMaxHz', 40, 'Hz'),
		datoTecnico('vfd.frecuenciaBaseHz', 40, 'Hz'), datoTecnico('vfd.tensionSalidaMaxV', 320, 'V')]);
	const memoria = memoriaVacia(); const estado = { 's-run': { activo: true }, vfd: { valor: 10 } };
	const a = simular(p, estado, undefined, { ahora: 0, memoria });
	const b = simular(p, estado, a.activos, { ahora: 4000, memoria });
	assert.equal(b.variadores[0].frecuenciaObjetivoHz, 40);
	assert.equal(b.variadores[0].frecuenciaHz, 40);
	assert.equal(b.variadores[0].frecuenciaNominalHz, 40);
	cerca(b.fisica.variadores.get('vfd')!.tensionSalidaV, 320);
	assert.equal(b.vivos.get('vfd::U')!.tension, 320);
	assert.equal(b.motores[0].frecuenciaElectricaHz, 40);
	todasFinitas(b);
});

test('V8 runtime: VFD vinculado importado conserva rampa/salida de su equivalente nativo', () => {
	const nativo = fixtureVfdMotorV6();
	vincular(nativo, 'vfd', 'VFD', [datoTecnico('vfd.frecuenciaMaxHz', 40, 'Hz'), datoTecnico('vfd.frecuenciaBaseHz', 40, 'Hz')]);
	const custom = cargarProyecto(JSON.stringify(nativo)).proyecto;
	const d = custom.dispositivos.find(d => d.id === 'vfd')!;
	d.tipo = 'otro'; d.imagen = 'asset://vfd-misma-semantica';
	const ejecutar = (p: Proyecto) => {
		const memoria = memoriaVacia(), estado = { 's-run': { activo: true }, vfd: { valor: 10 } };
		const a = simular(p, estado, undefined, { ahora: 0, memoria });
		return simular(p, estado, a.activos, { ahora: 4000, memoria });
	};
	const a = ejecutar(nativo), b = ejecutar(custom);
	assert.deepEqual(a.variadores, b.variadores);
	assert.deepEqual(a.motores, b.motores);
	assert.deepEqual(a.fisica.variadores.get('vfd'), b.fisica.variadores.get('vfd'));
});

test('V8 runtime: fuente vinculada alimenta igual dominio funcional y físico, sin duplicar fuentes', () => {
	const p = fixtureTransformadorV6();
	vincular(p, 'red', 'FUENTE', [datoTecnico('fuente.tensionNominalV', 120, 'V'), datoTecnico('fuente.rOhm', .2, 'ohm')]);
	const r = simular(p, {}); const directo = simularFisicaProyecto(p);
	assert.equal(r.vivos.get('red::L')!.tension, 120);
	assert.equal(r.fisica.red.fuentes.size, 1);
	assert.equal(directo.red.fuentes.size, 1);
	cerca(magnitud(r.fisica.red.fuentes.get('fuente:red:0')!.corrienteEntregadaA), magnitud(directo.red.fuentes.get('fuente:red:0')!.corrienteEntregadaA));
	assert.ok(magnitud(directo.red.nodos.get('red::L')!.tensionV!) < 120);
	todasFinitas(r);
});

test('V8 runtime: transformador vinculado conserva modelo acoplado y actualiza secundario de mando', () => {
	const p = fixtureTransformadorV6();
	vincular(p, 't1', 'TRANSFORMADOR', [datoTecnico('transformador.secundarioV', 46, 'V')]);
	const r = simular(p, {}); const directo = simularFisicaProyecto(p);
	assert.equal(r.vivos.get('t1::S1')!.tension, 46);
	assert.equal(r.fisica.red.fuentes.size, 1, 'el secundario NO se añade como otra fuente ideal');
	assert.equal(r.fisica.red.transformadores.size, 1);
	const t = directo.red.transformadores.get('transformador:t1')!;
	assert.ok(magnitud(t.tensionSecundariaV) > 44 && magnitud(t.tensionSecundariaV) < 46);
	cerca(magnitud(t.corrienteSecundariaA) / magnitud(t.corrientePrimariaA), 5);
	assert.ok(Math.abs(directo.red.metricas.errorBalanceW) < .1);
});

test('V8 runtime: dato de motor no aplicable no produce NaN ni Infinity por placa parcial', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'm1', 'MOTOR', [{ ...datoTecnico('motor.eficiencia', .9, '1'), condiciones: { sistema: 'DC' } }]);
	assert.equal(resolverProyectoTecnico(p).resoluciones[0].estado, 'NOT_APPLICABLE');
	const r = simular(p, { 's-run': { activo: true } });
	todasFinitas(r);
	assert.equal(r.motores.length, 0, 'no publica marcha sana con una placa técnica no aplicable');
	assert.equal(r.fisica.motores.has('m1'), false);
});

test('V8 runtime: intervalo de placa no se fuerza a número ni se elige un punto implícito', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'm1', 'MOTOR', [datoTecnico('motor.eficiencia', [.8, .9], '1')]);
	const resuelta = resolverProyectoTecnico(p);
	assert.deepEqual(resuelta.resoluciones[0].dato?.valor, [.8, .9], 'la información original del intervalo se conserva');
	const r = simular(p, { 's-run': { activo: true } });
	todasFinitas(r);
	assert.equal(r.fisica.motores.has('m1'), false, 'no se estima una eficiencia puntual sin decisión explícita');
});

test('V8 curvas: legacy mantiene su ventana genérica y la ficha usa interpolación declarada', () => {
	const legacy = evaluarCurva(CURVAS_PROTECCION_GENERICAS.C, 30, 10);
	assert.equal(legacy.region, 'TERMICA'); assert.equal(legacy.tecnica, undefined);
	const p = fixtureMotorPlacaV6(); const curva = curvaTecnica({ interpolacion: 'LINEAR' });
	vincular(p, 'q1', 'PROTECCION', [datoTecnico('proteccion.inA', 10, 'A')], curva);
	const perfil = perfilCurvaProteccionDispositivo(p.dispositivos.find(d => d.id === 'q1')!, p);
	const medio = evaluarCurva(perfil, 30, 10);
	assert.equal(medio.tecnica?.estado, 'RESOLVED'); cerca(medio.tMinS!, 5.05); cerca(medio.tMaxS!, 10.5);
	assert.equal(medio.tecnica?.procedencia?.origen, 'SINTETICO');
	assert.equal(medio.origen, 'ESTIMADO');
});

test('V8 curvas: dominio cerrado no hereda umbral magnético ni extrapolación del legacy', () => {
	const p = fixtureMotorPlacaV6(); vincular(p, 'q1', 'PROTECCION', [], curvaTecnica());
	const perfil = perfilCurvaProteccionDispositivo(p.dispositivos.find(d => d.id === 'q1')!, p);
	for (const corriente of [0, 5, 60, 10000]) {
		const e = evaluarCurva(perfil, corriente, 10);
		assert.equal(e.region, 'NO_MODELADA'); assert.equal(e.tecnica?.estado, 'OUT_OF_DOMAIN');
		assert.equal(e.tMinS, undefined); assert.equal(e.tMaxS, undefined);
	}
	assert.equal(evaluarCurva(perfil, 10, 10).tecnica?.estado, 'RESOLVED');
	assert.equal(evaluarCurva(perfil, 50, 10).tecnica?.estado, 'RESOLVED');
});

test('V8 curvas: EXACT_ONLY rechaza coordenada intermedia y amperios no depende de In', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'q1', 'PROTECCION', [], curvaTecnica({ base: 'AMPERIOS', interpolacion: 'EXACT_ONLY' }));
	const perfil = perfilCurvaProteccionDispositivo(p.dispositivos.find(d => d.id === 'q1')!, p);
	const exacta = evaluarCurva(perfil, 1, 0);
	assert.equal(exacta.tecnica?.estado, 'RESOLVED'); assert.equal(exacta.tMaxS, 20);
	assert.notEqual(evaluarCurva(perfil, 3, 10).tecnica?.estado, 'RESOLVED');
	assert.equal(evaluarCurva(perfil, 3, 10).tMaxS, undefined);
});

test('V8 curvas: condiciones AC/DC incompatibles o dato condicional ausente no usan ventana legacy', () => {
	for (const condiciones of [{ sistema: 'DC' as const }, { sistema: 'AC' as const, temperaturaC: [20, 30] as [number, number] }]) {
		const p = fixtureMotorPlacaV6(); vincular(p, 'q1', 'PROTECCION', [], curvaTecnica({ condiciones }));
		const e = evaluarCurva(perfilCurvaProteccionDispositivo(p.dispositivos.find(d => d.id === 'q1')!, p), 10, 10);
		assert.equal(e.region, 'NO_MODELADA'); assert.equal(e.tMaxS, undefined);
		assert.ok(['MISSING', 'NOT_APPLICABLE'].includes(e.tecnica!.estado));
	}
});

test('V8 curvas: dos contenidos distintos de una revisión son conflicto independientemente del orden', () => {
	for (const invertir of [false, true]) {
		const p = fixtureMotorPlacaV6(); const curva = curvaTecnica(); vincular(p, 'q1', 'PROTECCION', [], curva);
		p.datosTecnicos!.revisiones.push(publicarRevision({ ...curva, nombre: 'Contenido divergente' }));
		if (invertir) p.datosTecnicos!.revisiones.reverse();
		const e = evaluarCurva(perfilCurvaProteccionDispositivo(p.dispositivos.find(d => d.id === 'q1')!, p), 10, 10);
		assert.equal(e.region, 'NO_MODELADA'); assert.equal(e.tMaxS, undefined);
		assert.match(e.explicacion, /CONFLICT/);
	}
});

test('V8 curvas: revisión ausente/corrupta/hash incorrecto no cae en la curva genérica anterior', () => {
	for (const defecto of ['ausente', 'corrupta', 'producto-corrupto', 'producto-ausente', 'pin-erroneo'] as const) {
		const p = fixtureMotorPlacaV6(); const curva = curvaTecnica(); vincular(p, 'q1', 'PROTECCION', [], curva);
		if (defecto === 'ausente') p.datosTecnicos!.revisiones = p.datosTecnicos!.revisiones.filter(r => r.tipo !== 'CURVA');
		if (defecto === 'producto-ausente') p.datosTecnicos!.revisiones = p.datosTecnicos!.revisiones.filter(r => r.tipo !== 'PRODUCTO');
		if (defecto === 'corrupta') curva.puntos[0].maximoS = 99;
		if (defecto === 'producto-corrupto') p.datosTecnicos!.revisiones[0].nombre += '-corrupto';
		if (defecto === 'pin-erroneo') p.datosTecnicos!.vinculos[0].producto.hash = `sha256:${'f'.repeat(64)}`;
		const perfil = perfilCurvaProteccionDispositivo(p.dispositivos.find(d => d.id === 'q1')!, p);
		const e = evaluarCurva(perfil, 10000, 10);
		assert.equal(e.region, 'NO_MODELADA', defecto); assert.equal(e.tMaxS, undefined, defecto);
	}
});

test('V8 runtime: curva fuera de dominio no dispara mediante timer/atajo legacy encubierto', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'q1', 'PROTECCION', [datoTecnico('proteccion.inA', 1, 'A')], curvaTecnica({ base: 'AMPERIOS' }));
	const memoria = memoriaVacia(); const estado: EstadoTablero = { 's-run': { activo: true }, m1: { fallos: ['motor-bloqueado'] } };
	const r = simular(p, estado, undefined, { ahora: 0, memoria });
	assert.equal(r.fisica.protecciones.get('q1')!.evaluacion.tecnica?.estado, 'OUT_OF_DOMAIN');
	actualizarProteccionesRuntime(p, estado, r, 0, memoria);
	const despues = actualizarProteccionesRuntime(p, estado, r, 100000, memoria);
	assert.equal(despues.estado.q1?.disparado, undefined); assert.equal(despues.eventos.length, 0);
	const inyectado = actualizarProteccionesRuntime(p, { ...estado, q1: { fallos: ['cortocircuito'] } }, r, 100001, memoria);
	assert.equal(inyectado.estado.q1.disparado, true);
	assert.equal(inyectado.eventos[0].origen, 'inyectado');
});

test('V8 runtime: ventana técnica acumula una sola vez por Δt y usa segundos de la revisión', () => {
	const p = fixtureMotorPlacaV6();
	vincular(p, 'q1', 'PROTECCION', [datoTecnico('proteccion.inA', 1, 'A')], curvaTecnica({ base: 'AMPERIOS',
		puntos: [{ corriente: 1, minimoS: 4, maximoS: 4 }, { corriente: 1000, minimoS: 4, maximoS: 4 }] }));
	const memoria = memoriaVacia(); const estado: EstadoTablero = { 's-run': { activo: true }, m1: { fallos: ['motor-bloqueado'] } };
	const r = simular(p, estado, undefined, { ahora: 0, memoria });
	actualizarProteccionesRuntime(p, estado, r, 0, memoria);
	actualizarProteccionesRuntime(p, estado, r, 2000, memoria);
	cerca(memoria.protecciones!.q1.cargaTermica, .5);
	actualizarProteccionesRuntime(p, estado, r, 2000, memoria);
	cerca(memoria.protecciones!.q1.cargaTermica, .5);
	assert.equal(actualizarProteccionesRuntime(p, estado, r, 4000, memoria).estado.q1.disparado, true);
});

test('V8 runtime: protección importada usa idéntica curva fijada y disparo que una nativa', () => {
	const nativo = fixtureMotorPlacaV6();
	vincular(nativo, 'q1', 'PROTECCION', [datoTecnico('proteccion.inA', 1, 'A')], curvaTecnica({ base: 'AMPERIOS',
		puntos: [{ corriente: 1, minimoS: 4, maximoS: 4 }, { corriente: 1000, minimoS: 4, maximoS: 4 }] }));
	const custom = cargarProyecto(JSON.stringify(nativo)).proyecto;
	const d = custom.dispositivos.find(d => d.id === 'q1')!;
	d.tipo = 'otro'; d.imagen = 'asset://proteccion-misma-semantica';
	const ejecutar = (p: Proyecto) => {
		const memoria = memoriaVacia(); const estado: EstadoTablero = { 's-run': { activo: true }, m1: { fallos: ['motor-bloqueado'] } };
		const r = simular(p, estado, undefined, { ahora: 0, memoria });
		actualizarProteccionesRuntime(p, estado, r, 0, memoria);
		return { evaluacion: r.fisica.protecciones.get('q1')!.evaluacion,
			disparo: actualizarProteccionesRuntime(p, estado, r, 4000, memoria) };
	};
	const a = ejecutar(nativo), b = ejecutar(custom);
	assert.deepEqual(a, b); assert.equal(b.disparo.estado.q1.disparado, true);
});

test('V8 curvas: snapshot mantiene revisión fijada; orden y roundtrip no adoptan una revisión posterior', () => {
	const p = fixtureMotorPlacaV6(); const curva = curvaTecnica(); vincular(p, 'q1', 'PROTECCION', [], curva);
	p.datosTecnicos!.revisiones.push(publicarRevision({ ...curva, revision: 2,
		puntos: [{ corriente: 1, minimoS: 1, maximoS: 2 }, { corriente: 5, minimoS: .01, maximoS: .1 }] }));
	const q = cargarProyecto(JSON.stringify(p)).proyecto; q.datosTecnicos!.revisiones.reverse();
	const evalua = (proyecto: Proyecto) => evaluarCurva(perfilCurvaProteccionDispositivo(proyecto.dispositivos.find(d => d.id === 'q1')!, proyecto), 10, 10);
	assert.equal(evalua(p).tMaxS, 20); assert.deepEqual(evalua(p), evalua(q));
});

test('V8 UI: snapshot reutilizado entre ticks, aislado de edición y renovado tras invalidar/cambiar proyecto', async () => {
	const previos = new Map(['document', 'getComputedStyle', 'MutationObserver'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelectorAll: () => [], getElementById: () => undefined } });
	Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ getPropertyValue: () => '' }) });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	try {
		const { SnapshotProyectoSimulacion } = await import('../app/ui-simulacion.js');
		let original = fixtureMotorPlacaV6(); let lecturas = 0;
		vincular(original, 'm1', 'MOTOR', [datoTecnico('motor.corrienteNominalA', 7, 'A')]);
		const snapshot = new SnapshotProyectoSimulacion(() => { lecturas++; return original; });
		const primero = snapshot.obtener();
		for (let i = 0; i < 100; i++) assert.equal(snapshot.obtener(), primero);
		assert.equal(lecturas, 1);
		original.nombre = 'Edición aún no invalidada';
		assert.notEqual(snapshot.obtener().nombre, original.nombre);
		snapshot.invalidar(); assert.equal(snapshot.obtener().nombre, original.nombre); assert.equal(lecturas, 2);
		original = fixtureTransformadorV6(); snapshot.invalidar();
		assert.equal(snapshot.obtener().nombre, original.nombre); assert.equal(lecturas, 3);
		assert.notEqual(snapshot.obtener(), original, 'también legacy tiene snapshot aislado del diseño');
	} finally {
		for (const [k, descriptor] of previos) {
			if (descriptor) Object.defineProperty(globalThis, k, descriptor);
			else Reflect.deleteProperty(globalThis, k);
		}
	}
});
