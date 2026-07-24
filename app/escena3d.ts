/**
 * Construcción de la escena 3D del gabinete a partir del modelo de TableroStudio.
 *
 * Convención de coordenadas: el modelo usa milímetros con Y hacia abajo sobre la placa;
 * en 3D la placa queda vertical en el plano XY (Y hacia arriba) y Z sale de la placa
 * hacia el frente. Todo se centra en el origen para orbitar cómodo.
 */
import * as THREE from 'three';
import { Colocacion, Dispositivo, Gabinete, Proyecto } from '../src/modelo/tipos.js';
import { orthogonalize } from './geometria-cables.js';
import { construirAparato3D } from './dispositivos3d.js';

export const COLOR_CABLE: Record<string, number> = {
	'negro': 0x20242a,
	'azul': 0x1565c0,
	'rojo': 0xc62828,
	'blanco': 0xe8eaed,
	'gris': 0x9aa0a6,
	'marrón': 0x6d4c41,
	'marron': 0x6d4c41,
	'verde/amarillo': 0x7cb342,
};

/** Colores por nivel de tensión (referencia visual; niveles habituales en Chile). */
export const VOLTAJE_COLOR: Record<number, number> = {
	12: 0x26c6da,
	24: 0x29b6f6,
	110: 0xffca28,
	220: 0xfb8c00,
	380: 0xe53935,
	400: 0xd32f2f,
};

export function colorVoltaje(v?: number): number {
	return v !== undefined && VOLTAJE_COLOR[v] !== undefined ? VOLTAJE_COLOR[v] : 0x8a929a;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export interface Escenario {
	raiz: THREE.Group;
	dispositivos: THREE.Group;   // mallas con userData.dispositivoId
	cables: THREE.Group;
	cotas: THREE.Group;          // acotado dimensional (modo "ver tamaños")
	handles: THREE.Group;        // tiradores de mover/redimensionar del elemento seleccionado
	tapas: THREE.Object3D[];     // tapas de canaletas (para ocultarlas)
	etiquetas: THREE.Object3D[]; // sprites de designación
	centro: THREE.Vector3;
	/** Convierte un punto del modelo (mm, Y abajo) a coordenadas de escena. */
	aEscena: (x: number, y: number, z: number) => THREE.Vector3;
}

const ALTO_RIEL = 35;
const Z_FRENTE = 52; // profundidad a la que corren los cables (al frente, sin atravesar aparatos)

export function construirEscenario(proyecto: Proyecto): Escenario {
	const g = proyecto.gabinete;
	if (!g) throw new Error('El proyecto no tiene gabinete');

	const raiz = new THREE.Group();
	const aEscena = (x: number, y: number, z: number) =>
		new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z);

	raiz.add(construirCaja(g));
	for (const riel of g.rieles) raiz.add(construirRiel(riel, aEscena));

	const tapas: THREE.Object3D[] = [];
	for (const can of g.canaletas) raiz.add(construirCanaleta(can, aEscena, tapas));

	const dispositivos = new THREE.Group();
	const etiquetas: THREE.Object3D[] = [];
	for (const col of g.colocaciones) {
		const d = proyecto.dispositivos.find((x) => x.id === col.dispositivoId);
		if (!d) continue;
		dispositivos.add(construirDispositivo(d, col, aEscena, etiquetas));
	}
	raiz.add(dispositivos);

	const cables = new THREE.Group();
	raiz.add(cables);

	const cotas = new THREE.Group();
	cotas.visible = false;
	raiz.add(cotas);

	const handles = new THREE.Group();
	raiz.add(handles);

	return { raiz, dispositivos, cables, cotas, handles, tapas, etiquetas, centro: new THREE.Vector3(0, 0, 0), aEscena };
}

/* --------------------------------- Cotas --------------------------------- */

export interface DatosCota {
	/** Qué dimensión representa (para editarla con un clic en modo editor). */
	objetivo:
		| { tipo: 'caja'; dim: 'ancho' | 'alto' | 'profundidad' }
		| { tipo: 'placa'; dim: 'ancho' | 'alto' }
		| { tipo: 'riel'; id: string }
		| { tipo: 'canaleta'; id: string };
	valorMm: number;
}

