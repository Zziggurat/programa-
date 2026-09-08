/** Diagnóstico manual, fuera del gate: coste de clics visibles según tamaño de ventana. */
import { chromium } from 'playwright-core';
import { performance } from 'node:perf_hooks';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
let browser, servidor;
const timer = setTimeout(() => { process.exitCode = 1; void browser?.close(); servidor?.closeAllConnections?.(); }, 180_000);
try {
    const s = await servidorDeQA(); servidor = s.servidor;
    browser = await abrirNavegador(chromium);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${s.url}/?qa=1&inicio=0`); await esperarEditorListo(page);
    for (const id of ['btn-cerrar-ayuda', 'btn-cerrar-explicacion', 'btn-empezar-blanco']) {
        const b = page.locator(`#${id}`); if (await b.isVisible()) await b.click();
    }
    await page.locator('#btn-datos-tecnicos').click();
    await page.locator('[data-dt="ejemplo"]').click();
    await page.locator('[data-dt-estado]').filter({ hasText: 'Ejemplo de solo lectura' }).waitFor();
    for (const viewport of [{width:1440,height:1000}, {width:960,height:720}, {width:800,height:600}]) {
        await page.setViewportSize(viewport);
        const modo = 'raton';
        const tiempos = [];
        for (const accion of ['instalacion', 'biblioteca', 'criterios', 'biblioteca']) {
            const b = page.locator(`#modal-datos-tecnicos nav [data-dt="${accion}"]`);
            const t = performance.now();
            await b.click();
            tiempos.push(Math.round(performance.now() - t));
        }
        console.log(JSON.stringify({ viewport, modo, ms: tiempos, totalMs: tiempos.reduce((a,b) => a+b,0) }));
    }
} finally {
    clearTimeout(timer); await browser?.close(); servidor?.closeAllConnections?.();
    if (servidor) await new Promise((ok, no) => servidor.close(e => e ? no(e) : ok()));
}
