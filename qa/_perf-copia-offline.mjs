/** Diagnóstico manual: duración real de carga/copia file://, fuera del gate. */
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { abrirNavegador, RAIZ } from './lib/entorno.mjs';
import { observarConfirmacion } from './lib/confirmacion-visible.mjs';
const browser = await abrirNavegador(chromium);
const reloj = setTimeout(() => { console.error('Límite diagnóstico240s'); process.exitCode = 1; void browser.close(); }, 240_000);
let observador;
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(60_000);
    page.on('pageerror', e => console.error('PAGEERROR', e.message));
    const cdp = await page.context().newCDPSession(page);
    const rate = Number(process.env.QA_CPU_RATE ?? 4);
    if (!Number.isFinite(rate) || rate < 1 || rate > 8) throw new Error('Factor inválido');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(pathToFileURL(join(RAIZ, 'dist-final/TableroStudio.html')).href);
    await page.locator('#inicio-tableros').click();
    if (await page.locator('#modal-ayuda').isVisible()) await page.locator('#btn-cerrar-ayuda').click();
    await page.locator('#btn-archivo').click(); await page.locator('#btn-mis-tableros').click();
    await page.locator('#btn-nuevo-biblioteca').click();
    await page.locator('#nombre-proyecto').fill('QA Diagnóstico copia');
    await page.locator('#nombre-proyecto').press('Tab');
    await page.locator('#btn-empezar-ejemplo').click();
    const carga = performance.now();
    await page.locator('.tarjeta-ejemplo button').nth(2).click();
    if (await page.locator('#modal-dialogo').isVisible()) await page.locator('#dialogo-ok').click();
    await page.locator('#modal-explicacion').waitFor({ state: 'visible' });
    console.log('CARGA_MS', performance.now() - carga);
    await page.locator('#btn-cerrar-explicacion').click();
    observador = await observarConfirmacion(page,
        'La copia es un tablero nuevo, independiente y guardado localmente.', 120_000);
    const copia = performance.now();
    await page.locator('#btn-copiar-ejemplo').click();
    await observador.esperar();
    console.log('COPIA_MS', performance.now() - copia, 'NOMBRE', await page.locator('#nombre-proyecto').inputValue());
} catch (error) { process.exitCode = 1; console.error(error); }
finally { clearTimeout(reloj); try { await observador?.cerrar(); } finally { await browser.close(); } }
