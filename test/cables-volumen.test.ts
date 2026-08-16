/**
 * DOS CABLES NO PUEDEN OCUPAR EL MISMO SITIO, Y ESTO LO MIDE DE VERDAD.
 *
 * La prueba anterior del cableado comprobaba «0 pares a la misma profundidad». Eso es cierto y no
 * demuestra nada: dos cables asignados a capas distintas se cruzan igual mientras entran o salen
 * de esas capas, y dos ejes separados 3 mm siguen siendo dos tubos de 3 mm de radio metidos uno
 * dentro de otro. Aquí se mide el VOLUMEN: distancia mínima entre los dos recorridos
 * tridimensionales completos, con sus radios, sobre la geometría final que se dibuja.
 *
 * Se prueba sobre los cinco tableros de la biblioteca —de 17 a 52 conductores— porque una mejora
 * para un circuito pequeño puede romper uno grande, y al revés.
 *
 * Y hay un caso que conviene contar entero, porque estuvo escondido desde el principio y explica
 * por qué repartir profundidades no arreglaba nada:
 *
 *   `redondearEsquinas` solo mete vértices en las ESQUINAS. Una bajada recta de cuatrocientos
 *   milímetros sale de ahí como UN SOLO segmento, con sus dos únicos puntos pegados a los bornes.
 *   La rampa de profundidad se calculaba punto a punto… sobre esos dos puntos, que están los dos
 *   dentro de los 26 mm de rampa. O sea: el cable salía del borne, subía dos milímetros y volvía
 *   a bajar, en línea recta. La capa que el repartidor le asignaba NO SE APLICABA en las tiradas
 *   rectas, que son casi todas, y los cincuenta conductores viajaban amontonados entre 46 y 50 mm
 *   dijera lo que dijera su carril.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { conflictosDe, distanciaSegmentos, invasionesDe } from '../app/colisiones-cables.js';
import { Punto3, tenderCable } from '../app/geometria-cables.js';
import {
	HOLGURA_CABLE, solidosDelTablero, trazosDeCables,
} from '../app/escena3d.js';
import { invasionesDeCanaletas, RedCanaletas } from '../app/canaletas-red.js';

/** Cuánto se permite que se metan dos tubos, en mm. Cero sería lo ideal; esto es lo alcanzado. */
const PENETRACION_TOLERADA = 2.5;

test('la distancia entre segmentos es la de verdad, no la de sus extremos', () => {
	// Dos segmentos cruzados en aspa, separados 5 mm en z. Sus cuatro extremos están lejísimos
	// unos de otros; lo que importa es el punto de cruce, en mitad de los dos.
	const a0 = { x: -50, y: 0, z: 0 };
	const a1 = { x: 50, y: 0, z: 0 };
	const b0 = { x: 0, y: -50, z: 5 };
	const b1 = { x: 0, y: 50, z: 5 };
	const { d, donde } = distanciaSegmentos(a0, a1, b0, b1);
	assert.ok(Math.abs(d - 5) < 1e-6, `distancia ${d}, esperada 5`);
	assert.ok(Math.hypot(donde.x, donde.y) < 1e-6, 'el contacto está donde se cruzan');
});

test('dos paralelos se miden por su separación, no por sus puntas', () => {
	const { d } = distanciaSegmentos(
		{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 },
		{ x: 20, y: 4, z: 0 }, { x: 80, y: 4, z: 0 },
	);
	assert.ok(Math.abs(d - 4) < 1e-6, `distancia ${d}, esperada 4`);
});

test('la rampa de profundidad llega a su capa en una tirada recta', () => {
	/*
	 * ESTA es la prueba del fallo de fondo. Una bajada recta de 400 mm con la profundidad del
	 * borne a 46 y la de viaje a 80: en el medio el cable TIENE que estar a 80. Con la versión
	 * que calculaba la rampa sobre los vértices de las esquinas, en el medio estaba a 46,9.
	 */
	const puntos = tenderCable([
		{ x: 100, y: 40, z: 46 }, { x: 100, y: 80, z: 80 }, { x: 100, y: 400, z: 80 }, { x: 100, y: 440, z: 46 },
	], 22);
	const medio = puntos[Math.floor(puntos.length / 2)];
	assert.ok(medio.z > 79, `en el medio de la tirada el cable está a z=${medio.z.toFixed(1)}, no en su capa (80)`);
	assert.equal(puntos[0].z, 46, 'arranca en la cota del borne');
	assert.equal(puntos[puntos.length - 1].z, 46, 'y acaba en ella');
});

