import type { OrigenDatoFisico } from '../modelo/fisica.js';
import { faseDeg, magnitud, restar, type Complejo } from './complejos.js';
import type { ResultadoFisicaElectrica } from './topologia-proyecto.js';

export type ProvenienciaMedicion = 'CALCULADA' | 'ESTIMADA' | 'NO_DISPONIBLE';

export interface LecturaInstrumento {
	valor?: number;
	unidad: string;
	proveniencia: ProvenienciaMedicion;
	detalle?: string;
}

export interface LecturaPinza extends LecturaInstrumento {
	faseDeg?: number;
	sentido?: string;
}

export interface LecturaTrifasica {
	sistemaId: string;
	v12: LecturaInstrumento;
	v23: LecturaInstrumento;
	v31: LecturaInstrumento;
	i1: LecturaInstrumento;
	i2: LecturaInstrumento;
	i3: LecturaInstrumento;
	in: LecturaInstrumento;
	desequilibrioTension: LecturaInstrumento;
	desequilibrioCorriente: LecturaInstrumento;
	secuenciaPositivaV: LecturaInstrumento;
	secuenciaNegativaV: LecturaInstrumento;
	secuenciaCeroV: LecturaInstrumento;
}

export interface LecturaPotencia {
	cargaId: string;
	p: LecturaInstrumento;
	q: LecturaInstrumento;
	s: LecturaInstrumento;
	pf: LecturaInstrumento;
}

const noDisponible = (unidad: string, detalle: string): LecturaInstrumento => ({
	unidad, proveniencia: 'NO_DISPONIBLE', detalle,
});

function procedencia(...origenes: (OrigenDatoFisico | undefined)[]): ProvenienciaMedicion {
	if (origenes.some((o) => !o || o === 'NO_MODELADO')) return 'NO_DISPONIBLE';
	if (origenes.some((o) => o === 'ESTIMADO' || o === 'INYECTADO')) return 'ESTIMADA';
	return 'CALCULADA';
}

function lectura(valor: number, unidad: string, origen: ProvenienciaMedicion, detalle?: string): LecturaInstrumento {
	return Number.isFinite(valor) && origen !== 'NO_DISPONIBLE'
		? { valor, unidad, proveniencia: origen, detalle }
		: noDisponible(unidad, detalle ?? 'El modelo no produjo una magnitud finita.');
}

function nodosAlcanzables(fisica: ResultadoFisicaElectrica, inicio: string): Set<string> {
	const alcanzados = new Set([inicio]);
	const cola = [inicio];
	while (cola.length) {
		const actual = cola.shift()!;
		for (const rama of fisica.medicion.ramas.values()) {
			const vecino = rama.de === actual ? rama.a : rama.a === actual ? rama.de : undefined;
			if (vecino && !alcanzados.has(vecino)) {
				alcanzados.add(vecino);
				cola.push(vecino);
			}
		}
	}
	return alcanzados;
}

function modosQueAlimentan(fisica: ResultadoFisicaElectrica, nodoA: string, nodoB: string): Set<'AC' | 'DC'> {
	const nodos = nodosAlcanzables(fisica, nodoA);
	for (const nodo of nodosAlcanzables(fisica, nodoB)) nodos.add(nodo);
	return new Set(fisica.medicion.fuentes
		.filter((f) => nodos.has(f.de) || nodos.has(f.a))
		.map((f) => f.modo));
}

/** Voltímetro ideal sobre los fasores ya resueltos. No invoca al solver. */
export function medirTension(
	fisica: ResultadoFisicaElectrica,
	nodoA: string,
	nodoB: string,
	modo: 'VAC' | 'VDC',
): LecturaInstrumento {
	const a = fisica.red.nodos.get(nodoA);
	const b = fisica.red.nodos.get(nodoB);
	if (!a?.tensionV || !b?.tensionV || a.calidad !== 'VALIDA' || b.calidad !== 'VALIDA') {
		return noDisponible('V', 'Uno o ambos bornes no tienen una referencia eléctrica válida.');
	}
	const modos = modosQueAlimentan(fisica, nodoA, nodoB);
	const requerido = modo === 'VAC' ? 'AC' : 'DC';
	if (modos.size !== 1 || !modos.has(requerido)) {
		return noDisponible('V', modos.size > 1
			? 'La red contiene componentes AC y DC que el modelo fasorial no separa para esta medición.'
			: `La medición ${modo} no corresponde al sistema eléctrico resuelto.`);
	}
	const diferencia = restar(a.tensionV, b.tensionV);
	const valor = modo === 'VAC' ? magnitud(diferencia) : Math.abs(diferencia.re);
	return lectura(valor, 'V', procedencia(a.origen, b.origen), `${modo} entre ${nodoA} y ${nodoB}.`);
}

