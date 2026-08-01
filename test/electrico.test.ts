/**
 * Tests del motor eléctrico. Son los cálculos que deciden si un tablero es seguro, así que
 * se comprueban contra valores de tabla y contra casos reales de taller.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ampacidad, areaConductorAisladoMm2, caidaTensionPct, CAIDA_MAX_PCT, coordinacionCorrecta,
	factorAgrupamiento, factorTemperatura, ocupacionCanaleta, seccionMinima, seccionPE,
} from '../src/motores/electrico.js';

/* ------------------------------- Ampacidad ------------------------------- */

test('ampacidad: coincide con la tabla IEC para las secciones habituales', () => {
	assert.equal(ampacidad(1.5), 14.5);
	assert.equal(ampacidad(2.5), 19.5);
	assert.equal(ampacidad(4), 26);
	assert.equal(ampacidad(6), 34);
	assert.equal(ampacidad(10), 46);
});

test('ampacidad: una sección intermedia usa la fila inmediatamente superior (conservador)', () => {
	assert.equal(ampacidad(2), 19.5, '2 mm² no está en tabla: se usa la de 2,5');
});

test('ampacidad: agrupar conductores baja la corriente admisible', () => {
	assert.ok(ampacidad(2.5, 4) < ampacidad(2.5, 1));
	assert.equal(ampacidad(2.5, 4), 19.5 * 0.65);
});

test('factorAgrupamiento: baja al agrupar y nunca sube de 1', () => {
	assert.equal(factorAgrupamiento(1), 1);
	assert.equal(factorAgrupamiento(0), 1);
	for (let n = 2; n < 20; n++) {
		assert.ok(factorAgrupamiento(n) <= factorAgrupamiento(n - 1), `n=${n} no debe subir`);
		assert.ok(factorAgrupamiento(n) > 0 && factorAgrupamiento(n) < 1);
	}
});

/* ---------------------------- Sección mínima ---------------------------- */

test('seccionMinima: elige la sección normalizada que aguanta esa corriente', () => {
	assert.equal(seccionMinima(10), 1);      // 11 A
	assert.equal(seccionMinima(14), 1.5);    // 14,5 A
	assert.equal(seccionMinima(16), 2.5);    // 19,5 A
	assert.equal(seccionMinima(25), 4);      // 26 A
	assert.equal(seccionMinima(32), 6);      // 34 A
});

test('seccionMinima: con conductores agrupados pide más sección', () => {
	assert.equal(seccionMinima(16, 1), 2.5);
	assert.ok((seccionMinima(16, 6) ?? 0) > 2.5, 'agrupados, 2,5 mm² ya no basta para 16 A');
});

test('seccionMinima: fuera de tabla devuelve undefined en vez de inventar', () => {
	assert.equal(seccionMinima(5000), undefined);
});

/* --------------------------- Caída de tensión --------------------------- */

test('caidaTensionPct: caso de taller — 20 m, 16 A, 2,5 mm², 220 V', () => {
	// ΔU = 2·0,0225·20·16/2,5 = 5,76 V → 2,62 %
	const pct = caidaTensionPct({ corrienteA: 16, longitudM: 20, seccionMm2: 2.5, tensionV: 220 });
	assert.ok(Math.abs(pct - 2.618) < 0.01, `salió ${pct.toFixed(3)} %`);
	assert.ok(pct < CAIDA_MAX_PCT.fuerza, 'ese circuito es correcto');
});

test('caidaTensionPct: trifásico cae menos que monofásico en igualdad de condiciones', () => {
	const base = { corrienteA: 20, longitudM: 30, seccionMm2: 4, tensionV: 380 };
	assert.ok(caidaTensionPct({ ...base, trifasico: true }) < caidaTensionPct(base));
});

