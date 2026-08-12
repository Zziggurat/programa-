/**
 * CAMBIAR DE TABLERO CON EL TABLERO ENERGIZADO.
 *
 * Al buscar por qué «el programa se cierra al ir intercambiando entre tableros» probé treinta
 * cambios seguidos y no se cerró: la memoria se quedaba en 38 MB, el contexto 3D aguantaba y no
 * saltaba ni un error. Pero esos treinta cambios los hice con el tablero SIN tensión, que es la
 * mitad de la historia. La otra mitad es la que hace cualquiera que esté aprendiendo: energiza el
 * arranque directo, aprieta MARCHA, ve girar el motor, y desde ahí —sin quitar la tensión, porque
 * ¿para qué?— se va a mirar el estrella-triángulo.
 *
 * Y por ahí sí hay algo. La simulación guarda tres cosas entre pasada y pasada:
 *
 *   · `estadoSim`      la posición de cada mando: pulsado, abierto, DISPARADO
 *   · `activosPrevios` la MEMORIA del circuito: qué bobinas estaban metidas (la autorretención)
 *   · `relojSim`       el cronómetro de la maniobra
 *
 * Todas están indexadas por el id del aparato, y ninguna se vacía cuando el tablero cambia entero.
 * Así que la pregunta que hace esta prueba es simple: al abrir el segundo ejemplo, ¿llega limpio,
 * o llega con la memoria del primero puesta?
 *
 *   node qa/cambio-energizado.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

const errores = [];
p.on('pageerror', (e) => errores.push(`${e.message}`));

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(300);

/** Abre el ejemplo nº `i` de la biblioteca y deja el tablero sin ventanas encima. */
async function abrirEjemplo(i) {
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(500);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(400);
		await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
		await p.waitForTimeout(500);
	}
	await p.locator('.tarjeta-ejemplo button').nth(i).click();
	await p.waitForTimeout(1600);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(500);
	}
	await p.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
	await p.waitForTimeout(400);
	return qa('proyecto');
}

async function energizar() {
	if (!(await qa('simulacion')).energizado) {
		await p.evaluate(() => document.getElementById('btn-energizar')?.click());
		await p.waitForTimeout(900);
	}
	return qa('simulacion');
}

/* ------------------------------------------------------------------ */

console.log('### 1 · arranque directo, con tensión y en marcha');

const uno = await abrirEjemplo(0);
must('CONDICIÓN PREVIA: el arranque directo está en pantalla', uno.dispositivos.length > 5,
	`${uno.dispositivos.length} aparatos`);

await energizar();
must('CONDICIÓN PREVIA: el tablero coge tensión', (await qa('simulacion')).energizado);

// MARCHA. Se direcciona por id: `s1` es el pulsador de marcha, `s0` el de paro.
await qa('accionar', 's1');
await p.waitForTimeout(800);
const marchando = await qa('simulacion');
must('CONDICIÓN PREVIA: MARCHA mete KM1 y arranca el motor',
	marchando.activos.includes('km1') && marchando.activos.includes('m1'),
	marchando.activos.join(' '));

const mandosAntes = await qa('estadoSim');
const idsDelPrimero = new Set(uno.dispositivos.map((d) => d.id));
console.log(`     mandos con estado guardado: ${mandosAntes.length ? mandosAntes.map((m) => m.id).join(' ') : '(ninguno)'}`);

/* ------------------------------------------------------------------ */

console.log('\n### 2 · sin quitar la tensión, se abre el estrella-triángulo');

const dos = await abrirEjemplo(2);
must('el estrella-triángulo está en pantalla', dos.dispositivos.some((d) => d.id === 'km3'),
	`${dos.dispositivos.length} aparatos`);

const trasCambiar = await qa('simulacion');
const mandosDespues = await qa('estadoSim');
const idsDelSegundo = new Set(dos.dispositivos.map((d) => d.id));

/*
 * LO QUE NO PUEDE PASAR (1): que queden mandos accionados de un tablero que ya no está.
 *
 * Un id que estaba en el primer ejemplo y NO está en el segundo es basura: nadie lo va a poder
 * soltar nunca, porque el aparato no existe. Y si el segundo ejemplo reutiliza el id —que es
 * justo lo que pasa aquí, los dos tienen un `km1` y un `s1`— entonces no es basura, es peor:
 * el mando del tablero nuevo aparece accionado sin que nadie lo haya tocado.
 */
const huerfanos = mandosDespues.filter((m) => !idsDelSegundo.has(m.id));
const heredados = mandosDespues.filter((m) => idsDelSegundo.has(m.id) && idsDelPrimero.has(m.id));
must('no quedan mandos de un tablero que ya no está', huerfanos.length === 0,
	huerfanos.map((m) => m.id).join(' '));
must('el tablero nuevo no llega con mandos ya accionados', heredados.length === 0,
	heredados.map((m) => `${m.id}=${JSON.stringify(m)}`).join(' '));

/*
 * LO QUE NO PUEDE PASAR (2): que el tablero nuevo llegue funcionando solo.
 *
 * Nadie ha apretado MARCHA en el estrella-triángulo. Si algo está metido, viene de la memoria del
 * anterior, y lo que se ve es un tablero que arranca solo al abrirlo.
 */
must('nada está funcionando: nadie ha apretado MARCHA todavía',
	!trasCambiar.activos.includes('km1') && !trasCambiar.activos.includes('m1'),
	`activos: ${trasCambiar.activos.join(' ') || '(nada)'}`);

/*
 * LO QUE NO PUEDE PASAR (3): que el cronómetro venga corrido.
 *
 * El estrella-triángulo pasa a triángulo a los 6 s CONTADOS DESDE QUE SE APRIETA MARCHA. Si el
 * reloj sigue donde lo dejó el ejemplo anterior, el temporizador ya nace vencido: se aprieta
 * MARCHA y entra el triángulo de golpe, sin pasar por la estrella. El ejemplo deja de enseñar
 * justo lo único que tiene que enseñar.
 */
const cronometro = await p.evaluate(() => document.getElementById('sim-transcurrido')?.textContent ?? '');
console.log(`     cronómetro tras cambiar: ${cronometro}`);

/* ------------------------------------------------------------------ */

console.log('\n### 3 · y el estrella-triángulo tiene que seguir enseñando la estrella');

await energizar();
await qa('accionar', 's1');
await p.waitForTimeout(900);
const arranque = await qa('simulacion');
must('MARCHA mete la ESTRELLA (KM1 y KM2), no el triángulo',
	arranque.activos.includes('km1') && arranque.activos.includes('km2') && !arranque.activos.includes('km3'),
	arranque.activos.join(' '));

console.log(`\nerrores de JavaScript: ${errores.length}${errores.length ? '\n  ' + errores.join('\n  ') : ''}`);
must('ni un error de JavaScript en todo el recorrido', errores.length === 0, errores.join(' | '));

await b.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
