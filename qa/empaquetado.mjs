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
import { abrirNavegador, trabajarSobreCopia } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, '..', 'dist-final', 'TableroStudio.html');
const ARCHIVO_DESKTOP = join(AQUI, '..', 'desktop', 'app.html');
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
const htmlDesktop = existsSync(ARCHIVO_DESKTOP) ? readFileSync(ARCHIVO_DESKTOP, 'utf8') : '';
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
const buildId = html.match(/<meta name="tablerostudio-build" content="([A-F0-9]{10})">/)?.[1];
must('declara un Build ID de contenido', !!buildId, buildId ?? 'ausente');
must('la entrega V6 tiene un Build ID nuevo respecto de V5', buildId !== 'B5303F6750', buildId ?? 'ausente');
must('desktop/app.html corresponde byte a byte a la misma build', htmlDesktop === html,
	htmlDesktop ? `Build ${buildId}` : 'desktop/app.html ausente');
// El marcado de los diálogos vive en index.html: comprobamos que el empaquetador lo copió.
for (const id of ['modal-proyecto', 'modal-controlador', 'modal-drc', 'modal-ayuda',
	'modal-ejemplos', 'seccion-termico', 'estado-guardado', 'menu-archivo', 'inicio', 'mundo']) {
	must(`conserva el marcado de #${id}`, html.includes(`id="${id}"`));
}

/* ---------- 2. Arranca de verdad, abierto con doble clic ---------- */
console.log('\n--- 2. Arranca abriéndolo con doble clic (file://) ---');
let browser;
let page;
const errs = [];
const peticionesExternas = [];
try {
browser = await abrirNavegador(chromium);
page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
	if (m.type() !== 'error' || /favicon|404/i.test(m.text())) return;
	const origen = m.location().url ? ` @ ${m.location().url}:${m.location().lineNumber ?? 0}` : '';
	errs.push(m.text() + origen);
});
page.on('request', (peticion) => {
	if (/^https?:/i.test(peticion.url())) peticionesExternas.push(peticion.url());
});

await page.goto(`file://${ARCHIVO}`, { waitUntil: 'load' });
await page.waitForTimeout(2200);

