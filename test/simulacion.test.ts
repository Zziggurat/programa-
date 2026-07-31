/**
 * Tests de la simulación: dar tensión y ver el circuito funcionar.
 *
 * La prueba que manda aquí es la del ENCLAVAMIENTO. En un arranque directo, el contactor se
 * mantiene a través de su propio contacto auxiliar: es un lazo de realimentación, y si la
 * simulación no itera hasta estabilizarse, al soltar el pulsador de marcha el motor se pararía —
 * justo lo que el enclavamiento existe para evitar. Si esa prueba pasa, el motor está bien hecho.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import {
	contactosAuxiliaresIEC, contactosCerrados, memoriaVacia, polosDe, simular,
	tensionSecundariaDe, tiempoDeDisparo,
} from '../src/motores/simulacion.js';

/**
 * Un ejemplo tal como lo ve la aplicación: numerado. Los ejemplos se construyen sin designaciones
 * y es el motor de numeración el que les pone el «-M1», igual que hace `recalcular()` al abrirlos.
 */
const ejemplo = (id: string): Proyecto => {
	const e = EJEMPLOS.find((x) => x.id === id);
	assert.ok(e, `no existe el ejemplo ${id}`);
	const p = e!.crear();
	numerarDispositivos(p);
	return p;
};

const gira = (r: ReturnType<typeof simular>, designacion: string) =>
	r.funcionando.some((f) => f.designacion === designacion);

/* ------------------------- La numeración IEC de los contactos ------------------------- */

test('los contactos se deducen de la numeración IEC: 11-12 es NC y 13-14 es NA', () => {
	const d = {
		id: 'k', tipo: 'rele' as const,
		bornes: [{ id: '11' }, { id: '12' }, { id: '13' }, { id: '14' }, { id: '21' }, { id: '22' }],
	};
	const c = contactosAuxiliaresIEC(d);
	assert.deepEqual(c.find((x) => x.comun === '11'), { comun: '11', salida: '12', tipo: 'NC' });
	assert.deepEqual(c.find((x) => x.comun === '13'), { comun: '13', salida: '14', tipo: 'NA' });
	assert.deepEqual(c.find((x) => x.comun === '21'), { comun: '21', salida: '22', tipo: 'NC' });
});

test('un borne sin su pareja no se toma por un contacto', () => {
	const d = { id: 'k', tipo: 'rele' as const, bornes: [{ id: '13' }, { id: 'A1' }, { id: 'A2' }] };
	assert.deepEqual(contactosAuxiliaresIEC(d), []);
});

test('un bloque auxiliar 11-12 NO es un polo de potencia', () => {
	// Los polos llegan al 7-8; del 11 en adelante son contactos auxiliares. Confundirlos hacía que
	// un relé auxiliar condujera por su NC justo cuando la bobina estaba metida, o sea al revés.
	const rele = {
		id: 'kt', tipo: 'rele' as const,
		bornes: [{ id: 'A1' }, { id: 'A2' }, { id: '11' }, { id: '12' }, { id: '13' }, { id: '14' }],
	};
	assert.deepEqual(polosDe(rele), [], 'un relé auxiliar no tiene polos de potencia');
	assert.deepEqual(contactosCerrados(rele, {}, false), [['11', '12']], 'en reposo, cerrado el NC');
	assert.deepEqual(contactosCerrados(rele, {}, true), [['13', '14']], 'metido, cerrado el NA');

	// Y un automático de cuatro polos sí los conserva todos.
	const q = {
		id: 'q', tipo: 'disyuntor' as const,
		bornes: ['1', '2', '3', '4', '5', '6', '7', '8'].map((id) => ({ id })),
	};
	assert.equal(polosDe(q).length, 4, 'un tetrapolar tiene cuatro polos');
});

/* --------------------------------- Sin tablero --------------------------------- */

test('un proyecto sin acometida lo dice, no se queda callado', () => {
	const r = simular(crearProyecto('vacío'));
	assert.equal(r.funcionando.length, 0);
	assert.ok(r.avisos.some((a) => /acometida/i.test(a)), r.avisos.join(' | '));
});

/* --------------------------- Arranque directo de motor --------------------------- */

test('con el tablero energizado y sin pulsar nada, el motor NO gira', () => {
	const r = simular(ejemplo('arranque-directo'));
	assert.ok(!gira(r, '-M1'), 'el motor arranca solo: eso es un tablero peligroso');
	assert.ok(r.vivos.size > 0, 'no llega tensión a ningún borne');
});

test('al pulsar MARCHA el motor arranca', () => {
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const r = simular(p, { [marcha.id]: { activo: true } });
	assert.ok(gira(r, '-M1'), `el motor no arranca. Funcionando: ${r.funcionando.map((f) => f.designacion).join(', ')}`);
});

test('ENCLAVAMIENTO: al soltar la marcha el motor SIGUE girando', () => {
	// La prueba que justifica que la simulación arrastre el estado anterior. Un enclavamiento no
	// crea el estado, lo MANTIENE: el auxiliar que sostiene la bobina solo está cerrado si el
	// contactor ya estaba cerrado. Se simula como pasa en la realidad: pulsar, y luego soltar
	// partiendo de lo que había.
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const km = p.dispositivos.find((d) => d.tipo === 'contactor')!;

	const pulsado = simular(p, { [marcha.id]: { activo: true } });
	assert.ok(pulsado.activos.has(km.id), 'el contactor no cerró al pulsar marcha');
	assert.ok(gira(pulsado, '-M1'), 'el motor no arranca con la marcha pulsada');

	const soltado = simular(p, { [marcha.id]: { activo: false } }, pulsado.activos);
	assert.ok(soltado.activos.has(km.id), 'el contactor se cayó al soltar: el enclavamiento no funciona');
	assert.ok(gira(soltado, '-M1'), 'el motor se paró al soltar el pulsador de marcha');
});

