/**
 * LOS DETALLES DEL ARMARIO DE CERCA: bisagra, cierre, junta de puerta, canto del marco, suelo con
 * su placa pasacables y la sombra de contacto. Es donde se ve si la chapa está montada o pintada.
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

const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		A: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		H: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
		P: g.caja?.profundidad ?? 160,
	};
});
console.log(`armario ${A}×${H}×${P}`);

await puerta(p, 0);
await lamina(p, [
	['bisagra alta', { x: -A / 2 - 130, y: H * 0.22, z: P + 70, tx: -A / 2, ty: H * 0.28, tz: P - 10 }],
	['bisagra baja de canto', { x: -A / 2 - 90, y: -H * 0.28, z: P - 20, tx: -A / 2 - 6, ty: -H * 0.28, tz: P - 6 }],
	['cierre de tres cuartos', { x: A / 2 - 10, y: 60, z: P + 130, tx: A / 2 - 34, ty: 0, tz: P }],
	['junta y canto del marco', { x: A / 2 + 120, y: 0, z: P + 40, tx: A / 2 - 6, ty: 0, tz: P - 6 }],
	['esquina superior', { x: -A * 0.35, y: H * 0.72, z: P + 230, tx: -A / 2 + 20, ty: H / 2 - 10, tz: P - 20 }],
	['suelo y pasacables', { x: 40, y: -H / 2 - 200, z: P + 120, tx: 0, ty: -H / 2, tz: P * 0.4 }],
], { columnas: 3, celda: 470, archivo: 'v-detalle-cerrada.png' });
console.log('v-detalle-cerrada.png');

await puerta(p, 1);
await lamina(p, [
	['bisagra abierta', { x: -A * 0.9, y: H * 0.24, z: P + 260, tx: -A / 2, ty: H * 0.28, tz: P }],
	['marco y rebaje', { x: A * 0.2, y: 0, z: P + 420, tx: 0, ty: 0, tz: P - 30 }],
	['canto de la hoja', { x: -A * 0.62, y: 0, z: P + 40, tx: -A * 0.75, ty: 0, tz: -P * 0.2 }],
	['suelo por dentro', { x: 0, y: -H * 0.15, z: P + 330, tx: 0, ty: -H / 2 + 40, tz: 0 }],
	['espárragos de la placa', { x: -A * 0.42, y: H * 0.1, z: P + 90, tx: -A * 0.3, ty: 0, tz: -20 }],
	['sombra de contacto', { x: A * 0.5, y: -H * 0.34, z: P + 300, tx: 0, ty: -H / 2 + 30, tz: P * 0.2 }],
], { columnas: 3, celda: 470, archivo: 'v-detalle-abierta.png' });
console.log('v-detalle-abierta.png');
await b.close(); sv.close();
