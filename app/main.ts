/**
 * TableroStudio — Editor 3D del gabinete.
 *
 * Configurador completo: catálogo de aparatos, arrastre con anclaje a riel, cableado
 * desde el panel de propiedades, estructura editable (placa, rieles, canaletas),
 * guardar/abrir proyecto, exportación del dossier técnico y verificación eléctrica
 * en vivo. Todo apoyado en los motores del núcleo (src/motores).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { conductoresEn, crearProyecto, posicionTexto } from '../src/modelo/proyecto.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto, Hallazgo } from '../src/motores/drc.js';
import { rutearConductores, ResultadoRuteo } from '../src/motores/ruteo.js';
import { sincronizarEsquemaGabinete } from '../src/motores/sincronizacion.js';
import { generarReferencias } from '../src/motores/referencias.js';
import { generarPlanBorneros } from '../src/motores/bornes.js';
import { generarInformeHTML } from '../src/motores/documentacion.js';
import { cajaDe, construirCables, construirCotas, construirEscenario, DatosCota, Escenario } from './escena3d.js';
import { PLANTILLAS, crearDesdePlantilla } from './catalogo.js';

type Modo = 'editor' | 'trabajo';
let modo: Modo = 'editor';

/* ------------------------------ Estado ------------------------------ */

const CLAVE_AUTOSAVE = 'tablerostudio-proyecto';
const SNAP_RIEL = 20;      // el centro del aparato queda 20 mm bajo el eje del riel
const UMBRAL_SNAP = 45;    // distancia máxima para anclarse a un riel

