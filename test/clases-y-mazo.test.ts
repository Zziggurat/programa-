/**
 * LAS CUATRO CLASES DE CABLE Y LOS AJUSTES DEL MAZO.
 *
 * Dos cosas que parecen pequeñas y no lo son. La primera: un tablero no tiene «cables», tiene
 * cableado interno, cableado de puerta, cable de campo y protección, y cada uno se tiende de una
 * manera. Si el programa no sabe distinguirlos, todo lo que construya encima —el listado de
 * material, el mazo, la frontera con el instalador— parte de una simplificación falsa.
 *
 * La segunda: el mazo lo propone el programa y lo decide el usuario. Eso solo es verdad si lo que
 * el usuario decide LLEGA a la geometría y si lo que no decide no se guarda. Un ajuste que se
 * escribe en el archivo aunque nadie lo haya tocado convierte una propuesta en una decisión, y
 * entonces el día que mejore el valor propuesto ningún proyecto se entera.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import {
	claseDeConductor, fueraDelGabinete, montadoEnPuerta, recuentoPorClase,
} from '../src/motores/clases-cable.js';
import { ajustesDeMazo } from '../app/mazo-puerta.js';
import { Proyecto } from '../src/modelo/tipos.js';

function tablero(): Proyecto {
	return EJEMPLOS.find((e) => /estrella/i.test(e.titulo))!.crear();
}

test('un cable a un piloto de puerta es de clase puerta', () => {
	const p = tablero();
	const aPuerta = p.conductores.find(
		(c) => montadoEnPuerta(p, c.de.dispositivoId) || montadoEnPuerta(p, c.a.dispositivoId),
	);
	assert.ok(aPuerta, 'el ejemplo tiene que traer pilotos de puerta cableados');
	assert.equal(claseDeConductor(p, aPuerta), 'puerta');
});

test('un cable a un aparato que no está en el armario es de campo', () => {
	const p = tablero();
	const aCampo = p.conductores.find(
		(c) => fueraDelGabinete(p, c.de.dispositivoId) || fueraDelGabinete(p, c.a.dispositivoId),
	);
	assert.ok(aCampo, 'el ejemplo tiene que traer motor o acometida');
	assert.equal(claseDeConductor(p, aCampo), 'campo');
});

test('el campo tiene prioridad sobre la puerta: sale del armario y ya no se tiende aquí', () => {
	const p = tablero();
	// Se fuerza el caso difícil: un cable con un extremo en la puerta y otro fuera del armario.
	const enPuerta = p.gabinete!.colocaciones.find((c) => c.montaje === 'puerta')!;
	const fuera = p.dispositivos.find((d) => fueraDelGabinete(p, d.id))!;
	const mixto = {
		id: 'wtest', de: { dispositivoId: enPuerta.dispositivoId, borneId: 'X1' },
		a: { dispositivoId: fuera.id, borneId: fuera.bornes[0].id },
	};
	p.conductores.push(mixto);
	assert.equal(claseDeConductor(p, mixto), 'campo');
});

test('el usuario manda sobre lo que se deduce, y el resto sigue deduciéndose', () => {
	const p = tablero();
	const c = p.conductores[0];
	const deducida = claseDeConductor(p, c);
	c.clase = 'proteccion';
	assert.equal(claseDeConductor(p, c), 'proteccion');
	delete c.clase;
	assert.equal(claseDeConductor(p, c), deducida);
});

test('el recuento por clases cuenta todos los conductores una vez', () => {
	const p = tablero();
	const r = recuentoPorClase(p);
	const suma = r.interno + r.puerta + r.campo + r.proteccion;
	assert.equal(suma, p.conductores.length);
	assert.ok(r.puerta > 0 && r.interno > 0, `esperaba las dos clases: ${JSON.stringify(r)}`);
});

test('sin ajustes, el mazo usa lo que propone el programa', () => {
	const p = tablero();
	delete p.gabinete!.mazoPuerta;
	assert.deepEqual(ajustesDeMazo(p), { holgura: 0, pasoSujecion: 110, desdeBisagra: 26 });
});

test('lo que el usuario decide llega, y lo imposible se recorta', () => {
	const p = tablero();
	p.gabinete!.mazoPuerta = { holgura: 60, pasoSujecion: 70, desdeBisagra: 40 };
	assert.deepEqual(ajustesDeMazo(p), { holgura: 60, pasoSujecion: 70, desdeBisagra: 40 });
	// Un lazo tirante y una sujeción cada diez metros no son opiniones: son el mazo roto.
	p.gabinete!.mazoPuerta = { holgura: -500, pasoSujecion: 9000, desdeBisagra: 0 };
	const a = ajustesDeMazo(p);
	assert.equal(a.holgura, -30);
	assert.equal(a.pasoSujecion, 400);
	assert.equal(a.desdeBisagra, 12);
});

test('los ajustes del mazo, las entradas y la trenza sobreviven a guardar y volver a abrir', () => {
	const p = tablero();
	p.gabinete!.mazoPuerta = { holgura: 35, desdeBisagra: 44 };
	p.gabinete!.entradas = [
		{ id: 'ent1', cara: 'inferior', x: 120, y: 0, tipo: 'prensaestopas', diametro: 25, rosca: 'M25' },
	];
	// El ejemplo no declara envolvente: se declara aquí, porque la trenza es de la caja.
	p.gabinete!.caja = { ancho: 700, alto: 800, profundidad: 200, bonding: { puesto: true, seccion: 6 } };
	p.conductores[0].clase = 'proteccion';

	const { proyecto: leido } = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(leido.gabinete!.mazoPuerta, { holgura: 35, desdeBisagra: 44 });
	assert.equal(leido.gabinete!.entradas?.[0].rosca, 'M25');
	assert.equal(leido.gabinete!.entradas?.[0].diametro, 25);
	assert.equal(leido.gabinete!.caja?.bonding?.puesto, true);
	assert.equal(leido.conductores[0].clase, 'proteccion');
});

test('una clase inventada en el archivo se tira y el cable vuelve a deducirla', () => {
	const p = tablero();
	const bruto = JSON.parse(JSON.stringify(p)) as { conductores: { clase?: string }[] };
	bruto.conductores[0].clase = 'lo-que-sea';
	const { proyecto: leido } = cargarProyecto(JSON.stringify(bruto));
	assert.equal(leido.conductores[0].clase, undefined);
});
