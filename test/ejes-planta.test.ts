import test from 'node:test';
import assert from 'node:assert/strict';

import {
	altoSegunElAncho, coserEjes, ejesDeSistema, techoDeAncho, TrazoDibujado,
} from '../src/motores/ejes-planta.js';

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

test('coserEjes: se cosen los tramos MEDIDOS con los que no lo están', () => {
	/*
	 * El caso real de la cubierta: un ramal llega con su tramo central dibujado por los dos lados
	 * —de ahí se saca el ancho— y sus puntas dibujadas con una raya sola. Antes se cosían en dos
	 * montones separados que no se tocaban nunca, así que ese ramal salía partido en tres.
	 */
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, ancho: 300, medido: false },
		{ a: { x: 2160, y: 0 }, b: { x: 6000, y: 0 }, ancho: 300, medido: true },
		{ a: { x: 6150, y: 0 }, b: { x: 8000, y: 0 }, ancho: 300, medido: false },
	]);
	assert.equal(ejes.length, 1, 'es un ramal, no tres trozos');
	assert.deepEqual(ejes[0].puntos[0], [0, 0]);
	assert.deepEqual(ejes[0].puntos[ejes[0].puntos.length - 1], [8000, 0]);
	assert.equal(ejes[0].medido, true, 'basta con que un tramo se midiera para saber el ancho');
});

test('coserEjes: el ancho sale de los tramos medidos, no de los supuestos', () => {
	// Dos tramos medidos de 300 y cuatro puntas a las que se les puso el ancho de proyecto (600).
	// Por mayoría simple ganaría el 600 supuesto, que es justo el dato malo.
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, ancho: 600, medido: false },
		{ a: { x: 1100, y: 0 }, b: { x: 2000, y: 0 }, ancho: 600, medido: false },
		{ a: { x: 2100, y: 0 }, b: { x: 4000, y: 0 }, ancho: 300, medido: true },
		{ a: { x: 4100, y: 0 }, b: { x: 6000, y: 0 }, ancho: 300, medido: true },
		{ a: { x: 6100, y: 0 }, b: { x: 7000, y: 0 }, ancho: 600, medido: false },
		{ a: { x: 7100, y: 0 }, b: { x: 8000, y: 0 }, ancho: 600, medido: false },
	]);
	assert.equal(ejes.length, 1);
	assert.equal(ejes[0].ancho, 300, 'manda lo medido aunque sea minoría');
});

test('coserEjes: dos tramos que SE CRUZAN no son el mismo conducto', () => {
	// Un aspa: una rejilla, una cota o el símbolo de una pieza. Sus cuatro puntas están cerca unas
	// de otras, así que por pura cercanía se cosían y salía al 3D un conducto que no existe.
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 400, y: 400 }, ancho: 300 },
		{ a: { x: 400, y: 0 }, b: { x: 0, y: 400 }, ancho: 300 },
	]);
	assert.equal(ejes.length, 2, 'el aspa son dos rayas, no un conducto');
});

test('coserEjes: un codo de verdad SÍ se cose, aunque las puntas casi se toquen', () => {
	// Lo contrario del aspa: dos tramos en ángulo recto que se encuentran. Eso es un codo.
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, ancho: 300 },
		{ a: { x: 3150, y: 0 }, b: { x: 3150, y: 2500 }, ancho: 300 },
	]);
	assert.equal(ejes.length, 1, 'un codo no parte el conducto');
	assert.deepEqual(ejes[0].puntos[ejes[0].puntos.length - 1], [3150, 2500]);
});

test('coserEjes: se cose con el vecino MÁS CERCANO, no con el primero que salga', () => {
	// Tres tramos en línea. Si se cosiera con «el primero que aparezca» el recorrido podría saltar
	// al lejano y volver, y salía dando un rodeo que no existe.
	const ejes = coserEjes([
		{ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, ancho: 300 },
		{ a: { x: 1300, y: 0 }, b: { x: 2000, y: 0 }, ancho: 300 },
		{ a: { x: 1100, y: 0 }, b: { x: 1200, y: 0 }, ancho: 300 },
	]);
	assert.equal(ejes.length, 1);
	// El recorrido tiene que ir de menor a mayor sin volverse: 0 → 1000 → 1100 → 1200 → 1300 → 2000.
	const xs = ejes[0].puntos.map((p) => p[0]);
	const ordenado = [...xs].sort((a, b) => a - b);
	assert.deepEqual(xs, ordenado, `el recorrido da un rodeo: ${xs.join(' → ')}`);
});

/* ============ El techo de ancho: el conducto de extracción de una UMA mide 1.500 mm ============

Había un techo para no emparejar cualquier cosa —dos cañerías de agua que corren en paralelo a
metro y medio se emparejaban entre sí y salía un «tubo» de 1.875 mm que no existe— pero salía del
ANCHO DE PROYECTO por tres. Y ese ancho es el de respaldo, o sea el del conducto más pequeño del
sistema: para extracción son 200 mm, así que el techo quedaba en 600.

En la cubierta, la extracción de cada UMA está dibujada por sus dos lados a 1.500 mm. Se rechazaba
por ancha, se quedaba sin medir, y salía como trocitos sueltos alrededor de la máquina. */

