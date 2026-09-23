/** Frontera de teclado/capas de Mis Componentes: ninguna edición del tablero debe pasar detrás. */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const { servidor, url } = await servidorDeQA();
const cwdInicial = process.cwd();
const temporal = mkdtempSync(join(tmpdir(), 'qa-componentes-teclado-'));
const chromeLogPrevio = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let navegador;
let contexto;
let pagina;
let fallos = 0;
let comprobaciones = 0;
const erroresJs = [];
function comprobar(nombre, cumple, detalle = '') {
	comprobaciones++;
	if (!cumple) fallos++;
	console.log(`${cumple ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1024, height: 768 } });
	pagina = await contexto.newPage();
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJs.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/\/favicon\.ico(?:$|\?)/i.test(m.location().url ?? '')) erroresJs.push(m.text());
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	await pagina.waitForFunction(() => !document.getElementById('btn-componentes-personalizados')?.disabled);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#bienvenida').isVisible()) await pagina.locator('#btn-empezar-blanco').click();
	await pagina.locator('#btn-componentes-personalizados').click();
	const panel = pagina.locator('#ui-componentes-personalizados');
	await panel.waitFor({ state: 'visible' });
	if (process.env.QA_SCREENSHOT) {
		await pagina.waitForFunction(() => document.querySelector('#ui-componentes-personalizados [data-cp-estado]')
			?.textContent !== 'Cargando…');
		await pagina.screenshot({ path: process.env.QA_SCREENSHOT });
	}
	comprobar('el modal recibe el foco al abrir', await pagina.evaluate(() =>
		document.getElementById('ui-componentes-personalizados')?.contains(document.activeElement)));
	comprobar('el editor queda inerte', await pagina.evaluate(() =>
		!!document.getElementById('barra')?.closest('[inert]')));
	await pagina.keyboard.press('Shift+Tab');
	comprobar('Shift+Tab conserva el foco dentro del modal', await pagina.evaluate(() =>
		document.getElementById('ui-componentes-personalizados')?.contains(document.activeElement)));
	await pagina.evaluate(() => {
		window.__qaTeclasFiltradas = 0;
		window.addEventListener('keydown', (e) => { if (e.key === 'o') window.__qaTeclasFiltradas++; });
	});
	await pagina.keyboard.press('o');
	comprobar('la tecla O no llega a los atajos globales del tablero',
		await pagina.evaluate(() => window.__qaTeclasFiltradas === 0));
	await pagina.keyboard.press('Escape');
	comprobar('Escape cierra el modal y devuelve el foco al disparador',
		await panel.isHidden() && await pagina.evaluate(() => document.activeElement?.id === 'btn-componentes-personalizados'));
	comprobar('al cerrar, el editor deja de estar inerte', await pagina.evaluate(() =>
		!document.getElementById('barra')?.closest('[inert]')));

	await pagina.locator('#btn-componentes-personalizados').click();
	await panel.waitFor({ state: 'visible' });
	await pagina.locator('[data-cp="nuevo"]').click();
	await pagina.locator('[data-cp-campo="nombre"]').fill('Borrador de teclado');
	await pagina.keyboard.press('Escape');
	await pagina.locator('#btn-componentes-personalizados').click();
	comprobar('Escape no descarta campos del borrador',
		await pagina.locator('[data-cp-campo="nombre"]').inputValue() === 'Borrador de teclado');
	await pagina.locator('[data-cp="volver"]').click();
	await pagina.locator('.cp-borrador').waitFor({ state: 'visible' });
	await pagina.getByRole('button', { name: 'Descartar borrador' }).click();
	await pagina.locator('#modal-dialogo').waitFor({ state: 'visible' });
	comprobar('confirmación queda visualmente por encima de Mis Componentes', await pagina.evaluate(() => {
		const modal = document.getElementById('modal-dialogo');
		const panel = document.getElementById('ui-componentes-personalizados');
		const boton = document.getElementById('dialogo-cancelar');
		if (!modal || !panel || !boton) return false;
		const r = boton.getBoundingClientRect();
		return Number(getComputedStyle(modal).zIndex) > Number(getComputedStyle(panel).zIndex)
			&& document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === boton;
	}));
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar conserva el borrador', await pagina.locator('.cp-borrador').isVisible());
	// Lectura de imagen lenta: volver a la biblioteca no debe perder la selección que ya hizo
	// la persona, incluso cuando ese era el único cambio. Un rechazo tampoco puede quedar como
	// promesa sin manejar.
	await pagina.getByRole('button', { name: 'Descartar borrador' }).click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.locator('[data-cp="nuevo"]').click();
	await pagina.evaluate(() => {
		const original = File.prototype.arrayBuffer;
		window.__qaRestaurarLectura = () => { File.prototype.arrayBuffer = original; };
		File.prototype.arrayBuffer = function () {
			if (this.name === 'lenta.png') return new Promise((resolve, reject) => {
				window.__qaCompletarLectura = () => original.call(this).then(resolve, reject);
			});
			if (this.name === 'ilegible.png') return Promise.reject(new Error('lectura simulada fallida'));
			return original.call(this);
		};
	});
	const imagen = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
	await pagina.locator('[data-cp="imagen"]').setInputFiles({ name: 'lenta.png', mimeType: 'image/png', buffer: imagen });
	await pagina.waitForFunction(() => typeof window.__qaCompletarLectura === 'function');
	await pagina.locator('[data-cp="volver"]').click();
	await pagina.locator('.cp-borrador').waitFor({ state: 'visible' });
	await pagina.evaluate(() => window.__qaCompletarLectura());
	await pagina.getByRole('button', { name: 'Continuar edición' }).click();
	await pagina.locator('[data-cp="preview"] img').waitFor({ state: 'visible' });
	comprobar('la imagen elegida durante la navegación permanece en el borrador',
		await pagina.locator('[data-cp="preview"] img').count() === 1);
	await pagina.locator('[data-cp="imagen"]').setInputFiles({ name: 'ilegible.png', mimeType: 'image/png', buffer: imagen });
	await pagina.waitForFunction(() => document.querySelector('[data-cp-estado]')?.textContent?.includes('No se pudo leer la imagen'));
	comprobar('una lectura fallida conserva la imagen anterior y se informa',
		await pagina.locator('[data-cp="preview"] img').count() === 1);
	await pagina.evaluate(() => window.__qaRestaurarLectura());
	comprobar('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
	if (erroresJs.length) console.error('Errores JS:', erroresJs.slice(0, 3));
} finally {
	try { await contexto?.close(); } catch (e) { fallos++; console.error(e); }
	try { await navegador?.close(); } catch (e) { fallos++; console.error(e); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve())); }
	catch (e) { fallos++; console.error(e); }
	process.chdir(cwdInicial);
	rmSync(temporal, { recursive: true, force: true });
	if (chromeLogPrevio === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogPrevio;
}
console.log(`Mis Componentes / teclado: ${comprobaciones} comprobaciones, ${fallos} fallos, ${erroresJs.length} errores JS`);
process.exitCode = fallos ? 1 : 0;
