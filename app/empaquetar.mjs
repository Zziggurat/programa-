/**
 * Empaqueta la app compilada (app/dist) en UN ÚNICO archivo HTML autocontenido,
 * que se puede abrir con doble clic (sin servidor, sin internet, sin instalar nada).
 *
 *   npm run empaquetar   →   dist-final/TableroStudio.html
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = join(dirname(fileURLToPath(import.meta.url)), '..');
const distApp = join(base, 'app', 'dist');
const salidaDir = join(base, 'dist-final');
mkdirSync(salidaDir, { recursive: true });

const html = readFileSync(join(distApp, 'index.html'), 'utf8');
const jsFile = readdirSync(join(distApp, 'assets')).find((f) => f.endsWith('.js'));
if (!jsFile) throw new Error('No se encontró el bundle JS. Ejecuta primero: npm run editor:build');
const js = readFileSync(join(distApp, 'assets', jsFile), 'utf8');

const estilo = html.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';
const cuerpo = html.match(/<body>([\s\S]*?)<\/body>/)?.[1]
	.replace(/<script[^>]*><\/script>/g, '')
	.trim() ?? '';

const salida = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TableroStudio — Editor 3D de tableros eléctricos</title>
${estilo}
</head>
<body>
${cuerpo}
<script type="module">
${js}
</script>
</body>
</html>
`;

const destino = join(salidaDir, 'TableroStudio.html');
writeFileSync(destino, salida);
console.log(`✅ Empaquetado: ${destino} (${Math.round(salida.length / 1024)} KB)`);

// Copia para la app de escritorio (Electron carga desktop/app.html).
writeFileSync(join(base, 'desktop', 'app.html'), salida);
console.log('✅ Copiado a desktop/app.html');
