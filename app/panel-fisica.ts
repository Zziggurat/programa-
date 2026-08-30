/** Proyeccion compacta de ResultadoFisicaElectrica. Aqui no se calcula ninguna magnitud. */
import { faseDeg, magnitud } from '../src/fisica/complejos.js';
import {
	medirPinza, medirPotenciaCarga, medirResistenciaDirecta, medirTension, medirTrifasico,
	type LecturaInstrumento,
} from '../src/fisica/instrumentos.js';
import { analizarTecnico, type ContextoAnalisisTecnico, type ResultadoAnalisisTecnico } from '../src/diagnostico/analisis.js';
import type { ResultadoDiagnosticoIndustrial } from '../src/diagnostico/motor-causal.js';
import type { ResultadoFisicaElectrica } from '../src/fisica/topologia-proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import type { EstadoTablero } from '../src/motores/simulacion.js';
import { escaparHtml } from './dialogos.js';

const n = (valor: number | undefined, unidad = '', decimales = 3): string => valor === undefined || !Number.isFinite(valor)
	? '—' : `${valor.toLocaleString('es-CL', { maximumFractionDigits: decimales })}${unidad ? ` ${unidad}` : ''}`;
const z = (valor: { re: number; im: number } | undefined): string => valor
	? `${n(valor.re, '', 4)} ${valor.im < 0 ? '−' : '+'} j${n(Math.abs(valor.im), '', 4)} Ω` : '—';
const idDispositivo = (nodo: string): string => nodo.split('::')[0];
const titulo = (proyecto: Proyecto, id: string): string => {
	const d = proyecto.dispositivos.find((x) => x.id === id);
	return d?.designacion ?? d?.descripcion ?? id;
};
const fila = (clase: string, id: string, etiqueta: string, detalle: string) =>
	`<div class="fisica-fila ${clase}" data-fisica-dispositivo="${escaparHtml(id)}">`
	+ `<b>${escaparHtml(etiqueta)}</b><span>${detalle}</span></div>`;

export interface SeleccionInstrumentosFisica {
	nodoA?: string;
	nodoB?: string;
	modoTension?: 'VAC' | 'VDC' | 'OHM';
	conductorId?: string;
	sistemaId?: string;
	cargaId?: string;
	equipoAnalisisId?: string;
}

export interface ContextoPanelAnalisisFisica {
	diagnostico: ResultadoDiagnosticoIndustrial;
	estadosProteccion?: ContextoAnalisisTecnico['estadosProteccion'];
}

const opcion = (valor: string, etiqueta: string, actual: string | undefined): string =>
	`<option value="${escaparHtml(valor)}"${valor === actual ? ' selected' : ''}>${escaparHtml(etiqueta)}</option>`;