test('y un tablero al que se le da tensión con todo suelto NO arranca solo', () => {
	// La otra mitad de la moneda: sin estado anterior, el enclavamiento no se auto-engancha.
	const p = ejemplo('arranque-directo');
	const r = simular(p);
	assert.equal(r.activos.size, 0, 'una bobina se metió sola al energizar');
	assert.ok(!gira(r, '-M1'));
});

test('tras un PARO el enclavamiento no se recupera aunque se suelte el paro', () => {
	// Es lo que hace seguro un mando con enclavamiento: cortada la retención, hay que volver a
	// pulsar marcha. Si al soltar el paro el motor volviera solo, el tablero sería peligroso.
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const paro = p.dispositivos.find((d) => /PARO/i.test(d.descripcion ?? ''))!;
	const km = p.dispositivos.find((d) => d.tipo === 'contactor')!;

	const enMarcha = simular(p, { [marcha.id]: { activo: true } });
	const conParo = simular(p, { [paro.id]: { activo: true } }, enMarcha.activos);
	assert.ok(!conParo.activos.has(km.id), 'el paro no tiró el contactor');
	const trasSoltarParo = simular(p, {}, conParo.activos);
	assert.ok(!trasSoltarParo.activos.has(km.id), 'el motor volvió solo al soltar el paro');
});

test('al pulsar PARO el motor se para y no vuelve solo', () => {
	const p = ejemplo('arranque-directo');
	const paro = p.dispositivos.find((d) => /PARO/i.test(d.descripcion ?? ''))!;
	const km = p.dispositivos.find((d) => d.tipo === 'contactor')!;
	// El paro es un NC: al pulsarlo abre y corta la alimentación de la bobina.
	const r = simular(p, { [paro.id]: { activo: true } });
	assert.ok(!r.activos.has(km.id), 'el contactor sigue metido con el paro pulsado');
	assert.ok(!gira(r, '-M1'));
});

test('si el relé térmico dispara, el motor se para', () => {
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const termico = p.dispositivos.find((d) => d.bornes.some((b) => b.id === '95'))!;
	const r = simular(p, { [marcha.id]: { activo: true }, [termico.id]: { disparado: true } });
	assert.ok(!gira(r, '-M1'), 'el térmico disparó y el motor sigue girando: la bobina no vuelve por el 95-96');
});

test('con el guardamotor abierto no llega tensión al motor', () => {
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const q1 = p.dispositivos.find((d) => d.tipo === 'guardamotor')!;
	const r = simular(p, { [marcha.id]: { activo: true }, [q1.id]: { cerrado: false } });
	assert.ok(!gira(r, '-M1'), 'el motor gira con el guardamotor abierto');
});

test('la simulación se estabiliza: no oscila con el enclavamiento puesto', () => {
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const r = simular(p, { [marcha.id]: { activo: true } });
	assert.equal(r.oscila, false, `no se estabilizó en ${r.pasadas} pasadas`);
	assert.ok(r.pasadas > 1, 'con un lazo de enclavamiento tiene que hacer más de una pasada');
});

/* ------------------------------ Los cables se ven vivos ------------------------------ */

test('los conductores que llevan tensión se marcan, y los del motor solo al arrancar', () => {
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const parado = simular(p);
	const enMarcha = simular(p, { [marcha.id]: { activo: true } });
	assert.ok(enMarcha.conductoresVivos.size > parado.conductoresVivos.size,
		`parado ${parado.conductoresVivos.size} vivos, en marcha ${enMarcha.conductoresVivos.size}`);
});

/* ------------------------- Bomba con boya: el otro ejemplo ------------------------- */

test('la boya manda la bomba: cierra y arranca, abre y para', () => {
	// Este ejemplo no tiene pulsadores: lo gobierna la boya de nivel, que cierra cuando falta
	// agua. Es un mando SIN enclavamiento, así que la bomba sigue exactamente a la boya.
	const p = ejemplo('bomba-boya');
	const boya = p.dispositivos.find((d) => d.tipo === 'sensor')!;
	const bomba = p.dispositivos.find((d) => d.tipo === 'motor')!;
	const km = p.dispositivos.find((d) => d.tipo === 'contactor')!;

	const conAgua = simular(p, { [boya.id]: { activo: false } });
	assert.ok(!conAgua.activos.has(km.id), 'la bomba anda con el estanque lleno');

	const faltaAgua = simular(p, { [boya.id]: { activo: true } });
	assert.ok(faltaAgua.activos.has(km.id), 'la boya cerró y el contactor no metió');
	assert.ok(gira(faltaAgua, bomba.designacion!),
		`la bomba no arranca. Funcionando: ${faltaAgua.funcionando.map((f) => f.designacion).join(', ')}`);

	// Y al llenarse el estanque para, incluso arrastrando el estado anterior: sin enclavamiento
	// no hay nada que la sostenga.
	const otraVezLlena = simular(p, { [boya.id]: { activo: false } }, faltaAgua.activos);
	assert.ok(!otraVezLlena.activos.has(km.id), 'la bomba se quedó enganchada sin enclavamiento');
});

