/**
 * TableroStudio — Editor 3D del gabinete.
 *
 * Carga el proyecto de ejemplo, corre los motores del núcleo y presenta el gabinete en 3D:
 * selección de aparatos, arrastre sobre el riel con re-ruteo de cables en vivo, panel DRC
 * y ocupación de canaletas.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';
import { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { conductoresEn, posicionTexto } from '../src/modelo/proyecto.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto, Hallazgo } from '../src/motores/drc.js';
import { rutearConductores, ResultadoRuteo } from '../src/motores/ruteo.js';
import { sincronizarEsquemaGabinete } from '../src/motores/sincronizacion.js';
import { construirCables, construirEscenario, Escenario } from './escena3d.js';

/* ------------------------------ Estado ------------------------------ */

const proyecto: Proyecto = tableroEjemplo();
numerarDispositivos(proyecto);

let hallazgos: Hallazgo[] = [];
let ruteo: ResultadoRuteo;

function recalcular(): void {
	const potenciales = calcularPotenciales(proyecto);
	numerarConductores(proyecto, potenciales);
	ruteo = rutearConductores(proyecto);
	hallazgos = verificarProyecto(proyecto, potenciales);
	const sync = sincronizarEsquemaGabinete(proyecto);
	if (!sync.sincronizado) {
		for (const [a, b] of sync.solapes) {
			hallazgos.push({ regla: 'S1-solape', severidad: 'error', mensaje: `${a} y ${b} se solapan en la placa` });
		}
		for (const id of sync.faltanEnGabinete) {
			hallazgos.push({ regla: 'S2-falta-colocar', severidad: 'aviso', mensaje: `${id} no está colocado en el gabinete` });
		}
	}
}
recalcular();

/* ------------------------------ Escena ------------------------------ */

const contenedor = document.getElementById('escena')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
contenedor.appendChild(renderer.domElement);

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x171a1d);
escena.fog = new THREE.Fog(0x171a1d, 1600, 3200);

const camara = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 6000);
camara.position.set(420, 160, 820);

const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.maxPolarAngle = Math.PI * 0.55;

escena.add(new THREE.HemisphereLight(0xf4f6f8, 0x3a3f45, 1.05));
const sol = new THREE.DirectionalLight(0xffffff, 1.6);
sol.position.set(500, 700, 900);
escena.add(sol);
const contraluz = new THREE.DirectionalLight(0x88aaff, 0.35);
contraluz.position.set(-600, 200, -400);
escena.add(contraluz);

const suelo = new THREE.GridHelper(3000, 60, 0x2c3238, 0x22272c);
suelo.position.y = -(proyecto.gabinete!.alto / 2 + 40);
escena.add(suelo);

let escenario: Escenario = construirEscenario(proyecto);
escena.add(escenario.raiz);

function reconstruirCables(): void {
	escenario.cables.clear();
	escenario.cables.add(construirCables(proyecto, ruteo.rutas, escenario.aEscena));
	escenario.cables.visible = (document.getElementById('ver-cables') as HTMLInputElement).checked;
}
reconstruirCables();

/* --------------------------- Paneles laterales --------------------------- */

const $ = (id: string) => document.getElementById(id)!;

function pintarPaneles(): void {
	$('nombre-proyecto').textContent = proyecto.nombre;

	const lista = $('lista-dispositivos');
	lista.innerHTML = '';
	for (const d of proyecto.dispositivos.filter((x) => !x.campo)) {
		const li = document.createElement('li');
		li.dataset.id = d.id;
		li.className = d.id === seleccionadoId ? 'seleccionado' : '';
		li.innerHTML = `<span class="des">${d.designacion ?? d.id}</span><span class="desc">${d.descripcion ?? ''}</span>`;
		li.onclick = () => seleccionar(d.id);
		lista.appendChild(li);
	}

	const drc = $('lista-drc');
	drc.innerHTML = '';
	if (hallazgos.length === 0) {
		drc.innerHTML = '<li class="hallazgo ok">Sin errores ni avisos</li>';
	}
	for (const h of hallazgos) {
		const li = document.createElement('li');
		li.className = `hallazgo ${h.severidad}`;
		li.textContent = h.mensaje;
		drc.appendChild(li);
	}

	const ocup = $('ocupacion');
	ocup.innerHTML = '';
	for (const o of ruteo.ocupaciones) {
		const pct = Math.min(100, Math.round(o.ocupacion * 100));
		ocup.insertAdjacentHTML(
			'beforeend',
			`<div style="display:flex;justify-content:space-between"><span>${o.canaletaId}</span><span>${pct} %</span></div>
			 <div class="barra"><div class="${o.excedida ? 'excedida' : ''}" style="width:${pct}%"></div></div>`,
		);
	}

	const total = ruteo.rutas.reduce((s, r) => s + r.longitudMm, 0);
	$('resumen-cables').textContent =
		`${ruteo.rutas.length} cables ruteados · ${(total / 1000).toFixed(1)} m en total`;
}

