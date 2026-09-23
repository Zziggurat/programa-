/** Lectura defensiva del dibujo M2. No modifica el grafo eléctrico ni crea vistas legacy. */
import type { Dispositivo, Hoja, RepresentacionEsquema } from './tipos.js';

type Avisar = (ruta: string, motivo: string) => void;
type Par = { entrada: string; salida: string };

const MAX_REPRESENTACIONES = 5000;
const MAX_PARES = 500;
const esObjeto = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const referenciaValida = (v: unknown): v is string =>
	typeof v === 'string' && v.trim().length > 0;
const idValido = (v: unknown): v is string => referenciaValida(v) && v.length <= 120;
const soloClaves = (o: Record<string, unknown>, claves: string[]): boolean =>
	Object.keys(o).every((clave) => claves.includes(clave));
const clavePar = (entrada: string, salida: string): string => JSON.stringify([entrada, salida]);

/** Solo los pares declarados por el perfil eléctrico son contactos dibujables como tales. */
function paresDelPerfil(d: Dispositivo): Par[] {
	const perfil = d.comportamiento;
	if (!perfil) return [];
	switch (perfil.clase) {
		case 'contactos-electromagneticos':
		case 'proteccion': return [...perfil.polos, ...perfil.contactos];
		case 'mando':
		case 'sensor': return perfil.contactos;
		case 'variador': return perfil.contactoFallo ? [perfil.contactoFallo] : [];
		default: return [];
	}
}

function leerUna(
	bruto: unknown,
	indice: number,
	dispositivos: Map<string, Dispositivo>,
	hojas: Map<string, number>,
	avisar: Avisar,
): RepresentacionEsquema | undefined {
	const ruta = `esquema.representaciones[${indice}]`;
	const rechazar = (motivo: string): undefined => { avisar(ruta, motivo); return undefined; };
	if (!esObjeto(bruto) || !soloClaves(bruto, ['id', 'dispositivoId', 'hojaId', 'posicion', 'parte'])) {
		return rechazar('la representación no tenía una forma reconocida');
	}
	if (!idValido(bruto.id) || !referenciaValida(bruto.dispositivoId) || !referenciaValida(bruto.hojaId)) {
		return rechazar('la representación necesitaba identificadores válidos');
	}
	const d = dispositivos.get(bruto.dispositivoId);
	if (!d) return rechazar('la representación apuntaba a un aparato inexistente');
	if (hojas.get(bruto.hojaId) !== 1) {
		return rechazar('la representación apuntaba a una hoja inexistente o ambigua');
	}
	const posicion = bruto.posicion;
	if (!esObjeto(posicion) || !soloClaves(posicion, ['columna', 'fila'])
		|| typeof posicion.columna !== 'number' || typeof posicion.fila !== 'number'
		|| !Number.isInteger(posicion.columna) || !Number.isInteger(posicion.fila)
		|| posicion.columna < 1 || posicion.columna > 1000 || posicion.fila < 1 || posicion.fila > 1000) {
		return rechazar('la posición local necesitaba columna y fila enteras positivas');
	}
	const parte = bruto.parte;
	if (!esObjeto(parte)) return rechazar('la parte gráfica no tenía una forma reconocida');
	if (parte.tipo === 'completa' && soloClaves(parte, ['tipo'])) {
		return {
			id: bruto.id, dispositivoId: d.id, hojaId: bruto.hojaId,
			posicion: { columna: posicion.columna, fila: posicion.fila }, parte: { tipo: 'completa' },
		};
	}
	if (parte.tipo === 'bobina' && soloClaves(parte, ['tipo'])) {
		const perfil = d.comportamiento;
		if (perfil?.clase !== 'contactos-electromagneticos') {
			return rechazar('la bobina no estaba declarada en un perfil eléctrico válido');
		}
		const ids = new Set(d.bornes.map((b) => b.id));
		if (!ids.has(perfil.bobina.entrada) || !ids.has(perfil.bobina.retorno)) {
			return rechazar('la bobina refería bornes inexistentes');
		}
		return {
			id: bruto.id, dispositivoId: d.id, hojaId: bruto.hojaId,
			posicion: { columna: posicion.columna, fila: posicion.fila }, parte: { tipo: 'bobina' },
		};
	}
	if (parte.tipo !== 'contactos' || !soloClaves(parte, ['tipo', 'pares'])
		|| !Array.isArray(parte.pares) || parte.pares.length < 1 || parte.pares.length > MAX_PARES) {
		return rechazar('la parte de contactos necesitaba pares declarados y acotados');
	}
	const perfil = paresDelPerfil(d);
	const cuentas = new Map<string, number>();
	for (const par of perfil) {
		const clave = clavePar(par.entrada, par.salida);
		cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1);
	}
	const ids = new Set(d.bornes.map((b) => b.id));
	const vistos = new Set<string>();
	const bornesEnVista = new Set<string>();
	const pares: Par[] = [];
	for (const par of parte.pares) {
		if (!esObjeto(par) || !soloClaves(par, ['entrada', 'salida'])
			|| !referenciaValida(par.entrada) || !referenciaValida(par.salida) || par.entrada === par.salida) {
			return rechazar('un par de contacto no tenía dos IDs de borne válidos');
		}
		if (!ids.has(par.entrada) || !ids.has(par.salida)) {
			return rechazar('un par de contacto refería bornes inexistentes');
		}
		const clave = clavePar(par.entrada, par.salida);
		if (cuentas.get(clave) !== 1) {
			return rechazar('un par de contacto no existía de forma unívoca en el perfil eléctrico');
		}
		if (vistos.has(clave)) return rechazar('un par de contacto estaba repetido');
		if (bornesEnVista.has(par.entrada) || bornesEnVista.has(par.salida)) {
			return rechazar('un borne compartido entre contactos requería un anclaje gráfico único');
		}
		vistos.add(clave);
		bornesEnVista.add(par.entrada);
		bornesEnVista.add(par.salida);
		pares.push({ entrada: par.entrada, salida: par.salida });
	}
	return {
		id: bruto.id, dispositivoId: d.id, hojaId: bruto.hojaId,
		posicion: { columna: posicion.columna, fila: posicion.fila }, parte: { tipo: 'contactos', pares },
	};
}

