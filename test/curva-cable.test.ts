/**
 * UN CODO NO PUEDE SALIR EN PICO, NI ESTRANGULARSE, NI FACETEARSE.
 *
 * En una captura de uso real apareció un conductor con la esquina pinzada: cambio brusco de
 * dirección, aspecto de inglete, el tubo dejando de parecer un tubo. Lo primero era saber si la
 * culpa era del RECORRIDO o de la MALLA que se construye con él, porque son dos arreglos
 * distintos y el ruteo está congelado. Medido, los puntos del recorrido eran razonables: la
 * deformación nacía al redondear.
 *
 * `redondear3D` medía la longitud de los segmentos con `hypot(dx, dy)` —sin la z— y luego aplicaba
 * la fracción resultante al vector completo. Mientras todos los cables corrían por delante del
 * tablero eso pasaba desapercibido, porque la profundidad apenas cambiaba. Desde que entran y
 * salen de las canaletas hay codos que son un cambio PURO de profundidad: para aquella cuenta
 * medían cero, se saltaban el redondeo entero y el tubo giraba noventa grados de golpe.
 *
 * Estas pruebas guardan las tres propiedades que tiene que cumplir cualquier codo, venga de donde
 * venga: que la dirección no pegue saltos, que la sección no se estreche y que el radio se
 * degrade con elegancia cuando no cabe.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from 'three';

import { Punto3, tenderCable } from '../app/geometria-cables.js';

/** Los casos que hay que aguantar, incluidos los que antes rompían. */
const CASOS: Record<string, Punto3[]> = {
	'90 grados': [{ x: 0, y: 0, z: 46 }, { x: 100, y: 0, z: 46 }, { x: 100, y: 100, z: 46 }],
	'S de dos codos': [{ x: 0, y: 0, z: 46 }, { x: 60, y: 0, z: 46 }, { x: 60, y: 60, z: 46 }, { x: 120, y: 60, z: 46 }],
	'dos codos muy juntos': [{ x: 0, y: 0, z: 46 }, { x: 40, y: 0, z: 46 }, { x: 48, y: 8, z: 46 }, { x: 48, y: 80, z: 46 }],
	'segmento corto': [{ x: 0, y: 0, z: 46 }, { x: 6, y: 0, z: 46 }, { x: 6, y: 80, z: 46 }],
	'tres casi alineados': [{ x: 0, y: 0, z: 46 }, { x: 50, y: 1, z: 46 }, { x: 100, y: 0, z: 46 }],
	'cambio de profundidad': [{ x: 0, y: 0, z: 46 }, { x: 60, y: 0, z: 46 }, { x: 60, y: 0, z: 12 }, { x: 60, y: 90, z: 12 }],
	'entrada a canaleta': [{ x: 0, y: 0, z: 46 }, { x: 80, y: 0, z: 46 }, { x: 82, y: 4, z: 18 }, { x: 160, y: 4, z: 18 }],
	'tres codos en Z': [
		{ x: 0, y: 0, z: 46 }, { x: 40, y: 0, z: 46 }, { x: 40, y: 0, z: 16 },
		{ x: 120, y: 0, z: 16 }, { x: 120, y: 0, z: 46 }, { x: 160, y: 0, z: 46 },
	],
};

/** Lo que gira la dirección del recorrido de un tramo al siguiente, en grados. */
function giroMaximo(pts: Punto3[]): number {
	let peor = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const d0 = new THREE.Vector3(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
		const d1 = new THREE.Vector3(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y, pts[i + 1].z - pts[i].z);
		if (d0.length() < 1e-9 || d1.length() < 1e-9) continue;
		peor = Math.max(peor, THREE.MathUtils.radToDeg(d0.angleTo(d1)));
	}
	return peor;
}

/*
 * 20° es el tope, y no es arbitrario: los arcos se reparten en trozos de 15° nominales, así que
 * cualquier codo bien construido se queda por debajo. Antes de arreglarlo, el cambio de
 * profundidad daba 90° —el codo en pico de la captura— y el segmento corto 36,9°.
 */
