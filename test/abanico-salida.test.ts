/**
 * DOS HILOS DEL MISMO APARATO NO PUEDEN SALIR POR EL MISMO SITIO.
 *
 * El abanico abría las puntas a lo ancho y con eso arreglaba la hilera de tornillos. Lo que no
 * miraba era la PROFUNDIDAD, y ahí estaba el choque más frecuente: clasificando por fase del
 * recorrido, 12 de los 14 pares penetrados que quedaban en el estrella-triángulo estaban en el
 * borne o en el abanico y ninguno dentro de una canaleta. El caso típico son dos hilos del mismo
 * aparato que van a sitios distintos —uno sale hacia un lado, otro llega desde abajo— y se cruzan
 * en la cara del propio aparato, porque los dos viajan por el plano de los bornes.
 *
 * Esta prueba es el escenario mínimo que lo delata, y no depende de ningún ejemplo de la
 * biblioteca: un aparato con varios bornes juntos y varios conductores gordos saliendo de él.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Proyecto } from '../src/modelo/tipos.js';
import { abanicoDeSalida, radioDeCable, salidasDeCable } from '../app/escena3d.js';

/** Un aparato con seis bornes en fila y seis conductores de 6 mm² saliendo de él. */
function tableroApretado(): Proyecto {
	const bornes = ['1', '2', '3', '4', '5', '6'].map((id) => ({ id, etiqueta: id }));
	return {
		version: 1,
		dispositivos: [
			{ id: 'k1', designacion: '-K1', tipo: 'contactor', bornes },
			{ id: 'x9', designacion: '-X9', tipo: 'bornera', bornes },
		],
		conductores: bornes.map((b) => ({
			id: `w${b.id}`, seccion: 6, color: 'negro',
			de: { dispositivoId: 'k1', borneId: b.id },
			a: { dispositivoId: 'x9', borneId: b.id },
		})),
		gabinete: {
			ancho: 400, alto: 400,
			rieles: [{ id: 'r1', x: 20, y: 60, largo: 360 }, { id: 'r2', x: 20, y: 300, largo: 360 }],
			canaletas: [],
			colocaciones: [
				{ dispositivoId: 'k1', x: 60, y: 20, ancho: 54, alto: 80, rielId: 'r1' },
				{ dispositivoId: 'x9', x: 60, y: 260, ancho: 54, alto: 50, rielId: 'r2' },
			],
		},
	} as unknown as Proyecto;
}

test('los conductores de un mismo aparato no salen todos por el mismo plano', () => {
	const p = tableroApretado();
	const abanico = abanicoDeSalida(p);
	const salidas = p.conductores
		.map((c) => salidasDeCable(p, c, abanico))
		.filter((q): q is NonNullable<typeof q> => !!q);
	assert.equal(salidas.length, 6);
	const alturas = new Set(salidas.map((q) => Math.round(q.salidaA.z)));
	assert.ok(alturas.size >= 3, `sólo ${alturas.size} profundidades de salida: ${[...alturas].join(', ')}`);
});

test('dos salidas del mismo aparato nunca comparten eje y plano a la vez', () => {
	/*
	 * La comprobación de fondo. Dos puntas pueden estar a la misma altura si están separadas a lo
	 * ancho, y pueden estar en la misma vertical si están a distinta altura. Lo que no puede pasar
	 * —y es lo que producía las fusiones— es que coincidan en las dos cosas.
	 */
	const p = tableroApretado();
	const abanico = abanicoDeSalida(p);
	const salidas = p.conductores.map((c) => ({
		c, s: salidasDeCable(p, c, abanico)!, radio: radioDeCable(c.seccion),
	}));
	for (let i = 0; i < salidas.length; i++) {
		for (let j = i + 1; j < salidas.length; j++) {
			const A = salidas[i];
			const B = salidas[j];
			const d = Math.hypot(A.s.salidaA.x - B.s.salidaA.x, A.s.salidaA.z - B.s.salidaA.z);
			assert.ok(
				d >= A.radio + B.radio,
				`${A.c.id} y ${B.c.id} salen a ${d.toFixed(2)} mm y suman ${(A.radio + B.radio).toFixed(2)} de radio`,
			);
		}
	}
});
