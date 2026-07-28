/**
 * Ficha del tablero: los datos que describen el conjunto, no cada pieza.
 *
 * Es lo primero que mira un cliente y lo primero que pide un taller: qué caja es, qué
 * placa lleva, cuántos aparatos y de qué tipo, cuánto riel y cuánta canaleta, cuánto cable
 * y de qué secciones. Va aquí, en un motor puro, para que el PDF, el dossier HTML y la
 * pantalla digan exactamente lo mismo y se pueda comprobar sin renderizar nada.
 */
import { Dispositivo, Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import { cajaDeGabinete } from '../modelo/proyecto.js';
import { ResultadoRuteo } from './ruteo.js';

/** Familia comercial de cada tipo de aparato: es como se agrupa un presupuesto. */
export const FAMILIA_POR_TIPO: Record<TipoDispositivo, string> = {
	disyuntor: 'Protección', diferencial: 'Protección', guardamotor: 'Protección',
	fusible: 'Protección', seccionador: 'Protección',
	contactor: 'Maniobra', rele: 'Maniobra', variador: 'Maniobra',
	fuente: 'Alimentación', transformador: 'Alimentación',
	plc: 'Control', pulsador: 'Control', selector: 'Control', piloto: 'Control', sensor: 'Control',
	bornero: 'Conexión',
	motor: 'Consumo', valvula: 'Consumo', resistencia: 'Consumo', condensador: 'Consumo',
	cable: 'Cableado', otro: 'Otros',
};

/** Orden de presentación: el recorrido natural de la corriente por el tablero. */
const ORDEN_FAMILIAS = ['Protección', 'Maniobra', 'Alimentación', 'Control', 'Conexión', 'Consumo', 'Otros', 'Cableado'];

export interface RecuentoFamilia {
	familia: string;
	cantidad: number;
	/** Designaciones de los aparatos de la familia, en orden. */
	designaciones: string[];
}

export interface RecuentoSeccion {
	/** Sección en mm²; `undefined` si el conductor no la tiene definida. */
	seccion?: number;
	cantidad: number;
	longitudMm: number;
	/**
	 * Conductores del grupo con recorrido calculado. Los que van a un aparato de campo no
	 * pasan por canaleta y no tienen longitud: decirlo es más honesto que sumar cero.
	 */
	conRuta: number;
}

export interface FichaTablero {
	nombre: string;
	/**
	 * Caja envolvente en mm. Falta si el proyecto no tiene gabinete. `estimada` avisa de que
	 * el proyecto no la declara y se dedujo de la placa: no es una medida que valga para pedir
	 * el armario.
	 */
	caja?: { ancho: number; alto: number; profundidad: number; estimada: boolean };
	placa?: { ancho: number; alto: number };
	rieles: { cantidad: number; largoTotalMm: number };
	canaletas: { cantidad: number; largoTotalMm: number; llenadoMaxPct: number };
	aparatos: {
		total: number;
		enPlaca: number;
		deCampo: number;
		porFamilia: RecuentoFamilia[];
	};
	conductores: { total: number; longitudTotalMm: number; porSeccion: RecuentoSeccion[] };
	/** Tensiones de trabajo presentes en el tablero, de mayor a menor. */
	tensiones: number[];
	/** Porcentaje de la placa cubierto por aparatos, rieles y canaletas (0..100). */
	ocupacionPlacaPct: number;
	/** Fondo libre que queda entre el aparato más profundo y la puerta, en mm. */
	holguraFondoMm?: number;
}

const etiqueta = (d: Dispositivo): string => d.designacion ?? d.id;

/** Fondo de un aparato: el de su ficha si lo trae, o una estimación por tipo. */
export function fondoDe(d: Dispositivo): number {
	if (d.profundidad) return d.profundidad;
	if (d.imagen) return 6;
	switch (d.tipo) {
		case 'variador': return 120;
		case 'fuente': return 100;
		case 'contactor': return 84;
		case 'guardamotor': return 90;
		case 'transformador': return 85;
		case 'disyuntor': case 'diferencial': return 74;
		case 'fusible': return 72;
		case 'rele': return 70;
		case 'plc': return 62;
		case 'bornero': return 48;
		default: return 55;
	}
}

export function generarFichaTablero(proyecto: Proyecto, ruteo?: ResultadoRuteo): FichaTablero {
	const g = proyecto.gabinete;
	const colocados = new Set((g?.colocaciones ?? []).map((c) => c.dispositivoId));
	// Las imágenes de referencia son una ayuda visual, no material del tablero.
	const aparatos = proyecto.dispositivos.filter((d) => !d.imagen && d.tipo !== 'cable');

	const familias = new Map<string, RecuentoFamilia>();
	for (const d of aparatos) {
		const familia = FAMILIA_POR_TIPO[d.tipo] ?? 'Otros';
		const f = familias.get(familia) ?? { familia, cantidad: 0, designaciones: [] };
		f.cantidad++;
		f.designaciones.push(etiqueta(d));
		familias.set(familia, f);
	}
	const porFamilia = [...familias.values()].sort(
		(a, b) => ORDEN_FAMILIAS.indexOf(a.familia) - ORDEN_FAMILIAS.indexOf(b.familia),
	);
	for (const f of porFamilia) f.designaciones.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

	const longitudDe = new Map(ruteo?.rutas.map((r) => [r.conductorId, r.longitudMm]) ?? []);
	const secciones = new Map<string, RecuentoSeccion>();
	let longitudTotalMm = 0;
	for (const c of proyecto.conductores) {
		const ruta = longitudDe.get(c.id);
		longitudTotalMm += ruta ?? 0;
		const clave = String(c.seccion ?? '');
		const s = secciones.get(clave) ?? { seccion: c.seccion, cantidad: 0, longitudMm: 0, conRuta: 0 };
		s.cantidad++;
		if (ruta !== undefined) { s.longitudMm += ruta; s.conRuta++; }
		secciones.set(clave, s);
	}
	const porSeccion = [...secciones.values()].sort((a, b) => (a.seccion ?? 0) - (b.seccion ?? 0));

	const largoRieles = (g?.rieles ?? []).reduce((s, r) => s + r.largo, 0);
	const largoCanaletas = (g?.canaletas ?? []).reduce((s, c) => s + c.largo, 0);
	const llenadoMax = Math.max(0, ...(ruteo?.ocupaciones ?? []).map((o) => o.ocupacion)) * 100;

	// Superficie de placa realmente usada: aparatos + rieles + canaletas, sin contar dos veces
	// lo que se solapa (un aparato montado sobre su riel ocupa el sitio una sola vez).
	let ocupacionPlacaPct = 0;
	if (g && g.ancho > 0 && g.alto > 0) {
		const usada = superficieUsada(proyecto);
		ocupacionPlacaPct = Math.min(100, (usada / (g.ancho * g.alto)) * 100);
	}

	const fondoAparatos = Math.max(0, ...aparatos.filter((d) => colocados.has(d.id)).map(fondoDe));
	const caja = g ? cajaDeGabinete(g) : undefined;

	return {
		nombre: proyecto.nombre,
		caja,
		placa: g ? { ancho: g.ancho, alto: g.alto } : undefined,
		rieles: { cantidad: g?.rieles.length ?? 0, largoTotalMm: largoRieles },
		canaletas: {
			cantidad: g?.canaletas.length ?? 0,
			largoTotalMm: largoCanaletas,
			llenadoMaxPct: Math.round(llenadoMax),
		},
		aparatos: {
			total: aparatos.length,
			enPlaca: aparatos.filter((d) => colocados.has(d.id)).length,
			deCampo: aparatos.filter((d) => !colocados.has(d.id)).length,
			porFamilia,
		},
		conductores: { total: proyecto.conductores.length, longitudTotalMm, porSeccion },
		tensiones: [...new Set(aparatos.map((d) => d.tensionNominal).filter((v): v is number => !!v))]
			.sort((a, b) => b - a),
		ocupacionPlacaPct: Math.round(ocupacionPlacaPct),
		holguraFondoMm: caja && fondoAparatos > 0 ? caja.profundidad - fondoAparatos : undefined,
	};
}

/**
 * Superficie de placa cubierta (mm²), contando una sola vez lo que se solapa. Se resuelve
 * rasterizando en celdas de 5 mm: es exacto de sobra para un dato de ocupación y no depende
 * de una geometría de polígonos que aquí no aporta nada.
 */
function superficieUsada(proyecto: Proyecto): number {
	const g = proyecto.gabinete;
	if (!g) return 0;
	const PASO = 5;
	const cols = Math.ceil(g.ancho / PASO);
	const filas = Math.ceil(g.alto / PASO);
	const ocupada = new Uint8Array(cols * filas);
	const marcar = (x: number, y: number, ancho: number, alto: number): void => {
		const c0 = Math.max(0, Math.floor(x / PASO));
		const c1 = Math.min(cols, Math.ceil((x + ancho) / PASO));
		const f0 = Math.max(0, Math.floor(y / PASO));
		const f1 = Math.min(filas, Math.ceil((y + alto) / PASO));
		for (let f = f0; f < f1; f++) for (let c = c0; c < c1; c++) ocupada[f * cols + c] = 1;
	};
	for (const c of g.colocaciones) marcar(c.x, c.y, c.ancho, c.alto);
	for (const r of g.rieles) {
		if (r.orientacion === 'v') marcar(r.x, r.y, 35, r.largo);
		else marcar(r.x, r.y, r.largo, 35);
	}
	for (const c of g.canaletas) {
		if (c.orientacion === 'v') marcar(c.x, c.y, c.ancho, c.largo);
		else marcar(c.x, c.y, c.largo, c.ancho);
	}
	let n = 0;
	for (const v of ocupada) n += v;
	return n * PASO * PASO;
}