const GIRO_MAXIMO = 20;

for (const [nombre, nodos] of Object.entries(CASOS)) {
	test(`«${nombre}»: la dirección del cable no pega saltos`, () => {
		const g = giroMaximo(tenderCable(nodos, 14));
		assert.ok(g <= GIRO_MAXIMO, `gira ${g.toFixed(1)}° de un tramo al siguiente (tope ${GIRO_MAXIMO}°)`);
	});

	test(`«${nombre}»: el tubo mantiene su sección`, () => {
		const pts = tenderCable(nodos, 14);
		const curva = new THREE.CatmullRomCurve3(
			pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal', 0.5,
		);
		const RADIO = 2.2, LADOS = 12;
		const segmentos = Math.min(260, Math.max(64, pts.length * 3));
		const geo = new THREE.TubeGeometry(curva, segmentos, RADIO, LADOS, false);
		const pos = geo.attributes.position;
		/*
		 * Se mide el radio de CADA anillo respecto a su propio centro. Medirlo contra un punto de la
		 * curva no vale: `TubeGeometry` coloca sus anillos por longitud de arco y `getPoint` va por
		 * parámetro, así que salían distancias de sesenta milímetros en un tubo de dos y parecía que
		 * el tubo estaba reventado cuando lo que estaba mal era la vara de medir.
		 */
		let menor = Infinity, mayor = 0;
		for (let s = 0; s <= segmentos; s++) {
			const centro = new THREE.Vector3();
			for (let k = 0; k < LADOS; k++) centro.add(new THREE.Vector3().fromBufferAttribute(pos, s * (LADOS + 1) + k));
			centro.divideScalar(LADOS);
			for (let k = 0; k < LADOS; k++) {
				const r = new THREE.Vector3().fromBufferAttribute(pos, s * (LADOS + 1) + k).distanceTo(centro);
				menor = Math.min(menor, r); mayor = Math.max(mayor, r);
			}
		}
		assert.ok(menor > RADIO * 0.95, `el tubo se estrecha hasta ${menor.toFixed(2)} de ${RADIO}`);
		assert.ok(mayor < RADIO * 1.05, `el tubo se ensancha hasta ${mayor.toFixed(2)} de ${RADIO}`);
	});
}

test('un codo que no cabe encoge el radio en vez de romperse', () => {
	// 6 mm de segmento con 14 de radio pedido: no cabe ni de lejos. Tiene que salir un codo más
	// cerrado, no una esquina en pico ni un tubo con un pellizco.
	const pts = tenderCable(CASOS['segmento corto'], 14);
	assert.ok(pts.length > 3, 'el codo apretado sigue teniendo arco');
	assert.ok(giroMaximo(pts) <= GIRO_MAXIMO, 'y el arco es suave');
});

test('los puntos pegados no llegan a la geometría', () => {
	/*
	 * Un tramo de longitud cero no tiene dirección, así que redondear contra él manda el arco a
	 * donde diga el ruido. En el estrella-triángulo había 59 puntos exactamente repetidos y 391
	 * tramos de menos de medio milímetro: por ahí es por donde un conductor que bajaba a la
	 * canaleta se desviaba hasta meterse encima del que ya corría dentro.
	 */
	const conBasura: Punto3[] = [
		{ x: 0, y: 0, z: 46 }, { x: 40, y: 0, z: 46 }, { x: 40, y: 0, z: 46 },
		{ x: 40.2, y: 0.1, z: 46 }, { x: 40, y: 60, z: 46 },
	];
	const pts = tenderCable(conBasura, 14);
	for (let i = 1; i < pts.length; i++) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
		assert.ok(d > 1e-6, `hay un tramo de longitud ${d} en el punto ${i}`);
	}
	assert.ok(giroMaximo(pts) <= GIRO_MAXIMO, 'y el recorrido no serpentea por culpa de ellos');
});
