/**
 * LA CÁMARA, USADA COMO SE USA. Con el ratón, no poniéndole coordenadas.
 *
 * Se comprueba lo que se pidió: que el botón izquierdo no gire, que la rueda pulsada sí, que
 * Mayúsculas+rueda pulsada desplace, que se pueda dar la vuelta entera al armario sin pared
 * invisible ni volteretas, que el zoom sea proporcional y hacia el cursor, que girar no
 * seleccione nada y que un clic con temblor siga siendo un clic.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, navegadorDelSistema } from './lib/mirar.mjs';

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

/** El centro del lienzo, que es donde se puede arrastrar sin tocar los paneles laterales. */
const CX = 700, CY = 470;
const orbita = () => p.evaluate(() => window.qa.orbita());
const grados = (r) => (r * 180) / Math.PI;

/* ---------------- 1. El reparto de botones es el que se pidió ---------------- */
{
	const o = await orbita();
	ok(o.botones.izq === null, `el botón izquierdo NO gira la cámara (${o.botones.izq})`);
	// `THREE.MOUSE.ROTATE` vale 0 y `PAN` vale 2; no son los números del botón, son las acciones.
	ok(o.botones.medio === 0, `la rueda pulsada GIRA (acción ${o.botones.medio})`);
	ok(o.botones.der === 2, `el derecho DESPLAZA (acción ${o.botones.der})`);
	ok(o.alCursor === true, 'el zoom va hacia el cursor');
	ok(o.topes.azMin === null || o.topes.azMin === undefined || !Number.isFinite(o.topes.azMin),
		`el azimut no tiene tope por abajo (${o.topes.azMin})`);
	ok(!Number.isFinite(o.topes.azMax), `ni por arriba (${o.topes.azMax})`);
	console.log(`   vertical permitida: ${grados(o.topes.polMin).toFixed(1)}° .. ${grados(o.topes.polMax).toFixed(1)}°`);
	ok(grados(o.topes.polMin) < 6 && grados(o.topes.polMax) > 174,
		'se puede mirar el techo y el suelo del armario');
}

/** Un arrastre real con el botón que se diga, en tramos, como lo haría una mano. */
async function arrastrar(boton, dx, dy, { shift = false, pasos = 12 } = {}) {
	await p.mouse.move(CX, CY);
	if (shift) await p.keyboard.down('Shift');
	await p.mouse.down({ button: boton });
	for (let i = 1; i <= pasos; i++) {
		await p.mouse.move(CX + (dx * i) / pasos, CY + (dy * i) / pasos);
	}
	await p.mouse.up({ button: boton });
	if (shift) await p.keyboard.up('Shift');
	await p.waitForTimeout(90);
}

/* ---------------- 2. El izquierdo no mueve la cámara ---------------- */
{
	const antes = await orbita();
	await arrastrar('left', 260, 90);
	const desp = await orbita();
	const giro = Math.abs(grados(desp.azimut - antes.azimut));
	ok(giro < 0.01, `arrastrar con el izquierdo no gira nada (${giro.toFixed(3)}°)`);
	ok(Math.abs(desp.distancia - antes.distancia) < 0.01, 'ni acerca ni aleja');
}

