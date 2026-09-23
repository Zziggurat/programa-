/**
 * Montaje M1 visto desde la interfaz: una definición de placa con anclajes no se
 * acopla a DIN ni atraviesa canaletas; una definición legacy no se certifica.
 * Los hooks QA solamente leen estado persistente o convierten mm en píxeles.
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
	'base64',
);
const NOMBRE_PLACA = 'Caja placa M1 QA';
const NOMBRE_LEGACY = 'Caja sin método M1 QA';
const { servidor, url } = await servidorDeQA();
const cwdAnterior = process.cwd();
const temporal = mkdtempSync(join(tmpdir(), 'qa-montaje-m1-'));
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);

let navegador; let contexto; let pagina;
let comprobaciones = 0; let fallos = 0;
const erroresJs = [];
function comprobar(nombre, condicion, detalle = '') {
	comprobaciones++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
	if (!condicion) { fallos++; throw new Error(`Falló: ${nombre}${detalle ? ` (${detalle})` : ''}`); }
}
const qa = (metodo, ...args) => pagina.evaluate(
	([nombre, parametros]) => window.qa[nombre](...parametros), [metodo, args],
);
const proyecto = () => qa('proyecto');
const dispositivoDe = async (definicionId) => (await proyecto()).dispositivos.find(
	(d) => d.componentePersonalizado?.definicionId === definicionId,
);
const colocacionDe = async (dispositivoId) => (await proyecto()).gabinete.colocaciones.find(
	(c) => c.dispositivoId === dispositivoId,
);
const tarjeta = (nombre) => pagina.locator('#ui-componentes-personalizados .cp-tarjeta')
	.filter({ hasText: nombre }).first();

async function abrirBiblioteca() {
	await pagina.waitForFunction(() => !document.getElementById('btn-componentes-personalizados')?.disabled);
	await pagina.locator('#btn-componentes-personalizados').click();
	await pagina.locator('#ui-componentes-personalizados').waitFor({ state: 'visible' });
}

async function crearComponente(nombre, metodo) {
	await abrirBiblioteca();
	await pagina.locator('[data-cp="nuevo"]').click();
	await pagina.locator('[data-cp-campo="nombre"]').fill(nombre);
	await pagina.locator('[data-cp-campo="descripcion"]').fill(nombre);
	await pagina.locator('[data-cp-campo="referencia"]').fill(metodo ? 'QA-PLACA' : 'QA-LEGACY');
	await pagina.locator('[data-cp="siguiente"]').click();
	await pagina.locator('[data-cp-campo="tipo"]').selectOption('otro');
	await pagina.locator('[data-cp="siguiente"]').click();
	await pagina.locator('[data-cp="imagen"]').setInputFiles({ name: 'equipo-qa.png', mimeType: 'image/png', buffer: PNG });
	await pagina.locator('[data-cp="preview"] img').waitFor({ state: 'visible' });
	await pagina.locator('[data-cp="siguiente"]').click();
	await pagina.locator('[data-cp-campo="ancho"]').fill('40');
	await pagina.locator('[data-cp-campo="alto"]').fill('50');
	await pagina.locator('[data-cp-campo="fondo"]').fill('30');
	if (metodo) {
		await pagina.locator('[data-cp-campo="montaje-metodo"]').selectOption('atornillado-placa');
		for (const [indice, x, y] of [[0, 5, 5], [1, 35, 45]]) {
			await pagina.getByRole('button', { name: 'Añadir anclaje' }).click();
			const fila = pagina.locator(`[data-cp-anclaje="${indice}"]`);
			await fila.locator('[data-cp-anclaje-campo="x"]').fill(String(x));
			await fila.locator('[data-cp-anclaje-campo="y"]').fill(String(y));
			await fila.locator('[data-cp-anclaje-campo="diametro"]').fill('3');
		}
	}
	await pagina.locator('[data-cp-ir="revision"]').click();
	const resumen = await pagina.locator('[data-cp="resumen"]').innerText();
	comprobar(`${nombre}: revisión muestra montaje honesto`, metodo
		? /Placa atornillada; 2 anclajes declarados/.test(resumen)
		: /No declarado: ajuste NO EVALUABLE/.test(resumen), resumen.match(/Montaje[^\n]*/)?.[0]);
	await pagina.locator('[data-cp="validar"]').click();
	await pagina.locator('[data-cp="errores"].cp-ok').waitFor({ state: 'visible' });
	await pagina.locator('[data-cp="guardar"]').click();
	await tarjeta(nombre).waitFor({ state: 'visible' });
	const definicion = (await qa('componentesPersonalizados')).find((d) => d.nombre === nombre);
	comprobar(`${nombre}: definición guardada`, !!definicion);
	comprobar(`${nombre}: declaración persistente`, metodo
		? definicion.montaje?.metodo === 'atornillado-placa'
			&& definicion.montaje.anclajes?.length === 2
			&& definicion.montaje.anclajes[1].xMm === 35
		: definicion.montaje === undefined);
	return definicion;
}

