/** Recorrido V8 compacto sobre file://, sin window.qa ni escrituras privadas. */
import { readFileSync } from 'node:fs';
import { copiarEjemploConfirmado } from './confirmacion-visible.mjs';
export async function comprobarDatosTecnicosOffline(page, must, buildId) {
    const m = page.locator('#modal-datos-tecnicos');
    const b = a => m.locator(`[data-dt="${a}"]`);
    await page.locator('#btn-datos-tecnicos').click(); await b('sintetico').click();
    await m.locator('[data-dt-estado]').filter({ hasText: 'Catálogo SINTÉTICO añadido' }).waitFor();
    must('V8 offline carga biblioteca local y su CSS modular', await m.locator('[data-dt-select]').count() >= 5
        && await m.evaluate(e => getComputedStyle(e).position === 'fixed'));
    await b('ejemplo').click(); await m.locator('[data-dt-estado]').filter({ hasText: 'Ejemplo de solo lectura' }).waitFor();
    await b('cerrar').click();
    await copiarEjemploConfirmado(page, async () => {
        await page.locator('#btn-copiar-ejemplo').click();
        await page.locator('#chip-ejemplo').waitFor({ state: 'hidden' });
    });
    await page.locator('#btn-datos-tecnicos').click(); await b('instalacion').click();
    await m.locator('[data-dt-input="conductor"]').selectOption('w-fase-carga');
    const amp = JSON.parse(await m.locator('.dt-cuerpo > pre').innerText());
    must('V8 offline ampacidad conserva ambos factores y fuente', amp.estado === 'RESOLVED'
        && Math.abs(amp.izA - 22.56) < 1e-9 && amp.factoresAplicados.length === 2 && amp.procedencia.origen === 'SINTETICO');
    await b('criterios').click();
    must('V8 offline criterio versionado disponible', await m.locator('[data-dt-input="criterio"]').inputValue() !== '');
    await b('biblioteca').click();
    await m.locator('[data-dt-select]').filter({ hasText: 'Protección de prueba 25 A' }).filter({ hasText: /r2 · PRODUCTO/ }).click();
    await b('vincular').click(); await m.locator('[data-dt-input="entidad"]').selectOption('q1');
    await b('preview-vinculo').click(); await b('aplicar-preview').waitFor();
    must('V8 offline revisión r2 se compara sin aplicar', /BASE todavía intacta/.test(await m.innerText()) && /0[,.]1 kA/.test(await m.innerText()));
    await b('cancelar-preview').click(); await b('biblioteca').click();
    const portableEvent = page.waitForEvent('download'); await b('exportar-proyecto').click();
    const portable = await portableEvent;
    const paquete = JSON.parse(readFileSync(await portable.path(), 'utf8'));
    const proyecto = paquete.formato === 'tablero-studio-paquete' ? paquete.proyecto : paquete;
    must('V8 offline portable mantiene vínculo BASE r1 y frozen', proyecto.datosTecnicos.vinculos.find(v => v.entidadId === 'q1').producto.revision === 1
        && proyecto.datosTecnicos.revisiones.length >= 3);
    await b('cerrar').click(); await page.locator('#hta-ingenieria').click(); await page.locator('#ingenieria-validar').click();
    await page.locator('[data-ing-view="validacion"]').click();
    must('V8 offline validación expone coordinación fallida del laboratorio', /FAIL/.test(await page.locator('[data-ing-issue-card]').filter({ hasText: 'TS-CABLE-IB-IN-IZ' }).first().innerText()));
    await page.locator('[data-ing-view="documentacion"]').click(); await page.locator('[data-ing-doc="prepare"]').click();
    await page.locator('[data-ing-doc="html"]:not([disabled])').waitFor();
    const informeEvent = page.waitForEvent('download'); await page.locator('[data-ing-doc="html"]').click();
    const informe = await informeEvent, html = readFileSync(await informe.path(), 'utf8');
    must('V8 offline documento contiene Build, hash, fuente y ampacidad', html.includes(buildId)
        && html.includes('SINTETICO') && html.includes('22.56') && html.includes('sha256:') && html.includes('proteccion.Icu@'));
    must('V8 offline informe carece de scripts y recursos remotos', !/<script\b/i.test(html)
        && !/<(?:img|link)\b[^>]*(?:src|href)=["']https?:/i.test(html));
}
