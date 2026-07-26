/**
 * Construcción de la escena 3D del gabinete a partir del modelo de TableroStudio.
 *
 * Convención de coordenadas: el modelo usa milímetros con Y hacia abajo sobre la placa;
 * en 3D la placa queda vertical en el plano XY (Y hacia arriba) y Z sale de la placa
 * hacia el frente. Todo se centra en el origen para orbitar cómodo.
 */
import * as THREE from 'three';
import { Colocacion, Dispositivo, Gabinete, Proyecto } from '../src/modelo/tipos.js';
import { Banda, corredoresLibres, orthogonalize, rutaAutomatica } from './geometria-cables.js';
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
	bornes: THREE.Group;         // puntos de conexión clicables (para cablear en modo Trabajo)
	cotas: THREE.Group;          // acotado dimensional (modo "ver tamaños")
	handles: THREE.Group;        // tiradores de mover/redimensionar del elemento seleccionado
	tapas: THREE.Object3D[];     // tapas de canaletas (para ocultarlas)
	etiquetas: THREE.Object3D[]; // sprites de designación
	centro: THREE.Vector3;
	/** Convierte un punto del modelo (mm, Y abajo) a coordenadas de escena. */
	aEscena: (x: number, y: number, z: number) => THREE.Vector3;
}

const ALTO_RIEL = 35;
/** Profundidad a la que corren los cables (al frente, sin atravesar aparatos). */
export const Z_FRENTE = 52;

export function construirEscenario(proyecto: Proyecto, realista = false): Escenario {
	const g = proyecto.gabinete;
	if (!g) throw new Error('El proyecto no tiene gabinete');

	const raiz = new THREE.Group();
	const aEscena = (x: number, y: number, z: number) =>
		new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z);

	raiz.add(construirCaja(g, realista));
	for (const riel of g.rieles) raiz.add(construirRiel(riel, aEscena));

	const tapas: THREE.Object3D[] = [];
	for (const can of g.canaletas) raiz.add(construirCanaleta(can, aEscena, tapas));

	// Prensaestopas de entrada: por ahí salen los cables hacia la red y hacia el campo.
	raiz.add(construirEntradasCampo(proyecto, aEscena));

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

	const bornes = new THREE.Group();
	bornes.visible = false;
	raiz.add(bornes);

	const cotas = new THREE.Group();
	cotas.visible = false;
	raiz.add(cotas);

	const handles = new THREE.Group();
	raiz.add(handles);

	return { raiz, dispositivos, cables, bornes, cotas, handles, tapas, etiquetas, centro: new THREE.Vector3(0, 0, 0), aEscena };
}

/**
 * Puntos de conexión (bornes) clicables de TODOS los aparatos —los de la placa y los de
 * campo/red por su prensaestopas—, para cablear con clic como en un tablero real: se toca
 * un borne y luego otro. Cada esfera lleva su aparato y su borne.
 */
export function construirBornes(proyecto: Proyecto, aEscena: Escenario['aEscena']): THREE.Group {
	const grupo = new THREE.Group();
	const geo = new THREE.SphereGeometry(4.2, 12, 12);
	// Bornes ya cableados: se pintan apagados; los que faltan por conectar, en naranja vivo.
	// Así de un vistazo se ve qué queda por cablear, como al revisar un tablero de verdad.
	const usados = new Set<string>();
	for (const c of proyecto.conductores) {
		usados.add(`${c.de.dispositivoId}:${c.de.borneId}`);
		usados.add(`${c.a.dispositivoId}:${c.a.borneId}`);
	}
	for (const d of proyecto.dispositivos) {
		for (const b of d.bornes) {
			const pos = anclajeBorne(proyecto, d.id, b.id);
			if (!pos) continue;
			const conectado = usados.has(`${d.id}:${b.id}`);
			const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
				color: conectado ? 0x6f7c89 : 0xffb63a,
				emissive: conectado ? 0x11161b : 0x4a3200,
				emissiveIntensity: 1,
				roughness: 0.35,
				metalness: 0.2,
			}));
			m.position.copy(aEscena(pos.x, pos.y, pos.z + 4));
			m.scale.setScalar(conectado ? 0.78 : 1);
			m.userData = { borneDispositivoId: d.id, borneId: b.id, conectado };
			m.renderOrder = 997;
			grupo.add(m);
		}
	}
	return grupo;
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

/**
 * Envolvente del gabinete. En modo normal las paredes son translúcidas para poder trabajar
 * viendo el interior; en modo VISUALIZACIÓN (`realista`) son de chapa opaca y se añade la
 * puerta abierta, para ver el tablero tal como quedaría montado.
 */