test('con el diferencial abierto la bomba no arranca aunque la boya pida agua', () => {
	const p = ejemplo('bomba-boya');
	const boya = p.dispositivos.find((d) => d.tipo === 'sensor')!;
	const dif = p.dispositivos.find((d) => d.tipo === 'diferencial')!;
	const bomba = p.dispositivos.find((d) => d.tipo === 'motor')!;
	const r = simular(p, { [boya.id]: { activo: true }, [dif.id]: { cerrado: false } });
	assert.ok(!gira(r, bomba.designacion!), 'la bomba arranca con el diferencial abierto');
});

/* --------------------------------- El piloto --------------------------------- */

test('una lámpara entre fase y retorno se enciende; entre dos fases, no', () => {
	const p = crearProyecto('t');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'H' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 220 V', campo: true,
			tensionNominal: 220, bornes: [{ id: 'L', tipo: 'L' }, { id: 'L2', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{ id: 'h', tipo: 'piloto', designacion: '-H1', bornes: [{ id: 'X1', tipo: 'control' }, { id: 'X2', tipo: 'control' }] },
	];
	const cable = (de: [string, string], a: [string, string], id: string): Conductor =>
		({ id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] } });

	p.conductores = [cable(['red', 'L'], ['h', 'X1'], 'c1'), cable(['red', 'N'], ['h', 'X2'], 'c2')];
	assert.ok(gira(simular(p), '-H1'), 'la lámpara no se enciende entre fase y neutro');

	// Las dos puntas a fase: hay tensión en ambas pero no hay diferencia, así que no enciende.
	p.conductores = [cable(['red', 'L'], ['h', 'X1'], 'c1'), cable(['red', 'L2'], ['h', 'X2'], 'c2')];
	assert.ok(!gira(simular(p), '-H1'), 'la lámpara enciende con las dos puntas en fase');
});

/* ----------------------- El sensor de tres hilos (la duda del compañero) ----------------------- */

test('un detector PNP no da señal en reposo y sí al detectar', () => {
	const p = crearProyecto('t');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'H' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 24 V', campo: true,
			tensionNominal: 24, bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{
			id: 's1', tipo: 'sensor', designacion: '-B1', campo: true,
			bornes: [{ id: '+24', tipo: 'control' }, { id: '0V', tipo: 'control' }, { id: 'OUT', tipo: 'senal' }],
		},
		{ id: 'h', tipo: 'piloto', designacion: '-H1', bornes: [{ id: 'X1', tipo: 'control' }, { id: 'X2', tipo: 'control' }] },
	];
	const cable = (de: [string, string], a: [string, string], id: string): Conductor =>
		({ id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] } });
	p.conductores = [
		cable(['red', 'L'], ['s1', '+24'], 'c1'),
		cable(['red', 'N'], ['s1', '0V'], 'c2'),
		cable(['s1', 'OUT'], ['h', 'X1'], 'c3'),
		cable(['red', 'N'], ['h', 'X2'], 'c4'),
	];
	assert.ok(!gira(simular(p), '-H1'), 'el detector da señal sin detectar nada');
	assert.ok(gira(simular(p, { s1: { activo: true } }), '-H1'),
		'el detector no entrega +24 V por su salida al detectar');
});

/* ============================ INTENSIDADES, FALTAS Y DISPAROS ============================
 *
 * Hasta aquí la simulación decía QUÉ funciona. Estas pruebas son de lo que dice ahora: CUÁNTO
 * consume, por dónde pasa esa corriente, y qué salta cuando algo está mal. Es la diferencia
 * entre ver una lámpara encendida y saber si el automático que la protege va sobrado.
 */

/** Tablero mínimo: red → protección → carga, para medir con todo a la vista. */
function tableroSimple(opciones: {
	calibre: number;
	consumo: number;
	curva?: 'B' | 'C' | 'D';
	corto?: boolean;
}): Proyecto {
	const p = crearProyecto('t');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'H' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 220 V', campo: true,
			tensionNominal: 220, bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1', corrienteNominal: opciones.calibre,
			curvaDisparo: opciones.curva ?? 'C',
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }, { id: '3', tipo: 'N' }, { id: '4', tipo: 'N' }],
		},
		{
			id: 'm1', tipo: 'motor', designacion: '-M1', campo: true, corrienteNominal: opciones.consumo,
			bornes: [{ id: 'U1', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
	];
	const cable = (de: [string, string], a: [string, string], id: string): Conductor =>
		({ id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] } });
	p.conductores = [
		cable(['red', 'L'], ['q1', '1'], 'c1'),
		cable(['red', 'N'], ['q1', '3'], 'c2'),
		cable(['q1', '2'], ['m1', 'U1'], 'c3'),
		cable(['q1', '4'], ['m1', 'N'], 'c4'),
	];
	// El corto: un puente de la salida de fase al neutro, sin carga por medio.
	if (opciones.corto) p.conductores.push(cable(['q1', '2'], ['q1', '4'], 'cx'));
	return p;
}

test('una carga en marcha declara la corriente que consume', () => {
	const r = simular(tableroSimple({ calibre: 10, consumo: 3.5 }));
	assert.equal(r.consumos.length, 1, 'no se ve ninguna carga consumiendo');
	assert.equal(r.consumos[0].corriente, 3.5);
	assert.equal(r.corrienteTotal, 3.5);
	assert.ok(r.funcionando[0].que.includes('3.5 A'), r.funcionando[0].que);
});

