import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { asignarPlanesAutomaticos, prepararAsignacionPlanesAutomaticos, rutasDeCables } from '../app/escena3d.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { leerRutaFisicaV1 } from '../src/modelo/ruta-fisica.js';
import { geometriaDelPlanRuta, leerPlanRutaAutomaticaV1,
	MAX_PUNTOS_PLAN_AUTO, planDesdeRutaAutomatica } from '../src/modelo/plan-ruta-automatica.js';
import { firmaEntornoRutaAutomatica, marcarPlanesObsoletosPendientes } from '../src/modelo/dependencias-ruta.js';
import { longitudCoincidente3D } from '../app/colisiones-cables.js';

test('CAB-24: el plan automatico conserva XYZ exacto sin depender de la malla', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const ruta = rutasDeCables(proyecto).find((r) => r.conductorId === 'w4')!;
	const plan = planDesdeRutaAutomatica(ruta, 'entorno de prueba', 'fuente de prueba');
	const reabierto = leerPlanRutaAutomaticaV1(JSON.parse(JSON.stringify(plan)));
	const geometria = geometriaDelPlanRuta(reabierto);
	assert.deepEqual(geometria, { de: ruta.de, a: ruta.a, nodos: ruta.nodos, puntos: ruta.puntos });
	assert.ok(JSON.stringify(plan).length < JSON.stringify({ de: ruta.de, a: ruta.a,
		nodos: ruta.nodos, puntos: ruta.puntos }).length,
		'las series planas evitan repetir nombres de ejes por muestra');
});

test('CAB-24: una polilinea manual no se guarda como asignacion automatica', () => {
	assert.throws(() => planDesdeRutaAutomatica({ geometria: 'POLILINEA', radio: 2,
		de: { x: 0, y: 0, z: 0 }, a: { x: 10, y: 0, z: 0 },
		nodos: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
		puntos: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] }, 'entorno de prueba', 'fuente de prueba'), /MANUAL/);
});

test('CAB-24: planes asignados mantienen rutas ajenas al editar un solo cable y reabrir', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const antes = new Map(rutasDeCables(proyecto).map((r) => [r.conductorId, r.puntos]));
	assert.equal(asignarPlanesAutomaticos(proyecto), antes.size);
	const w4 = proyecto.conductores.find((c) => c.id === 'w4')!;
	delete w4.planRutaAutomatica;
	w4.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [
			{ id: 'w4:n1', x: 180, y: 110, z: 27 },
			{ id: 'w4:n2', x: 230, y: 110, z: 27 },
		] });
	const obtener = (p: typeof proyecto) => new Map(rutasDeCables(p).map((r) => [r.conductorId, r.puntos]));
	for (const [id, puntos] of obtener(proyecto)) {
		if (id !== 'w4') assert.deepEqual(puntos, antes.get(id), `${id} no debe redistribuirse`);
	}
	const abierto = cargarProyecto(JSON.stringify(proyecto));
	assert.deepEqual(abierto.arreglos, []);
	assert.deepEqual(obtener(abierto.proyecto), obtener(proyecto));
	abierto.proyecto.conductores.reverse();
	assert.deepEqual(obtener(abierto.proyecto), obtener(proyecto));
});

test('CAB-24: la aceptación focal no asigna planes ajenos de manera implícita', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const preparados = prepararAsignacionPlanesAutomaticos(proyecto, new Set(['w4']));
	assert.deepEqual(preparados.map((p) => p.conductorId), ['w4']);
	assert.equal(asignarPlanesAutomaticos(proyecto, preparados), 1);
	assert.equal(proyecto.conductores.filter((c) => c.planRutaAutomatica).length, 1);
});

