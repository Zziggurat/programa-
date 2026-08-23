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
import {
	conflictosDe, distanciaSegmentos, invasionesDe, longitudCoincidente3D, radioZonaSalidaBorne,
} from '../app/colisiones-cables.js';
import { Punto3, tenderCable } from '../app/geometria-cables.js';
import {
	HOLGURA_CABLE, invalidarCacheRuteo, rutasDeCables, solidosDelTablero, trazosDeCables,
} from '../app/escena3d.js';
import { invasionesDeCanaletas, RedCanaletas } from '../app/canaletas-red.js';
import { cargarProyecto } from '../src/modelo/cargar.js';

/**
 * Cuánto se permite que se metan dos tubos, en mm. Cero sería lo ideal; esto es LO ALCANZADO, y el
 * número está aquí para que se vea cuando empeore, no como objetivo.
 *
 * Medido hoy sobre los cinco tableros: el peor par del estrella-triángulo se penetra 3,37 mm y el
 * del climatizador 2,32; en los otros tres no se penetra ninguno. El peor caso está siempre entre
 * dos conductores de 6 mm² en la salida de una fila de contactores, donde los tornillos están a
 * 9 mm y los dos tubos miden 6: por ahí no caben dos cables sin rozarse, se elija el camino que se
 * elija. Lo que sí se consiguió es que no quede NINGÚN par fundido —dos cables en el mismo
 * volumen, holgura −6,00 mm— que era lo que se veía antes.
 */
const PENETRACION_TOLERADA = 3.5;

/** Firma física por ID: el orden de las listas del modelo no forma parte del recorrido. */
function firmasDeRutas(proyecto: ReturnType<typeof EJEMPLOS[number]['crear']>): Record<string, string> {
	return Object.fromEntries(rutasDeCables(proyecto)
		.map((r) => [r.conductorId, r.puntos
			.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join('|')])
		.sort(([a], [b]) => a.localeCompare(b)));
}

/** Punto de una polilínea a una distancia física de uno de sus extremos. */
function puntoA(puntos: Punto3[], distancia: number, desdeElFinal: boolean): Punto3 {
	const lista = desdeElFinal ? puntos.slice().reverse() : puntos;
	let restante = distancia;
	for (let i = 1; i < lista.length; i++) {
		const a = lista[i - 1];
		const b = lista[i];
		const largo = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
		if (largo >= restante && largo > 0) {
			const t = restante / largo;
			return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
		}
		restante -= largo;
	}
	return lista[lista.length - 1];
}

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

test('la fusión 3D distingue una línea compartida de un cruce puntual', () => {
	const recta = [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }];
	const misma = [{ x: 20, y: 0, z: 10 }, { x: 80, y: 0, z: 10 }];
	const cruzada = [{ x: 50, y: -30, z: 10 }, { x: 50, y: 30, z: 10 }];
	const otraCapa = [{ x: 20, y: 0, z: 14 }, { x: 80, y: 0, z: 14 }];
	assert.ok(Math.abs(longitudCoincidente3D(recta, misma) - 60) < 1e-6);
	assert.equal(longitudCoincidente3D(recta, cruzada), 0);
	assert.equal(longitudCoincidente3D(recta, otraCapa), 0);
});

test('los cables de un mismo borne comparten el tornillo y se separan después', () => {
	const proyecto = EJEMPLOS[0].crear();
	const rutas = new Map(rutasDeCables(proyecto).map((r) => [r.conductorId, r]));
	const porBorne = new Map<string, { id: string; final: boolean }[]>();
	for (const c of proyecto.conductores) {
		for (const [ref, final] of [[c.de, false], [c.a, true]] as const) {
			const clave = `${ref.dispositivoId}:${ref.borneId}`;
			const lista = porBorne.get(clave) ?? [];
			lista.push({ id: c.id, final });
			porBorne.set(clave, lista);
		}
	}

	let pares = 0;
	for (const lista of porBorne.values()) {
		for (let i = 0; i < lista.length; i++) {
			for (let j = i + 1; j < lista.length; j++) {
				const a = rutas.get(lista[i].id)!;
				const b = rutas.get(lista[j].id)!;
				const anclaA = lista[i].final ? a.puntos[a.puntos.length - 1] : a.puntos[0];
				const anclaB = lista[j].final ? b.puntos[b.puntos.length - 1] : b.puntos[0];
				assert.ok(Math.hypot(anclaA.x - anclaB.x, anclaA.y - anclaB.y, anclaA.z - anclaB.z) < 1e-6,
					'el punto común del tornillo debe seguir siendo exacto');
				const salidaA = puntoA(a.puntos, 18, lista[i].final);
				const salidaB = puntoA(b.puntos, 18, lista[j].final);
				const separacion = Math.hypot(salidaA.x - salidaB.x, salidaA.y - salidaB.y, salidaA.z - salidaB.z);
				assert.ok(separacion >= 4,
					`${lista[i].id}/${lista[j].id} siguen fusionados a 18 mm del borne (${separacion.toFixed(2)} mm)`);
				const finZona = Math.max(radioZonaSalidaBorne(a.radio), radioZonaSalidaBorne(b.radio)) + 1;
				const libreA = puntoA(a.puntos, finZona, lista[i].final);
				const libreB = puntoA(b.puntos, finZona, lista[j].final);
				const libre = Math.hypot(libreA.x - libreB.x, libreA.y - libreB.y, libreA.z - libreB.z);
				assert.ok(libre >= a.radio + b.radio + HOLGURA_CABLE,
					`${lista[i].id}/${lista[j].id}: tras la zona de salida quedan ${libre.toFixed(2)} mm entre ejes`);
				pares++;
			}
		}
	}
	assert.ok(pares > 0, 'el fixture debe contener al menos un borne compartido');
});

