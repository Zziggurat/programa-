/**
 * QA de dos cosas que se entregan al cliente: el ESQUEMA que ahora se puede ordenar a mano, y el
 * DOSSIER que no debe afirmar nada que el proyecto no declare.
 *
 * Van juntas en una sola suite porque comparten el arranque del navegador, que es lo caro.
 *
 *   node qa/esquema-dossier.mjs
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';
import { textoPdf } from './lib/texto-pdf.mjs';

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
	try {
		await page.waitForFunction(() => {
			const estado = document.getElementById('dos-estado')?.textContent ?? '';
			return /KB/.test(estado) || (estado === ''
				&& /No se pudo generar el dossier/.test(document.getElementById('dos-vista')?.textContent ?? ''));
		}, null, { timeout: 40000 });
		const estado = await page.evaluate(() => ({
			panelVisible: !document.getElementById('panel-dossier')?.hidden,
			estado: document.getElementById('dos-estado')?.textContent,
			vista: document.getElementById('dos-vista')?.textContent?.slice(0, 600),
		}));
		if (!/KB/.test(estado.estado ?? '')) throw new Error(`La vista previa falló: ${JSON.stringify(estado)}`);
	} catch (error) {
		if (!(error instanceof Error) || !error.message.startsWith('La vista previa falló:')) {
			const estado = await page.evaluate(() => ({
				panelVisible: !document.getElementById('panel-dossier')?.hidden,
				estado: document.getElementById('dos-estado')?.textContent,
				vista: document.getElementById('dos-vista')?.textContent?.slice(0, 600),
			}));
			throw new Error(`La vista previa no terminó: ${JSON.stringify(estado)}`, { cause: error });
		}
		throw error;
	}
}

/** Declara los datos desde Archivo → Datos del proyecto, igual que un usuario. */
async function guardarDatosDelProyecto(page, campos) {
	if (await page.locator('#panel-dossier').isVisible()) {
		await page.locator('#dos-cerrar').click();
		await page.locator('#panel-dossier').waitFor({ state: 'hidden' });
	}
	await page.locator('#btn-archivo').click();
	await page.locator('#btn-datos-proyecto').click();
	for (const [id, valor] of Object.entries(campos)) {
		const campo = page.locator(`#${id}`);
		if (['pr-montaje', 'pr-uso', 'pr-neutro'].includes(id)) await campo.selectOption(valor);
		else await campo.fill(valor);
	}
	await page.locator('#btn-guardar-proyecto').click();
	await page.locator('#modal-proyecto').waitFor({ state: 'hidden' });
}

const SAL = mkdtempSync(join(tmpdir(), 'tablerostudio-esquema-dossier-'));
// Solo se borra el directorio temporal creado por ESTA ejecución, nunca qa/_salida ni uno ajeno.
const temporalConfirmado = realpathSync(SAL).startsWith(resolve(tmpdir()) + sep)
	&& basename(SAL).startsWith('tablerostudio-esquema-dossier-');
if (!temporalConfirmado) throw new Error(`Ruta temporal fuera del directorio esperado: ${SAL}`);
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

let browser;
let page;
const errs = [];

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const proyecto = () => page.evaluate(() => window.qa.proyecto());

let fatal;
try {
browser = await abrirNavegador(chromium);
page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error'
	&& !/\/favicon\.ico(?:$|[?#])|favicon/i.test(`${m.location().url} ${m.text()}`))
	errs.push(`${m.text()} [${m.location().url || 'sin URL'}]`); });

await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(150);
await click('btn-empezar-ejemplo'); await page.waitForTimeout(300);
await page.locator('.tarjeta-ejemplo button').nth(0).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await click('btn-cerrar-explicacion'); await trabajarSobreCopia(page);

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
await click('esq-cerrar'); await page.waitForTimeout(300);
// El ejemplo puede traer datos: dejarlos sin declarar por el formulario real, sin mutar el modelo.
await guardarDatosDelProyecto(page, Object.fromEntries([
	'pr-cliente', 'pr-obra', 'pr-proyectista', 'pr-revision', 'pr-fecha', 'pr-fabricante',
	'pr-icc', 'pr-ambiente', 'pr-montaje', 'pr-uso', 'pr-inominal', 'pr-frecuencia',
	'pr-ip', 'pr-neutro', 'pr-notas',
].map((id) => [id, ''])));
const sinDeclarar = await proyecto();
must('IP vacío queda sin declarar', sinDeclarar.opciones?.gradoIP === undefined);
must('ficha de datos completamente vacía queda ausente', sinDeclarar.datos === undefined);
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

const texto = pdf ? textoPdf(readFileSync(pdf.destino)) : '';
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
await guardarDatosDelProyecto(page, {
	'pr-cliente': 'Aeropuerto', 'pr-obra': 'Cubierta', 'pr-proyectista': 'D.',
	'pr-fabricante': 'Taller', 'pr-icc': '10', 'pr-ambiente': '40',
	'pr-montaje': 'exento', 'pr-inominal': '63', 'pr-frecuencia': '50',
	'pr-ip': 'IP65', 'pr-neutro': 'TN-S', 'pr-uso': 'intemperie',
});
await abrirVistaPreviaDossier(page);
const pdf2 = await bajar('dos-descargar');
const texto2 = pdf2 ? textoPdf(readFileSync(pdf2.destino)) : '';
must('ya no queda nada pendiente',
	texto2.includes('declara todos los datos necesarios'),
	(texto2.match(/Pendiente de declarar \([^)]*\)/) ?? ['(ninguno)'])[0]);
must('la placa dice que el tablero va a la intemperie',
	texto2.includes('Uso previsto A la intemperie'));
must('y el balance térmico ya no marca nada como supuesto', !/SUPUEST/.test(texto2));

console.log('\n--- 6. Sin errores ---');
must('ningún error de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (error) {
	fatal = error;
	console.error('FATAL en QA esquema/dossier:', error);
	if (errs.length) console.error('Errores JavaScript:', errs.join(' | '));
	if (page && String(error).includes('El proyecto cambió mientras se preparaba el documento')) {
		const diferencias = await page.evaluate(() => {
			const actual = JSON.parse(JSON.stringify(window.qa.proyecto()));
			const guardado = JSON.parse(JSON.stringify(window.qa.documentoActivo()?.proyecto ?? null));
			const halladas = [];
			const caminar = (a, b, ruta) => {
				if (halladas.length >= 10 || Object.is(a, b)) return;
				if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
					halladas.push({ ruta, actual: JSON.stringify(a)?.slice(0, 100), guardado: JSON.stringify(b)?.slice(0, 100) });
					return;
				}
				for (const clave of new Set([...Object.keys(a), ...Object.keys(b)])) caminar(a[clave], b[clave], `${ruta}.${clave}`);
			};
			caminar(actual, guardado, 'proyecto');
			return halladas;
		});
		console.error('Primeras diferencias modelo/documento confirmado:', diferencias);
	}
} finally {
	try { await browser?.close(); } catch (error) { fatal ??= error; console.error('Chromium no cerró:', error); }
	await new Promise((resolve) => server.close(resolve));
	rmSync(SAL, { recursive: true, force: true });
}
console.log(`\n=== ${fatal ? 'ERROR FATAL ✗' : fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exitCode = fallos === 0 && !fatal ? 0 : 1;
