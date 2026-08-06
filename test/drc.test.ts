/**
 * Tests del motor DRC (detección de errores eléctricos).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { Hallazgo, verificarProyecto } from '../src/motores/drc.js';

function verificar(p: Proyecto): Hallazgo[] {
	return verificarProyecto(p, calcularPotenciales(p));
}

const reglas = (hs: Hallazgo[]) => hs.map((h) => h.regla);

test('R1: designaciones duplicadas', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'rele', designacion: '-K1', bornes: [] },
		{ id: 'b', tipo: 'rele', designacion: '-K1', bornes: [] },
	];
	assert.ok(reglas(verificar(p)).includes('R1-designacion-duplicada'));
});

test('R2: borne obligatorio sin conectar y dispositivo aislado', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', bornes: [{ id: '+24', tipo: 'control', obligatorio: true }] },
	];
	const r = reglas(verificar(p));
	assert.ok(r.includes('R2-borne-sin-conectar'));
	assert.ok(r.includes('R2-dispositivo-aislado'));
});

test('R3: cortocircuito L-N a través de un puente equivocado', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{
			id: 'x1', tipo: 'bornero',
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'N' }],
			puentes: [['1', '2']], // ¡puente entre fase y neutro!
		},
	];
	const errores = verificar(p).filter((h) => h.regla === 'R3-cortocircuito');
	assert.equal(errores.length, 1);
	assert.equal(errores[0].severidad, 'error');
});

test('R4: esclavo que apunta a un maestro inexistente', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'c', tipo: 'contactor', rol: { tipo: 'esclavo', maestroId: 'nope', contacto: 'NA' }, bornes: [] },
	];
	assert.ok(reglas(verificar(p)).includes('R4-esclavo-sin-maestro'));
});

test('R5: más conductores de los que admite el borne', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'rele', bornes: [{ id: 'A1', maxConductores: 2 }] },
		{ id: 'b', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }, { id: '3' }] },
	];
	p.conductores = ['1', '2', '3'].map((b, i) => ({
		id: `c${i}`,
		de: { dispositivoId: 'a', borneId: 'A1' },
		a: { dispositivoId: 'b', borneId: b },
		seccion: 1,
	}));
	const errores = verificar(p).filter((h) => h.regla === 'R5-exceso-conductores');
	assert.equal(errores.length, 1);
	assert.match(errores[0].mensaje, /3 conductores/);
});

test('R6: dispositivos con tensiones distintas en el mismo potencial', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', tensionNominal: 24, bornes: [{ id: '+', tipo: 'control' }] },
		{ id: 'b', tipo: 'piloto', tensionNominal: 220, bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'a', borneId: '+' }, a: { dispositivoId: 'b', borneId: '1' }, seccion: 1 },
	];
	assert.ok(reglas(verificar(p)).includes('R6-conflicto-tension'));
});

test('un circuito sano no produce errores', () => {
	const p = crearProyecto('t');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'h' }];
	p.dispositivos = [
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', hojaId: 'h1', posicion: { x: 0, y: 0 },
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{
			id: 'p1', tipo: 'piloto', designacion: '-P1', hojaId: 'h1', posicion: { x: 1, y: 0 },
			bornes: [{ id: '1', tipo: 'L' }],
		},
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'p1', borneId: '1' }, seccion: 1.5 },
	];
	const errores = verificar(p).filter((h) => h.severidad === 'error');
	// q1:2 queda libre pero no es obligatorio → sin errores (solo avisos).
	assert.deepEqual(errores, []);
});

/* ==================== Reglas ELÉCTRICAS (la física del tablero) ==================== */

/** Un circuito mínimo: protección de `In` A alimentando un motor por un cable de `seccion` mm². */
function circuito(In: number, seccion: number, opciones: { tension?: number; polos?: number } = {}): Proyecto {
	const p = crearProyecto('t');
	p.dispositivos = [
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', corrienteNominal: In,
			polos: opciones.polos ?? 1, tensionNominal: opciones.tension ?? 220,
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{
			id: 'm1', tipo: 'motor', designacion: '-M1', corrienteNominal: In,
			tensionNominal: opciones.tension ?? 220, polos: opciones.polos ?? 1,
			bornes: [{ id: 'U', tipo: 'L' }],
		},
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'm1', borneId: 'U' }, seccion }];
	return p;
}