/**
 * Ohmímetro limitado a una rama pasiva directa ya descrita por PhysicsEngine.
 * Una red energizada se bloquea antes de intentar dar un valor; redes serie/paralelo generales
 * quedan NO_DISPONIBLES hasta que exista un solver de resistencia equivalente desenergizada.
 */
export function medirResistenciaDirecta(
	fisica: ResultadoFisicaElectrica,
	nodoA: string,
	nodoB: string,
): LecturaInstrumento {
	if (fisica.medicion.energizada) {
		return noDisponible('Ω', 'MEDICIÓN BLOQUEADA: desenergice el circuito antes de usar Ω/continuidad.');
	}
	const ramas = [...fisica.medicion.ramas.values()].filter((r) =>
		(r.de === nodoA && r.a === nodoB) || (r.de === nodoB && r.a === nodoA));
	if (ramas.length !== 1) {
		return noDisponible('Ω', 'Resistencia equivalente no modelada; solo se admite una rama pasiva directa inequívoca.');
	}
	const rama = ramas[0];
	if (!(rama.zOhm.re >= 0) || Math.abs(rama.zOhm.im) > 1e-9) {
		return noDisponible('Ω', 'La rama incluye reactancia; el modelo no dispone de una resistencia DC equivalente válida.');
	}
	return lectura(rama.zOhm.re, 'Ω', procedencia(rama.origen), `Rama directa ${rama.id}.`);
}

/** Pinza ideal: corriente RMS y fase en el sentido de definición de la rama del conductor. */
export function medirPinza(fisica: ResultadoFisicaElectrica, conductorId: string): LecturaPinza {
	const rama = fisica.red.ramas.get(`conductor:${conductorId}`);
	const topologia = fisica.medicion.ramas.get(`conductor:${conductorId}`);
	if (!rama || !topologia) return { ...noDisponible('A', 'El conductor no pertenece a la topología efectiva.'),
		faseDeg: undefined, sentido: undefined };
	const origen = procedencia(rama.origen, topologia.origen);
	const base = lectura(magnitud(rama.corrienteA), 'A', origen, 'Corriente RMS fasorial calculada.');
	return { ...base, faseDeg: faseDeg(rama.corrienteA), sentido: `${topologia.de} → ${topologia.a}` };
}

const deFasor = (valor: Complejo, unidad: string, origen: ProvenienciaMedicion): LecturaInstrumento =>
	lectura(magnitud(valor), unidad, origen);

export function medirTrifasico(fisica: ResultadoFisicaElectrica, sistemaId: string): LecturaTrifasica | undefined {
	const t = fisica.trifasicos.get(sistemaId); if (!t) return undefined;
	const origen = procedencia(t.origen);
	const [v1, v2, v3] = t.tensionesFaseV;
	const [i1, i2, i3] = t.corrientesFaseA;
	return {
		sistemaId,
		v12: deFasor(restar(v1, v2), 'V', origen),
		v23: deFasor(restar(v2, v3), 'V', origen),
		v31: deFasor(restar(v3, v1), 'V', origen),
		i1: deFasor(i1, 'A', origen), i2: deFasor(i2, 'A', origen), i3: deFasor(i3, 'A', origen),
		in: deFasor(t.corrienteNeutroA, 'A', origen),
		desequilibrioTension: lectura(t.desequilibrioTensionPct, '%', origen, t.metrica),
		desequilibrioCorriente: lectura(t.desequilibrioCorrientePct, '%', origen, t.metrica),
		secuenciaPositivaV: deFasor(t.componentesTension.positiva, 'V', origen),
		secuenciaNegativaV: deFasor(t.componentesTension.negativa, 'V', origen),
		secuenciaCeroV: deFasor(t.componentesTension.cero, 'V', origen),
	};
}

export function medirPotenciaCarga(fisica: ResultadoFisicaElectrica, cargaId: string): LecturaPotencia | undefined {
	const carga = fisica.red.cargas.get(cargaId); if (!carga) return undefined;
	const origen = procedencia(carga.origen);
	const s = magnitud(carga.potenciaVA);
	return {
		cargaId,
		p: lectura(carga.potenciaVA.re, 'W', origen),
		q: lectura(carga.potenciaVA.im, 'var', origen),
		s: lectura(s, 'VA', origen),
		pf: carga.factorPotencia === undefined
			? noDisponible('', 'Factor de potencia no resoluble para esta carga.')
			: lectura(carga.factorPotencia, '', origen),
	};
}
