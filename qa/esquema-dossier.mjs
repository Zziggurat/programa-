/**
 * QA de dos cosas que se entregan al cliente: el ESQUEMA que ahora se puede ordenar a mano, y el
 * DOSSIER que no debe afirmar nada que el proyecto no declare.
 *
 * Van juntas en una sola suite porque comparten el arranque del navegador, que es lo caro.
 *
 *   node qa/esquema-dossier.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { abrirNavegador, ejecutablePython, servidorDeQA } from './lib/entorno.mjs';

/**
 * El dossier ya no se descarga de golpe: el botón 📄 abre la VISTA PREVIA, y se descarga desde
 * ella. Este ayudante recorre ese camino, que es el que hace ahora cualquiera.
 *
 * Se borra antes el indicador de tamaño para no dar por buena la generación ANTERIOR: si no, al
 * abrir la vista previa por segunda vez la espera terminaría al instante con el PDF de antes.
 */
async function abrirVistaPreviaDossier(page) {
	await page.evaluate(() => {
		const e = document.getElementById('dos-estado');
		if (e) e.textContent = '';
		document.getElementById('btn-pdf').click();
	});
	await page.waitForFunction(
		() => /KB/.test(document.getElementById('dos-estado')?.textContent ?? ''),
		{ timeout: 40000 },
	);
}

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const proyecto = () => page.evaluate(() => window.qa.proyecto());

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(150);
await click('btn-empezar-ejemplo'); await page.waitForTimeout(300);
await page.locator('.tarjeta-ejemplo button').nth(0).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await click('btn-cerrar-explicacion'); await page.waitForTimeout(200);

console.log('--- 1. El esquema se abre y se puede ordenar a mano ---');
await click('btn-esquema'); await page.waitForTimeout(700);
must('el esquema se abre', await page.isVisible('#panel-esquema'));
const simbolos = await page.locator('#esquema-hoja [data-dispositivo]').count();
must('dibuja los aparatos', simbolos > 2, `${simbolos} símbolos`);
must('nada está colocado a mano al empezar',
	(await proyecto()).dispositivos.every((d) => !d.esquema));

// Se arrastra el primer símbolo a otro sitio de la hoja.
const objetivo = page.locator('#esquema-hoja [data-dispositivo]').first();
const id = await objetivo.getAttribute('data-dispositivo');
const antes = await objetivo.boundingBox();
const hoja = await page.locator('#esquema-hoja').boundingBox();
await page.mouse.move(antes.x + antes.width / 2, antes.y + antes.height / 2);
await page.mouse.down();
await page.mouse.move(hoja.x + hoja.width * 0.72, hoja.y + hoja.height * 0.62, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);

const p1 = await proyecto();
const movido = p1.dispositivos.find((d) => d.id === id);
must('el aparato arrastrado queda colocado a mano', !!movido?.esquema,
	JSON.stringify(movido?.esquema));
must('y solo ese: los demás siguen ordenándose solos',
	p1.dispositivos.filter((d) => d.esquema).length === 1);
const despues = await page.locator(`#esquema-hoja [data-dispositivo="${id}"]`).boundingBox();
must('el símbolo se ha movido de verdad en la hoja',
	Math.abs(despues.x - antes.x) > 20 || Math.abs(despues.y - antes.y) > 20,
	`${Math.round(antes.x)},${Math.round(antes.y)} → ${Math.round(despues.x)},${Math.round(despues.y)}`);
must('se cae en la rejilla, no en cualquier punto',
	Number.isInteger(movido.esquema.columna) && Number.isInteger(movido.esquema.fila),
	JSON.stringify(movido.esquema));

console.log('\n--- 2. Deshacer y volver a ordenar solo ---');
await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
must('Ctrl+Z deshace la colocación',
	(await proyecto()).dispositivos.every((d) => !d.esquema));
await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
must('Ctrl+Y la devuelve',
	(await proyecto()).dispositivos.filter((d) => d.esquema).length === 1);

must('el botón dice cuántas hay a mano',
	(await page.textContent('#esq-auto')).includes('(1)'), await page.textContent('#esq-auto'));
