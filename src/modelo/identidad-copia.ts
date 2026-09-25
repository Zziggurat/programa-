/** Número y rótulo libres para una copia física, incluso en proyectos legacy sin `numero`. */
import { CLASE_POR_TIPO, type Dispositivo } from './tipos.js';

export function identidadParaCopia(
	original: Dispositivo, existentes: readonly Dispositivo[],
): { numero: number; designacion: string } {
	const clase = original.clase ?? CLASE_POR_TIPO[original.tipo];
	const visible = original.designacion?.trim() ?? '';
	const sufijo = /^(.*?)(\d{1,9})$/.exec(visible);
	const prefijo = sufijo?.[1] || visible || `-${clase}`;
	const anchoNumero = sufijo?.[2].length ?? 1;
	const asignadas = new Set(existentes.map((d) => d.designacion).filter((d): d is string => !!d));
	let maximo = 0;
	for (const d of existentes) {
		if ((d.clase ?? CLASE_POR_TIPO[d.tipo]) !== clase) continue;
		if (Number.isInteger(d.numero) && d.numero! > 0) maximo = Math.max(maximo, d.numero!);
		const nVisible = /^(.*?)(\d{1,9})$/.exec(d.designacion ?? '');
		if (nVisible) maximo = Math.max(maximo, Number(nVisible[2]));
	}
	let numero = maximo + 1;
	const rotulo = (): string => `${prefijo}${String(numero).padStart(anchoNumero, '0')}`;
	while (asignadas.has(rotulo())) numero++;
	return { numero, designacion: rotulo() };
}
