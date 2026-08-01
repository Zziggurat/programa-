/**
 * QA del ARCHIVO QUE SE ENTREGA.
 *
 * Todas las demás pruebas trabajan sobre `app/dist`, que es lo que produce Vite: varios
 * archivos servidos por un servidor. Pero lo que abre el usuario no es eso — es
 * `dist-final/TableroStudio.html`, un único archivo que el empaquetador arma pegando el estilo,
 * el cuerpo y el bundle. Entre una cosa y la otra hay un paso que nadie estaba comprobando: si
 * el empaquetador se dejara el marcado de un diálogo nuevo, o el bundle, o el estilo, la
 * aplicación entregada saldría rota y todas las demás pruebas seguirían en verde.
 *
 * Aquí se abre EL ARCHIVO ENTREGADO, con file:// y sin servidor —tal cual lo abre él de un
 * doble clic— y se comprueba que arranca y hace su trabajo. La sonda `window.qa` no existe en
 * este build (se borra a propósito), así que todo se comprueba por el DOM, que es exactamente
 * lo que ve el usuario.
 *
 *   npm run empaquetar && node qa/empaquetado.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, '..', 'dist-final', 'TableroStudio.html');
mkdirSync(join(AQUI, '_salida'), { recursive: true });

if (!existsSync(ARCHIVO)) {
	console.error(`No existe ${ARCHIVO}. Ejecuta antes: npm run empaquetar`);
	process.exit(1);
}

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };

/* ---------- 1. El archivo en sí ---------- */
console.log('--- 1. El archivo que se entrega ---');
const html = readFileSync(ARCHIVO, 'utf8');
const kb = Math.round(html.length / 1024);
must('el archivo pesa lo que pesa una aplicación completa', html.length > 1_000_000, `${kb} KB`);
must('lleva el estilo dentro', /<style>[\s\S]{2000,}<\/style>/.test(html));
must('lleva el bundle dentro', /<script type="module">[\s\S]{100000,}<\/script>/.test(html));
// Solo el MARCADO, sin el bundle: dentro del código de jsPDF hay cadenas como `<script src="`
// (su ayudante para abrir el PDF en otra ventana) que no son referencias externas de la página.
const marcado = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '<script type="module"></script>');
must('no quedan referencias a archivos externos',
	!/<script[^>]+src=|<link[^>]+stylesheet|https?:\/\//i.test(marcado));
// Si esto falla, el empaquetado lleva dentro el andamiaje de las pruebas.
must('no lleva dentro la sonda de pruebas', !html.includes('puntoParaAgarrar'));
// El marcado de los diálogos vive en index.html: comprobamos que el empaquetador lo copió.
for (const id of ['modal-proyecto', 'modal-controlador', 'modal-drc', 'modal-ayuda',
	'modal-ejemplos', 'seccion-termico', 'estado-guardado', 'menu-archivo', 'inicio', 'mundo']) {
	must(`conserva el marcado de #${id}`, html.includes(`id="${id}"`));
}

/* ---------- 2. Arranca de verdad, abierto con doble clic ---------- */
console.log('\n--- 2. Arranca abriéndolo con doble clic (file://) ---');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

await page.goto(`file://${ARCHIVO}`, { waitUntil: 'load' });
await page.waitForTimeout(2200);

must('la aplicación arranca sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

// Lo PRIMERO que se ve al abrir es la ventana de inicio, no el gabinete: aquí se elige
// herramienta. Es el único sitio donde se prueba tal cual lo vive el usuario, porque el resto
// de las suites entran con `?inicio=0` para no repetir el clic cientos de veces.
must('abre en la ventana de inicio, no en el gabinete', await page.isVisible('#inicio'));
must('ofrece las dos herramientas', await page.isVisible('#inicio-tableros') && await page.isVisible('#inicio-terreno'));
await page.click('#inicio-tableros'); await page.waitForTimeout(500);
must('«Trabajo de tableros» entra al editor', !(await page.isVisible('#inicio')));

must('se dibuja el tablero en 3D', await page.evaluate(() => !!document.querySelector('#escena canvas')));
must('el lienzo tiene tamaño real', await page.evaluate(() => {
	const c = document.querySelector('#escena canvas');
	return !!c && c.clientWidth > 400 && c.clientHeight > 300;
}));

const cerrar = async (id) => { if (await page.isVisible(`#${id}`)) await page.click(`#${id}`); };
await cerrar('btn-cerrar-ayuda'); await page.waitForTimeout(200);

must('está el catálogo de aparatos', await page.evaluate(
	() => document.querySelectorAll('#catalogo .item-catalogo').length > 20));
must('está la barra con sus herramientas', await page.evaluate(
	() => document.querySelectorAll('#barra button').length > 10));

/* ---------- 3. Se puede trabajar: añadir, verificar, ver el térmico ---------- */
console.log('\n--- 3. Se puede trabajar con él ---');
await page.click('#btn-empezar-ejemplo'); await page.waitForTimeout(400);
await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(1200);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await cerrar('btn-cerrar-explicacion'); await page.waitForTimeout(300);

const aparatos = await page.evaluate(() => document.querySelectorAll('#lista-dispositivos li').length);
must('se carga un tablero de ejemplo con sus aparatos', aparatos > 5, `${aparatos} aparatos`);
must('la verificación eléctrica responde',
	(await page.textContent('#chip-drc-texto')).trim().length > 0,
	(await page.textContent('#chip-drc-texto')).trim());

await page.evaluate(() => { const d = document.getElementById('seccion-termico'); if (d) d.open = true; });
await page.waitForTimeout(250);
const termico = (await page.textContent('#termico-veredicto')).trim();
must('el balance térmico se calcula', /\d+([.,]\d+)?\s*°C/.test(termico), termico.slice(0, 60));

// Añadir un aparato del catálogo: la interacción básica del programa. El ejemplo deja la
// aplicación en modo Trabajo, donde el catálogo está oculto a propósito (ahí solo se cablea).
await page.click('#modo-editor'); await page.waitForTimeout(400);
must('en modo Editor vuelve el catálogo', await page.isVisible('#catalogo'));
await page.locator('#catalogo .item-catalogo').first().click(); await page.waitForTimeout(600);
must('se puede añadir un aparato del catálogo',
	(await page.evaluate(() => document.querySelectorAll('#lista-dispositivos li').length)) > aparatos);

/* ---------- 4. Los entregables salen ---------- */
console.log('\n--- 4. Los entregables salen del archivo entregado ---');
/** `abridor` es el botón del menú desplegable donde vive la opción, si no está suelta en la barra. */
const bajar = async (selector, patron, abridor) => {
	if (abridor) { await page.click(abridor); await page.waitForTimeout(250); }
	const esperado = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
	await page.click(selector);
	const d = await esperado;
	if (!d) return { ok: false, nombre: '(no descargó)' };
	const destino = join(AQUI, '_salida', d.suggestedFilename());
	await d.saveAs(destino);
	return { ok: patron.test(d.suggestedFilename()), nombre: d.suggestedFilename(), bytes: readFileSync(destino).length };
};

// El botón 📄 abre la VISTA PREVIA del dossier; se descarga desde ella. Aquí se comprueba
// también que la vista previa funciona en el archivo entregado, sin sonda de pruebas.
await page.click('#btn-pdf');
await page.waitForFunction(
	() => /KB/.test(document.getElementById('dos-estado')?.textContent ?? ''), { timeout: 40000 });
must('la vista previa del dossier se abre en el archivo entregado', await page.isVisible('#panel-dossier'));
must('y enseña el PDF de verdad', await page.evaluate(() => {
	const f = document.querySelector('#dos-vista iframe');
	return !!f && f.src.startsWith('blob:');
}));
const pdf = await bajar('#dos-descargar', /\.pdf$/i);
must('exporta el dossier en PDF', pdf.ok && pdf.bytes > 30000, `${pdf.nombre} · ${pdf.bytes ?? 0} bytes`);
// La vista previa ocupa la pantalla entera: se cierra antes de seguir tocando el editor.
await page.click('#dos-cerrar');
await page.waitForTimeout(200);
must('la vista previa se cierra y se vuelve al tablero', !(await page.isVisible('#panel-dossier')));

const proyecto = await bajar('#btn-guardar', /\.json$/i, '#btn-archivo');
must('guarda el proyecto en un archivo', proyecto.ok && proyecto.bytes > 500,
	`${proyecto.nombre} · ${proyecto.bytes ?? 0} bytes`);

must('sigue sin errores de JavaScript después de trabajar', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: join(AQUI, '_salida', 'empaquetado.png') });
await browser.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
