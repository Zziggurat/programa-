/**
 * Empaqueta el build Vite en un único HTML offline. Ésta es la única implementación del formato:
 * tanto `npm run empaquetar` como `npm run entrega:check` llaman a esta función.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ARCHIVO_ACTUAL = fileURLToPath(import.meta.url);
const RAIZ = join(dirname(ARCHIVO_ACTUAL), '..');

// Vite conserva parte de los saltos de línea del checkout de origen. Canonizarlos aquí hace que
// Windows y Linux produzcan exactamente el mismo entregable y, por tanto, el mismo Build ID.
const textoCanonico = (texto) => texto.replace(/\r\n?/g, '\n');

const hashCsp = (texto) => `'sha256-${createHash('sha256').update(texto, 'utf8').digest('base64')}'`;
const hashContenido = (...partes) => {
	const h = createHash('sha256');
	for (const parte of partes) h.update(String(parte.length)).update(':').update(parte);
	return h.digest('hex').slice(0, 10).toUpperCase();
};

export function empaquetar({
	distApp = join(RAIZ, 'app', 'dist'),
	destino = join(RAIZ, 'dist-final', 'TableroStudio.html'),
	desktop = join(RAIZ, 'desktop', 'app.html'),
	silencioso = false,
} = {}) {
	const html = textoCanonico(readFileSync(join(distApp, 'index.html'), 'utf8'));
	const jsFile = readdirSync(join(distApp, 'assets')).filter((f) => f.endsWith('.js')).sort()[0];
	if (!jsFile) throw new Error('No se encontró el bundle JS. Ejecuta primero: npm run editor:build');
	const js = textoCanonico(readFileSync(join(distApp, 'assets', jsFile), 'utf8'));
	const estilo = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
	const cuerpo = html.match(/<body>([\s\S]*?)<\/body>/)?.[1]
		.replace(/<script[^>]*><\/script>/g, '')
		.trim() ?? '';

	/*
	 * El ID se deriva del contenido canónico ANTES de añadir el propio ID. Así no hay una
	 * autorreferencia imposible, dos builds iguales muestran el mismo valor y cualquier cambio del
	 * bundle, del estilo o del marcado lo cambia. No depende de la fecha ni del nombre del asset.
	 */
	const buildId = hashContenido(js, estilo, cuerpo);
	const script = `\nwindow.__TABLEROSTUDIO_BUILD_ID__ = ${JSON.stringify(buildId)};\n${js}\n`
		+ `const elBuild=document.getElementById("acerca-de");`
		+ `if(elBuild){elBuild.textContent+=" · Build: ${buildId}";elBuild.dataset.buildId="${buildId}";}`
		+ `console.info("TableroStudio · Build ${buildId}");\n`;

	/* CSP cerrada: solo el script y la hoja exactos; connect-src none garantiza el modo offline. */
	const hashJs = hashCsp(script);
	const hashCss = hashCsp(estilo.replace(/^<style>|<\/style>$/g, ''));
	const csp = [
		"default-src 'none'",
		`script-src ${hashJs}`,
		`style-src ${hashCss}`,
		"style-src-attr 'unsafe-inline'",
		'img-src data: blob:',
		'frame-src blob:',
		'font-src data:',
		"connect-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
		"object-src 'none'",
	].join('; ');

	const salida = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="tablerostudio-build" content="${buildId}">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TableroStudio — Editor 3D de tableros eléctricos</title>
${estilo}
</head>
<body>
${cuerpo}
<script type="module">${script}</script>
</body>
</html>
`;

	for (const archivo of [destino, desktop]) {
		mkdirSync(dirname(archivo), { recursive: true });
		writeFileSync(archivo, salida);
	}
	if (!silencioso) {
		console.log(`✅ Empaquetado: ${destino} (${Math.round(Buffer.byteLength(salida) / 1024)} KB)`);
		console.log(`✅ Copiado a ${desktop}`);
		console.log(`✅ Build ID: ${buildId}`);
	}
	return { buildId, salida, destino, desktop };
}

function argumento(nombre, porDefecto) {
	const valor = process.argv.find((x) => x.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
	return valor ? resolve(RAIZ, valor) : porDefecto;
}

if (resolve(process.argv[1] ?? '') === resolve(ARCHIVO_ACTUAL)) {
	empaquetar({
		distApp: argumento('dist-app', join(RAIZ, 'app', 'dist')),
		destino: argumento('salida-html', join(RAIZ, 'dist-final', 'TableroStudio.html')),
		desktop: argumento('desktop-html', join(RAIZ, 'desktop', 'app.html')),
		silencioso: process.argv.includes('--quiet'),
	});
}
