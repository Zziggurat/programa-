/**
 * LOS PILOTOS DE PUERTA SE ENCIENDEN PORQUE HAY CORRIENTE, no porque alguien lo diga.
 *
 * Ésta es la prueba que decide si la integración está bien hecha. Es facilísimo hacer que una luz
 * se encienda: se le pone un `encendido = true` y ya luce. Lo que cuesta —y lo único que sirve—
 * es que luzca por la MISMA razón por la que lo haría en el tablero: porque entre sus dos bornes
 * hay una fase y un retorno, y porque el circuito que la alimenta está cerrado.
 *
 * Si mañana alguien mete un segundo sistema eléctrico «solo para los pilotos», estas pruebas se
 * caen: comprueban el resultado del simulador de verdad, el mismo que enciende un motor.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from 'three';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { simular } from '../src/motores/simulacion.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { revisarTablero } from '../src/motores/revision.js';
import { cajaDeGabinete } from '../src/modelo/proyecto.js';
import { construirEnvolvente } from '../app/gabinete3d.js';
import {
	colorApagado, colorDePiloto, construirComponentePuerta, COLOR_PILOTO, fichaFrontal,
	valoresPorDefecto,
} from '../app/componentes-puerta.js';
import { Dispositivo, Proyecto } from '../src/modelo/tipos.js';

function tablero(): Proyecto {
	return EJEMPLOS.find((e) => /estrella/i.test(e.titulo))!.crear();
}

const PILOTOS = ['hr', 'hs', 'ht'];

test('los tres pilotos de fase se encienden con el tablero con tensión', () => {
	const p = tablero();
	const r = simular(p, {});
	for (const id of PILOTOS) {
		assert.ok(r.activos.has(id), `el piloto ${id} no se enciende con el tablero energizado`);
	}
	// Y no es un adorno: consumen, y su consumo sale en el total del tablero.
	const suyos = r.consumos.filter((c) => PILOTOS.includes(c.dispositivoId));
	assert.equal(suyos.length, 3, 'los pilotos no aparecen entre los consumos');
	for (const c of suyos) assert.ok(c.corriente > 0, `${c.dispositivoId} consume ${c.corriente} A`);
});

test('sin tensión en la acometida no se enciende ninguno', () => {
	/*
	 * Se corta por la acometida, no por una bandera: se quitan los conductores que traen las tres
	 * fases al tablero. Si algún piloto siguiera encendido, es que no dependía del circuito.
	 */
	const p = tablero();
	p.conductores = p.conductores.filter((c) => c.de.dispositivoId !== 'red' || c.de.borneId === 'N');
	const r = simular(p, {});
	for (const id of PILOTOS) {
		assert.ok(!r.activos.has(id), `el piloto ${id} sigue encendido sin acometida`);
	}
});

test('si falta UNA fase se apaga SOLO su piloto', () => {
	/*
	 * Es el caso que pidió Diego, y es la prueba de que los tres son independientes de verdad:
	 * R encendido, S apagado, T encendido. Se quita el hilo que lleva la fase S a su piloto —lo
	 * mismo que un fusible fundido o un borne flojo— y se comprueba que los otros dos ni se
	 * enteran.
	 */
	const p = tablero();
	const antes = p.conductores.length;
	p.conductores = p.conductores.filter(
		(c) => !(c.a.dispositivoId === 'hs' && c.a.borneId === 'X1'),
	);
	assert.equal(p.conductores.length, antes - 1, 'no se encontró el hilo de la fase S');

	const r = simular(p, {});
	assert.ok(r.activos.has('hr'), 'R tenía que seguir encendido');
	assert.ok(!r.activos.has('hs'), 'S tenía que quedarse apagado');
	assert.ok(r.activos.has('ht'), 'T tenía que seguir encendido');
});

