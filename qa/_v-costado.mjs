/** ¿QUÉ SON ESAS RANURAS EN EL COSTADO? Se mira de cerca y se pregunta a la escena. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema, lamina } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.setDefaultTimeout(90_000);
await abrirEjemplo(p, sv.address().port, 1);
// La caja MÁS PEQUEÑA que el modelo deja poner con esta placa: 300 × 400 se recorta a 310 × 410,
// o sea cinco milímetros de aire por lado. Es el caso en el que se vería si algo del interior
// atraviesa el costado.
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
console.log('armario', A, H, P);
// ¿Es geometría atravesando la chapa, o es una SOMBRA proyectada donde no debe? Se apaga el
// sombreado y se vuelve a mirar: si el dibujo desaparece, no había nada atravesando nada.
await lamina(p, [
	['con sombras', { x: -A / 2 - 190, y: -H * 0.05, z: P * 0.35, tx: -A / 2, ty: -H * 0.05, tz: P * 0.35 }],
], { columnas: 1, celda: 600, archivo: 'v-costado-con-sombras.png' });
await p.evaluate(() => window.qa.sombras(false));
await p.waitForTimeout(300);
await lamina(p, [
	['sin sombras', { x: -A / 2 - 190, y: -H * 0.05, z: P * 0.35, tx: -A / 2, ty: -H * 0.05, tz: P * 0.35 }],
], { columnas: 1, celda: 600, archivo: 'v-costado-sin-sombras.png' });
await p.evaluate(() => window.qa.sombras(true));
await p.waitForTimeout(300);
await lamina(p, [
	['costado de lejos', { x: -A * 2.2, y: 0, z: P * 0.4, tx: 0, ty: 0, tz: P * 0.4 }],
	['costado de cerca', { x: -A * 1.1, y: -H * 0.05, z: P * 0.35, tx: -A / 2, ty: -H * 0.05, tz: P * 0.35 }],
	['costado muy de cerca', { x: -A / 2 - 190, y: -H * 0.05, z: P * 0.35, tx: -A / 2, ty: -H * 0.05, tz: P * 0.35 }],
	['costado desde delante', { x: -A * 1.4, y: 0, z: P + 260, tx: -A / 2, ty: 0, tz: P * 0.4 }],
], { columnas: 2, celda: 600, archivo: 'v-costado.png' });
console.log('v-costado.png');
await b.close(); sv.close();
