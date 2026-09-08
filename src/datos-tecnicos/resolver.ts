import type { Conductor, Dispositivo, Proyecto } from '../modelo/tipos.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import { validarDato } from './schema.js';
import { CAMPOS_TECNICOS, factorUnidad, type CampoTecnico } from './campos.js';
import { evaluarCondicionesTecnicas } from './condiciones.js';
import { comparar, jsonCanonico, sha256Texto, verificarRevision } from './hash.js';
import { claveDato, claveRevision, type CondicionesTecnicas, type DatoTecnico, type EstadoResolucion, type FamiliaTecnica, type ReferenciaTecnica, type RevisionProductoTecnico, type RevisionTecnica, type VinculoTecnico } from './tipos.js';

export interface ResolucionDatoTecnico {
	entidad: 'DEVICE' | 'CONDUCTOR'; entidadId: string; clave: string; campo: CampoTecnico; canal?: string;
	estado: EstadoResolucion; dato?: DatoTecnico; referencia: ReferenciaTecnica;
	origen: 'OVERRIDE' | 'CONSERVAR' | 'CATALOGO' | 'LEGACY' | 'AUSENTE';
	pasos: string[]; motivos: string[]; advertencias: string[]; modelado: boolean;
}
export interface ResultadoProyectoTecnico {
	proyecto: Proyecto; resoluciones: ResolucionDatoTecnico[];
	problemas: { entidad: 'DEVICE' | 'CONDUCTOR' | 'PROJECT'; entidadId: string; estado: EstadoResolucion; motivo: string }[];
	manifestHash?: string;
}
export function familiaDispositivo(d: Dispositivo): FamiliaTecnica | undefined {
	const p = resolverComportamiento(d);
	if (p?.clase === 'proteccion') return 'PROTECCION';
	if (p?.clase === 'contactos-electromagneticos') return 'BOBINA';
	if (p?.clase === 'controlador') return 'PLC';
	if (p?.clase === 'variador') return 'VFD';
	if (p?.clase === 'carga' && p.efecto === 'giro') return 'MOTOR';
	if (d.fisica?.transformador) return 'TRANSFORMADOR';
	if (p?.clase === 'fuente' || d.fisica?.fuente) return 'FUENTE';
	if (p?.clase === 'sensor' && p.transmisor || d.fisica?.analogica) return 'ANALOGICA';
	return undefined;
}
const NO_RUNTIME = new Set<CampoTecnico>(['bobina.corrienteLlamadaA', 'bobina.tensionRangoV', 'plc.corrienteLlamadaMaxA', 'plc.tipoCarga']);
/** Lista de rutas derivada únicamente del registro cerrado; el usuario no controla rutas JS. */
function rutaFisica(campo: CampoTecnico): string[] | undefined {
	const [grupo, nombre] = campo.split('.');
	if (['motor', 'vfd', 'transformador', 'fuente', 'analogica', 'proteccion'].includes(grupo)) {
		if (['Icn', 'Icu', 'Ics'].includes(nombre)) return ['fisica', grupo, 'capacidadCorte', `${nombre.toLowerCase()}KA`];
		if (['modo', 'unidad', 'rango'].includes(nombre)) return undefined;
		return ['fisica', grupo, nombre];
	}
	if (grupo === 'conductor') return nombre === 'seccionMm2' ? ['seccion'] : ['fisica', nombre];
	return undefined;
}
function leerRuta(o: unknown, ruta: string[]): unknown { for (const k of ruta) { if (!o || typeof o !== 'object') return undefined; o = (o as Record<string, unknown>)[k]; } return o; }
function escribirRuta(o: object, ruta: string[], valor: unknown): void {
	let destino = o as Record<string, unknown>;
	for (const k of ruta.slice(0, -1)) { if (!destino[k]) { if (valor === undefined) return; destino[k] = {}; } destino = destino[k] as Record<string, unknown>; }
	const k = ruta.at(-1)!; if (valor === undefined) delete destino[k]; else destino[k] = structuredClone(valor);
}
export function leerDatoLegacy(entidad: Dispositivo | Conductor, campo: CampoTecnico, canal?: string): DatoTecnico | undefined {
	let valor: unknown; const ruta = rutaFisica(campo); if (ruta) valor = leerRuta(entidad, ruta);
	if ('bornes' in entidad) {
		const p = resolverComportamiento(entidad); const nombre = campo.split('.')[1];
		if (campo.startsWith('bobina.') && p?.clase === 'contactos-electromagneticos') valor = leerRuta(p.bobina.electrica, [nombre]);
		if (campo.startsWith('plc.') && p?.clase === 'controlador') valor = leerRuta(p.salidasDigitales.find(s => s.borne === canal)?.electrica, [nombre]);
		if (campo === 'proteccion.inA' && valor === undefined) valor = entidad.corrienteNominal;
		if (campo === 'analogica.modo' && p?.clase === 'sensor') valor = p.transmisor?.modoSalida;
		if (campo === 'analogica.unidad' && p?.clase === 'sensor') valor = p.transmisor?.salida.unidad;
		if (campo === 'analogica.rango' && p?.clase === 'sensor') valor = p.transmisor?.salida.rango;
		if (campo.startsWith('analogica.') && p?.clase === 'controlador') {
			const ai = p.entradasAnalogicas?.find(x => x.borne === canal);
			if (ai && campo === 'analogica.modo') valor = ai.modoEntrada;
			if (ai && campo === 'analogica.unidad') valor = ai.unidad;
			if (ai && campo === 'analogica.rango') valor = ai.rango;
		}
	}
	if (valor === undefined) return undefined;
	return { campo, ...(canal ? { canal } : {}), valor: structuredClone(valor) as DatoTecnico['valor'], unidad: CAMPOS_TECNICOS[campo].unidad,
		naturaleza: Array.isArray(valor) ? 'INTERVALO' : 'NOMINAL', procedencia: { origen: 'USUARIO', referencia: 'Perfil persistente anterior al vínculo; origen documental no corroborado' } };
}
export function normalizarDato(d: DatoTecnico): { dato: DatoTecnico; pasos: string[] } {
	validarDato(d);
	const unidad = CAMPOS_TECNICOS[d.campo].unidad; const f = factorUnidad(d.unidad, unidad)!;
	return { dato: { ...structuredClone(d), unidad, valor: typeof d.valor === 'number' ? d.valor * f : Array.isArray(d.valor) ? [d.valor[0] * f, d.valor[1] * f] : d.valor },
		pasos: d.unidad === unidad ? [] : [`Conversión explícita ${d.unidad} → ${unidad}; × ${f}`] };
}
function mismoValor(a: DatoTecnico, b: DatoTecnico): boolean {
	const na = normalizarDato(a).dato, nb = normalizarDato(b).dato;
	return jsonCanonico(na.valor) === jsonCanonico(nb.valor) && na.unidad === nb.unidad;
}
function aplicarDato(entidad: Dispositivo | Conductor, campo: CampoTecnico, canal: string | undefined, valor: DatoTecnico['valor'] | undefined): void {
	if (NO_RUNTIME.has(campo)) return;
	const ruta = rutaFisica(campo);
	if (ruta) { escribirRuta(entidad, ruta, valor); if ('bornes' in entidad && entidad.fisica) entidad.fisica.version = 1; }
	if (!('bornes' in entidad)) return;
	const p = entidad.comportamiento ?? structuredClone(resolverComportamiento(entidad));
	if (!p) return;
	const nombre = campo.split('.')[1];
	if (campo.startsWith('bobina.') && p.clase === 'contactos-electromagneticos') escribirRuta(p, ['bobina', 'electrica', nombre], valor);
	if (campo.startsWith('plc.') && p.clase === 'controlador') { const s = p.salidasDigitales.find(x => x.borne === canal); if (s) escribirRuta(s, ['electrica', nombre], valor); }
	if (p.clase === 'sensor' && p.transmisor) {
		if (campo === 'analogica.modo') escribirRuta(p.transmisor, ['modoSalida'], valor);
		if (campo === 'analogica.unidad') escribirRuta(p.transmisor, ['salida', 'unidad'], valor);
		if (campo === 'analogica.rango') escribirRuta(p.transmisor, ['salida', 'rango'], valor);
	}
	if (p.clase === 'controlador' && campo.startsWith('analogica.')) {
		const ai = p.entradasAnalogicas?.find(x => x.borne === canal);
		if (ai && campo === 'analogica.modo') escribirRuta(ai, ['modoEntrada'], valor);
		if (ai && campo === 'analogica.unidad') escribirRuta(ai, ['unidad'], valor);
		if (ai && campo === 'analogica.rango') escribirRuta(ai, ['rango'], valor);
	}
	if (p.clase === 'fuente' && (campo === 'fuente.tensionNominalV' || campo === 'transformador.secundarioV')) {
		for (const s of p.salidas) if (s.papel === 'fase') escribirRuta(s, ['tensionV'], valor);
	}
	if (p.clase === 'variador' && campo === 'vfd.frecuenciaMaxHz') escribirRuta(p.frecuencia, ['maximaHz'], valor);
	if (p.clase === 'variador' && campo === 'vfd.tensionSalidaMaxV') escribirRuta(p.salida, ['tensionV'], valor);
	// Alias nominales legacy consumidos por runtime: proceden del MISMO dato resuelto.
	if (campo === 'proteccion.inA' || campo === 'motor.corrienteNominalA') escribirRuta(entidad, ['corrienteNominal'], valor);
	if (campo === 'bobina.tensionNominalV' || campo === 'motor.tensionNominalV' || campo === 'vfd.tensionEntradaNominalV') escribirRuta(entidad, ['tensionNominal'], valor);
	entidad.comportamiento = p;
}
export function resolverVinculo(v: VinculoTecnico, r: RevisionProductoTecnico, entidad: Dispositivo | Conductor): ResolucionDatoTecnico[] {
	const grupos = new Map<string, DatoTecnico[]>();
	for (const d of r.campos) { const k = claveDato(d); grupos.set(k, [...(grupos.get(k) ?? []), d]); }
	for (const key of Object.keys(v.decisiones)) if (!grupos.has(key)) grupos.set(key, []);
	return [...grupos.entries()].sort(([a],[b]) => comparar(a,b)).map(([clave, candidatos]) => {
		const [campoBruto, canalBruto] = clave.split('@'); const campo = campoBruto as CampoTecnico, canal = canalBruto || undefined;
		const base: ResolucionDatoTecnico = { entidad: v.entidad, entidadId: v.entidadId, clave, campo, ...(canal ? { canal } : {}), estado: 'MISSING', origen: 'AUSENTE', referencia: v.producto, pasos: [], motivos: [], advertencias: [], modelado: !NO_RUNTIME.has(campo) };
		if (!Object.hasOwn(CAMPOS_TECNICOS, campo)) { base.motivos.push('Campo no soportado'); return base; }
		const familiaCampo = campo.split('.')[0].toUpperCase();
		if (familiaCampo !== r.familia && !(r.familia === 'PLC' && familiaCampo === 'ANALOGICA')) {
			return { ...base, estado: 'CONFLICT', modelado: false, motivos: ['Campo/override incompatible con la familia del producto.'] };
		}
		if (r.familia === 'PLC' && 'bornes' in entidad) {
			const perfil = resolverComportamiento(entidad);
			const canales = perfil?.clase === 'controlador' ? campo.startsWith('plc.') ? perfil.salidasDigitales : perfil.entradasAnalogicas ?? [] : [];
			if (!canal || !entidad.bornes.some(b => b.id === canal) || !canales.some(c => c.borne === canal)) {
				return { ...base, estado: 'CONFLICT', modelado: false, motivos: ['Canal inexistente o incompatible en los terminales y perfil persistentes.'] };
			}
			if (campo.startsWith('analogica.') && rutaFisica(campo) && canales.length > 1) {
				return { ...base, estado: 'CONFLICT', modelado: false, motivos: ['El modelo físico tiene una impedancia analógica común: no admite asignarla a una AI particular de un equipo multicanal. No se sobrescriben los demás canales.'] };
			}
		} else if (canal) return { ...base, estado: 'CONFLICT', modelado: false, motivos: ['Este campo no declara un contrato por canal.'] };
		if ('bornes' in entidad && (campo === 'fuente.tensionNominalV' || campo === 'transformador.secundarioV')) {
			const perfil = resolverComportamiento(entidad);
			if (perfil?.clase === 'fuente' && new Set(perfil.salidas.filter(s => s.papel === 'fase').map(s => s.tensionV)).size > 1) {
				return { ...base, estado: 'CONFLICT', modelado: false, motivos: ['Fuente con salidas de distintas tensiones: un valor nominal común no identifica qué salida modificar.'] };
			}
		}
		const decision = v.decisiones[clave];
		if (decision?.modo === 'SIN_HERENCIA') return { ...base, estado: 'NOT_APPLICABLE', motivos: [decision.motivo], pasos: ['Herencia suprimida explícitamente'] };
		const legacy = leerDatoLegacy(entidad, campo, canal);
		let elegido: DatoTecnico | undefined;
		if (decision?.modo === 'OVERRIDE' || decision?.modo === 'CONSERVAR') {
			try { validarDato(decision.dato); } catch (e) { return { ...base, estado: 'CONFLICT', motivos: [String(e)] }; }
			elegido = decision.dato; base.origen = decision.modo; base.pasos.push(`Decisión persistente ${decision.modo}`);
		}
		else {
			const evaluados = candidatos.map(d => ({ d, e: evaluarCondicionesTecnicas({ declaradas: d.condiciones ?? {}, actuales: v.condiciones }) }));
			const compatibles = evaluados.filter(x => x.e.estado === 'RESOLVED');
			if (compatibles.length > 1) return { ...base, estado: 'CONFLICT', motivos: ['Varias entradas aplicables: falta desambiguar condiciones, no se elige la mayor.'] };
			if (!compatibles.length) return { ...base, estado: evaluados.some(x => x.e.estado === 'MISSING') ? 'MISSING' : evaluados.length ? 'NOT_APPLICABLE' : 'MISSING', motivos: evaluados.length ? evaluados.flatMap(x => x.e.motivos) : ['La revisión no declara este campo.'] };
			elegido = compatibles[0].d;
			if (!decision && legacy && !mismoValor(legacy, elegido)) return { ...base, estado: 'CONFLICT', motivos: ['El perfil actual y la ficha difieren. Elegir Conservar o Catálogo antes de aplicar.'] };
			base.origen = 'CATALOGO'; base.pasos.push(`Revisión exacta ${r.revision}; ${r.hash}`);
		}
		const aplica = evaluarCondicionesTecnicas({ declaradas: elegido.condiciones ?? {}, actuales: v.condiciones });
		if (aplica.estado !== 'RESOLVED') return { ...base, estado: aplica.estado, motivos: aplica.motivos };
		const n = normalizarDato(elegido); base.dato = n.dato; base.pasos.push(...n.pasos); base.estado = 'RESOLVED';
		if (Array.isArray(n.dato.valor) && !['bobina.tensionRangoV','analogica.rango'].includes(campo)) {
			base.estado = 'MISSING'; base.modelado = false;
			base.motivos.push('Dato de intervalo conservado: el motor requiere un valor puntual explícito. No se elige media/extremo automáticamente.');
		}
		if (elegido.procedencia.origen === 'DOCUMENTAL') base.advertencias.push('UNVERIFIED_SOURCE: fuente declarada, revisión humana no acreditada por el paquete.');
		if (elegido.procedencia.origen === 'SINTETICO') base.advertencias.push('SINTÉTICO: no usar como ficha certificada de selección real.');
		if (r.estado === 'RETIRADA') base.advertencias.push('Revisión retirada: el vínculo fijado se conserva.');
		return base;
	});
}