function etiquetaCota(texto: string, color: string): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 240;
	canvas.height = 80;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.roundRect(2, 2, 236, 76, 16);
	ctx.fill();
	ctx.fillStyle = '#101215';
	ctx.font = '700 40px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(texto, 120, 42);
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
	sprite.scale.set(52, 17.3, 1);
	return sprite;
}

const cm = (mm: number) => `${(mm / 10).toFixed(mm % 10 === 0 ? 0 : 1)} cm`;

/** Línea de cota con marcas en los extremos y etiqueta clicable en el centro. */
function cota(
	a: THREE.Vector3,
	b: THREE.Vector3,
	color: string,
	datos: DatosCota,
	desvio: THREE.Vector3,
): THREE.Group {
	const g = new THREE.Group();
	const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
	const p1 = a.clone().add(desvio);
	const p2 = b.clone().add(desvio);
	g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), material));
	// Marcas en los extremos (perpendiculares cortas hacia el objeto).
	const marca = desvio.clone().normalize().multiplyScalar(8);
	g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1.clone().add(marca), p1.clone().sub(marca)]), material));
	g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p2.clone().add(marca), p2.clone().sub(marca)]), material));
	const etiqueta = etiquetaCota(cm(datos.valorMm), color);
	etiqueta.position.copy(p1.clone().add(p2).multiplyScalar(0.5));
	etiqueta.userData.cota = datos;
	g.add(etiqueta);
	return g;
}

/** Construye el acotado completo: caja (azul), placa (verde), canaletas (naranja), rieles (amarillo). */
export function construirCotas(proyecto: Proyecto, aEscena: Escenario['aEscena']): THREE.Group {
	const grupo = new THREE.Group();
	const g = proyecto.gabinete;
	if (!g) return grupo;
	const caja = cajaDe(g);
	const v = (x: number, y: number, z: number) => aEscena(x, y, z);

	// Caja envolvente — azul.
	const AZUL = '#7cc0ff';
	const cx = (caja.ancho - g.ancho) / 2;   // desborde de la caja respecto de la placa
	const cy = (caja.alto - g.alto) / 2;
	grupo.add(cota(
		v(-cx, g.alto + cy, 0), v(g.ancho + cx, g.alto + cy, 0), AZUL,
		{ objetivo: { tipo: 'caja', dim: 'ancho' }, valorMm: caja.ancho }, new THREE.Vector3(0, -60, 40),
	));
	grupo.add(cota(
		v(-cx, -cy, 0), v(-cx, g.alto + cy, 0), AZUL,
		{ objetivo: { tipo: 'caja', dim: 'alto' }, valorMm: caja.alto }, new THREE.Vector3(-60, 0, 40),
	));
	grupo.add(cota(
		v(g.ancho + cx, -cy, 0), v(g.ancho + cx, -cy, caja.profundidad), AZUL,
		{ objetivo: { tipo: 'caja', dim: 'profundidad' }, valorMm: caja.profundidad }, new THREE.Vector3(40, 40, 0),
	));

	// Placa de montaje — verde.
	const VERDE = '#7ee2a1';
	grupo.add(cota(
		v(0, -14, 0), v(g.ancho, -14, 0), VERDE,
		{ objetivo: { tipo: 'placa', dim: 'ancho' }, valorMm: g.ancho }, new THREE.Vector3(0, 0, 30),
	));
	grupo.add(cota(
		v(g.ancho + 14, 0, 0), v(g.ancho + 14, g.alto, 0), VERDE,
		{ objetivo: { tipo: 'placa', dim: 'alto' }, valorMm: g.alto }, new THREE.Vector3(0, 0, 30),
	));

	// Canaletas — naranja; rieles — amarillo.
	for (const can of g.canaletas) {
		const esH = can.orientacion === 'h';
		const a = v(can.x, can.y, can.alto + 8);
		const b = esH ? v(can.x + can.largo, can.y, can.alto + 8) : v(can.x, can.y + can.largo, can.alto + 8);
		grupo.add(cota(a, b, '#ffc069', { objetivo: { tipo: 'canaleta', id: can.id }, valorMm: can.largo },
			new THREE.Vector3(esH ? 0 : 14, esH ? 14 : 0, 12)));
	}
	for (const riel of g.rieles) {
		grupo.add(cota(
			v(riel.x, riel.y, 14), v(riel.x + riel.largo, riel.y, 14), '#ffe58f',
			{ objetivo: { tipo: 'riel', id: riel.id }, valorMm: riel.largo }, new THREE.Vector3(0, -6, 14),
		));
	}
	return grupo;
}

