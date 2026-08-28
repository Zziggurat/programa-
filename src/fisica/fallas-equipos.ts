import type { TipoFalloRuntime } from '../motores/fallos-runtime.js';
import type { Complejo } from './complejos.js';
import type { FallaFisicaRuntime } from './fallas.js';

export type CodigoFallaEquipo =
	| 'CONDUCTOR_ABIERTO' | 'RESISTENCIA_ELEVADA' | 'CORTO_LN' | 'CORTO_LL' | 'CORTO_LPE' | 'CORTO_3F' | 'NEUTRO_ABIERTO'
	| 'BOBINA_ABIERTA' | 'CONTACTO_NO_CIERRA' | 'CONTACTO_SOLDADO' | 'CONTACTO_RESISTIVO' | 'FASE_NO_CIERRA' | 'BOBINA_EN_CORTO'
	| 'FUSIBLE_ABIERTO' | 'DISYUNTOR_DISPARADO' | 'FALLO_APERTURA'
	| 'ROTOR_BLOQUEADO' | 'PERDIDA_FASE' | 'SOBRECARGA_MECANICA' | 'FASE_INTERNA_ABIERTA'
	| 'SECUNDARIO_ABIERTO' | 'SOBRECARGA_TRANSFORMADOR' | 'FASE_ABIERTA_TRANSFORMADOR'
	| 'VFD_UNDERVOLTAGE' | 'VFD_REFERENCE_LOSS' | 'VFD_OVERLOAD' | 'VFD_EXTERNAL_FAULT'
	| 'SENSOR_CIRCUITO_ABIERTO' | 'SENSOR_CORTO' | 'SENSOR_STUCK' | 'SENSOR_OFFSET' | 'SENSOR_DRIFT' | 'SENSOR_FUERA_RANGO'
	| 'PLC_STOP' | 'PLC_FAULT' | 'PLC_FORCE' | 'PLC_BAD_AI' | 'PLC_BAD_AO' | 'PLC_IO_MAPPING';

export type FamiliaFallaEquipo = 'conductor' | 'contacto' | 'proteccion' | 'motor' | 'transformador'
	| 'variador' | 'sensor' | 'controlador';

export type ObjetivoFallaEquipo =
	| { tipo: 'CONDUCTOR'; conductorId: string }
	| { tipo: 'CONTACTO'; dispositivoId: string; terminales: [string, string]; ramaId?: string }
	| { tipo: 'DISPOSITIVO'; dispositivoId: string }
	| { tipo: 'TRANSFORMADOR'; dispositivoId: string }
	| { tipo: 'NODOS'; nodoA: string; nodoB: string; dispositivoId?: string }
	| { tipo: 'CANAL'; dispositivoId: string; borneId: string };

export interface ParametrosFallaEquipo {
	resistenciaOhm?: number;
	impedanciaOhm?: Complejo;
	valor?: number;
	porcentaje?: number;
}

export interface FallaEquipoRuntime {
	id: string;
	codigo: CodigoFallaEquipo;
	objetivo: ObjetivoFallaEquipo;
	parametros?: ParametrosFallaEquipo;
}

export interface DefinicionFallaEquipo {
	codigo: CodigoFallaEquipo;
	familia: FamiliaFallaEquipo;
	efectos: readonly ('TOPOLOGIA' | 'PARAMETRO_FISICO' | 'ESTADO_FUNCIONAL')[];
	modelado: 'MODELADO' | 'PARCIAL' | 'NO_MODELADO';
	descripcion: string;
}

export interface DiagnosticoBaseFallaEquipo {
	fallaId: string;
	codigo: CodigoFallaEquipo;
	estado: 'APLICADA' | 'PARCIAL' | 'NO_MODELADA' | 'DIAGNOSTICO_INDETERMINADO';
	mensaje: string;
	origen: 'INYECTADO' | 'NO_MODELADO';
}

export interface EfectosFallasEquipo {
	fisicas: FallaFisicaRuntime[];
	funcionales: Map<string, TipoFalloRuntime[]>;
	parchesEstado: Map<string, Record<string, unknown>>;
	diagnosticos: DiagnosticoBaseFallaEquipo[];
}

const definicion = (codigo: CodigoFallaEquipo, familia: FamiliaFallaEquipo,
	efectos: DefinicionFallaEquipo['efectos'], modelado: DefinicionFallaEquipo['modelado'], descripcion: string): DefinicionFallaEquipo =>
	({ codigo, familia, efectos, modelado, descripcion });

