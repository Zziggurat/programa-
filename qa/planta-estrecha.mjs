/**
 * QA de la Planta 3D en PANTALLA ESTRECHA y con una ventana abierta.
 *
 * Segunda auditoría, TS2-P1-08 y TS2-P1-09.
 *
 * P1-08 · A 900 px o menos había un `display: none` sobre el panel, el buscador y la cinta. Activar
 * «Medir» ponía `hidden = false` y la cinta no salía igual, porque esa regla pesaba más; y el
 * buscador reaparecía por otra regla posterior, con la cascada contradiciéndose. A 480 px el botón
 * «Medir» caía en x=478–538, fuera de la pantalla. No se podía medir, ni ver el parte, ni salir.
 *
 * P1-09 · Una ventana era un `hidden = false` y nada más: con la guía abierta, la H seguía plegando
 * los paneles POR DETRÁS del modal y en modo Pasear la W movía la cámara mientras se leía la
 * ayuda. Uno vuelve de leer y está en otro sitio de la cubierta.
 *
 *   node qa/planta-estrecha.mjs
 */
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { servidor: s } = await servidorDeQA();
const b = await abrirNavegador(chromium);
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const url = `http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`;

/** Abre la Planta en una página del tamaño pedido. */
async function abrirPlanta(ancho, alto) {
	const p = await b.newPage({ viewport: { width: ancho, height: alto } });
	await p.goto(url);
	await p.waitForTimeout(1500);
	await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
	await p.evaluate(() => document.getElementById('btn-planta')?.click());
	await p.waitForTimeout(3500);
	// La guía sale sola la primera vez: se cierra para empezar como quien ya la ha visto.
	await p.evaluate(() => document.getElementById('btn-cerrar-guia-mundo')?.click());
	await p.waitForTimeout(400);
	return p;
}

/* ============ 1. Todos los mandos, alcanzables a 480 y a 800 px ============ */

for (const [ancho, alto] of [[480, 900], [360, 800], [800, 1000]]) {
	console.log(`\n--- ${ancho}×${alto} ---`);
	const p = await abrirPlanta(ancho, alto);

	const MANDOS = ['mundo-sims', 'mundo-paseo', 'mundo-guia', 'mundo-paneles', 'mundo-medir',
		'mundo-inicio', 'mundo-salir'];
	const fuera = await p.evaluate(([ids, w]) => ids.map((id) => {
		const e = document.getElementById(id);
		if (!e) return `${id}: no existe`;
		const r = e.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return `${id}: sin tamaño`;
		if (r.right > w + 1 || r.left < -1) return `${id}: x=${Math.round(r.left)}–${Math.round(r.right)}`;
		return null;
	}).filter(Boolean), [MANDOS, ancho]);
	must(`${ancho}px: todos los mandos caben en la pantalla`, fuera.length === 0, fuera.join(' · '));

	/*
	 * Y MEDIR TIENE QUE FUNCIONAR. Es el criterio de la auditoría, y es lo que se hace en obra:
	 * marcar dos puntos en la cubierta y guardar la tirada para saber cuánto cable pedir.
	 */
	await p.evaluate(() => document.getElementById('mundo-medir').click());
	await p.waitForTimeout(700);
	const cinta = await p.evaluate(() => {
		const e = document.getElementById('mundo-cinta');
		const r = e.getBoundingClientRect();
		return { visible: !e.hidden && getComputedStyle(e).display !== 'none' && r.height > 0,
			display: getComputedStyle(e).display, alto: Math.round(r.height) };
	});
	must(`${ancho}px: al pulsar Medir SALE la cinta`, cinta.visible, JSON.stringify(cinta));

	// Dos clics en el lienzo y la tirada tiene que poder guardarse.
	// Se pincha en la MITAD DE ARRIBA del lienzo: el cajón de la cinta ocupa la de abajo, y lo
	// que se comprueba es que quede cubierta tocable mientras se mide, no que se pueda tocar el
	// propio cajón.
	await p.mouse.click(Math.round(ancho * 0.35), Math.round(alto * 0.28));
	await p.waitForTimeout(500);
	await p.mouse.click(Math.round(ancho * 0.62), Math.round(alto * 0.40));
	await p.waitForTimeout(500);
	/*
	 * No basta con que el botón EXISTA: se pulsa y se comprueba que la tirada queda apuntada.
	 * Con un rectángulo dentro de la pantalla se daría por bueno un botón que no hace nada, y con
	 * uno fuera se suspendería un botón que solo hay que desplazar para ver.
	 */
	const antesTiradas = await p.evaluate(() => document.querySelectorAll('#mundo-tiradas .fila-tirada').length);
	const btn = await p.$('#mundo-guardar-tirada button');
	const visibleSinBuscar = btn && await p.evaluate((e) => {
		const r = e.getBoundingClientRect();
		return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
	}, btn);
	if (btn) { await btn.scrollIntoViewIfNeeded(); await btn.click(); await p.waitForTimeout(600); }
	const ahoraTiradas = await p.evaluate(() => document.querySelectorAll('#mundo-tiradas .fila-tirada').length);
	must(`${ancho}px: se puede guardar la tirada medida`, !!btn && ahoraTiradas === antesTiradas + 1,
		`${antesTiradas} → ${ahoraTiradas}`);
	must(`${ancho}px: y el botón de guardar se ve sin tener que buscarlo`, !!visibleSinBuscar);

	// El panel de la obra tiene que poder verse, no estar suprimido por CSS. Se sale de Medir
	// primero: en pantalla estrecha los cajones se turnan, y mientras se mide manda la cinta.
	await p.evaluate(() => document.getElementById('mundo-medir').click());
	await p.waitForTimeout(500);
	await p.evaluate(() => { document.getElementById('mundo').classList.remove('sin-paneles'); });
	const panel = await p.evaluate(() => {
		const e = document.getElementById('mundo-panel');
		return { display: getComputedStyle(e).display, alto: Math.round(e.getBoundingClientRect().height) };
	});
	must(`${ancho}px: el parte de obra se puede mirar`, panel.display !== 'none' && panel.alto > 40,
		JSON.stringify(panel));

	// Y la página no se desplaza de lado, que es el síntoma clásico de algo que se sale.
	const desborde = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
	must(`${ancho}px: la página no se va de lado`, desborde <= 1, `${desborde} px de más`);
	await p.close();
}