test('la corriente de la carga atraviesa la protección que tiene delante', () => {
	const r = simular(tableroSimple({ calibre: 10, consumo: 3.5 }));
	const q1 = r.cargaPorAparato.get('q1');
	assert.ok(q1, 'la protección no aparece en el reparto de corriente');
	assert.equal(q1!.corriente, 3.5, 'por el automático no pasa la corriente del motor');
	assert.equal(q1!.porcentaje, 35, 'un motor de 3,5 A en un automático de 10 A es el 35 %');
});

test('y también los cables de esa rama, uno por uno', () => {
	const r = simular(tableroSimple({ calibre: 10, consumo: 3.5 }));
	assert.equal(r.corrientePorConductor.get('c1'), 3.5, 'la acometida no lleva la corriente');
	assert.equal(r.corrientePorConductor.get('c3'), 3.5, 'el cable a la carga no lleva la corriente');
});

test('un automático holgado no dispara', () => {
	const r = simular(tableroSimple({ calibre: 10, consumo: 3.5 }));
	assert.equal(r.disparos.length, 0, r.disparos.map((d) => d.explicacion).join(' | '));
});

test('SOBRECARGA: con más corriente que calibre, la protección dispara', () => {
	const r = simular(tableroSimple({ calibre: 6, consumo: 9 }));
	const d = r.disparos.find((x) => x.dispositivoId === 'q1');
	assert.ok(d, 'un automático de 6 A con 9 A encima no dispara');
	assert.equal(d!.motivo, 'sobrecarga');
	assert.ok(d!.segundos > 0 && d!.segundos < 3600, `tiempo de disparo raro: ${d!.segundos} s`);
	assert.ok(r.avisos.some((a) => /sobrecarg/i.test(a)), r.avisos.join(' | '));
});

test('y a mayor exceso, antes dispara (es una curva, no un umbral)', () => {
	const poco = simular(tableroSimple({ calibre: 6, consumo: 8 })).disparos[0];
	const mucho = simular(tableroSimple({ calibre: 6, consumo: 20 })).disparos[0];
	assert.ok(poco.segundos > mucho.segundos,
		`con más corriente tendría que tardar menos: ${poco.segundos} s vs ${mucho.segundos} s`);
});

test('la curva importa: una D aguanta el arranque que a una B la haría saltar', () => {
	const b = tiempoDeDisparo(30, 6, 'B');   // 5·In: ya es magnético en curva B
	const d = tiempoDeDisparo(30, 6, 'D');   // 5·In: todavía es térmico en curva D
	assert.equal(b, 0.01, 'la curva B tiene que cortar al instante a 5 veces el calibre');
	assert.ok(d! > 0.01, 'la curva D no puede cortar al instante a 5 veces el calibre');
});

test('por debajo del calibre no dispara nunca, por mucho que se acerque', () => {
	assert.equal(tiempoDeDisparo(6, 6, 'C'), undefined);
	assert.equal(tiempoDeDisparo(6.5, 6, 'C'), undefined, '1,08·In no es disparo');
});

test('CORTOCIRCUITO: un puente fase-neutro se ve y dispara la protección de delante', () => {
	const r = simular(tableroSimple({ calibre: 10, consumo: 3.5, corto: true }));
	assert.equal(r.cortocircuitos.length, 1, 'no se detecta el cortocircuito');
	assert.ok(/retorno/i.test(r.cortocircuitos[0].que), r.cortocircuitos[0].que);
	assert.deepEqual(r.cortocircuitos[0].proteccionesAguasArriba, ['q1'],
		'no se identifica el automático que ve la falta');
	const d = r.disparos.find((x) => x.motivo === 'cortocircuito');
	assert.ok(d, 'el cortocircuito no dispara nada');
	assert.equal(d!.segundos, 0.01, 'un cortocircuito no se corta en segundos, se corta al instante');
	assert.ok(r.avisos[0].includes('CORTOCIRCUITO'), r.avisos.join(' | '));
});

test('un tablero bien cableado NO tiene cortocircuitos', () => {
	for (const id of ['arranque-directo', 'bomba-boya', 'control-24v', 'estrella-triangulo']) {
		const r = simular(ejemplo(id));
		assert.equal(r.cortocircuitos.length, 0,
			`el ejemplo «${id}» sale con un cortocircuito: ${r.cortocircuitos.map((c) => c.que).join(', ')}`);
	}
});

test('los ejemplos tampoco disparan sus protecciones al funcionar', () => {
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const r = simular(p, { [marcha.id]: { activo: true } });
    assert.ok(gira(r, '-M1'), 'el motor ni siquiera arranca');
	assert.equal(r.disparos.length, 0,
		`el arranque hace saltar algo: ${r.disparos.map((d) => d.explicacion).join(' | ')}`);
	assert.ok(r.corrienteTotal > 0, 'con el motor girando el tablero no consume nada');
});

/* ================================ TEMPORIZADORES ================================
 *
 * Un temporizador no es función del estado actual: depende de CUÁNDO cambió la cosa. Estas
 * pruebas mueven un reloj simulado, así que no dependen de esperas reales ni son lentas.
 */

