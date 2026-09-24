/** Asistente visible de Mis Componentes: pasos, vuelta atrás, teclado y revisión honesta. */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
const { servidor, url } = await servidorDeQA();
const directorioAnterior = process.cwd();
const temporal = mkdtempSync(join(tmpdir(), 'qa-asistente-componentes-'));
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
const capturaPrefijo = process.env.QA_SCREENSHOT_PREFIX;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let navegador; let contexto; let pagina;
let fallos = 0; let comprobaciones = 0;
const erroresJs = [];
function comprobar(nombre, cumple, detalle = '') {
	comprobaciones++;
	if (!cumple) fallos++;
	console.log(`${cumple ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}
const pasoVisible = () => pagina.locator('#ui-componentes-personalizados [data-cp-paso]:visible');
const comprobarPaso = async (nombre) => comprobar(`solo el paso «${nombre}» es visible`,
	await pasoVisible().count() === 1 && await pasoVisible().getAttribute('data-cp-paso') === nombre);

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1024, height: 768 } });
	pagina = await contexto.newPage();
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJs.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon\.ico/i.test(m.location().url ?? '')) erroresJs.push(m.text());
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	await pagina.waitForFunction(() => !document.getElementById('btn-componentes-personalizados')?.disabled);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#bienvenida').isVisible()) await pagina.locator('#btn-empezar-blanco').click();
	await pagina.locator('#btn-componentes-personalizados').click();
	await pagina.locator('[data-cp="nuevo"]').click();
	await comprobarPaso('identidad');
	await pagina.locator('[data-cp-campo="nombre"]').fill('Piloto asistido QA');
	await pagina.locator('[data-cp-campo="descripcion"]').fill('Descripción que debe sobrevivir al retroceso');
	await pagina.locator('[data-cp="siguiente"]').click();
	await comprobarPaso('funcion');
	await pagina.locator('[data-cp-campo="tipo"]').selectOption('piloto');
	await pagina.locator('[data-parametro="tensionV"]').fill('24');
	await pagina.locator('[data-cp="anterior"]').click();
	await comprobarPaso('identidad');
	comprobar('volver conserva identidad y descripción',
		await pagina.locator('[data-cp-campo="nombre"]').inputValue() === 'Piloto asistido QA'
		&& await pagina.locator('[data-cp-campo="descripcion"]').inputValue() === 'Descripción que debe sobrevivir al retroceso');
	await pagina.locator('[data-cp-ir="funcion"]').focus();
	await pagina.keyboard.press('ArrowRight');
	await comprobarPaso('bornes');
	comprobar('flecha mueve foco al paso siguiente',
		await pagina.locator('[data-cp-ir="bornes"]').evaluate((e) => e === document.activeElement));
	await pagina.locator('[data-cp-ir="funcion"]').click();
	comprobar('cambiar de perfil y volver conserva parámetros',
		await pagina.locator('[data-cp-campo="tipo"]').inputValue() === 'piloto'
		&& await pagina.locator('[data-parametro="tensionV"]').inputValue() === '24');
	await pagina.locator('[data-cp="siguiente"]').click();
	await pagina.locator('[data-cp="imagen"]').setInputFiles({ name: 'piloto.png', mimeType: 'image/png', buffer: PNG });
	await pagina.locator('[data-cp="preview"] img').waitFor({ state: 'visible' });
	await pagina.locator('[data-cp="preview"] img').click({ position: { x: 40, y: 40 } });
	await pagina.locator('[data-cp="preview"] img').click({ position: { x: 185, y: 125 } });
	if (capturaPrefijo) await pagina.screenshot({ path: `${capturaPrefijo}-bornes-1024.png` });
	await pagina.locator('#ui-componentes-personalizados .cp-cuerpo').evaluate((e) => { e.scrollTop = e.scrollHeight; });
	comprobar('la última fila de Bornes se alcanza sin quedar detrás del pie',
		await pagina.evaluate(() => {
			const fila = document.querySelector('#ui-componentes-personalizados [data-cp="terminales"] tr:last-child');
			const pie = document.querySelector('#ui-componentes-personalizados .cp-navegacion');
			return !!fila && !!pie && fila.getBoundingClientRect().bottom <= pie.getBoundingClientRect().top;
		}));
	if (capturaPrefijo) await pagina.screenshot({ path: `${capturaPrefijo}-bornes-1024-tabla.png` });
	await pagina.locator('[data-cp="siguiente"]').click();
	await comprobarPaso('dimensiones');
	await pagina.locator('[data-cp-campo="ancho"]').fill('31');
	await pagina.locator('[data-cp-campo="alto"]').fill('43');
	comprobar('montaje no se presenta como método verificado',
		/NO EVALUABLE/.test(await pagina.locator('[data-cp="montaje-extension"]').innerText()));
	await pagina.locator('[data-cp-campo="montaje-metodo"]').selectOption('atornillado-placa');
	await pagina.getByRole('button', { name: 'Añadir anclaje' }).click();
	await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="x"]').fill('7');
	await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="y"]').fill('8');
	await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="diametro"]').fill('3');
	await pagina.locator('[data-cp-campo="montaje-metodo"]').selectOption('riel-din');
	await pagina.locator('[data-cp-campo="montaje-metodo"]').selectOption('atornillado-placa');
	comprobar('alternar placa → DIN → placa recupera anclajes sin publicarlos en DIN',
		await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="x"]').inputValue() === '7'
		&& await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="diametro"]').inputValue() === '3');
	await pagina.locator('[data-cp="siguiente"]').click();
	await comprobarPaso('apariencia');
	await pagina.locator('[data-cp="preview-apariencia"] canvas').waitFor({ state: 'visible' });
	comprobar('apariencia dibuja la imagen seleccionada y mantiene las anclas u/v',
		await pagina.evaluate(() => {
			const panel = document.querySelector('#ui-componentes-personalizados');
			const canvas = panel?.querySelector('[data-cp="preview-apariencia"] canvas');
			const fuente = panel?.querySelector('[data-cp="preview"] img');
			const anclas = (selector) => [...(panel?.querySelectorAll(selector) ?? [])]
				.map((marca) => [marca.style.left, marca.style.top]);
			if (!canvas || !fuente || !canvas.width || !canvas.height) return false;
			const pixeles = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
			return !!pixeles && pixeles.some((valor, indice) => indice % 4 === 3 && valor > 0)
				&& JSON.stringify(anclas('[data-cp="preview"] .cp-marca'))
					=== JSON.stringify(anclas('[data-cp="preview-apariencia"] .cp-marca'));
		}));
	comprobar('ficha técnica opcional no vinculada indica límite de autenticidad sin simular certificación',
		/Sin ficha técnica vinculada/.test(await pasoVisible().innerText())
		&& /hash prueba integridad, no autenticidad, licencia ni certificación/i.test(await pasoVisible().innerText()));
	await pagina.locator('[data-cp="siguiente"]').click();
	await comprobarPaso('revision');
	const resumen = await pagina.locator('[data-cp="resumen"]').innerText();
	comprobar('revisión resume identidad, perfil, envolvente, montaje e imagen',
		resumen.includes('Piloto asistido QA') && resumen.includes('31 × 43 ×')
		&& resumen.includes('Nueva imagen pendiente') && resumen.includes('Piloto')
		&& resumen.includes('1 anclaje declarado'), resumen);
	await pagina.locator('[data-cp-ir="dimensiones"]').click();
	comprobar('volver conserva método, anclaje y diámetro',
		await pagina.locator('[data-cp-campo="montaje-metodo"]').inputValue() === 'atornillado-placa'
		&& await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="x"]').inputValue() === '7'
		&& await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="y"]').inputValue() === '8'
		&& await pagina.locator('[data-cp-anclaje="0"] [data-cp-anclaje-campo="diametro"]').inputValue() === '3');
	await pagina.locator('[data-cp-ir="revision"]').click();
	if (capturaPrefijo) {
		await pagina.screenshot({ path: `${capturaPrefijo}-revision-1024.png` });
		await pagina.setViewportSize({ width: 1366, height: 820 });
		await pagina.screenshot({ path: `${capturaPrefijo}-revision-1366.png` });
		await pagina.locator('[data-cp-ir="bornes"]').click();
		await pagina.screenshot({ path: `${capturaPrefijo}-bornes-1366.png` });
		await pagina.locator('[data-cp-ir="revision"]').click();
	}
	await pagina.locator('[data-cp="validar"]').click();
	comprobar('la validación sigue rechazando bornes marcados sin rol eléctrico',
		!(await pagina.locator('[data-cp="errores"]').evaluate((e) => e.classList.contains('cp-ok'))));
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
	process.chdir(directorioAnterior);
	rmSync(temporal, { recursive: true, force: true });
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}
console.log(`Asistente Mis Componentes M1: ${comprobaciones} comprobaciones, ${fallos} fallos, ${erroresJs.length} errores JS`);
process.exitCode = fallos ? 1 : 0;
