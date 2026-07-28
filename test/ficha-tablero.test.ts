/**
 * Tests de la ficha del tablero: las cifras que describen el conjunto y que van a la portada
 * del dossier. Si estas mienten, el cliente recibe un papel que no es su tablero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { fondoDe, generarFichaTablero } from '../src/motores/ficha-tablero.js';

test('la ficha cuenta los aparatos que hay de verdad, agrupados por familia', () => {
	const p = tableroEjemplo();
	numerarDispositivos(p);
	const ficha = generarFichaTablero(p, rutearConductores(p));

	const aparatosReales = p.dispositivos.filter((d) => !d.imagen && d.tipo !== 'cable').length;
	assert.equal(ficha.aparatos.total, aparatosReales);
	assert.equal(
		ficha.aparatos.porFamilia.reduce((s, f) => s + f.cantidad, 0),
		aparatosReales,
		'ningún aparato se pierde ni se cuenta dos veces al agrupar',
	);
	assert.equal(ficha.aparatos.enPlaca + ficha.aparatos.deCampo, aparatosReales);
	for (const f of ficha.aparatos.porFamilia) {
		assert.equal(f.designaciones.length, f.cantidad, `${f.familia}: cada unidad tiene su marcado`);
	}
});

test('las familias salen en el orden del recorrido de la corriente', () => {
	const p = tableroEjemplo();
	const orden = generarFichaTablero(p).aparatos.porFamilia.map((f) => f.familia);
	const esperado = ['Protección', 'Maniobra', 'Alimentación', 'Control', 'Conexión', 'Consumo', 'Otros'];
	const posicion = orden.map((f) => esperado.indexOf(f));
	assert.deepEqual(posicion, [...posicion].sort((a, b) => a - b));
});

test('las medidas son las del gabinete del proyecto, no un valor fijo', () => {
	const p = tableroEjemplo();
	p.gabinete = { ancho: 500, alto: 700, caja: { ancho: 600, alto: 800, profundidad: 210 }, rieles: [], canaletas: [], colocaciones: [] };
	const ficha = generarFichaTablero(p);
	assert.deepEqual(ficha.placa, { ancho: 500, alto: 700 });
	assert.deepEqual(ficha.caja, { ancho: 600, alto: 800, profundidad: 210, estimada: false });
});

test('si el proyecto no declara la caja, la ficha la deduce Y lo dice', () => {
	const p = tableroEjemplo();
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	const caja = generarFichaTablero(p).caja!;
	assert.equal(caja.estimada, true, 'una medida supuesta nunca se presenta como dato');
	assert.ok(caja.ancho > 400 && caja.alto > 600);
});

test('riel y canaleta se suman en metros y se reporta el llenado máximo', () => {
	const p = tableroEjemplo();
	p.gabinete = {
		ancho: 600, alto: 800,
		rieles: [{ id: 'r1', x: 0, y: 0, largo: 500 }, { id: 'r2', x: 0, y: 200, largo: 400 }],
		canaletas: [{ id: 'c1', x: 0, y: 100, largo: 560, orientacion: 'h', ancho: 40, alto: 60 }],
		colocaciones: [],
	};
	const ficha = generarFichaTablero(p, {
		rutas: [],
		ocupaciones: [{ canaletaId: 'c1', seccionOcupadaMm2: 200, seccionUtilMm2: 2400, ocupacion: 0.37, excedida: false }],
		avisos: [],
	});
	assert.equal(ficha.rieles.cantidad, 2);
	assert.equal(ficha.rieles.largoTotalMm, 900);
	assert.equal(ficha.canaletas.cantidad, 1);
	assert.equal(ficha.canaletas.largoTotalMm, 560);
	assert.equal(ficha.canaletas.llenadoMaxPct, 37);
});

test('la ocupación de la placa no cuenta dos veces lo que se solapa', () => {
	const p = crearProyecto('t');
	p.dispositivos = [{ id: 'd1', tipo: 'contactor', bornes: [] }];
	p.gabinete = {
		ancho: 1000, alto: 1000,
		// El aparato va montado SOBRE el riel: entre los dos ocupan el sitio del riel, no el doble.
		rieles: [{ id: 'r1', x: 0, y: 0, largo: 1000 }],
		canaletas: [],
		colocaciones: [{ dispositivoId: 'd1', x: 0, y: 0, ancho: 100, alto: 35 }],
	};
	// Riel: 1000 × 35 mm sobre 1000 × 1000 = 3,5 %. El aparato cae dentro y no añade nada.
	assert.equal(generarFichaTablero(p).ocupacionPlacaPct, 4);
});

test('el cable se agrupa por sección con su longitud ruteada', () => {
	const p = tableroEjemplo();
	const ruteo = rutearConductores(p);
	const ficha = generarFichaTablero(p, ruteo);
	assert.equal(
		ficha.conductores.porSeccion.reduce((s, x) => s + x.cantidad, 0),
		p.conductores.length,
	);
	assert.equal(ficha.conductores.total, p.conductores.length);
	const suma = ruteo.rutas.reduce((s, r) => s + r.longitudMm, 0);
	assert.ok(Math.abs(ficha.conductores.longitudTotalMm - suma) < 0.001);
	// Ordenadas de menor a mayor sección, como se pide el cable.
	const secciones = ficha.conductores.porSeccion.map((s) => s.seccion ?? 0);
	assert.deepEqual(secciones, [...secciones].sort((a, b) => a - b));
});

test('un proyecto sin gabinete no inventa medidas', () => {
	const p = crearProyecto('vacío');
	const ficha = generarFichaTablero(p);
	assert.equal(ficha.caja, undefined);
	assert.equal(ficha.placa, undefined);
	assert.equal(ficha.aparatos.total, 0);
	assert.equal(ficha.ocupacionPlacaPct, 0);
	assert.equal(ficha.holguraFondoMm, undefined);
});

test('el fondo de un aparato es el de su ficha si lo trae', () => {
	assert.equal(fondoDe({ id: 'a', tipo: 'plc', bornes: [], profundidad: 57 }), 57);
	assert.equal(fondoDe({ id: 'b', tipo: 'contactor', bornes: [] }), 84);
	assert.equal(fondoDe({ id: 'c', tipo: 'otro', bornes: [] }), 55);
});

test('la holgura de fondo avisa cuando el aparato más profundo se come la caja', () => {
	const p = crearProyecto('t');
	p.dispositivos = [{ id: 'd1', tipo: 'plc', bornes: [], profundidad: 150 }];
	p.gabinete = {
		ancho: 400, alto: 400, caja: { ancho: 500, alto: 500, profundidad: 160 },
		rieles: [], canaletas: [], colocaciones: [{ dispositivoId: 'd1', x: 0, y: 0, ancho: 100, alto: 100 }],
	};
	assert.equal(generarFichaTablero(p).holguraFondoMm, 10);
});
