/**
 * Definiciones reutilizables de componentes creados por la persona usuaria.
 *
 * Una definición no es una instancia colocada en un tablero. Al colocarla se toma una fotografía
 * profunda de terminales, perfil y parámetros. Así, editar mañana la biblioteca personal no
 * altera silenciosamente un proyecto antiguo.
 */
import { cargarProyecto } from '../modelo/cargar.js';
import { validarAdopcionTecnica } from '../datos-tecnicos/operaciones.js';
import { congelarSubconjunto, indexarRevisiones } from '../datos-tecnicos/hash.js';
import { familiaDispositivo } from '../datos-tecnicos/resolver.js';
import { validarReferencia } from '../datos-tecnicos/schema.js';
import { claveRevision, type ReferenciaTecnica, type RevisionTecnica } from '../datos-tecnicos/tipos.js';
import {
	ComportamientoSimulacion, validarComportamiento,
} from '../modelo/comportamiento.js';
import type { BloqueTerminales, Borne, Dispositivo, MontajeComponente, Proyecto, TipoBorne, TipoDispositivo } from '../modelo/tipos.js';
import { leerMontajeDeclarado, validarMontajeDeclarado } from './montaje.js';
import { leerCarcasaParametrica, validarCarcasaParametrica, type CarcasaParametrica } from './carcasa.js';
import { MAX_TERMINALES_BLOQUE } from '../motores/terminales.js';

export const FORMATO_COMPONENTE_PERSONALIZADO = 'tablero-studio-componente' as const;
export const VERSION_COMPONENTE_PERSONALIZADO = 1 as const;

export interface TerminalComponentePersonalizado extends Borne {
	u: number;
	v: number;
}

export interface ParametrosNominalesComponente {
	tensionV?: number;
	corrienteA?: number;
	potenciaW?: number;
	frecuenciaHz?: number;
	/** Propiedades runtime que no pertenecen al grafo de bornes del perfil. */
	temporizacion?: { tipo: 'trabajo' | 'reposo'; segundos: number };
	programa?: string;
	rangoSonda?: [number, number];
	unidadSonda?: string;
	rangoSalidaAnalogica?: [number, number];
}

export interface DefinicionComponentePersonalizado {
	formato: typeof FORMATO_COMPONENTE_PERSONALIZADO;
	version: typeof VERSION_COMPONENTE_PERSONALIZADO;
	id: string;
	revision: number;
	nombre: string;
	fabricante?: string;
	referencia?: string;
	descripcion?: string;
	creadoEn: string;
	modificadoEn: string;
	/** Clasificación de catálogo/esquema. La simulación usa `comportamiento`. */
	tipoDispositivo: TipoDispositivo;
	dimensiones: { anchoMm: number; altoMm: number; fondoMm: number };
	/** Ausente en definiciones anteriores: método y encaje físico no evaluables. */
	montaje?: MontajeComponente;
	/** Envolvente visual declarada, aproximada; independiente del contrato eléctrico. */
	carcasa?: CarcasaParametrica;
	assetId: string;
	terminales: TerminalComponentePersonalizado[];
	/** Borneras físicas declaradas: IDs existentes, orden dentro de cada bloque y borde del aparato. */
	bloquesTerminales?: BloqueTerminales[];
	comportamiento: ComportamientoSimulacion;
	parametros?: ParametrosNominalesComponente;
	/** Ficha exacta y su cierre V8 inmutable. Hash = integridad, nunca autenticidad. */
	fichaTecnica?: { producto: ReferenciaTecnica; revisiones: RevisionTecnica[] };
}

export interface ProcedenciaComponentePersonalizado {
	definicionId: string;
	revision: number;
}

export type DispositivoPersonalizado = Dispositivo & {
	assetId: string;
	componentePersonalizado: ProcedenciaComponentePersonalizado;
};

export interface SugerenciaRolTerminal {
	terminalId: string;
	rol: 'bobina-entrada' | 'bobina-retorno' | 'contacto-na' | 'contacto-nc'
		| 'polo-entrada' | 'polo-salida' | 'proteccion' | 'retorno' | 'comun';
	grupo?: string;
	motivo: string;
}

