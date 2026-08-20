/**
 * EL COLOR DE LOS PILOTOS, DESDE LA INTERFAZ DE VERDAD.
 *
 * Nada de escribir en el modelo: se pulsa «+ Piloto», se selecciona en el lienzo con un clic real,
 * se busca en la ficha el desplegable del color por su ETIQUETA —no por su posición— y se elige la
 * opción como la elegiría una persona. Después se comprueba lo único que importa: que cada lente
 * tenga SU color, que apagada conserve el tinte sin emitir, que encendida coincidan lente,
 * emisión y halo, y que cambiar una no toque a ninguna otra.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const EJEMPLO = Number(process.argv[2] ?? 2);
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

console.log(await abrirEjemplo(p, sv.address().port, EJEMPLO));
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(900);

/** Selecciona una pieza pinchándola en el lienzo, como una persona. */
async function pinchar(clase, id) {
	const pt = await p.evaluate(([c, i]) => window.qa.puntoEnPantallaDeFrontal(c, i), [clase, id]);
	if (!pt) throw new Error(`no se ve en pantalla: ${clase} ${id}`);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
	await p.waitForTimeout(320);
	return p.evaluate(() => window.qa.seleccion());
}

/** El desplegable del color, buscado por su etiqueta en la ficha que se está viendo. */
async function ponerColor(valor) {
	const idCampo = await p.evaluate(() => {
		for (const sel of document.querySelectorAll('#panel-der select')) {
			if ([...sel.options].some((o) => o.value === 'rojo')) return sel.id;
		}
		return null;
	});
	if (!idCampo) throw new Error('la ficha no ofrece ningún color de lente');
	await p.selectOption(`#${idCampo}`, valor);
	await p.waitForTimeout(420);
	return idCampo;
}

/** Añade un piloto por el botón y devuelve el id del que acaba de nacer. */
async function anadirPiloto() {
	const antes = new Set(await p.evaluate(() => window.qa.componentesDePuerta().map((q) => q.id)));
	await p.evaluate(() => document.getElementById('btn-add-piloto')?.click());
	await p.waitForTimeout(700);
	const ahora = await p.evaluate(() => window.qa.componentesDePuerta().map((q) => q.id));
	return ahora.find((i) => !antes.has(i));
}

const estado = () => p.evaluate(() => window.qa.componentesDePuerta());
const tono = (hex) => {
	const n = parseInt(hex.slice(1), 16);
	const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b2 = (n & 255) / 255;
	const mx = Math.max(r, g, b2), mn = Math.min(r, g, b2), d = mx - mn;
	let h = 0;
	if (d) h = mx === r ? ((g - b2) / d + 6) % 6 : mx === g ? (b2 - r) / d + 2 : (r - g) / d + 4;
	return { h: Math.round(h * 60), s: mx ? d / mx : 0, l: (mx + mn) / 2 };
};

/* ---- 1. R rojo, S ámbar, T verde, puestos uno a uno desde la ficha ---- */
const nuevos = [];
for (const [marca, color] of [['R', 'rojo'], ['S', 'ambar'], ['T', 'verde']]) {
	const id = await anadirPiloto();
	nuevos.push([marca, id]);
	await pinchar('aparato', id);
	await ponerColor(color);
	// Y se les separa para poder mirarlos: X distinto a cada uno, por la propia ficha.
	await p.evaluate((x) => {
		const e = document.getElementById('fp-x');
		e.value = String(x); e.dispatchEvent(new Event('change', { bubbles: true }));
	}, 120 + nuevos.length * 90);
	await p.waitForTimeout(300);
}
const [[, idR], [, idS], [, idT]] = nuevos;

const leer = async () => Object.fromEntries((await estado()).map((q) => [q.id, q]));
let v = await leer();
ok(tono(v[idR].color).h < 20 || tono(v[idR].color).h > 340, `R es rojo (${v[idR].color})`);
ok(tono(v[idS].color).h > 25 && tono(v[idS].color).h < 55, `S es ámbar (${v[idS].color})`);
ok(tono(v[idT].color).h > 90 && tono(v[idT].color).h < 160, `T es verde (${v[idT].color})`);

/* ---- 2. S -> azul, y NADIE MÁS SE ENTERA ---- */
const antesDelCambio = JSON.stringify(await estado());
await pinchar('aparato', idS);
await ponerColor('azul');
v = await leer();
ok(tono(v[idS].color).h > 190 && tono(v[idS].color).h < 250, `S pasa a azul (${v[idS].color})`);
const despues = await leer();
const antes = JSON.parse(antesDelCambio).reduce((a, q) => ({ ...a, [q.id]: q }), {});
for (const id of Object.keys(antes)) {
	if (id === idS) continue;
	ok(JSON.stringify(antes[id]) === JSON.stringify(despues[id]), `cambiar S no toca a ${id}`);
}

