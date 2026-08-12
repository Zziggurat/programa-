/**
 * NADIE ABRE UNA VENTANA POR SU CUENTA.
 *
 * Este es el fallo que dejó el programa congelado, y conviene contarlo entero porque la forma de
 * romperlo otra vez es muy fácil y muy inocente.
 *
 * El gestor de `app/ventanas.ts` apaga con `inert` todo lo que no es la ventana de arriba. Es lo
 * correcto: impide tabular a un botón que no se ve. Pero `#modal-dialogo` —el «¿seguro?», el que
 * pregunta «tienes cambios sin guardar, ¿abro el ejemplo de todas formas?»— se mostraba poniéndole
 * `hidden = false` a mano, sin pasar por el gestor. Con la biblioteca de ejemplos abierta, ese
 * aviso YA estaba inerte, porque era uno de los hermanos del fondo. Y entonces:
 *
 *   · se mostraba delante del todo, en la capa 70, perfectamente visible;
 *   · no se podía pulsar ni «Cancelar» ni «Abrir de todas formas», porque estaba inerte;
 *   · los clics se los quedaban las tarjetas de ejemplo de debajo.
 *
 * O sea: la pantalla entera muerta, con un aviso puesto que no se podía quitar. Justo al cambiar
 * de un tablero de ejemplo a otro, que es cuando sale ese aviso.
 *
 * Lo que lo hace peligroso es que NO da error. No hay excepción, no hay nada en la consola. Y las
 * pruebas de navegador no lo veían porque pulsaban con `element.click()` de JavaScript, que llega
 * al manejador aunque el elemento esté inerte: el robot atravesaba la pared y decía que no había
 * pared. Se caza con el ratón de verdad, y eso lo hace `qa/congelamiento.mjs`.
 *
 * Aquí se cierra la puerta por arriba: si alguien vuelve a mostrar un modal a mano, esto falla.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = (() => {
	let d = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6 && !existsSync(join(d, 'package.json')); i++) d = dirname(d);
	return d;
})();

/**
 * `ventanas.ts` es el único que puede tocar `hidden` de una ventana: es su trabajo.
 *
 * `mundo-ui.ts` y `ui-inicio.ts` muestran `#mundo` y `#inicio`, que NO son ventanas modales sino
 * herramientas a pantalla completa —viven en `--capa-herramienta`, por debajo de los modales, y no
 * apagan el fondo—. Esas no pasan por el gestor a propósito.
 */
const PUEDEN = new Set(['ventanas.ts']);

test('ningún modal se abre a mano: todos pasan por el gestor de ventanas', () => {
	const culpables: string[] = [];
	for (const archivo of readdirSync(join(RAIZ, 'app')).filter((f) => f.endsWith('.ts'))) {
		if (PUEDEN.has(archivo)) continue;
		const texto = readFileSync(join(RAIZ, 'app', archivo), 'utf8');
		/*
		 * SE SIGUE LA VARIABLE, no solo la línea.
		 *
		 * La primera versión de esta prueba exigía que `modal-` apareciera en la MISMA línea que el
		 * `hidden = false`, y por eso pasaba tan campante contra el código roto: allí ponía
		 * `const modal = $('modal-dialogo')` arriba y `modal.hidden = false` treinta líneas más
		 * abajo. Una prueba que no falla contra el fallo que dice vigilar no vigila nada.
		 */
		const bautizadas = new Set<string>();
		for (const m of texto.matchAll(
			/(?:const|let|var)\s+(\w+)\s*=\s*(?:\$|document\.getElementById)\(\s*'(modal-[\w-]+)'/g,
		)) bautizadas.add(m[1]);

		texto.split('\n').forEach((linea, i) => {
			if (/^\s*(\*|\/\/)/.test(linea)) return;
			if (!/\bhidden\s*=\s*false/.test(linea)) return;
			// De frente (`$('modal-x').hidden = false`) o por la variable que lo guarda.
			const deFrente = /modal-/.test(linea);
			const porVariable = [...bautizadas].some((v) => new RegExp(`\\b${v}\\.hidden\\s*=\\s*false`).test(linea));
			if (!deFrente && !porVariable) return;
			culpables.push(`app/${archivo}:${i + 1}  ${linea.trim()}`);
		});
	}
	assert.deepEqual(culpables, [],
		'estos modales se muestran sin pasar por `abrirVentana`, así que pueden salir INERTES —'
		+ 'visibles y sin poder pulsarse— y dejar la pantalla muerta:\n' + culpables.join('\n'));
});

/*
 * La otra mitad: que la inercia se DERIVE de la pila en vez de irse encendiendo y apagando.
 *
 * Mientras se hacía a incrementos, cualquier camino que se saltara un paso dejaba el `inert`
 * puesto para siempre. Calculada de una vez a partir de la pila, eso no puede pasar: si no hay
 * ventanas, no queda nada inerte, y punto.
 */
test('la inercia se recompone a partir de la pila, no a incrementos', () => {
	const texto = readFileSync(join(RAIZ, 'app/ventanas.ts'), 'utf8');
	assert.match(texto, /function aplicarInercia\(\)/,
		'no está `aplicarInercia`: si se ha vuelto a un `fondoInerte(caja, true/false)`, el atributo '
		+ 'puede quedarse puesto y la pantalla, muerta');
	assert.doesNotMatch(texto, /function fondoInerte\(/,
		'ha vuelto el encendido/apagado por incrementos, que es de donde salió la pantalla congelada');
	// Cerrar una ventana tiene que recomponer siempre, incluso si su caja ya no está en la página.
	const cerrar = texto.slice(texto.indexOf('export function cerrarVentana('));
	assert.match(cerrar.slice(0, cerrar.indexOf('\n}')), /aplicarInercia\(\)/,
		'`cerrarVentana` no recompone la inercia: al cerrar puede dejar el fondo apagado');
});

/*
 * Y que el aviso bloqueante conteste SIEMPRE.
 *
 * Detrás de `confirmar()` hay un `await`. Si la ventana se cierra por un camino que no resuelve la
 * promesa —Escape, o el saneo—, ese `await` se queda colgado para siempre y el programa se queda
 * a medias de lo que estuviera haciendo: otra forma de quedarse congelado, esta sin `inert`.
 */
test('el aviso bloqueante contesta aunque lo cierren por otro camino', () => {
	const texto = readFileSync(join(RAIZ, 'app/dialogos.ts'), 'utf8');
	assert.match(texto, /alCerrar:\s*\(\)\s*=>\s*terminar\(null\)/,
		'`abrirDialogo` no avisa al gestor de qué hacer si la ventana se cierra sola; un Escape '
		+ 'dejaría colgado al `await` que espera la respuesta');
});