function gabineteVacio(anchoMm = 600, altoMm = 800) {
	return {
		ancho: anchoMm,
		alto: altoMm,
		rieles: [
			{ id: 'riel1', x: 30, y: 60, largo: anchoMm - 60 },
			{ id: 'riel2', x: 30, y: Math.round(altoMm * 0.45), largo: anchoMm - 60 },
			{ id: 'riel3', x: 30, y: altoMm - 180, largo: anchoMm - 60 },
		],
		canaletas: [
			{ id: 'ch1', x: 20, y: 140, largo: anchoMm - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
			{ id: 'ch2', x: 20, y: Math.round(altoMm * 0.45) + 80, largo: anchoMm - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
			{ id: 'ch3', x: 20, y: altoMm - 100, largo: anchoMm - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
			{ id: 'cv1', x: 20, y: 140, largo: altoMm - 240, orientacion: 'v' as const, ancho: 40, alto: 60 },
		],
		colocaciones: [],
	};
}

function proyectoNuevo(): Proyecto {
	const p = crearProyecto('Tablero nuevo');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = gabineteVacio();
	return p;
}

function cargarInicial(): Proyecto {
	try {
		const guardado = localStorage.getItem(CLAVE_AUTOSAVE);
		if (guardado) {
			const p = JSON.parse(guardado);
			if (p && p.formato === 'tablero-studio' && p.gabinete) return p as Proyecto;
		}
	} catch { /* sin localStorage (p. ej. artifact con storage bloqueado) */ }
	const p = tableroEjemplo();
	numerarDispositivos(p);
	return p;
}

let proyecto: Proyecto = cargarInicial();

let hallazgos: Hallazgo[] = [];
let ruteo: ResultadoRuteo;

function recalcular(): void {
	const potenciales = calcularPotenciales(proyecto);
	numerarConductores(proyecto, potenciales);
	ruteo = rutearConductores(proyecto);
	hallazgos = verificarProyecto(proyecto, potenciales);
	const sync = sincronizarEsquemaGabinete(proyecto);
	for (const [a, b] of sync.solapes) {
		hallazgos.push({ regla: 'S1-solape', severidad: 'error', mensaje: `${a} y ${b} se solapan en la placa` });
	}
	for (const id of sync.faltanEnGabinete) {
		hallazgos.push({ regla: 'S2-falta-colocar', severidad: 'aviso', mensaje: `${id} no está colocado en el gabinete` });
	}
	try {
		localStorage.setItem(CLAVE_AUTOSAVE, JSON.stringify(proyecto));
	} catch { /* sin persistencia disponible */ }
}
recalcular();

/* ------------------------- Historial (deshacer/rehacer) ------------------------- */

const pila: string[] = [];      // estados anteriores (JSON)
const rehacerPila: string[] = [];
let capturaPendiente = false;

/** Guarda el estado ACTUAL antes de una mutación, para poder deshacerla. */
function capturar(): void {
	pila.push(JSON.stringify(proyecto));
	if (pila.length > 60) pila.shift();
	rehacerPila.length = 0;
	capturaPendiente = false;
	actualizarBotonesHistorial();
}

/** Programa una captura para el próximo microtask (evita duplicar en cambios encadenados). */
function marcarCambio(): void {
	if (capturaPendiente) return;
	capturaPendiente = true;
	pila.push(JSON.stringify(proyecto));
	if (pila.length > 60) pila.shift();
	rehacerPila.length = 0;
	queueMicrotask(() => { capturaPendiente = false; });
	actualizarBotonesHistorial();
}

function deshacer(): void {
	if (pila.length === 0) return;
	rehacerPila.push(JSON.stringify(proyecto));
	proyecto = JSON.parse(pila.pop()!) as Proyecto;
	trasCambiarProyecto();
}

function rehacer(): void {
	if (rehacerPila.length === 0) return;
	pila.push(JSON.stringify(proyecto));
	proyecto = JSON.parse(rehacerPila.pop()!) as Proyecto;
	trasCambiarProyecto();
}

function actualizarBotonesHistorial(): void {
	($('btn-deshacer') as HTMLButtonElement).disabled = pila.length === 0;
	($('btn-rehacer') as HTMLButtonElement).disabled = rehacerPila.length === 0;
}

/* ------------------------------ Escena ------------------------------ */

const contenedor = document.getElementById('escena')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
contenedor.appendChild(renderer.domElement);

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x171a1d);
escena.fog = new THREE.Fog(0x171a1d, 2200, 4200);

const camara = new THREE.PerspectiveCamera(42, 1, 1, 8000);

const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.maxPolarAngle = Math.PI * 0.55;

const pmrem = new THREE.PMREMGenerator(renderer);
escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;
escena.environmentIntensity = 0.55;

escena.add(new THREE.HemisphereLight(0xf2f5f8, 0x33383e, 0.55));
const sol = new THREE.DirectionalLight(0xffffff, 1.9);
sol.position.set(500, 750, 900);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.near = 10;
sol.shadow.camera.far = 4000;
sol.shadow.camera.left = -1000;
sol.shadow.camera.right = 1000;
sol.shadow.camera.top = 1200;
sol.shadow.camera.bottom = -1200;
sol.shadow.bias = -0.0004;
escena.add(sol);
const contraluz = new THREE.DirectionalLight(0x88aaff, 0.3);
contraluz.position.set(-600, 200, -400);
escena.add(contraluz);

const suelo = new THREE.GridHelper(4000, 80, 0x2c3238, 0x22272c);
escena.add(suelo);

let escenario: Escenario = construirEscenario(proyecto);
escena.add(escenario.raiz);

function encuadrar(): void {
	const g = proyecto.gabinete!;
	const distancia = Math.max(g.ancho * 1.7, g.alto * 1.4, 780);
	camara.position.set(g.ancho * 0.5, g.alto * 0.1, distancia);
	controles.target.set(0, 0, 0);
	suelo.position.y = -(g.alto / 2 + 42);
}
encuadrar();

function reconstruirCables(): void {
	escenario.cables.clear();
	escenario.cables.add(construirCables(proyecto, ruteo.rutas, escenario.aEscena));
	escenario.cables.visible = ($('ver-cables') as HTMLInputElement).checked;
}

function reconstruirCotas(): void {
	escenario.cotas.clear();
	escenario.cotas.add(construirCotas(proyecto, escenario.aEscena));
	escenario.cotas.visible = ($('ver-cotas') as HTMLInputElement).checked;
}

/** Desmonta y vuelve a construir todo el gabinete. */
function montarEscenario(): void {
	escena.remove(escenario.raiz);
	escenario = construirEscenario(proyecto);
	escena.add(escenario.raiz);
	reconstruirCables();
	reconstruirCotas();
	for (const t of escenario.tapas) t.visible = ($('ver-tapas') as HTMLInputElement).checked;
	for (const t of escenario.etiquetas) t.visible = ($('ver-etiquetas') as HTMLInputElement).checked;
	suelo.position.y = -(proyecto.gabinete!.alto / 2 + 42);
}

/** Recalcula, reconstruye y repinta todo (tras un cambio estructural). */
function actualizarTodo(): void {
	recalcular();
	montarEscenario();
	pintarPaneles();
	pintarSeleccion();
}

/** Tras reemplazar el objeto `proyecto` (deshacer/rehacer/abrir/nuevo). */
function trasCambiarProyecto(): void {
	if (seleccionadoId && !proyecto.dispositivos.some((d) => d.id === seleccionadoId)) {
		seleccionadoId = undefined;
		materialesResaltados = [];
	}
	recalcular();
	montarEscenario();
	pintarCatalogo();
	pintarPaneles();
	pintarEstructura();
	pintarSeleccion();
	actualizarBotonesHistorial();
}

/* --------------------------- Utilidades UI --------------------------- */

function $(id: string): HTMLElement {
	return document.getElementById(id)!;
}

function descargar(nombre: string, contenido: string, tipo = 'text/plain'): void {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
	a.download = nombre;
	a.click();
	URL.revokeObjectURL(a.href);
}

const etiquetaDe = (id: string): string => {
	const d = proyecto.dispositivos.find((x) => x.id === id);
	return d ? (d.designacion ?? d.id) : id;
};

/* ------------------------------ Catálogo ------------------------------ */

function pintarCatalogo(): void {
	const cont = $('catalogo');
	cont.innerHTML = '';
	let grupoActual = '';
	for (const p of PLANTILLAS) {
		if (p.grupo !== grupoActual) {
			grupoActual = p.grupo;
			cont.insertAdjacentHTML('beforeend', `<div class="grupo-catalogo">${p.grupo}</div>`);
		}
		const btn = document.createElement('button');
		btn.className = 'item-catalogo';
		btn.title = `${p.descripcion}\n${p.fabricante} ${p.referencia} · ${p.ancho}×${p.alto} mm`;
		btn.innerHTML = `<span class="chip-color" style="background:${p.color}"></span><span class="nombre">${p.nombre}</span><span class="mas">＋</span>`;
		btn.onclick = () => anadirDesdeCatalogo(p.id);
		cont.appendChild(btn);
	}
}

/** Busca el primer hueco libre sobre un riel para una huella ancho×alto. */
function buscarHueco(ancho: number, alto: number): { x: number; y: number } {
	const g = proyecto.gabinete!;
	const MARGEN = 8;
	for (const riel of g.rieles) {
		const y = riel.y + SNAP_RIEL - alto / 2;
		if (y < 0 || y + alto > g.alto) continue;
		const enRiel = g.colocaciones
			.filter((c) => Math.abs(c.y + c.alto / 2 - (riel.y + SNAP_RIEL)) < UMBRAL_SNAP)
			.sort((a, b) => a.x - b.x);
		let x = Math.max(riel.x, 20);
		const limite = riel.x + riel.largo - ancho;
		for (const c of enRiel) {
			if (c.x - x >= ancho + MARGEN) break;
			x = Math.max(x, c.x + c.ancho + MARGEN);
		}
		if (x <= limite) return { x, y };
	}
	return { x: g.ancho / 2 - ancho / 2, y: g.alto / 2 - alto / 2 };
}

function anadirDesdeCatalogo(plantillaId: string): void {
	capturar();
	const plantilla = PLANTILLAS.find((p) => p.id === plantillaId)!;
	const d = crearDesdePlantilla(plantilla, proyecto);
	d.hojaId = proyecto.hojas[0]?.id;
	d.posicion = { x: proyecto.dispositivos.length % 10, y: Math.floor(proyecto.dispositivos.length / 10) };
	proyecto.dispositivos.push(d);
	const hueco = buscarHueco(plantilla.ancho, plantilla.alto);
	proyecto.gabinete!.colocaciones.push({
		dispositivoId: d.id, x: hueco.x, y: hueco.y, ancho: plantilla.ancho, alto: plantilla.alto,
	});
	actualizarTodo();
	seleccionar(d.id);
}

function eliminarDispositivo(id: string): void {
	if (!confirm(`¿Eliminar ${etiquetaDe(id)} y sus cables?`)) return;
	capturar();
	proyecto.dispositivos = proyecto.dispositivos.filter((d) => d.id !== id);
	proyecto.conductores = proyecto.conductores.filter(
		(c) => c.de.dispositivoId !== id && c.a.dispositivoId !== id,
	);
	const g = proyecto.gabinete!;
	g.colocaciones = g.colocaciones.filter((c) => c.dispositivoId !== id);
	seleccionar(undefined);
	actualizarTodo();
}

/* --------------------------- Paneles laterales --------------------------- */

function pintarPaneles(): void {
	($('nombre-proyecto') as HTMLInputElement).value = proyecto.nombre;

	const lista = $('lista-dispositivos');
	lista.innerHTML = '';
	const internos = proyecto.dispositivos.filter((x) => !x.campo);
	$('contador-dispositivos').textContent = `(${internos.length})`;
	for (const d of internos) {
		const li = document.createElement('li');
		li.className = d.id === seleccionadoId ? 'seleccionado' : '';
		li.innerHTML = `<span class="des">${d.designacion ?? d.id}</span><span class="desc">${d.descripcion ?? ''}</span>`;
		li.onclick = () => seleccionar(d.id);
		lista.appendChild(li);
	}

	const drc = $('lista-drc');
	drc.innerHTML = '';
	if (hallazgos.length === 0) drc.innerHTML = '<li class="hallazgo ok">Sin errores ni avisos</li>';
	for (const h of hallazgos) {
		const li = document.createElement('li');
		li.className = `hallazgo ${h.severidad}`;
		li.textContent = h.mensaje;
		if (h.dispositivoId) {
			li.style.cursor = 'pointer';
			li.onclick = () => seleccionar(h.dispositivoId);
		}
		drc.appendChild(li);
	}
	const errores = hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = hallazgos.length - errores;
	const chip = $('chip-drc');
	chip.className = errores ? 'con-errores' : avisos ? 'con-avisos' : '';
	chip.id = 'chip-drc';
	$('chip-drc-texto').textContent = errores || avisos
		? `${errores} errores · ${avisos} avisos`
		: 'DRC sin hallazgos';

	const ocup = $('ocupacion');
	ocup.innerHTML = '';
	for (const o of ruteo.ocupaciones) {
		const pct = Math.min(100, Math.round(o.ocupacion * 100));
		ocup.insertAdjacentHTML(
			'beforeend',
			`<div style="display:flex;justify-content:space-between"><span>${o.canaletaId}</span><span>${pct} %</span></div>
			 <div class="barra-ocupacion"><div class="${o.excedida ? 'excedida' : ''}" style="width:${pct}%"></div></div>`,
		);
	}
	const total = ruteo.rutas.reduce((s, r) => s + r.longitudMm, 0);
	$('resumen-cables').textContent =
		`${proyecto.conductores.length} conductores · ${ruteo.rutas.length} ruteados · ${(total / 1000).toFixed(1)} m de cable`;
}

const SECCIONES = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10];
const COLORES = ['negro', 'azul', 'rojo', 'blanco', 'gris', 'marrón', 'verde/amarillo'];

function pintarSeleccion(): void {
	const panel = $('panel-der');
	if (!seleccionadoId) {
		panel.style.display = 'none';
		return;
	}
	const d = proyecto.dispositivos.find((x) => x.id === seleccionadoId);
	if (!d) {
		panel.style.display = 'none';
		return;
	}
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === d.id);
	const cablesDelAparato = proyecto.conductores.filter(
		(c) => c.de.dispositivoId === d.id || c.a.dispositivoId === d.id,
	);
	const propios = hallazgos.filter((h) => h.dispositivoId === d.id);
	const metros = ruteo.rutas
		.filter((r) => cablesDelAparato.some((c) => c.id === r.conductorId))
		.reduce((s, r) => s + r.longitudMm, 0);

	const otrosAparatos = proyecto.dispositivos.filter((x) => x.id !== d.id);

	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>${d.designacion ?? d.id}</h1>
		<div class="sub">${d.descripcion ?? ''}</div>
		<dl>
			<dt>Referencia</dt><dd>${d.fabricante ?? '—'} ${d.referencia ?? ''}</dd>
			${col ? `<dt>Posición en placa</dt><dd>x ${Math.round(col.x)} mm · y ${Math.round(col.y)} mm · ${col.ancho}×${col.alto} mm</dd>` : ''}
			${d.tensionNominal ? `<dt>Tensión</dt><dd>${d.tensionNominal} V</dd>` : ''}
			<dt>Posición en esquema</dt><dd>${posicionTexto(proyecto, d)}</dd>
		</dl>
		${propios.length ? `<h2>Hallazgos DRC</h2><ul>${propios
			.map((h) => `<li class="hallazgo ${h.severidad}">${h.mensaje}</li>`).join('')}</ul>` : ''}
		<h2>Cables conectados ${metros ? `· ${(metros / 1000).toFixed(2)} m` : ''}</h2>
		<div id="cables-aparato">${cablesDelAparato.length === 0 ? '<div class="sub">Sin cables todavía</div>' : ''}</div>
		<h2>Conectar cable nuevo</h2>
		<div class="form-cable">
			<select id="cable-borne-origen" title="Borne de este aparato">
				${d.bornes.map((b) => `<option value="${b.id}">${d.designacion ?? d.id}:${b.id}${b.tipo && b.tipo !== 'otro' ? ` · ${b.tipo}` : ''}</option>`).join('')}
			</select>
			<select id="cable-destino" title="Aparato de destino">
				<option value="">— destino —</option>
				${otrosAparatos.map((o) => `<option value="${o.id}">${o.designacion ?? o.id} ${o.descripcion ? `· ${o.descripcion.slice(0, 22)}` : ''}</option>`).join('')}
			</select>
			<select id="cable-borne-destino" title="Borne del destino" disabled><option>borne…</option></select>
			<select id="cable-seccion" title="Sección">${SECCIONES.map((s) => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s} mm²</option>`).join('')}</select>
			<select id="cable-color" class="ancho-total" title="Color del conductor">${COLORES.map((c) => `<option ${c === 'negro' ? 'selected' : ''}>${c}</option>`).join('')}</select>
			<button class="boton primario ancho-total" id="btn-conectar" disabled>Conectar</button>
		</div>
		<h2>Acciones</h2>
		<div class="botonera">
			<button class="boton" id="btn-duplicar">Duplicar</button>
			<button class="boton peligro" id="btn-eliminar">Eliminar</button>
		</div>
	`;

	// Lista de cables existentes con botón de quitar.
	const contCables = panel.querySelector('#cables-aparato')!;
	for (const c of cablesDelAparato) {
		const otro = c.de.dispositivoId === d.id ? c.a : c.de;
		const propio = c.de.dispositivoId === d.id ? c.de : c.a;
		const fila = document.createElement('div');
		fila.className = 'fila-cable';
		fila.innerHTML = `<span class="num">${c.numero ?? '—'}</span>
			<span>${propio.borneId} → ${etiquetaDe(otro.dispositivoId)}:${otro.borneId}${c.seccion ? ` · ${c.seccion} mm²` : ''}</span>
			<button class="quitar" title="Quitar cable">✕</button>`;
		(fila.querySelector('.quitar') as HTMLButtonElement).onclick = () => {
			capturar();
			proyecto.conductores = proyecto.conductores.filter((x) => x.id !== c.id);
			recalcular();
			reconstruirCables();
			pintarPaneles();
			pintarSeleccion();
		};
		contCables.appendChild(fila);
	}

	// Formulario de conexión.
	const selDestino = panel.querySelector('#cable-destino') as HTMLSelectElement;
	const selBorneDestino = panel.querySelector('#cable-borne-destino') as HTMLSelectElement;
	const btnConectar = panel.querySelector('#btn-conectar') as HTMLButtonElement;
	selDestino.onchange = () => {
		const destino = proyecto.dispositivos.find((x) => x.id === selDestino.value);
		selBorneDestino.disabled = !destino;
		btnConectar.disabled = !destino;
		selBorneDestino.innerHTML = destino
			? destino.bornes.map((b) => `<option value="${b.id}">${b.id}${b.tipo && b.tipo !== 'otro' ? ` · ${b.tipo}` : ''}</option>`).join('')
			: '<option>borne…</option>';
	};
	btnConectar.onclick = () => {
		const destino = selDestino.value;
		if (!destino) return;
		capturar();
		proyecto.conductores.push({
			id: `c${Date.now().toString(36)}`,
			de: { dispositivoId: d.id, borneId: (panel.querySelector('#cable-borne-origen') as HTMLSelectElement).value },
			a: { dispositivoId: destino, borneId: selBorneDestino.value },
			seccion: Number((panel.querySelector('#cable-seccion') as HTMLSelectElement).value),
			color: (panel.querySelector('#cable-color') as HTMLSelectElement).value,
		});
		recalcular();
		reconstruirCables();
		pintarPaneles();
		pintarSeleccion();
	};

	(panel.querySelector('#btn-eliminar') as HTMLButtonElement).onclick = () => eliminarDispositivo(d.id);
	(panel.querySelector('#btn-duplicar') as HTMLButtonElement).onclick = () => {
		const plantilla = PLANTILLAS.find((p) => p.referencia === d.referencia);
		if (plantilla) anadirDesdeCatalogo(plantilla.id);
	};
}

/* ------------------------ Estructura del gabinete ------------------------ */

function pintarEstructura(): void {
	const g = proyecto.gabinete!;
	const caja = cajaDe(g);
	($('caja-ancho') as HTMLInputElement).value = String(Math.round(caja.ancho / 10));
	($('caja-alto') as HTMLInputElement).value = String(Math.round(caja.alto / 10));
	($('caja-prof') as HTMLInputElement).value = String(Math.round(caja.profundidad / 10));
	($('dim-ancho') as HTMLInputElement).value = String(Math.round(g.ancho / 10));
	($('dim-alto') as HTMLInputElement).value = String(Math.round(g.alto / 10));

	const filas = (
		items: { id: string; x: number; y: number; largo: number }[],
		tipo: 'riel' | 'canaleta',
	) => items.map((r) => `
		<div class="fila-estructura" data-tipo="${tipo}" data-id="${r.id}">
			<span class="id">${r.id}</span>
			<input type="number" data-campo="x" value="${Math.round(r.x)}">
			<input type="number" data-campo="y" value="${Math.round(r.y)}">
			<input type="number" data-campo="largo" value="${Math.round(r.largo)}">
			<button title="Quitar" data-quitar>✕</button>
		</div>`).join('');

	$('lista-rieles').innerHTML = filas(g.rieles, 'riel');
	$('lista-canaletas').innerHTML = filas(g.canaletas, 'canaleta');

	for (const btn of document.querySelectorAll('[data-quitar]')) {
		(btn as HTMLButtonElement).onclick = (ev) => {
			capturar();
			const fila = (ev.target as HTMLElement).closest('.fila-estructura') as HTMLElement;
			const id = fila.dataset.id!;
			if (fila.dataset.tipo === 'riel') g.rieles = g.rieles.filter((r) => r.id !== id);
			else g.canaletas = g.canaletas.filter((c) => c.id !== id);
			actualizarTodo();
			pintarEstructura();
		};
	}
}

function siguienteId(prefijo: string, existentes: { id: string }[]): string {
	let n = 1;
	while (existentes.some((e) => e.id === `${prefijo}${n}`)) n += 1;
	return `${prefijo}${n}`;
}

function aplicarEstructura(): void {
	capturar();
	const g = proyecto.gabinete!;
	// 0. Caja envolvente (dimensiones propias, independientes de la placa).
	g.caja = {
		ancho: Math.min(Math.max(Number(($('caja-ancho') as HTMLInputElement).value) || 66, 20), 200) * 10,
		alto: Math.min(Math.max(Number(($('caja-alto') as HTMLInputElement).value) || 86, 30), 240) * 10,
		profundidad: Math.min(Math.max(Number(($('caja-prof') as HTMLInputElement).value) || 16, 10), 60) * 10,
	};
	// 1. Leer las filas editadas.
	for (const fila of document.querySelectorAll('.fila-estructura')) {
		const el = fila as HTMLElement;
		const leer = (campo: string) =>
			Number((el.querySelector(`[data-campo="${campo}"]`) as HTMLInputElement).value) || 0;
		const destino = el.dataset.tipo === 'riel'
			? g.rieles.find((r) => r.id === el.dataset.id)
			: g.canaletas.find((c) => c.id === el.dataset.id);
		if (destino) {
			destino.x = leer('x');
			destino.y = leer('y');
			destino.largo = Math.max(60, leer('largo'));
		}
	}
	// 2. Dimensiones de placa (se estira la estructura con el cambio de tamaño).
	const anchoMm = Math.min(Math.max(Number(($('dim-ancho') as HTMLInputElement).value) || 38, 20), 150) * 10;
	const altoMm = Math.min(Math.max(Number(($('dim-alto') as HTMLInputElement).value) || 58, 30), 220) * 10;
	const dAncho = anchoMm - g.ancho;
	const dAlto = altoMm - g.alto;
	g.ancho = anchoMm;
	g.alto = altoMm;
	if (dAncho !== 0 || dAlto !== 0) {
		for (const riel of g.rieles) riel.largo = Math.max(120, riel.largo + dAncho);
		for (const can of g.canaletas) {
			can.largo = Math.max(120, can.largo + (can.orientacion === 'h' ? dAncho : dAlto));
		}
	}
	// 3. Perfil de canaleta.
	const anchoCanaleta = Number(($('dim-canaleta') as HTMLSelectElement).value);
	const altoCanaleta = anchoCanaleta >= 60 ? 80 : 60;
	for (const can of g.canaletas) {
		can.ancho = anchoCanaleta;
		can.alto = altoCanaleta;
	}
	// 4. Mantener los aparatos dentro de la placa.
	for (const col of g.colocaciones) {
		col.x = Math.min(Math.max(col.x, 0), Math.max(0, g.ancho - col.ancho));
		col.y = Math.min(Math.max(col.y, 0), Math.max(0, g.alto - col.alto));
	}
	actualizarTodo();
	pintarEstructura();
	encuadrar();
}

($('aplicar-dim') as HTMLButtonElement).onclick = aplicarEstructura;
($('btn-add-riel') as HTMLButtonElement).onclick = () => {
	capturar();
	const g = proyecto.gabinete!;
	g.rieles.push({ id: siguienteId('riel', g.rieles), x: 30, y: Math.round(g.alto / 2), largo: g.ancho - 60 });
	actualizarTodo();
	pintarEstructura();
};
($('btn-add-can-h') as HTMLButtonElement).onclick = () => {
	capturar();
	const g = proyecto.gabinete!;
	g.canaletas.push({
		id: siguienteId('ch', g.canaletas), x: 20, y: Math.round(g.alto / 2) + 80,
		largo: g.ancho - 40, orientacion: 'h', ancho: g.canaletas[0]?.ancho ?? 40, alto: g.canaletas[0]?.alto ?? 60,
	});
	actualizarTodo();
	pintarEstructura();
};
($('btn-add-can-v') as HTMLButtonElement).onclick = () => {
	capturar();
	const g = proyecto.gabinete!;
	g.canaletas.push({
		id: siguienteId('cv', g.canaletas), x: g.ancho - 60, y: 140,
		largo: g.alto - 260, orientacion: 'v', ancho: g.canaletas[0]?.ancho ?? 40, alto: g.canaletas[0]?.alto ?? 60,
	});
	actualizarTodo();
	pintarEstructura();
};

/* ----------------------- Selección y arrastre ----------------------- */

const raycaster = new THREE.Raycaster();
const puntero = new THREE.Vector2();
let seleccionadoId: string | undefined;
let materialesResaltados: THREE.MeshStandardMaterial[] = [];

function grupoDe(id: string): THREE.Group | undefined {
	return escenario.dispositivos.children.find((g) => g.userData.dispositivoId === id) as THREE.Group | undefined;
}

function seleccionar(id: string | undefined): void {
	for (const m of materialesResaltados) m.emissive.setHex(0x000000);
	materialesResaltados = [];
	seleccionadoId = id;
	if (id) {
		grupoDe(id)?.traverse((o) => {
			if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
				o.material = o.material.clone();
				o.material.emissive.setHex(0x1d4ed8);
				o.material.emissiveIntensity = 0.35;
				materialesResaltados.push(o.material);
			}
		});
	}
	pintarPaneles();
	pintarSeleccion();
}

