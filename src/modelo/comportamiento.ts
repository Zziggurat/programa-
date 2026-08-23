/**
 * Contrato serializable entre el modelo de un aparato y el motor de simulación.
 *
 * `tipo` sigue describiendo qué es el aparato para catálogo, esquema y documentación. Este perfil
 * describe qué hace eléctricamente. Separarlos permite que un componente genérico o importado se
 * comporte igual que uno nativo sin deducir su función de la imagen, la marca o el texto visible.
 *
 * La versión 1 es deliberadamente pequeña: formaliza los roles que el motor ya sabe ejecutar. No
 * promete todavía un variador, un diferencial residual ni una red analógica completa.
 */
import type { Borne, Dispositivo, TipoDispositivo } from './tipos.js';

export interface ParBornesSimulacion {
	entrada: string;
	salida: string;
}

export interface ContactoSimulacion extends ParBornesSimulacion {
	reposo: 'abierto' | 'cerrado';
	funcion: 'potencia' | 'auxiliar';
}

export type ComportamientoSimulacion =
	| {
		version: 1;
		clase: 'contactos-electromagneticos';
		bobina: { entrada: string; retorno: string };
		polos: ParBornesSimulacion[];
		contactos: ContactoSimulacion[];
	}
	| {
		version: 1;
		clase: 'controlador';
		alimentacion: { entradas: string[]; retornos: string[] };
		salidasDigitales: { borne: string; comun: string }[];
		salidasAnalogicas: {
			borne: string;
			referencia: string;
			rango: [number, number];
			unidad: 'V';
		}[];
	}
	| {
		version: 1;
		clase: 'fuente';
		primario?: { entradas: string[]; retornos: string[] };
		salidas: { borne: string; papel: 'fase' | 'retorno'; tensionV: number }[];
	}
	| {
		version: 1;
		clase: 'proteccion';
		polos: ParBornesSimulacion[];
		contactos: ContactoSimulacion[];
		rearmable: boolean;
	}
	| {
		version: 1;
		clase: 'mando';
		contactos: ContactoSimulacion[];
	}
	| {
		version: 1;
		clase: 'sensor';
		contactos: ContactoSimulacion[];
		alimentacion?: { entrada: string; retorno: string };
		salidaDigital?: { borne: string; tomaDe: string };
	}
	| {
		version: 1;
		clase: 'carga';
		alimentacion: { fases: string[]; retornos: string[]; fasesMinimas: 1 | 3 };
		efecto: 'giro' | 'luz' | 'movimiento' | 'calor' | 'reactivo' | 'generico';
	}
	| {
		version: 1;
		clase: 'pasivo';
		conexiones: ParBornesSimulacion[];
	}
	| {
		version: 1;
		clase: 'sin-comportamiento';
		motivo: string;
	};

export type NivelFidelidadSimulacion = 'simulado' | 'parcial' | 'sin-comportamiento';

export interface FilaFidelidadSimulacion {
	nivel: NivelFidelidadSimulacion;
	participacion: string;
	limitacion: string;
}

/**
 * Matriz contractual, no texto de marketing. Al estar tipada como `Record<TipoDispositivo, ...>`,
 * añadir una familia al modelo obliga a declarar qué sabe hacer el motor con ella.
 */
