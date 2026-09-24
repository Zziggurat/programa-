/** DOC-03: diferencias del diseño persistente entre dos revisiones del MISMO proyecto.
 * La identidad del documento y la integridad de ambas copias corresponden al repositorio.
 * Este motor no compara resultados calculados ni convierte una ruta AUTO en ruta declarada. */
import type { Conductor, Dispositivo, Proyecto, RefBorne } from '../modelo/tipos.js';
import { contenidoCanonicoRevision, jsonCanonico } from '../datos-tecnicos/hash.js';
import { claveRevision, referenciaTecnica, type InstalacionConductorTecnica,
	type RevisionTecnica } from '../datos-tecnicos/tipos.js';

export type CategoriaCambioRevision = 'APARATO' | 'CONEXION' | 'SECCION' | 'PROTECCION'
	| 'DATOS_TECNICOS' | 'RUTA' | 'CRITERIO';

export interface CambioRevision {
	categoria: CategoriaCambioRevision;
	entidadId: string;
	campo: string;
	operacion: 'AGREGADO' | 'ELIMINADO' | 'MODIFICADO';
	/** JSON canónico o «(ausente)»; la presentación HTML debe escaparlo como texto. */
	antes: string;
	despues: string;
}

export interface RutaNoEvaluable {
	conductorId: string;
	motivo: 'AUTO_NO_PERSISTIDA' | 'CONTEXTO_FISICO_CAMBIO';
}

export interface DiferenciaRevisionProyecto {
	cambios: CambioRevision[];
	/** No son cambios de ruta: falta el recorrido AUTO anterior y/o actual. */
	rutasNoEvaluables: RutaNoEvaluable[];
}

/** Contrato compacto para UI/documentación. `detalle` es texto, nunca HTML confiable. */
export interface ResultadoDiferenciaRevision {
	cambios: { categoria: CategoriaCambioRevision; entidadId: string;
		tipo: CambioRevision['operacion']; detalle: string }[];
	limitaciones: string[];
}

const serializar = (valor: unknown): string => valor === undefined ? '(ausente)' : jsonCanonico(valor);
const ordenar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function indexar<T>(elementos: readonly T[], clave: (elemento: T) => string, tipo: string): Map<string, T> {
	const resultado = new Map<string, T>();
	for (const elemento of elementos) {
		const id = clave(elemento);
		if (resultado.has(id)) throw new Error(`DOC-03: ${tipo} duplicado (${id}); la diferencia sería ambigua.`);
		resultado.set(id, elemento);
	}
	return resultado;
}

function claves<T, U>(antes: Map<string, T>, despues: Map<string, U>): string[] {
	return [...new Set([...antes.keys(), ...despues.keys()])].sort(ordenar);
}

function extremos(c: Pick<Conductor, 'de' | 'a'>): string[] {
	const borne = (r: RefBorne) => JSON.stringify([r.dispositivoId, r.borneId]);
	// La inversión de «de/a» no cambia la conectividad eléctrica del mismo conductor.
	return [borne(c.de), borne(c.a)].sort(ordenar);
}

function resumenAparato(d: Dispositivo): unknown {
	return { id: d.id, tipo: d.tipo, designacion: d.designacion,
		bornes: [...d.bornes].map((b) => b.id).sort(ordenar),
		componentePersonalizado: d.componentePersonalizado };
}

function resumenConductor(c: Conductor): unknown {
	return { id: c.id, extremos: extremos(c), seccionMm2: c.seccion, numero: c.numero,
		clase: c.clase, estadoRutaFisica: c.estadoRutaFisica,
		trazado: c.trazado };
}

const tiposProteccion = new Set<Dispositivo['tipo']>([
	'disyuntor', 'guardamotor', 'diferencial', 'fusible', 'seccionador',
]);
const esProteccion = (d: Dispositivo): boolean => tiposProteccion.has(d.tipo)
	|| d.comportamiento?.clase === 'proteccion';

