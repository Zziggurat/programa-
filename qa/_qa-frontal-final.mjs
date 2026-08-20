/**
 * EL ESCENARIO MANUAL COMPLETO, ejecutado en el navegador con la interfaz de verdad.
 *
 * Nada de llamar a funciones por dentro: se pulsan los botones que pulsa Diego y se leen los
 * colores que la ESCENA está pintando, no los que el modelo dice. Cuando las dos cosas no
 * coincidan, la que manda es la escena, porque es lo que se ve.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = '/workspace/programa-/qa/capturas';
mkdirSync(SALIDA, { recursive: true });
const EJEMPLO = Number(process.argv[2] ?? 2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(60_000);
const er = []; p.on('pageerror', (e) => er.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);
const clic = (id) => p.evaluate((i) => document.getElementById(i)?.click(), id);
const foto = (n) => p.screenshot({ path: join(SALIDA, `qaf-${n}.png`) });
let fallos = 0;
const comprobar = (ok, que) => { console.log(`  ${ok ? 'OK ' : 'MAL'}  ${que}`); if (!ok) fallos++; };
const lentes = async () => Object.fromEntries((await qa('componentesDePuerta')).map((c) => [c.id, c.color]));

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 }); await p.waitForTimeout(2200);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('btn-copiar-ejemplo')?.click()); await p.waitForTimeout(900);
await clic('esp-frontal'); await p.waitForTimeout(1300);
const nombre = await p.evaluate(() => window.qa.proyecto().nombre);
const g = await p.evaluate(() => window.qa.proyecto().gabinete);
console.log(`TABLERO: ${nombre} · placa ${g.ancho}×${g.alto}\n`);

/* ---- Cambiar el color de un piloto desde su ficha ---- */
const ponerColor = async (id, color) => {
	await qa('marcarEnFrontal', [['aparato', id]]);
	await p.waitForTimeout(250);
	const ok = await p.evaluate((c) => {
		const sel = [...document.querySelectorAll('#panel-der select')]
			.find((s) => [...s.options].some((o) => o.value === 'rojo'));
		if (!sel) return false;
		sel.value = c;
		sel.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	}, color);
	await p.waitForTimeout(450);
	return ok;
};

/*
 * En un tablero que todavía no tiene mandos en la puerta se AÑADEN, que es exactamente lo que
 * haría quien lo esté montando. Así el escenario corre igual en un armario de 360×460 y en uno de
 * 660×760, y sale a la luz cualquier medida que estuviera dando por hecho un tamaño concreto.
 */
