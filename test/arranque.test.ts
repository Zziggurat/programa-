/**
 * EL ORDEN DEL ARCHIVO NO PUEDE SER LO ÚNICO QUE LO SOSTIENE.
 *
 * `app/main.ts` son casi cinco mil líneas con 69 variables de módulo, y durante la carga se
 * ejecutan llamadas de nivel superior. Una `let` de módulo está en ZONA MUERTA hasta la línea en
 * que se declara: si una función —que sí se iza— la lee, y esa función se llama al cargar el
 * módulo ANTES de esa línea, el programa revienta con «Cannot access X before initialization» y
 * lo que se ve es una pantalla en blanco.
 *
 * Hoy no pasa: se comprobó una por una y ninguna de las llamadas de arranque lee nada declarado
 * más abajo. Pero nada lo impide. Basta con mover una declaración veinte líneas para abajo, o
 * subir una llamada, para romperlo — y no lo ve TypeScript, ni el compilador, ni ninguna prueba
 * de navegador si el orden actual salva la situación por casualidad.
 *
 * Esto es lo que lo impide. No reordena nada: comprueba que el orden siga siendo válido, que es
 * lo que de verdad hacía falta. Si algún día falla, el mensaje dice qué se movió y adónde.
 *
 * POR QUÉ NO SE PARTIÓ EL ARCHIVO EN SU LUGAR: los efectos de nivel superior son 107 líneas
 * repartidas en 31 bloques a lo largo de 4.200, y la mayoría son registros de manejadores
 * (`botón.onclick = …`) que se ejecutan después y no son el peligro. Mover todo eso para arreglar
 * un peligro que hoy vale CERO es meter riesgo real a cambio de riesgo hipotético, en un programa
 * del que alguien depende. La comprobación da la misma protección sin tocar una línea del editor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * La raíz se BUSCA subiendo hasta el `package.json`, no se cuenta con «..».
 *
 * Las pruebas se ejecutan compiladas, desde `dist/test/`, así que un `..` a ojo apunta a `dist/`
 * y no encuentra nada. Subiendo hasta el `package.json` da igual desde dónde se lance.
 */
const RAIZ = (() => {
	let d = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6 && !existsSync(join(d, 'package.json')); i++) d = dirname(d);
	return d;
})();

/** Un módulo de la aplicación con su código fuente ya partido en líneas. */
function fuente(archivo: string): string[] {
	return readFileSync(join(RAIZ, archivo), 'utf8').split('\n');
}

/**
 * Quita el cuerpo de las funciones que se pasan como argumento.
 *
 * Es lo que separa «esto se ejecuta AHORA» de «esto se ejecuta luego». En
 * `renderer.setAnimationLoop(() => { pintar(); })`, `pintar()` no se llama al cargar el módulo
 * sino en cada fotograma, así que no puede tropezar con una zona muerta. Sin esta poda, la
 * comprobación daría por peligroso medio archivo y no serviría para nada.
 */
function sinCuerposDiferidos(texto: string): string {
	let out = '';
	let i = 0;
	while (i < texto.length) {
		const flecha = texto.indexOf('=>', i);
		const fn = texto.indexOf('function', i);
		const corte = [flecha, fn].filter((x) => x >= 0).sort((a, b) => a - b)[0];
		if (corte === undefined) { out += texto.slice(i); break; }
		out += texto.slice(i, corte);
		let j = corte + (texto.startsWith('=>', corte) ? 2 : 'function'.length);
		while (j < texto.length && /\s/.test(texto[j])) j++;
		if (texto[j] === '{') {
			// Cuerpo con llaves: se salta hasta la que lo cierra.
			let prof = 0;
			for (; j < texto.length; j++) {
				if (texto[j] === '{') prof++;
				else if (texto[j] === '}') { prof--; if (prof === 0) { j++; break; } }
			}
		} else {
			/*
			 * Cuerpo de una sola expresión, sin llaves: `botón.onclick = () => hazAlgo();`.
			 *
			 * Se salta hasta donde acaba esa expresión —una coma al mismo nivel, o el cierre del
			 * paréntesis que la envuelve—. Sin esto, la llamada de dentro se contaba como si se
			 * ejecutara al cargar el módulo, y salía un falso positivo: `btn-ver` engancha
			 * `() => aplicarVisualizacion(…)`, que corre cuando alguien pulsa, no al arrancar.
			 */
			let prof = 0;
			for (; j < texto.length; j++) {
				const c = texto[j];
				if (c === '(' || c === '[' || c === '{') prof++;
				else if (c === ')' || c === ']' || c === '}') { if (prof === 0) break; prof--; }
				else if (c === ',' && prof === 0) break;
			}
		}
		i = j;
	}
	return out;
}