export interface AssetPortatil {
	id: string;
	mime: 'image/png' | 'image/jpeg' | 'image/webp';
	/** Base64 sin prefijo data:. Solo aparece al exportar, nunca en el registro interno del proyecto. */
	base64: string;
}

export interface PaqueteProyectoPortatil {
	formato: 'tablero-studio-paquete';
	/** V2 porta revisiones; V3 fichas exactas; V4 preserva carcasas visuales declaradas. */
	version: 1 | 2 | 3 | 4;
	proyecto: Proyecto;
	assets: AssetPortatil[];
	componentes: DefinicionComponentePersonalizado[];
}

const TIPOS_BORNE = new Set<TipoBorne>(['L', 'N', 'PE', 'control', 'senal', 'otro']);
const LADOS_FUENTE = new Set(['primario', 'secundario+', 'secundario-']);
const LADOS_APARATO = new Set(['arriba', 'abajo', 'izquierda', 'derecha']);
const MIME_PORTATIL = new Set(['image/png', 'image/jpeg', 'image/webp']);

const clonar = <T>(valor: T): T => structuredClone(valor);
const texto = (valor: string | undefined): string | undefined => valor?.trim() || undefined;
const numeroPositivo = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Contrato único para editor, repositorio y paquetes: ausente significa «no declarado». */
export function validarLimitesTerminales(terminales: readonly {
	id: string; maxConductores?: unknown; seccionMaxMm2?: unknown;
}[]): string[] {
	const errores: string[] = [];
	for (const terminal of terminales) {
		if (terminal.maxConductores !== undefined
			&& (!Number.isSafeInteger(terminal.maxConductores)
				|| (terminal.maxConductores as number) < 1)) {
			errores.push(`Terminal «${terminal.id}»: máximo de conductores debe ser un entero positivo seguro.`);
		}
		if (terminal.seccionMaxMm2 !== undefined
			&& (typeof terminal.seccionMaxMm2 !== 'number' || !Number.isFinite(terminal.seccionMaxMm2)
				|| terminal.seccionMaxMm2 <= 0)) {
			errores.push(`Terminal «${terminal.id}»: sección máxima debe ser un número positivo finito en mm².`);
		}
	}
	return errores;
}

/** Metadatos eléctricos declarados: nunca se deducen del rótulo ni se descartan al importar. */
export function validarSemanticaTerminales(terminales: readonly {
	id: string; lado?: unknown; obligatorio?: unknown;
}[]): string[] {
	const errores: string[] = [];
	for (const terminal of terminales) {
		if (terminal.lado !== undefined && !LADOS_FUENTE.has(terminal.lado as string)) {
			errores.push(`Terminal «${terminal.id}»: lado de fuente no reconocido.`);
		}
		if (terminal.obligatorio !== undefined && typeof terminal.obligatorio !== 'boolean') {
			errores.push(`Terminal «${terminal.id}»: obligatorio debe ser sí o no.`);
		}
	}
	return errores;
}

export interface EvaluacionBloquesTerminales {
	estado: 'SIN_DECLARAR' | 'GEOMETRIA_DECLARADA' | 'NO_EVALUABLE';
	errores: string[];
	motivos: string[];
}