function perfilProteccion(d: Dispositivo): unknown {
	const comportamiento = d.comportamiento?.clase === 'proteccion' ? {
		...d.comportamiento,
		polos: [...d.comportamiento.polos].sort((a, b) => ordenar(serializar(a), serializar(b))),
		contactos: [...d.comportamiento.contactos].sort((a, b) => ordenar(serializar(a), serializar(b))),
	} : undefined;
	return { comportamiento,
		corrienteNominal: d.corrienteNominal, polos: d.polos, curvaDisparo: d.curvaDisparo,
		poderCorteKA: d.poderCorteKA, poderCorteEstimado: d.poderCorteEstimado,
		sensibilidadMA: d.sensibilidadMA, claseDiferencial: d.claseDiferencial,
		rangoRegulacionA: d.rangoRegulacionA,
		fisica: { proteccion: d.fisica?.proteccion, diferencial: d.fisica?.diferencial } };
}

function datosAparato(d: Dispositivo): unknown {
	const { proteccion: _proteccion, diferencial: _diferencial, ...otraFisica } = d.fisica ?? {};
	return { fabricante: d.fabricante, referencia: d.referencia,
		tensionNominal: d.tensionNominal,
		// Los valores de placa de una protección se informan en PROTECCION una sola vez.
		...(esProteccion(d) ? {} : { corrienteNominal: d.corrienteNominal, polos: d.polos }),
		fisica: Object.keys(otraFisica).length ? otraFisica : undefined };
}

function contextoFisicoRuta(p: Proyecto): unknown {
	const g = p.gabinete;
	return {
		gabinete: g && { ancho: g.ancho, alto: g.alto, caja: g.caja, mazoPuerta: g.mazoPuerta,
			canaletas: [...g.canaletas].sort((a, b) => ordenar(a.id, b.id)),
			rieles: [...g.rieles].sort((a, b) => ordenar(a.id, b.id)),
			entradas: [...(g.entradas ?? [])].sort((a, b) => ordenar(a.id, b.id)),
			colocaciones: [...g.colocaciones].sort((a, b) => ordenar(a.dispositivoId, b.dispositivoId)) },
		anclajes: [...p.dispositivos].map((d) => ({ id: d.id, tipo: d.tipo,
			bornes: [...d.bornes].sort((a, b) => ordenar(a.id, b.id)),
			terminales: d.terminales, campo: d.campo, profundidad: d.profundidad,
			componentePersonalizado: d.componentePersonalizado,
			carcasaPersonalizada: d.carcasaPersonalizada }))
			.sort((a, b) => ordenar(a.id, b.id)),
	};
}