test('techoDeAncho: un conducto de aire puede ser ancho; una cañería, no', () => {
	// El aire va por conductos que en una cubierta llegan a dos metros.
	assert.ok(techoDeAncho('extraccion', 200) >= 1500, 'la extracción de una UMA mide 1.500 mm');
	assert.ok(techoDeAncho('inyeccion', 355) >= 1500);
	// El agua no: sin techo estrecho, dos cañerías paralelas se emparejan entre sí.
	assert.ok(techoDeAncho('agua', 160) < 600, `salió ${techoDeAncho('agua', 160)}`);
	assert.ok(techoDeAncho('bus', 50) < 600);
});

test('el techo no puede salir del ancho de proyecto (es el del conducto más PEQUEÑO)', () => {
	// La regla vieja: 200 × 3 = 600, que deja fuera la extracción real de 1.500.
	assert.ok(techoDeAncho('extraccion', 200) > 200 * 3);
});

test('los dos lados de la extracción de una UMA se reconocen como un conducto', () => {
	// Geometría literal de UMA-2-373, en coordenadas relativas a la máquina.
	const lado = (y: number): TrazoDibujado => ({
		sistema: 'extraccion', z: 4600, ancho: 200, alto: 100,
		puntos: [[2216, y], [1216, y]],
	});
	const ejes = ejesDeSistema([lado(813), lado(-687)], { largoMinimoSuelto: 0 });
	assert.equal(ejes.length, 1, 'tenían que salir UN conducto, no dos líneas sueltas');
	assert.equal(Math.round(ejes[0].ancho), 1500, 'el ancho es el que mide el plano');
	assert.equal(ejes[0].anchoMedido, true);
	// Y el eje va por el medio de los dos lados.
	assert.equal(Math.round(ejes[0].puntos[0][1]), 63);
});

/*
 * Lo que el techo NO arregla, y que conviene que quede escrito para no volver a intentarlo: las
 * piezas de transición del plano se dibujan en ASPA —dos diagonales que se cruzan— y no son «dos
 * lados» de nada. Emparejarlas inventaría un conducto donde hay un accesorio.
 */
test('una pieza dibujada en aspa no se toma por un conducto', () => {
	const aspa = (p: [number, number][]): TrazoDibujado =>
		({ sistema: 'extraccion', z: 4600, ancho: 200, alto: 100, puntos: p });
	const ejes = ejesDeSistema([
		aspa([[-1534, 376], [-934, -512]]),
		aspa([[-1534, -251], [-934, 638]]),
	], { largoMinimoSuelto: 0 });
	assert.ok(ejes.every((e) => !e.anchoMedido),
		'se cruzan: no pueden dar un ancho medido');
});

/* ==================== Las PIEZAS: lo que el plano dibuja en aspa ====================

La costura ya sabía que dos tramos que se cruzan no son el mismo conducto, y por eso no los unía.
Lo que faltaba era la otra mitad: si al terminar quedan dos recorridos cortos, rectos y cruzados,
eso no es una costura perdida — es una transición, una compuerta o un acoplamiento flexible.

Comprobado en la cubierta: de los 66 recorridos cortos de inyección, los 32 que tenían una punta
vecina a menos de 350 mm (o sea, dentro del umbral de costura y aun así sin unir) son aspas, y las
32 estaban bien rechazadas. No había ni una costura perdida. Y en total son 129 de los 398
recorridos, 149 m: un tercio de lo que se estaba dibujando como conducto. */

test('dos diagonales cruzadas se marcan como PIEZA, no como conducto', () => {
	// La transición de UMA-2-373, tal cual sale del plano.
	const aspa = (p: [number, number][]): TrazoDibujado =>
		({ sistema: 'extraccion', z: 4600, ancho: 200, alto: 100, puntos: p });
	const ejes = ejesDeSistema([
		aspa([[-1534, 376], [-934, -512]]),
		aspa([[-1534, -251], [-934, 638]]),
	], { largoMinimoSuelto: 0 });
	assert.equal(ejes.length, 2, 'siguen ahí: están en un sitio real y hay que verlas');
	assert.ok(ejes.every((e) => e.pieza), 'las dos tenían que quedar marcadas como pieza');
});

test('un conducto de verdad NO se marca como pieza', () => {
	const ejes = ejesDeSistema(conducto(0, 0, 8000, 400), { largoMinimoSuelto: 0 });
	assert.equal(ejes.length, 1);
	assert.ok(!ejes[0].pieza, 'un tramo recto y largo es conducto, no accesorio');
});

test('dos conductos que se cruzan en planta a distinta altura no son una pieza', () => {
	// Se cruzan, sí, pero son LARGOS: un accesorio no mide ocho metros.
	const largo = (p: [number, number][]): TrazoDibujado =>
		({ sistema: 'inyeccion', z: 4200, ancho: 355, alto: 180, puntos: p });
	const ejes = ejesDeSistema([
		largo([[0, 0], [8000, 8000]]),
		largo([[0, 8000], [8000, 0]]),
	], { largoMinimoSuelto: 0 });
	assert.ok(ejes.every((e) => !e.pieza), 'son dos conductos que se cruzan, no un accesorio');
});
