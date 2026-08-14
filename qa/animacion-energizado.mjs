/**
 * ENERGIZAR TIENE QUE VERSE, NO SOLO CONTARSE.
 *
 * El simulador ya sabía qué estaba metido: lo decía en la lista de «funcionando» y encendía los
 * cables con tensión. Pero los aparatos no hacían nada. Un contactor metido, una lámpara encendida
 * y un motor girando se veían igual —los tres con el mismo brillo ámbar por encima— y nada se
 * movía. Para comprobar que el cableado está bien, que es para lo que se energiza, había que
 * leerse el panel en vez de mirar el tablero.
 *
 * Y los aparatos de campo —el motor, la boya, los pulsadores de la puerta— ni siquiera se
 * dibujaban: solo salía su prensaestopas. Justamente los que hay que ver funcionar.
 *
 * Esto comprueba, componente por componente, que la escena CAMBIA de verdad al accionar:
 *
 *   motor        el eje gira mientras funciona, y se para cuando se para
 *   contactor    la armadura baja cuando la bobina tira, y vuelve al soltar
 *   pulsador     la cabeza se hunde mientras está apretado
 *   boya/sonda   su testigo se enciende al accionarla
 *   protección   la palanca baja al abrirla y la mirilla se pone roja
 *
 * Se mira la geometría de la escena, no el panel: el panel ya decía la verdad cuando en pantalla
 * no se movía nada.
 *
 *   node qa/animacion-energizado.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

const errores = [];
p.on('pageerror', (e) => errores.push(e.message));

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(400);

async function abrirEjemplo(i) {
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(600);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(500);
		await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
		await p.waitForTimeout(600);
	}
	await p.locator('.tarjeta-ejemplo button').nth(i).click({ timeout: 30_000 });
	await p.waitForTimeout(1800);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(900);
	}
	if (await p.isVisible('#modal-explicacion')) {
		await p.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
		await p.waitForTimeout(500);
	}
}

const piezas = (id) => qa('piezas', id);
const accionar = async (id) => { await qa('accionar', id); await p.waitForTimeout(700); };

/* ================================================================== */

console.log('### 1 · el arranque directo: qué hay dibujado');

await abrirEjemplo(0);
for (const [id, nombre] of [['m1', 'el motor'], ['s1', 'el pulsador de marcha'], ['km1', 'el contactor']]) {
	const pz = await piezas(id);
	must(`${nombre} tiene cuerpo en la escena`, pz !== null,
		pz === null ? 'no se dibuja: no hay nada que ver ni que pinchar' : Object.keys(pz).join(' '));
}

console.log('\n### 2 · con tensión y en marcha, las cosas se mueven');

await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(1000);

const motorParado = await piezas('m1');
const kmSuelto = await piezas('km1');

await accionar('s1');   // MARCHA

const kmMetido = await piezas('km1');
must('el contactor METE: la armadura baja',
	(kmMetido?.armadura?.[0]?.z ?? 0) < (kmSuelto?.armadura?.[0]?.z ?? 0),
	`z ${kmSuelto?.armadura?.[0]?.z} → ${kmMetido?.armadura?.[0]?.z}`);

// El eje se mira dos veces separadas en el tiempo: girar es CAMBIAR, no estar en una posición.
const giro1 = (await piezas('m1'))?.eje?.[0]?.giro;
await p.waitForTimeout(700);
const giro2 = (await piezas('m1'))?.eje?.[0]?.giro;
must('el motor GIRA mientras funciona', giro1 !== undefined && giro2 !== undefined && giro1 !== giro2,
	`giro ${giro1} → ${giro2}`);

const s1Apretado = await piezas('s1');
must('el pulsador se hunde mientras está apretado',
	(s1Apretado?.boton?.[0]?.z ?? 99) < 6, `z ${s1Apretado?.boton?.[0]?.z}`);

console.log('\n### 3 · al parar, todo vuelve a su sitio');

await accionar('s1');   // soltar el pulsador (sigue en marcha por la autorretención)
await accionar('s0');   // PARO

const kmCaido = await piezas('km1');
must('la armadura del contactor vuelve a salir',
	Math.abs((kmCaido?.armadura?.[0]?.z ?? 0) - (kmSuelto?.armadura?.[0]?.z ?? 0)) < 0.2,
	`z ${kmCaido?.armadura?.[0]?.z} (en reposo era ${kmSuelto?.armadura?.[0]?.z})`);

const quieto1 = (await piezas('m1'))?.eje?.[0]?.giro;
await p.waitForTimeout(700);
const quieto2 = (await piezas('m1'))?.eje?.[0]?.giro;
must('el motor SE PARA de verdad (el eje deja de girar)', quieto1 === quieto2,
	`giro ${quieto1} → ${quieto2}`);
must('CONDICIÓN PREVIA: el motor tenía eje que mirar', motorParado?.eje?.length > 0);

console.log('\n### 4 · la protección se ve abierta, y disparada se ve roja');

const q1Cerrado = await piezas('q1');
await accionar('q1');   // abrir el guardamotor
const q1Abierto = await piezas('q1');
must('al abrir la protección, la palanca baja',
	(q1Abierto?.palanca?.[0]?.y ?? 0) < (q1Cerrado?.palanca?.[0]?.y ?? 0),
	`y ${q1Cerrado?.palanca?.[0]?.y} → ${q1Abierto?.palanca?.[0]?.y}`);