test('caidaTensionPct: doblar la longitud dobla la caída; doblar la sección la parte por dos', () => {
	const base = { corrienteA: 10, longitudM: 10, seccionMm2: 1.5, tensionV: 220 };
	const uno = caidaTensionPct(base);
	assert.ok(Math.abs(caidaTensionPct({ ...base, longitudM: 20 }) - 2 * uno) < 1e-9);
	assert.ok(Math.abs(caidaTensionPct({ ...base, seccionMm2: 3 }) - uno / 2) < 1e-9);
});

test('caidaTensionPct: datos imposibles no revientan ni inventan', () => {
	assert.equal(caidaTensionPct({ corrienteA: 10, longitudM: 5, seccionMm2: 0, tensionV: 220 }), 0);
	assert.equal(caidaTensionPct({ corrienteA: 10, longitudM: 5, seccionMm2: 2.5, tensionV: 0 }), 0);
});

/* ---------------------------- Coordinación ---------------------------- */

test('coordinacion: un automático de 16 A protege 2,5 mm² pero NO 1,5 mm²', () => {
	assert.ok(coordinacionCorrecta({ corrienteProteccionA: 16, seccionMm2: 2.5 }));
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 16, seccionMm2: 1.5 }),
		'1,5 mm² admite 14,5 A: un 16 A no lo protege');
});

test('coordinacion: el caso peligroso — automático grande sobre cable fino', () => {
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 32, seccionMm2: 1.5 }));
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 25, seccionMm2: 2.5 }));
});

test('coordinacion: el límite justo se acepta (In = Iz)', () => {
	assert.ok(coordinacionCorrecta({ corrienteProteccionA: 14.5, seccionMm2: 1.5 }));
});

test('coordinacion: agrupar conductores puede invalidar una coordinación que sola era correcta', () => {
	assert.ok(coordinacionCorrecta({ corrienteProteccionA: 16, seccionMm2: 2.5 }));
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 16, seccionMm2: 2.5, circuitosAgrupados: 6 }));
});

/* ------------------------------- PE ------------------------------- */

test('seccionPE: hasta 16 mm² el PE es igual a la fase', () => {
	assert.equal(seccionPE(1.5), 1.5);
	assert.equal(seccionPE(6), 6);
	assert.equal(seccionPE(16), 16);
});

test('seccionPE: entre 16 y 35 mm² el PE se queda en 16; por encima, la mitad', () => {
	assert.equal(seccionPE(25), 16);
	assert.equal(seccionPE(35), 16);
	assert.equal(seccionPE(50), 25);
	assert.equal(seccionPE(95), 48);
});

/* --------------------------- Llenado de canaleta --------------------------- */

test('areaConductorAisladoMm2: el conductor aislado ocupa bastante más que el cobre', () => {
	const a = areaConductorAisladoMm2(2.5);
	assert.ok(a > 2.5 * 4, `un 2,5 mm² ocupa ~14 mm² con aislación (salió ${a.toFixed(1)})`);
	assert.ok(a < 2.5 * 8);
});

test('ocupacionCanaleta: pocos cables en una canaleta grande van holgados', () => {
	const o = ocupacionCanaleta({ anchoMm: 40, altoMm: 60, secciones: [1.5, 1.5, 2.5] });
	assert.ok(o < 0.1, `salió ${(o * 100).toFixed(1)} %`);
});

test('ocupacionCanaleta: muchos cables gruesos la sobrepasan', () => {
	const secciones = Array.from({ length: 40 }, () => 6);
	const o = ocupacionCanaleta({ anchoMm: 25, altoMm: 30, secciones });
	assert.ok(o > 0.45, `debe superar el 45 % recomendado (salió ${(o * 100).toFixed(0)} %)`);
});

test('ocupacionCanaleta: sin cables o sin canaleta da 0, no NaN', () => {
	assert.equal(ocupacionCanaleta({ anchoMm: 40, altoMm: 60, secciones: [] }), 0);
	assert.equal(ocupacionCanaleta({ anchoMm: 0, altoMm: 60, secciones: [2.5] }), 0);
});

