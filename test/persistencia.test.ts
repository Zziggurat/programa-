/**
 * LO QUE SE CAMBIA, SE GUARDA. Y NO PUEDE DEPENDER DE QUE ALGUIEN SE ACUERDE.
 *
 * Segunda auditoría, TS2-P1-02. `capturar()` se llama justo ANTES de tocar el modelo —hace la
 * foto para deshacer— y a propósito no guarda: guardaría el estado anterior. Guardar le toca al
 * manejador, después. Y unos lo hacían y otros no:
 *
 *   · cambiar el COLOR de un cable
 *   · cambiar la PROFUNDIDAD Z de una imagen de referencia
 *   · CREAR una unión en un cable
 *   · QUITAR una unión con doble clic
 *   · ARRASTRAR una unión y soltarla
 *
 * Las cinco cambian el tablero, se ven en pantalla y desaparecían al recargar. Ninguna prueba lo
 * veía: `qa/se-guarda-solo.mjs` comprueba catorce datos y ninguno de estos tres, así que pasaba en
 * verde y concluía «NO SE PIERDE NADA».
 *
 * Esto es lo que lo impide de verdad. La regla es mecánica y no hay que acordarse de nada: si un
 * bloque llama a `capturar()`, va a cambiar el modelo; entonces tiene que acabar llamando a algo
 * que ESCRIBA el guardado —`marcarSucio`, `autoguardar`, `recalcular`, `actualizarTodo`—, él
 * mismo o a un salto de distancia.
 *
 * Lo que NO comprueba, dicho claro: que lo guardado sea correcto, ni que se guarde una sola vez,
 * ni las mutaciones que no capturan (que son las que no tocan el modelo). Comprueba que no haya
 * una ruta que fotografía para deshacer y luego se olvida de guardar, que es lo que pasaba.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = (() => {
	let d = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6 && !existsSync(join(d, 'package.json')); i++) d = dirname(d);
	return d;
})();

interface Bloque {
	nombre: string;
	/** Primera y última línea del bloque (1-based), para poder restarle lo que lleva dentro. */
	linea: number;
	hasta: number;
	texto: string;
	/** Su texto SIN los manejadores anidados: lo que de verdad se ejecuta al llamarlo. */
	propio: string;
}

/**
 * Los bloques con cuerpo del archivo: funciones de nivel superior Y manejadores anidados.
 *
 * Los anidados son la mitad del asunto: `botón.onclick = () => { … }` dentro de una función de
 * pintado es exactamente donde estaban las cinco fugas. Si se mira solo el nivel superior, el
 * manejador se funde con su función madre y basta con que ESA llame a `recalcular()` en cualquier
 * otra rama para que la fuga quede tapada.
 */
