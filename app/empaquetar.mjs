/**
 * Empaqueta la app compilada (app/dist) en UN ÚNICO archivo HTML autocontenido,
 * que se puede abrir con doble clic (sin servidor, sin internet, sin instalar nada).
 *
 *   npm run empaquetar   →   dist-final/TableroStudio.html
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/*
 * POLÍTICA DE SEGURIDAD DE CONTENIDO, con el hash del código que va dentro.
 *
 * Segunda auditoría, TS2-P1-12. El archivo entregado no traía ninguna, y es un HTML con todo el
 * programa metido en un `<script>` en línea: sin CSP, cualquier cosa que acabase inyectada en el
 * DOM podría ejecutarse. Con `'unsafe-inline'` no serviría de nada, así que se calcula el SHA-256
 * del script y del estilo que de verdad se empaquetan y se permiten SOLO esos dos.
 *
 * `connect-src 'none'` y `form-action 'none'` dicen lo que este programa ya cumple: no habla con
 * ningún servidor. Las imágenes admiten `data:` porque el logo y las fotos de referencia se
 * guardan así dentro del propio proyecto, y `blob:` porque de ahí salen las descargas.
 */
const hash = (t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;
const hashJs = hash(`\n${js}\n`);
const hashCss = hash(estilo.replace(/^<style>|<\/style>$/g, ''));
const csp = [
	"default-src 'none'",
	`script-src ${hashJs}`,
	`style-src ${hashCss}`,
	/*
	 * Los `style="…"` de los elementos van por su propia directiva.
	 *
	 * Con un hash en `style-src`, el `'unsafe-inline'` de esa misma directiva se IGNORA —lo dice
	 * el propio navegador en el aviso—, y el programa pinta chips de color, barras de disipación
	 * y anchos de columna con atributos `style`. Eso lo gobierna `style-src-attr`, que es una
	 * directiva aparte: la hoja empaquetada sigue atada a su hash y solo se abren los atributos.
	 * Lo cazó `qa/entrega.mjs` a la primera, con tres avisos de «Refused to apply inline style».
	 */
	"style-src-attr 'unsafe-inline'",
	"img-src data: blob:",
	// La vista previa del dossier es el PDF metido en un `<iframe>` con una URL `blob:`. Sin esto
	// `default-src 'none'` lo bloquea y el dossier se queda en blanco: lo dijo `qa/entrega.mjs`.
	"frame-src blob:",
	"font-src data:",
	"connect-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
	"object-src 'none'",
].join('; ');

const salida = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
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
