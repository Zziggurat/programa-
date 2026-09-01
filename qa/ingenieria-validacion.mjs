/** Gate I/J: recorrido visible de validación, circuitos, protecciones y potencia V7. */
import { chromium } from 'playwright-core';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now(); let servidor; let browser; let page; let fallos = 0; let comprobaciones = 0;
const erroresJS = []; const debugLog = join(process.cwd(), 'debug.log'); const debugLogExistia = existsSync(debugLog);
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';

function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++; if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}
async function click(id) { const b = page.locator(`#${id}`); await b.waitFor({ state: 'visible' }); await b.click(); }
async function abrirEjemplo() {
	if (await page.locator('#inicio').isVisible().catch(() => false)) await click('inicio-ejemplos');
	else { await click('btn-aprender'); await click('btn-ejemplos'); }
	await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
	const tarjeta = page.locator('.tarjeta-ejemplo', { hasText: 'Fixture V5: caída de tensión' }).first();
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	await Promise.race([
		page.locator('#modal-dialogo').waitFor({ state: 'visible', timeout: 1_200 }).then(() => true).catch(() => false),
		page.waitForFunction(() => window.qa.proyecto().nombre === 'Fixture V5 — caída de tensión', null, { timeout: 1_200 }).then(() => true).catch(() => false),
	]);
	if (await page.locator('#modal-dialogo').isVisible().catch(() => false)) await click('dialogo-ok');
	await page.waitForFunction(() => window.qa.proyecto().nombre === 'Fixture V5 — caída de tensión', null, { timeout: 30_000 });
	if (await page.locator('#modal-explicacion').isVisible().catch(() => false)) await click('btn-cerrar-explicacion');
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor; browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
	page.on('pageerror', (e) => erroresJS.push(e.message));
	page.on('console', (m) => { if (m.type() === 'error') erroresJS.push(`console: ${m.text()}`); });
	await page.goto(`${entorno.url}/?qa=1`, { waitUntil: 'domcontentloaded' }); await esperarEditorListo(page);
	await abrirEjemplo();

	await click('hta-ingenieria');
	comprobar('Ingeniería abre como panel contextual', await page.locator('#seccion-ingenieria').isVisible());
	comprobar('explica la condición estática sin exigir Energizar', /No hace falta energizar.*protecciones y polos de potencia cerrados/is.test(await page.locator('#ingenieria-contenido').innerText()));
	await click('ingenieria-validar');
	await page.locator('[data-ing-circuit-inspector]').waitFor({ state: 'visible' });
	comprobar('Validar Proyecto publica snapshot derivado no persistido', /Snapshot derivado.*no persistido/i.test(await page.locator('#ingenieria-estado').innerText()));
	comprobar('Circuit Inspector muestra fuente, protección, I, ΔV, P/Q/S y PF', /Fuente.*Protecciones.*I.*ΔV.*Icc.*P \/ Q \/ S.*PF/s.test(await page.locator('[data-ing-circuit-inspector]').innerText()));
	const circuitos = await page.locator('[data-ing-circuit]').count(); comprobar('vista deriva al menos un circuito', circuitos > 0, String(circuitos));
	await page.locator('[data-ing-view="validacion"]').click();
	const center = await page.locator('[data-ing-issue-center]').innerText();
	comprobar('Issue Center separa errores, advertencias, información e indeterminadas', /Errores.*Advertencias.*Información.*Indeterminadas/s.test(center), center);
	const issues = page.locator('[data-ing-issue-card]'); comprobar('issues tienen código estable y estado', await issues.count() > 0
		&& /TS-.*(?:FAIL|WARNING|INDETERMINATE)/s.test(await issues.first().innerText()));
	await page.locator('[data-ing-filter="category"]').selectOption('PROTECTION');
	comprobar('filtro por categoría deja issues de protección', await page.locator('[data-ing-issue-card]').count() > 0);
	const localizar = page.locator('[data-ing-issue-card] [data-ing-device]').first();
	if (await localizar.count()) await localizar.click();
	else await page.locator('[data-ing-issue-card]').first().click();
	const navegacion = await page.evaluate(() => window.qa.seleccion());
	comprobar('click en issue navega a una entidad relacionada', !!navegacion || await page.locator('[data-ing-circuit-inspector]').isVisible(), JSON.stringify(navegacion));

	await page.locator('[data-ing-view="protecciones"]').click();
	const proteccion = page.locator('[data-ing-protection-card]').first(); await proteccion.waitFor({ state: 'visible' });
	comprobar('protección muestra magnitudes y datos faltantes sin inventar Icu', /I diseño.*In.*I \/ In.*I startup.*Icc.*Icn \/ Icu \/ Ics.*Curva/s.test(await proteccion.innerText()));
	const curva = await proteccion.innerText();
	comprobar('time-current view consume puntos y provenance calculados', /I \/ In.*t mín.*t máx/s.test(curva) && /ESTIMADO/.test(curva), curva);
	await page.locator('[data-ing-view="potencia"]').click();
	const potencia = await page.locator('[data-ing-power]').innerText();
	comprobar('potencia muestra P/Q/S/PF, pérdidas, circuitos y frontera anti-double-count', /P.*Q.*S.*PF.*Pérdidas.*FUENTES_EXTERNAS_CONFIGURADAS.*Por circuito/s.test(potencia), potencia.slice(0, 700));
	comprobar('no hubo errores JavaScript', erroresJS.length === 0, erroresJS.slice(0, 4).join(' | '));
} catch (error) {
	fallos++; console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	try { await page?.close(); } catch (e) { fallos++; console.error(e); }
	try { await browser?.close(); } catch (e) { fallos++; console.error(e); }
	if (servidor) try { servidor.closeAllConnections?.(); await new Promise((ok, no) => servidor.close((e) => e ? no(e) : ok())); } catch (e) { fallos++; console.error(e); }
	if (!debugLogExistia && existsSync(debugLog)) try { unlinkSync(debugLog); } catch (e) { fallos++; console.error(e); }
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE; else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}
console.log(`\n=== ${fallos ? `${fallos} FALLO(S) ✗` : 'TODO OK ✔'} · ${comprobaciones} comprobaciones · ${((Date.now()-inicio)/1000).toFixed(1)} s ===`);
process.exitCode = fallos ? 1 : 0;
