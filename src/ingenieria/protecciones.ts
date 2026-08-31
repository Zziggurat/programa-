import { magnitud } from '../fisica/complejos.js';
import { evaluarCurva, type EvaluacionCurvaProteccion, type PerfilCurvaProteccion } from '../fisica/protecciones.js';
import {
	perfilCurvaProteccionDispositivo, type ResultadoFisicaElectrica,
} from '../fisica/topologia-proyecto.js';
import type { Dispositivo, Proyecto } from '../modelo/tipos.js';
import type { CircuitoIngenieria } from './circuitos.js';
import type { EngineeringRule, EstadoValidacionIngenieria, ResultadoReglaIngenieria } from './validacion.js';

const tol = (a: number, b: number) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function resultado(c: CircuitoIngenieria, code: ResultadoReglaIngenieria['code'], dispositivoId: string,
	status: EstadoValidacionIngenieria, title: string, description: string): ResultadoReglaIngenieria {
	return { code, category: code.startsWith('TS-COORD') ? 'COORDINATION' : 'PROTECTION',
		severity: status === 'FAIL' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO', status, title, description,
		circuitId: c.id, evidence: [], relatedEntities: [{ tipo: 'CIRCUIT', id: c.id }, { tipo: 'DEVICE', id: dispositivoId }],
		provenance: 'CALCULADO', missingData: [], remediationHints: [] };
}

function corrienteDiseno(proyecto: Proyecto, fisica: ResultadoFisicaElectrica | undefined, c: CircuitoIngenieria): {
	valor?: number; origen: 'CALCULADO' | 'CONFIGURADO' | 'NO_DISPONIBLE'; detalle: string;
} {
	const valores: { valor: number; origen: 'CALCULADO' | 'CONFIGURADO'; id: string }[] = [];
	for (const id of c.cargas) {
		const motor = fisica?.motores.get(id);
		if (motor) { valores.push({ valor: motor.corrienteNominalUsadaA, origen: 'CALCULADO', id }); continue; }
		const d = proyecto.dispositivos.find((x) => x.id === id);
		if (d?.corrienteNominal) valores.push({ valor: d.corrienteNominal, origen: 'CONFIGURADO', id });
	}
	if (!valores.length) return { origen: 'NO_DISPONIBLE', detalle: 'Las cargas no declaran corriente de diseño.' };
	return { valor: valores.reduce((s, x) => s + x.valor, 0),
		origen: valores.some((x) => x.origen === 'CALCULADO') ? 'CALCULADO' : 'CONFIGURADO',
		detalle: valores.map((x) => `${x.id}:${x.valor}A`).join(', ') };
}

function validarIn(proyecto: Proyecto, fisica: ResultadoFisicaElectrica | undefined, c: CircuitoIngenieria, d: Dispositivo): ResultadoReglaIngenieria {
	const p = fisica?.protecciones.get(d.id); const inA = p?.inA ?? d.fisica?.proteccion?.inA ?? d.corrienteNominal;
	const diseno = corrienteDiseno(proyecto, fisica, c);
	if (inA === undefined || diseno.valor === undefined) {
		const r = resultado(c, 'TS-PROT-RATING-DATA', d.id, 'INDETERMINATE', 'Calibre no validable',
			'Falta el calibre de la protección o la corriente de diseño de la carga.');
		r.provenance = 'NO_DISPONIBLE'; r.missingData = [
			...(inA === undefined ? ['In de la protección'] : []), ...(diseno.valor === undefined ? ['corriente de diseño de la carga'] : []),
		]; return r;
	}
	const falla = diseno.valor - inA > tol(diseno.valor, inA); const r = resultado(c, 'TS-PROT-RATING', d.id,
		falla ? 'FAIL' : 'PASS', falla ? 'Calibre inferior a la corriente de diseño' : 'Calibre compatible con la corriente de diseño',
		`Corriente de diseño ${diseno.valor.toFixed(3)} A; protección In ${inA} A.`);
	r.evidence = [{ codigo: 'I_DESIGN', descripcion: diseno.detalle, valor: diseno.valor, unidad: 'A', origen: diseno.origen },
		{ codigo: 'IN', descripcion: 'Calibre de protección', valor: inA, unidad: 'A', origen: 'CONFIGURADO' }];
	if (p) r.evidence.push({ codigo: 'I_OPERATING', descripcion: 'Corriente del snapshot físico', valor: p.corrienteA, unidad: 'A', origen: 'CALCULADO' });
	r.criterion = { descripcion: 'In no inferior a corriente de diseño según modelo V7', origen: 'MODELO_V7' };
	return r;
}

