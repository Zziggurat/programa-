import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, TubeGeometry, Vector3 } from 'three';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto, VERSION_FORMATO } from '../src/modelo/cargar.js';
import { admiteRutaEnPlaca, desplazarTramoInteriorM6, leerRutaFisicaV1, longitudPolilineaMm,
	MAX_NODOS_RUTA_M6, rutaDesdeTrazadoLegacy } from '../src/modelo/ruta-fisica.js';
import { construirUnCable, diagnosticoRutaManual, largoDibujadoMm, liberar, longitudesParaRevisionMm,
	rutaProvisional, rutasDeCables, salidasDeCable } from '../app/escena3d.js';
import { indiceDeInsercion, indiceDeInsercionM6, proyectarEnPolilinea } from '../app/edicion-cables.js';
import { contactoEnTramosDelNodo, primerSolidoEnPunto, primerSolidoEnTramosDelNodo,
	RejillaCables, type Trazo } from '../app/colisiones-cables.js';
import { dientesDe, invasionesDeCanaletas, ranurasDe, RedCanaletas } from '../app/canaletas-red.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { proyectarLongitudesDocumentales } from '../src/motores/longitudes-documentales.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';

function legadoV9(): Proyecto {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	p.version = 2;
	const c = p.conductores[0];
	c.trazado = [{ x: 180, y: 110, z: 27 }, { x: 230, y: 110, z: 27 }];
	c.fisica = { material: 'COBRE', longitudManualM: 3.2 };
	c.color = 'azul';
	return p;
}

test('CAB-10: preview local detecta un tramo invasor aunque el nodo esté fuera del aparato', () => {
	const obstaculo = { id: 'aparato vecino', x0: 205, x1: 245, y0: 110, y1: 155, z0: 0, z1: 40 };
	const ruta = [{ x: 80, y: 130, z: 35 }, { x: 145, y: 130, z: 35 }, { x: 260, y: 130, z: 35 }];
	assert.equal(primerSolidoEnTramosDelNodo(ruta, 1, 2, [obstaculo])?.id, obstaculo.id);
	assert.equal(primerSolidoEnTramosDelNodo(ruta, 1, 2, [obstaculo], [obstaculo.id]), undefined,
		'el cuerpo del aparato conectado no debe aparecer como obstáculo vecino');
	assert.equal(primerSolidoEnTramosDelNodo(ruta.map((p) => ({ ...p, z: 70 })), 1, 2, [obstaculo]), undefined,
		'la proyección 2D no constituye una colisión a otra profundidad');
	assert.equal(primerSolidoEnTramosDelNodo(ruta, 0, 2, [obstaculo]), undefined,
		'el cálculo no debe barrer tramos ajenos al nodo movido');
	assert.equal(primerSolidoEnPunto({ x: 215, y: 130, z: 70 }, 2, [obstaculo]), undefined,
		'un nodo proyectado sobre el aparato pero por encima en Z no debe marcarse como invasión');
	assert.equal(primerSolidoEnPunto({ x: 215, y: 130, z: 35 }, 2, [obstaculo])?.id, obstaculo.id);
});

test('CAB-11: preview local admite corredor y ranura, pero advierte diente atravesado', () => {
	const c = { id: 'd1', x: 20, y: 100, largo: 200, orientacion: 'h' as const, ancho: 40, alto: 40 };
	const red = new RedCanaletas([c]);
	const invadir = (puntos: { x: number; y: number; z: number }[]) =>
		invasionesDeCanaletas(red, [c], [{ id: 'w1', radio: 2, puntos }], 1);
	assert.deepEqual(invadir([{ x: 20, y: 100, z: 20 }, { x: 220, y: 100, z: 20 }]), [],
		'el volumen interior útil no es una caja sólida');
	const ranura = ranurasDe(c)[3];
	assert.deepEqual(invadir([{ x: ranura, y: 65, z: 20 }, { x: ranura, y: 100, z: 20 }]), [],
		'la entrada por una ranura no debe recibir aviso de pared');
	const diente = dientesDe(c)[3];
	assert.equal(invadir([{ x: diente, y: 65, z: 20 }, { x: diente, y: 100, z: 20 }])[0]?.parte, 'diente');
});

