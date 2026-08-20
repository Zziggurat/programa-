/** LAS BANDAS DE LA VISTA EN CONTRAPICADO: ¿qué son? Se mira de cerca y se pregunta a la escena. */
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

const caja = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		A: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		H: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
		P: g.caja?.profundidad ?? 160,
	};
});
const { A, H, P } = caja;
console.log('caja', caja);

await lamina(p, [
	['contrapicado lejano', { x: 0, y: -H * 1.6, z: P + H * 0.9, tx: 0, ty: 0, tz: P / 2 }],
	['contrapicado medio', { x: 0, y: -H * 0.9, z: P + H * 0.55, tx: 0, ty: 0, tz: P / 2 }],
	['contrapicado rasante', { x: 0, y: -H * 0.62, z: P + H * 0.20, tx: 0, ty: 0, tz: P / 2 }],
	['contrapicado cerca de la puerta', { x: 0, y: -H * 0.42, z: P + 150, tx: 0, ty: -H * 0.1, tz: P }],
], { columnas: 2, celda: 620, archivo: 'v-contrapicado.png' });

// ¿Qué hay dibujado en la escena a esa altura? Se pregunta por las mallas visibles.
const dentro = await p.evaluate(() => {
	const cuenta = {};
	window.qa.escena?.().traverse?.(() => {});
	return cuenta;
}).catch(() => null);
console.log('v-contrapicado.png');
await b.close(); sv.close();
