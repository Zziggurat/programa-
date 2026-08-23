/**
 * Runner de las pruebas de navegador.
 *
 * Antes `npm run qa` llevaba la lista escrita a mano en `package.json`. El resultado previsible:
 * la lista se quedó atrás. Once suites —entre ellas las de la auditoría, que son justamente las
 * que vigilan que un fallo arreglado no vuelva— no las corría nadie salvo que uno se acordara de
 * escribir su nombre. Una prueba que no se ejecuta es una prueba que no existe.
 *
 * `--all` descubre todo `qa/*.mjs` que no empiece por `_`. El gate predeterminado es deliberado y
 * vive en `qa/lib/gate.mjs`: una prueba nueva no puede convertirse accidentalmente en requisito de
 * CI antes de demostrar que es determinista. Las sondas `_` están clasificadas en
 * `qa/CLASIFICACION.md` y solo llegan al gate mediante un wrapper explícito.
 *
 * Cada suite se lanza en su PROPIO proceso y de una en una. Lo primero, porque cada una levanta su
 * servidor y su Chromium y así una que se cuelgue no se lleva a las demás por delante. Lo segundo,
 * porque en paralelo se quitan la CPU unas a otras: con dibujado por software `agarre` tarda media
 * hora ella sola, y acompañada no termina.
 *
 *   node qa/todas.mjs              gate estable
 *   node qa/todas.mjs --gate       gate estable (también es el valor predeterminado)
 *   node qa/todas.mjs --all        todas las suites oficiales, incluidas las largas
 *   node qa/todas.mjs cables riel  solo las que lleven eso en el nombre
 */
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_OFICIAL } from './lib/gate.mjs';

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

/*
 * Las suites pequeñas medidas en una máquina Windows con SwiftShader tardan 18–35 s; la suite
 * normal más lenta observada (`correcciones`) tarda 6:41. Doce minutos deja casi el doble de
 * margen para una máquina CI lenta sin permitir que una espera infinita bloquee toda la campaña.
 * Se puede subir de forma explícita para diagnósticos pesados, nunca silenciosamente:
 *
 *   QA_SUITE_TIMEOUT_MS=900000 node qa/todas.mjs correcciones
 */
const TIMEOUT_PREDETERMINADO_MS = 12 * 60_000;
const timeoutMs = Number(process.env.QA_SUITE_TIMEOUT_MS ?? TIMEOUT_PREDETERMINADO_MS);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
	console.error('QA_SUITE_TIMEOUT_MS debe ser un número de milisegundos mayor o igual a 1000.');
	process.exit(2);
}

const argumentos = process.argv.slice(2);
const opciones = argumentos.filter((a) => a.startsWith('--'));
const desconocidas = opciones.filter((a) => !['--gate', '--all'].includes(a));
if (desconocidas.length) {
	console.error(`Opciones QA desconocidas: ${desconocidas.join(', ')}`);
	process.exit(2);
}
if (opciones.includes('--gate') && opciones.includes('--all')) {
	console.error('Elige --gate o --all, no ambos.');
	process.exit(2);
}
const filtros = argumentos.filter((a) => !a.startsWith('--'));
const todasLasSuites = readdirSync(AQUI)
	.filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'todas.mjs')
	.map((f) => f.replace(/\.mjs$/, ''))
	.sort();
const faltantesDelGate = GATE_OFICIAL.filter((suite) => !todasLasSuites.includes(suite));
if (faltantesDelGate.length) {
	console.error(`El gate declara suites que no existen: ${faltantesDelGate.join(', ')}`);
	process.exit(2);
}
const suites = filtros.length
	? todasLasSuites.filter((n) => filtros.some((f) => n.includes(f)))
	: opciones.includes('--all') ? todasLasSuites : [...GATE_OFICIAL].sort();

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
const agotaronTiempo = [];
const saltadas = [];
let comprobaciones = 0;
const t0 = Date.now();
let hijoActivo;