/** Validación sin reordenar ni generar bornes. Un rango ausente entre bloques vecinos no prueba encaje. */
export function evaluarBloquesTerminales(
	bloques: unknown, terminales: readonly Pick<Borne, 'id'>[],
	dimensiones: Pick<DefinicionComponentePersonalizado['dimensiones'], 'anchoMm' | 'altoMm'>,
): EvaluacionBloquesTerminales {
	if (bloques === undefined) return { estado: 'SIN_DECLARAR', errores: [], motivos: [] };
	if (!Array.isArray(bloques) || bloques.length > 128) return { estado: 'NO_EVALUABLE',
		errores: ['Los bloques de terminales deben ser una lista de hasta 128.'], motivos: [] };
	if (bloques.length === 0) return { estado: 'SIN_DECLARAR', errores: [], motivos: [] };
	const errores: string[] = [];
	const motivos: string[] = [];
	const disponibles = new Set(terminales.map((t) => t.id));
	const usados = new Set<string>();
	const tramos = new Map<string, { desde: number; hasta: number; explicitado: boolean; indice: number }[]>();
	for (const [indice, dato] of bloques.entries()) {
		const n = indice + 1;
		if (!dato || typeof dato !== 'object' || Array.isArray(dato)) {
			errores.push(`Bloque ${n}: se requiere un objeto.`); continue;
		}
		const b = dato as Record<string, unknown>;
		if (Object.keys(b).some((k) => !['rotulo', 'lado', 'bornes', 'margen', 'desde', 'hasta', 'color', 'extraible'].includes(k))) {
			errores.push(`Bloque ${n}: campo desconocido.`);
		}
		if (!LADOS_APARATO.has(b.lado as string)) errores.push(`Bloque ${n}: lado físico no reconocido.`);
		if (!Array.isArray(b.bornes) || !b.bornes.length || b.bornes.length > MAX_TERMINALES_BLOQUE) {
			errores.push(`Bloque ${n}: declare de 1 a ${MAX_TERMINALES_BLOQUE} IDs de borne.`);
		} else for (const id of b.bornes) {
			if (typeof id !== 'string' || !disponibles.has(id)) errores.push(`Bloque ${n}: borne «${String(id)}» inexistente.`);
			else if (usados.has(id)) errores.push(`Bloque ${n}: borne «${id}» repetido en los bloques.`);
			else usados.add(id);
		}
		if (b.rotulo !== undefined && (typeof b.rotulo !== 'string' || !b.rotulo.trim()
			|| b.rotulo.length > 120 || /[\u0000-\u001f\u007f]/u.test(b.rotulo))) errores.push(`Bloque ${n}: rótulo inválido.`);
		if (b.color !== undefined && (typeof b.color !== 'string' || !/^#[a-f\d]{6}$/iu.test(b.color))) {
			errores.push(`Bloque ${n}: color debe ser #rrggbb.`);
		}
		if (b.extraible !== undefined && typeof b.extraible !== 'boolean') errores.push(`Bloque ${n}: extraíble debe ser sí o no.`);
		const perpendicular = b.lado === 'arriba' || b.lado === 'abajo' ? dimensiones.altoMm : dimensiones.anchoMm;
		if (b.margen !== undefined && (typeof b.margen !== 'number' || !Number.isFinite(b.margen)
			|| b.margen < 0 || b.margen > perpendicular)) errores.push(`Bloque ${n}: margen fuera de la envolvente.`);
		const desde = b.desde ?? 0; const hasta = b.hasta ?? 1;
		if (typeof desde !== 'number' || !Number.isFinite(desde) || desde < 0 || desde > 1
			|| typeof hasta !== 'number' || !Number.isFinite(hasta) || hasta < 0 || hasta > 1 || desde >= hasta) {
			errores.push(`Bloque ${n}: el tramo debe cumplir 0 ≤ desde < hasta ≤ 1.`);
		} else if (LADOS_APARATO.has(b.lado as string)) {
			const lado = b.lado as string;
			const delLado = tramos.get(lado) ?? [];
			for (const anterior of delLado) if (desde < anterior.hasta && hasta > anterior.desde) {
				if (b.desde !== undefined && b.hasta !== undefined && anterior.explicitado) {
					errores.push(`Bloques ${anterior.indice} y ${n}: tramos superpuestos en ${lado}.`);
				} else motivos.push(`Bloques ${anterior.indice} y ${n}: ubicación en ${lado} NO EVALUABLE sin rangos explícitos.`);
			}
			delLado.push({ desde, hasta, explicitado: b.desde !== undefined && b.hasta !== undefined, indice: n });
			tramos.set(lado, delLado);
		}
	}
	for (const terminal of terminales) if (!usados.has(terminal.id)) {
		motivos.push(`Terminal «${terminal.id}» sin bloque físico: posición de bloque NO EVALUABLE.`);
	}
	return { estado: errores.length || motivos.length ? 'NO_EVALUABLE' : 'GEOMETRIA_DECLARADA', errores, motivos };
}

/** Una definición usa la misma familia funcional que V8 evaluará al colocar la instancia. */
export function validarFichaTecnicaComponente(d: Pick<DefinicionComponentePersonalizado,
	'tipoDispositivo' | 'terminales' | 'comportamiento' | 'fichaTecnica'>): string[] {
	if (d.fichaTecnica === undefined) return [];
	const ficha = d.fichaTecnica;
	if (!ficha || typeof ficha !== 'object' || Array.isArray(ficha)
		|| Object.keys(ficha).some((k) => k !== 'producto' && k !== 'revisiones')
		|| !Array.isArray(ficha.revisiones) || ficha.revisiones.length < 1 || ficha.revisiones.length > 2) {
		return ['La ficha técnica debe contener solo un producto exacto y su cierre de hasta dos revisiones V8.'];
	}
	try {
		validarReferencia(ficha.producto, 'fichaTecnica.producto');
		if (ficha.producto.tipo !== 'PRODUCTO') return ['La ficha técnica debe referenciar un PRODUCTO V8.'];
		const indice = indexarRevisiones(ficha.revisiones);
		if (indice.size !== ficha.revisiones.length) return ['La ficha técnica contiene una revisión duplicada.'];
		const cierre = congelarSubconjunto([ficha.producto], ficha.revisiones);
		if (cierre.length !== ficha.revisiones.length) return ['La ficha técnica incluye revisiones ajenas al producto.'];
		const producto = indice.get(claveRevision(ficha.producto));
		if (!producto || producto.tipo !== 'PRODUCTO' || producto.hash !== ficha.producto.hash) {
			return ['La ficha técnica no contiene el producto exacto.'];
		}
		const familia = familiaDispositivo({ id: 'componente', tipo: d.tipoDispositivo,
			bornes: d.terminales, comportamiento: d.comportamiento });
		if (!familia || producto.familia !== familia) {
			return [`La ficha ${producto.familia} no corresponde a la familia funcional ${familia ?? 'NO EVALUABLE'} del componente.`];
		}
		// El cierre no convierte una fuente SINTÉTICA/DOCUMENTAL en ficha certificada.
		return [];
	} catch (error) {
		return [`Ficha técnica inválida: ${error instanceof Error ? error.message : String(error)}`];
	}
}

/**
 * Errores comprensibles del asistente. No devuelve un booleano porque una configuración puede
 * tener varios problemas y obligar a corregirlos de uno en uno sería innecesariamente hostil.
 */
export function validarDefinicionComponente(d: DefinicionComponentePersonalizado): string[] {
	const errores: string[] = [];
	if (d.formato !== FORMATO_COMPONENTE_PERSONALIZADO || d.version !== VERSION_COMPONENTE_PERSONALIZADO) {
		errores.push('el formato o la versión del componente no es compatible');
	}
	if (!texto(d.id)) errores.push('el componente necesita una identidad estable');
	if (!Number.isInteger(d.revision) || d.revision < 1) errores.push('la revisión debe ser un entero positivo');
	if (!texto(d.nombre)) errores.push('escribe un nombre para el componente');
	if (!texto(d.assetId)) errores.push('falta la imagen del componente');
	if (!numeroPositivo(d.dimensiones.anchoMm) || !numeroPositivo(d.dimensiones.altoMm)
		|| !numeroPositivo(d.dimensiones.fondoMm)) {
		errores.push('ancho, alto y fondo deben ser mayores que cero');
	}
	errores.push(...validarMontajeDeclarado(d.montaje, d.dimensiones));
	errores.push(...validarCarcasaParametrica(d.carcasa));
	const p = d.parametros;
	if (p?.temporizacion && (!Number.isFinite(p.temporizacion.segundos) || p.temporizacion.segundos < 0)) {
		errores.push('la temporización debe expresarse en segundos positivos o cero');
	}
	for (const [nombre, rango] of [
		['rango de sonda', p?.rangoSonda], ['rango de salida analógica', p?.rangoSalidaAnalogica],
	] as const) {
		if (rango && (!Number.isFinite(rango[0]) || !Number.isFinite(rango[1]) || rango[1] <= rango[0])) {
			errores.push(`el ${nombre} debe crecer de mínimo a máximo`);
		}
	}
	if (d.terminales.length === 0 && d.comportamiento.clase !== 'sin-comportamiento') {
		errores.push('marca al menos un terminal');
	}
	const ids = new Set<string>();
	for (const [i, terminal] of d.terminales.entries()) {
		const id = texto(terminal.id);
		if (!id) errores.push(`terminal ${i + 1}: falta el ID estable`);
		else if (ids.has(id)) errores.push(`el terminal «${id}» está repetido`);
		else ids.add(id);
		if (!Number.isFinite(terminal.u) || terminal.u < 0 || terminal.u > 1
			|| !Number.isFinite(terminal.v) || terminal.v < 0 || terminal.v > 1) {
			errores.push(`terminal «${id ?? i + 1}»: la posición debe caer dentro de la imagen`);
		}
		if (terminal.tipo !== undefined && !TIPOS_BORNE.has(terminal.tipo)) {
			errores.push(`terminal «${id ?? i + 1}»: naturaleza eléctrica no reconocida`);
		}
	}
	errores.push(...validarLimitesTerminales(d.terminales));
	errores.push(...validarSemanticaTerminales(d.terminales));
	for (const terminal of d.terminales) if (terminal.rotulo !== undefined
		&& (typeof terminal.rotulo !== 'string' || !terminal.rotulo.trim() || terminal.rotulo.length > 120
			|| /[\u0000-\u001f\u007f]/u.test(terminal.rotulo))) {
		errores.push(`terminal «${terminal.id}»: rótulo visible inválido`);
	}
	errores.push(...evaluarBloquesTerminales(d.bloquesTerminales, d.terminales, d.dimensiones).errores);
	errores.push(...validarFichaTecnicaComponente(d));

	errores.push(...validarComportamiento({ bornes: d.terminales, comportamiento: d.comportamiento }));

	const c = d.comportamiento;
	if (c.clase === 'contactos-electromagneticos') {
		if (c.polos.length === 0 && d.tipoDispositivo === 'contactor') {
			errores.push('un contactor necesita al menos un polo principal');
		}
		const bobina = new Set([c.bobina.entrada, c.bobina.retorno]);
		const usadosEnPotencia = new Set(c.polos.flatMap((p) => [p.entrada, p.salida]));
		const usadosEnContactos = new Set(c.contactos.flatMap((p) => [p.entrada, p.salida]));
		for (const id of bobina) {
			if (usadosEnPotencia.has(id) || usadosEnContactos.has(id)) {
				errores.push(`el terminal «${id}» no puede ser bobina y contacto/polo a la vez`);
			}
		}
		const polosVistos = new Set<string>();
		for (const polo of c.polos) {
			for (const id of [polo.entrada, polo.salida]) {
				if (polosVistos.has(id)) errores.push(`el terminal «${id}» pertenece a dos polos principales`);
				polosVistos.add(id);
			}
		}
	}
	if (c.clase === 'proteccion' && c.polos.length === 0) {
		errores.push('una protección o seccionador necesita al menos un polo');
	}
	if (c.clase === 'carga') {
		const distintas = new Set(c.alimentacion.fases);
		if (c.alimentacion.fasesMinimas === 3 && distintas.size < 3) {
			errores.push('una carga trifásica necesita tres terminales de fase distintos');
		}
		if (c.alimentacion.fasesMinimas === 1 && distintas.size === 0) {
			errores.push('la carga necesita al menos un terminal activo');
		}
	}
	return [...new Set(errores)];
}

/**
 * Sugerencias IEC: son solo propuestas visibles. Esta función no recibe ni devuelve una
 * definición y por tanto no puede guardar accidentalmente ninguna conclusión.
 */
export function sugerirRolesIEC(terminales: readonly Pick<Borne, 'id' | 'tipo'>[]): SugerenciaRolTerminal[] {
	const ids = new Set(terminales.map((t) => t.id));
	const salida: SugerenciaRolTerminal[] = [];
	const sugerir = (terminalId: string, rol: SugerenciaRolTerminal['rol'], motivo: string, grupo?: string) => {
		if (ids.has(terminalId)) salida.push({ terminalId, rol, motivo, ...(grupo ? { grupo } : {}) });
	};
	sugerir('A1', 'bobina-entrada', 'A1 suele identificar un extremo de bobina IEC');
	sugerir('A2', 'bobina-retorno', 'A2 suele identificar el retorno de bobina IEC');
	for (let grupo = 1; grupo <= 9; grupo++) {
		const prefijo = String(grupo);
		if (ids.has(`${prefijo}3`) && ids.has(`${prefijo}4`)) {
			sugerir(`${prefijo}3`, 'contacto-na', 'la pareja …3–…4 suele ser NA', prefijo);
			sugerir(`${prefijo}4`, 'contacto-na', 'la pareja …3–…4 suele ser NA', prefijo);
		}
		if (ids.has(`${prefijo}1`) && ids.has(`${prefijo}2`)) {
			sugerir(`${prefijo}1`, 'contacto-nc', 'la pareja …1–…2 suele ser NC', prefijo);
			sugerir(`${prefijo}2`, 'contacto-nc', 'la pareja …1–…2 suele ser NC', prefijo);
		}
	}
	for (let polo = 1; polo <= 3; polo++) {
		const entrada = `${polo * 2 - 1}/L${polo}`;
		const salidaPolo = `${polo * 2}/T${polo}`;
		sugerir(entrada, 'polo-entrada', 'L/T suele identificar un polo principal', String(polo));
		sugerir(salidaPolo, 'polo-salida', 'L/T suele identificar un polo principal', String(polo));
	}
	for (const t of terminales) {
		if (t.tipo === 'PE') sugerir(t.id, 'proteccion', 'el modelo declara explícitamente este borne como PE');
		if (t.tipo === 'N') sugerir(t.id, 'retorno', 'el modelo declara explícitamente este borne como neutro');
		if (/^(0V|GND|COM)$/i.test(t.id)) sugerir(t.id, 'comun', 'el rótulo sugiere un común funcional; confirma su función');
	}
	return salida;
}

export function instanciarComponentePersonalizado(
	definicion: DefinicionComponentePersonalizado,
	dispositivoId: string,
	opciones: { imagenResuelta?: string; campo?: boolean } = {},
): DispositivoPersonalizado {
	const errores = validarDefinicionComponente(definicion);
	if (errores.length) throw new Error(`Componente inválido: ${errores.join('; ')}`);
	const p = definicion.parametros;
	return {
		id: dispositivoId,
		tipo: definicion.tipoDispositivo,
		descripcion: definicion.descripcion ?? definicion.nombre,
		fabricante: definicion.fabricante,
		referencia: definicion.referencia,
		tensionNominal: p?.tensionV,
		corrienteNominal: p?.corrienteA,
		disipacionW: p?.potenciaW,
		profundidad: definicion.dimensiones.fondoMm,
		temporizacion: p?.temporizacion ? clonar(p.temporizacion) : undefined,
		programa: texto(p?.programa),
		rangoSonda: p?.rangoSonda ? clonar(p.rangoSonda) : undefined,
		unidadSonda: texto(p?.unidadSonda),
		rangoSalidaAnalogica: p?.rangoSalidaAnalogica ? clonar(p.rangoSalidaAnalogica) : undefined,
		campo: opciones.campo ?? false,
		bornes: clonar(definicion.terminales),
		...(definicion.bloquesTerminales ? { terminales: clonar(definicion.bloquesTerminales) } : {}),
		comportamiento: clonar(definicion.comportamiento),
		assetId: definicion.assetId,
		componentePersonalizado: { definicionId: definicion.id, revision: definicion.revision },
		...(definicion.montaje ? { montajeComponente: leerMontajeDeclarado(definicion.montaje, definicion.dimensiones)! } : {}),
		...(definicion.carcasa ? { carcasaPersonalizada: leerCarcasaParametrica(definicion.carcasa)! } : {}),
		...(opciones.imagenResuelta ? { imagen: opciones.imagenResuelta } : {}),
	};
}

export function duplicarDefinicionComponente(
	original: DefinicionComponentePersonalizado,
	id: string,
	nombre: string,
	ahora = new Date().toISOString(),
): DefinicionComponentePersonalizado {
	const copia = clonar(original);
	return { ...copia, id, nombre: nombre.trim(), revision: 1, creadoEn: ahora, modificadoEn: ahora };
}

export function actualizarDefinicionComponente(
	original: DefinicionComponentePersonalizado,
	cambios: Omit<Partial<DefinicionComponentePersonalizado>, 'id' | 'revision' | 'creadoEn' | 'formato' | 'version'>,
	ahora = new Date().toISOString(),
): DefinicionComponentePersonalizado {
	const nueva = { ...clonar(original), ...clonar(cambios), revision: original.revision + 1, modificadoEn: ahora };
	const errores = validarDefinicionComponente(nueva);
	if (errores.length) throw new Error(`Componente inválido: ${errores.join('; ')}`);
	return nueva;
}

/** Un paquete V1 solo tiene un registro por identidad; dos revisiones requieren formato nuevo. */
export function revisionesRequeridasProyecto(proyecto: Proyecto): Map<string, number> {
	const requeridas = new Map<string, number>();
	for (const dispositivo of proyecto.dispositivos) {
		const origen = dispositivo.componentePersonalizado;
		if (!origen) continue;
		const previa = requeridas.get(origen.definicionId);
		if (previa !== undefined && previa !== origen.revision) {
			throw new Error(
				`El paquete portátil V1 no puede contener simultáneamente las revisiones ${previa} y `
				+ `${origen.revision} del componente ${origen.definicionId}. Hace falta el formato V2.`,
			);
		}
		requeridas.set(origen.definicionId, origen.revision);
	}
	return requeridas;
}

/** La procedencia física del proyecto fija una clave compuesta, nunca la definición vigente. */
export function revisionesRequeridasProyectoV2(
	proyecto: Proyecto,
): Map<string, { id: string; revision: number }> {
	const requeridas = new Map<string, { id: string; revision: number }>();
	for (const dispositivo of proyecto.dispositivos) {
		const origen = dispositivo.componentePersonalizado;
		if (!origen) continue;
		if (!origen.definicionId?.trim() || !Number.isInteger(origen.revision) || origen.revision < 1) {
			throw new Error(`Procedencia inválida del aparato ${dispositivo.id}.`);
		}
		const clave = JSON.stringify([origen.definicionId, origen.revision]);
		requeridas.set(clave, { id: origen.definicionId, revision: origen.revision });
	}
	return requeridas;
}

export function validarCierreComponentesProyecto(
	proyecto: Proyecto, componentes: readonly DefinicionComponentePersonalizado[],
	version: PaqueteProyectoPortatil['version'] = 1,
): void {
	if (version >= 2) {
		const requeridas = revisionesRequeridasProyectoV2(proyecto);
		const disponibles = new Set(componentes.map((componente) =>
			JSON.stringify([componente.id, componente.revision])));
		for (const [clave, { id, revision }] of requeridas) {
			if (!disponibles.has(clave)) {
				throw new Error(`El paquete no contiene la revisión ${revision} del componente ${id}; la procedencia no es verificable.`);
			}
		}
		for (const clave of disponibles) {
			if (!requeridas.has(clave)) throw new Error(`El paquete incluye una revisión de componente no utilizada: ${clave}.`);
		}
		return;
	}
	const requeridas = revisionesRequeridasProyecto(proyecto);
	const disponibles = new Map(componentes.map((componente) => [componente.id, componente]));
	for (const [id, revision] of requeridas) {
		const disponible = disponibles.get(id);
		if (!disponible || disponible.revision !== revision) {
			throw new Error(
				`El paquete no contiene la revisión ${revision} del componente ${id}; `
				+ 'la procedencia de la instancia no es verificable.',
			);
		}
	}
}

export function crearPaqueteProyecto(
	proyecto: Proyecto,
	assets: readonly AssetPortatil[],
	componentes: readonly DefinicionComponentePersonalizado[],
	version: PaqueteProyectoPortatil['version'] = 1,
): PaqueteProyectoPortatil {
	// Usa el mismo codec que cualquier archivo entrante; IndexedDB no convierte el proyecto en fiable.
	const carga = cargarProyecto(JSON.stringify(proyecto));
	if (carga.arreglos.length > 0) {
		throw new Error(`El proyecto del paquete requeriría reparaciones: ${carga.arreglos.join('; ')}`);
	}
	const validado = carga.proyecto;
	for (const [indice, componente] of componentes.entries()) {
		if (!componente || typeof componente !== 'object' || Array.isArray(componente)) {
			throw new Error(`Definición ${indice + 1} del paquete inválida.`);
		}
		let errores: string[];
		try { errores = validarDefinicionComponente(componente); }
		catch { throw new Error(`Definición ${indice + 1} del paquete incompleta o malformada.`); }
		if (errores.length) throw new Error(`«${componente.nombre}»: ${errores.join('; ')}`);
	}
	if (version < 3 && componentes.some((componente) => componente.fichaTecnica !== undefined)) {
		throw new Error('La ficha técnica de un componente requiere el paquete de proyecto V3.');
	}
	if (version < 4 && (componentes.some((componente) => componente.carcasa !== undefined)
		|| validado.dispositivos.some((dispositivo) => dispositivo.carcasaPersonalizada !== undefined))) {
		throw new Error('La carcasa paramétrica requiere el paquete de proyecto V4 para conservarse.');
	}
	validarCierreComponentesProyecto(validado, componentes, version);
	const idsComponentes = new Set<string>();
	for (const componente of componentes) {
		const clave = version === 1 ? componente.id : JSON.stringify([componente.id, componente.revision]);
		if (idsComponentes.has(clave)) throw new Error(`Componente repetido en el paquete: ${clave}`);
		idsComponentes.add(clave);
	}
	const idsAssets = new Set<string>();
	for (const asset of assets) {
		if (!/^sha256:[a-f\d]{64}$/i.test(asset.id) || !MIME_PORTATIL.has(asset.mime)
			|| !asset.base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) {
			throw new Error(`Asset portátil inválido: ${asset.id || '(sin id)'}`);
		}
		if (idsAssets.has(asset.id)) throw new Error(`Asset repetido en el paquete: ${asset.id}`);
		idsAssets.add(asset.id);
	}
	for (const componente of componentes) {
		if (!idsAssets.has(componente.assetId)) throw new Error(`Falta el asset ${componente.assetId} de «${componente.nombre}»`);
	}
	for (const dispositivo of validado.dispositivos) {
		if (dispositivo.assetId && !idsAssets.has(dispositivo.assetId)) {
			throw new Error(`Falta el asset ${dispositivo.assetId} usado por el aparato ${dispositivo.id}`);
		}
	}
	if (version >= 2) {
		const requeridos = new Set<string>();
		for (const componente of componentes) requeridos.add(componente.assetId);
		for (const dispositivo of validado.dispositivos) {
			if (dispositivo.assetId) requeridos.add(dispositivo.assetId);
		}
		for (const id of idsAssets) {
			if (!requeridos.has(id)) throw new Error(`El paquete incluye un asset no utilizado: ${id}.`);
		}
	}
	return { formato: 'tablero-studio-paquete', version, proyecto: validado, assets: clonar([...assets]), componentes: clonar([...componentes]) };
}

export function leerPaqueteProyecto(textoJson: string): PaqueteProyectoPortatil {
	if (textoJson.length > 64 * 1024 * 1024) throw new Error('El paquete supera el límite de 64 MiB de texto.');
	const bruto: unknown = JSON.parse(textoJson);
	if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new Error('El paquete no es un objeto.');
	const p = bruto as Partial<PaqueteProyectoPortatil>;
	if (p.formato !== 'tablero-studio-paquete' || (p.version !== 1 && p.version !== 2 && p.version !== 3 && p.version !== 4) || !p.proyecto
		|| !Array.isArray(p.assets) || !Array.isArray(p.componentes)) {
		throw new Error('El archivo no es un paquete portable de TableroStudio compatible.');
	}
	const resultado = crearPaqueteProyecto(p.proyecto, p.assets, p.componentes, p.version);
	validarAdopcionTecnica(resultado.proyecto);
	return resultado;
}
