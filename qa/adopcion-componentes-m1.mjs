/** Un componente r1 colocado/cableado no cambia con la biblioteca: la adopción r2 es explícita. */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfFYAAAAASUVORK5CYII=', 'base64');
const PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
const NOMBRE = 'Piloto QA adopción M1';
const { servidor, url } = await servidorDeQA();
const anteriorCwd = process.cwd();
const temporal = mkdtempSync(join(tmpdir(), 'qa-adopcion-componentes-'));
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);
let navegador; let contexto; let pagina;
let fallos = 0; let comprobaciones = 0;
const erroresJs = [];
function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}
const qa = (nombre, ...argumentos) => pagina.evaluate(([n, a]) => window.qa[n](...a), [nombre, argumentos]);
const proyecto = () => qa('proyecto');
const componente = async (id) => (await proyecto()).dispositivos.find((d) => d.id === id);
const reposo = async () => qa('esperarPersistencia');
const tarjeta = () => pagina.locator('#ui-componentes-personalizados .cp-tarjeta').filter({ hasText: NOMBRE }).first();

async function abrirBiblioteca() {
	await pagina.locator('#btn-componentes-personalizados').click();
	await pagina.locator('#ui-componentes-personalizados').waitFor({ state: 'visible' });
}
async function abrirTableros() {
	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-mis-tableros').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'visible' });
}
async function abrirDocumento(id) {
	await abrirTableros();
	await pagina.locator(`.tarjeta-documento[data-documento-id="${id}"]`)
		.getByRole('button', { name: 'Abrir', exact: true }).click();
	await pagina.waitForFunction((documentoId) => window.qa.documentoActivo().id === documentoId, id);
	await reposo();
}
async function seleccionarInstancia() {
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#lista-dispositivos li').filter({ hasText: NOMBRE }).first().click();
}
async function subirImagen(bytes) {
	const previa = await pagina.locator('[data-cp="preview"] img').getAttribute('src').catch(() => null);
	const chooser = pagina.waitForEvent('filechooser');
	await pagina.locator('[data-cp="imagen"]').click();
	await (await chooser).setFiles({ name: 'piloto-adopcion.png', mimeType: 'image/png', buffer: bytes });
	await pagina.locator('[data-cp="preview"] img').waitFor({ state: 'visible' });
	if (previa) await pagina.waitForFunction((antes) =>
		document.querySelector('[data-cp="preview"] img')?.getAttribute('src') !== antes, previa);
}

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1500, height: 940 } });
	pagina = await contexto.newPage();
	pagina.setDefaultTimeout(25_000);
	pagina.on('pageerror', (e) => erroresJs.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon\.ico/i.test(m.location().url ?? '')) erroresJs.push(m.text());
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#bienvenida').isVisible()) await pagina.locator('#btn-empezar-blanco').click();
	await reposo();

	console.log('\n--- Componente r1 colocado y conectado por la UI ---');
	await abrirBiblioteca();
	await pagina.locator('[data-cp="nuevo"]').click();
	await pagina.locator('[data-cp-campo="tipo"]').selectOption('piloto');
	await pagina.locator('[data-cp-campo="nombre"]').fill(NOMBRE);
	await pagina.locator('[data-cp-campo="descripcion"]').fill(NOMBRE);
	await pagina.locator('[data-cp-campo="ancho"]').fill('35');
	await pagina.locator('[data-cp-campo="alto"]').fill('45');
	await subirImagen(PNG1);
	await pagina.locator('[data-cp="preview"] img').click({ position: { x: 38, y: 45 } });
	await pagina.locator('[data-cp="preview"] img').click({ position: { x: 185, y: 125 } });
	const filas = pagina.locator('[data-cp="terminales"] tr');
	for (const [indice, id, tipo, rol] of [[0, 'L', 'L', 'carga-fase'], [1, 'N', 'N', 'carga-retorno']]) {
		const fila = filas.nth(indice);
		await fila.locator('input').first().fill(id);
		await fila.locator('select').nth(0).selectOption(tipo);
		await fila.locator('select').nth(1).selectOption(rol);
	}
	await pagina.locator('[data-cp="validar"]').click();
	await pagina.locator('[data-cp="errores"].cp-ok').waitFor();
	await pagina.locator('[data-cp="guardar"]').click();
	await tarjeta().waitFor({ state: 'visible' });
	const definicionR1 = (await qa('componentesPersonalizados'))[0];
	const definicionId = definicionR1.id;
	await tarjeta().getByRole('button', { name: 'Colocar', exact: true }).click();
	await pagina.locator('#ui-componentes-personalizados').waitFor({ state: 'hidden' });
	await pagina.locator('#escena canvas').click({ position: { x: 520, y: 260 } });
	await reposo();
	const instancia = (await proyecto()).dispositivos.find((d) => d.componentePersonalizado?.definicionId === definicionId);
	comprobar('la instancia fija r1 y su PNG', instancia?.componentePersonalizado?.revision === 1 && instancia.imagen?.startsWith('blob:'));
	const imagenR1 = instancia.imagen;
	const idsAntes = new Set((await proyecto()).dispositivos.map((d) => d.id));
	await pagina.locator('#hta-anadir').click();
	await pagina.locator('#buscar-catalogo').fill('Acometida 220 V');
	await pagina.locator('#catalogo .item-catalogo').filter({ hasText: 'Acometida 220 V (red)' }).first().click();
	const fuente = (await proyecto()).dispositivos.find((d) => !idsAntes.has(d.id) && d.campo);
	if (!fuente) throw new Error('El catálogo no colocó la acometida de campo.');
	await pagina.locator('#hta-conectar').click();
	await pagina.locator('#btn-centrar').click();
	const origen = await qa('puntoParaBorne', fuente.id, 'L');
	const destino = await qa('puntoParaBorne', instancia.id, 'L');
	if (!origen || !destino) throw new Error('Los bornes de la regresión no quedaron visibles.');
	await pagina.mouse.click(origen.x, origen.y);
	await pagina.mouse.click(destino.x, destino.y);
	await pagina.waitForFunction((id) => window.qa.proyecto().conductores.some((c) =>
		(c.de.dispositivoId === id && c.de.borneId === 'L') || (c.a.dispositivoId === id && c.a.borneId === 'L')), instancia.id);
	await reposo();
	const cableId = (await proyecto()).conductores.find((c) => c.de.dispositivoId === instancia.id || c.a.dispositivoId === instancia.id).id;
	comprobar('un cable real ocupa L en r1', !!cableId);
	const tableroA = (await qa('documentoActivo')).id;
	await abrirTableros();
	await pagina.locator(`.tarjeta-documento[data-documento-id="${tableroA}"]`)
		.getByRole('button', { name: 'Duplicar', exact: true }).click();
	await pagina.waitForFunction(() => window.qa.documentos().then((ds) => ds.length === 2));
	const tableroB = (await qa('documentos')).find((d) => d.id !== tableroA).id;
	comprobar('duplicar crea Tablero B con identidad distinta sin activar la copia',
		!!tableroB && (await qa('documentoActivo')).id === tableroA);
	await pagina.locator('#btn-cerrar-tableros').click();

	console.log('\n--- Revisión r2 cambia SOLO la foto; A/B permanecen en r1 ---');
	await abrirBiblioteca();
	await tarjeta().getByRole('button', { name: 'Editar', exact: true }).click();
	await subirImagen(PNG2);
	await pagina.locator('[data-cp="validar"]').click();
	await pagina.locator('[data-cp="errores"].cp-ok').waitFor();
	await pagina.locator('[data-cp="guardar"]').click();
	await tarjeta().waitFor({ state: 'visible' });
	const definicionR2 = (await qa('componentesPersonalizados'))[0];
	comprobar('biblioteca r2 cambia solo asset: terminales y perfil son idénticos',
		definicionR2.revision === 2 && definicionR2.assetId !== definicionR1.assetId
		&& JSON.stringify(definicionR2.terminales) === JSON.stringify(definicionR1.terminales)
		&& JSON.stringify(definicionR2.comportamiento) === JSON.stringify(definicionR1.comportamiento));
	comprobar('publicar r2 no muta A ni su cable conectado',
		(await componente(instancia.id)).componentePersonalizado.revision === 1
		&& (await proyecto()).conductores.some((c) => c.id === cableId &&
			(c.de.borneId === 'L' || c.a.borneId === 'L')));
	await pagina.locator('#ui-componentes-personalizados [data-cp="cerrar"]').click();
	await abrirDocumento(tableroB);
	comprobar('Tablero B conserva instancia r1 y cable L tras publicar r2',
		(await componente(instancia.id)).componentePersonalizado.revision === 1
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L' || c.a.borneId === 'L')));
	await abrirDocumento(tableroA);
	comprobar('Tablero A continúa r1 al regresar desde B',
		(await componente(instancia.id)).componentePersonalizado.revision === 1);
	await seleccionarInstancia();
	await pagina.locator('#btn-revisar-componente').waitFor({ state: 'visible' });
	await pagina.locator('#btn-revisar-componente').click();
	const previewImagen = await pagina.locator('[data-adopcion="impacto"]').innerText();
	comprobar('preview r2 muestra mapeo L → L y foto nueva sin alterar lógica',
		(await pagina.getByLabel('Nuevo borne para L', { exact: true }).inputValue()) === 'L'
		&& previewImagen.includes('L → L') && /Perfil eléctrico: se conserva/.test(previewImagen)
		&& /Imagen: cambia/.test(previewImagen));
	await pagina.locator('[data-adopcion="cancelar"]').click();
	comprobar('cancelar r2 conserva A en r1', (await componente(instancia.id)).componentePersonalizado.revision === 1);
	await pagina.locator('#btn-revisar-componente').click();
	await pagina.locator('[data-adopcion="confirmar"]').click();
	await pagina.locator('#modal-adopcion-componente').waitFor({ state: 'detached' });
	await reposo();
	comprobar('confirmar r2 cambia solo foto/revisión de A, no borne ni cable',
		(await componente(instancia.id)).componentePersonalizado.revision === 2
		&& (await componente(instancia.id)).assetId === definicionR2.assetId
		&& (await componente(instancia.id)).imagen !== imagenR1
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L' || c.a.borneId === 'L')));

	console.log('\n--- Revisión r3 cambia ID de borne; adopción exige mapeo explícito ---');
	await abrirBiblioteca();
	await tarjeta().getByRole('button', { name: 'Editar', exact: true }).click();
	await pagina.locator('[data-cp="terminales"] tr').first().locator('input').first().fill('L2');
	await pagina.locator('[data-cp="validar"]').click();
	await pagina.locator('[data-cp="errores"].cp-ok').waitFor();
	await pagina.locator('[data-cp="guardar"]').click();
	await tarjeta().waitFor({ state: 'visible' });
	const definicionR3 = (await qa('componentesPersonalizados'))[0];
	comprobar('biblioteca r3 cambió terminal/perfil pero no repitió el asset',
		definicionR3.revision === 3 && definicionR3.assetId === definicionR2.assetId
		&& definicionR3.terminales[0].id === 'L2');
	await pagina.locator('#ui-componentes-personalizados [data-cp="cerrar"]').click();
	await abrirDocumento(tableroB);
	comprobar('Tablero B continúa r1 después de publicar r3', (await componente(instancia.id)).componentePersonalizado.revision === 1);
	await abrirDocumento(tableroA);
	comprobar('Tablero A sigue en r2 antes de adoptar r3', (await componente(instancia.id)).componentePersonalizado.revision === 2);
	const imagenAntesR3 = (await componente(instancia.id)).imagen;
	await seleccionarInstancia();
	await pagina.locator('#btn-revisar-componente').waitFor({ state: 'visible' });
	await pagina.locator('#btn-revisar-componente').click();
	await pagina.locator('#modal-adopcion-componente').waitFor({ state: 'visible' });
	for (const ancho of [1024, 1366]) {
		await pagina.setViewportSize({ width: ancho, height: 768 });
		await pagina.screenshot({ path: join(tmpdir(), `tablerostudio-m1-adopcion-${ancho}.png`) });
		const cabe = await pagina.evaluate(() => {
			const caja = document.querySelector('#modal-adopcion-componente .adopcion-caja').getBoundingClientRect();
			return caja.left >= 0 && caja.right <= innerWidth && caja.top >= 0 && caja.bottom <= innerHeight;
		});
		comprobar(`modal de adopción cabe a ${ancho} px`, cabe);
	}
	await pagina.setViewportSize({ width: 1500, height: 940 });
	comprobar('L anterior no se mapea por coincidencia inexistente',
		await pagina.getByLabel('Nuevo borne para L', { exact: true }).inputValue() === ''
		&& await pagina.locator('[data-adopcion="confirmar"]').isDisabled());
	await pagina.locator('[data-adopcion="cancelar"]').click();
	comprobar('cancelar conserva íntegramente r2 y cable L',
		(await componente(instancia.id)).componentePersonalizado.revision === 2
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L' || c.a.borneId === 'L')));

	console.log('\n--- Mapeo explícito, preview, confirmación, undo/redo y persistencia ---');
	const historialAntes = await qa('historial');
	await pagina.locator('#btn-revisar-componente').click();
	await pagina.getByLabel('Nuevo borne para L', { exact: true }).selectOption('L2');
	const preview = await pagina.locator('[data-adopcion="impacto"]').innerText();
	comprobar('preview muestra L → L2, cable, perfil y revisión de rutas',
		preview.includes('L → L2') && preview.includes(cableId)
		&& /Imagen: se conserva/.test(preview) && /rutas\/cables: requieren revisión visual/.test(preview), preview.slice(0, 190));
	await pagina.locator('[data-adopcion="confirmar"]').click();
	await pagina.locator('#modal-adopcion-componente').waitFor({ state: 'detached' });
	await reposo();
	const despues = await componente(instancia.id);
	const cable = (await proyecto()).conductores.find((c) => c.id === cableId);
	comprobar('confirmar crea una mutación: r3, L2, PNG conservado y un undo',
		despues.componentePersonalizado.revision === 3 && despues.imagen === imagenAntesR3
		&& (cable.de.borneId === 'L2' || cable.a.borneId === 'L2')
		&& (await qa('historial')).deshacer === historialAntes.deshacer + 1);
	await pagina.locator('#btn-deshacer').click();
	comprobar('Deshacer restaura r2 y cable L juntos',
		(await componente(instancia.id)).componentePersonalizado.revision === 2
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L' || c.a.borneId === 'L')));
	await pagina.locator('#btn-rehacer').click();
	await reposo();
	comprobar('Rehacer repone r3 y L2 juntos',
		(await componente(instancia.id)).componentePersonalizado.revision === 3
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L2' || c.a.borneId === 'L2')));
	await pagina.reload({ waitUntil: 'load' });
	await esperarEditorListo(pagina);
	comprobar('r3 y L2 sobreviven recarga, sin imagen inline en autosave',
		(await componente(instancia.id)).componentePersonalizado.revision === 3
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L2' || c.a.borneId === 'L2'))
		&& (await componente(instancia.id)).imagen?.startsWith('blob:'));
	await abrirDocumento(tableroB);
	comprobar('adoptar en A no cambia B: r1, borne L y asset r1',
		(await componente(instancia.id)).componentePersonalizado.revision === 1
		&& (await componente(instancia.id)).assetId === definicionR1.assetId
		&& (await proyecto()).conductores.some((c) => c.id === cableId && (c.de.borneId === 'L' || c.a.borneId === 'L')));
	comprobar('0 errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 3).join(' | '));
} catch (e) {
	fallos++;
	console.error(e?.stack ?? e);
} finally {
	try { await contexto?.close(); } catch (e) { fallos++; console.error('Cierre contexto:', e); }
	try { await navegador?.close(); } catch (e) { fallos++; console.error('Cierre navegador:', e); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve())); }
	catch (e) { fallos++; console.error('Cierre servidor:', e); }
	process.chdir(anteriorCwd);
	rmSync(temporal, { recursive: true, force: true });
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}
console.log(`\n${comprobaciones} comprobaciones · ${fallos} fallos · ${erroresJs.length} errores JS`);
process.exitCode = fallos ? 1 : 0;
