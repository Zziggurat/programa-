/**
 * Perfiles eléctricos que puede elegir el asistente de «Mis Componentes».
 *
 * El perfil se construye únicamente con roles CONFIRMADOS por la persona. Los rótulos IEC se
 * muestran como sugerencias en la UI, pero esta capa no intenta adivinar A1, COM, GND, etc. La
 * salida es un `ComportamientoSimulacion` serializable que queda fotografiado en la definición.
 */
import type {
	ComportamientoSimulacion, ContactoSimulacion, FilaFidelidadSimulacion,
} from '../modelo/comportamiento.js';
import { MATRIZ_FIDELIDAD_SIMULACION, validarComportamiento } from '../modelo/comportamiento.js';
import type { TipoBorne, TipoDispositivo } from '../modelo/tipos.js';

export type RolTerminalPerfil =
	| 'bobina-entrada' | 'bobina-retorno'
	| 'polo-entrada' | 'polo-salida'
	| 'contacto-comun' | 'contacto-na' | 'contacto-nc'
	| 'contacto-posicion-1' | 'contacto-posicion-2'
	| 'alimentacion-entrada' | 'alimentacion-retorno'
	| 'salida-fase' | 'salida-retorno'
	| 'salida-digital' | 'comun-digital'
	| 'entrada-analogica' | 'referencia-entrada-analogica'
	| 'salida-analogica' | 'referencia-analogica' | 'comun-analogico'
	| 'salida-feedback' | 'comun-feedback'
	| 'mando-run' | 'mando-enable'
	| 'salida-u' | 'salida-v' | 'salida-w'
	| 'carga-fase' | 'carga-retorno'
	| 'senal-digital'
	| 'pasivo-a' | 'pasivo-b'
	| 'proteccion' | 'sin-asignar';

export interface TerminalPerfilComponente {
	id: string;
	tipo?: TipoBorne;
	u: number;
	v: number;
	rol: RolTerminalPerfil;
	/** Une dos extremos funcionales. No se deduce del orden de la tabla. */
	grupo?: string;
}

export interface ParametrosConstruccionPerfil {
	tensionV?: number;
	tensionSalidaV?: number;
	corrienteA?: number;
	potenciaW?: number;
	frecuenciaHz?: number;
	fasesMinimas?: 1 | 3;
	modoMando?: 'momentaneo' | 'mantenido';
	posiciones?: 2 | 3;
	reposo?: number;
	rearmable?: boolean;
	polosMotor?: number;
	tiempoArranqueS?: number;
	tiempoParadaS?: number;
	deslizamiento?: number;
	unidadReferencia?: 'V' | 'mA' | 'porcentaje';
	modoEntradaAnalogica?: 'pasiva' | 'activa';
	modoTransmisor?: '2-hilos' | '3-hilos';
	modoSalidaAnalogica?: 'activa' | 'pasiva';
	magnitud?: string;
	failSafe?: 'mantener' | 'cerrar' | 'abrir' | 'posicion-segura';
	posicionSegura?: number;
	tiempoAperturaS?: number;
	tiempoCierreS?: number;
	referenciaMin?: number;
	referenciaMax?: number;
	frecuenciaMinHz?: number;
	frecuenciaMaxHz?: number;
	rampaHzS?: number;
	temporizacionTipo?: 'ninguna' | 'trabajo' | 'reposo';
	retardoSegundos?: number;
	programa?: string;
	rangoSondaMin?: number;
	rangoSondaMax?: number;
	unidadSonda?: string;
}

export type ClaveParametroPerfil = keyof ParametrosConstruccionPerfil;

export interface CampoParametroPerfil {
	clave: ClaveParametroPerfil;
	etiqueta: string;
	tipo: 'numero' | 'texto' | 'seleccion' | 'booleano';
	valorInicial?: string | number | boolean;
	opciones?: readonly { valor: string; etiqueta: string }[];
	min?: number;
	max?: number;
	paso?: number;
}

export interface PerfilBaseComponente {
	id: TipoDispositivo;
	nombre: string;
	descripcion: string;
	fidelidad: FilaFidelidadSimulacion;
	roles: readonly RolTerminalPerfil[];
	parametros: readonly CampoParametroPerfil[];
}

export interface ResultadoConstruccionPerfil {
	comportamiento?: ComportamientoSimulacion;
	errores: string[];
	advertencias: string[];
	/** Propiedades persistentes del dispositivo que no forman parte del contrato eléctrico. */
	propiedades: {
		temporizacion?: { tipo: 'trabajo' | 'reposo'; segundos: number };
		programa?: string;
		rangoSonda?: [number, number];
		unidadSonda?: string;
		rangoSalidaAnalogica?: [number, number];
	};
}

const R = {
	contactos: ['contacto-comun', 'contacto-na', 'contacto-nc'] as const,
	contactosSelector: ['contacto-comun', 'contacto-na', 'contacto-nc', 'contacto-posicion-1', 'contacto-posicion-2'] as const,
	polos: ['polo-entrada', 'polo-salida'] as const,
};

const P = {
	tension: { clave: 'tensionV', etiqueta: 'Tensión nominal (V)', tipo: 'numero', valorInicial: 24, min: 0, paso: 1 },
	corriente: { clave: 'corrienteA', etiqueta: 'Corriente nominal (A)', tipo: 'numero', min: 0, paso: 0.1 },
	potencia: { clave: 'potenciaW', etiqueta: 'Potencia (W)', tipo: 'numero', min: 0, paso: 1 },
	fases: { clave: 'fasesMinimas', etiqueta: 'Alimentación', tipo: 'seleccion', valorInicial: '1', opciones: [
		{ valor: '1', etiqueta: 'Monofásica / CC' }, { valor: '3', etiqueta: 'Trifásica' },
	] },
} as const satisfies Record<string, CampoParametroPerfil>;

