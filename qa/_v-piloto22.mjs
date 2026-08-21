/**
 * EL PILOTO Ø22, MEDIDO Y MIRADO, contra la fotografía de uno de verdad.
 *
 * Tres cosas que se pueden discutir con números: las cotas físicas (taladro, embellecedor, lente,
 * vuelo), el degradado de la lente encendida (centro casi blanco, borde saturado) y el alcance
 * del resplandor sobre la chapa. Y después, las láminas para mirarlo.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, t) => { console.log(`${bien ? 'OK ' : 'MAL'} ${t}`); if (!bien) fallos.push(t); };

console.log(await abrirEjemplo(p, sv.address().port, 2));
await puerta(p, 0);
await p.evaluate(() => window.qa.congelarCamara(true));

/* ---------------- 1. Las cotas, vértice a vértice ---------------- */
{
	const piezas = await p.evaluate(() => window.qa.medidasDePiloto());
	for (const q of piezas) console.log(`   ${q.pieza.padEnd(18)} Ø${q.ancho} × ${q.alto} · z ${q.z0}..${q.z1}`);
	const lente = piezas.find((q) => q.pieza === 'lente');
	const aro = piezas.filter((q) => q.pieza === 'LatheGeometry').sort((a, c) => c.ancho - a.ancho)[0];
	const vuelo = Math.max(...piezas.map((q) => q.z1));
	const fondo = Math.min(...piezas.map((q) => q.z0));
	ok(lente && Math.abs(lente.ancho - lente.alto) < 0.2,
		`la lente es REDONDA, no un óvalo (${lente?.ancho} × ${lente?.alto})`);
	ok(lente && lente.ancho >= 21 && lente.ancho <= 23, `y mide de 21 a 23 mm (Ø${lente?.ancho})`);
	ok(aro && aro.ancho >= 28 && aro.ancho <= 30.5, `el embellecedor mide unos 29 mm (Ø${aro?.ancho})`);
	ok(vuelo >= 7 && vuelo <= 10, `sobresale de 7 a 10 mm por delante de la chapa (${vuelo})`);
	const domo = lente ? lente.z1 - 5.2 : 0;
	console.log(`   el domo de la lente levanta ${domo.toFixed(1)} mm sobre el faldón`);
	ok(domo < lente.ancho * 0.2, `la lente es CASI PLANA, no media bola (domo ${domo.toFixed(1)} sobre Ø${lente.ancho})`);
	console.log(`   por dentro llega a ${fondo} mm: atraviesa la chapa de 15 y saca cuerpo y bornes`);
	ok(fondo < -30, `el cuerpo sale de verdad por dentro de la puerta (${fondo} mm)`);
}

/* ---------------- 2. El degradado de la lente encendida ---------------- */
/** Perfil de color a lo largo de una fila del lienzo, centrada en el piloto. */
async function perfil(px, py, largo, paso, dir = [1, 0]) {
	return p.evaluate(([cx, cy, largo, paso, dir]) => {
		const l = document.querySelector('canvas');
		const c = document.createElement('canvas');
		c.width = l.width; c.height = l.height;
		const g = c.getContext('2d');
		g.drawImage(l, 0, 0);
		// El lienzo puede tener más píxeles físicos que CSS: se lee en los suyos.
		const k = l.width / l.clientWidth;
		const salida = [];
		for (let d = 0; d <= largo; d += paso) {
			const x = Math.round((cx + d * dir[0]) * k), y = Math.round((cy + d * dir[1]) * k);
			if (x < 0 || x >= c.width || y < 0 || y >= c.height) { salida.push(null); continue; }
			const q = g.getImageData(x, y, 1, 1).data;
			salida.push([q[0], q[1], q[2]]);
		}
		return salida;
	}, [px, py, largo, paso, dir]);
}
const luz = (c) => Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
const satu = (c) => {
	const mx = Math.max(...c), mn = Math.min(...c);
	return mx === 0 ? 0 : Math.round(((mx - mn) / mx) * 100);
};

const pilotos = await p.evaluate(() => window.qa.componentesDePuerta());
console.log(`   pilotos: ${pilotos.map((q) => q.id).join(', ')}`);
const q0 = pilotos[Math.min(1, pilotos.length - 1)];
const { x, y, z } = q0.mundo;

