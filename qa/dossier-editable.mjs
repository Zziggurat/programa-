/**
 * QA de la VISTA PREVIA EDITABLE del dossier.
 *
 * Lo que se comprueba es lo que se pidió: que el PDF se VEA antes de descargarlo, que lo que se ve
 * sea el PDF de verdad y no una maqueta parecida, que se puedan quitar apartados, y que se pueda
 * añadir texto con formato (negrita, cursiva, tamaño, fuente) e imágenes —de archivo, del 3D y del
 * alzado 2D—. Al final se descarga y se LEE el PDF para comprobar que lo escrito está dentro.
 *
 *   node qa/dossier-editable.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { abrirNavegador, ejecutablePython, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const proyecto = () => page.evaluate(() => window.qa.proyecto());
/** Espera a que el visor termine de generar (el estado pasa de «Generando…» a los KB). */
const esperarPdf = async () => {
	await page.waitForFunction(() => /KB/.test(document.getElementById('dos-estado').textContent), { timeout: 30000 });
};

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(150);
await click('btn-empezar-ejemplo'); await page.waitForTimeout(300);
await page.locator('.tarjeta-ejemplo button').nth(0).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await click('btn-cerrar-explicacion'); await trabajarSobreCopia(page);

console.log('--- 1. El PDF se ve ANTES de descargarlo ---');
must('la vista previa está cerrada al empezar', !(await page.isVisible('#panel-dossier')));
await click('btn-pdf');
await esperarPdf();
must('el botón del PDF abre la vista previa', await page.isVisible('#panel-dossier'));
must('lo que se ve es un PDF de verdad, no una maqueta', await page.evaluate(() => {
	const f = document.querySelector('#dos-vista iframe');
	return !!f && f.src.startsWith('blob:');
}));
const kb0 = await page.textContent('#dos-estado');
must('dice lo que ocupa', /\d+ KB/.test(kb0), kb0);
must('y trae el botón de descargar al lado', await page.isVisible('#dos-descargar'));

console.log('\n--- 2. Se eligen los apartados ---');
const nSecciones = await page.locator('#dos-secciones [data-sec]').count();
must('salen todos los apartados en la lista', nSecciones >= 10, `${nSecciones}`);
must('todos empiezan marcados',
	(await page.locator('#dos-secciones [data-sec]:checked').count()) === nSecciones);
must('la verificación y la procedencia no se pueden desmarcar',
	(await page.locator('#dos-secciones [data-sec]:disabled').count()) === 2);

const kbAntes = Number((await page.textContent('#dos-estado')).match(/\d+/)[0]);
await page.uncheck('#dos-secciones [data-sec="bom"]');
await page.waitForTimeout(1200); await esperarPdf();
must('quitar la lista de materiales lo guarda en el proyecto',
	(await proyecto()).dossier?.secciones?.bom === false);
const kbSin = Number((await page.textContent('#dos-estado')).match(/\d+/)[0]);
must('y el PDF se rehace más pequeño', kbSin < kbAntes, `${kbAntes} KB → ${kbSin} KB`);
await page.check('#dos-secciones [data-sec="bom"]');
await page.waitForTimeout(1200); await esperarPdf();

console.log('\n--- 3. Texto con formato, como en un procesador ---');
await click('dos-add-texto'); await page.waitForTimeout(600); await esperarPdf();
must('se añade un bloque de texto', (await proyecto()).dossier?.bloques?.length === 1);
must('con su recuadro editable', await page.isVisible('.dos-texto'));
must('y su barra de formato (B, I, tamaño y fuente)', await page.evaluate(() => {
	const b = document.querySelector('.dos-formato');
	return !!b && !!b.querySelector('[data-fmt="bold"]') && !!b.querySelector('[data-fmt="italic"]')
		&& !!b.querySelector('[data-tam]') && !!b.querySelector('[data-fuente]');
}));

