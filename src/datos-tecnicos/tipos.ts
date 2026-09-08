/** V8: decisiones persistentes y revisiones congeladas; nunca resultados ni estado runtime. */
import type { CampoTecnico } from './campos.js';

export type TipoRevisionTecnica = 'PRODUCTO' | 'CURVA' | 'AMPACIDAD' | 'CRITERIOS';
export type FamiliaTecnica = 'PROTECCION' | 'BOBINA' | 'PLC' | 'ANALOGICA' | 'CONDUCTOR' | 'MOTOR' | 'VFD' | 'TRANSFORMADOR' | 'FUENTE';
export type EstadoResolucion = 'RESOLVED' | 'MISSING' | 'NOT_APPLICABLE' | 'OUT_OF_DOMAIN' | 'CONFLICT' | 'UNVERIFIED_SOURCE' | 'STALE_RESULT';
export interface ProcedenciaTecnica {
	origen: 'USUARIO' | 'GENERICO' | 'SINTETICO' | 'DOCUMENTAL';
	/** Declaración del autor, NO corroboración ni permiso de redistribución. */
	referencia: string;
	documento?: string;
	revisionDocumento?: string;
	seccion?: string;
	fechaConsulta?: string;
	url?: string;
}
export interface CondicionesTecnicas {
	sistema?: 'AC' | 'DC';
	tensionV?: number | [number, number];
	frecuenciaHz?: number | [number, number];
	polos?: number;
	temperaturaC?: number | [number, number];
	ajusteA?: number | [number, number];
	contexto?: string;
	carga?: 'RESISTIVA' | 'INDUCTIVA';
}
export interface DatoTecnico {
	campo: CampoTecnico;
	/** Canal identificado por borne persistente; no posición de array. */
	canal?: string;
	valor: number | string | boolean | [number, number];
	unidad: string;
	naturaleza: 'NOMINAL' | 'MINIMO' | 'MAXIMO' | 'INTERVALO';
	condiciones?: CondicionesTecnicas;
	procedencia: ProcedenciaTecnica;
}
export interface ReferenciaTecnica {
	tipo: TipoRevisionTecnica;
	catalogoId: string;
	id: string;
	revision: number;
	hash: string;
}
export interface BaseRevisionTecnica {
	version: 1;
	canon: 1;
	catalogo: { id: string; nombre: string };
	id: string;
	revision: number;
	hash: string;
	nombre: string;
	estado: 'ACTIVA' | 'RETIRADA';
	procedencia: ProcedenciaTecnica;
}
export interface RevisionProductoTecnico extends BaseRevisionTecnica {
	tipo: 'PRODUCTO';
	familia: FamiliaTecnica;
	variante: string;
	fabricanteDeclarado?: string;
	referenciaComercial?: string;
	campos: DatoTecnico[];
	curva?: ReferenciaTecnica;
	gruposSalidas?: { id: string; canales: string[]; corrienteMaxA: number; corrienteLlamadaMaxA?: number; condiciones: CondicionesTecnicas }[];
}
export type PoliticaLookup = 'EXACT_ONLY' | 'STEP_LOWER' | 'STEP_UPPER' | 'LINEAR';
export interface RevisionCurvaTecnica extends BaseRevisionTecnica {
	tipo: 'CURVA';
	base: 'AMPERIOS' | 'MULTIPLOS_IN';
	unidadTiempo: 's';
	interpolacion: 'EXACT_ONLY' | 'LINEAR' | 'LOG_LOG';
	condiciones: CondicionesTecnicas;
	/** Dominio cerrado. Fuera de estos puntos no se extrapola. Orden significativo. */
	puntos: { corriente: number; minimoS: number; maximoS: number }[];
}
export interface FilaAmpacidad {
	material: 'COBRE' | 'ALUMINIO';
	aislamiento: string;
	temperaturaAislamientoC: number;
	seccionMm2: number;
	metodo: string;
	temperaturaBaseC: number;
	cargados: number;
	agrupamientoBase: number;
	izA: number;
}
export interface FactorAmpacidad {
	id: string;
	dimension: 'AMBIENTE' | 'AGRUPAMIENTO';
	material: 'COBRE' | 'ALUMINIO';
	aislamiento: string;
	metodo: string;
	politica: PoliticaLookup;
	puntos: { valor: number; factor: number }[];
}
export interface RevisionTablaAmpacidad extends BaseRevisionTecnica {
	tipo: 'AMPACIDAD';
	politicaSeccion: PoliticaLookup;
	filas: FilaAmpacidad[];
	factores: FactorAmpacidad[];
	/** Única autorización de combinación; sin ella no se multiplican correcciones. */
	combinaciones: string[][];
}
export type ClaveCriterioTecnico = 'maxVoltageDropPercent' | 'maxLossW' | 'maxLossPercent' | 'maxUnbalancePercent' | 'capacidadCorte' | 'coordinarIbInIz';
export type ValorCriterioTecnico = { modo: 'VALOR'; valor: number | 'Icn' | 'Icu' | 'Ics' | boolean } | { modo: 'DESACTIVADO' | 'NO_APLICA'; motivo: string };
export interface RevisionCriteriosTecnicos extends BaseRevisionTecnica {
	tipo: 'CRITERIOS';
	ambitoDeclarado: string;
	parametros: Partial<Record<ClaveCriterioTecnico, ValorCriterioTecnico>>;
}
export type RevisionTecnica = RevisionProductoTecnico | RevisionCurvaTecnica | RevisionTablaAmpacidad | RevisionCriteriosTecnicos;
export type DecisionDatoTecnico = { modo: 'CATALOGO' } | { modo: 'CONSERVAR'; dato: DatoTecnico } | { modo: 'OVERRIDE'; dato: DatoTecnico } | { modo: 'SIN_HERENCIA'; motivo: string };
export interface VinculoTecnico {
	entidad: 'DEVICE' | 'CONDUCTOR';
	entidadId: string;
	producto: ReferenciaTecnica;
	/** Clave campo@canal. Ausencia ante conflicto requiere decisión, nunca adopción implícita. */
	decisiones: Record<string, DecisionDatoTecnico>;
	condiciones: CondicionesTecnicas;
}
export interface InstalacionConductorTecnica {
	conductorId: string;
	tabla: ReferenciaTecnica;
	material?: 'COBRE' | 'ALUMINIO';
	aislamiento?: string;
	temperaturaAislamientoC?: number;
	metodo?: string;
	temperaturaAmbienteC?: number;
	cargados?: number;
	agrupamiento?: number;
	factores: string[];
}
export interface ConfiguracionTecnicaProyecto {
	version: 1;
	/** Un subconjunto compartido por proyecto. Ninguna dependencia global/latest. */
	revisiones: RevisionTecnica[];
	vinculos: VinculoTecnico[];
	instalaciones: InstalacionConductorTecnica[];
	criterios?: ReferenciaTecnica;
	overridesCriterios?: Partial<Record<ClaveCriterioTecnico, ValorCriterioTecnico>>;
	criteriosCircuito?: Record<string, { perfil?: ReferenciaTecnica; overrides: Partial<Record<ClaveCriterioTecnico, ValorCriterioTecnico>> }>;
	/** Ensayo estático explícito; no es una falla runtime ni crea un neutro/tierra ideal. */
	prospectiva?: { proteccionId: string; de: { dispositivoId: string; borneId: string }; a: { dispositivoId: string; borneId: string }; tipo: 'L_N' | 'L_L' | 'L_PE' | 'TRIFASICA' }[];
}
export interface PaqueteTecnico {
	formato: 'tablero-studio-datos-tecnicos';
	version: 1;
	canon: 1;
	revisiones: RevisionTecnica[];
	manifiesto: { referencias: ReferenciaTecnica[]; hash: string };
}
/** Evidencia humana local, separada del contenido importable: no puede auto-certificarse. */
export interface RevisionHumanaTecnica { hash: string; estado: 'REVISADO' | 'RECHAZADO'; responsable: string; evidencia: string; fecha: string }
export const referenciaTecnica = (r: RevisionTecnica): ReferenciaTecnica => ({ tipo: r.tipo, catalogoId: r.catalogo.id, id: r.id, revision: r.revision, hash: r.hash });
export const claveRevision = (r: ReferenciaTecnica): string => JSON.stringify([r.tipo, r.catalogoId, r.id, r.revision]);
export const claveDato = (d: Pick<DatoTecnico, 'campo' | 'canal'>): string => `${d.campo}@${d.canal ?? ''}`;