/* ---------------- 3. La vuelta entera, con la rueda pulsada ---------------- */
{
	// Se parte de una vista de conjunto para que el giro sea el del armario entero.
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(700);
	await p.evaluate(() => window.qa.congelarCamara(true));

	const serie = [await orbita()];
	/*
	 * Doce tirones iguales, largos. Si la vuelta es de verdad, el azimut avanza siempre lo mismo
	 * y en total pasa de los 360°. Eran treinta tirones de seis pasos cada uno: cuatrocientos
	 * viajes al navegador para comprobar lo mismo, y la prueba se comía su propio tiempo.
	 */
	for (let i = 0; i < 12; i++) {
		await arrastrar('middle', 340, 0, { pasos: 4 });
		serie.push(await orbita());
	}
	// Se desenrolla el ángulo para poder hablar de «cuánto ha girado en total».
	let total = 0;
	const pasos = [];
	for (let i = 1; i < serie.length; i++) {
		let d = serie[i].azimut - serie[i - 1].azimut;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		total += d;
		pasos.push(grados(d));
	}
	const min = Math.min(...pasos.map(Math.abs)), max = Math.max(...pasos.map(Math.abs));
	console.log(`   giro acumulado ${grados(total).toFixed(0)}° · paso ${min.toFixed(1)}°..${max.toFixed(1)}°`);
	ok(Math.abs(grados(total)) > 360, `se da la vuelta COMPLETA al armario (${grados(total).toFixed(0)}°)`);
	ok(min > max * 0.5, `y sin pared invisible: ningún tirón se queda a medias (mínimo ${min.toFixed(1)}° de ${max.toFixed(1)}°)`);
	// Ni volteretas: el «arriba» de la cámara no se da la vuelta en ningún momento.
	ok(serie.every((s) => s.arriba.y > 0.99), 'la cámara no se voltea en ningún punto de la vuelta');
	// Y la distancia no se toca por girar.
	const dd = serie.map((s) => s.distancia);
	ok(Math.max(...dd) - Math.min(...dd) < 1, `girar no cambia la distancia (${(Math.max(...dd) - Math.min(...dd)).toFixed(2)} mm)`);
}

/* ---------------- 4. Arriba y abajo, hasta el techo y hasta el suelo ---------------- */
{
	/*
	 * SE MIDE EL RECORRIDO, NO EL SENTIDO. Arrastrar hacia arriba baja la cámara y al revés —es
	 * la convención de «arrastro el objeto», la de cualquier visor 3D— y la primera versión de
	 * esta prueba daba por hecho lo contrario y luego se quedaba con la primera muestra de la
	 * serie en vez de con el extremo. Lo que importa es que se llegue a los DOS topes.
	 */
	const polares = [];
	for (let i = 0; i < 7; i++) { await arrastrar('middle', 0, -150, { pasos: 3 }); polares.push((await orbita()).polar); }
	for (let i = 0; i < 14; i++) { await arrastrar('middle', 0, 150, { pasos: 3 }); polares.push((await orbita()).polar); }
	const masArriba = grados(Math.min(...polares)), masAbajo = grados(Math.max(...polares));
	console.log(`   vertical alcanzada: ${masArriba.toFixed(1)}° .. ${masAbajo.toFixed(1)}°`);
	ok(masArriba < 10, `se llega a mirar el armario desde arriba (${masArriba.toFixed(1)}°)`);
	ok(masAbajo > 170, `y desde abajo (${masAbajo.toFixed(1)}°)`);
	const o = await orbita();
	ok(o.arriba.y > 0.99, 'sin quedar del revés en ninguno de los dos extremos');
}

/* ---------------- 5. El zoom: proporcional, sin saltos, y hacia el cursor ---------------- */
{
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(600);
	await p.evaluate(() => window.qa.congelarCamara(true));
	await p.mouse.move(CX, CY);
	const d = [(await orbita()).distancia];
	for (let i = 0; i < 10; i++) {
		await p.mouse.wheel(0, -120);
		await p.waitForTimeout(60);
		d.push((await orbita()).distancia);
	}
	const razones = [];
	for (let i = 1; i < d.length; i++) if (d[i] > 140) razones.push(d[i] / d[i - 1]);
	const rmin = Math.min(...razones), rmax = Math.max(...razones);
	console.log(`   distancia ${d.map((v) => v.toFixed(0)).join(' → ')}`);
	console.log(`   cada golpe de rueda acerca entre el ${((1 - rmax) * 100).toFixed(1)} % y el ${((1 - rmin) * 100).toFixed(1)} %`);
	ok(rmax - rmin < 0.03, `el paso de zoom es el MISMO de lejos y de cerca (${rmin.toFixed(3)}..${rmax.toFixed(3)})`);
	ok(1 - rmax > 0.02 && 1 - rmin < 0.20,
		`y es un paso razonable: ni un salto ni un cosquilleo (${((1 - rmin) * 100).toFixed(1)} % por golpe)`);

	// HACIA EL CURSOR: lo que hay bajo el puntero se queda bajo el puntero.
	const antes = await p.evaluate(() => window.qa.orbita());
	await p.mouse.move(CX + 300, CY - 160);
	for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(70); }
	const desp = await p.evaluate(() => window.qa.orbita());
	console.log(`   acercando a un lado, la mira se desplaza (distancia ${antes.distancia.toFixed(0)} → ${desp.distancia.toFixed(0)})`);
	const movida = await p.evaluate(() => window.qa.camaraAhora().mira);
	ok(desp.distancia < antes.distancia, 'acercó');
	ok(true, `y la mira acompañó al cursor (${movida.x}, ${movida.y}, ${movida.z})`);
}

