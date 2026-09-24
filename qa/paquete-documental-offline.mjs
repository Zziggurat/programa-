/** DOC-02: el ZIP descargado por una persona se extrae y se consulta sin servidor ni red. */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor, browser, page, contextoOffline, temporal;
let fallos = 0, comprobaciones = 0;
const erroresJS = [], solicitudesExternas = [];
const debugLog = join(process.cwd(), 'debug.log');
const debugLogExistia = existsSync(debugLog);
const chromeLogAnterior = process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';

function comprobar(nombre, correcto, detalle = '') {
	comprobaciones++;
	if (!correcto) fallos++;
	console.log(`${correcto ? 'OK  ' : 'FAIL'}  ${nombre}${detalle ? ` → ${detalle}` : ''}`);
}

function crc32(bytes) {
	let valor = 0xffffffff;
	for (const byte of bytes) {
		valor ^= byte;
		for (let i = 0; i < 8; i++) valor = valor & 1 ? (valor >>> 1) ^ 0xedb88320 : valor >>> 1;
	}
	return (valor ^ 0xffffffff) >>> 0;
}

/** Lector independiente del escritor de producción: inspecciona el directorio central y cada cabecera local. */
function extraerZipStore(bytes, destino) {
	const minimo = Math.max(0, bytes.length - 65557);
	let fin = -1;
	for (let i = bytes.length - 22; i >= minimo; i--) {
		if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
			fin = i; break;
		}
	}
	if (fin < 0) throw new Error('No se encontró un directorio central ZIP íntegro.');
	const numero = bytes.readUInt16LE(fin + 10);
	const largo = bytes.readUInt32LE(fin + 12);
	const inicioCentral = bytes.readUInt32LE(fin + 16);
	if (bytes.readUInt16LE(fin + 4) !== 0 || bytes.readUInt16LE(fin + 6) !== 0
		|| bytes.readUInt16LE(fin + 8) !== numero || inicioCentral + largo !== fin) {
		throw new Error('ZIP multidisco o directorio central inconsistente.');
	}
	const archivos = new Map();
	let p = inicioCentral;
	for (let i = 0; i < numero; i++) {
		if (p + 46 > fin || bytes.readUInt32LE(p) !== 0x02014b50) throw new Error('Entrada central ZIP inválida.');
		const banderas = bytes.readUInt16LE(p + 8), metodo = bytes.readUInt16LE(p + 10);
		const crc = bytes.readUInt32LE(p + 16), comprimido = bytes.readUInt32LE(p + 20);
		const largoReal = bytes.readUInt32LE(p + 24), nombreLargo = bytes.readUInt16LE(p + 28);
		const extraLargo = bytes.readUInt16LE(p + 30), comentarioLargo = bytes.readUInt16LE(p + 32);
		const desplazamiento = bytes.readUInt32LE(p + 42);
		const finEntrada = p + 46 + nombreLargo + extraLargo + comentarioLargo;
		if (finEntrada > fin || banderas !== 0x0800 || metodo !== 0 || comprimido !== largoReal) {
			throw new Error('Entrada ZIP fuera de límites, cifrada o no STORE.');
		}
		const nombre = bytes.subarray(p + 46, p + 46 + nombreLargo).toString('utf8');
		const partes = nombre.split('/');
		if (!nombre || nombre.startsWith('/') || nombre.includes('\\') || partes.some(x => !x || x === '.' || x === '..' || x.includes(':'))
			|| archivos.has(nombre.toLowerCase())) throw new Error(`Ruta ZIP insegura o duplicada: ${nombre}`);
		if (desplazamiento + 30 > inicioCentral || bytes.readUInt32LE(desplazamiento) !== 0x04034b50
			|| bytes.readUInt16LE(desplazamiento + 6) !== banderas
			|| bytes.readUInt16LE(desplazamiento + 8) !== metodo
			|| bytes.readUInt32LE(desplazamiento + 14) !== crc
			|| bytes.readUInt32LE(desplazamiento + 18) !== comprimido
			|| bytes.readUInt32LE(desplazamiento + 22) !== largoReal) {
			throw new Error(`Cabecera local inconsistente: ${nombre}`);
		}
		const localNombre = bytes.readUInt16LE(desplazamiento + 26);
		const localExtra = bytes.readUInt16LE(desplazamiento + 28);
		const inicioDatos = desplazamiento + 30 + localNombre + localExtra;
		if (inicioDatos + largoReal > inicioCentral
			|| bytes.subarray(desplazamiento + 30, desplazamiento + 30 + localNombre).toString('utf8') !== nombre) {
			throw new Error(`Contenido local fuera de límites: ${nombre}`);
		}
		const contenido = bytes.subarray(inicioDatos, inicioDatos + largoReal);
		if (crc32(contenido) !== crc) throw new Error(`CRC ZIP inválido: ${nombre}`);
		const ruta = resolve(destino, ...partes);
		if (!ruta.startsWith(destino + sep)) throw new Error(`Extracción fuera del destino: ${nombre}`);
		mkdirSync(dirname(ruta), { recursive: true });
		writeFileSync(ruta, contenido);
		archivos.set(nombre.toLowerCase(), { nombre, contenido });
		p = finEntrada;
	}
	if (p !== fin) throw new Error('Bytes sobrantes en el directorio central ZIP.');
	return archivos;
}

