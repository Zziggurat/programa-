/**
 * TODOS LOS BOTONES, UNO POR UNO, CON EL RATÓN DE VERDAD.
 *
 * Las demás suites comprueban funciones concretas: que el esquema salga legible, que el dossier
 * lleve la empresa, que el estrella-triángulo pase por la estrella. Esta no comprueba ninguna
 * función en particular: recorre la botonería ENTERA —barra, menús desplegables, paneles y las
 * herramientas a pantalla completa— y de cada botón exige tres cosas que valen para todos:
 *
 *   1. que se pueda pulsar de verdad. Con el RATÓN, no con `element.click()`. Esta distinción no
 *      es un capricho: la pantalla congelada que reportó Diego —un aviso `inert` encima del que no
 *      se podía pulsar ni «Cancelar»— pasó por delante de 42 suites sin que ninguna la viera,
 *      porque todas pulsaban con JavaScript y el JavaScript atraviesa `inert`. El robot cruzaba la
 *      pared y certificaba que no había pared.
 *   2. que no reviente. Ni un error de JavaScript, ni una promesa sin capturar.
 *   3. QUE LA PANTALLA SIGA VIVA DESPUÉS. Esta es la que caza los congelamientos: si al cerrar
 *      algo queda `inert` puesto sin ninguna ventana delante, el programa está muerto aunque se
 *      vea perfecto. Se comprueba tras CADA pulsación, no al final.
 *
 * No sustituye a las pruebas de cada herramienta; es la red por debajo de todas: el botón que
 * nadie probó nunca, el que se añadió ayer, el que solo falla si vienes de otra pantalla.
 *
 *   node qa/todos-los-botones.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const p = await ctx.newPage();

let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };

const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
// Un selector de archivos abierto dejaría la prueba esperando: se cierra sin elegir nada.
p.on('filechooser', (fc) => { fc.setFiles([]).catch(() => {}); });
// Las descargas se aceptan y se tiran: aquí solo interesa que el botón no reviente.
p.on('download', (d) => { d.delete().catch(() => {}); });

/**
 * Lo que hay inerte y qué ventanas lo justifican. La invariante de «pantalla viva».
 *
 * OJO CON CÓMO SE MIDE «VISIBLE». La primera versión usaba `offsetParent !== null`, y eso es
 * SIEMPRE null en un elemento `position: fixed` —que es lo que son todas las ventanas de este
 * programa—. O sea que la lista de ventanas abiertas salía vacía siempre. Consecuencia: al abrir
 * el detalle del DRC, con el fondo inerte como debe ser, esta prueba cantaba «pantalla muerta» y
 * además no cerraba la ventana, así que los cinco botones siguientes fallaban en cascada. Cinco
 * fallos, ninguno del programa. Se mide por el rectángulo, que sí vale para `fixed`.
 */
const VISIBLE = `(e) => {
	if (e.hidden) return false;
	const r = e.getBoundingClientRect();
	return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
}`;
const inercia = () => p.evaluate(`(() => {
	const visible = ${VISIBLE};
	return {
		ventanas: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map((e) => e.id),
		inertes: [...document.querySelectorAll('[inert]')].map((e) => e.id || e.tagName.toLowerCase()),
	};
})()`);

/**
 * Devuelve el programa al editor, pase lo que pase: cierra avisos, modales y herramientas.
 *
 * Va por Escape y por los botones de cerrar, nunca poniendo `hidden` a mano: hacerlo a mano se
 * saltaría justamente al gestor de ventanas, que es lo que esta suite quiere vigilar.
 */
async function volverAlEditor() {
	for (let i = 0; i < 6; i++) {
		if (await p.isVisible('#modal-dialogo')) {
			await p.locator('#dialogo-cancelar').click({ timeout: 20_000 }).catch(() => {});
			await p.waitForTimeout(250);
			continue;
		}
		const { ventanas } = await inercia();
		if (ventanas.length) { await p.keyboard.press('Escape'); await p.waitForTimeout(350); continue; }
		break;
	}
	// Herramientas a pantalla completa, cada una por su botón de cerrar.
	/*
	 * Cada herramienta se cierra por SU botón, y hay que saberse el nombre:
	 *
	 *   · la Planta sale por «✕ Salir» (`#mundo-salir`). Puse `#mundo-cerrar`, que no existe, y la
	 *     Planta se quedaba abierta tapando la barra del editor;
	 *   · «🏠 Inicio» de la Planta NO es la vista general del terreno: cierra la Planta y abre la
	 *     PANTALLA DE INICIO. Desde ahí se vuelve al editor con «Tableros» (`#inicio-tableros`).
	 *     Sin esto, la pantalla de inicio quedaba delante y el editor parecía no responder.
	 */
	for (const [panel, cerrar] of [['#panel-esquema', '#esq-cerrar'], ['#panel-dossier', '#dos-cerrar'],
		['#mundo', '#mundo-salir'], ['#inicio', '#inicio-tableros']]) {
		if (!(await p.isVisible(panel))) continue;
		if (await p.isVisible(cerrar)) {
			await p.locator(cerrar).click({ timeout: 20_000 }).catch(() => {});
			await p.waitForTimeout(500);
		}
	}
	await p.waitForTimeout(200);
}

