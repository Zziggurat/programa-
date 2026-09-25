/**
 * Preparación, no aplicación, de una revisión nueva de una definición personal.
 * La biblioteca nunca modifica instancias colocadas: el editor debe presentar el impacto y
 * guardar `candidato` solo después de una confirmación explícita. Cancelar = desecharlo.
 */
import type { Borne, Dispositivo, Proyecto, RefBorne } from '../modelo/tipos.js';
import {
	instanciarComponentePersonalizado, validarDefinicionComponente,
	type DefinicionComponentePersonalizado,
} from './personalizados.js';
import { evaluarCompatibilidadMontaje, type EstadoCompatibilidadMontaje } from './montaje.js';

export interface ImpactoAdopcionComponente {
	dispositivoId: string;
	definicionId: string;
	revisionAnterior: number;
	revisionNueva: number;
	conductoresAfectados: string[];
	puertosAfectados: { anterior: string; nuevo: string; conexiones: number }[];
	puertosRetirados: string[];
	puertosAnadidos: string[];
	cambiaPerfil: boolean;
	cambiaTipo: boolean;
	cambiaImagen: boolean;
	cambiaEnvolvente: boolean;
	estadoMontaje: EstadoCompatibilidadMontaje | 'SIN_COLOCACION';
	/** La candidata no contiene la URL runtime del asset nuevo. Resolverla antes de repintar. */
	requiereHidratarAsset: boolean;
	requiereRevisionTecnica: boolean;
	requiereRevisionDeRuta: boolean;
}

export interface PreparacionAdopcionComponente {
	candidato: Proyecto;
	impacto: ImpactoAdopcionComponente;
}

function referenciaDelDispositivo(ref: RefBorne, dispositivoId: string): boolean {
	return ref.dispositivoId === dispositivoId;
}

function solapan(
	a: { x: number; y: number; ancho: number; alto: number },
	b: { x: number; y: number; ancho: number; alto: number },
): boolean {
	return a.x < b.x + b.ancho && a.x + a.ancho > b.x
		&& a.y < b.y + b.alto && a.y + a.alto > b.y;
}

/**
 * Los mapas son explícitos para los puertos usados. Una misma borna antigua puede conservar
 * su ID, pero también debe figurar en el mapa: así el cambio nunca depende de coincidencias
 * casuales de rótulo. El mapeo de puertos no usados es opcional; pueden desaparecer.
 *
 * Alcance de referencias tipadas del Proyecto: extremos de conductores y ensayos prospectivos
 * (`borneId`), además de puentes y bloques de terminales (`string[]`). Las decisiones de una
 * ficha técnica usan `campo@canal`, no `borneId`: se conservan y se marca revisión técnica,
 * pues un canal comercial no equivale automáticamente a un puerto físico renombrado.
 */
