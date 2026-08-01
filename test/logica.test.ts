/**
 * Tests del PROGRAMA DEL CONTROLADOR: el lenguaje que hace que un PLC del tablero deje de ser un
 * adorno y gobierne de verdad la maniobra.
 *
 * Se prueba en dos mitades: que el renglón se LEA como uno lo escribió —con su precedencia, sus
 * paréntesis y sus tiempos— y que se EJECUTE como uno espera, incluidos los retardos contra un
 * reloj simulado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	Expr, LecturaControlador, esperasDe, evaluar, leerPrograma, memoriaLogicaVacia, salidasActivas,
} from '../src/motores/logica.js';

/** Lo que ve el controlador: qué bornes tienen tensión y qué marcan las sondas. */
const lectura = (
	activos: string[] = [], valores: Record<string, number> = {}, salidas: string[] = [],
): LecturaControlador => ({
	activos: new Set(activos), valores, salidasPrevias: new Set(salidas),
});

const unaRegla = (texto: string) => {
	const p = leerPrograma(texto);
	assert.deepEqual(p.errores, [], `no se pudo leer «${texto}»`);
	assert.equal(p.reglas.length, 1);
	return p.reglas[0];
};

/* --------------------------------- Leer el programa --------------------------------- */

test('el renglón más simple: una salida sigue a una entrada', () => {
	const r = unaRegla('DO1 = DI1');
	assert.equal(r.salida, 'DO1');
	assert.deepEqual(r.cuando, { op: 'borne', borne: 'DI1' });
});

test('Y, O y NO se leen como se escriben', () => {
	assert.deepEqual(unaRegla('DO1 = DI1 Y DI2').cuando,
		{ op: 'y', de: [{ op: 'borne', borne: 'DI1' }, { op: 'borne', borne: 'DI2' }] });
	assert.deepEqual(unaRegla('DO1 = DI1 O DI2').cuando,
		{ op: 'o', de: [{ op: 'borne', borne: 'DI1' }, { op: 'borne', borne: 'DI2' }] });
	assert.deepEqual(unaRegla('DO1 = NO DI1').cuando,
		{ op: 'no', de: { op: 'borne', borne: 'DI1' } });
});

test('NO aprieta más que Y, e Y más que O: la precedencia de siempre', () => {
	// «A O B Y C» es «A O (B Y C)», no «(A O B) Y C». Si se leyera al revés, media maniobra de
	// clima haría lo contrario de lo que dice su renglón.
	const r = unaRegla('DO1 = DI1 O DI2 Y DI3');
	assert.equal(r.cuando.op, 'o');
	assert.equal((r.cuando as { de: Expr[] }).de[1].op, 'y');

	const n = unaRegla('DO1 = NO DI1 Y DI2');
	assert.equal(n.cuando.op, 'y', 'el NO se ha comido el Y entero');
	assert.equal((n.cuando as { de: Expr[] }).de[0].op, 'no');
});

test('los paréntesis mandan sobre la precedencia', () => {
	const r = unaRegla('DO1 = (DI1 O DI2) Y DI3');
	assert.equal(r.cuando.op, 'y');
	assert.equal((r.cuando as { de: Expr[] }).de[0].op, 'o');
});

test('se puede comparar una sonda con un número', () => {
	assert.deepEqual(unaRegla('AO1 = UI1 > 24').cuando, { op: 'mayor', borne: 'UI1', que: 24 });
	assert.deepEqual(unaRegla('AO1 = UI1 < 18,5').cuando, { op: 'menor', borne: 'UI1', que: 18.5 });
});

test('los tiempos van al final y no se confunden con la condición', () => {
	const r = unaRegla('DO2 = DI1 retardo 5');
	assert.equal(r.retardoS, 5);
	assert.deepEqual(r.cuando, { op: 'borne', borne: 'DI1' });

	const m = unaRegla('DO3 = DI1 Y DI2 minimo 30');
	assert.equal(m.minimoS, 30);
	assert.equal(m.cuando.op, 'y');

	const dos = unaRegla('DO4 = DI1 retardo 3 minimo 60');
	assert.equal(dos.retardoS, 3);
	assert.equal(dos.minimoS, 60);
});

