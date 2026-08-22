/** MIRAR LA APLICACIÓN COMO USUARIO: qué hay, dónde, cuánto scroll y qué cambia por espacio. */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, navegadorDelSistema, SALIDA } from './lib/mirar.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.setDefaultTimeout(120_000);
console.log(await abrirEjemplo(p, sv.address().port, 2));

const medir = async () => p.evaluate(() => {
	const v = (el) => el && el.offsetParent !== null;
	const izq = document.getElementById('panel-izq');
	const der = document.getElementById('panel-der');
	const barra = document.getElementById('barra');
	const lienzo = document.querySelector('canvas');
	const visibles = [...document.querySelectorAll('#barra button, #panel-izq button, #panel-izq input, #panel-izq select, #panel-der button, #panel-der input, #panel-der select')]
		.filter(v).map((e) => e.id || e.textContent.trim().slice(0, 22) || e.type);
	const secciones = [...document.querySelectorAll('#panel-izq > details')].filter(v)
		.map((d) => `${d.open ? '▼' : '▶'} ${d.querySelector('summary').textContent.trim().slice(0, 30)} (${Math.round(d.getBoundingClientRect().height)}px)`);
	return {
		izqScroll: izq.scrollHeight, izqAlto: izq.clientHeight,
		derVisible: der.style.display !== 'none', derScroll: der.scrollHeight,
		barraBotones: [...barra.querySelectorAll('button')].filter(v).length,
		lienzo: { w: lienzo.clientWidth, h: lienzo.clientHeight },
		tapado: Math.round(((izq.getBoundingClientRect().width + (der.style.display === 'none' ? 0 : der.getBoundingClientRect().width)) / innerWidth) * 100),
		controlesVisibles: visibles.length, secciones, visibles,
	};
});

for (const esp of ['interior', 'frontal', 'conjunto']) {
	await p.evaluate((e) => document.getElementById(`esp-${e}`)?.click(), esp);
	await p.waitForTimeout(900);
	const m = await medir();
	console.log(`\n=== ${esp.toUpperCase()} ===`);
	console.log(`   lienzo ${m.lienzo.w}×${m.lienzo.h} · paneles tapan el ${m.tapado} % del ancho`);
	console.log(`   panel izq: ${m.izqScroll} px de contenido en ${m.izqAlto} px de alto (${(m.izqScroll / m.izqAlto).toFixed(1)}× scroll)`);
	console.log(`   ${m.barraBotones} botones en la barra · ${m.controlesVisibles} controles visibles en total`);
	console.log('   secciones: ' + m.secciones.join(' | '));
	await p.screenshot({ path: join(SALIDA, `ux-${esp}.png`) });
}

// Con algo seleccionado, para ver el inspector.
await p.evaluate(() => document.getElementById('esp-interior')?.click());
await p.waitForTimeout(700);
// En Editor: en Trabajo el clic sobre un aparato empieza un cableado desde su borne, que es
// justo lo que ese modo tiene que hacer.
await p.evaluate(() => document.getElementById('hta-seleccionar')?.click());
await p.waitForTimeout(700);
// Se busca un aparato cuyo centro NO tenga un cable por delante: en el Editor los cables no se
// seleccionan, así que ahí el clic no elige nada y no sería culpa de la interfaz.
let idDisp;
for (const c of await p.evaluate(() => window.qa.proyecto().gabinete.colocaciones.map((k) => k.dispositivoId))) {
	const q = await p.evaluate((i) => window.qa.puntoDeImagen(i, 0, 0), c);
	if (!q) continue;
	const quien = await p.evaluate(([x, y]) => window.qa.queSeleccionaEnPixel(x, y), [q.x, q.y]);
	if (quien === `dispositivo:${c}`) { idDisp = c; break; }
}
const pt = await p.evaluate((i) => window.qa.puntoDeImagen(i, 0, 0), idDisp);
await p.mouse.click(pt.x, pt.y);
await p.waitForTimeout(600);
console.log(`   aparato elegido: ${idDisp} · seleccionado: ${JSON.stringify(await p.evaluate(() => window.qa.seleccion()))}`);
const m = await medir();
console.log(`\n=== con un aparato seleccionado ===`);
console.log(`   panel der visible ${m.derVisible} · ${m.derScroll} px · paneles tapan el ${m.tapado} %`);
console.log(`   panel izq: ${m.izqScroll} px de contenido`);
await p.screenshot({ path: join(SALIDA, 'ux-seleccion.png') });

// Modo Trabajo, para ver qué cambia.
await p.evaluate(() => document.getElementById('hta-conectar')?.click());
await p.waitForTimeout(800);
const t = await medir();
console.log(`\n=== herramienta CABLEAR ===`);
console.log('   secciones: ' + t.secciones.join(' | '));
console.log(`   ${t.controlesVisibles} controles visibles`);
await p.screenshot({ path: join(SALIDA, 'ux-trabajo.png') });

/* ---- Y a otros tamaños de pantalla ---- */
for (const [w, h] of [[2560, 1440], [1366, 768]]) {
	await p.setViewportSize({ width: w, height: h });
	await p.waitForTimeout(700);
	await p.evaluate(() => document.getElementById('hta-conectar')?.click());
	await p.waitForTimeout(500);
	const m = await medir();
	console.log(`\n=== ${w}×${h} (con el cajón de cables abierto) ===`);
	console.log(`   lienzo ${m.lienzo.w}×${m.lienzo.h} · paneles tapan el ${m.tapado} % del ancho`);
	console.log(`   ${m.barraBotones} botones visibles en la barra`);
	await p.screenshot({ path: join(SALIDA, `ux-${w}.png`) });
}
await p.setViewportSize({ width: 1920, height: 1080 });

writeFileSync(join(SALIDA, 'ux-controles.txt'), t.visibles.join('\n'));
console.log(`\n   lista completa en qa/capturas/ux-controles.txt`);
await b.close(); sv.close(); process.exit(0);