function iccProteccion(fisica: ResultadoFisicaElectrica | undefined, id: string): { ka?: number; origen: 'CALCULADO' | 'ESTIMADO' | 'NO_MODELADO' } {
	const ids = fisica?.protecciones.get(id)?.fallas ?? []; const fallas = ids.flatMap((fid) => {
		const f = fisica?.fallas.find((x) => x.id === fid); return f?.iccA ? [f] : [];
	});
	if (!fallas.length) return { origen: 'NO_MODELADO' };
	const mayor = fallas.sort((a, b) => magnitud(b.iccA!) - magnitud(a.iccA!))[0];
	return { ka: magnitud(mayor.iccA!) / 1000, origen: mayor.origen === 'CALCULADO' ? 'CALCULADO' : 'ESTIMADO' };
}

function validarCorte(fisica: ResultadoFisicaElectrica | undefined, c: CircuitoIngenieria, d: Dispositivo): ResultadoReglaIngenieria {
	const icc = iccProteccion(fisica, d.id); const perfil = d.fisica?.proteccion?.capacidadCorte;
	const capacidad = perfil?.icuKA ?? perfil?.icnKA;
	const etiqueta = perfil?.icuKA !== undefined ? 'Icu' : perfil?.icnKA !== undefined ? 'Icn' : undefined;
	if (icc.ka === undefined || capacidad === undefined) {
		const r = resultado(c, 'TS-PROT-BREAKING-CAPACITY-DATA', d.id, 'INDETERMINATE', 'Poder de corte no validable',
			'No existe información suficiente para comparar la Icc del punto con Icu/Icn.');
		r.provenance = 'NO_DISPONIBLE'; r.missingData = [
			...(icc.ka === undefined ? ['Icc calculada en el punto'] : []), ...(capacidad === undefined ? ['Icu o Icn configurado'] : []),
		]; if (perfil?.icsKA !== undefined) r.evidence.push({ codigo: 'ICS', descripcion: 'Ics declarada (no usada como Icu/Icn)', valor: perfil.icsKA, unidad: 'kA', origen: 'CONFIGURADO' });
		return r;
	}
	const falla = icc.ka - capacidad > tol(icc.ka, capacidad); const r = resultado(c, 'TS-PROT-BREAKING-CAPACITY', d.id,
		falla ? 'FAIL' : 'PASS', falla ? 'Poder de corte insuficiente' : 'Poder de corte superior a la Icc modelada',
		`Icc ${icc.ka.toFixed(3)} kA frente a ${etiqueta} ${capacidad} kA.`);
	r.evidence = [{ codigo: 'ICC', descripcion: 'Corriente de cortocircuito prospectiva', valor: icc.ka, unidad: 'kA', origen: icc.origen },
		{ codigo: etiqueta!, descripcion: `${etiqueta} configurada`, valor: capacidad, unidad: 'kA', origen: 'CONFIGURADO' }];
	r.criterion = { descripcion: `${etiqueta} no inferior a Icc calculada`, origen: 'MODELO_V7' };
	return r;
}

