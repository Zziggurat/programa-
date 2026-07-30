/**
 * Tests del catálogo de aparatos, con la ficha eléctrica.
 *
 * Lo que se vigila aquí no es que los números sean bonitos, es que **el programa no mienta sobre
 * su procedencia**. Un aparato colocado desde el catálogo llega con un poder de corte y una
 * disipación que son los corrientes de su familia, no los de la hoja de datos de ese modelo; si
 * eso no viaja marcado, el balance térmico presume de un rigor que no tiene y el DRC rechaza
 * aparatos con un número que nadie ha confirmado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLANTILLAS, SIN_FICHA_ELECTRICA, crearDesdePlantilla } from '../app/catalogo.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

const porId = (id: string) => {
	const p = PLANTILLAS.find((x) => x.id === id);
	assert.ok(p, `no existe la plantilla ${id}`);
	return p!;
};

test('todo aparato del catálogo declara de dónde salen sus datos eléctricos', () => {
	assert.deepEqual(SIN_FICHA_ELECTRICA, [],
		`sin ficha eléctrica: ${SIN_FICHA_ELECTRICA.join(', ')}`);
	for (const p of PLANTILLAS) {
		assert.ok(p.datosElectricos === 'referencia' || p.datosElectricos === 'tipico',
			`${p.id} no declara la procedencia de sus datos`);
	}
});

test('toda protección del catálogo trae calibre y poder de corte', () => {
	const ES_PROTECCION = new Set(['disyuntor', 'diferencial', 'guardamotor', 'fusible', 'seccionador']);
	for (const p of PLANTILLAS.filter((x) => ES_PROTECCION.has(x.tipo))) {
		assert.ok(p.poderCorteKA !== undefined && p.poderCorteKA > 0,
			`${p.id} sin poder de corte: el DRC no puede verificarlo contra la Icc`);
		// Un guardamotor o un relé térmico se regulan: su calibre es el tope del rango.
		const tieneCalibre = p.corrienteNominal !== undefined || p.rangoRegulacionA !== undefined;
		assert.ok(tieneCalibre, `${p.id} sin calibre ni rango de regulación`);
	}
});

test('todo aparato del catálogo declara su disipación, aunque sea cero', () => {
	for (const p of PLANTILLAS) {
		assert.ok(p.disipacionW !== undefined,
			`${p.id} sin disipación: el balance térmico le inventaría los vatios de su tipo`);
		assert.ok(p.disipacionW! >= 0 && p.disipacionW! < 500, `${p.id} disipa ${p.disipacionW} W`);
	}
});

test('los rangos de regulación van de menor a mayor y contienen al calibre', () => {
	for (const p of PLANTILLAS.filter((x) => x.rangoRegulacionA)) {
		const [min, max] = p.rangoRegulacionA!;
		assert.ok(min > 0 && min < max, `${p.id} rango ${min}–${max} incoherente`);
		if (p.corrienteNominal !== undefined) {
			assert.ok(p.corrienteNominal >= min && p.corrienteNominal <= max,
				`${p.id}: el calibre ${p.corrienteNominal} A queda fuera de ${min}–${max} A`);
		}
	}
});

test('un diferencial declara sensibilidad y clase', () => {
	for (const p of PLANTILLAS.filter((x) => x.tipo === 'diferencial')) {
		assert.ok(p.sensibilidadMA && p.sensibilidadMA > 0, `${p.id} sin sensibilidad`);
		assert.ok(p.claseDiferencial, `${p.id} sin clase: con un variador detrás un AC puede quedarse ciego`);
	}
});

test('la curva del automático coincide con la que dice su referencia', () => {
	// «iC60N 2P C16» es curva C: si la tabla y la referencia no concuerdan, una de las dos miente.
	for (const p of PLANTILLAS.filter((x) => x.tipo === 'disyuntor')) {
		const enReferencia = /\b([BCD])\d+\b/.exec(p.referencia)?.[1];
		if (enReferencia) {
			assert.equal(p.curvaDisparo, enReferencia,
				`${p.id}: la referencia dice curva ${enReferencia} y la ficha dice ${p.curvaDisparo}`);
		}
	}
});

test('el calibre coincide con el que dice la referencia del automático', () => {
	for (const p of PLANTILLAS.filter((x) => x.tipo === 'disyuntor')) {
		const enReferencia = /\b[BCD](\d+)\b/.exec(p.referencia)?.[1];
		if (enReferencia) {
			assert.equal(p.corrienteNominal, Number(enReferencia),
				`${p.id}: la referencia dice ${enReferencia} A y la ficha dice ${p.corrienteNominal}`);
		}
	}
});

test('un aparato colocado llega con la ficha eléctrica del catálogo', () => {
	const p = crearProyecto('t');
	const d = crearDesdePlantilla(porId('disyuntor-2p-16'), p);
	assert.equal(d.corrienteNominal, 16);
	assert.equal(d.curvaDisparo, 'C');
	assert.equal(d.poderCorteKA, 6);
	assert.equal(d.polos, 2);
	assert.ok(d.disipacionW !== undefined);
});

test('y llega MARCADO como estimación: es lo que evita que el dossier presuma', () => {
	const p = crearProyecto('t');
	const d = crearDesdePlantilla(porId('disyuntor-3p'), p);
	assert.equal(d.poderCorteEstimado, true);
	assert.equal(d.disipacionEstimada, true);
});

test('un guardamotor llega con su rango de regulación y no comparte el array del catálogo', () => {
	const p = crearProyecto('t');
	const plantilla = porId('guardamotor-9');
	const d = crearDesdePlantilla(plantilla, p);
	assert.deepEqual(d.rangoRegulacionA, [6, 10]);
	// Copia, no referencia: editar un aparato no puede alterar el catálogo para los siguientes.
	d.rangoRegulacionA![0] = 99;
	assert.equal(plantilla.rangoRegulacionA![0], 6);
});

test('un diferencial colocado conserva sensibilidad y clase', () => {
	const p = crearProyecto('t');
	const d = crearDesdePlantilla(porId('diferencial-4p'), p);
	assert.equal(d.sensibilidadMA, 30);
	assert.equal(d.claseDiferencial, 'AC');
});

test('el relé de estado sólido es el que más calienta del catálogo', () => {
	// No es un capricho del test: un SSR de 25 A disipa decenas de vatios y es justo el aparato
	// que decide si el armario necesita ventilación. Si algún día alguien le pone 1 W «porque es
	// pequeño», esto salta.
	const ssr = porId('rele-estado-solido');
	const masCalientes = [...PLANTILLAS].sort((a, b) => (b.disipacionW ?? 0) - (a.disipacionW ?? 0));
	assert.ok(masCalientes.slice(0, 3).includes(ssr),
		`el SSR disipa ${ssr.disipacionW} W y no está entre los tres que más calientan`);
});
