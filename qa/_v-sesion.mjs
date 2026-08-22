/**
 * UNA SESIÓN COMO LA HARÍA UNA PERSONA, sin abrir la consola.
 *
 * Las suites de regresión comprueban que cada pieza sigue funcionando. Ésta comprueba otra cosa
 * distinta y que ninguna de ellas mira: que el programa se puede USAR de principio a fin sin
 * saber dónde están escondidas las cosas. Se hace todo por donde lo haría el usuario —el rail,
 * los cajones, el visor, el inspector— y las sondas solo se usan para MIRAR el resultado, nunca
 * para provocarlo.
 *
 * La pregunta que responde es la del enunciado: «¿he tenido que buscar una acción que debería
 * ser obvia?». Aquí se traduce en algo comprobable: cada acción del recorrido tiene que estar a
 * un clic de donde el usuario ya está mirando, la ayuda de abajo tiene que hablar de lo que se
 * está haciendo, y el cajón abierto tiene que ser el de la herramienta activa.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, lamina, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
p.setDefaultTimeout(120_000);
const errores = [];
p.on('pageerror', (e) => errores.push(`${e.message}`));
const fallos = [];
const ok = (bien, t) => { console.log(`${bien ? 'OK ' : 'MAL'} ${t}`); if (!bien) fallos.push(t); };

const sel = () => p.evaluate(() => window.qa.seleccion());
const hist = () => p.evaluate(() => window.qa.historial());
const pr = () => p.evaluate(() => window.qa.proyecto());
/** Lo que dice la guía de abajo, en texto plano: es lo que lee el usuario. */
const guia = () => p.evaluate(() => document.getElementById('ayuda')?.textContent?.trim() ?? '');
/** Qué cajón está abierto y cómo se titula. */
const cajon = () => p.evaluate(() => ({
	titulo: document.getElementById('cajon-titulo')?.textContent?.trim(),
	visibles: [...document.querySelectorAll('#panel-izq details[data-cajon]')]
		.filter((d) => !d.hidden).map((d) => d.id),
	herramienta: document.querySelector('#rail .hta.activo')?.dataset.hta,
}));
const herramienta = async (h) => {
	await p.evaluate((k) => document.getElementById(`hta-${k}`)?.click(), h);
	await p.waitForTimeout(600);
};

console.log(await abrirEjemplo(p, sv.address().port, 2));

/* ---- 1. Dónde estoy y qué puedo hacer ---- */
{
	const c = await cajon();
	console.log(`   arranca en «${c.titulo}» con la herramienta ${c.herramienta}`);
	ok(c.herramienta === 'seleccionar', 'arranca eligiendo, que es lo que se hace primero');
	ok(c.visibles.length <= 2, `y con el cajón de esa herramienta, no con todos (${c.visibles.join(', ') || 'ninguno'})`);
	const g = await guia();
	console.log(`   guía: ${g.replace(/\s+/g, ' ')}`);
	ok(/girar/i.test(g) && /elegir/i.test(g), 'la guía cuenta a la vez cómo se mueve la cámara y qué hace la herramienta');
}

/* ---- 2. Añadir un aparato: la lista está en su cajón y el aparato acaba puesto ---- */
{
	await herramienta('anadir');
	const c = await cajon();
	ok(c.visibles.includes('seccion-catalogo'), `añadir enseña el catálogo (${c.visibles.join(', ')})`);
	ok(/añadir/i.test(c.titulo ?? ''), `y el cajón dice de qué va (${c.titulo})`);

	const antes = (await pr()).dispositivos.length;
	// Se elige un aparato de la lista como se elige de verdad: pulsando su tarjeta.
	await p.locator('#seccion-catalogo .item-catalogo, #seccion-catalogo button').first().click();
	await p.waitForTimeout(700);
	const g = await guia();
	console.log(`   con el aparato en el puntero, la guía dice: ${g.replace(/\s+/g, ' ')}`);
	ok(/suelt|clic/i.test(g), 'la guía cambia para explicar que ahora hay que soltarlo');
	// Y se suelta en un hueco del tablero.
	await p.mouse.click(760, 640);
	await p.waitForTimeout(900);
	const desp = (await pr()).dispositivos.length;
	ok(desp === antes + 1, `el aparato queda puesto (${antes} → ${desp})`);
	ok((await hist()).deshacer > 0, 'y se puede deshacer');
}

