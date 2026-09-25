/** ESQ-05: un aparato desdoblado se copia desde la UI como una sola identidad eléctrica. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA copia desdoblada M2',
	hojas: [{ id: 'h1', numero: 1, titulo: 'Mando' }, { id: 'h2', numero: 2, titulo: 'Potencia' }],
	gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'km1', x: 30, y: 40, ancho: 35, alto: 30 },
		{ dispositivoId: 'x1', x: 90, y: 40, ancho: 35, alto: 30 },
	] },
	dispositivos: [
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1',
			bornes: ['1/L1', '2/T1', '3/L2', '4/T2', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' }],
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
			},
		},
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
	],
	conductores: [{ id: 'c1', de: { dispositivoId: 'km1', borneId: 'A1' },
		a: { dispositivoId: 'x1', borneId: '1' } }],
	esquema: { representaciones: [
		{ id: 'bobina', dispositivoId: 'km1', hojaId: 'h1',
			posicion: { columna: 3, fila: 2 }, parte: { tipo: 'bobina' } },
		{ id: 'polos', dispositivoId: 'km1', hojaId: 'h2',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' },
			] } },
		{ id: 'auxiliar', dispositivoId: 'km1', hojaId: 'h1',
			posicion: { columna: 5, fila: 4 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
		{ id: 'x-vista', dispositivoId: 'x1', hojaId: 'h1',
			posicion: { columna: 7, fila: 5 }, parte: { tipo: 'completa' } },
	] },
};
let servidor, navegador, pagina, casos = 0;
const erroresJS = [];
function comprobar(nombre, condicion) {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
}
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const historial = () => pagina.evaluate(() => window.qa.historial().deshacer);
async function pegar(destino) {
	await pagina.locator('#esq-pegar-vista').click();
	await pagina.locator('#dialogo-input').fill(destino);
	await pagina.locator('#dialogo-ok').click();
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
	await (await chooser).setFiles({ name: 'qa-grupo-m2.tablero.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA copia desdoblada M2');
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esquema-hoja .simbolo[data-representacion="bobina"] rect[fill="transparent"]')
		.click({ position: { x: 4, y: 4 } });
	const antes = await proyecto(), undo0 = await historial();
	comprobar('una vista funcional permite copiar el aparato entero',
		await pagina.locator('#esq-copiar-vista').isEnabled());
	await pagina.locator('#esq-copiar-vista').click();
	comprobar('copiar no muta el proyecto ni crea Undo',
		JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0 && await pagina.locator('#esq-pegar-vista').isEnabled());
	await pagina.locator('#esq-girar-vista').click();
	comprobar('editar una vista del origen invalida la copia preparada',
		await pagina.locator('#esq-pegar-vista').isDisabled());
	await pagina.locator('#esq-ajustar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.find((r) => r.id === 'bobina')?.giro === undefined);
	await pagina.locator('#esq-copiar-vista').click();
	comprobar('Undo y copiar de nuevo restablecen el grupo original',
		JSON.stringify(await proyecto()) === JSON.stringify(antes)
		&& await historial() === undo0 && await pagina.locator('#esq-pegar-vista').isEnabled());
	await pegar('2.6.2');
	comprobar('mover el grupo a otro folio se rechaza sin efectos laterales',
		JSON.stringify(await proyecto()) === JSON.stringify(antes) && await historial() === undo0);
	await pegar('1.6.2');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 3);
	const despues = await proyecto();
	const copia = despues.dispositivos.find((d) => d.id !== 'km1' && d.id !== 'x1');
	const vistas = despues.esquema.representaciones.filter((r) => r.dispositivoId === copia?.id);
	const porParte = Object.fromEntries(vistas.map((r) => [r.parte.tipo === 'contactos'
		? r.parte.pares[0].entrada : r.parte.tipo, r]));
	comprobar('un Undo crea una sola identidad eléctrica y tres vistas en sus folios',
		!!copia && vistas.length === 3 && await historial() === undo0 + 1
		&& copia.designacion === '-KM2' && copia.numero === 2
		&& porParte.bobina?.hojaId === 'h1' && porParte.bobina?.posicion.columna === 6
		&& porParte['13']?.hojaId === 'h1' && porParte['13']?.posicion.columna === 8
		&& porParte['1/L1']?.hojaId === 'h2' && porParte['1/L1']?.posicion.columna === 7);
	comprobar('ningún conductor se copió ni cambió de extremo',
		JSON.stringify(despues.conductores) === JSON.stringify(antes.conductores)
		&& !despues.conductores.some((c) => c.de.dispositivoId === copia.id || c.a.dispositivoId === copia.id));
	comprobar('bobina y auxiliar copiados son visibles en Mando',
		await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${porParte.bobina.id}"]`).count() === 1
		&& await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${porParte['13'].id}"]`).count() === 1);
	mkdirSync(new URL('./_salida/', import.meta.url), { recursive: true });
	await pagina.locator('#esquema-hoja').screenshot({ path: fileURLToPath(new URL('./_salida/esquema-grupo-mando.png', import.meta.url)) });
	await pagina.locator('#esq-siguiente').click();
	comprobar('polos copiados son visibles en Potencia',
		await pagina.locator(`#esquema-hoja .simbolo[data-representacion="${porParte['1/L1'].id}"]`).count() === 1);
	await pagina.locator('#esquema-hoja').screenshot({ path: fileURLToPath(new URL('./_salida/esquema-grupo-potencia.png', import.meta.url)) });
	await pagina.locator('#esq-ajustar').focus();
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 2);
	comprobar('Undo retira aparato físico y las tres vistas juntos',
		(await proyecto()).esquema.representaciones.every((r) => r.dispositivoId !== copia.id)
		&& (await proyecto()).gabinete.colocaciones.every((c) => c.dispositivoId !== copia.id));
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 3);
	comprobar('Redo restaura las tres vistas sin copiar cables',
		(await proyecto()).esquema.representaciones.filter((r) => r.dispositivoId === copia.id).length === 3
		&& JSON.stringify((await proyecto()).conductores) === JSON.stringify(antes.conductores));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	comprobar('reapertura conserva identidad, folios, vistas y circuito',
		(await proyecto()).dispositivos.some((d) => d.id === copia.id)
		&& (await proyecto()).esquema.representaciones.filter((r) => r.dispositivoId === copia.id).length === 3
		&& JSON.stringify((await proyecto()).conductores) === JSON.stringify(antes.conductores));
	comprobar('cero errores JavaScript', erroresJS.length === 0);
} catch (error) {
	console.error(error);
	if (erroresJS.length) console.error('Errores JS:', erroresJS);
	process.exitCode = 1;
} finally {
	try { await pagina?.close(); } catch (error) { console.error('Página no cerró:', error); process.exitCode = 1; }
	try { await navegador?.close(); } catch (error) { console.error('Chromium no cerró:', error); process.exitCode = 1; }
	try {
		servidor?.closeAllConnections?.();
		if (servidor) await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { console.error('Servidor no cerró:', error); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`ESQ-05 copia desdoblada: ${casos}/${casos}, 0 JS; ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
