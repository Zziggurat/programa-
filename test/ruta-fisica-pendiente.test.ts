/** Una conexión del esquema existe eléctricamente sin inventarle cable dentro del gabinete. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';

import { construirBornes, largoDibujadoMm, longitudesDibujadasMm, rutasDeCables } from '../app/escena3d.js';
import { conductoresFisicosDePuerta } from '../app/mazo-puerta.js';
import { cargarProyecto, VERSION_FORMATO } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { generarFichaTablero } from '../src/motores/ficha-tablero.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { revisarTablero } from '../src/motores/revision.js';

function tablero(): Proyecto {
	const p = crearProyecto('Ruta pendiente', { reservaCable: 0, extraPorConexionMm: 0 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Esquema' }];
	p.dispositivos = [
		{ id: 'a', tipo: 'rele', posicion: { x: 0, y: 0 }, bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'b', tipo: 'rele', posicion: { x: 300, y: 0 }, bornes: [{ id: '1' }, { id: '2' }] },
	];
	p.conductores = [
		{ id: 'legado', de: { dispositivoId: 'a', borneId: '1' },
			a: { dispositivoId: 'b', borneId: '1' }, seccion: 1.5 },
		{ id: 'pendiente', de: { dispositivoId: 'a', borneId: '2' },
			a: { dispositivoId: 'b', borneId: '2' }, estadoRutaFisica: 'pendiente' },
	];
	p.gabinete = {
		ancho: 500, alto: 300, rieles: [],
		canaletas: [{ id: 'h', x: 0, y: 130, largo: 450, orientacion: 'h', ancho: 40, alto: 40 }],
		colocaciones: [
			{ dispositivoId: 'a', x: 20, y: 35, ancho: 45, alto: 65 },
			{ dispositivoId: 'b', x: 330, y: 35, ancho: 45, alto: 65 },
		],
	};
	return p;
}

test('ruta pendiente sobrevive JSON/carga; ausencia de discriminante conserva legacy', () => {
	const p = tablero();
	assert.equal(p.version, VERSION_FORMATO, 'el formato nuevo debe impedir que un lector anterior materialice una ruta desconocida');
	const primera = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(primera.arreglos, []);
	const segunda = cargarProyecto(JSON.stringify(primera.proyecto));
	assert.deepEqual(segunda.arreglos, []);
	assert.equal(segunda.proyecto.conductores.find((c) => c.id === 'pendiente')?.estadoRutaFisica, 'pendiente');
	assert.equal(segunda.proyecto.conductores.find((c) => c.id === 'legado')?.estadoRutaFisica, undefined);
	const legadoV1 = structuredClone(p);
	legadoV1.version = 1;
	legadoV1.conductores = legadoV1.conductores.filter((c) => c.id === 'legado');
	const migrado = cargarProyecto(JSON.stringify(legadoV1));
	assert.equal(migrado.proyecto.version, VERSION_FORMATO);
	assert.deepEqual(migrado.arreglos, []);
	assert.equal(migrado.proyecto.conductores[0].estadoRutaFisica, undefined);
});

test('un archivo de versión futura se rechaza antes de degradar rutas desconocidas', () => {
	const p = tablero();
	p.version = (VERSION_FORMATO + 1) as Proyecto['version'];
	assert.throws(() => cargarProyecto(JSON.stringify(p)), /versión más nueva/);
});

test('un estado hostil nunca se degrada silenciosamente a cable legacy', () => {
	for (const valor of ['automatica', null, 42, {}, []]) {
		const p = tablero();
		(p.conductores[1] as unknown as Record<string, unknown>).estadoRutaFisica = valor;
		const r = cargarProyecto(JSON.stringify(p));
		assert.deepEqual(r.proyecto.conductores.map((c) => c.id), ['legado']);
		assert.ok(r.diagnosticos.some((d) => d.ruta === 'conductores[pendiente].estadoRutaFisica'));
		assert.ok(r.arreglos.length > 0, 'el autosave debe saber que el archivo fue reparado');
	}
});

test('ruta pendiente con trazado o longitud manual contradictorios no se convierte a medias', () => {
	for (const cambio of [
		(c: Proyecto['conductores'][number]) => { c.trazado = [{ x: 10, y: 20 }]; },
		(c: Proyecto['conductores'][number]) => { c.fisica = { longitudManualM: 3 }; },
	]) {
		const p = tablero();
		cambio(p.conductores[1]);
		const r = cargarProyecto(JSON.stringify(p));
		assert.deepEqual(r.proyecto.conductores.map((c) => c.id), ['legado']);
		assert.ok(r.diagnosticos.some((d) => d.ruta === 'conductores[pendiente]'));
	}
});

test('pendiente cuenta como conexión, no como ruta, ocupación ni metraje del tablero', () => {
	const p = tablero();
	const soloLegado = structuredClone(p);
	soloLegado.conductores = soloLegado.conductores.filter((c) => c.id === 'legado');
	const ruteo = rutearConductores(p);
	assert.deepEqual(ruteo.rutas, rutearConductores(soloLegado).rutas);
	assert.deepEqual(ruteo.ocupaciones, rutearConductores(soloLegado).ocupaciones);
	assert.equal(ruteo.rutas.length, 1);
	assert.ok(ruteo.rutas[0].longitudMm > 0);
	const revision = revisarTablero(p);
	assert.equal(revision.resumen.conductores, 2, 'la identidad eléctrica sí existe');
	assert.equal(revision.resumen.longitudCableMm, ruteo.rutas[0].longitudMm);
	assert.ok(revision.potenciales.porConductor.has('pendiente'));
});

test('revisión ignora metros externos para pendiente sin mutar el mapa del caller', () => {
	const p = tablero();
	p.dispositivos[0].tensionNominal = 24;
	p.dispositivos[0].corrienteNominal = 10;
	p.conductores[1].seccion = 0.5;
	const largos = new Map([['legado', 300_000], ['pendiente', 300_000]]);
	const r = revisarTablero(p, { longitudesMm: largos });
	assert.ok(r.hallazgos.some((h) => h.conductorId === 'legado' && h.regla === 'R10-caida-tension'),
		'el override aún se aplica al cable legacy');
	assert.ok(!r.hallazgos.some((h) => h.conductorId === 'pendiente' && h.regla === 'R10-caida-tension'),
		'la conexión pendiente no adquiere una caída física por override');
	assert.equal(largos.get('pendiente'), 300_000);
});

test('DRC directo ignora override de metros para pendiente y mantiene R7', () => {
	const p = tablero();
	p.dispositivos[0].tensionNominal = 24;
	p.dispositivos[0].corrienteNominal = 10;
	p.conductores[1].seccion = 0.5;
	const largos = new Map([['legado', 300_000], ['pendiente', 300_000]]);
	const hallazgos = verificarProyecto(p, calcularPotenciales(p), { longitudesMm: largos });
	assert.ok(hallazgos.some((h) => h.conductorId === 'legado' && h.regla === 'R10-caida-tension'));
	assert.ok(!hallazgos.some((h) => h.conductorId === 'pendiente' && h.regla === 'R10-caida-tension'));
	assert.equal(largos.get('pendiente'), 300_000, 'el contexto del caller no se muta');
	p.conductores[1].seccion = undefined;
	const sinSeccion = verificarProyecto(p, calcularPotenciales(p), { longitudesMm: largos });
	assert.ok(sinSeccion.some((h) => h.conductorId === 'pendiente' && h.regla === 'R7-sin-seccion'),
		'la falta de sección sigue siendo un aviso honesto');
});

test('ficha separa conexiones pendientes de cable por sección, incluso con ruta externa hostil', () => {
	const p = tablero();
	p.conductores[1].seccion = 6; // declarada, pero aún sin tendido físico
	const ruteo = rutearConductores(p);
	const falso = { ...ruteo, rutas: [...ruteo.rutas, {
		conductorId: 'pendiente', longitudMm: 987_654, camino: [], canaletasUsadas: ['h'],
	}] };
	for (const r of [ruteo, falso]) {
		const f = generarFichaTablero(p, r).conductores;
		assert.equal(f.total, 2, 'dos vínculos eléctricos');
		assert.equal(f.pendientesRuta, 1, 'la conexión sin tendido se presenta aparte');
		assert.equal(f.longitudTotalMm, ruteo.rutas[0].longitudMm);
		assert.deepEqual(f.porSeccion, [{ seccion: 1.5, cantidad: 1,
			longitudMm: ruteo.rutas[0].longitudMm, conRuta: 1 }]);
	}
	const soloPendiente = structuredClone(p);
	soloPendiente.conductores = soloPendiente.conductores.filter((c) => c.id === 'pendiente');
	const sinCable = generarFichaTablero(soloPendiente, rutearConductores(soloPendiente)).conductores;
	assert.deepEqual(sinCable, { total: 1, pendientesRuta: 1, longitudTotalMm: 0, porSeccion: [] },
		'una conexión eléctrica pendiente no es una línea de material tendido');
});

test('la escena 3D no dibuja, mide ni ocupa abanico con la conexión pendiente', () => {
	const p = tablero();
	const soloLegado = structuredClone(p);
	soloLegado.conductores = soloLegado.conductores.filter((c) => c.id === 'legado');
	assert.equal(largoDibujadoMm(p, p.conductores[1]), 0);
	assert.equal(longitudesDibujadasMm(p).has('pendiente'), false);
	assert.deepEqual(rutasDeCables(p), rutasDeCables(soloLegado));
	assert.ok(rutasDeCables(p).some((r) => r.conductorId === 'legado'));
	const bornes = construirBornes(p, (x, y, z) => new Vector3(x, y, z));
	const fisico = bornes.children.find((m) => m.userData.borneDispositivoId === 'a' && m.userData.borneId === '1');
	const sinRuta = bornes.children.find((m) => m.userData.borneDispositivoId === 'a' && m.userData.borneId === '2');
	assert.equal(fisico?.userData.conectado, true);
	assert.equal(sinRuta?.userData.conectado, false);
});

test('una conexión pendiente hacia la puerta no genera mazo ni tendido PE', () => {
	const p = tablero();
	p.gabinete!.colocaciones[1].montaje = 'puerta';
	p.conductores[0].clase = 'puerta';
	p.conductores[1].clase = 'proteccion';
	const fisicos = conductoresFisicosDePuerta(p);
	assert.deepEqual(fisicos.mando.map((c) => c.id), ['legado']);
	assert.deepEqual(fisicos.proteccion, []);
});

test('ni sección ni longitud inyectadas en runtime convierten pendiente en impedancia física', () => {
	const p = tablero();
	p.conductores[1].fisica = { material: 'COBRE' }; // activa el solver físico, sin declarar metros
	const r = simularFisicaProyecto(p, {
		longitudesM: new Map([['pendiente', { metros: 12, origen: 'INYECTADO' }]]),
		seccionesMm2: new Map([['pendiente', 2.5]]),
	});
	assert.equal(r.activo, true);
	assert.equal(r.conductores.has('pendiente'), false);
	assert.equal(r.red.ramas.get('conductor:pendiente')?.origen, 'NO_MODELADO');
	assert.ok(r.diagnosticos.some((d) => d.elementos?.includes('pendiente') && /pendiente/i.test(d.mensaje)));
});