/** Compara decisiones declaradas, no los resultados del motor o de la simulación. */
export function compararRevisionesProyecto(antes: Proyecto, despues: Proyecto): DiferenciaRevisionProyecto {
	const cambios: CambioRevision[] = [];
	const agregar = (categoria: CategoriaCambioRevision, entidadId: string, campo: string,
		anterior: unknown, actual: unknown): void => {
		const a = serializar(anterior), b = serializar(actual);
		if (a !== b) cambios.push({ categoria, entidadId, campo,
			operacion: anterior === undefined ? 'AGREGADO' : actual === undefined ? 'ELIMINADO' : 'MODIFICADO',
			antes: a, despues: b });
	};
	const dispositivosAntes = indexar(antes.dispositivos, (d) => d.id, 'aparato');
	const dispositivosDespues = indexar(despues.dispositivos, (d) => d.id, 'aparato');
	for (const id of claves(dispositivosAntes, dispositivosDespues)) {
		const a = dispositivosAntes.get(id), b = dispositivosDespues.get(id);
		if (!a || !b) { agregar('APARATO', id, 'identidad', a && resumenAparato(a), b && resumenAparato(b)); continue; }
		agregar('APARATO', id, 'tipo', a.tipo, b.tipo);
		const identificacion = (d: Dispositivo) => ({ numero: d.numero, designacion: d.designacion,
			clase: d.clase, funcion: d.funcion, ubicacion: d.ubicacion,
			descripcion: d.descripcion, rol: d.rol });
		agregar('APARATO', id, 'identificacion', identificacion(a), identificacion(b));
		agregar('APARATO', id, 'bornes', [...a.bornes].sort((x, y) => ordenar(x.id, y.id)),
			[...b.bornes].sort((x, y) => ordenar(x.id, y.id)));
		agregar('APARATO', id, 'componentePersonalizado', a.componentePersonalizado, b.componentePersonalizado);
		if (!esProteccion(a) || !esProteccion(b)) agregar('APARATO', id, 'comportamiento',
			a.comportamiento, b.comportamiento);
		if (esProteccion(a) || esProteccion(b)) agregar('PROTECCION', id, 'perfilYCalibre',
			perfilProteccion(a), perfilProteccion(b));
		agregar('DATOS_TECNICOS', id, 'placaYFisica', datosAparato(a), datosAparato(b));
	}

	const conductoresAntes = indexar(antes.conductores, (c) => c.id, 'conductor');
	const conductoresDespues = indexar(despues.conductores, (c) => c.id, 'conductor');
	for (const id of claves(conductoresAntes, conductoresDespues)) {
		const a = conductoresAntes.get(id), b = conductoresDespues.get(id);
		if (!a || !b) { agregar('CONEXION', id, 'identidad', a && resumenConductor(a), b && resumenConductor(b)); continue; }
		agregar('CONEXION', id, 'extremos', extremos(a), extremos(b));
		agregar('CONEXION', id, 'numero', a.numero, b.numero);
		agregar('SECCION', id, 'seccionMm2', a.seccion, b.seccion);
		agregar('DATOS_TECNICOS', id, 'fisicaYColor',
			{ fisica: a.fisica, color: a.color }, { fisica: b.fisica, color: b.color });
		agregar('RUTA', id, 'estadoYClase',
			{ estado: a.estadoRutaFisica, clase: a.clase },
			{ estado: b.estadoRutaFisica, clase: b.clase });
		// Un punto de paso es una decisión ordenada: aquí el orden de los puntos SÍ importa.
		agregar('RUTA', id, 'trazadoDeclarado', a.trazado, b.trazado);
	}

	const tecnicoAntes = antes.datosTecnicos, tecnicoDespues = despues.datosTecnicos;
	const revisionesA = indexar(tecnicoAntes?.revisiones ?? [], (r) => claveRevision(referenciaTecnica(r)), 'revisión técnica');
	const revisionesB = indexar(tecnicoDespues?.revisiones ?? [], (r) => claveRevision(referenciaTecnica(r)), 'revisión técnica');
	const revisionComparable = (r: RevisionTecnica | undefined): unknown => r && ({
		referencia: referenciaTecnica(r), contenidoCanonico: contenidoCanonicoRevision(r),
	});
	for (const id of claves(revisionesA, revisionesB)) agregar('DATOS_TECNICOS', id, 'revisionCongelada',
		revisionComparable(revisionesA.get(id)), revisionComparable(revisionesB.get(id)));
	const vinculosA = indexar(tecnicoAntes?.vinculos ?? [], (v) => JSON.stringify([v.entidad, v.entidadId]), 'vínculo técnico');
	const vinculosB = indexar(tecnicoDespues?.vinculos ?? [], (v) => JSON.stringify([v.entidad, v.entidadId]), 'vínculo técnico');
	for (const id of claves(vinculosA, vinculosB)) agregar('DATOS_TECNICOS', id, 'vinculo',
		vinculosA.get(id), vinculosB.get(id));
	const instalacionesA = indexar(tecnicoAntes?.instalaciones ?? [], (i) => i.conductorId, 'instalación de conductor');
	const instalacionesB = indexar(tecnicoDespues?.instalaciones ?? [], (i) => i.conductorId, 'instalación de conductor');
	const instalacionComparable = (i: InstalacionConductorTecnica | undefined) =>
		i && ({ ...i, factores: [...i.factores].sort(ordenar) });
	for (const id of claves(instalacionesA, instalacionesB)) agregar('DATOS_TECNICOS', id, 'instalacion',
		instalacionComparable(instalacionesA.get(id)), instalacionComparable(instalacionesB.get(id)));
	const prospectiva = (p: Proyecto) => (p.datosTecnicos?.prospectiva ?? [])
		.map((x) => serializar(x)).sort(ordenar);
	agregar('DATOS_TECNICOS', 'proyecto', 'prospectiva', prospectiva(antes), prospectiva(despues));
	agregar('DATOS_TECNICOS', 'proyecto', 'opciones', antes.opciones, despues.opciones);
	agregar('CRITERIO', 'proyecto', 'ingenieria', antes.ingenieria?.criterios, despues.ingenieria?.criterios);
	agregar('CRITERIO', 'proyecto', 'tecnico',
		{ referencia: tecnicoAntes?.criterios, overrides: tecnicoAntes?.overridesCriterios },
		{ referencia: tecnicoDespues?.criterios, overrides: tecnicoDespues?.overridesCriterios });
	const circuitosA = antes.ingenieria?.circuitos ?? {}, circuitosB = despues.ingenieria?.circuitos ?? {};
	const criterioCircuito = (c: (typeof circuitosA)[string] | undefined) => c && ({ ...c,
		conductoresReasignablesFase: c.conductoresReasignablesFase
			? [...c.conductoresReasignablesFase].sort(ordenar) : undefined });
	for (const id of [...new Set([...Object.keys(circuitosA), ...Object.keys(circuitosB)])].sort(ordenar))
		agregar('CRITERIO', id, 'circuitoIngenieria', criterioCircuito(circuitosA[id]),
			criterioCircuito(circuitosB[id]));
	const criteriosTecnicosA = tecnicoAntes?.criteriosCircuito ?? {}, criteriosTecnicosB = tecnicoDespues?.criteriosCircuito ?? {};
	for (const id of [...new Set([...Object.keys(criteriosTecnicosA), ...Object.keys(criteriosTecnicosB)])].sort(ordenar))
		agregar('CRITERIO', id, 'circuitoTecnico', criteriosTecnicosA[id], criteriosTecnicosB[id]);
	const decisiones = (p: Proyecto) => (p.ingenieria?.disenoAsistido?.decisiones ?? [])
		.map((d) => serializar({ ...d, cambios: [...d.cambios]
			.sort((a, b) => ordenar(serializar(a), serializar(b))) })).sort(ordenar);
	agregar('CRITERIO', 'proyecto', 'decisionesV9Historicas', decisiones(antes), decisiones(despues));

	const contextoCambio = serializar(contextoFisicoRuta(antes)) !== serializar(contextoFisicoRuta(despues));
	const rutasNoEvaluables: RutaNoEvaluable[] = [];
	for (const id of claves(conductoresAntes, conductoresDespues)) {
		const a = conductoresAntes.get(id), b = conductoresDespues.get(id);
		if (!a || !b) continue;
		if ((a.estadoRutaFisica !== 'pendiente' && !a.trazado?.length)
			|| (b.estadoRutaFisica !== 'pendiente' && !b.trazado?.length)) {
			rutasNoEvaluables.push({ conductorId: id,
				motivo: contextoCambio ? 'CONTEXTO_FISICO_CAMBIO' : 'AUTO_NO_PERSISTIDA' });
		}
	}
	cambios.sort((a, b) => ordenar(a.categoria, b.categoria) || ordenar(a.entidadId, b.entidadId)
		|| ordenar(a.campo, b.campo));
	return { cambios, rutasNoEvaluables };
}

/** Vista breve para una revisión de cambios; no inventa diferencias de geometría AUTO. */
export function compararRevisiones(base: Proyecto, actual: Proyecto): ResultadoDiferenciaRevision {
	const resultado = compararRevisionesProyecto(base, actual);
	const cambiaronContexto = resultado.rutasNoEvaluables.filter((r) =>
		r.motivo === 'CONTEXTO_FISICO_CAMBIO').length;
	const limitaciones = resultado.rutasNoEvaluables.length ? [
		`El recorrido AUTO de ${resultado.rutasNoEvaluables.length} conductor(es) no está persistido; `
		+ 'esta comparación cubre conexiones y rutas declaradas, no la geometría generada.',
		...(cambiaronContexto ? [
			`Cambió el contexto físico del gabinete o los anclajes: ${cambiaronContexto} ruta(s) AUTO `
			+ 'deben recalcularse y revisarse antes de afirmar su trazado o longitud.',
		] : []),
	] : [];
	return { cambios: resultado.cambios.map((c) => ({ categoria: c.categoria,
		entidadId: c.entidadId, tipo: c.operacion,
		detalle: `${c.campo}: ${c.antes} → ${c.despues}` })), limitaciones };
}
