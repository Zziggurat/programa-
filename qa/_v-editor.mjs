/**
 * EL FRONTAL, USÁNDOLO. Ratón de verdad, teclas de verdad y las medidas que dicen si la
 * interacción se siente bien: si la pieza salta al agarrarla, si se despega del cursor, si se
 * recoloca sola al soltar, si las flechas suman exactamente lo que dicen sumar, si deshacer
 * devuelve lo que se acaba de mover y si las ayudas hacen lo que enseñan.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, navegadorDelSistema } from './lib/mirar.mjs';

const EJEMPLO = Number(process.argv[2] ?? 2);
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.setDefaultTimeout(90_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

console.log(await abrirEjemplo(p, sv.address().port, EJEMPLO));
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(900);
/*
 * LA CÁMARA GLISA. Cambiar de espacio la lleva a su sitio con amortiguación, y mientras tanto
 * proyectar una pieza a píxeles da una coordenada que ya no vale cuando llega el clic: la primera
 * versión de esta prueba pinchaba al vacío y creía que la selección estaba rota. Se espera al
 * hecho —que la cámara deje de moverse— y no a un reloj.
 */
async function camaraQuieta() {
	let antes = '';
	for (let i = 0; i < 60; i++) {
		const ahora = JSON.stringify(await p.evaluate(() => window.qa.camaraAhora()));
		if (ahora === antes) return;
		antes = ahora;
		await p.waitForTimeout(120);
	}
}
await camaraQuieta();

const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const punto = (clase, id) => p.evaluate(([c, i]) => window.qa.puntoEnPantallaDeFrontal(c, i), [clase, id]);
const una = async (clase, id) => (await piezas()).find((q) => q.clase === clase && q.id === id);

async function pinchar(clase, id, opciones = {}) {
	const pt = await punto(clase, id);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y), opciones);
	await p.waitForTimeout(280);
	return p.evaluate(() => window.qa.seleccion());
}

const lista = await piezas();
console.log('   piezas en la puerta:', lista.map((q) => `${q.clase}:${q.id}`).join(' '));
const aparato = lista.find((q) => q.clase === 'aparato');
const rotulo = lista.find((q) => q.clase === 'rotulo');

/* ---- 1. Seleccionar con un clic ---- */
ok((await pinchar('aparato', aparato.id))?.id === aparato.id, `un clic selecciona ${aparato.id}`);

/* ---- 2. Arrastre LENTO: la pieza no puede despegarse del cursor ---- */
async function arrastrar(clase, id, dxPx, dyPx, pasos, opciones = {}) {
	const pt = await punto(clase, id);
	const antes = await una(clase, id);
	await p.mouse.move(Math.round(pt.x), Math.round(pt.y));
	await p.mouse.down(opciones);
	// El desfase entre el cursor y el centro de la pieza al agarrar. Tiene que mantenerse.
	const desfases = [];
	for (let i = 1; i <= pasos; i++) {
		await p.mouse.move(Math.round(pt.x + (dxPx * i) / pasos), Math.round(pt.y + (dyPx * i) / pasos));
		await p.waitForTimeout(24);
		const ahora = await punto(clase, id);
		desfases.push(Math.hypot(ahora.x - (pt.x + (dxPx * i) / pasos), ahora.y - (pt.y + (dyPx * i) / pasos)));
	}
	const alSoltar = await una(clase, id);
    await p.mouse.up(opciones);
	await p.waitForTimeout(260);
	const tras = await una(clase, id);
	return {
		antes, tras,
		saltoInicial: desfases.length ? desfases[0] : 0,
		peorDesfase: Math.max(...desfases),
		correccionAlSoltar: Math.hypot(tras.x - alSoltar.x, tras.y - alSoltar.y),
	};
}

// Se aparta la pieza de sus vecinas primero, para que las ayudas no enturbien la medida del
// arrastre: aquí se está midiendo el agarre, no el imantado.
await p.evaluate(() => { document.getElementById('frontal-snap').checked = false; });
const lento = await arrastrar('aparato', aparato.id, 90, 40, 18);
ok(lento.saltoInicial < 6, `el arrastre lento no salta al agarrar (${lento.saltoInicial.toFixed(1)} px)`);
ok(lento.peorDesfase < 6, `la pieza no se despega del cursor arrastrando despacio (peor ${lento.peorDesfase.toFixed(1)} px)`);
ok(lento.correccionAlSoltar === 0, `al soltar no se recoloca sola (${lento.correccionAlSoltar} mm)`);

