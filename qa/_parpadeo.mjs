/**
 * ¿DE DÓNDE SALE EL MOTEADO NEGRO/BLANCO? Z-FIGHTING O SHADOW ACNE.
 *
 * A ojo se parecen: manchas que aparecen y desaparecen al girar la cámara. Distinguirlos discutiendo
 * no lleva a ningún sitio, así que se apaga una cosa cada vez y se vuelve a medir EL MISMO recorrido
 * de cámara. Cuatro configuraciones:
 *
 *   sombras ON  + marcas ON   ← lo que se ve hoy
 *   sombras OFF + marcas ON   ← si baja mucho, era el mapa de sombras
 *   sombras ON  + marcas OFF  ← si baja mucho, eran los planos de serigrafía
 *   sombras OFF + marcas OFF  ← el suelo: lo que quede es de la geometría misma
 *
 *   node qa/_parpadeo.mjs [carpeta] [ejemplo]
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = '/workspace/programa-/app/dist';
const SALIDA = process.argv[2] ?? '/tmp/parpadeo';
const EJEMPLO = Number(process.argv[3] ?? 2);
mkdirSync(SALIDA, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const sv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = join(RAIZ, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; } r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f)); });
await new Promise((r) => sv.listen(0, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.setDefaultTimeout(60_000);
const er = []; p.on('pageerror', (e) => er.push(e.message));
const qa = (fn, ...a) => p.evaluate(([f, ar]) => window.qa[f](...ar), [fn, a]);

await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if (await p.isVisible('#modal-dialogo')) { await p.evaluate(() => document.getElementById('dialogo-ok')?.click()); await p.waitForTimeout(500); await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600); }
await p.locator('.tarjeta-ejemplo button').nth(EJEMPLO).click({ timeout: 120_000 }); await p.waitForTimeout(2000);
for (const [m, bt] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) { if (await p.isVisible(m)) { await p.evaluate((i) => document.getElementById(i)?.click(), bt); await p.waitForTimeout(700); } }
await p.evaluate(() => document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);

console.log('profundidad de cámara:', JSON.stringify(await qa('profundidadCamara')));
const disp = await p.evaluate(() => window.qa.proyecto().dispositivos.map((d) => ({ id: d.id, tipo: d.tipo })));

/**
 * Un abanico de cámaras casi iguales alrededor de un aparato. El giro entre toma y toma es de
 * DÉCIMAS de grado: lo justo para que un artefacto cambie de sitio y la geometría no.
 */
function abanico(centro, radio, giro0, alto0, pasos = 6, paso = 0.0004) {
	const out = [];
	for (let i = 0; i < pasos; i++) {
		const g = giro0 + i * paso, a = alto0 + i * paso * 0.4;
		out.push({
			x: centro.x + Math.sin(g) * radio, y: centro.y + Math.sin(a) * radio,
			z: centro.z + Math.cos(g) * Math.cos(a) * radio,
			tx: centro.x, ty: centro.y, tz: centro.z,
		});
	}
	return out;
}

/*
 * No hace falta barrer los trece aparatos: leer el framebuffer entero por cada toma es lo caro, y
 * con SwiftShader (sin GPU) un barrido completo no termina. Se cogen los sospechosos —los que
 * tienen carcasa clara, que es donde Diego vio las manchas— más un par de contraste.
 */
const zonas = [];
for (const d of disp.slice(0, 4)) {
	const c = await qa('bulto', d.id);
	if (c) zonas.push({ id: d.id, tipo: d.tipo, centro: { x: c.x, y: c.y, z: c.z }, radio: Math.max(90, c.radio * 3.2) });
}

/*
 * Los cuatro estados se consiguen con DOS interruptores baratos: el sesgo del mapa de sombras
 * (un uniform) y la visibilidad de los planos de serigrafía. Apagar las sombras del todo obliga a
 * recompilar todos los shaders, y sobre SwiftShader el barrido no termina.
 *
 * Un `normalBias` de 3 mm separa la muestra tanto que el acne no puede sobrevivir; si el moteado
 * sigue ahí con ese sesgo, el negro NO viene de las sombras.
 */
/*
 * CONTROL DE PASO CERO: la cámara no se mueve entre tomas.
 *
 * Sin esto la medida no vale nada. Con un giro de medio grado la imagen se desplaza varios
 * píxeles, y un borde que cruza un píxel cuenta como «salto grande en zona lisa» exactamente igual
 * que un artefacto: la primera pasada dio 20.000 por millón en TODAS las configuraciones, que es
 * lo que sale cuando lo que se está midiendo es el movimiento y no el parpadeo. Con la cámara
 * quieta el resultado tiene que ser CERO; si no lo es, el número no mide lo que dice medir.
 */
const CONFIG = [
	['tal cual                ', async () => { await qa('sesgoSombra', 0.22); await qa('marcas3d', true); await qa('grano', { mapa: true, repeticion: 26, anisotropia: 1 }); }],
	['sin sombras (sesgo 3)   ', async () => { await qa('sesgoSombra', 3.0); }],
	['sin serigrafia          ', async () => { await qa('sesgoSombra', 0.22); await qa('marcas3d', false); }],
	['sin mapa de rugosidad   ', async () => { await qa('marcas3d', true); await qa('grano', { mapa: false }); }],
	['grano con anisotropia 16', async () => { await qa('grano', { mapa: true, anisotropia: 16 }); }],
	['grano sin repetir (1x)  ', async () => { await qa('grano', { mapa: true, repeticion: 1, anisotropia: 1 }); }],
];

console.log('\nmoteado por millón de píxeles comparados (más alto = más parpadeo)\n');
console.log('zona           ' + ['quieta', ...CONFIG.map((c) => c[0])].join(' | '));
const acumulado = new Map(CONFIG.map((c) => [c[0], 0]));
const peores = [];
for (const z of zonas) {
	const quieta = abanico(z.centro, z.radio, 0.34, 0.20, 4, 0);
	const control = (await qa('medirMoteado', quieta)).porMillon;
	const cams = abanico(z.centro, z.radio, 0.34, 0.20);
	const fila = [control];
	for (const [nombre, poner] of CONFIG) {
		await poner();
		await p.waitForTimeout(200);
		const r = await qa('medirMoteado', cams);
		fila.push(r.porMillon);
		acumulado.set(nombre, acumulado.get(nombre) + r.porMillon);
	}
	peores.push({ id: z.id, tipo: z.tipo, base: fila[0], fila });
	console.log(`${(z.id + ' (' + z.tipo + ')').padEnd(14)} ` + fila.map((v) => String(v).padStart(6)).join(' | '));
}
console.log('\nTOTAL              ' + CONFIG.map((c) => String(acumulado.get(c[0])).padStart(6)).join(' | '));

// La zona que más parpadea, fotografiada desde dos ángulos casi iguales.
peores.sort((a, b) => b.base - a.base);
const peor = peores[0];
if (peor) {
	console.log(`\nla zona que más parpadea: ${peor.id} (${peor.tipo}) con ${peor.base} por millón`);
	const z = zonas.find((x) => x.id === peor.id);
	await CONFIG[0][1]();
	const cams = abanico(z.centro, z.radio, 0.34, 0.20, 4, 0.02);
	for (let i = 0; i < cams.length; i++) {
		await qa('verDesde', cams[i]); await p.waitForTimeout(350);
		await p.screenshot({ path: join(SALIDA, `peor-${peor.id}-angulo${i}.png`) });
	}
}
console.log(er.length ? `ERRORES: ${er.slice(0, 2).join(' | ')}` : 'sin errores de JavaScript');
await b.close(); sv.close();