await click('esq-auto'); await page.waitForTimeout(300);
must('pide confirmación antes de soltarlas', await page.isVisible('#modal-dialogo'));
await click('dialogo-ok'); await page.waitForTimeout(400);
must('«Ordenar solo» deja el esquema automático otra vez',
	(await proyecto()).dispositivos.every((d) => !d.esquema));

console.log('\n--- 3. Columnas por hoja y título ---');
await page.fill('#esq-columnas', '5');
await page.dispatchEvent('#esq-columnas', 'change');
await page.waitForTimeout(500);
must('cambiar las columnas cambia el proyecto',
	(await proyecto()).esquema?.columnasPorHoja === 5);
const hojasCon5 = await page.textContent('#esq-indicador');
must('y reparte el esquema en más hojas', /\/\s*[2-9]/.test(hojasCon5), hojasCon5);
await page.fill('#esq-columnas', '10');
await page.dispatchEvent('#esq-columnas', 'change');
await page.waitForTimeout(400);

console.log('\n--- 4. El dossier no afirma lo que nadie ha declarado ---');
// Se deja el proyecto sin declarar NADA, que es como empieza cualquiera.
await page.evaluate(() => { window.qa.proyecto().opciones = {}; window.qa.proyecto().datos = {}; });
await click('esq-cerrar'); await page.waitForTimeout(300);
const bajar = async (id) => {
	const esperado = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
	await click(id);
	const d = await esperado;
	if (!d) return undefined;
	const destino = join(SAL, d.suggestedFilename());
	await d.saveAs(destino);
	return { nombre: d.suggestedFilename(), destino };
};
await abrirVistaPreviaDossier(page);
const pdf = await bajar('dos-descargar');
must('el dossier se descarga con su nombre completo', !!pdf && /\.pdf$/i.test(pdf.nombre),
	pdf?.nombre ?? '(no descargó)');

const texto = pdf ? execFileSync(ejecutablePython(), [join(AQUI, 'leer-pdf.py'), pdf.destino]).toString() : '';
must('trae la página de procedencia de los datos', texto.includes('Procedencia de los datos'));
must('lista lo que falta por declarar', /Pendiente de declarar \(\d+\)/.test(texto),
	(texto.match(/Pendiente de declarar \([^)]*\)/) ?? [''])[0]);
must('la placa de características NO se inventa el uso previsto',
	texto.includes('Uso previsto a declarar'),
	(texto.match(/Uso previsto[^A-Z]{0,30}/) ?? [''])[0]);
must('ni la frecuencia', texto.includes('Frecuencia asignada a declarar'));
must('ni la temperatura ambiente', texto.includes('Temperatura ambiente de proyecto a declarar'));
must('el balance térmico avisa de que el montaje es supuesto',
	/SUPUESTO, sin declarar/.test(texto));
must('y dice de dónde sale lo que sí está declarado',
	texto.includes('Declarado y comprobado'));

console.log('\n--- 5. Declarando los datos, el dossier deja de decir «a declarar» ---');
await page.evaluate(() => {
	const p = window.qa.proyecto();
	p.datos = { cliente: 'Aeropuerto', obra: 'Cubierta', proyectista: 'D.', fabricante: 'Taller' };
	p.opciones = {
		iccPresuntaKA: 10, temperaturaAmbienteC: 40, montajeGabinete: 'exento',
		corrienteAsignadaA: 63, frecuenciaHz: 50, gradoIP: 'IP65',
		regimenNeutro: 'TN-S', usoPrevisto: 'intemperie',
	};
});
await abrirVistaPreviaDossier(page);
const pdf2 = await bajar('dos-descargar');
const texto2 = pdf2 ? execFileSync(ejecutablePython(), [join(AQUI, 'leer-pdf.py'), pdf2.destino]).toString() : '';
must('ya no queda nada pendiente',
	texto2.includes('declara todos los datos necesarios'),
	(texto2.match(/Pendiente de declarar \([^)]*\)/) ?? ['(ninguno)'])[0]);
must('la placa dice que el tablero va a la intemperie',
	texto2.includes('Uso previsto A la intemperie'));
must('y el balance térmico ya no marca nada como supuesto', !/SUPUEST/.test(texto2));

console.log('\n--- 6. Sin errores ---');
must('ningún error de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
