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
import {
	cajaDe, construirCables, construirCanaleta, construirCotas, construirDispositivo,
	construirEscenario, construirRiel, DatosCota, Escenario,
} from './escena3d.js';
import { PLANTILLAS, crearDesdePlantilla } from './catalogo.js';

type Modo = 'editor' | 'trabajo';
let modo: Modo = 'editor';

type Seleccion =
	| { tipo: 'dispositivo'; id: string }
	| { tipo: 'canaleta'; id: string }
	| { tipo: 'riel'; id: string };

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
	const existe = sel && (sel.tipo === 'dispositivo'
		? proyecto.dispositivos.some((d) => d.id === sel!.id)
		: sel.tipo === 'canaleta'
			? proyecto.gabinete!.canaletas.some((c) => c.id === sel!.id)
			: proyecto.gabinete!.rieles.some((r) => r.id === sel!.id));
	if (!existe) { sel = undefined; resaltados = []; }
	recalcular();
	montarEscenario();
	construirHandles();
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
		li.className = d.id === idDispositivoSel() ? 'seleccionado' : '';
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
	const nc = proyecto.conductores.length;
	$('resumen-cables').textContent = nc === 0
		? 'Todavía no hay cables.'
		: `${nc} ${nc === 1 ? 'conductor' : 'conductores'} · ${ruteo.rutas.length} ruteados · ${(total / 1000).toFixed(1)} m de cable`;

	// Estado vacío de bienvenida (solo cuando la placa no tiene aparatos reales).
	const aparatos = proyecto.dispositivos.filter((d) => !d.campo && !d.imagen).length;
	($('bienvenida') as HTMLElement).hidden = aparatos > 0;
}

const SECCIONES = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10];
const COLORES = ['negro', 'azul', 'rojo', 'blanco', 'gris', 'marrón', 'verde/amarillo'];

function pintarSeleccion(): void {
	const panel = $('panel-der');
	if (!sel) {
		panel.style.display = 'none';
		return;
	}
	if (sel.tipo === 'canaleta' || sel.tipo === 'riel') {
		pintarPanelEstructura(sel);
		return;
	}
	const d = proyecto.dispositivos.find((x) => x.id === sel!.id);
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

	const esImagen = !!d.imagen;
	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>${d.designacion ?? d.id}</h1>
		<div class="sub">${esImagen ? '🖼️ Imagen de referencia' : (d.descripcion ?? '')}</div>
		<dl>
			${esImagen ? '' : `<dt>Referencia</dt><dd>${d.fabricante ?? '—'} ${d.referencia ?? ''}</dd>`}
			${col ? `<dt>Posición en placa</dt><dd>x ${Math.round(col.x)} mm · y ${Math.round(col.y)} mm · ${col.ancho}×${col.alto} mm</dd>` : ''}
			${d.tensionNominal ? `<dt>Tensión</dt><dd>${d.tensionNominal} V</dd>` : ''}
			${esImagen ? '' : `<dt>Posición en esquema</dt><dd>${posicionTexto(proyecto, d)}</dd>`}
		</dl>
		${esImagen ? `<h2>Puntos de conexión (${d.bornes.length})</h2>
			<button class="boton ${modoPin ? 'primario' : ''} ancho-total" id="btn-pin" style="width:100%">${modoPin ? '✓ Haz clic en la imagen…' : '➕ Añadir punto de conexión'}</button>
			<div id="lista-pines" style="margin-top:6px"></div>` : ''}
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
			<button class="boton ${eligiendoDestino ? 'primario' : ''} ancho-total" id="btn-elegir-destino" title="Elige el aparato de destino haciendo clic sobre él en el tablero 3D">${eligiendoDestino ? '👆 Haz clic en el aparato de destino…' : '🎯 Elegir destino en el tablero'}</button>
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

	// Elegir el destino haciendo clic en el aparato dentro del tablero 3D.
	(panel.querySelector('#btn-elegir-destino') as HTMLButtonElement).onclick = () => {
		eligiendoDestino = !eligiendoDestino;
		$('ayuda').textContent = eligiendoDestino
			? '🎯 Haz clic sobre el aparato de destino en el tablero…'
			: AYUDA[modo];
		pintarSeleccion();
	};

	(panel.querySelector('#btn-eliminar') as HTMLButtonElement).onclick = () => eliminarDispositivo(d.id);
	(panel.querySelector('#btn-duplicar') as HTMLButtonElement).onclick = () => {
		const plantilla = PLANTILLAS.find((p) => p.referencia === d.referencia);
		if (plantilla) anadirDesdeCatalogo(plantilla.id);
	};

	// Imagen de referencia: botón de modo pin y lista de puntos con opción de borrar.
	if (esImagen) {
		(panel.querySelector('#btn-pin') as HTMLButtonElement).onclick = () => {
			modoPin = !modoPin;
			pintarSeleccion();
		};
		const lista = panel.querySelector('#lista-pines')!;
		for (const b of d.bornes) {
			const fila = document.createElement('div');
			fila.className = 'fila-cable';
			fila.innerHTML = `<span class="num">◉</span><span>${b.id}</span>
				<button class="quitar" title="Quitar punto">✕</button>`;
			(fila.querySelector('.quitar') as HTMLButtonElement).onclick = () => {
				capturar();
				d.bornes = d.bornes.filter((x) => x.id !== b.id);
				proyecto.conductores = proyecto.conductores.filter(
					(c) => !(c.de.dispositivoId === d.id && c.de.borneId === b.id) &&
						!(c.a.dispositivoId === d.id && c.a.borneId === b.id),
				);
				actualizarTodo();
			};
			lista.appendChild(fila);
		}
	}
}