/** Red 24 V → pulsador → bobina del relé temporizado → su contacto NA → piloto. */
function tableroTemporizado(tipo: 'trabajo' | 'reposo', segundos: number): Proyecto {
	const p = crearProyecto('t');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'H' }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida 24 V', campo: true,
			tensionNominal: 24, bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{
			id: 's1', tipo: 'pulsador', designacion: '-S1', descripcion: 'MARCHA',
			bornes: [{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' }],
		},
		{
			id: 'kt', tipo: 'rele', designacion: '-KT1', temporizacion: { tipo, segundos },
			bornes: [
				{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
				{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' },
			],
		},
		{ id: 'h', tipo: 'piloto', designacion: '-H1', bornes: [{ id: 'X1', tipo: 'control' }, { id: 'X2', tipo: 'control' }] },
	];
	const cable = (de: [string, string], a: [string, string], id: string): Conductor =>
		({ id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] } });
	p.conductores = [
		cable(['red', 'L'], ['s1', '13'], 'c1'),
		cable(['s1', '14'], ['kt', 'A1'], 'c2'),
		cable(['red', 'N'], ['kt', 'A2'], 'c3'),
		cable(['red', 'L'], ['kt', '13'], 'c4'),
		cable(['kt', '14'], ['h', 'X1'], 'c5'),
		cable(['red', 'N'], ['h', 'X2'], 'c6'),
	];
	return p;
}

test('TEMPORIZADO A LA CONEXIÓN: la bobina se mete ya, pero el contacto espera', () => {
	const p = tableroTemporizado('trabajo', 5);
	const memoria = memoriaVacia();
	const pulsado = { s1: { activo: true } };

	// t = 0: se pulsa. La bobina entra, pero el piloto todavía NO se enciende.
	let r = simular(p, pulsado, undefined, { ahora: 0, memoria });
	assert.ok(r.funcionando.some((f) => f.designacion === '-KT1' && /contando/.test(f.que)),
		`el relé no está contando: ${r.funcionando.map((f) => f.que).join(' | ')}`);
	assert.ok(!gira(r, '-H1'), 'el piloto se enciende antes de tiempo: el temporizador no temporiza');

	// t = 3 s: todavía no.
	r = simular(p, pulsado, r.activos, { ahora: 3000, memoria });
	assert.ok(!gira(r, '-H1'), 'a los 3 s de un temporizador de 5 s ya está encendido');
	const cuenta = r.temporizadores.find((t) => t.dispositivoId === 'kt');
	assert.ok(cuenta?.contando, 'no se ve la cuenta atrás');
	assert.ok(cuenta!.restan > 1 && cuenta!.restan <= 2.1, `quedan ${cuenta!.restan} s, esperaba ~2`);

	// t = 6 s: ya pasó el tiempo, el piloto enciende.
	r = simular(p, pulsado, r.activos, { ahora: 6000, memoria });
	assert.ok(gira(r, '-H1'), 'pasados los 5 s el contacto sigue sin cerrar');
});

test('TEMPORIZADO A LA DESCONEXIÓN: conmuta al instante y suelta tarde', () => {
	const p = tableroTemporizado('reposo', 4);
	const memoria = memoriaVacia();

	// Pulsado: conmuta en el acto, sin esperar.
	let r = simular(p, { s1: { activo: true } }, undefined, { ahora: 0, memoria });
	assert.ok(gira(r, '-H1'), 'un temporizado a la desconexión tiene que actuar al instante');

	// Se suelta el pulsador: aguanta.
	r = simular(p, {}, r.activos, { ahora: 1000, memoria });
	assert.ok(gira(r, '-H1'), 'al soltar debería aguantar sus 4 s, y se ha soltado ya');

	// Pasados los 4 s, suelta.
	r = simular(p, {}, r.activos, { ahora: 6000, memoria });
	assert.ok(!gira(r, '-H1'), 'pasados los 4 s sigue enganchado: no suelta nunca');
});

test('sin reloj, un temporizado se comporta como instantáneo (para responder «¿esto funciona?»)', () => {
	const p = tableroTemporizado('trabajo', 30);
	const r = simular(p, { s1: { activo: true } });
	assert.ok(gira(r, '-H1'), 'sin reloj no se puede comprobar un circuito con temporizadores');
});

test('un relé sin temporización sigue conmutando al instante', () => {
	const p = tableroTemporizado('trabajo', 0);
	const r = simular(p, { s1: { activo: true } }, undefined, { ahora: 0, memoria: memoriaVacia() });
	assert.ok(gira(r, '-H1'), 'un relé normal se ha vuelto lento');
});

