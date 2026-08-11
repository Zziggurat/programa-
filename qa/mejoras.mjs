/**
 * QA de las mejoras de productividad del editor:
 *  · buscador del catálogo (filtrar por nombre, tipo, marca…)
 *  · duplicar aparato con Ctrl+D (los tableros repiten aparatos todo el rato)
 *
 *   node qa/mejoras.mjs
 */
import { chromium } from 'playwright-core';

import { join } from 'node:path';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const info = (t) => console.log('     ' + t);
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (f, ...a) => page.evaluate(([n, g]) => window.qa[n](...g), [f, a]);
const nItems = () => page.evaluate(() => document.querySelectorAll('#catalogo .item-catalogo').length);
const nombres = () => page.evaluate(() => [...document.querySelectorAll('#catalogo .item-catalogo .nombre')].map((e) => e.textContent));

await page.goto(url); await page.waitForTimeout(900);
if (await page.isVisible('#modal-ayuda')) { await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
if (await page.isVisible('#modal-ejemplos')) {
	await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
	await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(200);
}
await jsClick('modo-editor'); await page.waitForTimeout(300);

/* ---------------------------- 1. Buscador del catálogo ---------------------------- */
console.log('\n--- 1. Buscador del catálogo ---');
const todos = await nItems();
must('el catálogo se pinta entero al abrir', todos >= 12, `${todos} aparatos`);

await page.fill('#buscar-catalogo', 'contactor'); await page.waitForTimeout(200);
const porNombre = await nombres();
must('busca por nombre', porNombre.length > 0 && porNombre.every((n) => /contactor/i.test(n)), porNombre.join(', '));

await page.fill('#buscar-catalogo', 'phoenix'); await page.waitForTimeout(200);
const porMarca = await nItems();
must('busca por fabricante (aunque no salga en el nombre)', porMarca > 0, `${porMarca} resultados`);

await page.fill('#buscar-catalogo', 'disyuntor 3p'); await page.waitForTimeout(200);
const dosPalabras = await nombres();
must('busca por varias palabras a la vez', dosPalabras.length === 1 && /3P/i.test(dosPalabras[0]), dosPalabras.join(', '));

await page.fill('#buscar-catalogo', 'zzzz'); await page.waitForTimeout(200);
must('avisa cuando no hay coincidencias', (await nItems()) === 0 && await page.isVisible('.catalogo-vacio'));

await page.press('#buscar-catalogo', 'Escape'); await page.waitForTimeout(200);
must('Esc limpia la búsqueda y devuelve el catálogo entero', (await nItems()) === todos, `${await nItems()}/${todos}`);

// Escribir en el buscador no puede disparar los atajos del tablero (Supr borraría un aparato).
const antesTexto = (await qa('proyecto')).dispositivos.length;
await page.click('#buscar-catalogo');
await page.keyboard.type('rele'); await page.keyboard.press('Delete'); await page.waitForTimeout(250);
must('escribir en el buscador no borra aparatos', (await qa('proyecto')).dispositivos.length === antesTexto);
await page.fill('#buscar-catalogo', ''); await page.waitForTimeout(150);

/* ------------------------------ 2. Duplicar (Ctrl+D) ------------------------------ */
console.log('\n--- 2. Duplicar un aparato con Ctrl+D ---');
const p0 = await qa('proyecto');
const conCol = p0.gabinete.colocaciones.find((c) => {
	const d = p0.dispositivos.find((x) => x.id === c.dispositivoId);
	return d && !d.imagen && d.tipo !== 'bornero';
});
must('hay un aparato colocado para duplicar', !!conCol);
const original = p0.dispositivos.find((d) => d.id === conCol.dispositivoId);
info(`original: ${original.designacion} (${original.tipo})`);

await page.evaluate((id) => { document.activeElement?.blur?.(); window.qa.seleccionarPorId(id); }, original.id);
await page.waitForTimeout(250);
await page.keyboard.press('Control+d'); await page.waitForTimeout(400);

const p1 = await qa('proyecto');
must('aparece un aparato nuevo', p1.dispositivos.length === p0.dispositivos.length + 1,
	`${p0.dispositivos.length} → ${p1.dispositivos.length}`);
const copia = p1.dispositivos.at(-1);
info(`copia: ${copia.designacion} (${copia.tipo})`);
must('la copia es del mismo tipo', copia.tipo === original.tipo);
must('la copia tiene los mismos bornes', copia.bornes.length === original.bornes.length,
	`${copia.bornes.length} vs ${original.bornes.length}`);
must('la copia tiene designación PROPIA (no duplicada)', copia.designacion !== original.designacion,
	`${original.designacion} → ${copia.designacion}`);
must('ninguna designación queda repetida en el tablero',
	new Set(p1.dispositivos.map((d) => d.designacion)).size === p1.dispositivos.length);
must('la copia nace SIN cables', !p1.conductores.some((c) => c.de.dispositivoId === copia.id || c.a.dispositivoId === copia.id));

const colCopia = p1.gabinete.colocaciones.find((c) => c.dispositivoId === copia.id);
must('la copia queda colocada en la placa', !!colCopia);
if (!colCopia) { console.log('\n=== ' + fallos + ' FALLOS ✗ ==='); await browser.close(); server.close(); process.exit(1); }
must('la copia cabe dentro de la placa', colCopia.x >= 0 && colCopia.x + colCopia.ancho <= p1.gabinete.ancho,
	`x=${colCopia.x} ancho=${colCopia.ancho} placa=${p1.gabinete.ancho}`);
must('la copia queda anclada a un riel', !!colCopia.rielId, colCopia.rielId);
const encimados = p1.gabinete.colocaciones.filter((o) => o.dispositivoId !== copia.id
	&& colCopia.x < o.x + o.ancho && o.x < colCopia.x + colCopia.ancho
	&& colCopia.y < o.y + o.alto && o.y < colCopia.y + colCopia.alto);
must('la copia no queda encimada con otro aparato', encimados.length === 0,
	encimados.map((e) => e.dispositivoId).join(', '));

// Duplicar varias veces seguidas (el caso real: seis relés iguales).
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+d'); await page.waitForTimeout(350); }
const p2 = await qa('proyecto');
must('se puede duplicar en cadena', p2.dispositivos.length === p1.dispositivos.length + 3,
	`${p1.dispositivos.length} → ${p2.dispositivos.length}`);
must('siguen sin repetirse designaciones', new Set(p2.dispositivos.map((d) => d.designacion)).size === p2.dispositivos.length);
const cols = p2.gabinete.colocaciones;
let choques = 0;
for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
	const a = cols[i], b = cols[j];
	if (a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto) choques++;
}
must('ningún aparato del tablero queda encimado tras duplicar 4 veces', choques === 0, `${choques} choques`);

// Ctrl+Z tiene que deshacer el duplicado.
await page.keyboard.press('Control+z'); await page.waitForTimeout(350);
must('Ctrl+Z deshace el duplicado', (await qa('proyecto')).dispositivos.length === p2.dispositivos.length - 1);

console.log('\n--- 3. Coherencia ---');
const fin = await qa('proyecto');
must('sin cables fantasma', (await qa('cablesDibujados')) === fin.conductores.length,
	`${await qa('cablesDibujados')}/${fin.conductores.length}`);
must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ✗ ===`);
await browser.close(); server.close();
process.exit(fallos === 0 ? 0 : 1);
