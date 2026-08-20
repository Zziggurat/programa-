/** ¿QUÉ LE PASA A UNA PALABRA LARGA? El atlas guarda una palabra por celda y la celda mide 128 px. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.setDefaultTimeout(90_000);
await abrirEjemplo(p, sv.address().port, 2);
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(1400);

const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const PALABRAS = ['PARO', 'MARCHA', 'EMERGENCIA', 'TRANSFORMADOR', 'ENCLAVAMIENTO', 'RRRRRRRRRRRRRRRRRRRR'];
const ids = [];
for (let i = 0; i < PALABRAS.length; i++) {
	const antes = new Set((await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id));
	await p.evaluate(() => document.getElementById('btn-add-rotulo')?.click());
	await p.waitForTimeout(600);
	const id = (await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id).find((k) => !antes.has(k));
	await p.evaluate(([t, y]) => {
		const set = (k, v) => { const e = document.getElementById(k); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); };
		set('rot-alto', 12); set('rot-texto', t); set('rot-x', 330); set('rot-y', y);
	}, [PALABRAS[i], 120 + i * 70]);
	await p.waitForTimeout(700);
	ids.push(id);
}
const q = await piezas();
for (let i = 0; i < PALABRAS.length; i++) {
	const k = q.find((o) => o.id === ids[i]);
	console.log(`${PALABRAS[i].padEnd(22)} ${String(PALABRAS[i].length).padStart(2)} letras -> ${k.ancho}×${k.alto} mm  (${(k.ancho / PALABRAS[i].length).toFixed(1)} mm/letra)`);
}
await lamina(p, [['palabras largas', { x: 330 - 330, y: 0, z: 620, tx: 0, ty: 0, tz: 160 }]],
	{ columnas: 1, celda: 1000, archivo: 'v-palabra-larga.png' });
await b.close(); sv.close();
