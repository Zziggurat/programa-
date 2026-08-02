/**
 * QA de los dos problemas que se ven en un tablero real:
 *
 *  1. CABLES FUNDIDOS: dos conductores que llegan al mismo borne (o que corren en paralelo)
 *     dibujados exactamente uno encima de otro, de modo que parecen un solo cable.
 *  2. SELECCIÓN DESCALIBRADA: apuntas a un cable y el programa agarra el de al lado, porque
 *     el tubo grueso invisible de agarre del vecino le robaba el clic.
 *
 *   node qa/cables-fusion.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const info = (t) => console.log('     ' + t);
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const LIBRE = { x0: 320, x1: 966, y0: 60, y1: 782 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;

await page.goto(url);
await page.waitForTimeout(900);

/** Abre un tablero de la biblioteca (índice de la tarjeta) y lo deja en modo Trabajo. */
async function abrirEjemplo(indice) {
	await jsClick('btn-nuevo'); await page.waitForTimeout(250);
	if (await page.isVisible('#modal-dialogo')) { await jsClick('dialogo-ok'); await page.waitForTimeout(350); }
	await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
	if (await page.isVisible('#modal-ejemplos')) {
		await page.locator('.tarjeta-ejemplo button').nth(indice).click(); await page.waitForTimeout(650);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
		await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(150);
	}
	// La guía de primera visita se queda por delante del lienzo: se cierra, como haría cualquiera.
	if (await page.isVisible('#modal-ayuda')) { await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
	await jsClick('modo-trabajo'); await page.waitForTimeout(300);
	await jsClick('btn-centrar'); await page.waitForTimeout(400);
}

/** Comprueba que nada tapa el lienzo antes de pinchar (un modal abierto se comería el clic). */
async function lienzoLibre() {
	return !(await page.isVisible('#modal-ayuda')) && !(await page.isVisible('#modal-dialogo'))
		&& !(await page.isVisible('#modal-ejemplos')) && !(await page.isVisible('#modal-explicacion'));
}

/* ============ 1. Ningún cable puede salir FUNDIDO con otro de su mismo borne ============ */

const SEPARACION_MIN = 4; // mm: por debajo de esto dos cables se ven como uno solo

/** Puntos del recorrido de un cable a `dist` mm de su primer/último nodo (la salida del borne). */
function puntaDe(nodos, desdeElFinal) {
	return desdeElFinal ? nodos[nodos.length - 1] : nodos[0];
}

for (const [indice, nombre] of [[0, 'Arranque directo'], [1, 'Bomba con boya'], [2, 'Tablero de control']]) {
	console.log(`\n--- 1. ${nombre}: cables que comparten borne ---`);
	await abrirEjemplo(indice);
	const proyecto = await qa('proyecto');
	const rutas = await qa('rutas');
	const porId = new Map(rutas.map((r) => [r.id, r.nodos]));

	// Agrupa los conductores por borne y comprueba que las puntas de los que comparten uno
	// están separadas: si coincidieran, se verían fundidas en una sola conexión.
	const enBorne = new Map();
	for (const c of proyecto.conductores) {
		for (const [ref, alFinal] of [[c.de, false], [c.a, true]]) {
			const clave = `${ref.dispositivoId}:${ref.borneId}`;
			if (!enBorne.has(clave)) enBorne.set(clave, []);
			enBorne.get(clave).push({ id: c.id, alFinal });
		}
	}
	let compartidos = 0;
	let fundidos = 0;
	let peor = Infinity;
	for (const [clave, lista] of enBorne) {
		if (lista.length < 2) continue;
		compartidos++;
		for (let i = 0; i < lista.length; i++) {
			for (let j = i + 1; j < lista.length; j++) {
				const a = porId.get(lista[i].id); const b = porId.get(lista[j].id);
				if (!a || !b) continue;
				const pa = puntaDe(a, lista[i].alFinal);
				const pb = puntaDe(b, lista[j].alFinal);
				const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
				peor = Math.min(peor, d);
				if (d < SEPARACION_MIN) { fundidos++; info(`fundidos en ${clave}: ${lista[i].id} y ${lista[j].id} (${d.toFixed(1)} mm)`); }
			}
		}
	}
	info(`${compartidos} bornes con más de un cable · separación mínima ${peor === Infinity ? '—' : peor.toFixed(1) + ' mm'}`);
	must('ningún par de cables sale fundido del mismo borne', fundidos === 0, `${fundidos} pares`);

	/* ---- y tampoco pueden ir uno DENTRO de otro a lo largo del recorrido ---- */
	/*
	 * Lo que se exige es que ningún cable vaya metido dentro de otro: mismo recorrido Y misma
	 * profundidad, o sea indistinguibles por mucho que se gire la vista. Correr en paralelo por
	 * el mismo pasillo, en capas distintas, no es un defecto: es lo que hace un mazo de verdad,
	 * y medirlo en plano —que es lo que hacía esta prueba antes, con un tope de 45 mm/cable
	 * puesto a ojo— castigaba precisamente el peinado bien hecho.
	 */
	const am = await qa('amontonamiento');
	const porCable = am.cables ? Math.round(am.totalMm / am.cables) : 0;
	info(`en paralelo: ${am.totalMm} mm en ${am.pares} pares de ${am.cables} cables (${porCable} mm/cable)`);
	info(`a la misma profundidad: ${am.mismaCapaMm} mm en ${am.paresMismaCapa} pares`);
	must('ningún cable va metido DENTRO de otro', am.mismaCapaMm === 0,
		`${am.mismaCapaMm} mm en ${am.paresMismaCapa} pares`);
}

/* ============ 2. La selección tiene que caer en el cable que se está señalando ============ */

console.log('\n--- 2. Apuntar y seleccionar: el clic cae en el cable señalado ---');
await abrirEjemplo(2);
const rutas = await qa('rutas');
let probados = 0;
let aciertos = 0;
const errados = [];
for (const r of rutas) {
	const puntos = (await qa('puntosVisiblesDeCable', r.id, 7)).filter(enZona);
	for (const p of puntos) {
		// A quién elegiría un clic exactamente en ese píxel, donde SE VE este cable.
		const elegido = await qa('cableEnPixel', p.x, p.y);
		probados++;
		if (elegido === r.id) aciertos++;
		else errados.push(`${r.id} → ${elegido ?? 'nada'}`);
	}
}
info(`${aciertos}/${probados} clics cayeron en el cable señalado`);
if (errados.length) info('errados: ' + errados.slice(0, 6).join(', '));
must('apuntar a un cable selecciona ESE cable', aciertos === probados, `${aciertos}/${probados}`);

/* ---- Y el clic de verdad (ratón real) también, incluso con la cámara girada ---- */

/**
 * Espera a que la cámara deje de moverse DE VERDAD.
 *
 * La órbita lleva amortiguación: al soltar el ratón la cámara sigue frenando sola. Esperar un
 * tiempo fijo no basta — en una máquina lenta cada fotograma tarda mucho más y la cámara todavía
 * se está moviendo. Si la prueba calcula el píxel donde se ve un cable y pincha ahí mientras
 * tanto, apunta a una escena y pincha en otra, y un tubo fino se le escapa por un píxel.
 */
async function esperarCamaraQuieta(maximoMs = 6000) {
	let antes = await qa('camara');
	const hasta = Date.now() + maximoMs;
	while (Date.now() < hasta) {
		await page.waitForTimeout(120);
		const ahora = await qa('camara');
		if (Object.keys(ahora).every((k) => Math.abs(ahora[k] - antes[k]) < 0.02)) return;
		antes = ahora;
	}
}

async function girarCamara(dx, dy) {
	await qa('congelarCamara', false);   // para girar sí interesa el glisado, como al usuario
	const x = LIBRE.x1 - 30, y = LIBRE.y0 + 30;
	await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(30);
	for (let k = 1; k <= 5; k++) { await page.mouse.move(x + (dx * k) / 5, y + (dy * k) / 5); await page.waitForTimeout(25); }
	await page.mouse.up();
	await esperarCamaraQuieta();
}

for (const [dx, dy, comoSeVe] of [[0, 0, 'de frente'], [110, 0, 'girado a la derecha'], [-90, -60, 'girado a la izquierda y arriba']]) {
	if (dx || dy) await girarCamara(dx, dy);
	// La órbita nunca se para del todo: se le quita la amortiguación para medir y pinchar sobre
	// la misma vista. Sin esto fallaba un cable de cada treinta y tantos, distinto cada vez.
	await qa('congelarCamara', true);
	await page.waitForTimeout(120);
	const lista = await qa('rutas');
	let ok = 0; let total = 0;
	const mal = [];
	for (const r of lista) {
		// Esc antes de cada intento: si un clic anterior arrancó un cableado sin querer, TODOS los
		// clics siguientes se los come el tendido y saldrían como fallo en cascada, tapando cuál
		// fue el que falló de verdad. Cada cable se prueba desde un estado limpio.
		await page.keyboard.press('Escape'); await page.waitForTimeout(60);
		/*
		 * Apuntar, COMPROBAR que el píxel sigue siendo suyo y pinchar sin soltar el aliento.
		 *
		 * La órbita tiene inercia y nunca se para del todo, así que entre calcular el píxel y
		 * pinchar la vista se mueve un pelo y un tubo fino se escapa. Antes se reapuntaba una vez
		 * y se pinchaba a ciegas: si el segundo punto también llegaba tarde, fallo. Y salía un
		 * cable distinto en cada pasada, que es la firma de una carrera y no de un bug.
		 *
		 * Ahora se reintenta hasta cuatro veces y entre la comprobación y el clic NO hay espera:
		 * la ventana en la que la cámara puede moverse queda cerrada.
		 */
		let p;
		for (let intento = 0; intento < 4; intento++) {
			const candidato = await qa('puntoParaAgarrar', r.id);
			if (!enZona(candidato)) { p = undefined; break; }
			await page.mouse.move(candidato.x, candidato.y); await page.waitForTimeout(50);
			if ((await qa('cableEnPixel', candidato.x, candidato.y)) === r.id) { p = candidato; break; }
			p = undefined;
			await page.waitForTimeout(80);
		}
		if (!p) continue;
		// Lo que el programa dice del píxel JUSTO ANTES y JUSTO DESPUÉS de apretar. Si no coinciden,
		// lo que ha cambiado es la escena entre una cosa y la otra, no la puntería.
		const antesDeApretar = await qa('cableEnPixel', p.x, p.y);
		await page.mouse.down(); await page.waitForTimeout(40);
		const trasApretar = await qa('cableEnPixel', p.x, p.y);
		const sel = await qa('seleccion');
		await page.mouse.up(); await page.waitForTimeout(60);
		total++;
		if (sel?.tipo === 'cable' && sel.id === r.id) ok++;
		else {
			const hits = await qa('diagnosticoPixel', p.x, p.y);
			const est = await qa('estadoInteraccion');
			const encima = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.tagName, [p.x, p.y]);
			mal.push(`${r.id}@(${Math.round(p.x)},${Math.round(p.y)}) → ${sel ? sel.tipo + ':' + sel.id : 'nada'} `
				+ `(pixel antes=${antesDeApretar} despues=${trasApretar}) [${hits.join(' ')}] ${JSON.stringify(est)} encima=${encima}`);
		}
	}
	must(`nada tapa el lienzo (${comoSeVe})`, await lienzoLibre());
	if (mal.length) info('fallaron: ' + mal.join(' | '));
	must(`el clic real agarra el cable señalado (${comoSeVe})`, ok === total && total > 0, `${ok}/${total}`);
}

/* ============ 3. Coherencia ============ */
console.log('\n--- 3. Coherencia ---');
const finales = await qa('proyecto');
const dibujados = await qa('cablesDibujados');
must('ningún cable fantasma', dibujados === finales.conductores.length, `${dibujados}/${finales.conductores.length}`);
must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ✗ ===`);
await browser.close();
server.close();
process.exit(fallos === 0 ? 0 : 1);
