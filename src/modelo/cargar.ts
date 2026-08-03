/**
 * Apertura de un archivo de proyecto: validación y migración.
 *
 * Antes bastaba con que el JSON tuviera `formato` y `gabinete` para aceptarlo, así que un
 * archivo a medio escribir entraba y reventaba la aplicación a la primera pasada. Y el campo
 * `version` del modelo no se leía en ningún sitio: el día que cambie el formato, los
 * proyectos guardados de un cliente fallarían sin explicación.
 *
 * Aquí se comprueba de verdad la forma del archivo, se rellena lo que falte con valores
 * sanos y se deja escrito dónde va la migración de la próxima versión.
 */
import { Conductor, Dispositivo, Gabinete, Hoja, Proyecto } from './tipos.js';
import { BloqueDossier, SECCIONES_DOSSIER, TrozoTexto } from './dossier.js';

/** Versión de formato que escribe este programa. */
export const VERSION_FORMATO = 1;

export interface ResultadoCarga {
	proyecto: Proyecto;
	/** Cosas que se arreglaron solas al abrir (se le cuentan al usuario). */
	arreglos: string[];
}

export class ArchivoInvalido extends Error {}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const esLista = (v: unknown): v is unknown[] => Array.isArray(v);
const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const numero = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Lee un proyecto de un texto JSON. Lanza `ArchivoInvalido` con un motivo entendible si el
 * archivo no es un proyecto; nunca devuelve algo a medias que rompa la aplicación después.
 */
export function cargarProyecto(json: string): ResultadoCarga {
	let bruto: unknown;
	try {
		bruto = JSON.parse(json);
	} catch {
		throw new ArchivoInvalido('El archivo no es un JSON válido (¿se descargó a medias?).');
	}
	if (!esObjeto(bruto)) throw new ArchivoInvalido('El archivo no contiene un proyecto.');
	if (bruto.formato !== 'tablero-studio') {
		throw new ArchivoInvalido('Ese archivo no es un proyecto de TableroStudio.');
	}

	const version = numero(bruto.version) ?? 1;
	if (version > VERSION_FORMATO) {
		throw new ArchivoInvalido(
			`El proyecto se guardó con una versión más nueva del programa (formato ${version}). `
			+ 'Actualiza TableroStudio para abrirlo.',
		);
	}

	const arreglos: string[] = [];
	// Aquí irán las migraciones: `if (version < 2) { …; arreglos.push('…'); }`. Se dejan
	// encadenadas para que un proyecto viejo suba de versión en versión hasta la actual.

	if (!esObjeto(bruto.gabinete)) throw new ArchivoInvalido('Al proyecto le falta el gabinete.');
	const gabinete = leerGabinete(bruto.gabinete, arreglos);

	const dispositivos = leerDispositivos(bruto.dispositivos, arreglos);
	const idsValidos = new Set(dispositivos.map((d) => d.id));
	const conductores = leerConductores(bruto.conductores, idsValidos, arreglos);

	// Una colocación que apunta a un aparato que ya no existe deja un hueco fantasma.
	const antesColocaciones = gabinete.colocaciones.length;
	gabinete.colocaciones = gabinete.colocaciones.filter((c) => idsValidos.has(c.dispositivoId));
	if (gabinete.colocaciones.length !== antesColocaciones) {
		arreglos.push(`${antesColocaciones - gabinete.colocaciones.length} colocación(es) sin aparato`);
	}

	const hojas = esLista(bruto.hojas)
		? (bruto.hojas.filter(esObjeto) as unknown as Hoja[]).filter((h) => texto(h.id))
		: [];
	if (hojas.length === 0) {
		hojas.push({ id: 'h1', numero: 1, titulo: 'Hoja 1' });
		arreglos.push('no traía ninguna hoja de esquema');
	}

	const proyecto: Proyecto = {
		formato: 'tablero-studio',
		version: VERSION_FORMATO,
		nombre: texto(bruto.nombre)?.trim() || 'Tablero sin nombre',
		datos: esObjeto(bruto.datos) ? (bruto.datos as Proyecto['datos']) : undefined,
		hojas,
		dispositivos,
		conductores,
		gabinete,
		opciones: esObjeto(bruto.opciones) ? (bruto.opciones as Proyecto['opciones']) : undefined,
		esquema: leerAjustesEsquema(bruto.esquema),
		dossier: leerAjustesDossier(bruto.dossier),
	};
	return { proyecto, arreglos };
}

