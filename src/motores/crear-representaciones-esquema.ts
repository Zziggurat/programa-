/** Planes puros para pasar del dibujo legacy a vistas M2 y desdoblar un aparato. */
import { esReferenciaVisualInerte } from '../modelo/apariencia.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import { leerRepresentacionesEsquema } from '../modelo/representaciones-esquema.js';
import type {
	Dispositivo, Hoja, ParteRepresentacionEsquema, Proyecto, RepresentacionEsquema,
} from '../modelo/tipos.js';
import type { ResultadoPotenciales } from './potenciales.js';
import { FILAS_ESQ, filaDeAltura, montarEsquema } from './esquema.js';

export type Plan<T> = { ok: true; valor: T } | { ok: false; motivo: string };
const error = (motivo: string): Plan<never> => ({ ok: false, motivo });

export interface ActivacionRepresentaciones {
	hojas: Hoja[];
	representaciones: RepresentacionEsquema[];
	/** Solo las hojas que contenían el esquema legacy; las demás se conservan. */
	foliosVisibles: { id: string; numero: number; titulo: string; columnas: number;
		tituloLegacy: string; columnasLegacy: number; simbolos: number; nueva: boolean }[];
	hojasConservadasSinDibujo: number;
}

function idLibre(prefijo: string, ocupados: Set<string>): string {
	let numero = 1;
	while (ocupados.has(`${prefijo}-${numero}`)) numero++;
	const id = `${prefijo}-${numero}`;
	ocupados.add(id);
	return id;
}

