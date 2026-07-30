/**
 * Visor 3D de la planta: la SEGUNDA HERRAMIENTA del programa.
 *
 * Está deliberadamente separada del editor de tableros. No se comparte escena, ni cámara, ni
 * estado: son dos programas que viven en la misma ventana. Un tablero se diseña y se simula; una
 * planta se recorre y se consulta. Mezclarlas habría hecho las dos peores.
 *
 * Lo que hace: monta la cubierta con sus UMAs, sus extractores y sus instalaciones tal como salen
 * del plano del proyectista, y deja recorrerla de dos maneras —a pie en primera persona, y desde
 * arriba como en Los Sims—. Al pinchar una máquina se ve su lista de puntos de control del BMS:
 * qué válvulas tiene, qué sondas, qué controlador la gobierna y si sus señales van cableadas en
 * el tablero.
 *
 * HONESTIDAD SOBRE LO QUE SE VE: el plano no trae ni una cota Z en las capas de clima, así que
 * las alturas de los conductos y de las máquinas son REGLAS DE PROYECTO, no medidas. El visor lo
 * dice en su cabecera y no deja de decirlo. Quien mire esto va a tomar decisiones con lo que ve.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
	EquipoPlanta, Infraestructura, SISTEMAS, TrazaPlanta, resumenPlanta,
} from '../src/modelo/infraestructura.js';

/* --------------------------------- Construcción --------------------------------- */

const COLOR_UMA = 0x8b98a5;
const COLOR_VEX = 0x6b7d8f;
const COLOR_CUBIERTA = 0x1b1f24;

interface Mundo {
	escena: THREE.Scene;
	camara: THREE.PerspectiveCamera;
	orbita: OrbitControls;
	equipos: THREE.Group;
	instalaciones: THREE.Group;
	/** Centro de la planta en coordenadas de escena, para encuadrar. */
	centro: THREE.Vector3;
	tamano: { ancho: number; fondo: number };
}

/**
 * El plano viene en coordenadas del proyecto (cientos de miles de milímetros) y con Y hacia
 * arriba en planta. Se traslada al origen y se pasa a metros: un mundo de 240 m se recorre mucho
 * mejor si sus unidades son metros, y así la cámara y la velocidad de paseo salen naturales.
 */
function hacerConversor(inf: Infraestructura) {
	const cx = (inf.zona.x0 + inf.zona.x1) / 2;
	const cy = (inf.zona.y0 + inf.zona.y1) / 2;
	return (x: number, y: number, z = 0): THREE.Vector3 =>
		new THREE.Vector3((x - cx) / 1000, z / 1000, -(y - cy) / 1000);
}

function materialSistema(color: number, transparente = false): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color, roughness: 0.55, metalness: 0.15,
		transparent: transparente, opacity: transparente ? 0.75 : 1,
	});
}

/** Geometría de un tramo de conducto o cañería: un tubo que sigue el recorrido, con su sección. */
function geometriaTraza(
	t: TrazaPlanta, aEscena: ReturnType<typeof hacerConversor>,
): THREE.BufferGeometry | undefined {
	const pts = t.puntos.map(([x, y]) => aEscena(x, y, t.z));
	// Puntos repetidos rompen la curva; y con menos de dos no hay tramo.
	const limpios = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.01);
	if (limpios.length < 2) return undefined;
	const redondo = t.sistema === 'agua' || t.sistema === 'agua-fria' || t.sistema === 'bus';
	const curva = new THREE.CatmullRomCurve3(limpios, false, 'catmullrom', 0.02);
	const radio = Math.max(t.ancho, t.alto) / 2000;
	return new THREE.TubeGeometry(
		curva, Math.min(90, Math.max(2, limpios.length * 2)), radio, redondo ? 6 : 4, false,
	);
}

/**
 * Monta TODAS las instalaciones en una malla por sistema, no una por tramo.
 *
 * Son 1.384 tramos. Con una malla cada uno, la tarjeta gráfica hace 1.384 llamadas de dibujado por
 * fotograma y el paseo va a tirones —medido: se andaban 1,4 m donde tocaban 12—. Fusionando por
 * sistema quedan seis mallas y la cubierta se recorre fluida. Se pierde poder pinchar un tramo
 * concreto, que aquí no hace falta: lo que se consulta son las máquinas.
 */