export const MATRIZ_FIDELIDAD_SIMULACION = {
	version: 1,
	tipos: {
		plc: { nivel: 'parcial', participacion: 'Programa, entradas y salidas digitales/0-10 V.', limitacion: 'DSL limitada; no IEC 61131-3.' },
		fuente: { nivel: 'parcial', participacion: 'Crea un secundario si el primario está alimentado.', limitacion: 'Sin límite de potencia, eficiencia ni fallo.' },
		transformador: { nivel: 'parcial', participacion: 'Crea un secundario aislado condicionado por el primario.', limitacion: 'Sin impedancia, pérdidas ni saturación.' },
		contactor: { nivel: 'simulado', participacion: 'Bobina, polos y auxiliares NA/NC.', limitacion: 'Sin tiempos mecánicos ni desgaste.' },
		rele: { nivel: 'parcial', participacion: 'Bobina y contactos, con temporización opcional.', limitacion: 'Relé auxiliar y térmico comparten aún la misma familia.' },
		disyuntor: { nivel: 'parcial', participacion: 'Corte, sobrecarga y cortocircuito estimado.', limitacion: 'Sin impedancia ni Icc calculada.' },
		guardamotor: { nivel: 'parcial', participacion: 'Corte y disparo por sobrecarga estimada.', limitacion: 'Sin pérdida de fase ni coordinación.' },
		diferencial: { nivel: 'parcial', participacion: 'Corte manual y polos.', limitacion: 'No calcula corriente residual ni sensibilidad.' },
		fusible: { nivel: 'parcial', participacion: 'Corte por sobrecorriente estimada.', limitacion: 'El estado de sustitución no está modelado.' },
		seccionador: { nivel: 'parcial', participacion: 'Apertura y cierre de polos.', limitacion: 'Sin enclavamientos ni poder de corte.' },
		variador: { nivel: 'sin-comportamiento', participacion: 'No ejecuta potencia ni control.', limitacion: 'Faltan RUN, referencia, frecuencia, rampa y fallos.' },
		motor: { nivel: 'parcial', participacion: 'Carga y giro binario.', limitacion: 'Sin par, velocidad, transición de arranque ni fallo.' },
		pulsador: { nivel: 'parcial', participacion: 'Conmuta contactos NA/NC.', limitacion: 'El estado momentáneo/mantenido no es explícito.' },
		selector: { nivel: 'parcial', participacion: 'Conmuta contactos NA/NC.', limitacion: 'Solo dos estados; sin posiciones múltiples.' },
		piloto: { nivel: 'simulado', participacion: 'Carga binaria e indicación luminosa.', limitacion: 'No modela vida útil o destrucción por sobretensión.' },
		sensor: { nivel: 'parcial', participacion: 'Contacto seco, PNP simple o valor funcional.', limitacion: 'Sin modelo eléctrico 0-10 V/4-20 mA completo.' },
		valvula: { nivel: 'parcial', participacion: 'Carga y movimiento binario.', limitacion: 'Sin posición, presión o caudal.' },
		resistencia: { nivel: 'parcial', participacion: 'Carga de corriente declarada.', limitacion: 'Sin cálculo R/P ni temperatura.' },
		condensador: { nivel: 'parcial', participacion: 'Carga genérica.', limitacion: 'Sin carga, descarga, reactancia ni transitorio.' },
		bornero: { nivel: 'parcial', participacion: 'Conectividad pasiva y puentes.', limitacion: 'La señal analógica no atraviesa todos los puentes internos.' },
		cable: { nivel: 'sin-comportamiento', participacion: 'El tipo de dispositivo no participa.', limitacion: 'Los conductores del proyecto son otra entidad y sí participan.' },
		otro: { nivel: 'parcial', participacion: 'Una acometida legacy puede actuar como fuente.', limitacion: 'El resto carece de contrato común.' },
	},
} as const satisfies { version: 1; tipos: Record<TipoDispositivo, FilaFidelidadSimulacion> };

const esObjeto = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;
const listaTextos = (v: unknown): string[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const r = v.map(texto);
	return r.every((x): x is string => x !== undefined) ? r : undefined;
};
const par = (v: unknown): ParBornesSimulacion | undefined => {
	if (!esObjeto(v)) return undefined;
	const entrada = texto(v.entrada);
	const salida = texto(v.salida);
	return entrada && salida ? { entrada, salida } : undefined;
};
const pares = (v: unknown): ParBornesSimulacion[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const r = v.map(par);
	return r.every((x): x is ParBornesSimulacion => x !== undefined) ? r : undefined;
};
const contacto = (v: unknown): ContactoSimulacion | undefined => {
	const p = par(v);
	if (!p || !esObjeto(v)) return undefined;
	const reposo = v.reposo === 'abierto' || v.reposo === 'cerrado' ? v.reposo : undefined;
	const funcion = v.funcion === 'potencia' || v.funcion === 'auxiliar' ? v.funcion : undefined;
	return reposo && funcion ? { ...p, reposo, funcion } : undefined;
};
const contactos = (v: unknown): ContactoSimulacion[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const r = v.map(contacto);
	return r.every((x): x is ContactoSimulacion => x !== undefined) ? r : undefined;
};
const alimentacion = (v: unknown): { entradas: string[]; retornos: string[] } | undefined => {
	if (!esObjeto(v)) return undefined;
	const entradas = listaTextos(v.entradas);
	const retornos = listaTextos(v.retornos);
	return entradas && retornos ? { entradas, retornos } : undefined;
};
const rango = (v: unknown): [number, number] | undefined =>
	Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && Number.isFinite(v[0])
		&& typeof v[1] === 'number' && Number.isFinite(v[1]) && v[0] <= v[1]
		? [v[0], v[1]] : undefined;