test('CAB-24: un cable nuevo de mayor sección comparte borne sin mover planes aceptados', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	assert.equal(asignarPlanesAutomaticos(proyecto), 28);
	const antes = new Map(rutasDeCables(proyecto).map((r) => [r.conductorId, r.puntos]));
	const w4 = proyecto.conductores.find((c) => c.id === 'w4')!;
	const w5 = proyecto.conductores.find((c) => c.id === 'w5')!;
	proyecto.conductores.push({ id: 'w29', de: { ...w4.de }, a: { ...w5.a }, seccion: 6 });
	assert.deepEqual(marcarPlanesObsoletosPendientes(proyecto), [], 'agregar no invalida al vecino');
	const despues = new Map(rutasDeCables(proyecto).map((r) => [r.conductorId, r.puntos]));
	for (const [id, puntos] of antes) assert.deepEqual(despues.get(id), puntos, id);
	assert.ok(despues.has('w29'));
	assert.ok(longitudCoincidente3D(despues.get('w29')!, despues.get('w4')!) <= 4,
		'compartir tornillo no permite un mismo eje durante decenas de milímetros');
	assert.equal(asignarPlanesAutomaticos(proyecto, prepararAsignacionPlanesAutomaticos(proyecto,
		new Set(['w29']))), 1);
	const reabierto = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	assert.deepEqual(rutasDeCables(reabierto).find((r) => r.conductorId === 'w29')?.puntos,
		despues.get('w29'));
});

test('CAB-24: un plan con anclaje cambiado no se repara silenciosamente', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	assert.ok(asignarPlanesAutomaticos(proyecto) > 0);
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === 'km1')!;
	col.x += 5;
	assert.throws(() => rutasDeCables(proyecto), /desactualizado/);
});

test('CAB-24: la dependencia espacial distingue ducto cercano de aparato lejano', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const ruta = [{ x: 20, y: 100 }, { x: 100, y: 100 }];
	proyecto.gabinete!.canaletas = [{ id: 'cerca', x: 0, y: 100, largo: 120,
		orientacion: 'h', ancho: 40, alto: 40 }];
	proyecto.gabinete!.colocaciones = [{ dispositivoId: 'lejano', x: 400, y: 400, ancho: 50, alto: 50 }];
	const antes = firmaEntornoRutaAutomatica(proyecto, ruta, 2);
	proyecto.gabinete!.colocaciones[0].x += 10;
	assert.equal(firmaEntornoRutaAutomatica(proyecto, ruta, 2), antes);
	proyecto.gabinete!.canaletas[0].alto += 5;
	assert.notEqual(firmaEntornoRutaAutomatica(proyecto, ruta, 2), antes);
});

test('CAB-24: declarar la caja implicita no invalida planes fisicamente identicos', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	const ruta = rutasDeCables(proyecto).find((r) => r.conductorId === 'w4')!;
	const antes = firmaEntornoRutaAutomatica(proyecto, ruta.puntos, ruta.radio);
	const g = proyecto.gabinete!;
	g.caja = { ancho: g.ancho + 60, alto: g.alto + 60, profundidad: 160,
		bisagras: 'izquierda', bonding: { puesto: false, seccion: 6 } };
	assert.equal(firmaEntornoRutaAutomatica(proyecto, ruta.puntos, ruta.radio), antes);
	g.caja.profundidad += 20;
	assert.notEqual(firmaEntornoRutaAutomatica(proyecto, ruta.puntos, ruta.radio), antes);
});

test('CAB-24: la asignacion captura los cinco ejemplos sin cambiar su geometria visible', () => {
	for (const ejemplo of EJEMPLOS) {
		const proyecto = ejemplo.crear();
		const antes = rutasDeCables(proyecto).map((r) => ({ id: r.conductorId, puntos: r.puntos }));
		const numero = asignarPlanesAutomaticos(proyecto);
		assert.ok(numero > 0, ejemplo.titulo);
		const despues = rutasDeCables(proyecto).map((r) => ({ id: r.conductorId, puntos: r.puntos }));
		assert.deepEqual(despues, antes, ejemplo.titulo);
		const reabierto = cargarProyecto(JSON.stringify(proyecto));
		assert.ok(reabierto.arreglos.every((a) => a === 'no traía ninguna hoja de esquema'),
			`${ejemplo.titulo}: una reparación ajena al esquema no debe alterar el plan`);
		assert.deepEqual(rutasDeCables(reabierto.proyecto).map((r) => ({ id: r.conductorId, puntos: r.puntos })),
			antes, ejemplo.titulo);
	}
});

