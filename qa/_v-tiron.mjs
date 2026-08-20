/**
 * UN FOTOGRAMA DE CADA TREINTA TARDA MÁS DE UN SEGUNDO. ¿De qué?
 *
 * Se mide el dibujado con y sin sombras, con y sin serigrafía y con la puerta cerrada y abierta,
 * para saber si el tirón viene del mapa de sombras —que es el sospechoso natural en un
 * rasterizador por software— o de otra cosa. Y se compara con el tablero VACÍO de componentes de
 * puerta, para saber si lo ha traído esta pasada.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
console.log(await abrirEjemplo(p, sv.address().port, 2));
await puerta(p, 0);

const medir = async (etiqueta) => {
	const t = await p.evaluate(() => window.qa.medirDibujado(24));
	console.log(`${etiqueta.padEnd(34)} mediana ${String(t.mediana).padStart(6)} ms · peor ${String(t.peor).padStart(8)} ms`);
	return t;
};

await medir('tal cual');
await medir('tal cual (segunda vuelta)');
await p.evaluate(() => window.qa.sombras(false));
await p.waitForTimeout(300);
await medir('sin sombras');
await medir('sin sombras (segunda vuelta)');
await p.evaluate(() => window.qa.sombras(true));
await p.waitForTimeout(300);
await p.evaluate(() => window.qa.marcas3d(false));
await p.waitForTimeout(300);
await medir('sin serigrafía');
await p.evaluate(() => window.qa.marcas3d(true));
await p.waitForTimeout(300);

// Sin ningún componente de puerta: si el tirón sigue, no lo ha traído esta pasada.
await p.evaluate(() => {
	const pr = window.qa.proyecto();
	pr.gabinete.colocaciones = pr.gabinete.colocaciones.filter((c) => c.montaje !== 'puerta');
	pr.gabinete.rotulos = [];
	window.qa.recalcular();
});
await p.waitForTimeout(800);
await medir('sin nada montado en la puerta');
await medir('sin nada montado (segunda vuelta)');

// Y sin armario en absoluto.
await p.evaluate(() => { document.getElementById('ver-gabinete').click(); });
await p.waitForTimeout(600);
await medir('sin armario');

await b.close(); sv.close();