interface Analisis {
	declaraciones: Map<string, number>;
	funciones: Map<string, { texto: string }>;
	/** Llamadas que se ejecutan DURANTE la carga del módulo, con su línea. */
	llamadasDeArranque: { nombre: string; linea: number }[];
}

function analizar(lineas: string[]): Analisis {
	const declaraciones = new Map<string, number>();
	lineas.forEach((l, i) => {
		const simple = /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)/.exec(l);
		if (simple) declaraciones.set(simple[1], i + 1);
		const roto = /^(?:let|const|var)\s+[{[]([^}\]]+)[}\]]/.exec(l);
		if (roto) {
			for (const trozo of roto[1].split(',')) {
				const nombre = trozo.split(':').pop()!.trim().replace(/=.*/, '').trim();
				if (nombre) declaraciones.set(nombre, i + 1);
			}
		}
	});

	// Funciones de nivel superior, tanto `function f()` como `const f = () => …`.
	const funciones = new Map<string, { texto: string }>();
	lineas.forEach((l, i) => {
		const m = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(l)
			?? /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function)/.exec(l);
		if (!m) return;
		let prof = 0; let visto = false; let j = i;
		for (; j < lineas.length; j++) {
			for (const c of lineas[j]) {
				if (c === '{') { prof++; visto = true; } else if (c === '}') prof--;
			}
			if (visto && prof === 0) break;
			if (!visto && /;\s*$/.test(lineas[j]) && j > i) break;   // flecha de una sola expresión
		}
		funciones.set(m[1], { texto: lineas.slice(i, j + 1).join('\n') });
	});

	/*
	 * Sentencias de nivel superior: las que empiezan en la columna 0 y no son una declaración.
	 * De cada una se buscan las llamadas a funciones DE ESTE ARCHIVO, ya sin los cuerpos
	 * diferidos — y da igual dónde caiga la llamada dentro de la línea: `if (puedo()) …` cuenta.
	 */
	const llamadasDeArranque: { nombre: string; linea: number }[] = [];
	lineas.forEach((l, i) => {
		if (!/^[a-zA-Z$_(]/.test(l)) return;
		if (/^(?:export|import|declare|interface|type|class|let|const|var|function|async function)\b/.test(l)) return;
		for (const m of sinCuerposDiferidos(l).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
			if (funciones.has(m[1])) llamadasDeArranque.push({ nombre: m[1], linea: i + 1 });
		}
	});
	return { declaraciones, funciones, llamadasDeArranque };
}

/** Todo lo de módulo que una función lee, siguiendo también a las que llama. */
function loQueLee(a: Analisis, nombre: string, visto = new Set<string>()): Set<string> {
	const out = new Set<string>();
	if (visto.has(nombre) || !a.funciones.has(nombre)) return out;
	visto.add(nombre);
	for (const m of a.funciones.get(nombre)!.texto.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
		const id = m[1];
		if (a.declaraciones.has(id)) out.add(id);
		if (a.funciones.has(id) && id !== nombre) for (const x of loQueLee(a, id, visto)) out.add(x);
	}
	return out;
}