test('CAB-10/13: contacto de preview mide solo los tramos vecinos en 3D', () => {
	const origen = { x: 0, y: 0, z: 20 };
	const vecino: Trazo = { id: 'vecino', radio: 2,
		puntos: [{ x: 20, y: 0, z: 20 }, { x: 80, y: 0, z: 20 }],
		bornes: ['V:1', 'V:2'], extremos: [{ x: 20, y: 0, z: 20 }, { x: 80, y: 0, z: 20 }] };
	const rejilla = new RejillaCables(); rejilla.anadir(vecino);
	const actual: Trazo = { id: 'manual', radio: 2,
		puntos: [origen, { x: 30, y: 0, z: 20 }, { x: 60, y: 0, z: 20 },
			{ x: 90, y: 50, z: 20 }, { x: 120, y: 50, z: 20 }],
		bornes: ['M:1', 'M:2'], extremos: [origen, { x: 120, y: 50, z: 20 }] };
	assert.equal(contactoEnTramosDelNodo(rejilla, actual, 1, 1.2)?.b, 'vecino');
	assert.equal(contactoEnTramosDelNodo(rejilla, actual, 4, 1.2), undefined,
		'el contacto de un tramo remoto no debe contaminar el aviso del nodo movido');
	const sobre = { ...actual, puntos: actual.puntos.map((p) => ({ ...p, z: p.z + 20 })) };
	assert.equal(contactoEnTramosDelNodo(rejilla, sobre, 1, 1.2), undefined,
		'una coincidencia frontal a distinta profundidad no es contacto físico');
	const borne = new RejillaCables();
	borne.anadir({ ...vecino, puntos: [origen, { x: 8, y: 0, z: 20 }],
		bornes: ['COMUN:1', 'V:2'], extremos: [origen, { x: 8, y: 0, z: 20 }] });
	assert.equal(contactoEnTramosDelNodo(borne, { ...actual,
		puntos: [origen, { x: 8, y: 0, z: 20 }], bornes: ['COMUN:1', 'M:2'] }, 1, 1.2), undefined,
		'el borne común puede compartir solo su zona física de salida');
	const prolongado = new RejillaCables();
	prolongado.anadir({ ...vecino, puntos: [origen, { x: 80, y: 0, z: 20 }],
		bornes: ['COMUN:1', 'V:2'], extremos: [origen, { x: 80, y: 0, z: 20 }] });
	assert.equal(contactoEnTramosDelNodo(prolongado, { ...actual,
		puntos: [origen, { x: 80, y: 0, z: 20 }], bornes: ['COMUN:1', 'M:2'] }, 1, 1.2)?.b, 'vecino',
		'compartir borne no perdona una coincidencia de eje fuera de la zona de salida');
});

test('CAB-29: fixture V9 conserva identidades, conexión, XYZ, color y largo declarado', () => {
	const p = legadoV9();
	const antes = p.conductores.map((c) => ({ id: c.id, de: c.de, a: c.a, seccion: c.seccion,
		color: c.color, trazado: c.trazado, longitudManualM: c.fisica?.longitudManualM,
		material: c.fisica?.material }));
	const cargado = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(cargado.arreglos, []);
	assert.equal(cargado.proyecto.version, VERSION_FORMATO);
	assert.deepEqual(cargado.proyecto.conductores.map((c) => ({ id: c.id, de: c.de, a: c.a,
		seccion: c.seccion, color: c.color, trazado: c.trazado,
		longitudManualM: c.fisica?.longitudManualM, material: c.fisica?.material })), antes);
	assert.equal(cargado.proyecto.conductores[0].rutaFisica, undefined,
		'el proyecto V9 no se convierte automáticamente a ruta espacial M6');
});

test('CAB-30: XY legacy ambiguo no se convierte; XYZ explícito sí y conserva IDs', () => {
	assert.equal(rutaDesdeTrazadoLegacy('w1', [{ x: 1, y: 2 }]), undefined);
	assert.equal(rutaDesdeTrazadoLegacy('x'.repeat(120), [{ x: 1, y: 2, z: 3 }]), undefined,
		'una identidad extrema no debe romper el inspector al ofrecer adopción');
	const r = rutaDesdeTrazadoLegacy('w1', [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }])!;
	assert.deepEqual(r.nodos.map((n) => n.id), ['w1:n1', 'w1:n2']);
	assert.deepEqual(r.nodos.map(({ x, y, z }) => ({ x, y, z })),
		[{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }]);
});