function construirInstalaciones(
	trazas: TrazaPlanta[], aEscena: ReturnType<typeof hacerConversor>,
): THREE.Group {
	const grupo = new THREE.Group();
	const porSistema = new Map<string, THREE.BufferGeometry[]>();
	for (const t of trazas) {
		const g = geometriaTraza(t, aEscena);
		if (!g) continue;
		// Los atributos tienen que coincidir para poder fusionar: solo posición y normal.
		g.deleteAttribute('uv');
		if (!porSistema.has(t.sistema)) porSistema.set(t.sistema, []);
		porSistema.get(t.sistema)!.push(g);
	}
	for (const [sistema, geos] of porSistema) {
		const info = SISTEMAS[sistema as keyof typeof SISTEMAS];
		const fusionada = fusionar(geos);
		if (!fusionada) continue;
		const malla = new THREE.Mesh(fusionada, materialSistema(info.color, sistema === 'bus'));
		malla.userData.sistema = sistema;
		malla.userData.tramos = geos.length;
		grupo.add(malla);
	}
	return grupo;
}

/**
 * Fusiona geometrías en una sola. Se hace a mano en vez de con `BufferGeometryUtils` para no
 * arrastrar el addon al paquete que se entrega: solo hacen falta posición, normal e índices.
 */
