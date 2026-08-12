/**
 * QA de la PERSONALIZACIÓN DEL DOSSIER: que el documento salga a nombre de quien lo entrega.
 *
 * Un dossier que se le da a un cliente no puede ir rotulado con el nombre del programa. Aquí se
 * comprueba, sobre el PDF de verdad —no sobre la interfaz—, que:
 *   · el nombre de la empresa sustituye a «TableroStudio» en la cabecera, y sale en portada y pie
 *   · el color corporativo se aplica de verdad
 *   · el papel Carta cambia el tamaño de página
 *   · los apartados salen en el orden pedido
 *   · quitar el anexo NO se lleva por delante lo que el usuario puso al final
 *   · ningún carácter raro rompe una página, y una tabla partida no deja páginas desnudas
 *
 *   node qa/dossier-personalizado.mjs
 */
import { chromium } from 'playwright-core';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };

/** Genera el dossier con los ajustes que se le pasen y devuelve el PDF crudo como texto. */
const pdfCon = (ajustes) => page.evaluate((aj) => window.qa.dossierCrudo(aj), ajustes);

await page.goto(url);
await page.waitForTimeout(800);
await page.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
await page.waitForTimeout(400);
if (await page.isVisible('#modal-ejemplos')) {
	await page.evaluate(() => document.querySelectorAll('.tarjeta-ejemplo button')[2]?.click());
	await page.waitForTimeout(1700);
	await page.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
	// El panel del dossier ESCRIBE en el proyecto, y un ejemplo es de solo lectura: hay que
	// hacer la copia primero, igual que la haría el usuario. Sin esto, lo que se teclea en el
	// panel se descarta en silencio y la comprobación de más abajo lee `undefined`.
	await trabajarSobreCopia(page);
}

console.log('\n--- 1. Sin decir quién firma, el documento es del programa ---');
const base = await pdfCon({});
must('sale «TableroStudio» mientras nadie ponga su empresa', base.includes('TableroStudio'));

console.log('\n--- 2. Con empresa, el documento es SUYO ---');
const EMPRESA = 'ElectroCubierta SpA';
const CONTACTO = '+56 9 1234 5678 - contacto@electrocubierta.cl';
const conEmpresa = await pdfCon({ empresa: { nombre: EMPRESA, contacto: CONTACTO } });
must('el nombre de la empresa está en el PDF', conEmpresa.includes(EMPRESA));
must('y su contacto también', conEmpresa.includes('electrocubierta.cl'));
must('«TableroStudio» ya no rotula las páginas', !conEmpresa.includes('TableroStudio'),
	'la cabecera y el pie son de quien entrega');

console.log('\n--- 3. El papel ---');
const a4 = await pdfCon({ empresa: { nombre: EMPRESA } });
const carta = await pdfCon({ empresa: { nombre: EMPRESA }, papel: 'carta' });
// jsPDF escribe el tamaño de cada página en su /MediaBox, en puntos: A4 = 841.89, Carta = 792.
must('en A4 las páginas miden A4', /MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*/.test(a4));
must('eligiendo Carta, las páginas miden Carta', /MediaBox\s*\[\s*0\s+0\s+612\.?\d*\s+792\.?\d*/.test(carta),
	(carta.match(/MediaBox[^\]]*\]/) ?? ['?'])[0]);
must('y el documento sigue teniendo todos sus apartados', carta.includes('Procedencia de los datos'));

console.log('\n--- 4. El color corporativo ---');
const rojo = await pdfCon({ color: '#c8102e' });
// jsPDF escribe los rellenos como «r g b rg» con los componentes de 0 a 1.
must('el color elegido se usa de verdad en el documento', /0\.78\d* 0\.06\d* 0\.18\d* rg/.test(rojo),
	(rojo.match(/[\d.]+ [\d.]+ [\d.]+ rg/g) ?? []).slice(0, 3).join(' | '));

