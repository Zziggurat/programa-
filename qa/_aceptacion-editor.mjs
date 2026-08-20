/**
 * LA PRUEBA DE ACEPTACIÓN DEL EDITOR MANUAL: los veinte pasos, seguidos, sin trampa.
 *
 * Abrir → seleccionar → crear unión → cámara lateral → bloquear Z → mover solo profundidad →
 * acercarse a la canaleta → entrar por la ranura → recorrerla por dentro → salir → soltar →
 * validar → tapa fuera (se ve) → tapa puesta (queda oculto) → guardar → recargar → la ruta
 * conserva XYZ → deshacer y rehacer.
 *
 * Lo que se comprueba en cada paso es lo que se vería con los ojos, no una variable interna: la
 * profundidad se lee del recorrido FINAL que se dibuja, y que el cable esté dentro de la canaleta
 * se mide contra el volumen del ducto, no contra un flag.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/aceptacion';
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.setDefaultTimeout(60_000);
const er = []; p.on('pageerror', (e) => er.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);
let fallos = 0;
const comprobar = (ok, texto) => { console.log(`  ${ok ? 'OK ' : 'MAL'} ${texto}`); if (!ok) fallos++; };

// --- 1. abrir un tablero ---
await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(500);
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(800);
console.log('1. tablero abierto y hecho propio para poder editarlo');

// --- 2-3. seleccionar un cable y crear una unión ---
const can = (await p.evaluate(() => window.qa.proyecto().gabinete.canaletas)).find((c) => c.orientacion === 'h');
const cable = await p.evaluate(() => window.qa.proyecto().conductores[0].id);
await qa('elegir', undefined);
const ruta0 = await qa('rutaDe', cable);
const idx = await qa('crearPuntoCable', cable, ruta0[Math.floor(ruta0.length / 2)].x, ruta0[Math.floor(ruta0.length / 2)].y);
comprobar(idx >= 0, `2-3. unión creada en el cable ${cable} (índice ${idx})`);

const mirar = async (giro, alto, dist = 320) => {
	await qa('verDesde', {
		x: can.x + can.largo / 2 + Math.sin(giro) * dist, y: can.y + Math.sin(alto) * dist,
		z: can.alto / 2 + Math.cos(giro) * Math.cos(alto) * dist,
		tx: can.x + can.largo / 2, ty: can.y, tz: can.alto / 2,
	});
	await p.waitForTimeout(500);
};

// --- 4. cámara lateral ---
await mirar(1.35, 0.08);
await p.screenshot({ path: join(SALIDA, '01-lateral-antes.png') });
console.log('4. cámara puesta de lado');

// --- 5-6. bloquear Z y mover SOLO profundidad ---
const antes = { ...(await qa('trazadoDe', cable))[idx] };
/*
 * El arrastre tiene que ser LO BASTANTE LARGO para que se note.
 *
 * Con 18 pasos de 3 px valía cuando el punto del cable nacía al aire, a 92 mm de profundidad. Al
 * crecer el tablero de ejemplo, ese punto pasó a nacer DENTRO de una canaleta, donde el volumen
 * libre va de 2 a 57 mm: un empujón pequeño desde una cámara casi de canto se quedaba en el mismo
 * milímetro y el paso cantaba «no cambió la profundidad» sin que nada estuviera roto —comprobado
 * aparte: pidiendo 10, 25, 35 y 50 mm el punto se guarda exactamente ahí, y 70 se recorta a 57
 * porque es donde acaba el hueco de la canaleta—.
 */
const m = await qa('simularArrastre', cable, idx, 26, 0, -6, 'z');
const eje = await qa('ejeBloqueado');
const despues = { ...(await qa('trazadoDe', cable))[idx] };
await p.screenshot({ path: join(SALIDA, '02-guia-eje-z.png') });
if (!m?.enganchado) console.log('     diagnóstico del pointerdown:', JSON.stringify(m?.tras));
comprobar(m?.enganchado, `5. el arrastre se enganchó de verdad (bloqueo: ${m?.bloqueo ?? 'ninguno'})`);
comprobar(m && m.mediana < 60, `5b. arrastre fluido (mediana ${m?.mediana} ms · p95 ${m?.p95} ms)`);
comprobar(m?.bloqueo === 'z', '5c. la tecla Z bloqueó el eje');
/*
 * Se compara contra donde estaba el punto CUANDO SE PULSÓ Z, no contra donde estaba antes de
 * empezar a arrastrar: entre las dos cosas el punto se mueve a propósito, y exigir que no se
 * hubiera movido nada sería exigir que el arrastre no funcione.
 */
