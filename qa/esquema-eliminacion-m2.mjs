/** ESQ-04: borrar una vista no es borrar el aparato eléctrico y sus dependencias. */
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const referenciaProducto = { tipo: 'PRODUCTO', catalogoId: 'fixture-esq04',
	id: 'producto-sintetico', revision: 1, hash: `sha256:${'0'.repeat(64)}` };
const referenciaTabla = { ...referenciaProducto, tipo: 'AMPACIDAD', id: 'tabla-sintetica' };
// Las referencias técnicas sintéticas, deliberadamente no resueltas, son datos persistentes:
// ESQ-04 debe mostrar y retirar las dependencias sin exigir un catálogo externo al fixture.
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA eliminación eléctrica M2',
	gabinete: { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] },
	hojas: [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	],
	dispositivos: [
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1',
			bornes: ['1/L1', '2/T1', 'A1', 'A2', '13', '14'].map((id) => ({ id })),
			comportamiento: {
				version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }],
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
			},
		},
		{ id: 'xp', tipo: 'bornero', designacion: '-XP1', bornes: [{ id: 'X1' }, { id: 'X2' }] },
		{ id: 'xm', tipo: 'bornero', designacion: '-XM1', bornes: [{ id: 'Y1' }, { id: 'Y2' }] },
	],
	conductores: [
		{ id: 'c-potencia', de: { dispositivoId: 'km1', borneId: '1/L1' },
			a: { dispositivoId: 'xp', borneId: 'X1' }, estadoRutaFisica: 'pendiente' },
		{ id: 'c-mando', de: { dispositivoId: 'km1', borneId: 'A1' },
			a: { dispositivoId: 'xm', borneId: 'Y1' }, estadoRutaFisica: 'pendiente' },
		{ id: 'c-aux', de: { dispositivoId: 'km1', borneId: '13' },
			a: { dispositivoId: 'xp', borneId: 'X2' }, estadoRutaFisica: 'pendiente' },
		{ id: 'c-ajeno', de: { dispositivoId: 'xp', borneId: 'X2' },
			a: { dispositivoId: 'xm', borneId: 'Y2' }, estadoRutaFisica: 'pendiente' },
	],
	esquema: { representaciones: [
		{ id: 'km1-polos', dispositivoId: 'km1', hojaId: 'potencia',
			posicion: { columna: 4, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' },
			] } },
		{ id: 'km1-bobina', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 3, fila: 5 }, parte: { tipo: 'bobina' } },
		{ id: 'km1-aux', dispositivoId: 'km1', hojaId: 'mando',
			posicion: { columna: 6, fila: 3 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
		{ id: 'xp-vista', dispositivoId: 'xp', hojaId: 'potencia',
			posicion: { columna: 7, fila: 4 }, parte: { tipo: 'completa' } },
		{ id: 'xm-vista', dispositivoId: 'xm', hojaId: 'mando',
			posicion: { columna: 7, fila: 4 }, parte: { tipo: 'completa' } },
	] },
	datosTecnicos: { version: 1, revisiones: [], vinculos: [
		{ entidad: 'DEVICE', entidadId: 'km1', producto: referenciaProducto,
			decisiones: {}, condiciones: {} },
		{ entidad: 'DEVICE', entidadId: 'xp', producto: referenciaProducto,
			decisiones: {}, condiciones: {} },
	], instalaciones: [
		{ conductorId: 'c-potencia', tabla: referenciaTabla, factores: [] },
		{ conductorId: 'c-ajeno', tabla: referenciaTabla, factores: [] },
	] },
};

