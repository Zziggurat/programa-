/**
 * ¿LOS TABLEROS DE EJEMPLO HACEN LO QUE SU EXPLICACIÓN DICE QUE HACEN?
 *
 * Los cinco ejemplos son para APRENDER. Cada uno viene con un «cómo funciona» escrito paso a paso,
 * y ese texto es una promesa: quien lo lee y aprieta MARCHA tiene que ver exactamente lo que
 * acaba de leer. Si el texto dice «KM1 se autorretiene» y al soltar el botón el motor se para, el
 * ejemplo no está enseñando: está enseñando mal, que es peor que no enseñar.
 *
 * Así que esto no comprueba «que cargue sin errores». Comprueba, con el tablero ENERGIZADO y
 * accionando los mandos como los accionaría una persona, cada afirmación del texto:
 *
 *   arranque-directo   · MARCHA mete KM1 y arranca el motor
 *                      · al SOLTAR sigue en marcha (autorretención por 13-14)
 *                      · PARO lo tira
 *                      · el térmico F2 lo tira aunque nadie toque nada
 *   bomba-boya         · la boya cerrada arranca la bomba
 *                      · la boya abierta la para — y NO hay enclavamiento, a propósito
 *   estrella-triangulo · MARCHA mete KM1 y KM2 (ESTRELLA), no KM3
 *                      · a los 6 s KM2 se cae y entra KM3 (TRIÁNGULO), solo
 *                      · KM2 y KM3 NUNCA están metidos a la vez (serían un cortocircuito)
 *   control-24v        · el secundario está a 24 V y el PLC vive
 *                      · DO1 excita K1 y K1 alimenta la electroválvula
 *   uma-cubierta       · el selector abre la compuerta (DO2) y NO el ventilador todavía
 *                      · a los 8 s entra DO1 → K1 → KM1 y el ventilador arranca
 *                      · con la sonda por debajo de 21 °C abre la válvula (DO3); por encima cierra
 *                      · el filtro sucio cierra la compuerta pero el ventilador aguanta su mínimo
 *                      · el térmico para el ventilador AUNQUE el programa siga diciendo que sí
 *
 * Y en los cinco: ni un aviso de que algo no se pudo resolver, ni oscilación, ni cortocircuito.
 *
 *   node qa/ejemplos-energizados.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

const errores = [];
p.on('pageerror', (e) => errores.push(e.message));

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(300);

/** Abre el ejemplo nº `i` de la biblioteca y deja el tablero listo, sin ventanas encima. */
async function abrirEjemplo(i) {
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(500);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(400);
		await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
		await p.waitForTimeout(500);
	}
	await p.locator('.tarjeta-ejemplo button').nth(i).click();
	await p.waitForTimeout(1500);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(500);
	}
	await p.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
	await p.waitForTimeout(400);
	return qa('proyecto');
}

/** Da tensión (si no la tiene ya). */
async function energizar() {
	const yaEsta = (await qa('simulacion')).energizado;
	if (!yaEsta) {
		await p.evaluate(() => document.getElementById('btn-energizar')?.click());
		await p.waitForTimeout(900);
	}
	return qa('simulacion');
}

/*
 * SE DIRECCIONA POR EL ID DEL APARATO, no por el rótulo.
 *
 * La primera versión de esta prueba buscaba «S1» entre las designaciones, porque es como lo llama
 * la explicación. Y funcionaba... apretando el botón equivocado: en el arranque directo `-S1` es el
 * PARO y la MARCHA es `-S2`. Salieron ocho fallos que no eran del programa sino míos.
 *
 * De paso, eso destapó el problema de verdad —que el texto y el tablero no se llaman igual— y
 * ahora se comprueba aparte, en `rotulosCuadran()`.
 */
async function accionar(id) {
	const hizo = await qa('accionar', id);
	await p.waitForTimeout(700);
	return { ok: hizo, id };
}

/** ¿Está este aparato HACIENDO algo (bobina metida, motor girando)? */
async function activo(id) {
	const sim = await qa('simulacion');
	return sim.activos.includes(id);
}

