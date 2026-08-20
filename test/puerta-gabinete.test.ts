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
import { cajaDeGabinete } from '../src/modelo/proyecto.js';
import { Gabinete } from '../src/modelo/tipos.js';

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

test('la pala de la bisagra atornillada al armario NO se va con la puerta', () => {
	/*
	 * Las dos palas y el nudillo colgaban del PIVOTE, así que al abrir se iban las dos con la
	 * hoja: la que está atornillada al costado del armario se despegaba y se quedaba en el aire
	 * junto a la puerta. Con la puerta cerrada no se notaba —están superpuestas— y por eso había
	 * aguantado. Aquí se comprueba lo único que lo delata: abrir la puerta y mirar si se ha
	 * movido algo que no debía.
	 *
	 * Y de paso, el NUDILLO. Estaba siete milímetros fuera del eje de giro, así que al abrir
	 * describía un arco en vez de girar sobre sí mismo. Un nudillo que se desplaza no es un
	 * nudillo: es un bulto pegado a la puerta.
	 */
	const { grupo, puerta } = construirEnvolvente(600, 800, 200);
	grupo.updateMatrixWorld(true);

	const antes = new Map<THREE.Object3D, THREE.Vector3>();
	grupo.traverse((o) => antes.set(o, o.getWorldPosition(new THREE.Vector3())));

	puerta.pivote.rotation.y = puerta.aperturaMaxima;
	grupo.updateMatrixWorld(true);

	// Todo lo que NO cuelgue del pivote tiene que estar exactamente donde estaba.
	let quietos = 0;
	grupo.traverse((o) => {
		let bajoLaPuerta = false;
		for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n === puerta.pivote) bajoLaPuerta = true;
		if (bajoLaPuerta) return;
		const p = o.getWorldPosition(new THREE.Vector3());
		assert.ok(p.distanceTo(antes.get(o)!) < 1e-6, 'una pieza del cuerpo se ha movido al abrir la puerta');
		quietos += 1;
	});
	assert.ok(quietos > 10, 'la prueba no ha encontrado piezas de cuerpo que comprobar');

	/*
	 * Y que no se mueva no basta: la pala del cuerpo tiene que ESTAR en el cuerpo. Si alguien
	 * volviera a colgarla del pivote, el bucle de arriba dejaría de mirarla y la prueba pasaría
	 * sin comprobar nada. Así que se cuenta: junto al eje de cada bisagra, y FUERA del pivote,
	 * tiene que haber chapa.
	 */
	const ejes = new Set<number>();
	puerta.pivote.traverse((o) => {
		const g = (o as THREE.Mesh).geometry as THREE.CylinderGeometry | undefined;
		if (g?.type === 'CylinderGeometry' && Math.abs(g.parameters.height - 34) < 0.01) {
			ejes.add(Math.round(antes.get(o)!.y));
		}
	});
	for (const y of ejes) {
		let palas = 0;
		grupo.traverse((o) => {
			if (!(o as THREE.Mesh).isMesh) return;
			for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n === puerta.pivote) return;
			const p = antes.get(o)!;
			if (Math.abs(p.y - y) < 14 && Math.abs(p.x - puerta.pivote.position.x) < 30) palas += 1;
		});
		assert.ok(palas >= 1, `la bisagra a y=${y} no tiene pala atornillada al armario`);
	}

	// El nudillo: cilindro vertical de la bisagra, colgado del pivote y EN el eje.
	const nudillos: THREE.Mesh[] = [];
	puerta.pivote.traverse((o) => {
		const m = o as THREE.Mesh;
		const g = m.geometry as THREE.CylinderGeometry | undefined;
		if (m.isMesh && g?.type === 'CylinderGeometry' && Math.abs(g.parameters.height - 34) < 0.01) nudillos.push(m);
	});
	assert.ok(nudillos.length >= 2, `esperaba al menos dos nudillos, hay ${nudillos.length}`);
	for (const n of nudillos) {
		const p = n.getWorldPosition(new THREE.Vector3());
		const q = antes.get(n)!;
		assert.ok(
			Math.hypot(p.x - q.x, p.z - q.z) < 0.5,
			`el nudillo se desplaza ${Math.hypot(p.x - q.x, p.z - q.z).toFixed(1)} mm al abrir: no está en el eje`,
		);
	}
});

test('la placa nunca toca las paredes del armario', () => {
	/*
	 * El recorte mínimo era «la placa más un centímetro»: cinco milímetros de aire por lado. Con
	 * eso, una canaleta de 40 mm puesta a 15 mm del canto —lo normal— acaba con su cara en el
	 * MISMO plano que el costado del armario, y las dos superficies se disputan la profundidad:
	 * sobre la chapa del lateral aparecía dibujada la escalerilla de las ranuras de la canaleta.
	 * Se reprodujo pidiendo una caja de 30 × 40 sobre una placa de 30 × 40.
	 *
	 * Un armario monta la placa sobre espárragos con tres centímetros largos hasta la pared. El
	 * mínimo es ahora ese mismo margen, así que ya no se puede pedir un armario en el que la
	 * placa no cabe.
	 */
	const placa = (ancho: number, alto: number, caja?: { ancho: number; alto: number; profundidad: number }): Gabinete =>
		({ ancho, alto, rieles: [], canaletas: [], colocaciones: [], ...(caja ? { caja } : {}) }) as Gabinete;

	const apretado = cajaDeGabinete(placa(300, 400, { ancho: 300, alto: 400, profundidad: 150 }));
	assert.ok(apretado.ancho - 300 >= 60, `solo ${apretado.ancho - 300} mm de aire a lo ancho`);
	assert.ok(apretado.alto - 400 >= 60, `solo ${apretado.alto - 400} mm de aire a lo alto`);

	// Y una caja holgada se respeta tal cual: el mínimo es un suelo, no una imposición.
	const holgado = cajaDeGabinete(placa(300, 400, { ancho: 800, alto: 1000, profundidad: 250 }));
	assert.equal(holgado.ancho, 800);
	assert.equal(holgado.alto, 1000);

	// Sin caja declarada, la estimación ya dejaba ese aire y no cambia.
	const estimado = cajaDeGabinete(placa(300, 400));
	assert.equal(estimado.ancho, 360);
	assert.equal(estimado.alto, 460);
	assert.equal(estimado.estimada, true);
});