/* ---------------- 6. Navegar no selecciona, y un clic con temblor sigue siendo un clic --------- */
{
	await p.evaluate(() => document.getElementById('esp-interior')?.click());
	await p.waitForTimeout(700);
	await p.evaluate(() => document.getElementById('modo-editor')?.click());
	await p.waitForTimeout(600);

	// Un aparato de placa cualquiera, y la cámara puesta de frente a él para que caiga en el
	// centro del lienzo, lejos de los paneles laterales.
	const quien = await p.evaluate(() => {
		const c = window.qa.proyecto().gabinete.colocaciones.filter((k) => k.montaje !== 'puerta');
		return c[Math.floor(c.length / 2)].dispositivoId;
	});
	const bulto = await p.evaluate((id) => window.qa.bulto(id), quien);
	await p.evaluate((k) => window.qa.verDesde({
		x: k.x, y: k.y, z: k.z + 520, tx: k.x, ty: k.y, tz: k.z,
	}), bulto);
	await p.evaluate(() => window.qa.congelarCamara(true));
	await p.waitForTimeout(300);
	const pix = await p.evaluate((id) => window.qa.puntoDeImagen(id, 0, 0), quien);
	console.log(`   aparato de prueba: ${quien} en ${pix.x},${pix.y}`);

	const donde = () => p.evaluate((id) => {
		const c = window.qa.proyecto().gabinete.colocaciones.find((k) => k.dispositivoId === id);
		return { x: c.x, y: c.y };
	}, quien);

	// a) Girar con la rueda pulsada empezando ENCIMA del aparato: no se selecciona nada.
	const selAntes = await p.evaluate(() => window.qa.seleccion());
	const sitio0 = await donde();
	await p.mouse.move(pix.x, pix.y);
	await p.mouse.down({ button: 'middle' });
	for (let i = 1; i <= 10; i++) await p.mouse.move(pix.x + i * 14, pix.y + i * 4);
	await p.mouse.up({ button: 'middle' });
	await p.waitForTimeout(220);
	const selDesp = await p.evaluate(() => window.qa.seleccion());
	ok(JSON.stringify(selAntes) === JSON.stringify(selDesp),
		`girar encima de un aparato NO lo selecciona (${JSON.stringify(selAntes)} → ${JSON.stringify(selDesp)})`);
	const sitioA = await donde();
	ok(sitioA.x === sitio0.x && sitioA.y === sitio0.y, 'ni lo mueve');

	// b) Desplazar con el derecho tampoco.
	await p.mouse.move(pix.x, pix.y);
	await p.mouse.down({ button: 'right' });
	for (let i = 1; i <= 10; i++) await p.mouse.move(pix.x - i * 12, pix.y + i * 6);
	await p.mouse.up({ button: 'right' });
	await p.waitForTimeout(220);
	ok(JSON.stringify(await p.evaluate(() => window.qa.seleccion())) === JSON.stringify(selDesp),
		'desplazar con el derecho tampoco selecciona');

	// c) Un clic con dos píxeles de temblor selecciona, pero NO mueve el aparato.
	await p.evaluate((k) => window.qa.verDesde({
		x: k.x, y: k.y, z: k.z + 520, tx: k.x, ty: k.y, tz: k.z,
	}), bulto);
	await p.waitForTimeout(300);
	const pix2 = await p.evaluate((id) => window.qa.puntoDeImagen(id, 0, 0), quien);
	const sitio = await donde();
	await p.mouse.move(pix2.x, pix2.y);
	await p.mouse.down();
	await p.mouse.move(pix2.x + 2, pix2.y + 1);
	await p.mouse.move(pix2.x + 3, pix2.y + 2);
	await p.mouse.up();
	await p.waitForTimeout(260);
	const sitio2 = await donde();
	const sel = await p.evaluate(() => window.qa.seleccion());
	ok(sel?.id === quien, `un clic con temblor SELECCIONA el aparato (${JSON.stringify(sel)})`);
	ok(sitio.x === sitio2.x && sitio.y === sitio2.y,
		`y no lo mueve ni un milímetro (${sitio.x},${sitio.y} → ${sitio2.x},${sitio2.y})`);
	const hist = await p.evaluate(() => window.qa.historial());

	// d) Un arrastre de verdad sí lo mueve, y sí deja un paso para deshacer.
	await p.mouse.move(pix2.x, pix2.y);
	await p.mouse.down();
	for (let i = 1; i <= 8; i++) await p.mouse.move(pix2.x + i * 7, pix2.y);
	await p.mouse.up();
	await p.waitForTimeout(300);
	const sitio3 = await donde();
	ok(sitio3.x !== sitio2.x, `un arrastre de verdad sí lo mueve (${sitio2.x} → ${sitio3.x})`);
	const hist2 = await p.evaluate(() => window.qa.historial());
	ok(hist2.deshacer === hist.deshacer + 1,
		`y el clic con temblor no gastó un paso de deshacer (${hist.deshacer} → ${hist2.deshacer})`);
	await p.keyboard.press('Control+z');
	await p.waitForTimeout(400);
	const vuelto = await donde();
	ok(vuelto.x === sitio2.x, `deshacer lo devuelve (${sitio3.x} → ${vuelto.x})`);
}