/** La activación es todo-o-nada: jamás se pierde un símbolo o una conexión al optar por M2. */
export function planActivacionRepresentaciones(
	proyecto: Proyecto, potenciales: ResultadoPotenciales,
): Plan<ActivacionRepresentaciones> {
	if (proyecto.esquema?.representaciones !== undefined) {
		return error('Las vistas M2 ya están activadas; una lista vacía también es una decisión del proyecto.');
	}
	const aparatos = proyecto.dispositivos.filter((d) => !esReferenciaVisualInerte(d));
	const ids = new Set(aparatos.map((d) => d.id));
	if (ids.size !== aparatos.length) return error('Hay IDs de aparato repetidos; no se puede asignar una vista inequívoca.');
	if (aparatos.some((d) => new Set(d.bornes.map((b) => b.id)).size !== d.bornes.length)) {
		return error('Hay bornes repetidos en un aparato; no se puede asignar un anclaje inequívoco.');
	}
	const idsHojas = new Set(proyecto.hojas.map((h) => h.id));
	const numerosHojas = new Set(proyecto.hojas.map((h) => h.numero));
	if (idsHojas.size !== proyecto.hojas.length || numerosHojas.size !== proyecto.hojas.length) {
		return error('Hay IDs o números de hoja repetidos; corrige las hojas antes de activar vistas M2.');
	}
	const legacy = montarEsquema(proyecto, potenciales);
	const simbolos = legacy.flatMap((h) => h.simbolos);
	if (simbolos.length === 0) return error('El esquema no tiene símbolos que convertir.');
	if (simbolos.length !== aparatos.length || new Set(simbolos.map((s) => s.dispositivoId)).size !== aparatos.length
		|| simbolos.some((s) => !ids.has(s.dispositivoId))) {
		return error('El dibujo legacy no contiene exactamente una vista por cada aparato esquemático.');
	}
	const simboloPorAparato = new Map(simbolos.map((s) => [s.dispositivoId, s]));
	for (const c of proyecto.conductores) {
		for (const extremo of [c.de, c.a]) {
			const d = proyecto.dispositivos.find((item) => item.id === extremo.dispositivoId);
			if (d && !esReferenciaVisualInerte(d) && !simboloPorAparato.get(d.id)?.pines.has(extremo.borneId)) {
				return error(`El conductor ${c.id} usa ${d.id}:${extremo.borneId}, sin anclaje visible en el esquema legacy.`);
			}
		}
	}
	if (simbolos.length > 5000) return error('El esquema excede el máximo de 5000 vistas M2.');

	const hojas = proyecto.hojas.map((h) => ({ ...h }));
	const ocupadas = new Set(idsHojas);
	const foliosVisibles: ActivacionRepresentaciones['foliosVisibles'] = [];
	const representaciones: RepresentacionEsquema[] = [];
	for (const pagina of legacy) {
		let folio = hojas.find((h) => h.numero === pagina.numero);
		const nueva = !folio;
		if (!folio) {
			folio = { id: idLibre('hoja-m2', ocupadas), numero: pagina.numero,
				titulo: pagina.titulo, columnas: pagina.columnas };
			hojas.push(folio);
		}
		// La hoja existente manda: el esquema legacy no tenía autoridad sobre sus metadatos.
		const columnas = Math.max(4, Math.min(20, folio.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10));
		if (pagina.simbolos.some((s) => s.columna > columnas)) {
			return error(`La hoja existente ${folio.numero} «${folio.titulo}» tiene ${columnas} columnas; `
				+ 'algún símbolo legacy no cabría. Amplía la hoja antes de activar vistas M2.');
		}
		foliosVisibles.push({ id: folio.id, numero: folio.numero, titulo: folio.titulo,
			columnas, tituloLegacy: pagina.titulo, columnasLegacy: pagina.columnas,
			simbolos: pagina.simbolos.length, nueva });
		for (const simbolo of pagina.simbolos) {
			representaciones.push({
				id: `vista-m2-${representaciones.length + 1}`, dispositivoId: simbolo.dispositivoId,
				hojaId: folio.id, posicion: {
					columna: simbolo.columna,
					fila: filaDeAltura(simbolo.y + simbolo.alto / 2),
				}, parte: { tipo: 'completa' },
			});
		}
	}
	const avisos: string[] = [];
	const leidas = leerRepresentacionesEsquema(representaciones, proyecto.dispositivos, hojas,
		(ruta, motivo) => avisos.push(`${ruta}: ${motivo}`));
	if (avisos.length || leidas?.length !== representaciones.length) {
		return error(`La conversión no pasó la validación completa: ${avisos[0] ?? 'faltan vistas'}.`);
	}
	const candidato: Proyecto = { ...proyecto, hojas,
		esquema: { ...proyecto.esquema, representaciones } };
	const convertido = montarEsquema(candidato, potenciales);
	if (convertido.flatMap((h) => h.simbolos).length !== simbolos.length) {
		return error('El dibujo M2 no conservaría todos los símbolos legacy.');
	}
	const problema = convertido.flatMap((h) => h.problemas ?? []).find((p) =>
		p.codigo === 'representacion-invalida' || p.codigo === 'conexion-sin-ancla'
		|| p.codigo === 'posicion-fuera-de-hoja');
	if (problema) return error(`La conversión dejaría una conexión o vista ambigua: ${problema.mensaje}`);
	return { ok: true, valor: { hojas, representaciones, foliosVisibles,
		hojasConservadasSinDibujo: hojas.length - foliosVisibles.length } };
}

export type FuncionDesdoblada = 'bobina' | 'polos' | 'auxiliares';
export interface ParteDesdoblada {
	funcion: FuncionDesdoblada;
	parte: ParteRepresentacionEsquema;
	bornes: string[];
}
export interface PosicionVista { hojaId: string; columna: number; fila: number }
export type DestinosDesdoblamiento = Partial<Record<FuncionDesdoblada, PosicionVista>>;

function partesDePerfil(d: Dispositivo): Plan<ParteDesdoblada[]> {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase !== 'contactos-electromagneticos') {
		return error('Este aparato no declara bobina, polos y auxiliares en un perfil electromagnético.');
	}
	const polos = [...perfil.polos, ...perfil.contactos.filter((c) => c.funcion === 'potencia')];
	const auxiliares = perfil.contactos.filter((c) => c.funcion === 'auxiliar');
	const partes: ParteDesdoblada[] = [
		{ funcion: 'bobina', parte: { tipo: 'bobina' },
			bornes: [perfil.bobina.entrada, perfil.bobina.retorno] },
	];
	for (const [funcion, pares] of [
		['polos', polos], ['auxiliares', auxiliares],
	] as const) {
		if (pares.length) partes.push({ funcion,
			parte: { tipo: 'contactos', pares: pares.map((p) => ({ entrada: p.entrada, salida: p.salida })) },
			bornes: pares.flatMap((p) => [p.entrada, p.salida]) });
	}
	const ids = d.bornes.map((b) => b.id);
	const vistos = partes.flatMap((p) => p.bornes);
	if (new Set(ids).size !== ids.length || new Set(vistos).size !== vistos.length
		|| ids.length !== vistos.length || ids.some((id) => !vistos.includes(id))) {
		return error('El perfil no cubre los bornes una sola vez; desdoblar ocultaría puertos o duplicaría anclajes.');
	}
	if (partes.some((p) => p.parte.tipo === 'contactos' && p.parte.pares.length > 500)) {
		return error('El grupo de contactos supera el límite de vistas M2.');
	}
	return { ok: true, valor: partes };
}

