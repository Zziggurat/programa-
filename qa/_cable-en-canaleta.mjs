/**
 * LA PRUEBA QUE PIDIÓ DIEGO: meter un cable en una canaleta A MANO y comprobar que ESTÁ dentro.
 *
 * No vale esconderlo ni pintarlo de otro color cuando pasa por el ducto. Lo que se comprueba aquí
 * es que la geometría del conductor cae dentro del volumen útil de la canaleta —entre las dos
 * paredes y por debajo de la tapa— y que sigue ahí después de que el router rehaga la ruta. Por eso
 * se leen los puntos del recorrido FINAL, el que se dibuja, y no los que el usuario tecleó.
 *
 * El guion es el del electricista: sacar el cable del borne, llevarlo a la boca de la canaleta,
 * meterlo, recorrerla por dentro y salir por otra abertura.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/canaleta';
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.setDefaultTimeout(60_000);
const er = []; p.on('pageerror', (e) => er.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(2).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);
// Es un ejemplo de solo lectura: hay que hacerlo propio para poder peinar cables.
await p.evaluate(() => document.getElementById('btn-copia-editable')?.click()).catch(() => {});
await p.waitForTimeout(600);

const canaletas = await p.evaluate(() => window.qa.proyecto().gabinete.canaletas.map((c) => ({ ...c })));
const can = canaletas.find((c) => c.orientacion === 'h') ?? canaletas[0];
console.log(`canaleta elegida: ${can.id} · ${can.orientacion} · x=${can.x} y=${can.y} largo=${can.largo} ancho=${can.ancho} alto=${can.alto}`);

// Un cable que hoy NO pasa por dentro de esa canaleta.
const cables = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => ({ id: c.id, seccion: c.seccion })));
const elegido = cables[0].id;
const antes = await qa('rutaDe', elegido);
console.log(`cable ${elegido}: ${antes.length} puntos, z de ${Math.min(...antes.map((q) => q.z))} a ${Math.max(...antes.map((q) => q.z))}`);

await qa('elegir', undefined);
await qa('ponerTapas', false);
/*
 * La cámara se centra EN LA CANALETA, no en el tablero entero.
 *
 * Con el encuadre general no se veía nada de lo que hay que juzgar: el ducto ocupaba treinta
 * píxeles y el cable dentro, dos. Para contestar «¿está el cable ahí dentro?» hay que mirar el
 * sitio donde está.
 */
const mirar = async (giro, alto, dist = 300) => {
	await qa('verDesde', {
		x: can.x + can.largo / 2 + Math.sin(giro) * dist,
		y: can.y + Math.sin(alto) * dist,
		z: can.alto / 2 + Math.cos(giro) * Math.cos(alto) * dist,
		tx: can.x + can.largo / 2, ty: can.y, tz: can.alto / 2,
	});
	await p.waitForTimeout(600);
};
const general = mirar;
await mirar(0.35, 0.45);
await p.screenshot({ path: join(SALIDA, '1-antes.png') });

/*
 * EL GUION: tres puntos. Entrar por una ranura, correr por dentro y salir por otra.
 *
 * Las coordenadas salen de la canaleta de verdad: el eje longitudinal a un cuarto y a tres cuartos
 * de su largo, la transversal en su centro y la profundidad dentro de su alto. `moverPuntoCable`
 * es la misma función que usa el ratón, así que si aquí encaja, encaja arrastrando.
 */
const ejeA = can.x + can.largo * 0.3;
const ejeB = can.x + can.largo * 0.7;
const centro = can.y;
const zDentro = Math.round(can.alto * 0.5);
const guion = [
	{ x: Math.round(ejeA), y: Math.round(centro), z: zDentro },
	{ x: Math.round((ejeA + ejeB) / 2), y: Math.round(centro), z: zDentro },
	{ x: Math.round(ejeB), y: Math.round(centro), z: zDentro },
];
for (let i = 0; i < guion.length; i++) {
	const idx = await qa('crearPuntoCable', elegido, guion[i].x, guion[i].y);
	const r = await qa('moverPuntoCable', elegido, idx, guion[i].x, guion[i].y, guion[i].z);
	console.log(`  punto ${i}: pedido (${guion[i].x}, ${guion[i].y}, ${guion[i].z}) → ${JSON.stringify(r?.punto)} · ${JSON.stringify(r?.pista)}`);
}

const trazado = await qa('trazadoDe', elegido);
const ruta = await qa('rutaDe', elegido);
console.log(`\ntrazado guardado: ${JSON.stringify(trazado)}`);

// ¿Cuánto del recorrido FINAL cae dentro del volumen útil de la canaleta?
const dentro = ruta.filter((q) =>
	q.x >= can.x && q.x <= can.x + can.largo
	&& Math.abs(q.y - can.y) <= can.ancho / 2
	&& q.z >= 2 && q.z <= can.alto);
console.log(`recorrido final: ${ruta.length} puntos, ${dentro.length} dentro del volumen de ${can.id}`);
console.log(`   z dentro: de ${Math.min(...dentro.map((q) => q.z))} a ${Math.max(...dentro.map((q) => q.z))} (la canaleta va de 2 a ${can.alto})`);

await mirar(0.35, 0.45);
await p.screenshot({ path: join(SALIDA, '2-dentro-sin-tapa.png') });
await qa('ponerTapas', true); await p.waitForTimeout(500);
await p.screenshot({ path: join(SALIDA, '3-dentro-con-tapa.png') });
await qa('ponerTapas', false); await p.waitForTimeout(400);
// Lateral: la vista que antes solo servía para mirar.
await mirar(1.45, 0.06, 260);
await p.screenshot({ path: join(SALIDA, '4-lateral-sin-tapa.png') });
await qa('ponerTapas', true); await p.waitForTimeout(500);
await p.screenshot({ path: join(SALIDA, '5-lateral-con-tapa.png') });

console.log(dentro.length >= 3 ? '\nOK: el cable está dentro de la canaleta de verdad' : '\nMAL: el cable no ha entrado');
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
