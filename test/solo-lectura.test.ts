/**
 * NADIE SE SALTA EL VETO DE «ESTE TABLERO ES UN EJEMPLO».
 *
 * Los tableros de la biblioteca son material de estudio: se miran, se energizan y se recorren, pero
 * no se editan. Si se pudieran editar bastaría un Supr sin querer para que el que enseña el
 * estrella-triángulo dejara de enseñarlo, y no habría forma de recuperarlo.
 *
 * El veto vive en `capturar()`, que es por donde pasa TODA mutación que se pueda deshacer —es lo
 * que significa poder deshacerla—, y devuelve `false` en un ejemplo. Pero un veto que devuelve algo
 * solo sirve si quien llama lo mira, y ahí es donde esto se rompería sin avisar: se añade un botón
 * nuevo, se escribe `capturar();` como se ha escrito siempre, y ese botón edita los ejemplos.
 *
 * Así que esto es una barrera ESTRUCTURAL, del mismo tipo que `test/persistencia.test.ts`: lee el
 * código y exige que ninguna llamada tire el resultado. No comprueba comportamiento —de eso se
 * encarga `qa/ejemplos-solo-lectura.mjs`, en el navegador y accionando de verdad— sino que la
 * puerta siga cerrada mañana.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * La raíz del repositorio, subiendo hasta encontrar el `package.json`. Hace falta así porque la
 * prueba se ejecuta COMPILADA, desde `dist/test/`, y desde ahí `..` no es la raíz sino `dist/`.
 */
const RAIZ = (() => {
	let d = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6 && !existsSync(join(d, 'package.json')); i++) d = dirname(d);
	return d;
})();

/** Los archivos que pueden cambiar el tablero. Si aparece otro, se añade aquí. */
const FUENTES = ['app/main.ts', 'app/ui-dossier.ts', 'app/ui-esquema.ts'];

/**
 * El cuerpo de una función de nivel superior, desde su `{` hasta la llave que la cierra en la
 * columna 0.
 *
 * Se busca así y no con una expresión regular sobre la firma porque las firmas llevan paréntesis
 * dentro —`mutarProyecto(cambiar: () => void)`— y un `[^)]*` se corta a la mitad. Le pasó a la
 * primera versión de esta prueba: no encontraba la función y fallaba diciendo que faltaba la
 * comprobación que sí estaba.
 */
function cuerpoDe(texto: string, nombre: string): string {
	const i = texto.indexOf(`function ${nombre}(`);
	if (i < 0) return '';
	const abre = texto.indexOf('{', i);
	const fin = texto.indexOf('\n}', abre);
	return fin < 0 ? texto.slice(abre) : texto.slice(abre, fin);
}

test('ninguna llamada a capturar() ignora su respuesta', () => {
	const sueltas: string[] = [];
	for (const rel of FUENTES) {
		const texto = readFileSync(join(RAIZ, rel), 'utf8');
		texto.split('\n').forEach((linea, i) => {
			// La declaración y los comentarios no cuentan; se busca la LLAMADA.
			if (/^\s*(\*|\/\/)/.test(linea)) return;
			if (!/\bcapturar\(\)/.test(linea)) return;
			if (/function capturar\(/.test(linea)) return;
			/*
			 * Vale cualquier forma que MIRE el resultado: el `if (!capturar()) return;` de siempre,
			 * o una condición compuesta. Lo que no vale es la llamada a pelo, que tira el `false` y
			 * sigue editando tan tranquila.
			 */
			if (/if\s*\(\s*!\s*capturar\(\)\s*\)/.test(linea)) return;
			if (/(?:const|let|return|&&|\|\||\?)\s*[^;]*\bcapturar\(\)/.test(linea)) return;
			sueltas.push(`${rel}:${i + 1}  ${linea.trim()}`);
		});
	}
	assert.deepEqual(sueltas, [],
		'estas llamadas a capturar() no miran si se puede editar, así que editarían un ejemplo:\n'
		+ sueltas.join('\n'));
});

/*
 * Y la otra puerta. `mutarProyecto()` lleva su propio historial y NO pasa por `capturar()`, así que
 * se quedó fuera del veto sin que nadie lo notara: en un ejemplo, Ctrl+V pegaba. Lo cazó la prueba
 * de navegador. Aquí se fija que la comprobación siga estando.
 */
test('mutarProyecto también comprueba que se pueda editar', () => {
	const texto = readFileSync(join(RAIZ, 'app/main.ts'), 'utf8');
	const cuerpo = cuerpoDe(texto, 'mutarProyecto');
	assert.ok(cuerpo, 'no se encontró `mutarProyecto`: si se ha renombrado, hay que actualizar esto');
	assert.match(cuerpo, /sePuedeEditar\(\)/,
		'`mutarProyecto` edita el tablero sin pasar por `capturar()`; tiene que vetar los ejemplos '
		+ 'por su cuenta o Ctrl+V vuelve a pegar sobre un ejemplo');
});

/*
 * Lo que NO se puede bloquear, y conviene dejarlo escrito para que nadie lo «arregle» de más:
 * `reemplazarProyecto` cambia el tablero ENTERO, y eso es justo lo que hace abrir un ejemplo. Si
 * llevara el veto, no se podría abrir ninguno.
 */
test('reemplazarProyecto NO veta: es como se abre un ejemplo', () => {
	const texto = readFileSync(join(RAIZ, 'app/main.ts'), 'utf8');
	const cuerpo = cuerpoDe(texto, 'reemplazarProyecto');
	assert.ok(cuerpo, 'no se encontró `reemplazarProyecto`');
	assert.doesNotMatch(cuerpo, /if \(!sePuedeEditar\(\)\) return;/,
		'si `reemplazarProyecto` vetara, no se podría abrir un ejemplo estando en otro');
});

/*
 * Y el guardado. Esto es lo que de verdad protegía el trabajo de quien nunca descarga el archivo:
 * abrir un ejemplo escribía en `localStorage` encima de su tablero. El aviso hablaba de la
 * pantalla; lo que se perdía era la única copia que tenía.
 */
test('el autoguardado no escribe un ejemplo encima del tablero del usuario', () => {
	const texto = readFileSync(join(RAIZ, 'app/main.ts'), 'utf8');
	const cuerpo = cuerpoDe(texto, 'autoguardar');
	assert.ok(cuerpo, 'no se encontró `autoguardar`');
	assert.match(cuerpo, /if \(proyecto\.esEjemplo\) return;/,
		'sin esto, abrir un ejemplo borra del navegador el tablero en el que estabas trabajando');
});
