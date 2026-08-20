/**
 * LOS RÓTULOS: textos cortos, largos y de varias palabras, duplicados y pegados a los pilotos.
 *
 * Lo que se mira: que se lean, que midan lo que dicen medir, que dos rótulos iguales no cuesten
 * el doble —comparten celdas del atlas de serigrafía— y, sobre todo, que seleccionar UNO no
 * cambie el aspecto de los demás. Esto último fue un fallo real: el resaltado recorría el grupo
 * poniendo `emissive` y los glifos comparten los materiales de tinta de todo el tablero, así que
 * marcar un rótulo teñía de azul TODA la serigrafía del panel.
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
await p.waitForTimeout(1400);

const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const punto = (c, i) => p.evaluate(([a, b2]) => window.qa.puntoEnPantallaDeFrontal(a, b2), [c, i]);

/** Crea un rótulo por el botón y le pone texto por su ficha, como una persona. */
async function rotulo(texto, estilo = 'grabado', x, y) {
	const antes = new Set((await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id));
	await p.evaluate((e) => document.getElementById(`btn-add-${e}`)?.click(), estilo === 'grabado' ? 'rotulo' : estilo);
	await p.waitForTimeout(600);
	const id = (await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id).find((i) => !antes.has(i));
	// Recién creado ya queda seleccionado por el propio editor, que es lo que hace al añadirlo.
	await p.evaluate(([t, X, Y]) => {
		const set = (k, v) => { const e = document.getElementById(k); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); };
		set('rot-texto', t); set('rot-x', X); set('rot-y', Y);
	}, [texto, x, y]);
	await p.waitForTimeout(650);
	return id;
}

const TEXTOS = [
	['R', 'grabado', 180, 210], ['S', 'grabado', 300, 210], ['T', 'grabado', 420, 210],
	['MARCHA', 'grabado', 180, 330], ['FALLA', 'grabado', 330, 330], ['MOTOR 1', 'grabado', 480, 330],
	['TABLERO GENERAL', 'placa', 300, 100],
	['CUIDADO TABLERO ELÉCTRICO', 'aviso', 300, 560],
];
const creados = [];
for (const [t, e, x, y] of TEXTOS) creados.push([t, await rotulo(t, e, x, y)]);

const todos = await piezas();
for (const [t, id] of creados) {
	const q = todos.concat(await piezas()).find((k) => k.clase === 'rotulo' && k.id === id);
	console.log(`   «${t}» -> ${q.ancho}×${q.alto} mm en ${q.x},${q.y}`);
	ok(q.ancho > 0 && q.alto > 0, `«${t}» tiene huella (${q.ancho}×${q.alto})`);
}
{
	const anchoCorto = (await piezas()).find((k) => k.id === creados[0][1]).ancho;
	const anchoLargo = (await piezas()).find((k) => k.id === creados[7][1]).ancho;
	ok(anchoLargo > anchoCorto * 3, `un texto largo ocupa mucho más que «R» (${anchoCorto} vs ${anchoLargo} mm)`);
}