/** Mata la suite Y sus descendientes: Chromium y el servidor deben morir con ella. */
async function matarArbol(hijo) {
	if (!hijo?.pid) return;
	if (process.platform === 'win32') {
		await new Promise((resolve) => {
			const taskkill = spawn('taskkill', ['/pid', String(hijo.pid), '/t', '/f'], {
				stdio: 'ignore', windowsHide: true,
			});
			taskkill.once('error', resolve);
			taskkill.once('close', resolve);
		});
		return;
	}
	try { process.kill(-hijo.pid, 'SIGTERM'); } catch { return; }
	await new Promise((resolve) => setTimeout(resolve, 1_500));
	try { process.kill(-hijo.pid, 'SIGKILL'); } catch { /* ya terminó */ }
}

let interrumpiendo = false;
async function interrumpir(signal) {
	if (interrumpiendo) return;
	interrumpiendo = true;
	console.error(`\nQA interrumpido (${signal}); limpiando la suite activa…`);
	await matarArbol(hijoActivo);
	process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.once('SIGINT', () => { void interrumpir('SIGINT'); });
process.once('SIGTERM', () => { void interrumpir('SIGTERM'); });

for (const [i, suite] of suites.entries()) {
	if (NECESITAN_EMPAQUETADO.has(suite) && !hayEntrega) {
		saltadas.push(suite);
		console.log(`[${i + 1}/${suites.length}] ⏭  ${suite} — no está dist-final/TableroStudio.html `
			+ '(sale de `npm run empaquetar`)');
		continue;
	}
	const marca = Date.now();
	process.stdout.write(`[${i + 1}/${suites.length}] ▶  ${suite}… `);
	const resultado = await new Promise((resolve) => {
		const hijo = spawn(process.execPath, [join(AQUI, `${suite}.mjs`)], {
			cwd: RAIZ,
			stdio: ['ignore', 'pipe', 'pipe'],
			// En POSIX crea un grupo que incluye Chromium; Windows usa taskkill /t.
			detached: process.platform !== 'win32',
		});
		hijoActivo = hijo;
		let salida = '';
		hijo.stdout.on('data', (d) => { salida += d; });
		hijo.stderr.on('data', (d) => { salida += d; });
		let resuelto = false;
		const limite = setTimeout(() => {
			if (resuelto) return;
			resuelto = true;
			const duracion = mmss(Date.now() - marca);
			console.log(`⏱️  TIMEOUT ${duracion} (límite ${mmss(timeoutMs)})`);
			console.log(`        La suite «${suite}» agotó su tiempo; se termina su proceso, navegador y servidor.`);
			void matarArbol(hijo).then(() => resolve({ codigo: null, timeout: true, salida }));
		}, timeoutMs);
		hijo.on('error', (error) => {
			if (resuelto) return;
			resuelto = true;
			clearTimeout(limite);
			console.log(`❌ no se pudo iniciar: ${error.message}`);
			resolve({ codigo: 1, timeout: false, salida: `${salida}\n${error.stack ?? error.message}` });
		});
		hijo.on('close', (c) => {
			if (resuelto) return;
			resuelto = true;
			clearTimeout(limite);
			console.log(`${c === 0 ? '✅' : '❌'} ${mmss(Date.now() - marca)}`);
			// De las que pasan basta con saber que pasan; de las que fallan se enseña todo.
			if (c !== 0) console.log(salida.split('\n').map((l) => `        ${l}`).join('\n'));
			resolve({ codigo: c, timeout: false, salida });
		});
	});
	hijoActivo = undefined;
	comprobaciones += resultado.salida.split(/\r?\n/)
		.filter((linea) => /^(?:OK|FAIL|MAL)\s/.test(linea.trimStart())).length;
	if (resultado.timeout) agotaronTiempo.push(suite);
	if (resultado.codigo !== 0) fallaron.push(suite);
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`${suites.length - fallaron.length - saltadas.length} bien · ${fallaron.length} mal`
	+ `${agotaronTiempo.length ? ` · ${agotaronTiempo.length} timeout` : ''}`
	+ `${saltadas.length ? ` · ${saltadas.length} sin correr` : ''} · ${mmss(Date.now() - t0)}`);
console.log(`${comprobaciones} comprobaciones reportadas por las suites`);
if (saltadas.length) console.log(`sin correr: ${saltadas.join(', ')}`);
if (agotaronTiempo.length) console.log(`TIMEOUT: ${agotaronTiempo.join(', ')}`);
if (fallaron.length) console.log(`MAL: ${fallaron.join(', ')}`);
else console.log('✅ TODAS BIEN');
process.exit(fallaron.length ? 1 : 0);
