/**
 * A/B DE COSTE DE DIBUJADO, EN LA MISMA SESIÓN Y ALTERNANDO.
 *
 * Una medida de rendimiento de otro día no vale para comparar: la fase 4 pasó de 12,7 ms a 19,5 ms
 * sin tocar una línea, solo por la máquina en la que se midió. Así que aquí se sirven DOS carpetas
 * —la de antes y la de ahora— y se van midiendo una detrás de otra, varias vueltas, en el mismo
 * proceso y con el mismo navegador. Lo que se compara son dos números nacidos con un minuto de
 * diferencia, no dos números de dos tardes distintas.
 *
 *   node qa/_ab-dibujado.mjs <carpetaA> <carpetaB> [vueltas]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const CARPETAS = { base: process.argv[2], nuevo: process.argv[3] };
const VUELTAS = Number(process.argv[4] ?? 4);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const servidor = (raiz) => {
	const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(raiz, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
	return new Promise((res) => sv.listen(0, () => res(sv)));
};
const svs = { base: await servidor(CARPETAS.base), nuevo: await servidor(CARPETAS.nuevo) };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

// Una toma: abrir el ejemplo, energizarlo (que es donde el emisivo cuesta) y medir el dibujado.
async function toma(cual) {
	const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
	p.setDefaultTimeout(60_000);
	await p.goto(`http://127.0.0.1:${svs[cual].address().port}/?qa=1&inicio=0`);
	await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
	await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
	if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
	await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
	for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
	await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(500);
	await p.evaluate(() => document.getElementById('btn-energizar')?.click()); await p.waitForTimeout(2500);
	await p.evaluate(() => window.qa.medirDibujado(10));   // calentar: la primera vuelta compila
	const ms = (await p.evaluate(() => window.qa.medirDibujado(30))).mediana;   // devuelve {mediana, peor}
	await p.close();
	return ms;
}

const medidas = { base: [], nuevo: [] };
for (let v = 0; v < VUELTAS; v++) {
	// Alternando y cambiando el orden en las vueltas impares, para que si la máquina se va
	// calentando no cargue siempre sobre el mismo candidato.
	const orden = v % 2 === 0 ? ['base', 'nuevo'] : ['nuevo', 'base'];
	for (const cual of orden) medidas[cual].push(await toma(cual));
	console.log(`vuelta ${v + 1}: base ${medidas.base.at(-1)} ms · nuevo ${medidas.nuevo.at(-1)} ms`);
}
const mediana = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
console.log(`\nbase   ${medidas.base.join(', ')}  -> mediana ${mediana(medidas.base)} ms`);
console.log(`nuevo  ${medidas.nuevo.join(', ')}  -> mediana ${mediana(medidas.nuevo)} ms`);
console.log(`diferencia: ${(mediana(medidas.nuevo) - mediana(medidas.base)).toFixed(2)} ms`);
await b.close(); for (const s of Object.values(svs)) s.close();
