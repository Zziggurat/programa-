/**
 * PRUEBA DE FUEGO SOBRE EL ARCHIVO QUE SE ENTREGA.
 *
 * Es la última puerta antes de dar el programa por entregable.
 *
 * No sobre `app/dist` —que es el de desarrollo— sino sobre `dist-final/TableroStudio.html`, que es
 * el archivo único que va a abrir el compañero con doble clic. Hace lo que haría él el primer día:
 * abrir, cargar un tablero, poner su empresa y su color, elegir Carta, mover un apartado y
 * descargarse el PDF. Si algo de eso falla, no se entrega.
 *
 *   node qa/entrega.mjs
 */
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, trabajarSobreCopia } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, '..', 'dist-final', 'TableroStudio.html');

const browser = await abrirNavegador(chromium);
const contexto = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await contexto.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };

console.log(`\n=== Abriendo el archivo entregado tal cual: ${ARCHIVO}\n`);
await page.goto('file://' + ARCHIVO);
await page.waitForTimeout(1600);

console.log('--- 1. Arranca ---');
must('abre sin errores de JavaScript', errs.length === 0, errs.slice(0, 2).join(' | '));
must('sale la ventana de inicio', await page.isVisible('#inicio'));

// Entrar por «tableros» y cargar el ejemplo, como haría cualquiera el primer día.
await page.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
await page.waitForTimeout(500);
if (await page.isVisible('#modal-ejemplos')) {
	await page.evaluate(() => document.querySelectorAll('.tarjeta-ejemplo button')[2]?.click());
	await page.waitForTimeout(2000);
}
if (await page.isVisible('#modal-dialogo')) {
	await page.evaluate(() => document.getElementById('dialogo-ok')?.click());
	await page.waitForTimeout(400);
}
// Cerrar lo que se haya abierto encima, con Escape (que es uno de los arreglos).
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
// El dossier personalizado ESCRIBE en el proyecto, y un ejemplo es de solo lectura: sin la copia,
// lo que se teclea se descarta en silencio y el archivo guardado sale sin la empresa dentro.
await trabajarSobreCopia(page);
must('se carga un tablero de ejemplo', await page.evaluate(() =>
	document.querySelectorAll('#lista-aparatos li, #panel-der li').length > 0
	|| !document.getElementById('escena')?.hidden));

console.log('\n--- 2. Escape cierra las ventanas (el fallo que se arregló) ---');
for (const [boton, modal] of [['btn-ayuda', 'modal-ayuda'], ['btn-datos-proyecto', 'modal-proyecto']]) {
	await page.evaluate((b) => document.getElementById(b)?.click(), boton);
	await page.waitForTimeout(450);
	const abrio = await page.evaluate((m) => !document.getElementById(m)?.hidden, modal);
	await page.keyboard.press('Escape');
	await page.waitForTimeout(350);
	const cerro = await page.evaluate((m) => !!document.getElementById(m)?.hidden, modal);
	must(`«${modal}» abre y se cierra con Escape`, abrio && cerro, `abrió=${abrio} cerró=${cerro}`);
}

console.log('\n--- 3. Personalizar el dossier como lo haría él ---');
await page.evaluate(() => document.getElementById('btn-pdf')?.click());
await page.waitForTimeout(4500);
must('el panel del dossier abre y enseña el PDF', await page.evaluate(() =>
	!document.getElementById('panel-dossier')?.hidden && !!document.querySelector('#dos-vista iframe')));

await page.fill('#dos-empresa-nombre', 'ElectroCubierta SpA');
await page.dispatchEvent('#dos-empresa-nombre', 'change');
await page.waitForTimeout(4000);
await page.fill('#dos-empresa-contacto', 'Santiago · +56 9 1234 5678');
await page.dispatchEvent('#dos-empresa-contacto', 'change');
await page.waitForTimeout(4000);
await page.evaluate(() => {
	const c = document.getElementById('dos-color');
	c.value = '#0d7a5f'; c.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(4000);
await page.selectOption('#dos-papel', 'carta');
await page.waitForTimeout(4500);
// Subir un apartado con la flecha.
await page.evaluate(() => document.querySelector('#dos-secciones [data-sube="3"]')?.click());
await page.waitForTimeout(4500);

must('el panel sigue enseñando el PDF tras todos los cambios',
	await page.evaluate(() => !!document.querySelector('#dos-vista iframe')));
must('sin errores de JavaScript al personalizar', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('\n--- 4. Se descarga el PDF ---');
const descarga = page.waitForEvent('download', { timeout: 30000 });
await page.evaluate(() => document.getElementById('dos-descargar')?.click());
const bajado = await descarga;
const ruta = await bajado.path();
const { statSync } = await import('node:fs');
const bytes = ruta ? statSync(ruta).size : 0;
must('el PDF se descarga', !!bajado.suggestedFilename(), bajado.suggestedFilename());
must('y pesa lo que pesa un dossier de verdad', bytes > 80_000, `${Math.round(bytes / 1024)} KB`);

// Mirar DENTRO del PDF descargado: tiene que llevar la empresa y ser de tamaño Carta.
const crudo = ruta ? (await import('node:fs')).readFileSync(ruta, 'latin1') : '';
must('el PDF descargado lleva el nombre de la empresa', crudo.includes('ElectroCubierta SpA'));
must('y ya no dice «TableroStudio»', !crudo.includes('TableroStudio'));
must('y sale en papel Carta', /MediaBox\s*\[\s*0\s+0\s+612\.?\d*\s+792\.?\d*/.test(crudo));
must('sin caracteres que la fuente no sepa dibujar', crudo.includes('estrella->tri'));

console.log('\n--- 5. Se guarda el proyecto (con la personalización dentro) ---');
await page.evaluate(() => document.getElementById('dos-cerrar')?.click());
await page.waitForTimeout(600);
const guardado = page.waitForEvent('download', { timeout: 20000 });
await page.evaluate(() => document.getElementById('btn-guardar')?.click());
const archivoProy = await guardado;
const rutaProy = await archivoProy.path();
const json = rutaProy ? JSON.parse((await import('node:fs')).readFileSync(rutaProy, 'utf8')) : {};
must('el proyecto se guarda', !!archivoProy.suggestedFilename(), archivoProy.suggestedFilename());
must('y se lleva la empresa dentro', json.dossier?.empresa?.nombre === 'ElectroCubierta SpA',
	JSON.stringify(json.dossier?.empresa ?? null));
must('y el papel y el color', json.dossier?.papel === 'carta' && json.dossier?.color === '#0d7a5f',
	`${json.dossier?.papel} · ${json.dossier?.color}`);
must('y el orden de los apartados', Array.isArray(json.dossier?.orden) && json.dossier.orden.length > 0,
	String(json.dossier?.orden));

console.log('\n--- 6. Nada roto en todo el recorrido ---');
must('cero errores de JavaScript de principio a fin', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: join(AQUI, '_entrega.png') });
await browser.close();
console.log(`\n=== ${fallos === 0 ? 'EL ARCHIVO ENTREGADO ESTÁ LISTO ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