/* ============ 2. Con una ventana abierta, el fondo no se mueve ============ */

console.log('\n--- una ventana abierta bloquea lo de detrás ---');
const p = await abrirPlanta(1300, 850);

const panelesAntes = await p.evaluate(() => document.getElementById('mundo').classList.contains('sin-paneles'));
await p.evaluate(() => document.getElementById('mundo-guia').click());
await p.waitForTimeout(500);
must('la guía se abre', await p.evaluate(() => !document.getElementById('modal-guia-mundo').hidden));

// La H plegaba los paneles POR DETRÁS del modal: una acción invisible.
await p.keyboard.press('h');
await p.waitForTimeout(400);
const panelesDespues = await p.evaluate(() => document.getElementById('mundo').classList.contains('sin-paneles'));
must('con la guía abierta, la H no toca los paneles de detrás', panelesAntes === panelesDespues,
	`antes ${panelesAntes} · después ${panelesDespues}`);

// El fondo queda `inert`: ni ratón, ni tabulador, ni lector de pantalla.
const fondoApagado = await p.evaluate(() => {
	const barra = document.getElementById('mundo-barra');
	return !!barra?.closest('[inert]') || barra?.hasAttribute('inert');
});
must('el fondo queda fuera de alcance mientras la ventana está abierta', fondoApagado);

// Y el diálogo se anuncia como tal, con el foco dentro.
const acc = await p.evaluate(() => {
	const m = document.getElementById('modal-guia-mundo');
	return { rol: m.getAttribute('role'), modal: m.getAttribute('aria-modal'),
		focoDentro: m.contains(document.activeElement) };
});
must('la guía se anuncia como diálogo y recibe el foco',
	acc.rol === 'dialog' && acc.modal === 'true' && acc.focoDentro, JSON.stringify(acc));

// El tabulador no se escapa del diálogo.
for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
must('el tabulador no se sale del diálogo',
	await p.evaluate(() => document.getElementById('modal-guia-mundo').contains(document.activeElement)));

