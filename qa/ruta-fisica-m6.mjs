/** CAB-02/05/09/29/30: adopción, edición, Undo y reapertura de una ruta XYZ literal. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor, navegador, pagina, casos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
};
const cable = () => pagina.evaluate(() => window.qa.proyecto().conductores.find((c) => c.id === 'w1'));
const ruta = () => pagina.evaluate(() => window.qa.rutaDe('w1'));

const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA ruta M6',
	hojas: [{ id: 'h1', numero: 1, titulo: 'Prueba' }],
	dispositivos: [
		{ id: 'a', tipo: 'rele', designacion: '-K1', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'b', tipo: 'rele', designacion: '-K2', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'obstaculo', tipo: 'rele', designacion: '-K3', bornes: [{ id: '1' }, { id: '2' }] },
	],
	conductores: [
		{ id: 'w1', de: { dispositivoId: 'a', borneId: '1' }, a: { dispositivoId: 'b', borneId: '1' },
			seccion: 1.5, color: 'azul', fisica: { longitudManualM: 2.5 },
			trazado: [{ x: 130, y: 130, z: 35 }, { x: 260, y: 130, z: 35 }] },
		{ id: 'w2', de: { dispositivoId: 'a', borneId: '2' }, a: { dispositivoId: 'b', borneId: '2' },
			seccion: 1.5, color: 'negro' },
	],
	gabinete: { ancho: 500, alto: 300, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'a', x: 20, y: 35, ancho: 45, alto: 65 },
		{ dispositivoId: 'b', x: 330, y: 35, ancho: 45, alto: 65 },
		{ dispositivoId: 'obstaculo', x: 205, y: 110, ancho: 40, alto: 45 },
	] },
};

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1450, height: 900 } });
	pagina.setDefaultTimeout(25_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text()); });
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const archivo = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await archivo).setFiles({ name: 'legacy-v9.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA ruta M6');
	comprobar('V9 XY/XYZ carga sin conversión automática',
		(await cable()).rutaFisica === undefined && (await cable()).trazado?.length === 2);
	await pagina.locator('#hta-conectar').click();
	await pagina.locator('#lista-cables li').first().click();
	comprobar('la interfaz ofrece adopción explícita del XYZ legacy',
		await pagina.locator('#cbl-adoptar-m6').isVisible());
	await pagina.locator('#cbl-adoptar-m6').click();
	comprobar('preview declara diferencias y no adopta metraje eléctrico en silencio',
		/estimación legacy.*referencia espacial.*No se adopta automáticamente como longitud eléctrica/s
			.test(await pagina.locator('#modal-dialogo').innerText()));
	await pagina.locator('#dialogo-cancelar').click();
	comprobar('cancelar deja el proyecto y la ruta legacy intactos',
		(await cable()).rutaFisica === undefined && (await cable()).trazado?.[0].z === 35);
	await pagina.locator('#cbl-adoptar-m6').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => !!window.qa.proyecto().conductores.find((c) => c.id === 'w1')?.rutaFisica);
	const adoptado = await cable();
	comprobar('adopción conserva conexión/color/largo declarado y una sola ruta versionada',
		adoptado.rutaFisica.version === 1 && adoptado.trazado === undefined
		&& adoptado.fisica.longitudManualM === 2.5 && adoptado.color === 'azul'
		&& adoptado.de.dispositivoId === 'a' && adoptado.a.dispositivoId === 'b');
	comprobar('la geometría real atraviesa ambos nodos XYZ sin expulsión',
		(await ruta()).some((p) => p.x === 130 && p.y === 130 && p.z === 35)
		&& (await ruta()).some((p) => p.x === 260 && p.y === 130 && p.z === 35));
	const rutaAntesDiagnostico = JSON.stringify(await ruta());
	await pagina.locator('#cbl-diagnostico-m6').click();
	comprobar('interferencia manual se informa sin mover ni bloquear el cable',
		/Invade aparato obstaculo/.test(await pagina.locator('#cbl-resultado-m6').innerText())
		&& JSON.stringify(await ruta()) === rutaAntesDiagnostico);
	const x = pagina.locator('[data-ruta-nodo="0"][data-eje="x"]');
	await x.fill('145'); await x.press('Tab');
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.find((c) => c.id === 'w1')?.rutaFisica?.nodos[0].x === 145);
	comprobar('editar X numéricamente conserva Y/Z exactamente',
		JSON.stringify((await cable()).rutaFisica.nodos[0])
		=== JSON.stringify({ id: 'w1:n1', x: 145, y: 130, z: 35 }));
	comprobar('la vista usa la nueva coordenada, no una segunda verdad',
		(await ruta()).some((p) => p.x === 145 && p.y === 130 && p.z === 35));
	await pagina.locator('#btn-deshacer').click();
	comprobar('Undo restaura el nodo y su ID', (await cable()).rutaFisica?.nodos[0].x === 130);
	await pagina.locator('#btn-rehacer').click();
	comprobar('Redo restaura la misma ruta XYZ', (await cable()).rutaFisica?.nodos[0].x === 145);
	await pagina.locator('#btn-deshacer').click(); // deja una operación Redo que cancelar no debe borrar
	const historiaAntes = await pagina.evaluate(() => window.qa.historial());
	const nodoAntes = JSON.stringify((await cable()).rutaFisica.nodos[0]);
	const tirador = await pagina.evaluate(() => window.qa.puntoDeUnion('w1', 0));
	assert.ok(tirador && tirador.x > 0 && tirador.y > 0, 'el nodo M6 necesita un tirador visible');
	await pagina.mouse.move(tirador.x, tirador.y);
	await pagina.mouse.down();
	await pagina.keyboard.press('Escape');
	await pagina.mouse.up();
	comprobar('Escape antes del umbral libera el gesto sin tocar ruta ni historial',
		JSON.stringify((await cable()).rutaFisica.nodos[0]) === nodoAntes
		&& JSON.stringify(await pagina.evaluate(() => window.qa.historial())) === JSON.stringify(historiaAntes));
	await pagina.mouse.down();
	await pagina.mouse.move(tirador.x + 90, tirador.y + 28, { steps: 8 });
	await pagina.waitForFunction((anterior) =>
		JSON.stringify(window.qa.proyecto().conductores.find((c) => c.id === 'w1')?.rutaFisica?.nodos[0]) !== anterior,
		nodoAntes);
	await pagina.keyboard.press('Escape');
	await pagina.mouse.up();
	comprobar('Escape cancela el arrastre M6 sin ruta intermedia ni Undo fantasma',
		JSON.stringify((await cable()).rutaFisica.nodos[0]) === nodoAntes
		&& JSON.stringify(await pagina.evaluate(() => window.qa.historial())) === JSON.stringify(historiaAntes));
	await pagina.locator('#btn-rehacer').click();
	comprobar('Escape también conserva el Redo que existía antes del gesto',
		(await cable()).rutaFisica.nodos[0].x === 145);
	const historiaAntesDePerderFoco = await pagina.evaluate(() => window.qa.historial());
	const nodoAntesDePerderFoco = JSON.stringify((await cable()).rutaFisica.nodos[0]);
	const tiradorFoco = await pagina.evaluate(() => window.qa.puntoDeUnion('w1', 0));
	await pagina.mouse.move(tiradorFoco.x, tiradorFoco.y);
	await pagina.mouse.down();
	await pagina.mouse.move(tiradorFoco.x + 75, tiradorFoco.y + 20, { steps: 6 });
	await pagina.waitForFunction((anterior) =>
		JSON.stringify(window.qa.proyecto().conductores.find((c) => c.id === 'w1')?.rutaFisica?.nodos[0]) !== anterior,
		nodoAntesDePerderFoco);
	await pagina.evaluate(() => window.dispatchEvent(new Event('blur')));
	await pagina.mouse.up();
	comprobar('perder foco descarta la vista previa y restaura el historial',
		JSON.stringify((await cable()).rutaFisica.nodos[0]) === nodoAntesDePerderFoco
		&& JSON.stringify(await pagina.evaluate(() => window.qa.historial())) === JSON.stringify(historiaAntesDePerderFoco));
	const extremos = await pagina.evaluate(() => [window.qa.puntoDeUnion('w1', 0), window.qa.puntoDeUnion('w1', 1)]);
	assert.ok(extremos[0] && extremos[1], 'la polilínea M6 debe mantener ambos tiradores');
	const pixelNuevo = { x: extremos[0].x + (extremos[1].x - extremos[0].x) * 0.32,
		y: extremos[0].y + (extremos[1].y - extremos[0].y) * 0.32 };
	await pagina.mouse.dblclick(pixelNuevo.x, pixelNuevo.y, { delay: 90 });
	await pagina.waitForFunction(() => window.qa.proyecto().conductores.find((c) => c.id === 'w1')?.rutaFisica?.nodos.length === 3);
	const trasInsertar = (await cable()).rutaFisica.nodos;
	comprobar('doble clic inserta un nodo sobre el segmento M6 en su orden longitudinal',
		trasInsertar[0].id === 'w1:n1' && trasInsertar[2].id === 'w1:n2'
		&& trasInsertar[1].x > trasInsertar[0].x && trasInsertar[1].x < trasInsertar[2].x
		&& trasInsertar[1].z === 35);
	await pagina.locator('#btn-deshacer').click();
	comprobar('inserción M6 se deshace en una sola operación', (await cable()).rutaFisica.nodos.length === 2);
	await pagina.locator('#btn-rehacer').click();
	comprobar('Redo repone el nodo en la misma posición',
		JSON.stringify((await cable()).rutaFisica.nodos) === JSON.stringify(trasInsertar));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('reapertura conserva ruta, nodos y largo declarado',
		(await cable()).rutaFisica?.nodos[0].x === 145 && (await cable()).rutaFisica.nodos.length === 3
		&& (await cable()).fisica.longitudManualM === 2.5);
	comprobar('ningún error JavaScript', erroresJS.length === 0);
	console.log(`QA ruta física M6: ${casos}/${casos}, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
} catch (error) {
	console.error(error);
	process.exitCode = 1;
} finally {
	try { await pagina?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	try { await navegador?.close(); } catch (error) { console.error(error); process.exitCode = 1; }
	if (servidor) {
		servidor.closeAllConnections?.();
		await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()))
			.catch((error) => { console.error(error); process.exitCode = 1; });
	}
}
