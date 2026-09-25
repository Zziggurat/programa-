/** ESQ-10: una sola lectura del runtime se refleja en la vista, sin alterar el documento. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor, navegador, pagina;
let casos = 0;
const erroresJS = [];
function comprobar(nombre, condicion) {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
}

async function accionar(id, motorActivo) {
	const boton = pagina.locator(`#sim-mandos button[data-mando="${id}"]`);
	await boton.waitFor({ state: 'visible' });
	await boton.scrollIntoViewIfNeeded();
	const caja = await boton.boundingBox();
	assert.ok(caja, `${id} no tiene área visible`);
	await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
	await pagina.mouse.down();
	await pagina.waitForFunction((activo) => window.qa.simulacion().activos.includes('m1') === activo,
		motorActivo, { timeout: 10_000 });
	await pagina.mouse.up();
	await pagina.waitForFunction((activo) => window.qa.simulacion().activos.includes('m1') === activo,
		motorActivo, { timeout: 10_000 });
}

async function observarHoja(motorActivo) {
	await pagina.locator('#btn-esquema').click();
	// El rAF de la vista debe alcanzar al ÚLTIMO scan antes de comparar DOM y motor.
	await pagina.waitForFunction((activo) => {
		const sim = window.qa.simulacion();
		const hilos = [...document.querySelectorAll('#esquema-hoja .hilo[data-conductor], #esquema-hoja .referencia-conductor[data-conductor]')];
		const aparatos = [...document.querySelectorAll('#esquema-hoja .simbolo[data-dispositivo]')];
		return sim.energizado && sim.activos.includes('m1') === activo && hilos.length > 0 && aparatos.length > 0
			&& document.querySelector('#esq-sim-estado')?.dataset.modo === 'simulacion'
			&& hilos.every((g) => g.dataset.simEstado === (sim.conductoresVivosIds.includes(g.dataset.conductor)
				? 'vivo' : 'no-registrado-vivo'))
			&& aparatos.every((g) => g.dataset.simActividad === (sim.activos.includes(g.dataset.dispositivo)
				? 'activa' : 'no-registrada-activa'));
	}, motorActivo, { timeout: 10_000 });
	// Se comparan todos los indicadores con el oracle de un MISMO evaluate/snapshot.
	const observado = await pagina.evaluate(() => {
		const sim = window.qa.simulacion();
		const hilos = [...document.querySelectorAll('#esquema-hoja .hilo[data-conductor], #esquema-hoja .referencia-conductor[data-conductor]')]
			.map((g) => ({ id: g.dataset.conductor, estado: g.dataset.simEstado,
				esperado: sim.conductoresVivosIds.includes(g.dataset.conductor) ? 'vivo' : 'no-registrado-vivo',
				titulo: g.querySelector('title.esq-sim-titulo')?.textContent }));
		const aparatos = [...document.querySelectorAll('#esquema-hoja .simbolo[data-dispositivo]')]
			.map((g) => ({ id: g.dataset.dispositivo, actividad: g.dataset.simActividad,
				esperado: sim.activos.includes(g.dataset.dispositivo) ? 'activa' : 'no-registrada-activa',
				titulo: g.querySelector('title.esq-sim-titulo')?.textContent }));
		return { sim, modo: document.querySelector('#esq-sim-estado')?.dataset.modo,
			etiqueta: document.querySelector('#esq-sim-estado')?.textContent, hilos, aparatos };
	});
	comprobar(`motor ${motorActivo ? 'en marcha' : 'parado'} según circuito`,
		observado.sim.activos.includes('m1') === motorActivo);
	comprobar('hilos visibles coinciden con un único resultado de simulación',
		observado.hilos.length > 0 && observado.hilos.every((h) => h.estado === h.esperado && h.titulo?.includes(h.id)));
	comprobar('aparatos visibles coinciden con ese mismo resultado',
		observado.aparatos.length > 0 && observado.aparatos.every((a) => a.actividad === a.esperado && a.titulo?.includes(a.id)));
	comprobar('indicador explícito de simulación estable',
		observado.modo === 'simulacion' && observado.etiqueta?.startsWith('Simulación ·'));
	if (motorActivo && process.env.ESQ10_SCREENSHOT) {
		await pagina.screenshot({ path: process.env.ESQ10_SCREENSHOT });
		console.log(`CAPTURA_REVISION=${process.env.ESQ10_SCREENSHOT}`);
	}
	await pagina.locator('#esq-cerrar').click();
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1600, height: 920 }, acceptDownloads: true });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo', { hasText: 'Arranque directo de motor' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Arranque directo de motor 380 V');
	if (await pagina.locator('#modal-explicacion').isVisible())
		await pagina.locator('#btn-cerrar-explicacion').click();
	const proyectoAntes = await pagina.evaluate(() => JSON.stringify(window.qa.proyecto()));
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-esquema').click();
	comprobar('diseño se distingue de una simulación sin snapshot',
		await pagina.locator('#esq-sim-estado').getAttribute('data-modo') === 'diseno'
		&& /Diseño · sin tensión/.test(await pagina.locator('#esq-sim-estado').textContent()));
	comprobar('en diseño ningún hilo aparenta tener tensión',
		await pagina.locator('#esquema-hoja .hilo[data-sim-estado="vivo"]').count() === 0);
	await pagina.locator('#esq-cerrar').click();
	await pagina.locator('#btn-energizar').click();
	await pagina.waitForFunction(() => window.qa.simulacion().energizado);
	await observarHoja(false);
	await accionar('s1', true);
	await observarHoja(true);
	await accionar('s0', false);
	await observarHoja(false);
	await pagina.locator('#btn-energizar').click();
	await pagina.locator('#btn-esquema').click();
	comprobar('desenergizar borra indicación viva, no deja snapshot anterior',
		await pagina.locator('#esq-sim-estado').getAttribute('data-modo') === 'diseno'
		&& await pagina.locator('#esquema-hoja .hilo[data-sim-estado="vivo"]').count() === 0);
	const descarga = pagina.waitForEvent('download');
	await pagina.locator('#esq-svg').click();
	const svg = await readFile(await (await descarga).path(), 'utf8');
	comprobar('SVG descargado excluye por completo el estado efímero',
		!svg.includes('data-sim-') && !svg.includes('esq-sim-estado'));
	comprobar('START/STOP y overlay no mutan Proyecto',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === proyectoAntes);
	await pagina.locator('#esq-cerrar').click();
	await pagina.locator('#btn-energizar').click();
	await accionar('s1', true);
	const anterior = await pagina.evaluate(() => window.qa.simulacion());
	comprobar('el primer proyecto estaba realmente en marcha antes del reemplazo',
		anterior.activos.includes('km1') && anterior.activos.includes('m1'));
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo', { hasText: 'Bomba de agua con boya' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Bomba de agua con boya de nivel');
	if (await pagina.locator('#modal-explicacion').isVisible())
		await pagina.locator('#btn-cerrar-explicacion').click();
	await pagina.locator('#btn-esquema').click();
	await pagina.waitForFunction(() => document.querySelector('#esq-sim-estado')?.dataset.modo === 'simulacion');
	const reemplazo = await pagina.evaluate(() => ({
		proyecto: window.qa.proyecto().nombre,
		sim: window.qa.simulacion(),
		hilos: [...document.querySelectorAll('#esquema-hoja .hilo[data-conductor], #esquema-hoja .referencia-conductor[data-conductor]')]
			.map((g) => ({ id: g.dataset.conductor, estado: g.dataset.simEstado })),
	}));
	comprobar('reemplazo energizado con IDs km1/m1 repetidos reinicia la maniobra',
		reemplazo.proyecto === 'Bomba de agua con boya de nivel'
		&& reemplazo.sim.energizado && !reemplazo.sim.activos.includes('km1')
		&& !reemplazo.sim.activos.includes('m1'));
	comprobar('en nuevo proyecto ningún hilo conserva por ID el resultado anterior',
		reemplazo.hilos.length > 0 && reemplazo.hilos.every((h) => h.estado ===
			(reemplazo.sim.conductoresVivosIds.includes(h.id) ? 'vivo' : 'no-registrado-vivo')));
	comprobar('cero errores JavaScript', erroresJS.length === 0);
	console.log(`ESQ-10: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	await pagina?.close().catch(() => {});
	await navegador?.close().catch(() => {});
	await new Promise((resolve) => servidor?.close(resolve) ?? resolve());
}
