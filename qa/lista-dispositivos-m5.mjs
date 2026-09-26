/** MON-04 parcial: encontrar, seleccionar y enfocar sin alterar el tablero. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

let servidor, navegador, pagina;
let casos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	casos++;
	assert.ok(condicion, nombre);
	console.log(`OK ${nombre}`);
};

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1366, height: 850 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text()); });
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo', { hasText: 'Arranque directo de motor' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Arranque directo de motor 380 V');
	if (await pagina.locator('#modal-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	await pagina.locator('#hta-seleccionar').click();
	if (!await pagina.locator('#seccion-dispositivos').evaluate((e) => e.open))
		await pagina.locator('#seccion-dispositivos summary').click();
	const antes = await pagina.evaluate(() => JSON.stringify(window.qa.proyecto()));
	const total = await pagina.evaluate(() => window.qa.proyecto().dispositivos.length);
	comprobar('la lista inicia con todos los aparatos del tablero, sin cero ficticio',
		await pagina.locator('#lista-dispositivos li').count() === total
		&& await pagina.locator('#contador-dispositivos').innerText() === `(${total})`);
	await pagina.locator('#buscar-dispositivos').fill('linea motor');
	comprobar('la búsqueda sin acento encuentra por descripción con AND de términos',
		await pagina.locator('#lista-dispositivos li').count() === 1
		&& /Contactor de línea del motor/.test(await pagina.locator('#lista-dispositivos li').innerText())
		&& await pagina.locator('#contador-dispositivos').innerText() === `(1/${total})`);
	await pagina.locator('#lista-dispositivos li').first().click();
	comprobar('selección de la fila mantiene búsqueda y usa identidad del aparato',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'km1'
		&& await pagina.locator('#buscar-dispositivos').inputValue() === 'linea motor');
	const camaraAntes = await pagina.evaluate(() => window.qa.camara());
	await pagina.locator('#lista-dispositivos li .foco').click();
	const camara = await pagina.evaluate(() => window.qa.camara());
	const bulto = await pagina.evaluate(() => window.qa.bulto('km1'));
	comprobar('Enfocar lleva el pivote al aparato seleccionado, no modifica su identidad',
		// La caja enfocada incluye rótulos; el bulto de QA mide solo el cuerpo (2,7 mm aquí).
		Math.hypot(camara.tx - bulto.x, camara.ty - bulto.y, camara.tz - bulto.z) < 5
		&& Math.hypot(camara.tx - camaraAntes.tx, camara.ty - camaraAntes.ty, camara.tz - camaraAntes.tz) > 1
		&& (await pagina.evaluate(() => window.qa.seleccion()))?.id === 'km1');
	await pagina.locator('#buscar-dispositivos').fill('sin-aparato-inexistente');
	comprobar('cero coincidencias explica que los aparatos no se eliminaron',
		/siguen en el tablero/.test(await pagina.locator('#lista-dispositivos').innerText())
		&& await pagina.locator('#contador-dispositivos').innerText() === `(0/${total})`);
	await pagina.locator('#buscar-dispositivos').press('Escape');
	comprobar('Escape restaura la lista completa',
		await pagina.locator('#lista-dispositivos li').count() === total
		&& await pagina.locator('#buscar-dispositivos').inputValue() === '');
	await pagina.locator('#buscar-dispositivos').fill('q1');
	await pagina.locator('#lista-dispositivos li').first().focus();
	await pagina.keyboard.press('Enter');
	comprobar('la lista filtrada sigue seleccionable por teclado',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'q1');
	comprobar('búsqueda, selección y foco no mutan el Proyecto',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antes);
	await pagina.locator('#buscar-dispositivos').fill('linea motor');
	const km = pagina.locator('#lista-dispositivos li').first();
	const puntoKm = await pagina.evaluate(() => {
		const p = window.qa.centroEnPantallaAparato('km1');
		if (!p) return undefined;
		for (const dy of [0, -6, 6, -12, 12, -20, 20])
			for (const dx of [0, -6, 6, -12, 12, -20, 20])
				if (window.qa.aparatoEnPixel(p.x + dx, p.y + dy) === 'km1')
					return { x: p.x + dx, y: p.y + dy };
		return undefined;
	});
	comprobar('KM1 tiene un píxel seleccionable antes de ocultarlo', !!puntoKm);
	await km.locator('.accion-vista', { hasText: 'Ocultar' }).click();
	comprobar('ocultar retira el cuerpo de la escena, pero conserva su fila y su identidad',
		!(await pagina.evaluate(() => window.qa.vistaDeAparato('km1'))).visible
		&& await pagina.locator('#lista-dispositivos li').count() === 1
		&& await pagina.locator('#lista-dispositivos li.oculto').count() === 1);
	comprobar('ocultar no deja seleccionado el aparato invisible',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id !== 'km1');
	comprobar('el rayo sobre la misma malla oculta ya no selecciona KM1',
		await pagina.evaluate(p => window.qa.aparatoEnPixel(p.x, p.y), puntoKm) !== 'km1');
	await pagina.locator('#hta-conectar').click();
	comprobar('al cambiar a Cablear, los bornes ocultos no reaparecen como agarres fantasma',
		(await pagina.evaluate(() => window.qa.vistaDeAparato('km1'))).bornesVisibles === 0
		&& (await pagina.evaluate(() => window.qa.vistaDeAparato('q1'))).bornesVisibles > 0);
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#lista-dispositivos li .des').first().click();
	comprobar('la lista recupera selección y cuerpo de un aparato oculto',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'km1'
		&& (await pagina.evaluate(() => window.qa.vistaDeAparato('km1'))).visible);
	await pagina.locator('#lista-dispositivos li .accion-vista', { hasText: 'Aislar' }).click();
	comprobar('aislar conserva KM1 y aparta otros cuerpos sin borrarlos',
		(await pagina.evaluate(() => window.qa.vistaDeAparato('km1'))).visible
		&& !(await pagina.evaluate(() => window.qa.vistaDeAparato('q1'))).visible
		&& await pagina.locator('#vista-montaje-restaurar').isVisible());
	await pagina.locator('#vista-montaje-restaurar').click();
	comprobar('restaurar vista devuelve los cuerpos aislados',
		(await pagina.evaluate(() => window.qa.vistaDeAparato('q1'))).visible
		&& await pagina.locator('#vista-montaje-restaurar').isHidden());
	comprobar('ocultación y aislamiento no mutan Proyecto ni crean historial',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antes
		&& (await pagina.evaluate(() => window.qa.historial())).deshacer === 0);
	assert.equal(await trabajarSobreCopia(pagina), true, 'el ejemplo debe producir una copia editable');
	await pagina.locator('#buscar-dispositivos').fill('linea motor');
	const filaEditable = pagina.locator('#lista-dispositivos li[data-dispositivo-id="km1"]');
	const antesBloqueo = await pagina.evaluate(() => JSON.stringify(window.qa.proyecto()));
	const undoBloqueo = (await pagina.evaluate(() => window.qa.historial())).deshacer;
	await filaEditable.locator('.accion-bloqueo').click();
	comprobar('Bloquear muestra estado accesible sin alterar proyecto ni historial',
		await filaEditable.locator('.accion-bloqueo').getAttribute('aria-pressed') === 'true'
		&& await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antesBloqueo
		&& (await pagina.evaluate(() => window.qa.historial())).deshacer === undoBloqueo);
	await filaEditable.locator('.des').click();
	comprobar('el aparato bloqueado sigue seleccionable por identidad',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'km1');
	await pagina.locator('#pos-aparato-aplicar').waitFor({ state: 'visible' });
	const posicion = await pagina.evaluate(() => window.qa.proyecto().gabinete.colocaciones.find(c => c.dispositivoId === 'km1'));
	await pagina.locator('#pos-aparato-x').fill(String(posicion.x + 5));
	await pagina.locator('#pos-aparato-aplicar').click();
	comprobar('la posición numérica no mueve un aparato bloqueado ni crea Undo',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antesBloqueo
		&& (await pagina.evaluate(() => window.qa.historial())).deshacer === undoBloqueo);
	await pagina.locator('#dev-descripcion').fill('Cambio que debe rechazarse');
	await pagina.locator('#dev-descripcion').press('Tab');
	comprobar('la ficha tampoco modifica un aparato bloqueado',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antesBloqueo
		&& (await pagina.evaluate(() => window.qa.historial())).deshacer === undoBloqueo);
	await filaEditable.locator('.des').click();
	await pagina.keyboard.press('Delete');
	comprobar('Supr no borra un aparato bloqueado ni abre confirmación',
		await pagina.evaluate(() => JSON.stringify(window.qa.proyecto())) === antesBloqueo
		&& (await pagina.evaluate(() => window.qa.historial())).deshacer === undoBloqueo
		&& await pagina.locator('#modal-dialogo').isHidden());
	await filaEditable.locator('.accion-vista', { hasText: 'Ocultar' }).click();
	await pagina.locator('#vista-montaje-restaurar').click();
	comprobar('restaurar visibilidad no desbloquea la edición',
		await filaEditable.locator('.accion-bloqueo').getAttribute('aria-pressed') === 'true');
	await filaEditable.locator('.accion-bloqueo').click();
	await filaEditable.locator('.des').click();
	await pagina.locator('#pos-aparato-x').fill(String(posicion.x + 5));
	await pagina.locator('#pos-aparato-aplicar').click();
	comprobar('desbloquear habilita la misma edición real',
		(await pagina.evaluate(() => window.qa.proyecto().gabinete.colocaciones.find(c => c.dispositivoId === 'km1').x)) === posicion.x + 5
		&& (await pagina.evaluate(() => window.qa.historial())).deshacer === undoBloqueo + 1);
	await filaEditable.locator('.accion-bloqueo').click();
	await pagina.locator('#lista-dispositivos li .accion-vista', { hasText: 'Ocultar' }).click();
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo', { hasText: 'Arranque estrella-triángulo' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre.startsWith('Arranque estrella-triángulo'));
	comprobar('cambiar de tablero borra la ocultación temporal aunque reutilice KM1',
		(await pagina.evaluate(() => window.qa.vistaDeAparato('km1'))).visible
		&& await pagina.locator('#vista-montaje-restaurar').isHidden());
	comprobar('cambiar de tablero también limpia el bloqueo temporal del mismo ID',
		(await pagina.evaluate(() => window.qa.vistaDeAparato('km1'))).bloqueado === false);
	if (await pagina.locator('#modal-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#buscar-dispositivos').fill('campo motor');
	comprobar('la lista localiza el motor de campo por función y ubicación',
		await pagina.locator('#lista-dispositivos li[data-dispositivo-id="m1"]').count() === 1
		&& /Campo/.test(await pagina.locator('#lista-dispositivos li[data-dispositivo-id="m1"] .lugar').innerText()));
	await pagina.locator('#lista-dispositivos li[data-dispositivo-id="m1"] .des').click();
	comprobar('un aparato de campo se puede seleccionar por la misma lista',
		(await pagina.evaluate(() => window.qa.seleccion()))?.id === 'm1');
	await pagina.locator('#buscar-dispositivos').fill('puerta piloto');
	comprobar('la lista diferencia pilotos de puerta sin otra identidad',
		await pagina.locator('#lista-dispositivos li[data-dispositivo-id="hr"]').count() === 1
		&& /Puerta/.test(await pagina.locator('#lista-dispositivos li[data-dispositivo-id="hr"] .lugar').innerText()));
	const hr = pagina.locator('#lista-dispositivos li[data-dispositivo-id="hr"]');
	await hr.locator('.accion-vista', { hasText: 'Ocultar' }).click();
	comprobar('la misma lista recupera un piloto oculto de puerta',
		!(await pagina.evaluate(() => window.qa.vistaDeAparato('hr'))).visible);
	await hr.locator('.des').click();
	comprobar('seleccionar piloto oculto lo hace visible sin recrear el aparato',
		(await pagina.evaluate(() => window.qa.vistaDeAparato('hr'))).visible
		&& (await pagina.evaluate(() => window.qa.seleccion()))?.id === 'hr');
	comprobar('ningún error JavaScript', erroresJS.length === 0);
	console.log(`MON-04 lista y visibilidad de aparatos: ${casos}/${casos}, 0 JS`);
} catch (fallo) {
	console.error(fallo);
	process.exitCode = 1;
} finally {
	await pagina?.close().catch(() => {});
	await navegador?.close().catch(() => {});
	if (servidor) await new Promise((resolve) => servidor.close(resolve));
}
