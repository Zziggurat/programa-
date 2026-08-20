/**
 * LA PUERTA TIENE QUE SER UNA PIEZA, Y LO QUE SE MONTE EN ELLA TIENE QUE IRSE CON ELLA.
 *
 * Todavía no hay pilotos ni pulsadores montados en la puerta, pero la jerarquía que los va a
 * sostener sí existe, y es justo la parte que no se puede equivocar: si mañana un piloto se cuelga
 * de un sitio que no gira con la hoja, al abrir el armario la lente se queda flotando en el aire y
 * hay que rehacer la puerta entera. Estas pruebas fijan el contrato ANTES de que haya nada
 * colgando:
 *
 *   · lo que se monta en la puerta se mueve como un sólido rígido con ella;
 *   · las dos caras usan las mismas x, y —una lente y el cuerpo que la lleva son el mismo taladro—;
 *   · abrir es girar UN grupo, y el ángulo depende del lado de las bisagras.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from 'three';

import { construirEnvolvente } from '../app/gabinete3d.js';

/** Un objeto cualquiera, del tamaño de un piloto, para usarlo de testigo. */
function testigo(): THREE.Object3D {
	return new THREE.Mesh(new THREE.BoxGeometry(22, 22, 6));
}

function mundo(o: THREE.Object3D, raiz: THREE.Object3D): THREE.Vector3 {
	raiz.updateMatrixWorld(true);
	return o.getWorldPosition(new THREE.Vector3());
}

test('lo montado en las dos caras de la puerta comparte x e y', () => {
	const { grupo, puerta } = construirEnvolvente(600, 800, 200);
	const lente = testigo();
	const cuerpo = testigo();
	puerta.colocar(lente, 'frente', 150, 200);
	puerta.colocar(cuerpo, 'interior', 150, 200);

	const a = mundo(lente, grupo);
	const b = mundo(cuerpo, grupo);
	assert.ok(Math.abs(a.x - b.x) < 1e-9, `la lente está en x=${a.x} y su cuerpo en x=${b.x}`);
	assert.ok(Math.abs(a.y - b.y) < 1e-9, `la lente está en y=${a.y} y su cuerpo en y=${b.y}`);
	// Y separados exactamente por el fondo de la hoja: uno a cada lado de la chapa.
	assert.ok(Math.abs((a.z - b.z) - puerta.fondo) < 1e-9, `separación en z de ${(a.z - b.z).toFixed(2)}`);
});

test('al abrir, lo montado en la puerta se mueve con ella como un sólido rígido', () => {
	const { grupo, puerta } = construirEnvolvente(600, 800, 200);
	const lente = testigo();
	const cuerpo = testigo();
	puerta.colocar(lente, 'frente', 480, 120);
	puerta.colocar(cuerpo, 'interior', 480, 120);

	const cerrada = { lente: mundo(lente, grupo), cuerpo: mundo(cuerpo, grupo) };
	const separacionCerrada = cerrada.lente.distanceTo(cerrada.cuerpo);

	puerta.pivote.rotation.y = puerta.aperturaMaxima;
	const abierta = { lente: mundo(lente, grupo), cuerpo: mundo(cuerpo, grupo) };

	// Se han movido de verdad: si no, la prueba no probaría nada.
	assert.ok(
		cerrada.lente.distanceTo(abierta.lente) > 100,
		`la lente apenas se movió al abrir: ${cerrada.lente.distanceTo(abierta.lente).toFixed(1)} mm`,
	);
	// Y se han movido JUNTAS: la distancia entre las dos no cambia ni una milésima.
	assert.ok(
		Math.abs(abierta.lente.distanceTo(abierta.cuerpo) - separacionCerrada) < 1e-6,
		'la lente y su cuerpo se han separado al abrir la puerta',
	);
	// La puerta abre HACIA EL FRENTE: el canto libre se acerca al observador.
	assert.ok(abierta.lente.z > cerrada.lente.z, 'la puerta se ha abierto hacia dentro del armario');
});

test('el lado de las bisagras cambia el eje de giro y el sentido de apertura', () => {
	const izq = construirEnvolvente(600, 800, 200, { bisagras: 'izquierda' });
	const der = construirEnvolvente(600, 800, 200, { bisagras: 'derecha' });
	assert.ok(izq.puerta.pivote.position.x < 0, 'con bisagras a la izquierda el eje va a la izquierda');
	assert.ok(der.puerta.pivote.position.x > 0, 'con bisagras a la derecha el eje va a la derecha');
	assert.ok(
		Math.sign(izq.puerta.aperturaMaxima) !== Math.sign(der.puerta.aperturaMaxima),
		'las dos puertas giran en el mismo sentido, y no puede ser',
	);
	// Las dos abren hacia el frente, cada una por su lado.
	for (const { grupo, puerta } of [izq, der]) {
		const t = testigo();
		puerta.colocar(t, 'frente', 300, 400);
		const cerrada = mundo(t, grupo);
		puerta.pivote.rotation.y = puerta.aperturaMaxima;
		assert.ok(mundo(t, grupo).z > cerrada.z, 'esta puerta no abre hacia el frente');
	}
});

test('la envolvente se adapta al tamaño del armario sin cambiar el espesor de la chapa', () => {
	/*
	 * La chapa de un armario grande no es más gorda: es la misma. Si el modelo escalara entero, un
	 * armario de dos metros saldría con paredes de un centímetro y se leería como un juguete
	 * ampliado. Se comprueba midiendo la caja envolvente de los dos y viendo que el hueco interior
	 * crece exactamente lo que crece el armario.
	 */
	const medir = (w: number, h: number, p: number) => {
		const { grupo } = construirEnvolvente(w, h, p);
		grupo.updateMatrixWorld(true);
		const caja = new THREE.Box3().setFromObject(grupo);
		return caja.getSize(new THREE.Vector3());
	};
	const chico = medir(400, 500, 150);
	const grande = medir(1200, 2000, 300);
	assert.ok(Math.abs(grande.x - chico.x - 800) < 6, `el ancho creció ${(grande.x - chico.x).toFixed(1)} y debía crecer 800`);
	assert.ok(Math.abs(grande.y - chico.y - 1500) < 6, `el alto creció ${(grande.y - chico.y).toFixed(1)} y debía crecer 1500`);
	assert.ok(Math.abs(grande.z - chico.z - 150) < 6, `el fondo creció ${(grande.z - chico.z).toFixed(1)} y debía crecer 150`);
});
