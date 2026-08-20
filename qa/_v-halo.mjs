/**
 * ¿CUÁNTO SE VE EL HALO, Y DESDE DÓNDE? Se mide el resplandor en píxeles a varias distancias y
 * en rasante, apagado y encendido, y se guardan las láminas para juzgarlo a ojo además de por
 * número. Un halo que no se ve no es sutil: es un dibujo que no está.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(90_000);
await abrirEjemplo(p, sv.address().port, 2);
await puerta(p, 0);

const q = (await p.evaluate(() => window.qa.componentesDePuerta()))[1];
const { x, y, z } = q.mundo;

/**
 * Perfil radial de luminancia alrededor del piloto, en milímetros de mundo.
 * A `d` milímetros de cámara y con 42° de campo, un milímetro son `alto/2 / (d·tan21°)` píxeles.
 */
async function perfil(d) {
	await p.evaluate((c) => window.qa.verDesde(c), { x, y, z: z + d, tx: x, ty: y, tz: z });
	await p.waitForTimeout(200);
	return p.evaluate((dist) => {
		const l = document.querySelector('canvas');
		const c = document.createElement('canvas');
		c.width = l.width; c.height = l.height;
		const g = c.getContext('2d');
		g.drawImage(l, 0, 0);
		const pxPorMm = (l.height / 2) / (dist * Math.tan((21 * Math.PI) / 180));
		const cx = Math.round(l.width / 2), cy = Math.round(l.height / 2);
		const luz = (mm) => {
			const r = mm * pxPorMm;
			let s = 0, n = 0;
			for (let a = 0; a < 16; a++) {
				const px = Math.round(cx + r * Math.cos((a * Math.PI) / 8));
				const py = Math.round(cy + r * Math.sin((a * Math.PI) / 8));
				if (px < 0 || py < 0 || px >= l.width || py >= l.height) continue;
				const v = g.getImageData(px, py, 1, 1).data;
				s += 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
				n++;
			}
			return n ? Math.round(s / n) : -1;
		};
		return { pxPorMm: Math.round(pxPorMm * 100) / 100, r: [8, 12, 16, 20, 26, 34].map(luz) };
	}, d);
}

const distancias = [90, 250, 600, 1500];
const antes = {};
for (const d of distancias) antes[d] = await perfil(d);
await lamina(p, distancias.map((d) => [`apagado ${d}mm`, { x, y, z: z + d, tx: x, ty: y, tz: z }]),
	{ columnas: 2, celda: 560, archivo: 'v-halo-apagado.png' });

await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2500);
const despues = {};
for (const d of distancias) despues[d] = await perfil(d);
await lamina(p, distancias.map((d) => [`encendido ${d}mm`, { x, y, z: z + d, tx: x, ty: y, tz: z }]),
	{ columnas: 2, celda: 560, archivo: 'v-halo-encendido.png' });

console.log('radios muestreados (mm):   8    12    16    20    26    34');
console.log('  aro exterior en 14,6 mm · halo declarado hasta ' + (14.6 * 1.28).toFixed(1) + ' mm');
for (const d of distancias) {
	const a = antes[d].r, b2 = despues[d].r;
	console.log(`${String(d).padStart(5)}mm  ${a.map((v, i) => String(b2[i] - v).padStart(5)).join(' ')}   (delta de luminancia)`);
}

// Y de canto: un disco plano visto a 6° tiene que desaparecer, no verse como una raya.
const rasante = [];
for (const ang of [3, 8, 18, 40]) {
	const r = (ang * Math.PI) / 180;
	rasante.push([`rasante ${ang}°`, {
		x: x - 220 * Math.cos(r), y, z: z + 220 * Math.sin(r), tx: x, ty: y, tz: z,
	}]);
}
await lamina(p, rasante, { columnas: 2, celda: 560, archivo: 'v-halo-rasante.png' });
console.log('láminas: v-halo-apagado.png · v-halo-encendido.png · v-halo-rasante.png');
await b.close(); sv.close();