function instrumentos(
	proyecto: Proyecto,
	fisica: ResultadoFisicaElectrica,
	seleccion: SeleccionInstrumentosFisica,
): string {
	const nodos = [...fisica.red.nodos.values()].filter((x) => x.calidad === 'VALIDA').sort((a, b) => a.id.localeCompare(b.id));
	const fuente = fisica.medicion.fuentes[0];
	const nodoA = nodos.some((x) => x.id === seleccion.nodoA) ? seleccion.nodoA
		: fuente?.de ?? nodos[0]?.id;
	const nodoB = nodos.some((x) => x.id === seleccion.nodoB) ? seleccion.nodoB
		: fuente?.a ?? nodos.find((x) => x.id !== nodoA)?.id;
	const modo = seleccion.modoTension ?? (fuente?.modo === 'DC' ? 'VDC' : 'VAC');
	const conductores = [...fisica.conductores.keys()].sort((a, b) => a.localeCompare(b));
	const conductor = conductores.includes(seleccion.conductorId ?? '') ? seleccion.conductorId : conductores[0];
	const sistemas = [...fisica.trifasicos.keys()].sort((a, b) => a.localeCompare(b));
	const sistema = sistemas.includes(seleccion.sistemaId ?? '') ? seleccion.sistemaId : sistemas[0];
	const cargas = [...fisica.red.cargas.keys()].sort((a, b) => a.localeCompare(b));
	const carga = cargas.includes(seleccion.cargaId ?? '') ? seleccion.cargaId : cargas[0];
	const etiquetaNodo = (id: string) => `${titulo(proyecto, idDispositivo(id))}:${id.split('::').slice(1).join('::')}`;
	const selectorNodos = (campo: 'a' | 'b', actual: string | undefined) => `<select data-instrumento-nodo-${campo}>`
		+ nodos.slice(0, 160).map((x) => opcion(x.id, etiquetaNodo(x.id), actual)).join('') + '</select>';
	return '<details class="fisica-bloque fisica-instrumentos" open><summary>Instrumentos V6</summary><div>'
		+ `<div class="instrumento-tarjeta"><b>Multímetro</b><label>A ${selectorNodos('a', nodoA)}</label>`
		+ `<label>B ${selectorNodos('b', nodoB)}</label><label>Función <select data-instrumento-modo>`
		+ opcion('VAC', 'VAC', modo) + opcion('VDC', 'VDC', modo) + opcion('OHM', 'Ω / continuidad', modo) + '</select></label>'
		+ '<output data-instrumento-multimetro>—</output></div>'
		+ `<div class="instrumento-tarjeta"><b>Pinza amperimétrica</b><label>Conductor <select data-instrumento-conductor>`
		+ conductores.map((id) => opcion(id, id, conductor)).join('') + '</select></label>'
		+ '<output data-instrumento-pinza>—</output></div>'
		+ (sistemas.length ? `<div class="instrumento-tarjeta"><b>Analizador trifásico</b><label>Sistema <select data-instrumento-sistema>`
			+ sistemas.map((id) => opcion(id, titulo(proyecto, id), sistema)).join('') + '</select></label>'
			+ '<output data-instrumento-trifasico>—</output></div>' : '')
		+ (cargas.length ? `<div class="instrumento-tarjeta"><b>Analizador de potencia</b><label>Carga <select data-instrumento-carga>`
			+ cargas.map((id) => opcion(id, id, carga)).join('') + '</select></label>'
			+ '<output data-instrumento-potencia>—</output></div>' : '')
		+ '<small>Lecturas proyectadas del último resultado de PhysicsEngine; este panel no recalcula la red.</small>'
		+ '</div></details>';
}

const textoLectura = (x: LecturaInstrumento, decimales = 3): string => x.valor === undefined
	? `${x.proveniencia} · ${x.detalle ?? 'sin valor'}`
	: `${n(x.valor, x.unidad, decimales)} · ${x.proveniencia}${x.detalle ? ` · ${x.detalle}` : ''}`;

