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
import * as THREE from 'three';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import {
	claseDeConductor, fueraDelGabinete, montadoEnPuerta, recuentoPorClase,
} from '../src/motores/clases-cable.js';
import { ajustesDeMazo, conductoresFisicosDePuerta, construirMazoPuerta } from '../app/mazo-puerta.js';
import { construirComponentePuerta } from '../app/componentes-puerta.js';
import { construirEnvolvente } from '../app/gabinete3d.js';
import { ClaseConductor, Proyecto } from '../src/modelo/tipos.js';

function tablero(): Proyecto {
	return EJEMPLOS.find((e) => /estrella/i.test(e.titulo))!.crear();
}

/** Un tablero mínimo que contiene deliberadamente las cuatro fronteras físicas. */
function tableroSemantico(): Proyecto {
	const p = crearProyecto('clases semánticas');
	p.dispositivos = [
		{
			id: 'placa-a', tipo: 'otro', bornes: [
				{ id: 'PE', tipo: 'PE' }, { id: '0V', tipo: 'control' },
				{ id: 'C1', tipo: 'control' }, { id: 'C2', tipo: 'control' },
			],
		},
		{ id: 'placa-b', tipo: 'otro', bornes: [{ id: 'C', tipo: 'control' }] },
		{
			id: 'puerta', tipo: 'piloto', bornes: [
				{ id: 'PE', tipo: 'PE' }, { id: 'GND', tipo: 'control' }, { id: 'X1', tipo: 'control' },
			],
		},
		{ id: 'campo', tipo: 'sensor', campo: true, bornes: [{ id: 'S', tipo: 'senal' }] },
	];
	p.gabinete = {
		ancho: 500, alto: 600, rieles: [], canaletas: [],
		caja: { ancho: 560, alto: 660, profundidad: 180 },
		colocaciones: [
			{ dispositivoId: 'placa-a', x: 40, y: 80, ancho: 100, alto: 80 },
			{ dispositivoId: 'placa-b', x: 200, y: 80, ancho: 80, alto: 80 },
			{ dispositivoId: 'puerta', x: 260, y: 90, ancho: 30, alto: 30, montaje: 'puerta' },
		],
	};
	p.conductores = [
		{ id: 'pe-puerta', de: { dispositivoId: 'placa-a', borneId: 'PE' }, a: { dispositivoId: 'puerta', borneId: 'PE' } },
		{ id: 'gnd-control', de: { dispositivoId: 'placa-a', borneId: '0V' }, a: { dispositivoId: 'puerta', borneId: 'GND' } },
		{ id: 'campo-bornera', de: { dispositivoId: 'campo', borneId: 'S' }, a: { dispositivoId: 'placa-a', borneId: 'C1' } },
		{ id: 'interno', de: { dispositivoId: 'placa-a', borneId: 'C2' }, a: { dispositivoId: 'placa-b', borneId: 'C' } },
		{ id: 'puerta-mando', de: { dispositivoId: 'placa-b', borneId: 'C' }, a: { dispositivoId: 'puerta', borneId: 'X1' } },
	];
	return p;
}

function clasesPorId(p: Proyecto): Record<string, ClaseConductor> {
	return Object.fromEntries(p.conductores.map((c) => [c.id, claseDeConductor(p, c)]));
}

test('PE explícito, GND funcional, campo, interno y puerta no se confunden', () => {
	const p = tableroSemantico();
	assert.deepEqual(clasesPorId(p), {
		'pe-puerta': 'proteccion',
		'gnd-control': 'puerta',
		'campo-bornera': 'campo',
		interno: 'interno',
		'puerta-mando': 'puerta',
	});
});

test('el texto y el color no convierten por sí solos un GND de control en PE', () => {
	const p = tableroSemantico();
	const gnd = p.conductores.find((c) => c.id === 'gnd-control')!;
	gnd.color = 'verde/amarillo';
	assert.equal(claseDeConductor(p, gnd), 'puerta');

	const interno = p.conductores.find((c) => c.id === 'interno')!;
	interno.de.borneId = 'C2';
	p.dispositivos.find((d) => d.id === 'placa-a')!.bornes.find((b) => b.id === 'C2')!.id = 'GND';
	interno.de.borneId = 'GND';
	assert.equal(claseDeConductor(p, interno), 'interno');
});