test('CAB-02/09: ruta M6 es literal, estable al invertir arrays y no expulsa dos rutas coincidentes', () => {
	const p = legadoV9();
	p.version = 3;
	const a = p.conductores[3], b = p.conductores[4];
	p.conductores = [a, b];
	delete a.trazado;
	for (const c of [a, b]) c.rutaFisica = leerRutaFisicaV1({
		version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA',
		nodos: [{ id: `${c.id}:medio`, x: 200, y: 180, z: 28 }],
	});
	const datos = (proyecto: Proyecto) => rutasDeCables(proyecto).map((r) => ({
		id: r.conductorId, geometria: r.geometria, puntos: r.puntos,
	}));
	const rutas = datos(p);
	for (const r of rutas) {
		assert.equal(r.geometria, 'POLILINEA');
		assert.ok(r.puntos.some((q) => q.x === 200 && q.y === 180 && q.z === 28),
			`${r.id}: la ruta guardada debe atravesar el nodo exacto`);
	}
	const inverso = structuredClone(p); inverso.conductores.reverse();
	assert.deepEqual(datos(inverso), rutas);
	const recargado = cargarProyecto(JSON.stringify(inverso));
	assert.deepEqual(recargado.arreglos, []);
	assert.deepEqual(datos(recargado.proyecto), rutas);
	assert.equal(recargado.proyecto.conductores[0].rutaFisica?.nodos[0].z, 28);
	const intacto = JSON.stringify(p.conductores);
	const aviso = diagnosticoRutaManual(p, a.id);
	assert.equal(aviso.contacto?.b, b.id,
		'la coincidencia manual se informa, no se elimina ni se convierte en unión');
	assert.equal(JSON.stringify(p.conductores), intacto,
		'el diagnóstico jamás corrige ni desplaza la ruta manual');
});

test('CAB-03/06: preview y reparto comparten puntos e índices con nodos M6 coincidentes', () => {
	const p = legadoV9();
	const c = p.conductores[3]; p.conductores = [c]; delete c.trazado;
	c.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [
			{ id: 'primero', x: 200, y: 180, z: 28 },
			{ id: 'coincidente', x: 200, y: 180, z: 28 },
			{ id: 'tercero', x: 250, y: 190, z: 28 },
		] });
	const final = rutasDeCables(p)[0];
	assert.deepEqual(rutaProvisional(p, c.id), final,
		'el preview debe medir y dibujar exactamente los puntos que confirmará el reparto');
	assert.equal(final.indicesNodos?.[0], final.indicesNodos?.[1],
		'dos nodos persistentes en el mismo XYZ comparten vértice visible sin inventar longitud');
	c.rutaFisica.nodos[1].y = 185;
	assert.deepEqual(rutaProvisional(p, c.id), rutasDeCables(p)[0],
		'mover el nodo vuelve a asignar el índice real sin depender de la caché anterior');
});

test('CAB-26: la longitud M6 mide XYZ entre bornes y nodos, no la proyección XY', () => {
	const p = legadoV9();
	const c = p.conductores[3];
	p.conductores = [c]; delete c.trazado;
	c.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [{ id: 'subida', x: 200, y: 180, z: 90 }] });
	const r = rutasDeCables(p)[0];
	const pBornes = salidasDeCable(p, c)!;
	const esperado = longitudPolilineaMm([pBornes.de, pBornes.salidaA,
		{ x: 200, y: 180, z: 90 }, pBornes.salidaB, pBornes.a]);
	assert.equal(largoDibujadoMm(p, c), esperado);
	assert.equal(longitudPolilineaMm(r.puntos), esperado);
	assert.ok(esperado > r.puntos.slice(1).reduce((s, q, i) => s
		+ Math.hypot(q.x - r.puntos[i].x, q.y - r.puntos[i].y), 0));
});