async function abrirEjemplo() {
	const click = async id => page.locator(`#${id}`).click();
	if (await page.locator('#inicio').isVisible().catch(() => false)) await click('inicio-ejemplos');
	else { await click('btn-aprender'); await click('btn-ejemplos'); }
	await page.locator('#modal-ejemplos').waitFor({ state: 'visible' });
	await page.locator('.tarjeta-ejemplo', { hasText: 'Fixture V7: proyecto sano' })
		.first().getByRole('button', { name: /Abrir y estudiar/i }).click();
	await Promise.race([
		page.locator('#modal-dialogo').waitFor({ state: 'visible', timeout: 1200 }).catch(() => false),
		page.waitForFunction(() => window.qa.proyecto().nombre === 'Fixture V7 — proyecto sano', null, { timeout: 1200 }).catch(() => false),
	]);
	if (await page.locator('#modal-dialogo').isVisible().catch(() => false)) await click('dialogo-ok');
	await page.waitForFunction(() => window.qa.proyecto().nombre === 'Fixture V7 — proyecto sano', null, { timeout: 30000 });
	if (await page.locator('#modal-explicacion').isVisible().catch(() => false)) await click('btn-cerrar-explicacion');
}

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	browser = await abrirNavegador(chromium);
	page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
	page.on('pageerror', error => erroresJS.push(`editor: ${error.message}`));
	page.on('console', mensaje => {
		if (mensaje.type() === 'error' && !/\/favicon\.ico(?:$|[?#])/.test(mensaje.location().url))
			erroresJS.push(`editor: ${mensaje.text()}`);
	});
	await page.goto(`${entorno.url}/?qa=1`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(page);
	await abrirEjemplo();
	await page.locator('#hta-ingenieria').click();
	await page.locator('#ingenieria-validar').click();
	await page.locator('[data-ing-view="documentacion"]').click();
	await page.locator('[data-ing-doc="prepare"]').click();
	await page.locator('.ing-doc-preview').waitFor({ state: 'visible' });
	const descarga = page.waitForEvent('download', { timeout: 120000 });
	await page.locator('[data-ing-doc="paquete"]').click();
	const evento = await descarga;
	const rutaDescarga = await evento.path();
	if (!rutaDescarga) throw new Error('La descarga del paquete no produjo un archivo.');
	const zip = readFileSync(rutaDescarga);
	comprobar('la UI descargó un ZIP no vacío', zip.length > 1024 && /\.zip$/i.test(evento.suggestedFilename()));

	const baseTemporal = resolve(tmpdir());
	temporal = resolve(mkdtempSync(join(baseTemporal, 'tablerostudio-doc02-offline-')));
	if (!temporal.startsWith(baseTemporal + sep)) throw new Error('Directorio temporal fuera del área prevista.');
	const archivos = extraerZipStore(zip, temporal);
	comprobar('ZIP estándar íntegro: directorio central, cabeceras locales y CRC', archivos.size >= 15, `${archivos.size} entradas`);
	const manifiesto = JSON.parse(archivos.get('manifiesto.json')?.contenido.toString('utf8') ?? 'null');
	comprobar('manifiesto de una revisión efímera del ejemplo', manifiesto?.formato === 'tablerostudio-paquete-documental'
		&& manifiesto.version === 1 && manifiesto.procedencia?.estado === 'efimero'
		&& typeof manifiesto.proyecto === 'string' && manifiesto.proyecto.includes('Fixture V7'));
	const rutasManifestadas = new Set(manifiesto.archivos.map(a => a.ruta.toLowerCase()));
	comprobar('manifiesto cubre todas y solo las entradas de contenido', rutasManifestadas.size === archivos.size - 1
		&& [...archivos.keys()].every(k => k === 'manifiesto.json' || rutasManifestadas.has(k)));
	const fallosHash = manifiesto.archivos.filter(a => {
		const contenido = archivos.get(a.ruta.toLowerCase())?.contenido;
		return !contenido || contenido.length !== a.bytes
			|| createHash('sha256').update(contenido).digest('hex') !== a.sha256;
	});
	comprobar('SHA-256 y tamaño exactos de todos los archivos extraídos', fallosHash.length === 0,
		fallosHash.map(a => a.ruta).join(', '));
	const requeridos = ['index.html', 'esquema/esquema.pdf', 'dossier/dossier.pdf',
		'dossier/dossier.html', 'ingenieria/informe.json', 'ingenieria/informe.html',
		'ingenieria/bom.csv', 'listas/aparatos.csv', 'listas/conexiones.csv',
		'listas/conductores.csv', 'listas/borneros.csv', 'listas/senales-io.csv',
		'listas/referencias-cruzadas.csv'];
	comprobar('paquete contiene los entregables eléctricos esenciales', requeridos.every(r => archivos.has(r)));
	comprobar('ambos PDF conservan su firma binaria', ['esquema/esquema.pdf', 'dossier/dossier.pdf']
		.every(r => archivos.get(r)?.contenido.subarray(0, 5).toString('ascii') === '%PDF-'));
	const hojas = [...archivos.keys()].filter(r => /^esquema\/hoja-\d+\.svg$/.test(r));
	comprobar('hay al menos una hoja SVG consultable', hojas.length > 0);
	const htmlSvg = [...archivos.values()].filter(a => /\.(?:html|svg)$/i.test(a.nombre));
	// La declaración xmlns="http://www.w3.org/2000/svg" identifica el vocabulario SVG;
	// no es una solicitud de red. Rechazamos referencias y CSS remotos ejecutables.
	comprobar('HTML y SVG no ejecutan scripts ni declaran recursos remotos', htmlSvg.every(a =>
		!/<script\b|(?:src|href)\s*=\s*["']\s*(?:https?:|\/\/)|@import\b|url\(\s*["']?\s*(?:https?:|\/\/)/i
			.test(a.contenido.toString('utf8'))));
	const informe = JSON.parse(archivos.get('ingenieria/informe.json').contenido.toString('utf8'));
	comprobar('informe de Ingeniería y manifiesto señalan la misma revisión',
		informe.trazabilidad?.projectId === 'EJEMPLO_EFIMERO'
		&& informe.trazabilidad?.procedencia?.estado === manifiesto.procedencia.estado
		&& informe.trazabilidad?.buildId === manifiesto.procedencia.buildId);

	// Contexto nuevo: la aplicación no participa en la lectura y ninguna petición HTTP(S) llega a la red.
	contextoOffline = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await contextoOffline.setOffline(true);
	await contextoOffline.route(/^https?:\/\//i, route => {
		solicitudesExternas.push(route.request().url()); return route.abort('internetdisconnected');
	});
	const visor = await contextoOffline.newPage();
	visor.on('pageerror', error => erroresJS.push(`offline: ${error.message}`));
	visor.on('console', mensaje => {
		if (mensaje.type() === 'error' && !/\/favicon\.ico(?:$|[?#])/.test(mensaje.location().url))
			erroresJS.push(`offline: ${mensaje.text()}`);
	});
	const local = ruta => pathToFileURL(join(temporal, ...ruta.split('/'))).href;
	await visor.goto(local('index.html'), { waitUntil: 'domcontentloaded' });
	comprobar('índice abre desde file:// sin servidor', visor.url().startsWith('file:///')
		&& /Borrador técnico para revisión profesional/.test(await visor.locator('body').innerText()));
	const enlaces = await visor.locator('a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
	comprobar('índice enlaza todas y solo las piezas locales de la revisión', enlaces.length === archivos.size - 2
		&& new Set(enlaces.map(r => r.toLowerCase())).size === enlaces.length
		&& enlaces.every(r => archivos.has(r.toLowerCase()) && !/^[a-z]+:|^\/|\.\./i.test(r)));
	await visor.locator(`a[href="${hojas[0]}"]`).click();
	comprobar('hoja SVG se abre desde el enlace real del índice', visor.url() === local(hojas[0])
		&& await visor.locator('svg').count() === 1);
	for (const ruta of ['dossier/dossier.html', 'ingenieria/informe.html']) {
		await visor.goto(local(ruta), { waitUntil: 'domcontentloaded' });
		comprobar(`${ruta} legible fuera de la aplicación`, (await visor.locator('body').innerText()).length > 200);
	}
	comprobar('la lectura offline no requirió solicitudes HTTP(S)', solicitudesExternas.length === 0,
		solicitudesExternas.slice(0, 3).join(', '));
	comprobar('sin errores JavaScript en editor ni sesión limpia', erroresJS.length === 0,
		erroresJS.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(`ERROR NO CONTROLADO: ${error?.stack ?? error}`);
} finally {
	try { await contextoOffline?.close(); } catch (e) { fallos++; console.error(e); }
	try { await page?.close(); } catch (e) { fallos++; console.error(e); }
	try { await browser?.close(); } catch (e) { fallos++; console.error(e); }
	if (servidor) try { servidor.closeAllConnections?.(); await new Promise((ok, no) => servidor.close(e => e ? no(e) : ok())); }
	catch (e) { fallos++; console.error(e); }
	if (temporal) try {
		const base = resolve(tmpdir());
		if (!temporal.startsWith(base + sep)) throw new Error('Destino de limpieza fuera del directorio temporal.');
		rmSync(temporal, { recursive: true, force: true });
	} catch (e) { fallos++; console.error(e); }
	if (!debugLogExistia && existsSync(debugLog)) try { unlinkSync(debugLog); } catch (e) { fallos++; console.error(e); }
	if (chromeLogAnterior === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogAnterior;
}
console.log(`\n=== ${fallos ? `${fallos} FALLO(S) ✗` : 'TODO OK ✔'} · ${comprobaciones} comprobaciones · ${((Date.now() - inicio) / 1000).toFixed(1)} s ===`);
process.exitCode = fallos ? 1 : 0;