test('la semántica PE del borne tiene prioridad sobre una clase física incompatible', () => {
	const p = tableroSemantico();
	const pe = p.conductores.find((c) => c.id === 'pe-puerta')!;
	pe.clase = 'interno';
	assert.equal(claseDeConductor(p, pe), 'proteccion');
});

test('solo mando de puerta y protección llegan al sistema físico de la hoja', () => {
	const p = tableroSemantico();
	const fisicos = conductoresFisicosDePuerta(p);
	assert.deepEqual(fisicos.mando.map((c) => c.id), ['gnd-control', 'puerta-mando']);
	assert.deepEqual(fisicos.proteccion.map((c) => c.id), ['pe-puerta']);
	assert.ok(![...fisicos.mando, ...fisicos.proteccion].some((c) => c.id === 'campo-bornera'));
});

test('la escena separa el PE del mazo de mando y deja fuera el cable de campo', () => {
	const p = tableroSemantico();
	const g = p.gabinete!;
	const caja = g.caja!;
	const envolvente = construirEnvolvente(caja.ancho, caja.alto, caja.profundidad);
	const aparatos = g.colocaciones.filter((c) => c.montaje === 'puerta').map((col) => {
		const dispositivo = p.dispositivos.find((d) => d.id === col.dispositivoId)!;
		const grupo = construirComponentePuerta(dispositivo, col);
		envolvente.puerta.colocar(grupo, 'frente', col.x, col.y, 0);
		return grupo;
	});
	envolvente.grupo.updateMatrixWorld(true);
	const mazo = construirMazoPuerta({
		proyecto: p, puerta: envolvente.puerta, aparatos,
		aEscena: (x, y, z) => new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z),
		placa: { ancho: g.ancho, alto: g.alto }, caja, izquierda: true,
		color: () => 0x546e7a, radio: () => 1.2,
	});
	assert.deepEqual(mazo.cables.map((c) => c.conductorId), ['gnd-control', 'puerta-mando']);
	assert.deepEqual(mazo.protecciones.map((c) => c.conductorId), ['pe-puerta']);
	const tubos = mazo.enLaPuerta.children.filter((o) => o.userData.conductorId);
	assert.ok(tubos.some((o) => o.userData.conductorId === 'pe-puerta'
		&& o.userData.claseConductor === 'proteccion'));
	assert.ok(!tubos.some((o) => o.userData.conductorId === 'campo-bornera'));
});

test('guardar, cargar y recomputar conserva todas las clases deducidas', () => {
	const p = tableroSemantico();
	const antes = clasesPorId(p);
	const despues = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.deepEqual(clasesPorId(despues), antes);
});

test('invertir dispositivos, colocaciones y conductores no cambia ninguna clase ni el mazo', () => {
	const p = tableroSemantico();
	const clases = clasesPorId(p);
	const fisicos = conductoresFisicosDePuerta(p);
	p.dispositivos.reverse();
	p.gabinete!.colocaciones.reverse();
	p.conductores.reverse();
	assert.deepEqual(clasesPorId(p), clases);
	const invertidos = conductoresFisicosDePuerta(p);
	assert.deepEqual(invertidos.mando.map((c) => c.id), fisicos.mando.map((c) => c.id));
	assert.deepEqual(invertidos.proteccion.map((c) => c.id), fisicos.proteccion.map((c) => c.id));
});

test('un cable a un piloto de puerta es de clase puerta', () => {
	const p = tablero();
	const aPuerta = p.conductores.find(
		(c) => montadoEnPuerta(p, c.de.dispositivoId) || montadoEnPuerta(p, c.a.dispositivoId),
	);
	assert.ok(aPuerta, 'el ejemplo tiene que traer pilotos de puerta cableados');
	assert.equal(claseDeConductor(p, aPuerta), 'puerta');
});

test('el retorno directo desde la entrada declara de forma persistente su alcance de puerta', () => {
	const p = tablero();
	const campoEnPuerta = p.conductores.filter((c) =>
		(montadoEnPuerta(p, c.de.dispositivoId) || montadoEnPuerta(p, c.a.dispositivoId))
		&& claseDeConductor(p, c) === 'campo');
	assert.deepEqual(campoEnPuerta.map((c) => c.id), []);
	const retorno = p.conductores.find((c) => c.id === 'w56')!;
	assert.equal(retorno.clase, 'puerta');
	assert.equal(claseDeConductor(p, retorno), 'puerta');
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
