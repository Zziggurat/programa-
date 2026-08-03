/**
 * Tests del orquestador: que la revisión encadene los motores en el orden bueno, que lo caro no se
 * calcule si nadie lo pide, y que lo que dice sea lo MISMO mire quien lo mire.
 *
 * Lo último es el motivo de que exista el archivo. Antes la cadena estaba escrita a mano en la
 * pantalla, en el dossier HTML y en el PDF, y las tres se habían separado: el papel medía los
 * cables por el ruteo teórico y la pantalla por el trazado dibujado, y el papel no llamaba a la
 * sincronización, así que callaba los aparatos sin colocar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { revisarTablero } from '../src/motores/revision.js';

/** Un arranque mínimo: acometida, automático y motor, con su placa y su canaleta. */
function tableroDePrueba(): Proyecto {
	const p = crearProyecto('revisión', { reservaCable: 0, extraPorConexionMm: 0 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'fuente', tensionNominal: 380,
			bornes: [{ id: 'L1', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{
			id: 'q1', tipo: 'disyuntor', tensionNominal: 380, corrienteNominal: 10,
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
			puentesInternos: [['1', '2']],
		},
		{
			id: 'm1', tipo: 'motor', tensionNominal: 380, corrienteNominal: 6,
			bornes: [{ id: 'U', tipo: 'L' }, { id: 'V', tipo: 'N' }],
		},
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'red', borneId: 'L1' }, a: { dispositivoId: 'q1', borneId: '1' }, seccion: 2.5 },
		{ id: 'c2', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'm1', borneId: 'U' }, seccion: 2.5 },
		{ id: 'c3', de: { dispositivoId: 'red', borneId: 'N' }, a: { dispositivoId: 'm1', borneId: 'V' }, seccion: 2.5 },
	];
	p.gabinete = {
		ancho: 600, alto: 400, rieles: [],
		canaletas: [{ id: 'h1', x: 0, y: 200, largo: 500, orientacion: 'h', ancho: 40, alto: 40 }],
		colocaciones: [
			{ dispositivoId: 'red', x: 20, y: 100, ancho: 60, alto: 60 },
			{ dispositivoId: 'q1', x: 200, y: 100, ancho: 60, alto: 60 },
			{ dispositivoId: 'm1', x: 400, y: 100, ancho: 60, alto: 60 },
		],
	};
	return p;
}

test('revisarTablero: encadena los motores y devuelve todo cuadrado', () => {
	const r = revisarTablero(tableroDePrueba());

	assert.ok(r.potenciales.potenciales.length > 0, 'hay potenciales');
	assert.equal(r.resumen.conductores, 3);
	assert.equal(r.resumen.potenciales, r.potenciales.potenciales.length);
	assert.equal(
		r.resumen.errores,
		r.hallazgos.filter((h) => h.severidad === 'error').length,
		'el resumen cuenta los hallazgos que hay de verdad',
	);
	assert.equal(r.resumen.longitudCableMm, r.ruteo.rutas.reduce((s, x) => s + x.longitudMm, 0));
});

test('revisarTablero: los hilos se numeran, los aparatos solo si se pide', () => {
	const p = tableroDePrueba();
	const r = revisarTablero(p);
	assert.ok(p.conductores.every((c) => c.numero), 'todo hilo tiene número');
	assert.ok(p.dispositivos.every((d) => !d.designacion), 'sin pedirlo, no se renumeran los aparatos');
	assert.ok(r.hallazgos.length >= 0);

	revisarTablero(p, { renumerarAparatos: true });
	assert.ok(p.dispositivos.every((d) => d.designacion), 'pidiéndolo, todos llevan su designación IEC');
	assert.ok(p.dispositivos.find((d) => d.id === 'q1')!.designacion!.includes('Q'));
});

test('revisarTablero: el largo que se le pasa manda sobre el del ruteo', () => {
	const p = tableroDePrueba();
	// Un metraje disparatado para un cable de 2,5: la caída de tensión tiene que resentirse.
	const largos = new Map(p.conductores.map((c) => [c.id, 300_000]));
	const conLargo = revisarTablero(p, { longitudesMm: largos });
	const sinLargo = revisarTablero(p);

	const caida = (r: typeof conLargo) => r.hallazgos.filter((h) => h.regla.startsWith('R10')).length;
	assert.ok(caida(conLargo) > caida(sinLargo),
		'300 m de cable tienen que dar avisos de caída que 0,5 m no dan');
});

test('revisarTablero: los fallos del montaje salen como hallazgos, no aparte', () => {
	const p = tableroDePrueba();
	// Se pisan dos aparatos en la placa, y uno se queda sin colocar.
	p.gabinete!.colocaciones[1].x = 40;
	p.gabinete!.colocaciones.pop();

	const r = revisarTablero(p);
	assert.ok(r.hallazgos.some((h) => h.regla === 'S1-solape'), 'el solape se avisa');
	assert.ok(r.hallazgos.some((h) => h.regla === 'S2-falta-colocar'), 'el que falta se avisa');
	assert.equal(r.sincronizacion.sincronizado, false);
});

test('revisarTablero: los hallazgos salen ordenados, primero los errores', () => {
	const p = tableroDePrueba();
	p.gabinete!.colocaciones[1].x = 40; // un error de montaje, que llega el último a la lista
	const r = revisarTablero(p);
	const primerAviso = r.hallazgos.findIndex((h) => h.severidad === 'aviso');
	const ultimoError = r.hallazgos.map((h) => h.severidad).lastIndexOf('error');
	if (primerAviso >= 0 && ultimoError >= 0) {
		assert.ok(ultimoError < primerAviso, 'ningún error queda por debajo de un aviso');
	}
});

test('revisarTablero: lo caro no se calcula hasta que se pide, y solo una vez', () => {
	const p = tableroDePrueba();
	const r = revisarTablero(p);
	// Leerlo dos veces tiene que dar EL MISMO objeto: si se recalculase, serían distintos.
	assert.equal(r.bom, r.bom);
	assert.equal(r.planesBorneros, r.planesBorneros);
	assert.equal(r.referencias, r.referencias);
	assert.equal(r.ficha, r.ficha);
	assert.equal(r.listaConductores, r.listaConductores);
	assert.equal(r.bom.reduce((s, f) => s + f.cantidad, 0), 3, 'el BOM cuenta los tres aparatos');
});

test('revisarTablero: un tablero vacío no revienta', () => {
	const r = revisarTablero(crearProyecto('vacío'));
	assert.equal(r.resumen.dispositivos, 0);
	assert.equal(r.hojasEsquema.length, 0);
	assert.deepEqual(r.bom, []);
	assert.equal(r.termico, undefined, 'sin gabinete no hay balance térmico');
});
