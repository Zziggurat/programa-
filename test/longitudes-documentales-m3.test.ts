import assert from 'node:assert/strict';
import test from 'node:test';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { proyectarLongitudesDocumentales } from '../src/motores/longitudes-documentales.js';
import { rutearConductores } from '../src/motores/ruteo.js';

function tablero(): Proyecto {
	const p = crearProyecto('Longitudes DOC-05', { reservaCable: 0.1, extraPorConexionMm: 100 });
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', bornes: [{ id: '1' }] },
		{ id: 'b', tipo: 'rele', bornes: [{ id: '1' }] },
		{ id: 'campo', tipo: 'rele', campo: true, bornes: [{ id: '1' }] },
	];
	p.conductores = [
		{ id: 'w-ruta', de: { dispositivoId: 'a', borneId: '1' },
			a: { dispositivoId: 'b', borneId: '1' }, seccion: 1.5,
			fisica: { longitudManualM: 2.25 } },
		{ id: 'w-campo', de: { dispositivoId: 'a', borneId: '1' },
			a: { dispositivoId: 'campo', borneId: '1' }, seccion: 1.5,
			fisica: { longitudManualM: 5 } },
		{ id: 'w-pendiente', de: { dispositivoId: 'a', borneId: '1' },
			a: { dispositivoId: 'b', borneId: '1' }, estadoRutaFisica: 'pendiente' },
	];
	p.gabinete = {
		ancho: 400, alto: 400, rieles: [],
		canaletas: [
			{ id: 'h1', x: 0, y: 100, largo: 300, orientacion: 'h', ancho: 40, alto: 40 },
			{ id: 'v1', x: 300, y: 100, largo: 200, orientacion: 'v', ancho: 40, alto: 40 },
			{ id: 'h2', x: 0, y: 300, largo: 300, orientacion: 'h', ancho: 40, alto: 40 },
		],
		colocaciones: [
			{ dispositivoId: 'a', x: 30, y: 30, ancho: 40, alto: 40 },
			{ dispositivoId: 'b', x: 30, y: 330, ancho: 40, alto: 40 },
		],
	};
	return p;
}

test('DOC-05: ruta, reserva, puntas y redondeo reproducen exactamente el total legacy', () => {
	const p = tablero();
	const r = rutearConductores(p).rutas.find((x) => x.conductorId === 'w-ruta')!;
	assert.equal(r.longitudRutaMm, 800);
	assert.equal(r.reservaMm, 80);
	assert.equal(r.puntasMm, 200);
	assert.equal(r.redondeoMm, 0);
	assert.equal(r.longitudMm, 1080);
	const fila = proyectarLongitudesDocumentales(p, rutearConductores(p)).find((x) => x.conductorId === 'w-ruta')!;
	assert.deepEqual([fila.estadoRuta, fila.longitudDeclaradaElectricaM, fila.longitudRutaMm,
		fila.reservaPorcentaje, fila.reservaMm, fila.puntasMm, fila.propuestaCorteMm],
		['RUTA_2D_ESTIMADA', 2.25, 800, 0.1, 80, 200, 1080]);
	assert.equal(fila.origenReserva, 'CONFIGURADO');
	assert.equal(fila.origenPuntas, 'CONFIGURADO');
	assert.equal(fila.longitudCorteVerificadaMm, undefined,
		'la longitud eléctrica declarada no certifica un metraje de corte');
	p.opciones!.reservaCable = 0.101;
	const conRedondeo = rutearConductores(p).rutas.find((x) => x.conductorId === 'w-ruta')!;
	assert.equal(conRedondeo.longitudMm, 1081);
	assert.ok(conRedondeo.redondeoMm! > 0);
	assert.ok(Math.abs(conRedondeo.longitudRutaMm! + conRedondeo.reservaMm!
		+ conRedondeo.puntasMm! + conRedondeo.redondeoMm! - conRedondeo.longitudMm) < 1e-9);
	p.gabinete!.colocaciones[0].x = 30.1;
	for (const reservaCable of [0.01, 0.101, 0.17, 0.33, 0.99]) {
		p.opciones!.reservaCable = reservaCable;
		const decimal = rutearConductores(p).rutas.find((x) => x.conductorId === 'w-ruta')!;
		assert.ok(decimal.redondeoMm! >= 0);
		assert.ok(Math.abs(decimal.longitudRutaMm! + decimal.reservaMm! + decimal.puntasMm!
			+ decimal.redondeoMm! - decimal.longitudMm) < 1e-9);
		assert.equal(decimal.longitudMm,
			Math.ceil(decimal.longitudRutaMm! * (1 + reservaCable) + 2 * p.opciones!.extraPorConexionMm!));
	}
});