// Escape cierra, y el fondo vuelve.
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
must('Escape cierra la guía', await p.evaluate(() => document.getElementById('modal-guia-mundo').hidden));
must('y el fondo vuelve a estar vivo',
	await p.evaluate(() => !document.getElementById('mundo-barra')?.closest('[inert]')));

/* ============ 3. Paseando, la ventana también para la cámara ============ */

console.log('\n--- paseando, la ventana para la cámara ---');
await p.evaluate(() => document.getElementById('mundo-paseo').click());
await p.waitForTimeout(900);
await p.evaluate(() => document.getElementById('mundo-guia').click());
await p.waitForTimeout(500);
const camaraAntes = await p.evaluate(() => window.__plantaQA?.camara?.() ?? null);
await p.keyboard.down('w');
await p.waitForTimeout(1200);
await p.keyboard.up('w');
await p.waitForTimeout(300);
const camaraDespues = await p.evaluate(() => window.__plantaQA?.camara?.() ?? null);
if (!camaraAntes || !camaraDespues) {
	must('la sonda da la posición de la cámara', false, 'sin window.__plantaQA.camara()');
} else {
	const movido = Math.hypot(camaraDespues.x - camaraAntes.x, camaraDespues.z - camaraAntes.z);
	must('con la guía abierta, la W NO mueve la cámara', movido < 0.2, `${movido.toFixed(2)} m`);
}

/* ============ 4. Lo que NO se puede hacer aquí, dicho antes de intentarlo ============ */

/*
 * Tercera auditoría, TS3-P2-08 y TS3-P2-09.
 *
 * El informe da dos salidas para cada uno: implementarlo, o declararlo y no fingir. Se ha elegido
 * declararlo —Pasear necesita teclado, el editor necesita ancho—, así que lo que hay que comprobar
 * es que la declaración EXISTE y dice la verdad. Un botón que se pulsa y no lleva a ninguna parte,
 * o un editor que se abre con la placa tapada, es peor que un mensaje claro.
 */
console.log('\n--- lo que esta pantalla no da, se dice ---');

// Un teléfono de verdad: solo dedo, sin ratón. Es lo que distingue `pointer: fine`.
const movil = await b.newContext({
	viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
});
const t = await movil.newPage();
await t.goto(`http://127.0.0.1:${s.address().port}/?qa=1`);
await t.waitForTimeout(1600);

const avisoAncho = await t.evaluate(() => {
	const e = document.getElementById('inicio-aviso-ancho');
	return { existe: !!e, visible: !!e && !e.hidden, texto: e?.textContent ?? '' };
});
must('el inicio avisa de que el editor necesita más ancho', avisoAncho.visible);
must('el aviso dice la anchura que hace falta', /1024/.test(avisoAncho.texto), avisoAncho.texto.slice(0, 90));
must('y dice que la Planta sí funciona aquí', /Planta/i.test(avisoAncho.texto));

await t.evaluate(() => document.getElementById('inicio-terreno')?.click());
await t.waitForTimeout(4000);
await t.evaluate(() => document.getElementById('btn-cerrar-guia-mundo')?.click());
await t.waitForTimeout(400);

const paseo = await t.evaluate(() => {
	const bt = document.getElementById('mundo-paseo');
	return { existe: !!bt, apagado: !!bt?.disabled, porque: bt?.title ?? '' };
});
must('CONDICIÓN PREVIA: el botón de Pasear está ahí', paseo.existe);
must('en un equipo solo táctil, Pasear queda apagado', paseo.apagado);
must('y explica por qué', /teclado/i.test(paseo.porque), paseo.porque.slice(0, 80));
// Lo demás de la Planta sí tiene que funcionar: si no, apagar Pasear no arregla nada.
const utiles = await t.evaluate(() => ['mundo-q', 'mundo-medir', 'mundo-salir']
	.filter((i) => { const e = document.getElementById(i); return e && e.offsetParent !== null; }));
must('buscar, medir y salir siguen ahí', utiles.length === 3, utiles.join(', '));
await movil.close();

await b.close(); s.close();
console.log(`\n=== ${fallos === 0 ? 'la Planta se usa en pantalla estrecha y sus ventanas bloquean el fondo ✔' : `${fallos} FALLO(S) ✗`} ===`);
process.exit(fallos ? 1 : 0);