/** Deja un tablero de trabajo (copia de un ejemplo) en pantalla, listo para editar. */
async function tableroDeTrabajo() {
	await volverAlEditor();
	/*
	 * La sonda puede no estar todavía —o haber desaparecido, si un botón recargó la página—, así
	 * que se espera a que exista en vez de darla por hecha. Sin esto, un `window.qa.proyecto()` a
	 * secas revienta la suite entera y no se prueba ni un botón.
	 */
	await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 }).catch(() => {});
	const hay = await p.evaluate(() => (window.qa?.proyecto()?.dispositivos.length ?? 0));
	if (hay > 3 && !(await p.isVisible('#chip-ejemplo'))) return;
	await p.locator('#btn-empezar-ejemplo').click({ timeout: 20_000 }).catch(() => {});
	await p.waitForTimeout(600);
	if (await p.isVisible('#modal-dialogo')) {
		await p.locator('#dialogo-ok').click({ timeout: 20_000 }).catch(() => {});
		await p.waitForTimeout(400);
		await p.locator('#btn-empezar-ejemplo').click({ timeout: 20_000 }).catch(() => {});
		await p.waitForTimeout(600);
	}
	if (await p.isVisible('#modal-ejemplos')) {
		await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 20_000 });
		await p.waitForTimeout(1800);
		if (await p.isVisible('#modal-dialogo')) {
			await p.locator('#dialogo-ok').click({ timeout: 20_000 }).catch(() => {});
			await p.waitForTimeout(900);
		}
	}
	if (await p.isVisible('#modal-explicacion')) {
		await p.locator('#btn-cerrar-explicacion').click({ timeout: 20_000 }).catch(() => {});
		await p.waitForTimeout(400);
	}
	await trabajarSobreCopia(p);
}

/**
 * ¿Está el control DENTRO DE LA PANTALLA, no solo «visible»?
 *
 * No es lo mismo, y la diferencia costó dos vueltas. «🗔 Paneles» no esconde los paneles laterales
 * con `hidden`: los DESPLAZA fuera con `transform: translateX(-100% - 20px)`. Un elemento así
 * sigue teniendo rectángulo y sigue contando como «visible» —para `isVisible` y para
 * `waitForSelector({state:'visible'})`—, pero está fuera de la ventana y no hay ratón que lo
 * alcance. La prueba lo daba por presente y luego se comía un fallo al pulsarlo.
 *
 * Se mira si el rectángulo CORTA con la ventana, que es la pregunta de verdad.
 */
const enPantalla = (sel) => p.evaluate((s) => {
	const e = document.querySelector(s);
	if (!e || e.hidden) return false;
	const r = e.getBoundingClientRect();
	if (r.width === 0 || r.height === 0) return false;
	if (getComputedStyle(e).visibility === 'hidden') return false;
	return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
}, sel);

/**
 * Deja un menú desplegable ABIERTO, sin dar por hecho en qué estado estaba.
 *
 * El botón del menú ALTERNA, y Escape no cierra un desplegable (solo cierra ventanas). La primera
 * versión de esta suite pulsaba el botón a ciegas antes de cada entrada: si el menú venía abierto
 * de la vuelta anterior, ese clic lo CERRABA y la entrada quedaba invisible. Por eso fallaba
 * exactamente la PRIMERA entrada de cada uno de los tres menús y ninguna más —un patrón demasiado
 * limpio para ser del programa—. Se mira si la entrada se ve, y solo se pulsa si no.
 */
async function abrirMenu(boton, entradaSel) {
	for (let i = 0; i < 3; i++) {
		if (await p.isVisible(entradaSel)) return true;
		await p.locator(boton).click({ timeout: 20_000 }).catch(() => {});
		await p.waitForTimeout(400);
	}
	return p.isVisible(entradaSel);
}

