/**
 * CORROBORACIÓN VISUAL DEL ARMARIO, cámaras nuevas.
 *
 * Nueve puntos de vista —frente, los dos tres cuartos, el lateral de bisagras, el del cierre,
 * cenital, contrapicado, cerca y lejos— con la puerta cerrada, a medio abrir y abierta del todo,
 * y en tres tamaños de armario muy distintos. Sale una lámina de contactos por tamaño y
 * apertura, que es lo que se puede mirar de verdad.
 *
 * Uso: node qa/_v-armario.mjs [ejemplo]
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

/** Cambia el tamaño de la caja por la MISMA ficha que usa el usuario, en centímetros. */
async function medida(anchoCm, altoCm, fondoCm) {
	await p.evaluate(() => document.getElementById('modo-editor')?.click());
	await p.waitForTimeout(300);
	await p.evaluate(([a, h, f]) => {
		const poner = (id, v) => {
			const e = document.getElementById(id);
			e.value = String(v);
			e.dispatchEvent(new Event('input', { bubbles: true }));
		};
		poner('caja-ancho', a); poner('caja-alto', h); poner('caja-prof', f);
		document.getElementById('aplicar-dim').click();
	}, [anchoCm, altoCm, fondoCm]);
	await p.waitForTimeout(1200);
	await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
	await p.waitForTimeout(600);
	/*
	 * La caja NUNCA es más pequeña que su placa: el modelo la agranda si hace falta. Pedir
	 * 30 × 40 cm con una placa de 38 × 58 devuelve un armario de 39 × 59, y si la prueba coloca
	 * las cámaras con la medida PEDIDA en vez de con la real, se mete dentro del armario y
	 * fotografía cables creyendo que fotografía chapa. Aquí se lee la medida que de verdad se
	 * dibuja.
	 */
	return p.evaluate(() => {
		const g = window.qa.proyecto().gabinete;
		return {
			ancho: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
			alto: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
			profundidad: g.caja?.profundidad ?? 160,
			pedida: g.caja,
		};
	});
}

function camaras(caja) {
	const { ancho: A, alto: H, profundidad: P } = caja;
	const d = Math.max(A, H) * 1.5;      // distancia de trabajo
	const lejos = Math.min(d * 2.6, 5600);
	const zc = P / 2 - 11;               // centro del armario en profundidad
	const mira = { tx: 0, ty: 0, tz: zc };
	return [
		['frente', { x: 0, y: 0, z: d + P, ...mira }],
		['3/4 izquierdo (bisagras)', { x: -d * 0.72, y: H * 0.30, z: d * 0.78, ...mira }],
		['3/4 derecho (cierre)', { x: d * 0.72, y: H * 0.30, z: d * 0.78, ...mira }],
		['lateral bisagras', { x: -d * 1.05, y: 0, z: zc + 40, ...mira }],
		['lateral cierre', { x: d * 1.05, y: 0, z: zc + 40, ...mira }],
		['cenital', { x: 0, y: d * 1.0, z: zc + 90, ...mira }],
		['contrapicado', { x: 0, y: -d * 0.92, z: zc + 120, ...mira }],
		['cerca: cierre y canto', { x: A * 0.30, y: 0, z: P + 200, tx: A * 0.42, ty: 0, tz: P * 0.5 }],
		// La órbita del usuario no pasa de 6 m: mirar desde más lejos que eso es mirar algo que
		// nadie puede ver, y además saca el armario del plano lejano de la cámara.
		['lejos', { x: -lejos * 0.68, y: H * 0.3, z: lejos * 0.72, ...mira }],
	];
}

const tamanos = [
	['pequeno', 30, 40, 15],
	['mediano', 60, 80, 21],
	['grande', 120, 200, 30],
];

for (const [etiqueta, a, h, f] of tamanos) {
	const caja = await medida(a, h, f);
	console.log(`\n== ${etiqueta}: real ${caja.ancho}×${caja.alto}×${caja.profundidad} mm `
		+ `(pedida ${caja.pedida?.ancho}×${caja.pedida?.alto}) ==`);
	for (const [nom, t] of [['cerrada', 0], ['media', 0.5], ['abierta', 1]]) {
		await puerta(p, t);
		const ruta = await lamina(p, camaras(caja), {
			columnas: 3, celda: 470, archivo: `v-armario-${etiqueta}-${nom}.png`,
		});
		console.log(`  ${nom}: ${ruta.split('/').pop()}`);
	}
}

console.log(errores.length ? `\nERRORES JS: ${errores.join(' | ')}` : '\nsin errores de JavaScript');
await b.close();
sv.close();
