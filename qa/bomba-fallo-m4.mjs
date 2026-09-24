/** SIM-03: una boya con salida abierta de ensayo detiene la bomba por el mando cableado. */
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-bomba-fallo-m4-'));
const cwd = process.cwd();
const logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let browser, servidor, page, checks = 0, fallos = 0;
const erroresJS = [];
const ok = (nombre, pasa) => {
	checks++;
	if (!pasa) fallos++;
	console.log(`${pasa ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const foto = () => page.evaluate(() => window.qa.simulacion());

try {
	const servicio = await servidorDeQA(); servidor = servicio.servidor;
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	page.setDefaultTimeout(30_000);
	page.on('pageerror', (error) => erroresJS.push(String(error)));
	page.on('console', (mensaje) => {
		if (mensaje.type() === 'error' && !/favicon|404/i.test(mensaje.text())) erroresJS.push(mensaje.text());
	});
	await page.goto(`${servicio.url}/?qa=1&inicio=0`);
	await esperarEditorListo(page);
	for (const id of ['btn-cerrar-ayuda', 'btn-cerrar-explicacion']) {
		if (await page.locator(`#${id}`).isVisible()) await page.locator(`#${id}`).click();
	}
	if (await page.locator('#btn-empezar-ejemplo').isVisible()) {
		await page.locator('#btn-empezar-ejemplo').click();
	} else {
		await page.locator('#btn-archivo').click();
		await page.locator('#btn-ejemplos').click();
	}
	const tarjeta = page.locator('.tarjeta-ejemplo').filter({ hasText: 'Bomba de agua con boya de nivel' }).first();
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await page.locator('#modal-dialogo').isVisible()) await page.locator('#dialogo-ok').click();
	await page.waitForFunction(() => window.qa.proyecto().nombre === 'Bomba de agua con boya de nivel');
	if (await page.locator('#btn-cerrar-explicacion').isVisible()) await page.locator('#btn-cerrar-explicacion').click();
	if (!(await page.evaluate(() => document.body.classList.contains('modo-trabajo')))) {
		await page.locator('#modo-trabajo').click();
	}
	ok('el ejemplo se abrió desde la biblioteca', (await page.evaluate(() => window.qa.proyecto().nombre))
		=== 'Bomba de agua con boya de nivel');

	await page.locator('#btn-energizar').click();
	await page.waitForFunction(() => window.qa.simulacion().energizado);
	const boya = page.locator('#sim-mandos button[data-mando="b1"]');
	await boya.click();
	await page.waitForFunction(() => window.qa.simulacion().activos.includes('m1'));
	ok('la boya cierra KM1 y arranca la bomba', (await foto()).activos.includes('km1'));
	const ensayo = page.locator('#sim-fallos select[data-fallo="b1"]');
	ok('el fallo específico se ofrece en la UI visible',
		await ensayo.locator('option[value="salida-sensor-abierta"]').count() === 1);
	await ensayo.selectOption('salida-sensor-abierta');
	await page.waitForFunction(() => !window.qa.simulacion().activos.includes('m1'));
	const fallado = await foto();
	ok('el fallo hace caer el contactor por el mando y detiene la bomba',
		!fallado.activos.includes('km1') && !fallado.activos.includes('m1') && !fallado.oscila);
	ok('el ensayo permanece en runtime, no en el diseño',
		(await page.evaluate(() => window.qa.estadoSim())).some((e) =>
			e.id === 'b1' && e.fallos?.includes('salida-sensor-abierta'))
		&& !JSON.stringify(await page.evaluate(() => window.qa.proyecto())).includes('salida-sensor-abierta'));
	await page.screenshot({ path: join(temporal, 'boya-salida-abierta.png') });
	await boya.click(); // quitar demanda ANTES de restaurar el sensor; evita un rearranque de control automático.
	await ensayo.selectOption('');
	await page.waitForFunction(() => !window.qa.simulacion().activos.includes('m1'));
	ok('sin demanda, retirar el ensayo deja la bomba parada', !(await foto()).activos.includes('m1'));
	await boya.click();
	await page.waitForFunction(() => window.qa.simulacion().activos.includes('m1'));
	ok('una nueva demanda después de reparar vuelve a arrancar', (await foto()).activos.includes('km1'));
	await page.locator('#btn-energizar').click();
	await page.waitForFunction(() => !window.qa.simulacion().energizado);
	ok('al apagar se limpia el estado runtime',
		(await page.evaluate(() => window.qa.estadoSim())).length === 0);
} catch (error) {
	fallos++; console.error('FAIL QA bomba-fallo-m4:', error.stack ?? error);
} finally {
	ok('sin errores JavaScript', erroresJS.length === 0);
	if (erroresJS.length) console.error(erroresJS);
	try { await browser?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwd);
	if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = logAnterior;
	console.log(`Captura: ${temporal}`);
	console.log(`QA bomba-fallo-m4: ${checks} comprobaciones, ${fallos} fallos, ${(Date.now() - inicio) / 1000} s`);
	process.exitCode = fallos ? 1 : 0;
}
