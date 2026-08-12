/**
 * EL PROGRAMA SE QUEDA CONGELADO AL IR CAMBIANDO DE UN EJEMPLO A OTRO.
 *
 * Es lo que se ve desde fuera: la pantalla sigue ahí, con su tablero y sus botones, y no responde
 * a nada. Y «no responde» tiene una causa concreta y comprobable en este programa: `inert`.
 *
 * El gestor de ventanas apaga el fondo con `inert` mientras hay un modal delante —es lo correcto,
 * es lo que impide tabular a un botón que no se ve— y lo vuelve a encender al cerrarlo. Si por
 * cualquier camino se apaga y no se enciende, queda EXACTAMENTE lo que describe el usuario: todo
 * visible, nada pulsable. No es una hipótesis sobre memoria ni sobre WebGL: es un atributo que
 * está o no está en el DOM, y se puede leer.
 *
 * Así que esto no persigue «un crash». Vigila una INVARIANTE, en cada paso del camino:
 *
 *     si no hay ninguna ventana abierta, no puede quedar NADA inerte.
 *
 * Y la comprueba por el camino que se recorre de verdad: abrir un ejemplo, energizarlo, y desde
 * ahí irse a otro —con el aviso de «se reemplaza lo que hay» por medio—, una y otra vez.
 *
 * Además del atributo se comprueba que el programa RESPONDE: un clic de ratón de verdad (no un
 * `.click()` de JavaScript, que se salta `inert` y diría que todo va bien) sobre un botón que deja
 * huella, y que la escena se sigue dibujando.
 *
 *   node qa/congelamiento.mjs
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

/**
 * LA INVARIANTE.
 *
 * Devuelve qué hay inerte y si eso está justificado. Está justificado mientras haya una ventana
 * visible delante; en cuanto no la hay, cualquier `inert` que quede es la pantalla muerta.
 */
const estadoInerte = () => p.evaluate(() => {
	const visible = (e) => !!e && !e.hidden && e.offsetParent !== null;
	const ventanas = [...document.querySelectorAll('[role="dialog"]')].filter(visible).map((e) => e.id);
	const inertes = [...document.querySelectorAll('[inert]')].map((e) => e.id || e.tagName.toLowerCase());
	return { ventanas, inertes };
});

/**
 * ¿Responde el programa a un clic de RATÓN de verdad? `inert` mata este, no el `.click()`.
 *
 * Y si no responde, dice QUIÉN lo está tapando. Sin eso, «no llegó el ratón» obliga a montar un
 * diagnóstico aparte cada vez, y lo que hace falta saber es una sola cosa: qué hay encima.
 *
 * EL TOPE ES GENEROSO A PROPÓSITO. Con 4 s esto cantaba «pantalla muerta» en los cuatro sitios en
 * los que mira, y era mentira: aquí se dibuja por software y un clic de ratón tarda sus 4,7 s en
 * completarse. Se descubrió subiendo el tope, no razonándolo. Un tope apretado en una máquina
 * lenta no mide que el programa esté colgado: mide que la prueba tiene prisa, y habría mandado a
 * buscar un fallo que no existe.
 */
async function respondeAlRaton() {
	const antes = await qa('camara');
	try {
		await p.locator('#btn-centrar').click({ timeout: 20_000 });
	} catch (fallo) {
		const razon = String(fallo.message ?? fallo).split('\n').slice(0, 12).join(" | ");
		const quien = await p.evaluate(() => {
			const btn = document.getElementById('btn-centrar');
			const r = btn?.getBoundingClientRect();
			if (!r) return 'no existe #btn-centrar';
			const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			const caja = el?.closest('[id]');
			return el
				? `lo tapa <${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
					+ `${el.className ? '.' + String(el.className).split(' ')[0] : ''}>`
					+ (caja && caja !== el ? ` dentro de #${caja.id}` : '')
					+ ` · inerte=${!!el.closest('[inert]')}`
				: 'no hay nada en ese punto';
		});
		return { ok: false, motivo: `el ratón no llegó a Centrar — ${quien} · ${razon}` };
	}
	await p.waitForTimeout(500);
	const despues = await qa('camara');
	return { ok: true, movio: JSON.stringify(antes) !== JSON.stringify(despues) };
}

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(300);

/**
 * Abre el ejemplo nº `i` recorriendo la MISMA botonería que el usuario, incluido el aviso de
 * «tienes cambios sin guardar» cuando aparece. Devuelve qué ventanas quedaron por el camino.
 */
async function cambiarAEjemplo(i) {
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(400);
	/*
	 * TODO SE PULSA CON EL RATÓN DE VERDAD, y es el motivo de que esta suite exista.
	 *
	 * Las demás suites pulsan con `p.evaluate(() => el.click())`, que es una llamada de JavaScript:
	 * llega al manejador aunque el elemento esté `inert`. Por eso ninguna vio nunca este fallo —el
	 * aviso inerte que no se podía pulsar—, y por eso yo daba por bueno un camino que para el
	 * usuario estaba muerto. Un clic que se salta la barrera no prueba que la barrera no esté.
	 */
	if (await p.isVisible('#modal-dialogo')) {
		await p.locator('#dialogo-ok').click();
		await p.waitForTimeout(400);
		await p.locator('#btn-empezar-ejemplo').click();
		await p.waitForTimeout(400);
	}
	if (!(await p.isVisible('#modal-ejemplos'))) return { abrio: false };
	await p.locator('.tarjeta-ejemplo button').nth(i).click();
	await p.waitForTimeout(700);
	/*
	 * El aviso puede salir AQUÍ, que es el caso de la captura: se pincha la tarjeta y entonces
	 * pregunta. Se espera de verdad a que salga, porque abrir un ejemplo es asíncrono.
	 */
	if (await p.isVisible('#modal-dialogo')) {
		await p.locator('#dialogo-ok').click();
		await p.waitForTimeout(900);
	}
	await p.waitForFunction(() => (window.qa?.proyecto()?.dispositivos.length ?? 0) > 2, { timeout: 20_000 })
		.catch(() => {});
	// La explicación del ejemplo, que sale sola.
	if (await p.isVisible('#modal-explicacion')) {
		await p.locator('#btn-cerrar-explicacion').click();
		await p.waitForTimeout(400);
	}
	return { abrio: true };
}

