/**
 * ABRIR UN PROYECTO ES TODO O NADA: proyecto, historial Y repositorio.
 *
 * Tercera auditoría, TS3-P2-03. Al abrir un archivo, `capturar()` mete el estado actual en la pila
 * de deshacer y VACÍA la de rehacer antes de que el proyecto nuevo esté montado. Si el montaje
 * falla, el `catch` devuelve `proyecto` a su sitio —eso ya estaba arreglado, TS2-P1-01— pero no
 * las pilas: queda un paso de deshacer que no deshace nada y, sobre todo, se ha perdido TODO lo
 * que hubiera para rehacer. El guardado actual vive en IndexedDB y tampoco puede quedar un
 * documento fantasma en la biblioteca si el montaje rechazó el archivo.
 *
 * El informe lo dice tal cual: «No se reprodujo una excepción natural postvalidación en el
 * recorrido normal; es un defecto condicional de atomicidad. Debe probarse inyectando un fallo
 * después de `capturar` y antes del commit». Eso es lo que hace esta prueba, con
 * `window.qa.romperProximoMontaje()`.
 *
 * El caso de uso real, sin nada raro: llevas un rato trabajando, deshaces un par de cosas porque
 * te lo estabas pensando, y pruebas a abrir un archivo que resulta estar mal. El archivo no se
 * abre —eso es correcto— pero además te quedas sin poder rehacer lo que habías deshecho.
 *
 *   node qa/abrir-atomico.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

/**
 * Importar ya no reemplaza ni descarta el tablero actual: crea otra identidad en la biblioteca.
 * Por eso no debe aparecer la antigua confirmación destructiva. Si reaparece, se desbloquea para
 * que la suite pueda terminar y se devuelve `false` como regresión, sin medir un diálogo colgado.
 */
async function esperarOperacionSinDialogo(completada, timeout = 20_000) {
	const resultado = await Promise.race([
		p.waitForFunction(completada, null, { timeout }).then(() => 'completada'),
		p.waitForSelector('#modal-dialogo:not([hidden])', { timeout }).then(() => 'dialogo'),
	]);
	if (resultado === 'completada') return true;
	await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
	await p.waitForSelector('#modal-dialogo[hidden]', { timeout: 10_000 }).catch(() => {});
	await p.waitForFunction(completada, null, { timeout });
	return false;
}

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(200);

/*
 * Cuatro aparatos del catálogo y dos «deshacer»: así hay pila de deshacer Y pila de rehacer, que
 * es la que se pierde. Se añaden del catálogo porque es la mutación más simple que de verdad pasa
 * por `capturar()` —cambiar el nombre del proyecto, por ejemplo, NO entra en el historial— y no
 * depende de dónde esté el ratón.
 */
await qa('esperarPersistencia');
await p.evaluate(() => document.getElementById('btn-empezar-blanco')?.click());
await p.waitForFunction(() => document.getElementById('bienvenida')?.hidden === true, null, { timeout: 20_000 });
await qa('esperarPersistencia');
// El catálogo vive en el cajón real de «Añadir»; se abre como lo haría una persona.
await p.locator('#hta-anadir').click();
await p.waitForSelector('#seccion-catalogo:not([hidden])');
const catalogo = p.locator('#catalogo button');
for (let i = 0; i < 4; i++) { await catalogo.nth(i).click(); await p.waitForTimeout(250); }
await p.evaluate(() => document.getElementById('btn-deshacer')?.click()); await p.waitForTimeout(300);
await p.evaluate(() => document.getElementById('btn-deshacer')?.click()); await p.waitForTimeout(300);

/*
 * Se guarda el proyecto ENTERO serializado, no solo el número de aparatos. Es lo que pide el punto
 * 12 de las pruebas de aceptación del informe: «proyecto, Undo, Redo y autosave deben quedar byte a
 * byte iguales». Contar aparatos dejaría pasar un cambio que no añade ni quita ninguno.
 */
const documentoAntes = await qa('esperarPersistencia');
const antes = {
	historial: await qa('historial'),
	aparatos: (await qa('proyecto')).dispositivos.length,
	proyecto: JSON.stringify(await qa('proyecto')),
	documentoId: documentoAntes.id,
	guardado: JSON.stringify(documentoAntes.proyecto),
	biblioteca: (await qa('documentos')).map((d) => d.id).sort(),
};
console.log(`\nestado de partida: deshacer=${antes.historial.deshacer} rehacer=${antes.historial.rehacer} aparatos=${antes.aparatos}`);
must('CONDICIÓN PREVIA: hay pila de deshacer', antes.historial.deshacer > 0, String(antes.historial.deshacer));
must('CONDICIÓN PREVIA: hay pila de REHACER (es la que se pierde)', antes.historial.rehacer >= 2,
	String(antes.historial.rehacer));

