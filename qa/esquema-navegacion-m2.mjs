/** ESQ-09: esquema ↔ tablero/datos e issue → vista, por identidad y con ambigüedad visible. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const producto = { tipo: 'PRODUCTO', catalogoId: 'qa-esq09', id: 'sin-revision',
	revision: 1, hash: `sha256:${'0'.repeat(64)}` };
// Revisión válida y disponible, pero de familia BOBINA: nunca debe reasignar q-otro a km1.
const revisionIncompatible = {
	version: 1, canon: 1, catalogo: { id: 'qa-esq09', nombre: 'Ensayo navegación sintético' },
	id: 'bobina-incompatible', nombre: 'Bobina sintética', revision: 1,
	hash: 'sha256:83cfc45557045149ba7c501315b2dc36b9d548c0501fb14a2c92176cf0a90949',
	estado: 'ACTIVA', procedencia: { origen: 'SINTETICO', referencia: 'QA ESQ-09 identidad incompatible' },
	tipo: 'PRODUCTO', familia: 'BOBINA', variante: 'QA', campos: [],
};
const productoIncompatible = { tipo: 'PRODUCTO', catalogoId: revisionIncompatible.catalogo.id,
	id: revisionIncompatible.id, revision: revisionIncompatible.revision, hash: revisionIncompatible.hash };
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA navegación ESQ-09',
	hojaActiva: 'potencia', hojas: [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	],
	gabinete: { ancho: 500, alto: 320,
		rieles: [{ id: 'r1', x: 30, y: 40, largo: 390 }], canaletas: [],
		colocaciones: [
			{ dispositivoId: 'q1', x: 55, y: 45, ancho: 45, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'q-otro', x: 145, y: 45, ancho: 45, alto: 80, rielId: 'r1' },
			{ dispositivoId: 'km1', x: 245, y: 45, ancho: 45, alto: 80, rielId: 'r1' },
		],
	},
	dispositivos: [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', descripcion: 'Protección principal exacta',
			hojaId: 'potencia', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'q-otro', tipo: 'disyuntor', designacion: '-Q1', descripcion: 'Otro aparato mismo rótulo',
			hojaId: 'mando', bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', descripcion: 'Contactor de dos vistas',
			hojaId: 'potencia', bornes: ['1/L1', '2/T1', 'A1', 'A2'].map((id) => ({ id })),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }], contactos: [] } },
	],
	conductores: [],
	esquema: { representaciones: [
		{ id: 'q1-vista', dispositivoId: 'q1', hojaId: 'potencia',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'q-otro-vista', dispositivoId: 'q-otro', hojaId: 'mando',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'km1-polo', dispositivoId: 'km1', hojaId: 'potencia',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos',
				pares: [{ entrada: '1/L1', salida: '2/T1' }] } },
		{ id: 'km1-bobina', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'bobina' } },
	] },
	datosTecnicos: { version: 1, revisiones: [revisionIncompatible], instalaciones: [], vinculos: [
		{ entidad: 'DEVICE', entidadId: 'q1', producto, decisiones: {}, condiciones: {} },
		{ entidad: 'DEVICE', entidadId: 'q-otro', producto: productoIncompatible, decisiones: {}, condiciones: {} },
		{ entidad: 'DEVICE', entidadId: 'km1', producto, decisiones: {}, condiciones: {} },
	] },
};

let servidor, navegador, pagina;
const inicio = Date.now(), erroresJS = [];
let comprobaciones = 0, fallos = 0;
const comprobar = (nombre, condicion) => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const sinMutacion = () => pagina.evaluate(() => ({
	documento: JSON.stringify(window.qa.proyecto()), deshacer: window.qa.historial().deshacer,
}));

try {
	const entorno = await servidorDeQA(); servidor = entorno.servidor;
	navegador = await abrirNavegador(chromium);
	pagina = await navegador.newPage({ viewport: { width: 1600, height: 920 } });
	pagina.setDefaultTimeout(20_000);
	pagina.on('pageerror', (e) => erroresJS.push(e.message));
	pagina.on('console', (m) => {
		if (m.type() === 'error' && !/favicon|404/i.test(m.text())) erroresJS.push(m.text());
	});
	await pagina.goto(`${entorno.url}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) await pagina.locator('#btn-cerrar-ayuda').click();
	await pagina.locator('#btn-archivo').click();
	const selector = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await selector).setFiles({ name: 'navegacion-esquema.tablero.json',
		mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
	const carga = await Promise.race([
		pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA navegación ESQ-09', null,
			{ timeout: 20_000 }).then(() => 'ok'),
		pagina.locator('#toast.error').waitFor({ state: 'visible', timeout: 20_000 })
			.then(() => pagina.locator('#toast').textContent()),
	]);
	assert.equal(carga, 'ok', `El fixture no se importó: ${carga}`);
	const base = await sinMutacion();
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esquema-hoja .simbolo[data-dispositivo="q1"][data-representacion="q1-vista"]').click();
	comprobar('Q1 expone acción visible hacia tablero y ficha por ID',
		await pagina.locator('#esq-ver-en-tablero').isVisible()
		&& /q1-vista.*\[q1\]/i.test(await pagina.locator('#esq-ayuda').textContent()));
	await pagina.locator('#esq-ver-en-tablero').click();
	comprobar('esquema → tablero enfoca Q1 exacto, no el otro -Q1',
		await pagina.locator('#panel-esquema').isHidden()
		&& await pagina.locator('#dev-descripcion').inputValue() === 'Protección principal exacta'
		&& (await pagina.evaluate(() => window.qa.seleccion()))?.id === 'q1');
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('#esquema-hoja .simbolo[data-dispositivo="q1"][data-representacion="q1-vista"]').click();
	const modalTecnico = pagina.locator('#modal-datos-tecnicos');
	const esperaDatos = Promise.race([
		modalTecnico.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'ok'),
		pagina.locator('#toast.error').waitFor({ state: 'visible', timeout: 20_000 })
			.then(() => pagina.locator('#toast').textContent()),
	]);
	await pagina.locator('#esq-ver-datos-tecnicos').click();
	assert.equal(await esperaDatos, 'ok', 'No abrió Datos técnicos del aparato seleccionado');
	const fichaTecnica = await pagina.locator('#modal-datos-tecnicos .dt-cuerpo').innerText();
	comprobar('esquema → Datos técnicos abre vínculo del aparato exacto',
		await pagina.locator('#panel-esquema').isHidden()
		&& /Vínculo técnico no disponible · q1/.test(fichaTecnica)
		&& fichaTecnica.includes(producto.hash)
		&& !fichaTecnica.includes('q-otro'));
	await pagina.locator('#modal-datos-tecnicos [data-dt="cerrar"]').click();
	await pagina.locator('#hta-ingenieria').click();
	await pagina.locator('#ingenieria-validar').click();
	await pagina.locator('[data-ing-view="validacion"]').click();
	const tarjeta = pagina.locator('[data-ing-issue-card]')
		.filter({ has: pagina.locator('[data-ing-device="km1"]') })
		.filter({ hasText: 'TS-DATA-' }).first();
	await tarjeta.waitFor({ state: 'visible' });
	const issueId = await tarjeta.getAttribute('data-ing-issue-card');
	assert.ok(issueId, 'el issue técnico no expone identidad estable');
	assert.equal(await tarjeta.locator('[data-ing-scheme-issue]').getAttribute('data-ing-scheme-issue'), issueId);
	await tarjeta.locator('[data-ing-scheme-issue]').click();
	const opciones = pagina.locator('#esq-localizador-issue button[data-localizar-id="km1"]');
	comprobar('issue KM1 con dos vistas exige elección sin escoger primera hoja',
		await pagina.locator('#panel-esquema').isVisible()
		&& await opciones.count() === 2
		&& await pagina.locator('#esq-localizador-issue').innerText().then((x) => /elige la vista/.test(x)));
	await opciones.filter({ hasText: 'km1-bobina' }).click();
	const bobina = pagina.locator('#esquema-hoja .simbolo[data-dispositivo="km1"][data-representacion="km1-bobina"]');
	comprobar('elección del issue navega por ID a bobina KM1 en hoja 2 y la destaca',
		/Hoja 2 \/ 2/.test(await pagina.locator('#esq-indicador').textContent())
		&& await bobina.count() === 1
		&& /km1-bobina/.test(await pagina.locator('#esq-ayuda').textContent())
		&& await bobina.locator('rect[stroke="#f5a623"]').count() === 1);
	await pagina.locator('#esquema-hoja .simbolo[data-dispositivo="q-otro"][data-representacion="q-otro-vista"]').click();
	await pagina.locator('#esq-ver-datos-tecnicos').click();
	await modalTecnico.waitFor({ state: 'visible' });
	const fichaIncompatible = await pagina.locator('#modal-datos-tecnicos .dt-cuerpo').innerText();
	comprobar('vínculo incompatible conserva q-otro explícito y no reasigna a KM1',
		/Producto incompatible con q-otro/.test(fichaIncompatible)
		&& fichaIncompatible.includes(revisionIncompatible.hash)
		&& !fichaIncompatible.includes('km1')
		&& await pagina.locator('#modal-datos-tecnicos [data-dt-input="entidad"]').count() === 0);
	const despues = await sinMutacion();
	comprobar('navegar entre vistas/issue no modifica topología ni historial',
		despues.documento === base.documento && despues.deshacer === base.deshacer);
	comprobar('sin errores JavaScript', erroresJS.length === 0);
} catch (error) {
	fallos++;
	console.error('FAIL navegación ESQ-09:', error.stack ?? error);
} finally {
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	console.log(`QA navegación ESQ-09: ${comprobaciones} comprobaciones, ${fallos} fallos, `
		+ `${erroresJS.length} JS errors, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
