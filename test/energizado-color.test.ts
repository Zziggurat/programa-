/**
 * ENERGIZAR NO PUEDE ROBARLE EL COLOR AL CONDUCTOR.
 *
 * Durante mucho tiempo sí se lo robaba, y el fallo no lo cazó ninguna prueba porque no rompe nada:
 * el tablero se energiza, los cables se encienden y las 627 pruebas pasaban igual. Lo que pasaba es
 * que había DOS sitios pintando el mismo material. `animarSimulacion` modulaba la intensidad cable
 * a cable según la corriente, y `pintarSimulacion` machacaba justo después el COLOR del emisivo con
 * un ámbar fijo para todos. Medido en pantalla, un conductor negro pasaba de tono 220° a 42° y uno
 * gris de 210° a 39°: cualquier cable con tensión viraba al amarillo y dejaba de poder
 * identificarse, que en un tablero es justo para lo que sirve el color.
 *
 * Lo que se guarda aquí no es «el emisivo vale tal número» —eso se ajusta mirando capturas— sino la
 * regla que no puede volver a romperse: el color con el que se enciende un conductor es SU color.
 * Energizar es un estado que se suma, no uno que sustituye.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { emisionDeCable } from '../app/animacion-sim.js';
import { COLOR_CABLE } from '../app/escena3d.js';

/** Tono en grados, y si el color es tan gris que su tono ya no significa nada. */
function tonoDe(c: THREE.Color): { grados: number; gris: boolean } {
	const hsl = { h: 0, s: 0, l: 0 };
	c.getHSL(hsl);
	return { grados: hsl.h * 360, gris: hsl.s < 0.06 };
}

const distanciaAngular = (a: number, b: number): number => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

test('el emisivo de un conductor energizado conserva su tono', () => {
	for (const [nombre, hex] of Object.entries(COLOR_CABLE)) {
		const mat = new THREE.MeshStandardMaterial({ color: hex });
		const malla = new THREE.Mesh(undefined, mat);
		emisionDeCable(mat, malla);
		const base = tonoDe(new THREE.Color(hex));
		const emisivo = tonoDe(mat.emissive);
		// Un negro casi puro o un blanco casi puro no tienen tono que conservar: ahí la regla que
		// importa es la de abajo (que no se vayan al amarillo), no la del tono.
		if (base.gris) continue;
		assert.ok(
			distanciaAngular(base.grados, emisivo.grados) < 4,
			`el conductor «${nombre}» se enciende con tono ${Math.round(emisivo.grados)}° cuando el suyo es ${Math.round(base.grados)}°`,
		);
	}
});

test('ningún conductor se enciende en ámbar', () => {
	// El fallo concreto que hubo: 0xffc83d para todos. Un emisivo cálido y saturado en un conductor
	// que no es cálido significa que alguien ha vuelto a pintar por encima.
	for (const [nombre, hex] of Object.entries(COLOR_CABLE)) {
		const mat = new THREE.MeshStandardMaterial({ color: hex });
		emisionDeCable(mat, new THREE.Mesh(undefined, mat));
		const hsl = { h: 0, s: 0, l: 0 };
		mat.emissive.getHSL(hsl);
		const ambar = hsl.h * 360 > 30 && hsl.h * 360 < 60 && hsl.s > 0.45;
		const propio = tonoDe(new THREE.Color(hex));
		if (ambar && !(propio.grados > 30 && propio.grados < 60)) {
			assert.fail(`el conductor «${nombre}» se enciende en ámbar sin serlo`);
		}
	}
});

test('un conductor oscuro tiene algo que emitir y uno claro no se va al blanco', () => {
	const negro = new THREE.MeshStandardMaterial({ color: COLOR_CABLE['negro'] });
	emisionDeCable(negro, new THREE.Mesh(undefined, negro));
	const hslNegro = { h: 0, s: 0, l: 0 };
	negro.emissive.getHSL(hslNegro);
	// Sin suelo, emisivo = negro x intensidad = negro: no habría forma de ver que tiene tensión.
	assert.ok(hslNegro.l > 0.2, `el conductor negro emitiría con luz ${hslNegro.l}, que no se ve`);

	const blanco = new THREE.MeshStandardMaterial({ color: COLOR_CABLE['blanco'] });
	emisionDeCable(blanco, new THREE.Mesh(undefined, blanco));
	const hslBlanco = { h: 0, s: 0, l: 0 };
	blanco.emissive.getHSL(hslBlanco);
	assert.ok(hslBlanco.l < 0.8, `el conductor blanco emitiría con luz ${hslBlanco.l} y se quemaría`);
});

test('la simulación no vuelve a pintar los cables con un color fijo', () => {
	/*
	 * Esta es la prueba que habría cazado el fallo original, y por eso mira el código fuente en vez
	 * de la escena: el problema no era un valor mal puesto, era que había un segundo dueño del mismo
	 * material. Lo que se exige es que `pintarSimulacion` no elija colores de emisivo por su cuenta,
	 * sino que pase por la función compartida.
	 */
	const fuente = readFileSync(new URL('../../app/ui-simulacion.ts', import.meta.url), 'utf8');
	const pintar = fuente.slice(fuente.indexOf('function pintarSimulacion'), fuente.indexOf('function pintarPanelSimulacion'));
	assert.ok(pintar.length > 100, 'no se encontró pintarSimulacion');
	assert.ok(pintar.includes('emisionDeCable'), 'pintarSimulacion ya no usa la función compartida de emisión');
	const fijos = [...pintar.matchAll(/emissive\.setHex\(([^)]*)\)/g)].map((m) => m[1].trim());
	for (const v of fijos) {
		assert.equal(v, '0x000000', `pintarSimulacion pone un emisivo fijo (${v}) en vez de usar el color del conductor`);
	}
});
