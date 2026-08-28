import type { ConfiguracionFisicaConductor, OrigenDatoFisico } from '../modelo/fisica.js';
import type { Complejo } from './complejos.js';
import { perfilMaterial } from './materiales.js';
import { finito, mm2AM2, ohmPorKmAOhmPorM, positivo } from './unidades.js';

export interface LongitudFisica {
	metros: number;
	origen: OrigenDatoFisico;
}

export interface ResultadoConductorFisico {
	material: string;
	seccionMm2: number;
	longitudM: number;
	temperaturaC: number;
	r20Ohm: number;
	rOhm: number;
	xOhm: number;
	zOhm: Complejo;
	origenLongitud: OrigenDatoFisico;
	origenSeccion: OrigenDatoFisico;
	origenReactancia: OrigenDatoFisico;
}

export function resolverLongitudConductor(
	config: ConfiguracionFisicaConductor | undefined,
	longitudRutaM?: number,
	estimacionM?: number,
): LongitudFisica {
	if (config?.longitudManualM !== undefined) return { metros: positivo('longitud manual', config.longitudManualM), origen: 'CONFIGURADO' };
	if (longitudRutaM !== undefined && Number.isFinite(longitudRutaM) && longitudRutaM > 0) {
		return { metros: longitudRutaM, origen: 'CALCULADO' };
	}
	if (estimacionM !== undefined && Number.isFinite(estimacionM) && estimacionM > 0) {
		return { metros: estimacionM, origen: 'ESTIMADO' };
	}
	return { metros: 0, origen: 'NO_MODELADO' };
}

export function calcularConductorFisico(datos: {
	seccionMm2: number;
	longitud: LongitudFisica;
	config?: ConfiguracionFisicaConductor;
	origenSeccion?: OrigenDatoFisico;
}): ResultadoConductorFisico {
	const seccionMm2 = positivo('seccion', datos.seccionMm2);
	const longitudM = finito('longitud', datos.longitud.metros);
	if (longitudM < 0) throw new Error('LONGITUD_NEGATIVA');
	const temperaturaC = datos.config?.temperaturaC ?? 20;
	finito('temperatura', temperaturaC);
	const material = perfilMaterial(datos.config);
	const r20Ohm = material.rho20OhmM * longitudM / mm2AM2(seccionMm2);
	const factorTemperatura = 1 + material.alphaPorC * (temperaturaC - 20);
	if (!(factorTemperatura > 0)) throw new Error('TEMPERATURA_FUERA_DEL_MODELO');
	const rOhm = r20Ohm * factorTemperatura;
	const xDeclarada = datos.config?.xOhmPorKm;
	const xOhm = xDeclarada === undefined ? 0 : ohmPorKmAOhmPorM(xDeclarada) * longitudM;
	return {
		material: material.nombre, seccionMm2, longitudM, temperaturaC, r20Ohm, rOhm, xOhm,
		zOhm: { re: rOhm, im: xOhm }, origenLongitud: datos.longitud.origen,
		origenSeccion: datos.origenSeccion ?? 'CONFIGURADO',
		origenReactancia: xDeclarada === undefined ? 'NO_MODELADO' : 'CONFIGURADO',
	};
}
