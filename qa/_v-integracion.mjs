/**
 * EL RECORRIDO COMPLETO, de principio a fin y con el ratón.
 *
 * Abrir el ejemplo, mirar el frontal, abrir y cerrar la puerta desde el botón flotante, seguir el
 * mazo mientras la hoja gira, pinchar un conductor de puerta, dar la vuelta entera al armario,
 * mirarlo por detrás, subir y bajar, acercarse a un piloto, seleccionarlo, alejarse, pasear por
 * los tres espacios, guardar, recargar y volver a abrir la puerta. Y a lo largo de todo eso, que
 * no se pierda nada, no salte nada y no se seleccione nada sin querer.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, puerta, navegadorDelSistema } from './lib/mirar.mjs';

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

const paso = (n, t) => console.log(`\n--- ${n}. ${t} ---`);

/* 1 */ paso(1, 'abrir el estrella-triángulo');
console.log('   ' + await abrirEjemplo(p, sv.address().port, 2));
const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return { A: g.caja?.ancho ?? g.ancho + 60, H: g.caja?.alto ?? g.alto + 60, P: g.caja?.profundidad ?? 160 };
});
const cables0 = await p.evaluate(() => window.qa.cablesDibujados());
ok(cables0 === 61, `los 61 conductores están dibujados de salida (${cables0})`);

/* 2-3 */ paso(2, 'el frontal, y los pilotos a su medida');
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(1000);
const medidas = await p.evaluate(() => window.qa.medidasDePiloto());
const lente = medidas.find((q) => q.pieza === 'lente');
const aro = medidas.filter((q) => q.pieza === 'LatheGeometry').sort((a, c) => c.ancho - a.ancho)[0];
ok(lente.ancho >= 21 && lente.ancho <= 23 && aro.ancho >= 28 && aro.ancho <= 30.5,
	`piloto Ø22: lente ${lente.ancho}, aro ${aro.ancho}`);

/* 4 */ paso(4, 'abrir y cerrar desde el botón flotante');
const estadoBoton = () => p.evaluate(() => {
	const b = document.getElementById('puerta-flotante');
	const r = b.getBoundingClientRect();
	return {
		oculto: b.hidden, texto: b.querySelector('.texto').textContent,
		aria: b.getAttribute('aria-label'), titulo: b.title,
		enPantalla: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 60,
		encimaDelPanel: (() => {
			const d = document.getElementById('panel-der');
			if (!d || d.style.display === 'none') return false;
			const q = d.getBoundingClientRect();
			return r.right > q.left && r.left < q.right && r.bottom > q.top && r.top < q.bottom;
		})(),
	};
});
{
	const antes = await estadoBoton();
	console.log(`   botón: «${antes.texto}» · aria «${antes.aria}»`);
	ok(!antes.oculto && antes.enPantalla, 'el control flotante se ve en el visor');
	ok(/\(O\)/.test(antes.titulo), `y su ayuda emergente nombra el atajo (${antes.titulo})`);
	// Desde el Frontal, pedir «abrir» tiene que llevar al conjunto y abrir, no callarse.
	const espAntes = await p.evaluate(() => window.qa.camaraAhora().espacio);
	if (antes.texto === 'Abrir puerta') {
		await p.evaluate(() => document.getElementById('puerta-flotante').click());
		await p.waitForTimeout(1200);
		const desp = await p.evaluate(() => window.qa.camaraAhora().espacio);
		ok(desp !== 'frontal', `pedir «abrir» desde el Frontal lleva a otro espacio (${espAntes} → ${desp})`);
	}
	const tras = await estadoBoton();
	ok(tras.texto === 'Cerrar puerta', `y el botón pasa a decir «${tras.texto}»`);
	await p.evaluate(() => document.getElementById('puerta-flotante').click());
	await p.waitForTimeout(1000);
	ok((await estadoBoton()).texto === 'Abrir puerta', 'y al pulsarlo otra vez vuelve a «Abrir puerta»');
	// Y la tecla O hace lo mismo.
	await p.evaluate(() => document.querySelector('canvas').focus());
	await p.keyboard.press('o');
	await p.waitForTimeout(1000);
	ok((await estadoBoton()).texto === 'Cerrar puerta', 'la tecla O abre igual que el botón');
	// Escribiendo en un campo, la O es una letra.
	await p.evaluate(() => document.getElementById('esp-interior')?.click());
	await p.waitForTimeout(600);
	const campo = await p.evaluate(() => {
		const i = [...document.querySelectorAll('input[type="text"]')]
			.find((k) => k.offsetParent !== null);
		if (!i) return false;
		i.focus();
		return true;
	});
	if (campo) {
		const antesO = (await estadoBoton()).texto;
		await p.keyboard.press('o');
		await p.waitForTimeout(500);
		ok((await estadoBoton()).texto === antesO, 'escribiendo en un campo, la O es una letra y no toca la puerta');
		await p.evaluate(() => document.activeElement.blur());
	}
}