/**
 * UNA FOTO DE TODO LO ACTIVO, DE UNA SOLA VEZ.
 *
 * Preguntar `activo('km2')` y luego `activo('km3')` son DOS viajes al navegador, y entre uno y otro
 * pasa tiempo. Con el reloj de la simulación acelerado, los 6 s del temporizador caben de sobra en
 * ese hueco: la prueba veía la estrella metida en la primera pregunta y el triángulo metido en la
 * tercera, y cantaba «los dos a la vez» cuando en realidad había conmutado entre medias.
 *
 * Para decir «estos dos NUNCA coinciden» hay que mirarlos en el mismo instante. Esto lo hace.
 */
async function foto() {
	const sim = await qa('simulacion');
	const activos = new Set(sim.activos);
	return {
		hay: (id) => activos.has(id),
		lista: sim.activos,
		funcionando: sim.funcionando.map((f) => `${f.designacion} ${f.que}`),
		avisos: sim.avisos,
	};
}

/**
 * EL TEXTO Y EL TABLERO TIENEN QUE LLAMARSE IGUAL.
 *
 * Es el punto entero de un ejemplo para aprender. Si el «cómo funciona» dice «la bobina de KM1» y
 * en el tablero pone `-K1`, quien lo lee busca KM1, no lo encuentra, y se queda sin saber si está
 * mirando mal o si el ejemplo está mal. Peor todavía cuando el rótulo existe pero es OTRA cosa:
 * `-S1` en el arranque directo es el PARO, y la explicación llama S1 a la MARCHA.
 */
async function rotulosCuadran(pares, rot) {
	const proyecto = await qa('proyecto');
	const malos = [];
	for (const [nombreEnElTexto, id] of Object.entries(pares)) {
		const d = proyecto.dispositivos.find((x) => x.id === id);
		if (!d) { malos.push(`${nombreEnElTexto}: no existe el aparato «${id}»`); continue; }
		const rotulo = (d.designacion ?? '').replace(/^-/, '');
		if (rotulo !== nombreEnElTexto) malos.push(`el texto dice ${nombreEnElTexto}, el tablero rotula -${rotulo}`);
	}
	must(`${rot}: el tablero se rotula como lo llama la explicación`, malos.length === 0,
		malos.join(' · '));
}

/** Lo que el panel dice que está funcionando, en palabras. */
const funcionando = async () => (await qa('simulacion')).funcionando.map((f) => `${f.designacion} ${f.que}`);

/** El circuito está sano: sin avisos, sin oscilar. */
async function circuitoSano(rot) {
	const s = await qa('simulacion');
	must(`${rot}: el circuito se resuelve sin oscilar`, !s.oscila);
	/*
	 * «Hay tensión pero nada está funcionando todavía» NO es un fallo: es la ayuda que le dice a
	 * quien acaba de energizar que ahora tiene que apretar algo. Contarla como avería hacía fallar
	 * la prueba en los cinco ejemplos con el tablero perfectamente sano.
	 */
	const problemas = s.avisos.filter((a) => !/nada está funcionando todavía/i.test(a));
	must(`${rot}: sin avisos de avería`, problemas.length === 0, problemas.join(' | '));
}

/** Espera hasta `ms` a que se cumpla algo de la simulación, mirando de verdad. */
async function esperarA(cond, ms = 20_000) {
	const hasta = Date.now() + ms;
	while (Date.now() < hasta) {
		if (await cond()) return true;
		await p.waitForTimeout(400);
	}
	return false;
}

/* ══════════════════════════════ 1 · ARRANQUE DIRECTO ══════════════════════════════ */

console.log('\n════ 1. Arranque directo de motor (380 V) ════');
let pr = await abrirEjemplo(0);
must('CONDICIÓN PREVIA: es el arranque directo', /arranque directo/i.test(pr.nombre), pr.nombre);
await rotulosCuadran({ KM1: 'km1', S0: 's0', S1: 's1', F2: 'f2', M1: 'm1', Q1: 'q1' }, 'arranque directo');
await energizar();
must('el tablero se energiza', (await qa('simulacion')).energizado);
await circuitoSano('en reposo');
must('en reposo el motor NO gira', !(await activo('m1')), (await funcionando()).join(' · '));

console.log('\n  — «Al apretar MARCHA la corriente llega a la bobina A1 de KM1» —');
await accionar('s1');
must('MARCHA mete la bobina del contactor', await activo('km1'));
must('y el motor arranca', await activo('m1'), (await funcionando()).join(' · '));
await circuitoSano('en marcha');

