/**
 * LOS EJEMPLOS SE MIRAN, NO SE TOCAN — Y ABRIR UNO NO TE BORRA LO TUYO.
 *
 * Tres cosas que pidió Diego después de probarlo, y las tres se comprueban aquí de punta a punta:
 *
 *   1 · Cambiar de un ejemplo a otro, muchas veces, no rompe nada.
 *   2 · Un ejemplo no se puede editar: es material de estudio, y si se pudiera bastaría un Supr sin
 *       querer para que el que enseña el estrella-triángulo dejara de enseñarlo, sin vuelta atrás.
 *   3 · Abrir un ejemplo NO se lleva por delante el tablero en el que estabas trabajando.
 *
 * El 3 era el grave, y no estaba donde parecía. El programa SÍ avisaba —«se reemplaza lo que
 * hay»—, pero además de la pantalla escribía en `localStorage`, que es donde vive el tablero de
 * quien nunca descarga el archivo, o sea casi todo el mundo. Medido antes del arreglo, con «MI
 * TABLERO DEL AEROPUERTO» a medias:
 *
 *     ANTES    autoguardado = {"nombre":"MI TABLERO DEL AEROPUERTO", …}
 *     DESPUÉS  autoguardado = {"nombre":"Arranque estrella-triángulo …", …}
 *
 * Cerrabas la pestaña y tu tablero no existía en ninguna parte.
 *
 *   node qa/ejemplos-solo-lectura.mjs
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
p.on('pageerror', (e) => errores.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errores.push(m.text()); });
p.on('crash', () => errores.push('LA PÁGINA SE CAYÓ'));

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(300);

/** Abre el ejemplo nº `i`, contestando al aviso de trabajo sin guardar si sale. */
async function abrirEjemplo(i, aceptar = true) {
	await p.evaluate(() => document.getElementById('btn-ejemplos')?.click()
		?? document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(400);
	if (!(await p.isVisible('#modal-ejemplos'))) {
		await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
		await p.waitForTimeout(400);
	}
	if ((await p.locator('.tarjeta-ejemplo button').count()) === 0) return { abierto: false };
	await p.locator('.tarjeta-ejemplo button').nth(i % 5).click();
	await p.waitForTimeout(600);
	let preguntó = false;
	if (await p.isVisible('#modal-dialogo')) {
		preguntó = true;
		await p.evaluate((si) => document.getElementById(si ? 'dialogo-ok' : 'dialogo-cancelar')?.click(), aceptar);
		await p.waitForTimeout(1100);
	}
	await p.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
	await p.waitForTimeout(300);
	return { abierto: true, preguntó };
}

const autoguardado = () => p.evaluate(() => localStorage.getItem('tablerostudio-proyecto') ?? '');
const nombre = async () => (await qa('proyecto')).nombre;

/* ══════════════ 1 · Cambiar de ejemplo muchas veces no rompe nada ══════════════ */

console.log('════ 1. Ir y venir entre los cinco ejemplos ════');
let cablesOK = true;
for (let v = 0; v < 12; v++) {
	await abrirEjemplo(v);
	const pr = await qa('proyecto');
	const dibujados = await qa('cablesDibujados');
	if (dibujados !== pr.conductores.length) {
		cablesOK = false;
		console.log(`     vuelta ${v}: ${dibujados} dibujados de ${pr.conductores.length} — descuadre`);
	}
}
must('doce cambios de ejemplo sin un solo error de JavaScript', errores.length === 0,
	errores.slice(0, 2).join(' | '));
must('y sin cables fantasma en ninguna vuelta', cablesOK);
must('la sonda sigue viva al final', typeof (await nombre()) === 'string', await nombre());

/* ══════════════ 2 · Un ejemplo no se puede editar ══════════════ */

console.log('\n════ 2. Un ejemplo es de solo lectura ════');
await abrirEjemplo(2);   // estrella-triángulo
const antes = await qa('proyecto');
must('CONDICIÓN PREVIA: hay un ejemplo abierto', /estrella/i.test(antes.nombre), antes.nombre);
must('el tablero se anuncia como ejemplo', await p.evaluate(() => {
	const c = document.getElementById('chip-ejemplo');
	return !!c && !c.hidden;
}), 'tiene que verse el aviso de «Ejemplo — solo lectura»');

/*
 * Un ejemplo se abre en modo Trabajo, y ahí el catálogo no se ve. Se pasa a Editor —cambiar de modo
 * no es editar, y tiene que poder hacerse para mirar la estructura— y se intenta añadir desde ahí,
 * que es como lo intentaría cualquiera.
 */
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.waitForTimeout(600);
must('en un ejemplo SÍ se puede pasar a modo Editor para mirar',
	await p.isVisible('#catalogo'), 'mirar la estructura no es modificarla');

// a) Añadir un aparato del catálogo.
await p.locator('#catalogo button').nth(0).click({ force: true });
await p.waitForTimeout(500);
must('añadir del catálogo NO añade nada',
	(await qa('proyecto')).dispositivos.length === antes.dispositivos.length,
	`${antes.dispositivos.length} → ${(await qa('proyecto')).dispositivos.length}`);

// b) Borrar el aparato seleccionado con Supr.
await p.locator('#lista-dispositivos li').first().click();
await p.waitForTimeout(300);
await p.keyboard.press('Delete');
await p.waitForTimeout(500);
must('Supr NO borra el aparato seleccionado',
	(await qa('proyecto')).dispositivos.length === antes.dispositivos.length);

// c) Pegar.
await p.keyboard.press('Control+c'); await p.waitForTimeout(250);
await p.keyboard.press('Control+v'); await p.waitForTimeout(600);
must('Ctrl+V NO pega nada',
	(await qa('proyecto')).dispositivos.length === antes.dispositivos.length);

// d) El proyecto entero, byte a byte: nada ha cambiado.
must('el ejemplo queda IDÉNTICO tras intentar editarlo',
	JSON.stringify(await qa('proyecto')) === JSON.stringify(antes));

// e) Pero lo que es USAR el tablero sí funciona: energizar y accionar.
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(900);
must('un ejemplo SÍ se puede energizar', (await qa('simulacion')).energizado,
	'si no, el ejemplo no serviría para lo que está');
const s1 = (await qa('proyecto')).dispositivos.find((d) => d.id === 's1');
await qa('accionar', s1.id);
await p.waitForTimeout(800);
must('y SÍ se pueden accionar sus mandos', (await qa('simulacion')).activos.length > 0,
	(await qa('simulacion')).activos.join(', '));
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(500);

// f) Y hay salida para quien quiera trastear.
console.log('\n  — «Hacer una copia para trabajar» —');
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click());
await p.waitForTimeout(600);
must('la copia deja de ser un ejemplo', !(await qa('proyecto')).esEjemplo);
must('y se llama «Copia de …»', /^Copia de /.test(await nombre()), await nombre());
must('el aviso de solo lectura desaparece',
	await p.evaluate(() => document.getElementById('chip-ejemplo')?.hidden));