test('R9: un automático de 25 A sobre cable de 2,5 mm² es un ERROR (el cable arde sin que salte)', () => {
	const hs = verificar(circuito(25, 2.5));
	const r9 = hs.find((h) => h.regla === 'R9-proteccion-sobredimensionada');
	assert.ok(r9, 'debe detectarse la descoordinación');
	assert.equal(r9.severidad, 'error');
	assert.match(r9.mensaje, /25 A/);
	assert.match(r9.mensaje, /2\.5 mm²/);
	assert.match(r9.mensaje, /6 mm²/, 'debe decir a qué sección subir');
	assert.match(r9.mensaje, /35 °C/, 'y en qué condiciones lo ha calculado');
});

/**
 * LA TABLA NO ES EL TABLERO.
 *
 * Un 2,5 mm² «admite 19,5 A» en la tabla, que es a 30 °C y con un solo circuito. Dentro de un
 * armario a 35 °C admite 18,3 A, y un 4 mm² no llega a los 25 A que sí aguantaría en la tabla.
 * Estas dos pruebas son las que impiden volver a verificar un tablero con la tabla a secas.
 */
test('R9: a la temperatura del armario, un 4 mm² YA NO da para 25 A', () => {
	assert.ok(reglas(verificar(circuito(25, 4))).includes('R9-proteccion-sobredimensionada'),
		'con la tabla a 30 °C esto pasaba; a 35 °C dentro del armario, no');
});

test('R9: con 6 mm² sí queda coordinado', () => {
	assert.ok(!reglas(verificar(circuito(25, 6))).includes('R9-proteccion-sobredimensionada'));
});

test('R9: el límite justo (16 A sobre 2,5 mm², que a 35 °C admite 18,3 A) se acepta', () => {
	assert.ok(!reglas(verificar(circuito(16, 2.5))).includes('R9-proteccion-sobredimensionada'));
});

test('R9: los circuitos que comparten canaleta se cuentan y bajan la admisible', () => {
	// Cuatro circuitos juntos en la misma canaleta son el factor 0,65 de IEC 60364-5-52: un
	// 2,5 mm² que a 35 °C admitía 18,3 A pasa a 11,9 A, y el C16 que estaba bien deja de estarlo.
	const p = circuito(16, 2.5);
	const canaletas = new Map([['c1', ['can1']]]);
	const sinAgrupar = verificarProyecto(p, calcularPotenciales(p), { canaletasPorConductor: canaletas });
	assert.ok(!reglas(sinAgrupar).includes('R9-proteccion-sobredimensionada'),
		'un solo circuito en la canaleta no agrupa nada');

	// Se añaden tres circuitos más pasando por la misma canaleta.
	for (let i = 2; i <= 4; i++) {
		p.dispositivos.push({
			id: `q${i}`, tipo: 'disyuntor', designacion: `-Q${i}`, corrienteNominal: 16,
			polos: 1, tensionNominal: 220, bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		});
		p.dispositivos.push({
			id: `m${i}`, tipo: 'motor', designacion: `-M${i}`, corrienteNominal: 16,
			tensionNominal: 220, polos: 1, bornes: [{ id: 'U', tipo: 'L' }],
		});
		p.conductores.push({
			id: `c${i}`, de: { dispositivoId: `q${i}`, borneId: '2' },
			a: { dispositivoId: `m${i}`, borneId: 'U' }, seccion: 2.5,
		});
		canaletas.set(`c${i}`, ['can1']);
	}
	const agrupado = verificarProyecto(p, calcularPotenciales(p), { canaletasPorConductor: canaletas });
	const r9 = agrupado.find((h) => h.regla === 'R9-proteccion-sobredimensionada');
	assert.ok(r9, 'con cuatro circuitos juntos el 2,5 mm² ya no aguanta el C16');
	assert.match(r9!.mensaje, /4 circuitos/, r9!.mensaje);
});

