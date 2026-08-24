/**
 * Recorrido vertical de «Mis Componentes» usando exclusivamente la interfaz del producto.
 *
 * Crea un contactor desde un PNG, marca A1/A2, tres polos y auxiliares NA/NC, confirma su perfil
 * eléctrico, lo exporta/importa, lo coloca y cablea bobina + auxiliar a una ampolleta. Después
 * exporta el PROYECTO portable, lo importa en un navegador limpio y vuelve a energizarlo.
 * Los hooks `window.qa` de esta suite son solo sondas: observan estado o localizan píxeles; todas
 * las mutaciones pasan por botones, campos, selectores, file choosers y clics reales en el visor.
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfFYAAAAASUVORK5CYII=',
	'base64',
);
const NOMBRE = 'Contactor QA personalizado';
const TERMINALES = [
	{ id: 'A1', tipo: 'control', rol: 'bobina-entrada', posicion: { x: 28, y: 42 } },
	{ id: 'A2', tipo: 'control', rol: 'bobina-retorno', posicion: { x: 28, y: 138 } },
	{ id: '1/L1', tipo: 'L', rol: 'polo-entrada', grupo: 'p1', posicion: { x: 73, y: 24 } },
	{ id: '2/T1', tipo: 'L', rol: 'polo-salida', grupo: 'p1', posicion: { x: 73, y: 156 } },
	{ id: '3/L2', tipo: 'L', rol: 'polo-entrada', grupo: 'p2', posicion: { x: 118, y: 24 } },
	{ id: '4/T2', tipo: 'L', rol: 'polo-salida', grupo: 'p2', posicion: { x: 118, y: 156 } },
	{ id: '5/L3', tipo: 'L', rol: 'polo-entrada', grupo: 'p3', posicion: { x: 163, y: 24 } },
	{ id: '6/T3', tipo: 'L', rol: 'polo-salida', grupo: 'p3', posicion: { x: 163, y: 156 } },
	{ id: '11', tipo: 'control', rol: 'contacto-comun', grupo: 'aux', posicion: { x: 211, y: 42 } },
	{ id: '12', tipo: 'control', rol: 'contacto-nc', grupo: 'aux', posicion: { x: 211, y: 90 } },
	{ id: '14', tipo: 'control', rol: 'contacto-na', grupo: 'aux', posicion: { x: 211, y: 138 } },
];

const { servidor, url } = await servidorDeQA();
const cwdInicial = process.cwd();
const temporal = mkdtempSync(join(tmpdir(), 'qa-componentes-personalizados-'));
const chromeLogPrevio = process.env.CHROME_LOG_FILE;
// Chromium escribe `debug.log` en el cwd si el entorno de la máquina lo pide. Esta suite usa un
// directorio efímero explícito para que ni un fallo ni una ejecución local ensucien el repositorio.
process.env.CHROME_LOG_FILE = join(temporal, 'chromium.log');
process.chdir(temporal);

let navegador;
let contexto;
let pagina;
let fallos = 0;
const erroresJs = [];
const must = (nombre, condicion, extra = '') => {
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${extra ? ` → ${extra}` : ''}`);
};

const qa = (metodo, ...args) => pagina.evaluate(
	([nombre, parametros]) => window.qa[nombre](...parametros), [metodo, args],
);
const proyecto = () => qa('proyecto');
const flush = () => qa('esperarPersistencia');

function perfilContactorValido(definicion) {
	const c = definicion?.comportamiento;
	if (c?.clase !== 'contactos-electromagneticos'
		|| c.bobina?.entrada !== 'A1' || c.bobina?.retorno !== 'A2'
		|| c.polos?.length !== 3 || c.contactos?.length !== 2) return false;
	const polos = new Set(c.polos.map((p) => `${p.entrada}>${p.salida}`));
	const contactos = new Set(c.contactos.map((p) => `${p.entrada}>${p.salida}:${p.reposo}`));
	return ['1/L1>2/T1', '3/L2>4/T2', '5/L3>6/T3'].every((p) => polos.has(p))
		&& contactos.has('11>12:cerrado') && contactos.has('11>14:abierto');
}

const firmaCableado = (p) => p.conductores.map((c) => [
	`${c.de.dispositivoId}::${c.de.borneId}`,
	`${c.a.dispositivoId}::${c.a.borneId}`,
].sort().join('<->')).sort().join('|');

function vigilar(p) {
	p.setDefaultTimeout(60_000);
	p.on('pageerror', (e) => erroresJs.push(`PAGEERROR: ${e.message}`));
	p.on('console', (m) => {
		const recurso = m.location().url ?? '';
		if (m.type() === 'error' && !/\/favicon\.ico(?:$|\?)/i.test(recurso)) {
			erroresJs.push(`${m.text()}${recurso ? ` @ ${recurso}` : ''}`);
		}
	});
}

async function esperarAplicacion() {
	await pagina.waitForFunction(() => !!window.qa?.esperarPersistencia);
	await flush();
	await pagina.waitForFunction(() => {
		const boton = document.getElementById('btn-componentes-personalizados');
		return boton instanceof HTMLButtonElement && !boton.disabled;
	});
	if (await pagina.locator('#btn-cerrar-ayuda').isVisible()) {
		await pagina.locator('#btn-cerrar-ayuda').click();
	}
}

async function abrirComponentes() {
	await pagina.locator('#btn-componentes-personalizados').click();
	await pagina.locator('#ui-componentes-personalizados').waitFor({ state: 'visible' });
}

const tarjeta = () => pagina.locator('#ui-componentes-personalizados .cp-tarjeta')
	.filter({ hasText: NOMBRE }).first();

async function crearDesdeFormulario() {
	await abrirComponentes();
	await pagina.locator('[data-cp="nuevo"]').click();
	await pagina.locator('[data-cp-campo="tipo"]').selectOption('contactor');

	await pagina.locator('[data-cp-campo="nombre"]').fill(NOMBRE);
	await pagina.locator('[data-cp-campo="fabricante"]').fill('QA TableroStudio');
	await pagina.locator('[data-cp-campo="referencia"]').fill('QA-KM3-220');
	await pagina.locator('[data-cp-campo="descripcion"]').fill('Contactor 3P con bobina 220 V y auxiliar conmutado, creado por QA.');
	await pagina.locator('[data-cp-campo="ancho"]').fill('75');
	await pagina.locator('[data-cp-campo="alto"]').fill('110');
	await pagina.locator('[data-cp-campo="fondo"]').fill('60');
	await pagina.locator('[data-parametro="tensionV"]').fill('220');
	await pagina.locator('[data-parametro="corrienteA"]').fill('9');

	const selectorArchivo = pagina.waitForEvent('filechooser');
	await pagina.locator('[data-cp="imagen"]').click();
	await (await selectorArchivo).setFiles({ name: 'contactor-qa.png', mimeType: 'image/png', buffer: PNG });
	const imagen = pagina.locator('[data-cp="preview"] img');
	await imagen.waitFor({ state: 'visible' });

	// Cada marca nace de un clic humano sobre el PNG; ningún hook QA escribe terminales.
	for (const terminal of TERMINALES) {
		await pagina.locator('[data-cp="preview"] img').click({ position: terminal.posicion });
	}
	const filas = pagina.locator('[data-cp="terminales"] tr');
	await filas.nth(TERMINALES.length - 1).waitFor();
	must('la imagen permite marcar los once terminales por clic', await filas.count() === TERMINALES.length,
		String(await filas.count()));

	const configurarTerminal = async (indice, { id, tipo, rol, grupo }) => {
		const fila = filas.nth(indice);
		await fila.locator('input').first().fill(id);
		await fila.locator('select').nth(0).selectOption(tipo);
		await fila.locator('select').nth(1).selectOption(rol);
		if (grupo) await fila.locator('input').nth(1).fill(grupo);
	};
	for (const [indice, terminal] of TERMINALES.entries()) await configurarTerminal(indice, terminal);

	await pagina.locator('[data-cp="validar"]').click();
	await pagina.locator('[data-cp="errores"].cp-ok').waitFor();
	must('el perfil explícito de contactor valida antes de guardar',
		/configuración válida/i.test(await pagina.locator('[data-cp="errores"]').innerText()));
	await pagina.locator('[data-cp="guardar"]').click();
	await tarjeta().waitFor({ state: 'visible' });
}

async function exportarComponente() {
	const descargaPendiente = pagina.waitForEvent('download');
	await tarjeta().getByRole('button', { name: 'Exportar', exact: true }).click();
	const descarga = await descargaPendiente;
	const ruta = join(temporal, 'contactor-qa.tscomp.json');
	await descarga.saveAs(ruta);
	must('la UI exporta un paquete individual portable', /\.tscomp\.json$/i.test(descarga.suggestedFilename()),
		descarga.suggestedFilename());
	return ruta;
}

async function eliminarEImportar(ruta) {
	await tarjeta().getByRole('button', { name: 'Eliminar', exact: true }).click();
	await pagina.locator('#modal-dialogo').waitFor({ state: 'visible' });
	await pagina.locator('#dialogo-ok').click();
	await pagina.waitForFunction(() => document.querySelectorAll('#ui-componentes-personalizados .cp-tarjeta').length === 0);
	must('eliminar desde la biblioteca quita la definición', (await qa('componentesPersonalizados')).length === 0);

	const selectorArchivo = pagina.waitForEvent('filechooser');
	await pagina.locator('[data-cp="importar"]').click();
	await (await selectorArchivo).setFiles(ruta);
	await tarjeta().waitFor({ state: 'visible' });
	must('importar por la UI restaura la definición y su PNG', (await qa('componentesPersonalizados')).length === 1);
}

async function colocarComponente(definicionId) {
	await tarjeta().getByRole('button', { name: 'Colocar', exact: true }).click();
	await pagina.locator('#ui-componentes-personalizados').waitFor({ state: 'hidden' });
	await pagina.waitForFunction((id) => window.qa.proyecto().dispositivos
		.some((d) => d.componentePersonalizado?.definicionId === id), definicionId);

	// El componente nace pegado al puntero; este clic real lo deja sobre el riel más próximo.
	const lienzo = pagina.locator('#escena canvas');
	await lienzo.click({ position: { x: 520, y: 260 } });
	await flush();
	return (await proyecto()).dispositivos.find(
		(d) => d.componentePersonalizado?.definicionId === definicionId,
	);
}

async function sacarDelCatalogo(busqueda, nombreCompleto) {
	const idsAntes = new Set((await proyecto()).dispositivos.map((d) => d.id));
	// «Añadir» abre el cajón del catálogo; buscar allí es el recorrido visible, no un click forzado
	// sobre un botón que el rail mantiene oculto mientras está activa la herramienta Elegir.
	await pagina.locator('#hta-anadir').click();
	await pagina.locator('#buscar-catalogo').fill(busqueda);
	const boton = pagina.locator('#catalogo .item-catalogo').filter({ hasText: nombreCompleto }).first();
	await boton.waitFor({ state: 'visible' });
	await boton.click();
	await pagina.waitForFunction((ids) => window.qa.proyecto().dispositivos.some((d) => !ids.includes(d.id)), [...idsAntes]);
	return (await proyecto()).dispositivos.find((d) => !idsAntes.has(d.id));
}

async function cablear(deId, deBorne, aId, aBorne) {
	const p1 = await qa('puntoParaBorne', deId, deBorne);
	const p2 = await qa('puntoParaBorne', aId, aBorne);
	if (!p1 || !p2) return { ok: false, motivo: `borne no visible: ${deId}.${deBorne}/${aId}.${aBorne}` };
	const antes = (await proyecto()).conductores.length;
	await pagina.mouse.click(p1.x, p1.y);
	await pagina.waitForTimeout(140);
	await pagina.mouse.click(p2.x, p2.y);
	await pagina.waitForFunction((cantidad) => window.qa.proyecto().conductores.length > cantidad, antes, { timeout: 5_000 })
		.catch(() => undefined);
	const despues = (await proyecto()).conductores.length;
	return { ok: despues === antes + 1, motivo: `${antes}→${despues}` };
}

async function exportarProyectoPortable() {
	const descargaPendiente = pagina.waitForEvent('download');
	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-guardar').waitFor({ state: 'visible' });
	await pagina.locator('#btn-guardar').click();
	const descarga = await descargaPendiente;
	const ruta = join(temporal, 'tablero-contactor-qa.tablero.paquete.json');
	await descarga.saveAs(ruta);
	must('Guardar descarga el PROYECTO con su biblioteca y PNG',
		/\.tablero\.paquete\.json$/i.test(descarga.suggestedFilename()), descarga.suggestedFilename());
	return ruta;
}

async function importarProyectoEnContextoLimpio(ruta, instanciaId) {
	await contexto.close();
	contexto = await navegador.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
	pagina = await contexto.newPage();
	vigilar(pagina);
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarAplicacion();
	if (await pagina.locator('#bienvenida').isVisible()) {
		await pagina.locator('#btn-empezar-blanco').click();
		await flush();
	}

	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-mis-tableros').waitFor({ state: 'visible' });
	await pagina.locator('#btn-mis-tableros').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'visible' });
	const selectorArchivo = pagina.waitForEvent('filechooser');
	await pagina.locator('#btn-importar-biblioteca').click();
	await (await selectorArchivo).setFiles(ruta);
	await pagina.waitForFunction((id) => window.qa.proyecto().dispositivos.some((d) => d.id === id), instanciaId);
	await flush();
}

async function accionarMandoVisible(dispositivoId) {
	const boton = pagina.locator(`#sim-mandos [data-mando="${dispositivoId}"]`);
	// El panel contextual puede seguir mostrando «Cablear». Ir a «Tablero» es el recorrido real
	// para revelar Mandos; no se acciona el runtime por el hook QA.
	if (!(await boton.isVisible())) await pagina.locator('#hta-proyecto').click();
	await pagina.locator('#seccion-simulacion').evaluate((el) => {
		el.open = true;
		el.scrollIntoView({ block: 'center' });
	});
	await boton.waitFor({ state: 'visible' });
	await boton.click();
}

async function esperarActivos(encendidos, apagados) {
	await pagina.waitForFunction(([si, no]) => {
		const activos = new Set(window.qa.simulacion().activos);
		return si.every((id) => activos.has(id)) && no.every((id) => !activos.has(id));
	}, [encendidos, apagados]);
	return qa('simulacion');
}

try {
	navegador = await abrirNavegador(chromium);
	contexto = await navegador.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
	pagina = await contexto.newPage();
	vigilar(pagina);
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await esperarAplicacion();
	if (await pagina.locator('#bienvenida').isVisible()) {
		await pagina.locator('#btn-empezar-blanco').click();
		await flush();
	}

	console.log('\n--- 1. Crear contactor PNG y confirmar su contrato eléctrico por la UI ---');
	await crearDesdeFormulario();
	let definiciones = await qa('componentesPersonalizados');
	const original = definiciones.find((d) => d.nombre === NOMBRE);
	must('la biblioteca guarda una definición versionada', !!original && original.revision === 1,
		`${original?.id ?? 'sin id'} · rev ${original?.revision ?? '—'}`);
	must('el asset PNG queda content-addressed', /^sha256:[a-f\d]{64}$/i.test(original?.assetId ?? ''),
		original?.assetId);
	must('la semántica persistida contiene bobina, tres polos, un NA y un NC', perfilContactorValido(original));
	must('los once terminales confirmados conservan identidad y naturaleza',
		original?.terminales?.length === TERMINALES.length
		&& TERMINALES.every((esperado) => original.terminales.some((t) => t.id === esperado.id && t.tipo === esperado.tipo)));

	console.log('\n--- 2. Reabrir biblioteca y probar el paquete individual ---');
	const paquete = await exportarComponente();
	await pagina.reload({ waitUntil: 'load' });
	await esperarAplicacion();
	await abrirComponentes();
	definiciones = await qa('componentesPersonalizados');
	must('la biblioteca IndexedDB sobrevive a recargar',
		definiciones.length === 1 && definiciones[0].id === original.id && definiciones[0].assetId === original.assetId);
	await eliminarEImportar(paquete);
	const importado = (await qa('componentesPersonalizados'))[0];
	must('el roundtrip individual conserva identidad, polos, NA/NC y asset', importado.id === original.id
		&& importado.assetId === original.assetId && perfilContactorValido(importado));

	console.log('\n--- 3. Colocar, cablear bobina + auxiliar y energizar ---');
	const personalizado = await colocarComponente(importado.id);
	must('Colocar crea una instancia con snapshot de procedencia', !!personalizado
		&& personalizado.componentePersonalizado?.revision === importado.revision);
	must('la instancia usa el perfil explícito completo y la imagen resuelta', perfilContactorValido(personalizado)
		&& personalizado.imagen?.startsWith('blob:'));

	const red = await sacarDelCatalogo('Acometida 220 V', 'Acometida 220 V (red)');
	const selector = await sacarDelCatalogo('Selector 2 posiciones', 'Selector 2 posiciones');
	const lamparaPolo = await sacarDelCatalogo('Ampolleta 220 V', 'Ampolleta 220 V');
	const lamparaNA = await sacarDelCatalogo('Ampolleta 220 V', 'Ampolleta 220 V');
	const lamparaNC = await sacarDelCatalogo('Ampolleta 220 V', 'Ampolleta 220 V');
	must('la acometida se añade desde el catálogo real', !!red && red.campo === true);
	must('el selector mantenido se añade desde el catálogo real', !!selector && selector.tipo === 'selector');
	must('las tres cargas de polo/NA/NC son instancias distinguibles',
		[lamparaPolo, lamparaNA, lamparaNC].every((d) => d?.campo === true)
		&& new Set([lamparaPolo.id, lamparaNA.id, lamparaNC.id]).size === 3,
		[lamparaPolo, lamparaNA, lamparaNC].map((d) => d?.designacion).join(', '));
	await pagina.locator('#hta-conectar').click();
	await pagina.locator('#btn-centrar').click();
	await pagina.waitForTimeout(700);
	for (const [nombre, deId, deBorne, aId, aBorne] of [
		['la fase llega al selector de bobina', red.id, 'L', selector.id, '13'],
		['el selector alimenta A1 de la bobina', selector.id, '14', personalizado.id, 'A1'],
		['el neutro retorna por A2 de la bobina', red.id, 'N', personalizado.id, 'A2'],
		['la fase entra al común 11 del auxiliar', red.id, 'L', personalizado.id, '11'],
		['el NA 14 gobierna su carga identificable', personalizado.id, '14', lamparaNA.id, 'L'],
		['el NC 12 gobierna otra carga identificable', personalizado.id, '12', lamparaNC.id, 'L'],
		['la fase entra al primer polo principal', red.id, 'L', personalizado.id, '1/L1'],
		['la salida 2/T1 gobierna la carga del polo', personalizado.id, '2/T1', lamparaPolo.id, 'L'],
		['el neutro retorna desde la carga de polo', red.id, 'N', lamparaPolo.id, 'N'],
		['el neutro retorna desde la carga NA', red.id, 'N', lamparaNA.id, 'N'],
		['el neutro retorna desde la carga NC', red.id, 'N', lamparaNC.id, 'N'],
	]) {
		const r = await cablear(deId, deBorne, aId, aBorne);
		must(nombre, r.ok, r.motivo);
	}
	await flush();
	const cableado = await proyecto();
	const firmaCableadoOriginal = firmaCableado(cableado);
	must('los once conductores fueron creados por clics en el visor', cableado.conductores.length === 11,
		String(cableado.conductores.length));
	must('no hay cables fantasma', await qa('cablesDibujados') === cableado.conductores.length);

	await pagina.locator('#btn-energizar').click();
	const reposo = await esperarActivos([lamparaNC.id], [personalizado.id, lamparaPolo.id, lamparaNA.id]);
	const panelReposo = (await pagina.locator('#sim-funcionando').innerText()).replace(/\s+/g, ' ');
	must('con bobina en reposo solo conduce el auxiliar NC', reposo.activos.includes(lamparaNC.id)
		&& !reposo.activos.includes(lamparaPolo.id) && !reposo.activos.includes(lamparaNA.id), panelReposo);
	must('el estado NC es visible y distinguible en el panel', panelReposo.includes(lamparaNC.designacion)
		&& !panelReposo.includes(lamparaPolo.designacion) && !panelReposo.includes(lamparaNA.designacion), panelReposo);

	await accionarMandoVisible(selector.id);
	const trabajo = await esperarActivos(
		[personalizado.id, lamparaPolo.id, lamparaNA.id], [lamparaNC.id],
	);
	const panelTrabajo = (await pagina.locator('#sim-funcionando').innerText()).replace(/\s+/g, ' ');
	must('al accionar la bobina conducen un polo principal y el NA, y abre el NC',
		trabajo.activos.includes(lamparaPolo.id) && trabajo.activos.includes(lamparaNA.id)
		&& !trabajo.activos.includes(lamparaNC.id), trabajo.activos.join(', '));
	must('la UI muestra bobina alimentada y contactos cambiados',
		/bobina alimentada.*contactos cambiados/i.test(panelTrabajo), panelTrabajo);
	must('las cargas de polo y NA son visibles y la NC desaparece',
		panelTrabajo.includes(lamparaPolo.designacion) && panelTrabajo.includes(lamparaNA.designacion)
		&& !panelTrabajo.includes(lamparaNC.designacion), panelTrabajo);

	await accionarMandoVisible(selector.id);
	await esperarActivos([lamparaNC.id], [personalizado.id, lamparaPolo.id, lamparaNA.id]);
	must('volver el selector a reposo restablece el NC',
		(await qa('simulacion')).activos.includes(lamparaNC.id));

	console.log('\n--- 4. Autoguardado, recarga y segunda simulación ---');
	await pagina.locator('#btn-energizar').click();
	const documentoAntes = await flush();
	await pagina.reload({ waitUntil: 'load' });
	await esperarAplicacion();
	const documentoDespues = await qa('documentoActivo');
	const recargado = await proyecto();
	const instanciaRecargada = recargado.dispositivos.find((d) => d.id === personalizado.id);
	must('la recarga conserva el mismo documento activo', documentoDespues.id === documentoAntes.id,
		`${documentoAntes.id} / ${documentoDespues.id}`);
	must('la instancia, el asset y el perfil sobreviven', !!instanciaRecargada
		&& instanciaRecargada.assetId === original.assetId
		&& perfilContactorValido(instanciaRecargada)
		&& instanciaRecargada.imagen?.startsWith('blob:'));
	const idsCircuito = new Set([
		red.id, selector.id, personalizado.id, lamparaPolo.id, lamparaNA.id, lamparaNC.id,
	]);
	must('los once cables conservan exactamente sus extremos', recargado.conductores.length === 11
		&& recargado.conductores.every((c) => idsCircuito.has(c.de.dispositivoId)
			&& idsCircuito.has(c.a.dispositivoId))
		&& firmaCableado(recargado) === firmaCableadoOriginal, String(recargado.conductores.length));
	must('la definición reutilizable sigue en Mis Componentes',
		(await qa('componentesPersonalizados')).some((d) => d.id === original.id && perfilContactorValido(d)));

	await pagina.locator('#btn-energizar').click();
	await esperarActivos([lamparaNC.id], [personalizado.id, lamparaPolo.id, lamparaNA.id]);
	must('tras recargar, el reposo vuelve a alimentar exclusivamente el NC',
		(await qa('simulacion')).activos.includes(lamparaNC.id));
	await accionarMandoVisible(selector.id);
	const trabajoRecargado = await esperarActivos(
		[personalizado.id, lamparaPolo.id, lamparaNA.id], [lamparaNC.id],
	);
	must('tras recargar, polo y NA vuelven a cerrar y el NC vuelve a abrir',
		trabajoRecargado.activos.includes(lamparaPolo.id)
		&& trabajoRecargado.activos.includes(lamparaNA.id)
		&& !trabajoRecargado.activos.includes(lamparaNC.id), trabajoRecargado.activos.join(', '));
	await pagina.locator('#btn-energizar').click();
	await flush();

	console.log('\n--- 5. Exportar el PROYECTO completo e importarlo en un navegador limpio ---');
	const paqueteProyecto = await exportarProyectoPortable();
	await importarProyectoEnContextoLimpio(paqueteProyecto, personalizado.id);
	const proyectoImportado = await proyecto();
	const instanciaImportada = proyectoImportado.dispositivos.find((d) => d.id === personalizado.id);
	const bibliotecaImportada = await qa('componentesPersonalizados');
	must('el paquete abre el tablero completo con sus once cables', proyectoImportado.conductores.length === 11,
		String(proyectoImportado.conductores.length));
	must('el paquete conserva el mapa borne a borne, no solo la cantidad de cables',
		firmaCableado(proyectoImportado) === firmaCableadoOriginal);
	must('el paquete instala la definición reutilizable en la biblioteca limpia',
		bibliotecaImportada.some((d) => d.id === original.id && d.assetId === original.assetId));
	must('polos, NA y NC sobreviven al paquete de proyecto', perfilContactorValido(instanciaImportada)
		&& bibliotecaImportada.some((d) => d.id === original.id && perfilContactorValido(d)));
	must('el PNG se hidrata como imagen utilizable en el nuevo navegador',
		instanciaImportada?.assetId === original.assetId && instanciaImportada.imagen?.startsWith('blob:'));
	must('la importación no crea geometrías fantasma', await qa('cablesDibujados') === 11,
		`${await qa('cablesDibujados')}/11`);

	await pagina.locator('#btn-energizar').click();
	const reposoImportado = await esperarActivos(
		[lamparaNC.id], [personalizado.id, lamparaPolo.id, lamparaNA.id],
	);
	must('tras importar, el NC sigue cerrado en reposo', reposoImportado.activos.includes(lamparaNC.id));
	await accionarMandoVisible(selector.id);
	const simulacionImportada = await esperarActivos(
		[personalizado.id, lamparaPolo.id, lamparaNA.id], [lamparaNC.id],
	);
	const panelImportado = (await pagina.locator('#sim-funcionando').innerText()).replace(/\s+/g, ' ');
	must('el proyecto importado vuelve a energizar la bobina', simulacionImportada.activos.includes(personalizado.id)
		&& /bobina alimentada.*contactos cambiados/i.test(panelImportado), panelImportado);
	must('el polo principal y el NA importados conducen, mientras el NC abre',
		simulacionImportada.activos.includes(lamparaPolo.id)
		&& simulacionImportada.activos.includes(lamparaNA.id)
		&& !simulacionImportada.activos.includes(lamparaNC.id), simulacionImportada.activos.join(', '));
	must('el circuito importado conserva conductores vivos', simulacionImportada.conductoresVivos > 0,
		String(simulacionImportada.conductoresVivos));

	console.log('\n--- 6. Comparar con el contactor nativo que ofrece el catálogo ---');
	await pagina.locator('#btn-energizar').click();
	// La referencia nativa vive en un tablero limpio. Mezclarla con el fixture importado añadía seis
	// aparatos a una placa ya ocupada y podía dejar un borne fuera del encuadre: eso medía zoom, no
	// equivalencia eléctrica.
	// Se crea desde el recorrido visible vigente: Archivo → Mis tableros → Nuevo tablero.
	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-mis-tableros').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'visible' });
	await pagina.locator('#btn-nuevo-biblioteca').click();
	await pagina.waitForFunction(() => window.qa.proyecto().dispositivos.length === 0
		&& window.qa.proyecto().conductores.length === 0);
	const redNativa = await sacarDelCatalogo('Acometida 220 V', 'Acometida 220 V (red)');
	const fuente24 = await sacarDelCatalogo('Fuente 24 V 5 A', 'Fuente 24 V 5 A');
	const selectorNativo = await sacarDelCatalogo('Selector 2 posiciones', 'Selector 2 posiciones');
	const contactorNativo = await sacarDelCatalogo('Contactor 3P 9A', 'Contactor 3P 9A');
	const lamparaPoloNativa = await sacarDelCatalogo('Ampolleta 220 V', 'Ampolleta 220 V');
	const lamparaNANativa = await sacarDelCatalogo('Ampolleta 220 V', 'Ampolleta 220 V');
	must('la referencia nativa usa contactor real de catálogo y bobina de 24 V',
		fuente24?.tipo === 'fuente' && selectorNativo?.tipo === 'selector'
		&& contactorNativo?.tipo === 'contactor' && contactorNativo?.tensionNominal === 24);
	await pagina.locator('#hta-conectar').click();
	await pagina.locator('#btn-centrar').click();
	await pagina.waitForTimeout(700);
	for (const [nombre, deId, deBorne, aId, aBorne] of [
		['la red alimenta L de la fuente nativa', redNativa.id, 'L', fuente24.id, 'L'],
		['la red alimenta N de la fuente nativa', redNativa.id, 'N', fuente24.id, 'N'],
		['+24 V llega al selector nativo', fuente24.id, '+V', selectorNativo.id, '13'],
		['el selector nativo alimenta A1', selectorNativo.id, '14', contactorNativo.id, 'A1'],
		['-24 V retorna desde A2', fuente24.id, '-V', contactorNativo.id, 'A2'],
		['la fase entra al polo nativo', redNativa.id, 'L', contactorNativo.id, '1/L1'],
		['el polo nativo gobierna su carga', contactorNativo.id, '2/T1', lamparaPoloNativa.id, 'L'],
		['la carga de polo nativa retorna por N', redNativa.id, 'N', lamparaPoloNativa.id, 'N'],
		['la fase entra al NA nativo', redNativa.id, 'L', contactorNativo.id, '13'],
		['el NA nativo gobierna su carga', contactorNativo.id, '14', lamparaNANativa.id, 'L'],
		['la carga NA nativa retorna por N', redNativa.id, 'N', lamparaNANativa.id, 'N'],
	]) {
		const r = await cablear(deId, deBorne, aId, aBorne);
		must(nombre, r.ok, r.motivo);
	}
	await flush();
	await pagina.locator('#btn-energizar').click();
	const nativoReposo = await esperarActivos(
		[], [contactorNativo.id, lamparaPoloNativa.id, lamparaNANativa.id],
	);
	must('el polo y el NA nativos están abiertos con la bobina en reposo',
		!nativoReposo.activos.includes(lamparaPoloNativa.id)
		&& !nativoReposo.activos.includes(lamparaNANativa.id));
	await accionarMandoVisible(selectorNativo.id);
	const nativoTrabajo = await esperarActivos(
		[contactorNativo.id, lamparaPoloNativa.id, lamparaNANativa.id], [],
	);
	must('el nativo reproduce la misma conmutación de bobina, polo principal y NA',
		nativoTrabajo.activos.includes(contactorNativo.id)
		&& nativoTrabajo.activos.includes(lamparaPoloNativa.id)
		&& nativoTrabajo.activos.includes(lamparaNANativa.id), nativoTrabajo.activos.join(', '));
	console.log('INFO  el contactor nativo de catálogo solo declara NA 13/14; la apertura NC se '
		+ 'demuestra exclusivamente con el perfil explícito importado 11/12, sin inventar un borne nativo.');
	await pagina.waitForTimeout(400);
	must('sin errores JavaScript en todo el recorrido', erroresJs.length === 0, erroresJs.slice(0, 4).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	for (const [nombre, cerrar] of [
		['contexto Chromium', async () => contexto?.close()],
		['navegador Chromium', async () => navegador?.close()],
	] ) {
		try { await cerrar(); } catch (error) {
			fallos++;
			console.error(`No se pudo cerrar ${nombre}:`, error?.message ?? error);
		}
	}
	servidor.closeAllConnections?.();
	try {
		await new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
	} catch (error) {
		fallos++;
		console.error('No se pudo cerrar el servidor QA:', error?.message ?? error);
	}
	process.chdir(cwdInicial);
	rmSync(temporal, { recursive: true, force: true });
	if (chromeLogPrevio === undefined) delete process.env.CHROME_LOG_FILE;
	else process.env.CHROME_LOG_FILE = chromeLogPrevio;
}

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLO(S) ===`);
process.exitCode = fallos === 0 ? 0 : 1;
