/** ¿QUIÉN SE VE A TRAVÉS DEL COSTADO? Se pregunta a la escena, píxel a píxel. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.setDefaultTimeout(90_000);
await abrirEjemplo(p, sv.address().port, 1);
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.waitForTimeout(300);
await p.evaluate(() => {
	const poner = (id, v) => {
		const e = document.getElementById(id);
		e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true }));
	};
	poner('caja-ancho', 30); poner('caja-alto', 40); poner('caja-prof', 15);
	document.getElementById('aplicar-dim').click();
});
await p.waitForTimeout(1200);
await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
await p.waitForTimeout(600);
await puerta(p, 0);

const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		A: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		H: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
		P: g.caja?.profundidad ?? 160,
	};
});
await p.evaluate((c) => window.qa.verDesde(c),
	{ x: -A / 2 - 190, y: -H * 0.05, z: P * 0.35, tx: -A / 2, ty: -H * 0.05, tz: P * 0.35 });
await p.waitForTimeout(250);

for (const [nx, ny] of [[0.35, 0.45], [0.38, 0.25], [0.30, 0.62], [0.62, 0.45]]) {
	const r = await p.evaluate(([x, y]) => window.qa.queHayEnPixel(x, y), [nx * 1200, ny * 900]);
	console.log(`píxel ${(nx * 100).toFixed(0)}%,${(ny * 100).toFixed(0)}% ->`, JSON.stringify(r));
}

// Y el dato duro: la geometría del armario y la de las canaletas, en coordenadas.
const medidas = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	const caja = {
		ancho: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		alto: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
	};
	return {
		placa: { ancho: g.ancho, alto: g.alto },
		caja,
		caraInteriorIzquierda: -caja.ancho / 2 + 2,
		canaletas: g.canaletas.map((c) => ({
			id: c.id, x: c.x, y: c.y, largo: c.largo, o: c.orientacion,
			de: c.orientacion === 'h' ? c.x - c.largo / 2 : c.x,
			a: c.orientacion === 'h' ? c.x + c.largo / 2 : c.x,
		})),
		rieles: g.rieles.map((r) => ({ id: r.id, de: r.x - r.largo / 2, a: r.x + r.largo / 2 })),
	};
});
console.log(JSON.stringify(medidas, null, 1));
await b.close(); sv.close();