must('la aplicación arranca sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
must('el Build ID del archivo está disponible en runtime',
	await page.evaluate((id) => window.__TABLEROSTUDIO_BUILD_ID__ === id, buildId), buildId);

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
const energizarVisible = async (queremos) => {
	const boton = page.locator('#btn-energizar');
	const activo = await boton.evaluate((el) => el.classList.contains('activo'));
	if (activo !== queremos) await boton.click();
	await page.waitForFunction((esperado) =>
		document.getElementById('btn-energizar')?.classList.contains('activo') === esperado, queremos);
};
await cerrar('btn-cerrar-ayuda'); await page.waitForTimeout(200);

await page.click('#btn-aprender');
await page.click('#btn-ayuda');
must('el mismo Build ID aparece discretamente en Acerca de',
	(await page.locator('#acerca-de').innerText()).includes(buildId), await page.locator('#acerca-de').innerText());
await cerrar('btn-cerrar-ayuda');

must('está el catálogo de aparatos', await page.evaluate(
	() => document.querySelectorAll('#catalogo .item-catalogo').length > 20));
must('está la barra con sus herramientas', await page.evaluate(
	() => document.querySelectorAll('#barra button').length > 10));
must('Energizar y sus controles V2/V3 forman parte del entregable',
	await page.isVisible('#btn-energizar') && await page.locator('#sim-velocidad').count() === 1
		&& await page.locator('#sim-sondas').count() === 1 && await page.locator('#sim-fallos').count() === 1);

// IndexedDB y Mis Tableros se ejercitan antes de abrir un ejemplo: no basta con que exista el botón.
const idbFunciona = await page.evaluate(() => new Promise((resolve) => {
	const req = indexedDB.open('qa-entrega-idb', 1);
	req.onupgradeneeded = () => req.result.createObjectStore('datos');
	req.onerror = () => resolve(false);
	req.onsuccess = () => {
		const db = req.result;
		const tx = db.transaction('datos', 'readwrite');
		tx.objectStore('datos').put('ok', 'clave');
		tx.oncomplete = () => { db.close(); resolve(true); };
		tx.onerror = () => { db.close(); resolve(false); };
	};
}));
must('IndexedDB permite una transacción real bajo file://', idbFunciona);
await page.click('#btn-archivo'); await page.click('#btn-mis-tableros');
await page.locator('#modal-tableros').waitFor({ state: 'visible' });
must('Mis Tableros abre la biblioteca persistente', await page.isVisible('#btn-nuevo-biblioteca'));
await page.click('#btn-nuevo-biblioteca');
await page.locator('#modal-tableros').waitFor({ state: 'hidden' });
await page.locator('#nombre-proyecto').fill('QA Entrega Offline');
await page.locator('#nombre-proyecto').press('Tab');
await page.waitForTimeout(500);
await page.click('#btn-archivo'); await page.click('#btn-mis-tableros');
await page.locator('#modal-tableros').waitFor({ state: 'visible' });
must('el nombre escrito persiste y aparece en Mis Tableros',
	await page.locator('.tarjeta-documento', { hasText: 'QA Entrega Offline' }).count() === 1);
await page.locator('#btn-cerrar-tableros').click();

/* ---------- 3. Se puede trabajar: añadir, verificar, ver el térmico ---------- */
console.log('\n--- 3. Se puede trabajar con él ---');
await page.click('#btn-empezar-ejemplo'); await page.waitForTimeout(400);
await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(1200);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await cerrar('btn-cerrar-explicacion'); await page.waitForTimeout(300);
// Más abajo se añade un aparato del catálogo, y un ejemplo es de solo lectura: se trabaja sobre
// una copia, igual que hace el usuario con «Hacer una copia para trabajar».
await trabajarSobreCopia(page);
// La copia puede repintar la explicación del ejemplo en equipos lentos; se cierra después de que
// la transición haya terminado, antes de usar la herramienta visible Añadir.
await cerrar('btn-cerrar-explicacion');

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
await page.click('#hta-anadir'); await page.waitForTimeout(400);
must('en modo Editor vuelve el catálogo', await page.isVisible('#catalogo'));
// Añadir un aparato no navega. En Chromium/Windows el autocierre del panel puede dejar una
// navegación espuria pendiente; esperar por ella agota 30 s aunque el clic ya se haya ejecutado.
await page.locator('#catalogo .item-catalogo').first().click({ noWaitAfter: true }); await page.waitForTimeout(600);
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

/* ---------- 5. El vertical slice V3 existe también en el artefacto offline ---------- */
console.log('\n--- 5. Instrumentación V3 dentro del HTML entregado ---');
await page.click('#btn-aprender');
await page.click('#btn-ejemplos');
await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
await page.locator('.tarjeta-ejemplo', { hasText: 'Fixture V3: temperatura, PLC y válvula' })
	.getByRole('button', { name: /Abrir y estudiar/i }).click();
if (await page.isVisible('#modal-dialogo')) { await page.click('#dialogo-ok'); }
await page.waitForFunction(() => document.getElementById('nombre-proyecto')?.value
	=== 'Fixture V3 — temperatura, PLC y válvula modulante');
await cerrar('btn-cerrar-explicacion');
await energizarVisible(true);
await page.locator('#sim-sondas input[data-sonda="tt1"]').waitFor();
const panelV3 = (await page.locator('#sim-controladores').innerText()).replace(/\s+/g, ' ');
const aoV3 = (await page.locator('#sim-funcionando .analogica', { hasText: '-A1:AO1' }).innerText()).replace(/\s+/g, ' ');
must('el HTML offline ejecuta 50 °C → 12 mA → AI 50 °C',
	/AI1:\s*12\.00 mA\s*→\s*50\.0 °C/.test(panelV3), panelV3);
must('el HTML offline ejecuta AO=6 V y válvula modulante',
	/6\.00 V\s*·\s*60 %/.test(aoV3)
		&& /comando 60 %/.test(await page.locator('#sim-funcionando .posicion-carga').innerText()), aoV3);
must('la UI offline ofrece el fallo de lazo V3',
	await page.locator('#sim-fallos select[data-fallo="tt1"] option[value="circuito-analogico-abierto"]').count() === 1);

/* ---------- 6. El runtime PLC V4 también viaja dentro del HTML ---------- */
console.log('\n--- 6. Automatización PLC V4 dentro del HTML entregado ---');
// La escena V3 sigue energizada: se detiene por el mismo botón visible antes de cambiar de ejemplo.
await energizarVisible(false);
await page.click('#btn-aprender');
await page.click('#btn-ejemplos');
await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
await page.locator('.tarjeta-ejemplo', { hasText: 'Fixture V4: PLC y proceso secuencial' })
	.getByRole('button', { name: /Abrir y estudiar/i }).click();
if (await page.isVisible('#modal-dialogo')) { await page.click('#dialogo-ok'); }
await page.waitForFunction(() => document.getElementById('nombre-proyecto')?.value
	=== 'Fixture V4 — proceso secuencial de tanque');
await cerrar('btn-cerrar-explicacion');
if (!await page.evaluate(() => document.body.classList.contains('modo-trabajo'))) {
	await page.click('#modo-trabajo');
	await page.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
}
await energizarVisible(true);
try {
	await page.waitForFunction(() => {
		const panel = document.querySelector('#sim-controladores');
		const texto = panel instanceof HTMLElement ? panel.innerText : '';
		const scan = /scan\s+(\d+)/i.exec(texto);
		return /\bRUN\b/.test(texto) && Number(scan?.[1] ?? 0) >= 1;
	});
} catch {
	const detalle = await page.evaluate(() => ({
		modo: document.body.className,
		energizar: document.getElementById('btn-energizar')?.className ?? 'ausente',
		panel: document.getElementById('sim-controladores')?.textContent?.replace(/\s+/g, ' ').slice(0, 800) ?? 'ausente',
	}));
	throw new Error(`el PLC V4 offline no alcanzó RUN/scan: ${JSON.stringify(detalle)}`);
}
const panelV4 = (await page.locator('#sim-controladores').innerText()).replace(/\s+/g, ' ');
must('el HTML offline ejecuta PLC V4 en RUN con scan observable',
	/\bRUN\b/.test(panelV4) && /scan\s+[1-9]\d*/i.test(panelV4), panelV4.slice(0, 180));
must('el monitor offline publica secuencia, TON y CTU V4',
	/PROCESO:\s*IDLE/.test(panelV4) && /T_MEZCLA:\s*TON/.test(panelV4)
		&& /LOTES:\s*CTU/.test(panelV4), panelV4.slice(0, 260));

/* ---------- 7. Magnitudes físicas V5 dentro del HTML entregado ---------- */
console.log('\n--- 7. Física eléctrica V5 dentro del HTML entregado ---');
await energizarVisible(false);
await page.click('#btn-aprender');
await page.click('#btn-ejemplos');
await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
await page.locator('.tarjeta-ejemplo', { hasText: 'Fixture V5: caída de tensión' })
	.getByRole('button', { name: /Abrir y estudiar/i }).click();
if (await page.isVisible('#modal-dialogo')) { await page.click('#dialogo-ok'); }
await page.waitForFunction(() => document.getElementById('nombre-proyecto')?.value
	=== 'Fixture V5 — caída de tensión');
await cerrar('btn-cerrar-explicacion');
if (!await page.evaluate(() => document.body.classList.contains('modo-trabajo'))) {
	await page.click('#modo-trabajo');
	await page.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
}
await energizarVisible(true);
await page.waitForFunction(() => /PhysicsEngine V6/.test(document.getElementById('sim-fisica')?.innerText ?? ''));
const panelV5 = (await page.locator('#sim-fisica').innerText()).replace(/\s+/g, ' ');
must('el HTML offline resuelve y muestra tensión, corriente y caída V5',
	/PhysicsEngine V6/.test(panelV5) && /I\s+[0-9,.]+\s*A/.test(panelV5)
		&& /ΔV\s+[0-9,.]+\s*V/.test(panelV5) && /balance\s+[0-9,.]+\s*W/.test(panelV5),
	panelV5.slice(0, 300));
must('el smoke V5 conserva controles humanos de longitud y sección',
	await page.locator('#sim-fisica [data-fisica-longitud="w-fase-carga"]').isVisible()
		&& await page.locator('#sim-fisica [data-fisica-seccion="w-fase-carga"]').isVisible());

/* ---------- 8. Instrumentos, análisis e informe V6 dentro del HTML entregado ---------- */
console.log('\n--- 8. Equipos y diagnóstico V6 dentro del HTML entregado ---');
await energizarVisible(false);
await page.click('#btn-aprender');
await page.click('#btn-ejemplos');
await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
await page.locator('.tarjeta-ejemplo', { hasText: 'Fixture V6: transformador bajo carga' })
	.getByRole('button', { name: /Abrir y estudiar/i }).click();
if (await page.isVisible('#modal-dialogo')) { await page.click('#dialogo-ok'); }
await page.waitForFunction(() => document.getElementById('nombre-proyecto')?.value
	=== 'Fixture V6 — transformador bajo carga');
await cerrar('btn-cerrar-explicacion');
if (!await page.evaluate(() => document.body.classList.contains('modo-trabajo'))) {
	await page.click('#modo-trabajo');
	await page.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
}
await energizarVisible(true);
await page.locator('[data-analisis-equipo]').selectOption('t1');
await page.locator('[data-analisis-ejecutar]').click();
await page.waitForFunction(() => /Tensión primaria.*Corriente primaria.*Tensión secundaria.*Corriente secundaria/s
	.test(document.querySelector('[data-analisis-resultado]')?.textContent ?? ''));
const panelV6 = (await page.locator('#sim-fisica').innerText()).replace(/\s+/g, ' ');
const resultadoV6 = (await page.locator('[data-analisis-resultado]').innerText()).replace(/\s+/g, ' ');
must('el HTML offline incluye instrumentos y análisis V6 sobre el solver',
	/Instrumentos V6/.test(panelV6) && /ANALIZAR CIRCUITO \/ EQUIPO/.test(panelV6)
		&& /Tensión primaria.*Corriente primaria.*Tensión secundaria.*Corriente secundaria/.test(resultadoV6),
	panelV6.slice(0, 360));
const informeEsperado = page.waitForEvent('download', { timeout: 30_000 });
await page.locator('[data-analisis-exportar]').click();
const informeDescarga = await informeEsperado; const rutaInforme = await informeDescarga.path();
const informeHtml = rutaInforme ? readFileSync(rutaInforme, 'utf8') : '';
must('el informe V6 offline lleva Build ID, trazabilidad, provenance y limitaciones sin scripts',
	informeHtml.includes(buildId) && /EJEMPLO_EFIMERO/.test(informeHtml)
		&& /Provenance/.test(informeHtml) && /Limitaciones/.test(informeHtml) && !/<script\b/i.test(informeHtml));

must('no hizo ninguna petición HTTP externa obligatoria', peticionesExternas.length === 0,
	peticionesExternas.slice(0, 3).join(' | '));

must('sigue sin errores de JavaScript después de trabajar', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: join(AQUI, '_salida', 'empaquetado.png') });
} catch (error) {
	fallos++;
	console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	try { await page?.close(); } catch (error) { fallos++; console.error(`No se pudo cerrar la página: ${error.message}`); }
	try { await browser?.close(); } catch (error) { fallos++; console.error(`No se pudo cerrar Chromium: ${error.message}`); }
}
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