test('R9: sin calibre declarado no inventa un hallazgo', () => {
	const p = circuito(25, 1.5);
	delete p.dispositivos[0].corrienteNominal;
	delete p.dispositivos[1].corrienteNominal;
	assert.ok(!reglas(verificar(p)).includes('R9-proteccion-sobredimensionada'));
});

test('R9: un DIFERENCIAL puro no es una protección contra sobreintensidad', () => {
	// Un RCCB (IEC 61008) vigila la fuga a tierra, no la sobrecarga: sus 25 A son la corriente que
	// aguanta pasando, no un umbral de disparo. Tomarlo por protección hacía que el programa
	// mandara engordar a 4 mm² un cable que ya protegía el automático que va detrás.
	const p = circuito(25, 2.5);
	p.dispositivos[0].tipo = 'diferencial';
	p.dispositivos[0].sensibilidadMA = 30;
	assert.ok(!reglas(verificar(p)).includes('R9-proteccion-sobredimensionada'));
});

test('R9: un magnetotérmico-diferencial SÍ protege, y se le exige coordinación', () => {
	// Un RCBO (IEC 61009) es diferencial Y automático: declara curva, y con ella dispara también
	// por sobrecarga. La diferencia con el de arriba es exactamente esa curva.
	const p = circuito(25, 2.5);
	p.dispositivos[0].tipo = 'diferencial';
	p.dispositivos[0].sensibilidadMA = 30;
	p.dispositivos[0].curvaDisparo = 'C';
	assert.ok(reglas(verificar(p)).includes('R9-proteccion-sobredimensionada'));
});

test('R9: un SECCIONADOR tampoco protege: abre en carga, pero no dispara solo', () => {
	const p = circuito(25, 2.5);
	p.dispositivos[0].tipo = 'seccionador';
	assert.ok(!reglas(verificar(p)).includes('R9-proteccion-sobredimensionada'));
});

test('R13: el poder de corte sí se le exige a un seccionador y a un diferencial', () => {
	// No despejan ellos la falta, pero el cortocircuito les pasa por encima igual y tienen que
	// aguantarlo. Que no protejan contra sobrecarga no los libra de eso.
	for (const tipo of ['seccionador', 'diferencial'] as const) {
		const p = circuito(25, 4);
		p.dispositivos[0].tipo = tipo;
		p.opciones = { iccPresuntaKA: 10 };
		assert.ok(reglas(verificar(p)).includes('R13-sin-poder-de-corte'),
			`a un ${tipo} no se le pide el poder de corte`);
	}
});

test('R10: sin longitudes reales NO se calcula la caída de tensión (no se inventa)', () => {
	const p = circuito(16, 1.5);
	assert.ok(!reglas(verificar(p)).includes('R10-caida-tension'));
});

test('R10: un cable largo y fino avisa de caída de tensión excesiva', () => {
	const p = circuito(16, 1.5);
	// 60 m con 16 A por 1,5 mm² a 220 V → ~13 %, muy por encima del 5 %.
	const hs = verificarProyecto(p, calcularPotenciales(p), { longitudesMm: new Map([['c1', 60000]]) });
	const r10 = hs.find((h) => h.regla === 'R10-caida-tension');
	assert.ok(r10, 'debe avisar');
	assert.equal(r10.severidad, 'aviso');
	assert.match(r10.mensaje, /%/);
});

test('R10: el mismo circuito corto (1 m, como dentro de un tablero) no avisa', () => {
	const p = circuito(16, 1.5);
	const hs = verificarProyecto(p, calcularPotenciales(p), { longitudesMm: new Map([['c1', 1000]]) });
	assert.ok(!hs.some((h) => h.regla === 'R10-caida-tension'));
});

test('R10: en 24 V el listón es más estricto que en 220 V', () => {
	const p = circuito(2, 1, { tension: 24 });
	const hs = verificarProyecto(p, calcularPotenciales(p), { longitudesMm: new Map([['c1', 20000]]) });
	assert.ok(hs.some((h) => h.regla === 'R10-caida-tension'), 'en 24 V, 20 m con 2 A ya se nota');
});