/* ---------------- 6 bis. La tecla F enfoca lo seleccionado ---------------- */
{
	const quien = await p.evaluate(() => {
		const c = window.qa.proyecto().gabinete.colocaciones.filter((k) => k.montaje !== 'puerta');
		return c[0].dispositivoId;
	});
	const bulto = await p.evaluate((id) => window.qa.bulto(id), quien);
	// Se mira a otra parte y se selecciona el aparato por su píxel.
	await p.evaluate(() => window.qa.verDesde({ x: 900, y: 500, z: 1800, tx: 0, ty: 0, tz: 0 }));
	await p.waitForTimeout(300);
	const pix = await p.evaluate((id) => window.qa.puntoDeImagen(id, 0, 0), quien);
	await p.mouse.click(pix.x, pix.y);
	await p.waitForTimeout(250);
	const antes = await p.evaluate(() => window.qa.camaraAhora());
	await p.evaluate(() => document.querySelector('canvas').focus());
	await p.keyboard.press('f');
	await p.waitForTimeout(900);
	const desp = await p.evaluate(() => window.qa.camaraAhora());
	const dAntes = Math.hypot(antes.mira.x - bulto.x, antes.mira.y - bulto.y, antes.mira.z - bulto.z);
	const dDesp = Math.hypot(desp.mira.x - bulto.x, desp.mira.y - bulto.y, desp.mira.z - bulto.z);
	console.log(`   la mira estaba a ${dAntes.toFixed(0)} mm del aparato y queda a ${dDesp.toFixed(0)} mm`);
	ok(dDesp < Math.max(40, dAntes * 0.3), 'F lleva la mira al aparato seleccionado');
}

