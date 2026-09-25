/** ESQ-06: dibujo vectorial acotado, independiente de la foto y del perfil eléctrico. */
export interface SegmentoSimboloPersonal {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface SimboloEsquemaPersonal {
	version: 1;
	forma: 'bloque' | 'circulo' | 'rombo';
	rotulo?: string;
	segmentos: SegmentoSimboloPersonal[];
	/** Declaración de la persona que incorporó el dibujo; no prueba autoría ni permiso. */
	autorDeclarado: string;
	licenciaDeclarada: string;
}

const objeto = (valor: unknown): valor is Record<string, unknown> =>
	typeof valor === 'object' && valor !== null && !Array.isArray(valor);
const claves = (valor: Record<string, unknown>, permitidas: readonly string[]): boolean =>
	Object.keys(valor).every((clave) => permitidas.includes(clave));
const texto = (valor: unknown, maximo: number): valor is string =>
	typeof valor === 'string' && !!valor.trim() && valor.length <= maximo
		&& !/[\u0000-\u001f\u007f]/u.test(valor);
const coordenada = (valor: unknown): valor is number =>
	typeof valor === 'number' && Number.isFinite(valor) && valor >= -1 && valor <= 1;

/** Nunca se ejecuta SVG/HTML importado: solo se aceptan primitivas y metadatos conocidos. */
export function leerSimboloEsquemaPersonal(bruto: unknown): SimboloEsquemaPersonal | undefined {
	if (!objeto(bruto) || !claves(bruto,
		['version', 'forma', 'rotulo', 'segmentos', 'autorDeclarado', 'licenciaDeclarada'])
		|| bruto.version !== 1 || !['bloque', 'circulo', 'rombo'].includes(String(bruto.forma))
		|| !texto(bruto.autorDeclarado, 120) || !texto(bruto.licenciaDeclarada, 120)
		|| (bruto.rotulo !== undefined && !texto(bruto.rotulo, 24))
		|| !Array.isArray(bruto.segmentos) || bruto.segmentos.length > 32) return undefined;
	const segmentos: SegmentoSimboloPersonal[] = [];
	for (const segmento of bruto.segmentos) {
		if (!objeto(segmento) || !claves(segmento, ['x1', 'y1', 'x2', 'y2'])
			|| !coordenada(segmento.x1) || !coordenada(segmento.y1)
			|| !coordenada(segmento.x2) || !coordenada(segmento.y2)
			|| Math.hypot(segmento.x2 - segmento.x1, segmento.y2 - segmento.y1) < 0.02) return undefined;
		segmentos.push({ x1: segmento.x1, y1: segmento.y1, x2: segmento.x2, y2: segmento.y2 });
	}
	return {
		version: 1, forma: bruto.forma as SimboloEsquemaPersonal['forma'],
		...(bruto.rotulo !== undefined ? { rotulo: bruto.rotulo.trim() } : {}), segmentos,
		autorDeclarado: bruto.autorDeclarado.trim(), licenciaDeclarada: bruto.licenciaDeclarada.trim(),
	};
}

export function validarSimboloEsquemaPersonal(bruto: unknown): string[] {
	return bruto === undefined || leerSimboloEsquemaPersonal(bruto) !== undefined ? []
		: ['el símbolo esquemático necesita forma, trazos acotados y autor/licencia declarados; no se admiten SVG/HTML arbitrarios'];
}