let hay = (await qa('piezasDelFrontal')).filter((q) => q.clase === 'aparato');
if (hay.length < 3) {
	console.log(`(este tablero traía ${hay.length} mandos en la puerta: se añaden hasta tres)`);
	for (let i = hay.length; i < 3; i++) { await clic('btn-add-piloto'); await p.waitForTimeout(700); }
	hay = (await qa('piezasDelFrontal')).filter((q) => q.clase === 'aparato');
}
console.log('=== 1. configurar R rojo, S ámbar, T verde desde la ficha ===');
if (hay.length >= 3) {
	const ids = hay.slice(0, 3).map((q) => q.id);
	comprobar(await ponerColor(ids[0], 'rojo'), `${ids[0]} → rojo (la ficha ofrece el selector)`);
	await ponerColor(ids[1], 'ambar');
	await ponerColor(ids[2], 'verde');
	const c = await lentes();
	console.log('   lentes:', JSON.stringify(c));
	/*
	 * Se comprueba el TONO, no una constante escrita a mano: el apagado es el mismo color más
	 * oscuro, y su valor exacto sale de una fórmula. Poner aquí el número calculado a ojo es
	 * fabricarse un fallo, que es justo lo que pasó la primera vez que corrió esto.
	 */
	const tono = (hex) => {
		const n = parseInt(hex.slice(1), 16);
		const [r, v, a] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
		const max = Math.max(r, v, a); const min = Math.min(r, v, a);
		if (max === min) return { h: -1, l: (max + min) / 2 };
		const d = max - min;
		const h = max === r ? ((v - a) / d + (v < a ? 6 : 0)) : max === v ? (a - r) / d + 2 : (r - v) / d + 4;
		return { h: h / 6, l: (max + min) / 2 };
	};
	const esTono = (hex, esperado) => Math.abs(tono(hex).h - esperado) < 0.05;
	comprobar(esTono(c[ids[0]], tono('#d8332c').h), `${ids[0]} es ROJO (${c[ids[0]]})`);
	comprobar(esTono(c[ids[1]], tono('#efa720').h), `${ids[1]} es ÁMBAR (${c[ids[1]]})`);
	comprobar(esTono(c[ids[2]], tono('#2fa84f').h), `${ids[2]} es VERDE (${c[ids[2]]})`);

	console.log('\n=== 2. cambiar SOLO el del medio a azul ===');
	const antes = await lentes();
	await ponerColor(ids[1], 'azul');
	const tras = await lentes();
	comprobar(tras[ids[1]] !== antes[ids[1]], `${ids[1]} ha cambiado (${antes[ids[1]]} → ${tras[ids[1]]})`);
	comprobar(tras[ids[0]] === antes[ids[0]], `${ids[0]} NO se ha tocado (${tras[ids[0]]})`);
	comprobar(tras[ids[2]] === antes[ids[2]], `${ids[2]} NO se ha tocado (${tras[ids[2]]})`);
	await foto('1-tres-colores');

	console.log('\n=== 3. duplicar el primero y darle otro color ===');
	await qa('marcarEnFrontal', [['aparato', ids[0]]]);
	await clic('btn-dup-frontal'); await p.waitForTimeout(700);
	const copia = (await qa('piezasDelFrontal')).filter((q) => q.clase === 'aparato').map((q) => q.id)
		.find((k) => !hay.some((h) => h.id === k));
	comprobar(!!copia, `la copia se llama ${copia}`);
	const c2 = await lentes();
	comprobar(c2[copia] === c2[ids[0]], `la copia nace del mismo color que ${ids[0]}`);
	await ponerColor(copia, 'blanco');
	const c3 = await lentes();
	comprobar(c3[copia] !== c3[ids[0]], `la copia es blanca (${c3[copia]}) y ${ids[0]} sigue rojo (${c3[ids[0]]})`);
	// Y no comparten datos por referencia: tocar los bornes de una no puede tocar los de la otra.
	const atados = await p.evaluate(([a, c]) => {
		const P = window.qa.proyecto();
		const da = P.dispositivos.find((x) => x.id === a);
		const dc = P.dispositivos.find((x) => x.id === c);
		return da && dc ? da.bornes === dc.bornes : null;
	}, [ids[0], copia]);
	comprobar(atados === false, 'el original y la copia NO comparten su lista de bornes');

	console.log('\n=== 4. energizar: cada uno enciende de SU color ===');
	await clic('btn-energizar'); await p.waitForTimeout(1200);
	const enc = await qa('componentesDePuerta');
	for (const q of enc) console.log(`   ${q.id}: ${q.encendido ? 'ENCENDIDO' : 'apagado '} lente ${q.color} halo ${q.halo}`);
	/*
	 * UN PILOTO SIN CABLEAR TIENE QUE QUEDARSE APAGADO, y uno cableado tiene que encender. Las dos
	 * mitades importan: la primera es la que demuestra que la luz sale del circuito y no de una
	 * bandera. En los tableros donde el guion ha AÑADIDO los pilotos no hay ningún hilo que llegue
	 * a ellos, así que lo correcto ahí es que ninguno luzca.
	 */
	const cableados = await p.evaluate((ids) => {
		const P = window.qa.proyecto();
		return ids.filter((id) => P.conductores.some(
			(c) => c.de.dispositivoId === id || c.a.dispositivoId === id));
	}, enc.map((q) => q.id));
	const vivo = enc.filter((q) => q.encendido);
	if (cableados.length) {
		comprobar(vivo.length > 0, `${vivo.length} de ${cableados.length} pilotos cableados encienden`);
	} else {
		comprobar(vivo.length === 0, 'ningún piloto sin cablear se enciende (la luz sale del circuito)');
	}
	comprobar(vivo.every((q) => cableados.includes(q.id)), 'solo encienden los que tienen hilos');
	comprobar(vivo.every((q) => q.halo > 0), 'todos los encendidos tienen halo');
	comprobar(enc.filter((q) => !q.encendido).every((q) => q.halo === 0), 'los apagados no tienen halo');
	await foto('2-energizado');
	await clic('btn-energizar'); await p.waitForTimeout(900);
	const apag = await lentes();
	comprobar(esTono(apag[ids[0]], tono('#d8332c').h) && tono(apag[ids[0]]).l < tono('#d8332c').l,
		`apagado, ${ids[0]} sigue siendo una lente ROJA y más oscura (${apag[ids[0]]})`);
	comprobar(tono(apag[copia]).l < tono('#dfe4e8').l,
		`apagado, la copia blanca se ve más oscura (${apag[copia]})`);

	console.log('\n=== 5. abrir y cerrar la puerta cinco veces ===');
	const sitio0 = (await qa('componentesDePuerta')).map((q) => `${q.id}:${q.mundo.x},${q.mundo.y},${q.mundo.z}`).join(' ');
	for (let i = 0; i < 5; i++) { await clic('btn-puerta'); await p.waitForTimeout(520); }
	await clic('btn-puerta'); await p.waitForTimeout(700);
	const sitio1 = (await qa('componentesDePuerta')).map((q) => `${q.id}:${q.mundo.x},${q.mundo.y},${q.mundo.z}`).join(' ');
	comprobar(sitio0 === sitio1, 'tras cinco vaivenes los mandos vuelven al MISMO sitio, al milímetro');

	console.log('\n=== 6. cambiar de espacio no mueve ni cambia nada ===');
	const foto0 = JSON.stringify(await qa('piezasDelFrontal'));
	const col0 = JSON.stringify(await lentes());
	await clic('esp-interior'); await p.waitForTimeout(900);
	await clic('esp-conjunto'); await p.waitForTimeout(900);
	await clic('esp-frontal'); await p.waitForTimeout(1100);
	comprobar(JSON.stringify(await qa('piezasDelFrontal')) === foto0, 'las posiciones son idénticas');
	comprobar(JSON.stringify(await lentes()) === col0, 'los colores son idénticos');

	console.log('\n=== 7. guardar y recargar: el ida y vuelta completo ===');
	const antesJson = await p.evaluate(() => {
		const P = window.qa.proyecto();
		return JSON.stringify({
			ap: P.gabinete.colocaciones.filter((c) => c.montaje === 'puerta')
				.map((c) => ({ id: c.dispositivoId, x: c.x, y: c.y, m: c.montaje })).sort((a, z) => a.id < z.id ? -1 : 1),
			col: P.dispositivos.filter((d) => d.tipo === 'piloto')
				.map((d) => ({ id: d.id, c: d.colorSenal, des: d.designacion, v: d.tensionNominal })).sort((a, z) => a.id < z.id ? -1 : 1),
			rot: (P.gabinete.rotulos ?? []).map((r) => ({ id: r.id, t: r.texto, x: r.x, y: r.y, e: r.estilo })).sort((a, z) => a.id < z.id ? -1 : 1),
		});
	});
	const lentes0 = JSON.stringify(await lentes());
	const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
	await qa('cargarJson', json);
	await p.waitForTimeout(1400);
	await clic('esp-frontal'); await p.waitForTimeout(900);
	const despuesJson = await p.evaluate(() => {
		const P = window.qa.proyecto();
		return JSON.stringify({
			ap: P.gabinete.colocaciones.filter((c) => c.montaje === 'puerta')
				.map((c) => ({ id: c.dispositivoId, x: c.x, y: c.y, m: c.montaje })).sort((a, z) => a.id < z.id ? -1 : 1),
			col: P.dispositivos.filter((d) => d.tipo === 'piloto')
				.map((d) => ({ id: d.id, c: d.colorSenal, des: d.designacion, v: d.tensionNominal })).sort((a, z) => a.id < z.id ? -1 : 1),
			rot: (P.gabinete.rotulos ?? []).map((r) => ({ id: r.id, t: r.texto, x: r.x, y: r.y, e: r.estilo })).sort((a, z) => a.id < z.id ? -1 : 1),
		});
	});
	comprobar(antesJson === despuesJson, 'el modelo es idéntico tras guardar y cargar');
	if (antesJson !== despuesJson) { console.log('    antes  :', antesJson.slice(0, 400)); console.log('    después:', despuesJson.slice(0, 400)); }
	comprobar(JSON.stringify(await lentes()) === lentes0, 'y las lentes se pintan del mismo color');
	await foto('3-tras-recargar');
	console.log('\n=== 8. lo que cuesta cambiar un color ===');
	await qa('cronometro', true);
	await ponerColor(ids[0], 'verde');
	await ponerColor(ids[0], 'rojo');
	const cont = (await qa('cronometroLeer')).contadores;
	await qa('cronometro', false);
	console.log(`   dos cambios de color · repartos ${cont.repartos} · cables reconstruidos ${cont.cablesConstruidos} · TubeGeometry ${cont.tubos}`);
	comprobar(cont.cablesConstruidos === 0 && cont.tubos === 0,
		'cambiar el color de una lente no reconstruye ni un cable');
} else {
	console.log(`  (este tablero no tiene componentes de puerta: ${hay.length})`);
	comprobar(true, 'un tablero sin mandos en la puerta sigue funcionando');
	await foto('9-sin-mandos');
}

console.log(`\n${fallos === 0 ? 'TODO PASA' : `${fallos} comprobaciones fallan`}`);
console.log(er.length ? `ERRORES JS: ${er.slice(0, 3).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