/** Reconstruye un perfil externo desde una lista blanca. Nunca devuelve referencias al JSON bruto. */
export function leerComportamientoSimulacion(bruto: unknown): ComportamientoSimulacion | undefined {
	if (!esObjeto(bruto) || bruto.version !== 1 || typeof bruto.clase !== 'string') return undefined;
	switch (bruto.clase) {
		case 'contactos-electromagneticos': {
			if (!esObjeto(bruto.bobina)) return undefined;
			const entrada = texto(bruto.bobina.entrada);
			const retorno = texto(bruto.bobina.retorno);
			const ps = pares(bruto.polos);
			const cs = contactos(bruto.contactos);
			return entrada && retorno && ps && cs
				? { version: 1, clase: bruto.clase, bobina: { entrada, retorno }, polos: ps, contactos: cs }
				: undefined;
		}
		case 'controlador': {
			const alim = alimentacion(bruto.alimentacion);
			if (!alim || !Array.isArray(bruto.salidasDigitales) || !Array.isArray(bruto.salidasAnalogicas)) return undefined;
			const digitales = bruto.salidasDigitales.map((x) => esObjeto(x) && texto(x.borne) && texto(x.comun)
				? { borne: texto(x.borne)!, comun: texto(x.comun)! } : undefined);
			const analogas = bruto.salidasAnalogicas.map((x) => {
				if (!esObjeto(x)) return undefined;
				const borne = texto(x.borne); const referencia = texto(x.referencia); const r = rango(x.rango);
				return borne && referencia && r && x.unidad === 'V'
					? { borne, referencia, rango: r, unidad: 'V' as const } : undefined;
			});
			return digitales.every((x): x is { borne: string; comun: string } => !!x)
				&& analogas.every((x): x is { borne: string; referencia: string; rango: [number, number]; unidad: 'V' } => !!x)
				? { version: 1, clase: bruto.clase, alimentacion: alim, salidasDigitales: digitales, salidasAnalogicas: analogas }
				: undefined;
		}
		case 'fuente': {
			const primario = bruto.primario === undefined ? undefined : alimentacion(bruto.primario);
			if (bruto.primario !== undefined && !primario || !Array.isArray(bruto.salidas)) return undefined;
			const salidas = bruto.salidas.map((x) => {
				if (!esObjeto(x)) return undefined;
				const borne = texto(x.borne);
				return borne && (x.papel === 'fase' || x.papel === 'retorno')
					&& typeof x.tensionV === 'number' && Number.isFinite(x.tensionV) && x.tensionV >= 0
					? { borne, papel: x.papel, tensionV: x.tensionV } : undefined;
			});
			return salidas.every((x): x is { borne: string; papel: 'fase' | 'retorno'; tensionV: number } => !!x)
				? { version: 1, clase: bruto.clase, primario, salidas } : undefined;
		}
		case 'proteccion': {
			const ps = pares(bruto.polos); const cs = contactos(bruto.contactos);
			return ps && cs && typeof bruto.rearmable === 'boolean'
				? { version: 1, clase: bruto.clase, polos: ps, contactos: cs, rearmable: bruto.rearmable }
				: undefined;
		}
		case 'mando': {
			const cs = contactos(bruto.contactos);
			return cs ? { version: 1, clase: bruto.clase, contactos: cs } : undefined;
		}
		case 'sensor': {
			const cs = contactos(bruto.contactos);
			if (!cs) return undefined;
			let alim: { entrada: string; retorno: string } | undefined;
			if (bruto.alimentacion !== undefined) {
				if (!esObjeto(bruto.alimentacion)) return undefined;
				const entrada = texto(bruto.alimentacion.entrada); const retorno = texto(bruto.alimentacion.retorno);
				if (!entrada || !retorno) return undefined;
				alim = { entrada, retorno };
			}
			let salidaDigital: { borne: string; tomaDe: string } | undefined;
			if (bruto.salidaDigital !== undefined) {
				if (!esObjeto(bruto.salidaDigital)) return undefined;
				const borne = texto(bruto.salidaDigital.borne); const tomaDe = texto(bruto.salidaDigital.tomaDe);
				if (!borne || !tomaDe) return undefined;
				salidaDigital = { borne, tomaDe };
			}
			return { version: 1, clase: bruto.clase, contactos: cs, alimentacion: alim, salidaDigital };
		}
		case 'carga': {
			if (!esObjeto(bruto.alimentacion)) return undefined;
			const fases = listaTextos(bruto.alimentacion.fases);
			const retornos = listaTextos(bruto.alimentacion.retornos);
			const fasesMinimas = bruto.alimentacion.fasesMinimas === 1 || bruto.alimentacion.fasesMinimas === 3
				? bruto.alimentacion.fasesMinimas : undefined;
			const efectos = ['giro', 'luz', 'movimiento', 'calor', 'reactivo', 'generico'];
			return fases && retornos && fasesMinimas && typeof bruto.efecto === 'string' && efectos.includes(bruto.efecto)
				? { version: 1, clase: bruto.clase, alimentacion: { fases, retornos, fasesMinimas }, efecto: bruto.efecto as Extract<ComportamientoSimulacion, { clase: 'carga' }>['efecto'] }
				: undefined;
		}
		case 'pasivo': {
			const conexiones = pares(bruto.conexiones);
			return conexiones ? { version: 1, clase: bruto.clase, conexiones } : undefined;
		}
		case 'sin-comportamiento': {
			const motivo = texto(bruto.motivo);
			return motivo ? { version: 1, clase: bruto.clase, motivo } : undefined;
		}
		default: return undefined;
	}
}