/* 5-7 */ paso(5, 'el mazo, mientras la hoja gira');
{
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(800);
	const largos = [];
	for (let t = 0; t <= 1.0001; t += 0.1) {
		await puerta(p, t);
		const m = await p.evaluate(() => window.qa.mazoPuerta());
		largos.push(m);
	}
	const dibujados = largos.map((m) => m.enLaPuerta);
	ok(new Set(dibujados).size === 1 && dibujados[0] === 6,
		`los seis tramos de hoja están presentes en las once aperturas (${[...new Set(dibujados)].join(',')})`);
	const serie = largos.map((m) => Object.values(m.largos));
	let peor = 0;
	for (let i = 1; i < serie.length; i++) {
		for (let j = 0; j < serie[i].length; j++) peor = Math.max(peor, Math.abs(serie[i][j] - serie[i - 1][j]));
	}
	ok(peor < 20, `el lazo se deforma sin saltos entre pasos del 10 % (peor ${peor.toFixed(1)} mm)`);
	const cablesAhora = await p.evaluate(() => window.qa.cablesDibujados());
	ok(cablesAhora === cables0, `y no desaparece ningún conductor por abrir la puerta (${cablesAhora})`);
}

/* 8 */ paso(8, 'pinchar un conductor de puerta');
{
	await puerta(p, 1);
	await p.evaluate(() => window.qa.congelarCamara(true));
	const d = await p.evaluate(() => window.qa.dondeMazo().tramosHoja.find((c) => c.id === 'w54')
		?? window.qa.dondeMazo().porCable[0]);
	const c = d.hoja;
	const cx = (c.min.x + c.max.x) / 2, cy = (c.min.y + c.max.y) / 2, cz = (c.min.z + c.max.z) / 2;
	const a = (118 * Math.PI) / 180;
	await p.evaluate((v) => window.qa.verDesde(v), {
		x: cx + Math.sin(a) * 330, y: cy + 80, z: cz + Math.cos(a) * 330, tx: cx, ty: cy, tz: cz,
	});
	await p.waitForTimeout(350);
	const pts = await p.evaluate((i) => window.qa.puntosVisiblesDeCable(i, 25), d.id);
	let cogido = false;
	for (const pt of pts.slice(0, 6)) {
		const canvas = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [pt.x, pt.y]);
		if (canvas !== 'CANVAS') continue;
		await p.mouse.click(pt.x, pt.y);
		await p.waitForTimeout(150);
		const s = await p.evaluate(() => window.qa.seleccion());
		if (s?.tipo === 'cable' && s.id === d.id) { cogido = true; break; }
	}
	ok(cogido, `${d.id}: se coge con el ratón desde la vista de trabajo`);
	// Y sus propiedades siguen ahí.
	const ficha = await p.evaluate((i) => window.qa.proyecto().conductores.find((k) => k.id === i), d.id);
	ok(!!ficha && !!ficha.de && !!ficha.a, `y conserva origen y destino (${ficha?.de?.dispositivoId} → ${ficha?.a?.dispositivoId})`);
}