function dispositivoBajoElPuntero(ev: PointerEvent): string | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.dispositivos.children, true);
	return impactos.find((i) => i.object.userData.dispositivoId)?.object.userData.dispositivoId;
}

let arrastrando = false;
let capturadoEsteArrastre = false;
const planoArrastre = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const desfase = new THREE.Vector2();

/** Cota bajo el puntero (etiqueta clicable), solo si "Ver tamaños" está activo. */
function cotaBajoElPuntero(ev: PointerEvent): DatosCota | undefined {
	if (!escenario.cotas.visible) return undefined;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.cotas.children, true);
	return impactos.find((i) => i.object.userData.cota)?.object.userData.cota as DatosCota | undefined;
}

/** Edita por teclado la dimensión que representa una cota (solo modo editor). */
function editarCota(datos: DatosCota): void {
	const g = proyecto.gabinete!;
	const actual = datos.valorMm / 10;
	const entrada = prompt(`Nuevo valor en cm (actual ${actual} cm):`, String(actual));
	if (entrada === null) return;
	const cm = Number(entrada.replace(',', '.'));
	if (!isFinite(cm) || cm <= 0) return;
	capturar();
	const mm = Math.round(cm * 10);
	const o = datos.objetivo;
	if (o.tipo === 'caja') {
		g.caja = g.caja ?? cajaDe(g);
		g.caja[o.dim] = mm;
	} else if (o.tipo === 'placa') {
		const anterior = g[o.dim];
		g[o.dim] = mm;
		// Estirar rieles/canaletas con el cambio de placa, como en aplicarEstructura.
		const delta = mm - anterior;
		if (o.dim === 'ancho') {
			for (const riel of g.rieles) riel.largo = Math.max(120, riel.largo + delta);
			for (const can of g.canaletas) if (can.orientacion === 'h') can.largo = Math.max(120, can.largo + delta);
		} else {
			for (const can of g.canaletas) if (can.orientacion === 'v') can.largo = Math.max(120, can.largo + delta);
		}
		for (const col of g.colocaciones) {
			col.x = Math.min(Math.max(col.x, 0), Math.max(0, g.ancho - col.ancho));
			col.y = Math.min(Math.max(col.y, 0), Math.max(0, g.alto - col.alto));
		}
	} else if (o.tipo === 'riel') {
		const riel = g.rieles.find((r) => r.id === o.id);
		if (riel) riel.largo = mm;
	} else {
		const can = g.canaletas.find((c) => c.id === o.id);
		if (can) can.largo = mm;
	}
	actualizarTodo();
	pintarEstructura();
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
	// En modo editor, un clic sobre una cota la edita (tiene prioridad sobre seleccionar).
	if (modo === 'editor') {
		const cota = cotaBajoElPuntero(ev);
		if (cota) {
			editarCota(cota);
			return;
		}
	}
	const id = dispositivoBajoElPuntero(ev);
	if (id !== seleccionadoId) seleccionar(id);
	if (!id) return;
	// Arrastrar aparatos solo en modo editor; en trabajo nada se mueve.
	if (modo !== 'editor') return;
	const grupo = grupoDe(id);
	if (!grupo || !proyecto.gabinete!.colocaciones.some((c) => c.dispositivoId === id)) return;
	arrastrando = true;
	capturadoEsteArrastre = false;
	controles.enabled = false;
	const impacto = new THREE.Vector3();
	raycaster.ray.intersectPlane(planoArrastre, impacto);
	desfase.set(impacto.x - grupo.position.x, impacto.y - grupo.position.y);
});