const contactosIEC = (d: Pick<Dispositivo, 'bornes'>): ContactoSimulacion[] => {
	const ids = new Set(d.bornes.map((b) => b.id));
	const salida: ContactoSimulacion[] = [];
	for (let g = 1; g <= 9; g++) {
		const comun = `${g}1`; const nc = `${g}2`; const comunNA = `${g}3`; const na = `${g}4`;
		if (ids.has(comun) && ids.has(nc)) salida.push({ entrada: comun, salida: nc, reposo: 'cerrado', funcion: 'auxiliar' });
		if (ids.has(comunNA) && ids.has(na)) salida.push({ entrada: comunNA, salida: na, reposo: 'abierto', funcion: 'auxiliar' });
		else if (ids.has(comun) && ids.has(na)) salida.push({ entrada: comun, salida: na, reposo: 'abierto', funcion: 'auxiliar' });
	}
	return salida;
};

const polosIEC = (d: Pick<Dispositivo, 'bornes' | 'puentesInternos'>): ParBornesSimulacion[] => {
	if (d.puentesInternos?.length) return d.puentesInternos.map(([entrada, salida]) => ({ entrada, salida }));
	const ids = new Set(d.bornes.map((b) => b.id));
	const aux = new Set(contactosIEC(d).flatMap((c) => [c.entrada, c.salida]));
	const salida: ParBornesSimulacion[] = [];
	for (let i = 1; i <= 7; i += 2) {
		const entrada = String(i); const fin = String(i + 1);
		if (ids.has(entrada) && ids.has(fin) && !aux.has(entrada) && !aux.has(fin)) salida.push({ entrada, salida: fin });
	}
	for (let i = 1; i <= 3; i++) {
		const entrada = `${i * 2 - 1}/L${i}`; const fin = `${i * 2}/T${i}`;
		if (ids.has(entrada) && ids.has(fin)) salida.push({ entrada, salida: fin });
	}
	if (ids.has('N1') && ids.has('N2')) salida.push({ entrada: 'N1', salida: 'N2' });
	return salida;
};

const primerBorne = (bornes: readonly Borne[], ids: readonly string[]): string | undefined =>
	ids.find((id) => bornes.some((b) => b.id === id));

const comunLegacy = (d: Pick<Dispositivo, 'bornes'>, salida: string): string | undefined => {
	const ids = new Set(d.bornes.map((b) => b.id));
	const familia = `${salida.replace(/\d+$/, '')}C`;
	if (familia !== salida && ids.has(familia)) return familia;
	return primerBorne(d.bornes, ['+24', '+V']);
};

/**
 * Valida referencias y coherencia interna. Una lista vacía significa perfil apto para ejecutar.
 * Un perfil explícito inválido nunca cae silenciosamente al comportamiento legacy.
 */
