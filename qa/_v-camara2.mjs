/**
 * EL NUEVO ESQUEMA DE CÁMARA, con el ratón: izquierdo corto selecciona, izquierdo arrastrado
 * gira, derecho desplaza, rueda acerca. Y lo importante: tras girar, al soltar NO se selecciona.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, navegadorDelSistema } from './lib/mirar.mjs';

const EN_GATE = process.argv.includes('--gate');

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
await p.evaluate(() => document.getElementById('esp-interior')?.click());
await p.waitForTimeout(800);
await p.evaluate(() => window.qa.congelarCamara(true));
const orbita = () => p.evaluate(() => window.qa.orbita());
const sel = () => p.evaluate(() => window.qa.seleccion());
const gr = (r) => (r * 180) / Math.PI;

/* ---- El reparto de botones ---- */
{
	const o = await orbita();
	ok(o.botones.izq === 0, `el izquierdo GIRA (acción ${o.botones.izq})`);
	ok(o.botones.der === 2, `el derecho DESPLAZA (acción ${o.botones.der})`);
	ok(o.botones.medio === 0, `la rueda pulsada sigue girando, como alias (${o.botones.medio})`);
	ok(!Number.isFinite(o.topes.azMax), 'y el azimut sigue sin topes');
}

/**
 * Un aparato de placa CON SITIO A SU DERECHA, y su píxel, con la cámara puesta de frente.
 *
 * No vale cualquiera: los tres contactores están pegados unos a otros, así que moverlos un
 * centímetro los hace chocar y el editor los devuelve a su sitio —que es lo correcto y lo que
 * hace otra prueba—. Aquí lo que se comprueba es el GESTO, así que hace falta uno que quepa.
 */
const elegido = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	const cols = g.colocaciones.filter((k) => k.montaje !== 'puerta');
	/*
	 * SITIO LIBRE A LOS DOS LADOS, Y CONTANDO EL BORDE DE LA PLACA.
	 *
	 * La primera versión miraba solo el hueco a la derecha y solo hasta el vecino, así que
	 * elegía el aparato MÁS A LA DERECHA de todos —cuyo hueco llegaba hasta el infinito— y
	 * resultaba ser el que ya estaba tocando el canto: el editor recorta la posición al ancho de
	 * la placa, o sea que arrastrarlo a la derecha no podía moverlo ni un milímetro. La prueba
	 * decía «el arrastre no llega al aparato» cuando lo que pasaba es que el aparato no tenía
	 * adónde ir.
	 */
	let mejor = { id: cols[0].dispositivoId, sitio: -1, hacia: 1 };
	for (const c of cols) {
		const vecinos = cols.filter((k) => k !== c && Math.abs(k.y - c.y) < c.alto * 0.6);
		/*
		 * Y EL CARRIL TAMBIÉN ES UN TOPE. Un aparato pegado a un riel no se sale de él por mucho
		 * hueco que quede a su lado: el editor lo recorta a los extremos del perfil. Contando
		 * solo los vecinos y el canto de la placa, la prueba elegía un contactor que tenía
		 * trescientos milímetros «libres» y no se movía ni uno, porque su riel acababa ahí.
		 */
		const riel = (g.rieles ?? []).find((r) => r.id === c.rielId);
		/*
		 * Y UN APARATO EN CARRIL VERTICAL NO SE MUEVE EN HORIZONTAL, punto: el imantado le clava
		 * la x al eje del perfil. Tirando de él a la derecha no se mueve ni un milímetro, y eso
		 * es lo correcto —está atornillado a un riel— pero no sirve para probar el gesto. Se
		 * descarta al elegir, en vez de descubrirlo midiendo cero.
		 */
		if (riel?.orientacion === 'v') continue;
		const topeDer = riel ? Math.min(g.ancho, riel.x + riel.largo) : g.ancho;
		const topeIzq = riel ? Math.max(0, riel.x) : 0;
		const der = vecinos.filter((k) => k.x > c.x)
			.reduce((m, k) => Math.min(m, k.x - (c.x + c.ancho)), topeDer - (c.x + c.ancho));
		const izq = vecinos.filter((k) => k.x < c.x)
			.reduce((m, k) => Math.min(m, c.x - (k.x + k.ancho)), c.x - topeIzq);
		for (const [sitio, hacia] of [[der, 1], [izq, -1]]) {
			if (sitio > mejor.sitio) mejor = { id: c.dispositivoId, sitio, hacia };
		}
	}
	return mejor;
});
const quien = elegido.id;
console.log(`   se prueba con ${quien}: ${Math.round(elegido.sitio)} mm libres hacia `
	+ (elegido.hacia > 0 ? 'la derecha' : 'la izquierda'));
