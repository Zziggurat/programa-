/**
 * UN CABLE METIDO A MANO EN UNA CANALETA TIENE QUE ESTAR DE VERDAD DENTRO.
 *
 * Hasta ahora el peinado manual era `{x, y}`: el usuario decía por dónde pasaba el cable mirando
 * el tablero de frente y la profundidad la ponía el repartidor, la misma para todos los puntos del
 * peinado. Con eso, un cable llevado a mano no podía entrar en un ducto ni cambiar de plano a
 * mitad de camino, por mucho que el ruteo automático supiera hacer las dos cosas. El editor era 2D
 * encima de un motor 3D.
 *
 * Lo que se guarda aquí es que la profundidad que fija el usuario LLEGA a la geometría que se
 * dibuja, y que no se queda por el camino: ni la aplana el repartidor, ni la expulsa el suelo que
 * levanta los cables por encima de los ductos que no son suyos.
 *
 * No se comprueba escondiendo el cable ni mirando un flag: se mide dónde caen los puntos del
 * recorrido final, que son los mismos que dibuja la escena.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { encajarEnCanaleta, RedCanaletas } from '../app/canaletas-red.js';
import { rutasDeCables } from '../app/escena3d.js';
import { longitudCoincidente3D } from '../app/colisiones-cables.js';

/** El estrella-triángulo, que es el que tiene canaletas largas y cables de sobra. */
function tablero() {
	const proyecto = EJEMPLOS.find((e) => /estrella/i.test(e.titulo))!.crear();
	const canaleta = proyecto.gabinete!.canaletas.find((c) => c.orientacion === 'h')!;
	return { proyecto, canaleta };
}

test('la profundidad que fija el usuario llega a la geometría dibujada', () => {
	const { proyecto, canaleta } = tablero();
	const c = proyecto.conductores[0];
	const zPedida = Math.round(canaleta.alto * 0.5);
	const eje = (f: number) => Math.round(canaleta.x + canaleta.largo * f);
	c.trazado = [
		{ x: eje(0.3), y: Math.round(canaleta.y), z: zPedida },
		{ x: eje(0.5), y: Math.round(canaleta.y), z: zPedida },
		{ x: eje(0.7), y: Math.round(canaleta.y), z: zPedida },
	];

	const ruta = rutasDeCables(proyecto).find((r) => r.conductorId === c.id);
	assert.ok(ruta, 'el cable tiene recorrido');
	const dentro = ruta!.puntos.filter((p) => p.x >= canaleta.x && p.x <= canaleta.x + canaleta.largo
		&& Math.abs(p.y - canaleta.y) <= canaleta.ancho / 2
		&& p.z >= 2 && p.z <= canaleta.alto);
	assert.ok(dentro.length >= 5, `solo ${dentro.length} puntos del recorrido caen dentro de la canaleta`);
	// Y a la profundidad pedida, no a la que le habría tocado por capa (que ronda los 46 mm).
	const zMedia = dentro.reduce((a, p) => a + p.z, 0) / dentro.length;
	assert.ok(
		Math.abs(zMedia - zPedida) < 8,
		`el cable va a z≈${zMedia.toFixed(1)} y se pidió ${zPedida}: la profundidad manual se perdió`,
	);
});

test('un punto sin profundidad se sigue comportando como antes', () => {
	/*
	 * La compatibilidad no es un detalle: los proyectos que ya existen tienen peinados sin z, y si
	 * al abrirlos el cable se fuera al fondo del armario, el trabajo guardado de Diego cambiaría
	 * de sitio solo. Un punto sin z tiene que seguir saliendo por delante del tablero.
	 */
	const { proyecto } = tablero();
	const c = proyecto.conductores[0];
	c.trazado = [{ x: 200, y: 300 }, { x: 300, y: 300 }];
	const ruta = rutasDeCables(proyecto).find((r) => r.conductorId === c.id)!;
	const enMedio = ruta.puntos.filter((p) => p.x > 190 && p.x < 310 && Math.abs(p.y - 300) < 12);
	assert.ok(enMedio.length > 0, 'el cable pasa por donde se le dijo');
	for (const p of enMedio) {
		assert.ok(p.z > 20, `un punto sin z acabó a ${p.z.toFixed(1)} mm, metido en el tablero`);
	}
});

