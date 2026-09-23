/** M1 focal: bibliotecas buscables y copia de un ejemplo por su identidad visible. */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
import { abrirEjemploYCopiar } from './lib/ejemplo-documento.mjs';

const { servidor, url } = await servidorDeQA();
const temporal = mkdtempSync(join(tmpdir(), 'qa-flujo-m1-'));
const cwdInicial = process.cwd();
const chromeLogPrevio = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let navegador;
let contexto;
let fallos = 0;
const erroresJs = [];
const must = (nombre, condicion, detalle = '') => {
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
};

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1366, height: 768 } });
	const pagina = await contexto.newPage();
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', (error) => erroresJs.push(error.message));
	pagina.on('console', (mensaje) => {
		if (mensaje.type() === 'error' && !/favicon\.ico/i.test(mensaje.location().url ?? '')) erroresJs.push(mensaje.text());
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	if (await pagina.locator('#modal-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#bienvenida').isVisible()) await pagina.locator('#btn-empezar-blanco').click();

	const nombre = pagina.locator('#nombre-proyecto');
	await nombre.fill('Tablero M1 A'); await nombre.press('Tab');
	const a = await pagina.evaluate(() => window.qa.esperarPersistencia());
	const estadoA = pagina.locator('#estado-guardado');
	must('el estado persistente identifica A y su revisión confirmada',
		(await estadoA.innerText()).includes(`r${a.revision}`)
		&& (await estadoA.getAttribute('title'))?.includes(a.id)
		&& (await estadoA.getAttribute('title'))?.includes('Tablero M1 A'));
	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-mis-tableros').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'visible' });
	const buscar = pagina.locator('#buscar-mis-tableros');
	await buscar.fill('tablero m1 a');
	await pagina.waitForFunction(() => document.getElementById('contador-mis-tableros')?.textContent?.includes('de 1 tablero'));
	must('el nombre recupera el documento A', await pagina.locator('.tarjeta-documento').count() === 1
		&& await pagina.locator('.tarjeta-documento').first().getAttribute('data-documento-id') === a.id);
	await buscar.fill('sin-coincidencia-m1');
	must('la búsqueda vacía no borra ni altera el proyecto', await pagina.locator('.tarjeta-documento').count() === 0
		&& (await pagina.locator('#contador-mis-tableros').innerText()).includes('0 de 1'));
	await buscar.fill('');
	await pagina.locator('#btn-nuevo-biblioteca').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'hidden' });
	await nombre.fill('Tablero M1 B'); await nombre.press('Tab');
	const b = await pagina.evaluate(() => window.qa.esperarPersistencia());
	must('A y B tienen identidades y nombres independientes', a.id !== b.id
		&& a.nombre === 'Tablero M1 A' && b.nombre === 'Tablero M1 B');
	must('el estado cambia a B sin mostrar identidad de A',
		(await estadoA.innerText()).includes(`r${b.revision}`)
		&& (await estadoA.getAttribute('title'))?.includes(b.id)
		&& !(await estadoA.getAttribute('title'))?.includes(a.id));
	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-mis-tableros').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'visible' });
	await buscar.fill(a.id);
	await pagina.waitForFunction(() => document.getElementById('contador-mis-tableros')?.textContent?.includes('de 2 tableros'));
	const visiblesPorId = await pagina.locator('.tarjeta-documento').count();
	const activoTrasFiltro = await pagina.evaluate(() => window.qa.documentoActivo());
	must('se puede localizar A por identidad sin cambiar el activo B', visiblesPorId === 1
		&& activoTrasFiltro.id === b.id, `${visiblesPorId} tarjetas · activo ${activoTrasFiltro.id} · A ${a.id} · B ${b.id}`);
	await pagina.locator('#btn-ejemplos-biblioteca').click();
	await pagina.getByText('Fixture V7: proyecto sano', { exact: true }).waitFor();
	const copiado = await abrirEjemploYCopiar(pagina, {
		titulo: 'Fixture V7: proyecto sano',
		requisitos: { dispositivosMin: 1, conductoresMin: 1 },
		confirmarReemplazo: true,
	});
	must('el ejemplo se copió como tercer documento persistente', copiado.documento.id !== a.id
		&& copiado.documento.id !== b.id && (await pagina.evaluate(() => window.qa.documentos())).length === 3);
	must('la copia presenta su identidad y revisión confirmada',
		(await estadoA.innerText()).includes(`r${copiado.documento.revision}`)
		&& (await estadoA.getAttribute('title'))?.includes(copiado.documento.id));
	must('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await contexto?.close(); } catch (error) { fallos++; console.error('Cierre de contexto:', error); }
	try { await navegador?.close(); } catch (error) { fallos++; console.error('Cierre de Chromium:', error); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve())); }
	catch (error) { fallos++; console.error('Cierre de servidor:', error); }
	process.chdir(cwdInicial);
	rmSync(temporal, { recursive: true, force: true });
	if (chromeLogPrevio === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogPrevio;
}
console.log(fallos ? `\n${fallos} fallo(s) en M1` : '\nM1 focal: todo correcto');
process.exitCode = fallos ? 1 : 0;