console.log('\n--- 5. El orden de los apartados ---');
// Se compara DÓNDE aparece cada título dentro del PDF: el que va antes, sale antes.
const natural = await pdfCon({});
const alReves = await pdfCon({ orden: ['bom', 'ficha'] });
const posBomNat = natural.indexOf('Lista de materiales');
const posFichaNat = natural.indexOf('Ficha del tablero');
const posBom = alReves.indexOf('Lista de materiales');
const posFicha = alReves.indexOf('Ficha del tablero');
must('de fábrica, la ficha va antes que la lista de materiales', posFichaNat >= 0 && posFichaNat < posBomNat,
	`ficha@${posFichaNat} bom@${posBomNat}`);
must('pidiendo el BOM primero, el BOM sale primero', posBom >= 0 && posBom < posFicha,
	`bom@${posBom} ficha@${posFicha}`);

console.log('\n--- 6. Quitar el anexo NO se lleva lo que puso el usuario ---');
const MIO = 'Acta de puesta en marcha firmada en obra';
const bloque = [{ id: 'b1', tipo: 'texto', donde: 'final', titulo: MIO, trozos: [{ texto: 'Contenido del acta.' }] }];
const conAnexo = await pdfCon({ bloques: bloque, secciones: {} });
must('con el anexo puesto, lo del usuario está', conAnexo.includes(MIO));
const sinAnexo = await pdfCon({ bloques: bloque, secciones: { anexo: false } });
must('quitando el anexo del programa, lo del usuario SIGUE estando', sinAnexo.includes(MIO),
	'antes se borraba con él');
must('y el anexo del programa sí se fue', !sinAnexo.includes('Placa de características'));

console.log('\n--- 7. Nada de lo que escriba el usuario rompe el papel ---');
// El ejemplo trae «Temporizador a la conexión, 6 s (estrella→triángulo)». Esa flecha no la saben
// escribir las fuentes del PDF, y antes reventaba la fila entera: salía estirada y cortada.
must('la flecha del temporizador se escribe como se diría', base.includes('estrella->tri'),
	'antes salía la fila estirada y cortada');
must('y no queda ningún carácter que la fuente no sepa dibujar',
	!/[\u{0100}-\u{FFFF}]/u.test(base.replace(/[-ÿ]/g, '')));

console.log('\n--- 8. Una tabla partida no deja páginas desnudas ---');
// El acento va escapado dentro del PDF, así que se busca la raíz de la palabra.
must('la continuación de un apartado se rotula como tal', /\(contin/.test(carta),
	'la página siguiente a una tabla partida lleva su cabecera');

console.log('\n--- 9. El editor lo ofrece todo en pantalla ---');
await page.evaluate(() => { window.qa.proyecto().dossier = {}; });
await page.evaluate(() => document.getElementById('btn-pdf')?.click());
await page.waitForTimeout(3500);
const controles = await page.evaluate(() => ({
	nombre: !!document.getElementById('dos-empresa-nombre'),
	contacto: !!document.getElementById('dos-empresa-contacto'),
	logo: !!document.getElementById('dos-logo'),
	color: !!document.getElementById('dos-color'),
	papeles: document.querySelectorAll('#dos-papel option').length,
	flechas: document.querySelectorAll('#dos-secciones .mover').length,
	apartados: document.querySelectorAll('#dos-secciones [data-sec]').length,
}));
must('hay dónde poner el nombre y el contacto de la empresa', controles.nombre && controles.contacto);
must('hay dónde poner el logo', controles.logo);
must('hay dónde elegir el color', controles.color);
must('se puede elegir el papel', controles.papeles >= 2, `${controles.papeles} tamaños`);
must('cada apartado se puede subir y bajar', controles.flechas === controles.apartados * 2,
	`${controles.flechas} flechas para ${controles.apartados} apartados`);

// Escribir la empresa en el recuadro tiene que llegar al proyecto (y por tanto al archivo).
await page.fill('#dos-empresa-nombre', EMPRESA);
await page.dispatchEvent('#dos-empresa-nombre', 'change');
await page.waitForTimeout(3000);
const guardado = await page.evaluate(() => window.qa.proyecto().dossier?.empresa?.nombre);
must('lo que se escribe se guarda con el proyecto', guardado === EMPRESA, String(guardado));

await page.screenshot({ path: join(AQUI, '_dossier-personalizado.png') });

console.log('\n--- 10. Sin errores ---');
must('ningún error de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
