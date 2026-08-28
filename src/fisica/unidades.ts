export class ErrorConfiguracionFisica extends Error {
	constructor(public readonly codigo: string, mensaje: string) {
		super(mensaje);
		this.name = 'ErrorConfiguracionFisica';
	}
}

export function finito(nombre: string, valor: number): number {
	if (!Number.isFinite(valor)) throw new ErrorConfiguracionFisica('NUMERO_NO_FINITO', `${nombre} debe ser finito`);
	return valor;
}

export function positivo(nombre: string, valor: number): number {
	finito(nombre, valor);
	if (valor <= 0) throw new ErrorConfiguracionFisica('VALOR_NO_POSITIVO', `${nombre} debe ser mayor que cero`);
	return valor;
}

export function mmAMetros(mm: number): number { return finito('longitud mm', mm) / 1000; }
export function mm2AM2(mm2: number): number { return positivo('seccion mm2', mm2) * 1e-6; }
export function ohmPorKmAOhmPorM(valor: number): number { return finito('ohm/km', valor) / 1000; }
export function gradosARadianes(grados: number): number { return finito('angulo', grados) * Math.PI / 180; }
export function radianesAGrados(radianes: number): number { return finito('angulo', radianes) * 180 / Math.PI; }