renderer.domElement.addEventListener('pointermove', (ev) => {
	if (!arrastrando || !seleccionadoId) return;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impacto = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planoArrastre, impacto)) return;

	// La primera vez que realmente se mueve, capturamos el estado para poder deshacer.
	if (!capturadoEsteArrastre) {
		capturar();
		capturadoEsteArrastre = true;
	}

	const g = proyecto.gabinete!;
	const col = g.colocaciones.find((c) => c.dispositivoId === seleccionadoId)!;
	// Centro deseado en coordenadas de modelo (mm, Y hacia abajo).
	const cx = impacto.x - desfase.x + g.ancho / 2;
	let cy = g.alto / 2 - (impacto.y - desfase.y);
	// Anclaje al riel más cercano.
	let mejor: { d: number; y: number } | undefined;
	for (const riel of g.rieles) {
		const centroRiel = riel.y + SNAP_RIEL;
		const dist = Math.abs(cy - centroRiel);
		if (dist < UMBRAL_SNAP && (!mejor || dist < mejor.d)) mejor = { d: dist, y: centroRiel };
	}
	if (mejor) cy = mejor.y;
	col.x = Math.min(Math.max(cx - col.ancho / 2, 0), g.ancho - col.ancho);
	col.y = Math.min(Math.max(cy - col.alto / 2, 0), g.alto - col.alto);
	const grupo = grupoDe(seleccionadoId)!;
	const c = escenario.aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
	grupo.position.set(c.x, c.y, 0);
});

