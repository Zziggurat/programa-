/** MON-04 parcial: encontrar, seleccionar y enfocar sin alterar el tablero. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

let servidor, navegador, pagina;
let casos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
};

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1366, height: 850 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text()); });
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo', { hasText: 'Arranque directo de motor' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Arranque directo de motor 380 V');
	if (await pagina.locator('#modal-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	await pagina.locator('#hta-seleccionar').click();
	if (!await pagina.locator('#seccion-dispositivos').evaluate((e) => e.open))
		await pagina.locator('#seccion-dispositivos summary').click();
	const antes = await pagina.evaluate(() => JSON.stringify(window.qa.proyecto()));
	const total = await pagina.evaluate(() => window.qa.proyecto().dispositivos.filter((d) => !d.campo).length);
	comprobar('la lista inicia con todos los aparatos internos, sin cero ficticio',
		await pagina.locator('#lista-dispositivos li').count() === total
		&& await pagina.locator('#contador-dispositivos').innerText() === `(${total})`);
	await pagina.locator('#buscar-dispositivos').fill('linea motor');
	comprobar('la búsqueda sin acento encuentra por descripción con AND de términos',
		await pagina.locator('#lista-dispositivos li').count() === 1
		&& /Contactor de línea del motor/.test(await pagina.locator('#lista-dispositivos li').innerText())
		&& await pagina.locator('#contador-dispositivos').innerText() === `(1/${total})`);
	await pagina.locator('#lista-dispositivos li').first().click();
	comprobar('selección de la fila mantiene búsqueda y usa identidad del aparato',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'km1'
		&& await pagina.locator('#buscar-dispositivos').inputValue() === 'linea motor');
	const camaraAntes = await pagina.evaluate(() => window.qa.camara());
	await pagina.locator('#lista-dispositivos li .foco').click();
	const camara = await pagina.evaluate(() => window.qa.camara());
	const bulto = await pagina.evaluate(() => window.qa.bulto('km1'));
	comprobar('Enfocar lleva el pivote al aparato seleccionado, no modifica su identidad',
		// La caja enfocada incluye rótulos; el bulto de QA mide solo el cuerpo (2,7 mm aquí).
		Math.hypot(camara.tx - bulto.x, camara.ty - bulto.y, camara.tz - bulto.z) < 5
		&& Math.hypot(camara.tx - camaraAntes.tx, camara.ty - camaraAntes.ty, camara.tz - camaraAntes.tz) > 1
		&& (await pagina.evaluate(() => window.qa.seleccion()))?.id === 'km1');
	await pagina.locator('#buscar-dispositivos').fill('sin-aparato-inexistente');
	comprobar('cero coincidencias explica que los aparatos no se eliminaron',
		/siguen en el tablero/.test(await pagina.locator('#lista-dispositivos').innerText())
		&& await pagina.locator('#contador-dispositivos').innerText() === `(0/${total})`);
	await pagina.locator('#buscar-dispositivos').press('Escape');
	comprobar('Escape restaura la lista completa',
		await pagina.locator('#lista-dispositivos li').count() === total
		&& await pagina.locator('#buscar-dispositivos').inputValue() === '');
	await pagina.locator('#buscar-dispositivos').fill('q1');
	await pagina.locator('#lista-dispositivos li').first().focus();
	await pagina.keyboard.press('Enter');
	comprobar('la lista filtrada sigue seleccionable por teclado',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'q1');
	comprobar('búsqueda, selección y foco no mutan el Proyecto',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antes);
	comprobar('ningún error JavaScript', erroresJS.length === 0);
	console.log(`MON-04 lista de aparatos: ${casos}/${casos}, 0 JS`);
} catch (fallo) {
	console.error(fallo);
	process.exitCode = 1;
} finally {
	await pagina?.close().catch(() => {});
	await navegador?.close().catch(() => {});
	if (servidor) await new Promise((resolve) => servidor.close(resolve));
}