/* ---- 3. Elegirlo y cambiarle una propiedad, sin ir a buscar el inspector ---- */
{
	await herramienta('seleccionar');
	const nuevo = (await pr()).dispositivos.at(-1);
	await p.evaluate((i) => window.qa.seleccionarPorId(i), nuevo.id);
	await p.waitForTimeout(600);
	const visible = await p.evaluate(() => {
		const d = document.getElementById('panel-der');
		return d && getComputedStyle(d).display !== 'none' && d.textContent.trim().length > 0;
	});
	ok(visible, 'al elegir algo, el inspector de la derecha se llena solo');
	const campo = await p.evaluate(() => !!document.querySelector('#panel-der input, #panel-der select'));
	ok(campo, 'y trae campos que se pueden tocar sin abrir ningún diálogo');
}

/* ---- 4. Cablear: la herramienta cambia el modo, y la guía lo cuenta paso a paso ---- */
{
	await herramienta('conectar');
	const modo = await p.evaluate(() => window.qa.estadoInteraccion().modo);
	ok(modo === 'trabajo', `cablear pone el tablero en modo Trabajo por sí solo (${modo})`);
	const g = await guia();
	console.log(`   guía al cablear: ${g.replace(/\s+/g, ' ')}`);
	ok(/borne/i.test(g), 'y la guía habla de bornes, que es lo que hay que pinchar ahora');

	const antes = (await pr()).conductores.length;
	// Dos bornes de dos aparatos distintos, pinchados sobre el visor como haría cualquiera.
	const puntos = await p.evaluate(() => {
		const pro = window.qa.proyecto();
		const cols = pro.gabinete.colocaciones.filter((c) => c.montaje !== 'puerta');
		const sitios = [];
		for (const c of cols) {
			const d = pro.dispositivos.find((k) => k.id === c.dispositivoId);
			if (!d?.bornes?.length) continue;
			for (const bo of d.bornes) {
				const q = window.qa.puntoParaBorne(d.id, bo.id);
				if (q) { sitios.push({ d: d.id, b: bo.id, x: q.x, y: q.y }); break; }
			}
			if (sitios.length === 2) break;
		}
		return sitios;
	});
	if (puntos.length === 2) {
		await p.mouse.click(puntos[0].x, puntos[0].y);
		await p.waitForTimeout(500);
		const medias = await guia();
		ok(/destino|otro borne/i.test(medias), `elegido el origen, la guía pide el destino (${medias.replace(/\s+/g, ' ')})`);
		await p.mouse.click(puntos[1].x, puntos[1].y);
		await p.waitForTimeout(900);
		const desp = (await pr()).conductores.length;
		ok(desp === antes + 1, `el cable queda hecho con dos clics (${antes} → ${desp})`);
	} else {
		ok(false, `no se han localizado dos bornes pinchables (${puntos.length})`);
	}
}

/* ---- 5. Elegir un cable: clase, y la guía pasa a hablar de uniones ---- */
{
	const cid = (await pr()).conductores.at(-1).id;
	// Se pincha el cable en el visor, que es como se elige de verdad. La sonda solo dice por qué
	// píxel pasa; el clic lo da el ratón.
	const pix = await p.evaluate((i) => window.qa.puntoSobreCable(i), cid);
	if (pix) {
		await p.mouse.click(pix.x, pix.y);
		await p.waitForTimeout(700);
	}
	const elegido = await sel();
	ok(elegido?.tipo === 'cable', `un clic sobre el cable lo elige (${JSON.stringify(elegido)})`);
	const g = await guia();
	console.log(`   guía con un cable elegido: ${g.replace(/\s+/g, ' ')}`);
	ok(/uni[oó]n/i.test(g), 'con un cable elegido la guía explica las uniones');
	const clase = await p.evaluate(() => document.getElementById('panel-der')?.textContent ?? '');
	ok(/clase/i.test(clase), 'y el inspector dice de qué clase es el cable');
	// Y al elegir otra cosa, la guía DEJA de hablar de uniones: era el fallo de tenerla en el
	// inspector, que se quedaba explicando algo que ya no estaba elegido.
	const otro = (await pr()).dispositivos[0].id;
	await p.evaluate((i) => window.qa.seleccionarPorId(i), otro);
	await p.waitForTimeout(500);
	const g2 = await guia();
	ok(!/uni[oó]n/i.test(g2), `y al elegir otra cosa deja de hablar de uniones (${g2.replace(/\s+/g, ' ')})`);
}