/**
 * Pulsa un botón con el ratón y comprueba las tres cosas. `abre` dice qué modal/panel se espera
 * que aparezca, para no tomar por bueno un botón que no hace nada.
 */
async function pulsar(sel, nombre, { abre } = {}) {
	const erroresAntes = errores.length;
	let llego = true;
	try {
		await p.locator(sel).click({ timeout: 20_000 });
	} catch {
		llego = false;
	}
	await p.waitForTimeout(600);

	must(`${nombre}: se puede pulsar con el ratón`, llego,
		llego ? '' : 'no llegó el clic (tapado, inerte o inexistente)');
	if (!llego) { await volverAlEditor(); return false; }

	const nuevos = errores.slice(erroresAntes);
	must(`${nombre}: no revienta`, nuevos.length === 0, nuevos.slice(0, 2).join(' | '));

	if (abre) {
		const salio = await p.isVisible(abre).catch(() => false);
		must(`${nombre}: abre ${abre}`, salio, salio ? '' : 'no apareció');
	}

	await volverAlEditor();
	const { ventanas, inertes } = await inercia();
	must(`${nombre}: la pantalla sigue viva al volver`,
		!(ventanas.length === 0 && inertes.length > 0),
		`ventanas: [${ventanas}] · inertes: [${inertes}]`);
	return true;
}

/* ================================================================== */

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
// Se espera a que la sonda EXISTA, no a un reloj: el editor tarda lo que tarde en montarse.
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(400);

/** Cuántos aparatos hay, sin dar por hecho que la sonda esté puesta. */
const cuantosAparatos = () => p.evaluate(() => window.qa?.proyecto()?.dispositivos.length ?? -1);

await tableroDeTrabajo();
must('CONDICIÓN PREVIA: hay un tablero de trabajo en pantalla', (await cuantosAparatos()) > 3,
	`${await cuantosAparatos()} aparatos`);

/* ---------------- 1 · La barra de arriba ---------------- */

console.log('\n### 1 · la barra de arriba');

for (const [sel, nombre, opciones] of [
	['#btn-deshacer', 'Deshacer', {}],
	['#btn-rehacer', 'Rehacer', {}],
	['#btn-centrar', 'Centrar', {}],
	['#btn-2d', '2D / 3D', {}],
	['#btn-ver', 'Ver (visualización)', {}],
	['#btn-esquema', 'Esquema', { abre: '#panel-esquema' }],
	['#chip-drc', 'Chip del DRC', {}],
	['#btn-energizar', 'Energizar', {}],
	['#btn-pdf', 'Ver dossier', { abre: '#panel-dossier' }],
	['#modo-trabajo', 'Modo Trabajo', {}],
	['#modo-editor', 'Modo Editor', {}],
]) {
	await tableroDeTrabajo();
	await pulsar(sel, nombre, opciones);
}

/* ---------------- 2 · Los menús desplegables ---------------- */

console.log('\n### 2 · los menús desplegables, entrada por entrada');

for (const [boton, nombreMenu] of [
	['#btn-archivo', 'Archivo'], ['#btn-aprender', 'Aprender'], ['#btn-exportar', 'Entregar'],
]) {
	await tableroDeTrabajo();
	if (!(await p.isVisible(boton))) { console.log(`     (no hay ${boton}, se salta)`); continue; }
	await p.locator(boton).click({ timeout: 20_000 });
	await p.waitForTimeout(400);
	const entradas = await p.evaluate((sel) => {
		const menu = document.querySelector(sel)?.closest('[id^="menu-"]');
		if (!menu) return [];
		return [...menu.querySelectorAll('button')]
			.filter((e) => e.id !== document.querySelector(sel).id)
			.filter((e) => e.getBoundingClientRect().height > 0)
			.map((e) => ({ id: e.id || null, txt: (e.textContent || '').trim().slice(0, 30) }));
	}, boton);
	must(`el menú ${nombreMenu} despliega opciones`, entradas.length > 0, `${entradas.length} entradas`);

	for (const e of entradas) {
		if (!e.id) continue;
		await tableroDeTrabajo();
		await abrirMenu(boton, `#${e.id}`);
		await pulsar(`#${e.id}`, `${nombreMenu} › ${e.txt || e.id}`);
	}
}

/* ---------------- 3 · Las casillas del panel de vista ---------------- */