test('un motor TRIFÁSICO carga cada polo con su corriente, no con la suma de las tres', () => {
	// El fallo que tenía: sumar las tres fases daba el triple y hacía «disparar» aparatos que van
	// sobrados. Un guardamotor se elige por la corriente POR FASE, que es la que ve cada polo.
	const p = ejemplo('arranque-directo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const r = simular(p, { [marcha.id]: { activo: true } });
	const motor = p.dispositivos.find((d) => d.tipo === 'motor')!;
	const q1 = r.cargaPorAparato.get('q1');
	assert.ok(q1, 'el guardamotor no aparece en el reparto');
	assert.equal(q1!.corriente, motor.corrienteNominal,
		`por el guardamotor pasa ${q1!.corriente} A y el motor consume ${motor.corrienteNominal} A por fase`);
	assert.equal(r.corrienteTotal, motor.corrienteNominal);
	assert.equal(q1!.porcentaje, 85, 'un motor de 3,4 A en un guardamotor regulado a 4 A es el 85 %');
});

test('los ejemplos declaran el calibre de sus protecciones (si no, no se puede verificar nada)', () => {
	// Un contactor, un relé o una borna dejan pasar la corriente pero no la limitan: no tienen
	// calibre que comprobar. Lo que sí ha de estar declarado es el de todo lo que protege.
	const PROTEGE = new Set(['disyuntor', 'diferencial', 'guardamotor', 'fusible']);
	for (const id of ['arranque-directo', 'bomba-boya', 'control-24v', 'estrella-triangulo']) {
		const p = ejemplo(id);
		const r = simular(p);
		for (const c of r.cargaPorAparato.values()) {
			const d = p.dispositivos.find((x) => x.id === c.dispositivoId)!;
			if (!PROTEGE.has(d.tipo)) continue;
			assert.ok(c.nominal !== undefined,
				`en «${id}», ${c.designacion} (${d.tipo}) no declara calibre ni rango de regulación`);
		}
	}
});

test('los consumos de los ejemplos declaran lo que gastan (si no, la carga sale a cero)', () => {
	// Sin corriente de empleo declarada la barra de carga miente: dice 0 % en un circuito lleno.
	// Los sensores quedan fuera a propósito: un «sensor» puede ser un detector alimentado o un
	// contacto seco —una boya de nivel— que no consume nada.
	const CONSUME = new Set(['motor', 'piloto', 'valvula', 'resistencia', 'plc']);
	for (const id of ['arranque-directo', 'bomba-boya', 'control-24v', 'estrella-triangulo']) {
		const p = ejemplo(id);
		for (const d of p.dispositivos) {
			if (!CONSUME.has(d.tipo)) continue;
			assert.ok(d.corrienteNominal !== undefined && d.corrienteNominal > 0,
				`en «${id}», ${d.descripcion ?? d.id} (${d.tipo}) no declara corriente de empleo`);
		}
	}
});

/* ---------------- La maniobra completa: el ejemplo estrella-triángulo ---------------- */

/**
 * Esta es la prueba que de verdad justifica los temporizadores: no un circuito de laboratorio,
 * sino el tablero de ejemplo entero, con sus bloqueos, su autorretención y su térmico, corriendo
 * contra un reloj. Si el relevo estrella→triángulo no ocurre solo, aquí se ve.
 */
const activo = (r: ReturnType<typeof simular>, id: string) => r.activos.has(id);

test('ESTRELLA-TRIÁNGULO: el relevo ocurre solo al cumplirse el tiempo', () => {
	const p = ejemplo('estrella-triangulo');
	const memoria = memoriaVacia();
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;

	// t = 0, sin tocar nada: todo parado.
	let r = simular(p, {}, undefined, { ahora: 0, memoria });
	assert.ok(!activo(r, 'km1'), 'el contactor de línea entra sin apretar marcha');
	assert.ok(!gira(r, '-M1'), 'el motor gira sin apretar marcha');

	// t = 0, apretando MARCHA: línea + ESTRELLA, y el triángulo fuera.
	const pulsado = { [marcha.id]: { activo: true } };
	r = simular(p, pulsado, r.activos, { ahora: 0, memoria });
	assert.ok(activo(r, 'km1'), 'no entra el contactor de línea');
	assert.ok(activo(r, 'km2'), 'no entra la estrella: el motor arrancaría directo');
	assert.ok(!activo(r, 'km3'), 'entra el triángulo desde el arranque: no hay arranque suave');
	assert.ok(gira(r, '-M1'), 'el motor no arranca con las tres fases puestas');

	// t = 3 s: sigue en estrella y se ve la cuenta atrás.
	r = simular(p, pulsado, r.activos, { ahora: 3000, memoria });
	assert.ok(activo(r, 'km2') && !activo(r, 'km3'), 'a los 3 s de 6 ya ha pasado a triángulo');
	const cuenta = r.temporizadores.find((t) => t.dispositivoId === 'kt');
	assert.ok(cuenta?.contando && cuenta.restan > 2 && cuenta.restan <= 3.1,
		`la cuenta atrás marca ${cuenta?.restan} s, esperaba ~3`);

	// t = 7 s: TRIÁNGULO. La estrella tiene que haberse caído: las dos juntas son un cortocircuito.
	r = simular(p, pulsado, r.activos, { ahora: 7000, memoria });
	assert.ok(activo(r, 'km3'), 'pasados los 6 s no entra el triángulo');
	assert.ok(!activo(r, 'km2'), 'la estrella sigue metida con el triángulo: cortocircuito entre fases');
	assert.ok(activo(r, 'km1'), 'se ha caído la línea al pasar a triángulo');
	assert.ok(gira(r, '-M1'), 'el motor se ha parado en el cambio');

	// Se suelta el pulsador: la autorretención de KM1 mantiene el motor en marcha.
	r = simular(p, {}, r.activos, { ahora: 8000, memoria });
	assert.ok(activo(r, 'km1') && activo(r, 'km3') && gira(r, '-M1'),
		'sin autorretención el motor se para al soltar el botón');
});

test('ESTRELLA-TRIÁNGULO: el paro tira todo y el temporizador vuelve a cero', () => {
	const p = ejemplo('estrella-triangulo');
	const memoria = memoriaVacia();
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const paro = p.dispositivos.find((d) => /PARO/i.test(d.descripcion ?? ''))!;

	let r = simular(p, { [marcha.id]: { activo: true } }, undefined, { ahora: 0, memoria });
	r = simular(p, {}, r.activos, { ahora: 7000, memoria });
	assert.ok(activo(r, 'km3'), 'no llegó a triángulo');

	// PARO es NC: activarlo lo ABRE y corta el mando entero.
	r = simular(p, { [paro.id]: { activo: true } }, r.activos, { ahora: 7100, memoria });
	assert.ok(!activo(r, 'km1') && !activo(r, 'km3'), 'el paro no corta el mando');
	assert.ok(!gira(r, '-M1'), 'el motor sigue girando después del paro');

	// Y al volver a arrancar, otra vez empieza en estrella: el temporizador se ha reiniciado.
	r = simular(p, { [marcha.id]: { activo: true } }, r.activos, { ahora: 8000, memoria });
	assert.ok(activo(r, 'km2') && !activo(r, 'km3'),
		'al rearrancar entra directo en triángulo: el temporizador no se reinició');
});

test('ESTRELLA-TRIÁNGULO: por el térmico pasa la corriente del motor, no el triple', () => {
	const p = ejemplo('estrella-triangulo');
	const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
	const r = simular(p, { [marcha.id]: { activo: true } });
	const f2 = r.cargaPorAparato.get('f2');
	assert.ok(f2, 'el relé térmico no aparece en el reparto de corrientes');
	assert.equal(f2!.corriente, 8.5, `por el térmico pasan ${f2!.corriente} A y el motor consume 8,5 A`);
	assert.equal(r.corrienteTotal, 8.5);
	const q1 = r.cargaPorAparato.get('q1');
	assert.equal(q1!.porcentaje, 53, 'un motor de 8,5 A en un automático de 16 A es el 53 %');
});

/* ================== TENSIÓN EQUIVOCADA Y PUNTA DE ARRANQUE ================== */

/** Acometida (mono o trifásica) → automático → una carga. */
function tableroCarga(opciones: {
	tensionRed: number; trifasica?: boolean; carga: Partial<Dispositivo>; calibre?: number;
	curva?: 'B' | 'C' | 'D' | 'gG';
}): Proyecto {
	const p = crearProyecto('t');
	const fases = opciones.trifasica
		? [{ id: 'L1', tipo: 'L' as const }, { id: 'L2', tipo: 'L' as const }, { id: 'L3', tipo: 'L' as const }]
		: [{ id: 'L1', tipo: 'L' as const }];
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', descripcion: 'Acometida', campo: true,
			tensionNominal: opciones.tensionRed,
			bornes: [...fases, { id: 'N', tipo: 'N' }],
		},
		{
			id: 'q1', tipo: 'disyuntor', designacion: '-Q1',
			corrienteNominal: opciones.calibre ?? 16, curvaDisparo: opciones.curva ?? 'C',
			bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
		},
		{ id: 'm1', designacion: '-M1', tipo: 'piloto', bornes: [], ...opciones.carga } as Dispositivo,
	];
	const cab = (de: [string, string], a: [string, string], id: string): Conductor =>
		({ id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] } });
	p.conductores = [cab(['red', 'L1'], ['q1', '1'], 'c1'), cab(['q1', '2'], ['m1', 'A'], 'c2')];
	if (opciones.trifasica && (opciones.carga.bornes ?? []).some((b) => b.id === 'C')) {
		p.conductores.push(cab(['red', 'L2'], ['m1', 'B'], 'c3'), cab(['red', 'L3'], ['m1', 'C'], 'c4'));
	} else {
		p.conductores.push(cab(['red', 'N'], ['m1', 'B'], 'c3'));
	}
	return p;
}