/* 9-11 */ paso(9, 'la vuelta entera, por detrás, arriba y abajo');
{
	const CX = 700, CY = 460;
	async function girar(dx, dy) {
		await p.mouse.move(CX, CY);
		await p.mouse.down({ button: 'middle' });
		for (let i = 1; i <= 8; i++) await p.mouse.move(CX + (dx * i) / 8, CY + (dy * i) / 8);
		await p.mouse.up({ button: 'middle' });
		await p.waitForTimeout(70);
	}
	const selAntes = await p.evaluate(() => window.qa.seleccion());
	const vistos = [];
	let anterior = (await p.evaluate(() => window.qa.orbita())).azimut;
	let total = 0;
	for (let i = 0; i < 24; i++) {
		await girar(160, 0);
		const o = await p.evaluate(() => window.qa.orbita());
		let dd = o.azimut - anterior;
		while (dd > Math.PI) dd -= 2 * Math.PI;
		while (dd < -Math.PI) dd += 2 * Math.PI;
		total += dd; anterior = o.azimut;
		vistos.push(o);
	}
	ok(Math.abs(total) > 360 * Math.PI / 180, `se da la vuelta entera (${((total * 180) / Math.PI).toFixed(0)}°)`);
	ok(vistos.every((o) => o.arriba.y > 0.99), 'sin voltear la cámara en ningún punto');
	// Se mide el RECORRIDO, no el sentido: arrastrar hacia arriba baja la cámara, que es la
	// convención de cualquier visor 3D. Lo que importa es llegar a los dos topes.
	const polares = [];
	for (let i = 0; i < 8; i++) { await girar(0, -140); polares.push((await p.evaluate(() => window.qa.orbita())).polar); }
	for (let i = 0; i < 16; i++) { await girar(0, 140); polares.push((await p.evaluate(() => window.qa.orbita())).polar); }
	const gr = (r) => (r * 180) / Math.PI;
	console.log(`   vertical alcanzada: ${gr(Math.min(...polares)).toFixed(0)}° .. ${gr(Math.max(...polares)).toFixed(0)}°`);
	ok(gr(Math.min(...polares)) < 12 && gr(Math.max(...polares)) > 168, 'se mira el techo y el suelo');
	const selDesp = await p.evaluate(() => window.qa.seleccion());
	ok(JSON.stringify(selAntes) === JSON.stringify(selDesp),
		`y dar la vuelta no ha seleccionado nada por accidente (${JSON.stringify(selDesp)})`);
}

/* 12-14 */ paso(12, 'acercarse a un piloto, cogerlo y alejarse');
{
	await puerta(p, 0);
	const q = (await p.evaluate(() => window.qa.componentesDePuerta()))[1];
	const { x, y, z } = q.mundo;
	await p.evaluate((c) => window.qa.verDesde(c), { x, y, z: z + 110, tx: x, ty: y, tz: z });
	await p.waitForTimeout(400);
	const d1 = (await p.evaluate(() => window.qa.orbita())).distancia;
	await p.mouse.click(700, 460);
	await p.waitForTimeout(250);
	const sel = await p.evaluate(() => window.qa.seleccion());
	ok(sel?.id === q.id, `de cerca, el piloto se selecciona con un clic (${JSON.stringify(sel)})`);
	const props = await p.evaluate((i) => {
		const d = window.qa.proyecto().dispositivos.find((k) => k.id === i);
		return { color: d?.colorSenal, tension: d?.tensionNominal, marca: d?.designacion };
	}, q.id);
	console.log(`   propiedades: ${JSON.stringify(props)}`);
	ok(!!props.color && props.tension !== undefined, 'y conserva sus propiedades declaradas');
	// Cada golpe de rueda mueve un 3,7 %: doce golpes son un 55 % más de distancia. Y se parte de
	// 130 mm, que es el tope de acercamiento, así que de más cerca no se puede empezar.
	for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(40); }
	const d2 = (await p.evaluate(() => window.qa.orbita())).distancia;
	ok(d2 > d1 * 1.4, `alejarse con la rueda funciona (${d1.toFixed(0)} → ${d2.toFixed(0)} mm)`);
}

/* 15 */ paso(15, 'pasear por los tres espacios');
{
	const cam = {};
	for (const e of ['frontal', 'interior', 'conjunto']) {
		await p.evaluate((i) => document.getElementById(`esp-${i}`)?.click(), e);
		await p.waitForTimeout(900);
		cam[e] = await p.evaluate(() => window.qa.camaraAhora());
		const n = await p.evaluate(() => window.qa.cablesDibujados());
		ok(n === cables0, `${e}: siguen los ${cables0} conductores (${n})`);
	}
	for (const e of ['frontal', 'interior', 'conjunto']) {
		await p.evaluate((i) => document.getElementById(`esp-${i}`)?.click(), e);
		await p.waitForTimeout(900);
		const ahora = await p.evaluate(() => window.qa.camaraAhora());
		const dd = Math.hypot(ahora.pos.x - cam[e].pos.x, ahora.pos.y - cam[e].pos.y, ahora.pos.z - cam[e].pos.z);
		ok(dd < 3, `${e}: la cámara vuelve donde estaba (${dd.toFixed(1)} mm)`);
	}
}