function leerGabinete(bruto: Record<string, unknown>, arreglos: string[]): Gabinete {
	const ancho = numero(bruto.ancho);
	const alto = numero(bruto.alto);
	if (!ancho || !alto || ancho <= 0 || alto <= 0) {
		throw new ArchivoInvalido('El gabinete del proyecto no tiene medidas válidas.');
	}
	const lista = <T>(v: unknown, nombre: string): T[] => {
		if (esLista(v)) return v.filter(esObjeto) as T[];
		if (v !== undefined) arreglos.push(`la lista de ${nombre} estaba corrupta`);
		return [];
	};
	return {
		ancho,
		alto,
		caja: esObjeto(bruto.caja) ? (bruto.caja as Gabinete['caja']) : undefined,
		rieles: lista(bruto.rieles, 'rieles'),
		canaletas: lista(bruto.canaletas, 'canaletas'),
		colocaciones: lista(bruto.colocaciones, 'colocaciones'),
	};
}

/**
 * Ajustes del dibujo del esquema: columnas por hoja y títulos propios.
 *
 * Se leen aquí y no se dejan pasar tal cual porque son del archivo, y un archivo puede venir
 * tocado a mano: 500 columnas por hoja dejarían el esquema ilegible sin decir por qué.
 */
function leerAjustesEsquema(bruto: unknown): Proyecto['esquema'] {
	if (!esObjeto(bruto)) return undefined;
	const cols = Number(bruto.columnasPorHoja);
	const titulos: Record<string, string> = {};
	if (esObjeto(bruto.titulos)) {
		for (const [k, v] of Object.entries(bruto.titulos)) {
			if (typeof v === 'string' && v.trim()) titulos[k] = v.trim().slice(0, 120);
		}
	}
	const ajustes: Proyecto['esquema'] = {};
	if (Number.isFinite(cols)) ajustes.columnasPorHoja = Math.max(4, Math.min(20, Math.round(cols)));
	if (Object.keys(titulos).length) ajustes.titulos = titulos;
	return Object.keys(ajustes).length ? ajustes : undefined;
}

/**
 * Lo que el usuario ha decidido sobre el dossier: qué apartados lleva y qué le ha añadido.
 *
 * Los bloques traen IMÁGENES en data URL, que pueden ser megas. Se aceptan tal cual —son suyas—
 * pero se comprueba que sean de verdad una imagen: un `data:text/html` metido a mano en el archivo
 * acabaría en el PDF, y de ahí a un sitio donde se abra.
 */