const perfil = (
	id: TipoDispositivo, nombre: string, descripcion: string,
	roles: readonly RolTerminalPerfil[], parametros: readonly CampoParametroPerfil[] = [],
): PerfilBaseComponente => ({
	id, nombre, descripcion, roles, parametros,
	fidelidad: MATRIZ_FIDELIDAD_SIMULACION.tipos[id],
});

/** Un registro exhaustivo: agregar un `TipoDispositivo` obliga a declarar su perfil y fidelidad. */
export const PERFILES_BASE = {
	plc: perfil('plc', 'Controlador / PLC', 'Alimentación, salidas digitales y analógicas.', [
		'alimentacion-entrada', 'alimentacion-retorno', 'salida-digital', 'comun-digital',
		'entrada-analogica', 'referencia-entrada-analogica', 'salida-analogica', 'comun-analogico', 'sin-asignar',
	], [P.tension, { clave: 'programa', etiqueta: 'Programa lógico', tipo: 'texto' },
		{ clave: 'unidadReferencia', etiqueta: 'Modo AI/AO', tipo: 'seleccion', valorInicial: 'V', opciones: [
			{ valor: 'V', etiqueta: '0–10 V' }, { valor: 'mA', etiqueta: '4–20 mA' },
		] }, { clave: 'modoEntradaAnalogica', etiqueta: 'Entrada de corriente', tipo: 'seleccion', valorInicial: 'pasiva', opciones: [
			{ valor: 'pasiva', etiqueta: 'Pasiva' }, { valor: 'activa', etiqueta: 'Activa / alimenta lazo' },
		] }, { clave: 'magnitud', etiqueta: 'Magnitud AI', tipo: 'texto', valorInicial: 'variable' },
		{ clave: 'referenciaMin', etiqueta: 'AO mínima (V)', tipo: 'numero', valorInicial: 0 },
		{ clave: 'referenciaMax', etiqueta: 'AO máxima (V)', tipo: 'numero', valorInicial: 10 }]),
	fuente: perfil('fuente', 'Fuente', 'Primario condicionado y salidas de tensión declarada.', [
		'alimentacion-entrada', 'alimentacion-retorno', 'salida-fase', 'salida-retorno', 'proteccion', 'sin-asignar',
	], [P.tension, { clave: 'tensionSalidaV', etiqueta: 'Tensión de salida (V)', tipo: 'numero', valorInicial: 24, min: 0 }]),
	transformador: perfil('transformador', 'Transformador', 'Primario y secundario aislado conceptual.', [
		'alimentacion-entrada', 'alimentacion-retorno', 'salida-fase', 'salida-retorno', 'proteccion', 'sin-asignar',
	], [P.tension, { clave: 'tensionSalidaV', etiqueta: 'Tensión secundaria (V)', tipo: 'numero', valorInicial: 24, min: 0 }]),
	contactor: perfil('contactor', 'Contactor', 'Bobina, polos principales y auxiliares NA/NC.', [
		'bobina-entrada', 'bobina-retorno', ...R.polos, ...R.contactos, 'proteccion', 'sin-asignar',
	], [P.tension, P.corriente]),
	rele: perfil('rele', 'Relé / relé temporizado', 'Bobina, auxiliares y temporización TON/TOF opcional.', [
		'bobina-entrada', 'bobina-retorno', ...R.polos, ...R.contactos, 'sin-asignar',
	], [P.tension,
		{ clave: 'temporizacionTipo', etiqueta: 'Temporización', tipo: 'seleccion', valorInicial: 'ninguna', opciones: [
			{ valor: 'ninguna', etiqueta: 'Sin temporización' }, { valor: 'trabajo', etiqueta: 'A la conexión (TON)' },
			{ valor: 'reposo', etiqueta: 'A la desconexión (TOF)' },
		] }, { clave: 'retardoSegundos', etiqueta: 'Retardo (s)', tipo: 'numero', valorInicial: 1, min: 0, paso: 0.1 }]),
	disyuntor: perfil('disyuntor', 'Disyuntor', 'Polos y contactos auxiliares; disparo conceptual.', [...R.polos, ...R.contactos, 'proteccion', 'sin-asignar'], [P.corriente]),
	guardamotor: perfil('guardamotor', 'Guardamotor', 'Polos y auxiliares; sobrecarga conceptual.', [...R.polos, ...R.contactos, 'proteccion', 'sin-asignar'], [P.corriente]),
	diferencial: perfil('diferencial', 'Interruptor diferencial', 'Conmutación de polos; no calcula corriente residual.', [...R.polos, ...R.contactos, 'proteccion', 'sin-asignar'], [P.corriente]),
	fusible: perfil('fusible', 'Fusible', 'Protección no rearmable con pares de paso.', [...R.polos, ...R.contactos, 'sin-asignar'], [P.corriente]),
	seccionador: perfil('seccionador', 'Seccionador', 'Apertura/cierre de polos y auxiliares.', [...R.polos, ...R.contactos, 'proteccion', 'sin-asignar'], [P.corriente]),
	variador: perfil('variador', 'Variador de frecuencia', 'Potencia, RUN/ENABLE, 0–10 V o %, U/V/W y rampa.', [
		'alimentacion-entrada', 'alimentacion-retorno', 'mando-run', 'mando-enable', 'referencia-analogica',
		'comun-analogico', 'salida-u', 'salida-v', 'salida-w', 'proteccion', 'sin-asignar',
	], [P.tension, P.fases,
		{ clave: 'unidadReferencia', etiqueta: 'Unidad de referencia', tipo: 'seleccion', valorInicial: 'V', opciones: [
			{ valor: 'V', etiqueta: 'Voltios' }, { valor: 'mA', etiqueta: 'Miliamperios' }, { valor: 'porcentaje', etiqueta: 'Porcentaje' },
		] }, { clave: 'referenciaMin', etiqueta: 'Referencia mínima', tipo: 'numero', valorInicial: 0 },
		{ clave: 'referenciaMax', etiqueta: 'Referencia máxima', tipo: 'numero', valorInicial: 10 },
		{ clave: 'frecuenciaMinHz', etiqueta: 'Frecuencia mínima (Hz)', tipo: 'numero', valorInicial: 0, min: 0 },
		{ clave: 'frecuenciaMaxHz', etiqueta: 'Frecuencia máxima (Hz)', tipo: 'numero', valorInicial: 50, min: 0 },
		{ clave: 'rampaHzS', etiqueta: 'Rampa (Hz/s)', tipo: 'numero', valorInicial: 10, min: 0.01 }]),
	motor: perfil('motor', 'Motor', 'Carga de giro monofásica o trifásica.', ['carga-fase', 'carga-retorno', 'proteccion', 'sin-asignar'], [
		P.tension, P.corriente, P.potencia, P.fases,
		{ clave: 'polosMotor', etiqueta: 'Polos magnéticos (opcional)', tipo: 'numero', min: 2, paso: 2 },
		{ clave: 'tiempoArranqueS', etiqueta: 'Tiempo de arranque (s)', tipo: 'numero', valorInicial: 3, min: 0.1, paso: 0.1 },
		{ clave: 'tiempoParadaS', etiqueta: 'Tiempo de parada (s)', tipo: 'numero', valorInicial: 2, min: 0.1, paso: 0.1 },
		{ clave: 'deslizamiento', etiqueta: 'Deslizamiento estimado (0–0,19)', tipo: 'numero', min: 0, max: 0.19, paso: 0.01 },
	]),
	pulsador: perfil('pulsador', 'Pulsador', 'Mando momentáneo con contactos NA/NC.', [...R.contactos, 'sin-asignar'], [
		{ clave: 'modoMando', etiqueta: 'Modo', tipo: 'seleccion', valorInicial: 'momentaneo', opciones: [
			{ valor: 'momentaneo', etiqueta: 'Momentáneo' }, { valor: 'mantenido', etiqueta: 'Mantenido' },
		] },
	]),
	selector: perfil('selector', 'Selector', 'Mando mantenido de dos o tres posiciones.', [...R.contactosSelector, 'sin-asignar'], [
		{ clave: 'posiciones', etiqueta: 'Posiciones', tipo: 'seleccion', valorInicial: '2', opciones: [
			{ valor: '2', etiqueta: '2 posiciones' }, { valor: '3', etiqueta: '3 posiciones' },
		] }, { clave: 'reposo', etiqueta: 'Posición inicial', tipo: 'numero', valorInicial: 0, min: 0, max: 2 },
	]),
	piloto: perfil('piloto', 'Piloto', 'Carga luminosa binaria.', ['carga-fase', 'carga-retorno', 'proteccion', 'sin-asignar'], [P.tension, P.corriente, P.potencia]),
	sensor: perfil('sensor', 'Sensor', 'Contacto, PNP o transmisor 0–10 V/4–20 mA.', [
		'alimentacion-entrada', 'alimentacion-retorno', 'senal-digital', 'salida-analogica', 'comun-analogico',
		...R.contactos, 'proteccion', 'sin-asignar',
	], [P.tension, { clave: 'rangoSondaMin', etiqueta: 'Medida mínima', tipo: 'numero' },
		{ clave: 'rangoSondaMax', etiqueta: 'Medida máxima', tipo: 'numero' },
		{ clave: 'unidadSonda', etiqueta: 'Unidad de medida', tipo: 'texto' },
		{ clave: 'magnitud', etiqueta: 'Magnitud', tipo: 'texto', valorInicial: 'variable' },
		{ clave: 'unidadReferencia', etiqueta: 'Señal analógica', tipo: 'seleccion', valorInicial: 'mA', opciones: [
			{ valor: 'V', etiqueta: '0–10 V' }, { valor: 'mA', etiqueta: '4–20 mA' },
		] }, { clave: 'modoTransmisor', etiqueta: 'Conexión transmisor', tipo: 'seleccion', valorInicial: '3-hilos', opciones: [
			{ valor: '2-hilos', etiqueta: '2 hilos / loop-powered' }, { valor: '3-hilos', etiqueta: '3 hilos' },
		] }, { clave: 'modoSalidaAnalogica', etiqueta: 'Salida', tipo: 'seleccion', valorInicial: 'activa', opciones: [
			{ valor: 'activa', etiqueta: 'Activa' }, { valor: 'pasiva', etiqueta: 'Pasiva' },
		] }]),
	valvula: perfil('valvula', 'Válvula / actuador', 'Carga binaria o actuador modulante 0–100 %.', [
		'carga-fase', 'carga-retorno', 'referencia-analogica', 'comun-analogico',
		'salida-feedback', 'comun-feedback', 'proteccion', 'sin-asignar',
	], [P.tension, P.corriente, P.potencia,
		{ clave: 'unidadReferencia', etiqueta: 'Unidad de mando', tipo: 'seleccion', valorInicial: 'V', opciones: [
			{ valor: 'V', etiqueta: 'Voltios' }, { valor: 'mA', etiqueta: 'Miliamperios' }, { valor: 'porcentaje', etiqueta: 'Porcentaje' },
		] }, { clave: 'referenciaMin', etiqueta: 'Mando mínimo', tipo: 'numero', valorInicial: 0 },
		{ clave: 'referenciaMax', etiqueta: 'Mando máximo', tipo: 'numero', valorInicial: 10 },
		{ clave: 'tiempoAperturaS', etiqueta: 'Tiempo de apertura (s)', tipo: 'numero', valorInicial: 10, min: 0 },
		{ clave: 'tiempoCierreS', etiqueta: 'Tiempo de cierre (s)', tipo: 'numero', valorInicial: 10, min: 0 },
		{ clave: 'failSafe', etiqueta: 'Pérdida de señal', tipo: 'seleccion', valorInicial: 'cerrar', opciones: [
			{ valor: 'cerrar', etiqueta: 'Cerrar' }, { valor: 'abrir', etiqueta: 'Abrir' },
			{ valor: 'mantener', etiqueta: 'Mantener' }, { valor: 'posicion-segura', etiqueta: 'Posición segura' },
		] }, { clave: 'posicionSegura', etiqueta: 'Posición segura (%)', tipo: 'numero', valorInicial: 0, min: 0, max: 100 }]),
	resistencia: perfil('resistencia', 'Resistencia', 'Carga térmica conceptual.', ['carga-fase', 'carga-retorno', 'proteccion', 'sin-asignar'], [P.tension, P.corriente, P.potencia]),
	condensador: perfil('condensador', 'Condensador', 'Carga reactiva sin transitorio ni reactancia.', ['carga-fase', 'carga-retorno', 'proteccion', 'sin-asignar'], [P.tension, P.corriente]),
	bornero: perfil('bornero', 'Bornero / paso', 'Conectividad pasiva mediante pares explícitos.', ['pasivo-a', 'pasivo-b', 'proteccion', 'sin-asignar']),
	cable: perfil('cable', 'Cable como aparato', 'No participa: los conductores del proyecto son otra entidad.', ['sin-asignar']),
	otro: perfil('otro', 'Otro / referencia', 'Sin función automática hasta disponer de un contrato específico.', ['sin-asignar']),
} as const satisfies Record<TipoDispositivo, PerfilBaseComponente>;

