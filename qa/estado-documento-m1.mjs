/** M1 focal: identidad/revisión visible, barra adaptable y error de persistencia recuperable. */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = performance.now();
const { servidor, url } = await servidorDeQA();
const temporal = mkdtempSync(join(tmpdir(), 'qa-estado-documento-m1-'));
const cwdInicial = process.cwd();
const chromeLogPrevio = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let navegador;
let contexto;
let pagina;
let fallos = 0;
let comprobaciones = 0;
const erroresJs = [];
function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}

async function medirBarra(ancho) {
	await pagina.setViewportSize({ width: ancho, height: 768 });
	// Dejar que el evento resize y la compactación terminen antes de inspeccionar rótulos.
	await pagina.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await pagina.waitForFunction(() => {
		const barra = document.getElementById('barra');
		return barra && barra.scrollWidth <= barra.clientWidth + 1;
	}, undefined, { timeout: 10_000 });
	const medida = await pagina.evaluate(() => {
		const barra = document.getElementById('barra');
		const campo = document.getElementById('nombre-proyecto');
		const estado = document.getElementById('estado-guardado');
		const botones = [...barra.querySelectorAll('button')].filter((boton) => {
			const estilo = getComputedStyle(boton);
			return estilo.display !== 'none' && estilo.visibility !== 'hidden' && boton.getClientRects().length;
		});
		const rotulos = [...barra.querySelectorAll('.rotulo-boton')].filter((rotulo) =>
			getComputedStyle(rotulo).display !== 'none' && rotulo.getClientRects().length);
		const caja = (elemento) => {
			const r = elemento.getBoundingClientRect();
			return { izquierda: r.left, derecha: r.right, ancho: r.width };
		};
		return {
			barra: { contenido: barra.scrollWidth, visible: barra.clientWidth, clases: barra.className },
			campo: caja(campo), estado: caja(estado),
			botonesFuera: botones.filter((boton) => {
				const r = caja(boton);
				return r.izquierda < -1 || r.derecha > innerWidth + 1 || r.ancho < 18;
			}).map((boton) => boton.id),
			rotulosFuera: rotulos.filter((rotulo) => {
				const r = caja(rotulo);
				const p = caja(rotulo.closest('button'));
				return r.izquierda < p.izquierda - 1 || r.derecha > p.derecha + 1;
			}).map((rotulo) => rotulo.closest('button').id),
		};
	});
	comprobar(`barra usable a ${ancho}px con los rótulos efectivamente visibles`,
		medida.barra.contenido <= medida.barra.visible + 1
		&& medida.campo.ancho >= 70 && medida.estado.ancho >= 18
		&& medida.botonesFuera.length === 0 && medida.rotulosFuera.length === 0,
		JSON.stringify(medida));
}

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1366, height: 768 } });
	pagina = await contexto.newPage();
	pagina.setDefaultTimeout(30_000);
	pagina.on('pageerror', (error) => erroresJs.push(error.message));
	pagina.on('console', (mensaje) => {
		if (mensaje.type() === 'error' && !/favicon\.ico/i.test(mensaje.location().url ?? '')) erroresJs.push(mensaje.text());
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	const inicial = await pagina.evaluate(() => window.qa.esperarPersistencia());
	if (await pagina.locator('#modal-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#bienvenida').isVisible()) await pagina.locator('#btn-empezar-blanco').click();
	const nombre = pagina.locator('#nombre-proyecto');
	const estado = pagina.locator('#estado-guardado');
	comprobar('documento inicial con identidad y revisión confirmada',
		Boolean(inicial?.id && inicial.revision >= 1)
		&& (await estado.innerText()).includes(`r${inicial.revision}`)
		&& (await estado.getAttribute('title'))?.includes(inicial.id));

	await nombre.fill('Documento M1 con estado visible');
	await nombre.press('Tab');
	const renombrado = await pagina.evaluate(() => window.qa.esperarPersistencia());
	comprobar('renombrar por UI actualiza nombre, revisión y ayuda accesible',
		renombrado.id === inicial.id && renombrado.revision > inicial.revision
		&& renombrado.nombre === 'Documento M1 con estado visible'
		&& renombrado.proyecto.nombre === renombrado.nombre
		&& (await estado.innerText()).includes(`r${renombrado.revision}`)
		&& (await estado.getAttribute('aria-label'))?.includes(renombrado.nombre));

	for (const ancho of [1024, 1366, 1920]) await medirBarra(ancho);
	await pagina.setViewportSize({ width: 1366, height: 768 });

	// Se fuerza un fallo real del API de almacenamiento, no una bandera privada del producto.
	// Solo afecta a escrituras de proyectos y se restaura antes de pulsar el reintento visible.
	await pagina.evaluate(() => {
		const original = IDBObjectStore.prototype.put;
		window.__qaRestaurarEscriturasM1 = () => { IDBObjectStore.prototype.put = original; };
		IDBObjectStore.prototype.put = function (valor, clave) {
			if (this.name === 'projects' && this.transaction.mode === 'readwrite') {
				throw new DOMException('Fallo de escritura inducido por QA M1', 'QuotaExceededError');
			}
			return original.call(this, valor, clave);
		};
	});
	await nombre.fill('Documento M1 pendiente de reintento');
	await nombre.press('Tab');
	await pagina.locator('#aviso-estado-documento').waitFor({ state: 'visible' });
	const errorVisible = await pagina.locator('#aviso-estado-documento-texto').innerText();
	const enMemoria = await pagina.evaluate(() => window.qa.documentoActivo());
	comprobar('fallo IndexedDB queda visible sin simular una revisión guardada',
		(await estado.innerText()).includes('Sin guardar')
		&& (await estado.innerText()).includes(`r${renombrado.revision}`)
		&& errorVisible.includes('No se guardaron')
		&& await pagina.locator('#btn-accion-estado-documento').isVisible()
		&& (await nombre.inputValue()) === 'Documento M1 pendiente de reintento'
		&& enMemoria.revision === renombrado.revision
		&& enMemoria.nombre === renombrado.nombre,
		errorVisible);
	await pagina.evaluate(() => window.__qaRestaurarEscriturasM1());
	await pagina.locator('#btn-accion-estado-documento').click();
	const recuperado = await pagina.evaluate(() => window.qa.esperarPersistencia());
	comprobar('Reintentar guardado confirma la misma identidad y el nombre pendiente',
		recuperado.id === renombrado.id && recuperado.revision > renombrado.revision
		&& recuperado.nombre === 'Documento M1 pendiente de reintento'
		&& recuperado.proyecto.nombre === recuperado.nombre
		&& await pagina.locator('#aviso-estado-documento').isHidden()
		&& (await estado.innerText()).includes(`r${recuperado.revision}`));

	// El ejemplo debe mostrarse como estudio efímero; no se le asigna una revisión ni se pisa el activo.
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	const tarjeta = pagina.locator('.tarjeta-ejemplo').filter({
		has: pagina.getByRole('heading', { name: 'Fixture V7: proyecto sano', exact: true }),
	});
	await tarjeta.getByRole('button', { name: 'Abrir y estudiar', exact: true }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa?.proyecto?.().esEjemplo === true
		&& document.getElementById('chip-ejemplo')?.hidden === false);
	const duranteEjemplo = await pagina.evaluate(async () => ({
		activo: window.qa.documentoActivo(), documentos: await window.qa.documentos(),
	}));
	comprobar('el ejemplo es de solo lectura y no sustituye el documento persistente',
		await nombre.evaluate((input) => input.readOnly)
		&& await estado.isHidden()
		&& duranteEjemplo.activo.id === recuperado.id
		&& duranteEjemplo.documentos.length === 1
		&& await pagina.locator('#chip-ejemplo').isVisible());
	if (await pagina.locator('#modal-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	await pagina.locator('#btn-volver-tablero').click();
	await pagina.waitForFunction((id) => window.qa?.documentoActivo?.().id === id
		&& window.qa?.proyecto?.().esEjemplo !== true
		&& document.getElementById('chip-ejemplo')?.hidden === true, recuperado.id);
	comprobar('al cerrar el ejemplo regresan nombre y revisión reales',
		(await nombre.inputValue()) === recuperado.nombre
		&& (await estado.innerText()).includes(`r${recuperado.revision}`)
		&& (await estado.getAttribute('title'))?.includes(recuperado.id));
	comprobar('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	try { await pagina?.evaluate(() => window.__qaRestaurarEscriturasM1?.()); } catch { /* página cerrada */ }
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
console.log(`M1 estado documental: ${comprobaciones} comprobaciones, ${fallos} fallos, 0 skipped, ${Math.round(performance.now() - inicio)} ms`);
process.exitCode = fallos ? 1 : 0;