function construirCaja(g: Gabinete, realista = false): THREE.Group {
	const grupo = new THREE.Group();
	const caja = cajaDe(g);
	const fondo = caja.profundidad;
	const ancho = caja.ancho;
	const alto = caja.alto;
	const chapaLateral = realista
		? new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 0.45, roughness: 0.42, side: THREE.DoubleSide })
		: new THREE.MeshStandardMaterial({
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

	// Modo visualización: puerta de chapa ABIERTA sobre la bisagra izquierda, con su manilla.
	if (realista) {
		const puerta = new THREE.Group();
		const hoja = new THREE.Mesh(
			new THREE.BoxGeometry(ancho, alto, 12),
			new THREE.MeshStandardMaterial({ color: 0xe3e6e8, metalness: 0.5, roughness: 0.35 }),
		);
		hoja.position.set(ancho / 2, 0, 0); // el pivote queda en el borde izquierdo (la bisagra)
		hoja.castShadow = true;
		puerta.add(hoja);
		const manilla = new THREE.Mesh(
			new THREE.BoxGeometry(16, 60, 16),
			new THREE.MeshStandardMaterial({ color: 0x2f3438, metalness: 0.7, roughness: 0.3 }),
		);
		manilla.position.set(ancho - 26, 0, 12);
		puerta.add(manilla);
		puerta.position.set(-ancho / 2, 0, fondo - 12);
		puerta.rotation.y = -Math.PI * 0.62; // abierta hacia el frente-izquierda
		grupo.add(puerta);
	}

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
	// Tubo de agarre invisible (bastante más grueso) para poder pinchar el cable con facilidad
	// aunque se esté viendo el tablero alejado.
	const agarre = new THREE.Mesh(
		new THREE.TubeGeometry(curva, segmentos, Math.max(radio + 7, 9), 6, false),
		new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
	);
	agarre.userData.conductorId = conductorId;
	grupo.add(agarre);
}

/** Recorrido de un cable ya resuelto: sus anclajes y la polilínea ortogonal que sigue. */
export interface RutaCable {
	conductorId: string;
	de: { x: number; y: number; z: number };
	a: { x: number; y: number; z: number };
	/** Nodos del recorrido en coordenadas de modelo, ya ortogonalizados. */
	nodos: { x: number; y: number }[];
}

/**
 * Resuelve el recorrido de TODOS los cables: única fuente de verdad que usan tanto el dibujo
 * 3D como las comprobaciones de calidad (que no se amontonen ni pasen sobre los aparatos).
 * Con puntos de quiebre a mano pasa por ellos; sin puntos, se rutea por un CORREDOR LIBRE
 * (franja sin aparatos) tomando un carril propio.
 */
export function rutasDeCables(proyecto: Proyecto): RutaCable[] {
	const corredores = corredoresLibresDe(proyecto);
	const rutas: RutaCable[] = [];
	let carril = 0;
	for (const conductor of proyecto.conductores) {
		const a = anclajeBorne(proyecto, conductor.de.dispositivoId, conductor.de.borneId);
		const b = anclajeBorne(proyecto, conductor.a.dispositivoId, conductor.a.borneId);
		if (!a || !b) continue; // solo si falta el aparato entero (se limpia al eliminarlo)
		const intermedios = conductor.trazado?.length
			? conductor.trazado
			: rutaAutomatica({ x: a.x, y: a.y }, { x: b.x, y: b.y }, corredores, carril++);
		rutas.push({
			conductorId: conductor.id,
			de: a,
			a: b,
			nodos: orthogonalize([{ x: a.x, y: a.y }, ...intermedios, { x: b.x, y: b.y }]),
		});
	}
	return rutas;
}

export function construirCables(
	proyecto: Proyecto,
	aEscena: Escenario['aEscena'],
	voltajePorConductor?: Map<string, number | undefined>,
): THREE.Group {
	const grupo = new THREE.Group();
	const colorDe = (c: { id: string; color?: string }): number =>
		voltajePorConductor ? colorVoltaje(voltajePorConductor.get(c.id)) : (COLOR_CABLE[c.color ?? ''] ?? 0x546e7a);

	// Los cables se dibujan en tramos horizontales/verticales (estilo Tinkercad), al FRENTE
	// del tablero para no atravesar los aparatos.
	for (const ruta of rutasDeCables(proyecto)) {
		const conductor = proyecto.conductores.find((c) => c.id === ruta.conductorId)!;
		const radio = 0.9 + (conductor.seccion ?? 1.5) * 0.35;
		const puntos = [
			aEscena(ruta.de.x, ruta.de.y, ruta.de.z),
			...ruta.nodos.map((p) => aEscena(p.x, p.y, Z_FRENTE)),
			aEscena(ruta.a.x, ruta.a.y, ruta.a.z),
		];
		const curva = new THREE.CatmullRomCurve3(puntos, false, 'catmullrom', 0.12);
		anadirTuboCable(grupo, curva, Math.max(40, puntos.length * 8), radio, colorDe(conductor), conductor.id);
	}
	return grupo;
}

/** Corredores libres del gabinete: franjas sin aparatos, incluida la que va a los prensaestopas. */
export function corredoresLibresDe(proyecto: Proyecto): Banda[] {
	const g = proyecto.gabinete;
	if (!g) return [];
	const ocupadas = g.colocaciones.map((c) => ({ y0: c.y - 4, y1: c.y + c.alto + 4 }));
	return corredoresLibres(ocupadas, -10, yEntradasCampo(proyecto) - 8);
}

/* ------------------- Entradas de campo (prensaestopas del gabinete) ------------------- */

/** Aparatos que no están sobre la placa (acometida y aparatos de campo), en orden estable. */
export function aparatosDeCampo(proyecto: Proyecto): Dispositivo[] {
	const colocados = new Set(proyecto.gabinete?.colocaciones.map((c) => c.dispositivoId) ?? []);
	return proyecto.dispositivos.filter((d) => !colocados.has(d.id));
}

/** Y (mm) de la regleta de entrada de campo: justo por debajo de la placa, dentro de la caja. */
export function yEntradasCampo(proyecto: Proyecto): number {
	return (proyecto.gabinete?.alto ?? 0) + 26;
}

/** Centro X (mm) del prensaestopas de un aparato de campo, repartidos a lo ancho del gabinete. */
function xEntradaCampo(proyecto: Proyecto, dispositivoId: string): number | undefined {
	const campo = aparatosDeCampo(proyecto);
	const i = campo.findIndex((d) => d.id === dispositivoId);
	if (i < 0) return undefined;
	const ancho = proyecto.gabinete?.ancho ?? 0;
	return Math.round(((i + 1) * ancho) / (campo.length + 1));
}

/** Anclaje de un borne de un aparato de campo: sobre su prensaestopas, un punto por borne. */
function anclajeCampo(
	proyecto: Proyecto,
	d: Dispositivo,
	borneId: string,
): { x: number; y: number; z: number } | undefined {
	const cx = xEntradaCampo(proyecto, d.id);
	if (cx === undefined) return undefined;
	const j = Math.max(0, d.bornes.findIndex((b) => b.id === borneId));
	const n = Math.max(1, d.bornes.length);
	return { x: Math.round(cx + (j - (n - 1) / 2) * 13), y: yEntradasCampo(proyecto), z: 30 };
}

/**
 * Prensaestopas + rótulo de cada aparato de campo, en el borde inferior del gabinete: es el
 * punto físico por donde el cable sale del tablero hacia la red o hacia el campo.
 */
export function construirEntradasCampo(proyecto: Proyecto, aEscena: Escenario['aEscena']): THREE.Group {
	const grupo = new THREE.Group();
	const campo = aparatosDeCampo(proyecto);
	if (campo.length === 0) return grupo;
	const y = yEntradasCampo(proyecto);
	for (const d of campo) {
		const cx = xEntradaCampo(proyecto, d.id);
		if (cx === undefined) continue;
		const ancho = Math.max(26, d.bornes.length * 13 + 10);
		// Cuerpo del prensaestopas (regleta pasamuros).
		const cuerpo = new THREE.Mesh(
			new THREE.BoxGeometry(ancho, 16, 20),
			new THREE.MeshStandardMaterial({ color: 0x8b95a1, roughness: 0.6, metalness: 0.35 }),
		);
		cuerpo.position.copy(aEscena(cx, y, 10));
		cuerpo.castShadow = true;
		grupo.add(cuerpo);
		// Rótulo del destino (a dónde va: red, motor, sensor…).
		const etq = etiquetaCota(d.designacion ?? d.id, '#cfd6de');
		etq.position.copy(aEscena(cx, y + 24, 26));
		etq.scale.set(44, 14.6, 1);
		grupo.add(etq);
	}
	return grupo;
}

/**
 * Posición 3D (en coordenadas de modelo: mm, Y abajo) del BORNE concreto de un aparato,
 * para que el cable salga exactamente de su terminal (y se vea de dónde viene).
 * - Imágenes de referencia: usa la posición (u,v) del pin.
 * - Aparatos sobre la placa: dos filas de terminales (1,3,5 arriba · 2,4,6 abajo).
 * - Aparatos de campo/red (no colocados): su prensaestopas en el borde del gabinete.
 */
export function anclajeBorne(
	proyecto: Proyecto,
	dispositivoId: string,
	borneId: string,
): { x: number; y: number; z: number } | undefined {
	const d = proyecto.dispositivos.find((x) => x.id === dispositivoId);
	const col = proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === dispositivoId);
	if (!d) return undefined;
	// Aparato NO colocado en la placa (red/acometida o aparato de campo): su cable no puede
	// quedar en el aire («cable fantasma»). Entra por un PRENSAESTOPAS en el borde inferior
	// del gabinete, igual que en un tablero real, para que el cable tenga un recorrido visible.
	if (!col) return anclajeCampo(proyecto, d, borneId);
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
