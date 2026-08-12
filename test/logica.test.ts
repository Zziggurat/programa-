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
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { simular, memoriaVacia } from '../src/motores/simulacion.js';

import {
	Expr, LecturaControlador, esperasDe, evaluar, leerPrograma, memoriaLogicaVacia, salidasActivas,
	valorDeRampa, valoresAnalogicos,
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

/* --------------------------- Salidas analógicas (0–10 V) --------------------------- */

test('se lee una salida analógica escrita como se dice en obra', () => {
	const p = leerPrograma('AO1 = 0 a 10 según TE1 de 18 a 24  ; válvula de calor');
	assert.equal(p.errores.length, 0, JSON.stringify(p.errores));
	assert.equal(p.reglas.length, 1);
	assert.deepEqual(p.reglas[0].rampa, {
		sonda: 'TE1', sondaDesde: 18, sondaHasta: 24, desde: 0, hasta: 10,
	});
	assert.equal(p.reglas[0].comentario, 'válvula de calor');
});

test('la válvula abre en proporción a lo que marca la sonda', () => {
	const r = leerPrograma('AO1 = 0 a 10 según TE1 de 18 a 24').reglas[0].rampa!;
	assert.equal(valorDeRampa(r, { TE1: 18 }), 0, 'en el extremo frío, cerrada');
	assert.equal(valorDeRampa(r, { TE1: 21 }), 5, 'a mitad de banda, medio abierta');
	assert.equal(valorDeRampa(r, { TE1: 24 }), 10, 'en el extremo caliente, abierta del todo');
});

test('fuera de la banda se queda en el tope, no se pasa', () => {
	const r = leerPrograma('AO1 = 0 a 10 según TE1 de 18 a 24').reglas[0].rampa!;
	assert.equal(valorDeRampa(r, { TE1: 5 }), 0, 'no existe «menos que cerrada»');
	assert.equal(valorDeRampa(r, { TE1: 40 }), 10, 'ni «más que abierta»');
});

test('una banda al revés enfría: cuanto más calor, menos señal', () => {
	// Como se programa una compuerta de free-cooling o una válvula de frío.
	const r = leerPrograma('AO2 = 10 a 0 según TE1 de 22 a 28').reglas[0].rampa!;
	assert.equal(valorDeRampa(r, { TE1: 22 }), 10);
	assert.equal(valorDeRampa(r, { TE1: 25 }), 5);
	assert.equal(valorDeRampa(r, { TE1: 28 }), 0);
});

test('si la sonda no marca nada, la salida se queda en reposo', () => {
	const r = leerPrograma('AO1 = 0 a 10 según TE1 de 18 a 24').reglas[0].rampa!;
	assert.equal(valorDeRampa(r, {}), 0, 'sonda sin conectar: la válvula no se abre sola');
});

test('una banda de ancho cero se rechaza con su explicación', () => {
	const p = leerPrograma('AO1 = 0 a 10 según TE1 de 20 a 20');
	assert.equal(p.reglas.length, 0);
	assert.match(p.errores[0].que, /banda/i);
});

test('las analógicas no se cuelan entre las salidas encendidas', () => {
	const p = leerPrograma('DO1 = DI1\nAO1 = 0 a 10 según TE1 de 18 a 24');
	const lectura = { activos: new Set(['DI1']), salidasPrevias: new Set<string>(), valores: { TE1: 24 } };
	const encendidas = salidasActivas(p.reglas, lectura);
	assert.ok(encendidas.has('DO1'));
	assert.ok(!encendidas.has('AO1'), 'una válvula abierta al 100 % no es un contacto cerrado');
	assert.deepEqual(valoresAnalogicos(p.reglas, lectura), { AO1: 10 });
});

test('lo de siempre sigue funcionando junto a lo analógico', () => {
	const p = leerPrograma([
		'DO1 = DI1 Y NO DI2      ; ventilador',
		'AO1 = 0 a 10 según TE1 de 18 a 24   ; válvula',
		'DO2 = DI1 retardo 5     ; compuerta',
	].join('\n'));
	assert.equal(p.errores.length, 0, JSON.stringify(p.errores));
	assert.equal(p.reglas.length, 3);
	assert.equal(p.reglas[1].rampa?.sonda, 'TE1');
	assert.equal(p.reglas[2].retardoS, 5);
});

/* ==================================================================================================
 * UN RETARDO DEL PROGRAMA TIENE QUE CUMPLIRSE DE VERDAD, DENTRO DE LA SIMULACIÓN ENTERA.
 *
 * El motor de lógica contaba bien los retardos cuando se le llamaba solo. Pero la simulación lo
 * llama VARIAS VECES por paso —una por cada pasada del bucle que va estabilizando el tablero— y en
 * la primera pasada el circuito todavía no está resuelto: una entrada que sí tiene tensión aparece
 * sin ella, la condición sale falsa, y `salidasActivas` borraba el contador del retardo por
 * entender que la condición «había dejado de cumplirse».
 *
 * Resultado: en cada paso el reloj del retardo volvía a cero y NINGÚN `retardo` ni `minimo` de un
 * programa podía cumplirse jamás. Medido en la UMA de la biblioteca, con la marcha pedida desde el
 * segundo 0: a los 60 segundos simulados el ventilador seguía parado.
 *
 * Esta prueba corre la simulación COMPLETA, como la corre el modo Energizar, y por eso vale: la
 * misma comprobación hecha solo contra `salidasActivas` pasaba con el defecto puesto.
 * ================================================================================================ */


/**
 * Corre la simulación paso a paso, como el reloj del modo Energizar (200 ms por paso).
 *
 * `mover` puede cambiar los mandos por el camino, y es imprescindible para probar un tiempo
 * mínimo: hay que ensuciar el filtro CON EL VENTILADOR YA EN MARCHA. Empezar una corrida nueva con
 * el filtro sucio no prueba nada —nunca llega a arrancar—, que es lo que hacía la primera versión
 * de esta prueba.
 */
function correr(
	proyecto: ReturnType<typeof EJEMPLOS[number]['crear']>,
	estado: Record<string, { activo?: boolean; disparado?: boolean }>,
	segundos: number,
	mover?: (t: number, estado: Record<string, { activo?: boolean; disparado?: boolean }>) => void,
) {
	const reloj = { ahora: 0, memoria: memoriaVacia(), logica: memoriaLogicaVacia() };
	let previos = new Set<string>();
	let r = simular(proyecto, estado, previos, reloj);
	for (let paso = 1; paso <= (segundos * 1000) / 200; paso++) {
		reloj.ahora = paso * 200;
		mover?.(reloj.ahora / 1000, estado);
		r = simular(proyecto, estado, previos, reloj);
		previos = r.activos;
	}
	return r;
}

test('el retardo de un programa se cumple: la UMA arranca el ventilador a los 8 s', () => {
	const proyecto = EJEMPLOS.find((e) => e.id === 'uma-cubierta')!.crear();
	const marcha = { s0: { activo: true } };

	// A los 4 s la compuerta ya está abierta y el ventilador TODAVÍA no: eso es el retardo.
	const a4 = correr(proyecto, marcha, 4);
	assert.ok(a4.activos.has('y1'), 'la compuerta abre en cuanto se pide marcha');
	assert.ok(!a4.activos.has('m1'), 'a los 4 s el ventilador aún espera los 8 s del programa');

	// A los 12 s tiene que estar girando, y por el camino que dice la explicación.
	const a12 = correr(proyecto, marcha, 12);
	assert.ok(a12.activos.has('m1'),
		'a los 12 s el ventilador tiene que girar: el retardo de 8 s ya venció');
	assert.ok(a12.activos.has('k1'), 'y pasa por el relé de interposición de 24 V');
	assert.ok(a12.activos.has('km1'), 'que mete el contactor de 220 V');
});

test('el tiempo mínimo de un programa sostiene la salida', () => {
	const proyecto = EJEMPLOS.find((e) => e.id === 'uma-cubierta')!.crear();
	/*
	 * Una SOLA corrida: marcha desde el principio y, a los 14 s —con el ventilador ya girando—, se
	 * ensucia el filtro. El renglón 1 cierra la compuerta al instante; el renglón 2 lleva
	 * `minimo 30` y el ventilador tiene que aguantar. Es lo que evita que el motor arranque y pare
	 * sin parar cada vez que el presostato tirita.
	 */
	let giraba = false;
	const r = correr(proyecto, { s0: { activo: true } }, 20, (t, estado) => {
		if (t >= 14 && !estado.s1) estado.s1 = { activo: true };
	});
	giraba = true;
	assert.ok(giraba);
	assert.ok(!r.activos.has('y1'), 'el filtro sucio cierra la compuerta');
	assert.ok(r.activos.has('m1'),
		'pero el ventilador aguanta su tiempo mínimo en vez de caerse de golpe');

	// Y pasado el mínimo, sí se cae: el sostén tiene fin.
	const tarde = correr(proyecto, { s0: { activo: true } }, 50, (t, estado) => {
		if (t >= 14 && !estado.s1) estado.s1 = { activo: true };
	});
	assert.ok(!tarde.activos.has('m1'),
		'cumplidos los 30 s de mínimo el ventilador sí para: si no, el «minimo» no acabaría nunca');
});
