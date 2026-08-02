import test from 'node:test';
import assert from 'node:assert/strict';

import { altoSegunElAncho, coserEjes, ejesDeSistema, TrazoDibujado } from '../src/motores/ejes-planta.js';

/** Un conducto dibujado por sus dos lados, como en un plano de verdad. */
function conducto(x0: number, y: number, x1: number, ancho: number): TrazoDibujado[] {
	return [
		{ sistema: 'aire', z: 4000, ancho: 600, alto: 400, puntos: [[x0, y], [x1, y]] },
		{ sistema: 'aire', z: 4000, ancho: 600, alto: 400, puntos: [[x0, y + ancho], [x1, y + ancho]] },
	];
}

test('ejesDeSistema: los dos lados de un conducto dan UN eje por el medio', () => {
	const ejes = ejesDeSistema(conducto(0, 0, 10000, 400));
	assert.equal(ejes.length, 1, 'dos lados son un solo conducto, no dos');
	assert.equal(ejes[0].puntos.length, 2);
	assert.equal(ejes[0].puntos[0][1], 200, 'el eje va por el medio de los dos lados');
	assert.equal(ejes[0].puntos[1][1], 200);
});

test('ejesDeSistema: el ancho se MIDE del plano, no se supone', () => {
	// El sistema dice 600 de proyecto, pero el plano dibuja este tramo de 250.
	const ejes = ejesDeSistema(conducto(0, 0, 10000, 250));
	assert.equal(ejes[0].ancho, 250, 'manda lo que mide el plano');
	assert.equal(ejes[0].anchoMedido, true);
});

test('ejesDeSistema: dos conductos que van en paralelo LEJOS no se confunden con uno', () => {
	// Cuatro líneas: dos conductos de 300 separados tres metros entre sí.
	const trazos = [...conducto(0, 0, 10000, 300), ...conducto(0, 3000, 10000, 300)];
	const ejes = ejesDeSistema(trazos);
	assert.equal(ejes.length, 2, 'son dos conductos, no uno gordo de 3,3 m');
	for (const e of ejes) assert.equal(e.ancho, 300);
});

test('ejesDeSistema: los detalles cortos sin pareja no llegan al 3D', () => {
	// Una rejilla dibujada con dos rayas cruzadas junto a un conducto de verdad.
	const trazos: TrazoDibujado[] = [
		...conducto(0, 0, 10000, 400),
		{ sistema: 'aire', z: 4000, ancho: 600, alto: 400, puntos: [[5000, 900], [5400, 1300]] },
		{ sistema: 'aire', z: 4000, ancho: 600, alto: 400, puntos: [[5400, 900], [5000, 1300]] },
	];
	const ejes = ejesDeSistema(trazos);
	assert.equal(ejes.length, 1, 'la rejilla no es un conducto');
});

test('ejesDeSistema: una línea sola y larga se conserva (hay planos esquemáticos)', () => {
	const trazos: TrazoDibujado[] = [
		{ sistema: 'aire', z: 4000, ancho: 600, alto: 400, puntos: [[0, 0], [20000, 0]] },
	];
	const ejes = ejesDeSistema(trazos);
	assert.equal(ejes.length, 1);
	assert.equal(ejes[0].ancho, 600, 'sin dos lados que medir, vale el de proyecto');
	assert.equal(ejes[0].anchoMedido, false);
});

test('ejesDeSistema: el mismo trazo repetido en el DXF no duplica el conducto', () => {
	const uno = conducto(0, 0, 10000, 400);
	const ejes = ejesDeSistema([...uno, ...uno, ...uno]);
	assert.equal(ejes.length, 1);
});

test('coserEjes: los tramos seguidos se cosen en un recorrido', () => {
	// Tres tramos en línea, con el hueco que deja cada pieza entre medias.
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, ancho: 300 },
		{ a: { x: 3160, y: 0 }, b: { x: 6000, y: 0 }, ancho: 300 },
		{ a: { x: 6150, y: 0 }, b: { x: 9000, y: 0 }, ancho: 300 },
	]);
	assert.equal(ejes.length, 1, 'es un solo conducto, no tres');
	// Cuatro puntos y no seis: al coser, la punta de un tramo y la del siguiente son la MISMA
	// unión, y el huequito que deja la pieza en el plano se absorbe ahí.
	assert.equal(ejes[0].puntos.length, 4);
	assert.deepEqual(ejes[0].puntos[0], [0, 0]);
	assert.deepEqual(ejes[0].puntos[3], [9000, 0]);
	assert.equal(ejes[0].ancho, 300);
});

test('coserEjes: dos conductos lejanos NO se cosen entre sí', () => {
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, ancho: 300 },
		{ a: { x: 0, y: 50000 }, b: { x: 3000, y: 50000 }, ancho: 300 },
	]);
	assert.equal(ejes.length, 2);
});

test('coserEjes: el ancho del recorrido es el que más se repite, no el de una reducción', () => {
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, ancho: 300 },
		{ a: { x: 3100, y: 0 }, b: { x: 6000, y: 0 }, ancho: 300 },
		{ a: { x: 6100, y: 0 }, b: { x: 7000, y: 0 }, ancho: 150 },
	]);
	assert.equal(ejes.length, 1);
	assert.equal(ejes[0].ancho, 300, 'la reducción del final no define el conducto');
});

test('altoSegunElAncho: la proporción sale del propio plano (2:1), no de una constante', () => {
	// Los bloques del DWG se llaman por su sección en pulgadas: 16X8, 8X4, 22X10, 14X8, 22X12.
	assert.equal(altoSegunElAncho(355), 178, 'un 14" va con la mitad de alto');
	assert.equal(altoSegunElAncho(200), 100, 'un 8" igual');
	assert.equal(altoSegunElAncho(60), 80, 'los muy finos no bajan de un mínimo visible');
});

test('ejesDeSistema: el alto acompaña al ancho medido, no se queda con el de proyecto', () => {
	const ejes = ejesDeSistema(conducto(0, 0, 10000, 200));
	assert.equal(ejes[0].ancho, 200);
	assert.equal(ejes[0].alto, 100, 'no puede salir más alto que ancho');
});