/** Pone la cámara de frente al piloto a `d` mm y devuelve el píxel de su centro. */
async function deFrente(d) {
	await p.evaluate(([c]) => window.qa.verDesde(c), [{ x, y, z: z + d, tx: x, ty: y, tz: z }]);
	await p.waitForTimeout(220);
	return { cx: 1400 / 2, cy: 900 / 2 };
}

/*
 * ENERGIZAR MIRANDO EL ESTADO, no contando pulsaciones. La primera versión de esta prueba
 * alternaba el botón a ciegas y acabó etiquetando «encendido» la lámina del piloto apagado y al
 * revés: las fotos eran buenas y los pies de foto, mentira.
 */
async function energizar(quiero) {
	for (let i = 0; i < 3; i++) {
		const vivos = (await p.evaluate(() => window.qa.componentesDePuerta())).some((k) => k.encendido);
		if (vivos === quiero) return vivos;
		await p.evaluate(() => document.getElementById('btn-energizar')?.click());
		await p.waitForTimeout(2400);
	}
	return (await p.evaluate(() => window.qa.componentesDePuerta())).some((k) => k.encendido);
}
await energizar(true);
const encendidos = await p.evaluate(() => window.qa.componentesDePuerta());
console.log(`   encendidos: ${encendidos.filter((k) => k.encendido).length} de ${encendidos.length}`);
ok(encendidos.every((k) => k.encendido), `los ${encendidos.length} pilotos se encienden al energizar`);

{
	const { cx, cy } = await deFrente(120);
	// A 120 mm con lente de 22 mm, el radio de la lente cae sobre unos 105 px de pantalla.
	const serie = await perfil(cx, cy, 320, 8);
	const util = serie.filter(Boolean);
	console.log('   perfil radial (luz/saturación):');
	console.log('   ' + util.map((c, i) => `${i * 8}px:${luz(c)}/${satu(c)}`).join(' '));
	const centro = util[0];
	// El borde de la lente: el último punto antes de que empiece el aro negro.
	const borde = util.slice(6, 14).sort((a, c) => satu(c) - satu(a))[0];
	console.log(`   centro ${centro} luz ${luz(centro)} sat ${satu(centro)}%`);
	console.log(`   borde  ${borde} luz ${luz(borde)} sat ${satu(borde)}%`);
	ok(luz(centro) > 200, `el centro de la lente encendida está casi en blanco (luz ${luz(centro)})`);
	ok(satu(centro) < 35, `y desaturado, como una lámpara detrás del plástico (sat ${satu(centro)} %)`);
	ok(satu(borde) > satu(centro) + 15,
		`el borde conserva el color saturado (${satu(borde)} % contra ${satu(centro)} % del centro)`);
}

/* ---------------- 3. El resplandor sobre la chapa, y hasta dónde llega ---------------- */
{
	const { cx, cy } = await deFrente(320);
	/*
	 * SE MIDE HACIA ARRIBA. Los tres pilotos del ejemplo están en fila horizontal: barriendo a lo
	 * ancho, a partir de un cuarto de pantalla lo que se encuentra es el VECINO, y su resplandor
	 * se contaba como si fuera el de éste. Hacia arriba solo hay chapa.
	 *
	 * A 320 mm de la lente, un píxel de pantalla son 0,27 mm de puerta: el aro (Ø29,7) acaba
	 * sobre los 55 px y el disco del resplandor (R 34) sobre los 125.
	 */
	const conLuz = await perfil(cx, cy, 400, 10, [0, -1]);
	await energizar(false);
	const sinLuz = await perfil(cx, cy, 400, 10, [0, -1]);
	const salto = conLuz.map((c, i) => (c && sinLuz[i] ? luz(c) - luz(sinLuz[i]) : 0));
	console.log('   halo hacia arriba, apagado → encendido, cada 10 px: ' + salto.join(' '));
	const banda = (a, b) => salto.slice(a, b).reduce((m, v) => Math.max(m, v), 0);
	const enChapa = banda(6, 11);      //  60..100 px: la chapa justo alrededor del aro
	const medio = banda(11, 14);       // 110..130 px: el borde del resplandor
	const lejos = banda(17, 40);       // 170 px en adelante: media puerta
	ok(enChapa > 4, `la chapa de al lado se ilumina de verdad (+${enChapa})`);
	ok(medio < enChapa, `y va apagándose hacia fuera (+${enChapa} → +${medio})`);
	ok(lejos < 3, `a media puerta ya no llega nada (+${lejos})`);
	await energizar(true);
}