console.log('\n### 3 · las casillas de «Vista»');

await tableroDeTrabajo();
for (const id of ['ver-cotas', 'ver-voltaje', 'ver-cables', 'ver-tapas', 'ver-etiquetas']) {
	if (!(await p.isVisible(`#${id}`))) { console.log(`     (no hay #${id}, se salta)`); continue; }
	const erroresAntes = errores.length;
	const antes = await p.isChecked(`#${id}`);
	await p.locator(`#${id}`).click({ timeout: 20_000 }).catch(() => {});
	await p.waitForTimeout(500);
	const despues = await p.isChecked(`#${id}`);
	must(`casilla ${id}: cambia de estado`, antes !== despues, `${antes} → ${despues}`);
	must(`casilla ${id}: no revienta`, errores.length === erroresAntes,
		errores.slice(erroresAntes).slice(0, 1).join(''));
	// Se deja como estaba, para no arrastrar el estado a la siguiente.
	await p.locator(`#${id}`).click({ timeout: 20_000 }).catch(() => {});
	await p.waitForTimeout(300);
}

/* ---------------- 4 · Dentro de cada herramienta ---------------- */

console.log('\n### 4 · la botonería DENTRO de cada herramienta');

for (const [abrir, panel, nombre] of [
	['#btn-esquema', '#panel-esquema', 'Esquema'],
	['#btn-pdf', '#panel-dossier', 'Dossier'],
	['#btn-planta', '#mundo', 'Planta 3D'],
]) {
	await tableroDeTrabajo();
	if (!(await p.isVisible(abrir))) { console.log(`     (no hay ${abrir}, se salta)`); continue; }
	await p.locator(abrir).click({ timeout: 20_000 }).catch(() => {});
	// La Planta tarda en montarse; se espera al panel, no a un reloj.
	await p.waitForSelector(`${panel}:visible`, { timeout: 60_000 }).catch(() => {});
	await p.waitForTimeout(2500);
	if (!(await p.isVisible(panel))) { must(`${nombre}: se abre`, false, 'no apareció el panel'); continue; }
	must(`${nombre}: se abre`, true);

	/*
	 * LAS GUÍAS QUE SALEN SOLAS, ESPERÁNDOLAS.
	 *
	 * La guía de la Planta aparece cuando la Planta termina de montarse, y eso pasa DESPUÉS de que
	 * el panel ya se vea. La primera versión miraba una vez tras 2,5 s, la guía todavía no estaba,
	 * y a continuación enumeraba once botones que —correctamente— estaban `inert` porque la guía
	 * llegó justo después. Once fallos, ninguno del programa: el fondo inerte bajo una ventana
	 * abierta es exactamente lo que tiene que pasar.
	 */
	for (const g of ['#btn-cerrar-guia-mundo', '#btn-cerrar-explicacion']) {
		const salio = await p.waitForSelector(`${g}:visible`, { timeout: 8000 }).then(() => true, () => false);
		if (!salio) continue;
		await p.locator(g).click({ timeout: 20_000 }).catch(() => {});
		await p.waitForTimeout(500);
	}
	// Y por si quedara alguna otra ventana encima, se cierra antes de contar los botones.
	for (let i = 0; i < 4 && (await inercia()).ventanas.length; i++) {
		await p.keyboard.press('Escape');
		await p.waitForTimeout(350);
	}

	const dentro = await p.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)]
		.filter((e) => e.getBoundingClientRect().height > 0 && !e.disabled)
		.map((e) => ({ id: e.id || null, txt: (e.textContent || '').trim().slice(0, 24) }))
		.filter((e) => e.id), panel);
	console.log(`     ${nombre}: ${dentro.length} botones dentro`);

	for (const e of dentro) {
		// Salir/cerrar la herramienta se prueba al final: en medio dejaría al resto sin pantalla.
		if (/cerrar|salir/i.test(e.id)) continue;
		/*
		 * CADA BOTÓN SE PRUEBA DESDE UN ESTADO CONOCIDO.
		 *
		 * Una herramienta tiene modos, y sus botones se esconden unos a otros haciendo su trabajo:
		 * «🗔 Paneles» esconde los paneles laterales —lo que promete su ayuda—, «Paseo» entra en el
		 * recorrido a pie, «Medir» cambia el ratón. Dentro de esos paneles viven «Todas con
		 * señales», «Vaciar» y «Parte de obra (CSV)», así que recorriendo en orden los primeros
		 * apagaban a los últimos y la prueba los daba por rotos sin estarlo.
		 *
		 * Intenté rescatarlos volviendo a pulsar «Paneles» y no bastó: desde el modo paseo no
		 * vuelven. Así que en vez de adivinar qué los escondió, se cierra la herramienta y se abre
		 * otra vez. Cuesta unos segundos por botón y a cambio lo que mide es de fiar.
		 */
		if (!(await enPantalla(`#${e.id}`))) {
			await volverAlEditor();
			await p.locator(abrir).click({ timeout: 20_000 }).catch(() => {});
			await p.waitForSelector(`${panel}:visible`, { timeout: 60_000 }).catch(() => {});
			await p.waitForTimeout(2500);
			for (const g of ['#btn-cerrar-guia-mundo', '#btn-cerrar-explicacion']) {
				if (await p.isVisible(g)) {
					await p.locator(g).click({ timeout: 20_000 }).catch(() => {});
					await p.waitForTimeout(400);
				}
			}
		}
		/*
		 * HAY BOTONES QUE SOLO EXISTEN EN SU MOMENTO, y exigirles que se puedan pulsar siempre es
		 * probar lo que no es. «Vaciar» vive en el cajón de máquinas elegidas y no aparece hasta
		 * que hay alguna elegida; «Todas con señales» cuelga del recuento, que se rellena cuando
		 * termina de cargar la cubierta. Con la herramienta recién abierta no están, y eso es
		 * correcto. Se anotan aparte —ni bien ni mal— para que se vea que no se han probado, en vez
		 * de contarlos como rotos y ensuciar el recuento con dos fallos que no lo son.
		 */
		let aparece = false;
		for (let i = 0; i < 16 && !aparece; i++) {
			aparece = await enPantalla(`#${e.id}`);
			if (!aparece) await p.waitForTimeout(500);
		}
		if (!aparece) {
			console.log(`--    ${nombre} › ${e.txt || e.id}: no sale en este estado (depende de una `
				+ 'selección o de un modo); no se prueba aquí');
			continue;
		}
		const erroresAntes = errores.length;
		let llego = true;
		try { await p.locator(`#${e.id}`).click({ timeout: 20_000 }); } catch { llego = false; }
		await p.waitForTimeout(700);
		must(`${nombre} › ${e.txt || e.id}: se pulsa y no revienta`,
			llego && errores.length === erroresAntes,
			!llego ? 'no llegó el clic' : errores.slice(erroresAntes).slice(0, 1).join(''));
		// Un aviso o ventana que abra el botón se cierra antes de ir al siguiente; si no, el de
		// después saldría inerte por debajo y se contaría como fallo sin serlo.
		if (await p.isVisible('#modal-dialogo')) {
			await p.locator('#dialogo-cancelar').click({ timeout: 20_000 }).catch(() => {});
			await p.waitForTimeout(300);
		}
		for (let i = 0; i < 3 && (await inercia()).ventanas.length; i++) {
			await p.keyboard.press('Escape');
			await p.waitForTimeout(350);
		}
		// Si el botón cerró la herramienta (p. ej. «llevar al tablero»), se vuelve a abrir.
		if (!(await p.isVisible(panel))) {
			await p.locator(abrir).click({ timeout: 20_000 }).catch(() => {});
			await p.waitForSelector(`${panel}:visible`, { timeout: 60_000 }).catch(() => {});
			await p.waitForTimeout(1500);
			for (const g of ['#btn-cerrar-guia-mundo', '#btn-cerrar-explicacion']) {
				if (await p.isVisible(g)) { await p.locator(g).click({ timeout: 20_000 }).catch(() => {}); await p.waitForTimeout(400); }
			}
		}
	}

	await volverAlEditor();
	const { ventanas, inertes } = await inercia();
	must(`${nombre}: al cerrarla la pantalla sigue viva`,
		!(ventanas.length === 0 && inertes.length > 0),
		`ventanas: [${ventanas}] · inertes: [${inertes}]`);
	const r = await p.locator('#btn-centrar').click({ timeout: 20_000 }).then(() => true, () => false);
	must(`${nombre}: y el editor vuelve a responder al ratón`, r);
}

/* ---------------- 5 · Recuento ---------------- */

console.log(`\nerrores de JavaScript en toda la sesión: ${errores.length}`);
if (errores.length) console.log('  ' + [...new Set(errores)].slice(0, 8).join('\n  '));

await ctx.close();
await b.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