/* ---- El ancho sigue al texto dentro del mismo estilo ---- */
{
	const [, idR] = creados[0];
	const pt = await punto('rotulo', idR);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
	await p.waitForTimeout(350);
	const antes = (await piezas()).find((k) => k.id === idR).ancho;
	await p.evaluate(() => {
		const e = document.getElementById('rot-texto');
		e.value = 'RRRRRRRRRRRRRRRRRRRR'; e.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await p.waitForTimeout(700);
	const despues = (await piezas()).find((k) => k.id === idR).ancho;
	ok(despues > antes * 2, `veinte letras ocupan mucho más que una (${antes} -> ${despues} mm)`);
	await p.evaluate(() => {
		const e = document.getElementById('rot-texto');
		e.value = 'R'; e.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await p.waitForTimeout(700);
}

/* ---- Duplicar un rótulo: identidad propia, texto igual ---- */
{
	/*
	 * Se selecciona PINCHANDO. La sonda `qa.elegir` marca siempre como «dispositivo», así que con
	 * un rótulo deja la selección en un tipo que no le corresponde y luego duplicar no encuentra
	 * nada que duplicar: la primera versión de esta prueba acusaba al editor de no duplicar
	 * rótulos cuando lo que estaba mal era la forma de seleccionarlos desde fuera.
	 */
	const [, idMarcha] = creados[3];
	{
		const pt = await punto('rotulo', idMarcha);
		await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
		await p.waitForTimeout(350);
	}
	const antes = new Set((await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id));
	await p.evaluate(() => document.getElementById('btn-dup-frontal')?.click());
	await p.waitForTimeout(700);
	const copia = (await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id).find((i) => !antes.has(i));
	ok(!!copia && copia !== idMarcha, `duplicar MARCHA da un rótulo con identidad propia (${copia})`);
	const textos = await p.evaluate(([a, c]) => {
		const g = window.qa.proyecto().gabinete;
		return [g.rotulos.find((r) => r.id === a)?.texto, g.rotulos.find((r) => r.id === c)?.texto];
	}, [idMarcha, copia]);
	ok(textos[0] === 'MARCHA' && textos[1] === 'MARCHA', `la copia dice lo mismo (${textos.join(' / ')})`);
	// Y cambiar la copia no toca al original: es lo que distingue una copia de un alias.
	{
		const pt = await punto('rotulo', copia);
		await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
		await p.waitForTimeout(350);
	}
	await p.evaluate(() => {
		const e = document.getElementById('rot-texto');
		e.value = 'PARO'; e.dispatchEvent(new Event('change', { bubbles: true }));
	});
	await p.waitForTimeout(650);
	const despues = await p.evaluate(([a, c]) => {
		const g = window.qa.proyecto().gabinete;
		return [g.rotulos.find((r) => r.id === a)?.texto, g.rotulos.find((r) => r.id === c)?.texto];
	}, [idMarcha, copia]);
	ok(despues[0] === 'MARCHA' && despues[1] === 'PARO', `cambiar la copia no toca al original (${despues.join(' / ')})`);
}

/* ---- Seleccionar uno NO puede cambiar el aspecto de los demás ---- */
{
	const [, idLejano] = creados[6];      // TABLERO GENERAL, arriba
	const [, idOtro] = creados[7];        // el aviso, abajo del todo
	const pt = await punto('rotulo', idLejano);
	const antes = await p.evaluate(([x, y]) => {
		const l = document.querySelector('canvas');
		const c = document.createElement('canvas');
		c.width = l.width; c.height = l.height;
		c.getContext('2d').drawImage(l, 0, 0);
		const g = c.getContext('2d');
		const r = l.getBoundingClientRect();
		const d = g.getImageData(Math.round(x - r.left) - 40, Math.round(y - r.top) - 12, 80, 24).data;
		return Array.from(d).join(',');
	}, [(await punto('rotulo', idOtro)).x, (await punto('rotulo', idOtro)).y]);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
	await p.waitForTimeout(400);
	const sel = await p.evaluate(() => window.qa.seleccion());
	ok(sel?.id === idLejano, `se selecciona el rótulo pinchado (${sel?.id})`);
	const despues = await p.evaluate(([x, y]) => {
		const l = document.querySelector('canvas');
		const c = document.createElement('canvas');
		c.width = l.width; c.height = l.height;
		c.getContext('2d').drawImage(l, 0, 0);
		const g = c.getContext('2d');
		const r = l.getBoundingClientRect();
		const d = g.getImageData(Math.round(x - r.left) - 40, Math.round(y - r.top) - 12, 80, 24).data;
		return Array.from(d).join(',');
	}, [(await punto('rotulo', idOtro)).x, (await punto('rotulo', idOtro)).y]);
	ok(antes === despues, 'marcar un rótulo no cambia ni un píxel de otro rótulo del panel');
}

/* ---- Mirarlos ---- */
const camara = await p.evaluate(() => {
	const c = window.qa.camaraAhora();
	return { x: c.pos.x, y: c.pos.y, z: c.pos.z, tx: c.mira.x, ty: c.mira.y, tz: c.mira.z };
});
await p.mouse.click(1180, 880);   // la chapa vacía: deselecciona
await p.waitForTimeout(300);
await lamina(p, [
	['todo el frontal', camara],
	['de cerca', { x: camara.tx + 40, y: camara.ty + 60, z: camara.tz + 420, tx: camara.tx, ty: camara.ty + 60, tz: camara.tz }],
], { columnas: 2, celda: 740, archivo: 'v-rotulos.png' });

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