test('el piloto es un aparato normal: sobrevive a guardar y volver a abrir', () => {
	const p = tablero();
	const vuelto = cargarProyecto(JSON.stringify(p)).proyecto;
	for (const id of PILOTOS) {
		const d = vuelto.dispositivos.find((x) => x.id === id);
		assert.ok(d, `el piloto ${id} se perdió al recargar`);
		assert.equal(d!.tipo, 'piloto');
		assert.ok(d!.colorSenal, `${id} perdió su color de señalización`);
		const col = vuelto.gabinete!.colocaciones.find((c) => c.dispositivoId === id);
		assert.equal(col?.montaje, 'puerta', `${id} dejó de estar montado en la puerta`);
	}
	// Y sigue encendiendo igual después del viaje de ida y vuelta.
	const r = simular(vuelto, {});
	for (const id of PILOTOS) assert.ok(r.activos.has(id), `${id} no enciende tras recargar`);
});

/* ------------------------- La pieza y su sitio en la puerta ------------------------- */

function pilotoDePrueba(color: string): Dispositivo {
	return {
		id: 'hx', tipo: 'piloto', designacion: 'X', colorSenal: color,
		bornes: [{ id: 'X1' }, { id: 'X2' }],
	} as Dispositivo;
}

test('el color es un parámetro, no una rama: los cinco salen del mismo constructor', () => {
	const vistos = new Set<number>();
	for (const nombre of ['rojo', 'verde', 'ambar', 'azul', 'blanco']) {
		const g = construirComponentePuerta(pilotoDePrueba(nombre), { dispositivoId: 'hx', x: 0, y: 0, ancho: 30, alto: 30 });
		let lente: THREE.Mesh | undefined;
		g.traverse((o) => { if (o.userData.pieza === 'lente') lente = o as THREE.Mesh; });
		assert.ok(lente, `el piloto ${nombre} no tiene lente`);
		const propio = lente!.userData.colorPropio as number;
		assert.equal(propio, COLOR_PILOTO[nombre], `el piloto ${nombre} no salió de su color`);
		vistos.add(propio);
		// Apagado es el mismo tono más oscuro, no otro color: un rojo apagado sigue siendo rojo.
		const apagado = new THREE.Color(lente!.userData.colorApagado as number);
		const encendido = new THREE.Color(propio);
		const a = { h: 0, s: 0, l: 0 };
		const b = { h: 0, s: 0, l: 0 };
		apagado.getHSL(a);
		encendido.getHSL(b);
		assert.ok(a.l < b.l * 0.6, `el ${nombre} apagado no se ve más oscuro que encendido`);
		if (b.s > 0.1) assert.ok(Math.abs(a.h - b.h) < 0.02, `el ${nombre} apagado cambió de tono`);
	}
	assert.equal(vistos.size, 5, 'dos colores distintos dieron el mismo número');
});

test('un color desconocido no deja el piloto sin lente', () => {
	// Un dato raro en un archivo no puede hacer desaparecer un aparato: sale blanco y se ve.
	assert.equal(colorDePiloto(pilotoDePrueba('turquesa')), COLOR_PILOTO.blanco);
	assert.equal(colorDePiloto(pilotoDePrueba('#123456')), 0x123456);
	assert.ok(colorApagado(0xd8332c) !== 0xd8332c);
});

test('el piloto atraviesa la chapa: se ve por fuera y por dentro, y es UNA pieza', () => {
	const { grupo, puerta } = construirEnvolvente(660, 660, 160);
	const g = construirComponentePuerta(pilotoDePrueba('rojo'), { dispositivoId: 'hx', x: 250, y: 70, ancho: 30, alto: 30 });
	puerta.colocar(g, 'frente', 250, 70, 0);
	grupo.updateMatrixWorld(true);

	const caja = new THREE.Box3().setFromObject(g);
	// Por fuera de la hoja hay lente y aro; por dentro, cuerpo y terminales. La pieza tiene que
	// cruzar el plano de la cara exterior de la puerta, que es donde está su origen.
	const origen = g.getWorldPosition(new THREE.Vector3());
	assert.ok(caja.max.z > origen.z + 3, 'el piloto no asoma por fuera de la puerta');
	assert.ok(caja.min.z < origen.z - 25, 'el piloto no sale por dentro de la puerta');
});

