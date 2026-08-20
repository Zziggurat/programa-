/**
 * LA PUERTA COMO PIEZA FÍSICA, no como animación.
 *
 * Cinco aperturas miradas desde arriba y en tres cuartos —que es donde se vería atravesar la
 * chapa—, más las medidas que no se pueden juzgar a ojo: que lo montado en la hoja se mueva como
 * un sólido rígido, que ciclar abrir/cerrar devuelva todo al mismo milímetro, y que pasear por
 * los espacios de trabajo no mueva nada.
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
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		A: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		H: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
		P: g.caja?.profundidad ?? 160,
	};
});
console.log(`${nombre} — armario ${A}×${H}×${P}`);

/* ---- 1. Las cinco aperturas, vistas desde donde se vería el destrozo ---- */
const pasos = [0, 0.25, 0.5, 0.75, 1];
const cenital = [];
const tresCuartos = [];
for (const t of pasos) {
	await puerta(p, t);
	cenital.push([`${t * 100}% desde arriba`, { x: 0, y: A * 1.5, z: P + 40, tx: -A * 0.15, ty: 0, tz: P * 0.3 }]);
	tresCuartos.push([`${t * 100}% en tres cuartos`, { x: -A * 1.1, y: H * 0.35, z: P + A * 0.95, tx: -A * 0.2, ty: 0, tz: P * 0.4 }]);
}
// Se rehacen las tomas una a una porque cada una necesita su ángulo de puerta.
async function laminaPorApertura(camaras, archivo) {
	const tomas = [];
	for (let i = 0; i < pasos.length; i++) {
		await puerta(p, pasos[i]);
		tomas.push(camaras[i]);
		await p.evaluate((c) => window.qa.verDesde(c), camaras[i][1]);
		await p.waitForTimeout(140);
	}
	// lamina() vuelve a recorrer las cámaras, así que se repite el barrido sincronizando puerta.
	const png = [];
	for (let i = 0; i < pasos.length; i++) {
		await puerta(p, pasos[i]);
		await p.evaluate((c) => window.qa.verDesde(c), camaras[i][1]);
		await p.waitForTimeout(140);
		png.push([camaras[i][0], await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'))]);
	}
	const hoja = await p.evaluate(async ([tomas, columnas, celda]) => {
		const filas = Math.ceil(tomas.length / columnas);
		const alto = Math.round(celda * 0.68), pie = 22;
		const h = document.createElement('canvas');
		h.width = columnas * celda; h.height = filas * (alto + pie);
		const c = h.getContext('2d');
		c.fillStyle = '#101214'; c.fillRect(0, 0, h.width, h.height);
		for (let i = 0; i < tomas.length; i++) {
			const img = new Image();
			await new Promise((r) => { img.onload = r; img.src = tomas[i][1]; });
			const cx = (i % columnas) * celda, cy = Math.floor(i / columnas) * (alto + pie);
			c.drawImage(img, cx, cy, celda, alto);
			c.strokeStyle = '#2a2e33'; c.strokeRect(cx + 0.5, cy + 0.5, celda - 1, alto - 1);
			c.fillStyle = '#cfd4d9'; c.font = '13px monospace';
			c.fillText(tomas[i][0], cx + 8, cy + alto + 15);
		}
		return h.toDataURL('image/png');
	}, [png, 3, 470]);
	const { writeFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { SALIDA } = await import('./lib/mirar.mjs');
	writeFileSync(join(SALIDA, archivo), Buffer.from(hoja.split(',')[1], 'base64'));
	console.log(`  ${archivo}`);
}
await laminaPorApertura(cenital, 'v-puerta-cenital.png');
await laminaPorApertura(tresCuartos, 'v-puerta-tres-cuartos.png');

/* ---- 2. Sólido rígido: las distancias entre lo montado no cambian ---- */
const posiciones = {};
for (const t of pasos) {
	await puerta(p, t);
	posiciones[t] = await p.evaluate(() => window.qa.componentesDePuerta().map((q) => q.fino));
}
if (posiciones[0].length >= 2) {
	const dist = (a, b2) => Math.hypot(a.x - b2.x, a.y - b2.y, a.z - b2.z);
	const base = dist(posiciones[0][0], posiciones[0][1]);
	let peor = 0;
	for (const t of pasos) peor = Math.max(peor, Math.abs(dist(posiciones[t][0], posiciones[t][1]) - base));
	ok(peor < 0.02, `la distancia entre dos piezas de la puerta no cambia al abrir (peor ${peor.toFixed(4)} mm)`);
} else {
	console.log('    (menos de dos piezas montadas: no se puede medir el sólido rígido)');
}

/* ---- 3. Ciclos: abrir y cerrar cinco veces devuelve al mismo sitio ---- */
await puerta(p, 0);
const cerrada0 = await p.evaluate(() => window.qa.componentesDePuerta().map((q) => q.mundo));
for (let i = 0; i < 5; i++) {
	await p.evaluate(() => document.getElementById('btn-puerta')?.click());
	await p.waitForTimeout(900);
	await p.evaluate(() => document.getElementById('btn-puerta')?.click());
	await p.waitForTimeout(900);
}
await puerta(p, 0);
const cerrada5 = await p.evaluate(() => window.qa.componentesDePuerta().map((q) => q.mundo));
const deriva = cerrada0.length
	? Math.max(...cerrada0.map((q, i) => Math.hypot(q.x - cerrada5[i].x, q.y - cerrada5[i].y, q.z - cerrada5[i].z)))
	: 0;
ok(deriva < 0.6, `cinco ciclos de puerta no dejan deriva (peor ${deriva.toFixed(2)} mm)`);

/* ---- 4. Espacios de trabajo: ir y volver no mueve nada ---- */
/*
 * Y se mide DONDE ESTÁ LA PIEZA EN LA PUERTA, no dónde cae en la escena. Cada espacio de trabajo
 * deja la puerta a un ángulo distinto —el interior la abre, el frontal la cierra—, así que las
 * coordenadas de mundo cambian a propósito: la primera versión de esta prueba las comparaba y
 * acusaba al editor de mover los pilotos 347 mm cuando lo único que había pasado es que la puerta
 * se había abierto. Lo que no puede cambiar es la posición de la pieza SOBRE la hoja.
 */
const enLaHoja = () => p.evaluate(() => window.qa.piezasDelFrontal()
	.map((q) => `${q.tipo}:${q.id}@${q.x},${q.y}`).join(' | '));
const hojaAntes = await enLaHoja();
const espacios = ['esp-frontal', 'esp-interior', 'esp-conjunto', 'esp-frontal'];
const camaras = [];
for (const id of espacios) {
	await p.evaluate((i) => document.getElementById(i)?.click(), id);
	await p.waitForTimeout(700);
	camaras.push(await p.evaluate(() => window.qa.camaraAhora()));
}
const hojaDespues = await enLaHoja();
ok(hojaAntes === hojaDespues, 'pasear por los espacios no mueve ninguna pieza sobre la hoja');
if (hojaAntes !== hojaDespues) console.log(`     antes:   ${hojaAntes}\n     después: ${hojaDespues}`);
ok(
	JSON.stringify(camaras[0]) === JSON.stringify(camaras[3]),
	`volver al frontal recupera la misma cámara: ${JSON.stringify(camaras[0].pos)} vs ${JSON.stringify(camaras[3].pos)}`,
);
console.log('   cámaras:', camaras.map((c) => `${c.espacio} ${c.pos.x},${c.pos.y},${c.pos.z}`).join(' | '));

/* ---- 5. Escala y orientación: la hoja no crece ni se tuerce ---- */
const escalas = {};
for (const t of pasos) {
	await puerta(p, t);
	escalas[t] = await p.evaluate(() => {
		const q = window.qa.componentesDePuerta();
		return q.length >= 2 ? Math.hypot(q[0].mundo.x - q[1].mundo.x, q[0].mundo.y - q[1].mundo.y, q[0].mundo.z - q[1].mundo.z) : 0;
	});
}
console.log('   separación entre las dos primeras piezas por apertura:',
	pasos.map((t) => `${t * 100}%=${escalas[t].toFixed(2)}`).join(' '));

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
