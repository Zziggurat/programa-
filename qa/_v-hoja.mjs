/** ¿QUÉ pieza de la hoja cambia de sitio al guardar y recargar? Se diffea, no se supone. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
p.on('pageerror', (e) => console.log('JS ERROR', e.message));
console.log(await abrirEjemplo(p, sv.address().port, 2));
await puerta(p, 0);
const antes = await p.evaluate(() => window.qa.piezasDeLaHoja());
const caja1 = await p.evaluate(() => window.qa.dondeMazo().hoja);
const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
await p.evaluate((j) => window.qa.cargarJson(j), json);
await p.waitForTimeout(1800);
await puerta(p, 0);
const despues = await p.evaluate(() => window.qa.piezasDeLaHoja());
const caja2 = await p.evaluate(() => window.qa.dondeMazo().hoja);
console.log(`   caja de la hoja: ${JSON.stringify(caja1)}`);
console.log(`                    ${JSON.stringify(caja2)}`);
console.log(`   ${antes.length} piezas antes · ${despues.length} después`);
const sa = new Set(antes), sd = new Set(despues);
const soloAntes = antes.filter((k) => !sd.has(k));
const soloDespues = despues.filter((k) => !sa.has(k));
console.log(`   ${soloAntes.length} solo antes, ${soloDespues.length} solo después`);
for (const k of soloAntes.slice(0, 15)) console.log(`   - ${k}`);
for (const k of soloDespues.slice(0, 15)) console.log(`   + ${k}`);
await b.close(); sv.close(); process.exit(0);
