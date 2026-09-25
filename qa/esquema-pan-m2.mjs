/** ESQ-05: desplazar el papel sin mover vistas ni iniciar una conexión eléctrica. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA pan esquemático M2',
	hojaActiva: 'h1', hojas: [{ id: 'h1', numero: 1, titulo: 'Mando' }],
	gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
	dispositivos: [
		{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] },
	],
	conductores: [],
	esquema: { representaciones: [
		{ id: 'ps-vista', dispositivoId: 'ps', hojaId: 'h1',
			posicion: { columna: 3, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'h1',
			posicion: { columna: 8, fila: 6 }, parte: { tipo: 'completa' } },
	] },
};
let servidor, navegador, pagina, casos = 0;
const erroresJS = [];
function comprobar(nombre, valor) {
	casos++;
	assert.ok(valor, nombre);
	console.log(`OK ${nombre}`);
}
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const historial = () => pagina.evaluate(() => window.qa.historial().deshacer);
const scroll = () => pagina.locator('#esquema-lienzo').evaluate((el) => ({
	x: el.scrollLeft, y: el.scrollTop, maxX: el.scrollWidth - el.clientWidth,
	maxY: el.scrollHeight - el.clientHeight,
}));
async function moverRatonDesde(locator, boton, dx, dy) {
	await locator.scrollIntoViewIfNeeded();
	const caja = await locator.boundingBox();
	assert.ok(caja && caja.width > 0 && caja.height > 0);
	const x = caja.x + caja.width / 2, y = caja.y + caja.height / 2;
	await pagina.mouse.move(x, y);
	await pagina.mouse.down({ button: boton });
	await pagina.mouse.move(x + dx, y + dy, { steps: 3 });
	await pagina.mouse.up({ button: boton });
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1420, height: 860 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (error) => erroresJS.push(error.message));
	pagina.on('console', (mensaje) => {
		if (mensaje.type() === 'error' && !/favicon|404/i.test(mensaje.text())) erroresJS.push(mensaje.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const chooser = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await chooser).setFiles({ name: 'qa-pan.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA pan esquemático M2');
	await pagina.locator('#btn-esquema').click();
	for (let i = 0; i < 6; i++) await pagina.locator('#esq-acercar').click();
	const lienzo = pagina.locator('#esquema-lienzo');
	const antes = await proyecto(), undo0 = await historial();
	const base = await scroll();
	comprobar('papel ampliado permite desplazamiento horizontal y vertical',
		base.maxX > 200 && base.maxY > 100);
	comprobar('lienzo se anuncia y acepta foco de teclado',
		await lienzo.getAttribute('tabindex') === '0' && !!await lienzo.getAttribute('aria-label'));
	await lienzo.evaluate((el) => { el.scrollLeft = el.scrollWidth / 2; el.scrollTop = el.scrollHeight / 2; });
	const posicion = await scroll();
	const cajaLienzo = await lienzo.boundingBox();
	assert.ok(cajaLienzo);
	const blanco = { x: cajaLienzo.x + 7, y: cajaLienzo.y + 7 };
	await lienzo.focus();
	await pagina.keyboard.down('Space');
	await pagina.evaluate(() => window.dispatchEvent(new Event('blur')));
	await pagina.mouse.move(blanco.x, blanco.y);
	await pagina.mouse.down();
	await pagina.mouse.move(blanco.x + 50, blanco.y + 30);
	await pagina.mouse.up();
	await pagina.keyboard.up('Space');
	const trasBlur = await scroll();
	comprobar('perder foco antes de soltar Espacio no deja pan armado',
		Math.abs(trasBlur.x - posicion.x) < 1 && Math.abs(trasBlur.y - posicion.y) < 1);
	await lienzo.focus();
	await pagina.keyboard.down('Space');
	await pagina.mouse.move(blanco.x, blanco.y);
	await pagina.mouse.down();
	await pagina.mouse.move(blanco.x + 90, blanco.y + 60, { steps: 3 });
	await pagina.mouse.up();
	await pagina.keyboard.up('Space');
	const trasEspacio = await scroll();
	comprobar('Espacio y arrastre desplazan solo el viewport',
		trasEspacio.x < posicion.x - 30 && trasEspacio.y < posicion.y - 20
		&& JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0);

	const simbolo = pagina.locator('#esquema-hoja .simbolo[data-representacion="ps-vista"]');
	await simbolo.scrollIntoViewIfNeeded();
	const antesMedio = await scroll();
	await moverRatonDesde(simbolo, 'middle', antesMedio.x > 30 ? 75 : -75, 0);
	const trasMedio = await scroll();
	comprobar('botón medio sobre un símbolo no lo arrastra ni selecciona borne',
		Math.abs(trasMedio.x - antesMedio.x) > 20
		&& JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0
		&& await pagina.locator('#esq-movimiento-aviso').isHidden());
	await pagina.evaluate(() => {
		window.__qaPanPointer = undefined;
		document.addEventListener('pointerdown', (ev) => { window.__qaPanPointer = ev.pointerId; },
			{ capture: true, once: true });
	});
	await pagina.mouse.move(blanco.x, blanco.y);
	await pagina.mouse.down({ button: 'middle' });
	await pagina.mouse.move(blanco.x - 40, blanco.y, { steps: 2 });
	await pagina.evaluate(() => {
		window.dispatchEvent(new PointerEvent('pointercancel', {
			bubbles: true, pointerId: window.__qaPanPointer, button: 1, buttons: 0,
		}));
		delete window.__qaPanPointer;
	});
	await pagina.mouse.up({ button: 'middle' });
	comprobar('pointercancel libera gesto y listeners sin mutar modelo',
		!await lienzo.evaluate((el) => el.classList.contains('pan-esquema'))
		&& JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0);

	const borne = pagina.locator('#esquema-hoja .borne-esq[data-borne]').first();
	await borne.scrollIntoViewIfNeeded();
	await lienzo.focus();
	await pagina.keyboard.down('Space');
	const antesBorne = await scroll();
	await moverRatonDesde(borne, 'left', antesBorne.x > 30 ? 65 : -65, 0);
	await pagina.keyboard.up('Space');
	const trasBorne = await scroll();
	comprobar('Espacio sobre borne desplaza sin armar conexión',
		Math.abs(trasBorne.x - antesBorne.x) > 20
		&& await pagina.locator('#esq-cancelar-conexion').count() === 0
		&& JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0);

	await lienzo.focus();
	await pagina.keyboard.down('Space');
	await pagina.mouse.move(blanco.x, blanco.y);
	await pagina.mouse.down();
	await pagina.mouse.move(blanco.x + 40, blanco.y + 15);
	await pagina.keyboard.press('Escape');
	await pagina.mouse.up();
	await pagina.keyboard.up('Space');
	comprobar('Escape cancela pan sin cerrar el esquema', await pagina.locator('#panel-esquema').isVisible());
	await borne.click();
	comprobar('tras cancelar, un clic normal en borne vuelve a funcionar',
		await pagina.locator('#esq-cancelar-conexion').isVisible());
	await pagina.locator('#esq-cancelar-conexion').click();
	await pagina.mouse.move(blanco.x, blanco.y);
	await pagina.mouse.down({ button: 'middle' });
	await pagina.mouse.move(blanco.x - 35, blanco.y, { steps: 2 });
	await pagina.locator('#esq-cerrar').evaluate((el) => el.click());
	await pagina.mouse.up({ button: 'middle' });
	await pagina.locator('#btn-esquema').click();
	comprobar('cerrar durante pan permite reabrir sin gesto retenido',
		await pagina.locator('#panel-esquema').isVisible()
		&& !await lienzo.evaluate((el) => el.classList.contains('pan-esquema'))
		&& JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0);
	await borne.click();
	comprobar('tras reabrir, borne conserva su clic ordinario',
		await pagina.locator('#esq-cancelar-conexion').isVisible());
	await pagina.locator('#esq-cancelar-conexion').click();
	for (let i = 0; i < 6; i++) await pagina.locator('#esq-acercar').click();
	const anchoAntesBoton = (await pagina.locator('#esquema-hoja').boundingBox()).width;
	await pagina.locator('#esq-acercar').focus();
	await pagina.locator('#esq-acercar').press('Space');
	const anchoDespuesBoton = (await pagina.locator('#esquema-hoja').boundingBox()).width;
	comprobar('Espacio en botón conserva su activación y no arma pan',
		anchoDespuesBoton > anchoAntesBoton && await historial() === undo0);
	await lienzo.focus();
	await lienzo.evaluate((el) => { el.scrollLeft = el.scrollWidth / 2; });
	const antesFlecha = (await scroll()).x;
	await pagina.keyboard.press('ArrowRight');
	await pagina.waitForFunction((x) => document.getElementById('esquema-lienzo').scrollLeft > x + 5,
		antesFlecha, { timeout: 3000 });
	comprobar('flecha con foco en lienzo desplaza papel sin cambiar folio',
		/Hoja 1/.test(await pagina.locator('#esq-indicador').textContent())
		&& (await scroll()).x > antesFlecha + 5);
	comprobar('pan y zoom no mutaron proyecto ni historial',
		JSON.stringify(await proyecto()) === JSON.stringify(antes) && await historial() === undo0);
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-05 pan: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	try { await pagina?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try { await navegador?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try {
		servidor?.closeAllConnections?.();
		if (servidor) await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { console.error(error); process.exitCode = 1; }
}
