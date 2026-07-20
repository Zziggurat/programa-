/**
 * Construcción de la escena 3D del gabinete a partir del modelo de TableroStudio.
 *
 * Convención de coordenadas: el modelo usa milímetros con Y hacia abajo sobre la placa;
 * en 3D la placa queda vertical en el plano XY (Y hacia arriba) y Z sale de la placa
 * hacia el frente. Todo se centra en el origen para orbitar cómodo.
 */
import * as THREE from 'three';
import { Colocacion, Dispositivo, Gabinete, Proyecto, TipoDispositivo } from '../src/modelo/tipos.js';
import { RutaConductor } from '../src/motores/ruteo.js';

export interface AparienciaTipo { color: number; fondo: number; profundidad: number }

export const APARIENCIA: Record<TipoDispositivo, AparienciaTipo> = {
	plc:           { color: 0x23272b, fondo: 0x16181b, profundidad: 62 },
	fuente:        { color: 0x9aa0a6, fondo: 0x7d838a, profundidad: 70 },
	transformador: { color: 0x86673f, fondo: 0x6b5232, profundidad: 82 },
	contactor:     { color: 0x3c4248, fondo: 0x2c3136, profundidad: 78 },
	rele:          { color: 0x4a545c, fondo: 0x353d44, profundidad: 66 },
	disyuntor:     { color: 0xe8e8e4, fondo: 0xcfcfca, profundidad: 74 },
	guardamotor:   { color: 0xd9d9d4, fondo: 0xbcbcb6, profundidad: 78 },
	diferencial:   { color: 0xe8e8e4, fondo: 0xcfcfca, profundidad: 74 },
	fusible:       { color: 0x5d666e, fondo: 0x49525a, profundidad: 58 },
	seccionador:   { color: 0xcf3b3b, fondo: 0xa72f2f, profundidad: 80 },
	variador:      { color: 0x2e3338, fondo: 0x1f2428, profundidad: 90 },
	motor:         { color: 0x2c5aa0, fondo: 0x234a85, profundidad: 90 },
	pulsador:      { color: 0x505a62, fondo: 0x3d474f, profundidad: 40 },
	selector:      { color: 0x505a62, fondo: 0x3d474f, profundidad: 40 },
	piloto:        { color: 0x505a62, fondo: 0x3d474f, profundidad: 40 },
	sensor:        { color: 0xb0b6bc, fondo: 0x969ca2, profundidad: 35 },
	valvula:       { color: 0x6b7b8c, fondo: 0x596876, profundidad: 45 },
	resistencia:   { color: 0x8c6d5a, fondo: 0x745a49, profundidad: 40 },
	condensador:   { color: 0x707a83, fondo: 0x5c666f, profundidad: 45 },
	bornero:       { color: 0xd97b29, fondo: 0xb96317, profundidad: 46 },
	cable:         { color: 0x444444, fondo: 0x333333, profundidad: 10 },
	otro:          { color: 0x777f87, fondo: 0x626a72, profundidad: 50 },
};

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

export interface Escenario {
	raiz: THREE.Group;
	dispositivos: THREE.Group;   // mallas con userData.dispositivoId
	cables: THREE.Group;
	tapas: THREE.Object3D[];     // tapas de canaletas (para ocultarlas)
	etiquetas: THREE.Object3D[]; // sprites de designación
	centro: THREE.Vector3;
	/** Convierte un punto del modelo (mm, Y abajo) a coordenadas de escena. */
	aEscena: (x: number, y: number, z: number) => THREE.Vector3;
}

const ALTO_RIEL = 35;
const Z_CABLE = 28; // profundidad a la que corren los cables dentro de la canaleta

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

	return { raiz, dispositivos, cables, tapas, etiquetas, centro: new THREE.Vector3(0, 0, 0), aEscena };
}

/* ------------------------------- Gabinete ------------------------------- */

function construirCaja(g: Gabinete): THREE.Group {
	const grupo = new THREE.Group();
	const margen = 30;     // holgura de la envolvente respecto de la placa
	const fondo = 160;     // profundidad de la envolvente
	const ancho = g.ancho + margen * 2;
	const alto = g.alto + margen * 2;
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

function construirRiel(
	riel: { x: number; y: number; largo: number },
	aEscena: Escenario['aEscena'],
): THREE.Group {
	const grupo = new THREE.Group();
	const material = new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 0.7, roughness: 0.35 });
	// Perfil sombrero simplificado: base + dos alas.
	const base = new THREE.Mesh(new THREE.BoxGeometry(riel.largo, ALTO_RIEL - 10, 5), material);
	base.position.z = 5;
	const ala = (dy: number) => {
		const a = new THREE.Mesh(new THREE.BoxGeometry(riel.largo, 6, 2), material);
		a.position.set(0, dy, 7.5);
		grupo.add(a);
	};
	grupo.add(base);
	ala((ALTO_RIEL - 10) / 2 + 2);
	ala(-(ALTO_RIEL - 10) / 2 - 2);
	const c = aEscena(riel.x + riel.largo / 2, riel.y, 0);
	grupo.position.set(c.x, c.y, 0);
	return grupo;
}

