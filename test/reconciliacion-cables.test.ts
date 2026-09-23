import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { Conductor } from '../src/modelo/tipos.js';
import {
	construirUnCable, liberar, reconciliarCablesDibujados, reiniciarContadores, contadores, RutaCable,
} from '../app/escena3d.js';

const aEscena = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const conductor = (id: string, color = 'azul'): Conductor => ({
	id, color, seccion: 1.5,
	de: { dispositivoId: 'a', borneId: '1' }, a: { dispositivoId: 'b', borneId: '1' },
});
const ruta = (id: string, x = 0): RutaCable => ({
	conductorId: id, de: { x, y: 0, z: 50 }, a: { x: x + 100, y: 100, z: 50 },
	nodos: [{ x, y: 0 }, { x: x + 100, y: 100 }], z: 50, radio: 1.5,
	puntos: [{ x, y: 0, z: 50 }, { x: x + 50, y: 50, z: 60 }, { x: x + 100, y: 100, z: 50 }],
});

test('el drop conserva mallas de rutas idénticas y libera solo la que cambió', () => {
	const escena = new THREE.Group();
	try {
		reiniciarContadores();
		const conductores = [conductor('w1'), conductor('w2')];
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[ruta('w1'), ruta('w2', 200)], conductores, aEscena),
			{ reutilizados: 0, reconstruidos: 2, retirados: 0 });
		const [primero, segundo] = escena.children;
		let liberada = 0;
		primero.traverse((objeto) => {
			const m = objeto as THREE.Mesh;
			if (m.isMesh && m.userData.tuboVisible) m.geometry.addEventListener('dispose', () => { liberada++; });
		});
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[ruta('w1'), ruta('w2', 200)], conductores, aEscena),
			{ reutilizados: 2, reconstruidos: 0, retirados: 0 });
		assert.equal(contadores.tubos, 2);
		assert.strictEqual(escena.children[0], primero);
		assert.strictEqual(escena.children[1], segundo);

		// Menos de 0,1 mm: el hook de diagnóstico lo redondearía, la firma real no.
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[ruta('w1', 0.000001), ruta('w2', 200)], conductores, aEscena),
			{ reutilizados: 1, reconstruidos: 1, retirados: 1 });
		assert.notStrictEqual(escena.children[0], primero);
		assert.strictEqual(escena.children[1], segundo);
		assert.equal(liberada, 1);
		assert.equal(contadores.tubos, 3);
	} finally { liberar(escena); }
});

test('radio/color efectivos invalidan la malla sin rehacer otras rutas', () => {
	const escena = new THREE.Group();
	try {
		const conductores = [conductor('w1'), conductor('w2')];
		reconciliarCablesDibujados(escena, [ruta('w1'), ruta('w2', 200)], conductores, aEscena);
		const [primero, segundo] = escena.children;
		const gruesa = ruta('w1'); gruesa.radio = 1.500001;
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[gruesa, ruta('w2', 200)], conductores, aEscena),
			{ reutilizados: 1, reconstruidos: 1, retirados: 1 });
		assert.notStrictEqual(escena.children[0], primero);
		assert.strictEqual(escena.children[1], segundo);
		const actual = escena.children[0];
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[gruesa, ruta('w2', 200)], [conductor('w1', 'rojo'), conductor('w2')], aEscena),
			{ reutilizados: 1, reconstruidos: 1, retirados: 1 });
		assert.notStrictEqual(escena.children[0], actual);
		assert.strictEqual(escena.children[1], segundo);
		const despuesColor = [...escena.children];
		const desplazada = (x: number, y: number, z: number) => new THREE.Vector3(x + 1, y, z);
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[gruesa, ruta('w2', 200)], [conductor('w1', 'rojo'), conductor('w2')], desplazada),
			{ reutilizados: 0, reconstruidos: 2, retirados: 2 });
		assert.notStrictEqual(escena.children[0], despuesColor[0]);
		assert.notStrictEqual(escena.children[1], despuesColor[1]);
	} finally { liberar(escena); }
});

test('vista previa y grupos sin firma nunca se reutilizan; el orden mantiene identidad', () => {
	const escena = new THREE.Group();
	try {
		const previa = construirUnCable(ruta('w1'), 0x1e5fa8, aEscena);
		escena.add(previa);
		const conductores = [conductor('w1'), conductor('w2')];
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[ruta('w1'), ruta('w2', 200)], conductores, aEscena),
			{ reutilizados: 0, reconstruidos: 2, retirados: 1 });
		const [uno, dos] = escena.children;
		assert.notStrictEqual(uno, previa);
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[ruta('w2', 200), ruta('w1')], conductores, aEscena),
			{ reutilizados: 2, reconstruidos: 0, retirados: 0 });
		assert.strictEqual(escena.children[0], dos);
		assert.strictEqual(escena.children[1], uno);
	} finally { liberar(escena); }
});

test('ruta duplicada falla sin retirar mallas previas ni dejar grupos nuevos', () => {
	const escena = new THREE.Group();
	try {
		const conductores = [conductor('w1'), conductor('w2')];
		reconciliarCablesDibujados(escena, [ruta('w1'), ruta('w2', 200)], conductores, aEscena);
		const hijos = [...escena.children];
		assert.throws(() => reconciliarCablesDibujados(escena,
			[ruta('w1', 5), ruta('w2', 200), ruta('w1', 8)], conductores, aEscena),
			/Ruta de cable duplicada/);
		assert.deepEqual(escena.children, hijos);
	} finally { liberar(escena); }
});

test('quitar un conductor retira su grupo y libera el tubo sin dejar geometría fantasma', () => {
	const escena = new THREE.Group();
	try {
		const conductores = [conductor('w1'), conductor('w2')];
		reconciliarCablesDibujados(escena, [ruta('w1'), ruta('w2', 200)], conductores, aEscena);
		const [uno, dos] = escena.children;
		let liberada = 0;
		dos.traverse((objeto) => {
			const m = objeto as THREE.Mesh;
			if (m.isMesh && m.userData.tuboVisible) m.geometry.addEventListener('dispose', () => { liberada++; });
		});
		assert.deepEqual(reconciliarCablesDibujados(escena,
			[ruta('w1')], [conductor('w1')], aEscena),
			{ reutilizados: 1, reconstruidos: 0, retirados: 1 });
		assert.equal(escena.children.length, 1);
		assert.strictEqual(escena.children[0], uno);
		assert.equal(dos.parent, null);
		assert.equal(liberada, 1);
	} finally { liberar(escena); }
});
