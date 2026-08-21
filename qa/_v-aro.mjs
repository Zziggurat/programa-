/** ¿QUÉ es ese anillo claro alrededor del aro? Se pregunta al rayo y se leen los píxeles. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(90_000);
await abrirEjemplo(p, sv.address().port, 2);
await puerta(p, 0);
await p.evaluate(() => window.qa.congelarCamara(true));
const q = (await p.evaluate(() => window.qa.componentesDePuerta()))[1];
const { x, y, z } = q.mundo;
const D = 240;
await p.evaluate((c) => window.qa.verDesde(c), { x, y, z: z + D, tx: x, ty: y, tz: z });
await p.waitForTimeout(300);
// A 240 mm, un píxel de pantalla son 0,2047 mm de puerta.
const mmPorPx = (2 * D * Math.tan((21 * Math.PI) / 180)) / 900;
console.log(`   ${mmPorPx.toFixed(4)} mm por píxel`);
for (const mm of [0, 4, 8, 10.5, 12, 13.5, 14.8, 15.5, 16.5, 17.6, 19, 22, 28]) {
	const dx = Math.round(mm / mmPorPx);
	const caja = await p.evaluate(() => {
		const l = document.querySelector('canvas');
		const r = l.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	const px = caja.x + dx, py = caja.y;
	// EL CENTRO DEL LIENZO NO ES EL CENTRO DE LA VENTANA: el visor empieza 46 px por debajo de
	// la barra, así que el punto al que mira la cámara cae en (ancho/2, alto/2) DEL LIENZO. Con
	// 450 fijos se estaba midiendo una cuerda 23 px por debajo del piloto y llamándola radio.
	const color = await p.evaluate(([dx]) => {
		const l = document.querySelector('canvas');
		const c = document.createElement('canvas');
		c.width = l.width; c.height = l.height;
		const g = c.getContext('2d');
		g.drawImage(l, 0, 0);
		const d = g.getImageData(Math.round(l.width / 2 + dx * (l.width / l.clientWidth)), Math.round(l.height / 2), 1, 1).data;
		return [d[0], d[1], d[2]];
	}, [dx]);
	const rayo = await p.evaluate(([X, Y]) => window.qa.queHayEnPixel(X, Y), [px, py]);
	console.log(`   r=${String(mm).padStart(5)} mm (+${dx}px) color ${String(color).padEnd(14)} rayo: ${JSON.stringify(rayo).slice(0, 150)}`);
}
console.log('\n   piezas:', JSON.stringify(await p.evaluate(() => window.qa.mallasDeAparato('hs')), null, 1));
await b.close(); sv.close(); process.exit(0);