test('el encaje mete el punto en el volumen útil, no en el centro visual', () => {
	const { proyecto, canaleta } = tablero();
	const red = new RedCanaletas(proyecto.gabinete!.canaletas);
	const radio = 3;
	// Un punto que el usuario suelta contra la pared de la canaleta y por encima de la tapa.
	const bruto = { x: canaleta.x + canaleta.largo / 2, y: canaleta.y + canaleta.ancho, z: canaleta.alto + 30 };
	const encaje = encajarEnCanaleta(red, bruto, radio, 40);
	assert.ok(encaje, 'reconoce que el usuario va a por esa canaleta');
	assert.equal(encaje!.canaleta, canaleta.id);
	// Dentro de las paredes, descontando el propio tubo.
	assert.ok(
		Math.abs(encaje!.punto.y - canaleta.y) <= canaleta.ancho / 2,
		`quedó a ${encaje!.punto.y} y la canaleta va de ${canaleta.y - canaleta.ancho / 2} a ${canaleta.y + canaleta.ancho / 2}`,
	);
	// Y por debajo de la tapa, con su radio de margen.
	assert.ok(encaje!.punto.z <= canaleta.alto - radio, `quedó a z=${encaje!.punto.z} y la tapa está en ${canaleta.alto}`);
	assert.ok(encaje!.punto.z >= radio, `quedó a z=${encaje!.punto.z}, clavado en el fondo`);
});

test('lejos de toda canaleta no se inventa un encaje', () => {
	const { proyecto } = tablero();
	const red = new RedCanaletas(proyecto.gabinete!.canaletas);
	// Muy por encima del tablero y lejos de cualquier ducto.
	assert.equal(encajarEnCanaleta(red, { x: -400, y: -400, z: 46 }, 3), undefined);
});

test('dos cables llevados a la misma canaleta conservan la intención sin fusionarse', () => {
	/*
	 * Se llevan DOS conductores al mismo eje y profundidad. Ambos deben seguir dentro del corredor
	 * pedido, pero el segundo ocupa el sitio físico libre más cercano de la rejilla interior: una
	 * canaleta admite muchos hilos, no dos tubos con la misma línea central.
	 */
	const { proyecto, canaleta } = tablero();
	const [a, b] = proyecto.conductores.filter((c) => (c.seccion ?? 1.5) <= 1.5);
	// La regresión aísla la asignación de dos carriles; los otros 57 conductores del ejemplo
	// medirían además cómo el trazado manual negocia con un tablero ya ocupado, que es otra regla.
	proyecto.conductores = [a, b];
	const z = Math.round(canaleta.alto * 0.5);
	const eje = (f: number) => Math.round(canaleta.x + canaleta.largo * f);
	for (const c of [a, b]) {
		c.trazado = [
			{ x: eje(0.35), y: Math.round(canaleta.y), z },
			{ x: eje(0.65), y: Math.round(canaleta.y), z },
		];
	}

	const rutas = rutasDeCables(proyecto);
	for (const c of [a, b]) {
		const ruta = rutas.find((r) => r.conductorId === c.id);
		assert.ok(ruta, `${c.id} tiene recorrido`);
		for (const q of c.trazado!) {
			const cerca = ruta!.puntos.reduce(
				(m, p) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z!)), Infinity,
			);
			assert.ok(
				cerca < 25,
				`${c.id}: el punto (${q.x},${q.y},${q.z}) quedó a ${cerca.toFixed(1)} mm del cable dibujado`,
			);
		}
	}
	// Los dos siguen dentro del mismo corredor manual, cada uno en un sitio físico distinto.
	for (const c of [a, b]) {
		const ruta = rutas.find((r) => r.conductorId === c.id)!;
		const dentro = ruta.puntos.filter((p) => p.x >= eje(0.42) && p.x <= eje(0.58)
			&& Math.abs(p.y - canaleta.y) <= canaleta.ancho / 2);
		assert.ok(dentro.length > 0, `${c.id} no pasa por el tramo pedido`);
		// Uno de los dos debe abandonar la profundidad exacta pedida: exigirla aquí volvería a exigir
		// la fusión. Lo importante es que permanezca dentro del volumen útil y cerca de los waypoints
		// (comprobado arriba), ocupando otro sitio real de la misma canaleta.
		for (const p of dentro) assert.ok(p.z > 2 && p.z < canaleta.alto - 2, `${c.id} salió del volumen útil`);
	}
	const ra = rutas.find((r) => r.conductorId === a.id)!;
	const rb = rutas.find((r) => r.conductorId === b.id)!;
	assert.equal(longitudCoincidente3D(ra.puntos, rb.puntos), 0,
		'los trazados manuales no pueden convertirse en una sola geometría');
});
