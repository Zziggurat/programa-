/** UNA LÍNEA DE BARRIDO SOBRE EL COSTADO: qué se ve pintado y qué hay realmente delante. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const ANCHO = Number(process.argv[2] ?? 30);
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
await p.evaluate((a) => {
	const poner = (id, v) => {
		const e = document.getElementById(id);
		e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true }));
	};
	poner('caja-ancho', a); poner('caja-alto', 40); poner('caja-prof', 15);
	document.getElementById('aplicar-dim').click();
}, ANCHO);
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
console.log(`caja pedida ${ANCHO} cm -> real ${A}×${H}×${P}`);
await p.evaluate((c) => window.qa.verDesde(c),
	{ x: -A / 2 - 190, y: -H * 0.05, z: P * 0.35, tx: -A / 2, ty: -H * 0.05, tz: P * 0.35 });
await p.waitForTimeout(250);

const filas = await p.evaluate(() => {
	const l = document.querySelector('canvas');
	const c = document.createElement('canvas');
	c.width = l.width; c.height = l.height;
	c.getContext('2d').drawImage(l, 0, 0);
	const g = c.getContext('2d');
	const out = [];
	for (let ny = 0.14; ny < 0.92; ny += 0.055) {
		const py = Math.round(ny * l.height);
		const px = Math.round(0.34 * l.width);
		const d = g.getImageData(px, py, 1, 1).data;
		out.push({ py, rgb: `${d[0]},${d[1]},${d[2]}`, hay: window.qa.queHayEnPixel(px, py) });
	}
	return out;
});
for (const f of filas) console.log(String(f.py).padStart(4), f.rgb.padStart(12), f.hay.slice(0, 3).join(' '));
await b.close(); sv.close();