test('R11: un borne de tierra sin conectar es ERROR aunque no esté marcado obligatorio', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'm1', tipo: 'motor', designacion: '-M1', bornes: [{ id: 'U', tipo: 'L' }, { id: 'PE', tipo: 'PE' }] },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1', tipo: 'L' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'm1', borneId: 'U' }, a: { dispositivoId: 'x1', borneId: '1' } }];
	const r11 = verificar(p).find((h) => h.regla === 'R11-sin-tierra');
	assert.ok(r11);
	assert.equal(r11.severidad, 'error');
	assert.equal(r11.dispositivoId, 'm1');
});

test('R11: con la tierra conectada no protesta', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'm1', tipo: 'motor', bornes: [{ id: 'PE', tipo: 'PE' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: 'PE', tipo: 'PE' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'm1', borneId: 'PE' }, a: { dispositivoId: 'x1', borneId: 'PE' }, seccion: 2.5 }];
	assert.ok(!reglas(verificar(p)).includes('R11-sin-tierra'));
});

test('R12: avisa de la canaleta que se pasa de llenado, y solo de esa', () => {
	const p = crearProyecto('t');
	const hs = verificarProyecto(p, calcularPotenciales(p), {
		canaletas: [
			{ canaletaId: 'can1', ocupacion: 1.3, excedida: true },
			{ canaletaId: 'can2', ocupacion: 0.4, excedida: false },
		],
	});
	const r12 = hs.filter((h) => h.regla === 'R12-canaleta-llena');
	assert.equal(r12.length, 1, 'la canaleta holgada no genera aviso');
	assert.match(r12[0].mensaje, /can1/);
	assert.match(r12[0].mensaje, /130 %/);
});

test('R12: sin datos de canaletas no se inventa ningún aviso', () => {
	const p = crearProyecto('t');
	assert.ok(!verificarProyecto(p, calcularPotenciales(p)).some((h) => h.regla === 'R12-canaleta-llena'));
});

test('un tablero correcto no dispara ninguna regla eléctrica', () => {
	const p = circuito(16, 2.5);
	p.dispositivos.forEach((d) => { d.bornes.push({ id: 'PE', tipo: 'PE' }); });
	p.conductores.push({ id: 'cpe', de: { dispositivoId: 'q1', borneId: 'PE' }, a: { dispositivoId: 'm1', borneId: 'PE' }, seccion: 2.5 });
	const hs = verificarProyecto(p, calcularPotenciales(p), { longitudesMm: new Map([['c1', 1500], ['cpe', 1500]]) });
	const electricas = hs.filter((h) => /^R(9|10|11|12)-/.test(h.regla));
	assert.deepEqual(electricas.map((h) => h.regla + ': ' + h.mensaje), []);
});

/* ------- Afinado de reglas: menos ruido, sin dejar de ver lo importante ------- */

test('R6: 380 V y 220 V del MISMO sistema (fase-neutro) no son un conflicto', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'red', tipo: 'otro', designacion: '-W1', tensionNominal: 380, bornes: [{ id: 'L1', tipo: 'L' }] },
		{ id: 'f1', tipo: 'fusible', designacion: '-F1', tensionNominal: 220, bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'red', borneId: 'L1' }, a: { dispositivoId: 'f1', borneId: '1' }, seccion: 1 }];
	assert.ok(!reglas(verificar(p)).includes('R6-conflicto-tension'),
		'el mando a 220 V colgado de una red de 380 V es lo normal, no un error');
});

test('R6: una mezcla que SÍ es peligrosa (24 V con 220 V) se sigue avisando', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'a', tipo: 'plc', designacion: '-A1', tensionNominal: 24, bornes: [{ id: '+24', tipo: 'control' }] },
		{ id: 'q', tipo: 'disyuntor', designacion: '-Q1', tensionNominal: 220, bornes: [{ id: '2', tipo: 'L' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'a', borneId: '+24' }, a: { dispositivoId: 'q', borneId: '2' }, seccion: 1 }];
	assert.ok(reglas(verificar(p)).includes('R6-conflicto-tension'));
});

