/** Aceptación M2 focal: una edición esquemática cambia la red DOL, su lista y la simulación. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const inicio = Date.now();
let servidor, navegador, pagina;
let comprobaciones = 0, fallos = 0;
const erroresJS = [];
const comprobar = (nombre, condicion) => {
	comprobaciones++;
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}`);
};
const proyecto = () => pagina.evaluate(() => window.qa.proyecto());
const simulacion = () => pagina.evaluate(() => window.qa.simulacion());
const estado = () => pagina.evaluate(() => ({
	proyecto: window.qa.proyecto(), historial: window.qa.historial(), cables3d: window.qa.cablesDibujados(),
}));

async function hoja(numero) {
	for (let intento = 0; intento < 12; intento++) {
		const texto = await pagina.locator('#esq-indicador').textContent();
		const actual = Number(/Hoja\s+(\d+)\s*\//.exec(texto ?? '')?.[1]);
		assert.ok(actual > 0, `indicador de hoja ilegible: ${texto}`);
		if (actual === numero) return;
		await pagina.locator(actual < numero ? '#esq-siguiente' : '#esq-anterior').click();
	}
	throw new Error(`no se llegó a la hoja ${numero}`);
}

async function seleccionarConexion(id) {
	const diagnostico = [];
	for (const numero of [1, 2]) {
		await hoja(numero);
		const referencia = pagina.locator(`#esquema-hoja .referencia-conductor[data-conductor="${id}"]`).first();
		if (await referencia.count()) {
			await referencia.click();
			return 'puntero';
		}
		for (const hilo of await pagina.locator(`#esquema-hoja .hilo[data-conductor="${id}"]`).all()) {
			diagnostico.push(await hilo.evaluate((grupo) => ({
				hoja: document.querySelector('#esq-indicador')?.textContent,
				visible: !!grupo.getBoundingClientRect().width,
				paths: [...grupo.querySelectorAll('path')].map((p) => ({ clase: p.getAttribute('class'),
					d: p.getAttribute('d'), longitud: p.getTotalLength() })),
			})));
			const punto = await hilo.evaluate((grupo) => {
				const path = grupo.querySelector('path.hilo-agarre');
				const matriz = path?.getScreenCTM();
				if (!path || !matriz || !path.getAttribute('d') || path.getTotalLength() <= 0) return null;
				for (let i = 1; i < 20; i++) {
					const pos = path.getPointAtLength((i / 20) * path.getTotalLength());
					const pantalla = new DOMPoint(pos.x, pos.y).matrixTransform(matriz);
					const encima = document.elementFromPoint(pantalla.x, pantalla.y);
					if (encima === path || encima?.closest('.hilo') === grupo) {
						return { x: pantalla.x, y: pantalla.y };
					}
				}
				return null;
			});
			if (punto) {
				await pagina.mouse.click(punto.x, punto.y);
				return 'puntero';
			}
		}
	}
	// Un hilo colineal puede quedar enteramente bajo otros sin zona única de ratón.
	// La selección semántica SVG permanece disponible por teclado: no equivale a inventar
	// un clic en un trazo que la persona no puede distinguir.
	await hoja(2);
	const accesible = pagina.locator(`#esquema-hoja .hilo[data-conductor="${id}"][tabindex="0"]`).first();
	if (await accesible.count()) {
		await accesible.focus();
		await pagina.keyboard.press('Enter');
		if (await pagina.locator('#esq-desconectar').isVisible()) {
			console.log(`INFO ${id} carece de tramo único de ratón; seleccionado por teclado. SVG: ${JSON.stringify(diagnostico)}`);
			return 'teclado';
		}
	}
	throw new Error(`el conductor ${id} no tiene selección por ratón ni teclado: ${JSON.stringify(diagnostico)}`);
}

async function energizar(queremos) {
	if ((await simulacion()).energizado !== queremos) {
		await pagina.locator('#btn-energizar').click();
		await pagina.waitForFunction((estado) => window.qa.simulacion().energizado === estado, queremos);
	}
}

/** Gesto humano de pulsador momentáneo: se observa mientras el primario sigue abajo. */
async function presionarStart() {
	const boton = pagina.locator('#sim-mandos button[data-mando="s1"]');
	await boton.waitFor({ state: 'visible' });
	await boton.scrollIntoViewIfNeeded();
	const caja = await boton.boundingBox();
	assert.ok(caja, 'MARCHA no tiene área visible clicable');
	await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
	await pagina.mouse.down();
	await pagina.waitForFunction(() => window.qa.estadoSim().find((e) => e.id === 's1')?.activo === true);
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
	await pagina.locator('#btn-aprender').click();
	await pagina.locator('#btn-ejemplos').click();
	const tarjeta = pagina.locator('.tarjeta-ejemplo', { hasText: 'Arranque directo de motor' }).first();
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	if (await pagina.locator('#modal-dialogo').isVisible()) await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().nombre === 'Arranque directo de motor 380 V');
	if (await pagina.locator('#modal-explicacion').isVisible())
		await pagina.locator('#btn-cerrar-explicacion').click();
	assert.equal(await trabajarSobreCopia(pagina), true, 'el ejemplo no se convirtió en copia editable');
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-esquema').click();
	const antesDeVistas = await estado();
	comprobar('arranque directo real tiene fuerza y mando en dos hojas',
		antesDeVistas.proyecto.hojas.length >= 2
		&& antesDeVistas.proyecto.dispositivos.some((d) => d.id === 'km1')
		&& antesDeVistas.proyecto.dispositivos.some((d) => d.id === 'm1')
		&& antesDeVistas.proyecto.conductores.length >= 20);
	await pagina.locator('#esq-activar-vistas').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().esquema?.representaciones?.length > 0);
	await hoja(1);
	await pagina.locator('#esquema-hoja .simbolo[data-dispositivo="km1"]').click();
	await pagina.locator('#esq-desdoblar').click();
	const documento = await proyecto();
	const potencia = documento.hojas.find((h) => h.numero === 1)?.id;
	const mando = documento.hojas.find((h) => h.numero === 2)?.id;
	assert.ok(potencia && mando, 'falta hoja de fuerza o mando');
	const ocupadas = new Set(documento.esquema.representaciones.map((r) =>
		JSON.stringify([r.hojaId, r.posicion.columna, r.posicion.fila])));
	const libre = (hojaId, preferida) => {
		const columnas = documento.hojas.find((h) => h.id === hojaId)?.columnas
			?? documento.esquema?.columnasPorHoja ?? 10;
		for (const fila of [preferida, 5, 6, 7, 8, 4, 3, 2, 1]) {
			for (let columna = 1; columna <= columnas; columna++) {
				const clave = JSON.stringify([hojaId, columna, fila]);
				if (ocupadas.has(clave)) continue;
				ocupadas.add(clave);
				return { columna: String(columna), fila: String(fila) };
			}
		}
		throw new Error(`no queda casilla libre para ${hojaId}`);
	};
	for (const [parte, destino, filaPreferida] of [
		['bobina', mando, 5], ['polos', potencia, 3], ['auxiliares', mando, 3],
	]) {
		const { columna, fila } = libre(destino, filaPreferida);
		await pagina.locator(`#esq-desdoblar-hoja-${parte}`).selectOption(destino);
		await pagina.locator(`#esq-desdoblar-columna-${parte}`).fill(columna);
		await pagina.locator(`#esq-desdoblar-fila-${parte}`).fill(fila);
	}
	await pagina.locator('#esq-desdoblar-aplicar').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.filter((r) => r.dispositivoId === 'km1').length === 3);
	const desdoblado = await estado();
	const vistasKM = desdoblado.proyecto.esquema.representaciones.filter((r) => r.dispositivoId === 'km1');
	comprobar('bobina, polos y auxiliar comparten km1 y están en dos hojas sin duplicar cables',
		vistasKM.length === 3 && new Set(vistasKM.map((r) => r.hojaId)).size === 2
		&& vistasKM.some((r) => r.parte.tipo === 'bobina' && r.hojaId === mando)
		&& vistasKM.filter((r) => r.parte.tipo === 'contactos').length === 2
		&& desdoblado.proyecto.dispositivos.filter((d) => d.id === 'km1').length === 1
		&& desdoblado.proyecto.conductores.length === antesDeVistas.proyecto.conductores.length);
	const cableA1 = desdoblado.proyecto.conductores.find((c) =>
		[c.de, c.a].some((e) => e.dispositivoId === 'km1' && e.borneId === 'A1')
		&& [c.de, c.a].some((e) => e.dispositivoId === 'x2' && e.borneId === '3'));
	assert.ok(cableA1, 'el ejemplo no conserva la conexión mando x2:3 ↔ km1:A1');
	const metodoSeleccion = await seleccionarConexion(cableA1.id);
	const inspectorSeleccion = await pagina.locator('#esq-ayuda').textContent();
	comprobar('conductor real se selecciona por trazo único o teclado semántico sin adjudicar clic al solape',
		['teclado', 'puntero'].includes(metodoSeleccion)
		&& !!inspectorSeleccion && inspectorSeleccion.includes(cableA1.id)
		&& inspectorSeleccion.includes('A1'));
	await pagina.locator('#esq-desconectar').click();
	const avisoDesconexion = await pagina.locator('#dialogo-msg').textContent();
	comprobar('desconexión esquemática identifica el vínculo real de la bobina',
		!!avisoDesconexion && avisoDesconexion.includes(cableA1.id)
		&& avisoDesconexion.includes('A1') && avisoDesconexion.includes('3'));
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction((id) => !window.qa.proyecto().conductores.some((c) => c.id === id), cableA1.id);
	const desconectado = await estado();
	comprobar('desconectar quita una sola identidad de la topología y lista',
		desconectado.proyecto.conductores.length === desdoblado.proyecto.conductores.length - 1
		&& !desconectado.proyecto.conductores.some((c) => c.id === cableA1.id));
	await pagina.locator('#esq-cerrar').click();
	await pagina.locator('#hta-conectar').click();
	await energizar(true);
	await presionarStart();
	const sinBobina = await simulacion();
	comprobar('START no arranca motor ni contactor si se quitó el vínculo A1',
		!sinBobina.activos.includes('m1') && !sinBobina.activos.includes('km1'));
	await pagina.mouse.up();
	await energizar(false);
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-esquema').click();
	await hoja(2);
	await pagina.locator('.borne-esq[data-dispositivo="x2"][data-borne="3"]').click();
	comprobar('origen visible de conexión x2:3 queda preparado en la hoja de mando',
		await pagina.locator('#esq-cancelar-conexion').isVisible());
	await pagina.locator('.borne-esq[data-dispositivo="km1"][data-borne="A1"]').click();
	const avisoConexion = await pagina.locator('#dialogo-msg').textContent();
	comprobar('reconectar propone identidad eléctrica pendiente sin metraje inventado',
		/ruta física pendiente/i.test(avisoConexion)
		&& /no se declararán metros/i.test(avisoConexion));
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction((n) => window.qa.proyecto().conductores.length === n,
		desdoblado.proyecto.conductores.length);
	const reconectado = await estado();
	const nuevo = reconectado.proyecto.conductores.find((c) => c.id !== cableA1.id
		&& [c.de, c.a].some((e) => e.dispositivoId === 'km1' && e.borneId === 'A1')
		&& [c.de, c.a].some((e) => e.dispositivoId === 'x2' && e.borneId === '3'));
	comprobar('red recompuesta por el esquema conserva una sola conexión pendiente sin malla 3D',
		!!nuevo && nuevo.estadoRutaFisica === 'pendiente'
		&& nuevo.seccion === undefined && nuevo.trazado === undefined
		&& reconectado.cables3d === desconectado.cables3d);
	assert.ok(nuevo, 'no se creó el conductor pendiente entre x2:3 y km1:A1');
	await pagina.locator('#esq-cerrar').click();
	await pagina.locator('#hta-conectar').click();
	const lista = await pagina.locator('#lista-cables').textContent();
	comprobar('lista visible muestra los extremos y marca ruta pendiente',
		!!lista && /-X2:3.*-KM1:A1/.test(lista) && /ruta física pendiente/.test(lista));
	await energizar(true);
	await presionarStart();
	await pagina.waitForFunction(() => window.qa.simulacion().activos.includes('m1'), null, { timeout: 8_000 });
	const conBobina = await simulacion();
	comprobar('START reactivó KM1, su motor y el conductor pendiente por la red real',
		conBobina.activos.includes('km1') && conBobina.activos.includes('m1')
		&& conBobina.conductoresVivosIds.includes(nuevo.id));
	await pagina.mouse.up();
	comprobar('soltar START conserva marcha por enclavamiento del mismo KM1',
		(await simulacion()).activos.includes('m1'));
	await energizar(false);
	await pagina.locator('#hta-seleccionar').click();
	await pagina.locator('#btn-esquema').click();
	await hoja(2);
	await pagina.locator('#esquema-hoja .simbolo[data-dispositivo="f1"]').click();
	const antesVistaF1 = await estado();
	const vistaF1 = antesVistaF1.proyecto.esquema.representaciones.find((r) => r.dispositivoId === 'f1');
	assert.ok(vistaF1, 'el fusible no tiene una vista que se pueda borrar y reponer');
	await pagina.locator('#esq-borrar-representacion').click();
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => !window.qa.proyecto().esquema.representaciones
		.some((r) => r.dispositivoId === 'f1'));
	const sinVistaF1 = await estado();
	const problemas = await pagina.locator('#esq-problemas').textContent();
	comprobar('aparato sin representación permanece visible como problema, sin borrar electricidad',
		sinVistaF1.proyecto.dispositivos.some((d) => d.id === 'f1')
		&& sinVistaF1.proyecto.conductores.length === antesVistaF1.proyecto.conductores.length
		&& /f1|fusible/i.test(problemas ?? '')
		&& /no tiene ninguna vista válida|sin representaci[oó]n|sin vista/i.test(problemas ?? ''));
	const reponer = pagina.locator('#esq-problemas button[data-reponer-dispositivo="f1"]');
	comprobar('problema de aparato oculto ofrece reparación visible', await reponer.isVisible());
	await reponer.click();
	const numeroHojaF1 = antesVistaF1.proyecto.hojas.find((h) => h.id === vistaF1.hojaId)?.numero;
	assert.ok(numeroHojaF1, 'la vista original de F1 no tiene hoja persistente');
	await pagina.locator('#dialogo-input').fill(`${numeroHojaF1}.${vistaF1.posicion.columna}.${vistaF1.posicion.fila}`);
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.some((r) => r.dispositivoId === 'f1'));
	const repuesto = await estado();
	const problemasReparados = await pagina.locator('#esq-problemas').count()
		? await pagina.locator('#esq-problemas').textContent() : '';
	comprobar('reponer F1 devuelve una sola vista y quita el aviso sin tocar la red',
		repuesto.proyecto.esquema.representaciones.filter((r) => r.dispositivoId === 'f1').length === 1
		&& !/f1.*ninguna vista válida/i.test(problemasReparados ?? '')
		&& repuesto.proyecto.dispositivos.length === antesVistaF1.proyecto.dispositivos.length
		&& repuesto.proyecto.conductores.length === antesVistaF1.proyecto.conductores.length);
	await pagina.keyboard.press('Control+z');
	await pagina.waitForFunction(() => !window.qa.proyecto().esquema.representaciones
		.some((r) => r.dispositivoId === 'f1'));
	comprobar('Undo de reposición vuelve a mostrar el problema sin eliminar F1',
		(await proyecto()).dispositivos.some((d) => d.id === 'f1')
		&& /f1.*ninguna vista válida/i.test(await pagina.locator('#esq-problemas').textContent()));
	await pagina.keyboard.press('Control+y');
	await pagina.waitForFunction(() => window.qa.proyecto().esquema.representaciones
		.some((r) => r.dispositivoId === 'f1'));
	comprobar('Redo recompone la vista y conserva el circuito probado',
		(await proyecto()).conductores.length === reconectado.proyecto.conductores.length);
	comprobar('sin errores JavaScript', erroresJS.length === 0);
} catch (error) {
	fallos++;
	console.error('FAIL aceptación M2 multihoja:', error.stack ?? error);
} finally {
	try { await pagina?.mouse.up(); } catch { /* ya se suelta al cerrar Chromium */ }
	try { await navegador?.close(); } catch (error) { fallos++; console.error(error); }
	try {
		servidor?.closeAllConnections?.();
		if (servidor?.listening) await new Promise((resolve, reject) =>
			servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
	console.log(`QA aceptación M2 multihoja: ${comprobaciones} comprobaciones, ${fallos} fallos, `
		+ `${erroresJS.length} JS errors, ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
	process.exitCode = fallos ? 1 : 0;
}