test('varios cables comparten canaleta sin compartir línea central', () => {
	const proyecto = EJEMPLOS[2].crear();
	const trazos = trazosDeCables(proyecto);
	const red = new RedCanaletas(proyecto.gabinete?.canaletas ?? []);
	const dentro = (t: typeof red.tramos[number], p: Punto3): boolean => {
		const eje = t.esH ? p.x : p.y;
		const cruz = t.esH ? p.y : p.x;
		return eje > t.desde && eje < t.hasta
			&& Math.abs(cruz - t.centro) < t.semiancho && p.z > t.zMin && p.z < t.zMax;
	};
	const usuarios = new Map(red.tramos.map((t) => [t.id, trazos.filter((c) => c.puntos.some((p) => dentro(t, p))).length]));
	assert.ok([...usuarios.values()].some((n) => n >= 2), 'el fixture debe tener varios cables dentro de una canaleta');
	const fusionadosDentro: string[] = [];
	for (let i = 0; i < trazos.length; i++) {
		for (let j = i + 1; j < trazos.length; j++) {
			const compartenCanaleta = red.tramos.some((t) => trazos[i].puntos.some((p) => dentro(t, p))
				&& trazos[j].puntos.some((p) => dentro(t, p)));
			if (compartenCanaleta && longitudCoincidente3D(trazos[i].puntos, trazos[j].puntos) > 4) {
				fusionadosDentro.push(`${trazos[i].id}/${trazos[j].id}`);
			}
		}
	}
	assert.deepEqual(fusionadosDentro, [], 'compartir corredor no significa ocupar el mismo eje 3D');
});

test('el reparto no depende del orden de conductores ni canaletas', () => {
	const proyecto = EJEMPLOS[0].crear();
	invalidarCacheRuteo();
	const original = firmasDeRutas(proyecto);
	proyecto.conductores.reverse();
	proyecto.gabinete?.canaletas.reverse();
	invalidarCacheRuteo();
	assert.deepEqual(firmasDeRutas(proyecto), original);
});

test('guardar y cargar conserva la asignación física de recorridos', () => {
	const proyecto = EJEMPLOS[0].crear();
	invalidarCacheRuteo();
	const original = firmasDeRutas(proyecto);
	const carga = cargarProyecto(JSON.stringify(proyecto));
	assert.deepEqual(carga.arreglos, [], 'un proyecto actual no debe necesitar reparaciones al cargar');
	invalidarCacheRuteo();
	assert.deepEqual(firmasDeRutas(carga.proyecto), original);
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
		/*
		 * Cuatro milímetros y pico, medidos. Lo que queda no es un cable entrando por donde no
		 * debe: son uno o dos por tablero que TREPAN por encima de una canaleta para cruzarla y,
		 * al hacerlo justo donde esa canaleta se cruza con otra, rozan la tapa. Es el sitio donde
		 * las dos canaletas comparten volumen y el suelo de una discute con el interior de la
		 * otra. Las entradas por ranura, que es lo que esta prueba nació para vigilar, sí están:
		 * el resto de los puntos de contacto caen exactamente en el centro de una ranura.
		 */
		const peor = invasiones[0];
		assert.ok(
			!peor || peor.dentro < 4.2,
			peor ? `${peor.cable} se mete ${peor.dentro.toFixed(1)} mm en el ${peor.parte} de ${peor.canaleta}` : '',
		);
	});

	test(`${ej.titulo}: el reparto es determinista`, () => {
		// Mismo proyecto, mismo reparto. Sin esto, cada reconstrucción de la escena movería los
		// cables de sitio y trabajar sería imposible.
		invalidarCacheRuteo();
		const unos = trazosDeCables(ej.crear()).map((t) => t.puntos.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join('|'));
		invalidarCacheRuteo();
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
