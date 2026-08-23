/**
 * SITUACIONES DIFÍCILES DE PUNTERÍA, hechas a propósito.
 *
 * Pilotos casi pegados, un piloto con su rótulo debajo, varios rótulos juntos, piezas pequeñas y
 * piezas contra el canto de la hoja. Se comprueban las dos mitades del problema: que se pueda
 * coger lo que se quiere sin puntería de cirujano, y que el vecino no robe el clic.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, navegadorDelSistema } from './lib/mirar.mjs';

const EN_GATE = process.argv.includes('--gate');

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.setDefaultTimeout(90_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

console.log(await abrirEjemplo(p, sv.address().port, 2));
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(900);
async function camaraQuieta() {
	let antes = '';
	for (let i = 0; i < 60; i++) {
		const ahora = JSON.stringify(await p.evaluate(() => window.qa.camaraAhora()));
		if (ahora === antes) return;
		antes = ahora; await p.waitForTimeout(120);
	}
}
await camaraQuieta();

const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const punto = (clase, id) => p.evaluate(([c, i]) => window.qa.puntoEnPantallaDeFrontal(c, i), [clase, id]);
const colocar = async (clase, id, x, y) => {
	await p.evaluate(([c, i, X, Y]) => {
		const g = window.qa.proyecto().gabinete;
		if (c === 'aparato') { const k = g.colocaciones.find((o) => o.dispositivoId === i); k.x = X; k.y = Y; }
		else { const k = g.rotulos.find((o) => o.id === i); k.x = X; k.y = Y; }
		window.qa.recalcular();
	}, [clase, id, x, y]);
	await p.waitForTimeout(260);
};
async function clic(x, y) {
	await p.mouse.click(Math.round(x), Math.round(y));
	await p.waitForTimeout(200);
	return p.evaluate(() => window.qa.seleccion());
}
const hoja = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		ancho: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		alto: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
	};
});
console.log('   hoja', hoja);

const lista = await piezas();
const aparatos = lista.filter((q) => q.clase === 'aparato');
const rotulos = lista.filter((q) => q.clase === 'rotulo');
console.log('   aparatos', aparatos.map((q) => q.id).join(' '), '· rótulos', rotulos.map((q) => q.id).join(' '));

/* ---- 1. Dos pilotos casi pegados: 32 mm de eje a eje (el aro mide 29,2) ---- */
await colocar('aparato', aparatos[0].id, 200, 150);
await colocar('aparato', aparatos[1].id, 232, 150);
await colocar('aparato', aparatos[2].id, 480, 420);
for (const r of rotulos) await colocar('rotulo', r.id, 480, 120 + rotulos.indexOf(r) * 40);
await p.waitForTimeout(300);

for (const q of [aparatos[0], aparatos[1]]) {
	const pt = await punto('aparato', q.id);
	ok((await clic(pt.x, pt.y))?.id === q.id, `pegados a 32 mm, el clic en el centro coge ${q.id}`);
}
// Y con el puntero unos píxeles fuera del centro tiene que seguir cogiendo el mismo.
for (const [dx, dy] of [[6, 0], [-6, 0], [0, 7], [0, -7]]) {
	const pt = await punto('aparato', aparatos[0].id);
	const s = await clic(pt.x + dx, pt.y + dy);
	ok(s?.id === aparatos[0].id, `desviando ${dx},${dy} px sigue cogiendo ${aparatos[0].id} (cogió ${s?.id ?? 'nada'})`);
}
// El vecino NO puede robar el clic: se pincha entre los dos, más cerca del segundo.
{
	const a = await punto('aparato', aparatos[0].id);
	const c = await punto('aparato', aparatos[1].id);
	const s = await clic(a.x + (c.x - a.x) * 0.72, a.y + (c.y - a.y) * 0.72);
	ok(s?.id === aparatos[1].id, `pinchando al 72 % del camino gana el más cercano (cogió ${s?.id ?? 'nada'})`);
}

/* ---- 2. Un piloto con su rótulo justo debajo ---- */
await colocar('aparato', aparatos[0].id, 200, 300);
await colocar('rotulo', rotulos[0].id, 200, 326);
await p.waitForTimeout(300);
{
	const pa = await punto('aparato', aparatos[0].id);
	const pr = await punto('rotulo', rotulos[0].id);
	ok((await clic(pa.x, pa.y))?.id === aparatos[0].id, 'con el rótulo pegado debajo, el clic en la lente coge el piloto');
	const s = await clic(pr.x, pr.y);
	ok(s?.id === rotulos[0].id, `y el clic en el rótulo coge el rótulo (cogió ${s?.id ?? 'nada'})`);
}

/* ---- 3. Varios rótulos juntos ---- */
for (let i = 0; i < Math.min(4, rotulos.length); i++) await colocar('rotulo', rotulos[i].id, 430, 200 + i * 26);
await p.waitForTimeout(300);
for (let i = 0; i < Math.min(4, rotulos.length); i++) {
	const pt = await punto('rotulo', rotulos[i].id);
	const s = await clic(pt.x, pt.y);
	ok(s?.id === rotulos[i].id, `con cuatro rótulos a 26 mm, el clic coge ${rotulos[i].id} (cogió ${s?.id ?? 'nada'})`);
}

/* ---- 4. Contra el canto de la hoja ---- */
await colocar('aparato', aparatos[2].id, 22, hoja.alto - 22);
await p.waitForTimeout(300);
{
	const pt = await punto('aparato', aparatos[2].id);
	const s = await clic(pt.x, pt.y);
	ok(s?.id === aparatos[2].id, `una pieza contra la esquina sigue siendo pinchable (cogió ${s?.id ?? 'nada'})`);
}

/* ---- 5. Pinchar el vacío deselecciona, y no coge nada de dentro del armario ---- */
{
	const s = await clic(760, 860);
	ok(s === undefined || s === null, `pinchar la chapa vacía deselecciona (quedó ${JSON.stringify(s)})`);
}

if (!EN_GATE) {
	await lamina(p, [['puntería', await p.evaluate(() => {
		const c = window.qa.camaraAhora();
		return { x: c.pos.x, y: c.pos.y, z: c.pos.z, tx: c.mira.x, ty: c.mira.y, tz: c.mira.z };
	})]], { columnas: 1, celda: 900, archivo: 'v-picking.png' });
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
process.exit(fallos.length ? 1 : 0);