export function prepararAdopcionRevisionComponente(
	proyecto: Proyecto,
	dispositivoId: string,
	nueva: DefinicionComponentePersonalizado,
	mapaBornes: Readonly<Record<string, string>>,
): PreparacionAdopcionComponente {
	if (proyecto.esEjemplo) throw new Error('Un ejemplo es de solo lectura; crea una copia antes de adoptar revisiones.');
	const instancias = proyecto.dispositivos.filter((d) => d.id === dispositivoId);
	if (instancias.length !== 1) throw new Error(`El aparato ${dispositivoId} no tiene una identidad única.`);
	const anterior = instancias[0];
	const procedencia = anterior.componentePersonalizado;
	if (!procedencia) throw new Error(`El aparato ${dispositivoId} no procede de una definición personal.`);
	if (nueva.id !== procedencia.definicionId) {
		throw new Error('La revisión pertenece a otra definición; no se puede sustituir la identidad del componente.');
	}
	if (!Number.isInteger(procedencia.revision) || procedencia.revision < 1
		|| !Number.isInteger(nueva.revision) || nueva.revision <= procedencia.revision) {
		throw new Error('La adopción exige una revisión posterior a la instancia colocada.');
	}
	const errores = validarDefinicionComponente(nueva);
	if (errores.length) throw new Error(`Revisión inválida: ${errores.join('; ')}`);

	const anteriores = new Map<string, Borne>();
	for (const borne of anterior.bornes) {
		if (anteriores.has(borne.id)) throw new Error(`La instancia tiene un borne duplicado: ${borne.id}.`);
		anteriores.set(borne.id, borne);
	}
	const siguientes = new Map(nueva.terminales.map((borne) => [borne.id, borne]));
	const entradas = Object.entries(mapaBornes);
	const destinos = new Set<string>();
	for (const [origen, destino] of entradas) {
		if (!anteriores.has(origen)) throw new Error(`El mapeo menciona un borne anterior inexistente: ${origen}.`);
		if (!siguientes.has(destino)) throw new Error(`El mapeo apunta a un borne nuevo inexistente: ${destino}.`);
		if (destinos.has(destino)) throw new Error(`Dos bornes anteriores no pueden ocupar el mismo borne nuevo: ${destino}.`);
		destinos.add(destino);
	}
	const referenciados = new Set<string>();
	const conexiones = new Map<string, number>();
	const conductoresAfectados: string[] = [];
	for (const conductor of proyecto.conductores) {
		let afecta = false;
		for (const ref of [conductor.de, conductor.a]) {
			if (!referenciaDelDispositivo(ref, dispositivoId)) continue;
			if (!anteriores.has(ref.borneId)) {
				throw new Error(`El conductor ${conductor.id} conecta un borne antiguo inexistente: ${ref.borneId}.`);
			}
			referenciados.add(ref.borneId);
			conexiones.set(ref.borneId, (conexiones.get(ref.borneId) ?? 0) + 1);
			afecta = true;
		}
		if (afecta) conductoresAfectados.push(conductor.id);
	}
	for (const ensayo of proyecto.datosTecnicos?.prospectiva ?? []) {
		for (const ref of [ensayo.de, ensayo.a]) {
			if (referenciaDelDispositivo(ref, dispositivoId)) referenciados.add(ref.borneId);
		}
	}
	for (const [a, b] of anterior.puentesInternos ?? []) { referenciados.add(a); referenciados.add(b); }
	for (const grupo of anterior.puentes ?? []) for (const id of grupo) referenciados.add(id);
	for (const bloque of anterior.terminales ?? []) for (const id of bloque.bornes) referenciados.add(id);
	for (const id of referenciados) {
		if (!anteriores.has(id)) throw new Error(`La instancia referencia un borne anterior inexistente: ${id}.`);
		if (!Object.hasOwn(mapaBornes, id)) throw new Error(`Falta el mapeo explícito del borne usado ${id}.`);
	}
	for (const [origen, destino] of entradas) {
		const previo = anteriores.get(origen)!;
		const siguiente = siguientes.get(destino)!;
		if ((conexiones.get(origen) ?? 0) > 0 && (previo.tipo === 'PE') !== (siguiente.tipo === 'PE')) {
			throw new Error(`El borne conectado ${origen} no puede cambiar su semántica de protección PE.`);
		}
		if ((conexiones.get(origen) ?? 0) > 0 && siguiente.seccionMaxMm2 !== undefined) {
			for (const conductor of proyecto.conductores) {
				if (!((conductor.de.dispositivoId === dispositivoId && conductor.de.borneId === origen)
					|| (conductor.a.dispositivoId === dispositivoId && conductor.a.borneId === origen))) continue;
				if (conductor.seccion !== undefined && conductor.seccion > siguiente.seccionMaxMm2) {
					throw new Error(`El conductor ${conductor.id} supera la sección máxima del nuevo borne ${destino}.`);
				}
			}
		}
	}
	const cantidadDestino = new Map<string, number>();
	for (const [origen, destino] of entradas) {
		cantidadDestino.set(destino, (cantidadDestino.get(destino) ?? 0) + (conexiones.get(origen) ?? 0));
	}
	for (const [destino, cantidad] of cantidadDestino) {
		const maximo = siguientes.get(destino)?.maxConductores;
		// Un límite ausente es desconocido, no una capacidad física supuesta.
		if (maximo !== undefined && cantidad > maximo) {
			throw new Error(`El borne ${destino} solo admite ${maximo} conductores (${cantidad} conectados).`);
		}
	}

	const candidato = structuredClone(proyecto);
	const nuevoSnapshot = instanciarComponentePersonalizado(nueva, dispositivoId, { campo: anterior.campo });
	const editado = candidato.dispositivos.find((d) => d.id === dispositivoId)!;
	const camposDeDefinicion = [
		'tipo', 'descripcion', 'fabricante', 'referencia', 'tensionNominal', 'corrienteNominal',
		'disipacionW', 'profundidad', 'temporizacion', 'programa', 'rangoSonda',
		'unidadSonda', 'rangoSalidaAnalogica', 'bornes', 'comportamiento', 'assetId',
		'componentePersonalizado', 'montajeComponente',
		'simboloEsquemaPersonal',
	] as const satisfies readonly (keyof Dispositivo)[];
	for (const campo of camposDeDefinicion) {
		// La ausencia en la definición nueva también retira el dato anterior; no debe sobrevivir
		// un programa, parámetro o perfil que pertenecía a la revisión antigua.
		delete (editado as unknown as Record<string, unknown>)[campo];
		const valor = nuevoSnapshot[campo];
		if (valor !== undefined) (editado as unknown as Record<string, unknown>)[campo] = structuredClone(valor);
	}
	if (anterior.assetId !== nueva.assetId) delete editado.imagen;
	const mapear = (id: string): string => Object.hasOwn(mapaBornes, id) ? mapaBornes[id] : id;
	for (const conductor of candidato.conductores) {
		for (const ref of [conductor.de, conductor.a]) {
			if (referenciaDelDispositivo(ref, dispositivoId)) ref.borneId = mapear(ref.borneId);
		}
	}
	for (const ensayo of candidato.datosTecnicos?.prospectiva ?? []) {
		for (const ref of [ensayo.de, ensayo.a]) {
			if (referenciaDelDispositivo(ref, dispositivoId)) ref.borneId = mapear(ref.borneId);
		}
	}
	if (editado.puentesInternos) editado.puentesInternos = editado.puentesInternos.map(([a, b]) => [mapear(a), mapear(b)]);
	if (editado.puentes) editado.puentes = editado.puentes.map((grupo) => grupo.map(mapear));
	if (editado.terminales) editado.terminales = editado.terminales.map((bloque) => ({
		...bloque, bornes: bloque.bornes.map(mapear),
	}));

	const colocaciones = candidato.gabinete?.colocaciones.filter((c) => c.dispositivoId === dispositivoId) ?? [];
	if (colocaciones.length > 1) throw new Error(`El aparato ${dispositivoId} tiene varias colocaciones físicas.`);
	const colocacion = colocaciones[0];
	const cambiaEnvolvente = anterior.profundidad !== nueva.dimensiones.fondoMm
		|| !!colocacion && (colocacion.ancho !== nueva.dimensiones.anchoMm
			|| colocacion.alto !== nueva.dimensiones.altoMm);
	if (colocacion) {
		const antes = { ...colocacion };
		colocacion.ancho = nueva.dimensiones.anchoMm;
		colocacion.alto = nueva.dimensiones.altoMm;
		const g = candidato.gabinete!;
		if (colocacion.montaje !== 'puerta') {
			if (colocacion.x < 0 || colocacion.y < 0 || colocacion.x + colocacion.ancho > g.ancho
				|| colocacion.y + colocacion.alto > g.alto) {
				throw new Error('La nueva envolvente sale de la placa; recoloca el aparato antes de adoptar.');
			}
		}
		for (const otra of g.colocaciones) {
			if (otra === colocacion || (otra.montaje ?? 'placa') !== (colocacion.montaje ?? 'placa')) continue;
			if (solapan(colocacion, otra) && !solapan(antes, otra)) {
				throw new Error(`La nueva envolvente colisiona con ${otra.dispositivoId}.`);
			}
		}
	}
	const evaluacionMontaje = colocacion
		? evaluarCompatibilidadMontaje(nueva.dimensiones, nueva.montaje, candidato.gabinete!, colocacion)
		: undefined;
	if (evaluacionMontaje?.estado === 'NO_CABE') {
		throw new Error(`La revisión nueva no cabe en el montaje actual: ${evaluacionMontaje.motivos.join(' ')}`);
	}
	const usadosNuevos = new Set(entradas.map(([, destino]) => destino));
	const puertosAfectados = entradas.map(([anteriorId, nuevo]) => ({
		anterior: anteriorId, nuevo, conexiones: conexiones.get(anteriorId) ?? 0,
	}));
	const vinculoTecnico = proyecto.datosTecnicos?.vinculos.some((v) => v.entidad === 'DEVICE' && v.entidadId === dispositivoId) ?? false;
	const cambiaImagen = anterior.assetId !== nueva.assetId;
	const cambiaPosicionDePuerto = entradas.some(([origen, destino]) => {
		const antes = anteriores.get(origen)!;
		const despues = siguientes.get(destino)!;
		return antes.u !== despues.u || antes.v !== despues.v;
	});
	return {
		candidato,
		impacto: {
			dispositivoId,
			definicionId: nueva.id,
			revisionAnterior: procedencia.revision,
			revisionNueva: nueva.revision,
			conductoresAfectados,
			puertosAfectados,
			puertosRetirados: [...anteriores.keys()].filter((id) => !Object.hasOwn(mapaBornes, id) && !siguientes.has(id)),
			puertosAnadidos: [...siguientes.keys()].filter((id) => !usadosNuevos.has(id) && !anteriores.has(id)),
			cambiaPerfil: JSON.stringify(anterior.comportamiento) !== JSON.stringify(nueva.comportamiento),
			cambiaTipo: anterior.tipo !== nueva.tipoDispositivo,
			cambiaImagen,
			cambiaEnvolvente,
			estadoMontaje: evaluacionMontaje?.estado ?? 'SIN_COLOCACION',
			requiereHidratarAsset: cambiaImagen,
			requiereRevisionTecnica: vinculoTecnico || anterior.tipo !== nueva.tipoDispositivo
				|| JSON.stringify(anterior.comportamiento) !== JSON.stringify(nueva.comportamiento),
			requiereRevisionDeRuta: cambiaEnvolvente || cambiaImagen || cambiaPosicionDePuerto
				|| entradas.some(([origen, destino]) => origen !== destino),
		},
	};
}
