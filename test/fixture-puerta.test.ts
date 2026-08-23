/** Regresión rápida del fixture permanente de semántica y geometría de puerta. */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from 'three';

import { fixturePuertaSemantica } from '../ejemplo/fixture-puerta.js';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { PLANTILLAS } from '../app/catalogo.js';
import { bornesDeControlador, CONTROLADORES } from '../app/controladores.js';
import { construirComponentePuerta } from '../app/componentes-puerta.js';
import { construirEnvolvente } from '../app/gabinete3d.js';
import {
	actualizarMazoPuerta, conductoresFisicosDePuerta, construirMazoPuerta, Mazo, trazasDeMazo,
} from '../app/mazo-puerta.js';
import { claseDeConductor } from '../src/motores/clases-cable.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { ClaseConductor, Proyecto } from '../src/modelo/tipos.js';

const clases = (p: Proyecto): Record<string, ClaseConductor> => Object.fromEntries(
	p.conductores.map((c) => [c.id, claseDeConductor(p, c)]),
);

function escenaDelFixture(p = fixturePuertaSemantica()) {
	const g = p.gabinete!;
	const caja = g.caja!;
	const envolvente = construirEnvolvente(caja.ancho, caja.alto, caja.profundidad, { bisagras: caja.bisagras });
	const aparatos = g.colocaciones.filter((c) => c.montaje === 'puerta').map((col) => {
		const d = p.dispositivos.find((x) => x.id === col.dispositivoId)!;
		const grupo = construirComponentePuerta(d, col);
		envolvente.puerta.colocar(grupo, 'frente', col.x, col.y, 0);
		return grupo;
	});
	envolvente.grupo.updateMatrixWorld(true);
	const mazo = construirMazoPuerta({
		proyecto: p,
		puerta: envolvente.puerta,
		aparatos,
		aEscena: (x, y, z) => new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z),
		placa: { ancho: g.ancho, alto: g.alto },
		caja,
		izquierda: caja.bisagras !== 'derecha',
		color: (c) => c.color === 'verde/amarillo' ? 0x50a337 : c.color === 'azul' ? 0x287bc1 : 0xc43c32,
		radio: (seccion) => 0.9 + Math.sqrt(seccion ?? 1) * 0.35,
	});
	envolvente.grupo.add(mazo.flexibles);
	envolvente.grupo.updateMatrixWorld(true);
	return { p, envolvente, aparatos, mazo };
}

const ids = (m: Mazo) => ({
	mando: m.cables.map((c) => c.conductorId),
	proteccion: m.protecciones.map((c) => c.conductorId),
});

test('el fixture contiene las cuatro clases sin forzarlas en los conductores', () => {
	const p = fixturePuertaSemantica();
	assert.ok(p.conductores.every((c) => c.clase === undefined), 'el fixture no debe aprobarse a sí mismo con overrides');
	assert.deepEqual(clases(p), {
		'w-int-24v': 'interno',
		'w-int-0v': 'interno',
		'w-mando': 'puerta',
		'w-0v-puerta': 'puerta',
		'w-pe-interno': 'proteccion',
		'w-pe-puerta': 'proteccion',
		'w-campo': 'campo',
	});
});

test('0V sigue siendo funcional y PE sigue siendo protección por semántica explícita', () => {
	const p = fixturePuertaSemantica();
	const borne = (d: string, b: string) => p.dispositivos.find((x) => x.id === d)!.bornes.find((x) => x.id === b)!;
	assert.equal(borne('x1', '0V').tipo, 'control');
	assert.equal(borne('b1', '0V').tipo, 'control');
	assert.equal(borne('xpe', 'PE').tipo, 'PE');
	assert.equal(borne('pe-hoja', 'PE').tipo, 'PE');
});

test('mando y PE entran en sistemas separados; campo e interno no entran al mazo', () => {
	const p = fixturePuertaSemantica();
	const f = conductoresFisicosDePuerta(p);
	assert.deepEqual(f.mando.map((c) => c.id), ['w-mando', 'w-0v-puerta']);
	assert.deepEqual(f.proteccion.map((c) => c.id), ['w-pe-puerta']);
	assert.ok(![...f.mando, ...f.proteccion].some((c) => c.id === 'w-campo'));
	assert.ok(![...f.mando, ...f.proteccion].some((c) => c.id.startsWith('w-int')));
});

test('guardar, cargar y recomputar conserva semántica, bonding y partición física', () => {
	const p = fixturePuertaSemantica();
	const esperado = clases(p);
	const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(clases(cargado), esperado);
	assert.equal(cargado.gabinete!.caja!.bonding?.puesto, true);
	assert.deepEqual(
		{
			mando: conductoresFisicosDePuerta(cargado).mando.map((c) => c.id),
			proteccion: conductoresFisicosDePuerta(cargado).proteccion.map((c) => c.id),
		},
		{ mando: ['w-mando', 'w-0v-puerta'], proteccion: ['w-pe-puerta'] },
	);
});

test('invertir arrays no cambia clases, orden físico ni geometrías requeridas', () => {
	const p = fixturePuertaSemantica();
	const esperado = clases(p);
	const antes = ids(escenaDelFixture(p).mazo);
	p.dispositivos.reverse();
	p.conductores.reverse();
	p.gabinete!.colocaciones.reverse();
	assert.deepEqual(clases(p), esperado);
	assert.deepEqual(ids(escenaDelFixture(p).mazo), antes);
});

