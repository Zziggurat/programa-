/**
 * GUARDAR Y VOLVER A ABRIR UN FRONTAL VARIADO, y comprobarlo también A LA VISTA.
 *
 * Se compone a mano un frontal con pilotos de cinco colores, duplicados, rótulos de tres estilos
 * y textos de largos distintos; se serializa por el mismo camino que el botón de guardar; se
 * abre por el mismo camino que el de abrir; y se compara el modelo campo a campo Y la imagen
 * píxel a píxel. Que el JSON coincida no demuestra que se vea igual: eso hay que mirarlo.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, navegadorDelSistema, SALIDA } from './lib/mirar.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(90_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

console.log(await abrirEjemplo(p, sv.address().port, 2));
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(1400);

const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const punto = (c, i) => p.evaluate(([a, k]) => window.qa.puntoEnPantallaDeFrontal(a, k), [c, i]);
const pinchar = async (c, i) => {
	const pt = await punto(c, i);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
	await p.waitForTimeout(300);
};

/* ---- Componer un frontal variado, todo por la interfaz ---- */
const COLORES = ['rojo', 'verde', 'ambar', 'azul', 'blanco'];
const pilotos = [];
for (let i = 0; i < COLORES.length; i++) {
	const antes = new Set((await piezas()).filter((q) => q.clase === 'aparato').map((q) => q.id));
	await p.evaluate(() => document.getElementById('btn-add-piloto')?.click());
	await p.waitForTimeout(650);
	const id = (await piezas()).filter((q) => q.clase === 'aparato').map((q) => q.id).find((k) => !antes.has(k));
	pilotos.push(id);
	await pinchar('aparato', id);
	const campo = await p.evaluate(() => {
		for (const s of document.querySelectorAll('#panel-der select')) {
			if ([...s.options].some((o) => o.value === 'rojo')) return s.id;
		}
		return null;
	});
	await p.selectOption(`#${campo}`, COLORES[i]);
	await p.waitForTimeout(400);
	await pinchar('aparato', id);
	await p.evaluate(([x, y]) => {
		const set = (k, v) => { const e = document.getElementById(k); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); };
		set('fp-x', x); set('fp-y', y);
	}, [120 + i * 90, 150]);
	await p.waitForTimeout(350);
}
// Un duplicado del primero, movido y con otra tensión.
await pinchar('aparato', pilotos[0]);
const antesDup = new Set((await piezas()).filter((q) => q.clase === 'aparato').map((q) => q.id));
await p.evaluate(() => document.getElementById('btn-dup-frontal')?.click());
await p.waitForTimeout(700);
const copia = (await piezas()).filter((q) => q.clase === 'aparato').map((q) => q.id).find((k) => !antesDup.has(k));
await pinchar('aparato', copia);
await p.evaluate(() => {
	const set = (k, v) => { const e = document.getElementById(k); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); };
	set('fp-x', 300); set('fp-y', 250);
});
await p.waitForTimeout(400);

// Rótulos de los tres estilos y de largos distintos.
const ROTULOS = [
	['rotulo', 'R', 120, 200], ['rotulo', 'MOTOR 1', 300, 200],
	['placa', 'TABLERO GENERAL', 300, 90], ['aviso', 'CUIDADO TABLERO ELÉCTRICO', 300, 520],
];
for (const [estilo, texto, x, y] of ROTULOS) {
	const antes = new Set((await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id));
	await p.evaluate((e) => document.getElementById(`btn-add-${e}`)?.click(), estilo);
	await p.waitForTimeout(650);
	const id = (await piezas()).filter((q) => q.clase === 'rotulo').map((q) => q.id).find((k) => !antes.has(k));
	await p.evaluate(([t, X, Y]) => {
		const set = (k, v) => { const e = document.getElementById(k); e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true })); };
		set('rot-texto', t); set('rot-x', X); set('rot-y', Y);
	}, [texto, x, y]);
	await p.waitForTimeout(650);
}
/*
 * DESELECCIONAR DE VERDAD antes de la foto. Un clic en «un hueco» no basta: puede caer sobre un
 * panel o sobre otra pieza, y entonces la foto de antes lleva el recuadro azul de la selección y
 * la de después no —porque abrir un proyecto deselecciona—. La primera versión de esta prueba
 * acusó al guardado de cambiar la imagen y lo que cambiaba era el recuadro. Escape es el camino
 * explícito y no depende de dónde haya piezas.
 */
await p.mouse.click(700, 700);
await p.keyboard.press('Escape');
await p.waitForTimeout(500);

/* ---- La foto de antes: modelo y render ---- */
const proyeccion = () => p.evaluate(() => {
	const pr = window.qa.proyecto();
	const g = pr.gabinete;
	return JSON.stringify({
		col: g.colocaciones.filter((c) => c.montaje === 'puerta')
			.map((c) => ({ id: c.dispositivoId, x: c.x, y: c.y, m: c.montaje })),
		ap: g.colocaciones.filter((c) => c.montaje === 'puerta').map((c) => {
			const d = pr.dispositivos.find((k) => k.id === c.dispositivoId);
			return {
				id: d.id, tipo: d.tipo, des: d.designacion, color: d.colorSenal,
				v: d.tensionNominal, desc: d.descripcion, bornes: d.bornes.map((x) => x.id),
			};
		}),
		rot: (g.rotulos ?? []).map((r) => ({ id: r.id, t: r.texto, x: r.x, y: r.y, e: r.estilo, a: r.alto, w: r.ancho })),
	}, null, 1);
});
const render = () => p.evaluate(() => window.qa.componentesDePuerta()
	.map((q) => `${q.id} ${q.color} em=${q.emision} halo=${q.halo} ${q.mundo.x},${q.mundo.y},${q.mundo.z}`).join('\n'));