const bulto = await p.evaluate((i) => window.qa.bulto(i), quien);
async function deFrente() {
	await p.evaluate((k) => window.qa.verDesde({ x: k.x, y: k.y, z: k.z + 620, tx: k.x, ty: k.y, tz: k.z }), bulto);
	await p.waitForTimeout(260);
	return p.evaluate((i) => window.qa.puntoDeImagen(i, 0, 0), quien);
}
const donde = () => p.evaluate((i) => {
	const c = window.qa.proyecto().gabinete.colocaciones.find((k) => k.dispositivoId === i);
	return { x: c.x, y: c.y };
}, quien);

/* ---- 1. Clic corto sobre un aparato: selecciona ---- */
{
	const pix = await deFrente();
	await p.mouse.click(pix.x, pix.y);
	await p.waitForTimeout(250);
	ok((await sel())?.id === quien, `un clic corto selecciona el aparato (${JSON.stringify(await sel())})`);
}

/* ---- 2. Clic con temblor dentro del umbral: sigue seleccionando y no mueve ---- */
{
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(600);
	const pix = await deFrente();
	await p.evaluate(() => window.qa.congelarCamara(true));
	const antes = await orbita();
	const sitio = await donde();
	await p.mouse.move(pix.x, pix.y);
	await p.mouse.down();
	await p.mouse.move(pix.x + 2, pix.y + 1);
	await p.mouse.move(pix.x + 3, pix.y + 2);
	await p.mouse.up();
	await p.waitForTimeout(250);
	const desp = await orbita();
	const giro = Math.abs(gr(desp.azimut - antes.azimut));
	ok((await sel())?.id === quien, 'con tres píxeles de temblor sigue siendo un clic');
	/*
	 * La cámara SÍ acompaña al puntero desde el primer píxel —es lo que hace que girar se sienta
	 * directo y no a saltos— así que tres píxeles de temblor mueven la vista un grado escaso. Lo
	 * que el umbral decide no es si la cámara se mueve, sino qué pasa AL SOLTAR.
	 */
	ok(giro < 2, `y la vista apenas se ha movido (${giro.toFixed(2)}°)`);
	const s2 = await donde();
	ok(s2.x === sitio.x && s2.y === sitio.y, 'y el aparato no se ha movido');
}

/* ---- 3. Arrastre claro desde el vacío: gira y NO selecciona ---- */
{
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(600);
	await p.evaluate(() => window.qa.verDesde({ x: 0, y: 0, z: 1600, tx: 0, ty: 0, tz: 70 }));
	await p.waitForTimeout(300);
	// Se selecciona algo primero, para poder ver que girar NO lo cambia.
	const pix = await p.evaluate((i) => window.qa.puntoDeImagen(i, 0, 0), quien);
	await p.mouse.click(pix.x, pix.y);
	await p.waitForTimeout(250);
	const antesSel = await sel();
	const antes = await orbita();
	await p.mouse.move(700, 450);
	await p.mouse.down();
	for (let i = 1; i <= 10; i++) await p.mouse.move(700 + i * 24, 450 + i * 3);
	await p.mouse.up();
	await p.waitForTimeout(250);
	const desp = await orbita();
	const giro = Math.abs(gr(desp.azimut - antes.azimut));
	console.log(`   el arrastre giró ${giro.toFixed(1)}°`);
	ok(giro > 15, `arrastrar con el izquierdo GIRA la cámara (${giro.toFixed(1)}°)`);
	ok(JSON.stringify(await sel()) === JSON.stringify(antesSel),
		`y al soltar NO cambia la selección (${JSON.stringify(await sel())})`);
}

/* ---- 4. Arrastre que empieza ENCIMA de un aparato y acaba en otro sitio ---- */
{
	await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
	await p.waitForTimeout(700);
	const pix = await deFrente();
	await p.evaluate(() => window.qa.congelarCamara(true));
	const antes = await orbita();
	const antesSel = await sel();
	await p.mouse.move(pix.x, pix.y);
	await p.mouse.down();
	for (let i = 1; i <= 10; i++) await p.mouse.move(pix.x + i * 22, pix.y + i * 2);
	await p.mouse.up();
	await p.waitForTimeout(250);
	const giro = Math.abs(gr((await orbita()).azimut - antes.azimut));
	ok(giro > 10, `en Trabajo, arrastrar desde encima de un aparato gira (${giro.toFixed(1)}°)`);
	ok(JSON.stringify(await sel()) === JSON.stringify(antesSel), 'y no cambia la selección');
}