/** Refresca salidas desde el snapshot físico recibido; nunca invoca `simular` ni el solver. */
export function actualizarInstrumentosFisica(panel: HTMLElement, fisica: ResultadoFisicaElectrica): void {
	const nodoA = panel.querySelector<HTMLSelectElement>('[data-instrumento-nodo-a]')?.value;
	const nodoB = panel.querySelector<HTMLSelectElement>('[data-instrumento-nodo-b]')?.value;
	const modo = panel.querySelector<HTMLSelectElement>('[data-instrumento-modo]')?.value;
	const salidaMultimetro = panel.querySelector<HTMLOutputElement>('[data-instrumento-multimetro]');
	if (nodoA && nodoB && salidaMultimetro) {
		const lectura = modo === 'OHM' ? medirResistenciaDirecta(fisica, nodoA, nodoB)
			: medirTension(fisica, nodoA, nodoB, modo === 'VDC' ? 'VDC' : 'VAC');
		salidaMultimetro.textContent = textoLectura(lectura);
		salidaMultimetro.title = lectura.detalle ?? '';
		salidaMultimetro.dataset.proveniencia = lectura.proveniencia;
	}
	const conductor = panel.querySelector<HTMLSelectElement>('[data-instrumento-conductor]')?.value;
	const salidaPinza = panel.querySelector<HTMLOutputElement>('[data-instrumento-pinza]');
	if (conductor && salidaPinza) {
		const lectura = medirPinza(fisica, conductor);
		salidaPinza.textContent = `${textoLectura(lectura)}${lectura.faseDeg === undefined ? '' : ` · ∠ ${n(lectura.faseDeg, '°', 1)}`}`
			+ `${lectura.sentido ? ` · ${lectura.sentido}` : ''}`;
		salidaPinza.dataset.proveniencia = lectura.proveniencia;
	}
	const sistema = panel.querySelector<HTMLSelectElement>('[data-instrumento-sistema]')?.value;
	const salidaTrifasica = panel.querySelector<HTMLOutputElement>('[data-instrumento-trifasico]');
	if (sistema && salidaTrifasica) {
		const t = medirTrifasico(fisica, sistema);
		salidaTrifasica.textContent = !t ? 'NO_DISPONIBLE' : [
			`V12 ${n(t.v12.valor, 'V', 1)}`, `V23 ${n(t.v23.valor, 'V', 1)}`, `V31 ${n(t.v31.valor, 'V', 1)}`,
			`I1 ${n(t.i1.valor, 'A')}`, `I2 ${n(t.i2.valor, 'A')}`, `I3 ${n(t.i3.valor, 'A')}`, `IN ${n(t.in.valor, 'A')}`,
			`desbal. V ${n(t.desequilibrioTension.valor, '%', 2)}`, `I ${n(t.desequilibrioCorriente.valor, '%', 2)}`,
			`V+ ${n(t.secuenciaPositivaV.valor, 'V', 1)}`, `V− ${n(t.secuenciaNegativaV.valor, 'V', 1)}`, `V0 ${n(t.secuenciaCeroV.valor, 'V', 1)}`,
			`· ${t.v12.proveniencia}`,
		].join(' · ');
	}
	const carga = panel.querySelector<HTMLSelectElement>('[data-instrumento-carga]')?.value;
	const salidaPotencia = panel.querySelector<HTMLOutputElement>('[data-instrumento-potencia]');
	if (carga && salidaPotencia) {
		const p = medirPotenciaCarga(fisica, carga);
		salidaPotencia.textContent = !p ? 'NO_DISPONIBLE' : `P ${n(p.p.valor, 'W', 1)} · Q ${n(p.q.valor, 'var', 1)}`
			+ ` · S ${n(p.s.valor, 'VA', 1)} · PF ${n(p.pf.valor, '', 3)} · ${p.p.proveniencia}`;
	}
}

function panelAnalisis(
	proyecto: Proyecto,
	fisica: ResultadoFisicaElectrica,
	seleccion: SeleccionInstrumentosFisica,
): string {
	const candidatos = proyecto.dispositivos.filter((d) => d.fisica?.motor || d.fisica?.vfd || d.fisica?.transformador
		|| d.fisica?.proteccion || d.fisica?.diferencial || [...fisica.red.cargas.keys()].some((id) => id.includes(`:${d.id}:`)))
		.sort((a, b) => a.id.localeCompare(b.id));
	const actual = seleccion.equipoAnalisisId === '@circuito' || candidatos.some((d) => d.id === seleccion.equipoAnalisisId)
		? seleccion.equipoAnalisisId : '@circuito';
	return '<details class="fisica-bloque fisica-analisis" open><summary>ANALIZAR circuito / equipo</summary><div>'
		+ '<div class="analisis-barra"><label>Objetivo <select data-analisis-equipo>'
		+ opcion('@circuito', `Circuito · ${proyecto.nombre}`, actual)
		+ candidatos.map((d) => opcion(d.id, `${d.designacion ?? d.id} · ${d.descripcion ?? d.tipo}`, actual)).join('')
		+ '</select></label><button data-analisis-ejecutar>ANALIZAR</button></div><div data-analisis-resultado></div>'
		+ '</div></details>';
}