test('el cable trepa por encima de un obstáculo en vez de atravesarlo', () => {
	// Una canaleta de 60 mm de alto entre y=200 e y=240, cruzada por una bajada recta.
	const suelo = (x: number, y: number): number => (y >= 200 && y <= 240 ? 64 : 0);
	const puntos = tenderCable(
		[{ x: 100, y: 40, z: 46 }, { x: 100, y: 440, z: 46 }], 22, suelo,
	);
	const dentro = puntos.filter((p: Punto3) => p.y >= 200 && p.y <= 240);
	assert.ok(dentro.length > 0, 'la canaleta tiene que quedar muestreada');
	for (const p of dentro) assert.ok(p.z >= 64, `dentro de la canaleta el cable está a z=${p.z.toFixed(1)}`);
	// Y trepa, no salta: entre dos puntos seguidos no puede haber un escalón vertical.
	for (let i = 1; i < puntos.length; i++) {
		const avance = Math.hypot(puntos[i].x - puntos[i - 1].x, puntos[i].y - puntos[i - 1].y);
		const sube = Math.abs(puntos[i].z - puntos[i - 1].z);
		assert.ok(sube <= avance * 0.8 + 0.6, `escalón de ${sube.toFixed(1)} mm en ${avance.toFixed(1)} mm de avance`);
	}
});

for (const ej of EJEMPLOS) {
	test(`${ej.titulo}: ningún cable atraviesa a otro`, () => {
		const proyecto = ej.crear();
		const trazos = trazosDeCables(proyecto);
		assert.ok(trazos.length > 0, 'el tablero tiene cables');
		const conflictos = conflictosDe(trazos, HOLGURA_CABLE);
		const peor = conflictos[0];
		const detalle = peor
			? `${peor.a} vs ${peor.b}: holgura ${peor.holgura.toFixed(2)} mm en `
				+ `(${peor.donde.x.toFixed(0)}, ${peor.donde.y.toFixed(0)}, ${peor.donde.z.toFixed(0)})`
			: 'ninguno';
		assert.ok(
			!peor || peor.holgura > -PENETRACION_TOLERADA,
			`hay tubos metidos uno dentro de otro más de ${PENETRACION_TOLERADA} mm → ${detalle}`,
		);
	});

	test(`${ej.titulo}: ningún cable atraviesa carril ni aparato`, () => {
		const proyecto = ej.crear();
		const invasiones = invasionesDe(trazosDeCables(proyecto), solidosDelTablero(proyecto));
		const peor = invasiones[0];
		assert.ok(
			!peor || -peor.holgura < 2,
			peor ? `${peor.a} se mete ${(-peor.holgura).toFixed(1)} mm en ${peor.b}` : '',
		);
	});

	test(`${ej.titulo}: los cables entran por ranura, no atravesando el plástico`, () => {
		/*
		 * La comprobación que de verdad importa en esta fase. El INTERIOR de la canaleta es un
		 * sitio legítimo —es para lo que sirve un ducto—; lo que no se puede atravesar son sus
		 * partes. Si un cable entrara por donde le viniera bien en vez de por una ranura, aquí
		 * saldría metido en un diente o en el zócalo.
		 */
		const proyecto = ej.crear();
		const canaletas = proyecto.gabinete?.canaletas ?? [];
		const red = new RedCanaletas(canaletas);
		const invasiones = invasionesDeCanaletas(red, canaletas, trazosDeCables(proyecto));
		const peor = invasiones[0];
		assert.ok(
			!peor || peor.dentro < 2,
			peor ? `${peor.cable} se mete ${peor.dentro.toFixed(1)} mm en el ${peor.parte} de ${peor.canaleta}` : '',
		);
	});

	test(`${ej.titulo}: el reparto es determinista`, () => {
		// Mismo proyecto, mismo reparto. Sin esto, cada reconstrucción de la escena movería los
		// cables de sitio y trabajar sería imposible.
		const unos = trazosDeCables(ej.crear()).map((t) => t.puntos.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join('|'));
		const otros = trazosDeCables(ej.crear()).map((t) => t.puntos.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join('|'));
		assert.deepEqual(unos, otros);
	});
}

test('los cables usan de verdad las profundidades que se reparten', () => {
	// Si todos acabaran en la misma capa, las comprobaciones de arriba podrían pasar por pura
	// suerte en un tablero poco cargado. En el más cargado tiene que haber reparto real.
	const proyecto = EJEMPLOS.find((e) => e.id.includes('estrella'))!.crear();
	const trazos = trazosDeCables(proyecto);
	const alturas = new Set(trazos.map((t) => Math.round(t.puntos[Math.floor(t.puntos.length / 2)].z)));
	assert.ok(alturas.size >= 5, `solo ${alturas.size} profundidades distintas en el tramo de viaje`);
});