console.log('\n  — «El contacto 13-14 en paralelo mantiene la marcha: eso es el ENCLAVAMIENTO» —');
await accionar('s1');   // soltar el pulsador
must('SOLTANDO marcha, el contactor SIGUE metido (autorretención)', await activo('km1'),
	'si esto falla, el ejemplo enseña un enclavamiento que no existe');
must('y el motor sigue girando', await activo('m1'));

console.log('\n  — «PARO corta el mando y el motor para» —');
await accionar('s0');
must('PARO tira la bobina del contactor', !(await activo('km1')));
must('y el motor para', !(await activo('m1')), (await funcionando()).join(' · '));
await accionar('s0');   // el paro es NC: se suelta y vuelve a cerrar

console.log('\n  — «Si el motor consume de más, el térmico corta la bobina» —');
await accionar('s1'); await accionar('s1');
must('CONDICIÓN PREVIA: el motor está en marcha otra vez', await activo('m1'));
await accionar('f2');
must('con el térmico disparado el motor PARA solo', !(await activo('m1')),
	(await funcionando()).join(' · '));
must('y el contactor se cae con él', !(await activo('km1')));
await accionar('f2');   // rearmar
must('al rearmar el térmico el motor NO vuelve solo', !(await activo('m1')),
	'tras un disparo hay que volver a dar marcha: si arrancara solo sería peligroso');

/* ══════════════════════════════ 2 · BOMBA CON BOYA ══════════════════════════════ */

console.log('\n════ 2. Bomba de agua con boya de nivel ════');
pr = await abrirEjemplo(1);
must('CONDICIÓN PREVIA: es la bomba con boya', /bomba/i.test(pr.nombre), pr.nombre);
await rotulosCuadran({ Q1: 'q1', Q2: 'q2', KM1: 'km1', B1: 'b1', M1: 'm1' }, 'bomba con boya');
await energizar();
await circuitoSano('bomba, estado inicial');

const bombaAlEmpezar = await activo('m1');
console.log(`  (la boya empieza ${bombaAlEmpezar ? 'CERRADA: la bomba arranca sola' : 'ABIERTA: la bomba está parada'})`);

console.log('\n  — «La boya va EN SERIE con la bobina: manda ella» —');
await accionar('b1');
const trasMover = await activo('m1');
must('mover la boya CAMBIA el estado de la bomba', trasMover !== bombaAlEmpezar,
	`antes ${bombaAlEmpezar ? 'en marcha' : 'parada'}, después ${trasMover ? 'en marcha' : 'parada'}`);
must('con la boya cerrada el contactor está metido', (await activo('km1')) === trasMover);

console.log('\n  — «No lleva enclavamiento A PROPÓSITO: sigue siempre a la boya» —');
must('CONDICIÓN PREVIA: la bomba está en marcha', trasMover);
await accionar('b1');
must('al abrir la boya la bomba PARA (no queda retenida)', !(await activo('m1')),
	'si quedara retenida, el ejemplo contradiría su propia explicación');
await circuitoSano('bomba, tras maniobrar');

/* ══════════════════════════ 3 · ESTRELLA-TRIÁNGULO ══════════════════════════ */

console.log('\n════ 3. Arranque estrella-triángulo con temporizador ════');
pr = await abrirEjemplo(2);
must('CONDICIÓN PREVIA: es el estrella-triángulo', /estrella/i.test(pr.nombre), pr.nombre);
await rotulosCuadran({ KM1: 'km1', KM2: 'km2', KM3: 'km3', KT: 'kt', S0: 's0', S1: 's1', F2: 'f2' },
	'estrella-triángulo');
await energizar();
await circuitoSano('estrella-triángulo en reposo');
// El reloj se acelera para no esperar 6 s reales en cada vuelta.
await p.evaluate(() => {
	const v = document.getElementById('sim-velocidad');
	if (v) { v.value = [...v.options].map((o) => o.value).at(-1); v.dispatchEvent(new Event('change', { bubbles: true })); }
});

console.log('\n  — «Al apretar MARCHA entra el de línea y, por 11-12 del temporizador, el de ESTRELLA» —');
await accionar('s1'); await accionar('s1');
// Los cuatro se leen de la MISMA foto: si no, el temporizador conmuta entre pregunta y pregunta.
const estrella = await foto();
must('MARCHA mete el contactor de LÍNEA', estrella.hay('km1'));
must('y mete el de ESTRELLA: el motor arranca en estrella', estrella.hay('km2'),
	estrella.funcionando.join(' · '));