function htmlAnalisis(a: ResultadoAnalisisTecnico): string {
	const topologia = `<div class="analisis-seccion"><b>Topología · ${a.topologia.orientacion}</b>`
		+ `<span>${escaparHtml(a.topologia.explicacion)}</span>`
		+ (a.topologia.trayecto.length ? `<span>${a.topologia.trayecto.map(escaparHtml).join(' → ')}</span>` : '')
		+ (a.topologia.conductores.length ? `<small>Conductores: ${a.topologia.conductores.map(escaparHtml).join(', ')}</small>` : '') + '</div>';
	const magnitudes = `<div class="analisis-magnitudes">${a.magnitudes.map((m) => `<div><b>${escaparHtml(m.etiqueta)}</b>`
		+ `<span>${n(m.valor, m.unidad ?? '', 3)}</span><small>${escaparHtml(m.origen)}</small></div>`).join('')}</div>`;
	const diagnosticos = a.diagnosticos.length ? `<div class="analisis-seccion"><b>Diagnósticos y evidencias</b>${a.diagnosticos.map((d) =>
		`<article><strong>${escaparHtml(d.clasificacion)} · ${escaparHtml(d.confianza)}</strong><span>${escaparHtml(d.resumen)}</span>`
		+ `<ul>${d.evidencias.map((e) => `<li>${escaparHtml(e.codigo)} · ${escaparHtml(e.descripcion)}`
			+ `${e.valor === undefined ? '' : ` · ${n(e.valor, e.unidad ?? '')}`} · ${escaparHtml(e.origen)}</li>`).join('')}</ul></article>`).join('')}</div>`
		: '<div class="analisis-seccion"><b>Diagnósticos</b><span>Sin hallazgos sostenidos para este objetivo.</span></div>';
	const hotspots = a.hotspots.length ? `<div class="analisis-seccion"><b>Pérdidas elevadas localizadas</b>${a.hotspots.map((h) =>
		`<span>${escaparHtml(h.elementoId)} · ${n(h.perdidaW, 'W')} · ${escaparHtml(h.detalle)}</span>`).join('')}</div>` : '';
	return `<header><b>${escaparHtml(a.titulo)}</b><span>${escaparHtml(a.estado)}</span></header><p>${escaparHtml(a.resumen)}</p>`
		+ topologia + magnitudes + hotspots + diagnosticos
		+ `<details><summary>Limitaciones del modelo</summary><ul>${a.limitaciones.map((l) => `<li>${escaparHtml(l)}</li>`).join('')}</ul></details>`;
}

export function actualizarAnalisisFisica(
	panel: HTMLElement,
	proyecto: Proyecto,
	fisica: ResultadoFisicaElectrica,
	contexto: ContextoPanelAnalisisFisica,
): ResultadoAnalisisTecnico | undefined {
	const selector = panel.querySelector<HTMLSelectElement>('[data-analisis-equipo]');
	const salida = panel.querySelector<HTMLElement>('[data-analisis-resultado]');
	if (!selector || !salida) return undefined;
	const analisis = analizarTecnico({ proyecto, fisica, diagnostico: contexto.diagnostico,
		equipoId: selector.value === '@circuito' ? undefined : selector.value,
		estadosProteccion: contexto.estadosProteccion });
	salida.innerHTML = htmlAnalisis(analisis);
	salida.dataset.tipoAnalisis = analisis.tipo;
	salida.dataset.objetivoAnalisis = analisis.objetivoId;
	return analisis;
}

function resumenNodos(proyecto: Proyecto, fisica: ResultadoFisicaElectrica): string {
	const todos = [...fisica.red.nodos.values()].sort((a, b) => a.id.localeCompare(b.id));
	const visibles = todos.slice(0, 80);
	return '<details class="fisica-bloque"><summary>Bornes / nodos (' + todos.length + ')</summary><div>'
		+ visibles.map((r) => {
			const etiqueta = `${titulo(proyecto, idDispositivo(r.id))}:${r.id.split('::').slice(1).join('::')}`;
			const medida = r.tensionV ? `${n(magnitud(r.tensionV), 'V', 2)} ∠ ${n(faseDeg(r.tensionV), '°', 1)}` : 'SIN REFERENCIA';
			return fila(r.calidad.toLowerCase(), idDispositivo(r.id), etiqueta,
				`${escaparHtml(medida)} · ${escaparHtml(r.calidad)} · ${escaparHtml(r.origen)}`);
		}).join('')
		+ (todos.length > visibles.length ? `<small>Se muestran ${visibles.length} de ${todos.length} nodos.</small>` : '')
		+ '</div></details>';
}

