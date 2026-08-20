/**
 * ALINEAR Y REPARTIR, sobre la build y con los botones de verdad.
 *
 * Con dos, con tres y con cinco piezas; con huellas iguales y con huellas distintas —un piloto
 * mide 29 mm y un rótulo bastante más—; y contra el canto de la hoja, que es donde una alineación
 * mal hecha tira una pieza fuera de la chapa. Se comprueban los dos repartos, que NO son lo
 * mismo: mismo paso entre ejes (el del taladrado) y mismo aire entre piezas.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, navegadorDelSistema } from './lib/mirar.mjs';

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
await p.waitForTimeout(1200);

const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const marcar = (claves) => p.evaluate((k) => window.qa.marcarEnFrontal(k), claves);
const pulsar = async (id) => { await p.evaluate((i) => document.getElementById(i)?.click(), id); await p.waitForTimeout(420); };
const colocar = async (pares) => {
	await p.evaluate((ps) => {
		const g = window.qa.proyecto().gabinete;
		for (const [c, i, X, Y] of ps) {
			if (c === 'aparato') { const k = g.colocaciones.find((o) => o.dispositivoId === i); k.x = X; k.y = Y; }
			else { const k = g.rotulos.find((o) => o.id === i); k.x = X; k.y = Y; }
		}
		window.qa.recalcular();
	}, pares);
	await p.waitForTimeout(320);
};
const de = async (clase, id) => (await piezas()).find((q) => q.clase === clase && q.id === id);

const lista = await piezas();
const ap = lista.filter((q) => q.clase === 'aparato').map((q) => q.id);
const rot = lista.filter((q) => q.clase === 'rotulo').map((q) => q.id);
const hoja = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		ancho: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		alto: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
	};
});
console.log(`   ${ap.length} aparatos · ${rot.length} rótulos · hoja ${hoja.ancho}×${hoja.alto}`);
console.log('   huellas:', (await piezas()).map((q) => `${q.id} ${q.ancho}×${q.alto}`).join(' · '));

/* ---- 1. DOS piezas: alinear en Y ---- */
await colocar([['aparato', ap[0], 150, 120], ['aparato', ap[1], 300, 190]]);
await marcar([['aparato', ap[0]], ['aparato', ap[1]]]);
await pulsar('btn-al-cy');
{
	const a = await de('aparato', ap[0]), c = await de('aparato', ap[1]);
	ok(a.y === c.y, `dos piezas centradas en horizontal comparten Y (${a.y} vs ${c.y})`);
}

/* ---- 2. TRES piezas: repartir por EJES ---- */
await colocar([['aparato', ap[0], 120, 300], ['aparato', ap[1], 210, 300], ['aparato', ap[2], 520, 300]]);
await marcar(ap.map((i) => ['aparato', i]));
await pulsar('btn-rep-h');
{
	const q = await Promise.all(ap.map((i) => de('aparato', i)));
	q.sort((a, c) => a.x - c.x);
	const p1 = q[1].x - q[0].x, p2 = q[2].x - q[1].x;
	ok(Math.abs(p1 - p2) <= 1, `tres pilotos quedan a paso constante entre ejes (${p1} y ${p2} mm)`);
	ok(q[0].x === 120 && q[2].x === 520, `los extremos no se mueven (${q[0].x}, ${q[2].x})`);
}

