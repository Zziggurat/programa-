import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { imagenAdmisible } from '../src/modelo/cargar.js';
import { leerInformeDisenoJson } from '../src/diseno-asistido/documentacion.js';

// jsPDF consulta el DOM al cargar el módulo, aun cuando el documento se genera sin navegador.
Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');
const procedencia = { estado: 'confirmado' as const, projectId: 'doc-seguridad',
	revisionRepositorio: 3, buildId: 'QA-DOC08', generadoEn: '2026-09-24T12:00:00.000Z' };

test('DOC-08: texto hostil permanece como texto y HTML/SVG portátiles no cargan código ni red', async () => {
	const hostil = 'Á & " </style><script>globalThis.__doc08 = true</script>\n<svg onload=alert(1)>';
	const p = crearProyecto(hostil);
	p.hojas = [{ id: 'h1', numero: 1, titulo: hostil }];
	p.dispositivos = [{ id: 'x1', tipo: 'bornero', designacion: hostil,
		descripcion: hostil, bornes: [{ id: '1', tipo: 'control' }] }];
	p.esquema = { representaciones: [{ id: 'x1-vista', dispositivoId: 'x1', hojaId: 'h1',
		posicion: { columna: 2, fila: 3 }, parte: { tipo: 'completa' } }] };
	const antes = JSON.stringify(p);
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), antes, 'exportar no aplica ni sanea el proyecto vivo');
	const vistas = archivos.filter(a => /(?:\.html|\.svg)$/.test(a.ruta));
	assert.ok(vistas.length >= 4, 'índice, esquema, dossier e Ingeniería están presentes');
	for (const archivo of vistas) {
		const texto = String(archivo.contenido);
		assert.doesNotMatch(texto, /<script\b|<svg\s+onload\b|<img\s+onerror\b/i,
			`${archivo.ruta}: no hay elementos ejecutables procedentes de datos`);
		assert.doesNotMatch(texto, /<link\b|@import\b|url\(\s*['"]?\s*(?:https?:|\/\/)/i,
			`${archivo.ruta}: no requiere CSS ni fuentes remotas`);
		for (const [, url] of texto.matchAll(/<(?:a|img|iframe)\b[^>]*\b(?:href|src)="([^"]*)"/gi)) {
			const destino = new URL(url, `file:///paquete/${archivo.ruta}`);
			assert.equal(destino.protocol, 'file:', `${archivo.ruta}: recurso local`);
			assert.ok(destino.pathname.startsWith('/paquete/'), `${archivo.ruta}: no sale del paquete`);
		}
	}
	for (const ruta of ['index.html', 'dossier/dossier.html', 'ingenieria/informe.html']) {
		const texto = String(archivos.find(a => a.ruta === ruta)?.contenido ?? '');
		assert.match(texto, /&lt;script&gt;globalThis\.__doc08 = true&lt;\/script&gt;/,
			`${ruta}: conserva el texto hostil escapado`);
	}
	assert.match(String(archivos.find(a => a.ruta === 'ingenieria/informe.html')?.contenido),
		/Content-Security-Policy[^>]+default-src 'none'/);
});

test('DOC-08: un HTML importado no es un informe de edición y HTML/SVG no son imágenes admisibles', () => {
	assert.throws(() => leerInformeDisenoJson('<script>globalThis.__doc08 = true</script>'),
		/INFORME_JSON_INVALIDO/);
	assert.equal(imagenAdmisible('data:text/html;base64,PHNjcmlwdD4=').ok, false);
	assert.equal(imagenAdmisible('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9').ok, false);
});