/* 16-18 */ paso(16, 'guardar, recargar y volver a abrir');
{
	await puerta(p, 0);
	/*
	 * SE COMPARA EL MAZO, NO LA CAJA DE LA HOJA ENTERA.
	 *
	 * `dondeMazo()` da además la caja envolvente de la hoja completa, que es un dato de contexto
	 * muy útil para diagnosticar… y que NO es del mazo: incluye todo lo que cuelgue de la puerta
	 * en ese momento, marco de selección incluido. En este recorrido queda un piloto seleccionado
	 * desde el paso 13, así que su recuadro de selección engordaba la caja dos milímetros; al
	 * recargar, la selección se suelta, el recuadro desaparece y la caja volvía a su medida. La
	 * prueba acusaba al mazo de moverse y lo que se movía era el subrayado. Comprobado aparte con
	 * `qa/_v-hoja.mjs`: sin selección, las 87 mallas de la hoja caen exactamente donde estaban.
	 */
	const soloElMazo = (d) => JSON.stringify({
		enLaPuerta: d.enLaPuerta, flexibles: d.flexibles, tramosHoja: d.tramosHoja, porCable: d.porCable,
	});
	const antes = await p.evaluate(() => JSON.stringify(window.qa.dondeMazo()));
	const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
	await p.evaluate((j) => window.qa.cargarJson(j), json);
	await p.waitForTimeout(1800);
	await puerta(p, 0);
	const despues = await p.evaluate(() => JSON.stringify(window.qa.dondeMazo()));
	ok(soloElMazo(JSON.parse(antes)) === soloElMazo(JSON.parse(despues)),
		'tras recargar, el mazo cae exactamente donde estaba');
	if (soloElMazo(JSON.parse(antes)) !== soloElMazo(JSON.parse(despues))) {
		// Y se dice EN QUÉ se diferencian, que es lo único que sirve para arreglarlo.
		const a = JSON.parse(antes), b = JSON.parse(despues);
		const plano = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object'
			? plano(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
		const ma = new Map(plano(a)), mb = new Map(plano(b));
		const dif = [...ma.keys()].filter((k) => String(ma.get(k)) !== String(mb.get(k)));
		console.log(`     ${dif.length} campos distintos de ${ma.size}`);
		for (const k of dif.slice(0, 12)) console.log(`     ${k}: ${ma.get(k)} → ${mb.get(k)}`);
	}
	await puerta(p, 1);
	const abierto = await p.evaluate(() => JSON.stringify(window.qa.dondeMazo()));
	await p.evaluate((j) => window.qa.cargarJson(j), json);
	await p.waitForTimeout(1800);
	await puerta(p, 1);
	const abiertoDespues = await p.evaluate(() => JSON.stringify(window.qa.dondeMazo()));
	ok(soloElMazo(JSON.parse(abierto)) === soloElMazo(JSON.parse(abiertoDespues)),
		'y abrirla después de cargar produce el mismo recorrido');
	const n = await p.evaluate(() => window.qa.cablesDibujados());
	ok(n === cables0, `y no se ha perdido ningún conductor (${n})`);
}

/* La lámina del recorrido */
{
	await puerta(p, 0.55);
	const R = A * 1.4;
	const camaras = [];
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		camaras.push([`${Math.round((a * 180) / Math.PI)}°`,
			{ x: Math.sin(a) * R, y: H * 0.2, z: Math.cos(a) * R + P / 2, tx: 0, ty: 0, tz: P / 2 }]);
	}
	console.log('   ' + await lamina(p, camaras, { columnas: 3, archivo: 'v-integracion.png' }));
}

console.log(errores.length ? `\nERRORES JS: ${errores.join(' | ')}` : '\nsin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close();
sv.close();
process.exit(0);
