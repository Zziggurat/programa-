/** Recorrido común de QA: ejemplo identificado, contenido comprobado y copia persistida. */
import { isDeepStrictEqual } from 'node:util';
import { esperarEditorListo } from './entorno.mjs';

function exigir(condicion, mensaje) {
	if (!condicion) throw new Error(`QA ejemplo: ${mensaje}`);
}

/** Cada suite declara los aparatos/cables que necesita; un ejemplo vacío nunca da 0/0 verde. */
export function verificarProyectoEjemplo(proyecto, requisitos = {}) {
	const { dispositivosMin = 1, conductoresMin = 0, dispositivoIds = [], conductorIds = [] } = requisitos;
	exigir(Number.isInteger(dispositivosMin) && dispositivosMin >= 0, 'dispositivosMin debe ser un entero no negativo');
	exigir(Number.isInteger(conductoresMin) && conductoresMin >= 0, 'conductoresMin debe ser un entero no negativo');
	exigir(Array.isArray(dispositivoIds) && Array.isArray(conductorIds), 'los IDs requeridos deben ser listas');
	exigir(dispositivosMin + conductoresMin + dispositivoIds.length + conductorIds.length > 0,
		'declara al menos una precondición positiva');
	exigir(Array.isArray(proyecto?.dispositivos) && proyecto.dispositivos.length >= dispositivosMin,
		`se esperaban al menos ${dispositivosMin} aparatos; hay ${proyecto?.dispositivos?.length ?? 'ninguno'}`);
	exigir(Array.isArray(proyecto?.conductores) && proyecto.conductores.length >= conductoresMin,
		`se esperaban al menos ${conductoresMin} conductores; hay ${proyecto?.conductores?.length ?? 'ninguno'}`);
	for (const id of dispositivoIds) {
		exigir(proyecto.dispositivos.some(dispositivo => dispositivo.id === id), `falta el aparato ${id}`);
	}
	for (const id of conductorIds) {
		exigir(proyecto.conductores.some(conductor => conductor.id === id), `falta el conductor ${id}`);
	}
}

function contenido(proyecto) {
	const { nombre: _nombre, esEjemplo: _esEjemplo, ...resto } = proyecto;
	// El cargador materializa claves opcionales con valor `undefined`; el formato durable JSON las
	// omite. Se compara exactamente el contenido serializable, no el detalle de representación JS.
	return JSON.parse(JSON.stringify(resto));
}

function primeraDiferencia(a, b, ruta = 'proyecto') {
	if (isDeepStrictEqual(a, b)) return '';
	if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null)
		return `${ruta}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`.slice(0, 300);
	const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const clave of claves) {
		if (Object.hasOwn(a, clave) !== Object.hasOwn(b, clave))
			return `${ruta}.${clave}: presencia ${Object.hasOwn(a, clave)} (${JSON.stringify(a[clave])}) ≠ ${Object.hasOwn(b, clave)} (${JSON.stringify(b[clave])})`;
		const diferencia = primeraDiferencia(a[clave], b[clave], `${ruta}.${clave}`);
		if (diferencia) return diferencia;
	}
	return `${ruta}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`.slice(0, 300);
}

/** El cargador puede añadir defaults, pero no puede perder ni modificar datos declarados. */
function primeraPerdida(original, copia, ruta = 'proyecto') {
	if (original === undefined) return '';
	if (Array.isArray(original)) {
		if (!Array.isArray(copia) || original.length !== copia.length)
			return `${ruta}: ${original.length} elementos ≠ ${copia?.length ?? 'ninguno'}`;
		for (let i = 0; i < original.length; i++) {
			const diferencia = primeraPerdida(original[i], copia[i], `${ruta}.${i}`);
			if (diferencia) return diferencia;
		}
		return '';
	}
	if (original && typeof original === 'object') {
		if (!copia || typeof copia !== 'object' || Array.isArray(copia)) return `${ruta}: cambió de tipo`;
		for (const [clave, valor] of Object.entries(original)) {
			if (valor === undefined) continue;
			if (!Object.hasOwn(copia, clave)) return `${ruta}.${clave}: dato ausente en la copia`;
			const diferencia = primeraPerdida(valor, copia[clave], `${ruta}.${clave}`);
			if (diferencia) return diferencia;
		}
		return '';
	}
	return Object.is(original, copia) ? '' : `${ruta}: ${JSON.stringify(original)} ≠ ${JSON.stringify(copia)}`.slice(0, 300);
}