test('CAB-03: el tubo M6 sigue la misma polilínea que medición y picking, sin spline que sobresalga', () => {
	const p = legadoV9(); p.version = 3;
	const c = p.conductores[3]; p.conductores = [c]; delete c.trazado;
	c.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [
			{ id: 'a', x: 120, y: 150, z: 28 }, { id: 'b', x: 120, y: 190, z: 75 },
			{ id: 'c', x: 280, y: 190, z: 75 },
		] });
	const ruta = rutasDeCables(p)[0];
	const grupo = construirUnCable(ruta, 0x224466, (x, y, z) => new Vector3(x, y, z));
	try {
		const tubo = grupo.children[0] as Mesh<TubeGeometry>;
		const curva = tubo.geometry.parameters.path;
		for (let i = 0; i <= 100; i++) {
			const punto = curva.getPoint(i / 100);
			const sobreRuta = proyectarEnPolilinea(ruta.puntos, punto);
			assert.ok(sobreRuta && sobreRuta.distancia < 1e-6,
				`muestra ${i}: la malla se separó ${sobreRuta?.distancia} mm de la ruta medida`);
		}
	} finally { liberar(grupo); }
});

test('CAB-06/07: insertar sobre un segmento posterior que vuelve al mismo XYZ respeta el orden', () => {
	const p = legadoV9(); p.version = 3;
	const c = p.conductores[3]; p.conductores = [c]; delete c.trazado;
	c.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [
			{ id: 'ida', x: 200, y: 180, z: 28 },
			{ id: 'vuelta', x: 240, y: 180, z: 28 },
			{ id: 'ida-otra-vez', x: 200, y: 180, z: 28 },
			{ id: 'salida', x: 150, y: 180, z: 28 },
		] });
	const ruta = rutasDeCables(p)[0];
	assert.equal(ruta.indicesNodos?.length, 4);
	const avancePosterior = ruta.indicesNodos![1] + 0.5;
	assert.equal(indiceDeInsercionM6(ruta.indicesNodos!, avancePosterior), 2);
	assert.notEqual(indiceDeInsercion(ruta.puntos, c.rutaFisica.nodos, avancePosterior), 2,
		'la proyección espacial ambigua de los nodos no sirve para el orden M6');
});

test('CAB-07/13: trasladar un tramo interior conserva bornes e IDs y rechaza cambios parciales', () => {
	const p = legadoV9(); p.version = 3;
	const c = p.conductores[3]; p.conductores = [c]; delete c.trazado;
	const original = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [
			{ id: 'n1', x: 145, y: 115, z: 35 }, { id: 'n2', x: 260, y: 115, z: 35 },
			{ id: 'n3', x: 275, y: 140, z: 35 },
		] });
	c.rutaFisica = original;
	const extremos = rutasDeCables(p)[0];
	const movida = desplazarTramoInteriorM6(original, 0, { x: 5, y: -2, z: 8 });
	assert.deepEqual(movida.nodos.map((n) => n.id), original.nodos.map((n) => n.id));
	assert.deepEqual(movida.nodos.slice(0, 2).map((n) => [n.x, n.y, n.z]),
		[[150, 113, 43], [265, 113, 43]]);
	assert.deepEqual(movida.nodos[2], original.nodos[2]);
	assert.equal(original.nodos[0].x, 145, 'la propuesta no debe mutar el proyecto antes de confirmar');
	c.rutaFisica = movida;
	const nuevosExtremos = rutasDeCables(p)[0];
	assert.deepEqual([nuevosExtremos.de, nuevosExtremos.a], [extremos.de, extremos.a]);
	for (const [indice, delta] of [[-1, { x: 1, y: 0, z: 0 }],
		[2, { x: 1, y: 0, z: 0 }], [0, { x: Infinity, y: 0, z: 0 }],
		[0, { x: 5000, y: 0, z: 0 }]] as const) {
		assert.throws(() => desplazarTramoInteriorM6(movida, indice, delta));
		assert.deepEqual(c.rutaFisica, movida, 'una entrada inválida no deja medio tramo cambiado');
	}
});

