/**
 * Estrés de las funciones profesionales: se lanzan cientos de operaciones AL AZAR mezclando
 * multi-selección, alineado, copiar/pegar, esquema, visualización, modos y deshacer, y tras
 * cada una se comprueba que el tablero sigue siendo coherente.
 *
 * Es la prueba que destapa los bugs de interacción, que son los que aparecen cuando alguien
 * usa el programa de verdad ocho horas seguidas.
 *
 *   node qa/estres-profesional.mjs [semilla]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

// Generador reproducible: si algo falla, se repite con la misma semilla.
let semilla = Number(process.argv[2] ?? 20260726);
const rnd = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
const elegir = (a) => a[Math.floor(rnd() * a.length)];


const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });
page.on('dialog', (d) => d.dismiss().catch(() => {}));

const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (f, ...a) => page.evaluate(([n, g]) => window.qa[n](...g), [f, a]);

await page.goto(url); await page.waitForTimeout(900);
if (await page.isVisible('#modal-ayuda')) { await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
if (await page.isVisible('#modal-ejemplos')) {
	await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
	await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(200);
}
await jsClick('modo-editor'); await page.waitForTimeout(300);

/** El tablero tiene que cumplir SIEMPRE esto, pase lo que pase. */
async function invariantes(paso) {
	const p = await qa('proyecto');
	const g = p.gabinete;
	const problemas = [];

	// 1. Ningún cable puede apuntar a un aparato que ya no existe.
	const ids = new Set(p.dispositivos.map((d) => d.id));
	for (const c of p.conductores) {
		if (!ids.has(c.de.dispositivoId) || !ids.has(c.a.dispositivoId)) problemas.push(`cable ${c.id} huérfano`);
	}
	// 2. Ninguna colocación puede sobrar ni faltar.
	for (const col of g.colocaciones) {
		if (!ids.has(col.dispositivoId)) problemas.push(`colocación huérfana ${col.dispositivoId}`);
	}
	// 3. Nada fuera de la placa.
	for (const col of g.colocaciones) {
		if (col.x < -0.5 || col.y < -0.5 || col.x + col.ancho > g.ancho + 0.5 || col.y + col.alto > g.alto + 0.5) {
			problemas.push(`${col.dispositivoId} fuera de la placa (${col.x},${col.y})`);
		}
		if (!Number.isFinite(col.x) || !Number.isFinite(col.y)) problemas.push(`${col.dispositivoId} con posición NaN`);
	}
	// 4. Ninguna designación repetida.
	const des = p.dispositivos.filter((d) => d.designacion).map((d) => d.designacion);
	if (new Set(des).size !== des.length) problemas.push('designaciones repetidas');
	// 5. Todos los cables del modelo se dibujan (sin fantasmas).
	const dibujados = await qa('cablesDibujados');
	if (dibujados !== p.conductores.length) problemas.push(`fantasmas: ${dibujados}/${p.conductores.length}`);
	// 6. El esquema, si se monta, no puede perder aparatos ni salirse del papel.
	const esq = await page.evaluate(() => {
		if (!window.qa.esquema) return null;
		return window.qa.esquema();
	});
	if (esq) {
		const enEsquema = new Set(esq.flatMap((h) => h.aparatos));
		const deberian = p.dispositivos.filter((d) => !d.imagen).map((d) => d.id);
		for (const id of deberian) if (!enEsquema.has(id)) problemas.push(`${id} no sale en el esquema`);
		for (const h of esq) if (h.fuera > 0) problemas.push(`${h.fuera} símbolos fuera del papel`);
	}
	if (problemas.length) {
		console.log(`\n✗ tras «${paso}» (semilla ${process.argv[2] ?? 20260726}):`);
		for (const x of problemas.slice(0, 8)) console.log('   · ' + x);
		return false;
	}
	return true;
}

