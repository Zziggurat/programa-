import type { Proyecto } from '../modelo/tipos.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import { calcularConductorFisico, resolverLongitudConductor } from './conductores.js';

export interface ResultadoLazoAnalogicoFisico {
	fuenteId?: string;
	entradaId?: string;
	tipo: '4_20_MA' | '0_10_V';
	corrienteMA?: number;
	tensionV?: number;
	valorDemandado: number;
	resistenciaCableOhm: number;
	burdenOhm: number;
	caidaCableV: number;
	tensionBurdenV: number;
	tensionTransmisorV?: number;
	calidad: 'NORMAL' | 'COMPLIANCE_INSUFICIENTE' | 'CARGA_EXCESIVA';
	origen: OrigenDatoFisico;
}

export function resolverLazo420(datos: {
	corrienteDemandadaMA: number;
	tensionDisponibleV: number;
	tensionMinimaTransmisorV: number;
	resistenciaCableOhm: number;
	burdenOhm: number;
}): ResultadoLazoAnalogicoFisico {
	const totalR = Math.max(0, datos.resistenciaCableOhm) + Math.max(0, datos.burdenOhm);
	const demandadaA = Math.max(0, datos.corrienteDemandadaMA) / 1000;
	const maximaA = totalR > 0 ? Math.max(0, datos.tensionDisponibleV - datos.tensionMinimaTransmisorV) / totalR : Infinity;
	const actualA = Math.min(demandadaA, maximaA);
	const corrienteMA = actualA * 1000;
	const caidaCableV = actualA * Math.max(0, datos.resistenciaCableOhm);
	const tensionBurdenV = actualA * Math.max(0, datos.burdenOhm);
	const tensionTransmisorV = datos.tensionDisponibleV - caidaCableV - tensionBurdenV;
	return {
		tipo: '4_20_MA', corrienteMA, valorDemandado: datos.corrienteDemandadaMA,
		resistenciaCableOhm: datos.resistenciaCableOhm, burdenOhm: datos.burdenOhm,
		caidaCableV, tensionBurdenV, tensionTransmisorV,
		calidad: corrienteMA + 1e-6 < datos.corrienteDemandadaMA ? 'COMPLIANCE_INSUFICIENTE' : 'NORMAL',
		origen: 'CALCULADO',
	};
}

export function resolverSenal010(datos: {
	tensionDemandadaV: number;
	resistenciaSalidaOhm: number;
	resistenciaEntradaOhm: number;
}): ResultadoLazoAnalogicoFisico {
	const rOut = Math.max(0, datos.resistenciaSalidaOhm);
	const rIn = Math.max(0, datos.resistenciaEntradaOhm);
	const tensionV = rIn > 0 ? datos.tensionDemandadaV * rIn / (rIn + rOut) : 0;
	const corrienteA = rIn > 0 ? tensionV / rIn : 0;
	const errorRel = Math.abs(datos.tensionDemandadaV - tensionV) / Math.max(1e-9, Math.abs(datos.tensionDemandadaV));
	return {
		tipo: '0_10_V', tensionV, valorDemandado: datos.tensionDemandadaV,
		resistenciaCableOhm: rOut, burdenOhm: rIn, caidaCableV: corrienteA * rOut,
		tensionBurdenV: tensionV, calidad: errorRel > 0.01 ? 'CARGA_EXCESIVA' : 'NORMAL', origen: 'CALCULADO',
	};
}

/** Menor resistencia declarada entre dos bornes, usando solo cables y puentes pasivos. */
export function resistenciaCaminoAnalogico(proyecto: Proyecto, desde: string, hasta: string): {
	ohm?: number; origen: OrigenDatoFisico;
} {
	const vecinos = new Map<string, { nodo: string; ohm: number; origen: OrigenDatoFisico }[]>();
	const unir = (a: string, b: string, ohm: number, origen: OrigenDatoFisico) => {
		const x = vecinos.get(a) ?? []; x.push({ nodo: b, ohm, origen }); vecinos.set(a, x);
		const y = vecinos.get(b) ?? []; y.push({ nodo: a, ohm, origen }); vecinos.set(b, y);
	};
	for (const c of proyecto.conductores) {
		if (!(c.seccion && c.seccion > 0)) continue;
		const longitud = resolverLongitudConductor(c.fisica);
		if (longitud.metros <= 0) continue;
		const datos = calcularConductorFisico({ seccionMm2: c.seccion, longitud, config: c.fisica });
		unir(`${c.de.dispositivoId}::${c.de.borneId}`, `${c.a.dispositivoId}::${c.a.borneId}`, datos.rOhm, longitud.origen);
	}
	for (const d of proyecto.dispositivos) for (const p of d.puentesInternos ?? []) unir(`${d.id}::${p[0]}`, `${d.id}::${p[1]}`, 0, 'CONFIGURADO');
	const dist = new Map<string, { ohm: number; origen: OrigenDatoFisico }>([[desde, { ohm: 0, origen: 'CALCULADO' }]]);
	const pendientes = new Set([desde]);
	while (pendientes.size) {
		const actual = [...pendientes].sort((a, b) => (dist.get(a)?.ohm ?? Infinity) - (dist.get(b)?.ohm ?? Infinity))[0];
		pendientes.delete(actual); if (actual === hasta) break;
		const base = dist.get(actual)!;
		for (const e of vecinos.get(actual) ?? []) {
			const candidato = base.ohm + e.ohm;
			if (candidato >= (dist.get(e.nodo)?.ohm ?? Infinity)) continue;
			dist.set(e.nodo, { ohm: candidato,
				origen: base.origen === 'CALCULADO' && e.origen === 'CONFIGURADO' ? 'CALCULADO'
					: e.origen === 'NO_MODELADO' ? 'NO_MODELADO' : 'ESTIMADO' });
			pendientes.add(e.nodo);
		}
	}
	return dist.get(hasta) ?? { origen: 'NO_MODELADO' };
}