/** Los módulos que hacen trabajo al cargarse. Si aparece otro, se añade aquí. */
const MODULOS = ['app/main.ts', 'app/mundo-ui.ts', 'app/dialogos.ts'];

for (const archivo of MODULOS) {
	test(`${archivo}: nada de lo que se ejecuta al arrancar lee algo declarado más abajo`, () => {
		const a = analizar(fuente(archivo));
		const malos: string[] = [];
		for (const { nombre, linea } of a.llamadasDeArranque) {
			for (const leido of loQueLee(a, nombre)) {
				const donde = a.declaraciones.get(leido)!;
				if (donde > linea) {
					malos.push(`${nombre}() se ejecuta en la línea ${linea} y lee «${leido}», `
						+ `que no existe hasta la línea ${donde}`);
				}
			}
		}
		assert.deepEqual(malos, [], `\n  ${malos.join('\n  ')}\n\n`
			+ '  Una `let` de módulo está en zona muerta hasta su línea: leerla antes revienta la\n'
			+ '  carga entera y deja la pantalla en blanco. O se sube la declaración por encima de\n'
			+ '  la llamada, o se baja la llamada al bloque de arranque del final.\n');
	});
}

/*
 * Y que la comprobación siga MIRANDO algo. Una prueba de este tipo se puede quedar en nada sin que
 * nadie lo note —cambia la forma de escribir una función y de pronto no encuentra ninguna—, y
 * entonces pasa siempre y no protege de nada. Así que se exige que encuentre material.
 */
test('la comprobación de arranque sigue encontrando qué mirar', () => {
	const a = analizar(fuente('app/main.ts'));
	assert.ok(a.declaraciones.size > 40, `solo vio ${a.declaraciones.size} declaraciones de módulo`);
	assert.ok(a.funciones.size > 80, `solo vio ${a.funciones.size} funciones`);
	assert.ok(a.llamadasDeArranque.length >= 10,
		`solo vio ${a.llamadasDeArranque.length} llamadas de arranque`);
});

/*
 * Y que sepa cazar el fallo. Sin esto, lo de arriba solo dice «no encontré nada», que es
 * exactamente lo que diría una comprobación rota.
 */
test('cazaría el fallo: una llamada de arranque que lee una let de más abajo', () => {
	const roto = [
		'function pintar(): void {',
		'\tconsole.log(estado);',
		'}',
		'pintar();',
		'let estado = 1;',
	];
	const a = analizar(roto);
	const malos: string[] = [];
	for (const { nombre, linea } of a.llamadasDeArranque) {
		for (const leido of loQueLee(a, nombre)) {
			if (a.declaraciones.get(leido)! > linea) malos.push(leido);
		}
	}
	assert.deepEqual(malos, ['estado']);
});

test('no se alarma por lo que se ejecuta DESPUÉS (un manejador, el bucle de dibujado)', () => {
	const bien = [
		'function pintar(): void {',
		'\tconsole.log(estado);',
		'}',
		'renderer.setAnimationLoop(() => { pintar(); });',
		// Cuerpo de flecha SIN llaves. Este caso daba un falso positivo: la poda saltaba el «=>»
		// y volvía a ver la llamada de dentro, así que `btn-ver` salía como peligro de arranque
		// cuando en realidad corre al pulsar. Queda fijado aquí para que no vuelva.
		'($(\'btn-ver\') as HTMLButtonElement).onclick = () => pintar();',
		'let estado = 1;',
	];
	const a = analizar(bien);
	const malos: string[] = [];
	for (const { nombre, linea } of a.llamadasDeArranque) {
		for (const leido of loQueLee(a, nombre)) {
			if (a.declaraciones.get(leido)! > linea) malos.push(leido);
		}
	}
	assert.deepEqual(malos, [], 'el bucle de dibujado corre luego: ahí no hay zona muerta');
});
