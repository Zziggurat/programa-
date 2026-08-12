/**
 * QA del dossier en PDF: comprueba que el documento describe EL TABLERO QUE HAY EN PANTALLA.
 *
 * No basta con que el PDF se genere: tiene que llevar el nombre del proyecto, el recuento
 * real de aparatos, sus medidas y el marcado de cada uno. Por eso aquí se abre un tablero,
 * se modifica, y se comprueba que el PDF cambia con él.
 *
 *   node qa/dossier.mjs
 */
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const jsClick = (id) => page.evaluate((i) => {
	const b = document.getElementById(i);
	if (!b) throw new Error(`No existe el botón #${i}`); // un id mal escrito falsearía la prueba
	b.click();
}, id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

/** Vacía la placa como haría el usuario con «Nuevo» (el diálogo pide confirmación). */
async function empezarDeCero() {
	await jsClick('btn-nuevo');
	await page.waitForTimeout(250);
	if (await page.isVisible('#modal-dialogo')) {
		await page.click('#dialogo-ok');
		await page.waitForTimeout(500);
	}
	await page.waitForTimeout(300);
}

mkdirSync(join(AQUI, '_salida'), { recursive: true });
/** Exporta el dossier y devuelve su contenido como texto crudo del PDF. */
async function exportar(nombre) {
	// El botón 📄 abre la vista previa; el dossier se descarga desde ella.
	await page.evaluate(() => {
		const e = document.getElementById('dos-estado');
		if (e) e.textContent = '';
		document.getElementById('btn-pdf').click();
	});
	await page.waitForFunction(
		() => /KB/.test(document.getElementById('dos-estado')?.textContent ?? ''), { timeout: 40000 });
	const espera = page.waitForEvent('download');
	await jsClick('dos-descargar');
	const d = await espera;
	// Se cierra: la vista previa ocupa la pantalla entera y taparía el editor de detrás.
	await jsClick('dos-cerrar');
	await page.waitForTimeout(150);
	const destino = join(AQUI, '_salida', `${nombre}.pdf`);
	await d.saveAs(destino);
	const bytes = readFileSync(destino);
	return { texto: bytes.toString('latin1'), bytes: bytes.length, archivo: d.suggestedFilename() };
}
const paginas = (t) => (t.match(/\/Type \/Page[^s]/g) ?? []).length;

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(120);

console.log('\n--- 1. El dossier de un tablero real ---');
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(400);
await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(800);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await jsClick('btn-cerrar-explicacion'); await trabajarSobreCopia(page);

const p = await qa('proyecto');
const uno = await exportar('ejemplo');
must('el PDF se genera y pesa lo suyo', uno.bytes > 30000, `${uno.bytes} bytes`);
// Se compara con el nombre REAL del proyecto abierto y no con una palabra fija: así la prueba
// sigue valiendo cuando cambia la biblioteca de ejemplos.
must('el archivo lleva el nombre del proyecto',
	uno.archivo.startsWith(p.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30)),
	`${uno.archivo} · proyecto «${p.nombre}»`);
must('tiene todas las secciones del dossier', paginas(uno.texto) >= 8, `${paginas(uno.texto)} páginas`);
for (const seccion of ['Ficha del tablero', 'Disposici', 'Lista de materiales', 'ndice de aparatos',
	'Lista de conductores', 'Verificaci']) {
	must(`incluye la sección «${seccion}»`, uno.texto.includes(seccion));
}

console.log('\n--- 2. Las cifras son las del tablero, no un relleno ---');
const aparatos = p.dispositivos.filter((d) => !d.imagen && d.tipo !== 'cable');
must('el recuento de aparatos es el real',
	uno.texto.includes(`(${aparatos.length})`) || uno.texto.includes(`${aparatos.length}`),
	`${aparatos.length} aparatos`);
must('aparecen las medidas de la placa',
	uno.texto.includes(String(p.gabinete.ancho)) && uno.texto.includes(String(p.gabinete.alto)),
	`${p.gabinete.ancho}×${p.gabinete.alto}`);
const marcados = aparatos.map((d) => d.designacion).filter(Boolean);
const ausentes = marcados.filter((m) => !uno.texto.includes(m.replace('-', '')) && !uno.texto.includes(m));
must('está el marcado de todos los aparatos', ausentes.length === 0, ausentes.join(', '));
must('lleva la leyenda del plano de la placa',
	uno.texto.includes('Canaleta') && uno.texto.includes('Riel DIN') && uno.texto.includes('Aparato'));
must('lleva el recuento por familias', uno.texto.includes('Componentes por familia'));
must('lleva la posición y la huella de cada aparato', uno.texto.includes('Huella'));

console.log('\n--- 3. El dossier SIGUE al tablero: si cambia, cambia ---');
await jsClick('modo-editor'); await page.waitForTimeout(250);
await page.fill('#buscar-catalogo', 'PUB6438S'); await page.waitForTimeout(250);
await page.locator('#catalogo .item-catalogo').first().click(); await page.waitForTimeout(500);
const dos = await exportar('con-controlador');
const p2 = await qa('proyecto');
const nuevo = p2.dispositivos.find((d) => d.referencia === 'PUB6438S');
must('el aparato añadido sale en el PDF', dos.texto.includes('PUB6438S'));
must('sale con su marcado nuevo', !!nuevo?.designacion && dos.texto.includes(nuevo.designacion.replace('-', '')));
must('el PDF cambió respecto del anterior', dos.texto !== uno.texto);
must('sale su huella real de la hoja de datos',
	dos.texto.includes('138') && dos.texto.includes('174'), '138×174 mm');

console.log('\n--- 4. Un proyecto recién empezado no revienta el PDF ---');
await empezarDeCero();
const vacio = await exportar('vacio');
must('el dossier de un tablero vacío se genera igual', vacio.bytes > 5000, `${vacio.bytes} bytes`);
must('y lo dice en vez de inventar datos',
	vacio.texto.includes('no tiene aparatos') || vacio.texto.includes('no tiene conductores'));

console.log('\n--- 5. Coherencia ---');
must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(fallos ? `\n=== ${fallos} FALLO(S) ===` : '\n=== TODO OK ✔ ===');
await browser.close();
server.close();
process.exit(fallos ? 1 : 0);