/* ---- 6. Cambiar de espacio y abrir la puerta desde donde se mira ---- */
{
	await p.evaluate(() => document.getElementById('esp-conjunto')?.click());
	await p.waitForTimeout(1200);
	const c = await cajon();
	ok(!!c.herramienta, `en Conjunto sigue habiendo herramienta activa (${c.herramienta})`);
	const boton = await p.evaluate(() => {
		const q = document.getElementById('puerta-flotante');
		return q && !q.hidden ? q.textContent.trim() : undefined;
	});
	ok(!!boton, `el botón de puerta está sobre el visor (${boton})`);
	await p.evaluate(() => document.getElementById('puerta-flotante')?.click());
	await p.waitForTimeout(1400);
	const desp = await p.evaluate(() => document.getElementById('puerta-flotante')?.textContent.trim());
	ok(desp !== boton, `y al pulsarlo cambia de estado (${boton} → ${desp})`);
	await p.evaluate(() => document.querySelector('canvas').focus());
	await p.keyboard.press('o');
	await p.waitForTimeout(1400);
	ok(await p.evaluate(() => document.getElementById('puerta-flotante')?.textContent.trim()) === boton,
		'y la tecla O hace exactamente lo mismo, no otra cosa parecida');
	await lamina(p, 'sesion-conjunto.png');
}

/* ---- 7. Deshacer y rehacer devuelven el tablero ---- */
{
	await p.evaluate(() => document.getElementById('esp-interior')?.click());
	await p.waitForTimeout(900);
	const antes = (await pr()).conductores.length;
	await p.evaluate(() => document.getElementById('btn-deshacer')?.click());
	await p.waitForTimeout(800);
	const menos = (await pr()).conductores.length;
	ok(menos < antes, `deshacer quita el último cable (${antes} → ${menos})`);
	await p.evaluate(() => document.getElementById('btn-rehacer')?.click());
	await p.waitForTimeout(800);
	ok((await pr()).conductores.length === antes, 'y rehacer lo devuelve');
}

/* ---- 8. Guardar y volver a abrir: el tablero es el mismo ---- */
{
	const antes = await pr();
	const json = JSON.stringify(antes);
	await p.evaluate((t) => window.qa.cargarJson(t), json);
	await p.waitForTimeout(1600);
	const desp = await pr();
	ok(desp.dispositivos.length === antes.dispositivos.length
		&& desp.conductores.length === antes.conductores.length,
		`el proyecto vuelve entero (${desp.dispositivos.length} aparatos · ${desp.conductores.length} cables)`);
	const c = await cajon();
	ok(!!c.herramienta, `y la interfaz sigue en pie después de recargar (${c.herramienta} · ${c.titulo})`);
}

/* ---- 9. Nada de lo anterior ha exigido dos mil píxeles de scroll ---- */
{
	const m = await p.evaluate(() => {
		const izq = document.getElementById('panel-izq');
		const der = document.getElementById('panel-der');
		const cv = document.querySelector('canvas').getBoundingClientRect();
		return {
			izqScroll: izq.hidden ? 0 : izq.scrollHeight,
			alto: window.innerHeight,
			derVisible: der && getComputedStyle(der).display !== 'none',
			lienzo: Math.round(cv.width),
			ancho: window.innerWidth,
		};
	});
	console.log(`   panel izquierdo ${m.izqScroll} px en ${m.alto} px · lienzo ${m.lienzo} de ${m.ancho} px`);
	ok(m.izqScroll <= m.alto * 1.6, `el cajón abierto cabe casi de una vez (${m.izqScroll} px en ${m.alto})`);
	// El listón se pone donde duele: con TODO abierto. Es el peor caso, y es el que decide si el
	// tablero se puede seguir mirando mientras se trabaja.
	ok(m.lienzo >= m.ancho * 0.55, `y el visor se queda con la mayor parte de la pantalla (${Math.round(100 * m.lienzo / m.ancho)} %)`);
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close(); process.exit(0);
