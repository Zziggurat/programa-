/**
 * QA del modo Energizar: dar tensión al tablero y verlo funcionar.
 *
 * Nace del feedback de quien lo probó («no sé cómo dar play para energizar y ver los circuitos
 * funcionando») así que lo que se comprueba aquí es exactamente eso: que se pueda pulsar un
 * pulsador y que arranque el motor, que el enclavamiento lo sostenga al soltar, que el paro lo
 * tire, y que los cables con tensión se vean encendidos.
 *
 *   node qa/energizar.mjs
 */
import { chromium } from 'playwright-core';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const filas = () => page.evaluate(() => [...document.querySelectorAll('#sim-funcionando .fila-sim')]
	.map((f) => f.textContent.trim()));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(200);

// El arranque directo de motor: el ejemplo con enclavamiento, que es el caso interesante.
await click('btn-empezar-ejemplo'); await page.waitForTimeout(400);
await page.locator('.tarjeta-ejemplo button').nth(0).click(); await page.waitForTimeout(1000);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await click('btn-cerrar-explicacion'); await page.waitForTimeout(300);

console.log('--- 1. Se puede energizar ---');
must('el botón de energizar está en la barra', await page.isVisible('#btn-energizar'));
must('el panel de simulación está oculto antes de energizar', !(await page.isVisible('#seccion-simulacion')));

await click('btn-energizar'); await page.waitForTimeout(600);
must('al energizar aparece el panel', await page.isVisible('#seccion-simulacion'));
must('el botón queda marcado como activo',
	await page.evaluate(() => document.getElementById('btn-energizar').classList.contains('activo')));
must('el tablero energizado NO arranca solo',
	!(await filas()).some((f) => /girando/i.test(f)), (await filas()).join(' | '));

console.log('\n--- 2. Hay cables con tensión ---');
const vivosParado = await page.evaluate(() => window.qa.simulacion().conductoresVivos);
must('con el tablero energizado hay cables vivos', vivosParado > 0, `${vivosParado} cables`);

console.log('\n--- 3. Se pulsa MARCHA y arranca el motor ---');
const marcha = await page.evaluate(() => window.qa.proyecto().dispositivos
	.find((d) => /MARCHA/i.test(d.descripcion ?? ''))?.id);
must('el ejemplo tiene un pulsador de marcha', !!marcha, marcha);
await qa('accionar', marcha); await page.waitForTimeout(500);
const enMarcha = await filas();
must('el motor aparece girando', enMarcha.some((f) => /girando/i.test(f)), enMarcha.join(' | '));
must('el contactor aparece con la bobina metida',
	enMarcha.some((f) => /bobina/i.test(f)), enMarcha.join(' | '));
const vivosMarcha = await page.evaluate(() => window.qa.simulacion().conductoresVivos);
must('en marcha hay más cables vivos que parado', vivosMarcha > vivosParado, `${vivosParado} → ${vivosMarcha}`);
must('los cables vivos se ven encendidos en el 3D',
	(await page.evaluate(() => window.qa.cablesEncendidos())) > 0);

console.log('\n--- 4. ENCLAVAMIENTO: al soltar sigue girando ---');
await qa('accionar', marcha); await page.waitForTimeout(500);
must('el pulsador queda suelto', !(await page.evaluate(() => window.qa.estadoSim())[0]?.activo));
must('el motor SIGUE girando al soltar la marcha',
	(await filas()).some((f) => /girando/i.test(f)), (await filas()).join(' | '));

console.log('\n--- 5. El PARO lo tira y no vuelve solo ---');
const paro = await page.evaluate(() => window.qa.proyecto().dispositivos
	.find((d) => /PARO/i.test(d.descripcion ?? ''))?.id);
await qa('accionar', paro); await page.waitForTimeout(500);
must('con el paro pulsado el motor se para', !(await filas()).some((f) => /girando/i.test(f)));
await qa('accionar', paro); await page.waitForTimeout(500);
must('y al soltar el paro NO vuelve solo', !(await filas()).some((f) => /girando/i.test(f)),
	(await filas()).join(' | '));

console.log('\n--- 6. Abrir una protección deja el tablero muerto ---');
await qa('accionar', marcha); await page.waitForTimeout(400);
must('vuelve a arrancar tras rearmar', (await filas()).some((f) => /girando/i.test(f)));
const q1 = await page.evaluate(() => window.qa.proyecto().dispositivos
	.find((d) => d.tipo === 'guardamotor')?.id);
await qa('accionar', q1); await page.waitForTimeout(500);
must('con el guardamotor abierto el motor se para', !(await filas()).some((f) => /girando/i.test(f)));

console.log('\n--- 7. Volver al reposo y desenergizar ---');
await click('btn-sim-reposo'); await page.waitForTimeout(500);
must('«volver al reposo» deja todo suelto y sin nada girando',
	!(await filas()).some((f) => /girando/i.test(f)));
await click('btn-energizar'); await page.waitForTimeout(500);
must('al desenergizar se oculta el panel', !(await page.isVisible('#seccion-simulacion')));
must('y se apagan los cables', (await page.evaluate(() => window.qa.cablesEncendidos())) === 0);

console.log('\n--- 8. Sin errores ---');
must('la aplicación no lanzó ningún error', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
