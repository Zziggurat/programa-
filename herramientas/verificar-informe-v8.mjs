/** QA de presentación del mismo informe público: requiere npm run build, no otro motor documental. */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { ejecutableNavegador } from '../qa/lib/entorno.mjs';
import { fixtureDatosTecnicosV8 } from '../dist/ejemplo/datos-tecnicos-v8.js';
import { ejecutarIngenieria } from '../dist/src/ingenieria/engine.js';
import { crearInformeIngenieriaV7, informeIngenieriaV7AHtml } from '../dist/src/ingenieria/documentacion.js';

const carpeta = await mkdtemp(join(tmpdir(), 'qa-v8-informe-a4-'));
const proyecto = fixtureDatosTecnicosV8();
const informe = crearInformeIngenieriaV7({ proyecto,
	analisis: ejecutarIngenieria({ proyecto, contextoFisico: { conexionesCerradas: new Map([['q1', [['1', '2']]]]) } }),
	trazabilidad: { projectId: 'fixture-v8', revision: 1, buildId: 'QA-INFORME-V8', generadoEn: '2026-09-07T12:00:00.000Z' },
});
const html = join(carpeta, 'informe.html');
await writeFile(html, informeIngenieriaV7AHtml(informe), 'utf8');
// Un informe HTML no usa WebGL: no necesita los flags SwiftShader de la escena 3D.
const navegador = await chromium.launch({ executablePath: ejecutableNavegador() });
try {
	const pagina = await navegador.newPage({ viewport: { width: 1280, height: 960 } });
	const errores = [], redes = [];
	pagina.on('pageerror', error => errores.push(error.message));
	pagina.on('request', request => { if (/^https?:/.test(request.url())) redes.push(request.url()); });
	await pagina.goto(pathToFileURL(html).href);
	await pagina.screenshot({ path: join(carpeta, 'pantalla.png') });
	assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'informe sin desbordamiento horizontal');
	await pagina.emulateMedia({ media: 'print' });
	await pagina.pdf({ path: join(carpeta, 'informe.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
	assert.deepEqual(errores, [], 'sin errores JavaScript');
	assert.deepEqual(redes, [], 'informe sin dependencias de red');
	console.log(`OK  informe público offline, pantalla y PDF A4: ${carpeta}`);
} finally { await navegador.close(); }
