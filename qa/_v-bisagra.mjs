/** LA BISAGRA, GRANDE. Y de paso el color medio del nudillo, medido en píxeles. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema, SALIDA } from './lib/mirar.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.setDefaultTimeout(90_000);
await abrirEjemplo(p, sv.address().port, 2);
await puerta(p, 0);
const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		A: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		H: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
		P: g.caja?.profundidad ?? 160,
	};
});
// La bisagra alta está en el eje: x = −ancho/2 + 7, y = alto/2 − alto·0,22, z = boca − 6.
// El eje de la bisagra: x = −ancho/2, z = boca + 1. Con la puerta abierta la hoja tapa el
// costado, así que la segunda cámara mira desde MUY delante, que es de donde se ve el nudillo
// sin que la propia puerta se ponga en medio.
const hx = -A / 2, hy = H / 2 - H * 0.22, hz = P - 11 - 3 + 1;
const cam = { x: hx - 78, y: hy + 26, z: hz + 96, tx: hx, ty: hy, tz: hz };
const lejos = { x: hx - 120, y: hy + 40, z: hz + 520, tx: hx, ty: hy, tz: hz };
console.log('bisagra en', { hx, hy, hz });
const { lamina } = await import('./lib/mirar.mjs');
for (const t of [0, 0.5, 1]) {
	await puerta(p, t);
	await lamina(p, [[`cerca ${t * 100}%`, cam], [`lejos ${t * 100}%`, lejos]],
		{ columnas: 2, celda: 600, archivo: `v-bisagra-${t * 100}.png` });
	console.log(`v-bisagra-${t * 100}.png`);
}
await puerta(p, 0);
await p.evaluate((c) => window.qa.verDesde(c), cam);
await p.waitForTimeout(250);
const datos = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
writeFileSync(join(SALIDA, 'v-bisagra.png'), Buffer.from(datos.split(',')[1], 'base64'));

// Histograma tosco del centro de la imagen: ¿es gris neutro o tiene tinte?
const stats = await p.evaluate(() => {
	const l = document.querySelector('canvas');
	const c = document.createElement('canvas');
	c.width = l.width; c.height = l.height;
	c.getContext('2d').drawImage(l, 0, 0);
	const d = c.getContext('2d').getImageData(l.width / 2 - 60, l.height / 2 - 90, 120, 180).data;
	let r = 0, g = 0, bl = 0, n = 0, azules = 0;
	for (let i = 0; i < d.length; i += 4) {
		r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++;
		if (d[i + 2] > d[i] + 22) azules++;
	}
	return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n), azules: Math.round((azules / n) * 100) };
});
console.log('nudillo medio', stats, '(azules = % de píxeles con B mucho mayor que R)');
await b.close(); sv.close();