/** Puertos que una representación podrá exponer; los anclajes duplicados son ambiguos. */
function bornesRepresentados(r: RepresentacionEsquema, d: Dispositivo): string[] {
	switch (r.parte.tipo) {
		case 'completa': return d.bornes.map((b) => b.id);
		case 'bobina': {
			const perfil = d.comportamiento;
			return perfil?.clase === 'contactos-electromagneticos'
				? [perfil.bobina.entrada, perfil.bobina.retorno] : [];
		}
		case 'contactos': return r.parte.pares.flatMap((p) => [p.entrada, p.salida]);
	}
}

/**
 * `undefined` conserva el adaptador legacy; incluso una lista inválida presente se convierte en
 * `[]` con diagnóstico, para no regenerar símbolos que la persona pudo haber borrado.
 */
export function leerRepresentacionesEsquema(
	bruto: unknown,
	aparatos: Dispositivo[],
	folios: Hoja[],
	avisar: Avisar,
): RepresentacionEsquema[] | undefined {
	if (bruto === undefined) return undefined;
	if (!Array.isArray(bruto)) {
		avisar('esquema.representaciones', 'las representaciones debían ser una lista');
		return [];
	}
	if (bruto.length > MAX_REPRESENTACIONES) {
		avisar('esquema.representaciones', 'se recortó la lista de representaciones al máximo admitido');
	}
	const dispositivos = new Map(aparatos.map((d) => [d.id, d]));
	const hojas = new Map<string, number>();
	for (const h of folios) hojas.set(h.id, (hojas.get(h.id) ?? 0) + 1);
	const candidatas: { indice: number; vista: RepresentacionEsquema }[] = [];
	for (const [indice, item] of bruto.slice(0, MAX_REPRESENTACIONES).entries()) {
		const vista = leerUna(item, indice, dispositivos, hojas, avisar);
		if (vista) candidatas.push({ indice, vista });
	}

	// Rechazar TODOS los duplicados, no elegir «el primero»: invertir el archivo no cambia el resultado.
	const porId = new Map<string, number[]>();
	for (const { indice, vista } of candidatas) {
		const indices = porId.get(vista.id) ?? [];
		indices.push(indice);
		porId.set(vista.id, indices);
	}
	const conflictos = new Map<number, Set<string>>();
	const marcar = (indice: number, motivo: string): void => {
		const motivos = conflictos.get(indice) ?? new Set<string>();
		motivos.add(motivo);
		conflictos.set(indice, motivos);
	};
	for (const indices of porId.values()) {
		if (indices.length > 1) for (const indice of indices) marcar(indice, 'el ID gráfico estaba repetido');
	}
	const puertos = new Map<string, number[]>();
	for (const { indice, vista } of candidatas) {
		if (conflictos.has(indice)) continue;
		const d = dispositivos.get(vista.dispositivoId)!;
		for (const borneId of new Set(bornesRepresentados(vista, d))) {
			const clave = JSON.stringify([vista.dispositivoId, borneId]);
			const indices = puertos.get(clave) ?? [];
			indices.push(indice);
			puertos.set(clave, indices);
		}
	}
	for (const indices of puertos.values()) {
		if (indices.length > 1) for (const indice of indices) {
			marcar(indice, 'un borne estaba dibujado en varias vistas conectables');
		}
	}
	for (const { indice } of candidatas) {
		const motivos = conflictos.get(indice);
		if (motivos) avisar(`esquema.representaciones[${indice}]`, [...motivos].join('; '));
	}
	return candidatas.filter(({ indice }) => !conflictos.has(indice)).map(({ vista }) => vista);
}
