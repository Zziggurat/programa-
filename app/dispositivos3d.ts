/**
 * Modelos 3D detallados de los aparatos del tablero.
 *
 * Cada tipo se construye de forma procedimental (cajas, cilindros y materiales PBR)
 * con los rasgos que lo identifican en un tablero real: palanca y mirilla en los
 * disyuntores, tornillos de bornes, peines de conexión y LEDs en el PLC, aletas de
 * disipación en fuentes y variadores, núcleo y bobina en el transformador, bloques
 * individuales en los borneros, etc.
 */
import * as THREE from 'three';
import { Colocacion, Dispositivo } from '../src/modelo/tipos.js';

const M = {
	metal: (color = 0xb9bec2) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.35 }),
	plastico: (color: number, roughness = 0.55) => new THREE.MeshStandardMaterial({ color, roughness }),
	oscuro: () => new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.6 }),
};

function caja(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y, z);
	return m;
}

function cilindro(r: number, largo: number, mat: THREE.Material, x = 0, y = 0, z = 0, ejeZ = true): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, largo, 20), mat);
	if (ejeZ) m.rotation.x = Math.PI / 2;
	m.position.set(x, y, z);
	return m;
}

/** Fila de bornes con tornillo (cuerpo oscuro + tornillo metálico con ranura). */
function filaBornes(g: THREE.Group, n: number, ancho: number, y: number, z: number): void {
	const cuerpoMat = M.oscuro();
	const tornilloMat = M.metal(0xcfd4d8);
	const paso = ancho / n;
	for (let i = 0; i < n; i++) {
		const x = (i + 0.5) * paso - ancho / 2;
		g.add(caja(Math.min(paso - 2, 10), 9, 7, cuerpoMat, x, y, z));
		const t = cilindro(2.4, 2, tornilloMat, x, y, z + 4.2);
		g.add(t);
		g.add(caja(3.6, 0.8, 0.6, cuerpoMat, x, y, z + 5.2)); // ranura del tornillo
	}
}