test('R4: un contactor con auxiliares PROPIOS ya cableados no reclama esclavos', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', rol: { tipo: 'maestro' }, bornes: [
			{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
			{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' },
		] },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'km1', borneId: '13' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 1 }];
	assert.ok(!reglas(verificar(p)).includes('R4-maestro-sin-esclavos'));
});

test('R4: un contactor que manda por sus POLOS de potencia tampoco reclama esclavos', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', rol: { tipo: 'maestro' }, bornes: [
			{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
			{ id: '1/L1', tipo: 'L' }, { id: '2/T1', tipo: 'L' },
		] },
		{ id: 'm1', tipo: 'motor', designacion: '-M1', bornes: [{ id: 'U', tipo: 'L' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'km1', borneId: '2/T1' }, a: { dispositivoId: 'm1', borneId: 'U' }, seccion: 2.5 }];
	assert.ok(!reglas(verificar(p)).includes('R4-maestro-sin-esclavos'));
});

test('R4: una bobina que no manda NADA sí se avisa', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', rol: { tipo: 'maestro' }, bornes: [
			{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
		] },
		{ id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [{ id: 'c1', de: { dispositivoId: 'km1', borneId: 'A1' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 1 }];
	assert.ok(reglas(verificar(p)).includes('R4-maestro-sin-esclavos'));
});

test('R13: sin Icc declarada se avisa de que no se puede verificar el poder de corte', () => {
	const p = crearProyecto('t');
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', poderCorteKA: 6, bornes: [] },
	];
	assert.ok(reglas(verificar(p)).includes('R13-icc-sin-declarar'));
});

test('R13: un aparato con poder de corte por debajo de la Icc es un ERROR', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', poderCorteKA: 6, bornes: [] },
	];
	const h = verificar(p).filter((x) => x.regla === 'R13-poder-de-corte-insuficiente');
	assert.equal(h.length, 1);
	assert.equal(h[0].severidad, 'error');
	assert.equal(h[0].dispositivoId, 'q1');
});

test('R13: con poder de corte suficiente no se dice nada', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', poderCorteKA: 15, bornes: [] },
	];
	assert.ok(!reglas(verificar(p)).some((r) => r.startsWith('R13')));
});

test('R13: una protección sin poder de corte declarado se avisa, no se da por buena', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: [] },
	];
	const h = verificar(p).filter((x) => x.regla === 'R13-sin-poder-de-corte');
	assert.equal(h.length, 1);
	assert.equal(h[0].severidad, 'aviso');
});

test('R13: lo que no es una protección no entra en la regla', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [
		{ id: 'k1', tipo: 'contactor', designacion: '-KM1', bornes: [] },
	];
	assert.ok(!reglas(verificar(p)).some((r) => r.startsWith('R13')));
});

test('R14: un armario que se calienta de más sale como aviso, no como error', () => {
	const p = crearProyecto('t');
	p.gabinete = { ancho: 400, alto: 500, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [{ id: 'v1', tipo: 'variador', designacion: '-T1', disipacionW: 600, bornes: [] }];
	p.gabinete.colocaciones = [{ dispositivoId: 'v1', x: 20, y: 20, ancho: 120, alto: 200 }];
	const h = verificar(p).filter((x) => x.regla === 'R14-calentamiento');
	assert.equal(h.length, 1);
	assert.equal(h[0].severidad, 'aviso');
	assert.match(h[0].mensaje, /°C/);
});

test('R14: un armario fresco no dice nada del calentamiento', () => {
	const p = crearProyecto('t');
	p.gabinete = { ancho: 800, alto: 1200, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', disipacionW: 2, bornes: [] }];
	p.gabinete.colocaciones = [{ dispositivoId: 'q1', x: 20, y: 20, ancho: 18, alto: 85 }];
	assert.ok(!reglas(verificar(p)).includes('R14-calentamiento'));
});

test('R13: un fusible del circuito de mando no se compara contra la Icc de la acometida', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', tensionNominal: 400, poderCorteKA: 15, bornes: [] },
		// Detrás del transformador: aquí no hay 10 kA ni de lejos.
		{ id: 'f1', tipo: 'fusible', designacion: '-F1', tensionNominal: 24, bornes: [] },
	];
	const r = verificar(p).filter((h) => h.regla.startsWith('R13'));
	assert.deepEqual(r.map((h) => h.dispositivoId), []);
});