function resumenConductores(proyecto: Proyecto, fisica: ResultadoFisicaElectrica): string {
	const todos = [...fisica.conductores.values()].sort((a, b) => a.conductorId.localeCompare(b.conductorId));
	return '<details class="fisica-bloque" open><summary>Conductores (' + todos.length + ')</summary><div>'
		+ todos.slice(0, 80).map((c) => {
			const original = proyecto.conductores.find((x) => x.id === c.conductorId);
			const extremos = original ? `${titulo(proyecto, original.de.dispositivoId)}:${original.de.borneId} → `
				+ `${titulo(proyecto, original.a.dispositivoId)}:${original.a.borneId}` : c.conductorId;
			return `<div class="fisica-conductor" data-fisica-conductor="${escaparHtml(c.conductorId)}">`
				+ `<button class="fisica-enlace" data-fisica-seleccionar-cable="${escaparHtml(c.conductorId)}">${escaparHtml(c.conductorId)}</button>`
				+ `<span class="fisica-extremos">${escaparHtml(extremos)}</span>`
				+ `<span>${escaparHtml(c.material)} · <label>L <input data-fisica-longitud="${escaparHtml(c.conductorId)}" type="number" min="0.001" step="0.1" value="${c.longitudM}"> m</label>`
				+ ` · <label>A <input data-fisica-seccion="${escaparHtml(c.conductorId)}" type="number" min="0.01" step="0.1" value="${c.seccionMm2}"> mm²</label></span>`
				+ `<span>R ${n(c.rOhm, 'Ω', 4)} · X ${n(c.xOhm, 'Ω', 4)} · |Z| ${n(magnitud(c.zOhm), 'Ω', 4)}</span>`
				+ `<span>I ${n(c.corrienteA, 'A', 3)} · ΔV ${n(c.caidaV, 'V', 3)} · ${n(c.caidaPct, '%', 3)} · pérdidas ${n(c.perdidaW, 'W', 3)}</span>`
				+ `<small>longitud ${escaparHtml(c.origenLongitud)} · sección ${escaparHtml(c.origenSeccion)} · reactancia ${escaparHtml(c.origenReactancia)}</small>`
				+ `<span class="fisica-acciones"><button data-fisica-falla-id="abierto:${escaparHtml(c.conductorId)}" data-fisica-falla-tipo="CONDUCTOR_ABIERTO" data-fisica-rama="conductor:${escaparHtml(c.conductorId)}">Abrir conductor</button>`
				+ `<button data-fisica-falla-id="flojo:${escaparHtml(c.conductorId)}" data-fisica-falla-tipo="RESISTENCIA_ANORMAL" data-fisica-rama="conductor:${escaparHtml(c.conductorId)}" data-fisica-resistencia="1">Terminal flojo +1 Ω</button></span></div>`;
		}).join('') + '</div></details>';
}

function resumenCargas(proyecto: Proyecto, fisica: ResultadoFisicaElectrica): string {
	const cargas = [...fisica.red.cargas.values()].sort((a, b) => a.id.localeCompare(b.id));
	if (!cargas.length) return '';
	return '<details class="fisica-bloque" open><summary>Cargas (' + cargas.length + ')</summary><div>'
		+ cargas.map((c) => {
			const id = c.id.split(':')[1] ?? c.id;
			const s = magnitud(c.potenciaVA);
			return fila('', id, `${titulo(proyecto, id)} · ${c.id.split(':').at(-1)}`,
				`V ${n(magnitud(c.tensionV), 'V', 2)} · I ${n(magnitud(c.corrienteA), 'A', 3)} · `
				+ `P ${n(c.potenciaVA.re, 'W', 1)} · Q ${n(c.potenciaVA.im, 'var', 1)} · S ${n(s, 'VA', 1)} · PF ${n(c.factorPotencia, '', 3)} · ${escaparHtml(c.origen)}`);
		}).join('') + '</div></details>';
}