export const BIBLIOTECA_FALLAS_EQUIPO: ReadonlyMap<CodigoFallaEquipo, DefinicionFallaEquipo> = new Map([
	definicion('CONDUCTOR_ABIERTO', 'conductor', ['TOPOLOGIA'], 'MODELADO', 'Abre una rama de conductor.'),
	definicion('RESISTENCIA_ELEVADA', 'conductor', ['PARAMETRO_FISICO'], 'MODELADO', 'Añade resistencia serie.'),
	definicion('NEUTRO_ABIERTO', 'conductor', ['TOPOLOGIA'], 'MODELADO', 'Abre el conductor neutro indicado.'),
	...(['CORTO_LN', 'CORTO_LL', 'CORTO_LPE', 'CORTO_3F'] as const).map((c) =>
		definicion(c, 'conductor', ['TOPOLOGIA'], 'MODELADO', 'Inserta una impedancia de falla entre nodos.')),
	definicion('BOBINA_ABIERTA', 'contacto', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Impide excitar la bobina.'),
	definicion('CONTACTO_NO_CIERRA', 'contacto', ['TOPOLOGIA'], 'MODELADO', 'Impide cerrar el par seleccionado.'),
	definicion('FASE_NO_CIERRA', 'contacto', ['TOPOLOGIA'], 'MODELADO', 'Impide cerrar un polo de potencia.'),
	definicion('CONTACTO_SOLDADO', 'contacto', ['TOPOLOGIA'], 'MODELADO', 'Fuerza cerrado el par seleccionado.'),
	definicion('CONTACTO_RESISTIVO', 'contacto', ['PARAMETRO_FISICO'], 'MODELADO', 'Añade resistencia al contacto físico.'),
	definicion('BOBINA_EN_CORTO', 'contacto', [], 'NO_MODELADO', 'Requiere impedancia de bobina aún no modelada.'),
	definicion('FUSIBLE_ABIERTO', 'proteccion', ['ESTADO_FUNCIONAL', 'TOPOLOGIA'], 'MODELADO', 'Funde y abre el fusible.'),
	definicion('DISYUNTOR_DISPARADO', 'proteccion', ['ESTADO_FUNCIONAL', 'TOPOLOGIA'], 'MODELADO', 'Dispara y abre la protección.'),
	definicion('FALLO_APERTURA', 'proteccion', ['ESTADO_FUNCIONAL'], 'PARCIAL', 'Inyecta una negativa de apertura no certificada.'),
	definicion('ROTOR_BLOQUEADO', 'motor', ['ESTADO_FUNCIONAL', 'PARAMETRO_FISICO'], 'MODELADO', 'Fuerza rpm cero y corriente estimada de bloqueo.'),
	definicion('PERDIDA_FASE', 'motor', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Declara pérdida de fase funcional.'),
	definicion('SOBRECARGA_MECANICA', 'motor', ['ESTADO_FUNCIONAL', 'PARAMETRO_FISICO'], 'MODELADO', 'Eleva la corriente mecánica estimada.'),
	definicion('FASE_INTERNA_ABIERTA', 'motor', [], 'NO_MODELADO', 'Requiere un circuito interno de devanados.'),
	definicion('SECUNDARIO_ABIERTO', 'transformador', ['TOPOLOGIA'], 'MODELADO', 'Abre el acoplamiento del transformador indicado.'),
	definicion('SOBRECARGA_TRANSFORMADOR', 'transformador', [], 'PARCIAL', 'Se detecta por carga; no se inventa una carga adicional.'),
	definicion('FASE_ABIERTA_TRANSFORMADOR', 'transformador', [], 'NO_MODELADO', 'El modelo trifásico de transformador no está disponible.'),
	definicion('VFD_UNDERVOLTAGE', 'variador', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Inyecta subtensión de runtime.'),
	definicion('VFD_REFERENCE_LOSS', 'variador', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Inyecta pérdida de referencia.'),
	definicion('VFD_OVERLOAD', 'variador', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Inyecta sobrecarga del VFD.'),
	definicion('VFD_EXTERNAL_FAULT', 'variador', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Inyecta FAULT externo.'),
	definicion('SENSOR_CIRCUITO_ABIERTO', 'sensor', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Abre la señal analógica.'),
	definicion('SENSOR_CORTO', 'sensor', [], 'NO_MODELADO', 'Necesita nodos físicos explícitos del canal.'),
	definicion('SENSOR_STUCK', 'sensor', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Fija la lectura al valor indicado.'),
	definicion('SENSOR_OFFSET', 'sensor', ['ESTADO_FUNCIONAL'], 'PARCIAL', 'Aplica offset al valor de ensayo.'),
	definicion('SENSOR_DRIFT', 'sensor', [], 'NO_MODELADO', 'Necesita una ley temporal declarada.'),
	definicion('SENSOR_FUERA_RANGO', 'sensor', ['ESTADO_FUNCIONAL'], 'MODELADO', 'Marca señal fuera de rango.'),
	definicion('PLC_STOP', 'controlador', ['ESTADO_FUNCIONAL'], 'PARCIAL', 'Detiene la publicación de salidas.'),
	definicion('PLC_FAULT', 'controlador', ['ESTADO_FUNCIONAL'], 'PARCIAL', 'Bloquea salidas por fallo de controlador.'),
	definicion('PLC_FORCE', 'controlador', [], 'PARCIAL', 'Los forzados siguen el runtime PLC existente.'),
	definicion('PLC_BAD_AI', 'controlador', [], 'NO_MODELADO', 'Requiere objetivo de canal y calidad explícitos.'),
	definicion('PLC_BAD_AO', 'controlador', [], 'NO_MODELADO', 'Requiere objetivo de canal y calidad explícitos.'),
	definicion('PLC_IO_MAPPING', 'controlador', [], 'NO_MODELADO', 'No se inventa un mapeo alternativo.'),
].map((d) => [d.codigo, d]));

const dispositivoDe = (o: ObjetivoFallaEquipo): string | undefined => 'dispositivoId' in o ? o.dispositivoId : undefined;
const claveObjetivo = (o: ObjetivoFallaEquipo): string => o.tipo === 'CONDUCTOR' ? `c:${o.conductorId}`
	: o.tipo === 'CONTACTO' ? `x:${o.dispositivoId}:${[...o.terminales].sort().join(':')}`
		: o.tipo === 'NODOS' ? `n:${[o.nodoA, o.nodoB].sort().join(':')}`
			: `${o.tipo}:${dispositivoDe(o) ?? ''}`;

function agregarFuncional(mapa: Map<string, TipoFalloRuntime[]>, id: string | undefined, fallo: TipoFalloRuntime): void {
	if (!id) return; const actuales = new Set(mapa.get(id) ?? []); actuales.add(fallo); mapa.set(id, [...actuales].sort());
}

export function resolverFallasEquipo(fallas: readonly FallaEquipoRuntime[]): EfectosFallasEquipo {
	const salida: EfectosFallasEquipo = { fisicas: [], funcionales: new Map(), parchesEstado: new Map(), diagnosticos: [] };
	const porObjetivo = new Map<string, FallaEquipoRuntime[]>();
	for (const f of fallas) { const lista = porObjetivo.get(claveObjetivo(f.objetivo)) ?? []; lista.push(f); porObjetivo.set(claveObjetivo(f.objetivo), lista); }
	const incompatibles = new Set<string>();
	for (const grupo of porObjetivo.values()) {
		const codigos = new Set(grupo.map((f) => f.codigo));
		if (codigos.has('CONTACTO_SOLDADO') && (codigos.has('CONTACTO_NO_CIERRA') || codigos.has('FASE_NO_CIERRA'))) {
			for (const f of grupo) if (['CONTACTO_SOLDADO', 'CONTACTO_NO_CIERRA', 'FASE_NO_CIERRA'].includes(f.codigo)) incompatibles.add(f.id);
		}
	}
	for (const f of [...fallas].sort((a, b) => a.id.localeCompare(b.id))) {
		const def = BIBLIOTECA_FALLAS_EQUIPO.get(f.codigo)!;
		if (incompatibles.has(f.id)) { salida.diagnosticos.push({ fallaId: f.id, codigo: f.codigo,
			estado: 'DIAGNOSTICO_INDETERMINADO', mensaje: 'Fallas incompatibles sobre el mismo objetivo.', origen: 'INYECTADO' }); continue; }
		let aplicada = def.modelado !== 'NO_MODELADO'; const id = dispositivoDe(f.objetivo);
		const ramaConductor = f.objetivo.tipo === 'CONDUCTOR' ? `conductor:${f.objetivo.conductorId}` : undefined;
		switch (f.codigo) {
			case 'CONDUCTOR_ABIERTO': case 'NEUTRO_ABIERTO':
				salida.fisicas.push({ id: f.id, tipo: f.codigo, ramaId: ramaConductor }); break;
			case 'RESISTENCIA_ELEVADA':
				salida.fisicas.push({ id: f.id, tipo: 'RESISTENCIA_ANORMAL', ramaId: ramaConductor,
					resistenciaAdicionalOhm: Math.max(0, f.parametros?.resistenciaOhm ?? 0) }); break;
			case 'CORTO_LN': case 'CORTO_LL': case 'CORTO_LPE': case 'CORTO_3F':
				if (f.objetivo.tipo !== 'NODOS') aplicada = false; else salida.fisicas.push({ id: f.id,
					tipo: ({ CORTO_LN: 'L_N', CORTO_LL: 'L_L', CORTO_LPE: 'L_PE', CORTO_3F: 'TRIFASICA' } as const)[f.codigo],
					nodoA: f.objetivo.nodoA, nodoB: f.objetivo.nodoB, zFallaOhm: f.parametros?.impedanciaOhm }); break;
			case 'CONTACTO_RESISTIVO':
				if (f.objetivo.tipo !== 'CONTACTO' || !f.objetivo.ramaId) aplicada = false; else salida.fisicas.push({ id: f.id,
					tipo: 'RESISTENCIA_ANORMAL', ramaId: f.objetivo.ramaId,
					resistenciaAdicionalOhm: Math.max(0, f.parametros?.resistenciaOhm ?? 0) }); break;
			case 'BOBINA_ABIERTA': if (!id) aplicada = false; break;
			case 'CONTACTO_NO_CIERRA': case 'CONTACTO_SOLDADO': case 'FASE_NO_CIERRA':
				if (f.objetivo.tipo !== 'CONTACTO') aplicada = false; break;
			case 'FUSIBLE_ABIERTO':
				if (!id) aplicada = false; else { agregarFuncional(salida.funcionales, id, 'fusible-fundido'); salida.parchesEstado.set(id, { disparado: true }); } break;
			case 'DISYUNTOR_DISPARADO':
				if (!id) aplicada = false; else { agregarFuncional(salida.funcionales, id, 'proteccion-disparada'); salida.parchesEstado.set(id, { disparado: true }); } break;
			case 'FALLO_APERTURA': if (!id) aplicada = false; else salida.parchesEstado.set(id, { cerrado: true, disparado: false }); break;
			case 'ROTOR_BLOQUEADO': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'motor-bloqueado'); break;
			case 'PERDIDA_FASE': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'perdida-fase'); break;
			case 'SOBRECARGA_MECANICA': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'sobrecarga'); break;
			case 'SECUNDARIO_ABIERTO':
				if (f.objetivo.tipo !== 'TRANSFORMADOR') aplicada = false;
				else salida.fisicas.push({ id: f.id, tipo: 'SECUNDARIO_TRANSFORMADOR_ABIERTO', dispositivoId: f.objetivo.dispositivoId }); break;
			case 'SOBRECARGA_TRANSFORMADOR': aplicada = false; break;
			case 'VFD_UNDERVOLTAGE': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'subtension'); break;
			case 'VFD_REFERENCE_LOSS': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'perdida-referencia'); break;
			case 'VFD_OVERLOAD': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'sobrecarga'); break;
			case 'VFD_EXTERNAL_FAULT': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'fallo-externo'); break;
			case 'SENSOR_CIRCUITO_ABIERTO': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'circuito-analogico-abierto'); break;
			case 'SENSOR_FUERA_RANGO': if (!id) aplicada = false; else agregarFuncional(salida.funcionales, id, 'senal-fuera-rango'); break;
			case 'SENSOR_STUCK': if (id && f.parametros?.valor !== undefined) salida.parchesEstado.set(id, { valor: f.parametros.valor }); else aplicada = false; break;
			case 'SENSOR_OFFSET': if (id && f.parametros?.valor !== undefined) salida.parchesEstado.set(id, { __offsetFalla: f.parametros.valor }); else aplicada = false; break;
			case 'PLC_STOP': case 'PLC_FAULT': if (id) salida.parchesEstado.set(id, { fallo: true }); else aplicada = false; break;
			case 'PLC_FORCE': aplicada = false; break;
			default: break;
		}
		salida.diagnosticos.push({ fallaId: f.id, codigo: f.codigo,
			estado: !aplicada ? 'NO_MODELADA' : def.modelado === 'PARCIAL' ? 'PARCIAL' : 'APLICADA',
			mensaje: aplicada ? def.descripcion : `${def.descripcion} Efecto no resoluble con el objetivo/parámetros actuales.`,
			origen: aplicada ? 'INYECTADO' : 'NO_MODELADO' });
	}
	return salida;
}

export function fallaContactoActiva(estado: { fallasEquipos?: readonly FallaEquipoRuntime[] } | undefined,
	codigos: readonly CodigoFallaEquipo[], terminales?: readonly [string, string]): boolean {
	const candidatas = (estado?.fallasEquipos ?? []).filter((f) => !terminales || f.objetivo.tipo === 'CONTACTO'
		&& [...f.objetivo.terminales].sort().join(':') === [...terminales].sort().join(':'));
	const presentes = new Set(candidatas.map((f) => f.codigo));
	if (presentes.has('CONTACTO_SOLDADO') && (presentes.has('CONTACTO_NO_CIERRA') || presentes.has('FASE_NO_CIERRA'))) return false;
	return candidatas.some((f) => codigos.includes(f.codigo));
}
