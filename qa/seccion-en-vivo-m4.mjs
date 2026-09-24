/** SIM-10: editar la sección de un cable desde Trabajo invalida la física energizada. */
import { chromium } from 'playwright-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-seccion-en-vivo-m4-'));
const cwd = process.cwd();
const logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let navegador, servidor, pagina, comprobaciones = 0, fallos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion, detalle = '') => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? `: ${detalle}` : ''}`);
};
const datos = () => pagina.evaluate(() => {
	const conductor = window.qa.proyecto().conductores.find((c) => c.id === 'w-fase-carga');
	const resultado = window.qa.simulacion().fisica?.conductores.find((c) => c.conductorId === 'w-fase-carga');
	return { seccionProyecto: conductor?.seccion, seccionFisica: resultado?.seccionMm2,
		resistencia: resultado?.rOhm, energizado: window.qa.simulacion().energizado };
});

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1500, height: 960 } });
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', (error) => erroresJS.push(error.message));
	pagina.on('console', (mensaje) => {
		if (mensaje.type() === 'error' && !/favicon|404/i.test(mensaje.text())) erroresJS.push(mensaje.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`);
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#inicio').isVisible()) await pagina.locator('#inicio-ejemplos').click();
	else { await pagina.locator('#btn-aprender').click(); await pagina.locator('#btn-ejemplos').click(); }
	const tarjeta = pagina.locator('.tarjeta-ejemplo').filter({ hasText: 'Fixture V5: caída de tensión' }).first();
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Fixture V5 — caída de tensión');
	if (await pagina.locator('#btn-cerrar-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	comprobar('el fixture abrió desde la biblioteca', (await datos()).seccionProyecto === 2.5);
	comprobar('la copia se monta antes de editar', await trabajarSobreCopia(pagina));
	if (!(await pagina.evaluate(() => document.body.classList.contains('modo-trabajo')))) {
		const boton = pagina.locator('#hta-conectar');
		await boton.waitFor({ state: 'visible' });
		const caja = await boton.boundingBox();
		if (!caja) throw new Error('Cablear no tiene área de clic visible');
		await pagina.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
		await pagina.waitForFunction(() => document.body.classList.contains('modo-trabajo'));
	}
	await pagina.locator('#btn-energizar').click();
	await pagina.waitForFunction(() => window.qa.simulacion().energizado);
	await pagina.waitForFunction(() => window.qa.simulacion().fisica?.conductores
		.some((c) => c.conductorId === 'w-fase-carga'));
	const antes = await datos();
	comprobar('el conductor inicialmente usa 2,5 mm² en proyecto y motor',
		antes.energizado && antes.seccionProyecto === 2.5 && antes.seccionFisica === 2.5);

	// La posición procede del documento, pero la selección y la edición son interacciones visibles.
	const indice = await pagina.evaluate(() => window.qa.proyecto().conductores.findIndex((c) => c.id === 'w-fase-carga'));
	if (indice < 0) throw new Error('falta w-fase-carga en el proyecto');
	await pagina.locator('#lista-cables li').nth(indice).click();
	await pagina.locator('#cbl-seccion').waitFor({ state: 'visible' });
	await pagina.locator('#cbl-seccion').selectOption('6');
	await pagina.waitForFunction(() => window.qa.simulacion().fisica?.conductores
		.find((c) => c.conductorId === 'w-fase-carga')?.seccionMm2 === 6);
	const despues = await datos();
	comprobar('el selector real persiste 6 mm²', despues.seccionProyecto === 6);
	comprobar('el motor energizado adopta la nueva sección sin reinicio',
		despues.energizado && despues.seccionFisica === 6 && despues.resistencia < antes.resistencia * 0.5,
		`R ${antes.resistencia} → ${despues.resistencia} Ω`);

	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores
		.find((c) => c.id === 'w-fase-carga')?.seccion === 2.5);
	await pagina.waitForFunction(() => window.qa.simulacion().fisica?.conductores
		.find((c) => c.conductorId === 'w-fase-carga')?.seccionMm2 === 2.5);
	const restaurado = await datos();
	comprobar('Undo restaura diseño y física en marcha',
		restaurado.energizado && restaurado.seccionProyecto === 2.5
		&& restaurado.seccionFisica === 2.5 && Math.abs(restaurado.resistencia - antes.resistencia) < 1e-9);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores
		.find((c) => c.id === 'w-fase-carga')?.seccion === 6);
	await pagina.waitForFunction(() => window.qa.simulacion().fisica?.conductores
		.find((c) => c.conductorId === 'w-fase-carga')?.seccionMm2 === 6);
	const rehecho = await datos();
	comprobar('Redo reaplica diseño y física en marcha',
		rehecho.energizado && rehecho.seccionProyecto === 6
		&& rehecho.seccionFisica === 6 && Math.abs(rehecho.resistencia - despues.resistencia) < 1e-9);
} catch (error) {
	fallos++; console.error('FAIL QA sección en vivo M4:', error.stack ?? error);
} finally {
	comprobar('sin errores JavaScript', erroresJS.length === 0, erroresJS.join(' | '));
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwd);
	if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = logAnterior;
	console.log(`QA sección en vivo M4: ${comprobaciones} comprobaciones, ${fallos} fallos, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