const camara = await p.evaluate(() => {
	const c = window.qa.camaraAhora();
	return { x: c.pos.x, y: c.pos.y, z: c.pos.z, tx: c.mira.x, ty: c.mira.y, tz: c.mira.z };
});
await p.evaluate((c) => window.qa.verDesde(c), camara);
await p.waitForTimeout(250);
const pixelesAntes = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
const modeloAntes = await proyeccion();
const renderAntes = await render();
writeFileSync(join(SALIDA, 'v-persistencia-antes.png'), Buffer.from(pixelesAntes.split(',')[1], 'base64'));

/* ---- Guardar y volver a abrir por el camino de verdad ---- */
const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
console.log(`   archivo de ${(json.length / 1024).toFixed(0)} kB`);
await p.evaluate((j) => window.qa.cargarJson(j), json);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(1400);
await p.evaluate((c) => window.qa.verDesde(c), camara);
await p.waitForTimeout(400);

const modeloDespues = await proyeccion();
const renderDespues = await render();
const pixelesDespues = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
writeFileSync(join(SALIDA, 'v-persistencia-despues.png'), Buffer.from(pixelesDespues.split(',')[1], 'base64'));

ok(modeloAntes === modeloDespues, 'el modelo sobrevive entero al ida y vuelta');
if (modeloAntes !== modeloDespues) {
	const a = modeloAntes.split('\n'), c = modeloDespues.split('\n');
	for (let i = 0; i < Math.max(a.length, c.length); i++) if (a[i] !== c[i]) console.log(`     línea ${i}: «${a[i]}» -> «${c[i]}»`);
}
ok(renderAntes === renderDespues, 'y el render también: mismo color, misma emisión, mismo sitio');
if (renderAntes !== renderDespues) console.log(`     antes:\n${renderAntes}\n     después:\n${renderDespues}`);

/* ---- Y la imagen, píxel a píxel ---- */
const diferencia = await p.evaluate(async ([a, c]) => {
	const carga = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
	const [ia, ic] = [await carga(a), await carga(c)];
	const lienzo = (img) => {
		const k = document.createElement('canvas');
		k.width = img.width; k.height = img.height;
		k.getContext('2d').drawImage(img, 0, 0);
		return k.getContext('2d').getImageData(0, 0, img.width, img.height).data;
	};
	const [da, dc] = [lienzo(ia), lienzo(ic)];
	let distintos = 0, peor = 0;
	for (let i = 0; i < da.length; i += 4) {
		const d = Math.max(Math.abs(da[i] - dc[i]), Math.abs(da[i + 1] - dc[i + 1]), Math.abs(da[i + 2] - dc[i + 2]));
		if (d > 8) distintos++;
		if (d > peor) peor = d;
	}
	// Y una imagen de la diferencia, para poder MIRAR dónde está en vez de adivinarlo.
	const k = document.createElement('canvas');
	k.width = ia.width; k.height = ia.height;
	const g = k.getContext('2d');
	const img = g.createImageData(ia.width, ia.height);
	let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
	for (let i = 0; i < da.length; i += 4) {
		const d = Math.max(Math.abs(da[i] - dc[i]), Math.abs(da[i + 1] - dc[i + 1]), Math.abs(da[i + 2] - dc[i + 2]));
		const px = (i / 4) % ia.width, py = Math.floor((i / 4) / ia.width);
		img.data[i] = d > 8 ? 255 : da[i] * 0.25;
		img.data[i + 1] = d > 8 ? 0 : da[i + 1] * 0.25;
		img.data[i + 2] = d > 8 ? 0 : da[i + 2] * 0.25;
		img.data[i + 3] = 255;
		if (d > 8) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
	}
	g.putImageData(img, 0, 0);
	return { distintos, total: da.length / 4, peor, caja: [x0, y0, x1, y1], mapa: k.toDataURL('image/png') };
}, [pixelesAntes, pixelesDespues]);
// Un recorte ampliado de la zona, antes y después, para verlo con los ojos.
if (diferencia.caja && diferencia.caja[2] > 0) {
	const recorte = await p.evaluate(async ([a, c, caja]) => {
		const carga = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
		const [ia, ic] = [await carga(a), await carga(c)];
		const [x0, y0, x1, y1] = caja;
		const m = 24, w = x1 - x0 + 1 + m * 2, h = y1 - y0 + 1 + m * 2, z = 4;
		const k = document.createElement('canvas');
		k.width = w * z; k.height = h * z * 2;
		const g = k.getContext('2d');
		g.imageSmoothingEnabled = false;
		g.drawImage(ia, x0 - m, y0 - m, w, h, 0, 0, w * z, h * z);
		g.drawImage(ic, x0 - m, y0 - m, w, h, 0, h * z, w * z, h * z);
		g.fillStyle = '#ff0'; g.font = '16px monospace';
		g.fillText('antes', 6, 18); g.fillText('después', 6, h * z + 18);
		return k.toDataURL('image/png');
	}, [pixelesAntes, pixelesDespues, diferencia.caja]);
	writeFileSync(join(SALIDA, 'v-persistencia-zoom.png'), Buffer.from(recorte.split(',')[1], 'base64'));
}
if (diferencia.mapa) {
	writeFileSync(join(SALIDA, 'v-persistencia-diferencia.png'), Buffer.from(diferencia.mapa.split(',')[1], 'base64'));
	console.log(`   la diferencia cae en el rectángulo ${JSON.stringify(diferencia.caja)}`);
}
const porMillon = Math.round((diferencia.distintos / diferencia.total) * 1e6);
ok(porMillon < 400, `la imagen es la misma tras recargar (${porMillon} píxeles distintos por millón, peor salto ${diferencia.peor})`);

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