function validarArranque(proyecto: Proyecto, fisica: ResultadoFisicaElectrica | undefined, c: CircuitoIngenieria,
	d: Dispositivo): ResultadoReglaIngenieria | undefined {
	const motorId = c.cargas.find((id) => proyecto.dispositivos.find((x) => x.id === id)?.tipo === 'motor');
	if (!motorId) return undefined;
	const motor = proyecto.dispositivos.find((x) => x.id === motorId)!; const cfg = motor.fisica?.motor;
	const nominal = fisica?.motores.get(motorId)?.corrienteNominalUsadaA ?? cfg?.corrienteNominalA ?? motor.corrienteNominal;
	const multiplo = cfg?.corrienteArranqueMultiplo; const tiempo = cfg?.tiempoArranqueS;
	const inA = fisica?.protecciones.get(d.id)?.inA ?? d.fisica?.proteccion?.inA ?? d.corrienteNominal;
	const curva = perfilCurvaProteccionDispositivo(d);
	if (!(nominal && multiplo && tiempo && inA && curva)) {
		const r = resultado(c, 'TS-PROT-MOTOR-START-DATA', d.id, 'INDETERMINATE', 'Arranque de motor no validable',
			'Faltan datos de placa, tiempo de arranque, calibre o curva de protección.'); r.provenance = 'NO_DISPONIBLE';
		r.relatedEntities.push({ tipo: 'DEVICE', id: motorId }); r.missingData = [
			...(!nominal ? ['corriente nominal del motor'] : []), ...(!multiplo ? ['múltiplo de arranque'] : []),
			...(!tiempo ? ['tiempo de arranque'] : []), ...(!inA ? ['In protección'] : []), ...(!curva ? ['curva tiempo-corriente'] : []),
		]; return r;
	}
	const iArranque = nominal * multiplo; const e = evaluarCurva(curva, iArranque, inA);
	let status: EstadoValidacionIngenieria = 'PASS'; let titulo = 'Arranque fuera de la zona de actuación modelada';
	if (e.region === 'NO_MODELADA') { status = 'INDETERMINATE'; titulo = 'Curva de arranque no modelada'; }
	else if (e.region === 'INSTANTANEA' || e.tMaxS !== undefined && e.tMaxS < tiempo) { status = 'FAIL'; titulo = 'La protección puede actuar durante el arranque'; }
	else if (e.tMinS !== undefined && e.tMinS <= tiempo) { status = 'WARNING'; titulo = 'Margen reducido durante el arranque'; }
	const r = resultado(c, 'TS-PROT-MOTOR-START', d.id, status, titulo,
		`Arranque ${iArranque.toFixed(3)} A durante ${tiempo}s; ${e.explicacion}.`);
	r.relatedEntities.push({ tipo: 'DEVICE', id: motorId }); r.provenance = e.origen;
	r.evidence = [{ codigo: 'I_START', descripcion: 'Corriente de arranque estimada desde placa', valor: iArranque, unidad: 'A', origen: 'ESTIMADO' },
		{ codigo: 'T_START', descripcion: 'Tiempo de arranque', valor: tiempo, unidad: 's', origen: 'CONFIGURADO' },
		{ codigo: 'CURVE_REGION', descripcion: e.explicacion, valor: e.region, origen: e.origen }];
	return r;
}

function cadenaProtecciones(c: CircuitoIngenieria): string[] {
	const set = new Set(c.protecciones); let mejor: string[] = [];
	for (const t of c.trayectos) {
		const secuencia: string[] = [];
		for (const nodo of t.nodos) { const id = nodo.split('::')[0]; if (set.has(id) && secuencia.at(-1) !== id) secuencia.push(id); }
		if (secuencia.length > mejor.length || secuencia.length === mejor.length && secuencia.join() < mejor.join()) mejor = secuencia;
	}
	return mejor;
}