test('el punto PE de hoja tiene geometría propia y un terminal PE seleccionable', () => {
	const { aparatos } = escenaDelFixture();
	const pe = aparatos.find((g) => g.userData.dispositivoId === 'pe-hoja')!;
	let punto = false;
	let terminal = false;
	pe.traverse((o) => {
		if (o.userData.pieza === 'punto-pe') punto = true;
		if (o.userData.pieza === 'terminal-pe' && o.userData.borneId === 'PE') terminal = true;
	});
	assert.ok(punto, 'el PE de hoja no puede verse como un piloto genérico');
	assert.ok(terminal, 'el mazo necesita el punto geométrico persistente del borne PE');
});

test('mando, PE aislado y bonding son tres entidades geométricas distintas', () => {
	const { mazo } = escenaDelFixture();
	assert.deepEqual(ids(mazo), { mando: ['w-mando', 'w-0v-puerta'], proteccion: ['w-pe-puerta'] });
	assert.ok(mazo.bonding, 'el fixture debe traer la trenza de bonding');
	assert.equal(mazo.bonding!.conductorId, '');
	assert.equal(mazo.bonding!.flexible.userData.conductorId, undefined);
	assert.notEqual(mazo.bonding!.flexible, mazo.protecciones[0].flexible);

	const entrada = (m: THREE.Mesh) => (m.userData.guia as { x: number }[])[0].x;
	const xPe = entrada(mazo.protecciones[0].enLaPuerta);
	for (const mando of mazo.cables) {
		const holgura = mando.radio + mazo.protecciones[0].radio + 4;
		assert.ok(Math.abs(entrada(mando.enLaPuerta) - xPe) >= holgura,
			`PE y ${mando.conductorId} comparten corredor sin holgura`);
	}

	const pe = mazo.protecciones[0];
	const destino = pe.entrada.getWorldPosition(new THREE.Vector3());
	assert.ok(pe.reserva - pe.fijo.distanceTo(destino) >= pe.radio * 40 - 1e-6,
		'la reserva del PE no alcanza dos radios mínimos de curvatura');
});

test('cerrar, entreabrir y abrir solo deforma los lazos: no crea fantasmas', () => {
	const { envolvente, mazo } = escenaDelFixture();
	const tubos = [...mazo.cables, ...mazo.protecciones].map((c) => c.flexible);
	const geometrias = tubos.map((m) => m.geometry);
	const cuentas = { hoja: mazo.enLaPuerta.children.length, flex: mazo.flexibles.children.length };
	const primera = mazo.cables[0].trazaLazo.map((p) => p.clone());

	for (const t of [0, 0.5, 1]) {
		envolvente.puerta.pivote.rotation.y = envolvente.puerta.aperturaMaxima * t;
		envolvente.grupo.updateMatrixWorld(true);
		actualizarMazoPuerta(mazo);
		assert.equal(mazo.enLaPuerta.children.length, cuentas.hoja);
		assert.equal(mazo.flexibles.children.length, cuentas.flex);
		assert.deepEqual(tubos.map((m) => m.geometry), geometrias, 'abrir la puerta reconstruyó geometrías');
		for (const traza of trazasDeMazo(mazo)) {
			assert.ok(traza.puntos.length > 1);
			assert.ok(traza.puntos.every((p) => Number.isFinite(p.x + p.y + p.z)));
		}
	}
	assert.ok(mazo.cables[0].trazaLazo.some((p, i) => p.distanceTo(primera[i]) > 1),
		'el lazo de mando no acompañó la apertura');
	const porId = mazo.enLaPuerta.children.filter((o) => o.userData.conductorId)
		.map((o) => o.userData.conductorId as string);
	assert.equal(new Set(porId).size, porId.length, `tramos duplicados: ${porId.join(', ')}`);
	assert.ok(!porId.includes('w-campo'));
});

test('la auditoría focalizada no convierte GND, 0V ni COM en PE', () => {
	const funcional = /^(?:GND|0V|24V COM|COM\d*)$/i;
	const proteccion = /^(?:PE\d*|EARTH|TIERRA|⏚)$/i;
	const revisar = (origen: string, bornes: { id: string; tipo?: string }[]) => {
		for (const b of bornes) {
			if (funcional.test(b.id)) assert.notEqual(b.tipo, 'PE', `${origen} convierte ${b.id} en PE`);
			if (proteccion.test(b.id)) assert.equal(b.tipo, 'PE', `${origen} degrada ${b.id}`);
		}
	};
	for (const id of ['piloto-24', 'fuente-24', 'borna-pe-1', 'sensor-inductivo', 'pulsador-marcha', 'selector-2pos']) {
		const plantilla = PLANTILLAS.find((p) => p.id === id)!;
		assert.ok(plantilla, `falta la plantilla auditada ${id}`);
		revisar(`catálogo ${id}`, plantilla.bornes);
	}
	for (const controlador of CONTROLADORES) revisar(controlador.id, bornesDeControlador(controlador));
	for (const ejemplo of EJEMPLOS) {
		for (const d of ejemplo.crear().dispositivos) revisar(`${ejemplo.id}/${d.id}`, d.bornes);
	}
});