test('al abrir la puerta, la lente y los terminales se mueven juntos', () => {
	/*
	 * El piloto se coloca UNA vez y la chapa pasa por en medio, así que no hay dos posiciones que
	 * mantener sincronizadas. Esto lo comprueba: se miran dos piezas que están en caras opuestas
	 * y se exige que la distancia entre ellas no cambie ni una milésima al abrir.
	 */
	const { grupo, puerta } = construirEnvolvente(660, 660, 160);
	const g = construirComponentePuerta(pilotoDePrueba('verde'), { dispositivoId: 'hx', x: 250, y: 70, ancho: 30, alto: 30 });
	puerta.colocar(g, 'frente', 250, 70, 0);

	let lente: THREE.Object3D | undefined;
	let terminal: THREE.Object3D | undefined;
	g.traverse((o) => {
		if (o.userData.pieza === 'lente') lente = o;
		if (o.userData.borneId === 'X2') terminal = o;
	});
	assert.ok(lente && terminal, 'faltan la lente o el terminal');

	const donde = (o: THREE.Object3D) => {
		grupo.updateMatrixWorld(true);
		return o.getWorldPosition(new THREE.Vector3());
	};
	const cerrada = { l: donde(lente!), t: donde(terminal!) };
	const separacion = cerrada.l.distanceTo(cerrada.t);

	puerta.pivote.rotation.y = puerta.aperturaMaxima;
	const abierta = { l: donde(lente!), t: donde(terminal!) };

	assert.ok(cerrada.l.distanceTo(abierta.l) > 100, 'el piloto no se movió al abrir la puerta');
	assert.ok(
		Math.abs(abierta.l.distanceTo(abierta.t) - separacion) < 1e-6,
		'la lente y su terminal se separaron al abrir: no son la misma pieza',
	);
});

test('un aparato de puerta y uno de placa no se estorban aunque compartan coordenadas', () => {
	/*
	 * Esto lo cazó el DRC en cuanto se montaron los tres pilotos: daba tres errores de solape
	 * -«f2 y hr se solapan en la placa»- en un tablero perfectamente montado. Las coordenadas de
	 * la placa y las de la puerta se parecen —las dos se miden en milímetros desde una esquina de
	 * arriba a la izquierda— pero son de sitios distintos, separados por el fondo del armario.
	 *
	 * Se comprueba con el caso extremo: dos aparatos EXACTAMENTE en las mismas coordenadas, uno en
	 * cada superficie. No pueden estorbarse, y dos en la MISMA sí.
	 */
	const p = tablero();
	const hr = p.gabinete!.colocaciones.find((c) => c.dispositivoId === 'hr')!;
	const f2 = p.gabinete!.colocaciones.find((c) => c.dispositivoId === 'f2')!;
	hr.x = f2.x;
	hr.y = f2.y;
	hr.ancho = f2.ancho;
	hr.alto = f2.alto;

	const r = revisarTablero(p);
	const solapes = r.hallazgos.filter((h) => h.regla === 'S1-solape');
	assert.equal(solapes.length, 0, `sobran solapes: ${solapes.map((h) => h.mensaje).join(' · ')}`);

	// Y la regla no se ha roto: dos en la MISMA superficie sí tienen que cantar.
	hr.montaje = undefined;
	const r2 = revisarTablero(p);
	assert.ok(
		r2.hallazgos.some((h) => h.regla === 'S1-solape'),
		'dos aparatos encimados en la placa tienen que dar error de solape',
	);
});