/* ------------------------------- Gabinete ------------------------------- */

/** Dimensiones efectivas de la caja envolvente (si no están definidas, placa + margen). */
export function cajaDe(g: Gabinete): { ancho: number; alto: number; profundidad: number } {
	return {
		ancho: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 10),
		alto: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 10),
		profundidad: g.caja?.profundidad ?? 160,
	};
}

function construirCaja(g: Gabinete): THREE.Group {
	const grupo = new THREE.Group();
	const caja = cajaDe(g);
	const fondo = caja.profundidad;
	const ancho = caja.ancho;
	const alto = caja.alto;
	// Paredes translúcidas: el interior se ve desde cualquier ángulo de órbita.
	const chapaLateral = new THREE.MeshStandardMaterial({
		color: 0xbfc3c7, metalness: 0.15, roughness: 0.75,
		transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
	});

	// Placa de montaje (galvanizada, ligeramente cálida).
	const placa = new THREE.Mesh(
		new THREE.BoxGeometry(g.ancho, g.alto, 3),
		new THREE.MeshStandardMaterial({ color: 0xd8d9d2, metalness: 0.35, roughness: 0.5 }),
	);
	placa.receiveShadow = true;
	placa.position.z = -1.5;
	grupo.add(placa);

	// Fondo y paredes de la envolvente (frente abierto para mirar dentro).
	const fondoCaja = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, 2), chapaLateral);
	fondoCaja.position.z = -12;
	grupo.add(fondoCaja);

	const pared = (w: number, h: number, x: number, y: number) => {
		const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, fondo), chapaLateral);
		m.position.set(x, y, fondo / 2 - 12);
		grupo.add(m);
	};
	pared(2, alto, -ancho / 2, 0);
	pared(2, alto, ancho / 2, 0);
	pared(ancho, 2, 0, alto / 2);
	pared(ancho, 2, 0, -alto / 2);

	return grupo;
}

export function construirRiel(
	riel: { id?: string; x: number; y: number; largo: number; orientacion?: 'h' | 'v' },
	aEscena: Escenario['aEscena'],
): THREE.Group {
	const grupo = new THREE.Group();
	const material = new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 0.7, roughness: 0.35 });
	const esV = riel.orientacion === 'v';
	// Perfil sombrero simplificado: base + dos alas. El largo corre en X (h) o en Y (v).
	const lx = esV ? ALTO_RIEL - 10 : riel.largo;
	const ly = esV ? riel.largo : ALTO_RIEL - 10;
	const base = new THREE.Mesh(new THREE.BoxGeometry(lx, ly, 5), material);
	base.position.z = 5;
	const ala = (desp: number) => {
		const a = esV
			? new THREE.Mesh(new THREE.BoxGeometry(6, riel.largo, 2), material)
			: new THREE.Mesh(new THREE.BoxGeometry(riel.largo, 6, 2), material);
		a.position.set(esV ? desp : 0, esV ? 0 : desp, 7.5);
		grupo.add(a);
	};
	grupo.add(base);
	ala((ALTO_RIEL - 10) / 2 + 2);
	ala(-(ALTO_RIEL - 10) / 2 - 2);
	const cx = riel.x + (esV ? 0 : riel.largo / 2);
	const cy = riel.y + (esV ? riel.largo / 2 : 0);
	const c = aEscena(cx, cy, 0);
	grupo.position.set(c.x, c.y, 0);
	grupo.traverse((o) => { o.userData.rielId = (riel as { id?: string }).id; });
	return grupo;
}