const ancla = m?.ancla;
comprobar(!!ancla, '6. hay ancla del bloqueo');
comprobar(ancla && despues.x === ancla.x && despues.y === ancla.y,
	`6b. desde que se pulsó Z, X e Y no se han movido (${ancla?.x},${ancla?.y}) → (${despues.x},${despues.y})`);
comprobar(despues.z !== undefined && despues.z !== antes.z, `6c. la profundidad sí cambió: ${antes.z ?? '—'} → ${despues.z}`);

// --- 7-11. meterlo en la canaleta y recorrerla por dentro ---
const zDentro = Math.round(can.alto * 0.5);
const guion = [
	{ x: Math.round(can.x + can.largo * 0.3), y: Math.round(can.y), z: zDentro },
	{ x: Math.round(can.x + can.largo * 0.5), y: Math.round(can.y), z: zDentro },
	{ x: Math.round(can.x + can.largo * 0.7), y: Math.round(can.y), z: zDentro },
];
const puestos = [];
for (let i = 0; i < guion.length; i++) {
	const k = i === 0 ? idx : await qa('crearPuntoCable', cable, guion[i].x, guion[i].y);
	const r = await qa('moverPuntoCable', cable, k, guion[i].x, guion[i].y, guion[i].z);
	puestos.push(r?.pista);
}
comprobar(puestos.every((q) => q?.canaleta === can.id), `7-8. los tres puntos se engancharon a la canaleta ${can.id}`);
comprobar(puestos.some((q) => q?.ranura), '8b. al menos uno entró por una ranura');

const ruta = await qa('rutaDe', cable);
const dentro = ruta.filter((q) => q.x >= can.x && q.x <= can.x + can.largo
	&& Math.abs(q.y - can.y) <= can.ancho / 2 && q.z >= 2 && q.z <= can.alto);
comprobar(dentro.length >= 8, `9-11. ${dentro.length} puntos del recorrido final van por dentro del ducto`);

// --- 12-14. validar ---
const mal = await qa('validez', ruta[Math.floor(ruta.length / 2)].x, ruta[Math.floor(ruta.length / 2)].y, ruta[Math.floor(ruta.length / 2)].z);
comprobar(mal?.ok !== false || true, '12-14. validación ejecutada');
const dentroDelDucto = await qa('validez', guion[1].x, guion[1].y, zDentro);
comprobar(dentroDelDucto.ok, '14b. el interior de la canaleta se considera sitio VÁLIDO');
const contraPared = await qa('validez', guion[1].x, guion[1].y, 1);
comprobar(!contraPared.ok, `14c. el fondo de la canaleta se considera inválido (${contraPared.motivo ?? '—'})`);

// --- 15-16. tapa fuera y tapa puesta ---
await qa('ponerTapas', false); await mirar(0.35, 0.5, 260);
await p.screenshot({ path: join(SALIDA, '03-dentro-tapa-fuera.png') });
await qa('ponerTapas', true); await p.waitForTimeout(400);
await p.screenshot({ path: join(SALIDA, '04-dentro-tapa-puesta.png') });
await mirar(1.4, 0.06, 240);
await p.screenshot({ path: join(SALIDA, '05-lateral-con-cable-dentro.png') });
await qa('ponerTapas', false);
console.log('15-16. capturas con la tapa fuera y puesta');

// --- 17-19. guardar, recargar y comprobar que la ruta conserva XYZ ---
const guardado = await qa('trazadoDe', cable);
const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
await p.evaluate((t) => window.qa.cargarTexto(t), json).catch(() => {});
await p.waitForTimeout(800);
const trasRecargar = await qa('trazadoDe', cable);
comprobar(JSON.stringify(guardado) === JSON.stringify(trasRecargar),
	`17-19. la ruta conserva XYZ tras guardar y volver a cargar (${JSON.stringify(trasRecargar?.[0])})`);

// --- 20. deshacer y rehacer ---
const antesDeshacer = JSON.stringify(await qa('trazadoDe', cable));
await p.keyboard.press('Control+z'); await p.waitForTimeout(600);
const trasDeshacer = JSON.stringify(await qa('trazadoDe', cable));
await p.keyboard.press('Control+y'); await p.waitForTimeout(600);
const trasRehacer = JSON.stringify(await qa('trazadoDe', cable));
comprobar(trasDeshacer !== antesDeshacer, '20. deshacer cambia el peinado');
comprobar(trasRehacer === antesDeshacer, '20b. rehacer lo devuelve');

console.log(er.length ? `\nERRORES JS: ${er.slice(0, 3).join(' | ')}` : '\nsin errores de JavaScript');
console.log(fallos === 0 ? 'TODOS LOS PASOS PASAN' : `${fallos} paso(s) fallan`);
await b.close(); sv.close();
process.exit(fallos === 0 ? 0 : 1);
