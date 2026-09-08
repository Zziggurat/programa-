/** Autoría ordinaria V8: formularios, revisiones inmutables, evidencia local y teclado.
 * Complementa ingeniería/importación; no prepara el modelo con hooks privados.
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
import { presupuestoV8, crearRelojProgreso } from './lib/presupuestos-v8.mjs';
const progreso = crearRelojProgreso();
const inicio = Date.now(), carpeta = mkdtempSync(join(tmpdir(), 'qa-v8-catalogo-'));
let browser, servidor, page, fallos = 0, checks = 0, timeouts = 0;
const errores = [], cwd = process.cwd(), logAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = join(carpeta, 'chromium.log'); process.chdir(carpeta);
const ok = (nombre, pasa) => { checks++; if (!pasa) fallos++; console.log(`${pasa ? 'OK  ' : 'FAIL'} ${nombre} ${progreso(checks)}`); };
const modal = () => page.locator('#modal-datos-tecnicos');
const b = a => modal().locator(`${a === 'biblioteca' ? 'nav > ' : ''}[data-dt="${a}"]`);
const input = a => modal().locator(`[data-dt-input="${a}"]`);
const mensaje = t => modal().locator('[data-dt-estado]').filter({ hasText: t }).waitFor();
async function confirmar() { await page.locator('#dialogo-ok').click(); await page.locator('#modal-dialogo').waitFor({ state: 'hidden' }); }
async function publicar() { await b('publicar').click(); await confirmar(); await mensaje('Revisión publicada'); }
async function exportar() {
    const descarga = page.waitForEvent('download'); await b('exportar').click();
    const archivo = await descarga; if (await archivo.failure()) throw new Error('Falló descarga');
    return JSON.parse(readFileSync(await archivo.path(), 'utf8'));
}
const limite = presupuestoV8('datos-tecnicos-catalogo');
const reloj = setTimeout(() => { timeouts++; fallos++; console.error(`TIMEOUT catálogo V8 (${limite} ms totales; ${checks} checks alcanzados)`); void browser?.close(); servidor?.closeAllConnections?.(); }, limite);
reloj.unref();
try {
    const servicio = await servidorDeQA(); servidor = servicio.servidor;
    browser = await abrirNavegador(chromium);
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
    page.setDefaultTimeout(30_000);
    page.on('pageerror', e => errores.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
    await page.goto(`${servicio.url}/?qa=1&inicio=0`); await esperarEditorListo(page);
    for (const selector of ['#btn-cerrar-ayuda', '#btn-cerrar-explicacion', '#btn-empezar-blanco']) if (await page.locator(selector).isVisible()) await page.locator(selector).click();
    await page.locator('#btn-datos-tecnicos').click(); await modal().waitFor({ state: 'visible' });
    ok('Un solo diálogo accesible de Datos técnicos', await page.getByRole('dialog').filter({ hasText: 'Datos técnicos' }).count() === 1);
    await b('cerrar').focus(); await page.keyboard.press('Shift+Tab');
    ok('Shift+Tab permanece dentro del diálogo', await modal().evaluate(e => e.contains(document.activeElement)));
    await page.keyboard.press('Escape'); await modal().waitFor({ state: 'hidden' });
    ok('Escape devuelve foco al disparador', await page.locator('#btn-datos-tecnicos').evaluate(e => e === document.activeElement));
    await page.locator('#btn-datos-tecnicos').click(); await b('nuevo').click();
    await input('producto-id').fill('proteccion-autor-v8'); await input('nombre').fill('Protección autor V8');
    await input('fuente').fill('Ensayo manual sintético, no fabricante'); await input('origen').selectOption('SINTETICO');
    await b('campo').click(); await input('campo').selectOption('proteccion.Icu'); await input('valor').fill('6');
    await input('sistema').selectOption('AC'); await input('tension').fill('230');
    await modal().locator('[data-dt-guardar-campo]').click();
    ok('Ficha de borrador muestra valor y aplicabilidad', /6 kA/.test(await modal().innerText()) && /230/.test(await modal().innerText()));
    await b('guardar-borrador').click(); await mensaje('Borrador guardado');
    await b('biblioteca').click(); await b('borradores').click(); await modal().locator('[data-dt-borrador]').filter({ hasText: 'Protección autor V8' }).click();
    ok('Borrador conserva nombre y campo al reabrir', await input('nombre').inputValue() === 'Protección autor V8' && await modal().locator('[data-dt-editar-campo]').count() === 1);
    await publicar(); const r1 = await exportar();
    const p1 = r1.revisiones.find(r => r.tipo === 'PRODUCTO');
    ok('Publicación usa unidad, condiciones y fuente del formulario', p1.revision === 1 && p1.campos[0].valor === 6 && p1.campos[0].unidad === 'kA' && p1.campos[0].condiciones.sistema === 'AC' && p1.campos[0].condiciones.tensionV === 230 && p1.campos[0].procedencia.origen === 'SINTETICO');
    await b('editar').click(); await modal().locator('[data-dt-editar-campo="0"]').click();
    await input('valor').fill('3'); await modal().locator('[data-dt-guardar-campo]').click(); await publicar();
    const r2 = await exportar(), p2 = r2.revisiones.find(r => r.tipo === 'PRODUCTO');
    ok('Nueva revisión cambia hash sin mutar la anterior', p2.revision === 2 && p2.hash !== p1.hash && p2.campos[0].valor === 3);
    await modal().locator(`[data-dt-select="${p1.hash}"]`).click();
    ok('Revisión anterior continúa exportable con su valor original', (await exportar()).revisiones.find(r => r.tipo === 'PRODUCTO').campos[0].valor === 6);
    await input('buscar').fill('proteccion-autor-v8'); await b('buscar').click();
    ok('Búsqueda por ID devuelve ambas revisiones', await modal().locator('[data-dt-select]').count() === 2);
    await input('familia-filtro').selectOption('MOTOR'); await b('buscar').click();
    ok('Filtro de familia excluye protección', await modal().locator('[data-dt-select]').count() === 0);
    await input('familia-filtro').selectOption('PROTECCION'); await b('buscar').click();
    await modal().locator(`[data-dt-select="${p2.hash}"]`).click(); await b('revision-humana').click();
    await input('responsable').fill('QA autoría'); await input('evidencia').fill('Comprobación del formulario sintético, no certificación');
    await b('guardar-revision-humana').click(); await mensaje('Revisión humana local registrada');
    ok('Ficha identifica evidencia humana separada', /QA autoría/.test(await modal().innerText()) && /No acredita certificación/.test(await modal().innerText()));
    ok('Exportación no convierte revisión humana local en autenticación', !JSON.stringify(await exportar()).includes('QA autoría'));
    await page.screenshot({ path: join(carpeta, 'ficha-escritorio.png') });
    await page.setViewportSize({ width: 640, height: 900 });
    ok('Modal estrecho permanece dentro de viewport', await modal().evaluate(e => e.getBoundingClientRect().right <= innerWidth + 1));
    await page.screenshot({ path: join(carpeta, 'ficha-estrecha.png') });
    await b('cerrar').click(); await page.reload(); await esperarEditorListo(page);
    await page.locator('#btn-datos-tecnicos').click(); await modal().locator(`[data-dt-select="${p2.hash}"]`).click();
    await modal().getByText(/QA autoría/).waitFor();
    ok('Revisión y evidencia humana sobreviven recarga', /3 kA/.test(await modal().innerText()));
} catch (e) { fallos++; if (e.name === 'TimeoutError') timeouts++; console.error('FAIL catálogo V8:', e.stack ?? e); }
finally {
    clearTimeout(reloj); ok('Sin errores JavaScript', errores.length === 0); if (errores.length) console.error(errores);
    try { await browser?.close(); } catch (e) { fallos++; console.error(e); }
    try { servidor?.closeAllConnections?.(); if (servidor?.listening) await new Promise((ok, no) => servidor.close(e => e ? no(e) : ok())); } catch (e) { fallos++; console.error(e); }
    process.chdir(cwd); if (logAnterior === undefined) delete process.env.CHROME_LOG_FILE; else process.env.CHROME_LOG_FILE = logAnterior;
    console.log(`Evidencia visual: ${carpeta}`);
    console.log(`QA datos-tecnicos-catalogo: ${checks} comprobaciones; ${fallos} fallos; ${timeouts} timeouts; 0 skipped; ${(Date.now() - inicio) / 1000} s.`);
    process.exitCode = fallos ? 1 : 0;
}