renderer.domElement.addEventListener('pointerup', () => {
	if (!arrastrando) return;
	arrastrando = false;
	controles.enabled = true;
	if (!capturadoEsteArrastre) return; // fue un clic, no un arrastre real
	recalcular();
	reconstruirCables();
	reconstruirCotas();
	pintarPaneles();
	pintarSeleccion();
});

window.addEventListener('keydown', (ev) => {
	const activo = document.activeElement?.tagName;
	if (activo === 'INPUT' || activo === 'SELECT' || activo === 'TEXTAREA') return;
	const ctrl = ev.ctrlKey || ev.metaKey;
	if (ctrl && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); deshacer(); return; }
	if (ctrl && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) {
		ev.preventDefault();
		rehacer();
		return;
	}
	if ((ev.key === 'Delete' || ev.key === 'Backspace') && seleccionadoId && modo === 'editor') eliminarDispositivo(seleccionadoId);
	if (ev.key === 'Escape') seleccionar(undefined);
});

/* ------------------------------ Barra superior ------------------------------ */

($('nombre-proyecto') as HTMLInputElement).onchange = (e) => {
	proyecto.nombre = (e.target as HTMLInputElement).value || 'Tablero sin nombre';
	recalcular();
};

($('btn-nuevo') as HTMLButtonElement).onclick = () => {
	if (!confirm('¿Empezar un tablero nuevo? El actual queda en el último archivo guardado.')) return;
	capturar();
	proyecto = proyectoNuevo();
	seleccionar(undefined);
	actualizarTodo();
	pintarEstructura();
	encuadrar();
};