test('CAB-24: importacion rechaza plan obsoleto, version falsa o dos escritores', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	assert.ok(asignarPlanesAutomaticos(proyecto) > 0);
	const cable = proyecto.conductores.find((c) => c.id === 'w4')!;
	const obsoleto = structuredClone(proyecto);
	obsoleto.gabinete!.canaletas[0].alto += 5;
	assert.throws(() => cargarProyecto(JSON.stringify(obsoleto)), /plan automático no corresponde/);
	const versionFalsa = structuredClone(proyecto);
	versionFalsa.version = 3;
	assert.throws(() => cargarProyecto(JSON.stringify(versionFalsa)), /anterior a la versión 4/);
	const dosEscritores = structuredClone(proyecto);
	dosEscritores.conductores.find((c) => c.id === cable.id)!.trazado = [{ x: 10, y: 10 }];
	assert.throws(() => cargarProyecto(JSON.stringify(dosEscritores)), /simultáneos/);
});

test('CAB-24: mover una canaleta marca planes afectados pendientes sin perder su ruta anterior', () => {
	const proyecto = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	assert.ok(asignarPlanesAutomaticos(proyecto) > 0);
	const previo = new Map(proyecto.conductores.map((c) => [c.id, c.planRutaAutomatica]));
	const canaleta = proyecto.gabinete!.canaletas[0];
	canaleta.alto += 5;
	const ids = marcarPlanesObsoletosPendientes(proyecto);
	assert.ok(ids.length > 0);
	assert.ok(ids.length < proyecto.conductores.length,
		'la dependencia local no debe poner todo el tablero en revisión');
	for (const id of ids) {
		const c = proyecto.conductores.find((x) => x.id === id)!;
		assert.equal(c.estadoRutaFisica, 'pendiente');
		assert.deepEqual(c.planRutaAutomatica, previo.get(id), 'el plan anterior no se descarta');
	}
	proyecto.conductores.find((c) => c.id === ids[0])!.fisica =
		{ material: 'COBRE', longitudManualM: 2.5 };
	const cargado = cargarProyecto(JSON.stringify(proyecto));
	assert.deepEqual(cargado.arreglos, []);
	assert.deepEqual(cargado.proyecto.conductores.filter((c) => c.estadoRutaFisica === 'pendiente')
		.map((c) => c.id).sort(), ids);
	assert.equal(cargado.proyecto.conductores.find((c) => c.id === ids[0])!.fisica?.longitudManualM, 2.5,
		'la medición declarada no se pierde aunque la ruta ya no se use');
	assert.equal(rutasDeCables(cargado.proyecto).length, proyecto.conductores.length - ids.length);
});

test('CAB-24: plan truncado, hostil o demasiado grande se rechaza sin rerouting', () => {
	const bueno = { version: 1, modo: 'AUTO_ASIGNADO', marco: 'PLACA', radio: 2,
		entorno: 'prueba', fuente: 'prueba',
		de: [0, 0, 0], a: [10, 0, 0], nodosXY: [0, 0, 10, 0],
		puntosXYZ: [0, 0, 0, 10, 0, 0] };
	assert.deepEqual(leerPlanRutaAutomaticaV1(bueno).puntosXYZ, bueno.puntosXYZ);
	for (const malo of [
		{ ...bueno, version: 2 }, { ...bueno, puntosXYZ: [0, 0, 0, 10, 0] },
		{ ...bueno, puntosXYZ: [0, 0, 0, 11, 0, 0] },
		{ ...bueno, puntosXYZ: [0, 0, 0, NaN, 0, 0] },
		{ ...bueno, puntosXYZ: [0, 0, 0, 5001, 0, 0] },
		{ ...bueno, puntosXYZ: new Array((MAX_PUNTOS_PLAN_AUTO + 1) * 3).fill(0) },
		{ ...bueno, claveDesconocida: true },
	]) assert.throws(() => leerPlanRutaAutomaticaV1(malo));
});