function pintarSeleccion(): void {
	const panel = $('panel-der');
	if (!seleccionadoId) {
		panel.style.display = 'none';
		return;
	}
	const d = proyecto.dispositivos.find((x) => x.id === seleccionadoId)!;
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === d.id);
	const conexiones = d.bornes.flatMap((b) =>
		conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id }).map((c) => c.numero ?? c.id),
	);
	const propios = hallazgos.filter((h) => h.dispositivoId === d.id);
	const longitudes = ruteo.rutas
		.filter((r) => {
			const c = proyecto.conductores.find((x) => x.id === r.conductorId)!;
			return c.de.dispositivoId === d.id || c.a.dispositivoId === d.id;
		})
		.reduce((s, r) => s + r.longitudMm, 0);

	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>${d.designacion ?? d.id}</h1>
		<div style="color:var(--texto-suave)">${d.descripcion ?? ''}</div>
		<dl>
			<dt>Referencia</dt><dd>${d.fabricante ?? '—'} ${d.referencia ?? ''}</dd>
			<dt>Posición en esquema</dt><dd>${posicionTexto(proyecto, d)}</dd>
			${col ? `<dt>Posición en placa</dt><dd>x ${Math.round(col.x)} mm · y ${Math.round(col.y)} mm</dd>` : ''}
			${d.tensionNominal ? `<dt>Tensión</dt><dd>${d.tensionNominal} V</dd>` : ''}
			<dt>Bornes</dt><dd>${d.bornes.map((b) => `<span class="chip">${b.id}</span>`).join('')}</dd>
			<dt>Conductores conectados</dt>
			<dd>${[...new Set(conexiones)].map((n) => `<span class="chip">${n}</span>`).join('') || '—'}</dd>
			${longitudes ? `<dt>Cable asociado</dt><dd>${(longitudes / 1000).toFixed(2)} m</dd>` : ''}
		</dl>
		${propios.length ? `<h2>Hallazgos DRC</h2><ul>${propios
			.map((h) => `<li class="hallazgo ${h.severidad}">${h.mensaje}</li>`)
			.join('')}</ul>` : ''}
	`;
}

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
		const grupo = grupoDe(id);
		grupo?.traverse((o) => {
			if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
				o.material = o.material.clone();
				o.material.emissive.setHex(0x2255aa);
				o.material.emissiveIntensity = 0.55;
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

// Arrastre: restringido al eje X (a lo largo del riel), con re-ruteo al soltar.
let arrastrando = false;
let planoArrastre = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let desfaseArrastre = 0;

renderer.domElement.addEventListener('pointerdown', (ev) => {
	const id = dispositivoBajoElPuntero(ev);
	if (id !== seleccionadoId) seleccionar(id);
	if (!id) return;
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === id);
	if (!col) return;
	arrastrando = true;
	controles.enabled = false;
	planoArrastre = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
	const impacto = new THREE.Vector3();
	raycaster.ray.intersectPlane(planoArrastre, impacto);
	desfaseArrastre = impacto.x - grupoDe(id)!.position.x;
});

renderer.domElement.addEventListener('pointermove', (ev) => {
	if (!arrastrando || !seleccionadoId) return;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impacto = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planoArrastre, impacto)) return;

	const g = proyecto.gabinete!;
	const col = g.colocaciones.find((c) => c.dispositivoId === seleccionadoId)!;
	const xEscena = impacto.x - desfaseArrastre;
	col.x = Math.min(Math.max(xEscena + g.ancho / 2 - col.ancho / 2, 0), g.ancho - col.ancho);
	grupoDe(seleccionadoId)!.position.x = col.x + col.ancho / 2 - g.ancho / 2;
});

renderer.domElement.addEventListener('pointerup', () => {
	if (!arrastrando) return;
	arrastrando = false;
	controles.enabled = true;
	recalcular();
	reconstruirCables();
	pintarPaneles();
	pintarSeleccion();
});

/* ------------------------------- Vista ------------------------------- */

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

window.addEventListener('resize', () => {
	camara.aspect = window.innerWidth / window.innerHeight;
	camara.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

pintarPaneles();

renderer.setAnimationLoop(() => {
	controles.update();
	renderer.render(escena, camara);
});