test('R13: una protección de red sin tensión declarada sí se comprueba', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: [] }];
	assert.ok(reglas(verificar(p)).includes('R13-sin-poder-de-corte'));
});

test('R13: 380 y 400 V son la misma red y las dos protecciones se comprueban', () => {
	const p = crearProyecto('t');
	p.opciones = { iccPresuntaKA: 10 };
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', tensionNominal: 400, poderCorteKA: 6, bornes: [] },
		{ id: 'q2', tipo: 'guardamotor', designacion: '-Q2', tensionNominal: 380, poderCorteKA: 6, bornes: [] },
	];
	const ids = verificar(p).filter((h) => h.regla === 'R13-poder-de-corte-insuficiente')
		.map((h) => h.dispositivoId).sort();
	assert.deepEqual(ids, ['q1', 'q2']);
});

/* ---------------- R15: la sección tiene que caber en la borna ---------------- */

test('R15: un 6 mm² no entra en una borna que admite 2,5', () => {
	// R5 cuenta cuántos hilos entran; esto comprueba que ENTREN. Se descubre con el tablero
	// montado y el cable ya cortado, que es el peor momento posible.
	const p = circuito(25, 6);
	p.dispositivos.push({
		id: 'x1', tipo: 'bornero', designacion: '-X1',
		bornes: [{ id: '1', tipo: 'L', seccionMaxMm2: 2.5 }],
	});
	p.conductores.push({
		id: 'c2', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 6,
	});
	const h = verificar(p).find((x) => x.regla === 'R15-seccion-no-cabe');
	assert.ok(h, 'no avisa de que el cable no entra');
	assert.equal(h!.severidad, 'error');
	assert.match(h!.mensaje, /6 mm²/);
	assert.match(h!.mensaje, /2\.5 mm²/);
});

test('R15: sin límite declarado no se supone ninguno', () => {
	const p = circuito(25, 6);
	p.dispositivos.push({
		id: 'x1', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1', tipo: 'L' }],
	});
	p.conductores.push({
		id: 'c2', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 6,
	});
	assert.ok(!reglas(verificar(p)).includes('R15-seccion-no-cabe'));
});

/* ------------- R16: la tierra no se adelgaza respecto de su fase ------------- */

test('R16: la tierra de un motor no puede ser más fina que su fase', () => {
	const p = circuito(16, 2.5);
	p.dispositivos[1].bornes.push({ id: 'PE', tipo: 'PE' });
	p.dispositivos.push({
		id: 'x0', tipo: 'bornero', designacion: '-X0', bornes: [{ id: 'PE', tipo: 'PE' }],
	});
	p.conductores.push({
		id: 'cpe', de: { dispositivoId: 'x0', borneId: 'PE' }, a: { dispositivoId: 'm1', borneId: 'PE' }, seccion: 1.5,
	});
	const h = verificar(p).find((x) => x.regla === 'R16-tierra-mas-fina-que-la-fase');
	assert.ok(h, 'una tierra de 1,5 bajo una fase de 2,5 tiene que salir');
	assert.match(h!.mensaje, /2\.5 mm²/);
});

test('R16: con la misma sección que la fase no dice nada', () => {
	const p = circuito(16, 2.5);
	p.dispositivos[1].bornes.push({ id: 'PE', tipo: 'PE' });
	p.dispositivos.push({
		id: 'x0', tipo: 'bornero', designacion: '-X0', bornes: [{ id: 'PE', tipo: 'PE' }],
	});
	p.conductores.push({
		id: 'cpe', de: { dispositivoId: 'x0', borneId: 'PE' }, a: { dispositivoId: 'm1', borneId: 'PE' }, seccion: 2.5,
	});
	assert.ok(!reglas(verificar(p)).includes('R16-tierra-mas-fina-que-la-fase'));
});