test('DOC-05: opciones por defecto se identifican y una ruta ausente no produce corte', () => {
	const p = tablero();
	delete p.opciones;
	const filas = proyectarLongitudesDocumentales(p, rutearConductores(p));
	const ruta = filas.find((x) => x.conductorId === 'w-ruta')!;
	assert.deepEqual([ruta.origenReserva, ruta.origenPuntas, ruta.reservaPorcentaje,
		ruta.extraPorConexionMm, ruta.longitudRutaMm, ruta.reservaMm, ruta.puntasMm,
		ruta.propuestaCorteMm], ['POR_DEFECTO', 'POR_DEFECTO', 0.15, 100, 800, 120, 200, 1120]);
	const campo = filas.find((x) => x.conductorId === 'w-campo')!;
	assert.equal(campo.estadoRuta, 'SIN_RUTA');
	assert.equal(campo.longitudDeclaradaElectricaM, 5);
	assert.equal(campo.longitudRutaMm, undefined);
	assert.equal(campo.propuestaCorteMm, undefined);
	const pendiente = filas.find((x) => x.conductorId === 'w-pendiente')!;
	assert.equal(pendiente.estadoRuta, 'PENDIENTE');
	assert.equal(pendiente.propuestaCorteMm, undefined);
});

test('DOC-05: orden de arrays y guardado/carga no cambian las magnitudes ni la procedencia', () => {
	const p = tablero();
	const base = proyectarLongitudesDocumentales(p, rutearConductores(p));
	const invertido = structuredClone(p);
	invertido.dispositivos.reverse(); invertido.conductores.reverse();
	invertido.gabinete!.canaletas.reverse(); invertido.gabinete!.colocaciones.reverse();
	assert.deepEqual(proyectarLongitudesDocumentales(invertido, rutearConductores(invertido)), base);
	const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(proyectarLongitudesDocumentales(cargado, rutearConductores(cargado)), base);
});

test('DOC-05: un resultado ajeno sin desglose no se presenta como corte calculado', () => {
	const p = tablero();
	const r = rutearConductores(p);
	const sinDesglose = { ...r, rutas: r.rutas.map((ruta) => ({
		conductorId: ruta.conductorId, longitudMm: ruta.longitudMm,
		camino: ruta.camino, canaletasUsadas: ruta.canaletasUsadas,
	})) };
	const fila = proyectarLongitudesDocumentales(p, sinDesglose).find((x) => x.conductorId === 'w-ruta')!;
	assert.equal(fila.estadoRuta, 'SIN_DESGLOSE');
	assert.equal(fila.propuestaCorteMm, undefined);
	assert.equal(fila.longitudDeclaradaElectricaM, 2.25);
	const hostil = { ...r, rutas: [...r.rutas, { ...r.rutas[0], conductorId: 'w-pendiente' }] };
	p.conductores.find((c) => c.id === 'w-pendiente')!.fisica = { longitudManualM: 9 };
	const pendiente = proyectarLongitudesDocumentales(p, hostil).find((x) => x.conductorId === 'w-pendiente')!;
	assert.equal(pendiente.estadoRuta, 'PENDIENTE');
	assert.equal(pendiente.propuestaCorteMm, undefined);
	assert.equal(pendiente.longitudDeclaradaElectricaM, 9,
		'declarar longitud eléctrica no materializa una ruta física pendiente');
});