/* ------------------------------------------------------------------ */

console.log('### 1 · el camino de la captura: energizado y saltando de ejemplo en ejemplo');

await cambiarAEjemplo(1);   // bomba con boya, que es el de la captura
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(1200);
must('CONDICIÓN PREVIA: el tablero está energizado', (await qa('simulacion')).energizado);

const ORDEN = [2, 0, 4, 1, 3, 2, 4, 0, 3, 1];
let congelado = null;
for (let v = 0; v < ORDEN.length; v++) {
	await cambiarAEjemplo(ORDEN[v]);
	const { ventanas, inertes } = await estadoInerte();
	if (ventanas.length === 0 && inertes.length > 0) {
		congelado = `vuelta ${v + 1}: sin ninguna ventana abierta y con ${inertes.length} elementos `
			+ `inertes (${inertes.join(', ')})`;
		break;
	}
}
must('nunca queda la pantalla inerte sin una ventana que lo justifique', congelado === null, congelado ?? '');

const r1 = await respondeAlRaton();
must('después de diez cambios el programa responde al ratón', r1.ok, r1.motivo ?? '');

/* ------------------------------------------------------------------ */

console.log('\n### 2 · lo mismo, pero cancelando el aviso a mitad');

/*
 * Cancelar es el otro camino, y el que más se usa sin querer: se pincha un ejemplo, sale el aviso
 * y uno se echa atrás. Si «Cancelar» cierra el aviso pero deja el fondo apagado, la pantalla queda
 * muerta con el tablero de siempre delante, que es aún más desconcertante.
 */
// Para que salte el aviso hace falta trabajo sin guardar: hacer la copia del ejemplo ya lo es.
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click());
await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
await p.waitForTimeout(500);
if (await p.isVisible('#modal-ejemplos')) {
	await p.locator('.tarjeta-ejemplo button').nth(3).click();
	await p.waitForTimeout(800);
	if (await p.isVisible('#modal-dialogo')) {
		await p.locator('#dialogo-cancelar').click();
		await p.waitForTimeout(600);
	}
}
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
const trasCancelar = await estadoInerte();
must('al cancelar el aviso no queda la pantalla inerte',
	!(trasCancelar.ventanas.length === 0 && trasCancelar.inertes.length > 0),
	`ventanas: [${trasCancelar.ventanas}] · inertes: [${trasCancelar.inertes}]`);
const r2 = await respondeAlRaton();
must('y sigue respondiendo al ratón', r2.ok, r2.motivo ?? '');

/* ------------------------------------------------------------------ */

console.log('\n### 3 · con las herramientas de pantalla completa por medio');

/*
 * El dossier, el esquema y la Planta son «herramientas»: ocupan la pantalla entera y viven en una
 * capa por debajo de los modales. Abrir un ejemplo desde ahí, o abrir una de ellas con un modal
 * todavía puesto, es donde el gestor se puede quedar a medias.
 */
for (const [boton, cerrar, nombre] of [
	['btn-esquema', 'esq-cerrar', 'esquema'],
	['btn-dossier', 'dos-cerrar', 'dossier'],
]) {
	const existe = await p.evaluate((id) => !!document.getElementById(id), boton);
	if (!existe) { console.log(`     (no hay #${boton}, se salta)`); continue; }
	await p.evaluate((id) => document.getElementById(id)?.click(), boton);
	await p.waitForTimeout(1200);
	await p.evaluate((id) => document.getElementById(id)?.click(), cerrar);
	await p.waitForTimeout(800);
	const e = await estadoInerte();
	must(`tras abrir y cerrar el ${nombre} no queda nada inerte`,
		!(e.ventanas.length === 0 && e.inertes.length > 0),
		`ventanas: [${e.ventanas}] · inertes: [${e.inertes}]`);
	const r = await respondeAlRaton();
	must(`   y el programa responde al ratón`, r.ok, r.motivo ?? '');
}

/* ------------------------------------------------------------------ */

console.log('\n### 4 · ¿sigue viva la escena?');

const dib = await qa('medirDibujado', 10).catch(() => null);
must('la escena se sigue dibujando', dib !== null && dib.mediana < 500,
	dib ? `mediana ${dib.mediana} ms` : 'no se pudo medir');

console.log(`\nerrores de JavaScript: ${errores.length}${errores.length ? '\n  ' + errores.join('\n  ') : ''}`);
must('ni un error de JavaScript en todo el recorrido', errores.length === 0, errores.slice(0, 3).join(' | '));

await b.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