/**
 * Canaleta ranurada de PVC (ducto ranurado): base atornillada a la placa y dos paredes
 * formadas por "dientes" con ranuras intermedias, por donde cada cable sale hacia el
 * aparato justo en su punto de conexión. Tapa translúcida desmontable.
 */
export function construirCanaleta(
	can: { id: string; x: number; y: number; largo: number; orientacion: 'h' | 'v'; ancho: number; alto: number },
	aEscena: Escenario['aEscena'],
	tapas: THREE.Object3D[],
): THREE.Group {
	const grupo = new THREE.Group();
	const pvc = new THREE.MeshStandardMaterial({ color: 0xb0b6ba, roughness: 0.75 });
	const pvcTapa = new THREE.MeshStandardMaterial({
		color: 0xc2c8cc, roughness: 0.7, transparent: true, opacity: 0.4, depthWrite: false,
	});
	const esH = can.orientacion === 'h';
	const largoX = esH ? can.largo : can.ancho;
	const largoY = esH ? can.ancho : can.largo;

	const DIENTE = 6;   // ancho de cada diente (mm)
	const RANURA = 6;   // ancho de cada ranura (mm)
	const ESPESOR = 2;  // espesor de pared

	// Base perforada (simplificada como placa llena).
	const base = new THREE.Mesh(new THREE.BoxGeometry(largoX, largoY, ESPESOR), pvc);
	base.position.z = ESPESOR / 2;
	grupo.add(base);

	// Paredes ranuradas: una sola geometría fusionada por pared (dientes + zócalo).
	const paredRanurada = (lado: -1 | 1): THREE.Mesh => {
		const cajas: THREE.BoxGeometry[] = [];
		const trasladar = (g: THREE.BoxGeometry, a: number, z: number) => {
			// `a` corre a lo largo de la canaleta; el lado fija la coordenada transversal.
			const t = (largoY / 2 - ESPESOR / 2) * lado;
			if (esH) g.translate(a, t, z);
			else g.translate((largoX / 2 - ESPESOR / 2) * lado, a, z);
			cajas.push(g);
		};
		const largo = can.largo;
		// Zócalo continuo abajo (de él nacen los dientes).
		const zocaloAlto = 8;
		trasladar(
			esH
				? new THREE.BoxGeometry(largo, ESPESOR, zocaloAlto)
				: new THREE.BoxGeometry(ESPESOR, largo, zocaloAlto),
			0,
			ESPESOR + zocaloAlto / 2,
		);
		// Dientes periódicos hasta el borde superior.
		const alturaDiente = can.alto - ESPESOR - zocaloAlto;
		const paso = DIENTE + RANURA;
		const n = Math.floor((largo - RANURA) / paso);
		const inicio = -((n - 1) * paso) / 2;
		for (let i = 0; i < n; i++) {
			trasladar(
				esH
					? new THREE.BoxGeometry(DIENTE, ESPESOR, alturaDiente)
					: new THREE.BoxGeometry(ESPESOR, DIENTE, alturaDiente),
				inicio + i * paso,
				ESPESOR + zocaloAlto + alturaDiente / 2,
			);
		}
		const geometria = fusionarCajas(cajas);
		return new THREE.Mesh(geometria, pvc);
	};
	grupo.add(paredRanurada(1));
	grupo.add(paredRanurada(-1));

	// Tapa translúcida para poder ver los cables.
	const tapa = new THREE.Mesh(new THREE.BoxGeometry(largoX, largoY, 2), pvcTapa);
	tapa.position.z = can.alto + 1;
	grupo.add(tapa);
	tapas.push(tapa);

	const cx = can.x + (esH ? can.largo / 2 : 0);
	const cy = can.y + (esH ? 0 : can.largo / 2);
	const c = aEscena(cx, cy, 0);
	grupo.position.set(c.x, c.y, 0);
	grupo.traverse((o) => { o.userData.canaletaId = can.id; });
	return grupo;
}

