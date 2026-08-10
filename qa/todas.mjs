/**
 * Corre TODAS las pruebas de navegador, buscándolas ella sola.
 *
 * Antes `npm run qa` llevaba la lista escrita a mano en `package.json`. El resultado previsible:
 * la lista se quedó atrás. Once suites —entre ellas las de la auditoría, que son justamente las
 * que vigilan que un fallo arreglado no vuelva— no las corría nadie salvo que uno se acordara de
 * escribir su nombre. Una prueba que no se ejecuta es una prueba que no existe.
 *
 * Así que la lista se saca del directorio: todo `qa/*.mjs` que no empiece por `_` (los `_` son
 * sondas de diagnóstico de usar y tirar, y están fuera del repositorio) es una suite y se corre.
 * Añadir una prueba nueva es dejar el archivo ahí; no hay ningún sitio más donde apuntarla.
 *
 * Cada suite se lanza en su PROPIO proceso y de una en una. Lo primero, porque cada una levanta su
 * servidor y su Chromium y así una que se cuelgue no se lleva a las demás por delante. Lo segundo,
 * porque en paralelo se quitan la CPU unas a otras: con dibujado por software `agarre` tarda media
 * hora ella sola, y acompañada no termina.
 *
 *   node qa/todas.mjs              todas
 *   node qa/todas.mjs cables riel  solo las que lleven eso en el nombre
 */
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

/**
 * Las que no se pueden correr sin el archivo empaquetado.
 *
 * `npm run qa` construye `app/dist` (el de desarrollo). Estas dos miran `dist-final/
 * TableroStudio.html`, que es lo que se le entrega al compañero y sale de `npm run empaquetar`.
 * Si no está, se dice y se sigue: peor sería fallar y que nadie corriera el resto.
 */
const NECESITAN_EMPAQUETADO = new Set(['empaquetado', 'entrega']);
const ARCHIVO_ENTREGA = join(RAIZ, 'dist-final', 'TableroStudio.html');

const filtros = process.argv.slice(2);
const suites = readdirSync(AQUI)
	.filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'todas.mjs')
	.map((f) => f.replace(/\.mjs$/, ''))
	.filter((n) => filtros.length === 0 || filtros.some((f) => n.includes(f)))
	.sort();

if (suites.length === 0) {
	console.error(`No hay ninguna prueba que encaje con «${filtros.join(' ')}».`);
	process.exit(1);
}

/*
 * ¿ESTÁ CONSTRUIDO CON LA SONDA? Es la trampa que más veces ha mordido.
 *
 * Casi todas las suites entran con `?qa=1` y hablan con `window.qa`. La sonda solo se compila con
 * `vite build app --mode qa`; `npm run empaquetar` construye SIN ella —a propósito, porque el archivo
 * que se entrega no la lleva—. Si uno empaqueta y luego lanza las pruebas, `app/dist` se ha
 * quedado sin sonda y lo que sale es «Cannot read properties of undefined (reading …)» treinta
 * veces seguidas, que no dice absolutamente nada de lo que pasa.
 *
 * El marcador es `has("qa")`, que sobrevive a la minificación y solo existe en la construcción de
 * pruebas. Vale más pararse aquí y decir qué hay que hacer.
 */
const bundle = existsSync(join(RAIZ, 'app', 'dist', 'assets'))
	? readdirSync(join(RAIZ, 'app', 'dist', 'assets')).find((f) => f.endsWith('.js'))
	: undefined;
const conSonda = bundle
	&& readFileSync(join(RAIZ, 'app', 'dist', 'assets', bundle), 'utf8').includes('has("qa")');
if (!conSonda && suites.some((s) => !NECESITAN_EMPAQUETADO.has(s))) {
	console.error('\n⚠️  app/dist está construido SIN la sonda de pruebas.\n'
		+ '   Las suites hablan con `window.qa`, que solo existe si se construye así:\n\n'
		+ '       QA=1 npx vite build app\n\n'
		+ '   (`npm run empaquetar` construye sin ella a propósito: el archivo que se entrega\n'
		+ '   no lleva andamiaje. Si acabas de empaquetar, vuelve a construir con --mode qa.)\n');
	process.exit(1);
}

const hayEntrega = existsSync(ARCHIVO_ENTREGA);
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

console.log(`\n${suites.length} suites de navegador, de una en una.\n`);

const fallaron = [];
const saltadas = [];
const t0 = Date.now();

for (const [i, suite] of suites.entries()) {
	if (NECESITAN_EMPAQUETADO.has(suite) && !hayEntrega) {
		saltadas.push(suite);
		console.log(`[${i + 1}/${suites.length}] ⏭  ${suite} — no está dist-final/TableroStudio.html `
			+ '(sale de `npm run empaquetar`)');
		continue;
	}
	const marca = Date.now();
	process.stdout.write(`[${i + 1}/${suites.length}] ▶  ${suite}… `);
	const codigo = await new Promise((resolve) => {
		const hijo = spawn(process.execPath, [join(AQUI, `${suite}.mjs`)], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
		let salida = '';
		hijo.stdout.on('data', (d) => { salida += d; });
		hijo.stderr.on('data', (d) => { salida += d; });
		hijo.on('close', (c) => {
			console.log(`${c === 0 ? '✅' : '❌'} ${mmss(Date.now() - marca)}`);
			// De las que pasan basta con saber que pasan; de las que fallan se enseña todo.
			if (c !== 0) console.log(salida.split('\n').map((l) => `        ${l}`).join('\n'));
			resolve(c);
		});
	});
	if (codigo !== 0) fallaron.push(suite);
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`${suites.length - fallaron.length - saltadas.length} bien · ${fallaron.length} mal`
	+ `${saltadas.length ? ` · ${saltadas.length} sin correr` : ''} · ${mmss(Date.now() - t0)}`);
if (saltadas.length) console.log(`sin correr: ${saltadas.join(', ')}`);
if (fallaron.length) console.log(`MAL: ${fallaron.join(', ')}`);
else console.log('✅ TODAS BIEN');
process.exit(fallaron.length ? 1 : 0);