/* ---- 3. Repartir por HUECOS con huellas DISTINTAS ---- */
// Un piloto, un rótulo corto y un rótulo largo: tres anchos diferentes.
await p.evaluate(([r1, r2]) => {
	const g = window.qa.proyecto().gabinete;
	g.rotulos.find((o) => o.id === r1).texto = 'R';
	g.rotulos.find((o) => o.id === r2).texto = 'CUIDADO TABLERO ELÉCTRICO';
	window.qa.recalcular();
}, [rot[0], rot[1]]);
await p.waitForTimeout(500);
await colocar([['aparato', ap[0], 110, 440], ['rotulo', rot[0], 260, 440], ['rotulo', rot[1], 540, 440]]);
const trio = [['aparato', ap[0]], ['rotulo', rot[0]], ['rotulo', rot[1]]];
await marcar(trio);
await pulsar('btn-hue-h');
{
	const q = await Promise.all(trio.map(([c, i]) => de(c, i)));
	q.sort((a, c) => a.x - c.x);
	const hueco1 = (q[1].x - q[1].ancho / 2) - (q[0].x + q[0].ancho / 2);
	const hueco2 = (q[2].x - q[2].ancho / 2) - (q[1].x + q[1].ancho / 2);
	console.log(`   anchos ${q.map((k) => k.ancho).join('/')} · huecos ${hueco1.toFixed(1)} y ${hueco2.toFixed(1)} mm`);
	ok(Math.abs(hueco1 - hueco2) <= 1.5, `con huellas distintas el AIRE queda igual (${hueco1.toFixed(1)} vs ${hueco2.toFixed(1)})`);
	ok(q[0].x === 110 && q[2].x === 540, `los extremos siguen quietos (${q[0].x}, ${q[2].x})`);
	// Y el reparto por EJES sobre las mismas piezas da otra cosa: es lo que demuestra que
	// son dos operaciones distintas y no un botón repetido.
	await marcar(trio);
	await pulsar('btn-rep-h');
	const e = await Promise.all(trio.map(([c, i]) => de(c, i)));
	e.sort((a, c) => a.x - c.x);
	ok(e[1].x !== q[1].x, `repartir por ejes coloca la del medio en otro sitio que por huecos (${q[1].x} vs ${e[1].x})`);
	ok(Math.abs((e[1].x - e[0].x) - (e[2].x - e[1].x)) <= 1, 'y por ejes el paso sí queda igual');
}

/* ---- 4. CINCO piezas ---- */
const cinco = [['aparato', ap[0]], ['aparato', ap[1]], ['aparato', ap[2]], ['rotulo', rot[2]], ['rotulo', rot[3]]];
await colocar([
	['aparato', ap[0], 100, 200], ['aparato', ap[1], 140, 260], ['aparato', ap[2], 300, 180],
	['rotulo', rot[2], 380, 300], ['rotulo', rot[3], 560, 240],
]);
await marcar(cinco);
await pulsar('btn-al-cy');
await marcar(cinco);
await pulsar('btn-rep-h');
{
	const q = await Promise.all(cinco.map(([c, i]) => de(c, i)));
	ok(new Set(q.map((k) => k.y)).size === 1, `las cinco comparten Y (${q.map((k) => k.y).join(',')})`);
	q.sort((a, c) => a.x - c.x);
	const pasos = q.slice(1).map((k, i) => k.x - q[i].x);
	ok(Math.max(...pasos) - Math.min(...pasos) <= 1, `y quedan a paso constante (${pasos.join(', ')})`);
}

/* ---- 5. Contra el canto: alinear no puede sacar nada de la hoja ---- */
await colocar([['aparato', ap[0], 20, 80], ['aparato', ap[1], 400, 300], ['aparato', ap[2], 640, 560]]);
await marcar(ap.map((i) => ['aparato', i]));
await pulsar('btn-al-izq');
{
	const q = await Promise.all(ap.map((i) => de('aparato', i)));
	for (const k of q) ok(k.x - k.ancho / 2 >= 0, `${k.id} no se sale por la izquierda (canto en ${(k.x - k.ancho / 2).toFixed(1)})`);
}
await marcar(ap.map((i) => ['aparato', i]));
await pulsar('btn-al-der');
{
	const q = await Promise.all(ap.map((i) => de('aparato', i)));
	for (const k of q) ok(k.x + k.ancho / 2 <= hoja.ancho, `${k.id} no se sale por la derecha (canto en ${(k.x + k.ancho / 2).toFixed(1)})`);
}
await marcar(ap.map((i) => ['aparato', i]));
await pulsar('btn-al-aba');
{
	const q = await Promise.all(ap.map((i) => de('aparato', i)));
	for (const k of q) ok(k.y + k.alto / 2 <= hoja.alto, `${k.id} no se sale por abajo (canto en ${(k.y + k.alto / 2).toFixed(1)})`);
}

/* ---- 6. Una fila industrial de verdad, para mirarla ---- */
await colocar([
	['aparato', ap[0], 230, 170], ['aparato', ap[1], 330, 170], ['aparato', ap[2], 430, 170],
	['rotulo', rot[2], 230, 205], ['rotulo', rot[3], 330, 205], ['rotulo', rot[4], 430, 205],
	['rotulo', rot[0], 330, 120], ['rotulo', rot[1], 330, 520],
]);
await lamina(p, [['fila R S T', await p.evaluate(() => {
	const c = window.qa.camaraAhora();
	return { x: c.pos.x, y: c.pos.y, z: c.pos.z, tx: c.mira.x, ty: c.mira.y, tz: c.mira.z };
})]], { columnas: 1, celda: 900, archivo: 'v-alinear.png' });

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