function resumenProtecciones(proyecto: Proyecto, fisica: ResultadoFisicaElectrica): string {
	const protecciones = [...fisica.protecciones.values()].sort((a, b) => a.dispositivoId.localeCompare(b.dispositivoId));
	if (!protecciones.length) return '';
	return '<details class="fisica-bloque" open><summary>Protecciones (' + protecciones.length + ')</summary><div>'
		+ protecciones.map((p) => fila(p.evaluacion.region.toLowerCase(), p.dispositivoId, titulo(proyecto, p.dispositivoId),
			`In ${n(p.inA, 'A')} · I ${n(p.corrienteA, 'A')} · ${n(p.evaluacion.multiploIn, ' In', 2)} · `
			+ `${escaparHtml(p.evaluacion.region)} · ${p.evaluacion.tMinS === undefined ? '' : `${n(p.evaluacion.tMinS, 's')}…${n(p.evaluacion.tMaxS, 's')} · `}`
			+ `${escaparHtml(p.evaluacion.explicacion)}${p.corrienteResidualA === undefined ? '' : ` · IΔ ${n(p.corrienteResidualA, 'A')}`}`)).join('')
		+ '</div></details>';
}

function controlesFalla(proyecto: Proyecto, estado: EstadoTablero): string {
	const activas = new Set(Object.values(estado).flatMap((s) => s.fallasFisicas ?? []).map((f) => f.id));
	const botones: string[] = [];
	for (const d of proyecto.dispositivos) {
		const carga = d.fisica?.carga;
		if (!carga) continue;
		const datos: { sufijo: string; tipo: string; a: string; b: string; texto: string }[] = [];
		if (carga.terminales) datos.push({ sufijo: 'ln', tipo: 'L_N', a: carga.terminales[0], b: carga.terminales[1], texto: 'Corto L-N' });
		if (carga.fases) {
			datos.push({ sufijo: 'll', tipo: 'L_L', a: carga.fases[0], b: carga.fases[1], texto: 'Corto L-L' });
			datos.push({ sufijo: '3f', tipo: 'TRIFASICA', a: carga.fases[0], b: '__estrella_v5', texto: 'Corto 3F simétrico' });
		}
		const pe = d.bornes.find((b) => b.tipo === 'PE')?.id;
		const fase = carga.terminales?.[0] ?? carga.fases?.[0];
		if (pe && fase) datos.push({ sufijo: 'lpe', tipo: 'L_PE', a: fase, b: pe, texto: 'Corto L-PE' });
		for (const x of datos) {
			const id = `cc:${d.id}:${x.sufijo}`; const activa = activas.has(id);
			botones.push(`<button class="${activa ? 'activo' : ''}" data-fisica-falla-id="${escaparHtml(id)}" `
				+ `data-fisica-falla-tipo="${x.tipo}" data-fisica-owner="${escaparHtml(d.id)}" `
				+ `data-fisica-nodo-a="${escaparHtml(`${d.id}::${x.a}`)}" data-fisica-nodo-b="${escaparHtml(`${d.id}::${x.b}`)}">`
				+ `${activa ? 'Retirar' : 'Inyectar'} ${escaparHtml(x.texto)} en ${escaparHtml(titulo(proyecto, d.id))}</button>`);
		}
	}
	return botones.length ? `<div class="fisica-inyeccion"><b>Fallas físicas de ensayo</b>${botones.join('')}</div>` : '';
}