const antesDeAnadir = (await qa('proyecto')).dispositivos.length;
await p.locator('#catalogo button').nth(0).click({ force: true });
await p.waitForTimeout(600);
must('y AHORA sí se puede añadir un aparato',
	(await qa('proyecto')).dispositivos.length === antesDeAnadir + 1,
	`${antesDeAnadir} → ${(await qa('proyecto')).dispositivos.length}`);

/* ══════════════ 3 · Abrir un ejemplo no se lleva tu tablero ══════════════ */

console.log('\n════ 3. Tu tablero sobrevive a abrir un ejemplo ════');
// Se empieza de cero y se monta algo propio, con nombre reconocible.
await p.evaluate(() => document.getElementById('btn-nuevo')?.click());
await p.waitForTimeout(400);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(600); }
for (let i = 0; i < 3; i++) { await p.locator('#catalogo button').nth(i).click({ force: true }); await p.waitForTimeout(350); }
await p.evaluate(() => {
	const c = document.getElementById('nombre-proyecto');
	c.value = 'MI TABLERO DEL AEROPUERTO';
	c.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(800);
const mio = { nombre: await nombre(), aparatos: (await qa('proyecto')).dispositivos.length };
must('CONDICIÓN PREVIA: hay un tablero propio con trabajo hecho',
	mio.nombre === 'MI TABLERO DEL AEROPUERTO' && mio.aparatos === 3, JSON.stringify(mio));
must('CONDICIÓN PREVIA: y está en el guardado del navegador',
	(await autoguardado()).includes('MI TABLERO DEL AEROPUERTO'));

const { preguntó } = await abrirEjemplo(4);   // la UMA
must('abrir un ejemplo AVISA de que hay trabajo sin guardar', preguntó,
	'sin el aviso, el trabajo se reemplaza a ciegas');
must('el ejemplo se abre', /uma|climatizador/i.test(await nombre()), await nombre());

const guardado = await autoguardado();
must('EL GUARDADO SIGUE TENIENDO TU TABLERO', guardado.includes('MI TABLERO DEL AEROPUERTO'),
	'lo que se perdía: al cerrar la pestaña, tu trabajo no estaba en ninguna parte');
must('y NO se ha escrito el ejemplo encima', !/Climatizador de cubierta/.test(guardado));

// Y al recargar, vuelve lo tuyo: es la prueba de que de verdad está a salvo.
await p.reload();
await p.waitForTimeout(2200);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(400);
must('al volver a abrir el programa, ahí está tu tablero',
	(await nombre()) === 'MI TABLERO DEL AEROPUERTO', await nombre());
must('con sus aparatos', (await qa('proyecto')).dispositivos.length === 3,
	String((await qa('proyecto')).dispositivos.length));

/* ══════════════ 4 · Con la explicación abierta, el programa responde ══════════════ */

/*
 * ESTE es el candidato serio a lo que se vive como «el programa crashea».
 *
 * Al abrir un ejemplo sale su explicación. Si desde ahí se pulsa «Planta 3D» o «Ver dossier», la
 * herramienta se abría DEBAJO de la ventana y marcada `inert`: se veía algo raro y no respondía a
 * nada. Desde fuera eso no se distingue de un cuelgue. Se arregló hace un momento —las
 * herramientas cierran las ventanas al abrirse— y aquí se vigila que siga así.
 */
console.log('\n════ 4. Con la explicación de un ejemplo abierta, todo responde ════');
await abrirEjemplo(0);
await p.evaluate(() => document.getElementById('btn-explicacion')?.click());
await p.waitForTimeout(600);
must('CONDICIÓN PREVIA: la explicación está abierta',
	await p.evaluate(() => !document.getElementById('modal-explicacion')?.hidden));
await p.evaluate(() => document.getElementById('btn-pdf')?.click());
await p.waitForTimeout(3000);
const dossier = await p.evaluate(() => {
	const panel = document.getElementById('panel-dossier');
	const campo = document.getElementById('dos-empresa-nombre');
	return {
		abierto: !!panel && !panel.hidden,
		inerte: !!panel?.closest('[inert]') || !!panel?.hasAttribute('inert'),
		usable: !!campo && campo.offsetParent !== null && !campo.closest('[inert]'),
	};
});
must('el dossier se abre desde la explicación de un ejemplo', dossier.abierto);
must('y NO queda muerto detrás de ella', !dossier.inerte, 'esto se vive como un cuelgue');
must('sus controles responden', dossier.usable);
await p.evaluate(() => document.getElementById('dos-cerrar')?.click());
await p.waitForTimeout(600);
must('y al cerrarlo se puede seguir trabajando',
	await p.evaluate(() => ![...document.body.children].some((h) => h.hasAttribute('inert'))));

console.log('\n════ Estado final ════');
must('ningún error de JavaScript en toda la sesión', errores.length === 0, errores.slice(0, 3).join(' | '));

console.log(fallos === 0
	? '\n=== LOS EJEMPLOS SE ESTUDIAN SIN RIESGO ✔ ==='
	: `\n=== ${fallos} FALLOS ===`);
await b.close(); servidor.close();
process.exit(fallos === 0 ? 0 : 1);