test('el comentario tras «;» se guarda y no estorba', () => {
	const r = unaRegla('DO1 = DI1   ; arranca el ventilador');
	assert.equal(r.comentario, 'arranca el ventilador');
	assert.deepEqual(r.cuando, { op: 'borne', borne: 'DI1' });
});

test('las líneas en blanco y los comentarios sueltos se saltan', () => {
	const p = leerPrograma('\n; esto es el programa de la UMA-3\n\nDO1 = DI1\n\n');
	assert.deepEqual(p.errores, []);
	assert.equal(p.reglas.length, 1);
});

test('un renglón mal escrito NO tumba el resto del programa', () => {
	// Mientras se escribe, la mitad de los renglones están a medias. Lo que no puede pasar es que
	// un error deje el controlador entero mudo sin decir dónde está el problema.
	const p = leerPrograma('DO1 = DI1\nesto no es nada\nDO2 = DI2');
	assert.equal(p.reglas.length, 2, 'un renglón malo se ha llevado a los buenos por delante');
	assert.equal(p.errores.length, 1);
	assert.equal(p.errores[0].linea, 2);
	assert.match(p.errores[0].que, /=/);
});

test('los errores dicen QUÉ pasa, no «error de sintaxis»', () => {
	const casos: [string, RegExp][] = [
		['DO1 =', /cu[aá]ndo se enciende/],
		['DO1 = (DI1 Y DI2', /par[eé]ntesis/],
		['DO1 = DI1 Y', /se corta/],
		['DO1 = DI1 DI2', /sobra/],
		['= DI1', /borne de salida/],
		['DO1 = UI1 > verde', /n[uú]mero/],
	];
	for (const [texto, patron] of casos) {
		const p = leerPrograma(texto);
		assert.equal(p.errores.length, 1, `«${texto}» debería dar un error`);
		assert.match(p.errores[0].que, patron, `«${texto}» → «${p.errores[0].que}»`);
	}
});

/* ---------------------------------- Ejecutar ---------------------------------- */

test('una entrada con tensión cumple su condición', () => {
	const r = unaRegla('DO1 = DI1');
	assert.equal(evaluar(r.cuando, lectura(['DI1'])), true);
	assert.equal(evaluar(r.cuando, lectura([])), false);
});

test('Y necesita las dos; O le basta con una; NO le da la vuelta', () => {
	const y = unaRegla('DO1 = DI1 Y DI2').cuando;
	assert.equal(evaluar(y, lectura(['DI1', 'DI2'])), true);
	assert.equal(evaluar(y, lectura(['DI1'])), false);

	const o = unaRegla('DO1 = DI1 O DI2').cuando;
	assert.equal(evaluar(o, lectura(['DI2'])), true);
	assert.equal(evaluar(o, lectura([])), false);

	const no = unaRegla('DO1 = NO DI1').cuando;
	assert.equal(evaluar(no, lectura([])), true);
	assert.equal(evaluar(no, lectura(['DI1'])), false);
});

test('la comparación de una sonda usa su valor de verdad', () => {
	const c = unaRegla('AO1 = UI1 > 24').cuando;
	assert.equal(evaluar(c, lectura([], { UI1: 26 })), true);
	assert.equal(evaluar(c, lectura([], { UI1: 22 })), false);
	assert.equal(evaluar(c, lectura([], {})), false, 'una sonda sin valor no puede pedir nada');
});

test('LA MANIOBRA DE UNA UMA: marcha, sin alarma, y la válvula por temperatura', () => {
	const p = leerPrograma([
		'DO1 = DI1 Y NO DI2        ; ventilador: marcha y sin alarma',
		'AO1 = UI1 < 21            ; válvula de calor si hace frío',
	].join('\n'));
	assert.deepEqual(p.errores, []);

	const enMarcha = salidasActivas(p.reglas, lectura(['DI1'], { UI1: 19 }));
	assert.deepEqual([...enMarcha].sort(), ['AO1', 'DO1']);

	const conAlarma = salidasActivas(p.reglas, lectura(['DI1', 'DI2'], { UI1: 19 }));
	assert.deepEqual([...conAlarma], ['AO1'], 'la alarma no ha parado el ventilador');

	const yaCaliente = salidasActivas(p.reglas, lectura(['DI1'], { UI1: 23 }));
	assert.deepEqual([...yaCaliente], ['DO1'], 'la válvula sigue abierta con la sala caliente');
});