export function validarComportamiento(
	d: Pick<Dispositivo, 'bornes' | 'comportamiento'>,
): string[] {
	const c = d.comportamiento;
	if (!c) return [];
	const errores: string[] = [];
	const ids = new Set(d.bornes.map((b) => b.id));
	const borne = (id: string, ruta: string) => {
		if (!ids.has(id)) errores.push(`${ruta} refiere al borne inexistente «${id}»`);
	};
	const revisarPar = (p: ParBornesSimulacion, ruta: string) => {
		borne(p.entrada, `${ruta}.entrada`); borne(p.salida, `${ruta}.salida`);
		if (p.entrada === p.salida) errores.push(`${ruta} une un borne consigo mismo`);
	};
	if (c.version !== 1) errores.push(`versión de comportamiento no soportada: ${String((c as { version: unknown }).version)}`);
	switch (c.clase) {
		case 'contactos-electromagneticos':
			borne(c.bobina.entrada, 'bobina.entrada'); borne(c.bobina.retorno, 'bobina.retorno');
			if (c.bobina.entrada === c.bobina.retorno) errores.push('la bobina usa el mismo borne en ambos extremos');
			c.polos.forEach((p, i) => revisarPar(p, `polos[${i}]`));
			c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`));
			break;
		case 'controlador':
			c.alimentacion.entradas.forEach((x, i) => borne(x, `alimentacion.entradas[${i}]`));
			c.alimentacion.retornos.forEach((x, i) => borne(x, `alimentacion.retornos[${i}]`));
			c.salidasDigitales.forEach((x, i) => { borne(x.borne, `salidasDigitales[${i}].borne`); borne(x.comun, `salidasDigitales[${i}].comun`); });
			c.salidasAnalogicas.forEach((x, i) => { borne(x.borne, `salidasAnalogicas[${i}].borne`); borne(x.referencia, `salidasAnalogicas[${i}].referencia`); });
			if (!c.alimentacion.entradas.length || !c.alimentacion.retornos.length) errores.push('el controlador no declara un par de alimentación');
			break;
		case 'fuente':
			c.primario?.entradas.forEach((x, i) => borne(x, `primario.entradas[${i}]`));
			c.primario?.retornos.forEach((x, i) => borne(x, `primario.retornos[${i}]`));
			c.salidas.forEach((x, i) => borne(x.borne, `salidas[${i}].borne`));
			break;
		case 'proteccion':
			c.polos.forEach((p, i) => revisarPar(p, `polos[${i}]`));
			c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`));
			break;
		case 'mando': c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`)); break;
		case 'sensor':
			c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`));
			if (c.alimentacion) { borne(c.alimentacion.entrada, 'alimentacion.entrada'); borne(c.alimentacion.retorno, 'alimentacion.retorno'); }
			if (c.salidaDigital) { borne(c.salidaDigital.borne, 'salidaDigital.borne'); borne(c.salidaDigital.tomaDe, 'salidaDigital.tomaDe'); }
			break;
		case 'carga':
			c.alimentacion.fases.forEach((x, i) => borne(x, `alimentacion.fases[${i}]`));
			c.alimentacion.retornos.forEach((x, i) => borne(x, `alimentacion.retornos[${i}]`));
			break;
		case 'pasivo': c.conexiones.forEach((p, i) => revisarPar(p, `conexiones[${i}]`)); break;
		case 'sin-comportamiento': break;
	}
	return errores;
}

/**
 * Resuelve el contrato ejecutable. El perfil persistente manda; sin él se conserva el adaptador
 * IEC actual. Una referencia con imagen y sin perfil queda inerte: la imagen no prueba función.
 */
