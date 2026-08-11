/**
 * ABRIR UN PROYECTO ES TODO O NADA: proyecto, historial Y guardado.
 *
 * Tercera auditoría, TS3-P2-03. Al abrir un archivo, `capturar()` mete el estado actual en la pila
 * de deshacer y VACÍA la de rehacer antes de que el proyecto nuevo esté montado. Si el montaje
 * falla, el `catch` devuelve `proyecto` a su sitio —eso ya estaba arreglado, TS2-P1-01— pero no
 * las pilas: queda un paso de deshacer que no deshace nada y, sobre todo, se ha perdido TODO lo
 * que hubiera para rehacer. Y `actualizarTodo()` autoguarda por el camino, así que el navegador
 * puede quedarse con el proyecto a medio montar.
 *
 * El informe lo dice tal cual: «No se reprodujo una excepción natural postvalidación en el
 * recorrido normal; es un defecto condicional de atomicidad. Debe probarse inyectando un fallo
 * después de `capturar` y antes del commit». Eso es lo que hace esta prueba, con
 * `window.qa.romperProximoMontaje()`.
 *
 * El caso de uso real, sin nada raro: llevas un rato trabajando, deshaces un par de cosas porque
 * te lo estabas pensando, y pruebas a abrir un archivo que resulta estar mal. El archivo no se
 * abre —eso es correcto— pero además te quedas sin poder rehacer lo que habías deshecho.
 *
 *   node qa/abrir-atomico.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(200);

/*
 * Cuatro aparatos del catálogo y dos «deshacer»: así hay pila de deshacer Y pila de rehacer, que
 * es la que se pierde. Se añaden del catálogo porque es la mutación más simple que de verdad pasa
 * por `capturar()` —cambiar el nombre del proyecto, por ejemplo, NO entra en el historial— y no
 * depende de dónde esté el ratón.
 */
await p.evaluate(() => document.getElementById('btn-empezar-blanco')?.click());
await p.waitForTimeout(250);
const catalogo = p.locator('#catalogo button');
for (let i = 0; i < 4; i++) { await catalogo.nth(i).click({ force: true }); await p.waitForTimeout(250); }
await p.evaluate(() => document.getElementById('btn-deshacer')?.click()); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('btn-deshacer')?.click()); await p.waitForTimeout(300);

const antes = {
	historial: await qa('historial'),
	aparatos: (await qa('proyecto')).dispositivos.length,
	guardado: await qa('autoguardado'),
};
console.log(`\nestado de partida: deshacer=${antes.historial.deshacer} rehacer=${antes.historial.rehacer} aparatos=${antes.aparatos}`);
must('CONDICIÓN PREVIA: hay pila de deshacer', antes.historial.deshacer > 0, String(antes.historial.deshacer));
must('CONDICIÓN PREVIA: hay pila de REHACER (es la que se pierde)', antes.historial.rehacer >= 2,
	String(antes.historial.rehacer));

/*
 * Y ahora se abre un archivo perfectamente válido, pero se rompe el montaje a propósito. Es la
 * fase de después de validar: el archivo está bien, lo que falla es el render.
 */
console.log('\n--- abrir un archivo válido con el montaje roto ---');
const otro = JSON.stringify({
	formato: 'tablero-studio', version: 1, nombre: 'EL QUE NO SE DEBE ABRIR',
	gabinete: { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] },
	hojas: [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }],
	dispositivos: [], conductores: [],
});
await qa('romperProximoMontaje');
await p.evaluate((texto) => {
	const entrada = document.getElementById('archivo-abrir');
	const dt = new DataTransfer();
	dt.items.add(new File([texto], 'otro.tablero.json', { type: 'application/json' }));
	entrada.files = dt.files;
	entrada.dispatchEvent(new Event('change', { bubbles: true }));
}, otro);
await p.waitForTimeout(500);
/*
 * Hay trabajo sin descargar, así que antes de abrir otro archivo pregunta. Hay que contestar que
 * sí: sin esto la apertura se queda esperando y la prueba mide el estado de un archivo que nunca
 * se llegó a abrir —pasaba todo, y no comprobaba nada—.
 */