function resumenFallas(fisica: ResultadoFisicaElectrica): string {
	if (!fisica.fallas.length) return '';
	return '<details class="fisica-bloque falla" open><summary>Falla / coordinación</summary><div>'
		+ fisica.fallas.map((f) => `<div class="fisica-falla"><b>${escaparHtml(f.tipo)}${f.despejada ? ' · DESPEJADA' : ''}</b>`
			+ `<span>${escaparHtml(f.nodoA ?? '—')} ↔ ${escaparHtml(f.nodoB ?? '—')}</span>`
			+ `<span>Vprefalla ${n(f.vPrefallaV ? magnitud(f.vPrefallaV) : undefined, 'V')} · Zth ${z(f.zTheveninOhm)} · Zf ${z(f.zFallaOhm)} · Icc ${n(f.iccA ? magnitud(f.iccA) : undefined, 'A', 1)} · ${escaparHtml(f.origen)}</span></div>`).join('')
		+ fisica.selectividad.map((s) => `<div class="fisica-selectividad ${s.clasificacion.toLowerCase()}"><b>${escaparHtml(s.clasificacion)}</b>`
			+ `<span>${escaparHtml(s.aguasAbajoId)} → ${escaparHtml(s.aguasArribaId)} · ${escaparHtml(s.explicacion)}</span></div>`).join('')
		+ '</div></details>';
}

function resumenAnalogico(fisica: ResultadoFisicaElectrica): string {
	if (!fisica.lazosAnalogicos.length) return '';
	return '<details class="fisica-bloque" open><summary>Lazos analógicos físicos</summary><div>'
		+ fisica.lazosAnalogicos.map((l) => `<div class="fisica-fila ${l.calidad.toLowerCase()}"><b>${escaparHtml(l.tipo)}</b>`
			+ `<span>${escaparHtml(l.fuenteId ?? '')} → ${escaparHtml(l.entradaId ?? '')} · demanda ${n(l.valorDemandado, l.tipo === '4_20_MA' ? 'mA' : 'V')} · salida ${n(l.corrienteMA ?? l.tensionV, l.tipo === '4_20_MA' ? 'mA' : 'V')} · cable ${n(l.resistenciaCableOhm, 'Ω')} · `
			+ `<label>burden <input data-fisica-burden="${escaparHtml((l.entradaId ?? '').split('::')[0])}" type="number" min="0" step="10" value="${l.burdenOhm}"> Ω</label>`
			+ ` · caída ${n(l.caidaCableV, 'V')} · ${escaparHtml(l.calidad)}</span></div>`).join('')
		+ '</div></details>';
}

export function htmlFisicaV5(
	proyecto: Proyecto,
	fisica: ResultadoFisicaElectrica,
	estado: EstadoTablero,
	seleccionInstrumentos: SeleccionInstrumentosFisica = {},
	contextoAnalisis?: ContextoPanelAnalisisFisica,
): string {
	if (!fisica.activo) return '';
	const m = fisica.red.metricas;
	const cabecera = `<div class="fisica-resumen"><b>PhysicsEngine V5</b>`
		+ `<span>fuente ${n(fisica.red.potenciaFuentesW, 'W', 1)}</span><span>carga ${n(fisica.red.potenciaCargasW, 'W', 1)}</span>`
		+ `<span>pérdidas ${n(fisica.red.potenciaPerdidasW, 'W', 2)}</span><span>balance ${n(m.errorBalanceW, 'W', 3)}</span>`
		+ `<span>${m.nodos} nodos · ${m.ramas} ramas · ${m.iteraciones} iter. · ${n(m.tiempoMs, 'ms', 2)}</span>`
		+ `<em>${m.convergio ? 'CONVERGIÓ' : 'RESULTADO DEGRADADO'}</em></div>`;
	const diagnosticos = fisica.diagnosticos.length ? `<div class="fisica-diagnosticos">${fisica.diagnosticos.map((d) =>
		`<div><b>${escaparHtml(d.codigo)}</b> ${escaparHtml(d.mensaje)}</div>`).join('')}</div>` : '';
	return '<h3 class="titulo-sim">Magnitudes físicas V6</h3>' + cabecera + instrumentos(proyecto, fisica, seleccionInstrumentos)
		+ (contextoAnalisis ? panelAnalisis(proyecto, fisica, seleccionInstrumentos) : '')
		+ controlesFalla(proyecto, estado)
		+ resumenFallas(fisica) + resumenConductores(proyecto, fisica) + resumenNodos(proyecto, fisica)
		+ resumenCargas(proyecto, fisica) + resumenProtecciones(proyecto, fisica) + resumenAnalogico(fisica) + diagnosticos;
}
