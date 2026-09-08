import { createHash } from 'node:crypto';

/** Oráculo Node independiente del SHA/canon que ejecuta el navegador. */
export const canonSeguridad = valor => Array.isArray(valor) ? `[${valor.map(canonSeguridad).join(',')}]`
	: valor && typeof valor === 'object' ? `{${Object.keys(valor).sort().map(k => `${JSON.stringify(k)}:${canonSeguridad(valor[k])}`).join(',')}}`
		: JSON.stringify(valor);
const hash = texto => `sha256:${createHash('sha256').update(texto, 'utf8').digest('hex')}`;
const referencia = r => ({ tipo: r.tipo, catalogoId: r.catalogo.id, id: r.id, revision: r.revision, hash: r.hash });

export function paqueteSeguridadTecnica() {
	const procedencia = { origen: 'SINTETICO', referencia: 'QA importación V8, datos aritméticos sin fabricante' };
	const producto = { version: 1, canon: 1, catalogo: { id: 'qa-seguridad-v8', nombre: 'QA seguridad V8' },
		id: 'proteccion-qa', revision: 1, nombre: 'Protección QA <img src=x onerror="window.__qaV8Xss=1">',
		estado: 'ACTIVA', procedencia, tipo: 'PRODUCTO', familia: 'PROTECCION', variante: 'AC 230 V sintética', campos: [
			{ campo: 'proteccion.Icu', valor: 6, unidad: 'kA', naturaleza: 'NOMINAL', condiciones: { sistema: 'AC', tensionV: 230 }, procedencia },
			{ campo: 'proteccion.inA', valor: 25, unidad: 'A', naturaleza: 'NOMINAL', procedencia },
		] };
	producto.hash = hash(canonSeguridad(producto));
	const referencias = [referencia(producto)];
	return { formato: 'tablero-studio-datos-tecnicos', version: 1, canon: 1,
		revisiones: [producto], manifiesto: { referencias, hash: hash(canonSeguridad(referencias)) } };
}

export function entradasTecnicasHostiles() {
	const valido = paqueteSeguridadTecnica();
	const modificar = f => { const p = structuredClone(valido); f(p); return JSON.stringify(p); };
	return [
		{ nombre: 'JSON incompleto', texto: '{"formato":', error: /JSON inválido/i },
		{ nombre: 'versión futura', texto: modificar(p => { p.version = 99; }), error: /valor no permitido|versión|version/i },
		{ nombre: 'contenido alterado manteniendo hash', texto: modificar(p => { p.revisiones[0].campos[0].valor = 999; }), error: /integridad|hash/i },
		{ nombre: 'hash de manifiesto alterado', texto: modificar(p => { p.manifiesto.hash = `sha256:${'f'.repeat(64)}`; }), error: /integridad|manifiesto/i },
		{ nombre: 'clave peligrosa __proto__', texto: JSON.stringify(valido).replace('{', '{"__proto__":{"v8Contaminado":true},'), error: /clave peligrosa|campo desconocido/i },
		{ nombre: 'verificación humana autodeclarada por import', texto: modificar(p => { p.revisiones[0].verificado = true; }), error: /campo desconocido/i },
	];
}

/** Sonda estrictamente readonly: nunca crea base/store, escribe ni altera el almacenamiento. */
export async function leerBibliotecaTecnica(pagina) {
	return pagina.evaluate(async () => {
		const nombre = 'tablerostudio-documentos';
		const existentes = await indexedDB.databases();
		if (!existentes.some(x => x.name === nombre)) throw new Error('Base del producto aún no inicializada');
		const base = await new Promise((resolve, reject) => {
			const r = indexedDB.open(nombre);
			r.onupgradeneeded = () => { r.transaction.abort(); reject(new Error('La sonda no crea bases')); };
			r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const tx = base.transaction(['technicalData'], 'readonly'); const r = tx.objectStore('technicalData').getAll();
				tx.oncomplete = () => resolve(r.result.sort((a, b) => a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
				tx.onabort = () => reject(tx.error ?? new Error('Lectura IDB abortada')); tx.onerror = () => reject(tx.error);
			});
		} finally { base.close(); }
	});
}

export async function snapshotProyectoVisible(pagina) {
	await pagina.evaluate(() => window.qa.esperarPersistencia());
	return pagina.evaluate(() => ({ proyecto: window.qa.proyecto(), id: window.qa.documentoActivo().id,
		revision: window.qa.documentoActivo().revision }));
}

export async function enviarJSONTecnico(pagina, texto, nombre = 'datos-tecnicos-qa.json') {
	await pagina.locator('#modal-datos-tecnicos [data-dt-archivo]').setInputFiles({ name: nombre,
		mimeType: 'application/json', buffer: Buffer.from(texto, 'utf8') });
}
