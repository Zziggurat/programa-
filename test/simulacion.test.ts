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
import { Conductor, Proyecto } from '../src/modelo/tipos.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import { contactosAuxiliaresIEC, simular } from '../src/motores/simulacion.js';

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