($('btn-guardar') as HTMLButtonElement).onclick = () => {
	descargar(
		`${proyecto.nombre.replaceAll(/[^\wáéíóúñ -]/gi, '')}.tablero.json`,
		JSON.stringify(proyecto, null, '\t'),
		'application/json',
	);
};

($('btn-abrir') as HTMLButtonElement).onclick = () => ($('archivo-abrir') as HTMLInputElement).click();
($('archivo-abrir') as HTMLInputElement).onchange = async (e) => {
	const archivo = (e.target as HTMLInputElement).files?.[0];
	if (!archivo) return;
	try {
		const p = JSON.parse(await archivo.text());
		if (!p || p.formato !== 'tablero-studio' || !p.gabinete) throw new Error('formato');
		capturar();
		proyecto = p as Proyecto;
		seleccionar(undefined);
		actualizarTodo();
		pintarEstructura();
		encuadrar();
	} catch {
		alert('El archivo no es un proyecto de TableroStudio válido.');
	}
	(e.target as HTMLInputElement).value = '';
};

($('btn-dossier') as HTMLButtonElement).onclick = () => {
	const potenciales = calcularPotenciales(proyecto);
	const dossier = generarInformeHTML({
		proyecto,
		potenciales,
		hallazgos,
		referencias: generarReferencias(proyecto),
		planesBorneros: generarPlanBorneros(proyecto, potenciales),
		ruteo,
		sincronizacion: sincronizarEsquemaGabinete(proyecto),
	});
	descargar(`${proyecto.nombre.replaceAll(/[^\wáéíóúñ -]/gi, '')} - dossier.html`, dossier, 'text/html');
};