const proyecciones = new WeakMap<Proyecto, ResultadoProyectoTecnico>();
/** Proyección pura en frontera de evaluación; reutilizar su resultado durante un ciclo runtime. */
export function resolverProyectoTecnico(original: Proyecto): ResultadoProyectoTecnico {
	const preparada = proyecciones.get(original); if (preparada) return preparada;
	if (!original.datosTecnicos) return { proyecto: original, resoluciones: [], problemas: [] };
	const cfg = original.datosTecnicos; const p = structuredClone(original); const resoluciones: ResolucionDatoTecnico[] = [], problemas: ResultadoProyectoTecnico['problemas'] = [];
	const indice = new Map<string, RevisionTecnica>(); const errores = new Map<string, string>();
	for (const r of cfg.revisiones) {
		const k = claveRevision({ tipo: r.tipo, catalogoId: r.catalogo.id, id: r.id, revision: r.revision, hash: r.hash });
		try { verificarRevision(r); if (indice.has(k) && indice.get(k)!.hash !== r.hash) throw new Error('Dos contenidos para una misma revisión'); indice.set(k, r); } catch (e) { errores.set(k, String(e)); }
	}
	const dispositivos = new Map(p.dispositivos.map(d => [d.id, d])); const conductores = new Map(p.conductores.map(c => [c.id, c]));
	for (const v of [...cfg.vinculos].sort((a,b) => comparar(`${a.entidad}:${a.entidadId}`, `${b.entidad}:${b.entidadId}`))) {
		const entidad = v.entidad === 'DEVICE' ? dispositivos.get(v.entidadId) : conductores.get(v.entidadId);
		const k = claveRevision(v.producto), r = indice.get(k);
		let motivo: string | undefined;
		if (!entidad) motivo = 'Entidad vinculada ausente';
		else if (errores.has(k)) motivo = errores.get(k);
		else if (!r || r.hash !== v.producto.hash || r.tipo !== 'PRODUCTO') motivo = 'MISSING: revisión exacta ausente o hash diferente';
		else if (r.familia !== (v.entidad === 'CONDUCTOR' ? 'CONDUCTOR' : familiaDispositivo(entidad as Dispositivo))) motivo = 'NOT_APPLICABLE: familia incompatible con perfil funcional';
		if (motivo) {
			problemas.push({ entidad: v.entidad, entidadId: v.entidadId, estado: errores.has(k) ? 'CONFLICT' : motivo.startsWith('NOT_APPLICABLE') ? 'NOT_APPLICABLE' : 'MISSING', motivo });
			// Un vínculo roto no autoriza reactivar silenciosamente el modelo legacy.
			// El diseño original sigue intacto y puede rescatarse/desvincularse explícitamente.
			if (entidad && 'bornes' in entidad) {
				const familia = familiaDispositivo(entidad);
				for (const campo of Object.keys(CAMPOS_TECNICOS) as CampoTecnico[]) {
					if (campo.split('.')[0].toUpperCase() === familia) {
						const perfil = resolverComportamiento(entidad);
						if (perfil?.clase === 'controlador') for (const s of perfil.salidasDigitales) aplicarDato(entidad, campo, s.borne, undefined);
						else aplicarDato(entidad, campo, undefined, undefined);
					}
				}
				delete entidad.fisica;
				if (familia && ['MOTOR', 'VFD', 'FUENTE', 'TRANSFORMADOR'].includes(familia)) entidad.comportamiento = { version: 1, clase: 'sin-comportamiento', motivo: `NO_MODELADO: ${motivo}` };
			} else if (entidad) { delete entidad.fisica; }
			continue;
		}
		const datos = resolverVinculo(v, r as RevisionProductoTecnico, entidad!); resoluciones.push(...datos);
		for (const d of datos) if (!(d.estado === 'CONFLICT' && !d.modelado)) aplicarDato(entidad!, d.campo, d.canal, d.estado === 'RESOLVED' ? d.dato?.valor : undefined);
		if ('bornes' in entidad!) {
			const aparato = entidad as Dispositivo;
			const vitales: Record<string, string[]> = {
				motor: ['potenciaMecanicaNominalW','tensionNominalV','frecuenciaHz','fases','eficiencia','factorPotencia'],
				vfd: ['tensionEntradaNominalV','fasesEntrada','potenciaNominalW','eficiencia','frecuenciaBaseHz','frecuenciaMaxHz','tensionSalidaMaxV'],
				fuente: ['tensionNominalV'], transformador: ['primarioV','secundarioV'],
			};
			for (const [grupo, campos] of Object.entries(vitales)) {
				const afectados = datos.filter(d => d.campo.startsWith(`${grupo}.`) && campos.includes(d.campo.split('.')[1]) && d.estado !== 'RESOLVED' && !(d.estado === 'CONFLICT' && !d.modelado));
				if (!afectados.length) continue;
				escribirRuta(aparato, ['fisica', grupo], undefined);
				aparato.comportamiento = { version: 1, clase: 'sin-comportamiento', motivo: `NO_MODELADO: datos técnicos requeridos no resueltos (${afectados.map(d=>d.clave).join(', ')})` };
				problemas.push({ entidad: 'DEVICE', entidadId: aparato.id, estado: 'MISSING', motivo: aparato.comportamiento.motivo });
			}
		}
	}
	const manifestHash = sha256Texto(jsonCanonico({ ...cfg, revisiones: [...cfg.revisiones].sort((a,b) => comparar(a.hash,b.hash)), vinculos: [...cfg.vinculos].sort((a,b) => comparar(`${a.entidad}:${a.entidadId}`,`${b.entidad}:${b.entidadId}`)), instalaciones: [...cfg.instalaciones].sort((a,b) => comparar(a.conductorId,b.conductorId)) }));
	const resultado = { proyecto: p, resoluciones, problemas, manifestHash };
	// Solo el objeto NUEVO es marcado. Mutar el original nunca reutiliza datos antiguos.
	proyecciones.set(p, resultado); return resultado;
}