/** Panel de propiedades de una canaleta o un riel seleccionado. */
function pintarPanelEstructura(s: Seleccion): void {
	const panel = $('panel-der');
	const g = proyecto.gabinete!;
	const esCanaleta = s.tipo === 'canaleta';
	const obj = esCanaleta ? g.canaletas.find((c) => c.id === s.id) : g.rieles.find((r) => r.id === s.id);
	if (!obj) { panel.style.display = 'none'; return; }
	const can = esCanaleta ? (obj as typeof g.canaletas[number]) : undefined;

	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>${esCanaleta ? '📦 Canaleta' : '➖ Riel DIN'} ${obj.id}</h1>
		<div class="sub">${esCanaleta ? `Ranurada ${can!.orientacion === 'h' ? 'horizontal' : 'vertical'} · ${can!.ancho}×${can!.alto} mm` : 'Perfil sombrero 35 mm'}</div>
		<div class="sub" style="margin-top:8px">Arrástrala para moverla, o tira de las esferas de los extremos para alargarla. También puedes ajustar los cm aquí:</div>
		<dl>
			<dt>Posición X</dt><dd><input type="number" id="e-x" value="${(obj.x / 10).toFixed(1)}" step="0.5"> cm</dd>
			<dt>Posición Y</dt><dd><input type="number" id="e-y" value="${(obj.y / 10).toFixed(1)}" step="0.5"> cm</dd>
			<dt>Largo</dt><dd><input type="number" id="e-largo" value="${(obj.largo / 10).toFixed(1)}" step="0.5"> cm</dd>
			${esCanaleta ? `<dt>Ancho del canal</dt><dd><input type="number" id="e-ancho" value="${can!.ancho}" step="5"> mm</dd>` : ''}
			${esCanaleta ? `<dt>Orientación</dt><dd><select id="e-orient"><option value="h" ${can!.orientacion === 'h' ? 'selected' : ''}>Horizontal</option><option value="v" ${can!.orientacion === 'v' ? 'selected' : ''}>Vertical</option></select></dd>` : ''}
		</dl>
		<div class="botonera">
			<button class="boton primario" id="e-aplicar">Aplicar cm</button>
			<button class="boton peligro" id="e-eliminar">Eliminar</button>
		</div>
	`;
	(panel.querySelector('#e-aplicar') as HTMLButtonElement).onclick = () => {
		capturar();
		obj.x = Math.round(Number((panel.querySelector('#e-x') as HTMLInputElement).value) * 10);
		obj.y = Math.round(Number((panel.querySelector('#e-y') as HTMLInputElement).value) * 10);
		obj.largo = Math.max(60, Math.round(Number((panel.querySelector('#e-largo') as HTMLInputElement).value) * 10));
		if (can) {
			can.ancho = Math.max(15, Number((panel.querySelector('#e-ancho') as HTMLInputElement).value));
			can.alto = can.ancho >= 60 ? 80 : 60;
			can.orientacion = (panel.querySelector('#e-orient') as HTMLSelectElement).value as 'h' | 'v';
		}
		actualizarTodo();
		pintarEstructura();
	};
	(panel.querySelector('#e-eliminar') as HTMLButtonElement).onclick = () => eliminarEstructura(s);
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
let sel: Seleccion | undefined;
let resaltados: THREE.MeshStandardMaterial[] = [];
let modoPin = false; // añadiendo un punto de conexión sobre una imagen de referencia
let eligiendoDestino = false; // esperando un clic en 3D para elegir el aparato de destino del cable

function idDispositivoSel(): string | undefined {
	return sel?.tipo === 'dispositivo' ? sel.id : undefined;
}

function grupoDe(id: string): THREE.Group | undefined {
	return escenario.dispositivos.children.find((g) => g.userData.dispositivoId === id) as THREE.Group | undefined;
}

function limpiarResaltado(): void {
	for (const m of resaltados) m.emissive.setHex(0x000000);
	resaltados = [];
}

function resaltarObjeto(raiz: THREE.Object3D | undefined, color = 0x1d4ed8, intensidad = 0.4): void {
	raiz?.traverse((o) => {
		if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(color);
			o.material.emissiveIntensity = intensidad;
			resaltados.push(o.material);
		}
	});
}

function resaltarPorUserData(clave: 'canaletaId' | 'rielId', id: string): void {
	escenario.raiz.traverse((o) => {
		if (o.userData[clave] === id && o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(0x1d4ed8);
			o.material.emissiveIntensity = 0.55;
			resaltados.push(o.material);
		}
	});
}

/** Aplica una selección de cualquier tipo (o la limpia) y refresca resaltado, handles y paneles. */
function aplicarSeleccion(nueva: Seleccion | undefined): void {
	limpiarResaltado();
	modoPin = false;
	sel = nueva;
	if (sel?.tipo === 'dispositivo') resaltarObjeto(grupoDe(sel.id));
	else if (sel?.tipo === 'canaleta') resaltarPorUserData('canaletaId', sel.id);
	else if (sel?.tipo === 'riel') resaltarPorUserData('rielId', sel.id);
	construirHandles();
	pintarPaneles();
	pintarSeleccion();
}

/** Selección por id de dispositivo (compatibilidad con el resto del código). */
function seleccionar(id: string | undefined): void {
	aplicarSeleccion(id ? { tipo: 'dispositivo', id } : undefined);
}

/** Primer elemento (aparato, canaleta o riel) bajo el puntero. */
function elementoBajoElPuntero(ev: PointerEvent): Seleccion | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.raiz.children, true);
	for (const i of impactos) {
		const u = i.object.userData;
		if (u.dispositivoId) return { tipo: 'dispositivo', id: u.dispositivoId };
		if (u.canaletaId) return { tipo: 'canaleta', id: u.canaletaId };
		if (u.rielId) return { tipo: 'riel', id: u.rielId };
	}
	return undefined;
}

/* ------------------------ Tiradores (handles) ------------------------ */

interface DatosHandle {
	rol: 'inicio' | 'fin' | 'esquina';
	sel: Seleccion;
}

/** Construye los tiradores de redimensionado del elemento seleccionado (solo modo editor). */
function construirHandles(): void {
	escenario.handles.clear();
	if (modo !== 'editor' || !sel) return;
	const g = proyecto.gabinete!;
	const esfera = (p: THREE.Vector3, datos: DatosHandle, color = 0x4da3ff): void => {
		const m = new THREE.Mesh(
			new THREE.SphereGeometry(9, 16, 16),
			new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false }),
		);
		m.position.copy(p);
		m.renderOrder = 999;
		m.userData.handle = datos;
		escenario.handles.add(m);
	};

	if (sel.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === sel!.id);
		if (!can) return;
		const esH = can.orientacion === 'h';
		const ini = escenario.aEscena(can.x, can.y, can.alto + 12);
		const fin = esH
			? escenario.aEscena(can.x + can.largo, can.y, can.alto + 12)
			: escenario.aEscena(can.x, can.y + can.largo, can.alto + 12);
		esfera(ini, { rol: 'inicio', sel }, 0x35c46a);
		esfera(fin, { rol: 'fin', sel }, 0x35c46a);
	} else if (sel.tipo === 'riel') {
		const riel = g.rieles.find((r) => r.id === sel!.id);
		if (!riel) return;
		esfera(escenario.aEscena(riel.x, riel.y, 22), { rol: 'inicio', sel }, 0xffcf40);
		esfera(escenario.aEscena(riel.x + riel.largo, riel.y, 22), { rol: 'fin', sel }, 0xffcf40);
	} else {
		const d = proyecto.dispositivos.find((x) => x.id === sel!.id);
		const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id);
		if (d?.imagen && col) {
			esfera(escenario.aEscena(col.x + col.ancho, col.y + col.alto, 12), { rol: 'esquina', sel }, 0xff8c1a);
		}
	}
}

let arrastrando = false;
let capturadoEsteArrastre = false;
let handleArrastrado: DatosHandle | undefined;
const planoArrastre = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const desfase = new THREE.Vector2();

/** Punto del ratón proyectado sobre el plano de la placa, en coordenadas de modelo (mm). */
function puntoModelo(ev: PointerEvent): { x: number; y: number } | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impacto = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planoArrastre, impacto)) return undefined;
	const g = proyecto.gabinete!;
	return { x: impacto.x + g.ancho / 2, y: g.alto / 2 - impacto.y };
}

/** Handle bajo el puntero (tiene prioridad sobre cualquier otra cosa). */
function handleBajoElPuntero(ev: PointerEvent): DatosHandle | undefined {
	if (escenario.handles.children.length === 0) return undefined;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.handles.children, false);
	return impactos[0]?.object.userData.handle as DatosHandle | undefined;
}

/** Reconstruye en la escena solo el riel o canaleta indicado (para arrastre fluido). */
function reconstruirEstructuraUno(s: Seleccion): void {
	const g = proyecto.gabinete!;
	const clave = s.tipo === 'canaleta' ? 'canaletaId' : 'rielId';
	for (const hijo of [...escenario.raiz.children]) {
		if (hijo.userData[clave] === s.id) escenario.raiz.remove(hijo);
	}
	if (s.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === s.id);
		if (can) escenario.raiz.add(construirCanaleta(can, escenario.aEscena, escenario.tapas));
	} else {
		const riel = g.rieles.find((r) => r.id === s.id);
		if (riel) escenario.raiz.add(construirRiel(riel, escenario.aEscena));
	}
}

/** Cota bajo el puntero (etiqueta clicable), solo si "Ver tamaños" está activo. */
function cotaBajoElPuntero(ev: PointerEvent): DatosCota | undefined {
	if (!escenario.cotas.visible) return undefined;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.cotas.children, true);
	return impactos.find((i) => i.object.userData.cota)?.object.userData.cota as DatosCota | undefined;
}

/** En modo pin, añade un punto de conexión a la imagen seleccionada donde se hizo clic. */
function anadirPin(ev: PointerEvent): boolean {
	const id = idDispositivoSel();
	if (!id) return false;
	const d = proyecto.dispositivos.find((x) => x.id === id);
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === id);
	if (!d?.imagen || !col) return false;
	const p = puntoModelo(ev);
	if (!p) return false;
	const u = (p.x - col.x) / col.ancho;
	const v = (p.y - col.y) / col.alto;
	if (u < 0 || u > 1 || v < 0 || v > 1) return false; // clic fuera de la imagen
	const etiqueta = prompt('Nombre del punto de conexión (p. ej. L1, GND, +24):', `P${d.bornes.length + 1}`);
	if (etiqueta === null) return false;
	capturar();
	d.bornes.push({ id: etiqueta.trim() || `P${d.bornes.length + 1}`, u, v });
	actualizarTodo();
	return true;
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
	// Cablear por clic: si estamos eligiendo destino, el próximo clic sobre otro aparato
	// lo fija como destino en el formulario (funciona en cualquier modo). Se actualiza el
	// DOM en el sitio para no perder la selección de destino al re-renderizar.
	if (eligiendoDestino) {
		eligiendoDestino = false;
		$('ayuda').textContent = AYUDA[modo];
		const origenId = idDispositivoSel();
		const clic = elementoBajoElPuntero(ev);
		const selDestino = document.getElementById('cable-destino') as HTMLSelectElement | null;
		if (selDestino && clic && clic.tipo === 'dispositivo' && clic.id !== origenId) {
			selDestino.value = clic.id;
			selDestino.dispatchEvent(new Event('change'));
		}
		const btn = document.getElementById('btn-elegir-destino') as HTMLButtonElement | null;
		if (btn) { btn.classList.remove('primario'); btn.textContent = '🎯 Elegir destino en el tablero'; }
		return;
	}

	if (modo === 'editor') {
		// 1. Tiradores de redimensionado (máxima prioridad).
		const handle = handleBajoElPuntero(ev);
		if (handle) {
			handleArrastrado = handle;
			arrastrando = true;
			capturadoEsteArrastre = false;
			controles.enabled = false;
			return;
		}
		// 2. Modo pin: clic sobre la imagen añade un punto de conexión.
		if (modoPin && anadirPin(ev)) return;
		// 3. Cota clicable → editar medida.
		const cota = cotaBajoElPuntero(ev);
		if (cota) { editarCota(cota); return; }
	}

	const elem = elementoBajoElPuntero(ev);
	const mismo = elem && sel && elem.tipo === sel.tipo && elem.id === sel.id;
	if (!mismo) aplicarSeleccion(elem);
	if (!elem || modo !== 'editor') return;

	// Preparar arrastre (mover). Los aparatos normales y las imágenes/canaletas/rieles
	// se pueden mover; los aparatos sin colocación no.
	const g = proyecto.gabinete!;
	if (elem.tipo === 'dispositivo' && !g.colocaciones.some((c) => c.dispositivoId === elem.id)) return;
	arrastrando = true;
	handleArrastrado = undefined;
	capturadoEsteArrastre = false;
	controles.enabled = false;
	const p = puntoModelo(ev);
	if (!p) return;
	if (elem.tipo === 'dispositivo') {
		const col = g.colocaciones.find((c) => c.dispositivoId === elem.id)!;
		desfase.set(p.x - (col.x + col.ancho / 2), p.y - (col.y + col.alto / 2));
	} else if (elem.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === elem.id)!;
		desfase.set(p.x - can.x, p.y - can.y);
	} else {
		const riel = g.rieles.find((r) => r.id === elem.id)!;
		desfase.set(p.x - riel.x, p.y - riel.y);
	}
});

renderer.domElement.addEventListener('pointermove', (ev) => {
	if (!arrastrando || !sel) return;
	const p = puntoModelo(ev);
	if (!p) return;
	if (!capturadoEsteArrastre) { capturar(); capturadoEsteArrastre = true; }
	const g = proyecto.gabinete!;

	// --- Redimensionar con un tirador ---
	if (handleArrastrado) {
		if (sel.tipo === 'canaleta') {
			const can = g.canaletas.find((c) => c.id === sel!.id)!;
			const esH = can.orientacion === 'h';
			if (handleArrastrado.rol === 'fin') {
				can.largo = Math.max(60, Math.round((esH ? p.x - can.x : p.y - can.y) / 5) * 5);
			} else {
				const fin = esH ? can.x + can.largo : can.y + can.largo;
				const nuevoIni = Math.min(esH ? p.x : p.y, fin - 60);
				if (esH) { can.x = Math.round(nuevoIni / 5) * 5; can.largo = fin - can.x; }
				else { can.y = Math.round(nuevoIni / 5) * 5; can.largo = fin - can.y; }
			}
			reconstruirEstructuraUno(sel);
		} else if (sel.tipo === 'riel') {
			const riel = g.rieles.find((r) => r.id === sel!.id)!;
			if (handleArrastrado.rol === 'fin') {
				riel.largo = Math.max(60, Math.round((p.x - riel.x) / 5) * 5);
			} else {
				const fin = riel.x + riel.largo;
				riel.x = Math.round(Math.min(p.x, fin - 60) / 5) * 5;
				riel.largo = fin - riel.x;
			}
			reconstruirEstructuraUno(sel);
		} else {
			const d = proyecto.dispositivos.find((x) => x.id === sel!.id)!;
			const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id)!;
			if (d.imagen) {
				col.ancho = Math.max(40, Math.round((p.x - col.x) / 5) * 5);
				col.alto = Math.max(40, Math.round((p.y - col.y) / 5) * 5);
				reconstruirDispositivoUno(sel.id);
			}
		}
		construirHandles();
		return;
	}

	// --- Mover ---
	if (sel.tipo === 'dispositivo') {
		const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id)!;
		const cx = p.x - desfase.x;
		let cy = p.y - desfase.y;
		let mejor: { d: number; y: number } | undefined;
		for (const riel of g.rieles) {
			const centroRiel = riel.y + SNAP_RIEL;
			const dist = Math.abs(cy - centroRiel);
			if (dist < UMBRAL_SNAP && (!mejor || dist < mejor.d)) mejor = { d: dist, y: centroRiel };
		}
		if (mejor) cy = mejor.y;
		col.x = Math.min(Math.max(cx - col.ancho / 2, 0), g.ancho - col.ancho);
		col.y = Math.min(Math.max(cy - col.alto / 2, 0), g.alto - col.alto);
		const c = escenario.aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
		grupoDe(sel.id)!.position.set(c.x, c.y, 0);
	} else if (sel.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === sel!.id)!;
		can.x = Math.round((p.x - desfase.x) / 5) * 5;
		can.y = Math.round((p.y - desfase.y) / 5) * 5;
		reconstruirEstructuraUno(sel);
	} else {
		const riel = g.rieles.find((r) => r.id === sel!.id)!;
		riel.x = Math.round((p.x - desfase.x) / 5) * 5;
		riel.y = Math.round((p.y - desfase.y) / 5) * 5;
		reconstruirEstructuraUno(sel);
	}
	construirHandles();
});

renderer.domElement.addEventListener('pointerup', () => {
	if (!arrastrando) return;
	arrastrando = false;
	handleArrastrado = undefined;
	controles.enabled = true;
	if (!capturadoEsteArrastre) return; // fue un clic, no un arrastre real
	recalcular();
	reconstruirCables();
	reconstruirCotas();
	construirHandles();
	pintarPaneles();
	pintarSeleccion();
	pintarEstructura();
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
	if ((ev.key === 'Delete' || ev.key === 'Backspace') && modo === 'editor' && sel) {
		if (sel.tipo === 'dispositivo') eliminarDispositivo(sel.id);
		else eliminarEstructura(sel);
	}
	if (ev.key === 'Escape') aplicarSeleccion(undefined);
});

/** Reconstruye en la escena solo el aparato indicado (para arrastre/resize fluido). */
function reconstruirDispositivoUno(id: string): void {
	const viejo = grupoDe(id);
	if (viejo) escenario.dispositivos.remove(viejo);
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === id);
	const d = proyecto.dispositivos.find((x) => x.id === id);
	if (col && d) {
		const etq: THREE.Object3D[] = [];
		escenario.dispositivos.add(construirDispositivo(d, col, escenario.aEscena, etq));
	}
}

function eliminarEstructura(s: Seleccion): void {
	const g = proyecto.gabinete!;
	const nombre = s.tipo === 'canaleta' ? 'la canaleta' : 'el riel';
	if (!confirm(`¿Eliminar ${nombre} «${s.id}»?`)) return;
	capturar();
	if (s.tipo === 'canaleta') g.canaletas = g.canaletas.filter((c) => c.id !== s.id);
	else g.rieles = g.rieles.filter((r) => r.id !== s.id);
	aplicarSeleccion(undefined);
	actualizarTodo();
	pintarEstructura();
}

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

// Imagen de referencia: se importa como dispositivo con imagen (data URL) y colocación.
($('btn-imagen') as HTMLButtonElement).onclick = () => ($('archivo-imagen') as HTMLInputElement).click();
($('archivo-imagen') as HTMLInputElement).onchange = (e) => {
	const archivo = (e.target as HTMLInputElement).files?.[0];
	if (!archivo) return;
	const lector = new FileReader();
	lector.onload = () => {
		const url = lector.result as string;
		const img = new Image();
		img.onload = () => {
			if (modo !== 'editor') aplicarModo('editor');
			capturar();
			const g = proyecto.gabinete!;
			// Tamaño inicial ~1/3 del ancho de placa, conservando proporción de la imagen.
			const ancho = Math.round(g.ancho * 0.35);
			const alto = Math.round(ancho * (img.height / img.width));
			const id = `img${Date.now().toString(36)}`;
			proyecto.dispositivos.push({
				id, tipo: 'otro', imagen: url, campo: true,
				descripcion: archivo.name, bornes: [],
			});
			g.colocaciones.push({
				dispositivoId: id,
				x: Math.max(0, Math.round((g.ancho - ancho) / 2)),
				y: Math.max(0, Math.round((g.alto - alto) / 2)),
				ancho, alto,
			});
			actualizarTodo();
			seleccionar(id);
			$('ayuda').textContent = '🖼️ Imagen añadida — con ella seleccionada, pulsa «➕ Añadir punto de conexión» y haz clic sobre la imagen para marcar cada punto; luego cámbiate a modo Trabajo para cablearlos.';
		};
		img.src = url;
	};
	lector.readAsDataURL(archivo);
	(e.target as HTMLInputElement).value = '';
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
	// Al pasar a trabajo se cancela cualquier arrastre en curso y se quitan los tiradores.
	if (modo === 'trabajo') {
		arrastrando = false;
		modoPin = false;
		controles.enabled = true;
	}
	construirHandles();
	pintarSeleccion();
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

/* --------------------- Ayuda, centrar vista y ejemplo --------------------- */

($('btn-centrar') as HTMLButtonElement).onclick = () => encuadrar();

($('btn-ayuda') as HTMLButtonElement).onclick = () => { ($('modal-ayuda') as HTMLElement).hidden = false; };
($('btn-cerrar-ayuda') as HTMLButtonElement).onclick = () => { ($('modal-ayuda') as HTMLElement).hidden = true; };
$('modal-ayuda').addEventListener('click', (e) => {
	if (e.target === $('modal-ayuda')) ($('modal-ayuda') as HTMLElement).hidden = true;
});

($('btn-empezar-ejemplo') as HTMLButtonElement).onclick = () => {
	capturar();
	proyecto = tableroEjemplo();
	numerarDispositivos(proyecto);
	aplicarSeleccion(undefined);
	trasCambiarProyecto();
	encuadrar();
};

// Primera visita: abrir la guía automáticamente una sola vez.
try {
	if (!localStorage.getItem('tablerostudio-visto')) {
		($('modal-ayuda') as HTMLElement).hidden = false;
		localStorage.setItem('tablerostudio-visto', '1');
	}
} catch { /* sin localStorage */ }

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
