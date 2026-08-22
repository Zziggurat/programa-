/** MIRAR EL MAZO como se mira un tablero: desde dentro, con la puerta a medio abrir. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, puerta, navegadorDelSistema } from './lib/mirar.mjs';
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
console.log(await abrirEjemplo(p, sv.address().port, 2));
await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
await p.waitForTimeout(800);
await p.evaluate(() => window.qa.congelarCamara(true));
const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return { A: g.caja?.ancho ?? g.ancho + 60, H: g.caja?.alto ?? g.alto + 60, P: g.caja?.profundidad ?? 160 };
});
const d = await p.evaluate(() => window.qa.dondeMazo());
const c0 = d.porCable[0];
console.log('   tramo de hoja:', JSON.stringify(c0.hoja), '\n   guía:', c0.guia.join(' | '));
console.log('   lazo:', JSON.stringify(c0.lazo));
for (const t of [0.35, 0.7, 1]) {
	await puerta(p, t);
	const cx = (c0.lazo.min.x + c0.lazo.max.x) / 2;
	// La cara interior de la hoja, calculada desde dónde han quedado los tubos: es la única
	// vista desde la que se juzga si el mazo parece instalado sobre la puerta.
	const tramos = await p.evaluate(() => window.qa.dondeMazo().tramosHoja);
	const caja = tramos.reduce((a, k) => ({
		x: [Math.min(a.x[0], k.hoja.min.x), Math.max(a.x[1], k.hoja.max.x)],
		y: [Math.min(a.y[0], k.hoja.min.y), Math.max(a.y[1], k.hoja.max.y)],
		z: [Math.min(a.z[0], k.hoja.min.z), Math.max(a.z[1], k.hoja.max.z)],
	}), { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] });
	const mx = (caja.x[0] + caja.x[1]) / 2, my = (caja.y[0] + caja.y[1]) / 2, mz = (caja.z[0] + caja.z[1]) / 2;
	const a = (-118 * t * Math.PI) / 180;
	const n = { x: -Math.sin(a), z: -Math.cos(a) };
	await lamina(p, [
		[`cara interior ${t * 100} %`, { x: mx + n.x * 620, y: my + 60, z: mz + n.z * 620, tx: mx, ty: my, tz: mz }],
		[`transferencia ${t * 100} %`, { x: cx + 300, y: (c0.lazo.min.y + c0.lazo.max.y) / 2 + 140, z: (c0.lazo.min.z + c0.lazo.max.z) / 2 + 240, tx: cx, ty: (c0.lazo.min.y + c0.lazo.max.y) / 2, tz: (c0.lazo.min.z + c0.lazo.max.z) / 2 }],
		[`de arriba ${t * 100} %`, { x: -A * 0.3, y: A * 0.8, z: P + A * 0.2, tx: -A * 0.35, ty: 0, tz: P * 0.5 }],
	], { columnas: 3, celda: 470, archivo: `v-mazo-real-${Math.round(t * 100)}.png` });
	console.log(`   v-mazo-real-${Math.round(t * 100)}.png`);
}
await b.close(); sv.close(); process.exit(0);
