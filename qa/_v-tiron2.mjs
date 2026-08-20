/**
 * ¿QUÉ PASO INTRODUCE EL FOTOGRAMA DE UN SEGUNDO?
 *
 * Se repite la secuencia de la prueba de rendimiento paso a paso, midiendo el dibujado después de
 * cada uno. El primero que dispare el pico es el culpable. Medir después de todo y culpar a «la
 * escena» no sirve: hay que saber qué la deja así.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
console.log(await abrirEjemplo(p, sv.address().port, 2));

const medir = async (etiqueta) => {
	const t = await p.evaluate(() => window.qa.medirDibujado(20));
	console.log(`${etiqueta.padEnd(38)} mediana ${String(t.mediana).padStart(6)} · peor ${String(t.peor).padStart(9)} ms`);
	return t;
};
const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const punto = (c, i) => p.evaluate(([a, k]) => window.qa.puntoEnPantallaDeFrontal(a, k), [c, i]);

await medir('recién abierto (interior)');
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(1600);
await medir('en el frontal, sin tocar nada');

const lista = await piezas();
const ap = lista.filter((q) => q.clase === 'aparato');
{
	const pt = await punto('aparato', ap[0].id);
	await p.mouse.move(Math.round(pt.x), Math.round(pt.y));
	await p.mouse.down();
	for (let i = 1; i <= 12; i++) { await p.mouse.move(Math.round(pt.x + i * 6), Math.round(pt.y + i * 2)); await p.waitForTimeout(18); }
	await p.mouse.up();
	await p.waitForTimeout(400);
}
await medir('tras arrastrar un piloto');

{
	const pt = await punto('aparato', ap[0].id);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
	await p.waitForTimeout(300);
	const campo = await p.evaluate(() => {
		for (const s of document.querySelectorAll('#panel-der select')) {
			if ([...s.options].some((o) => o.value === 'rojo')) return s.id;
		}
		return null;
	});
	await p.selectOption(`#${campo}`, 'azul');
	await p.waitForTimeout(600);
}
await medir('tras cambiar un color');

await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2600);
await medir('CON EL TABLERO ENERGIZADO');
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(1600);
await medir('tras desenergizar');

await p.evaluate(() => document.getElementById('btn-puerta')?.click());
await p.waitForTimeout(1000);
await p.evaluate(() => document.getElementById('btn-puerta')?.click());
await p.waitForTimeout(1200);
await medir('tras abrir y cerrar la puerta');

await p.evaluate((k) => window.qa.marcarEnFrontal(k), lista.slice(0, 5).map((q) => [q.clase, q.id]));
await p.waitForTimeout(400);
await medir('con cinco piezas marcadas');

// Los dos ingredientes que le quedan a la prueba de rendimiento y que aquí no había: la tormenta
// de cien movimientos de ratón y el paseo por los tres espacios de trabajo.
{
	const pt = await punto('aparato', ap[1].id);
	for (let i = 0; i < 100; i++) await p.mouse.move(Math.round(pt.x + (i % 20) - 10), Math.round(pt.y + (i % 7)));
	await p.waitForTimeout(400);
}
await medir('tras cien movimientos de ratón');

for (const id of ['esp-interior', 'esp-conjunto', 'esp-frontal']) {
	await p.evaluate((i) => document.getElementById(i)?.click(), id);
	await p.waitForTimeout(900);
}
let antes = '';
for (let i = 0; i < 60; i++) {
	const ahora = JSON.stringify(await p.evaluate(() => window.qa.camaraAhora()));
	if (ahora === antes) break;
	antes = ahora; await p.waitForTimeout(120);
}
await medir('tras pasear por los tres espacios');

// Y con el cronómetro de la sonda encendido, que es lo último que hace distinta la otra prueba.
await p.evaluate(() => window.qa.cronometro(true));
await medir('con el cronómetro de la sonda activo');
await p.evaluate(() => window.qa.cronometro(false));
await medir('con el cronómetro apagado otra vez');

// EL ÚLTIMO INGREDIENTE que faltaba: arrastrar el GRUPO de cinco piezas, no solo marcarlo.
{
	await p.evaluate((k) => window.qa.marcarEnFrontal(k), lista.slice(0, 5).map((q) => [q.clase, q.id]));
	await p.waitForTimeout(300);
	const pt = await punto(lista[0].clase, lista[0].id);
	await p.mouse.move(Math.round(pt.x), Math.round(pt.y));
	await p.mouse.down();
	for (let i = 1; i <= 12; i++) { await p.mouse.move(Math.round(pt.x - i * 4), Math.round(pt.y + i * 3)); await p.waitForTimeout(18); }
	await p.mouse.up();
	await p.waitForTimeout(500);
}
await medir('TRAS ARRASTRAR LAS CINCO JUNTAS');
await medir('y otra vez, por si es la primera');
await p.waitForTimeout(1500);
await medir('y tras un segundo y medio de calma');

await b.close(); sv.close();