/* ---------------- 4. Los cinco colores ---------------- */
{
	const ids = pilotos.slice(0, Math.min(5, pilotos.length)).map((k) => k.id);
	const colores = ['rojo', 'verde', 'ambar', 'azul', 'blanco'];
	await p.evaluate(([ids, colores]) => {
		const pr = window.qa.proyecto();
		ids.forEach((id, i) => {
			const d = pr.dispositivos.find((k) => k.id === id);
			if (d) d.colorSenal = colores[i % colores.length];
		});
		window.qa.recalcular();
	}, [ids, colores]);
	await p.waitForTimeout(1200);
	const tras = await p.evaluate(() => window.qa.componentesDePuerta());
	console.log('   colores: ' + tras.map((k) => `${k.id}=${k.color}`).join(' '));
	const distintos = new Set(tras.slice(0, ids.length).map((k) => k.color));
	ok(distintos.size === Math.min(5, ids.length),
		`cada piloto conserva SU color, no el del vecino (${distintos.size} distintos de ${ids.length})`);
}

/* ---------------- 5. Las láminas ---------------- */
{
	const mira = { tx: x, ty: y, tz: z };
	const alrededor = (r) => [
		[`frente ${r}`, { x, y, z: z + r, ...mira }],
		[`tres cuartos`, { x: x - r * 0.6, y: y + r * 0.4, z: z + r * 0.68, ...mira }],
		[`de canto`, { x: x - r * 0.95, y: y + r * 0.08, z: z + r * 0.3, ...mira }],
	];
	for (const [etiq, encender] of [['apagado', false], ['encendido', true]]) {
		const vivo = await energizar(encender);
		ok(vivo === encender, `la lámina «${etiq}» se toma con los pilotos ${encender ? 'encendidos' : 'apagados'}`);
		await lamina(p, [...alrededor(75), ...alrededor(240)], { columnas: 3, celda: 460, archivo: `v-p22-${etiq}.png` });
		console.log(`   v-p22-${etiq}.png`);
	}
	// De lejos: los tres pilotos en su puerta, para juzgar la escala.
	const { A, H, P } = await p.evaluate(() => {
		const g = window.qa.proyecto().gabinete;
		return { A: g.caja?.ancho ?? g.ancho + 60, H: g.caja?.alto ?? g.alto + 60, P: g.caja?.profundidad ?? 160 };
	});
	await lamina(p, [
		['la puerta entera', { x: 0, y: 0, z: P + A * 1.35, tx: 0, ty: 0, tz: P / 2 }],
		['de tres cuartos', { x: A * 0.75, y: H * 0.28, z: P + A * 0.95, tx: 0, ty: 0, tz: P / 2 }],
		['rasante', { x: A * 1.25, y: H * 0.05, z: P + A * 0.32, tx: 0, ty: y, tz: P / 2 }],
	], { columnas: 3, celda: 460, archivo: 'v-p22-puerta.png' });
	console.log('   v-p22-puerta.png');

	// Y por detrás, con la puerta abierta: cuerpo, nervios, tuerca, bornes y la llegada del mazo.
	await puerta(p, 1);
	const tras = (await p.evaluate(() => window.qa.componentesDePuerta()))[Math.min(1, pilotos.length - 1)].mundo;
	const a = (-118 * Math.PI) / 180;
	const n = { x: -Math.sin(a), z: -Math.cos(a) };
	const detras = (d, dy = 0) => ({ x: tras.x + n.x * d, y: tras.y + dy, z: tras.z + n.z * d, tx: tras.x, ty: tras.y, tz: tras.z });
	await lamina(p, [
		['trasera de frente', detras(150)],
		['trasera en diagonal', detras(130, 80)],
		['trasera de cerca', detras(72, 24)],
	], { columnas: 3, celda: 460, archivo: 'v-p22-trasera.png' });
	console.log('   v-p22-trasera.png');
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close();
sv.close();
process.exit(0);