export function resolverComportamiento(d: Dispositivo): ComportamientoSimulacion | undefined {
	if (d.comportamiento) return validarComportamiento(d).length ? undefined : d.comportamiento;
	if (d.imagen) return undefined;
	const bornes = d.bornes;
	const ids = new Set(bornes.map((b) => b.id));
	if ((d.tipo === 'contactor' || d.tipo === 'rele') && ids.has('A1') && ids.has('A2')) {
		return {
			version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
			polos: polosIEC(d), contactos: contactosIEC(d),
		};
	}
	if ((d.tipo === 'contactor' || d.tipo === 'rele') && d.rol?.tipo === 'esclavo') {
		return { version: 1, clase: 'mando', contactos: contactosIEC(d) };
	}
	if (['disyuntor', 'guardamotor', 'diferencial', 'fusible', 'seccionador'].includes(d.tipo)
		|| d.tipo === 'rele' && ids.has('95')) {
		return {
			version: 1, clase: 'proteccion', polos: polosIEC(d), contactos: contactosIEC(d),
			rearmable: d.tipo !== 'fusible',
		};
	}
	if (d.tipo === 'pulsador' || d.tipo === 'selector') {
		return { version: 1, clase: 'mando', contactos: contactosIEC(d) };
	}
	if (d.tipo === 'sensor') {
		const entrada = primerBorne(bornes, ['+24', '+']);
		const retorno = primerBorne(bornes, ['0V', '-']);
		const senal = bornes.find((b) => b.tipo === 'senal')?.id;
		return {
			version: 1, clase: 'sensor', contactos: contactosIEC(d),
			alimentacion: entrada && retorno ? { entrada, retorno } : undefined,
			salidaDigital: entrada && senal ? { borne: senal, tomaDe: entrada } : undefined,
		};
	}
	if (d.tipo === 'plc') {
		const entradas = bornes.filter((b) => ['+24', '+V', '+', '24V', '24V~', 'L'].includes(b.id)).map((b) => b.id);
		const retornos = bornes.filter((b) => ['0V', '-V', '-', 'GND', 'N', '24V COM'].includes(b.id)).map((b) => b.id);
		const salidasDigitales = bornes.filter((b) => /^(DO|Q|BO|CO)\d+$/.test(b.id))
			.map((b) => ({ borne: b.id, comun: comunLegacy(d, b.id) })).filter((x): x is { borne: string; comun: string } => !!x.comun);
		const rangoAO = d.rangoSalidaAnalogica ?? [0, 10] as [number, number];
		const salidasAnalogicas = bornes.filter((b) => /^(AO|Y)\d+$/.test(b.id))
			.map((b) => ({ borne: b.id, referencia: comunLegacy(d, b.id), rango: rangoAO, unidad: 'V' as const }))
			.filter((x): x is { borne: string; referencia: string; rango: [number, number]; unidad: 'V' } => !!x.referencia);
		return { version: 1, clase: 'controlador', alimentacion: { entradas, retornos }, salidasDigitales, salidasAnalogicas };
	}
	if (d.tipo === 'fuente' || d.tipo === 'transformador') {
		const tensionV = d.tensionSecundariaV ?? 24;
		const salidas = bornes.filter((b) => b.lado === 'secundario+' || b.lado === 'secundario-')
			.map((b) => ({ borne: b.id, papel: b.lado === 'secundario+' ? 'fase' as const : 'retorno' as const, tensionV }));
		const entradas = bornes.filter((b) => b.tipo === 'L' || b.id === 'P1' || b.id === 'L').map((b) => b.id);
		const retornos = bornes.filter((b) => b.tipo === 'N' || b.id === 'P2').map((b) => b.id);
		return { version: 1, clase: 'fuente', primario: { entradas, retornos }, salidas };
	}
	if (['motor', 'valvula', 'resistencia', 'piloto', 'condensador'].includes(d.tipo)) {
		const fases = bornes.filter((b) => b.tipo !== 'PE' && b.tipo !== 'N').map((b) => b.id);
		const retornos = bornes.filter((b) => b.tipo === 'N' || /^(N|0V|X2|A2)$/.test(b.id)).map((b) => b.id);
		const efecto = d.tipo === 'motor' ? 'giro' : d.tipo === 'piloto' ? 'luz' : d.tipo === 'valvula'
			? 'movimiento' : d.tipo === 'resistencia' ? 'calor' : 'reactivo';
		return { version: 1, clase: 'carga', alimentacion: { fases, retornos, fasesMinimas: d.polos && d.polos >= 3 ? 3 : 1 }, efecto };
	}
	if (d.tipo === 'bornero') {
		return { version: 1, clase: 'pasivo', conexiones: polosIEC(d) };
	}
	const esAcometida = d.campo && bornes.some((b) => b.tipo === 'L')
		&& (d.clase === 'W' || /acometida|red|alimentaci/i.test(d.descripcion ?? ''));
	if (esAcometida) {
		const tensionV = d.tensionNominal ?? 220;
		return { version: 1, clase: 'fuente', salidas: bornes.filter((b) => b.tipo === 'L' || b.tipo === 'N')
			.map((b) => ({ borne: b.id, papel: b.tipo === 'L' ? 'fase' as const : 'retorno' as const, tensionV })) };
	}
	return { version: 1, clase: 'sin-comportamiento', motivo: `sin adaptador legacy para ${d.tipo}` };
}