/* ---- 5. En Editor, arrastrar un aparato lo MUEVE y no gira ---- */
{
	// En el INTERIOR, que es donde se mueven los aparatos: en Conjunto el arrastre no aplica.
	await p.evaluate(() => document.getElementById('esp-interior')?.click());
	await p.waitForTimeout(700);
	await p.evaluate(() => document.getElementById('modo-editor')?.click());
	await p.waitForTimeout(700);
	const pix = await deFrente();
	await p.evaluate(() => window.qa.congelarCamara(true));
	// Primero se ELIGE —esa es la regla: se arrastra lo que ya está elegido— y después se mueve
	// hacia el lado por donde tiene sitio.
	await p.mouse.click(pix.x, pix.y);
	await p.waitForTimeout(250);
	console.log(`   aparato ${quien} · píxel ${pix.x},${pix.y} · elegiría `
		+ await p.evaluate(([x, y]) => window.qa.queSeleccionaEnPixel(x, y), [pix.x, pix.y])
		+ ` · seleccionado ${JSON.stringify(await sel())}`);
	const antes = await orbita();
	const sitio = await donde();
	await p.mouse.move(pix.x, pix.y);
	await p.mouse.down();
	/*
	 * Y SE TIRA LARGO. Un contactor imanta al carril en pasos de módulo, así que un tirón de
	 * setenta píxeles —unos cuarenta milímetros a esta distancia— se redondeaba a la misma
	 * ranura y el aparato se quedaba clavado en su sitio: la prueba decía «no se mueve» cuando
	 * lo que pasaba era que se movía menos de un escalón del imantado.
	 */
	for (let i = 1; i <= 16; i++) await p.mouse.move(pix.x + elegido.hacia * i * 12, pix.y);
	/*
	 * SE MIRA CON EL BOTÓN TODAVÍA APRETADO, y no después de soltar.
	 *
	 * Al soltar manda el editor: corre el aparato al hueco libre más cercano si se ha encimado
	 * con el vecino, y lo devuelve a su sitio si no cabe. Eso está bien y lo comprueban
	 * `_v-picking` y `_v-editor`. Lo que esta prueba tiene que saber es a QUIÉN fue el gesto, y
	 * eso se ve mientras el gesto está pasando: si el aparato se está moviendo, el arrastre es
	 * suyo y no de la cámara.
	 */
	const enVuelo = await donde();
	await p.mouse.up();
	await p.waitForTimeout(350);
	const s2 = await donde();
	const giro = Math.abs(gr((await orbita()).azimut - antes.azimut));
	console.log(`   ${sitio.x} → (arrastrando ${enVuelo.x}) → ${s2.x}`);
	// A quién fue el gesto: al aparato, y no a la cámara. Las dos cosas, o no prueba nada.
	ok(enVuelo.x !== sitio.x, `en Editor, arrastrar lo elegido lo mueve a él (${sitio.x} → ${enVuelo.x} mm)`);
	ok(giro < 0.5, `y la cámara se queda quieta (${giro.toFixed(2)}°)`);
	await p.keyboard.press('Control+z');
	await p.waitForTimeout(400);
}

/* ---- 6. Derecho: desplaza ---- */
{
	const antes = await p.evaluate(() => window.qa.camaraAhora());
	await p.mouse.move(700, 450);
	await p.mouse.down({ button: 'right' });
	for (let i = 1; i <= 8; i++) await p.mouse.move(700 - i * 18, 450 + i * 6);
	await p.mouse.up({ button: 'right' });
	await p.waitForTimeout(250);
	const desp = await p.evaluate(() => window.qa.camaraAhora());
	const d = Math.hypot(desp.mira.x - antes.mira.x, desp.mira.y - antes.mira.y, desp.mira.z - antes.mira.z);
	ok(d > 10, `el botón derecho desplaza la vista (${d.toFixed(0)} mm)`);
}

