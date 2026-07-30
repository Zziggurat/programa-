/**
 * QA de la segunda herramienta: el visor 3D de la planta.
 *
 * Comprueba lo que se le pidió: que sea una herramienta SEPARADA del editor de tableros, que la
 * planta salga del plano de verdad (los equipos y sus metros de instalación), que se puedan ver
 * los puntos de control de cada máquina, que las dos vistas funcionen, y que el visor NO deje de
 * avisar de que las alturas son de proyecto y no del plano.
 *
 *   node qa/planta.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const ROOT = join(AQUI, '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/?qa=1`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const texto = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? '', sel);

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(200);

console.log('--- 1. Es una herramienta aparte ---');
must('el botón de la planta está en la barra', await page.isVisible('#btn-planta'));
must('el visor está cerrado al arrancar', !(await page.isVisible('#mundo')));
await click('btn-planta');
await page.waitForTimeout(3500);   // construir la escena lleva su tiempo
must('el visor se abre a pantalla completa', await page.isVisible('#mundo'));
must('tapa el editor de tableros', await page.evaluate(() => {
	const m = document.getElementById('mundo').getBoundingClientRect();
	return m.width >= window.innerWidth - 2 && m.height >= window.innerHeight - 2;
}));
must('dibuja la planta en 3D', await page.evaluate(() => {
	const c = document.getElementById('mundo-lienzo');
	return !!c && c.clientWidth > 800 && c.clientHeight > 500;
}));

console.log('\n--- 2. Los datos son los del plano ---');
const res = await texto('#mundo-resumen');
must('el resumen cuenta las UMAs', /9[0-9]/.test(res), res.replace(/\s+/g, ' ').slice(0, 90));
must('el título dice de qué archivo sale', (await texto('#mundo-titulo')).includes('.dxf')
	|| (await texto('#mundo-titulo')).includes('.dwg'), await texto('#mundo-titulo'));
const ley = await texto('#mundo-leyenda');
for (const s of ['Inyección', 'Extracción', 'Bus LON']) {
	must(`la leyenda incluye «${s}»`, ley.includes(s));
}
must('la leyenda da metros de cada sistema', /\d+\s*m/.test(ley), ley.replace(/\s+/g, ' ').slice(0, 80));

console.log('\n--- 3. NO deja de avisar de lo que es supuesto ---');
const aviso = await texto('#mundo-aviso');
must('avisa de que las alturas son de proyecto', /altura|cota/i.test(aviso), aviso.slice(0, 70));
must('y de que el recorrido en planta sí es del plano', /planta/i.test(aviso));

console.log('\n--- 4. Se puede consultar una máquina ---');
const conPuntos = await page.evaluate(() => {
	const q = window.__plantaQA;
	return q ? q.equipos.filter((e) => e.x !== null && e.puntos.length > 0).length : -1;
});
must('hay máquinas situadas con puntos de control', conPuntos > 5, `${conPuntos}`);
const ficha = await page.evaluate(() => {
	const q = window.__plantaQA;
	const e = q.equipos.find((x) => x.x !== null && x.puntos.length >= 6);
	q.seleccionar(e.tag);
	return { tag: e.tag, puntos: e.puntos.length, ctrl: e.controlador };
});
await page.waitForTimeout(400);
const html = await texto('#mundo-ficha');
must(`la ficha muestra ${ficha.tag}`, html.includes(ficha.tag), html.replace(/\s+/g, ' ').slice(0, 80));
must('la ficha lista sus puntos de control', /Puntos de control/.test(html));
for (const sig of ['VAF', 'VAC', 'EF']) {
	must(`la ficha nombra el punto ${sig}`, html.includes(sig));
}
must('explica qué es cada sigla, no solo la sigla',
	/lvula de agua/i.test(html), html.replace(/\s+/g, ' ').slice(0, 120));
await page.screenshot({ path: join(SAL, 'planta-sims.png') });

console.log('\n--- 5. Las dos vistas ---');
must('arranca en vista general', await page.evaluate(
	() => document.getElementById('mundo-sims').classList.contains('activo')));
must('la ayuda de paseo está oculta en vista general', !(await page.isVisible('#mundo-ayuda-paseo')));
const camSims = await page.evaluate(() => window.__plantaQA.camara());
await click('mundo-paseo'); await page.waitForTimeout(700);
must('al pasear cambia el botón activo', await page.evaluate(
	() => document.getElementById('mundo-paseo').classList.contains('activo')));
must('aparece la ayuda de teclas', await page.isVisible('#mundo-ayuda-paseo'));
const camPaseo = await page.evaluate(() => window.__plantaQA.camara());
must('la cámara baja a la altura de los ojos', Math.abs(camPaseo.y - 1.7) < 0.2, `y=${camPaseo.y.toFixed(2)} m`);
must('y cambia de sitio respecto a la vista general',
	Math.abs(camPaseo.y - camSims.y) > 5, `${camSims.y.toFixed(1)} → ${camPaseo.y.toFixed(1)}`);

// Andar. Se mide en DOS pasos y por un motivo: este contenedor renderiza por software y da 2-3
// fps, así que medir el paseo en tiempo real mediría la gráfica del servidor y no el programa.
// Primero se comprueba que la tecla llega y mueve algo; luego, que el movimiento es el que toca,
// con un reloj simulado.
const fps = await page.evaluate(() => window.__plantaQA.fps());
console.log(`     (fps reales del contenedor: ${fps})`);
await page.mouse.move(800, 500);
await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
await page.waitForTimeout(150);
const trasTecla = await page.evaluate(() => window.__plantaQA.camara());
const conTecla = Math.hypot(trasTecla.x - camPaseo.x, trasTecla.z - camPaseo.z);
must('la tecla W llega al visor y mueve la cámara', conTecla > 0.3, `${conTecla.toFixed(2)} m`);

const paso = await page.evaluate(() => {
	// Se mantiene W pulsada y se anda un segundo de reloj simulado.
	window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
	const r = window.__plantaQA.andar(1);
	window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
	return r;
});
must('en un segundo se recorren metros de verdad', paso.avanzado > 8 && paso.avanzado < 25,
	`${paso.avanzado.toFixed(1)} m/s`);
must('y sin despegarse del suelo', Math.abs(paso.y - 1.7) < 0.05, `y=${paso.y.toFixed(2)} m`);
must('sin salirse de la losa', await page.evaluate(() => {
	const q = window.__plantaQA; const c = q.camara(); const t = q.tamano();
	return Math.abs(c.x) <= t.ancho / 2 + 10 && Math.abs(c.z) <= t.fondo / 2 + 10;
}));
await page.screenshot({ path: join(SAL, 'planta-paseo.png') });

console.log('\n--- 6. Salir y volver al editor ---');
await click('mundo-salir'); await page.waitForTimeout(500);
must('el visor se cierra', !(await page.isVisible('#mundo')));
must('el editor de tableros sigue ahí', await page.isVisible('#escena'));
must('y su catálogo también', await page.evaluate(
	() => document.querySelectorAll('#catalogo .item-catalogo').length > 20));
await click('btn-planta'); await page.waitForTimeout(1200);
must('se puede volver a abrir', await page.isVisible('#mundo'));

console.log('\n--- 7. Sin errores ---');
must('ningún error de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
