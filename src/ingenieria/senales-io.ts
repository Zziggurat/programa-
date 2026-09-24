/** Lista documental de E/S derivada del circuito persistente, nunca del dibujo del esquema. */
import { resolverComportamiento, validarComportamiento } from '../modelo/comportamiento.js';
import type { ClaseIOPLC } from '../modelo/programa-plc.js';
import type { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { ioDeControlador } from '../motores/simulacion.js';

export type OrigenSenalIO = 'PERFIL_EXPLICITO' | 'ETIQUETA_EXPLICITA' | 'ADAPTADOR_LEGACY' | 'DI_INFERIDA';
export type CalidadDatoIO = 'DECLARADA' | 'NO_VERIFICADA';

export interface ConexionSenalIO {
	conductorId: string;
	otroDispositivoId: string;
	otroBorneId: string;
	/** No se confunde la unión eléctrica existente con una ruta física todavía pendiente. */
	estadoRutaFisica?: 'pendiente';
	extremoValido: boolean;
}

export interface FilaSenalIO {
	dispositivoId: string;
	designacion: string;
	borneId: string;
	rotulo?: string;
	/** AMBIGUA impide escoger arbitrariamente una clase cuando un perfil reutiliza el mismo pin. */
	clase: ClaseIOPLC | 'AMBIGUA';
	clasesDeclaradas?: ClaseIOPLC[];
	origen: OrigenSenalIO;
	/** La fuente del comportamiento, separada de la inferencia particular de DI. */
	origenPerfil: 'EXPLICITO' | 'LEGACY';
	/** DECLARADA significa dato persistente, no validación independiente del fabricante. */
	calidad: CalidadDatoIO;
	etiquetas: string[];
	comun?: string;
	unidad?: 'V' | 'mA';
	rango?: [number, number];
	modoEntrada?: 'pasiva' | 'activa';
	tipoSalida?: 'PNP' | 'NPN' | 'RELE' | 'TRIAC';
	tensionV?: number;
	corrienteMaxA?: number;
	conexiones: ConexionSenalIO[];
	estadoConexion: 'CONECTADO' | 'SIN_CONDUCTOR' | 'EXTREMO_INVALIDO';
}

export interface DiagnosticoSenalesIO {
	dispositivoId: string;
	codigo: 'PERFIL_INVALIDO' | 'SIN_PERFIL_CONTROLADOR' | 'ROL_AMBIGUO';
	mensaje: string;
	borneId?: string;
}

export interface ListaSenalesIO {
	filas: FilaSenalIO[];
	diagnosticos: DiagnosticoSenalesIO[];
}

const clases: ClaseIOPLC[] = ['DI', 'DO', 'AI', 'AO'];
const comparar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const clave = (dispositivoId: string, borneId: string): string => JSON.stringify([dispositivoId, borneId]);

/** La lista se indexa por identidad eléctrica: varias representaciones no crean otra E/S. */
export function generarListaSenalesIO(proyecto: Proyecto): ListaSenalesIO {
	const filas: FilaSenalIO[] = [];
	const diagnosticos: DiagnosticoSenalesIO[] = [];
	const bornesReales = new Set(proyecto.dispositivos.flatMap((d) => d.bornes.map((b) => clave(d.id, b.id))));
	const conexiones = new Map<string, ConexionSenalIO[]>();
	for (const w of proyecto.conductores) {
		const anotar = (dispositivoId: string, borneId: string, otroDispositivoId: string, otroBorneId: string) => {
			const k = clave(dispositivoId, borneId);
			const lista = conexiones.get(k) ?? [];
			lista.push({ conductorId: w.id, otroDispositivoId, otroBorneId,
				...(w.estadoRutaFisica ? { estadoRutaFisica: w.estadoRutaFisica } : {}),
				extremoValido: bornesReales.has(clave(otroDispositivoId, otroBorneId)) });
			conexiones.set(k, lista);
		};
		anotar(w.de.dispositivoId, w.de.borneId, w.a.dispositivoId, w.a.borneId);
		if (clave(w.de.dispositivoId, w.de.borneId) !== clave(w.a.dispositivoId, w.a.borneId)) {
			anotar(w.a.dispositivoId, w.a.borneId, w.de.dispositivoId, w.de.borneId);
		}
	}
	for (const d of proyecto.dispositivos) {
		const erroresPerfil = d.comportamiento ? validarComportamiento(d) : [];
		if (erroresPerfil.length) {
			if (d.comportamiento?.clase === 'controlador' || d.tipo === 'plc') {
				diagnosticos.push({ dispositivoId: d.id, codigo: 'PERFIL_INVALIDO',
					mensaje: `Perfil explícito inválido: ${erroresPerfil.join('; ')}` });
			}
			continue;
		}
		const perfil = resolverComportamiento(d);
		if (perfil?.clase !== 'controlador') {
			if (d.tipo === 'plc' || d.programaPLC) diagnosticos.push({ dispositivoId: d.id,
				codigo: 'SIN_PERFIL_CONTROLADOR', mensaje: 'No hay un perfil de controlador válido; no se atribuyen E/S por imagen, nombre ni programa.' });
			continue;
		}
		const io = ioDeControlador(d);
		const clasesPorBorne = new Map<string, ClaseIOPLC[]>();
		for (const c of clases) for (const borne of io[c]) {
			const lista = clasesPorBorne.get(borne) ?? [];
			if (!lista.includes(c)) lista.push(c);
			clasesPorBorne.set(borne, lista);
		}
		for (const [borneId, roles] of clasesPorBorne) {
			const borne = d.bornes.find((b) => b.id === borneId);
			if (!borne) {
				// Un perfil explícito válido ya se comprobó arriba; no documentar pines inexistentes.
				continue;
			}
			const clase = roles.length === 1 ? roles[0] : 'AMBIGUA';
			const etiquetas = [...new Set((d.programaPLC?.etiquetas ?? []).filter((e) => e.io?.borne === borneId
				&& roles.includes(e.io.clase) && e.tipo === (e.io.clase === 'AI' || e.io.clase === 'AO' ? 'REAL' : 'BOOL'))
				.map((e) => e.nombre))].sort(comparar);
			const explicito = !!d.comportamiento;
			const origen: OrigenSenalIO = clase === 'DI'
				? etiquetas.length ? 'ETIQUETA_EXPLICITA' : 'DI_INFERIDA'
				: explicito ? 'PERFIL_EXPLICITO' : 'ADAPTADOR_LEGACY';
			const salidaDigital = clase === 'DO' ? perfil.salidasDigitales.find((s) => s.borne === borneId) : undefined;
			const entradaAnalogica = clase === 'AI' ? perfil.entradasAnalogicas?.find((s) => s.borne === borneId) : undefined;
			const salidaAnalogica = clase === 'AO' ? perfil.salidasAnalogicas.find((s) => s.borne === borneId) : undefined;
			const datoDeclarado = explicito && (clase === 'AI' && !!entradaAnalogica
				|| clase === 'AO' && !!salidaAnalogica || clase === 'DO' && !!salidaDigital?.electrica);
			const enlaces = [...(conexiones.get(clave(d.id, borneId)) ?? [])].sort((a, b) =>
				comparar(a.conductorId, b.conductorId) || comparar(a.otroDispositivoId, b.otroDispositivoId)
				|| comparar(a.otroBorneId, b.otroBorneId));
			filas.push({ dispositivoId: d.id, designacion: d.designacion ?? d.id, borneId,
				...(borne.rotulo ? { rotulo: borne.rotulo } : {}), clase,
				...(clase === 'AMBIGUA' ? { clasesDeclaradas: roles } : {}), origen,
				origenPerfil: explicito ? 'EXPLICITO' : 'LEGACY',
				calidad: datoDeclarado ? 'DECLARADA' : 'NO_VERIFICADA', etiquetas,
				...(salidaDigital ? { comun: salidaDigital.comun } : {}),
				...(entradaAnalogica ? { comun: entradaAnalogica.comun, unidad: entradaAnalogica.unidad,
					rango: [...entradaAnalogica.rango] as [number, number], modoEntrada: entradaAnalogica.modoEntrada } : {}),
				...(salidaAnalogica ? { comun: salidaAnalogica.referencia, unidad: salidaAnalogica.unidad,
					rango: [...salidaAnalogica.rango] as [number, number] } : {}),
				...(salidaDigital?.electrica ? { tipoSalida: salidaDigital.electrica.tipoSalida,
					tensionV: salidaDigital.electrica.tensionV,
					...(salidaDigital.electrica.corrienteMaxA === undefined ? {} : { corrienteMaxA: salidaDigital.electrica.corrienteMaxA }) } : {}),
				conexiones: enlaces, estadoConexion: !enlaces.length ? 'SIN_CONDUCTOR'
					: enlaces.some((e) => !e.extremoValido) ? 'EXTREMO_INVALIDO' : 'CONECTADO',
			});
			if (clase === 'AMBIGUA') diagnosticos.push({ dispositivoId: d.id, borneId,
				codigo: 'ROL_AMBIGUO', mensaje: `El borne ${borneId} figura en varias clases de E/S: ${roles.join(', ')}.` });
		}
	}
	filas.sort((a, b) => comparar(a.dispositivoId, b.dispositivoId)
		|| (a.clase === 'AMBIGUA' ? clases.length : clases.indexOf(a.clase))
			- (b.clase === 'AMBIGUA' ? clases.length : clases.indexOf(b.clase))
		|| comparar(a.borneId, b.borneId));
	diagnosticos.sort((a, b) => comparar(a.dispositivoId, b.dispositivoId)
		|| comparar(a.codigo, b.codigo) || comparar(a.borneId ?? '', b.borneId ?? ''));
	return { filas, diagnosticos };
}