/* ------------- R17: selectividad entre protecciones en serie ------------- */

/** Dos protecciones una detrás de otra, con los calibres que se le pasen. */
function enSerie(inArriba: number, inAbajo: number): Proyecto {
	const p = crearProyecto('selectividad');
	p.dispositivos = [
		{ id: 'red', tipo: 'fuente', tensionNominal: 400, bornes: [{ id: 'L1', tipo: 'L' }] },
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', tensionNominal: 400,
			corrienteNominal: inArriba, bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{
			id: 'q2', tipo: 'disyuntor', designacion: '-Q2', tensionNominal: 400,
			corrienteNominal: inAbajo, bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{ id: 'm1', tipo: 'motor', tensionNominal: 400, bornes: [{ id: 'U', tipo: 'L' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'red', borneId: 'L1' }, a: { dispositivoId: 'q1', borneId: '1' }, seccion: 6 },
		{ id: 'c2', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'q2', borneId: '1' }, seccion: 6 },
		{ id: 'c3', de: { dispositivoId: 'q2', borneId: '2' }, a: { dispositivoId: 'm1', borneId: 'U' }, seccion: 2.5 },
	];
	return p;
}

const reglas17 = (p: Proyecto): string[] =>
	verificarProyecto(p, calcularPotenciales(p)).filter((h) => h.regla.startsWith('R17')).map((h) => h.regla);

test('R17: dos protecciones en serie del MISMO calibre es un error', () => {
	// El caso que deja a oscuras medio tablero por una avería de un solo circuito.
	assert.deepEqual(reglas17(enSerie(16, 16)), ['R17-sin-selectividad']);
});

test('R17: un general apenas mayor que su derivado se avisa', () => {
	// 20 A sobre 16 A es 1,25 veces: no llega a 1,6 y pueden saltar los dos.
	assert.deepEqual(reglas17(enSerie(20, 16)), ['R17-selectividad-justa']);
});

test('R17: con holgura de sobra no se dice nada', () => {
	assert.deepEqual(reglas17(enSerie(40, 16)), [], '40 sobre 16 es 2,5 veces: selectivo');
	assert.deepEqual(reglas17(enSerie(32, 16)), [], '32 sobre 16 es el doble');
});

test('R17: no se avisa dos veces de la misma pareja', () => {
	const hallazgos = verificarProyecto(enSerie(16, 16), calcularPotenciales(enSerie(16, 16)));
	assert.equal(hallazgos.filter((h) => h.regla.startsWith('R17')).length, 1);
});

test('R17: dos protecciones que NO están en serie no se comparan', () => {
	// Dos salidas independientes del mismo general, cada una con su automático de 16 A: eso es
	// un tablero normal y corriente, no un fallo de selectividad entre ellas.
	const p = crearProyecto('paralelo');
	p.dispositivos = [
		{ id: 'red', tipo: 'fuente', tensionNominal: 400, bornes: [{ id: 'L1', tipo: 'L' }] },
		{ id: 'qa', tipo: 'disyuntor', designacion: '-QA', tensionNominal: 400, corrienteNominal: 16,
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }] },
		{ id: 'qb', tipo: 'disyuntor', designacion: '-QB', tensionNominal: 400, corrienteNominal: 16,
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'red', borneId: 'L1' }, a: { dispositivoId: 'qa', borneId: '1' }, seccion: 6 },
		{ id: 'c2', de: { dispositivoId: 'red', borneId: 'L1' }, a: { dispositivoId: 'qb', borneId: '1' }, seccion: 6 },
	];
	// Comparten la ENTRADA, no van uno detrás del otro: no hay nada que coordinar entre ellos.
	assert.deepEqual(
		verificarProyecto(p, calcularPotenciales(p))
			.filter((h) => h.regla === 'R17-sin-selectividad').length, 0);
});

test('R17: sin calibre declarado no se inventa nada', () => {
	const p = enSerie(16, 16);
	delete p.dispositivos.find((d) => d.id === 'q1')!.corrienteNominal;
	assert.deepEqual(reglas17(p), [], 'sin el dato no se puede afirmar nada');
});