async function comenzarColocacion(definicion) {
	await tarjeta(definicion.nombre).getByRole('button', { name: 'Colocar', exact: true }).click();
	await pagina.locator('#ui-componentes-personalizados').waitFor({ state: 'hidden' });
	await pagina.waitForFunction((id) => window.qa.proyecto().dispositivos.some(
		(d) => d.componentePersonalizado?.definicionId === id), definicion.id);
	const d = await dispositivoDe(definicion.id);
	comprobar(`${definicion.nombre}: instancia creada por Colocar`, !!d);
	return d;
}

async function moverAMm(x, y) {
	const punto = await qa('puntoEnPantalla', x, y, 0);
	await pagina.mouse.move(punto.x, punto.y);
	return punto;
}

/** Busca sobre la malla visible un punto que el picking real atribuya a la pieza. */
async function puntoArrastrable(dispositivoId) {
	return pagina.evaluate((id) => {
		const col = window.qa.proyecto().gabinete.colocaciones.find((c) => c.dispositivoId === id);
		const lienzo = document.querySelector('#escena canvas')?.getBoundingClientRect();
		if (!col || !lienzo) return { punto: null, diagnostico: { col, lienzo } };
		const muestras = [];
		for (const z of [30, 20, 10, 45, 60, 0]) {
			for (const u of [0.5, 0.3, 0.7]) for (const v of [0.5, 0.3, 0.7]) {
				const punto = window.qa.puntoEnPantalla(col.x + col.ancho * u, col.y + col.alto * v, z);
				if (punto.x < lienzo.left + 3 || punto.x > lienzo.right - 3
					|| punto.y < lienzo.top + 3 || punto.y > lienzo.bottom - 3) {
					if (muestras.length < 8) muestras.push({ z, u, v, punto, hit: 'fuera-del-canvas' });
					continue;
				}
				const hit = window.qa.queSeleccionaEnPixel(punto.x, punto.y);
				if (hit === `dispositivo:${id}`) return { punto, diagnostico: { z, u, v } };
				if (muestras.length < 8) muestras.push({ z, u, v, punto, hit });
			}
		}
		const centro = window.qa.puntoEnPantalla(col.x + col.ancho / 2, col.y + col.alto / 2, 30);
		return { punto: null, diagnostico: {
			col, lienzo, muestras,
			crudo: window.qa.queHayEnPixel(centro.x, centro.y),
			mallas: window.qa.mallasDeAparato(id),
			senalar: window.qa.senalar(id),
			elementoDom: document.elementFromPoint(centro.x, centro.y)?.id ?? 'sin-id',
			modoEditor: document.getElementById('modo-editor')?.classList.contains('activo'),
			espacioInterior: document.getElementById('esp-interior')?.classList.contains('activo'),
			vista2D: document.body.classList.contains('vista-2d'),
		} };
	}, dispositivoId);
}

/** El cambio pasa únicamente por down/move/up humanos; el modelo solo se lee. */
async function arrastrarPlaca(dispositivo, destino) {
	await seleccionarEnLista(dispositivo);
	const agarre = await puntoArrastrable(dispositivo.id);
	const origen = agarre.punto;
	if (!origen) {
		const col = await colocacionDe(dispositivo.id);
		const centro = await qa('puntoEnPantalla', col.x + col.ancho / 2, col.y + col.alto / 2, 30);
		// Clic humano: distingue un fallo de la sonda de un fallo real de selección visible.
		await pagina.mouse.click(centro.x + 100, centro.y + 100);
		await pagina.mouse.click(centro.x, centro.y);
		const seleccionHumana2D = await qa('seleccion');
		await pagina.locator('#btn-2d').click();
		await pagina.locator('#btn-centrar').click();
		const perspectiva = await puntoArrastrable(dispositivo.id);
		const centro3D = await qa('puntoEnPantalla', col.x + col.ancho / 2, col.y + col.alto / 2, 30);
		await pagina.mouse.click(centro3D.x + 100, centro3D.y + 100);
		await pagina.mouse.click(centro3D.x, centro3D.y);
		const seleccionHumana3D = await qa('seleccion');
		console.error('Diagnóstico picking imagen M1:', JSON.stringify({
			frontal: agarre.diagnostico, seleccionHumana2D,
			perspectiva: perspectiva.diagnostico, puntoDisponible3D: !!perspectiva.punto,
			seleccionHumana3D,
		}));
	}
	comprobar(`${dispositivo.descripcion}: existe punto de agarre real`, !!origen,
		origen ? '' : JSON.stringify(agarre.diagnostico));
	const final = await qa('puntoEnPantalla', destino.x, destino.y, 0);
	await pagina.mouse.move(origen.x, origen.y);
	await pagina.mouse.down();
	let previa;
	try {
		await pagina.mouse.move(final.x, final.y, { steps: 6 });
		previa = await colocacionDe(dispositivo.id);
	} finally { await pagina.mouse.up(); }
	return { previa, posterior: await colocacionDe(dispositivo.id) };
}

