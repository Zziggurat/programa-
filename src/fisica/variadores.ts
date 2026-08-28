import type { ConfiguracionVfdFisico, OrigenDatoFisico } from '../modelo/fisica.js';

export interface EstadoVfdParaFisica {
	estado: 'sin-alimentacion' | 'listo' | 'marcha' | 'decel' | 'falla';
	frecuenciaHz: number;
	frecuenciaObjetivoHz: number;
	motivoFalla?: string;
}

export type CodigoDiagnosticoVfdFisico = 'VFD_UNDERVOLTAGE' | 'VFD_OVERCURRENT'
	| 'VFD_OVERLOAD' | 'VFD_PHASE_LOSS' | 'VFD_CONFIG_INVALIDA';

export interface DiagnosticoVfdFisico {
	codigo: CodigoDiagnosticoVfdFisico;
	mensaje: string;
	origen: OrigenDatoFisico;
}

export interface ResultadoVfdFisico {
	dispositivoId: string;
	tensionEntradaV: number;
	corrienteEntradaA: number;
	potenciaEntradaW: number;
	tensionSalidaV: number;
	corrienteSalidaA: number;
	potenciaSalidaW: number;
	perdidasW: number;
	eficiencia?: number;
	frecuenciaSalidaHz: number;
	estado: EstadoVfdParaFisica['estado'];
	diagnosticos: DiagnosticoVfdFisico[];
	origen: OrigenDatoFisico;
}

export function tensionSalidaVfd(config: ConfiguracionVfdFisico, frecuenciaHz: number): number {
	if (!(frecuenciaHz > 0)) return 0;
	return config.tensionSalidaMaxV * Math.min(1, frecuenciaHz / config.frecuenciaBaseHz);
}

export function validarVfdFisico(config: ConfiguracionVfdFisico): DiagnosticoVfdFisico[] {
	const salida: DiagnosticoVfdFisico[] = [];
	if (!(config.eficiencia > 0 && config.eficiencia <= 1)) salida.push({ codigo: 'VFD_CONFIG_INVALIDA',
		mensaje: 'La eficiencia VFD debe estar en (0, 1].', origen: 'CONFIGURADO' });
	if (!(config.frecuenciaBaseHz > 0 && config.frecuenciaMaxHz >= config.frecuenciaBaseHz)) salida.push({
		codigo: 'VFD_CONFIG_INVALIDA', mensaje: 'Frecuencias base/máxima incompatibles.', origen: 'CONFIGURADO' });
	return salida;
}