function fusionar(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | undefined {
	if (geos.length === 0) return undefined;
	let vertices = 0;
	let indices = 0;
	for (const g of geos) {
		vertices += g.getAttribute('position').count;
		indices += g.index ? g.index.count : g.getAttribute('position').count;
	}
	const pos = new Float32Array(vertices * 3);
	const nor = new Float32Array(vertices * 3);
	const idx = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
	let vOff = 0;
	let iOff = 0;
	for (const g of geos) {
		const p = g.getAttribute('position');
		const n = g.getAttribute('normal');
		pos.set(p.array as Float32Array, vOff * 3);
		if (n) nor.set(n.array as Float32Array, vOff * 3);
		const gi = g.index;
		if (gi) {
			for (let i = 0; i < gi.count; i++) idx[iOff + i] = gi.getX(i) + vOff;
			iOff += gi.count;
		} else {
			for (let i = 0; i < p.count; i++) idx[iOff + i] = i + vOff;
			iOff += p.count;
		}
		vOff += p.count;
		g.dispose();
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
	out.setIndex(new THREE.BufferAttribute(idx, 1));
	out.computeBoundingSphere();
	return out;
}

/** Una máquina: su caja, y un cartel con su marcado que siempre mira a la cámara. */
function construirEquipo(e: EquipoPlanta, aEscena: ReturnType<typeof hacerConversor>): THREE.Group | undefined {
	if (e.x === null || e.y === null) return undefined;
	const g = new THREE.Group();
	const an = (e.ancho ?? 2000) / 1000;
	const fo = (e.fondo ?? 2000) / 1000;
	const al = (e.alto ?? 2000) / 1000;
	const esUma = e.tipo === 'uma';
	const cuerpo = new THREE.Mesh(
		new THREE.BoxGeometry(an, al, fo),
		new THREE.MeshStandardMaterial({
			color: esUma ? COLOR_UMA : COLOR_VEX, roughness: 0.65, metalness: 0.35,
		}),
	);
	cuerpo.position.y = al / 2;
	cuerpo.castShadow = true;
	g.add(cuerpo);
	// Franja de color en el frente: verde si tiene puntos de control, gris si el plano no los da.
	const franja = new THREE.Mesh(
		new THREE.BoxGeometry(an * 0.96, Math.min(0.22, al * 0.12), 0.04),
		new THREE.MeshStandardMaterial({
			color: e.puntos.length ? 0x2f9e44 : 0x4a5158,
			emissive: e.puntos.length ? 0x14401f : 0x000000, emissiveIntensity: 0.6,
		}),
	);
	franja.position.set(0, al * 0.78, fo / 2 + 0.02);
	g.add(franja);
	g.add(cartel(e.tag, al + 0.9, e.tagSeguro));
	g.position.copy(aEscena(e.x, e.y, 0));
	g.userData.tag = e.tag;
	g.userData.equipo = e;
	return g;
}

/** Cartel de texto flotante (sprite): se lee desde cualquier ángulo. */
function cartel(texto: string, altura: number, seguro: boolean): THREE.Sprite {
	const lienzo = document.createElement('canvas');
	lienzo.width = 512; lienzo.height = 128;
	const c = lienzo.getContext('2d')!;
	c.fillStyle = 'rgba(12,16,20,.82)';
	c.beginPath(); c.roundRect(6, 26, 500, 76, 14); c.fill();
	c.strokeStyle = seguro ? '#4dabf7' : '#9aa0a6';
	c.lineWidth = 3; c.stroke();
	c.fillStyle = seguro ? '#e6edf3' : '#aab2ba';
	c.font = 'bold 44px system-ui, sans-serif';
	c.textAlign = 'center'; c.textBaseline = 'middle';
	c.fillText(seguro ? texto : `${texto} ?`, 256, 64);
	const tex = new THREE.CanvasTexture(lienzo);
	const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
	sp.scale.set(4.4, 1.1, 1);
	sp.position.y = altura;
	sp.userData.cartel = true;
	return sp;
}

export function construirMundo(inf: Infraestructura, lienzo: HTMLCanvasElement): Mundo {
	const aEscena = hacerConversor(inf);
	const escena = new THREE.Scene();
	escena.background = new THREE.Color(0x0c1015);
	escena.fog = new THREE.Fog(0x0c1015, 90, 340);

	const ancho = (inf.zona.x1 - inf.zona.x0) / 1000;
	const fondo = (inf.zona.y1 - inf.zona.y0) / 1000;

	// Losa de la cubierta, con una rejilla encima para dar escala al caminar.
	const losa = new THREE.Mesh(
		new THREE.BoxGeometry(ancho + 20, 0.35, fondo + 20),
		new THREE.MeshStandardMaterial({ color: COLOR_CUBIERTA, roughness: 0.95 }),
	);
	losa.position.y = -0.18;
	losa.receiveShadow = true;
	escena.add(losa);
	const rejilla = new THREE.GridHelper(Math.max(ancho, fondo) + 20, Math.round((Math.max(ancho, fondo) + 20) / 5),
		0x2a3138, 0x1c2126);
	rejilla.position.y = 0.02;
	escena.add(rejilla);

	escena.add(new THREE.HemisphereLight(0x9fb6cd, 0x1a1f24, 1.05));
	const sol = new THREE.DirectionalLight(0xffe8c4, 1.5);
	sol.position.set(ancho * 0.4, 90, fondo * 0.3);
	sol.castShadow = true;
	sol.shadow.mapSize.set(2048, 2048);
	sol.shadow.camera.near = 1; sol.shadow.camera.far = 400;
	const s = Math.max(ancho, fondo) * 0.7;
	Object.assign(sol.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
	sol.shadow.camera.updateProjectionMatrix();
	escena.add(sol);

	const instalaciones = construirInstalaciones(inf.trazas, aEscena);
	escena.add(instalaciones);

	const equipos = new THREE.Group();
	for (const e of inf.equipos) {
		const g = construirEquipo(e, aEscena);
		if (g) equipos.add(g);
	}
	escena.add(equipos);

	const camara = new THREE.PerspectiveCamera(58, 1, 0.1, 1200);
	const orbita = new OrbitControls(camara, lienzo);
	orbita.enableDamping = true;
	orbita.dampingFactor = 0.09;
	orbita.maxPolarAngle = Math.PI / 2.05;   // no meter la cámara bajo la losa

	return { escena, camara, orbita, equipos, instalaciones,
		centro: new THREE.Vector3(0, 0, 0), tamano: { ancho, fondo } };
}

/* ------------------------------- Las dos vistas ------------------------------- */

export type VistaMundo = 'sims' | 'paseo';

/** Vista «Sims»: desde arriba y en ángulo, con la planta entera a la vista. */
export function ponerVistaSims(m: Mundo): void {
	const d = Math.max(m.tamano.ancho, m.tamano.fondo) * 0.62;
	m.camara.position.set(d * 0.45, d * 0.78, d * 0.62);
	m.orbita.target.set(0, 0, 0);
	m.orbita.enabled = true;
	m.orbita.update();
}

/**
 * Vista de paseo: a la altura de los ojos y JUNTO A UNA MÁQUINA, no en el borde de la cubierta.
 *
 * Puesto en el borde de una planta de 244 m, lo primero que se ve es una línea de cosas diminutas
 * en el horizonte y da la impresión de que no hay nada. Empezar a ocho metros de una UMA, mirándola,
 * enseña de entrada la escala real: una máquina de siete metros de largo por encima de la cabeza.
 */
export function ponerVistaPaseo(m: Mundo): void {
	m.orbita.enabled = false;      // en paseo manda el teclado y el ratón libre
	const cerca = m.equipos.children[Math.floor(m.equipos.children.length / 2)];
	if (cerca) {
		m.camara.position.set(cerca.position.x + 9, 1.7, cerca.position.z + 9);
		m.camara.lookAt(cerca.position.x, 1.7, cerca.position.z);
		return;
	}
	m.camara.position.set(0, 1.7, m.tamano.fondo * 0.42);
	m.camara.lookAt(0, 1.7, 0);
}

/**
 * Paseo en primera persona: WASD para moverse, ratón para mirar.
 *
 * No usa `PointerLockControls` para no bloquear el cursor sin avisar —eso desconcierta a quien
 * no juega— sino arrastre con el botón izquierdo, que es lo que ya hace en el resto del programa.
 */
export function crearPaseo(m: Mundo, lienzo: HTMLCanvasElement) {
	const teclas = new Set<string>();
	let girando = false;
	let ultimo = { x: 0, y: 0 };
	let yaw = Math.PI;
	let pitch = 0;
	const ALTURA_OJOS = 1.7;
	const VELOCIDAD = 14;          // m/s: se recorren 240 m sin aburrirse

	const onKeyDown = (e: KeyboardEvent) => { teclas.add(e.code); };
	const onKeyUp = (e: KeyboardEvent) => { teclas.delete(e.code); };
	const onDown = (e: MouseEvent) => { girando = true; ultimo = { x: e.clientX, y: e.clientY }; };
	const onUp = () => { girando = false; };
	const onMove = (e: MouseEvent) => {
		if (!girando) return;
		yaw -= (e.clientX - ultimo.x) * 0.0035;
		pitch = Math.max(-1.4, Math.min(1.4, pitch - (e.clientY - ultimo.y) * 0.0035));
		ultimo = { x: e.clientX, y: e.clientY };
	};

	function activar(): void {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		lienzo.addEventListener('mousedown', onDown);
		window.addEventListener('mouseup', onUp);
		window.addEventListener('mousemove', onMove);
		// Se mira hacia donde ya apuntaba la cámara, para no dar un salto al cambiar de vista.
		const dir = new THREE.Vector3();
		m.camara.getWorldDirection(dir);
		yaw = Math.atan2(-dir.x, -dir.z);
		pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
		m.camara.position.y = ALTURA_OJOS;
	}
	function desactivar(): void {
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		lienzo.removeEventListener('mousedown', onDown);
		window.removeEventListener('mouseup', onUp);
		window.removeEventListener('mousemove', onMove);
		teclas.clear();
		girando = false;
	}
	function paso(dt: number): void {
		const dir = new THREE.Vector3(
			Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch),
		).multiplyScalar(-1);
		m.camara.lookAt(m.camara.position.clone().add(dir));
		const adelante = new THREE.Vector3(dir.x, 0, dir.z).normalize();
		const lado = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), adelante).normalize();
		const v = new THREE.Vector3();
		if (teclas.has('KeyW') || teclas.has('ArrowUp')) v.add(adelante);
		if (teclas.has('KeyS') || teclas.has('ArrowDown')) v.sub(adelante);
		if (teclas.has('KeyA') || teclas.has('ArrowLeft')) v.add(lado);
		if (teclas.has('KeyD') || teclas.has('ArrowRight')) v.sub(lado);
		const rapido = teclas.has('ShiftLeft') || teclas.has('ShiftRight');
		if (v.lengthSq() > 0) {
			v.normalize().multiplyScalar(VELOCIDAD * (rapido ? 3 : 1) * dt);
			m.camara.position.add(v);
		}
		m.camara.position.y = ALTURA_OJOS;
		// No dejar salirse de la cubierta: fuera no hay nada que ver y se pierde el norte.
		const lx = m.tamano.ancho / 2 + 8;
		const lz = m.tamano.fondo / 2 + 8;
		m.camara.position.x = Math.max(-lx, Math.min(lx, m.camara.position.x));
		m.camara.position.z = Math.max(-lz, Math.min(lz, m.camara.position.z));
	}
	return { activar, desactivar, paso };
}