function validarCoordinacion(fisica: ResultadoFisicaElectrica | undefined, c: CircuitoIngenieria): ResultadoReglaIngenieria[] {
	const cadena = cadenaProtecciones(c); const salida: ResultadoReglaIngenieria[] = [];
	for (let i = 0; i + 1 < cadena.length; i++) {
		const arriba = cadena[i]; const abajo = cadena[i + 1];
		const dato = fisica?.selectividad.find((x) => x.aguasArribaId === arriba && x.aguasAbajoId === abajo);
		if (!dato) { const r = resultado(c, 'TS-COORD-DATA', abajo, 'INDETERMINATE', 'Coordinación no evaluable',
			`Falta una ventana tiempo-corriente común para ${arriba}/${abajo}.`); r.provenance = 'NO_DISPONIBLE';
			r.relatedEntities.push({ tipo: 'DEVICE', id: arriba }); r.missingData = ['Icc y ventanas tiempo-corriente del par']; salida.push(r); continue; }
		const mapa: Record<typeof dato.clasificacion, EstadoValidacionIngenieria> = {
			SELECTIVA: 'PASS', PARCIAL: 'WARNING', NO_SELECTIVA: 'FAIL', INDETERMINADA: 'INDETERMINATE',
		};
		const r = resultado(c, 'TS-COORD-SELECTIVITY', abajo, mapa[dato.clasificacion],
			`Coordinación ${dato.clasificacion.toLowerCase().replace('_', ' ')}`, dato.explicacion);
		r.relatedEntities.push({ tipo: 'DEVICE', id: arriba }); r.provenance = dato.aguasAbajo.origen;
		r.evidence = [{ codigo: 'CLASSIFICATION', descripcion: dato.explicacion, valor: dato.clasificacion, origen: dato.aguasAbajo.origen },
			{ codigo: 'FAULT', descripcion: 'Falla usada para evaluar el par', valor: dato.fallaId, origen: 'INYECTADO' }]; salida.push(r);
	}
	return salida;
}

export const REGLA_PROTECCIONES: EngineeringRule = {
	code: 'TS-PROT-DESIGN', category: 'PROTECTION', scope: 'CIRCUIT',
	evaluate(contexto) {
		const porId = new Map(contexto.proyecto.dispositivos.map((d) => [d.id, d])); const salida: ResultadoReglaIngenieria[] = [];
		for (const c of contexto.circuitos) {
			for (const id of c.protecciones) { const d = porId.get(id); if (!d) continue;
				salida.push(validarIn(contexto.proyecto, contexto.fisica, c, d), validarCorte(contexto.fisica, c, d));
				const arranque = validarArranque(contexto.proyecto, contexto.fisica, c, d); if (arranque) salida.push(arranque);
			}
			salida.push(...validarCoordinacion(contexto.fisica, c));
		}
		return salida;
	},
};

export interface DatosCurvaProteccionV7 {
	dispositivoId: string;
	perfil?: PerfilCurvaProteccion;
	evaluacion?: EvaluacionCurvaProteccion;
}
export interface DatosCoordinacionV7 {
	circuitId: string;
	aguasArriba: DatosCurvaProteccionV7;
	aguasAbajo: DatosCurvaProteccionV7;
	clasificacion: 'SELECTIVA' | 'PARCIAL' | 'NO_SELECTIVA' | 'INDETERMINADA';
	explicacion: string;
}

/** Datos de presentación ya resueltos; la futura UI no recalcula curvas. */
export function datosCoordinacion(proyecto: Proyecto, circuitos: readonly CircuitoIngenieria[],
	fisica?: ResultadoFisicaElectrica): DatosCoordinacionV7[] {
	const porId = new Map(proyecto.dispositivos.map((d) => [d.id, d])); const salida: DatosCoordinacionV7[] = [];
	for (const c of circuitos) {
		const cadena = cadenaProtecciones(c);
		for (let i = 0; i + 1 < cadena.length; i++) {
			const arriba = cadena[i]; const abajo = cadena[i + 1];
			const dato = fisica?.selectividad.find((x) => x.aguasArribaId === arriba && x.aguasAbajoId === abajo);
			salida.push({ circuitId: c.id, aguasArriba: { dispositivoId: arriba,
				perfil: porId.get(arriba) ? perfilCurvaProteccionDispositivo(porId.get(arriba)!) : undefined,
				evaluacion: dato?.aguasArriba }, aguasAbajo: { dispositivoId: abajo,
				perfil: porId.get(abajo) ? perfilCurvaProteccionDispositivo(porId.get(abajo)!) : undefined,
				evaluacion: dato?.aguasAbajo }, clasificacion: dato?.clasificacion ?? 'INDETERMINADA',
				explicacion: dato?.explicacion ?? 'Faltan Icc o ventanas tiempo-corriente para este par.' });
		}
	}
	return salida.sort((a, b) => a.circuitId.localeCompare(b.circuitId)
		|| a.aguasArriba.dispositivoId.localeCompare(b.aguasArriba.dispositivoId)
		|| a.aguasAbajo.dispositivoId.localeCompare(b.aguasAbajo.dispositivoId));
}