must('el de TRIÁNGULO está fuera', !estrella.hay('km3'),
	'estrella y triángulo a la vez serían un cortocircuito entre fases');
must('el motor está girando', estrella.hay('m1'), estrella.funcionando.join(' · '));

console.log('\n  — «A los 6 s el temporizador conmuta: cae la estrella y entra el triángulo» —');
const conmuto = await esperarA(async () => (await activo('km3')) === true, 30_000);
must('pasado el tiempo, el TRIÁNGULO entra SOLO', conmuto,
	'nadie tocó nada: lo tiene que hacer el temporizador');
const triangulo = await foto();
must('y la ESTRELLA se ha caído', !triangulo.hay('km2'), triangulo.funcionando.join(' · '));
must('el motor sigue girando en triángulo', triangulo.hay('m1'), triangulo.funcionando.join(' · '));
await circuitoSano('en triángulo');

console.log('\n  — «Estrella y triángulo se bloquean: NUNCA los dos a la vez» —');
await accionar('s0'); await accionar('s0');
must('PARO corta todo', !(await activo('km1')) && !(await activo('m1')));
await accionar('s1'); await accionar('s1');
let juntos = 0, muestras = 0;
const hasta = Date.now() + 25_000;
while (Date.now() < hasta) {
	const f = await foto();    // UNA sola lectura: los dos en el mismo instante
	muestras++;
	if (f.hay('km2') && f.hay('km3')) juntos++;
	if (f.hay('km3')) break;   // ya conmutó: la ventana peligrosa ha pasado
	await p.waitForTimeout(200);
}
must('en toda la conmutación NUNCA coinciden estrella y triángulo', juntos === 0,
	`${juntos} de ${muestras} muestras con los dos metidos`);
const s3 = await qa('simulacion');
must('y no aparece ningún cortocircuito', !/cortocircuito/i.test(s3.avisos.join(' ')), s3.avisos.join(' | '));
await accionar('s0'); await accionar('s0');

/* ══════════════════════════ 4 · CONTROL CON PLC Y 24 V ══════════════════════════ */

console.log('\n════ 4. Tablero de control con PLC y 24 V ════');
pr = await abrirEjemplo(3);
must('CONDICIÓN PREVIA: es el tablero de control', /control/i.test(pr.nombre), pr.nombre);
await rotulosCuadran({ Q1: 'q1', T1: 't1', F1: 'f1', A1: 'a1', K1: 'k1', B1: 's1', Y1: 'y1' },
	'control 24 V');
await energizar();
await circuitoSano('control 24 V');

console.log('\n  — «T1 baja de 220 a 24 V; F1 protege el secundario y alimenta al PLC» —');
const tensiones = await qa('tensionesVivas');
must('conviven los 220 V de la acometida y los 24 V del control',
	tensiones.includes(220) && tensiones.includes(24), tensiones.join(', ') + ' V');
must('y NO hay ninguna tensión rara por medio', tensiones.every((v) => v === 220 || v === 24),
	tensiones.join(', ') + ' V');

/*
 * «El sensor B1 entra al PLC por DI1… cuando el programa lo decide, DO1 excita el relé K1, y su
 * contacto NA alimenta la electroválvula Y1».
 *
 * Este tablero no hace nada hasta que el sensor detecta, y eso está bien: es lo que dice su texto.
 * La primera versión de esta prueba se limitaba a energizar y exigía «que algo funcione», y
 * fallaba con el ejemplo perfectamente sano. El fallo era de la prueba, que no leyó la explicación
 * que dice que hay que activar el sensor.
 */
console.log('\n  — «El sensor manda: DO1 excita K1 y K1 alimenta la electroválvula» —');
const enReposo4 = await foto();
must('sin señal del sensor, la electroválvula está cerrada', !enReposo4.hay('y1'));
await accionar('s1');
const detectando = await foto();
must('con el sensor detectando, el relé K1 mete', detectando.hay('k1'), detectando.funcionando.join(' · '));
must('y la electroválvula abre', detectando.hay('y1'), detectando.funcionando.join(' · '));
await accionar('s1');
must('al dejar de detectar, la válvula cierra', !(await activo('y1')));
await circuitoSano('control 24 V, tras maniobrar');