/** Fusiona varias BoxGeometry ya trasladadas en una sola geometría (una pared = un draw call). */
function fusionarCajas(cajas: THREE.BoxGeometry[]): THREE.BufferGeometry {
	let totalPos = 0;
	let totalIdx = 0;
	for (const c of cajas) {
		totalPos += c.attributes.position.count;
		totalIdx += c.index!.count;
	}
	const pos = new Float32Array(totalPos * 3);
	const norm = new Float32Array(totalPos * 3);
	const idx = new Uint32Array(totalIdx);
	let pOff = 0;
	let iOff = 0;
	let base = 0;
	for (const c of cajas) {
		pos.set(c.attributes.position.array as Float32Array, pOff * 3);
		norm.set(c.attributes.normal.array as Float32Array, pOff * 3);
		const ci = c.index!.array;
		for (let i = 0; i < ci.length; i++) idx[iOff + i] = ci[i] + base;
		iOff += ci.length;
		base += c.attributes.position.count;
		pOff += c.attributes.position.count;
		c.dispose();
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
	g.setIndex(new THREE.BufferAttribute(idx, 1));
	return g;
}

/* ------------------------------ Dispositivos ------------------------------ */

function textura(texto: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 96;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#f5f6f7';
	ctx.beginPath();
	ctx.roundRect(4, 4, 248, 88, 14);
	ctx.fill();
	ctx.fillStyle = '#111';
	ctx.font = 'bold 52px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(texto, 128, 52);
	const t = new THREE.CanvasTexture(canvas);
	t.anisotropy = 4;
	return t;
}

/** Chapa de tensión: fondo del color del nivel + texto "220 V". */
function badgeVoltaje(voltios: number): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = hex(colorVoltaje(voltios));
	ctx.beginPath();
	ctx.roundRect(4, 4, 120, 56, 12);
	ctx.fill();
	ctx.fillStyle = voltios >= 110 ? '#fff' : '#0d1520';
	ctx.font = 'bold 34px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(`${voltios} V`, 64, 34);
	const t = new THREE.CanvasTexture(canvas);
	t.anisotropy = 4;
	return t;
}

export function construirDispositivo(
	d: Dispositivo,
	col: Colocacion,
	aEscena: Escenario['aEscena'],
	etiquetas: THREE.Object3D[],
): THREE.Group {
	const { grupo, profundidad } = construirAparato3D(d, col);
	grupo.userData.dispositivoId = d.id;

	// Etiqueta con la designación sobre el aparato.
	if (d.designacion) {
		const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura(d.designacion), depthTest: false }));
		sprite.scale.set(44, 16.5, 1);
		sprite.position.set(0, col.alto / 2 + 13, profundidad);
		etiquetas.push(sprite);
		grupo.add(sprite);
	}

	// Chapa de tensión de trabajo (color por nivel), como el rotulado de un tablero real.
	if (d.tensionNominal !== undefined && !d.imagen) {
		const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeVoltaje(d.tensionNominal), depthTest: false }));
		badge.scale.set(24, 12, 1);
		badge.position.set(0, col.alto / 2 + 26, profundidad);
		etiquetas.push(badge);
		grupo.add(badge);
	}

	const c = aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
	grupo.position.set(c.x, c.y, 0);
	return grupo;
}

/* --------------------------------- Cables --------------------------------- */

/** Añade al grupo el tubo visible del cable + un tubo invisible más grueso para poder clicarlo. */
function anadirTuboCable(
	grupo: THREE.Group,
	curva: THREE.Curve<THREE.Vector3>,
	segmentos: number,
	radio: number,
	color: number,
	conductorId: string,
): void {
	const tubo = new THREE.Mesh(
		new THREE.TubeGeometry(curva, segmentos, radio, 7, false),
		new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
	);
	tubo.userData.conductorId = conductorId;
	grupo.add(tubo);
	// Tubo de agarre invisible (radio mayor) para seleccionar el cable con facilidad.
	const agarre = new THREE.Mesh(
		new THREE.TubeGeometry(curva, segmentos, Math.max(radio + 4, 5), 6, false),
		new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
	);
	agarre.userData.conductorId = conductorId;
	grupo.add(agarre);
}