/* ---- 3. Arrastre RÁPIDO: tres saltos grandes ---- */
const rapido = await arrastrar('aparato', aparato.id, -110, -30, 3);
ok(rapido.peorDesfase < 6, `la pieza sigue pegada al cursor arrastrando deprisa (peor ${rapido.peorDesfase.toFixed(1)} px)`);
ok(rapido.correccionAlSoltar === 0, `tampoco se recoloca al soltar deprisa (${rapido.correccionAlSoltar} mm)`);

/* ---- 4. Flechas: 1 mm y 10 mm, sin acumular decimales ---- */
await pinchar('aparato', aparato.id);
const base = await una('aparato', aparato.id);
for (let i = 0; i < 10; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(40); }
let ahora = await una('aparato', aparato.id);
ok(ahora.x - base.x === 10, `diez flechas mueven exactamente 10 mm (${ahora.x - base.x})`);
for (let i = 0; i < 3; i++) { await p.keyboard.down('Shift'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift'); await p.waitForTimeout(40); }
const trasShift = await una('aparato', aparato.id);
ok(trasShift.y - ahora.y === 30, `tres Mayúsculas+flecha mueven exactamente 30 mm (${trasShift.y - ahora.y})`);
for (let i = 0; i < 10; i++) { await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(40); }
ahora = await una('aparato', aparato.id);
ok(ahora.x === base.x, `ida y vuelta con flechas vuelve al mismo milímetro (${base.x} -> ${ahora.x})`);

/* ---- 5. Deshacer después de mover ---- */
const antesDeshacer = await una('aparato', aparato.id);
const movido = await arrastrar('aparato', aparato.id, 70, 0, 6);
ok(movido.tras.x !== antesDeshacer.x, `la pieza se ha movido (${antesDeshacer.x} -> ${movido.tras.x})`);
await p.keyboard.press('Control+z');
await p.waitForTimeout(500);
const trasDeshacer = await una('aparato', aparato.id);
ok(
	trasDeshacer.x === antesDeshacer.x && trasDeshacer.y === antesDeshacer.y,
	`deshacer devuelve la pieza a donde estaba (${antesDeshacer.x},${antesDeshacer.y} -> ${trasDeshacer.x},${trasDeshacer.y})`,
);
// Y rehacer la trae de vuelta.
await p.keyboard.press('Control+y');
await p.waitForTimeout(500);
const trasRehacer = await una('aparato', aparato.id);
ok(trasRehacer.x === movido.tras.x, `rehacer la devuelve al sitio nuevo (${movido.tras.x} -> ${trasRehacer.x})`);

/* ---- 6. Imantado: la guía tiene que corresponder al imantado aplicado ---- */
await p.evaluate(() => { document.getElementById('frontal-snap').checked = true; });
const vecinas = (await piezas()).filter((q) => q.clase === 'aparato' && q.id !== aparato.id);
if (vecinas.length) {
	const objetivo = vecinas[0];
	// Se lleva la pieza a tres milímetros de la X de su vecina y se suelta: debe caer EN su X.
	await p.evaluate(([id, x, y]) => {
		window.qa.elegir(id);
		const ex = document.getElementById('fp-x'), ey = document.getElementById('fp-y');
		ex.value = String(x); ex.dispatchEvent(new Event('change', { bubbles: true }));
		ey.value = String(y); ey.dispatchEvent(new Event('change', { bubbles: true }));
	}, [aparato.id, objetivo.x + 30, objetivo.y + 80]);
	await p.waitForTimeout(400);
	await pinchar('aparato', aparato.id);
	// Arrastre corto de 30 mm hacia la X de la vecina, en pasos pequeños.
	const pt = await punto('aparato', aparato.id);
	const ptObj = await punto('aparato', objetivo.id);
	const dx = ptObj.x - pt.x;
	await p.mouse.move(Math.round(pt.x), Math.round(pt.y));
	await p.mouse.down();
	for (let i = 1; i <= 10; i++) {
		await p.mouse.move(Math.round(pt.x + (dx * i) / 10), Math.round(pt.y));
		await p.waitForTimeout(28);
	}
	const ayuda = await p.evaluate(() => document.getElementById('ayuda').textContent);
	const antesDeSoltar = await una('aparato', aparato.id);
	await p.mouse.up();
	await p.waitForTimeout(300);
	const trasSoltar = await una('aparato', aparato.id);
	ok(Math.abs(trasSoltar.x - objetivo.x) <= 1, `el imantado engancha la X de la vecina (${trasSoltar.x} vs ${objetivo.x})`);
	ok(/imantado a/.test(ayuda), `la barra avisa del imantado mientras se arrastra: «${ayuda.slice(0, 90)}»`);
	ok(trasSoltar.x === antesDeSoltar.x && trasSoltar.y === antesDeSoltar.y, 'soltar no añade ninguna corrección extra');

	/* ---- 7. Alt: ninguna ayuda ---- */
	await p.evaluate(([id, x, y]) => {
		window.qa.elegir(id);
		const ex = document.getElementById('fp-x'), ey = document.getElementById('fp-y');
		ex.value = String(x); ex.dispatchEvent(new Event('change', { bubbles: true }));
		ey.value = String(y); ey.dispatchEvent(new Event('change', { bubbles: true }));
	}, [aparato.id, objetivo.x + 30, objetivo.y + 80]);
	await p.waitForTimeout(400);
	await pinchar('aparato', aparato.id);
	const pt2 = await punto('aparato', aparato.id);
	const ptObj2 = await punto('aparato', objetivo.id);
	await p.keyboard.down('Alt');
	await p.mouse.move(Math.round(pt2.x), Math.round(pt2.y));
	await p.mouse.down();
	for (let i = 1; i <= 10; i++) {
		await p.mouse.move(Math.round(pt2.x + ((ptObj2.x - pt2.x) * i) / 10), Math.round(pt2.y));
		await p.waitForTimeout(28);
	}
	const ayudaAlt = await p.evaluate(() => document.getElementById('ayuda').textContent);
	await p.mouse.up();
	await p.keyboard.up('Alt');
	await p.waitForTimeout(300);
	const conAlt = await una('aparato', aparato.id);
	ok(!/imantado a/.test(ayudaAlt), 'con Alt la barra no anuncia ningún imantado');
	console.log(`   con Alt la pieza queda en x=${conAlt.x} (la vecina está en ${objetivo.x})`);
}

/* ---- 8. Duplicar y borrar por teclado ---- */
await pinchar('aparato', aparato.id);
const antesDup = (await piezas()).length;
await p.keyboard.press('Control+d');
await p.waitForTimeout(600);
ok((await piezas()).length === antesDup + 1, 'Ctrl+D duplica');
await p.keyboard.press('Delete');
await p.waitForTimeout(500);
ok((await piezas()).length === antesDup, 'Supr quita la copia');

/* ---- 9. Texto de un rótulo ---- */
if (rotulo) {
	await pinchar('rotulo', rotulo.id);
	const campo = await p.evaluate(() => {
		const t = document.querySelector('#panel-der input[type="text"], #panel-der textarea');
		return t ? t.id : null;
	});
	if (campo) {
		await p.evaluate((id) => {
			const e = document.getElementById(id);
			e.value = 'CUIDADO TABLERO ELÉCTRICO';
			e.dispatchEvent(new Event('change', { bubbles: true }));
		}, campo);
		await p.waitForTimeout(600);
		const texto = await p.evaluate((id) => window.qa.proyecto().gabinete.rotulos.find((r) => r.id === id)?.texto, rotulo.id);
		ok(texto === 'CUIDADO TABLERO ELÉCTRICO', `el rótulo cambia de texto: «${texto}»`);
	} else {
		ok(false, 'la ficha del rótulo no ofrece ningún campo de texto');
	}
}

/* ---- 10. Ir y volver de espacio no descoloca nada ---- */
const foto = (await piezas()).map((q) => `${q.clase}:${q.id}@${q.x},${q.y}`).join('|');
for (const id of ['esp-interior', 'esp-conjunto', 'esp-frontal']) {
	await p.evaluate((i) => document.getElementById(i)?.click(), id);
	await p.waitForTimeout(700);
	await camaraQuieta();
}
ok((await piezas()).map((q) => `${q.clase}:${q.id}@${q.x},${q.y}`).join('|') === foto,
	'pasar por los tres espacios y volver deja todo donde estaba');

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
