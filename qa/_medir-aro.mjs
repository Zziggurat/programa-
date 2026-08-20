/** ¿POR QUÉ EL ARO SE OSCURECE AL ENCENDER? Se miden los píxeles, no se supone. */
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

const q = (await p.evaluate(() => window.qa.componentesDePuerta()))[1];
const { x, y, z } = q.mundo;
await p.evaluate((c) => window.qa.verDesde(c), { x, y, z: z + 90, tx: x, ty: y, tz: z });
await p.waitForTimeout(200);

/** Media de color en una cruz de puntos, en coordenadas de lienzo. */
const muestra = async (etiqueta) => {
	const r = await p.evaluate(() => {
		const l = document.querySelector('canvas');
		const c = document.createElement('canvas');
		c.width = l.width; c.height = l.height;
		c.getContext('2d').drawImage(l, 0, 0);
		const g = c.getContext('2d');
		const cx = Math.round(l.width / 2), cy = Math.round(l.height / 2);
		const leer = (dx, dy) => {
			const d = g.getImageData(cx + dx, cy + dy, 1, 1).data;
			return [d[0], d[1], d[2]];
		};
		return {
			centro: leer(0, 0),
			// El aro cae a poco más de un radio de lente del centro; a esta distancia
			// (90 mm de cámara) son del orden de 150 px en pantalla.
			aroDer: leer(150, 0), aroIzq: leer(-150, 0),
			aroArr: leer(0, -150), aroAba: leer(0, 150),
			fuera: leer(330, 0),
		};
	});
	console.log(etiqueta, JSON.stringify(r));
	return r;
};

const antes = await muestra('APAGADO ');
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2500);
const despues = await muestra('ENCENDIDO');

const luz = (c) => Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
for (const k of Object.keys(antes)) {
	console.log(`${k}: ${luz(antes[k])} → ${luz(despues[k])}  (${luz(despues[k]) - luz(antes[k])})`);
}
console.log('halo:', JSON.stringify((await p.evaluate(() => window.qa.componentesDePuerta()))[1]));
await b.close(); sv.close();