test('un componente de puerta se mide contra la PUERTA, no contra la placa', () => {
	/*
	 * La puerta es del tamaño del armario y el armario es mayor que la placa. Un piloto colocado
	 * en la banda que hay entre las dos medidas está perfectamente dentro de la puerta, y medido
	 * contra la placa saldría fuera.
	 */
	const p = tablero();
	const caja = cajaDeGabinete(p.gabinete!);
	assert.ok(caja.ancho > p.gabinete!.ancho, 'este ejemplo no sirve: la caja no es mayor que la placa');
	const hr = p.gabinete!.colocaciones.find((c) => c.dispositivoId === 'hr')!;
	hr.x = p.gabinete!.ancho + 5;         // fuera de la placa, dentro de la puerta
	hr.ancho = 30;
	assert.ok(hr.x + hr.ancho <= caja.ancho, 'el caso de prueba no cabe en la puerta');
	assert.ok(
		!revisarTablero(p).hallazgos.some((h) => h.mensaje.includes('hr') && /fuera/i.test(h.mensaje)),
		'un piloto dentro de la puerta no puede salir como fuera de sitio',
	);
});

/* ===================== Lo que descubrió el uso real ===================== */

test('el color de un piloto es SUYO: cambiar uno no toca a los demás', () => {
	/*
	 * El fallo que Diego encontró usando el programa: los pilotos salían verdes y no había forma de
	 * cambiarlos. La causa no era el valor por defecto —eso habría sido un parche de una línea—
	 * sino que no existía NINGÚN control para tocar `colorSenal`: la ficha del aparato, en el
	 * espacio Frontal, solo ofrecía los controles de cablear.
	 *
	 * Esto fija la parte que se puede probar sin navegador: que el color es una propiedad
	 * individual y que cada piloto construye su propio material. Si dos pilotos compartieran
	 * material —que es como se rompe esto de verdad— cambiar uno cambiaría el otro.
	 */
	const uno = pilotoDePrueba('rojo');
	const otro = { ...pilotoDePrueba('verde'), id: 'hy' } as Dispositivo;
	const ga = construirComponentePuerta(uno, { dispositivoId: uno.id, x: 0, y: 0, ancho: 30, alto: 30 });
	const gb = construirComponentePuerta(otro, { dispositivoId: 'hy', x: 0, y: 0, ancho: 30, alto: 30 });
	const lenteDe = (g: THREE.Object3D) => {
		let m: THREE.Mesh | undefined;
		g.traverse((o) => { if (o.userData.pieza === 'lente') m = o as THREE.Mesh; });
		return m!;
	};
	const a = lenteDe(ga);
	const b = lenteDe(gb);
	assert.notEqual(a.material, b.material, 'dos pilotos comparten el material de la lente');
	assert.equal(a.userData.colorPropio, COLOR_PILOTO.rojo);
	assert.equal(b.userData.colorPropio, COLOR_PILOTO.verde);

	// Y tocar el material de uno no puede llegar al otro.
	(a.material as THREE.MeshStandardMaterial).color.setHex(0x123456);
	assert.notEqual((b.material as THREE.MeshStandardMaterial).color.getHex(), 0x123456);
});

test('la ficha del piloto declara su color, y no está escrito en el editor', () => {
	/*
	 * La otra mitad del arreglo: el editor no sabe qué es un piloto. Le pregunta a la ficha qué se
	 * puede configurar y dibuja lo que le digan. Si mañana el pulsador declara sus propiedades, el
	 * panel las enseña sin tocar una línea de interfaz.
	 */
	const f = fichaFrontal(pilotoDePrueba('rojo'));
	const color = f.propiedades.find((p) => p.clave === 'colorSenal');
	assert.ok(color, 'la ficha del piloto no declara su color');
	assert.equal(color!.tipo, 'lista');
	for (const n of ['rojo', 'verde', 'ambar', 'azul', 'blanco']) {
		assert.ok(color!.opciones?.some((o) => o.valor === n), `falta el color ${n}`);
	}
	// Y el valor con el que nace un piloto sale de ahí, no de un literal en `main`.
	assert.equal(valoresPorDefecto('piloto').colorSenal, color!.porDefecto);
});