test('una salida se puede realimentar a sí misma (enclavamiento en el programa)', () => {
	const p = leerPrograma('DO1 = (DI1 O DO1) Y NO DI2');
	const arranca = salidasActivas(p.reglas, lectura(['DI1']));
	assert.deepEqual([...arranca], ['DO1']);
	// Se suelta la marcha: la salida se sostiene por sí misma, como un contactor enclavado.
	const sigue = salidasActivas(p.reglas, lectura([], {}, ['DO1']));
	assert.deepEqual([...sigue], ['DO1'], 'no se sostiene al soltar la marcha');
	// Y el paro la tira.
	const para = salidasActivas(p.reglas, lectura(['DI2'], {}, ['DO1']));
	assert.deepEqual([...para], [], 'el paro no la tira');
});

/* ------------------------------- Retardos y mínimos ------------------------------- */

test('RETARDO: la salida espera sus segundos antes de encender', () => {
	const p = leerPrograma('DO1 = DI1 retardo 5');
	const memoria = memoriaLogicaVacia();
	const pedida = lectura(['DI1']);

	assert.deepEqual([...salidasActivas(p.reglas, pedida, { ahora: 0, memoria })], [],
		'ha encendido en el acto');
	assert.deepEqual([...salidasActivas(p.reglas, pedida, { ahora: 3000, memoria })], [],
		'a los 3 s de 5 ya está encendida');
	const espera = esperasDe(p.reglas, pedida, { ahora: 3000, memoria });
	assert.equal(espera[0]?.motivo, 'retardo');
	assert.ok(espera[0].restan > 1.5 && espera[0].restan <= 2.1, `quedan ${espera[0].restan} s`);
	assert.deepEqual([...salidasActivas(p.reglas, pedida, { ahora: 6000, memoria })], ['DO1']);
});

test('y si la condición se cae durante el retardo, la cuenta vuelve a empezar', () => {
	const p = leerPrograma('DO1 = DI1 retardo 5');
	const memoria = memoriaLogicaVacia();
	salidasActivas(p.reglas, lectura(['DI1']), { ahora: 0, memoria });
	salidasActivas(p.reglas, lectura([]), { ahora: 3000, memoria });        // se suelta
	assert.deepEqual([...salidasActivas(p.reglas, lectura(['DI1']), { ahora: 4000, memoria })], [],
		'la cuenta no se reinició al soltar');
	assert.deepEqual([...salidasActivas(p.reglas, lectura(['DI1']), { ahora: 9500, memoria })], ['DO1']);
});

test('TIEMPO MÍNIMO: una salida no se cae antes de tiempo aunque se lo pidan', () => {
	// Es lo que salva un compresor: arrancar y parar cada dos segundos lo destruye.
	const p = leerPrograma('DO1 = DI1 minimo 30');
	const memoria = memoriaLogicaVacia();
	assert.deepEqual([...salidasActivas(p.reglas, lectura(['DI1']), { ahora: 0, memoria })], ['DO1']);
	assert.deepEqual([...salidasActivas(p.reglas, lectura([]), { ahora: 5000, memoria })], ['DO1'],
		'se ha caído a los 5 s teniendo 30 de mínimo');
	const espera = esperasDe(p.reglas, lectura([]), { ahora: 5000, memoria });
	assert.equal(espera[0]?.motivo, 'minimo');
	assert.deepEqual([...salidasActivas(p.reglas, lectura([]), { ahora: 31000, memoria })], [],
		'no se cae nunca');
});

test('sin reloj, los tiempos se resuelven como si fueran cero', () => {
	// Para responder «¿esta lógica hace lo que quiero?» sin esperar medio minuto.
	const p = leerPrograma('DO1 = DI1 retardo 30');
	assert.deepEqual([...salidasActivas(p.reglas, lectura(['DI1']))], ['DO1']);
});

test('el programa se puede volver a escribir tal como se leyó', () => {
	const texto = 'DO1 = DI1 Y NO DI2   ; el ventilador\nDO2 = UI1 > 24 retardo 5';
	const p = leerPrograma(texto);
	assert.deepEqual(p.reglas.map((r) => r.fuente), texto.split('\n').map((l) => l.trim()));
});
