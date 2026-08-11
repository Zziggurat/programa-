/**
 * QA de TECLADO EN LAS VENTANAS: quien no usa el ratón no se sale del diálogo sin querer.
 *
 * Tercera auditoría, TS3-P2-02. Con «Ejemplos» abierto, enfocar el botón de cerrar y pulsar
 * Shift+Tab llevaba el foco a `#grupo-borrar` —detrás del modal—, y el contenedor no declaraba
 * `role="dialog"` ni `aria-modal="true"`. El bloqueo de atajos destructivos que ya había reduce el
 * daño, pero no arregla ni el teclado ni el lector de pantalla: quien navega con Tab se sale del
 * diálogo sin enterarse y sigue pulsando cosas que ya no ve.
 *
 * Esto comprueba las cinco cosas que tiene que hacer CADA ventana, sin mirar cómo están hechas:
 *
 *   1 · al abrirse, el foco entra dentro;
 *   2 · Tab desde el último control vuelve al primero, no se escapa;
 *   3 · Shift+Tab desde el primero va al último, no se escapa;
 *   4 · Escape la cierra;
 *   5 · al cerrarse, el foco vuelve al botón que la abrió;
 *   6 · se anuncia como diálogo (`role`, `aria-modal`) y el fondo queda `inert`.
 *
 * Se abren por su BOTÓN, como las abre cualquiera, no poniéndoles `hidden = false` a mano: media
 * ventana no se prepara hasta que se pulsa, y una prueba que la fuerza a mano no comprueba lo que
 * ve el usuario.
 *
 *   node qa/modales-teclado.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(200);

/** Quién tiene el foco ahora mismo, dicho de forma que se pueda leer en el informe. */
const foco = () => p.evaluate(() => {
	const a = document.activeElement;
	if (!a || a === document.body) return '(body)';
	return a.id || `${a.tagName.toLowerCase()}.${a.className.split(' ')[0]}`;
});

/** Lo que se puede tabular dentro de una ventana, en el orden del tabulador. */
const enfocablesDe = (id) => p.evaluate((i) => {
	const caja = document.getElementById(i);
	if (!caja) return [];
	return [...caja.querySelectorAll(
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
		+ 'textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
	)].filter((e) => e.offsetParent !== null).map((e) => e.id || `${e.tagName.toLowerCase()}.${e.className.split(' ')[0]}`);
}, id);

/** ¿El foco sigue dentro de la ventana? Lo pregunta al DOM, no a la lista de arriba. */
const focoDentro = (id) => p.evaluate((i) => {
	const caja = document.getElementById(i);
	return !!caja && caja.contains(document.activeElement);
}, id);

/**
 * Las ventanas del editor y por qué botón se abre cada una.
 *
 * `modal-explicacion` no está: sale sola detrás de cargar un ejemplo y no tiene botón propio, así
 * que se comprueba de paso al abrir `modal-ejemplos`. `modal-dialogo` tampoco: vive por encima de
 * la pila con su propio Enter/Escape que además le devuelve la respuesta a quien la espera.
 */
const VENTANAS = [
	{ id: 'modal-ayuda', abre: 'btn-ayuda', menu: 'menu-aprender' },
	{ id: 'modal-proyecto', abre: 'btn-datos-proyecto', menu: 'menu-archivo' },
	{ id: 'modal-drc', abre: 'chip-drc' },
	{ id: 'modal-controlador', abre: 'btn-controlador-medida' },
	{ id: 'modal-ejemplos', abre: 'btn-empezar-ejemplo' },
];