test('CAB-30: el límite de nodos M6 es el mismo en lectura y en edición', () => {
	const base = { version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA' };
	const nodos = Array.from({ length: MAX_NODOS_RUTA_M6 + 1 }, (_, i) =>
		({ id: `n${i}`, x: i, y: 0, z: 35 }));
	assert.equal(leerRutaFisicaV1({ ...base, nodos: nodos.slice(0, -1) }).nodos.length, MAX_NODOS_RUTA_M6);
	assert.throws(() => leerRutaFisicaV1({ ...base, nodos }), /RUTA_M6_NO_SOPORTADA/);
});

test('CAB-27 pendiente: medir una ruta no sustituye la longitud eléctrica declarada ni inventa otra', () => {
	const p = legadoV9(); p.version = 3;
	const c = p.conductores[3], legacy = p.conductores[4];
	p.conductores = [c, legacy]; delete c.trazado;
	c.fisica = { material: 'COBRE', longitudManualM: 3.2 };
	c.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [{ id: 'n1', x: 200, y: 170, z: 100 }] });
	assert.ok(largoDibujadoMm(p, c) < 2500);
	assert.equal(longitudesParaRevisionMm(p).get(c.id), 3200);
	assert.ok(longitudesParaRevisionMm(p).has(legacy.id));
	delete c.fisica;
	assert.equal(longitudesParaRevisionMm(p).has(c.id), false,
		'sin política de adopción ni largo declarado, la medición no es dato eléctrico');
	const ruteo = rutearConductores(p);
	assert.ok(!ruteo.rutas.some((r) => r.conductorId === c.id),
		'el router 2D no puede inventar un segundo recorrido para la ruta M6');
	const fila = proyectarLongitudesDocumentales(p, ruteo,
		new Map([[c.id, largoDibujadoMm(p, c)]])).find((l) => l.conductorId === c.id)!;
	assert.equal(fila.estadoRuta, 'RUTA_3D_REFERENCIA');
	assert.equal(fila.longitudReferencia3DMm, largoDibujadoMm(p, c));
	assert.equal(fila.longitudRutaMm, undefined);
	assert.equal(fila.propuestaCorteMm, undefined);
	const fuente = p.dispositivos.find((d) => d.id === c.de.dispositivoId)!;
	fuente.fisica = { version: 1, fuente: { sistema: 'DC', tensionNominalV: 24,
		referencia: fuente.bornes[1].id, fases: [{ borne: fuente.bornes[0].id, fase: 'POSITIVO' }] } };
	const fisica = simularFisicaProyecto(p);
	assert.equal(fisica.activo, true);
	assert.equal(fisica.conductores.has(c.id), false,
		'el solver no debe recuperar una falsa distancia recta para una ruta M6 sin política CAB-27');
	assert.equal(fisica.red.ramas.get(`conductor:${c.id}`)?.origen, 'NO_MODELADO');
});

test('CAB-30: ruta hostil o contradictoria no se degrada silenciosamente a legacy', () => {
	for (const rutaFisica of [
		{ version: 2, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA', nodos: [] },
		{ version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA', nodos: [{ id: 'n', x: 'NaN', y: 0, z: 0 }] },
		{ version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA', nodos: [{ id: 'n', x: 1, y: 0, z: 0 }, { id: 'n', x: 2, y: 0, z: 0 }] },
	]) {
		const p = legadoV9(); p.version = 3;
		delete p.conductores[0].trazado;
		(p.conductores[0] as unknown as Record<string, unknown>).rutaFisica = rutaFisica;
		assert.throws(() => cargarProyecto(JSON.stringify(p)), /ruta M6/);
	}
	const p = legadoV9(); p.version = 3;
	p.conductores[0].rutaFisica = rutaDesdeTrazadoLegacy('w1', p.conductores[0].trazado)!;
	assert.throws(() => cargarProyecto(JSON.stringify(p)), /simultáneos/);
});

test('CAB-04/30: el marco PLACA no acepta puerta, campo ni extremo sin colocación', () => {
	const p = legadoV9(); p.version = 3;
	const c = p.conductores[3]; p.conductores = [c]; delete c.trazado;
	c.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
		geometria: 'POLILINEA', nodos: [{ id: 'n1', x: 200, y: 170, z: 28 }] });
	assert.ok(admiteRutaEnPlaca(c, p.gabinete!.colocaciones, p.dispositivos));
	for (const montaje of ['puerta', 'sin-colocacion', 'campo-con-colocacion'] as const) {
		const q = structuredClone(p);
		const extremo = q.gabinete!.colocaciones.find((col) => col.dispositivoId === c.de.dispositivoId)!;
		if (montaje === 'puerta') extremo.montaje = 'puerta';
		else if (montaje === 'sin-colocacion') q.gabinete!.colocaciones = q.gabinete!.colocaciones.filter((col) => col !== extremo);
		else q.dispositivos.find((d) => d.id === c.de.dispositivoId)!.campo = true;
		assert.ok(!admiteRutaEnPlaca(q.conductores[0], q.gabinete!.colocaciones, q.dispositivos));
		assert.throws(() => cargarProyecto(JSON.stringify(q)), /marco PLACA/);
	}
});