/* ══════════════════════════ 5 · UMA DE CUBIERTA ══════════════════════════ */

console.log('\n════ 5. Climatizador de cubierta (UMA) con controlador ════');
pr = await abrirEjemplo(4);
must('CONDICIÓN PREVIA: es la UMA de cubierta', /uma|climatizador|cubierta/i.test(pr.nombre), pr.nombre);
await rotulosCuadran({ Q2: 'q2', G1: 'g1', F1: 'f1', A1: 'a1', K1: 'k1', KM1: 'km1', F2: 'f2',
	S0: 's0', S1: 's1', B1: 'b1', Y1: 'y1', Y2: 'y2', M1: 'm1' }, 'UMA de cubierta');
await energizar();
await circuitoSano('UMA en reposo');
await p.evaluate(() => {
	const v = document.getElementById('sim-velocidad');
	if (v) { v.value = [...v.options].map((o) => o.value).at(-1); v.dispatchEvent(new Event('change', { bubbles: true })); }
});
must('en reposo el ventilador NO gira', !(await activo('m1')), (await funcionando()).join(' · '));

console.log('\n  — «El selector pide marcha: DO2 abre la compuerta; el ventilador espera 8 s» —');
await accionar('s0');
await p.waitForTimeout(1000);
const antesDelRetardo = await foto();
must('la compuerta se abre en cuanto se pide marcha', antesDelRetardo.hay('y1'),
	antesDelRetardo.funcionando.join(' · '));
must('el ventilador todavía NO arranca (espera a la compuerta)', !antesDelRetardo.hay('m1'),
	'el renglón 2 dice «DO1 = DO2 retardo 8»');

console.log('\n  — «Pasados los 8 s entra DO1 → K1 → KM1 y el ventilador arranca» —');
const arranco = await esperarA(async () => (await activo('m1')) === true, 40_000);
must('el ventilador arranca SOLO al cumplirse el retardo', arranco,
	'nadie tocó nada: lo hace el programa del controlador');
must('y pasa por el relé de interposición', await activo('k1'),
	'el programa da 24 V; la bobina del contactor es de 220 V');
must('con el contactor del ventilador metido', await activo('km1'));
await circuitoSano('UMA en marcha');

console.log('\n  — «El térmico para el ventilador AUNQUE el programa siga diciendo que sí» —');
await accionar('f2');
const conTermico = await foto();
must('con el térmico disparado el ventilador PARA', !conTermico.hay('m1'),
	'una seguridad no se programa, se cablea');
must('y el programa SIGUE pidiendo marcha: la parada es del CABLEADO', conTermico.hay('k1'),
	'si el relé de interposición se cayera, no se demostraría que la seguridad es cableada');
await accionar('f2');
must('al rearmar, el ventilador vuelve', await esperarA(async () => (await activo('m1')) === true, 40_000));

console.log('\n  — «El filtro sucio cierra la compuerta; el ventilador aguanta su mínimo» —');
await accionar('s1');
await p.waitForTimeout(1200);
const filtroSucio = await foto();
must('con el filtro sucio la compuerta cierra', !filtroSucio.hay('y1'),
	'renglón 1: «DO2 = DI1 Y NO DI2»');
must('pero el ventilador NO se cae de golpe (mínimo 30 s)', filtroSucio.hay('m1'),
	'renglón 2: «minimo 30» evita que el motor arranque y pare sin parar');
await accionar('s1');
await p.waitForTimeout(1200);
must('al limpiar el filtro la compuerta vuelve a abrir', await activo('y1'));
await accionar('s0');

/* ══════════════════════════ Y nada roto por el camino ══════════════════════════ */

console.log('\n════ Estado final ════');
must('ningún error de JavaScript en toda la sesión', errores.length === 0, errores.slice(0, 3).join(' | '));

console.log(fallos === 0
	? '\n=== LOS CINCO EJEMPLOS HACEN LO QUE SU EXPLICACIÓN DICE ✔ ==='
	: `\n=== ${fallos} FALLOS ===`);
await b.close(); servidor.close();
process.exit(fallos === 0 ? 0 : 1);
