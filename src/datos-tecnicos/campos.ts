/** Lista cerrada. Ningún import puede ejecutar expresiones ni seleccionar rutas JS arbitrarias. */
const n = (unidad: string, minimo = 0, maximo?: number) => ({ tipo: 'numero' as const, unidad, minimo, maximo });
const e = (...valores: string[]) => ({ tipo: 'enum' as const, unidad: '1', valores });
export const CAMPOS_TECNICOS = {
	'proteccion.inA': n('A'), 'proteccion.Icn': n('kA'), 'proteccion.Icu': n('kA'), 'proteccion.Ics': n('kA'),
	'proteccion.instantaneoDesdeIn': n('1'), 'proteccion.i2tA2s': n('A2s'),
	'bobina.tensionNominalV': n('V'), 'bobina.sistema': e('AC', 'DC'), 'bobina.frecuenciaHz': n('Hz'),
	'bobina.corrienteA': n('A'), 'bobina.corrienteLlamadaA': n('A'), 'bobina.tensionRangoV': n('V'),
	'plc.tensionV': n('V'), 'plc.sistema': e('AC', 'DC'), 'plc.tipoSalida': e('PNP', 'NPN', 'RELE', 'TRIAC'),
	'plc.corrienteMaxA': n('A'), 'plc.corrienteLlamadaMaxA': n('A'), 'plc.tipoCarga': e('RESISTIVA', 'INDUCTIVA'),
	'analogica.burdenOhm': n('ohm'), 'analogica.resistenciaSalidaOhm': n('ohm'),
	'analogica.tensionMinimaTransmisorV': n('V'), 'analogica.tensionComplianceV': n('V'),
	'analogica.modo': e('activa', 'pasiva'), 'analogica.unidad': e('V', 'mA'), 'analogica.rango': n('1', -1e6),
	'conductor.seccionMm2': n('mm2'), 'conductor.material': e('COBRE', 'ALUMINIO'),
	'conductor.xOhmPorKm': n('ohm/km'), 'conductor.temperaturaC': n('°C', -273.15),
	'motor.potenciaMecanicaNominalW': n('W'), 'motor.tensionNominalV': n('V'), 'motor.frecuenciaHz': n('Hz'),
	'motor.fases': n('1', 1, 3), 'motor.eficiencia': n('1', 0, 1), 'motor.factorPotencia': n('1', 0, 1),
	'motor.corrienteNominalA': n('A'), 'motor.rpmNominal': n('rpm'), 'motor.polos': n('1', 1, 100),
	'motor.corrienteArranqueMultiplo': n('1'), 'motor.tiempoArranqueS': n('s'), 'motor.factorServicio': n('1'),
	'vfd.tensionEntradaNominalV': n('V'), 'vfd.fasesEntrada': n('1', 1, 3), 'vfd.potenciaNominalW': n('W'),
	'vfd.eficiencia': n('1', 0, 1), 'vfd.frecuenciaBaseHz': n('Hz'), 'vfd.frecuenciaMaxHz': n('Hz'),
	'vfd.tensionSalidaMaxV': n('V'), 'vfd.corrienteNominalA': n('A'), 'vfd.limiteCorrienteA': n('A'), 'vfd.rSalidaOhm': n('ohm'),
	'transformador.primarioV': n('V'), 'transformador.secundarioV': n('V'), 'transformador.potenciaVA': n('VA'),
	'transformador.impedanciaPct': n('%'), 'transformador.xSobreR': n('1'), 'transformador.frecuenciaHz': n('Hz'), 'transformador.perdidasVacioW': n('W'),
	'fuente.tensionNominalV': n('V'), 'fuente.frecuenciaHz': n('Hz'), 'fuente.rOhm': n('ohm'), 'fuente.xOhm': n('ohm'),
} as const;
export type CampoTecnico = keyof typeof CAMPOS_TECNICOS;
export const CONVERSIONES_UNIDAD: Readonly<Record<string, { base: string; factor: number }>> = {
	mA: { base: 'A', factor: .001 }, kA: { base: 'A', factor: 1000 }, kV: { base: 'V', factor: 1000 },
	kW: { base: 'W', factor: 1000 }, kVA: { base: 'VA', factor: 1000 }, ms: { base: 's', factor: .001 },
	'%': { base: '1', factor: .01 },
};
export function factorUnidad(desde: string, hasta: string): number | undefined {
	if (desde === hasta) return 1;
	const a = CONVERSIONES_UNIDAD[desde] ?? { base: desde, factor: 1 };
	const b = CONVERSIONES_UNIDAD[hasta] ?? { base: hasta, factor: 1 };
	return a.base === b.base ? a.factor / b.factor : undefined;
}