function bloques(fuente: string): Bloque[] {
	const lineas = fuente.split('\n');
	const salida: Bloque[] = [];
	const ARRANQUES = [
		/^(?<i>\s*)(?:export\s+)?(?:async\s+)?function\s+(?<n>[A-Za-z_$][\w$]*)/,
		/^(?<i>\s*)(?:export\s+)?const\s+(?<n>[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/,
		// Manejadores: `algo.onclick = (…) => {`, `x.addEventListener('y', (…) => {`
		/^(?<i>\s*).*\.(?<n>on[a-z]+)\s*=\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*\{/,
		/^(?<i>\s*).*addEventListener\(\s*'(?<n>[a-z]+)'\s*,\s*(?:async\s*)?\(?[^)]*\)?\s*=>\s*\{/,
	];
	for (let i = 0; i < lineas.length; i++) {
		const m = ARRANQUES.map((r) => r.exec(lineas[i])).find(Boolean);
		if (!m) continue;
		let prof = 0; let visto = false; let j = i;
		for (; j < lineas.length && j < i + 400; j++) {
			for (const c of lineas[j]) { if (c === '{') { prof++; visto = true; } else if (c === '}') prof--; }
			if (visto && prof <= 0) break;
		}
		if (!visto) continue;
		salida.push({
			nombre: m.groups!.n, linea: i + 1, hasta: j + 1,
			texto: lineas.slice(i, j + 1).join('\n'), propio: '',
		});
	}
	/*
	 * Y a cada bloque se le QUITA lo que lleva dentro.
	 *
	 * `pintarSeleccion()` son cuatrocientas líneas y dentro engancha una docena de manejadores, y
	 * varios de ellos llaman a `recalcular()`. Eso NO se ejecuta al llamar a `pintarSeleccion()`:
	 * corre cuando alguien pulsa. Sin restarlo, cualquier manejador que repinte la selección
	 * parecía estar guardando, y la comprobación pasaba con las cinco fugas dentro —comprobado
	 * revirtiendo `main.ts`—, que es justo lo que no puede pasar.
	 */
	for (const b of salida) {
		const dentro = salida.filter((o) => o !== b && o.linea > b.linea && o.hasta <= b.hasta);
		const tapadas = new Set<number>();
		for (const o of dentro) for (let k = o.linea; k <= o.hasta; k++) tapadas.add(k);
		b.propio = lineas.slice(b.linea - 1, b.hasta)
			.filter((_, k) => !tapadas.has(b.linea + k)).join('\n');
	}
	return salida;
}

/**
 * Lo que cuenta como «esto queda guardado»: lo que de verdad ESCRIBE el archivo automático.
 *
 * `senalarTrabajoSinExportar` NO está aquí, y es la parte que más importa de esta lista. Solo
 * enciende el aviso de «tienes trabajo sin descargar»; no escribe nada. Y lo llama `capturar()`,
 * así que meterlo aquí hacía que TODO bloque que captura cumpliera la regla por el mero hecho de
 * capturar: la comprobación pasaba con las cinco fugas dentro. Se descubrió al revertir `main.ts`
 * y ver que seguía en verde, que es exactamente para lo que sirve esa prueba de la prueba.
 *
 * `revertirCaptura` y `descartarCaptura` sí valen: son las salidas de «al final no cambió nada»,
 * y ahí no hay que guardar porque no hay nada que guardar.
 */
const PERSISTEN = [
	'marcarSucio', 'autoguardar', 'recalcular', 'actualizarTodo', 'trasCambiarProyecto',
	'revertirCaptura', 'descartarCaptura',
];

/**
 * ¿Este bloque guarda? Se mira SU PROPIO texto, sin seguir a lo que llame.
 *
 * El primer intento seguía las llamadas: si el manejador llamaba a `reconstruirCables()` y esa,
 * cinco saltos más allá, tocaba algo que guardaba, se daba por bueno. En un archivo de casi cinco
 * mil líneas eso conecta todo con todo: la comprobación pasaba con las cinco fugas dentro, que es
 * exactamente lo que no puede pasar. Comprobado revirtiendo `main.ts` y volviéndola a correr.
 *
 * Así que la regla es directa y por eso sirve: quien hace la foto para deshacer, guarda ahí mismo.
 * Cuesta una línea y se lee de un vistazo, que es justo lo que hacía falta.
 */
function guardaDirecto(b: Bloque): boolean {
	return PERSISTEN.some((p) => new RegExp(`\\b${p}\\s*\\(`).test(b.propio));
}

/**
 * Un solo salto: o guarda él, o llama a una función que guarda ELLA MISMA.
 *
 * Un solo salto y no más, a propósito. `duplicarDispositivo()` termina en
 * `actualizarConservandoAparatos()` y el dossier en `actualizarDossier()`: son funciones de cierre
 * que guardan en su primera línea, y exigirles a los dos sitios que además llamen a `marcarSucio()`
 * sería duplicar el guardado. Pero seguir la cadena entera conecta todo con todo en un archivo de
 * casi cinco mil líneas y la comprobación deja de comprobar.
 */
function guarda(b: Bloque, porNombre: Map<string, Bloque>): boolean {
	if (guardaDirecto(b)) return true;
	for (const m of b.propio.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
		const otro = porNombre.get(m[1]);
		if (otro && otro !== b && guardaDirecto(otro)) return true;
	}
	return false;
}

/**
 * El arrastre es la excepción, y va con nombre y apellido.
 *
 * `pointermove` hace la foto al empezar a arrastrar y mueve el aparato en cada píxel; guardar en
 * cada uno sería escribir en `localStorage` sesenta veces por segundo. Lo que guarda es el
 * `pointerup`, al soltar — y eso NO se da por supuesto: se comprueba abajo.
 */
const ARRASTRE = ['pointermove', 'mousemove', 'touchmove'];

const MODULOS = ['app/main.ts', 'app/ui-inicio.ts', 'app/ui-dossier.ts'];

for (const archivo of MODULOS) {
	test(`${archivo}: todo lo que cambia el tablero acaba guardándolo`, () => {
		const bs = bloques(readFileSync(join(RAIZ, archivo), 'utf8'));
		// Solo las funciones CON NOMBRE se pueden llamar desde otra: los manejadores, no.
		const porNombre = new Map(bs.filter((b) => !/^on[a-z]+$/.test(b.nombre)).map((b) => [b.nombre, b]));
		const fugas = bs
			// `capturar` misma no cuenta: el patrón casa con su propia línea de declaración.
			.filter((b) => b.nombre !== 'capturar')
			.filter((b) => /\bcapturar\s*\(\)/.test(b.propio))
			.filter((b) => !ARRASTRE.includes(b.nombre))
			.filter((b) => !guarda(b, porNombre))
			.map((b) => `${archivo}:${b.linea} · ${b.nombre}()`);

		assert.deepEqual(fugas, [], `\n  ${fugas.join('\n  ')}\n\n`
			+ '  Estas rutas hacen la foto para deshacer —o sea, van a cambiar el tablero— y luego no\n'
			+ '  guardan nada. El usuario ve el cambio, cierra, y al volver no está. Llama a\n'
			+ '  `marcarSucio()` después de la mutación (o a `recalcular()` si además hay que\n'
			+ '  recalcular), o a `revertirCaptura()` si al final la acción no cambió nada.\n');
	});
}

/*
 * Y que la comprobación siga MIRANDO algo. Si un cambio de estilo deja de encajar con los patrones,
 * esto pasaría siempre sin proteger de nada — que es exactamente lo que hace una prueba rota.
 */
test('la comprobación de persistencia sigue encontrando qué mirar', () => {
	const bs = bloques(readFileSync(join(RAIZ, 'app/main.ts'), 'utf8'));
	assert.ok(bs.length > 150, `solo vio ${bs.length} bloques con cuerpo`);
	const cambian = bs.filter((b) => /\bcapturar\s*\(\)/.test(b.propio));
	assert.ok(cambian.length >= 25, `solo vio ${cambian.length} rutas que cambian el tablero`);
	assert.ok(bs.some((b) => /^on[a-z]+$/.test(b.nombre)),
		'no vio ni un manejador anidado, que es justo donde estaban las cinco fugas');
});

test('cazaría el fallo: un manejador que captura y solo repinta', () => {
	const roto = [
		"(panel.querySelector('#cbl-color') as HTMLSelectElement).onchange = (e) => {",
		'\tcapturar();',
		'\tc.color = e.target.value;',
		'\treconstruirCables();',
		'};',
	].join('\n');
	const fugas = bloques(roto).filter((b) => /\bcapturar\s*\(\)/.test(b.propio)).filter((b) => !guardaDirecto(b));
	assert.equal(fugas.length, 1, 'este es literalmente el caso del color de cable que se perdía');
});

test('no se alarma por el que sí guarda', () => {
	const bien = [
		"(panel.querySelector('#cbl-color') as HTMLSelectElement).onchange = (e) => {",
		'\tcapturar();',
		'\tc.color = e.target.value;',
		'\treconstruirCables();',
		'\tmarcarSucio();',
		'};',
	].join('\n');
	const fugas = bloques(bien).filter((b) => /\bcapturar\s*\(\)/.test(b.propio)).filter((b) => !guardaDirecto(b));
	assert.deepEqual(fugas, []);
});

/*
 * Y la excepción del arrastre, comprobada. Si algún día el `pointerup` deja de guardar, mover un
 * aparato se perdería al recargar y la exención de arriba lo estaría tapando.
 */
test('lo que se exime al arrastrar, lo guarda el soltar', () => {
	const bs = bloques(readFileSync(join(RAIZ, 'app/main.ts'), 'utf8'));
	const soltar = bs.filter((b) => b.nombre === 'pointerup');
	assert.ok(soltar.length > 0, 'no se encontró el manejador de soltar');
	assert.ok(soltar.some(guardaDirecto),
		'ningún `pointerup` guarda: entonces mover un aparato se pierde al recargar');
});