const dosBornes = [{ id: 'A', tipo: 'L' as const }, { id: 'B', tipo: 'N' as const }];
const tresBornes = [{ id: 'A', tipo: 'L' as const }, { id: 'B', tipo: 'L' as const }, { id: 'C', tipo: 'L' as const }];

test('un piloto de 24 V colgado del circuito de 220 se avisa: en el tablero se quema', () => {
	const p = tableroCarga({ tensionRed: 220, carga: { tensionNominal: 24, corrienteNominal: 0.02, bornes: dosBornes } });
	const r = simular(p);
	assert.equal(r.tensionesEquivocadas.length, 1, 'no se ha detectado la tensión equivocada');
	assert.equal(r.tensionesEquivocadas[0].recibe, 220);
	assert.equal(r.tensionesEquivocadas[0].suya, 24);
	assert.match(r.tensionesEquivocadas[0].que, /quema/);
	assert.ok(r.avisos.some((a) => /24 V/.test(a)), r.avisos.join(' | '));
});

test('y una carga de 220 en su circuito de 220 NO se avisa', () => {
	const p = tableroCarga({ tensionRed: 220, carga: { tensionNominal: 220, corrienteNominal: 0.5, bornes: dosBornes } });
	assert.deepEqual(simular(p).tensionesEquivocadas, []);
});

test('220 y 230 son la misma red: no se avisa por el redondeo del catálogo', () => {
	const p = tableroCarga({ tensionRed: 230, carga: { tensionNominal: 220, corrienteNominal: 0.5, bornes: dosBornes } });
	assert.deepEqual(simular(p).tensionesEquivocadas, []);
});

test('EL CASO QUE NO PUEDE FALLAR: mando de 220 V en un tablero trifásico de 380 está BIEN', () => {
	// Entre una fase y el neutro de una red de 380 hay 220. Avisar aquí mandaría a alguien a
	// revisar un cableado impecable, que es peor que no avisar.
	const p = tableroCarga({ tensionRed: 380, trifasica: true, carga: { tensionNominal: 220, corrienteNominal: 0.5, bornes: dosBornes } });
	assert.deepEqual(simular(p).tensionesEquivocadas, [], 'falso positivo en el mando de 220 V');
});

test('y un motor de 380 entre las tres fases también está bien', () => {
	const p = tableroCarga({ tensionRed: 380, trifasica: true, carga: { tipo: 'motor', tensionNominal: 380, corrienteNominal: 3, polos: 3, bornes: tresBornes } });
	const r = simular(p);
	assert.deepEqual(r.tensionesEquivocadas, []);
	assert.ok(r.funcionando.some((f) => f.designacion === '-M1'), 'el motor no gira');
});