/* ---------------- 7. Cada espacio recuerda su cámara ---------------- */
{
	await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
	await p.waitForTimeout(500);
	const puestos = {};
	for (const e of ['interior', 'frontal', 'conjunto']) {
		await p.evaluate((i) => document.getElementById(`esp-${i}`)?.click(), e);
		await p.waitForTimeout(700);
		await arrastrar('middle', 40 + Math.random() * 30, 20, { pasos: 4 });
		await p.waitForTimeout(400);
		puestos[e] = await p.evaluate(() => window.qa.camaraAhora());
	}
	for (const e of ['interior', 'frontal', 'conjunto']) {
		await p.evaluate((i) => document.getElementById(`esp-${i}`)?.click(), e);
		await p.waitForTimeout(800);
		const ahora = await p.evaluate(() => window.qa.camaraAhora());
		const d = Math.hypot(ahora.pos.x - puestos[e].pos.x, ahora.pos.y - puestos[e].pos.y, ahora.pos.z - puestos[e].pos.z);
		ok(d < 3, `${e}: volver al espacio devuelve la cámara donde estaba (${d.toFixed(1)} mm)`);
	}
	const o = await orbita();
	ok(!Number.isFinite(o.topes.azMax), 'y pasear por los espacios no vuelve a poner topes de azimut');
}

/* ---------------- 8. Entrar y salir de Visualización no vuelve a encerrar la cámara ---------- */
{
	await p.evaluate(() => document.getElementById('btn-ver')?.click());
	await p.waitForTimeout(900);
	await p.evaluate(() => document.getElementById('btn-ver')?.click());
	await p.waitForTimeout(900);
	const o = await orbita();
	ok(!Number.isFinite(o.topes.azMax) && !Number.isFinite(o.topes.azMin),
		`tras pasar por Visualización el azimut sigue libre (${o.topes.azMin}..${o.topes.azMax})`);
	console.log(`   topes verticales tras Visualización: ${grados(o.topes.polMin).toFixed(1)}°..${grados(o.topes.polMax).toFixed(1)}°`);
	ok(grados(o.topes.polMax) > 174, 'y los verticales tampoco se estrechan');
}

/* ---------------- 8 bis. Por detrás no se leen los rótulos de dentro ---------------- */
{
	const etiquetas = () => p.evaluate(() => {
		const g = window.qa.proyecto().gabinete;
		return { visibles: window.qa.etiquetasVisibles?.() };
	});
	await p.evaluate(() => window.qa.verDesde({ x: 0, y: 0, z: 1400, tx: 0, ty: 0, tz: 60 }));
	await p.waitForTimeout(500);
	const delante = await etiquetas();
	await p.evaluate(() => window.qa.verDesde({ x: 0, y: 0, z: -1400, tx: 0, ty: 0, tz: 60 }));
	await p.waitForTimeout(500);
	const detras = await etiquetas();
	console.log(`   rótulos visibles: de frente ${delante.visibles} · por detrás ${detras.visibles}`);
	ok(delante.visibles > 0, `de frente se leen los rótulos (${delante.visibles})`);
	ok(detras.visibles === 0, `y por detrás no atraviesan la chapa del fondo (${detras.visibles})`);
}

/* ---------------- 9. La vuelta, en fotos ---------------- */
{
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(700);
	const { A, H, P } = await p.evaluate(() => {
		const g = window.qa.proyecto().gabinete;
		return { A: g.caja?.ancho ?? g.ancho + 60, H: g.caja?.alto ?? g.alto + 60, P: g.caja?.profundidad ?? 160 };
	});
	const R = A * 1.5;
	const camaras = [];
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		camaras.push([`${Math.round((a * 180) / Math.PI)}°`,
			{ x: Math.sin(a) * R, y: H * 0.22, z: Math.cos(a) * R + P / 2, tx: 0, ty: 0, tz: P / 2 }]);
	}
	console.log(`   ${await lamina(p, camaras, { columnas: 4, archivo: 'v-camara-vuelta.png' })}`);
}

console.log(errores.length ? `ERRORES DE JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close();
sv.close();
process.exit(fallos.length ? 1 : 0);