/* ---------- Datos imposibles: nunca se propaga un número sin sentido ---------- */

test('ningún cálculo devuelve NaN ni Infinity, pase lo que pase', () => {
	const raros = [0, -1, -1e9, 1e12, NaN, Infinity, -Infinity, 1e-12];
	for (const v of raros) {
		assert.ok(Number.isFinite(ampacidad(v)), `ampacidad(${v}) = ${ampacidad(v)}`);
		assert.ok(Number.isFinite(seccionPE(v)), `seccionPE(${v}) = ${seccionPE(v)}`);
		assert.ok(Number.isFinite(areaConductorAisladoMm2(v)), `area(${v})`);
		assert.ok(Number.isFinite(factorAgrupamiento(v)), `agrupamiento(${v})`);
		assert.ok(Number.isFinite(ocupacionCanaleta({ anchoMm: v, altoMm: 40, secciones: [2.5, v] })), `ocupacion(${v})`);
		for (const w of raros) {
			const pct = caidaTensionPct({ corrienteA: v, longitudM: w, seccionMm2: 2.5, tensionV: 220 });
			assert.ok(Number.isFinite(pct), `caida(${v}, ${w}) = ${pct}`);
		}
	}
});

test('una sección desconocida NO se da por protegida (se responde por el lado seguro)', () => {
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 10, seccionMm2: 0 }));
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 10, seccionMm2: NaN }));
	assert.ok(!coordinacionCorrecta({ corrienteProteccionA: 10, seccionMm2: -2.5 }));
});

test('sin sección no hay intensidad admisible que inventar', () => {
	assert.equal(ampacidad(0), 0);
	assert.equal(ampacidad(-4), 0);
	assert.equal(ampacidad(NaN), 0);
});

test('una sección enorme extrapola pero sigue siendo un número usable', () => {
	const i = ampacidad(1e6);
	assert.ok(Number.isFinite(i) && i > ampacidad(95), `salió ${i}`);
});

test('seccionMinima con una corriente imposible no devuelve una sección falsa', () => {
	assert.equal(seccionMinima(NaN), undefined);
	assert.equal(seccionMinima(Infinity), undefined);
});

/* ------------------ La tabla no es el tablero: correcciones ------------------ */

test('la intensidad admisible se corrige por temperatura (IEC 60364-5-52 B.52.14)', () => {
	// Es la corrección que faltaba y por la que el programa aprobaba cables de azotea con la
	// tabla de 30 °C. Los factores son los de la norma para PVC.
	assert.equal(factorTemperatura(30), 1);
	assert.equal(factorTemperatura(40), 0.87);
	assert.equal(factorTemperatura(50), 0.71);
	// Entre dos filas se interpola.
	assert.ok(Math.abs(factorTemperatura(45) - 0.79) < 1e-9);
	assert.ok(factorTemperatura(47.5) > 0.71 && factorTemperatura(47.5) < 0.79);
	// Por debajo de la tabla no se extrapola al infinito.
	assert.equal(factorTemperatura(-40), 1.22);
});

test('por encima de 60 °C el PVC no admite corriente, y se dice con un cero', () => {
	// No es «aguanta poco»: es que a esa temperatura no se pone PVC. Devolver un número pequeño
	// invitaría a subir la sección, que ahí no arregla nada.
	assert.equal(factorTemperatura(61), 0);
	assert.equal(ampacidad(2.5, 1, 61), 0);
	assert.equal(seccionMinima(10, 1, 61), undefined);
});

test('un 2,5 mm² en un tablero de cubierta no admite lo que dice la tabla', () => {
	// El caso que motivó todo: tabla 19,5 A; dentro de un armario a 50 °C con nueve circuitos
	// en la canaleta, menos de 7 A. Aprobar un C16 encima era el error.
	assert.equal(ampacidad(2.5), 19.5);
	const real = ampacidad(2.5, 9, 50);
	assert.ok(real > 6.8 && real < 7.1, `${real} A`);
});