const preguntó = await p.isVisible('#modal-dialogo');
must('CONDICIÓN PREVIA: avisa de que hay trabajo sin descargar', preguntó);
if (preguntó) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); }
await p.waitForTimeout(1200);

const despues = {
	historial: await qa('historial'),
	aparatos: (await qa('proyecto')).dispositivos.length,
	guardado: await qa('autoguardado'),
};
console.log(`estado tras el fallo: deshacer=${despues.historial.deshacer} rehacer=${despues.historial.rehacer} aparatos=${despues.aparatos}`);

must('el proyecto en pantalla sigue siendo el de antes', despues.aparatos === antes.aparatos,
	`${antes.aparatos} → ${despues.aparatos} aparatos`);
must('la pila de DESHACER no crece con un paso que no hizo nada',
	despues.historial.deshacer === antes.historial.deshacer,
	`${antes.historial.deshacer} → ${despues.historial.deshacer}`);
must('la pila de REHACER sigue entera',
	despues.historial.rehacer === antes.historial.rehacer,
	`${antes.historial.rehacer} → ${despues.historial.rehacer}`);
must('lo guardado en el navegador NO es el proyecto que no se pudo abrir',
	!(despues.guardado ?? '').includes('EL QUE NO SE DEBE ABRIR'));
must('lo guardado en el navegador sigue siendo lo de antes', despues.guardado === antes.guardado);

/* Y el editor tiene que seguir vivo: rehacer devuelve lo que había, sin recargar la página. */
console.log('\n--- y el editor sigue funcionando ---');
await p.evaluate(() => document.getElementById('btn-rehacer')?.click()); await p.waitForTimeout(350);
must('rehacer sigue funcionando después del fallo',
	(await qa('proyecto')).dispositivos.length === antes.aparatos + 1,
	`${antes.aparatos} → ${(await qa('proyecto')).dispositivos.length} aparatos`);

/*
 * Y AHORA EL CAMINO BUENO, que es lo que impide que todo lo de arriba se cumpla por no hacer nada.
 *
 * Una transacción que no apuntara NUNCA en el historial pasaría las cinco comprobaciones del fallo
 * sin despeinarse. Así que se abre el mismo archivo sin romper nada: tiene que entrar de verdad,
 * dejar su paso de deshacer, vaciar el de rehacer —eso es lo correcto tras un cambio nuevo— y
 * quedar guardado en el navegador.
 */
console.log('\n--- abrir un archivo que SÍ se abre ---');
const previo = await qa('historial');
await p.evaluate((texto) => {
	const entrada = document.getElementById('archivo-abrir');
	const dt = new DataTransfer();
	dt.items.add(new File([texto], 'otro.tablero.json', { type: 'application/json' }));
	entrada.files = dt.files;
	entrada.dispatchEvent(new Event('change', { bubbles: true }));
}, otro);
await p.waitForTimeout(500);
if (await p.isVisible('#modal-dialogo')) await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
await p.waitForTimeout(1200);

const bueno = {
	historial: await qa('historial'),
	nombre: (await qa('proyecto')).nombre,
	guardado: await qa('autoguardado'),
};
console.log(`tras abrirlo bien: deshacer=${bueno.historial.deshacer} rehacer=${bueno.historial.rehacer} nombre=${bueno.nombre}`);
must('el archivo se abre de verdad', bueno.nombre === 'EL QUE NO SE DEBE ABRIR', bueno.nombre);
must('deja su paso de deshacer', bueno.historial.deshacer === previo.deshacer + 1,
	`${previo.deshacer} → ${bueno.historial.deshacer}`);
must('vacía el rehacer, como cualquier cambio nuevo', bueno.historial.rehacer === 0,
	String(bueno.historial.rehacer));
must('queda guardado en el navegador', (bueno.guardado ?? '').includes('EL QUE NO SE DEBE ABRIR'));
await p.evaluate(() => document.getElementById('btn-deshacer')?.click()); await p.waitForTimeout(400);
must('y se puede deshacer la apertura', (await qa('proyecto')).nombre !== 'EL QUE NO SE DEBE ABRIR',
	(await qa('proyecto')).nombre);

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ===`);
await b.close(); servidor.close();
process.exit(fallos === 0 ? 0 : 1);