export function construirCables(
	proyecto: Proyecto,
	aEscena: Escenario['aEscena'],
	voltajePorConductor?: Map<string, number | undefined>,
): THREE.Group {
	const grupo = new THREE.Group();
	const colorDe = (c: { id: string; color?: string }): number =>
		voltajePorConductor ? colorVoltaje(voltajePorConductor.get(c.id)) : (COLOR_CABLE[c.color ?? ''] ?? 0x546e7a);

	// TODOS los cables se dibujan en tramos horizontales/verticales (estilo Tinkercad), al
	// FRENTE del tablero para no atravesar aparatos. Con puntos de quiebre a mano pasan por
	// ellos; sin puntos, siguen un recorrido ortogonal por defecto en un carril propio para que
	// queden ordenados y no se crucen. Las canaletas son solo ductos físicos: los cables ya no
	// se ordenan por dentro de ellas (más simple y predecible).
	let carril = 0;
	for (const conductor of proyecto.conductores) {
		const a = anclajeBorne(proyecto, conductor.de.dispositivoId, conductor.de.borneId);
		const b = anclajeBorne(proyecto, conductor.a.dispositivoId, conductor.a.borneId);
		if (!a || !b) continue;
		const color = colorDe(conductor);
		const radio = 0.9 + (conductor.seccion ?? 1.5) * 0.35;
		const pa = aEscena(a.x, a.y, a.z);
		const pb = aEscena(b.x, b.y, b.z);

		let nodos: { x: number; y: number }[];
		if (conductor.trazado?.length) {
			nodos = orthogonalize([{ x: a.x, y: a.y }, ...conductor.trazado, { x: b.x, y: b.y }]);
		} else {
			const laneY = Math.round((a.y + b.y) / 2 + ((carril % 8) - 3.5) * 16);
			carril++;
			nodos = [{ x: a.x, y: a.y }, { x: a.x, y: laneY }, { x: b.x, y: laneY }, { x: b.x, y: b.y }];
		}
		const puntos = [pa, ...nodos.map((p) => aEscena(p.x, p.y, Z_FRENTE)), pb];
		const curva = new THREE.CatmullRomCurve3(puntos, false, 'catmullrom', 0.12);
		anadirTuboCable(grupo, curva, Math.max(40, puntos.length * 8), radio, color, conductor.id);
	}
	return grupo;
}

/**
 * Posición 3D (en coordenadas de modelo: mm, Y abajo) del BORNE concreto de un aparato,
 * para que el cable salga exactamente de su terminal (y se vea de dónde viene).
 * - Imágenes de referencia: usa la posición (u,v) del pin.
 * - Resto de aparatos: reparte los bornes en dos filas (terminales arriba/abajo), igual
 *   que en un aparato modular real (1,3,5 arriba · 2,4,6 abajo).
 * Devuelve undefined si el aparato no está colocado en la placa.
 */
export function anclajeBorne(
	proyecto: Proyecto,
	dispositivoId: string,
	borneId: string,
): { x: number; y: number; z: number } | undefined {
	const d = proyecto.dispositivos.find((x) => x.id === dispositivoId);
	const col = proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === dispositivoId);
	if (!d || !col) return undefined;
	if (d.imagen) {
		const b = d.bornes.find((x) => x.id === borneId);
		if (b?.u !== undefined && b?.v !== undefined) {
			return { x: col.x + b.u * col.ancho, y: col.y + b.v * col.alto, z: 10 };
		}
		return { x: col.x + col.ancho / 2, y: col.y + col.alto / 2, z: 10 };
	}
	const idx = d.bornes.findIndex((b) => b.id === borneId);
	if (idx < 0) return { x: col.x + col.ancho / 2, y: col.y + col.alto / 2, z: 44 };
	// Índices pares → fila superior; impares → fila inferior (como 1/3/5 vs 2/4/6).
	const arriba = idx % 2 === 0;
	const fila = d.bornes.filter((_, i) => (i % 2 === 0) === arriba);
	const pos = fila.findIndex((b) => b.id === borneId);
	const n = Math.max(1, fila.length);
	const x = col.x + (n === 1 ? 0.5 : (pos + 0.5) / n) * col.ancho;
	const y = arriba ? col.y + 5 : col.y + col.alto - 5;
	return { x, y, z: 46 };
}