/* ---- 7. Dos vueltas completas, arriba y abajo ---- */
if (!EN_GATE) {
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(700);
	await p.evaluate(() => window.qa.congelarCamara(true));
	/*
	 * SIN NADA ELEGIDO. La regla del programa es que se arrastra lo que ya está elegido, así que
	 * si el aparato de la sección anterior sigue seleccionado y ha quedado bajo el punto desde el
	 * que se tira, el gesto va a él y la cámara no se mueve: la prueba medía 129° donde tenía que
	 * medir dos vueltas. Lo que se comprueba aquí es la órbita, y se comprueba con la mano libre.
	 */
	await p.evaluate(() => window.qa.elegir(undefined));
	await p.waitForTimeout(300);
	let anterior = (await orbita()).azimut;
	let total = 0;
	const arriba = [];
	// Se gira desde una esquina VACÍA del lienzo: con la regla de «se arrastra lo elegido» el
	// centro también giraría, pero desde el vacío la prueba no depende de qué haya en medio.
	for (let i = 0; i < 16; i++) {
		await p.mouse.move(700, 450);
		await p.mouse.down();
		for (let k = 1; k <= 4; k++) await p.mouse.move(700 + k * 90, 450);
		await p.mouse.up();
		const o = await orbita();
		let d = o.azimut - anterior;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		total += d; anterior = o.azimut;
		arriba.push(o.arriba.y);
	}
	console.log(`   giro acumulado ${gr(total).toFixed(0)}°`);
	ok(Math.abs(gr(total)) > 720, `dos vueltas completas con el izquierdo (${gr(total).toFixed(0)}°)`);
	ok(arriba.every((y) => y > 0.99), 'sin voltear la cámara');
	const polares = [];
	for (let i = 0; i < 6; i++) {
		await p.mouse.move(700, 450);
		await p.mouse.down();
		for (let k = 1; k <= 3; k++) await p.mouse.move(700, 450 - k * 90);
		await p.mouse.up();
		polares.push((await orbita()).polar);
	}
	for (let i = 0; i < 12; i++) {
		await p.mouse.move(700, 450);
		await p.mouse.down();
		for (let k = 1; k <= 3; k++) await p.mouse.move(700, 450 + k * 90);
		await p.mouse.up();
		polares.push((await orbita()).polar);
	}
	console.log(`   vertical ${gr(Math.min(...polares)).toFixed(0)}° .. ${gr(Math.max(...polares)).toFixed(0)}°`);
	ok(gr(Math.min(...polares)) < 10 && gr(Math.max(...polares)) > 170, 'se llega al techo y al suelo');
} else {
	console.log('SKIP diagnóstico manual: dos vueltas completas y barrido polar extremo');
}

/* ---- 8. F y O ---- */
{
	// Se vuelve a Interior y se descongela: la sección anterior dejó la cámara dando vueltas en
	// Conjunto, y desde ahí el aparato puede quedar fuera de imagen.
	await p.evaluate(() => document.getElementById('esp-interior')?.click());
	await p.waitForTimeout(700);
	await p.evaluate(() => window.qa.congelarCamara(true));
	await p.evaluate(() => document.querySelector('canvas').focus());
	const pixq = await deFrente();
	if (!pixq) {
		fallos.push('el aparato de prueba no cae en la imagen para F/O');
		console.log(`MAL  no se localiza ${quien} en pantalla · colocaciones `
			+ await p.evaluate(() => window.qa.proyecto().gabinete.colocaciones.length));
	}
	await p.mouse.click(pixq?.x ?? 700, pixq?.y ?? 450);
	await p.waitForTimeout(250);
	const antes = await p.evaluate(() => window.qa.camaraAhora());
	await p.keyboard.press('f');
	await p.waitForTimeout(800);
	const desp = await p.evaluate(() => window.qa.camaraAhora());
	const d0 = Math.hypot(antes.mira.x - bulto.x, antes.mira.y - bulto.y, antes.mira.z - bulto.z);
	const d1 = Math.hypot(desp.mira.x - bulto.x, desp.mira.y - bulto.y, desp.mira.z - bulto.z);
	ok(d1 < Math.max(40, d0 * 0.4), `F enfoca lo seleccionado (${d0.toFixed(0)} → ${d1.toFixed(0)} mm)`);
	const texto = () => p.evaluate(() => document.querySelector('#puerta-flotante .texto')?.textContent);
	const t0 = await texto();
	await p.keyboard.press('o');
	await p.waitForTimeout(900);
	ok(await texto() !== t0, `O abre y cierra la puerta (${t0} → ${await texto()})`);
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close(); process.exit(fallos.length ? 1 : 0);