/**
 * Canaleta ranurada de PVC (ducto ranurado): base atornillada a la placa y dos paredes
 * formadas por "dientes" con ranuras intermedias, por donde cada cable sale hacia el
 * aparato justo en su punto de conexión. Tapa translúcida desmontable.
 */
function construirCanaleta(
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

export function construirDispositivo(
	d: Dispositivo,
	col: Colocacion,
	aEscena: Escenario['aEscena'],
	etiquetas: THREE.Object3D[],
): THREE.Group {
	const apariencia = APARIENCIA[d.tipo] ?? APARIENCIA.otro;
	const grupo = new THREE.Group();
	grupo.userData.dispositivoId = d.id;

	const cuerpo = new THREE.Mesh(
		new THREE.BoxGeometry(col.ancho, col.alto, apariencia.profundidad),
		new THREE.MeshStandardMaterial({ color: apariencia.color, roughness: 0.6 }),
	);
	cuerpo.position.z = apariencia.profundidad / 2;
	cuerpo.userData.dispositivoId = d.id;
	grupo.add(cuerpo);

	// Franja frontal (le da lectura de "aparato" en vez de caja).
	const frente = new THREE.Mesh(
		new THREE.BoxGeometry(col.ancho * 0.72, col.alto * 0.5, 2),
		new THREE.MeshStandardMaterial({ color: apariencia.fondo, roughness: 0.5 }),
	);
	frente.position.z = apariencia.profundidad + 1;
	frente.userData.dispositivoId = d.id;
	grupo.add(frente);

	// Bornes: pequeños conectores arriba y abajo del frente.
	const nBornes = Math.min(d.bornes.length, Math.max(2, Math.floor(col.ancho / 12)));
	const born = new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.5, roughness: 0.4 });
	for (let i = 0; i < nBornes; i++) {
		const bx = (i + 0.5) / nBornes * col.ancho - col.ancho / 2;
		for (const dy of [col.alto / 2 - 4, -col.alto / 2 + 4]) {
			const b = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 6), born);
			b.position.set(bx, dy, apariencia.profundidad - 3);
			b.userData.dispositivoId = d.id;
			grupo.add(b);
		}
	}

	// Etiqueta con la designación sobre el aparato.
	if (d.designacion) {
		const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura(d.designacion), depthTest: false }));
		sprite.scale.set(56, 21, 1);
		sprite.position.set(0, col.alto / 2 + 16, apariencia.profundidad);
		etiquetas.push(sprite);
		grupo.add(sprite);
	}

	const c = aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
	grupo.position.set(c.x, c.y, 0);
	return grupo;
}

/* --------------------------------- Cables --------------------------------- */

export function construirCables(
	proyecto: Proyecto,
	rutas: RutaConductor[],
	aEscena: Escenario['aEscena'],
): THREE.Group {
	const grupo = new THREE.Group();
	const separacion = new Map<string, number>(); // desfase por punto de entrada para no solapar tubos

	for (const ruta of rutas) {
		const conductor = proyecto.conductores.find((c) => c.id === ruta.conductorId);
		if (!conductor || ruta.camino.length < 2) continue;
		const color = COLOR_CABLE[conductor.color ?? ''] ?? 0x546e7a;
		const radio = 0.9 + (conductor.seccion ?? 1.5) * 0.35;

		// Desfase pequeño y estable por conductor para que los tubos no coincidan exactamente.
		const clave = `${ruta.camino[1].x},${ruta.camino[1].y}`;
		const n = separacion.get(clave) ?? 0;
		separacion.set(clave, n + 1);
		const desfase = (n % 5 - 2) * 2.4;

		const puntos: THREE.Vector3[] = [];
		const camino = ruta.camino;
		const ultimo = camino.length - 1;
		// Origen: frente del aparato → cae por una ranura de la pared dentada (punto de paso
		// sobre el borde) → recorre la canaleta a Z_CABLE → sube por otra ranura al destino.
		puntos.push(aEscena(camino[0].x, camino[0].y, 40));
		puntos.push(aEscena(camino[1].x, camino[1].y, 52));
		for (let i = 1; i < ultimo; i++) {
			puntos.push(aEscena(camino[i].x + desfase * 0.3, camino[i].y + desfase * 0.3, Z_CABLE + desfase));
		}
		puntos.push(aEscena(camino[ultimo - 1].x, camino[ultimo - 1].y, 52));
		puntos.push(aEscena(camino[ultimo].x, camino[ultimo].y, 40));

		const curva = new THREE.CatmullRomCurve3(puntos, false, 'catmullrom', 0.08);
		const tubo = new THREE.Mesh(
			new THREE.TubeGeometry(curva, Math.max(24, puntos.length * 8), radio, 6, false),
			new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
		);
		tubo.userData.conductorId = conductor.id;
		grupo.add(tubo);
	}
	return grupo;
}