for (const { id, abre, menu } of VENTANAS) {
	console.log(`\n--- #${id} (se abre con #${abre}) ---`);

	/*
	 * Dos de estos botones viven dentro de un desplegable que solo se despliega con `.abierto`.
	 * Se abre antes, porque un botón con `display: none` no se puede ni enfocar ni pulsar.
	 */
	if (menu) await p.evaluate((m) => document.getElementById(m)?.classList.add('abierto'), menu);
	// El botón se enfoca ANTES de pulsarlo: así se sabe a dónde tiene que volver el foco al cerrar.
	const hay = await p.evaluate((x) => {
		const bt = document.getElementById(x);
		if (!bt || bt.offsetParent === null) return false;
		bt.focus(); bt.click(); return true;
	}, abre);
	must(`CONDICIÓN PREVIA: #${abre} existe y se puede pulsar`, hay);
	if (!hay) continue;
	await p.waitForTimeout(400);

	const visible = await p.isVisible(`#${id}`);
	must('la ventana se abre', visible);
	if (!visible) continue;

	/* 1 · el foco entra dentro */
	must('al abrirse, el foco entra en la ventana', await focoDentro(id), await foco());

	/* 6 · se anuncia como diálogo y el fondo queda apagado */
	const anuncio = await p.evaluate((i) => {
		const caja = document.getElementById(i);
		const fondo = [...document.body.children].filter((h) => h !== caja && !h.contains(caja) && h.id !== 'modal-dialogo');
		return {
			papel: caja.getAttribute('role'),
			modal: caja.getAttribute('aria-modal'),
			nombre: caja.getAttribute('aria-label') || caja.getAttribute('aria-labelledby'),
			despiertos: fondo.filter((h) => !h.hasAttribute('inert')).map((h) => h.id || h.tagName),
		};
	}, id);
	must('se anuncia como diálogo modal', anuncio.papel === 'dialog' && anuncio.modal === 'true',
		`role=${anuncio.papel} aria-modal=${anuncio.modal}`);
	must('el diálogo tiene nombre accesible', !!anuncio.nombre, String(anuncio.nombre));
	must('lo de detrás queda inerte', anuncio.despiertos.length === 0, anuncio.despiertos.join(', '));

	/* 2 y 3 · el tabulador da la vuelta dentro */
	const lista = await enfocablesDe(id);
	must('la ventana tiene controles que tabular', lista.length > 0, `${lista.length}`);
	if (lista.length > 0) {
		await p.evaluate((i) => {
			const caja = document.getElementById(i);
			const l = [...caja.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
				.filter((e) => e.offsetParent !== null);
			l[l.length - 1].focus();
		}, id);
		await p.keyboard.press('Tab'); await p.waitForTimeout(120);
		must('Tab desde el último control NO se sale de la ventana', await focoDentro(id), await foco());

		await p.evaluate((i) => {
			const caja = document.getElementById(i);
			const l = [...caja.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
				.filter((e) => e.offsetParent !== null);
			l[0].focus();
		}, id);
		await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(120);
		must('Shift+Tab desde el primer control NO se sale de la ventana', await focoDentro(id), await foco());
	}

	/* 4 y 5 · Escape cierra y el foco vuelve */
	await p.keyboard.press('Escape'); await p.waitForTimeout(350);
	must('Escape cierra la ventana', !(await p.isVisible(`#${id}`)));
	/*
	 * A dónde tiene que volver el foco.
	 *
	 * Lo normal es el mismo botón. Pero si salió de un desplegable, ese botón ya no existe para el
	 * teclado —el `.lista` se cerró con `display: none`— y enfocarlo no haría nada: el foco se
	 * quedaría en `<body>`, que es donde estaba antes de arreglar esto. Lo correcto ahí es el botón
	 * que ABRE el desplegable, que es de donde salió el usuario y desde donde puede volver a entrar.
	 *
	 * Esta prueba lo daba por fallo en las dos primeras ventanas, con el foco ya puesto en
	 * «Aprender ▾» y «Archivo ▾». El fallo era de la prueba: se comprobaba el botón exacto en vez
	 * de comprobar que el foco vuelve a un sitio útil.
	 */
	const disparadorDelMenu = menu
		? await p.evaluate((m) => document.getElementById(m)?.querySelector('.boton')?.id, menu)
		: undefined;
	const donde = await foco();
	must('al cerrarse, el foco vuelve al botón que la abrió (o al menú que lo contiene)',
		donde === abre || (!!disparadorDelMenu && donde === disparadorDelMenu), donde);

	// Y el fondo tiene que volver a estar vivo, o lo siguiente que se pulse no responderá.
	const apagados = await p.evaluate(() => [...document.body.children]
		.filter((h) => h.hasAttribute('inert')).map((h) => h.id || h.tagName));
	must('al cerrarse, lo de detrás vuelve a estar vivo', apagados.length === 0, apagados.join(', '));

	// Si algo quedó abierto (Escape no llegó), se cierra a mano para no arrastrarlo a la siguiente.
	await p.evaluate((i) => { const c = document.getElementById(i); if (c) c.hidden = true; }, id);
	await p.evaluate(() => { for (const h of document.body.children) h.removeAttribute('inert'); });
	await p.waitForTimeout(150);
}

/*
 * UNA VENTANA CERRADA POR LA ESPALDA SE TIENE QUE PODER VOLVER A ABRIR.
 *
 * El gestor lleva su lista de ventanas abiertas, pero `hidden` lo puede tocar cualquiera. Si algo
 * la cierra sin pasar por él, la lista se queda con una ventana que ya no está y la siguiente
 * llamada a `abrirVentana` la da por abierta: esa ventana no se abre nunca más.
 *
 * Le pasó de verdad a `qa/datos-proyecto.mjs` en cuanto «Datos del proyecto» entró en el gestor:
 * cerraba con `setAttribute('hidden')` y en el intento siguiente ya no salía la ventana. Aquí se
 * reproduce a propósito, para que no vuelva a hacer falta descubrirlo de rebote.
 */
console.log('\n--- una ventana cerrada por la espalda vuelve a abrirse ---');
await p.evaluate(() => document.getElementById('chip-drc').click());
await p.waitForTimeout(300);
must('CONDICIÓN PREVIA: la ventana está abierta', await p.isVisible('#modal-drc'));
// Se cierra a lo bruto, sin avisar al gestor. Esto es legal: `hidden` es un atributo del DOM.
await p.evaluate(() => { document.getElementById('modal-drc').hidden = true; });
await p.waitForTimeout(200);
await p.evaluate(() => document.getElementById('chip-drc').click());
await p.waitForTimeout(300);
must('se vuelve a abrir después de que alguien la cerrara a pelo', await p.isVisible('#modal-drc'));
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
must('y sigue cerrándose con Escape', !(await p.isVisible('#modal-drc')));
const restos = await p.evaluate(() => [...document.body.children]
	.filter((h) => h.hasAttribute('inert')).map((h) => h.id || h.tagName));
must('sin dejar nada inerte por el camino', restos.length === 0, restos.join(', '));

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ===`);
await b.close(); servidor.close();
process.exit(fallos === 0 ? 0 : 1);
