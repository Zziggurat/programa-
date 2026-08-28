import type { ConfiguracionMotorFisico, OrigenDatoFisico } from '../modelo/fisica.js';

export type CodigoDiagnosticoMotorFisico = 'PLACA_INCOMPLETA' | 'PLACA_INCONSISTENTE'
	| 'EFICIENCIA_INVALIDA' | 'PF_INVALIDO' | 'RPM_INCOMPATIBLE_CON_FRECUENCIA'
	| 'CORRIENTE_NOMINAL_INCONSISTENTE' | 'UNDERVOLTAGE' | 'PERDIDA_FASE'
	| 'ROTOR_BLOQUEADO' | 'SOBRECARGA_MECANICA';

export interface DiagnosticoMotorFisico {
	codigo: CodigoDiagnosticoMotorFisico;
	mensaje: string;
	origen: OrigenDatoFisico;
}

export interface PlacaMotorCalculada {
	potenciaEntradaNominalW: number;
	corrienteNominalCalculadaA: number;
	corrienteNominalUsadaA: number;
	potenciaReactivaNominalVar: number;
	potenciaAparenteNominalVA: number;
	rpmSincronas?: number;
	deslizamiento?: number;
	diagnosticos: DiagnosticoMotorFisico[];
}

export function calcularPlacaMotor(config: ConfiguracionMotorFisico): PlacaMotorCalculada {
	const diagnosticos: DiagnosticoMotorFisico[] = [];
	if (!(config.eficiencia > 0 && config.eficiencia <= 1)) diagnosticos.push({ codigo: 'EFICIENCIA_INVALIDA',
		mensaje: 'La eficiencia debe estar en (0, 1].', origen: 'CONFIGURADO' });
	if (!(config.factorPotencia > 0 && config.factorPotencia <= 1)) diagnosticos.push({ codigo: 'PF_INVALIDO',
		mensaje: 'El factor de potencia debe estar en (0, 1].', origen: 'CONFIGURADO' });
	const eta = Math.max(1e-6, Math.min(1, config.eficiencia));
	const fp = Math.max(1e-6, Math.min(1, config.factorPotencia));
	const pin = config.potenciaMecanicaNominalW / eta;
	const s = pin / fp;
	const inCalc = config.fases === 3 ? s / (Math.sqrt(3) * config.tensionNominalV) : s / config.tensionNominalV;
	if (config.corrienteNominalA && Math.abs(config.corrienteNominalA - inCalc) / inCalc > 0.15) diagnosticos.push({
		codigo: 'CORRIENTE_NOMINAL_INCONSISTENTE',
		mensaje: `In configurada ${config.corrienteNominalA.toFixed(2)} A difiere de ${inCalc.toFixed(2)} A calculados.`,
		origen: 'CALCULADO',
	});
	const rpmSincronas = config.polos && Number.isInteger(config.polos) && config.polos >= 2
		? 120 * config.frecuenciaHz / config.polos : undefined;
	let deslizamiento: number | undefined;
	if (rpmSincronas && config.rpmNominal) {
		deslizamiento = (rpmSincronas - config.rpmNominal) / rpmSincronas;
		if (!(deslizamiento >= 0 && deslizamiento < 0.2)) diagnosticos.push({
			codigo: 'RPM_INCOMPATIBLE_CON_FRECUENCIA',
			mensaje: `${config.rpmNominal} rpm no es coherente con ${rpmSincronas} rpm síncronas.`, origen: 'CALCULADO',
		});
	}
	return { potenciaEntradaNominalW: pin, corrienteNominalCalculadaA: inCalc,
		corrienteNominalUsadaA: config.corrienteNominalA ?? inCalc,
		potenciaReactivaNominalVar: pin * Math.tan(Math.acos(fp)), potenciaAparenteNominalVA: s,
		rpmSincronas, deslizamiento, diagnosticos };
}

export interface EstadoMotorParaFisica {
	estado: 'detenido' | 'arrancando' | 'marcha' | 'desacelerando' | 'falla';
	progresoArranque: number;
	velocidadActual: number;
	rpmEstimada?: number;
	fasesPresentes: number;
	fasesRequeridas: 1 | 3;
	frecuenciaElectricaHz?: number;
	motivoFalla?: string;
	alimentadoPorVariadorId?: string;
}

export interface ResultadoMotorFisico {
	dispositivoId: string;
	tensionV: number;
	corrienteA: number;
	potenciaEntradaW: number;
	potenciaReactivaVar: number;
	potenciaAparenteVA: number;
	factorPotencia?: number;
	potenciaMecanicaEstimadaW: number;
	eficiencia: number;
	rpm?: number;
	rpmSincronas?: number;
	deslizamiento?: number;
	corrienteNominalCalculadaA: number;
	corrienteNominalUsadaA: number;
	estado: EstadoMotorParaFisica['estado'];
	diagnosticos: DiagnosticoMotorFisico[];
	origen: OrigenDatoFisico;
}

export function factorCorrienteMotor(config: ConfiguracionMotorFisico, estado?: EstadoMotorParaFisica): number {
	if (!estado || estado.estado === 'marcha') return 1;
	if (estado.estado === 'detenido' || estado.estado === 'desacelerando') return 0;
	const arranque = config.corrienteArranqueMultiplo ?? 6;
	if (estado.motivoFalla === 'motor-bloqueado') return arranque;
	if (estado.motivoFalla === 'sobrecarga') return Math.max(1, config.factorServicio ?? 1.5);
	if (estado.motivoFalla === 'perdida-fase') return 1.5;
	if (estado.motivoFalla === 'subtension' || estado.motivoFalla === 'sobretension') return 1;
	if (estado.estado === 'arrancando') return 1 + (arranque - 1) * (1 - Math.max(0, Math.min(1, estado.progresoArranque)));
	return estado.estado === 'falla' ? 0 : 1;
}
