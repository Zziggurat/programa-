/**
 * QA de los ENTREGABLES en PDF: comprueba que los archivos que salen del programa son PDF
 * válidos, con las páginas que tocan y vectoriales (no una captura de pantalla incrustada).
 * Un PDF corrupto no se descubre hasta que el cliente intenta abrirlo, así que se mira aquí.
 *
 *   node qa/entregables.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOT = join('/workspace/programa-', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((q, r) => {
	let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { r.statusCode = 404; return r.end(''); }
	r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const click = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
await page.goto(`http://127.0.0.1:${server.address().port}/?qa=1`); await page.waitForTimeout(900);
if (await page.isVisible('#modal-ayuda')) { await click('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
await click('btn-empezar-ejemplo'); await page.waitForTimeout(350);
if (await page.isVisible('#modal-ejemplos')) {
	await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(700);
	await click('btn-cerrar-explicacion'); await page.waitForTimeout(200);
}
await click('btn-esquema'); await page.waitForTimeout(700);

let fallos = 0;
const must = (n, c, e='') => { if (!c) fallos++; console.log(`${c?'OK  ':'FAIL'}  ${n}${e?' → '+e:''}`); };

async function bajar(id, nombre) {
	const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 25000 }), click(id)]);
	const ruta = await dl.path();
	const bytes = readFileSync(ruta);
	const txt = bytes.toString('latin1');
	must(`${nombre}: es un PDF válido`, txt.startsWith('%PDF-'), txt.slice(0, 8));
	must(`${nombre}: lleva marcador de fin`, txt.includes('%%EOF'));
	must(`${nombre}: tiene tamaño razonable`, bytes.length > 1500, `${bytes.length} bytes`);
	const paginas = (txt.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
	must(`${nombre}: tiene al menos una página`, paginas >= 1, `${paginas} páginas`);
	return { txt, bytes, paginas };
}

console.log('--- PDF del esquema ---');
const esq = await bajar('esq-pdf', 'esquema');
const hojas = Number((await page.textContent('#esq-indicador')).split('/')[1].trim());
must('el PDF trae una página por hoja del esquema', esq.paginas === hojas, `${esq.paginas} vs ${hojas} hojas`);
must('el PDF del esquema es vectorial (no una imagen incrustada)', !/\/Subtype\s*\/Image/.test(esq.txt));

console.log('\n--- PDF de rótulos ---');
await click('esq-cerrar'); await page.waitForTimeout(400);
await bajar('btn-etiquetas', 'rótulos');

console.log('\n--- PDF del dossier ---');
await bajar('btn-pdf', 'dossier');

must('sin errores de JavaScript', errs.length === 0, errs.slice(0,2).join(' | '));
console.log(fallos === 0 ? '\n=== PDFs CORRECTOS ✔ ===' : `\n=== ${fallos} FALLOS ✗ ===`);
await b.close(); server.close(); process.exit(fallos === 0 ? 0 : 1);
