/**
 * Recorrido vertical de la biblioteca IndexedDB usando la interfaz real.
 *
 * Crea y modifica A/B, abre un ejemplo efímero, vuelve, alterna A/B y cierra la página. La
 * segunda página usa el mismo contexto del navegador: es una reapertura de la aplicación con
 * IndexedDB intacta, no una lectura del modelo para fabricar el resultado.
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ARGS_NAVEGADOR, ejecutableNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor, url } = await servidorDeQA();
const cwdInicial = process.cwd();
const cwdNavegador = mkdtempSync(join(tmpdir(), 'qa-multiproyecto-'));
process.chdir(cwdNavegador);
let contexto;
let fallos = 0;
const errores = [];
console.log('--- Biblioteca multiproyecto: recorrido A/B/ejemplo/reapertura ---');
const must = (nombre, condicion, extra = '') => {
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${extra ? ` → ${extra}` : ''}`);
};

const vigilar = (pagina) => {
	pagina.setDefaultTimeout(60_000);
	pagina.on('pageerror', (e) => errores.push(`PAGEERROR: ${e.message}`));
	pagina.on('console', (m) => {
		const recurso = m.location().url ?? '';
		if (m.type() === 'error' && !/\/favicon\.ico(?:$|\?)/i.test(recurso)) {
			errores.push(`${m.text()}${recurso ? ` @ ${recurso}` : ''}`);
		}
	});
};
const qa = (pagina, metodo, ...args) => pagina.evaluate(
	([nombre, parametros]) => window.qa[nombre](...parametros), [metodo, args],
);
const guardar = (pagina) => qa(pagina, 'esperarPersistencia');
const nombrar = async (pagina, nombre) => {
	const entrada = pagina.locator('#nombre-proyecto');
	await entrada.fill(nombre);
	await entrada.press('Tab');
	await guardar(pagina);
};
const abrirBiblioteca = async (pagina) => {
	await pagina.locator('#btn-archivo').click();
	await pagina.locator('#btn-mis-tableros').click();
	await pagina.locator('#modal-tableros').waitFor({ state: 'visible' });
};
const abrirDocumento = async (pagina, id, nombre) => {
	await abrirBiblioteca(pagina);
	const tarjeta = pagina.locator(`.tarjeta-documento[data-documento-id="${id}"]`);
	await tarjeta.getByRole('button', { name: 'Abrir', exact: true }).click();
	await pagina.waitForFunction((documentoId) => window.qa.documentoActivo().id === documentoId, id);
	await guardar(pagina);
};
const firmaAparatos = (p) => p.dispositivos.map((d) => `${d.id}:${d.tipo}`).sort().join('|');
const anadirDelCatalogo = async (pagina, texto) => {
	if (!(await pagina.locator('#modo-editor').evaluate((b) => b.classList.contains('activo')))) {
		await pagina.locator('#modo-editor').click();
	}
	await pagina.locator('#hta-anadir').click();
	await pagina.locator('#seccion-catalogo').waitFor({ state: 'visible' });
	await pagina.locator('#catalogo .item-catalogo').filter({ hasText: texto }).first().click();
};

const abrirContextoPersistente = () => {
	const executablePath = ejecutableNavegador();
	return chromium.launchPersistentContext(join(cwdNavegador, 'perfil'), {
		...(executablePath ? { executablePath } : {}), args: ARGS_NAVEGADOR,
		viewport: { width: 1440, height: 900 },
	});
};

try {
	contexto = await abrirContextoPersistente();
	console.log('... Chromium abierto');
	let pagina = contexto.pages()[0] ?? await contexto.newPage(); vigilar(pagina);
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	console.log('... aplicación cargada');
	await pagina.waitForFunction(() => !!window.qa?.esperarPersistencia);
	await guardar(pagina);
	console.log('... repositorio inicializado');
	if (await pagina.locator('#bienvenida').isVisible()) {
		await pagina.evaluate(() => document.getElementById('btn-empezar-blanco')?.click());
	}
	if (await pagina.locator('#modal-ayuda').isVisible()) {
		await pagina.locator('#btn-cerrar-ayuda').click();
	}

	// El documento inicial de una biblioteca vacía se convierte en A mediante controles reales.
	await nombrar(pagina, 'Tablero A');
	console.log('... A nombrado');
	await anadirDelCatalogo(pagina, 'Contactor 3P 9A');
	await guardar(pagina);
	console.log('... A modificado');
	const activoA = await qa(pagina, 'documentoActivo');
	const proyectoA = await qa(pagina, 'proyecto');
	const cantidadA = proyectoA.dispositivos.length;
	const firmaA = firmaAparatos(proyectoA);
	must('A tiene identidad estable y un contactor propio', !!activoA.id && cantidadA === 1
		&& proyectoA.dispositivos[0]?.tipo === 'contactor',
		`${activoA.id ?? 'sin id'} · ${firmaA}`);

	// Nuevo tablero desde Mis Tableros: no vacía A ni usa Deshacer.
	await abrirBiblioteca(pagina);
	await pagina.locator('#btn-nuevo-biblioteca').click();
	await pagina.waitForFunction(() => document.getElementById('modal-tableros')?.hidden === true);
	await nombrar(pagina, 'Tablero B');
	for (const texto of ['Piloto 24 V', 'Pulsador marcha/paro']) {
		await anadirDelCatalogo(pagina, texto);
	}
	await guardar(pagina);
	const activoB = await qa(pagina, 'documentoActivo');
	const proyectoB = await qa(pagina, 'proyecto');
	const cantidadB = proyectoB.dispositivos.length;
	const firmaB = firmaAparatos(proyectoB);
	must('B tiene otra identidad y piloto/pulsador propios', activoB.id !== activoA.id && cantidadB === 2
		&& proyectoB.dispositivos.some((d) => d.tipo === 'piloto')
		&& proyectoB.dispositivos.some((d) => d.tipo === 'pulsador'),
		`${activoB.id ?? 'sin id'} · ${firmaB}`);

	// El ejemplo es una vista efímera y volver restaura el último documento, B.
	await abrirBiblioteca(pagina);
	console.log('... biblioteca abierta desde B');
	await pagina.evaluate(() => document.getElementById('btn-ejemplos-biblioteca')?.click());
	await pagina.locator('#modal-ejemplos').waitFor({ state: 'visible' });
	console.log('... ejemplos visibles');
	await pagina.locator('.tarjeta-ejemplo button').first().evaluate((boton) => boton.click());
	console.log('... ejemplo solicitado');
	if (await pagina.locator('#modal-dialogo').isVisible()) {
		await pagina.evaluate(() => document.getElementById('dialogo-ok')?.click());
	}
	await pagina.waitForFunction(() => document.getElementById('chip-ejemplo')?.hidden === false);
	console.log('... ejemplo montado');
	if (await pagina.locator('#modal-explicacion').isVisible()) await pagina.locator('#btn-cerrar-explicacion').click();
	must('abrir un ejemplo no crea ni reemplaza documentos',
		(await qa(pagina, 'documentos')).length === 2 && (await qa(pagina, 'documentoActivo')).ejemplo === true);
	await pagina.evaluate(() => document.getElementById('btn-volver-tablero')?.click());
	await pagina.waitForFunction(() => document.getElementById('chip-ejemplo')?.hidden !== false);
	await guardar(pagina);
	must('Volver a mi tablero restaura B',
		(await qa(pagina, 'documentoActivo')).id === activoB.id
			&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaB);

	await abrirDocumento(pagina, activoA.id, 'Tablero A');
	must('A reaparece intacto después de B y del ejemplo',
		(await qa(pagina, 'documentoActivo')).id === activoA.id
			&& (await qa(pagina, 'proyecto')).nombre === 'Tablero A'
			&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaA);
	const snapshotsA = await qa(pagina, 'snapshots');
	must('A conserva recuperación aislada', snapshotsA.length >= 1
		&& snapshotsA.every((s) => s.projectId === activoA.id), `${snapshotsA.length} snapshots`);
	await abrirDocumento(pagina, activoB.id, 'Tablero B');
	must('B reaparece intacto al alternar A/B',
		(await qa(pagina, 'documentoActivo')).id === activoB.id
			&& (await qa(pagina, 'proyecto')).nombre === 'Tablero B'
			&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaB);
	const snapshotsB = await qa(pagina, 'snapshots');
	must('B conserva recuperación aislada', snapshotsB.length >= 1
		&& snapshotsB.every((s) => s.projectId === activoB.id), `${snapshotsB.length} snapshots`);

	// Cerrar el proceso completo y volverlo a abrir con el mismo perfil persistente.
	await pagina.close();
	await contexto.close();
	contexto = await abrirContextoPersistente();
	pagina = contexto.pages()[0] ?? await contexto.newPage(); vigilar(pagina);
	await pagina.goto(`${url}/?qa=1&inicio=0`, { waitUntil: 'load' });
	await pagina.waitForFunction(() => !!window.qa?.esperarPersistencia);
	await guardar(pagina);
	if (await pagina.locator('#modal-ayuda').isVisible()) {
		await pagina.locator('#btn-cerrar-ayuda').click();
	}
	const trasReabrir = await qa(pagina, 'documentoActivo');
	const documentos = await qa(pagina, 'documentos');
	must('la reapertura recupera el último tablero B', trasReabrir.id === activoB.id
		&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaB);
	must('A y B siguen en la biblioteca y ningún ejemplo fue persistido',
		documentos.length === 2 && documentos.map((d) => d.nombre).sort().join('|') === 'Tablero A|Tablero B',
		documentos.map((d) => d.nombre).join(', '));

	// No basta con que las tarjetas sobrevivan: se vuelven a montar ambos documentos desde
	// IndexedDB y se comprueba su contenido y su recuperación después del reinicio completo.
	await abrirDocumento(pagina, activoA.id, 'Tablero A');
	let snapshotsTrasReabrirA = await qa(pagina, 'snapshots');
	must('tras reiniciar, A conserva nombre, contenido y snapshots',
		(await qa(pagina, 'proyecto')).nombre === 'Tablero A'
			&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaA
			&& snapshotsTrasReabrirA.length >= snapshotsA.length
			&& snapshotsTrasReabrirA.every((s) => s.projectId === activoA.id),
		`${firmaAparatos(await qa(pagina, 'proyecto'))} · ${snapshotsTrasReabrirA.length} snapshots`);

	// La restauración se ejerce por la fila visible. Primero se crea una diferencia posterior al
	// snapshot conocido; restaurar debe volver exactamente a la firma anterior, no solo cerrar el modal.
	const snapshotRestaurable = snapshotsTrasReabrirA.find((s) => firmaAparatos(s.proyecto) === firmaA);
	must('A ofrece un snapshot restaurable de su contenido conocido', !!snapshotRestaurable,
		`${snapshotsTrasReabrirA.length} snapshots`);
	if (snapshotRestaurable) {
		await anadirDelCatalogo(pagina, 'Piloto 24 V');
		await guardar(pagina);
		must('la versión previa a restaurar es realmente distinta',
			firmaAparatos(await qa(pagina, 'proyecto')) !== firmaA);
		const snapshotsAntesDeRestaurar = await qa(pagina, 'snapshots');
		const indiceSnapshot = snapshotsAntesDeRestaurar.findIndex((s) => s.id === snapshotRestaurable.id);
		must('el snapshot objetivo conserva identidad después de editar', indiceSnapshot >= 0,
			snapshotRestaurable.id);
		await abrirBiblioteca(pagina);
		const versiones = pagina.locator('.recuperacion-biblioteca').first();
		await versiones.locator('summary').click();
		const filas = pagina.locator('#lista-recuperacion .fila-snapshot');
		await filas.nth(indiceSnapshot).getByRole('button', { name: 'Restaurar', exact: true }).click();
		await pagina.locator('#modal-dialogo').waitFor({ state: 'visible' });
		await pagina.locator('#dialogo-ok').click();
		await pagina.waitForFunction((firma) => {
			const p = window.qa.proyecto();
			return p.dispositivos.map((d) => `${d.id}:${d.tipo}`).sort().join('|') === firma;
		}, firmaA);
		await guardar(pagina);
		must('Restaurar recupera por UI la identidad, nombre y contenido de A',
			(await qa(pagina, 'documentoActivo')).id === activoA.id
				&& (await qa(pagina, 'proyecto')).nombre === 'Tablero A'
				&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaA);
	}

	await abrirDocumento(pagina, activoB.id, 'Tablero B');
	const snapshotsTrasReabrirB = await qa(pagina, 'snapshots');
	must('tras reiniciar, B conserva nombre, contenido y snapshots',
		(await qa(pagina, 'proyecto')).nombre === 'Tablero B'
			&& firmaAparatos(await qa(pagina, 'proyecto')) === firmaB
			&& snapshotsTrasReabrirB.length >= snapshotsB.length
			&& snapshotsTrasReabrirB.every((s) => s.projectId === activoB.id),
		`${firmaAparatos(await qa(pagina, 'proyecto'))} · ${snapshotsTrasReabrirB.length} snapshots`);

	// Duplicar y eliminar se comprueban desde la tarjeta; la copia no puede alterar A/B ni quedar
	// como proyecto activo al borrarla.
	await abrirBiblioteca(pagina);
	await pagina.locator(`.tarjeta-documento[data-documento-id="${activoB.id}"]`)
		.getByRole('button', { name: 'Duplicar', exact: true }).click();
	await pagina.waitForFunction(() => window.qa.documentos().then((ds) => ds.length === 3));
	const trasDuplicar = await qa(pagina, 'documentos');
	const copia = trasDuplicar.find((d) => d.id !== activoA.id && d.id !== activoB.id);
	must('Duplicar crea una tercera identidad independiente sin cambiar B', !!copia
		&& (await qa(pagina, 'documentoActivo')).id === activoB.id, copia?.id ?? 'sin copia');
	if (copia) {
		await pagina.locator(`.tarjeta-documento[data-documento-id="${copia.id}"]`)
			.getByRole('button', { name: 'Eliminar', exact: true }).click();
		await pagina.locator('#modal-dialogo').waitFor({ state: 'visible' });
		await pagina.locator('#dialogo-ok').click();
		await pagina.waitForFunction(() => window.qa.documentos().then((ds) => ds.length === 2));
		const trasEliminar = await qa(pagina, 'documentos');
		must('Eliminar quita solo la copia y mantiene A/B aislados',
			trasEliminar.map((d) => d.id).sort().join('|') === [activoA.id, activoB.id].sort().join('|')
				&& (await qa(pagina, 'documentoActivo')).id === activoB.id);
	}
	must('sin errores JavaScript nuevos', errores.length === 0, errores.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	for (const [nombre, cerrar] of [
		['contexto Chromium', async () => contexto?.close()],
	]) {
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
	rmSync(cwdNavegador, { recursive: true, force: true });
}

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ===`);
process.exitCode = fallos === 0 ? 0 : 1;