/*
 * Y ahora se abre un archivo perfectamente válido, pero se rompe el montaje a propósito. Es la
 * fase de después de validar: el archivo está bien, lo que falla es el render.
 */
console.log('\n--- abrir un archivo válido con el montaje roto ---');
const otro = JSON.stringify({
	formato: 'tablero-studio', version: 1, nombre: 'EL QUE NO SE DEBE ABRIR',
	gabinete: { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] },
	hojas: [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }],
	dispositivos: [], conductores: [],
});
await qa('romperProximoMontaje');
await p.evaluate((texto) => {
	const entrada = document.getElementById('archivo-abrir');
	const dt = new DataTransfer();
	dt.items.add(new File([texto], 'otro.tablero.json', { type: 'application/json' }));
	entrada.files = dt.files;
	entrada.dispatchEvent(new Event('change', { bubbles: true }));
}, otro);
const sinDialogoAlFallar = await esperarOperacionSinDialogo(
	() => /no se pudo/i.test(document.getElementById('toast')?.textContent ?? ''),
);
must('importar como otro tablero no pide descartar el actual', sinDialogoAlFallar);

const documentoDespues = await qa('esperarPersistencia');
const despues = {
	historial: await qa('historial'),
	aparatos: (await qa('proyecto')).dispositivos.length,
	proyecto: JSON.stringify(await qa('proyecto')),
	documentoId: documentoDespues.id,
	guardado: JSON.stringify(documentoDespues.proyecto),
	biblioteca: (await qa('documentos')).map((d) => d.id).sort(),
};
console.log(`estado tras el fallo: deshacer=${despues.historial.deshacer} rehacer=${despues.historial.rehacer} aparatos=${despues.aparatos}`);

must('el proyecto en pantalla sigue siendo el de antes', despues.aparatos === antes.aparatos,
	`${antes.aparatos} → ${despues.aparatos} aparatos`);
must('y queda IDÉNTICO, campo a campo', despues.proyecto === antes.proyecto,
	despues.proyecto === antes.proyecto ? '' : `${antes.proyecto.length} → ${despues.proyecto.length} caracteres`);
must('la pila de DESHACER no crece con un paso que no hizo nada',
	despues.historial.deshacer === antes.historial.deshacer,
	`${antes.historial.deshacer} → ${despues.historial.deshacer}`);
must('la pila de REHACER sigue entera',
	despues.historial.rehacer === antes.historial.rehacer,
	`${antes.historial.rehacer} → ${despues.historial.rehacer}`);
must('el documento activo conserva su identidad', despues.documentoId === antes.documentoId,
	`${antes.documentoId} → ${despues.documentoId}`);
must('IndexedDB NO contiene el proyecto que no se pudo montar',
	!(despues.guardado ?? '').includes('EL QUE NO SE DEBE ABRIR'));
must('el documento guardado sigue siendo lo de antes', despues.guardado === antes.guardado);
must('el montaje fallido no deja un documento fantasma en la biblioteca',
	JSON.stringify(despues.biblioteca) === JSON.stringify(antes.biblioteca),
	`${antes.biblioteca.length} → ${despues.biblioteca.length} tableros`);

/* Y el editor tiene que seguir vivo: rehacer devuelve lo que había, sin recargar la página. */
console.log('\n--- y el editor sigue funcionando ---');
await p.evaluate(() => document.getElementById('btn-rehacer')?.click()); await p.waitForTimeout(350);
must('rehacer sigue funcionando después del fallo',
	(await qa('proyecto')).dispositivos.length === antes.aparatos + 1,
	`${antes.aparatos} → ${(await qa('proyecto')).dispositivos.length} aparatos`);

/*
 * Y AHORA EL CAMINO BUENO, que es lo que impide que todo lo de arriba se cumpla por no hacer nada.
 *
 * Una transacción que no apuntara NUNCA en el historial pasaría las cinco comprobaciones del fallo
 * sin despeinarse. Así que se abre el mismo archivo sin romper nada: tiene que entrar de verdad,
 * dejar el historial limpio —abrir un documento establece una nueva línea base— y quedar guardado
 * en el navegador.
 */
console.log('\n--- abrir un archivo que SÍ se abre ---');
const previo = await qa('historial');
await p.evaluate((texto) => {
	const entrada = document.getElementById('archivo-abrir');
	const dt = new DataTransfer();
	dt.items.add(new File([texto], 'otro.tablero.json', { type: 'application/json' }));
	entrada.files = dt.files;
	entrada.dispatchEvent(new Event('change', { bubbles: true }));
}, otro);
/*
 * SE ESPERA A QUE EL ARCHIVO ESTÉ ABIERTO, no un puñado de milisegundos.
 *
 * Con `waitForTimeout(1200)` esto fallaba dentro de la batería completa y pasaba en solitario: el
 * estado se leía antes de que la apertura terminase y salía «deshacer 3 → 3». Al meter dos
 * `console.log` de depuración —que hablan con la página y tardan— empezaba a pasar, que es la
 * señal inconfundible de que la prueba mide un reloj y no un hecho.
 */
