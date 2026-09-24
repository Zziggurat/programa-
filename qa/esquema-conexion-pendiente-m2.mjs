/** ESQ-02 visible: dos hojas, un enlace eléctrico y ninguna ruta física inventada. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const temporal = mkdtempSync(join(tmpdir(), 'qa-esq-conexion-m2-'));
const cwdAnterior = process.cwd();
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA conexión esquemática M2',
	hojaActiva: 'potencia',
	hojas: [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	],
	gabinete: { ancho: 500, alto: 300, rieles: [], canaletas: [], colocaciones: [] },
	dispositivos: [
		{ id: 'xp', tipo: 'bornero', designacion: '-XP1', bornes: [{ id: 'X1' }] },
		{ id: 'xm', tipo: 'bornero', designacion: '-XM1', bornes: [{ id: 'Y1' }] },
	],
	conductores: [],
	esquema: { representaciones: [
		{ id: 'xp-vista', dispositivoId: 'xp', hojaId: 'potencia',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'xm-vista', dispositivoId: 'xm', hojaId: 'mando',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
	] },
};

let navegador, servidor, pagina;
let comprobaciones = 0, fallos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const estado = () => pagina.evaluate(() => ({
	proyecto: window.qa.proyecto(), historial: window.qa.historial(),
	cables3d: window.qa.cablesDibujados(),
}));

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1600, height: 920 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const selector = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await selector).setFiles({ name: 'conexion-esquema.tablero.json',
		mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA conexión esquemática M2');
	await pagina.locator('#btn-esquema').click();
	const origen = pagina.locator('.borne-esq[data-dispositivo="xp"][data-borne="X1"]');
	await origen.waitFor({ state: 'visible' });
	const base = await estado();
	comprobar('arranque: dos hojas y ningún cable físico ni conexión',
		base.proyecto.hojas.length === 2 && base.proyecto.conductores.length === 0 && base.cables3d === 0);

	await origen.click();
	comprobar('origen visible y cancelable sin mutar el proyecto',
		await pagina.locator('#esq-cancelar-conexion').isVisible()
		&& (await estado()).proyecto.conductores.length === 0);
	await pagina.keyboard.press('Escape');
	const escapeConservaPanel = await pagina.locator('#panel-esquema').isVisible();
	comprobar('Escape cancela sin cerrar esquema ni crear entrada de deshacer',
		(await estado()).proyecto.conductores.length === 0
		&& (await estado()).historial.deshacer === base.historial.deshacer
		&& escapeConservaPanel
		&& !(await pagina.locator('#esq-cancelar-conexion').isVisible()));
	assert.ok(escapeConservaPanel, 'Escape cerró el esquema además de cancelar el origen');

	await origen.click();
	await pagina.locator('#esq-siguiente').click();
	comprobar('el origen persiste al pasar a la otra hoja',
		await pagina.locator('#esq-cancelar-conexion').isVisible()
		&& /Hoja 2/.test(await pagina.locator('#esq-indicador').textContent()));
	await pagina.locator('.borne-esq[data-dispositivo="xm"][data-borne="Y1"]').click();
	const propuesta = await pagina.locator('#dialogo-msg').textContent();
	comprobar('confirmación distingue enlace eléctrico de tendido físico',
		/ruta física pendiente/i.test(propuesta) && /no se declararán metros/i.test(propuesta));
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar confirmación no crea cable ni paso de undo',
		(await estado()).proyecto.conductores.length === 0
		&& (await estado()).historial.deshacer === base.historial.deshacer);

	await pagina.locator('#esq-anterior').click();
	await pagina.locator('.borne-esq[data-dispositivo="xp"][data-borne="X1"]').click();
	await pagina.locator('#esq-siguiente').click();
	await pagina.locator('.borne-esq[data-dispositivo="xm"][data-borne="Y1"]').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.length === 1);
	const creado = await estado();
	const c = creado.proyecto.conductores[0];
	comprobar('una identidad eléctrica entre dos hojas, sin sección/color/ruta/metros',
		creado.proyecto.version === 2 && creado.proyecto.conductores.length === 1
		&& c.estadoRutaFisica === 'pendiente' && c.seccion === undefined && c.color === undefined
		&& c.trazado === undefined && c.fisica === undefined && creado.cables3d === 0
		&& creado.historial.deshacer === base.historial.deshacer + 1);
	await pagina.locator('#esq-anterior').click();
	await pagina.locator('.borne-esq[data-dispositivo="xp"][data-borne="X1"]').click();
	await pagina.locator('#esq-siguiente').click();
	await pagina.locator('.borne-esq[data-dispositivo="xm"][data-borne="Y1"]').click();
	comprobar('duplicado bidireccional no abre confirmación ni añade undo',
		await pagina.locator('#modal-dialogo').isHidden()
		&& (await estado()).proyecto.conductores.length === 1
		&& (await estado()).historial.deshacer === creado.historial.deshacer);
	await pagina.locator('#esq-cancelar-conexion').click();
	await pagina.evaluate(() => { window.qa.proyecto().esEjemplo = true; });
	await pagina.locator('.borne-esq[data-dispositivo="xm"][data-borne="Y1"]').click();
	comprobar('solo lectura veta el gesto antes de preparar un origen',
		(await estado()).proyecto.conductores.length === 1
		&& (await estado()).historial.deshacer === creado.historial.deshacer
		&& !(await pagina.locator('#esq-cancelar-conexion').isVisible()));
	await pagina.evaluate(() => { delete window.qa.proyecto().esEjemplo; });
	comprobar('referencia interhoja seleccionable en hoja destino',
		await pagina.locator('.referencia-conductor[data-conductor]').count() === 1);
	await pagina.locator('.referencia-conductor[data-conductor]').click();
	comprobar('la referencia abre desconexión del conductor real',
		await pagina.locator('#esq-desconectar').isVisible()
		&& /ruta física pendiente/i.test(await pagina.locator('#esq-ayuda').textContent()));

	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.length === 0);
	comprobar('Undo retira el único vínculo y sus referencias',
		(await estado()).cables3d === 0 && await pagina.locator('.referencia-conductor').count() === 0);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.length === 1);
	comprobar('Redo restaura vínculo pendiente sin materializar cable',
		(await estado()).proyecto.conductores[0].estadoRutaFisica === 'pendiente'
		&& (await estado()).cables3d === 0);
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = await estado();
	comprobar('guardado/reapertura conserva clase física pendiente y una conexión',
		reabierto.proyecto.conductores.length === 1
		&& reabierto.proyecto.conductores[0].estadoRutaFisica === 'pendiente'
		&& reabierto.cables3d === 0);
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esq-siguiente').click();
	await pagina.locator('.referencia-conductor[data-conductor]').click();
	await pagina.locator('#esq-desconectar').click();
	comprobar('desconectar pendiente advierte sobre topología y admite cancelación',
		/ruta física aún no se ha definido/i.test(await pagina.locator('#dialogo-msg').textContent()));
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar desconexión deja una sola conexión',
		(await estado()).proyecto.conductores.length === 1);
	await pagina.locator('#esq-desconectar').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.length === 0);
	comprobar('desconexión real quita el vínculo sin cable fantasma',
		(await estado()).cables3d === 0 && await pagina.locator('.referencia-conductor').count() === 0);
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.length === 1);
	comprobar('Undo restaura la misma conexión pendiente tras desconectar',
		(await estado()).proyecto.conductores[0].estadoRutaFisica === 'pendiente'
		&& (await estado()).cables3d === 0);
	comprobar('sin errores JavaScript', erroresJS.length === 0);
} catch (error) {
	fallos++;
	console.error('FAIL QA conexión esquemática M2:', error.stack ?? error);
} finally {
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	process.chdir(cwdAnterior);
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
	const base = realpathSync(tmpdir());
	const ruta = realpathSync(temporal);
	assert.ok(ruta.startsWith(base + sep), 'el temporal de QA debe estar dentro de tmp');
	rmSync(ruta, { recursive: true, force: true });
	console.log(`QA conexión esquemática M2: ${comprobaciones} comprobaciones, ${fallos} fallos, `
		+ `${erroresJS.length} JS errors, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