// Se escribe un texto propio, se selecciona una palabra y se le da negrita y tamaño.
await page.evaluate(() => {
	const caja = document.querySelector('.dos-texto');
	caja.textContent = 'Tablero fabricado y probado en taller.';
	caja.focus();
});
await page.evaluate(() => {
	const caja = document.querySelector('.dos-texto');
	const r = document.createRange();
	// «probado» son los caracteres 20..27 de «Tablero fabricado y probado en taller.».
	r.setStart(caja.firstChild, 20); r.setEnd(caja.firstChild, 27);
	const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.locator('[data-fmt="bold"]').click();
await page.waitForTimeout(900);
const trozos = (await proyecto()).dossier.bloques[0].trozos;
must('el texto escrito se guarda', trozos.map((t) => t.texto).join('').includes('Tablero fabricado'),
	JSON.stringify(trozos).slice(0, 120));
must('y la palabra seleccionada queda en NEGRITA',
	trozos.some((t) => t.negrita && t.texto.includes('probado')), JSON.stringify(trozos));

// Ahora cursiva y tamaño sobre otra palabra.
await page.evaluate(() => {
	const caja = document.querySelector('.dos-texto');
	const r = document.createRange();
	r.selectNodeContents(caja.firstChild);
	const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.locator('[data-fmt="italic"]').click();
await page.waitForTimeout(700);
must('la cursiva también se guarda',
	(await proyecto()).dossier.bloques[0].trozos.some((t) => t.cursiva));

await page.selectOption('[data-tam]', '18');
await page.waitForTimeout(900);
must('el tamaño de letra se guarda',
	(await proyecto()).dossier.bloques[0].trozos.some((t) => t.tam === 18),
	JSON.stringify((await proyecto()).dossier.bloques[0].trozos).slice(0, 160));

await page.selectOption('[data-fuente]', 'times');
await page.waitForTimeout(900);
must('y la fuente también',
	(await proyecto()).dossier.bloques[0].trozos.some((t) => t.fuente === 'times'));

console.log('\n--- 4. Imágenes: del tablero en 3D y en 2D ---');
await click('dos-add-3d'); await page.waitForTimeout(900); await esperarPdf();
const con3d = (await proyecto()).dossier.bloques;
must('la foto del 3D entra en el dossier', con3d.length === 2 && con3d[1].tipo === 'imagen');
must('y es una imagen de verdad', /^data:image\/png/.test(con3d[1].imagen ?? ''),
	(con3d[1].imagen ?? '').slice(0, 30));
must('con algo dentro, no un lienzo en blanco', (con3d[1].imagen ?? '').length > 5000,
	`${Math.round((con3d[1].imagen ?? '').length / 1024)} KB`);

await click('dos-add-2d'); await page.waitForTimeout(1200); await esperarPdf();
const con2d = (await proyecto()).dossier.bloques;
must('el alzado 2D también entra', con2d.length === 3);
must('y es distinto de la foto en 3D', con2d[2].imagen !== con2d[1].imagen);
must('la vista del editor vuelve a quedar como estaba', await page.evaluate(
	() => !document.body.classList.contains('vista-2d')));

console.log('\n--- 5. Colocar cada cosa donde toque ---');
await page.selectOption('[data-donde="0"]', 'portada');
await page.waitForTimeout(1200); await esperarPdf();
must('un bloque se puede mandar a la portada',
	(await proyecto()).dossier.bloques[0].donde === 'portada');
await page.locator('[data-bajar="0"]').click();
await page.waitForTimeout(1000);
must('y se puede reordenar', (await proyecto()).dossier.bloques[1].donde === 'portada');

console.log('\n--- 6. Lo escrito llega al PDF descargado ---');
const esperado = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await click('dos-descargar');
const d = await esperado;
must('el dossier se descarga con su nombre', !!d && /\.pdf$/i.test(d.suggestedFilename()),
	d?.suggestedFilename() ?? '(no descargó)');
let texto = '';
if (d) {
	const destino = join(SAL, 'dossier-editado.pdf');
	await d.saveAs(destino);
	// El extractor separa las piezas de texto con espacios: se normalizan para poder comparar.
	texto = execFileSync(ejecutablePython(), [join(AQUI, 'leer-pdf.py'), destino]).toString()
		.replace(/\s+/g, ' ');
}
must('el texto que se escribió está DENTRO del PDF', texto.includes('Tablero fabricado'),
	texto.slice(0, 60));
must('y el apartado que se le puso de título también', texto.includes('Presentación'));
must('sigue trayendo los apartados generados', texto.includes('Ficha del tablero'));

console.log('\n--- 7. Cerrar y volver ---');
await click('dos-cerrar'); await page.waitForTimeout(300);
must('se cierra la vista previa', !(await page.isVisible('#panel-dossier')));
must('y el editor sigue ahí', await page.isVisible('#escena'));
await click('btn-pdf'); await esperarPdf();
must('al volver a abrir, lo editado sigue puesto',
	(await page.locator('#dos-bloques .dos-bloque').count()) === 3);

console.log('\n--- 8. Sin errores ---');
must('ningún error de JavaScript en todo el recorrido', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: join(SAL, 'dossier-editable.png') });
await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
