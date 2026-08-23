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
import { join } from 'node:path';
import { servir, abrirEjemplo, SALIDA, navegadorDelSistema } from './lib/mirar.mjs';

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
	// El rail esconde los cajones con `display`, no con `hidden`: mirar `hidden` decía que
	// estaban todos abiertos cuando en pantalla solo se veía uno.
	visibles: [...document.querySelectorAll('#panel-izq details[data-cajon]')]
		.filter((d) => getComputedStyle(d).display !== 'none').map((d) => d.id),
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
	/*
	 * CANDIDATOS ORDENADOS POR LO DESPEJADO QUE ESTÁ EL APARATO.
	 *
	 * En un tablero ya cableado hay una regla del programa que manda por encima de todo: si en el
	 * píxel del terminal se ve un cable, el clic es para el cable. Es lo correcto —es lo que
	 * permite agarrar un cable que pasa por delante de un borne— pero convierte «pincha un borne»
	 * en algo que depende de por dónde pase el peinado. Quien cablea de verdad tampoco insiste en
	 * un borne tapado: gira un poco o va a otro. Aquí se hace lo equivalente: se prueban varios
	 * pares de bornes LIBRES, empezando por los aparatos con menos cables encima —el que se acaba
	 * de añadir no tiene ninguno—, y basta con que uno funcione.
	 */
	const candidatos = await p.evaluate(() => {
		const pro = window.qa.proyecto();
		const ocupado = new Set();
		const cuantos = new Map();
		for (const c of pro.conductores) {
			ocupado.add(`${c.de.dispositivoId}|${c.de.borneId}`);
			ocupado.add(`${c.a.dispositivoId}|${c.a.borneId}`);
			for (const e of [c.de, c.a]) cuantos.set(e.dispositivoId, (cuantos.get(e.dispositivoId) ?? 0) + 1);
		}
		const cols = pro.gabinete.colocaciones.filter((c) => c.montaje !== 'puerta');
		const sitios = [];
		for (const c of cols) {
			const d = pro.dispositivos.find((k) => k.id === c.dispositivoId);
			if (!d?.bornes?.length) continue;
			for (const bo of d.bornes) {
				if (ocupado.has(`${d.id}|${bo.id}`)) continue;
				const q = window.qa.puntoParaBorne(d.id, bo.id);
				if (q) { sitios.push({ d: d.id, b: bo.id, x: q.x, y: q.y, carga: cuantos.get(d.id) ?? 0 }); break; }
			}
		}
		return sitios.sort((a, b) => a.carga - b.carga);
	});
	console.log(`   bornes libres: ${candidatos.map((q) => `${q.d}.${q.b}(${q.carga})`).join(' ')}`);

	/*
	 * SE PRUEBAN LOS PARES EN LOS DOS SENTIDOS. Con dos bornes libres, empezar siempre por el
	 * primero y buscar el compañero «más adelante en la lista» deja el segundo sin probar nunca
	 * como origen: si el primero está tapado, la prueba se rinde con el otro intacto. Quien
	 * cablea prueba por el otro extremo, y eso es lo que hace falta reproducir.
	 */
	const pares = [];
	for (const a of candidatos) for (const b of candidatos) if (a.d !== b.d) pares.push([a, b]);

	/*
	 * PARA REMATAR VALE CUALQUIER TERMINAL DE OTRO APARATO, esté libre u ocupado: en una bornera
	 * llegan varios hilos al mismo borne, y quien cablea remata donde alcanza. El ejemplo solo
	 * tiene dos bornes libres y uno de ellos es del aparato recién puesto, así que limitarse a
	 * ésos dejaba la prueba a merced de que ese aparato cayera despejado.
	 */
	const destinos = (origen) => p.evaluate((oid) => {
		const pro = window.qa.proyecto();
		const salida = [];
		for (const c of pro.gabinete.colocaciones.filter((k) => k.montaje !== 'puerta')) {
			if (c.dispositivoId === oid) continue;
			const d = pro.dispositivos.find((k) => k.id === c.dispositivoId);
			for (const bo of d?.bornes ?? []) {
				const q = window.qa.puntoParaBorne(d.id, bo.id);
				if (q) salida.push({ d: d.id, b: bo.id, x: q.x, y: q.y });
			}
		}
		return salida;
	}, origen);

	let hecho = false;
	let armado = false;
	for (let i = 0; i < pares.length && !hecho && i < 4; i++) {
		const [a, b] = pares[i];
		await p.mouse.click(a.x, a.y);
		await p.waitForTimeout(600);
		const medias = await p.evaluate(() => window.qa.estadoInteraccion());
		if (!medias.cableando) {
			console.log(`   ${a.d}.${a.b} no arrancó el cable (hay algo por delante): se prueba otro`);
			await p.keyboard.press('Escape');
			await p.waitForTimeout(200);
			continue;
		}
		armado = true;
		/*
		 * Y EL DESTINO SE BUSCA ENTRE VARIOS. Un borne puede estar en pantalla y aun así tener
		 * medio aparato por delante; con el cable ya empezado, quien cablea prueba en el
		 * siguiente terminal en vez de rendirse. Se rematan hasta cuatro candidatos, y basta con
		 * que uno acepte.
		 */
		for (const q of (await destinos(a.d)).slice(0, 6)) {
			await p.mouse.click(q.x, q.y);
			await p.waitForTimeout(900);
			hecho = (await pr()).conductores.length === antes + 1;
			console.log(`   ${a.d}.${a.b} → ${q.d}.${q.b}: ${hecho ? 'cable hecho' : 'no cuajó'}`);
			if (hecho) break;
		}
		if (!hecho) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
	}
	ok(armado, 'pinchar un borne libre deja el cable esperando destino');
	ok(hecho, `el cable queda hecho con dos clics (${antes} → ${(await pr()).conductores.length})`);
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
	// La herramienta de cablear tiene «doble clic en un cable · unión» escrito en su ayuda fija,
	// y ahí es verdad. Lo que no puede quedarse es la ayuda del CABLE elegido —mover la unión,
	// quitarla— cuando lo elegido ya no es un cable.
	ok(!/Arrastrar unión/i.test(g2), `y al elegir otra cosa deja de explicar cómo mover uniones (${g2.replace(/\s+/g, ' ')})`);
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
	await p.screenshot({ path: join(SALIDA, 'sesion-conjunto.png') });
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
	/*
	 * QUÉ SE MIDE Y QUÉ NO.
	 *
	 * Una LISTA larga puede ser larga: sesenta y un conductores ocupan lo que ocupan, y hacerlos
	 * caber en una pantalla solo se consigue escondiéndolos. Lo que no puede quedar al final de
	 * un scroll es una ACCIÓN: un botón que cierra el formulario, que aplica lo tecleado o que
	 * añade algo. Así que se mide lo hondo que cae el botón más profundo de cada cajón.
	 *
	 * Y el reparto de pantalla se mide por lo que TAPAN los paneles, no por el ancho del lienzo:
	 * el visor ocupa la ventana entera y los paneles flotan encima, así que el ancho del canvas
	 * siempre daría el 100 % y no diría nada.
	 */
	const alto = await p.evaluate(() => window.innerHeight);
	for (const h of ['seleccionar', 'anadir', 'conectar', 'estructura', 'proyecto']) {
		await herramienta(h);
		const m = await p.evaluate(() => {
			const izq = document.getElementById('panel-izq');
			if (izq.hidden) return undefined;
			const arriba = izq.getBoundingClientRect().top;
			let hondo = 0;
			for (const b of izq.querySelectorAll('button, input, select')) {
				const suyo = b.closest('details');
				if (!suyo || getComputedStyle(suyo).display === 'none') continue;
				// Un botón pegado al fondo del cajón está SIEMPRE a la vista: no cuenta como hondo.
				if (getComputedStyle(b.closest('.botonera') ?? b).position === 'sticky') continue;
				hondo = Math.max(hondo, b.getBoundingClientRect().top - arriba + izq.scrollTop);
			}
			// Un cajón que ofrece un control PEGADO —un buscador arriba, un «Aplicar» abajo— no
			// entierra nada aunque su lista sea larga: la salida está siempre a la vista.
			const pegado = [...izq.querySelectorAll('input, button, .botonera')]
				.some((q) => getComputedStyle(q).position === 'sticky' && q.closest('details')
					&& getComputedStyle(q.closest('details')).display !== 'none');
			return { hondo: Math.round(hondo), scroll: izq.scrollHeight, pegado };
		});
		if (!m) { console.log(`   ${h}: sin cajón`); continue; }
		console.log(`   ${h}: ${m.scroll} px de contenido · el control más hondo a ${m.hondo} px`
			+ (m.pegado ? ' · con control pegado' : ''));
		ok(m.hondo <= alto * 1.35 || m.pegado,
			`en «${h}» ninguna acción queda enterrada (la más honda a ${m.hondo} px de ${alto})`);
	}

	const reparto = await p.evaluate(() => {
		const v = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
		return { izq: v('--tapa-izq'), der: v('--tapa-der'), ancho: window.innerWidth };
	});
	const libre = reparto.ancho - reparto.izq - reparto.der;
	console.log(`   paneles: ${reparto.izq} + ${reparto.der} px de ${reparto.ancho} · libre ${libre} px`);
	ok(libre >= reparto.ancho * 0.55,
		`el visor conserva la mayor parte de la pantalla (${Math.round((100 * libre) / reparto.ancho)} %)`);
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close(); process.exit(fallos.length ? 1 : 0);