function leerAjustesDossier(bruto: unknown): Proyecto['dossier'] {
	if (!esObjeto(bruto)) return undefined;
	const secciones: Record<string, boolean> = {};
	if (esObjeto(bruto.secciones)) {
		for (const [k, v] of Object.entries(bruto.secciones)) {
			if (typeof v === 'boolean') secciones[k] = v;
		}
	}
	const bloques: BloqueDossier[] = [];
	if (esLista(bruto.bloques)) {
		for (const b of bruto.bloques) {
			if (!esObjeto(b) || !texto(b.id)) continue;
			const tipo = b.tipo === 'imagen' ? 'imagen' : 'texto';
			const donde = ['portada', 'principio', 'final'].includes(String(b.donde))
				? (b.donde as BloqueDossier['donde']) : 'final';
			const imagen = texto(b.imagen);
			if (tipo === 'imagen' && !(imagen && /^data:image\//i.test(imagen))) continue;
			bloques.push({
				id: b.id as string,
				tipo,
				donde,
				titulo: texto(b.titulo),
				pie: texto(b.pie),
				imagen: tipo === 'imagen' ? imagen : undefined,
				anchoPct: Number.isFinite(Number(b.anchoPct))
					? Math.max(10, Math.min(100, Number(b.anchoPct))) : undefined,
				trozos: tipo === 'texto' && esLista(b.trozos)
					? (b.trozos as unknown[]).filter(esObjeto)
						.filter((t) => typeof t.texto === 'string')
						.map((t) => t as unknown as TrozoTexto)
					: undefined,
			});
		}
	}
	const ajustes: Proyecto['dossier'] = {};
	if (Object.keys(secciones).length) ajustes.secciones = secciones;
	if (bloques.length) ajustes.bloques = bloques;

	// Orden de los apartados: solo ids conocidos y sin repetir. Un id inventado en el archivo no
	// haría daño, pero tampoco aporta nada y ensucia lo que se vuelve a guardar.
	if (esLista(bruto.orden)) {
		const conocidos = new Set(SECCIONES_DOSSIER.map((x) => x.id));
		const orden = [...new Set((bruto.orden as unknown[])
			.filter((x): x is string => typeof x === 'string' && conocidos.has(x)))];
		if (orden.length) ajustes.orden = orden;
	}

	// Quién firma. El logo se acepta tal cual —es suyo— pero se comprueba que sea de verdad una
	// imagen, por lo mismo que los bloques: un `data:text/html` acabaría dentro del PDF.
	if (esObjeto(bruto.empresa)) {
		const logo = texto(bruto.empresa.logo);
		const empresa = {
			nombre: texto(bruto.empresa.nombre)?.slice(0, 120),
			contacto: texto(bruto.empresa.contacto)?.slice(0, 200),
			logo: logo && /^data:image\//i.test(logo) ? logo : undefined,
		};
		if (empresa.nombre || empresa.contacto || empresa.logo) ajustes.empresa = empresa;
	}

	const color = texto(bruto.color);
	if (color && /^#[0-9a-fA-F]{6}$/.test(color)) ajustes.color = color.toLowerCase();
	if (bruto.papel === 'carta' || bruto.papel === 'a4') ajustes.papel = bruto.papel;

	return Object.keys(ajustes).length ? ajustes : undefined;
}

/** Colocación manual de un símbolo. Un valor imposible se descarta y el motor vuelve a decidir. */
function leerColocacionEsquema(bruto: unknown): Dispositivo['esquema'] {
	if (!esObjeto(bruto)) return undefined;
	const columna = Number(bruto.columna);
	const fila = Number(bruto.fila);
	if (!Number.isFinite(columna) || !Number.isFinite(fila)) return undefined;
	return { columna: Math.max(1, Math.round(columna)), fila: Math.max(1, Math.round(fila)) };
}

function leerDispositivos(bruto: unknown, arreglos: string[]): Dispositivo[] {
	if (!esLista(bruto)) {
		if (bruto !== undefined) arreglos.push('la lista de aparatos estaba corrupta');
		return [];
	}
	const salida: Dispositivo[] = [];
	const vistos = new Set<string>();
	let descartados = 0;
	for (const d of bruto) {
		// Un aparato sin id o sin tipo no se puede dibujar ni cablear: se descarta y se dice.
		if (!esObjeto(d) || !texto(d.id) || !texto(d.tipo) || vistos.has(d.id as string)) {
			descartados++;
			continue;
		}
		vistos.add(d.id as string);
		salida.push({
			...(d as unknown as Dispositivo),
			bornes: esLista(d.bornes) ? (d.bornes as Dispositivo['bornes']) : [],
			esquema: leerColocacionEsquema((d as Record<string, unknown>).esquema),
		});
	}
	if (descartados) arreglos.push(`${descartados} aparato(s) sin datos suficientes`);
	return salida;
}

function leerConductores(bruto: unknown, idsValidos: Set<string>, arreglos: string[]): Conductor[] {
	if (!esLista(bruto)) {
		if (bruto !== undefined) arreglos.push('la lista de cables estaba corrupta');
		return [];
	}
	const salida: Conductor[] = [];
	let huerfanos = 0;
	for (const c of bruto) {
		if (!esObjeto(c) || !texto(c.id) || !esObjeto(c.de) || !esObjeto(c.a)) { huerfanos++; continue; }
		const de = c.de as Record<string, unknown>;
		const a = c.a as Record<string, unknown>;
		// Un cable que apunta a un aparato inexistente queda «colgando» y rompe el ruteo.
		if (!idsValidos.has(texto(de.dispositivoId) ?? '') || !idsValidos.has(texto(a.dispositivoId) ?? '')) {
			huerfanos++;
			continue;
		}
		salida.push(c as unknown as Conductor);
	}
	if (huerfanos) arreglos.push(`${huerfanos} cable(s) sueltos sin aparato en un extremo`);
	return salida;
}
