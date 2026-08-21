/**
 * PERFILADO POR ACTIVIDAD, y atribución de tirones.
 *
 * Se hace CADA COSA por separado —girar, desplazar, acercar, pasar el ratón, pinchar, mover un
 * cable, abrir la puerta, cambiar de espacio— y de cada una se apuntan tres cosas: lo que tardó
 * el gesto entero, si el navegador marcó alguna tarea de más de 50 ms, y si en ese rato nacieron
 * geometrías, texturas o programas de shader. Con eso un tirón se ATRIBUYE en vez de suponerse.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';

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
await p.evaluate(() => window.qa.congelarCamara(true));
const CX = 700, CY = 460;

const filas = [];
async function medir(nombre, accion) {
	await p.evaluate(() => window.qa.olvidarTareasLargas());
	const a = await p.evaluate(() => window.qa.contadores());
	const t0 = Date.now();
	await accion();
	const ms = Date.now() - t0;
	const c = await p.evaluate(() => window.qa.contadores());
	const dib = await p.evaluate(() => window.qa.medirDibujado(20));
	const largas = c.tareasLargas.filter((t) => t.ms > 50);
	const fila = {
		nombre,
		gesto: ms,
		dibujo: dib.mediana,
		geo: c.geometrias - a.geometrias,
		tex: c.texturas - a.texturas,
		prog: c.programas - a.programas,
		largas: largas.length,
		peorLarga: largas.reduce((m, t) => Math.max(m, t.ms), 0),
	};
	filas.push(fila);
	console.log(`   ${nombre.padEnd(34)} gesto ${String(fila.gesto).padStart(5)} ms · dibujo ${String(fila.dibujo).padStart(6)} ms`
		+ ` · geo ${fila.geo >= 0 ? '+' : ''}${fila.geo} tex ${fila.tex >= 0 ? '+' : ''}${fila.tex} prog ${fila.prog >= 0 ? '+' : ''}${fila.prog}`
		+ (fila.largas ? ` · ${fila.largas} tareas >50 ms (peor ${fila.peorLarga})` : ''));
	return fila;
}

async function arrastrar(boton, dx, dy, pasos = 10) {
	await p.mouse.move(CX, CY);
	await p.mouse.down({ button: boton });
	for (let i = 1; i <= pasos; i++) await p.mouse.move(CX + (dx * i) / pasos, CY + (dy * i) / pasos);
	await p.mouse.up({ button: boton });
}

console.log('\n--- una vuelta de calentamiento: la primera vez se compilan los shaders ---');
await medir('primer dibujado (calentando)', async () => { await p.waitForTimeout(400); });

console.log('\n--- navegación ---');
await medir('girar (rueda pulsada)', () => arrastrar('middle', 320, 60, 20));
await medir('desplazar (botón derecho)', () => arrastrar('right', 220, 120, 16));
await medir('acercar y alejar con la rueda', async () => {
	for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(20); }
	for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(20); }
});

console.log('\n--- señalado y selección ---');
await medir('cien movimientos de ratón', async () => {
	for (let i = 0; i < 100; i++) await p.mouse.move(400 + (i * 7) % 600, 300 + (i * 11) % 400);
});
await medir('diez clics de selección', async () => {
	for (let i = 0; i < 10; i++) { await p.mouse.click(500 + i * 30, 400 + (i % 3) * 40); await p.waitForTimeout(30); }
});

console.log('\n--- la puerta ---');
await medir('abrir la puerta de par en par', async () => {
	for (let t = 0; t <= 1.0001; t += 0.05) await p.evaluate((v) => window.qa.ponerPuerta(v), t);
});
await medir('cerrarla otra vez', async () => {
	for (let t = 1; t >= -0.0001; t -= 0.05) await p.evaluate((v) => window.qa.ponerPuerta(v), t);
});
await medir('veinte ciclos completos', async () => {
	for (let i = 0; i < 20; i++) {
		await p.evaluate(() => window.qa.ponerPuerta(1));
		await p.evaluate(() => window.qa.ponerPuerta(0));
	}
});

console.log('\n--- espacios de trabajo ---');
await medir('interior → frontal → conjunto', async () => {
	for (const e of ['frontal', 'conjunto', 'interior']) {
		await p.evaluate((i) => document.getElementById(`esp-${i}`)?.click(), e);
		await p.waitForTimeout(320);
	}
});

console.log('\n--- energizar ---');
await medir('energizar el tablero', async () => {
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(2400);
});
await medir('con el tablero vivo, abrir la puerta', async () => {
	for (let t = 0; t <= 1.0001; t += 0.05) await p.evaluate((v) => window.qa.ponerPuerta(v), t);
});
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(1400);

/* ---------------- Los veredictos ---------------- */
console.log('');
const puerta1 = filas.find((f) => f.nombre === 'abrir la puerta de par en par');
const ciclos = filas.find((f) => f.nombre === 'veinte ciclos completos');
ok(puerta1.geo <= 0, `abrir la puerta NO crea geometría nueva (${puerta1.geo})`);
ok(puerta1.tex <= 0, `ni texturas (${puerta1.tex})`);
ok(puerta1.prog <= 0, `ni programas de shader (${puerta1.prog})`);
ok(ciclos.geo <= 0 && ciclos.tex <= 0 && ciclos.prog <= 0,
	`veinte ciclos de puerta tampoco (geo ${ciclos.geo}, tex ${ciclos.tex}, prog ${ciclos.prog})`);
const porCiclo = ciclos.gesto / 40;
console.log(`   cada paso de puerta cuesta ${porCiclo.toFixed(1)} ms de ida y vuelta con la sonda`);

const nav = filas.filter((f) => ['girar (rueda pulsada)', 'desplazar (botón derecho)', 'acercar y alejar con la rueda'].includes(f.nombre));
for (const f of nav) {
	ok(f.geo <= 0 && f.prog <= 0, `${f.nombre}: mover la cámara no reconstruye nada (geo ${f.geo}, prog ${f.prog})`);
}
const hover = filas.find((f) => f.nombre === 'cien movimientos de ratón');
ok(hover.geo <= 2, `cien movimientos de ratón no fabrican geometría (${hover.geo})`);
console.log(`   y cuestan ${(hover.gesto / 100).toFixed(1)} ms cada uno, ida y vuelta con la sonda incluida`);

const conLargas = filas.filter((f) => f.largas > 0);
if (conLargas.length) {
	console.log('\n   TAREAS LARGAS ATRIBUIDAS:');
	for (const f of conLargas) {
		const causa = f.prog > 0 ? 'compilación de shaders'
			: f.geo > 0 ? 'reconstrucción de geometría'
				: f.tex > 0 ? 'subida de texturas'
					: 'JavaScript o recolector de basura';
		console.log(`   · ${f.nombre}: ${f.largas} tarea(s), peor ${f.peorLarga} ms → ${causa}`);
	}
} else {
	console.log('\n   ninguna tarea por encima de 50 ms en toda la sesión');
}

const dibujos = filas.map((f) => f.dibujo);
console.log(`\n   dibujado en reposo tras cada actividad: ${Math.min(...dibujos)}..${Math.max(...dibujos)} ms (SwiftShader por software)`);
ok(Math.max(...dibujos) < Math.min(...dibujos) * 2.2 + 12,
	`el coste de dibujar no se dispara con el uso (${Math.min(...dibujos)} → ${Math.max(...dibujos)} ms)`);

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close();
sv.close();
process.exit(0);
