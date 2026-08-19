/**
 * BARRIDO DE PARPADEO SOBRE TODOS LOS APARATOS DE UN TABLERO.
 *
 * La pasada anterior midió cuatro aparatos de un tablero y arregló dos causas. Diego sigue viendo
 * moteado «alrededor de pequeñas marcas oscuras sobre componentes claros», así que aquí se miran
 * TODOS los aparatos y la serigrafía entra como variable: la sonda de caras coplanares la excluía
 * a propósito —lleva su propio polygonOffset— y eso pudo dejar fuera justamente el caso que queda.
 *
 * Con la cámara quieta el contador tiene que dar CERO. Si no, la medida no vale.
 *
 *   node qa/_flicker-todos.mjs [ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const EJEMPLO = Number(process.argv[2] ?? 4);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
p.setDefaultTimeout(60_000);
const er = []; p.on('pageerror', (e) => er.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);

const nombre = await p.evaluate(() => window.qa.proyecto().nombre);
const disp = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));
console.log(`${nombre}: ${disp.length} aparatos\n`);
console.log('aparato              quieta  normal  sin marcas   sin sombras');
const peores = [];
for (const d of disp) {
	const c = await qa('bulto', d.id);
	if (!c) continue;
	const radio = Math.max(80, c.radio * 3.0);
	const cam = (i, paso) => {
		const g = 0.34 + i * paso, a = 0.20 + i * paso * 0.4;
		return { x: c.x + Math.sin(g) * radio, y: c.y + Math.sin(a) * radio, z: c.z + Math.cos(g) * Math.cos(a) * radio, tx: c.x, ty: c.y, tz: c.z };
	};
	const quietas = Array.from({ length: 4 }, () => cam(0, 0));
	const moviendo = Array.from({ length: 6 }, (_, i) => cam(i, 0.0004));
	await qa('sesgoSombra', 0.22); await qa('marcas3d', true);
	const quieta = (await qa('medirMoteado', quietas)).porMillon;
	const normal = (await qa('medirMoteado', moviendo)).porMillon;
	await qa('marcas3d', false);
	const sinMarcas = (await qa('medirMoteado', moviendo)).porMillon;
	await qa('marcas3d', true); await qa('sesgoSombra', 3.0);
	const sinSombras = (await qa('medirMoteado', moviendo)).porMillon;
	await qa('sesgoSombra', 0.22);
	console.log(`${(d.id + ' (' + d.tipo + ')').padEnd(20)} ${String(quieta).padStart(6)}  ${String(normal).padStart(6)}  ${String(sinMarcas).padStart(10)}  ${String(sinSombras).padStart(11)}`);
	if (normal > 200) peores.push({ id: d.id, tipo: d.tipo, normal, sinMarcas, sinSombras });
}
console.log('\nlos que más parpadean:');
for (const q of peores.sort((a, b) => b.normal - a.normal)) {
	const culpa = q.sinMarcas < q.normal * 0.4 ? 'LA SERIGRAFÍA' : q.sinSombras < q.normal * 0.4 ? 'LAS SOMBRAS' : 'la geometría';
	console.log(`  ${q.id} (${q.tipo}): ${q.normal} · sin marcas ${q.sinMarcas} · sin sombras ${q.sinSombras} → ${culpa}`);
}
if (!peores.length) console.log('  ninguno pasa de 200 por millón');
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