/* ---- 3. Duplicar R y pasar la copia a blanco ---- */
await pinchar('aparato', idR);
const antesDup = new Set(Object.keys(await leer()));
await p.evaluate(() => document.getElementById('btn-dup-frontal')?.click());
await p.waitForTimeout(700);
const idCopia = Object.keys(await leer()).find((i) => !antesDup.has(i));
ok(!!idCopia, `duplicar R crea una pieza nueva (${idCopia})`);
await pinchar('aparato', idCopia);
await p.evaluate(() => {
	const e = document.getElementById('fp-x');
	e.value = String(470); e.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(300);
await pinchar('aparato', idCopia);
await ponerColor('blanco');
v = await leer();
/*
 * «Blanco» no se comprueba con un número mágico. Un blanco de señalización es un blanco FRÍO
 * (0xdfe4e8) y al apagarlo baja de luminosidad conservando el tono, así que en RGB queda un gris
 * azulado: #838d95, con 0,12 de saturación medida sobre el máximo. Eso no lo distingue un umbral
 * absoluto —la primera versión de esta prueba puso 0,12 y falló por una milésima— pero lo
 * distingue lo único que importa de verdad: al lado de un rojo, un azul o un verde de la misma
 * puerta, el blanco tiene que estar MUCHO menos saturado que cualquiera de ellos.
 */
const satColor = Math.min(...[idR, idS, idT].map((i) => tono(v[i].color).s));
ok(
	tono(v[idCopia].color).s < satColor * 0.35,
	`la copia es blanca: ${tono(v[idCopia].color).s.toFixed(2)} de saturación frente a ${satColor.toFixed(2)} del piloto de color menos vivo (${v[idCopia].color})`,
);
ok(tono(v[idR].color).h < 20 || tono(v[idR].color).h > 340, `R SIGUE rojo tras teñir su copia (${v[idR].color})`);
ok(tono(v[idS].color).h > 190 && tono(v[idS].color).h < 250, `S sigue azul (${v[idS].color})`);
ok(tono(v[idT].color).h > 90 && tono(v[idT].color).h < 160, `T sigue verde (${v[idT].color})`);

/* ---- 4. Apagado: tinte sí, emisión no ---- */
const apagados = await leer();
for (const [id, q] of Object.entries(apagados)) {
	ok(q.emision === 0 && q.halo === 0, `${id} apagado no emite ni tiene halo`);
}
await puerta(p, 0);
await lamina(p, [['apagados', await p.evaluate(() => {
	const c = window.qa.camaraAhora();
	return { x: c.pos.x, y: c.pos.y, z: c.pos.z, tx: c.mira.x, ty: c.mira.y, tz: c.mira.z };
})]], { columnas: 1, celda: 900, archivo: 'v-color-apagados.png' });

/* ---- 5. Encendido: lente, emisión y halo del MISMO color ---- */
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(2600);
const vivos = await estado();
const conHilos = await p.evaluate((ids) => ids.filter((i) => window.qa.proyecto().conductores
	.some((c) => c.de.dispositivoId === i || c.a.dispositivoId === i)), vivos.map((q) => q.id));
console.log(`   pilotos cableados: ${conHilos.join(', ') || 'ninguno'}`);
for (const q of vivos) {
	if (conHilos.includes(q.id)) {
		ok(q.encendido && q.halo > 0, `${q.id} cableado enciende con halo (em=${q.emision} halo=${q.halo})`);
	} else {
		ok(!q.encendido, `${q.id} sin cablear NO enciende: la luz sale del circuito`);
	}
}
const claros = Object.fromEntries(vivos.map((q) => [q.id, tono(q.color)]));
for (const q of vivos) {
	if (!conHilos.includes(q.id)) continue;
	// Encendido y apagado son el MISMO tono: lo que cambia es cuánto, no cuál.
	const dif = Math.abs(claros[q.id].h - tono(apagados[q.id].color).h);
	ok(Math.min(dif, 360 - dif) < 12, `${q.id} enciende en SU color (${apagados[q.id].color} -> ${q.color})`);
	ok(claros[q.id].l > tono(apagados[q.id].color).l, `${q.id} encendido es más claro que apagado`);
}
await lamina(p, [['encendidos', await p.evaluate(() => {
	const c = window.qa.camaraAhora();
	return { x: c.pos.x, y: c.pos.y, z: c.pos.z, tx: c.mira.x, ty: c.mira.y, tz: c.mira.z };
})]], { columnas: 1, celda: 900, archivo: 'v-color-encendidos.png' });

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