must('y la mirilla deja de estar verde',
	q1Abierto?.mirilla?.[0]?.color !== q1Cerrado?.mirilla?.[0]?.color,
	`color ${q1Cerrado?.mirilla?.[0]?.color?.toString(16)} → ${q1Abierto?.mirilla?.[0]?.color?.toString(16)}`);
await accionar('q1');   // cerrarla otra vez

console.log('\n### 5 · la bomba con boya: el testigo de la boya se enciende');

await abrirEjemplo(1);
if (!(await qa('simulacion')).energizado) {
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(1000);
}
const boyaReposo = await piezas('b1');
must('la boya tiene cuerpo en la escena', boyaReposo !== null);
await accionar('b1');
const boyaCerrada = await piezas('b1');
must('al cerrar la boya, su testigo se enciende',
	(boyaCerrada?.lente?.[0]?.brillo ?? 0) > (boyaReposo?.lente?.[0]?.brillo ?? 0),
	`brillo ${boyaReposo?.lente?.[0]?.brillo} → ${boyaCerrada?.lente?.[0]?.brillo}`);

const giroBomba1 = (await piezas('m1'))?.eje?.[0]?.giro;
await p.waitForTimeout(700);
const giroBomba2 = (await piezas('m1'))?.eje?.[0]?.giro;
must('y la bomba se pone a girar', giroBomba1 !== giroBomba2, `giro ${giroBomba1} → ${giroBomba2}`);

/* ------------------------------------------------------------------ */

console.log('\n### 6 · el tablero de control: la pantalla del autómata se enciende');

/*
 * Un autómata sin tensión tiene la pantalla APAGADA. Antes nacía siempre iluminada, así que daba
 * exactamente igual energizar o no: el equipo parecía vivo aunque no le llegara ni un voltio.
 */
await abrirEjemplo(3);   // tablero de control 24 V, que lleva autómata
/*
 * SE APAGA A PROPÓSITO ANTES DE MIRAR. Energizar no se pierde al cambiar de tablero —y está bien
 * que no se pierda—, así que llegar aquí desde el ejemplo anterior con tensión puesta hacía que
 * el botón la QUITARA en vez de darla: la pantalla salía encendida antes y apagada después, justo
 * al revés. La prueba daba por hecho un estado en vez de fijarlo.
 */
const ponerTension = async (encendida) => {
	if ((await qa('simulacion')).energizado !== encendida) {
		await p.evaluate(() => document.getElementById('btn-energizar')?.click());
		await p.waitForTimeout(1200);
	}
};
await ponerTension(false);
const apagada = await piezas('a1');
must('el autómata tiene pantalla en la escena', (apagada?.pantalla?.length ?? 0) > 0,
	Object.keys(apagada ?? {}).join(' '));
must('sin tensión, la pantalla está apagada', (apagada?.pantalla?.[0]?.brillo ?? 1) === 0,
	`brillo ${apagada?.pantalla?.[0]?.brillo}`);

await ponerTension(true);
const encendida = await piezas('a1');
must('al energizar, la pantalla del autómata SE ENCIENDE',
	(encendida?.pantalla?.[0]?.brillo ?? 0) > 0.5,
	`brillo ${apagada?.pantalla?.[0]?.brillo} → ${encendida?.pantalla?.[0]?.brillo}`);
must('y sus LEDs también', (encendida?.led ?? []).some((l) => l.brillo > 0),
	(encendida?.led ?? []).map((l) => l.brillo).join(' '));

console.log('\n### 7 · personalización: el color se elige y manda sobre el de fábrica');

/*
 * El color lo ponía el catálogo y no había forma de cambiarlo, así que dos contactores de marcas
 * distintas salían idénticos. Y en los aparatos de campo yo lo ADIVINABA del rótulo —si el marcado
 * llevaba «S0», rojo—, o sea que un paro rotulado «-PARO» salía verde. Ahora se elige en la ficha.
 */
await abrirEjemplo(0);
/*
 * Se trabaja sobre una COPIA. Un ejemplo es de solo lectura, así que elegir un color no se guarda
 * —y está bien que no se guarde—: la primera versión de esta comprobación fallaba por eso, con la
 * regla haciendo exactamente su trabajo. Es el mismo camino que sigue el usuario.
 */
await trabajarSobreCopia(p);
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.waitForTimeout(400);
await qa('elegir', 'km1');
await p.waitForTimeout(600);
const hayCampo = await p.isVisible('#dev-color');
must('la ficha del aparato ofrece elegir color', hayCampo);

if (hayCampo) {
	const antes = (await qa('proyecto')).dispositivos.find((x) => x.id === 'km1')?.colorCuerpo;
	await p.evaluate(() => {
		const c = document.getElementById('dev-color');
		c.value = '#c81e5a';
		c.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await p.waitForTimeout(900);
	const despues = (await qa('proyecto')).dispositivos.find((x) => x.id === 'km1')?.colorCuerpo;
	must('elegir un color lo guarda en el aparato', despues === '#c81e5a', `${antes} → ${despues}`);
	// Y el botón de volver al de fábrica tiene que dejarlo como estaba.
	await p.evaluate(() => document.getElementById('dev-color-reset')?.click());
	await p.waitForTimeout(700);
	const vuelto = (await qa('proyecto')).dispositivos.find((x) => x.id === 'km1')?.colorCuerpo;
	must('el botón ↺ devuelve el color de fábrica', vuelto === undefined, String(vuelto));
}

console.log(`\nerrores de JavaScript: ${errores.length}`);
must('ni un error de JavaScript', errores.length === 0, errores.slice(0, 2).join(' | '));

await b.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