/* ------------------------------- Modos ------------------------------- */

const AYUDA: Record<Modo, string> = {
	editor: '🔧 EDITOR — Añade aparatos del catálogo · arrástralos (se anclan al riel) · edita la caja, placa, rieles y canaletas · «Ver tamaños» para acotar y editar medidas · Supr elimina · Ctrl+Z deshace',
	trabajo: '🔌 TRABAJO — Cablea desde la ficha de cada aparato y observa la verificación en vivo. La estructura está bloqueada: nada se mueve por accidente.',
};

function aplicarModo(nuevo: Modo): void {
	modo = nuevo;
	document.body.classList.toggle('modo-trabajo', modo === 'trabajo');
	$('modo-editor').classList.toggle('activo', modo === 'editor');
	$('modo-trabajo').classList.toggle('activo', modo === 'trabajo');
	$('ayuda').textContent = AYUDA[modo];
	// Al pasar a trabajo se cancela cualquier arrastre en curso.
	if (modo === 'trabajo') {
		arrastrando = false;
		controles.enabled = true;
	}
}

$('modo-editor').onclick = () => aplicarModo('editor');
$('modo-trabajo').onclick = () => aplicarModo('trabajo');

($('btn-deshacer') as HTMLButtonElement).onclick = deshacer;
($('btn-rehacer') as HTMLButtonElement).onclick = rehacer;

