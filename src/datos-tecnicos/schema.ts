import { CAMPOS_TECNICOS, factorUnidad } from './campos.js';
import { claveDato, claveRevision, referenciaTecnica, type ConfiguracionTecnicaProyecto, type DatoTecnico, type PaqueteTecnico, type RevisionTecnica } from './tipos.js';

export const LIMITES_TECNICOS = { caracteres: 32 * 1024 * 1024, profundidad: 32, nodos: 2_000_000, coleccion: 20_000, revisiones: 12_000, campos: 256 } as const;
export class DatosTecnicosInvalidos extends Error { constructor(mensaje: string) { super(mensaje); this.name = 'DatosTecnicosInvalidos'; } }
const fallo = (ruta: string, detalle: string): never => { throw new DatosTecnicosInvalidos(`${ruta}: ${detalle}`); };
const canonEstructura = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonEstructura).join(',')}]`
	: v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonEstructura((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
type Obj = Record<string, unknown>;
type Validador = (v: unknown, ruta: string) => void;
const objeto = (v: unknown, ruta: string): Obj => {
	if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fallo(ruta, 'objeto requerido');
	return v as Obj;
};
const texto: Validador = (v, p) => { if (typeof v !== 'string' || !v.trim() || v.length > 2000) fallo(p, 'texto no vacío de hasta 2000 caracteres requerido'); };
const id: Validador = (v, p) => { texto(v, p); if (!/^[\p{L}\p{N}_.:-]{1,120}$/u.test(v as string)) fallo(p, 'identidad inválida'); };
const num = (min = 0, max = Number.MAX_VALUE, entero = false): Validador => (v, p) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (entero && !Number.isInteger(v))) fallo(p, `número ${entero ? 'entero ' : ''}en [${min}, ${max}] requerido`); };
const en = (...vals: unknown[]): Validador => (v, p) => { if (!vals.includes(v)) fallo(p, `valor no permitido: ${String(v)}`); };
const lista = (item: Validador, min = 0, max: number = LIMITES_TECNICOS.coleccion): Validador => (v, p) => { if (!Array.isArray(v) || v.length < min || v.length > max) fallo(p, `lista de ${min} a ${max} elementos requerida`); (v as unknown[]).forEach((x, i) => item(x, `${p}[${i}]`)); };
const forma = (requeridos: Record<string, Validador>, opcionales: Record<string, Validador> = {}): Validador => (v, p) => {
	const o = objeto(v, p);
	for (const k of Object.keys(o)) if (!Object.hasOwn(requeridos, k) && !Object.hasOwn(opcionales, k)) fallo(`${p}.${k}`, 'campo desconocido');
	for (const [k, f] of Object.entries(requeridos)) f(o[k], `${p}.${k}`);
	for (const [k, f] of Object.entries(opcionales)) if (o[k] !== undefined) f(o[k], `${p}.${k}`);
};
const mapa = (f: Validador): Validador => (v, p) => { const o = objeto(v, p); if (Object.keys(o).length > 20_000) fallo(p, 'mapa excesivo'); for (const [k, x] of Object.entries(o)) { if (!k || k.length > 256) fallo(p, 'clave inválida'); f(x, `${p}.${k}`); } };
const rango: Validador = (v, p) => { lista(num(-1e12, 1e12), 2, 2)(v, p); if ((v as number[])[0] > (v as number[])[1]) fallo(p, 'rango invertido'); };
const magnitud: Validador = (v, p) => Array.isArray(v) ? rango(v, p) : num(-1e12, 1e12)(v, p);
const hash: Validador = (v, p) => { if (typeof v !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v)) fallo(p, 'SHA-256 requerido'); };
const url: Validador = (v, p) => { texto(v, p); try { const u = new URL(v as string); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fallo(p, 'solo URL HTTP(S) pública sin credenciales'); } catch { fallo(p, 'URL no admitida'); } };
const documento: Validador = (v, p) => { texto(v, p); if (/^(?:file:|[a-z]:[\\/]|\\\\|\/)/i.test(v as string)) fallo(p, 'no se admiten rutas privadas'); };
export const validarProcedencia: Validador = forma({ origen: en('USUARIO', 'GENERICO', 'SINTETICO', 'DOCUMENTAL'), referencia: documento }, { documento, revisionDocumento: texto, seccion: texto, fechaConsulta: (v, p) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))) fallo(p, 'fecha ISO requerida'); }, url });
const magnitudPositiva: Validador = (v, p) => { magnitud(v, p); for (const x of Array.isArray(v) ? v : [v]) num()(x, p); };
export const validarCondiciones: Validador = forma({}, { sistema: en('AC', 'DC'), tensionV: magnitudPositiva, frecuenciaHz: magnitudPositiva, polos: num(1, 100, true), temperaturaC: magnitud, ajusteA: magnitudPositiva, contexto: texto, carga: en('RESISTIVA', 'INDUCTIVA') });
const tipos = en('PRODUCTO', 'CURVA', 'AMPACIDAD', 'CRITERIOS');
export const validarReferencia: Validador = forma({ tipo: tipos, catalogoId: id, id, revision: num(1, 1e9, true), hash });
export function inspeccionarDatosNoConfiables(valor: unknown): void {
	let nodos = 0;
	const recorrer = (v: unknown, profundidad: number): void => {
		if (++nodos > LIMITES_TECNICOS.nodos || profundidad > LIMITES_TECNICOS.profundidad) fallo('$', 'estructura excesiva');
		if (typeof v === 'number' && !Number.isFinite(v)) fallo('$', 'número no finito');
		if (typeof v === 'string' && v.length > 100_000) fallo('$', 'cadena excesiva');
		if (v === undefined || v === null || ['string', 'boolean', 'number'].includes(typeof v)) return;
		if (typeof v !== 'object') fallo('$', 'solo datos JSON');
		if (Array.isArray(v)) { if (v.length > LIMITES_TECNICOS.coleccion) fallo('$', 'colección excesiva'); for (const x of v) recorrer(x, profundidad + 1); }
		else { const o = objeto(v, '$'); for (const [k, x] of Object.entries(o)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) fallo('$', 'clave peligrosa'); recorrer(x, profundidad + 1); } }
	};
	recorrer(valor, 0);
}
export function parsearJsonTecnico(textoJson: string): unknown {
	if (textoJson.length > LIMITES_TECNICOS.caracteres) fallo('$', 'archivo mayor que el límite de 32 MiB de texto');
	let valor: unknown; try { valor = JSON.parse(textoJson); } catch { return fallo('$', 'JSON inválido'); }
	inspeccionarDatosNoConfiables(valor); return valor;
}
export function validarDato(v: unknown, p = 'dato'): asserts v is DatoTecnico {
	forma({ campo: en(...Object.keys(CAMPOS_TECNICOS)), valor: () => {}, unidad: texto, naturaleza: en('NOMINAL', 'MINIMO', 'MAXIMO', 'INTERVALO'), procedencia: validarProcedencia }, { canal: id, condiciones: validarCondiciones })(v, p);
	const d = v as DatoTecnico; const regla = CAMPOS_TECNICOS[d.campo];
	if (regla.tipo === 'enum') { en(...regla.valores)(d.valor, `${p}.valor`); if (d.unidad !== '1' || d.naturaleza === 'INTERVALO') fallo(p, 'enum sin unidad/rango'); }
	else {
		const factor = factorUnidad(d.unidad, regla.unidad); if (factor === undefined) fallo(p, `unidad incompatible: ${d.unidad} / ${regla.unidad}`);
		const valores = Array.isArray(d.valor) ? d.valor : [d.valor];
		if ((d.naturaleza === 'INTERVALO') !== Array.isArray(d.valor)) fallo(p, 'naturaleza y rango inconsistentes');
		if (Array.isArray(d.valor)) rango(d.valor, p);
		for (const x of valores) { num(-1e12, 1e12)(x, p); num(regla.minimo, regla.maximo)((x as number) * factor!, p); }
		if (['motor.eficiencia', 'motor.factorPotencia', 'motor.tensionNominalV', 'vfd.eficiencia', 'vfd.frecuenciaBaseHz', 'vfd.frecuenciaMaxHz', 'vfd.tensionEntradaNominalV', 'transformador.primarioV', 'transformador.secundarioV', 'conductor.seccionMm2'].includes(d.campo)
			&& valores.some(x => Number(x) <= 0)) fallo(p, 'este parámetro nominal debe ser estrictamente positivo; cero no es un dato ausente');
		if (d.campo.endsWith('.fases') || d.campo.endsWith('.fasesEntrada')) valores.forEach(x => en(1, 3)(x, p));
		if (d.campo === 'motor.polos') valores.forEach(x => { if (!Number.isInteger(x) || Number(x) % 2) fallo(p, 'polos pares requeridos'); });
	}
	if (['bobina.tensionRangoV', 'analogica.rango'].includes(d.campo) && !Array.isArray(d.valor)) fallo(p, 'intervalo requerido');
	if (d.campo.startsWith('plc.') && !d.canal) fallo(p, 'borne de canal PLC requerido');
}
const lookup = en('EXACT_ONLY', 'STEP_LOWER', 'STEP_UPPER', 'LINEAR');
const clavesCriterios = ['maxVoltageDropPercent', 'maxLossW', 'maxLossPercent', 'maxUnbalancePercent', 'capacidadCorte', 'coordinarIbInIz'];
const parametros: Validador = (v, p) => {
	const o = objeto(v, p);
	for (const [k, x] of Object.entries(o)) {
		if (!clavesCriterios.includes(k)) fallo(p, `criterio no soportado: ${k}`);
		if (x === undefined) continue;
		if (objeto(x, p).modo === 'VALOR') forma({ modo: en('VALOR'), valor: k === 'capacidadCorte' ? en('Icn', 'Icu', 'Ics') : k === 'coordinarIbInIz' ? en(true, false) : num() })(x, `${p}.${k}`);
		else forma({ modo: en('DESACTIVADO', 'NO_APLICA'), motivo: texto })(x, `${p}.${k}`);
	}
};
const base = { version: en(1), canon: en(1), catalogo: forma({ id, nombre: texto }), id, revision: num(1, 1e9, true), hash, nombre: texto, estado: en('ACTIVA', 'RETIRADA'), procedencia: validarProcedencia };
export function validarRevisionTecnica(v: unknown): asserts v is RevisionTecnica {
	inspeccionarDatosNoConfiables(v); const o = objeto(v, 'revision');
	if (o.tipo === 'PRODUCTO') {
		forma({ ...base, tipo: en('PRODUCTO'), familia: en('PROTECCION', 'BOBINA', 'PLC', 'ANALOGICA', 'CONDUCTOR', 'MOTOR', 'VFD', 'TRANSFORMADOR', 'FUENTE'), variante: texto, campos: lista(validarDato, 0, LIMITES_TECNICOS.campos) }, { fabricanteDeclarado: texto, referenciaComercial: texto, curva: validarReferencia, gruposSalidas: lista(forma({ id, canales: lista(id, 1, 256), corrienteMaxA: num(), condiciones: validarCondiciones }, { corrienteLlamadaMaxA: num() }), 0, 256) })(v, 'producto');
		const r = v as RevisionTecnica & { tipo: 'PRODUCTO' }; const claves = r.campos.map(d => `${claveDato(d)}:${canonEstructura(d.condiciones ?? {})}`);
		if (new Set(claves).size !== claves.length) fallo('campos', 'dato/condición duplicado');
		if (new Set(r.gruposSalidas?.map(g => g.id)).size !== (r.gruposSalidas?.length ?? 0)) fallo('gruposSalidas', 'identidad duplicada');
		for (const g of r.gruposSalidas ?? []) if (new Set(g.canales).size !== g.canales.length) fallo('gruposSalidas', 'canal duplicado');
		if (r.curva?.tipo !== undefined && r.curva.tipo !== 'CURVA') fallo('curva', 'referencia no es curva');
		const familias: Record<string, string> = { PROTECCION: 'proteccion', BOBINA: 'bobina', PLC: 'plc', ANALOGICA: 'analogica', CONDUCTOR: 'conductor', MOTOR: 'motor', VFD: 'vfd', TRANSFORMADOR: 'transformador', FUENTE: 'fuente' };
		for (const d of r.campos) if (!d.campo.startsWith(`${familias[r.familia]}.`) && !(r.familia === 'PLC' && d.campo.startsWith('analogica.'))) fallo('campos', 'campo incompatible con familia');
	} else if (o.tipo === 'CURVA') {
		forma({ ...base, tipo: en('CURVA'), base: en('AMPERIOS', 'MULTIPLOS_IN'), unidadTiempo: en('s'), interpolacion: en('EXACT_ONLY', 'LINEAR', 'LOG_LOG'), condiciones: validarCondiciones, puntos: lista(forma({ corriente: num(Number.MIN_VALUE), minimoS: num(Number.MIN_VALUE), maximoS: num(Number.MIN_VALUE) }), 2, 5000) })(v, 'curva');
		const r = v as RevisionTecnica & { tipo: 'CURVA' }; r.puntos.forEach((x, i) => { if (x.minimoS > x.maximoS || (i && x.corriente <= r.puntos[i - 1].corriente)) fallo('curva.puntos', 'banda invertida, corriente duplicada u orden inválido'); });
	} else if (o.tipo === 'AMPACIDAD') {
		forma({ ...base, tipo: en('AMPACIDAD'), politicaSeccion: lookup,
			filas: lista(forma({ material: en('COBRE', 'ALUMINIO'), aislamiento: texto, temperaturaAislamientoC: num(-273.15), seccionMm2: num(Number.MIN_VALUE), metodo: texto, temperaturaBaseC: num(-273.15), cargados: num(1, 1000, true), agrupamientoBase: num(1, 10000, true), izA: num(Number.MIN_VALUE) }), 1, 10000),
			factores: lista(forma({ id, dimension: en('AMBIENTE', 'AGRUPAMIENTO'), material: en('COBRE', 'ALUMINIO'), aislamiento: texto, metodo: texto, politica: lookup, puntos: lista(forma({ valor: num(-273.15), factor: num(Number.MIN_VALUE, 10) }), 1, 1000) }), 0, 100), combinaciones: lista(lista(id, 0, 100), 0, 100),
		})(v, 'ampacidad');
		const r = v as RevisionTecnica & { tipo: 'AMPACIDAD' };
		if (new Set(r.factores.map(f => f.id)).size !== r.factores.length) fallo('factores', 'identidad duplicada');
		for (const f of r.factores) f.puntos.forEach((x, i) => { if (i && x.valor <= f.puntos[i - 1].valor) fallo('factores', 'dominio duplicado o desordenado'); });
		for (const c of r.combinaciones) { const fs = c.map(k => r.factores.find(f => f.id === k)); if (fs.some(f => !f) || new Set(fs.map(f => f?.dimension)).size !== fs.length) fallo('combinaciones', 'referencia ausente o doble corrección de una dimensión'); }
	} else if (o.tipo === 'CRITERIOS') forma({ ...base, tipo: en('CRITERIOS'), ambitoDeclarado: texto, parametros })(v, 'criterios');
	else fallo('revision.tipo', 'versión/tipo no soportado');
}
export function validarConfiguracionTecnica(v: unknown): asserts v is ConfiguracionTecnicaProyecto {
	inspeccionarDatosNoConfiables(v);
	const decision: Validador = (x, p) => { const o = objeto(x, p); if (o.modo === 'CATALOGO') forma({ modo: en('CATALOGO') })(x, p); else if (o.modo === 'SIN_HERENCIA') forma({ modo: en('SIN_HERENCIA'), motivo: texto })(x, p); else forma({ modo: en('OVERRIDE', 'CONSERVAR'), dato: validarDato })(x, p); };
	const borne = forma({ dispositivoId: id, borneId: id });
	forma({ version: en(1), revisiones: lista(validarRevisionTecnica, 0, LIMITES_TECNICOS.revisiones), vinculos: lista(forma({ entidad: en('DEVICE', 'CONDUCTOR'), entidadId: id, producto: validarReferencia, decisiones: mapa(decision), condiciones: validarCondiciones })), instalaciones: lista(forma({ conductorId: id, tabla: validarReferencia, factores: lista(id, 0, 100) }, { material: en('COBRE', 'ALUMINIO'), aislamiento: texto, temperaturaAislamientoC: num(-273.15), metodo: texto, temperaturaAmbienteC: num(-273.15), cargados: num(1, 1000, true), agrupamiento: num(1, 10000, true) })) }, {
		criterios: validarReferencia, overridesCriterios: parametros, criteriosCircuito: mapa(forma({ overrides: parametros }, { perfil: validarReferencia })),
		prospectiva: lista(forma({ proteccionId: id, de: borne, a: borne, tipo: en('L_N', 'L_L', 'L_PE', 'TRIFASICA') }), 0, 1000),
	})(v, 'datosTecnicos');
	const c = v as ConfiguracionTecnicaProyecto;
	if (new Set(c.vinculos.map(b => `${b.entidad}:${b.entidadId}`)).size !== c.vinculos.length) fallo('vinculos', 'entidad duplicada');
	if (new Set(c.instalaciones.map(i => i.conductorId)).size !== c.instalaciones.length) fallo('instalaciones', 'conductor duplicado');
	for (const b of c.vinculos) { if (b.producto.tipo !== 'PRODUCTO') fallo('vinculo', 'producto requerido'); for (const [k, d] of Object.entries(b.decisiones)) if ('dato' in d && claveDato(d.dato) !== k) fallo('decisiones', 'clave diferente del dato'); }
	for (const i of c.instalaciones) if (i.tabla.tipo !== 'AMPACIDAD') fallo('instalacion', 'tabla requerida');
	if (c.criterios && c.criterios.tipo !== 'CRITERIOS') fallo('criterios', 'perfil requerido');
	// Referencias ausentes/hashes alterados NO se reparan aquí: el resolver conserva el proyecto
	// rescatable y bloquea solo esos datos. La adopción/importación sí exige cierre íntegro.
}
export function validarPaqueteTecnico(v: unknown): asserts v is PaqueteTecnico {
	inspeccionarDatosNoConfiables(v);
	forma({ formato: en('tablero-studio-datos-tecnicos'), version: en(1), canon: en(1), revisiones: lista(validarRevisionTecnica, 1, LIMITES_TECNICOS.revisiones), manifiesto: forma({ referencias: lista(validarReferencia, 1, LIMITES_TECNICOS.revisiones), hash }) })(v, 'paquete');
	const p = v as PaqueteTecnico; const reales = p.revisiones.map(r => canonEstructura(referenciaTecnica(r))).sort();
	if (JSON.stringify(reales) !== JSON.stringify(p.manifiesto.referencias.map(canonEstructura).sort())) fallo('manifiesto', 'referencias no coinciden con contenido');
	if (new Set(p.revisiones.map(r => claveRevision(referenciaTecnica(r)))).size !== p.revisiones.length) fallo('paquete', 'revisión duplicada');
}