export function planPartesDesdoblamiento(
	proyecto: Proyecto, vistaId: string,
): Plan<{ origen: RepresentacionEsquema; partes: ParteDesdoblada[] }> {
	const lista = proyecto.esquema?.representaciones;
	const origen = lista?.find((r) => r.id === vistaId);
	if (!origen || origen.parte.tipo !== 'completa') {
		return error('Selecciona una vista completa M2 para desdoblarla.');
	}
	if (lista?.filter((r) => r.dispositivoId === origen.dispositivoId).length !== 1) {
		return error('El aparato ya tiene otras vistas; no se puede duplicar un borne.');
	}
	const d = proyecto.dispositivos.find((item) => item.id === origen.dispositivoId);
	if (!d) return error('El aparato de esta vista ya no existe.');
	const partes = partesDePerfil(d);
	return partes.ok ? { ok: true, valor: { origen, partes: partes.valor } } : partes;
}

/** Construye el reemplazo completo sin tocar dispositivo, cables ni otras representaciones. */
export function planDesdoblamientoRepresentacion(
	proyecto: Proyecto, vistaId: string, destinos: DestinosDesdoblamiento,
): Plan<RepresentacionEsquema[]> {
	const base = planPartesDesdoblamiento(proyecto, vistaId);
	if (!base.ok) return base;
	const { origen, partes } = base.valor;
	const ocupados = new Set(proyecto.esquema?.representaciones?.map((r) => r.id));
	const casillas = new Set((proyecto.esquema?.representaciones ?? [])
		.filter((r) => r !== origen)
		.map((r) => JSON.stringify([r.hojaId, r.posicion.columna, r.posicion.fila])));
	const nuevas: RepresentacionEsquema[] = [];
	for (const parte of partes) {
		const p = destinos[parte.funcion];
		const hoja = proyecto.hojas.find((h) => h.id === p?.hojaId);
		if (!p || !hoja || proyecto.hojas.filter((h) => h.id === p.hojaId).length !== 1) {
			return error(`Elige una hoja existente y única para ${parte.funcion}.`);
		}
		const columnas = Math.max(4, Math.min(20, hoja.columnas ?? proyecto.esquema?.columnasPorHoja ?? 10));
		if (!Number.isInteger(p.columna) || p.columna < 1 || p.columna > columnas
			|| !Number.isInteger(p.fila) || p.fila < 1 || p.fila > FILAS_ESQ) {
			return error(`La posición de ${parte.funcion} debe caber en ${hoja.titulo} (${columnas}×${FILAS_ESQ}).`);
		}
		const casilla = JSON.stringify([p.hojaId, p.columna, p.fila]);
		if (casillas.has(casilla)) return error(`La casilla ${p.columna}.${p.fila} de ${hoja.titulo} ya tiene otra vista.`);
		casillas.add(casilla);
		nuevas.push({ id: idLibre('vista-m2', ocupados), dispositivoId: origen.dispositivoId,
			hojaId: p.hojaId, posicion: { columna: p.columna, fila: p.fila }, parte: parte.parte });
	}
	const candidato = (proyecto.esquema?.representaciones ?? []).filter((r) => r !== origen).concat(nuevas);
	const avisos: string[] = [];
	const leidas = leerRepresentacionesEsquema(candidato, proyecto.dispositivos, proyecto.hojas,
		(ruta, motivo) => avisos.push(`${ruta}: ${motivo}`));
	if (avisos.length || leidas?.length !== candidato.length) {
		return error(`El desdoblamiento no pasó la validación: ${avisos[0] ?? 'faltan vistas'}.`);
	}
	return { ok: true, valor: nuevas };
}