const acciones = {
	async seleccionar() {
		const p = await qa('proyecto');
		const c = elegir(p.gabinete.colocaciones);
		if (!c) return;
		await page.evaluate((id) => { document.activeElement?.blur?.(); window.qa.seleccionarPorId(id); }, c.dispositivoId);
	},
	async multiSeleccion() {
		const p = await qa('proyecto');
		const cols = p.gabinete.colocaciones;
		if (cols.length < 2) return;
		const cuantos = 2 + Math.floor(rnd() * Math.min(4, cols.length - 1));
		const ids = [];
		for (let i = 0; i < cuantos; i++) ids.push(elegir(cols).dispositivoId);
		await page.evaluate((lista) => {
			document.activeElement?.blur?.();
			window.qa.seleccionarPorId(lista[0]);
			for (const id of lista.slice(1)) window.qa.anadirASeleccion(id);
		}, [...new Set(ids)]);
	},
	async alinear() {
		if (!(await page.isVisible('[data-alinear]'))) return;
		const como = elegir(['izquierda', 'derecha', 'arriba', 'abajo', 'centrar-h', 'centrar-v', 'repartir-h']);
		await page.click(`[data-alinear="${como}"]`).catch(() => {});
	},
	async copiarPegar() {
		await page.keyboard.press('Control+c'); await page.waitForTimeout(120);
		await page.keyboard.press('Control+v');
	},
	async duplicar() { await page.keyboard.press('Control+d'); },
	async borrar() {
		const p = await qa('proyecto');
		if (p.dispositivos.length <= 3) return; // dejar siempre algo con lo que trabajar
		await page.keyboard.press('Delete'); await page.waitForTimeout(200);
		if (await page.isVisible('#modal-dialogo')) await jsClick('dialogo-ok');
	},
	async deshacer() { await page.keyboard.press('Control+z'); },
	async rehacer() { await page.keyboard.press('Control+y'); },
	async esquema() {
		await jsClick('btn-esquema'); await page.waitForTimeout(400);
		if (await page.isVisible('#panel-esquema')) {
			await jsClick(elegir(['esq-siguiente', 'esq-anterior', 'esq-acercar', 'esq-alejar', 'esq-ajustar']));
			await page.waitForTimeout(200);
			if (rnd() < 0.6) await jsClick('esq-cerrar');
		}
	},
	async visualizacion() {
		await jsClick('btn-ver'); await page.waitForTimeout(350);
		if (rnd() < 0.7) { await jsClick('btn-ver'); await page.waitForTimeout(300); }
	},
	async modo() { await jsClick(elegir(['modo-editor', 'modo-trabajo'])); },
	async buscar() {
		// El catálogo solo se ve en modo Editor; si está escondido, no hay nada que buscar.
		if (!(await page.isVisible('#buscar-catalogo'))) return;
		await page.fill('#buscar-catalogo', elegir(['rele', 'contactor', 'zzz', '']));
		await page.evaluate(() => document.activeElement?.blur?.());
	},
	async anadirDelCatalogo() {
		if (!(await page.isVisible('#catalogo .item-catalogo'))) return;
		const n = await page.evaluate(() => document.querySelectorAll('#catalogo .item-catalogo').length);
		if (!n) return;
		await page.evaluate((i) => document.querySelectorAll('#catalogo .item-catalogo')[i].click(), Math.floor(rnd() * n));
	},
};

const nombres = Object.keys(acciones);
const cuenta = {};
let ok = true;
const N = Number(process.env.OPS ?? 220);
for (let i = 0; i < N && ok; i++) {
	const nombre = elegir(nombres);
	cuenta[nombre] = (cuenta[nombre] ?? 0) + 1;
	try {
		await acciones[nombre]();
	} catch (e) {
		console.log(`\n✗ la acción «${nombre}» lanzó: ${e.message}`);
		ok = false;
		break;
	}
	await page.waitForTimeout(140);
	// Cerrar cualquier capa antes de comprobar, para leer el estado real.
	if (await page.isVisible('#modal-dialogo')) await jsClick('dialogo-cancelar');
	ok = await invariantes(nombre);
}

// Estado final: se cierra todo y se comprueba que el programa sigue usable.
if (await page.isVisible('#panel-esquema')) await jsClick('esq-cerrar');
await page.waitForTimeout(300);
const fin = await qa('proyecto');
console.log(`\nOperaciones: ${N} → ${Object.entries(cuenta).map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`Estado final: ${fin.dispositivos.length} aparatos · ${fin.conductores.length} cables · ${await qa('cablesDibujados')} dibujados`);
if (errs.length) { console.log(`\n✗ ${errs.length} errores de JavaScript:`); for (const e of errs.slice(0, 5)) console.log('   · ' + e); }

const bien = ok && errs.length === 0;
console.log(bien ? '\n=== SIN PROBLEMAS ✔ ===' : '\n=== CON PROBLEMAS ✗ ===');
await browser.close(); server.close();
process.exit(bien ? 0 : 1);
