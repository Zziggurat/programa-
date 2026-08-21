/** Sonda corta: por qué un clic sobre w54 no lo selecciona. Se mira, no se supone. */
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
await puerta(p, 1);
await p.evaluate(() => window.qa.congelarCamara(true));

const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return { A: g.caja?.ancho ?? g.ancho + 60, H: g.caja?.alto ?? g.alto + 60, P: g.caja?.profundidad ?? 160 };
});
console.log('estado:', JSON.stringify(await p.evaluate(() => window.qa.estadoInteraccion())));

for (const id of ['w54', 'w55', 'w51']) {
	const d = await p.evaluate((i) => window.qa.dondeMazo().tramosHoja.find((c) => c.id === i)
		?? window.qa.dondeMazo().porCable.find((c) => c.id === i), id);
	const c = d.hoja;
	const cx = (c.min.x + c.max.x) / 2, cy = (c.min.y + c.max.y) / 2, cz = (c.min.z + c.max.z) / 2;
	const a = (118 * Math.PI) / 180;
	await p.evaluate((v) => window.qa.verDesde(v), {
		x: cx + Math.sin(a) * 330, y: cy + 80, z: cz + Math.cos(a) * 330, tx: cx, ty: cy, tz: cz,
	});
	await p.waitForTimeout(300);
	const pts = await p.evaluate((i) => window.qa.puntosVisiblesDeCable(i, 25), id);
	console.log(`\n=== ${id}: ${pts.length} puntos visibles ===`);
	for (const pt of pts.slice(0, 4)) {
		const encima = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName ?? 'nada', [pt.x, pt.y]);
		const eligiria = await p.evaluate(([x, y]) => window.qa.queSeleccionaEnPixel(x, y), [pt.x, pt.y]);
		const rayo = await p.evaluate(([x, y]) => window.qa.queHayEnPixel(x, y), [pt.x, pt.y]);
		await p.mouse.click(pt.x, pt.y);
		await p.waitForTimeout(150);
		const sel = await p.evaluate(() => window.qa.seleccion());
		const est = await p.evaluate(() => window.qa.estadoInteraccion());
		console.log(`  (${pt.x.toFixed(0)},${pt.y.toFixed(0)}) sobre=${encima} elegiria=${eligiria} sel=${JSON.stringify(sel)} cableando=${est.cableando} bornes=${est.bornesVisibles}`);
		if (pts.indexOf(pt) === 0) console.log(`     rayo: ${JSON.stringify(rayo).slice(0, 320)}`);
		await p.keyboard.press('Escape');
		await p.waitForTimeout(80);
	}
}
await b.close();
sv.close();
process.exit(0);
