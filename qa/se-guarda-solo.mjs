/**
 * REGRESIÓN END-TO-END DEL AUTOGUARDADO.
 *
 * La modificación se hace exclusivamente por la interfaz pública: biblioteca, nombre del
 * proyecto, herramienta Montaje, formulario de estructura y botón Aplicar. `window.qa` se usa
 * solo después para observar el resultado serializado; nunca para provocar el cambio.
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor, url } = await servidorDeQA();
const navegador = await abrirNavegador(chromium);
const pagina = await navegador.newPage({ viewport: { width: 1400, height: 900 } });
pagina.setDefaultTimeout(45_000);

const errores = [];
pagina.on('pageerror', (error) => errores.push(`PAGEERROR: ${error.message}`));
pagina.on('console', (mensaje) => {
	if (mensaje.type() === 'error' && !/favicon|404|Not Found/i.test(mensaje.text())) errores.push(mensaje.text());
});

let fallos = 0;
const comprobar = (descripcion, condicion, detalle = '') => {
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${descripcion}${detalle ? ` → ${detalle}` : ''}`);
};

async function cerrarSiVisible(selector) {
	const elemento = pagina.locator(selector);
	if (await elemento.isVisible().catch(() => false)) await elemento.click();
}

async function abrirEjemploDesdeLaInterfaz() {
	await cerrarSiVisible('#btn-cerrar-ayuda');
	// Se parte de la ventana de inicio: este botón también la oculta, cosa que el antiguo atajo
	// `#btn-empezar-ejemplo` no hacía cuando se pulsaba fuera de su contexto.
	await pagina.locator('#inicio-ejemplos').click();
	await pagina.locator('.tarjeta-ejemplo button').first().click();
	await cerrarSiVisible('#dialogo-ok');
	await cerrarSiVisible('#btn-cerrar-explicacion');
	if (!(await trabajarSobreCopia(pagina))) throw new Error('el ejemplo no ofreció una copia editable');
}

async function estadoPersistente() {
	return pagina.evaluate(() => {
		const proyecto = window.qa.proyecto();
		return {
			nombre: proyecto.nombre,
			ancho: proyecto.gabinete?.ancho,
			espacio: window.qa.estadoInteraccion().espacio,
		};
	});
}

const NOMBRE = 'Regresión de autoguardado QA';
const ANCHO_CM = 83;

try {
	await pagina.goto(`${url}/?qa=1`, { waitUntil: 'domcontentloaded' });
	await pagina.waitForFunction(() => !!window.qa);
	await abrirEjemploDesdeLaInterfaz();

	console.log('\n--- modificar mediante la interfaz real ---');
	await pagina.locator('#nombre-proyecto').fill(NOMBRE);
	await pagina.locator('#nombre-proyecto').press('Tab');
	await pagina.locator('#hta-estructura').click();
	await pagina.locator('#seccion-estructura > summary').click();
	await pagina.locator('#aplicar-dim').waitFor({ state: 'visible' });
	await pagina.locator('#dim-ancho').fill(String(ANCHO_CM));
	await pagina.locator('#aplicar-dim').click();
	await pagina.waitForFunction(([nombre, ancho]) => {
		const proyecto = window.qa.proyecto();
		return proyecto.nombre === nombre && proyecto.gabinete?.ancho === ancho;
	}, [NOMBRE, ANCHO_CM * 10]);

	const antes = await estadoPersistente();
	comprobar('la UI aplicó el nombre', antes.nombre === NOMBRE, antes.nombre);
	comprobar('la UI aplicó el ancho', antes.ancho === ANCHO_CM * 10, `${antes.ancho} mm`);

	console.log('\n--- recargar el navegador ---');
	await pagina.reload({ waitUntil: 'domcontentloaded' });
	await pagina.waitForFunction(() => !!window.qa);
	const recargado = await estadoPersistente();
	comprobar('el nombre sobrevivió a la recarga', recargado.nombre === NOMBRE, recargado.nombre);
	comprobar('el ancho sobrevivió a la recarga', recargado.ancho === ANCHO_CM * 10, `${recargado.ancho} mm`);
	// Tras una recarga normal vuelve a aparecer la ventana de inicio. Entrar al editor es parte del
	// recorrido real; forzar `hidden` desde la prueba ocultaría precisamente un fallo de navegación.
	await pagina.locator('#inicio-tableros').click();
	await cerrarSiVisible('#btn-cerrar-ayuda');

	console.log('\n--- cambiar de espacio y volver ---');
	await pagina.locator('#esp-frontal').click();
	await pagina.locator('#esp-frontal.activo').waitFor();
	const frontal = await estadoPersistente();
	comprobar('el estado persiste en Frontal', frontal.nombre === NOMBRE && frontal.ancho === ANCHO_CM * 10);
	await pagina.locator('#esp-interior').click();
	await pagina.locator('#esp-interior.activo').waitFor();
	await pagina.locator('#hta-estructura').click();
	if (!(await pagina.locator('#seccion-estructura').evaluate((e) => e.open))) {
		await pagina.locator('#seccion-estructura > summary').click();
	}
	await pagina.locator('#aplicar-dim').waitFor({ state: 'visible' });
	comprobar('el formulario restaurado muestra el ancho guardado',
		await pagina.locator('#dim-ancho').inputValue() === String(ANCHO_CM),
		await pagina.locator('#dim-ancho').inputValue());

	comprobar('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3).join(' | '));
} finally {
	await navegador.close();
	servidor.close();
}

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLO(S) ===`);
process.exit(fallos === 0 ? 0 : 1);