/** Valida identidad nueva, contenido completo y presencia en el repositorio tras flush. */
export function verificarCopiaEjemplo({ anterior, ejemplo, copia, persistido, registrados, requisitos }) {
	verificarProyectoEjemplo(ejemplo, requisitos);
	verificarProyectoEjemplo(copia, requisitos);
	exigir(ejemplo.esEjemplo === true, 'el origen dejó de ser un ejemplo de solo lectura');
	exigir(copia.esEjemplo !== true, 'la copia sigue marcada como ejemplo');
	exigir(Boolean(anterior?.id && persistido?.id && persistido.id !== anterior.id),
		'la copia no recibió una identidad documental nueva');
	exigir(persistido.nombre === copia.nombre && persistido.proyecto?.nombre === copia.nombre,
		'el nombre del documento no coincide con el proyecto guardado');
	const perdida = primeraPerdida(contenido(ejemplo), contenido(copia));
	exigir(!perdida, `la copia perdió o cambió datos declarados del ejemplo: ${perdida}`);
	exigir(isDeepStrictEqual(contenido(copia), contenido(persistido.proyecto)),
		`el documento persistido perdió contenido de la copia: ${primeraDiferencia(contenido(copia), contenido(persistido.proyecto))}`);
	exigir(Array.isArray(registrados) && registrados.some(d =>
		d.id === persistido.id && d.nombre === persistido.nombre),
		'la copia no figura en el repositorio de proyectos');
}

/**
 * Abre un ejemplo por título exacto usando los controles visibles y crea una copia independiente.
 * Solo se usa en build QA: `window.qa` permite observar la transacción y el contenido sin mutarlos.
 * `confirmarReemplazo` debe ser explícito cuando el tablero previo tiene trabajo pendiente.
 */
export async function abrirEjemploYCopiar(page, {
	titulo, requisitos = { dispositivosMin: 1 }, confirmarReemplazo = false, timeout = 60_000,
} = {}) {
	exigir(typeof titulo === 'string' && titulo.trim(), 'falta el título exacto del ejemplo');
	await esperarEditorListo(page, { timeout });
	const anterior = await page.evaluate(() => window.qa.esperarPersistencia());
	exigir(anterior?.id, 'no hay un documento activo listo antes de abrir el ejemplo');
	exigir(!(await page.evaluate(() => window.qa.documentoActivo().ejemplo)),
		'el recorrido debe comenzar desde un documento, no desde otro ejemplo');

	if (!(await page.locator('#modal-ejemplos').isVisible())) {
		if (await page.locator('#inicio').isVisible()) {
			await page.locator('#inicio-ejemplos').click();
		} else {
			await page.locator('#btn-aprender').click();
			await page.locator('#btn-ejemplos').click();
		}
	}
	await page.locator('#modal-ejemplos').waitFor({ state: 'visible', timeout });
	const tarjeta = page.locator('.tarjeta-ejemplo').filter({
		has: page.getByRole('heading', { name: titulo, exact: true }),
	});
	exigir((await tarjeta.count()) === 1, `se esperaba una sola tarjeta titulada «${titulo}»`);
	await tarjeta.getByRole('button', { name: 'Abrir y estudiar', exact: true }).click();
	await page.waitForFunction(() =>
		document.getElementById('modal-dialogo')?.hidden === false
		|| document.getElementById('modal-ejemplos')?.hidden === true,
		undefined, { timeout });
	if (await page.locator('#modal-dialogo').isVisible()) {
		exigir(confirmarReemplazo, 'el editor pidió confirmar el reemplazo del tablero anterior');
		await page.locator('#dialogo-ok').click();
	}
	await page.waitForFunction(() => {
		const proyecto = window.qa?.proyecto?.();
		return proyecto?.esEjemplo === true && window.qa?.documentoActivo?.().ejemplo === true
			&& document.getElementById('chip-ejemplo')?.hidden === false
			&& document.getElementById('modal-ejemplos')?.hidden === true;
	}, undefined, { timeout });
	const ejemplo = await page.evaluate(() => window.qa.proyecto());
	verificarProyectoEjemplo(ejemplo, requisitos);
	if (await page.locator('#modal-explicacion').isVisible()) {
		await page.locator('#btn-cerrar-explicacion').click();
	}

	await page.locator('#btn-copiar-ejemplo').click();
	await page.waitForFunction((idAnterior) => {
		const activo = window.qa?.documentoActivo?.();
		return activo?.id && activo.id !== idAnterior && activo.ejemplo === false
			&& window.qa?.proyecto?.().esEjemplo !== true
			&& document.getElementById('chip-ejemplo')?.hidden === true;
	}, anterior.id, { timeout });
	const persistido = await page.evaluate(() => window.qa.esperarPersistencia());
	const copia = await page.evaluate(() => window.qa.proyecto());
	const registrados = await page.evaluate(() => window.qa.documentos());
	verificarCopiaEjemplo({ anterior, ejemplo, copia, persistido, registrados, requisitos });
	return { ejemplo, copia, documento: persistido };
}
