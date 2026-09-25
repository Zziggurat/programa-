/** ESQ-08 visible: propuesta explícita de marcado, reservas congeladas, duplicados y Undo/Redo. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';

const bobinas = ['1/L1', '2/T1', 'A1', 'A2', '13', '14'].map((id) => ({ id }));
const aparato = (id, designacion, numero, congelado = false) => ({
	id, tipo: 'contactor', designacion, numero, congelado, bornes: bobinas,
	comportamiento: { version: 1, clase: 'contactos-electromagneticos',
		bobina: { entrada: 'A1', retorno: 'A2' },
		polos: [{ entrada: '1/L1', salida: '2/T1' }],
		contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
	},
});
const fixture = {
	formato: 'tablero-studio', version: 2, nombre: 'QA renumeración M2',
	gabinete: { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] },
	hojas: [
		{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' },
	],
	// El orden de este array contradice el orden gráfico; la bobina de kmA tiene prioridad
	// sobre su vista de polos. El 99 obsoleto de kmB no debe reservar hasta -K99: manda -K2.
	dispositivos: [
		aparato('kmD', '-K77', 77),
		aparato('kmA', '-K90', 90),
		aparato('kmB', '-K2', 99, true),
		aparato('kmC', '-K88', 88),
	],
	conductores: [{ id: 'c-entre-vistas', de: { dispositivoId: 'kmA', borneId: 'A1' },
		a: { dispositivoId: 'kmB', borneId: 'A1' }, estadoRutaFisica: 'pendiente' }],
	esquema: { representaciones: [
		{ id: 'kmA-polos', dispositivoId: 'kmA', hojaId: 'potencia',
			posicion: { columna: 1, fila: 2 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' },
			] } },
		{ id: 'kmB-vista', dispositivoId: 'kmB', hojaId: 'potencia',
			posicion: { columna: 2, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'kmC-vista', dispositivoId: 'kmC', hojaId: 'potencia',
			posicion: { columna: 5, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'kmA-bobina', dispositivoId: 'kmA', hojaId: 'mando',
			posicion: { columna: 2, fila: 4 }, parte: { tipo: 'bobina' } },
		{ id: 'kmD-vista', dispositivoId: 'kmD', hojaId: 'mando',
			posicion: { columna: 4, fila: 2 }, parte: { tipo: 'completa' } },
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
const marcas = (p) => Object.fromEntries(p.dispositivos.map((d) => [d.id, {
		designacion: d.designacion, numero: d.numero, congelado: d.congelado,
	}]));
const identidades = (p) => ({
	aparatos: p.dispositivos.map((d) => d.id).sort(),
	conductores: p.conductores.map((c) => c.id).sort(),
	vistas: p.esquema.representaciones.map((r) => `${r.id}:${r.dispositivoId}:${r.hojaId}`).sort(),
});

async function importarProyecto(documento, nombreArchivo) {
	await pagina.locator('#btn-archivo').click();
	const selector = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-abrir').click();
	await (await selector).setFiles({ name: nombreArchivo,
		mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(documento)) });
	await pagina.waitForFunction((nombre) => window.qa.proyecto().nombre === nombre, documento.nombre);
}

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
	await importarProyecto(fixture, 'renumeracion-m2.tablero.json');
	await pagina.locator('#btn-esquema').click();
	const inicial = await estado();
	comprobar('fixture multivista: cuatro aparatos, una conexión y botón visible',
		inicial.proyecto.dispositivos.length === 4 && inicial.proyecto.conductores.length === 1
		&& inicial.proyecto.esquema.representaciones.length === 5
		&& await pagina.locator('#esq-renumerar').isVisible());
	assert.ok(await pagina.locator('#esq-renumerar').isVisible(), 'falta gesto de renumeración visible');

	await pagina.locator('#esq-renumerar').click();
	const preview = await pagina.locator('#dialogo-msg').textContent();
	comprobar('preview enumera cambios y reserva la designación congelada real, no su número obsoleto',
		!!preview && /kmB/.test(preview) && /-K2/.test(preview)
		&& /kmC/.test(preview) && /-K1/.test(preview)
		&& /kmA/.test(preview) && /-K3/.test(preview)
		&& /kmD/.test(preview) && /-K4/.test(preview)
		&& /congelad/i.test(preview));
	await pagina.locator('#dialogo-cancelar').click();
	const cancelado = await estado();
	comprobar('cancelar propuesta conserva marcas, IDs, hojas y pila Undo',
		JSON.stringify(marcas(cancelado.proyecto)) === JSON.stringify(marcas(inicial.proyecto))
		&& JSON.stringify(identidades(cancelado.proyecto)) === JSON.stringify(identidades(inicial.proyecto))
		&& cancelado.historial.deshacer === inicial.historial.deshacer);

	await pagina.locator('#esq-renumerar').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos
		.find((d) => d.id === 'kmA')?.designacion === '-K3');
	const renumerado = await estado();
	comprobar('aplicar usa orden gráfico y ancla de bobina, sin tocar identidad eléctrica',
		renumerado.proyecto.dispositivos.find((d) => d.id === 'kmC')?.designacion === '-K1'
		&& renumerado.proyecto.dispositivos.find((d) => d.id === 'kmA')?.designacion === '-K3'
		&& renumerado.proyecto.dispositivos.find((d) => d.id === 'kmD')?.designacion === '-K4'
		&& JSON.stringify(identidades(renumerado.proyecto)) === JSON.stringify(identidades(inicial.proyecto))
		&& renumerado.historial.deshacer === inicial.historial.deshacer + 1);
	comprobar('congelado real -K2 conserva designación y número 99 obsoleto',
		renumerado.proyecto.dispositivos.find((d) => d.id === 'kmB')?.designacion === '-K2'
		&& renumerado.proyecto.dispositivos.find((d) => d.id === 'kmB')?.numero === 99);
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos
		.find((d) => d.id === 'kmA')?.designacion === '-K90');
	comprobar('Undo restaura todas las designaciones sin cambiar IDs ni conexiones',
		JSON.stringify(marcas((await estado()).proyecto)) === JSON.stringify(marcas(inicial.proyecto)));
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos
		.find((d) => d.id === 'kmA')?.designacion === '-K3');
	comprobar('Redo restaura las marcas propuestas de forma atómica',
		JSON.stringify(marcas((await estado()).proyecto)) === JSON.stringify(marcas(renumerado.proyecto)));
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await esperarEditorListo(pagina);
	const reabierto = (await estado()).proyecto;
	comprobar('reapertura conserva marcas, anclas y una sola conexión',
		JSON.stringify(marcas(reabierto)) === JSON.stringify(marcas(renumerado.proyecto))
		&& JSON.stringify(identidades(reabierto)) === JSON.stringify(identidades(inicial.proyecto)));

	const duplicado = structuredClone(fixture);
	duplicado.nombre = 'QA renumeración duplicada M2';
	const segundo = duplicado.dispositivos.find((d) => d.id === 'kmC');
	segundo.designacion = '-K2';
	segundo.congelado = true;
	await importarProyecto(duplicado, 'renumeracion-duplicada-m2.tablero.json');
	await pagina.locator('#btn-esquema').click();
	const antesConflicto = await estado();
	await pagina.locator('#esq-renumerar').click();
	const aviso = await pagina.locator('#dialogo-msg').textContent();
	comprobar('dos congelados -K2 revelan conflicto bloqueante y ambos IDs',
		!!aviso && /duplicad|conflicto/i.test(aviso) && /-K2/.test(aviso)
		&& /kmB/.test(aviso) && /kmC/.test(aviso));
	await pagina.locator('#dialogo-ok').click();
	const despuesConflicto = await estado();
	comprobar('aceptar aviso de conflicto no aplica renumeración parcial ni crea Undo',
		JSON.stringify(marcas(despuesConflicto.proyecto))
		=== JSON.stringify(marcas(antesConflicto.proyecto))
		&& despuesConflicto.historial.deshacer === antesConflicto.historial.deshacer);
	comprobar('sin errores JavaScript', erroresJS.length === 0);
} catch (error) {
	fallos++;
	console.error('FAIL QA renumeración esquemática M2:', error.stack ?? error);
} finally {
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	console.log(`QA renumeración esquemática M2: ${comprobaciones} comprobaciones, ${fallos} fallos, `
		+ `${erroresJS.length} JS errors, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