/** Etiqueta frontal impresa (canvas) para referencias y marcas. */
function etiquetaImpresa(texto: string, w: number, h: number, fondo: string, tinta: string): THREE.Mesh {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = Math.max(32, Math.round((h / w) * 256));
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = fondo;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = tinta;
	ctx.font = `600 ${Math.round(canvas.height * 0.42)}px system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(texto, canvas.width / 2, canvas.height / 2);
	const tex = new THREE.CanvasTexture(canvas);
	tex.anisotropy = 4;
	const m = new THREE.Mesh(
		new THREE.PlaneGeometry(w, h),
		new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
	);
	return m;
}

/* --------------------------- Modelos por tipo --------------------------- */

function modular(g: THREE.Group, w: number, h: number, color: number, ref: string, polos: number): number {
	// Aparato modular DIN (disyuntor/diferencial): cuerpo, cara, palanca y mirilla.
	const prof = 74;
	const cuerpo = M.plastico(color);
	g.add(caja(w, h, prof - 6, cuerpo, 0, 0, (prof - 6) / 2));
	g.add(caja(w * 0.96, h * 0.55, 8, M.plastico(0xf4f4f0), 0, 0, prof - 2));
	// Palanca por polo (unidas), en gris oscuro.
	const palanca = M.plastico(0x33383c, 0.45);
	for (let i = 0; i < polos; i++) {
		const x = (i + 0.5) * (w / polos) - w / 2;
		g.add(caja(w / polos - 4, 7, 6, palanca, x, 6, prof + 2));
		g.add(caja(w / polos - 4, 16, 4, palanca, x, 12, prof - 1));
	}
	// Mirilla de estado (verde) y referencia impresa.
	g.add(caja(Math.min(10, w * 0.4), 3.5, 1, M.plastico(0x2e7d32, 0.35), 0, -6, prof + 2.2));
	const et = etiquetaImpresa(ref, Math.min(w * 0.9, 30), 6, '#f4f4f0', '#333');
	et.position.set(0, -h * 0.32, prof + 2.2);
	g.add(et);
	filaBornes(g, polos, w, h / 2 - 5, prof - 14);
	filaBornes(g, polos, w, -h / 2 + 5, prof - 14);
	return prof;
}

function contactor(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 84;
	g.add(caja(w, h, prof - 10, M.plastico(color), 0, 0, (prof - 10) / 2));
	g.add(caja(w * 0.9, h * 0.42, 12, M.plastico(0x22262a), 0, 2, prof - 4));
	// Ventana portaetiquetas y referencia.
	const et = etiquetaImpresa(ref, w * 0.72, 7, '#e8e8e4', '#222');
	et.position.set(0, 2, prof + 2.2);
	g.add(et);
	// Rejillas de ventilación laterales.
	const rejilla = M.plastico(0x191c1f);
	for (let i = 0; i < 4; i++) {
		g.add(caja(1.2, h * 0.5, prof * 0.5, rejilla, -w / 2 + 0.4, 0, prof * 0.35 + i * 0));
		g.add(caja(1.2, h * 0.5, prof * 0.5, rejilla, w / 2 - 0.4, 0, prof * 0.35));
		break;
	}
	filaBornes(g, 3, w, h / 2 - 5, prof - 16);
	filaBornes(g, 3, w, -h / 2 + 5, prof - 16);
	// Bornes de bobina A1/A2 en la esquina frontal superior.
	filaBornes(g, 2, w * 0.5, h / 2 - 14, prof - 6);
	return prof;
}

function plc(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 62;
	g.add(caja(w, h, prof - 4, M.plastico(color), 0, 0, (prof - 4) / 2));
	g.add(caja(w * 0.98, h * 0.5, 4, M.plastico(0x2c3136), 0, -2, prof - 1));
	// Peines de conexión verdes arriba y abajo (estilo autómata compacto).
	const verde = M.plastico(0x2e5d3a, 0.5);
	g.add(caja(w * 0.94, 10, 10, verde, 0, h / 2 - 6, prof - 8));
	g.add(caja(w * 0.94, 10, 10, verde, 0, -h / 2 + 6, prof - 8));
	filaBornes(g, Math.max(6, Math.floor(w / 11)), w * 0.9, h / 2 - 6, prof - 3);
	filaBornes(g, Math.max(4, Math.floor(w / 16)), w * 0.9, -h / 2 + 6, prof - 3);
	// Fila de LEDs de estado.
	for (let i = 0; i < 6; i++) {
		const led = new THREE.MeshStandardMaterial({
			color: 0x21d07a, emissive: 0x21d07a, emissiveIntensity: i < 4 ? 0.9 : 0.1, roughness: 0.3,
		});
		g.add(caja(2.6, 1.6, 1, led, -w * 0.32 + i * 6, h * 0.2, prof - 0.5));
	}
	const et = etiquetaImpresa(ref, w * 0.5, 8, '#23272b', '#dfe3e6');
	et.position.set(-w * 0.2, h * 0.06, prof + 0.2);
	g.add(et);
	// Pantalla pequeña.
	g.add(caja(w * 0.3, h * 0.24, 1.4, M.plastico(0x0d2b20, 0.3), w * 0.24, h * 0.12, prof - 0.4));
	return prof;
}

function fuente(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 100;
	g.add(caja(w, h, prof - 6, M.metal(color), 0, 0, (prof - 6) / 2));
	// Aletas de disipación laterales.
	const aleta = M.metal(0x9aa0a5);
	for (let i = 0; i < 6; i++) {
		const z = 14 + i * ((prof - 30) / 5);
		g.add(caja(2, h * 0.9, 2, aleta, -w / 2 + 1, 0, z));
		g.add(caja(2, h * 0.9, 2, aleta, w / 2 - 1, 0, z));
	}
	const et = etiquetaImpresa(ref, w * 0.8, 10, '#dfe3e6', '#222');
	et.position.set(0, h * 0.18, prof - 2.9);
	g.add(et);
	// LED DC OK.
	g.add(caja(3, 3, 1, new THREE.MeshStandardMaterial({ color: 0x21d07a, emissive: 0x21d07a, emissiveIntensity: 0.9 }), w * 0.25, -h * 0.1, prof - 2.5));
	filaBornes(g, 5, w * 0.9, -h / 2 + 5, prof - 14);
	return prof;
}

function transformador(g: THREE.Group, w: number, h: number): number {
	const prof = 85;
	// Núcleo laminado (paquete de chapas) + bobina de cobre encintada.
	const nucleo = M.metal(0x6f7377);
	g.add(caja(w, h * 0.85, prof * 0.5, nucleo, 0, 0, prof * 0.32));
	const bobina = M.plastico(0x8a5a2b, 0.5);
	g.add(caja(w * 0.55, h * 0.92, prof * 0.62, bobina, 0, 0, prof * 0.34));
	const cinta = M.plastico(0xc9a86a, 0.6);
	g.add(caja(w * 0.57, h * 0.3, prof * 0.64, cinta, 0, 0, prof * 0.34));
	// Patas de fijación.
	const pata = M.metal(0x8b9095);
	g.add(caja(w * 1.06, 6, 12, pata, 0, -h / 2 + 3, 6));
	g.add(caja(w * 1.06, 6, 12, pata, 0, h / 2 - 3, 6));
	filaBornes(g, 4, w * 0.8, -h / 2 + 9, prof * 0.62);
	return prof * 0.7;
}

function bornero(g: THREE.Group, d: Dispositivo, w: number, h: number): number {
	const prof = 48;
	const n = Math.max(2, d.bornes.length);
	const paso = w / n;
	for (let i = 0; i < n; i++) {
		const b = d.bornes[i];
		const esPE = b?.tipo === 'PE';
		const x = (i + 0.5) * paso - w / 2;
		// Bloque individual: gris (o verde/amarillo si es tierra).
		const cuerpo = esPE ? M.plastico(0x3f9142, 0.55) : M.plastico(0xaeb4b9, 0.6);
		g.add(caja(paso - 1.2, h, prof, cuerpo, x, 0, prof / 2));
		if (esPE) g.add(caja(paso - 1.2, h * 0.3, prof + 0.6, M.plastico(0xe4c437, 0.55), x, 0, prof / 2));
		// Tornillos superior e inferior.
		const tor = M.metal(0xcfd4d8);
		g.add(cilindro(2, 2, tor, x, h * 0.28, prof + 0.8));
		g.add(cilindro(2, 2, tor, x, -h * 0.28, prof + 0.8));
	}
	// Topes finales.
	const tope = M.plastico(0x5d666e, 0.6);
	g.add(caja(3, h + 2, prof + 2, tope, -w / 2 - 1.5, 0, prof / 2));
	g.add(caja(3, h + 2, prof + 2, tope, w / 2 + 1.5, 0, prof / 2));
	return prof;
}

function variador(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 120;
	g.add(caja(w, h, prof * 0.55, M.plastico(color), 0, 0, prof * 0.27));
	g.add(caja(w * 0.92, h * 0.9, prof * 0.4, M.plastico(0x33383d), 0, 0, prof * 0.72));
	// Radiador trasero.
	const aleta = M.metal(0x7d838a);
	for (let i = 0; i < 7; i++) {
		g.add(caja(w * 0.1, h * 0.9, 8, aleta, -w * 0.42 + i * (w * 0.14), 0, 5));
	}
	// Display y teclas.
	g.add(caja(w * 0.4, h * 0.14, 1.4, new THREE.MeshStandardMaterial({ color: 0x16a34a, emissive: 0x16a34a, emissiveIntensity: 0.55 }), 0, h * 0.28, prof - 0.4));
	const et = etiquetaImpresa(ref, w * 0.6, 8, '#26292c', '#c8cdd2');
	et.position.set(0, h * 0.1, prof - 0.2);
	g.add(et);
	const rueda = cilindro(w * 0.12, 2, M.plastico(0x0f766e, 0.4), 0, -h * 0.18, prof - 0.2);
	g.add(rueda);
	filaBornes(g, 5, w * 0.85, -h / 2 + 6, prof - 12);
	return prof;
}

function guardamotorModelo(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 90;
	g.add(caja(w, h, prof - 8, M.plastico(color), 0, 0, (prof - 8) / 2));
	// Mando giratorio al frente.
	g.add(cilindro(w * 0.26, 6, M.plastico(0x16181b, 0.45), 0, h * 0.12, prof));
	g.add(caja(4, w * 0.36, 7, M.plastico(0xd23b3b, 0.45), 0, h * 0.12, prof + 1));
	const et = etiquetaImpresa(ref, w * 0.7, 7, '#3d4348', '#d5dade');
	et.position.set(0, -h * 0.2, prof - 3.8);
	g.add(et);
	filaBornes(g, 3, w, h / 2 - 5, prof - 18);
	filaBornes(g, 3, w, -h / 2 + 5, prof - 18);
	return prof;
}

function releAux(g: THREE.Group, w: number, h: number, color: number): number {
	const prof = 70;
	// Zócalo + relé translúcido con clip metálico.
	g.add(caja(w, h * 0.4, 22, M.plastico(0x33383c), 0, -h * 0.3, 11));
	const cuerpoRele = new THREE.MeshStandardMaterial({
		color, roughness: 0.25, transparent: true, opacity: 0.85,
	});
	g.add(caja(w * 0.86, h * 0.62, prof - 26, cuerpoRele, 0, h * 0.12, 22 + (prof - 26) / 2));
	g.add(caja(w * 0.5, h * 0.4, prof - 32, M.plastico(0x8b6f3f, 0.5), 0, h * 0.1, 24 + (prof - 32) / 2)); // bobina visible
	const clip = M.metal(0xcfd4d8);
	g.add(caja(2, h * 0.7, prof - 20, clip, -w * 0.46, h * 0.08, 20 + (prof - 20) / 2));
	filaBornes(g, 4, w, -h / 2 + 5, 16);
	return prof;
}

function fusibleModelo(g: THREE.Group, w: number, h: number, color: number): number {
	const prof = 72;
	g.add(caja(w, h, prof * 0.6, M.plastico(color), 0, 0, prof * 0.3));
	// Palanca portafusible abatible.
	const palanca = M.plastico(0x2b3035, 0.45);
	const p = caja(w * 0.8, h * 0.5, 10, palanca, 0, h * 0.12, prof * 0.62);
	p.rotation.x = -0.35;
	g.add(p);
	g.add(caja(w * 0.5, 3, 1.2, new THREE.MeshStandardMaterial({ color: 0xd23b3b, emissive: 0x881111, emissiveIntensity: 0.3 }), 0, -h * 0.3, prof * 0.61));
	filaBornes(g, 1, w, h / 2 - 5, prof * 0.45);
	filaBornes(g, 1, w, -h / 2 + 5, prof * 0.45);
	return prof * 0.72;
}

function generico(g: THREE.Group, w: number, h: number, color: number): number {
	const prof = 55;
	g.add(caja(w, h, prof, M.plastico(color), 0, 0, prof / 2));
	filaBornes(g, Math.max(2, Math.floor(w / 14)), w * 0.9, -h / 2 + 5, prof - 8);
	return prof;
}

const COLOR_TIPO: Record<string, number> = {
	disyuntor: 0xe8e8e4, diferencial: 0xe8e8e4, guardamotor: 0x3d4348, fusible: 0x5d666e,
	contactor: 0x2f3437, rele: 0x3b6ea5, variador: 0x26292c, plc: 0x23272b,
	fuente: 0xb9bec2, transformador: 0x86673f, bornero: 0xaeb4b9, otro: 0x777f87,
};

/**
 * Panel de imagen de referencia: la foto sobre un plano fino, con un marcador por cada
 * pin (borne con u,v). Sirve para cablear cualquier imagen de forma visual (estilo EduVolt).
 */
function imagenReferencia(g: THREE.Group, d: Dispositivo, w: number, h: number): number {
	const prof = 6;
	// Marco/plano trasero.
	g.add(caja(w + 4, h + 4, 2, M.plastico(0x2a2f34, 0.8), 0, 0, 1));

	// La textura llega asíncrona; se refresca sola en el bucle de render.
	const tex = new THREE.Texture();
	const img = new Image();
	img.onload = () => { tex.image = img; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; };
	img.src = d.imagen!;
	const plano = new THREE.Mesh(
		new THREE.PlaneGeometry(w, h),
		new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
	);
	plano.position.z = prof - 1;
	plano.userData.esPlanoImagen = true; // para calcular u,v al añadir pines
	g.add(plano);

	// Pines: disco naranja con anillo, en la posición (u,v) de cada borne.
	for (const b of d.bornes) {
		if (b.u === undefined || b.v === undefined) continue;
		const x = (b.u - 0.5) * w;
		const y = (0.5 - b.v) * h;
		const disco = new THREE.Mesh(
			new THREE.CircleGeometry(Math.max(4, Math.min(w, h) * 0.02), 20),
			new THREE.MeshBasicMaterial({ color: 0xff8c1a, toneMapped: false }),
		);
		disco.position.set(x, y, prof + 0.5);
		disco.userData.pinBorneId = b.id;
		g.add(disco);
		const anillo = new THREE.Mesh(
			new THREE.RingGeometry(Math.max(4, Math.min(w, h) * 0.02), Math.max(6, Math.min(w, h) * 0.03), 20),
			new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
		);
		anillo.position.set(x, y, prof + 0.4);
		g.add(anillo);
	}
	return prof;
}

/** Construye el modelo 3D de un aparato ya colocado. Devuelve el grupo (origen en su centro). */
export function construirAparato3D(d: Dispositivo, col: Colocacion): { grupo: THREE.Group; profundidad: number } {
	const g = new THREE.Group();
	const w = col.ancho;
	const h = col.alto;
	const color = COLOR_TIPO[d.tipo] ?? COLOR_TIPO.otro;
	const ref = d.referencia ?? d.tipo;

	if (d.imagen) {
		const profundidad = imagenReferencia(g, d, w, h);
		g.traverse((o) => { o.userData.dispositivoId = d.id; });
		return { grupo: g, profundidad };
	}

	let profundidad: number;
	switch (d.tipo) {
		case 'disyuntor':
		case 'diferencial':
			profundidad = modular(g, w, h, color, ref, Math.max(1, Math.round(w / 18)));
			break;
		case 'guardamotor':
			profundidad = guardamotorModelo(g, w, h, color, ref);
			break;
		case 'contactor':
			profundidad = contactor(g, w, h, color, ref);
			break;
		case 'rele':
			profundidad = w <= 30 ? releAux(g, w, h, COLOR_TIPO.rele) : contactor(g, w, h, 0x4a545c, ref);
			break;
		case 'plc':
			profundidad = plc(g, w, h, color, ref);
			break;
		case 'fuente':
			profundidad = fuente(g, w, h, color, ref);
			break;
		case 'transformador':
			profundidad = transformador(g, w, h);
			break;
		case 'bornero':
			profundidad = bornero(g, d, w, h);
			break;
		case 'variador':
			profundidad = variador(g, w, h, color, ref);
			break;
		case 'fusible':
			profundidad = fusibleModelo(g, w, h, color);
			break;
		default:
			profundidad = generico(g, w, h, color);
	}

	g.traverse((o) => {
		o.userData.dispositivoId = d.id;
		if (o instanceof THREE.Mesh) {
			o.castShadow = true;
			o.receiveShadow = true;
		}
	});
	return { grupo: g, profundidad };
}