/** Equipo bajo el puntero, si hay alguno (para pinchar una máquina y ver su ficha). */
export function equipoEnPixel(
	m: Mundo, lienzo: HTMLCanvasElement, cx: number, cy: number,
): EquipoPlanta | undefined {
	const r = lienzo.getBoundingClientRect();
	const puntero = new THREE.Vector2(
		((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1,
	);
	const rayo = new THREE.Raycaster();
	rayo.setFromCamera(puntero, m.camara);
	for (const h of rayo.intersectObjects(m.equipos.children, true)) {
		let o: THREE.Object3D | null = h.object;
		while (o && !o.userData.equipo) o = o.parent;
		if (o?.userData.equipo) return o.userData.equipo as EquipoPlanta;
	}
	return undefined;
}

/** Resalta la máquina seleccionada y apaga las demás. */
export function resaltarEquipo(m: Mundo, tag: string | undefined): void {
	for (const g of m.equipos.children) {
		const activo = g.userData.tag === tag;
		g.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
			if (o.userData.baseColor === undefined) o.userData.baseColor = o.material.color.getHex();
			o.material.emissive.setHex(activo ? 0x2b6cb0 : (o.material.emissive.getHex() && !activo ? o.material.emissive.getHex() : 0x000000));
			o.material.emissiveIntensity = activo ? 0.55 : (o.userData.emisivo ?? 0);
		});
	}
}

/** Enfoca la vista Sims sobre una máquina concreta. */
export function enfocarEquipo(m: Mundo, tag: string): void {
	const g = m.equipos.children.find((x) => x.userData.tag === tag);
	if (!g) return;
	m.orbita.target.copy(g.position);
	m.camara.position.set(g.position.x + 16, 12, g.position.z + 16);
	m.orbita.update();
}

export { resumenPlanta };
