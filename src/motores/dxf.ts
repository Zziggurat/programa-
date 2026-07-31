/**
 * Exportación a DXF (AutoCAD). Muchas empresas reciben o entregan el trabajo en CAD, y sin
 * DXF el archivo de TableroStudio no le sirve a nadie más.
 *
 * Se genera DXF R12 ASCII a propósito: es el dialecto que abre TODO (AutoCAD, LibreCAD,
 * QCAD, DraftSight, BricsCAD) sin conversores ni sorpresas de versión. Se emiten solo las
 * entidades básicas (LINE, CIRCLE, TEXT), que es lo que un plano de tablero necesita.
 *
 * Convenio de coordenadas: el modelo usa Y hacia ABAJO (como una pantalla) y el CAD usa Y
 * hacia ARRIBA, así que se invierte la Y al escribir.
 */
import { sinTildes } from '../modelo/archivos.js';

export interface EntidadDXF {
	capa: string;
	trazo:
		| { tipo: 'linea'; x1: number; y1: number; x2: number; y2: number }
		| { tipo: 'circulo'; x: number; y: number; r: number }
		| { tipo: 'texto'; x: number; y: number; texto: string; alto: number };
}

/** Capas del dibujo, con su color AutoCAD (1 rojo, 2 amarillo, 3 verde, 4 cian, 5 azul, 7 blanco). */
export const CAPAS: { nombre: string; color: number }[] = [
	{ nombre: 'PLACA', color: 8 },
	{ nombre: 'RIELES', color: 3 },
	{ nombre: 'CANALETAS', color: 4 },
	{ nombre: 'APARATOS', color: 7 },
	{ nombre: 'TEXTO', color: 2 },
	{ nombre: 'CABLES', color: 1 },
	{ nombre: 'COTAS', color: 5 },
];

const par = (codigo: number, valor: string | number): string => `${codigo}\n${valor}\n`;
const num = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3);

/** Cabecera con la tabla de capas: sin ella el CAD mete todo en la capa 0. */
function cabecera(): string {
	let s = par(0, 'SECTION') + par(2, 'HEADER')
		+ par(9, '$INSUNITS') + par(70, 4) // 4 = milímetros
		+ par(0, 'ENDSEC');
	s += par(0, 'SECTION') + par(2, 'TABLES') + par(0, 'TABLE') + par(2, 'LAYER') + par(70, CAPAS.length);
	for (const c of CAPAS) {
		s += par(0, 'LAYER') + par(2, c.nombre) + par(70, 0) + par(62, c.color) + par(6, 'CONTINUOUS');
	}
	s += par(0, 'ENDTAB') + par(0, 'ENDSEC');
	return s;
}

/** Escribe una entidad, invirtiendo la Y (modelo con Y abajo → CAD con Y arriba). */
function entidad(e: EntidadDXF, altoMm: number): string {
	const y = (v: number) => num(altoMm - v);
	const t = e.trazo;
	if (t.tipo === 'linea') {
		return par(0, 'LINE') + par(8, e.capa)
			+ par(10, num(t.x1)) + par(20, y(t.y1)) + par(30, '0.0')
			+ par(11, num(t.x2)) + par(21, y(t.y2)) + par(31, '0.0');
	}
	if (t.tipo === 'circulo') {
		return par(0, 'CIRCLE') + par(8, e.capa)
			+ par(10, num(t.x)) + par(20, y(t.y)) + par(30, '0.0') + par(40, num(t.r));
	}
	// El DXF R12 no admite acentos en TEXT sin tabla de estilos: se transliteran.
	return par(0, 'TEXT') + par(8, e.capa)
		+ par(10, num(t.x)) + par(20, y(t.y)) + par(30, '0.0')
		+ par(40, num(t.alto)) + par(1, sinAcentos(t.texto));
}

/** Quita acentos y caracteres que el DXF R12 no sabe representar. */
export function sinAcentos(t: string): string {
	return sinTildes(t).replace(/[^\x20-\x7E]/g, '');
}

/** Monta el archivo DXF completo a partir de una lista de entidades. */
export function generarDXF(entidades: EntidadDXF[], altoMm: number): string {
	let s = cabecera() + par(0, 'SECTION') + par(2, 'ENTITIES');
	for (const e of entidades) s += entidad(e, altoMm);
	s += par(0, 'ENDSEC') + par(0, 'EOF');
	return s;
}

/** Rectángulo como cuatro líneas (el DXF R12 no tiene rectángulo). */
export function rectangulo(capa: string, x: number, y: number, ancho: number, alto: number): EntidadDXF[] {
	return [
		{ capa, trazo: { tipo: 'linea', x1: x, y1: y, x2: x + ancho, y2: y } },
		{ capa, trazo: { tipo: 'linea', x1: x + ancho, y1: y, x2: x + ancho, y2: y + alto } },
		{ capa, trazo: { tipo: 'linea', x1: x + ancho, y1: y + alto, x2: x, y2: y + alto } },
		{ capa, trazo: { tipo: 'linea', x1: x, y1: y + alto, x2: x, y2: y } },
	];
}
