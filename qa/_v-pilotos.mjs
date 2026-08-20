/**
 * MIRAR UN PILOTO DE CERCA. De frente, de canto, en diagonal, por detrás de la puerta y desde
 * lejos, apagado y encendido, para juzgar si se lee como aparamenta de tablero o como un LED.
 *
 * Uso: node qa/_v-pilotos.mjs [ejemplo]
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const EJEMPLO = Number(process.argv[2] ?? 2);
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(90_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));

const nombre = await abrirEjemplo(p, sv.address().port, EJEMPLO);
console.log(`Ejemplo: ${nombre}`);

await puerta(p, 0);
let pilotos = await p.evaluate(() => window.qa.componentesDePuerta());
console.log(`pilotos: ${pilotos.map((q) => `${q.id}@${q.mundo.x},${q.mundo.y},${q.mundo.z}`).join(' · ')}`);
if (!pilotos.length) { console.log('sin pilotos en este tablero'); await b.close(); sv.close(); process.exit(0); }

const q = pilotos[Math.min(1, pilotos.length - 1)];
const { x, y, z } = q.mundo;
const mira = { tx: x, ty: y, tz: z };

/** Cámaras alrededor de UN piloto, a distancias de lupa. */
function alrededor(r) {
	return [
		[`frente ${r}mm`, { x, y, z: z + r, ...mira }],
		[`diagonal ${r}mm`, { x: x - r * 0.62, y: y + r * 0.42, z: z + r * 0.66, ...mira }],
		[`canto casi rasante`, { x: x - r * 0.97, y: y + r * 0.06, z: z + r * 0.24, ...mira }],
		[`desde abajo`, { x, y: y - r * 0.86, z: z + r * 0.5, ...mira }],
		[`desde arriba`, { x, y: y + r * 0.86, z: z + r * 0.5, ...mira }],
		[`lejos`, { x, y, z: z + 1400, ...mira }],
	];
}

for (const [etiqueta, encender] of [['apagado', false], ['encendido', true]]) {
	if (encender) {
		await p.evaluate(() => document.getElementById('btn-energizar')?.click());
		await p.waitForTimeout(2200);
	}
	const estado = await p.evaluate(() => window.qa.componentesDePuerta());
	console.log(`${etiqueta}: ${estado.map((s) => `${s.id} ${s.color} em=${s.emision} halo=${s.halo}`).join(' | ')}`);
	const ruta = await lamina(p, alrededor(90), { columnas: 3, celda: 470, archivo: `v-piloto-${etiqueta}.png` });
	console.log(`  ${ruta.split('/').pop()}`);
}

// La trasera: se abre la puerta y se mira el portalámparas desde dentro del armario.
await puerta(p, 1);
const tras = await p.evaluate(() => window.qa.componentesDePuerta());
const t = tras[Math.min(1, tras.length - 1)].mundo;
/*
 * Con las bisagras a la izquierda la puerta gira −118°, así que la normal de su cara EXTERIOR
 * queda en (sin(−118°), 0, cos(−118°)) y la TRASERA —la que da al interior del armario, que es
 * la que se quiere mirar aquí— es la contraria. La primera versión de esta prueba puso la cámara
 * del lado equivocado y fotografió las lentes creyendo que fotografiaba los portalámparas.
 */
const a = (-118 * Math.PI) / 180;
const n = { x: -Math.sin(a), z: -Math.cos(a) };
const detras = (d, dy = 0) => ({
	x: t.x + n.x * d, y: t.y + dy, z: t.z + n.z * d, tx: t.x, ty: t.y, tz: t.z,
});
await lamina(p, [
	['trasera de frente', detras(150)],
	['trasera en diagonal', detras(150, 90)],
	['trasera de cerca', detras(70, 26)],
], { columnas: 3, celda: 470, archivo: 'v-piloto-trasera.png' });
console.log('  v-piloto-trasera.png');

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
await b.close();
sv.close();