const sinDialogoAlAbrir = await esperarOperacionSinDialogo(
	() => window.qa.documentoActivo().proyecto?.nombre === 'EL QUE NO SE DEBE ABRIR',
);
must('abrir como otro tablero tampoco pide descartar el anterior', sinDialogoAlAbrir);

const documentoBueno = await qa('esperarPersistencia');
const bueno = {
	historial: await qa('historial'),
	nombre: (await qa('proyecto')).nombre,
	guardado: JSON.stringify(documentoBueno.proyecto),
};
console.log(`tras abrirlo bien: deshacer=${bueno.historial.deshacer} rehacer=${bueno.historial.rehacer} nombre=${bueno.nombre}`);
must('el archivo se abre de verdad', bueno.nombre === 'EL QUE NO SE DEBE ABRIR', bueno.nombre);
must('abre con el historial de deshacer limpio', bueno.historial.deshacer === 0,
	`${previo.deshacer} → ${bueno.historial.deshacer}`);
must('abre con el historial de rehacer limpio', bueno.historial.rehacer === 0,
	String(bueno.historial.rehacer));
must('queda guardado como documento activo en IndexedDB',
	(bueno.guardado ?? '').includes('EL QUE NO SE DEBE ABRIR'));

/*
 * PEGAR TAMPOCO PUEDE QUEDARSE A MEDIAS.
 *
 * Tercera auditoría, TS3-P3-01: «Empezar por importación/clipboard y las cinco mutaciones ya
 * cubiertas». Pegar empujaba aparatos y colocaciones al proyecto de uno en uno y luego llamaba a
 * `actualizarTodo()`. Si el render reventaba a media lista quedaba media pegada en pantalla y ya
 * escrita en el navegador, porque `recalcular()` autoguarda antes de montar la escena.
 */
console.log('\n--- pegar con el montaje roto ---');
await p.evaluate(() => document.getElementById('btn-nuevo')?.click());
await p.waitForTimeout(300);
if (await p.isVisible('#modal-dialogo')) await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
await p.waitForTimeout(500);
await p.locator('#hta-anadir').click();
for (let i = 0; i < 2; i++) { await catalogo.nth(i).click(); await p.waitForTimeout(300); }
/*
 * Se copia el primero y se pega una vez, para saber que copiar/pegar funciona antes de romperlo.
 * Se selecciona pulsando su fila en el panel de la izquierda, que es como se hace: Ctrl+C solo
 * atiende con un aparato seleccionado y en modo Editor.
 */
await p.locator('#hta-seleccionar').click();
await p.locator('#lista-dispositivos li').first().click();
await p.waitForTimeout(300);
await p.keyboard.press('Control+c'); await p.waitForTimeout(300);
await p.keyboard.press('Control+v'); await p.waitForTimeout(700);
const trasPegar = (await qa('proyecto')).dispositivos.length;
must('CONDICIÓN PREVIA: copiar y pegar funciona', trasPegar === 3, `${trasPegar} aparatos`);

const documentoAntesDeRomper = await qa('esperarPersistencia');
const antesDeRomper = {
	aparatos: trasPegar,
	historial: await qa('historial'),
	guardado: JSON.stringify(documentoAntesDeRomper.proyecto),
};
await qa('romperProximoMontaje');
await p.keyboard.press('Control+v');
// Igual que arriba: se espera al aviso de que no se pudo, no a un número de milisegundos.
await p.waitForFunction(() => /no se pudo/i.test(document.getElementById('toast')?.textContent ?? ''),
	{ timeout: 15_000 }).catch(() => {});
await p.waitForTimeout(300);
const documentoTrasRomper = await qa('esperarPersistencia');
const trasRomper = {
	aparatos: (await qa('proyecto')).dispositivos.length,
	historial: await qa('historial'),
	guardado: JSON.stringify(documentoTrasRomper.proyecto),
};
must('pegar con el render roto no deja medio aparato puesto',
	trasRomper.aparatos === antesDeRomper.aparatos,
	`${antesDeRomper.aparatos} → ${trasRomper.aparatos} aparatos`);
must('ni toca el historial', trasRomper.historial.deshacer === antesDeRomper.historial.deshacer,
	`${antesDeRomper.historial.deshacer} → ${trasRomper.historial.deshacer}`);
must('ni deja lo pegado a medias guardado en IndexedDB',
	trasRomper.guardado === antesDeRomper.guardado);

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ===`);
await b.close(); servidor.close();
process.exit(fallos === 0 ? 0 : 1);