const inicio = Date.now();
let servidor, navegador, pagina;
let comprobaciones = 0, fallos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const estado = () => pagina.evaluate(() => ({
	proyecto: window.qa.proyecto(), historial: window.qa.historial(),
}));
const ids = (lista) => lista.map((x) => x.id).sort();
const referencias = (p) => p.esquema.representaciones.filter((r) => r.dispositivoId === 'km1').map((r) => r.id).sort();

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
	await (await selector).setFiles({ name: 'eliminacion-esquema.tablero.json',
		mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'QA eliminación eléctrica M2');
	await pagina.locator('#btn-esquema').click();
	await pagina.locator('.simbolo[data-representacion="km1-polos"]').click();
	const inicial = await estado();
	comprobar('dos acciones visibles y distinguibles para la misma representación',
		await pagina.locator('#esq-borrar-representacion').isVisible()
		&& await pagina.locator('#esq-eliminar-dispositivo').isVisible()
		&& inicial.proyecto.dispositivos.length === 3
		&& inicial.proyecto.conductores.length === 4
		&& referencias(inicial.proyecto).length === 3);

	await pagina.locator('#esq-borrar-representacion').click();
	comprobar('Borrar vista advierte que aparato y conductores permanecen',
		/aparato y sus conductores seguirán/i.test(await pagina.locator('#dialogo-msg').textContent()));
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => !window.qa.proyecto().esquema.representaciones
		.some((r) => r.id === 'km1-polos'));
	const soloVista = await estado();
	comprobar('Borrar vista conserva el aparato, sus tres cables y sus otras dos vistas',
		soloVista.proyecto.dispositivos.some((d) => d.id === 'km1')
		&& soloVista.proyecto.conductores.filter((c) => c.de.dispositivoId === 'km1'
			|| c.a.dispositivoId === 'km1').length === 3
		&& referencias(soloVista.proyecto).length === 2
		&& soloVista.historial.deshacer === inicial.historial.deshacer + 1);
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.some((r) => r.id === 'km1-polos'));
	comprobar('Undo de Borrar vista restaura la identidad gráfica',
		JSON.stringify(referencias((await estado()).proyecto))
		=== JSON.stringify(referencias(inicial.proyecto)));

	await pagina.locator('.simbolo[data-representacion="km1-polos"]').click();
	const antesEliminacion = await estado();
	await pagina.locator('#esq-eliminar-dispositivo').click();
	const preview = await pagina.locator('#dialogo-msg').textContent();
	comprobar('eliminar aparato previsualiza cables, hojas y datos afectados',
		!!preview && /KM1/.test(preview)
		&& ['c-potencia', 'c-mando', 'c-aux'].every((id) => preview.includes(id))
		&& /Potencia|potencia/.test(preview) && /Mando|mando/.test(preview)
		&& /técnic|vínculo/i.test(preview));
	await pagina.locator('#dialogo-cancelar').click();
	const cancelado = await estado();
	comprobar('cancelar eliminación no muta el proyecto ni crea Undo',
		JSON.stringify(cancelado.proyecto) === JSON.stringify(antesEliminacion.proyecto)
		&& cancelado.historial.deshacer === antesEliminacion.historial.deshacer);

	await pagina.locator('#esq-eliminar-dispositivo').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => !window.qa.proyecto().dispositivos
		.some((d) => d.id === 'km1'));
	const eliminado = await estado();
	comprobar('eliminar aparato retira las tres vistas y solo sus tres conexiones',
		ids(eliminado.proyecto.dispositivos).join(',') === 'xm,xp'
		&& ids(eliminado.proyecto.conductores).join(',') === 'c-ajeno'
		&& !eliminado.proyecto.esquema.representaciones.some((r) => r.dispositivoId === 'km1')
		&& eliminado.proyecto.esquema.representaciones.length === 2
		&& eliminado.historial.deshacer === antesEliminacion.historial.deshacer + 1);
	comprobar('dependencias técnicas removidas sin borrar los registros ajenos',
		eliminado.proyecto.datosTecnicos.vinculos.length === 1
		&& eliminado.proyecto.datosTecnicos.vinculos[0].entidadId === 'xp'
		&& eliminado.proyecto.datosTecnicos.instalaciones.length === 1
		&& eliminado.proyecto.datosTecnicos.instalaciones[0].conductorId === 'c-ajeno');
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.some((d) => d.id === 'km1'));
	const deshecho = (await estado()).proyecto;
	comprobar('Undo restaura aparato, cableado, tres vistas y datos técnicos',
		ids(deshecho.dispositivos).join(',') === ids(inicial.proyecto.dispositivos).join(',')
		&& ids(deshecho.conductores).join(',') === ids(inicial.proyecto.conductores).join(',')
		&& referencias(deshecho).length === 3
		&& deshecho.datosTecnicos.vinculos.length === 2
		&& deshecho.datosTecnicos.instalaciones.length === 2);
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => !window.qa.proyecto().dispositivos.some((d) => d.id === 'km1'));
	comprobar('Redo retira nuevamente el mismo aparato y sus vistas',
		!(await estado()).proyecto.esquema.representaciones.some((r) => r.dispositivoId === 'km1'));

	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = (await estado()).proyecto;
	comprobar('guardado/reapertura conserva eliminación sin vistas huérfanas ni pérdida ajena',
		ids(reabierto.dispositivos).join(',') === 'xm,xp'
		&& ids(reabierto.conductores).join(',') === 'c-ajeno'
		&& reabierto.esquema.representaciones.length === 2
		&& reabierto.esquema.representaciones.every((r) =>
			reabierto.dispositivos.some((d) => d.id === r.dispositivoId))
		&& reabierto.datosTecnicos.vinculos.length === 1
		&& reabierto.datosTecnicos.instalaciones.length === 1);
	comprobar('sin errores JavaScript', erroresJS.length === 0);
} catch (error) {
	fallos++;
	console.error('FAIL QA eliminación eléctrica M2:', error.stack ?? error);
} finally {
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	console.log(`QA eliminación eléctrica M2: ${comprobaciones} comprobaciones, ${fallos} fallos, `
		+ `${erroresJS.length} JS errors, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