test('la lente es REDONDA y sobresale lo que dice sobresalir', () => {
	/*
	 * ESTA ES LA PRUEBA QUE FALTABA CUANDO EL BUG ESTABA VIVO.
	 *
	 * La lente era un casquete de esfera con `scale.z = 0,62` puesto para aplastar la cúpula. Pero
	 * la malla se gira después 90° sobre X, y ese giro lleva el eje local +Y —el de la cúpula— a
	 * +Z y el local +Z a −Y. O sea que el factor no aplastaba la cúpula: aplastaba la lente EN
	 * VERTICAL. Salía un óvalo de 21,3 × 13,2 mm que además sobresalía 14,2 mm en vez de 7,4.
	 *
	 * Las 700 pruebas pasaban igual, porque ninguna miraba la forma. Ésta la mira: la lente tiene
	 * que medir lo mismo de ancho que de alto —es un vidrio de revolución— y no puede sobresalir
	 * más de lo que promete el vuelo del conjunto.
	 */
	const { grupo, puerta } = construirEnvolvente(660, 660, 160);
	const g = construirComponentePuerta(pilotoDePrueba('rojo'), { dispositivoId: 'hx', x: 250, y: 70, ancho: 30, alto: 30 });
	puerta.colocar(g, 'frente', 250, 70, 0);
	grupo.updateMatrixWorld(true);

	let lente: THREE.Mesh | undefined;
	g.traverse((o) => { if (o.userData.pieza === 'lente') lente = o as THREE.Mesh; });
	assert.ok(lente, 'el piloto no tiene lente');

	const caja = new THREE.Box3().setFromObject(lente!);
	const ancho = caja.max.x - caja.min.x;
	const alto = caja.max.y - caja.min.y;
	assert.ok(Math.abs(ancho - alto) < 0.4, `la lente no es redonda: ${ancho.toFixed(1)} × ${alto.toFixed(1)} mm`);

	const origen = g.getWorldPosition(new THREE.Vector3());
	const vuelo = caja.max.z - origen.z;
	assert.ok(vuelo > 5 && vuelo <= 8, `la lente sobresale ${vuelo.toFixed(1)} mm, que no es el vuelo del piloto`);
	// Y cabe dentro del embellecedor, que es lo que la sujeta.
	assert.ok(ancho < 30, `la lente mide ${ancho.toFixed(1)} mm y no cabe en un aro de Ø22`);
});

test('el resplandor cae FUERA del aro, que es donde se puede ver', () => {
	/*
	 * El halo medía 1,28 veces el aro, así que todo el degradado se consumía por debajo del metal
	 * opaco. Medido sobre la aplicación —luminancia alrededor del piloto, apagado contra
	 * encendido— aportaba cero fuera del embellecedor a cualquier distancia: existía en el código
	 * y no en la pantalla. Tiene que ser bastante mayor que el aro, y quedarse pegado a la chapa
	 * para no verse como un disco flotante al mirar la puerta de canto.
	 */
	const g = construirComponentePuerta(pilotoDePrueba('rojo'), { dispositivoId: 'hx', x: 0, y: 0, ancho: 30, alto: 30 });
	let halo: THREE.Mesh | undefined;
	let aro: THREE.Mesh | undefined;
	g.traverse((o) => {
		if (o.userData.pieza === 'halo') halo = o as THREE.Mesh;
		if ((o as THREE.Mesh).isMesh && o.userData.pieza === undefined && !aro
			&& (o as THREE.Mesh).geometry.type === 'LatheGeometry') aro = o as THREE.Mesh;
	});
	assert.ok(halo && aro, 'falta el halo o el aro');
	halo!.geometry.computeBoundingBox();
	aro!.geometry.computeBoundingBox();
	const rHalo = halo!.geometry.boundingBox!.max.x;
	const rAro = aro!.geometry.boundingBox!.max.x;
	assert.ok(rHalo > rAro * 1.8, `el resplandor (${rHalo} mm) no rebasa el aro (${rAro} mm) lo bastante para verse`);
	assert.ok(halo!.position.z < 3, 'el halo vuela por delante de la lente y se ve de canto');
});