export const LISTA_PERFILES_BASE: readonly PerfilBaseComponente[] = Object.values(PERFILES_BASE);

const limpio = (s: string | undefined): string => s?.trim() ?? '';
const numero = (n: number | undefined, defecto: number): number => Number.isFinite(n) ? n! : defecto;

/** Construye el contrato sin usar ids IEC ni el orden del array. */
export function construirComportamientoPerfil(
	tipo: TipoDispositivo,
	terminalesEntrada: readonly TerminalPerfilComponente[],
	parametros: Readonly<ParametrosConstruccionPerfil> = {},
): ResultadoConstruccionPerfil {
	const errores: string[] = [];
	const advertencias: string[] = [];
	const propiedades: ResultadoConstruccionPerfil['propiedades'] = {};
	const terminales = terminalesEntrada
		.map((t) => ({ ...t, id: limpio(t.id), grupo: limpio(t.grupo) || undefined }))
		.sort((a, b) => a.id.localeCompare(b.id));
	const ids = new Set<string>();
	const rolesPermitidos = new Set<RolTerminalPerfil>(PERFILES_BASE[tipo].roles);
	for (const [i, t] of terminales.entries()) {
		if (!t.id) errores.push(`terminal ${i + 1}: falta el ID`);
		else if (ids.has(t.id)) errores.push(`el terminal «${t.id}» está repetido`);
		else ids.add(t.id);
		if (!Number.isFinite(t.u) || t.u < 0 || t.u > 1 || !Number.isFinite(t.v) || t.v < 0 || t.v > 1) {
			errores.push(`terminal «${t.id || i + 1}»: u/v debe estar entre 0 y 1`);
		}
		if (!rolesPermitidos.has(t.rol)) errores.push(`el rol «${t.rol}» no pertenece al perfil ${tipo}`);
	}
	const porRol = (rol: RolTerminalPerfil) => terminales.filter((t) => t.rol === rol);
	const uno = (rol: RolTerminalPerfil, etiqueta: string, opcional = false): string | undefined => {
		const candidatos = porRol(rol);
		if (!candidatos.length) { if (!opcional) errores.push(`falta asignar ${etiqueta}`); return undefined; }
		if (candidatos.length > 1) errores.push(`${etiqueta} debe corresponder a un solo terminal`);
		return candidatos[0]?.id;
	};
	const agrupados = (roles: readonly RolTerminalPerfil[], etiqueta: string): Map<string, Map<RolTerminalPerfil, string[]>> => {
		const grupos = new Map<string, Map<RolTerminalPerfil, string[]>>();
		for (const t of terminales.filter((x) => roles.includes(x.rol))) {
			if (!t.grupo) { errores.push(`terminal «${t.id}»: falta grupo para ${etiqueta}`); continue; }
			const g = grupos.get(t.grupo) ?? new Map<RolTerminalPerfil, string[]>();
			g.set(t.rol, [...(g.get(t.rol) ?? []), t.id]); grupos.set(t.grupo, g);
		}
		return grupos;
	};
	const pares = (a: RolTerminalPerfil, b: RolTerminalPerfil, etiqueta: string) => {
		const salida: { entrada: string; salida: string }[] = [];
		for (const [grupo, roles] of agrupados([a, b], etiqueta)) {
			const aa = roles.get(a) ?? []; const bb = roles.get(b) ?? [];
			if (aa.length !== 1 || bb.length !== 1) errores.push(`${etiqueta} «${grupo}» necesita exactamente un extremo de cada rol`);
			else salida.push({ entrada: aa[0], salida: bb[0] });
		}
		return salida;
	};
	const contactos = (selector = false): ContactoSimulacion[] => {
		const roles: RolTerminalPerfil[] = ['contacto-comun', 'contacto-na', 'contacto-nc'];
		if (selector) roles.push('contacto-posicion-1', 'contacto-posicion-2');
		const salida: ContactoSimulacion[] = [];
		for (const [grupo, mapa] of agrupados(roles, 'contacto')) {
			const comunes = mapa.get('contacto-comun') ?? [];
			const extremos = roles.slice(1).flatMap((rol) => (mapa.get(rol) ?? []).map((id) => ({ id, rol })));
			if (comunes.length !== 1 || extremos.length === 0) {
				errores.push(`contacto «${grupo}» necesita un común y al menos una salida`); continue;
			}
			for (const extremo of extremos) {
				const cerradoEn = extremo.rol === 'contacto-posicion-1' ? [1]
					: extremo.rol === 'contacto-posicion-2' ? [2] : undefined;
				salida.push({
					entrada: comunes[0], salida: extremo.id,
					reposo: extremo.rol === 'contacto-nc' ? 'cerrado' : 'abierto', funcion: 'auxiliar',
					...(cerradoEn ? { cerradoEn } : {}),
				});
			}
		}
		return salida;
	};

	let comportamiento: ComportamientoSimulacion | undefined;
	if (tipo === 'contactor' || tipo === 'rele') {
		const entrada = uno('bobina-entrada', 'la entrada de bobina');
		const retorno = uno('bobina-retorno', 'el retorno de bobina');
		const polos = pares('polo-entrada', 'polo-salida', 'polo');
		const cs = contactos();
		if (tipo === 'contactor' && polos.length === 0) errores.push('un contactor necesita al menos un polo principal');
		if (entrada && retorno) comportamiento = { version: 1, clase: 'contactos-electromagneticos', bobina: { entrada, retorno }, polos, contactos: cs };
		if (parametros.temporizacionTipo && parametros.temporizacionTipo !== 'ninguna') {
			const segundos = numero(parametros.retardoSegundos, 0);
			if (tipo !== 'rele') advertencias.push('la temporización solo se guarda en perfiles de relé');
			else if (segundos < 0) errores.push('el retardo no puede ser negativo');
			else propiedades.temporizacion = { tipo: parametros.temporizacionTipo, segundos };
		}
	} else if (['disyuntor', 'guardamotor', 'diferencial', 'fusible', 'seccionador'].includes(tipo)) {
		const polos = pares('polo-entrada', 'polo-salida', 'polo');
		const cs = contactos();
		if (!polos.length) errores.push('la protección necesita al menos un polo');
		const funcion = tipo === 'fusible' ? 'fusible' as const : tipo === 'diferencial' ? 'diferencial' as const
			: tipo === 'seccionador' ? 'seccionamiento' as const : 'termomagnetico' as const;
		comportamiento = { version: 1, clase: 'proteccion', polos, contactos: cs,
			rearmable: tipo === 'fusible' ? false : parametros.rearmable ?? true, funcion };
	} else if (tipo === 'pulsador' || tipo === 'selector') {
		const posiciones = tipo === 'selector' ? parametros.posiciones ?? 2 : 2;
		const reposo = Math.trunc(numero(parametros.reposo, 0));
		const cs = contactos(tipo === 'selector');
		if (!cs.length) errores.push('el mando necesita al menos un contacto');
		comportamiento = { version: 1, clase: 'mando', modo: tipo === 'pulsador' ? parametros.modoMando ?? 'momentaneo' : 'mantenido', posiciones, reposo, contactos: cs };
	} else if (tipo === 'fuente' || tipo === 'transformador') {
		const entradas = porRol('alimentacion-entrada').map((t) => t.id);
		const retornos = porRol('alimentacion-retorno').map((t) => t.id);
		const tensionV = numero(parametros.tensionSalidaV, 24);
		if (!entradas.length || !retornos.length) errores.push('declara entrada y retorno del primario');
		if (tensionV <= 0) errores.push('la tensión de salida debe ser positiva');
		const salidas = [
			...porRol('salida-fase').map((t) => ({ borne: t.id, papel: 'fase' as const, tensionV })),
			...porRol('salida-retorno').map((t) => ({ borne: t.id, papel: 'retorno' as const, tensionV })),
		];
		if (!salidas.some((x) => x.papel === 'fase') || !salidas.some((x) => x.papel === 'retorno')) errores.push('declara fase/+ y retorno del secundario');
		comportamiento = { version: 1, clase: 'fuente', primario: { entradas, retornos }, salidas };
	} else if (tipo === 'plc') {
		const entradas = porRol('alimentacion-entrada').map((t) => t.id);
		const retornos = porRol('alimentacion-retorno').map((t) => t.id);
		const salidasDigitales = pares('salida-digital', 'comun-digital', 'salida digital')
			.map((p) => ({ borne: p.entrada, comun: p.salida }));
		const unidad = parametros.unidadReferencia === 'mA' ? 'mA' as const : 'V' as const;
		const minimo = numero(parametros.referenciaMin, unidad === 'mA' ? 4 : 0);
		const maximo = numero(parametros.referenciaMax, unidad === 'mA' ? 20 : 10);
		const salidasAnalogicas = pares('salida-analogica', 'comun-analogico', 'salida analógica')
			.map((p) => ({ borne: p.entrada, referencia: p.salida, rango: [minimo, maximo] as [number, number], unidad }));
		const variable = {
			magnitud: parametros.magnitud?.trim() || 'variable', unidad: parametros.unidadSonda?.trim() || '%',
			minimo: numero(parametros.rangoSondaMin, 0), maximo: numero(parametros.rangoSondaMax, 100),
		};
		const entradasAnalogicas = pares('entrada-analogica', 'referencia-entrada-analogica', 'entrada analógica')
			.map((p) => ({ borne: p.entrada, comun: p.salida, rango: [minimo, maximo] as [number, number], unidad,
				variable, modoEntrada: parametros.modoEntradaAnalogica ?? 'pasiva' }));
		comportamiento = { version: 1, clase: 'controlador', alimentacion: { entradas, retornos },
			salidasDigitales, salidasAnalogicas, ...(entradasAnalogicas.length ? { entradasAnalogicas } : {}) };
		if (parametros.programa?.trim()) propiedades.programa = parametros.programa.trim();
		propiedades.rangoSalidaAnalogica = [minimo, maximo];
	} else if (tipo === 'sensor') {
		const entrada = uno('alimentacion-entrada', 'la alimentación del sensor', true);
		const retorno = uno('alimentacion-retorno', 'el retorno del sensor', true);
		if (!!entrada !== !!retorno) errores.push('la alimentación del sensor necesita entrada y retorno');
		const senal = uno('senal-digital', 'la salida digital del sensor', true);
		if (senal && !entrada) errores.push('una salida activa del sensor necesita alimentación');
		const cs = contactos();
		const salidaAnalogica = uno('salida-analogica', 'la salida analógica', true);
		const comunAnalogico = uno('comun-analogico', 'el común analógico', true);
		if (!!salidaAnalogica !== !!comunAnalogico) errores.push('la salida analógica necesita señal y común/lazo');
		if (!senal && !cs.length && !salidaAnalogica) errores.push('declara una salida digital, analógica o un contacto seco');
		const unidad = parametros.unidadReferencia === 'V' ? 'V' as const : 'mA' as const;
		const minimoFisico = numero(parametros.rangoSondaMin, 0);
		const maximoFisico = numero(parametros.rangoSondaMax, 100);
		const transmisor = salidaAnalogica && comunAnalogico ? {
			modoConexion: parametros.modoTransmisor ?? '3-hilos' as const,
			salida: { borne: salidaAnalogica, comun: comunAnalogico, unidad,
				rango: [unidad === 'V' ? 0 : 4, unidad === 'V' ? 10 : 20] as [number, number] },
			variable: { magnitud: parametros.magnitud?.trim() || 'variable', unidad: parametros.unidadSonda?.trim() || '%',
				minimo: minimoFisico, maximo: maximoFisico },
			modoSalida: parametros.modoSalidaAnalogica ?? (parametros.modoTransmisor === '2-hilos' ? 'pasiva' : 'activa') as 'activa' | 'pasiva',
		} : undefined;
		comportamiento = { version: 1, clase: 'sensor', contactos: cs,
			...(entrada && retorno ? { alimentacion: { entrada, retorno } } : {}),
			...(senal && entrada ? { salidaDigital: { borne: senal, tomaDe: entrada } } : {}),
			...(transmisor ? { transmisor } : {}),
		};
		if (Number.isFinite(parametros.rangoSondaMin) && Number.isFinite(parametros.rangoSondaMax)) {
			const r: [number, number] = [parametros.rangoSondaMin!, parametros.rangoSondaMax!];
			if (r[1] <= r[0]) errores.push('el rango de sonda debe crecer de mínimo a máximo');
			else propiedades.rangoSonda = r;
		}
		if (parametros.unidadSonda?.trim()) propiedades.unidadSonda = parametros.unidadSonda.trim();
	} else if (tipo === 'variador') {
		const fases = porRol('alimentacion-entrada').map((t) => t.id);
		const retornos = porRol('alimentacion-retorno').map((t) => t.id);
		const fasesMinimas = parametros.fasesMinimas ?? (fases.length >= 3 ? 3 : 1);
		const run = uno('mando-run', 'la entrada RUN'); const habilitacion = uno('mando-enable', 'la entrada ENABLE', true);
		const borne = uno('referencia-analogica', 'la referencia analógica'); const comun = uno('comun-analogico', 'el común analógico');
		const u = uno('salida-u', 'la salida U'); const v = uno('salida-v', 'la salida V'); const w = uno('salida-w', 'la salida W');
		const minimo = numero(parametros.referenciaMin, 0); const maximo = numero(parametros.referenciaMax, parametros.unidadReferencia === 'porcentaje' ? 100 : 10);
		if (run && borne && comun && u && v && w) comportamiento = {
			version: 1, clase: 'variador', alimentacion: { fases, retornos, fasesMinimas }, mando: { run, ...(habilitacion ? { habilitacion } : {}) },
			referencia: { borne, comun, unidad: parametros.unidadReferencia ?? 'V', rango: [minimo, maximo] },
			salida: { u, v, w, tensionV: numero(parametros.tensionV, 220) }, frecuencia: {
				minimaHz: numero(parametros.frecuenciaMinHz, 0), maximaHz: numero(parametros.frecuenciaMaxHz, 50), rampaHzS: numero(parametros.rampaHzS, 10),
			},
		};
	} else if (['motor', 'piloto', 'valvula', 'resistencia', 'condensador'].includes(tipo)) {
		const fases = porRol('carga-fase').map((t) => t.id); const retornos = porRol('carga-retorno').map((t) => t.id);
		const fasesMinimas = parametros.fasesMinimas ?? (tipo === 'motor' && fases.length >= 3 ? 3 : 1);
		if (fases.length < fasesMinimas) errores.push(`la carga necesita ${fasesMinimas} terminal(es) de fase`);
		if (fasesMinimas === 1 && !retornos.length) errores.push('la carga monofásica/CC necesita retorno');
		const efecto = tipo === 'motor' ? 'giro' : tipo === 'piloto' ? 'luz' : tipo === 'valvula' ? 'movimiento'
			: tipo === 'resistencia' ? 'calor' : 'reactivo';
		let mandoAnalogico: Extract<ComportamientoSimulacion, { clase: 'carga' }>['mandoAnalogico'];
		const refs = porRol('referencia-analogica'); const comunes = porRol('comun-analogico');
		if (refs.length || comunes.length) {
			const borne = uno('referencia-analogica', 'la referencia analógica'); const comun = uno('comun-analogico', 'el común analógico');
			if (borne && comun) mandoAnalogico = { borne, comun, unidad: parametros.unidadReferencia ?? 'V', rango: [numero(parametros.referenciaMin, 0), numero(parametros.referenciaMax, 10)] };
		}
		const feedbackBorne = uno('salida-feedback', 'la salida de feedback', true);
		const feedbackComun = uno('comun-feedback', 'el común de feedback', true);
		if (!!feedbackBorne !== !!feedbackComun) errores.push('el feedback necesita señal y común');
		const dinamicaMotor = tipo === 'motor' ? {
			...(Number.isInteger(parametros.polosMotor) && parametros.polosMotor! >= 2
				? { polos: parametros.polosMotor } : {}),
			...(Number.isFinite(parametros.tiempoArranqueS) && parametros.tiempoArranqueS! > 0
				? { tiempoArranqueS: parametros.tiempoArranqueS } : {}),
			...(Number.isFinite(parametros.tiempoParadaS) && parametros.tiempoParadaS! > 0
				? { tiempoParadaS: parametros.tiempoParadaS } : {}),
			...(Number.isFinite(parametros.deslizamiento) && parametros.deslizamiento! >= 0
				&& parametros.deslizamiento! < 0.2 ? { deslizamiento: parametros.deslizamiento } : {}),
		} : undefined;
		const dinamicaActuador = tipo === 'valvula' ? {
			tipo: mandoAnalogico ? 'modulante' as const : 'on-off' as const,
			tiempoAperturaS: Math.max(0, numero(parametros.tiempoAperturaS, 10)),
			tiempoCierreS: Math.max(0, numero(parametros.tiempoCierreS, 10)),
			failSafe: parametros.failSafe ?? 'cerrar' as const,
			...(parametros.failSafe === 'posicion-segura'
				? { posicionSegura: Math.max(0, Math.min(100, numero(parametros.posicionSegura, 0))) } : {}),
			...(feedbackBorne && feedbackComun && parametros.unidadReferencia !== 'porcentaje' ? {
				feedback: { borne: feedbackBorne, comun: feedbackComun,
					unidad: parametros.unidadReferencia === 'mA' ? 'mA' as const : 'V' as const,
					rango: parametros.unidadReferencia === 'mA' ? [4, 20] as [number, number] : [0, 10] as [number, number] },
			} : {}),
		} : undefined;
		comportamiento = { version: 1, clase: 'carga', alimentacion: { fases, retornos, fasesMinimas }, efecto,
			...(mandoAnalogico ? { mandoAnalogico } : {}), ...(dinamicaMotor ? { dinamicaMotor } : {}),
			...(dinamicaActuador ? { dinamicaActuador } : {}) };
	} else if (tipo === 'bornero') {
		const conexiones = pares('pasivo-a', 'pasivo-b', 'paso');
		if (!conexiones.length) errores.push('el bornero necesita al menos un par de paso');
		comportamiento = { version: 1, clase: 'pasivo', conexiones };
	} else {
		comportamiento = { version: 1, clase: 'sin-comportamiento', motivo: tipo === 'cable'
			? 'los conductores se modelan como entidades del proyecto, no como aparatos'
			: 'referencia personalizada sin contrato eléctrico ejecutable' };
	}

	if (comportamiento) {
		const erroresContrato = validarComportamiento({
			bornes: terminales.map(({ id, tipo, u, v }) => ({ id, tipo, u, v })), comportamiento,
		});
		errores.push(...erroresContrato);
	}
	return { comportamiento, errores: [...new Set(errores)], advertencias: [...new Set(advertencias)], propiedades };
}