test('pero un motor de 220 entre las tres fases de 380 sí se avisa', () => {
	const p = tableroCarga({ tensionRed: 380, trifasica: true, carga: { tipo: 'motor', tensionNominal: 220, corrienteNominal: 3, polos: 3, bornes: tresBornes } });
	const r = simular(p);
	assert.equal(r.tensionesEquivocadas.length, 1, 'un motor de 220 a 380 pasa desapercibido');
	assert.equal(r.tensionesEquivocadas[0].recibe, 380);
});

test('PUNTA DE ARRANQUE: un motor pide seis veces su nominal al arrancar en directo', () => {
	const p = tableroCarga({ tensionRed: 220, calibre: 16, carga: { tipo: 'motor', tensionNominal: 220, corrienteNominal: 5, bornes: dosBornes } });
	const r = simular(p);
	const a = r.arranques.find((x) => x.designacion === '-M1');
	assert.ok(a, 'no se calcula la punta de arranque');
	assert.equal(a!.nominal, 5);
	assert.equal(a!.punta, 30, '5 A × 6 = 30 A');
	assert.ok(a!.protecciones.some((x) => x.designacion === '-Q1'), 'no ve la protección de delante');
});

test('un automático de curva B salta en el arranque de un motor, y se dice', () => {
	// El caso de libro: una curva B es para alumbrado y tomas, y salta con el magnético a 5 veces
	// el calibre. 5 A × 6 = 30 A por un B10 son 3 veces… pero por un B4 son 7,5: magnético, y el
	// motor no llega a arrancar. Es el fallo que hace volver al tablero una y otra vez.
	const p = tableroCarga({ tensionRed: 220, calibre: 4, curva: 'B', carga: { tipo: 'motor', tensionNominal: 220, corrienteNominal: 5, bornes: dosBornes } });
	const r = simular(p);
	const a = r.arranques[0];
	assert.ok(a.saltaAlArrancar, `no avisa: ${JSON.stringify(a.protecciones)}`);
	assert.ok(r.avisos.some((x) => /arrancando EN DIRECTO/.test(x)), r.avisos.join(' | '));
});

test('y uno bien elegido no salta: el motor arranca', () => {
	const p = tableroCarga({ tensionRed: 220, calibre: 16, curva: 'C', carga: { tipo: 'motor', tensionNominal: 220, corrienteNominal: 5, bornes: dosBornes } });
	const r = simular(p);
	assert.equal(r.arranques[0].saltaAlArrancar, false);
	assert.ok(!r.avisos.some((x) => /arrancando EN DIRECTO/.test(x)), r.avisos.join(' | '));
});

test('una punta por debajo del magnético NO se toma por un fallo de arranque', () => {
	// 30 A por un C4 son 7,5 veces: mucho, pero por debajo del magnético (10×). El motor arranca
	// —tarda 13 s en disparar por térmico— y decir «no arrancaría» sería falso. Que ese automático
	// esté mal elegido para 5 A continuos es otro asunto, y lo canta el disparo por sobrecarga.
	const p = tableroCarga({ tensionRed: 220, calibre: 4, curva: 'C', carga: { tipo: 'motor', tensionNominal: 220, corrienteNominal: 5, bornes: dosBornes } });
	const r = simular(p);
	assert.equal(r.arranques[0].saltaAlArrancar, false, 'confunde arrancar con ir sobrecargado');
	assert.ok(r.disparos.some((d) => d.motivo === 'sobrecarga'),
		'y sin embargo va sobrecargado: eso sí hay que decirlo');
});

test('los ejemplos del programa arrancan sin que salte nada', () => {
	// Si un ejemplo no arrancara, estaría enseñando a montar un tablero que no funciona.
	for (const id of ['arranque-directo', 'estrella-triangulo']) {
		const p = ejemplo(id);
		const marcha = p.dispositivos.find((d) => /MARCHA/i.test(d.descripcion ?? ''))!;
		const r = simular(p, { [marcha.id]: { activo: true } });
		assert.ok(r.arranques.length > 0, `en «${id}» no se ve ningún arranque`);
		for (const a of r.arranques) {
			assert.equal(a.saltaAlArrancar, false,
				`en «${id}», ${a.designacion} no arrancaría: ${JSON.stringify(a.protecciones)}`);
		}
		assert.deepEqual(r.tensionesEquivocadas, [], `«${id}» tiene una carga a la tensión que no es`);
	}
});

test('EL SECUNDARIO DEL TRANSFORMADOR no es siempre 24 V', () => {
	// Era: `d.tensionNominal === 220 ? 24 : 24`, que da 24 mire por donde se mire. Un
	// transformador de mando de 380/110 se simulaba como si sacara 24.
	assert.equal(tensionSecundariaDe({ id: 't', tipo: 'transformador', bornes: [], descripcion: 'Transformador 380/110 V' }), 110);
	assert.equal(tensionSecundariaDe({ id: 't', tipo: 'transformador', bornes: [], descripcion: 'Transformador 220/24 V 3 A' }), 24);
	assert.equal(tensionSecundariaDe({ id: 't', tipo: 'transformador', bornes: [], tensionSecundariaV: 48 }), 48,
		'el dato declarado manda sobre la descripción');
	assert.equal(tensionSecundariaDe({ id: 't', tipo: 'fuente', bornes: [] }), 24, 'sin nada, lo más común');
});