/* ------------------------------- Vista ------------------------------- */

($('ver-cotas') as HTMLInputElement).onchange = (e) => {
	escenario.cotas.visible = (e.target as HTMLInputElement).checked;
};
($('ver-cables') as HTMLInputElement).onchange = (e) => {
	escenario.cables.visible = (e.target as HTMLInputElement).checked;
};
($('ver-tapas') as HTMLInputElement).onchange = (e) => {
	const v = (e.target as HTMLInputElement).checked;
	for (const t of escenario.tapas) t.visible = v;
};
($('ver-etiquetas') as HTMLInputElement).onchange = (e) => {
	const v = (e.target as HTMLInputElement).checked;
	for (const t of escenario.etiquetas) t.visible = v;
};

function ajustarTamano(): void {
	const r = contenedor.getBoundingClientRect();
	camara.aspect = r.width / r.height;
	camara.updateProjectionMatrix();
	renderer.setSize(r.width, r.height);
}
window.addEventListener('resize', ajustarTamano);
ajustarTamano();

/* ------------------------------- Arranque ------------------------------- */

pintarCatalogo();
pintarPaneles();
pintarEstructura();
reconstruirCables();
reconstruirCotas();
aplicarModo('editor');
actualizarBotonesHistorial();

renderer.setAnimationLoop(() => {
	controles.update();
	renderer.render(escena, camara);
});