/** Reconstruye la tabla al editar sin re-inferir roles desde los rótulos. */
export function rolesDesdeComportamiento(
	terminales: readonly { id: string; tipo?: TipoBorne; u: number; v: number }[],
	comportamiento: ComportamientoSimulacion,
): TerminalPerfilComponente[] {
	const salida: TerminalPerfilComponente[] = terminales.map((t) => ({
		...t, rol: 'sin-asignar' as RolTerminalPerfil,
	}));
	const asignar = (id: string, rol: RolTerminalPerfil, grupo?: string) => {
		const t = salida.find((x) => x.id === id); if (t) { t.rol = rol; t.grupo = grupo; }
	};
	const asignarPares = (pares: readonly { entrada: string; salida: string }[], a: RolTerminalPerfil, b: RolTerminalPerfil, prefijo: string) =>
		pares.forEach((p, i) => { const g = `${prefijo}-${i + 1}`; asignar(p.entrada, a, g); asignar(p.salida, b, g); });
	const gruposContacto = new Map<string, string>();
	const asignarContactos = (contactos: readonly ContactoSimulacion[]) => contactos.forEach((c) => {
		const g = gruposContacto.get(c.entrada) ?? `contacto-${gruposContacto.size + 1}`;
		gruposContacto.set(c.entrada, g); asignar(c.entrada, 'contacto-comun', g);
		const rol = c.cerradoEn?.includes(2) ? 'contacto-posicion-2' : c.cerradoEn?.includes(1) ? 'contacto-posicion-1'
			: c.reposo === 'cerrado' ? 'contacto-nc' : 'contacto-na';
		asignar(c.salida, rol, g);
	});
	switch (comportamiento.clase) {
		case 'contactos-electromagneticos':
			asignar(comportamiento.bobina.entrada, 'bobina-entrada'); asignar(comportamiento.bobina.retorno, 'bobina-retorno');
			asignarPares(comportamiento.polos, 'polo-entrada', 'polo-salida', 'polo'); asignarContactos(comportamiento.contactos); break;
		case 'proteccion': asignarPares(comportamiento.polos, 'polo-entrada', 'polo-salida', 'polo'); asignarContactos(comportamiento.contactos); break;
		case 'mando': asignarContactos(comportamiento.contactos); break;
		case 'fuente':
			comportamiento.primario?.entradas.forEach((x) => asignar(x, 'alimentacion-entrada'));
			comportamiento.primario?.retornos.forEach((x) => asignar(x, 'alimentacion-retorno'));
			comportamiento.salidas.forEach((x) => asignar(x.borne, x.papel === 'fase' ? 'salida-fase' : 'salida-retorno')); break;
		case 'controlador':
			comportamiento.alimentacion.entradas.forEach((x) => asignar(x, 'alimentacion-entrada'));
			comportamiento.alimentacion.retornos.forEach((x) => asignar(x, 'alimentacion-retorno'));
			comportamiento.salidasDigitales.forEach((x, i) => { const g = `do-${i + 1}`; asignar(x.borne, 'salida-digital', g); asignar(x.comun, 'comun-digital', g); });
			comportamiento.entradasAnalogicas?.forEach((x, i) => { const g = `ai-${i + 1}`; asignar(x.borne, 'entrada-analogica', g); asignar(x.comun, 'referencia-entrada-analogica', g); });
			comportamiento.salidasAnalogicas.forEach((x, i) => { const g = `ao-${i + 1}`; asignar(x.borne, 'salida-analogica', g); asignar(x.referencia, 'comun-analogico', g); }); break;
		case 'sensor':
			if (comportamiento.alimentacion) { asignar(comportamiento.alimentacion.entrada, 'alimentacion-entrada'); asignar(comportamiento.alimentacion.retorno, 'alimentacion-retorno'); }
			if (comportamiento.salidaDigital) asignar(comportamiento.salidaDigital.borne, 'senal-digital');
			if (comportamiento.transmisor) { asignar(comportamiento.transmisor.salida.borne, 'salida-analogica'); asignar(comportamiento.transmisor.salida.comun, 'comun-analogico'); }
			asignarContactos(comportamiento.contactos); break;
		case 'variador':
			comportamiento.alimentacion.fases.forEach((x) => asignar(x, 'alimentacion-entrada')); comportamiento.alimentacion.retornos.forEach((x) => asignar(x, 'alimentacion-retorno'));
			asignar(comportamiento.mando.run, 'mando-run'); if (comportamiento.mando.habilitacion) asignar(comportamiento.mando.habilitacion, 'mando-enable');
			asignar(comportamiento.referencia.borne, 'referencia-analogica'); asignar(comportamiento.referencia.comun, 'comun-analogico');
			asignar(comportamiento.salida.u, 'salida-u'); asignar(comportamiento.salida.v, 'salida-v'); asignar(comportamiento.salida.w, 'salida-w'); break;
		case 'carga':
			comportamiento.alimentacion.fases.forEach((x) => asignar(x, 'carga-fase')); comportamiento.alimentacion.retornos.forEach((x) => asignar(x, 'carga-retorno'));
			if (comportamiento.mandoAnalogico) { asignar(comportamiento.mandoAnalogico.borne, 'referencia-analogica'); asignar(comportamiento.mandoAnalogico.comun, 'comun-analogico'); }
			if (comportamiento.dinamicaActuador?.feedback) { asignar(comportamiento.dinamicaActuador.feedback.borne, 'salida-feedback'); asignar(comportamiento.dinamicaActuador.feedback.comun, 'comun-feedback'); } break;
		case 'pasivo': asignarPares(comportamiento.conexiones, 'pasivo-a', 'pasivo-b', 'paso'); break;
		case 'sin-comportamiento': break;
	}
	return salida;
}