async function seleccionarEnLista(dispositivo) {
	await pagina.locator('#hta-seleccionar').click();
	if (!(await pagina.locator('#seccion-dispositivos').evaluate((e) => e.open))) {
		await pagina.locator('#seccion-dispositivos summary').click();
	}
	await pagina.locator('#lista-dispositivos li').filter({ hasText: dispositivo.descripcion }).first().click();
	await pagina.locator('#panel-der .revision-personal').waitFor({ state: 'visible' });
}

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1366, height: 900 } });
	pagina = await contexto.newPage();
	pagina.setDefaultTimeout(25_000);
	pagina.on('pageerror', (e) => erroresJs.push(`PAGEERROR: ${e.message}`));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon\.ico/i.test(m.location().url ?? '')) erroresJs.push(m.text());
	});
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarEditorListo(pagina);
	await pagina.waitForFunction(() => !document.getElementById('btn-componentes-personalizados')?.disabled);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	if (await pagina.locator('#bienvenida').isVisible()) await pagina.locator('#btn-empezar-blanco').click();
	await pagina.locator('#btn-2d').click();
	const definicionPlaca = await crearComponente(NOMBRE_PLACA, true);
	const placa = await comenzarColocacion(definicionPlaca);
	comprobar('placa: la instancia conserva método y anclajes', placa.montajeComponente?.metodo === 'atornillado-placa'
		&& placa.montajeComponente.anclajes?.length === 2);
	const ducto = (await proyecto()).gabinete.canaletas.find((c) => c.id === 'ch1');
	comprobar('fixture: canaleta ch1 existente', !!ducto && ducto.orientacion === 'h');
	const puntoDucto = await moverAMm(300, ducto.y + ducto.ancho / 2);
	await pagina.waitForFunction((id) => {
		const g = window.qa.proyecto().gabinete;
		const c = g.colocaciones.find((x) => x.dispositivoId === id);
		const ducto = g.canaletas.find((x) => x.id === 'ch1');
		return c && ducto && c.x < ducto.x + ducto.largo && c.x + c.ancho > ducto.x
			&& c.y < ducto.y + ducto.ancho && c.y + c.alto > ducto.y;
	}, placa.id);
	await pagina.mouse.click(puntoDucto.x, puntoDucto.y);
	await pagina.waitForFunction(() => /Ese montaje no cabe:.*canaleta/i.test(
		document.getElementById('toast')?.textContent ?? ''));
	comprobar('choque con canaleta: rechazo visible sin soltar la pieza',
		/confirmar montaje declarado/i.test(await pagina.locator('#ayuda').innerText()));
	const puntoValido = await moverAMm(300, 250);
	const colAntes = await colocacionDe(placa.id);
	comprobar('placa: posición propuesta sin riel DIN y fuera de canaleta', !colAntes.rielId
		&& colAntes.y > ducto.y + ducto.ancho);
	await pagina.mouse.click(puntoValido.x, puntoValido.y);
	await seleccionarEnLista(placa);
	comprobar('inspector: geometría compatible sin certificar fijación',
		/Envolvente geométricamente compatible; fijación no certificada/i.test(
			await pagina.locator('#panel-der .revision-personal').innerText()));
	const colPlaca = await colocacionDe(placa.id);
	comprobar('placa: colocación final no conserva rielId', !colPlaca.rielId);
	const sobreCanaleta = await arrastrarPlaca(placa, { x: 300, y: ducto.y + ducto.ancho / 2 });
	comprobar('drag: el intento apuntó físicamente a ch1',
		sobreCanaleta.previa.x < ducto.x + ducto.largo
		&& sobreCanaleta.previa.x + sobreCanaleta.previa.ancho > ducto.x
		&& sobreCanaleta.previa.y < ducto.y + ducto.ancho
		&& sobreCanaleta.previa.y + sobreCanaleta.previa.alto > ducto.y);
	comprobar('drag: canaleta rechazada y posición anterior recuperada',
		sobreCanaleta.posterior.x === colPlaca.x && sobreCanaleta.posterior.y === colPlaca.y
		&& !sobreCanaleta.posterior.rielId
		&& /canaleta/i.test(await pagina.locator('#toast').innerText()));
	const riel = (await proyecto()).gabinete.rieles.find((r) => r.id === 'riel1');
	comprobar('fixture: riel1 existente', !!riel && riel.orientacion !== 'v');
	const sobreRiel = await arrastrarPlaca(placa, { x: 300, y: riel.y });
	comprobar('drag: el intento apuntó físicamente al riel',
		sobreRiel.previa.x < riel.x + riel.largo && sobreRiel.previa.x + sobreRiel.previa.ancho > riel.x
		&& sobreRiel.previa.y < riel.y + 17.5 && sobreRiel.previa.y + sobreRiel.previa.alto > riel.y - 17.5);
	comprobar('drag: riel rechazado sin convertir placa en DIN',
		sobreRiel.posterior.x === colPlaca.x && sobreRiel.posterior.y === colPlaca.y
		&& !sobreRiel.posterior.rielId
		&& /riel/i.test(await pagina.locator('#toast').innerText()));
	const haciaLibre = await arrastrarPlaca(placa, { x: 420, y: 250 });
	comprobar('drag: hueco libre cambia posición sin adquirir riel',
		haciaLibre.posterior.x !== colPlaca.x && !haciaLibre.posterior.rielId
		&& haciaLibre.posterior.y > ducto.y + ducto.ancho);
	comprobar('drag: la malla visible siguió a la colocación final',
		!!(await puntoArrastrable(placa.id)).punto);
	comprobar('drag: inspector conserva compatibilidad geométrica',
		/Envolvente geométricamente compatible; fijación no certificada/i.test(
			await pagina.locator('#panel-der .revision-personal').innerText()));
	await qa('esperarPersistencia');
	await pagina.reload({ waitUntil: 'load' });
	await esperarEditorListo(pagina);
	await qa('esperarPersistencia');
	const placaReabierta = await dispositivoDe(definicionPlaca.id);
	const colReabierta = await colocacionDe(placa.id);
	comprobar('recarga: instancia, anclajes y posición sobreviven',
		placaReabierta?.montajeComponente?.metodo === 'atornillado-placa'
		&& placaReabierta.montajeComponente.anclajes?.length === 2
		&& colReabierta?.x === haciaLibre.posterior.x && colReabierta?.y === haciaLibre.posterior.y
		&& !colReabierta?.rielId);
	comprobar('recarga: la pieza sigue siendo seleccionable donde está guardada',
		!!(await puntoArrastrable(placa.id)).punto);
	await seleccionarEnLista(placaReabierta);
	comprobar('recarga: inspector sigue explicando el alcance geométrico',
		/Envolvente geométricamente compatible; fijación no certificada/i.test(
			await pagina.locator('#panel-der .revision-personal').innerText()));

	const definicionLegacy = await crearComponente(NOMBRE_LEGACY, false);
	const legacy = await comenzarColocacion(definicionLegacy);
	const colLegacy = await colocacionDe(legacy.id);
	comprobar('legacy: no se inventó un método de montaje', legacy.montajeComponente === undefined);
	const puntoLegacy = await moverAMm(colLegacy.x + colLegacy.ancho / 2, colLegacy.y + colLegacy.alto / 2);
	await pagina.mouse.click(puntoLegacy.x, puntoLegacy.y);
	await seleccionarEnLista(legacy);
	comprobar('legacy: inspector informa NO_EVALUABLE, sin aprobación ficticia',
		/Compatibilidad mecánica no evaluable/i.test(await pagina.locator('#panel-der .revision-personal').innerText()));
	await qa('esperarPersistencia');
	comprobar('sin errores JavaScript', erroresJs.length === 0, erroresJs.slice(0, 3).join(' | '));
} catch (error) {
	if (!/Falló:/.test(String(error))) fallos++;
	console.error(error?.stack ?? error);
	if (erroresJs.length) console.error('Errores JavaScript:', erroresJs.slice(0, 3));
} finally {
	try { await contexto?.close(); } catch (e) { fallos++; console.error(e); }
	try { await navegador?.close(); } catch (e) { fallos++; console.error(e); }
	servidor.closeAllConnections?.();
	try { await new Promise((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve())); }
	catch (e) { fallos++; console.error(e); }
	process.chdir(cwdAnterior);
	rmSync(temporal, { recursive: true, force: true });
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}
console.log(`Montaje componente M1: ${comprobaciones} comprobaciones, ${fallos} fallos, ${erroresJs.length} errores JS`);
process.exitCode = fallos ? 1 : 0;
