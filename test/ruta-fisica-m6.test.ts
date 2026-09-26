import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, TubeGeometry, Vector3 } from 'three';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto, VERSION_FORMATO } from '../src/modelo/cargar.js';
import { admiteRutaEnPlaca, leerRutaFisicaV1, longitudPolilineaMm, rutaDesdeTrazadoLegacy } from '../src/modelo/ruta-fisica.js';
import { construirUnCable, largoDibujadoMm, liberar, longitudesParaRevisionMm,
	rutasDeCables, salidasDeCable } from '../app/escena3d.js';
import { proyectarEnPolilinea } from '../app/edicion-cables.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { proyectarLongitudesDocumentales } from '../src/motores/longitudes-documentales.js';
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
