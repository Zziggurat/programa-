import type { ConfiguracionFisicaConductor } from '../modelo/fisica.js';
import { ErrorConfiguracionFisica, finito, positivo } from './unidades.js';

export interface PerfilMaterialConductor {
	id: string;
	nombre: string;
	rho20OhmM: number;
	alphaPorC: number;
}

export const MATERIALES_CONDUCTOR = Object.freeze({
	COBRE: Object.freeze({ id: 'COBRE', nombre: 'Cobre', rho20OhmM: 1.7241e-8, alphaPorC: 0.00393 }),
	ALUMINIO: Object.freeze({ id: 'ALUMINIO', nombre: 'Aluminio', rho20OhmM: 2.8264e-8, alphaPorC: 0.00403 }),
});

export function perfilMaterial(config?: ConfiguracionFisicaConductor): PerfilMaterialConductor {
	const material = config?.material ?? 'COBRE';
	if (material === 'COBRE' || material === 'ALUMINIO') return MATERIALES_CONDUCTOR[material];
	const p = config?.materialPersonalizado;
	if (!p?.nombre?.trim()) throw new ErrorConfiguracionFisica('MATERIAL_INVALIDO', 'El material personalizado necesita nombre');
	return {
		id: 'PERSONALIZADO', nombre: p.nombre.trim(),
		rho20OhmM: positivo('rho20', p.rho20OhmM),
		alphaPorC: finito('alpha', p.alphaPorC),
	};
}

