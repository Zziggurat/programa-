/**
 * Construcción de la escena 3D del gabinete a partir del modelo de TableroStudio.
 *
 * Convención de coordenadas: el modelo usa milímetros con Y hacia abajo sobre la placa;
 * en 3D la placa queda vertical en el plano XY (Y hacia arriba) y Z sale de la placa
 * hacia el frente. Todo se centra en el origen para orbitar cómodo.
 */
import * as THREE from 'three';
import { Canaleta, Colocacion, Conductor, Dispositivo, Gabinete, Proyecto } from '../src/modelo/tipos.js';
import { cajaDeGabinete } from '../src/modelo/proyecto.js';
import { posicionesDeTerminales } from '../src/motores/terminales.js';
import {
	Banda, carrilesDe, corredoresLibres, mejorCorredor, orthogonalize, Punto, Punto3, tenderCable,
} from './geometria-cables.js';
import {
	Conflicto, conflictosDe, invasionesDe, RejillaCables, Solido, Trazo,
} from './colisiones-cables.js';
import {
	cruzDe, DIENTE, dientesDe, ejeDe, ESPESOR, huellaCanaleta, puntoDe, RANURA, RedCanaletas,
	TAPA, invasionesDeCanaletas, Tramo, ZOCALO,
} from './canaletas-red.js';
import { ALTURA_CARRIL, bornesGenericos, construirAparato3D, Z_BORNE } from './dispositivos3d.js';

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

/**
 * El color de un cable, MIRANDO SOLO LAS CLAVES PROPIAS de la tabla.
 *
 * `COLOR_CABLE[c.color]` a pelo tiene una trampa: el color del conductor es texto libre que viene
 * del archivo, y una tabla escrita como objeto literal hereda de `Object.prototype`. Con
 * `color: "constructor"` la búsqueda no devuelve `undefined` sino una FUNCIÓN, que se cuela por el
 * `?? 0x...` y acaba en `hexColor(fn)` → `fn.toString(16)`, o sea el código fuente de la función
 * metido en un `style="background:…"`.
 *
 * No llega a ser una inyección —lo que sale de ahí no lleva comillas y no se sale del atributo—
 * pero es una búsqueda sobre un dato de entrada que devuelve algo que no es un color, y ese es
 * justo el patrón que la auditoría persigue en TS3-P1-01 y TS3-P1-04. `Object.hasOwn` lo cierra en
 * una línea y sin depender de qué haya hoy en `Object.prototype`.
 */
export function colorDeCable(nombre: string | undefined, porDefecto = 0x546e7a): number {
	if (!nombre || !Object.hasOwn(COLOR_CABLE, nombre)) return porDefecto;
	return COLOR_CABLE[nombre];
}

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

/**
 * Libera la memoria de VÍDEO de un objeto y de todo lo que cuelga de él.
 *
 * three.js NO libera nada al quitar un objeto de la escena: la geometría, los materiales y
 * las texturas se quedan en la tarjeta gráfica hasta que se llama a `dispose()`. Como este
 * editor rehace trozos de la escena continuamente (cada aparato movido, cada cable, cada
 * cota), sin esto una sesión de trabajo va dejando copias enteras del tablero en memoria
 * hasta que el navegador se ahoga.
 *
 * Es seguro llamarlo sobre cualquier subárbol del escenario porque aquí ningún material ni
 * geometría se comparte entre objetos: todos se crean dentro de la función que los usa.
 */
export function liberar(raiz: THREE.Object3D | undefined): void {
	if (!raiz) return;
	raiz.traverse((o) => {
		const conGeometria = o as Partial<THREE.Mesh>;
		conGeometria.geometry?.dispose();
		const material = (o as Partial<THREE.Mesh>).material;
		for (const m of Array.isArray(material) ? material : material ? [material] : []) {
			// Las texturas cuelgan del material como propiedades (map, alphaMap…): hay que
			// soltarlas a mano, porque `Material.dispose()` no las toca.
			for (const valor of Object.values(m as unknown as Record<string, unknown>)) {
				if (valor && (valor as THREE.Texture).isTexture) (valor as THREE.Texture).dispose();
			}
			m.dispose();
		}
	});
}

/** Vacía un grupo liberando de verdad lo que había dentro (equivale a `.clear()` sin fuga). */
export function vaciar(grupo: THREE.Object3D): void {
	for (const hijo of [...grupo.children]) liberar(hijo);
	grupo.clear();
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

/**
 * Profundidades de una imagen de referencia. El riel sobresale 22 mm de la placa, así que una
 * imagen a ras (z = 0) queda TAPADA por él: por eso nace ya por delante, que es para lo que se
 * pone —para trabajar sobre ella—. «Al fondo» la manda detrás de toda la estructura.
 */
export const Z_IMAGEN_FRENTE = 26;
export const Z_IMAGEN_FONDO = -12;

export function construirEscenario(proyecto: Proyecto, realista = false): Escenario {
	const g = proyecto.gabinete;
	if (!g) throw new Error('El proyecto no tiene gabinete');

	const raiz = new THREE.Group();
	const aEscena = (x: number, y: number, z: number) =>
		new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z);

	raiz.add(construirCaja(g, realista));
	for (const riel of g.rieles) raiz.add(construirRiel(riel, aEscena));

	const tapas: THREE.Object3D[] = [];
	// La red se calcula UNA vez y la comparten todas: cada canaleta necesita saber quién la cruza
	// para abrirse ahí, y el router necesita la misma topología para poder pasar por esos cruces.
	const red = new RedCanaletas(g.canaletas);
	for (const can of g.canaletas) raiz.add(construirCanaleta(can, aEscena, tapas, realista, red));

	const dispositivos = new THREE.Group();
	const etiquetas: THREE.Object3D[] = [];
	for (const col of g.colocaciones) {
		const d = proyecto.dispositivos.find((x) => x.id === col.dispositivoId);
		if (!d) continue;
		dispositivos.add(construirDispositivo(d, col, aEscena, etiquetas));
	}
	/*
	 * Prensaestopas de entrada y el aparato de campo que cuelga de cada uno.
	 *
	 * Los CUERPOS van dentro de `dispositivos` y no sueltos en la raíz, y no es un detalle de
	 * orden: ahí es donde miran el ratón —para poder pinchar un pulsador de la puerta— y la
	 * animación de la simulación —para hacer girar el motor—. Fuera de ese grupo serían adorno.
	 */
	raiz.add(construirEntradasCampo(proyecto, aEscena, dispositivos));
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
			// Justo por delante del aparato pero POR DETRÁS del plano por el que corren los cables
			// (Z_FRENTE): si sobresaliera más, la esfera taparía al cable que pasa por encima del
			// terminal y le robaría el clic —era la causa de «a veces no puedo agarrar los cables»—.
			m.position.copy(aEscena(pos.x, pos.y, Math.min(pos.z + 4, Z_FRENTE - 5)));
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
	return cajaDeGabinete(g); // la medida la decide el modelo, no el dibujo
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
	/*
	 * CARRIL TS35 DE VERDAD: acero cincado con perfil de sombrero.
	 *
	 * Era un perfil dorado y plano —una losa de 5 mm con dos aletas pegadas encima— con
	 * `metalness: 0.7` y color latón. Un carril DIN no es de latón: es chapa de acero cincada,
	 * gris y algo mate. Y su forma es un sombrero: la base atornillada a la placa, dos almas que
	 * suben 7,5 mm y, arriba, los dos LABIOS vueltos hacia fuera, que son de lo que agarra la
	 * pinza del aparato. Sin esos labios no había nada de lo que engancharse, y de perfil el
	 * carril se leía como un listón.
	 */
	const material = new THREE.MeshStandardMaterial({ color: 0xb8bec3, metalness: 0.78, roughness: 0.42 });
	const esV = riel.orientacion === 'v';
	const CHAPA = 1.3;
	const anchoBase = ALTO_RIEL - 16;   // el alma queda 8 mm por dentro de cada labio
	const anchoLabio = 7;
	/** Una tira a lo largo del carril: `t` es su medida en el eje corto. */
	const tira = (t: number, grosor: number, desp: number, z: number): THREE.Mesh => {
		const m = new THREE.Mesh(
			esV ? new THREE.BoxGeometry(t, riel.largo, grosor) : new THREE.BoxGeometry(riel.largo, t, grosor),
			material,
		);
		m.position.set(esV ? desp : 0, esV ? 0 : desp, z);
		m.castShadow = true;
		m.receiveShadow = true;
		grupo.add(m);
		return m;
	};
	// Base contra la placa, con sus taladros alargados de fijación.
	tira(anchoBase, CHAPA, 0, CHAPA / 2);
	const taladros = Math.max(2, Math.floor(riel.largo / 55));
	for (let i = 0; i < taladros; i++) {
		const d = (i + 0.5) * (riel.largo / taladros) - riel.largo / 2;
		const t = new THREE.Mesh(
			new THREE.BoxGeometry(esV ? 6.5 : 14, esV ? 14 : 6.5, CHAPA + 0.6),
			new THREE.MeshStandardMaterial({ color: 0x8e959b, metalness: 0.6, roughness: 0.6 }),
		);
		t.position.set(esV ? 0 : d, esV ? d : 0, CHAPA / 2);
		grupo.add(t);
	}
	// Almas y labios: el sombrero.
	for (const signo of [1, -1]) {
		const alma = signo * (anchoBase / 2 - CHAPA / 2);
		tira(CHAPA, ALTURA_CARRIL - CHAPA, alma, (ALTURA_CARRIL + CHAPA) / 2);
		tira(anchoLabio, CHAPA, signo * (anchoBase / 2 + anchoLabio / 2 - CHAPA), ALTURA_CARRIL - CHAPA / 2);
	}
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
	can: Canaleta,
	aEscena: Escenario['aEscena'],
	tapas: THREE.Object3D[],
	realista = false,
	red?: RedCanaletas,
): THREE.Group {
	const grupo = new THREE.Group();
	const pvc = new THREE.MeshStandardMaterial({ color: 0xb0b6ba, roughness: 0.75 });
	// Trabajando, la tapa es translúcida para ver por dónde va el cableado. En Visualización el
	// tablero se ve como es de verdad: la tapa es PVC macizo y tapa lo que hay debajo.
	const pvcTapa = realista
		? new THREE.MeshStandardMaterial({ color: 0xc2c8cc, roughness: 0.7 })
		: new THREE.MeshStandardMaterial({
			color: 0xc2c8cc, roughness: 0.7, transparent: true, opacity: 0.4, depthWrite: false,
		});
	const esH = can.orientacion === 'h';
	const largoX = esH ? can.largo : can.ancho;
	const largoY = esH ? can.ancho : can.largo;
	const ejeCentro = (esH ? can.x : can.y) + can.largo / 2;

	/*
	 * LOS CRUCES SE ABREN DE VERDAD.
	 *
	 * Dos canaletas que se cruzaban tenían las paredes de cada una atravesando el interior de la
	 * otra: geometría superpuesta y, sobre todo, ningún paso. Un conductor no podía cambiar de la
	 * horizontal a la vertical sin atravesar plástico, así que las canaletas no eran una red: eran
	 * canales aislados. Un instalador, en ese cruce, CORTA la canaleta.
	 *
	 * Aquí se hace lo mismo: en el trozo donde otra canaleta cruza no se dibujan ni el zócalo ni
	 * los dientes. Solo ahí, y solo por cruces reales entre una horizontal y una vertical: no son
	 * agujeros de conveniencia, es la unión que existiría en el tablero montado.
	 *
	 * El fondo y la tapa los pone UNA sola de las dos —la que va antes en el proyecto—, porque dos
	 * placas en el mismo plano se pelean por el buffer de profundidad y el cruce parpadea.
	 */
	const cruces = red?.crucesDe(can.id) ?? [];
	const orden = red?.tramos.map((t) => t.id) ?? [];
	const enCruce = (a: number, medio: number): boolean =>
		cruces.some((c) => a + medio > c.desde && a - medio < c.hasta);
	const cede = (a: number, medio: number): boolean => cruces.some(
		(c) => a + medio > c.desde && a - medio < c.hasta && orden.indexOf(c.otro) < orden.indexOf(can.id),
	);

	/**
	 * Recorre el ducto en pasos cortos y llama a `poner` con cada tramo SEGUIDO en el que la
	 * respuesta a `saltar` es que no. Sirve igual para el fondo, la tapa y el zócalo: los tres son
	 * piezas continuas a las que hay que hacerles un hueco en los cruces.
	 */
	const porTrozos = (paso: number, saltar: (a: number, medio: number) => boolean,
		poner: (desde: number, largo: number) => void): void => {
		const n = Math.max(1, Math.round(can.largo / paso));
		let inicio: number | undefined;
		for (let i = 0; i <= n; i++) {
			const a = (esH ? can.x : can.y) + (can.largo * i) / n;
			const corta = i === n || saltar(a, paso / 2);
			if (!corta && inicio === undefined) inicio = a;
			if (corta && inicio !== undefined) {
				if (a - inicio > 0.5) poner(inicio, a - inicio);
				inicio = undefined;
			}
		}
	};

	const placa = (grosor: number, z: number, mat: THREE.Material, esTapa: boolean): void => {
		porTrozos(6, cede, (desde, largo) => {
			const caja = esH
				? new THREE.BoxGeometry(largo, largoY, grosor)
				: new THREE.BoxGeometry(largoX, largo, grosor);
			const m = new THREE.Mesh(caja, mat);
			const centro = desde + largo / 2 - ejeCentro;
			m.position.set(esH ? centro : 0, esH ? 0 : centro, z);
			grupo.add(m);
			if (esTapa) tapas.push(m);
		});
	};
	placa(ESPESOR, ESPESOR / 2, pvc, false);
	placa(TAPA, can.alto + TAPA / 2, pvcTapa, true);

	// Paredes: zócalo continuo y dientes, ambos interrumpidos en los cruces.
	const pared = (lado: -1 | 1): void => {
		const cajas: THREE.BoxGeometry[] = [];
		const t = ((esH ? largoY : largoX) / 2 - ESPESOR / 2) * lado;
		const poner = (g: THREE.BoxGeometry, a: number, z: number) => {
			if (esH) g.translate(a - ejeCentro, t, z); else g.translate(t, a - ejeCentro, z);
			cajas.push(g);
		};
		porTrozos(4, enCruce, (desde, largo) => {
			poner(
				esH ? new THREE.BoxGeometry(largo, ESPESOR, ZOCALO)
					: new THREE.BoxGeometry(ESPESOR, largo, ZOCALO),
				desde + largo / 2, ESPESOR + ZOCALO / 2,
			);
		});
		// Dientes: los mismos que conoce la red, y ninguno dentro de un cruce.
		const alturaDiente = can.alto - ESPESOR - ZOCALO;
		for (const centro of dientesDe(can)) {
			if (enCruce(centro, DIENTE / 2)) continue;
			poner(
				esH ? new THREE.BoxGeometry(DIENTE, ESPESOR, alturaDiente)
					: new THREE.BoxGeometry(ESPESOR, DIENTE, alturaDiente),
				centro, ESPESOR + ZOCALO + alturaDiente / 2,
			);
		}
		if (cajas.length) grupo.add(new THREE.Mesh(fusionarCajas(cajas), pvc));
	};
	pared(1);
	pared(-1);

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

	// col.z permite mandar una imagen de referencia al fondo (detrás del riel) o traerla al frente.
	const c = aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
	grupo.position.set(c.x, c.y, col.z ?? 0);
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
	/*
	 * EL AISLANTE ES PVC, NO TIZA.
	 *
	 * Con `roughness: 0.55` el tubo devolvía la luz repartida por toda su superficie, así que no
	 * cogía la RAYA de brillo que corre a lo largo de un cable y que es lo que dice que es
	 * redondo. Sin esa raya, cincuenta cables juntos se leen como cincuenta cintas de color. El
	 * PVC de un hilo de tablero es satinado tirando a brillante, y ahí sale la línea especular.
	 *
	 * Y se le da a cada conductor su punto de acabado a partir de su id: dos hilos nuevos y del
	 * mismo color siguen sin ser el mismo objeto, igual que en un tablero de verdad.
	 */
	const grano = ((conductorId.charCodeAt(0) + conductorId.length * 13) % 7) / 100;
	const tubo = new THREE.Mesh(
		// Doce lados en vez de siete: a la distancia a la que se mira un borne, un tubo de siete
		// caras se ve poligonal y delata que es un modelo.
		new THREE.TubeGeometry(curva, segmentos, radio, 12, false),
		new THREE.MeshStandardMaterial({ color, roughness: 0.32 + grano, metalness: 0.04 }),
	);
	tubo.userData.conductorId = conductorId;
	tubo.userData.tuboVisible = true; // el que se ve: manda al seleccionar con el ratón
	grupo.add(tubo);
	/*
	 * PUNTERAS EN LAS DOS PUNTAS.
	 *
	 * Un hilo de tablero no entra pelado en el borne: lleva su puntera engastada, y es de lo
	 * primero que se mira para saber si un cuadro está bien hecho. Son dos casquillos por cable
	 * —el cuello de plástico y el tubo metálico—, sin texto y sin textura, así que no cuestan
	 * memoria: es geometría y ya.
	 */
	const collarin = new THREE.MeshStandardMaterial({ color: 0xe9ebec, roughness: 0.5 });
	const metal = new THREE.MeshStandardMaterial({ color: 0xc3c8cc, metalness: 0.85, roughness: 0.4 });
	const largoCurva = curva.getLength();
	if (largoCurva > 40) {
		const eje = new THREE.Vector3(0, 1, 0);
		/*
		 * La puntera va SOBRE el hilo, medida en milímetros de recorrido desde la punta. Colocarla
		 * por parámetro de curva y luego correrla a lo largo de la tangente la sacaba del cable:
		 * el desplazamiento se aplicaba hacia FUERA del recorrido, así que el casquillo metálico
		 * acababa clavado dentro del aparato y torcido respecto del hilo del que cuelga.
		 *
		 *   3,5 mm  el tubo metálico engastado, el que entra en el tornillo
		 *   9,5 mm  el cuello de plástico, un poco más gordo, ya sobre el aislante
		 */
		for (const desdeLaPunta of [3.5, 9.5]) {
			const esCuello = desdeLaPunta > 6;
			const largo = esCuello ? 5.5 : 6;
			const r = radio + (esCuello ? 1.1 : 0.45);
			for (const extremo of [0, 1]) {
				const t = extremo === 0 ? desdeLaPunta / largoCurva : 1 - desdeLaPunta / largoCurva;
				const casquillo = new THREE.Mesh(
					new THREE.CylinderGeometry(r, r, largo, 10),
					esCuello ? collarin : metal,
				);
				casquillo.position.copy(curva.getPointAt(t));
				casquillo.quaternion.setFromUnitVectors(eje, curva.getTangentAt(t).normalize());
				casquillo.userData.conductorId = conductorId;
				grupo.add(casquillo);
			}
		}
	}
	// Tubo de agarre invisible (más grueso) para poder pinchar el cable con facilidad aunque se
	// esté viendo el tablero alejado. Solo se usa si el puntero NO está sobre un cable visible.
	const agarre = new THREE.Mesh(
		new THREE.TubeGeometry(curva, segmentos, Math.max(radio + 7, 9), 6, false),
		new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
	);
	agarre.userData.conductorId = conductorId;
	agarre.userData.tuboAgarre = true;
	grupo.add(agarre);
}

/** Punto físico exacto del que sale un cable (mm de modelo, Y abajo; z = profundidad). */
export interface Anclaje { x: number; y: number; z: number }

/** Recorrido de un cable ya resuelto: sus anclajes y la polilínea ortogonal que sigue. */
export interface RutaCable {
	conductorId: string;
	de: Anclaje;
	a: Anclaje;
	/** Nodos del recorrido en coordenadas de modelo, ya ortogonalizados. */
	nodos: { x: number; y: number }[];
	/** Profundidad a la que corre este cable. Ver `CAPAS_CABLE`. */
	z: number;
	/**
	 * EL RECORRIDO 3D FINAL, tal cual se va a dibujar.
	 *
	 * Va DENTRO de la ruta y no se recalcula fuera, y esa es toda la gracia. Dejar que cada quien
	 * lo reconstruya a partir de los nodos es exactamente como se coló el fallo que esta iteración
	 * viene a quitar: el repartidor pasaba a `recorrido3D` el suelo que imponen las canaletas y el
	 * dibujo, que llamaba a la misma función sin ese argumento, pintaba otra cosa. Se validaba una
	 * geometría y se veía otra. Yendo dentro de la ruta, no hay dos.
	 */
	puntos: Punto3[];
	/** El radio del tubo: hace falta para medir choques y para dibujarlo. */
	radio: number;
}

/**
 * CAPAS DE CABLEADO. En un tablero de verdad los cables no viven todos en el mismo plano: el
 * mazo se va montando y unos pasan por delante de otros. Aquí, con todos a la misma cota, dos
 * cables que se cruzaban se ATRAVESABAN —se veía el tubo de uno saliendo por dentro del otro—.
 * Repartiéndolos en unas pocas capas de 3 mm, los cruces se apilan como en un mazo real y cada
 * cable se sigue con la vista sin perderlo.
 *
 * Son pocas y muy juntas a propósito: el agarre con el ratón proyecta sobre el plano de
 * referencia, y una separación grande descuadraría el clic respecto de lo que se ve.
 */
/*
 * CUÁNTAS PROFUNDIDADES DISTINTAS HAY PARA TENDER, Y CUÁNTO SE SEPARAN.
 *
 * Eran 4 capas a 3 mm. Con un tablero de 52 conductores eso obliga al repartidor a meter trece
 * cables en cada plano, y 3 mm de separación con tubos de hasta 1,9 mm de radio deja los de capas
 * vecinas prácticamente tocándose. De frente colaba; de lado el tablero era una lámina de cables
 * coplanares, que es exactamente lo que se ve al girar la cámara.
 *
 * Con nueve capas a 3,6 mm el repartidor tiene sitio de verdad para separar, y el bloque de
 * cableado ocupa 29 mm de fondo: sigue por delante de la placa y por detrás de la cara de los
 * aparatos altos (el guardamotor saca 90 mm), así que no atraviesa nada ni se pega a la puerta.
 */
const CAPAS_CABLE = 9;
const SEPARACION_CAPAS = 3.6;

/**
 * Cuánto tarda un cable en pasar de la profundidad de su borne a la de su carril, en mm de
 * recorrido. Es lo que convierte el cable en un objeto tendido en el espacio en vez de una cinta
 * plana: sale del terminal a la profundidad del terminal, se va al frente para viajar, y vuelve a
 * hundirse al llegar. Sin esto, la Z era constante de punta a punta y el cable no bajaba nunca a
 * buscar su borne.
 */
/*
 * Las ranuras van de 10 mm —donde acaba el zócalo continuo— hasta la altura de la canaleta, y los
 * bornes están a 46. Por eso un cable puede salir del tornillo y entrar en el ducto A SU MISMA
 * PROFUNDIDAD, sin rodeos: cruza la boca de la ranura a 46 y solo entonces baja a su carril.
 */
/** Base de las capas para el cable que NO entra en canaleta y cruza por delante del tablero. */
const Z_EXPUESTO = 66;

/**
 * Resuelve el recorrido de TODOS los cables: única fuente de verdad que usan tanto el dibujo
 * 3D como las comprobaciones de calidad (que no se amontonen ni pasen sobre los aparatos).
 * Con puntos de quiebre a mano pasa por ellos; sin puntos, se rutea por un CORREDOR LIBRE
 * (franja sin aparatos) tomando un carril propio.
 */
/** Separación (mm) entre las puntas de dos cables que comparten el mismo borne. */
/**
 * Abanico de salida en los bornes compartidos.
 *
 * Varios cables pueden llegar al MISMO borne (una bobina, un puente, un bornero…). Si todos
 * salieran exactamente del mismo punto se verían FUSIONADOS en uno solo, que es irreal: en un
 * tablero de verdad se abren en abanico junto al terminal. Esta función devuelve el desvío
 * lateral (mm) que le toca a cada punta de cable; 0 si el borne no lo comparte con nadie.
 *
 * La usan por igual el dibujo 3D y la interacción del ratón, para que el cable que se ve y el
 * cable con el que se trabaja sean exactamente el mismo (si no, la selección queda descalibrada).
 */
export function abanicoDeSalida(proyecto: Proyecto): (dispositivoId: string, borneId: string, conductorId: string) => number {
	/*
	 * EL ABANICO SE RESUELVE PARA TODA UNA FILA DE BORNES A LA VEZ, NO CUBO A CUBO.
	 *
	 * La versión anterior metía cada punta de cable en un cubo de 5 mm (`round(x / 5)`) y dentro de
	 * cada cubo abría los cables ±6 mm desde su centro. Suena razonable y tiene un fallo que produce
	 * exactamente las «fusiones» que se ven: los cubos son de 5 mm y el abanico abre 6, así que DOS
	 * CUBOS VECINOS SE PISAN. Medido sobre el estrella-triángulo, el borne `q1:6` (x = 125) y el
	 * `q1:2` (x = 107) acababan los dos en x = 122,0 exacto; los de `km3:6/T3` y `km3:2/T1`, los dos
	 * en 289,5. Sus bajadas no es que quedaran cerca: eran la MISMA recta, con los dos tubos en el
	 * mismo volumen en toda su longitud. De ahí salían las holguras de −6,00 mm, que es justo el
	 * diámetro sumado de los dos cables.
	 *
	 * Ahora el reparto es global dentro de cada fila y con una regla física: ordenadas las puntas
	 * por su x, dos consecutivas quedan separadas al menos lo que suman sus radios más aire. Se
	 * resuelve exacto —con el desplazamiento total mínimo— por regresión isotónica: se resta a cada
	 * punta la separación acumulada que le toca, se fuerza que la serie no decrezca fundiendo
	 * bloques vecinos por su media, y se vuelve a sumar. El que no tiene vecinos cerca no se mueve;
	 * los que se pisan se abren lo justo y repartido. Y como el resultado es monótono en el orden de
	 * partida, dos salidas nunca se CRUZAN al abrirse, que era el otro riesgo.
	 */
	const puntas: { clave: string; x: number; y: number; radio: number }[] = [];
	for (const c of proyecto.conductores) {
		const radio = radioDeCable(c.seccion);
		for (const extremo of [c.de, c.a]) {
			const a = anclajeBorne(proyecto, extremo.dispositivoId, extremo.borneId);
			if (!a) continue;
			puntas.push({ clave: `${extremo.dispositivoId}|${extremo.borneId}|${c.id}`, x: a.x, y: a.y, radio });
		}
	}
	/*
	 * Fila a fila, no de una vez para todo el tablero. Es un matiz que cuesta caro equivocar: el
	 * problema que resuelve el abanico es el de la HILERA de tornillos —dos bornes vecinos del
	 * mismo aparato, o de dos aparatos pegados en el mismo riel— cuyas salidas se pisan al abrirse.
	 * Dos bornes a la misma x pero separados medio tablero no se estorban ahí, y forzarlos a
	 * apartarse tira de los dos hilos lejos de su tornillo sin ganar nada (probado: empeoraba). Lo
	 * que sí puede pasar entre filas distintas —que sus bajadas se crucen— lo arregla el repartidor
	 * corriendo una de las dos bajadas, que para eso tiene ese grado de libertad.
	 */
	const desvio = new Map<string, number>();
	const filas = new Map<number, typeof puntas>();
	for (const q of puntas) {
		const fila = Math.round(q.y / 12);
		const l = filas.get(fila);
		if (l) l.push(q); else filas.set(fila, [q]);
	}
	for (const fila of filas.values()) {
		// Orden estable: por x y, a igualdad, por clave. Es lo que hace el reparto DETERMINISTA.
		fila.sort((a, b) => a.x - b.x || (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
		const acumulado: number[] = [];
		let suma = 0;
		for (let i = 0; i < fila.length; i++) {
			// Lo que pide la física —los dos radios más aire— y nunca menos de 4,2 mm: por debajo de
			// eso dos puntas se leen como una sola aunque el hilo sea fino y los números cuadren.
			if (i > 0) suma += Math.max(4.2, fila[i - 1].radio + fila[i].radio + HOLGURA_CABLE);
			acumulado.push(suma);
		}
		const bloques: { media: number; n: number }[] = [];
		for (let i = 0; i < fila.length; i++) {
			let media = fila[i].x - acumulado[i];
			let n = 1;
			while (bloques.length && bloques[bloques.length - 1].media > media) {
				const previo = bloques.pop()!;
				media = (media * n + previo.media * previo.n) / (n + previo.n);
				n += previo.n;
			}
			bloques.push({ media, n });
		}
		let i = 0;
		for (const b of bloques) {
			for (let k = 0; k < b.n; k++, i++) desvio.set(fila[i].clave, b.media + acumulado[i] - fila[i].x);
		}
	}
	return (dispositivoId, borneId, conductorId) => desvio.get(`${dispositivoId}|${borneId}|${conductorId}`) ?? 0;
}

/** Puntas de un cable: el borne real y el punto al que se abre para no fundirse con sus vecinos. */
export function salidasDeCable(
	proyecto: Proyecto,
	conductor: Conductor,
	abanico = abanicoDeSalida(proyecto),
): { de: Anclaje; a: Anclaje; salidaA: { x: number; y: number }; salidaB: { x: number; y: number } } | undefined {
	const a = anclajeBorne(proyecto, conductor.de.dispositivoId, conductor.de.borneId);
	const b = anclajeBorne(proyecto, conductor.a.dispositivoId, conductor.a.borneId);
	if (!a || !b) return undefined; // solo si falta el aparato entero (se limpia al eliminarlo)
	return {
		de: a,
		a: b,
		salidaA: { x: a.x + abanico(conductor.de.dispositivoId, conductor.de.borneId, conductor.id), y: a.y },
		salidaB: { x: b.x + abanico(conductor.a.dispositivoId, conductor.a.borneId, conductor.id), y: b.y },
	};
}

/**
 * Largo real (mm) de un conductor tal como está DIBUJADO en la placa, por su recorrido ortogonal
 * (Manhattan, que es como corren los cables de verdad).
 *
 * Es el metraje que se va a cortar en el taller, y por tanto el bueno para la caída de tensión y
 * para el total de cable que enseña el panel. Vive aquí y no en los motores porque la geometría
 * del trazado es de la vista: depende de dónde quedó cada aparato, de por dónde abre el cable
 * para no fundirse con sus vecinos y de los puntos de quiebre que haya movido quien dibuja.
 */
export function largoDibujadoMm(
	proyecto: Proyecto,
	conductor: Conductor,
	abanico = abanicoDeSalida(proyecto),
): number {
	const p = salidasDeCable(proyecto, conductor, abanico);
	if (!p) return 0;
	const orto = orthogonalize([p.salidaA, ...(conductor.trazado ?? []), p.salidaB]);
	let largo = 0;
	for (let i = 0; i < orto.length - 1; i++) {
		largo += Math.abs(orto[i].x - orto[i + 1].x) + Math.abs(orto[i].y - orto[i + 1].y);
	}
	return largo;
}

/**
 * Lo mismo para todo el tablero, por id de conductor. Lo usan la pantalla y el PDF, y que lo usen
 * los DOS es el asunto: cada uno tenía su propia cuenta y salían caídas de tensión distintas para
 * el mismo tablero. El abanico se calcula UNA vez para todos, que es lo caro.
 */
export function longitudesDibujadasMm(proyecto: Proyecto): Map<string, number> {
	const abanico = abanicoDeSalida(proyecto);
	return new Map(proyecto.conductores.map((c) => [c.id, largoDibujadoMm(proyecto, c, abanico)]));
}

/** Radio del tubo de un conductor. Lo comparten el dibujo, el reparto y las pruebas. */
export function radioDeCable(seccion?: number): number {
	return 0.9 + (seccion ?? 1.5) * 0.35;
}

/** Radio mínimo de curvatura del codo: cuanto más grueso el cable, más abierto dobla. */
export function radioCodo(radio: number): number {
	return 10 + radio * 4;
}

/**
 * Aire que se quiere dejar ENTRE SUPERFICIES de dos cables que no tienen por qué tocarse.
 *
 * No es `distancia > 0`: dos tubos que se rozan exactamente se ven fundidos, porque a la distancia
 * a la que se mira un tablero medio milímetro de separación no se distingue de cero.
 */
export const HOLGURA_CABLE = 1.2;

/** Cuánto se puede correr una bajada a un lado para buscarle sitio, y en cuántos pasos. */
const PASO_LATERAL = 5;
const PASOS_LATERALES = [0, 1, -1];
/** Cuántas ranuras vecinas se prueban a cada lado antes de rendirse con una entrada. */


/**
 * EL ÚLTIMO REPARTO, GUARDADO.
 *
 * `rutasDeCables` la llaman el dibujo, el diagnóstico y —esto es lo que obliga— la interacción del
 * ratón, que la consulta cada vez que se señala un cable. Resolver el reparto de un tablero de
 * cincuenta conductores cuesta unas décimas de segundo; hacerlo en cada movimiento del ratón se
 * nota en la mano. Se guarda el resultado con una firma de lo único que puede cambiarlo.
 */
let ultimoReparto: { firma: string; rutas: RutaCable[] } | undefined;

function firmaDelRuteo(proyecto: Proyecto): string {
	const g = proyecto.gabinete;
	return JSON.stringify([
		proyecto.conductores.map((c) => [c.id, c.de, c.a, c.seccion, c.trazado]),
		g?.colocaciones.map((c) => [c.dispositivoId, c.x, c.y, c.ancho, c.alto, c.z]),
		g?.canaletas.map((c) => [c.id, c.x, c.y, c.largo, c.orientacion, c.ancho, c.alto]),
		g?.rieles.map((r) => [r.x, r.y, r.largo, r.orientacion]),
		[g?.ancho, g?.alto],
	]);
}

export function rutasDeCables(proyecto: Proyecto): RutaCable[] {
	const firma = firmaDelRuteo(proyecto);
	if (ultimoReparto?.firma === firma) return ultimoReparto.rutas;
	const rutas = repartirCables(proyecto);
	ultimoReparto = { firma, rutas };
	return rutas;
}

/** Un camino candidato: los puntos por los que pasaría el cable y cuánto va expuesto. */
interface Candidato {
	nodos: Punto3[];
	/** Milímetros que viajan por FUERA de una canaleta. Es lo que produce la «cortina». */
	expuesto: number;
	/** Por cuántas canaletas pasa: sirve para preferir lo simple a igualdad de lo demás. */
	ductos: number;
	/** Qué recursos de la red ocupa, para poder apuntarlos cuando el camino se acepta. */
	reserva: Reserva[];
}

/** Un trozo de canaleta que un cable ocupa: qué tramo, qué sitio interior y por dónde entra. */
interface Reserva {
	tramo: string;
	/** Índice del sitio en la rejilla interior del tramo. */
	sitio: number;
	desde: number;
	hasta: number;
	accesos: { ranura: number; z: number; ancho: number }[];
}

/**
 * LOS SITIOS QUE DE VERDAD HAY DENTRO DE UN DUCTO.
 *
 * Antes se ofrecían seis: tres carriles a lo ancho por dos profundidades, escritos a mano. Un
 * ducto de 40 × 60 tiene 36 × 58 mm de interior útil; con cables de 6 mm² —el más gordo de la
 * biblioteca, 6 mm de diámetro— ahí caben quince tiradas sin tocarse, no seis. Los seis sitios
 * eran el cuello de botella real del estrella-triángulo: cincuenta y dos conductores peleándose
 * por seis posiciones acaban metidos unos dentro de otros por mucho que se busque.
 *
 * La rejilla sale de la geometría del tramo, no de constantes: un ducto más ancho ofrece más
 * carriles y uno más bajo, menos profundidades. Se ordena de abajo arriba y del centro hacia
 * fuera, que es como se llena un ducto de verdad.
 */
interface Sitio { cruz: number; z: number; }

/** Separación entre ejes de dos cables dentro del ducto. */
const PASO_INTERIOR = 8.5;
/** Aire que se le pide a una ranura por encima del diámetro del cable que va a pasar. */
const AIRE_RANURA = 0.8;
/** Separación entre carriles paralelos de aproximación a un ducto. */
const SEPARACION_APROXIMACION = 8;

const SITIOS = new Map<string, Sitio[]>();

function sitiosDe(t: Tramo): Sitio[] {
	const clave = `${t.id}|${t.centro}|${t.semiancho}|${t.zMin}|${t.zMax}`;
	const ya = SITIOS.get(clave);
	if (ya) return ya;
	const semi = t.semiancho - 3;
	// El zócalo es macizo: por debajo de él no se puede circular aunque quede hueco en el dibujo.
	const z0 = Math.max(t.zMin + 3, ZOCALO + 4);
	const z1 = t.zMax - 3;
	const nCruz = Math.max(1, Math.floor((semi * 2) / PASO_INTERIOR) + 1);
	const nZ = Math.max(1, Math.floor((z1 - z0) / PASO_INTERIOR) + 1);
	const sitios: Sitio[] = [];
	for (let j = 0; j < nZ; j++) {
		for (let i = 0; i < nCruz; i++) {
			sitios.push({
				cruz: t.centro + (nCruz === 1 ? 0 : -semi + (i * semi * 2) / (nCruz - 1)),
				z: z0 + (nZ === 1 ? 0 : (j * (z1 - z0)) / (nZ - 1)),
			});
		}
	}
	sitios.sort((a, b) => a.z - b.z || Math.abs(a.cruz - t.centro) - Math.abs(b.cruz - t.centro) || a.cruz - b.cruz);
	SITIOS.set(clave, sitios);
	return sitios;
}

/** Por dónde entra un cable a un ducto: qué ranura y a qué altura dentro de ella. */
interface Acceso { ranura: number; z: number; }

/**
 * Las alturas a las que se puede entrar por una ranura. La ranura no es un agujero: es una
 * ventana de cincuenta milímetros de alto entre dos dientes, así que por la misma ranura pueden
 * pasar dos cables uno encima de otro sin rozarse. Contarlo dobla la capacidad de acceso sin
 * tocar la geometría.
 */
const BANDAS = new Map<string, number[]>();
function bandasDe(t: Tramo): number[] {
	const clave = `${t.zMax}`;
	const ya = BANDAS.get(clave);
	if (ya) return ya;
	const bandas: number[] = [];
	for (let z = t.zMax - 14; z >= ZOCALO + 6; z -= 13) bandas.push(z);
	if (!bandas.length) bandas.push(t.zMax - 14);
	BANDAS.set(clave, bandas);
	return bandas;
}

/**
 * EL MAPA DE OCUPACIÓN DE LA RED.
 *
 * Es la pieza que convierte el reparto de fuerza bruta en asignación incremental. Antes se
 * generaban todas las combinaciones de ranura × carril × profundidad × camino —medidas: 355
 * candidatos por cable, 18.504 en el estrella-triángulo— y se construía la geometría completa de
 * cada una para medirla contra todo lo tendido. Generarlas costaba 21 ms; medirlas, un segundo y
 * medio, y con las dos pasadas se iba a seis segundos.
 *
 * Con el mapa, el router no PRUEBA sitios: los ELIGE. Pregunta qué carril está más libre en el
 * trozo que va a recorrer y por qué ranura le queda hueco, construye una geometría —no
 * trescientas— y solo si esa choca amplía la búsqueda.
 *
 * La ocupación de una ranura se lleva en MILÍMETROS DE ANCHO, no en número de cables: por una
 * ranura de 6 mm pasan dos hilos de mando o uno de 6 mm², y eso es una diferencia física, no una
 * preferencia. Un acceso que no da la anchura no se ofrece: el cable buscará otra ranura, otra
 * altura o, si de verdad no hay, saldrá por delante.
 */
class Ocupacion {
	/** Por tramo y sitio interior: los trozos de eje ya ocupados. */
	private readonly carriles = new Map<string, { desde: number; hasta: number }[]>();
	/** Por tramo, ranura y banda: milímetros de ancho ya comprometidos. */
	private readonly accesos = new Map<string, number>();

	private clave(tramo: string, sitio: number): string { return `${tramo}|${sitio}`; }
	/*
	 * La ocupación de una ranura NO distingue alturas, y esa fue una lección medida. La idea de
	 * contar la ranura como una ventana alta —dos cables por ella, uno encima de otro— es cierta
	 * DENTRO del ducto, pero para llegar hasta ahí los dos vienen del borne a la misma altura y
	 * cruzan la boca por el mismo sitio. Contando alturas, dos conductores de 6 mm² compartían
	 * ranura «legalmente» y acababan uno DENTRO del otro, a −6,00 mm, justo delante de ella: tres
	 * pares fundidos en el estrella-triángulo. El cuello de botella es la boca, así que la boca es
	 * lo que se reserva.
	 */
	private claveAcceso(tramo: string, ranura: number): string {
		return `${tramo}|${Math.round(ranura)}`;
	}

	apuntar(reservas: Reserva[]): void {
		for (const r of reservas) {
			const l = this.carriles.get(this.clave(r.tramo, r.sitio)) ?? [];
			l.push({ desde: Math.min(r.desde, r.hasta), hasta: Math.max(r.desde, r.hasta) });
			this.carriles.set(this.clave(r.tramo, r.sitio), l);
			for (const a of r.accesos) {
				const k = this.claveAcceso(r.tramo, a.ranura);
				this.accesos.set(k, (this.accesos.get(k) ?? 0) + a.ancho);
			}
		}
	}

	/** Devolver el sitio al mapa, para que la pasada de reparación pueda volver a elegir. */
	quitar(reservas: Reserva[]): void {
		for (const r of reservas) {
			const l = this.carriles.get(this.clave(r.tramo, r.sitio));
			const desde = Math.min(r.desde, r.hasta);
			const hasta = Math.max(r.desde, r.hasta);
			const i = l?.findIndex((q) => q.desde === desde && q.hasta === hasta) ?? -1;
			if (l && i >= 0) l.splice(i, 1);
			for (const a of r.accesos) {
				const k = this.claveAcceso(r.tramo, a.ranura);
				this.accesos.set(k, Math.max(0, (this.accesos.get(k) ?? 0) - a.ancho));
			}
		}
	}

	/** Milímetros que un trozo compartiría con lo ya tendido en ese sitio. */
	solape(tramo: string, sitio: number, desde: number, hasta: number): number {
		const a = Math.min(desde, hasta);
		const b = Math.max(desde, hasta);
		let total = 0;
		for (const r of this.carriles.get(this.clave(tramo, sitio)) ?? []) {
			total += Math.max(0, Math.min(b, r.hasta) - Math.max(a, r.desde));
		}
		return total;
	}

	/**
	 * Los sitios interiores de un tramo ordenados por lo libres que están en ese trozo. Es la
	 * pregunta que sustituye a «genera los quince y mídelos»: aquí se contesta con aritmética
	 * sobre intervalos, sin construir un solo punto.
	 */
	mejoresSitios(t: Tramo, desde: number, hasta: number, radio: number, n: number): { sitio: number; cruz: number; z: number }[] {
		const rejilla = sitiosDe(t);
		const cabe: { sitio: number; cruz: number; z: number; coste: number }[] = [];
		for (let i = 0; i < rejilla.length; i++) {
			const s = rejilla[i];
			if (Math.abs(s.cruz - t.centro) > t.semiancho - radio - 0.5) continue;
			if (s.z - radio < t.zMin + 0.5 || s.z + radio > t.zMax - 0.5) continue;
			cabe.push({ sitio: i, cruz: s.cruz, z: s.z, coste: this.solape(t.id, i, desde, hasta) });
		}
		cabe.sort((a, b) => a.coste - b.coste || a.sitio - b.sitio);
		return cabe.slice(0, n);
	}

	/**
	 * EL CARRIL DE APROXIMACIÓN, que es donde se juntaban los cables sin que nadie lo mirara.
	 *
	 * Para entrar por una ranura que no le queda enfrente, el cable sale a una línea paralela al
	 * ducto y se desliza por ella hasta ponerse en el eje de la ranura. Esa línea salía siempre a
	 * la misma distancia del ducto, así que todos los cables de la misma fila se deslizaban por la
	 * MISMA recta y los que compartían un trozo de camino quedaban uno dentro de otro. La zona de
	 * convergencia también es un recurso, así que se reparte como los demás.
	 */
	mejorAproximacion(tramo: string, lado: number, desde: number, hasta: number): number {
		let mejor = 0;
		let coste = Infinity;
		for (let k = 0; k < 4; k++) {
			const c = this.solape(`${tramo}|ap${lado}`, k, desde, hasta) + k * 0.5;
			if (c < coste) { coste = c; mejor = k; }
		}
		return mejor;
	}

	/** Los `n` accesos mejores cerca de `coord`: los que dan la anchura, el más cercano primero. */
	mejoresAccesos(t: Tramo, coord: number, radio: number, n: number): Acceso[] {
		const libres: { ranura: number; z: number; coste: number }[] = [];
		for (const ranura of t.ranuras) {
			for (const z of bandasDe(t)) {
				if (z - radio < ZOCALO + 1 || z + radio > t.zMax - 1) continue;
				const usado = this.accesos.get(this.claveAcceso(t.id, ranura)) ?? 0;
				/*
				 * Un cable de 6 mm² mide justo 6 mm y la ranura mide justo 6: entra, y en la obra
				 * se mete empujando. Pedirle además un aire de holgura dejaba a los 31 conductores
				 * de potencia del estrella-triángulo SIN NINGUNA ranura válida en todo el tablero,
				 * así que ninguno podía entrar en canaleta por mucho sitio que hubiera dentro. El
				 * aire solo hace falta ENTRE dos cables que comparten la misma ranura.
				 */
				const pide = radio * 2 + (usado > 0 ? AIRE_RANURA : 0);
				if (usado + pide > RANURA + 1e-9) continue;
				libres.push({ ranura, z, coste: Math.abs(ranura - coord) + usado * 0.5 });
			}
		}
		libres.sort((a, b) => a.coste - b.coste || a.ranura - b.ranura || b.z - a.z);
		return libres.slice(0, n).map((l) => ({ ranura: l.ranura, z: l.z }));
	}
}

/**
 * LA APROXIMACIÓN A UNA RANURA, que es donde estaba el plástico atravesado.
 *
 * Una ranura mide 6 mm de ancho y un cable de 6 mm² mide 6 mm de diámetro: entra justo, y solo si
 * entra RECTO. El generador anterior giraba hacia la ranura demasiado cerca del ducto, así que el
 * codo —que para un 6 mm² son veintidós milímetros de radio— se comía el diente de al lado. De ahí
 * salían las diez invasiones de «diente» de hasta 4 mm: no era el cable metido en el sitio
 * equivocado, era el cable doblando encima del sitio correcto.
 *
 * Aquí el giro se hace en una línea de aproximación separada del ducto lo que mida el codo, así
 * que cuando el cable llega a la pared ya viene alineado con la ranura y el último tramo es recto.
 * Es también lo que se hace en la obra: se saca el hilo, se alinea con la ranura y se mete.
 */
function acceso(
	t: Tramo, ac: Acceso, ejeBorne: number, cruzBorne: number, zBorne: number, codo: number,
	carril: number,
): Punto3[] {
	const lado = Math.sign(cruzBorne - t.centro) || 1;
	const fuera = t.centro + lado * (Math.max(
		Math.abs(cruzBorne - t.centro), t.semiancho + ESPESOR + codo + 2,
	) + carril * SEPARACION_APROXIMACION);
	const pared = t.centro + lado * t.semiancho;
	/*
	 * Y la bajada a la altura de entrada se hace YA DENTRO de la ranura. Hacerla fuera —que es lo
	 * que salía de escribir el punto de pared directamente a la altura de la banda— mandaba al
	 * cable a bajar a veinte milímetros del suelo POR DELANTE del ducto, o sea por encima del
	 * aparato que tuviera al lado: de ahí salían invasiones de hasta 15 mm en contactores y
	 * borneras. La ranura es una ventana de cincuenta milímetros de alto: dentro de ella se puede
	 * bajar en vertical sin tocar nada.
	 */
	return [
		{ ...puntoDe(t, ejeBorne, fuera), z: zBorne },
		{ ...puntoDe(t, ac.ranura, fuera), z: zBorne },
		{ ...puntoDe(t, ac.ranura, pared), z: zBorne },
		{ ...puntoDe(t, ac.ranura, t.centro + lado * (t.semiancho - 1.5)), z: ac.z },
	];
}

/**
 * El trozo de carril de aproximación que un cable comprometa al entrar por una ranura: lo que
 * recorre en paralelo al ducto MÁS el ancho de la propia boca, porque para meterse en ella cruza
 * el carril en perpendicular y ese cruce también ocupa sitio.
 */
function tramoAcceso(eje: number, ranura: number): { desde: number; hasta: number } {
	return { desde: Math.min(eje, ranura) - RANURA, hasta: Math.max(eje, ranura) + RANURA };
}

/** Lo que un camino viaja por fuera del ducto: la parte que se ve y hace cortina. */
function largoDe(nodos: Punto3[]): number {
	let l = 0;
	for (let i = 1; i < nodos.length; i++) l += Math.hypot(nodos[i].x - nodos[i - 1].x, nodos[i].y - nodos[i - 1].y);
	return l;
}

/**
 * LOS CAMINOS QUE SE LE OFRECEN A UN CABLE, ya elegidos y pocos.
 *
 * `amplitud` es el presupuesto: cuántos accesos y cuántos sitios interiores se consideran. Se
 * empieza por uno de cada —lo más barato— y solo se amplía si esa primera propuesta choca. Un
 * cable en zona despejada se resuelve con una sola geometría; uno en el centro del lío puede
 * llegar a unas decenas. Es lo que hace que el coste dependa de la dificultad y no del tamaño
 * del tablero.
 */
function caminosPosibles(
	red: RedCanaletas, ocupacion: Ocupacion, a: Anclaje, b: Anclaje, sa: Punto, sb: Punto,
	corredores: Banda[], amplitud: number, radio: number, codo: number,
): Candidato[] {
	const salida: Candidato[] = [];
	const nAccesos = amplitud;
	const nSitios = amplitud + 1;
	const ancho = radio * 2;

	/** Un viaje por dentro de un tramo, entrando y saliendo por sus ranuras. */
	const porUnDucto = (t: Tramo): void => {
		const ca = cruzDe(t, sa.x, sa.y);
		const cb = cruzDe(t, sb.x, sb.y);
		const ea = ejeDe(t, sa.x, sa.y);
		const eb = ejeDe(t, sb.x, sb.y);
		for (const A of ocupacion.mejoresAccesos(t, ea, radio, nAccesos)) {
			for (const B of ocupacion.mejoresAccesos(t, eb, radio, nAccesos)) {
				const ladoA = Math.sign(ca - t.centro) || 1;
				const ladoB = Math.sign(cb - t.centro) || 1;
				const { desde: dA, hasta: hA } = tramoAcceso(ea, A.ranura);
				const { desde: dB, hasta: hB } = tramoAcceso(eb, B.ranura);
				const apA = ocupacion.mejorAproximacion(t.id, ladoA, dA, hA);
				const apB = ocupacion.mejorAproximacion(t.id, ladoB, dB, hB);
				for (const s of ocupacion.mejoresSitios(t, A.ranura, B.ranura, radio, nSitios)) {
					const entra = acceso(t, A, ea, ca, a.z, codo, apA);
					const sale = acceso(t, B, eb, cb, b.z, codo, apB);
					salida.push({
						nodos: [
							{ x: a.x, y: a.y, z: a.z },
							{ x: sa.x, y: sa.y, z: a.z },
							...entra,
							{ ...puntoDe(t, A.ranura, s.cruz), z: s.z },
							{ ...puntoDe(t, B.ranura, s.cruz), z: s.z },
							...sale.slice().reverse(),
							{ x: sb.x, y: sb.y, z: b.z },
							{ x: b.x, y: b.y, z: b.z },
						],
						expuesto: largoDe([{ x: sa.x, y: sa.y, z: a.z }, ...entra])
							+ largoDe([{ x: sb.x, y: sb.y, z: b.z }, ...sale]),
						ductos: 1,
						reserva: [
							{
								tramo: t.id, sitio: s.sitio, desde: A.ranura, hasta: B.ranura,
								accesos: [{ ranura: A.ranura, z: A.z, ancho }, { ranura: B.ranura, z: B.z, ancho }],
							},
							{ tramo: `${t.id}|ap${ladoA}`, sitio: apA, ...tramoAcceso(ea, A.ranura), accesos: [] },
							{ tramo: `${t.id}|ap${ladoB}`, sitio: apB, ...tramoAcceso(eb, B.ranura), accesos: [] },
						],
					});
				}
			}
		}
	};

	/** Lo mismo cambiando de ducto en un cruce: entra por la horizontal y sale por la vertical. */
	const porDosDuctos = (ta: Tramo, tb: Tramo): void => {
		const cruce = red.cruceEntre(ta.id, tb.id);
		if (!cruce) return;
		const ca = cruzDe(ta, sa.x, sa.y);
		const cb = cruzDe(tb, sb.x, sb.y);
		const ea = ejeDe(ta, sa.x, sa.y);
		const eb = ejeDe(tb, sb.x, sb.y);
		const ejeCruceA = ta.esH ? (cruce.zona.x0 + cruce.zona.x1) / 2 : (cruce.zona.y0 + cruce.zona.y1) / 2;
		const ejeCruceB = tb.esH ? (cruce.zona.x0 + cruce.zona.x1) / 2 : (cruce.zona.y0 + cruce.zona.y1) / 2;
		for (const A of ocupacion.mejoresAccesos(ta, ea, radio, nAccesos)) {
			for (const B of ocupacion.mejoresAccesos(tb, eb, radio, nAccesos)) {
				for (const s of ocupacion.mejoresSitios(ta, A.ranura, ejeCruceA, radio, nSitios)) {
					// Dentro del cruce los dos ducтos comparten volumen: el cable pasa de uno a otro
					// a la misma altura, y la coordenada transversal de cada uno es el eje del otro.
					const sb2 = ocupacion.mejoresSitios(tb, ejeCruceB, B.ranura, radio, 1)[0];
					if (!sb2) continue;
					const ladoA = Math.sign(ca - ta.centro) || 1;
					const ladoB = Math.sign(cb - tb.centro) || 1;
					const { desde: dA, hasta: hA } = tramoAcceso(ea, A.ranura);
					const { desde: dB, hasta: hB } = tramoAcceso(eb, B.ranura);
					const apA = ocupacion.mejorAproximacion(ta.id, ladoA, dA, hA);
					const apB = ocupacion.mejorAproximacion(tb.id, ladoB, dB, hB);
					const entra = acceso(ta, A, ea, ca, a.z, codo, apA);
					const sale = acceso(tb, B, eb, cb, b.z, codo, apB);
					salida.push({
						nodos: [
							{ x: a.x, y: a.y, z: a.z },
							{ x: sa.x, y: sa.y, z: a.z },
							...entra,
							{ ...puntoDe(ta, A.ranura, s.cruz), z: s.z },
							{ ...puntoDe(ta, ejeCruceA, s.cruz), z: s.z },
							{ ...puntoDe(tb, ejeCruceB, sb2.cruz), z: sb2.z },
							{ ...puntoDe(tb, B.ranura, sb2.cruz), z: sb2.z },
							...sale.slice().reverse(),
							{ x: sb.x, y: sb.y, z: b.z },
							{ x: b.x, y: b.y, z: b.z },
						],
						expuesto: largoDe([{ x: sa.x, y: sa.y, z: a.z }, ...entra])
							+ largoDe([{ x: sb.x, y: sb.y, z: b.z }, ...sale]),
						ductos: 2,
						reserva: [
							{
								tramo: ta.id, sitio: s.sitio, desde: A.ranura, hasta: ejeCruceA,
								accesos: [{ ranura: A.ranura, z: A.z, ancho }],
							},
							{
								tramo: tb.id, sitio: sb2.sitio, desde: ejeCruceB, hasta: B.ranura,
								accesos: [{ ranura: B.ranura, z: B.z, ancho }],
							},
							{ tramo: `${ta.id}|ap${ladoA}`, sitio: apA, ...tramoAcceso(ea, A.ranura), accesos: [] },
							{ tramo: `${tb.id}|ap${ladoB}`, sitio: apB, ...tramoAcceso(eb, B.ranura), accesos: [] },
						],
					});
				}
			}
		}
	};

	/*
	 * PRIMERA ETAPA DEL RUTEO: QUÉ DUCTOS MERECE LA PENA MIRAR.
	 *
	 * Aquí estaba el fallo gordo de la fase. El filtro decía que un ducto solo servía si quedaba
	 * ENTRE los dos bornes, y en un tablero de verdad la mayoría de los hilos van entre aparatos
	 * de la MISMA fila: contactor con contactor, protección con contactor. Para esos no hay ningún
	 * ducto «en medio», así que se descartaban todos y el cable salía por delante. Medido en el
	 * estrella-triángulo: 4 conductores de 52 usaban canaleta, y los 48 restantes formaban
	 * exactamente la cortina que había que quitar —los 33 choques estaban TODOS fuera de los
	 * ductos, ni uno dentro—.
	 *
	 * Un electricista no lo hace así: mete el hilo en la canaleta que tiene al lado, lo lleva por
	 * dentro y lo saca donde le toca, esté esa canaleta arriba, abajo o en medio. Lo único que se
	 * le pide al ducto es que DÉ DE SÍ a lo largo para cubrir los dos bornes. Lo cerca o lejos que
	 * quede ya lo paga el candidato en su tramo expuesto, y lo compara la nota.
	 */
	const utiles = red.tramos
		.map((t) => {
			const ea = ejeDe(t, sa.x, sa.y);
			const eb = ejeDe(t, sb.x, sb.y);
			return {
				t,
				cubre: t.desde <= Math.min(ea, eb) + 40 && t.hasta >= Math.max(ea, eb) - 40,
				rodeo: Math.abs(cruzDe(t, sa.x, sa.y) - t.centro) + Math.abs(cruzDe(t, sb.x, sb.y) - t.centro),
			};
		})
		.filter((q) => q.cubre)
		.sort((a, b) => a.rodeo - b.rodeo || (a.t.id < b.t.id ? -1 : 1))
		.slice(0, 1 + amplitud);
	for (const q of utiles) porUnDucto(q.t);
	// Cambiar de ducto en un cruce cuesta más de mirar, así que solo si con uno no salió nada
	// razonable o si el presupuesto ya se ha ampliado.
	if (salida.length === 0 || amplitud > 1) {
		for (const ta of red.tramos) {
			for (const tb of red.tramos) {
				if (ta.id !== tb.id) porDosDuctos(ta, tb);
			}
		}
	}

	/*
	 * Y el camino de siempre, por delante del tablero. Sigue haciendo falta —dos bornes sin
	 * canaleta útil en medio, o un tablero sin canaletas— pero va el último porque es el que
	 * produce la cortina.
	 */
	const corredor = mejorCorredor(sa, sb, corredores);
	const alturas = corredor ? carrilesDe(corredor) : [Math.round((sa.y + sb.y) / 2)];
	for (const yCarril of alturas.slice(0, Math.max(2, amplitud))) {
		for (const paso of PASOS_LATERALES.slice(0, amplitud > 1 ? 3 : 1)) {
			const d = paso * PASO_LATERAL;
			for (let capa = 0; capa < CAPAS_CABLE; capa++) {
				const zc = Z_EXPUESTO + capa * SEPARACION_CAPAS;
				const nodos: Punto3[] = [
					{ x: a.x, y: a.y, z: a.z },
					{ x: sa.x, y: sa.y, z: a.z },
					{ x: sa.x + d, y: yCarril, z: zc },
					{ x: sb.x + d, y: yCarril, z: zc },
					{ x: sb.x, y: sb.y, z: b.z },
					{ x: b.x, y: b.y, z: b.z },
				];
				salida.push({ nodos, expuesto: largoDe(nodos), ductos: 0, reserva: [] });
			}
		}
	}
	return salida;
}

/**
 * EL REPARTO: a cada cable, el mejor camino que se pueda medir.
 *
 * De cada candidato se construye el recorrido 3D COMPLETO que se va a dibujar y se mide su
 * distancia real contra todo lo ya tendido, radio incluido. La nota premia primero no chocar y,
 * a igualdad de holgura, ir lo menos expuesto posible: entre meterse en una canaleta y cruzar por
 * delante del tablero, gana la canaleta. Es lo que quita la cortina sin esconder nada.
 *
 * Es determinista: mismo proyecto, mismo reparto, porque se recorren los conductores en el orden
 * del proyecto y los candidatos en un orden fijo.
 */
function repartirCables(proyecto: Proyecto): RutaCable[] {
	const corredores = corredoresLibresDe(proyecto);
	const abanico = abanicoDeSalida(proyecto);
	const red = new RedCanaletas(proyecto.gabinete?.canaletas ?? []);
	/*
	 * El suelo que imponen las canaletas al cable que NO entra en ellas: un tramo expuesto que
	 * cruza un ducto por fuera tiene que pasar por encima de los dientes, no a través. Al que va
	 * por dentro no se le aplica: sus puntos ya están en el interior útil.
	 */
	const solidas = (proyecto.gabinete?.canaletas ?? []).map((c) => ({
		id: '', ...huellaCanaleta(c), alto: c.alto + TAPA,
	}));
	/*
	 * Y los CUERPOS DE LOS APARATOS también son suelo para el cable que no va a ellos. Un hilo que
	 * sale hacia el campo lo hace a 30 mm de la placa —es la altura a la que entra por abajo— y si
	 * cruza medio tablero a esa altura se mete por dentro de la bornera o del contactor que se
	 * encuentre: doce milímetros dentro, medidos. Al aparato al que el cable va conectado no se le
	 * aplica, porque ahí tiene que estar.
	 */
	for (const s of solidosDelTablero(proyecto)) {
		if (!s.id.startsWith('aparato ')) continue;
		solidas.push({ id: s.id, x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, alto: s.z1 });
	}

	interface Puesto {
		conductorId: string;
		trazo: Trazo;
		nodos: Punto3[];
		z: number;
		clave: string;
		/** Cómo volver a pedir caminos para este cable, con el mapa de ocupación de ese momento. */
		generar: (amplitud: number) => Candidato[];
		reserva: Reserva[];
		radio: number;
		codo: number;
		sueloMin: (x: number, y: number) => number;
		sueloDentro: (x: number, y: number) => number;
		de: Anclaje;
		a: Anclaje;
	}

	/** ¿Ese punto está en la salida de un borne, donde no hay camino alternativo que valga? */
	const cerca = (p: Punto3, q: Anclaje): boolean =>
		Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 34;

	const puestos: Puesto[] = [];
	const rejilla = new RejillaCables();
	const ocupacion = new Ocupacion();
	/** Primero que no choque; luego, que vaya lo menos expuesto posible. */
	const puntuar = (c: Candidato, holgura: number): number =>
		Math.min(holgura, HOLGURA_CABLE) * 1000 - c.expuesto - c.ductos * 30;
	/**
	 * MEDIR SOLO HASTA QUE SE SEPA QUE PIERDE. La nota de arriba se conoce a medias antes de
	 * medir: el tramo expuesto y el número de ductos son datos del candidato. De ahí sale
	 * exactamente qué holgura necesitaría para ganar al mejor de momento, y en cuanto se le
	 * encuentra un choque peor que eso ya no hace falta recorrer el resto del cable. Es una poda
	 * exacta —nunca descarta un candidato que fuera a ganar— y es lo que baja el
	 * estrella-triángulo de 5,1 a 1,3 segundos.
	 */
	const rendirse = (c: Candidato, nota: number): number =>
		(nota === -Infinity ? -Infinity : (nota + c.expuesto + c.ductos * 30) / 1000);

	/*
	 * EN QUÉ ORDEN SE COLOCAN. El primero elige con el tablero vacío y el último, con todo en
	 * contra, así que se colocan primero los GORDOS: un 6 mm² necesita una ranura entera y sitio
	 * de sobra dentro del ducto, mientras que un hilo de mando se acomoda en cualquier hueco.
	 * (Medido: en los cinco tableros de la biblioteca no cambia ni una cifra, porque los ejemplos
	 * ya declaran la potencia antes que el mando. Se deja porque en un tablero dibujado en otro
	 * orden sí importaría, y no cuesta nada.)
	 *
	 * El desempate es el índice del proyecto, así que el reparto sigue siendo determinista.
	 */
	const orden = proyecto.conductores
		.map((c, i) => ({ c, i }))
		.sort((p, q) => radioDeCable(q.c.seccion) - radioDeCable(p.c.seccion) || p.i - q.i);

	for (const { c: conductor } of orden) {
		const p = salidasDeCable(proyecto, conductor, abanico);
		if (!p) continue;
		const radio = radioDeCable(conductor.seccion);
		const codo = radioCodo(radio);
		const MARGEN = radio + HOLGURA_CABLE + 8;
		const mios = [
			`aparato ${conductor.de.dispositivoId}`, `aparato ${conductor.a.dispositivoId}`,
		];
		/**
		 * El suelo que le imponen al cable las cosas por encima de las que tiene que pasar.
		 *
		 * `porDentro` distingue los dos casos: al que viaja por dentro de un ducto no se le puede
		 * aplicar el suelo del propio ducto —lo sacaría de él— pero sí el de los aparatos, porque
		 * cruzar una bornera por dentro es igual de malo se venga de donde se venga.
		 */
		const suelo = (porDentro: boolean) => (x: number, y: number): number => {
			let z = 0;
			for (const c of solidas) {
				if (x < c.x0 - MARGEN || x > c.x1 + MARGEN || y < c.y0 - MARGEN || y > c.y1 + MARGEN) continue;
				if (!c.id) {
					if (porDentro) return 0;   // es su ducto: aquí no hay suelo que valga
					z = Math.max(z, c.alto + radio + HOLGURA_CABLE);
					continue;
				}
				if (mios.includes(c.id)) continue;
				z = Math.max(z, c.alto + radio + HOLGURA_CABLE);
			}
			return z;
		};
		const sueloMin = suelo(false);
		const sueloDentro = suelo(true);
		const bornes: [string, string] = [
			`${conductor.de.dispositivoId}:${conductor.de.borneId}`,
			`${conductor.a.dispositivoId}:${conductor.a.borneId}`,
		];

		// Un cable peinado a mano manda: se le respeta el trazado y solo se le busca profundidad.
		const aMano = (): Candidato[] => Array.from({ length: CAPAS_CABLE }, (_, capa) => {
			const zc = Z_EXPUESTO + capa * SEPARACION_CAPAS;
			return {
				nodos: [
					{ x: p.de.x, y: p.de.y, z: p.de.z },
					{ x: p.salidaA.x, y: p.salidaA.y, z: p.de.z },
					...conductor.trazado!.map((q) => ({ x: q.x, y: q.y, z: zc })),
					{ x: p.salidaB.x, y: p.salidaB.y, z: p.a.z },
					{ x: p.a.x, y: p.a.y, z: p.a.z },
				] as Punto3[],
				expuesto: 0,
				ductos: 0,
				reserva: [],
			};
		});

		/*
		 * BÚSQUEDA POR PRESUPUESTO, CON ACEPTACIÓN TEMPRANA.
		 *
		 * Se empieza pidiendo una sola ranura y un solo carril —la propuesta que el mapa de
		 * ocupación considera mejor— y se mide. Si deja holgura, se acepta y no se mira nada más:
		 * un cable en zona despejada cuesta UNA geometría. Solo si choca se amplía la búsqueda, y
		 * aun así con tope. Es lo que hace que el coste dependa de la dificultad del cable y no del
		 * tamaño del tablero.
		 */
		const generar = (amplitud: number): Candidato[] => (conductor.trazado?.length
			? aMano()
			: caminosPosibles(red, ocupacion, p.de, p.a, p.salidaA, p.salidaB, corredores, amplitud, radio, codo));

		let mejor: Puesto | undefined;
		let mejorNota = -Infinity;
		let basta = false;
		/*
		 * Ampliar el presupuesto vuelve a proponer los caminos del anterior más los nuevos: sin
		 * recordar cuáles ya se midieron, cada ampliación repetiría todo el trabajo de la anterior.
		 */
		const vistos = new Set<string>();
		for (const amplitud of [1, 2, 3]) {
			let hayDondeMejorar = false;
			for (const cand of generar(amplitud)) {
				let firma = `${cand.ductos}`;
				for (const n of cand.nodos) firma += `|${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)}`;
				if (vistos.has(firma)) continue;
				vistos.add(firma);
				const puntos = tenderCable(cand.nodos, codo, cand.ductos ? sueloDentro : sueloMin);
				const trazo: Trazo = { id: conductor.id, radio, puntos, bornes, extremos: [p.de, p.a] };
				const choque = rejilla.peorConflicto(trazo, HOLGURA_CABLE, rendirse(cand, mejorNota));
				const nota = puntuar(cand, choque ? choque.holgura : Infinity);
				if (nota > mejorNota) {
					mejorNota = nota;
					/*
					 * ¿Y el choque que queda, se puede arreglar cambiando de camino? Si está pegado
					 * a uno de los dos bornes, NO: por ahí tienen que pasar todos los candidatos,
					 * porque es la salida del propio terminal. Ampliar la búsqueda para esos cables
					 * era gastar cuatrocientas geometrías más para acabar con el mismo choque en el
					 * mismo sitio. Lo que falta ahí no es camino, es sitio en el borne, y eso lo
					 * reparte el abanico. Solo se mira en el candidato que va ganando, que es el
					 * único cuya medida llegó al final sin rendirse.
					 */
					hayDondeMejorar = !!choque && !cerca(choque.donde, p.de) && !cerca(choque.donde, p.a);
					mejor = {
						conductorId: conductor.id, trazo, nodos: cand.nodos, reserva: cand.reserva,
						z: puntos[Math.floor(puntos.length / 2)].z,
						clave: '', generar, radio, codo, sueloMin, sueloDentro, de: p.de, a: p.a,
					};
				}
				// Suficientemente bueno: no choca con nadie. Los candidatos vienen ordenados de
				// mejor a peor, así que el primero limpio es el mejor limpio que había.
				if (!choque) { basta = true; break; }
			}
			if (basta || !hayDondeMejorar || mejorNota >= HOLGURA_CABLE * 1000 - 400) break;
			if (conductor.trazado?.length) break;
		}
		if (!mejor) continue;
		ocupacion.apuntar(mejor.reserva);
		mejor.clave = rejilla.anadir(mejor.trazo);
		puestos.push(mejor);
	}

	/*
	 * SEGUNDA PASADA: levantar y volver a tender a los que quedaron mal. En la primera cada cable
	 * se coloca contra los que YA estaban, así que el último tiene el tablero entero en contra y el
	 * primero no tuvo que esquivar a nadie.
	 */
	const malos = new Set<string>();
	for (const c of conflictosDe(puestos.map((q) => q.trazo), HOLGURA_CABLE)) { malos.add(c.a); malos.add(c.b); }
	for (const puesto of puestos) {
		if (!malos.has(puesto.conductorId)) continue;
		rejilla.retirar(puesto.clave);
		/*
		 * Soltar su sitio antes de volver a elegir. Sin esto el cable se encontraba a SÍ MISMO
		 * ocupando el carril y la ranura que acababa de dejar, así que el mapa le decía que no
		 * había hueco justo donde sí lo había, y se repetía la misma mala elección.
		 */
		ocupacion.quitar(puesto.reserva);
		let mejorNota = -Infinity;
		let mejor: { nodos: Punto3[]; trazo: Trazo; z: number; reserva: Reserva[] } | undefined;
		/*
		 * Aquí sí se paga una búsqueda ancha —solo la pagan los cables que quedaron mal— pero con
		 * tope: sin él, un cable imposible de arreglar se comía setecientas geometrías para acabar
		 * donde estaba. Los candidatos vienen ordenados de mejor a peor, así que cortar por arriba
		 * pierde poco y acota el peor caso.
		 */
		let presupuesto = 400;
		for (const cand of puesto.generar(3)) {
			if (presupuesto-- <= 0) break;
			const puntos = tenderCable(cand.nodos, puesto.codo, cand.ductos ? puesto.sueloDentro : puesto.sueloMin);
			const trazo: Trazo = {
				id: puesto.conductorId, radio: puesto.radio, puntos,
				bornes: puesto.trazo.bornes, extremos: puesto.trazo.extremos,
			};
			const choque = rejilla.peorConflicto(trazo, HOLGURA_CABLE, rendirse(cand, mejorNota));
			const nota = puntuar(cand, choque ? choque.holgura : Infinity);
			if (nota > mejorNota) {
				mejorNota = nota;
				mejor = {
					nodos: cand.nodos, trazo, reserva: cand.reserva,
					z: puntos[Math.floor(puntos.length / 2)].z,
				};
			}
			if (!choque) break;
		}
		if (mejor) Object.assign(puesto, mejor);
		ocupacion.apuntar(puesto.reserva);
		puesto.clave = rejilla.anadir(puesto.trazo);
	}

	const sitioEnProyecto = new Map(proyecto.conductores.map((c, i) => [c.id, i]));
	puestos.sort((p, q) => (sitioEnProyecto.get(p.conductorId) ?? 0) - (sitioEnProyecto.get(q.conductorId) ?? 0));
	return puestos.map((q) => ({
		conductorId: q.conductorId, de: q.de, a: q.a,
		nodos: q.nodos.map((n) => ({ x: n.x, y: n.y })), z: q.z,
		puntos: q.trazo.puntos, radio: q.trazo.radio,
	}));
}

/**
 * Los cables del tablero como volúmenes: el recorrido 3D final de cada uno con su radio. Sale de
 * las MISMAS funciones que dibujan, no de una copia paralela.
 */
export function trazosDeCables(proyecto: Proyecto): Trazo[] {
	return rutasDeCables(proyecto).map((ruta) => {
		const conductor = proyecto.conductores.find((c) => c.id === ruta.conductorId)!;
		return {
			id: ruta.conductorId,
			radio: ruta.radio,
			puntos: ruta.puntos,
			bornes: [
				`${conductor.de.dispositivoId}:${conductor.de.borneId}`,
				`${conductor.a.dispositivoId}:${conductor.a.borneId}`,
			] as [string, string],
			extremos: [ruta.de, ruta.a] as [Punto3, Punto3],
			propios: [`aparato ${conductor.de.dispositivoId}`, `aparato ${conductor.a.dispositivoId}`],
		};
	});
}

/**
 * LO QUE HAY EN EL TABLERO POR DONDE UN CABLE NO DEBERÍA PASAR.
 *
 * Las canaletas no estaban en el modelo de ruteo de ninguna forma: `corredoresLibresDe()` solo
 * descuenta las huellas de los APARATOS, así que un corredor libre podía caer justo encima de una
 * canaleta y el cable la cruzaba de lado a lado, atravesando sus dedos. Eran decoración. Aquí
 * entran como sólidos de verdad, junto con el carril y los aparatos.
 */
export function solidosDelTablero(proyecto: Proyecto): Solido[] {
	const g = proyecto.gabinete;
	if (!g) return [];
	const solidos: Solido[] = [];
	/*
	 * LA CANALETA YA NO ENTRA AQUÍ.
	 *
	 * Esta lista es de volúmenes que un cable no puede pisar, y una canaleta ya no es eso: su
	 * INTERIOR es precisamente por donde tiene que ir. Lo que no se puede atravesar son sus partes
	 * —fondo, zócalo, dientes y tapa—, y eso lo mide `invasionesDeCanaletas`, que sabe dónde está
	 * cada diente en vez de tratar el ducto como un ladrillo.
	 */
	for (const r of g.rieles) {
		const esV = r.orientacion === 'v';
		solidos.push({
			id: `carril ${r.id ?? ''}`.trim(),
			x0: r.x - (esV ? 17.5 : 0), x1: r.x + (esV ? 17.5 : r.largo),
			y0: r.y - (esV ? 0 : 17.5), y1: r.y + (esV ? r.largo : 17.5),
			z0: 0, z1: ALTURA_CARRIL,
		});
	}
	for (const col of g.colocaciones) {
		/*
		 * El aparato cuenta hasta POR DEBAJO del hombro de bornes. El hombro es la superficie donde
		 * se apoya el hilo al salir del tornillo: es exactamente lo que tiene que pasar ahí.
		 * Contándolo como sólido hasta la cota del borne, cada cable salía marcado como invasor de
		 * su propio aparato por un milímetro, y eso es ruido que tapa las invasiones de verdad.
		 */
		solidos.push({
			id: `aparato ${col.dispositivoId}`,
			x0: col.x, x1: col.x + col.ancho,
			y0: col.y, y1: col.y + col.alto,
			z0: 0, z1: Z_BORNE - 7,
		});
	}
	return solidos;
}

/**
 * DIAGNÓSTICO DEL CABLEADO: qué pares de cables se tocan, y qué cable invade algo sólido.
 *
 * Es la respuesta a «¿de verdad no se cruzan?», contestada MIDIENDO la geometría final y no
 * razonando sobre carriles. La usan las pruebas y la sonda de QA.
 */
export function diagnosticoCables(proyecto: Proyecto, margen = HOLGURA_CABLE): {
	cables: number;
	holguraMinima: number;
	conflictos: Conflicto[];
	invasiones: Conflicto[];
	porCanaleta: number;
} {
	const trazos = trazosDeCables(proyecto);
	const conflictos = conflictosDe(trazos, margen);
	const canaletas = proyecto.gabinete?.canaletas ?? [];
	const red = new RedCanaletas(canaletas);
	return {
		cables: trazos.length,
		holguraMinima: conflictos.length ? conflictos[0].holgura : Infinity,
		conflictos,
		invasiones: [
			...invasionesDe(trazos, solidosDelTablero(proyecto)),
			// Las canaletas se miden aparte: distinguen el interior útil de lo sólido.
			...invasionesDeCanaletas(red, canaletas, trazos).map((i) => ({
				a: i.cable, b: `${i.parte} de canaleta ${i.canaleta}`,
				holgura: -i.dentro, distanciaEjes: 0, donde: i.donde,
			})),
		].sort((p, q) => p.holgura - q.holgura),
		/** Cuántos cables usan de verdad una canaleta: la medida de que la cortina se va. */
		porCanaleta: trazos.filter((t) => t.puntos.some(
			(q) => red.tramos.some((tr) => {
				const eje = tr.esH ? q.x : q.y;
				const cruz = tr.esH ? q.y : q.x;
				return eje > tr.desde && eje < tr.hasta
					&& Math.abs(cruz - tr.centro) < tr.semiancho && q.z > tr.zMin && q.z < tr.zMax;
			}),
		)).length,
	};
}

export function construirCables(
	proyecto: Proyecto,
	aEscena: Escenario['aEscena'],
	voltajePorConductor?: Map<string, number | undefined>,
): THREE.Group {
	const grupo = new THREE.Group();
	const colorDe = (c: { id: string; color?: string }): number =>
		voltajePorConductor ? colorVoltaje(voltajePorConductor.get(c.id)) : colorDeCable(c.color);

	// Los cables se dibujan en tramos horizontales/verticales (estilo Tinkercad), al FRENTE
	// del tablero para no atravesar los aparatos.
	for (const ruta of rutasDeCables(proyecto)) {
		const conductor = proyecto.conductores.find((c) => c.id === ruta.conductorId)!;
		// Los puntos vienen YA RESUELTOS en la ruta: son los mismos con los que el repartidor
		// comprobó que este cable cabía ahí y los mismos que miden las pruebas. No hay dos.
		const puntos = ruta.puntos.map((p) => aEscena(p.x, p.y, p.z));
		// «centripetal» evita los lazos y cúspides que salían al pasar por vértices muy juntos.
		const curva = new THREE.CatmullRomCurve3(puntos, false, 'centripetal', 0.5);
		anadirTuboCable(
			grupo, curva, Math.min(260, Math.max(64, puntos.length * 3)),
			ruta.radio, colorDe(conductor), conductor.id,
		);
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
 * EL CUERPO DE UN APARATO DE CAMPO, colgado por debajo de su prensaestopas.
 *
 * Un aparato que no va en el riel —el motor, una lámpara, la boya, la válvula, los pulsadores de
 * la puerta— no se dibujaba: solo salía su prensaestopas y un rótulo. Y son justamente los que hay
 * que VER funcionar. Se energizaba el tablero, el motor arrancaba según el simulador, y en
 * pantalla no había ningún motor: lo único que cambiaba era una línea de texto en el panel.
 *
 * No pretende ser un modelo fiel del aparato: es un símbolo reconocible, del tamaño justo para
 * verse desde donde se mira el tablero, con la pieza que se mueve o se enciende marcada para que
 * la simulación la anime —el eje del motor gira, el globo de la lámpara alumbra, el vástago de la
 * válvula sale—. Lo que importa es que al apretar MARCHA se vea girar algo.
 */
function cuerpoDeCampo(d: Dispositivo): THREE.Group {
	const g = new THREE.Group();
	/*
	 * EL COLOR QUE HAYA ELEGIDO EL USUARIO manda sobre el de fábrica.
	 *
	 * Antes cada tipo traía su color a fuego, y el del pulsador lo adivinaba yo mirando si el
	 * marcado llevaba «S0» —o sea que un paro rotulado «-PARO» salía verde—. Adivinar por el
	 * nombre es exactamente lo que no hay que hacer: ahora se elige en la ficha del aparato y esto
	 * lo respeta, tanto para el cuerpo como para lo que alumbra.
	 */
	const elegido = d.colorCuerpo ? new THREE.Color(d.colorCuerpo).getHex() : undefined;
	const pintura = (c: number, rug = 0.55) => new THREE.MeshStandardMaterial({ color: c, roughness: rug });
	const marca = (m: THREE.Mesh, pieza: string, color?: number): THREE.Mesh => {
		m.userData.pieza = pieza;
		if (color !== undefined) m.userData.colorPropio = color;
		return m;
	};

	switch (d.tipo) {
		case 'motor': {
			// Carcasa con aletas, caja de bornes y el ventilador de la cola, que es lo que gira.
			const carcasa = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 46, 20), pintura(elegido ?? 0x2f6f9e, 0.45));
			carcasa.rotation.z = Math.PI / 2;
			g.add(carcasa);
			for (let i = 0; i < 7; i++) {
				const aleta = new THREE.Mesh(new THREE.TorusGeometry(17.6, 1.1, 6, 18), pintura(0x2a6390, 0.5));
				aleta.rotation.y = Math.PI / 2;
				aleta.position.x = -19 + i * 6.5;
				g.add(aleta);
			}
			const bornera = new THREE.Mesh(new THREE.BoxGeometry(16, 11, 13), pintura(0x24506f, 0.6));
			bornera.position.set(-2, 19, 0);
			g.add(bornera);
			// EL EJE Y SUS ASPAS: giran mientras el motor esté funcionando.
			const eje = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 20, 12), pintura(0xc9ced3, 0.3));
			eje.rotation.z = Math.PI / 2;
			eje.position.x = 32;
			g.add(marca(eje, 'eje'));
			for (const [ah, az] of [[26, 5], [5, 26]] as const) {
				const aspa = new THREE.Mesh(new THREE.BoxGeometry(1.5, ah, az), pintura(0xdfe4e8, 0.4));
				aspa.position.x = 26;
				g.add(marca(aspa, 'eje'));
			}
			break;
		}
		case 'piloto':
		case 'resistencia': {
			// Una lámpara: casquillo y globo. El globo alumbra con SU color, no con un amarillo igual
			// para todo: el piloto de defecto tiene que verse rojo y el de marcha, verde.
			const color = elegido ?? (d.tipo === 'resistencia' ? 0xff7043 : 0xffd54f);
			const casquillo = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 9, 14), pintura(0x9aa1a8, 0.5));
			casquillo.position.y = 14;
			g.add(casquillo);
			const globo = new THREE.Mesh(new THREE.SphereGeometry(12, 20, 16),
				new THREE.MeshStandardMaterial({ color, roughness: 0.2, transparent: true, opacity: 0.9 }));
			g.add(marca(globo, 'lente', color));
			break;
		}
		case 'valvula': {
			// Cuerpo de válvula con su actuador arriba; el vástago sale al abrir.
			const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 16, 16), pintura(0x8d949b, 0.45));
			cuerpo.rotation.z = Math.PI / 2;
			g.add(cuerpo);
			const actuador = new THREE.Mesh(new THREE.BoxGeometry(20, 16, 20), pintura(0x37474f, 0.55));
			actuador.position.y = 20;
			g.add(actuador);
			const vastago = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 14, 10), pintura(0xd7dce0, 0.3));
			vastago.position.y = 9;
			g.add(marca(vastago, 'vastago'));
			break;
		}
		case 'pulsador':
		case 'selector': {
			/*
			 * EL MANDO DE LA PUERTA, que además arregla algo que no era solo estético: estos
			 * pulsadores no tenían cuerpo, así que no se podían pinchar en el tablero. Ahora sí.
			 */
			// Sin color elegido se usa el convenio de siempre —rojo el selector/paro, verde la
			// marcha—, pero como PUNTO DE PARTIDA, no como adivinanza sobre el rótulo.
			const color = elegido ?? (d.tipo === 'selector' ? 0xd32f2f : 0x2e7d32);
			const aro = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 5, 20), pintura(0xb6bcc2, 0.35));
			aro.rotation.x = Math.PI / 2;
			g.add(aro);
			const cabeza = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 8.5, 8, 20), pintura(color, 0.4));
			cabeza.rotation.x = Math.PI / 2;
			cabeza.position.z = 6;
			g.add(marca(cabeza, 'boton', color));
			break;
		}
		case 'sensor': {
			// Sonda o contacto de campo (una boya, un presostato), con su testigo.
			g.add(new THREE.Mesh(new THREE.BoxGeometry(20, 26, 14), pintura(0x455a64, 0.55)));
			const testigo = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 10),
				new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.25 }));
			testigo.position.set(0, 9, 9);
			g.add(marca(testigo, 'lente', 0x66bb6a));
			break;
		}
		default:
			// Acometida y demás: un bloque sobrio, sin nada que animar.
			g.add(new THREE.Mesh(new THREE.BoxGeometry(24, 16, 14), pintura(0x6b737b, 0.6)));
	}
	g.traverse((o) => {
		o.userData.dispositivoId = d.id;
		if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
	});
	return g;
}

/**
 * Prensaestopas + rótulo de cada aparato de campo, en el borde inferior del gabinete: es el
 * punto físico por donde el cable sale del tablero hacia la red o hacia el campo.
 */
export function construirEntradasCampo(
	proyecto: Proyecto,
	aEscena: Escenario['aEscena'],
	/** Dónde dejar los cuerpos de los aparatos, para que el ratón y la simulación los alcancen. */
	dispositivos?: THREE.Group,
): THREE.Group {
	const grupo = new THREE.Group();
	const campo = aparatosDeCampo(proyecto);
	if (campo.length === 0) return grupo;
	const y = yEntradasCampo(proyecto);
	const anchoGab = proyecto.gabinete?.ancho ?? 600;

	/*
	 * LA BANCADA DE CAMPO.
	 *
	 * Los aparatos de campo se dibujaban colgando en mitad de la nada por debajo del gabinete, y
	 * eso es lo que se ve: cosas flotando en el aire. En un tablero de verdad el motor está en el
	 * suelo y los pulsadores en la puerta; aquí no hay ni suelo ni puerta, así que se dibuja lo que
	 * hace de las dos cosas: una bancada con su zócalo sobre la que APOYAN, y de cada prensaestopas
	 * baja un tubo corrugado hasta su aparato.
	 *
	 * No es adorno: sin una superficie de referencia, el ojo no sabe a qué altura está cada cosa y
	 * todo el conjunto parece un montaje pegado.
	 */
	const bancada = new THREE.Group();
	const grisBanco = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.85, metalness: 0.05 });
	const cantoBanco = new THREE.MeshStandardMaterial({ color: 0x3a424b, roughness: 0.7, metalness: 0.2 });
	const anchoBanco = anchoGab + 90;
	// El tablero de la bancada, con su canto al frente.
	const tablero = new THREE.Mesh(new THREE.BoxGeometry(anchoBanco, 14, 96), grisBanco);
	tablero.position.copy(aEscena(anchoGab / 2, y + 78, 6));
	tablero.receiveShadow = true;
	bancada.add(tablero);
	const canto = new THREE.Mesh(new THREE.BoxGeometry(anchoBanco, 5, 4), cantoBanco);
	canto.position.copy(aEscena(anchoGab / 2, y + 70, 54));
	bancada.add(canto);
	// Zócalo: da fondo y evita que la bancada parezca a su vez una tabla en el aire.
	const zocalo = new THREE.Mesh(new THREE.BoxGeometry(anchoBanco - 40, 26, 70),
		new THREE.MeshStandardMaterial({ color: 0x22272d, roughness: 0.9 }));
	zocalo.position.copy(aEscena(anchoGab / 2, y + 98, 0));
	bancada.add(zocalo);
	grupo.add(bancada);

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
		/*
		 * EL TUBO que baja del prensaestopas al aparato. Es lo que ata visualmente una cosa con la
		 * otra: sin él, el aparato queda suelto y parece pegado encima del fondo.
		 */
		const tubo = new THREE.Mesh(
			new THREE.CylinderGeometry(4.5, 4.5, 30, 12),
			new THREE.MeshStandardMaterial({ color: 0x353b42, roughness: 0.8 }),
		);
		tubo.position.copy(aEscena(cx, y + 23, 12));
		tubo.castShadow = true;
		grupo.add(tubo);

		// Y el aparato en sí, APOYADO en la bancada: el motor, la lámpara, la boya…
		const cuerpoCampo = cuerpoDeCampo(d);
		cuerpoCampo.position.copy(aEscena(cx, y + 52, 14));
		cuerpoCampo.userData.dispositivoId = d.id;
		(dispositivos ?? grupo).add(cuerpoCampo);
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
): Anclaje | undefined {
	const d = proyecto.dispositivos.find((x) => x.id === dispositivoId);
	const col = proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === dispositivoId);
	if (!d) return undefined;
	// Aparato NO colocado en la placa (red/acometida o aparato de campo): su cable no puede
	// quedar en el aire («cable fantasma»). Entra por un PRENSAESTOPAS en el borde inferior
	// del gabinete, igual que en un tablero real, para que el cable tenga un recorrido visible.
	if (!col) return anclajeCampo(proyecto, d, borneId);
	if (d.imagen) {
		// La profundidad de la imagen CUENTA: sus pines se dibujan sobre el panel, así que si la
		// imagen está adelantada, el punto de enganche del cable tiene que adelantarse con ella.
		// Sin esto el cable salía por detrás del pin y el pin dejaba de poder pincharse.
		const z = (col.z ?? 0) + 10;
		const b = d.bornes.find((x) => x.id === borneId);
		if (b?.u !== undefined && b?.v !== undefined) {
			return { x: col.x + b.u * col.ancho, y: col.y + b.v * col.alto, z };
		}
		return { x: col.x + col.ancho / 2, y: col.y + col.alto / 2, z };
	}
	// Aparato con borneras declaradas (controladores reales): el cable sale del terminal
	// que dice su ficha de datos, no de un reparto genérico en dos filas.
	if (d.terminales?.length) {
		const p = posicionesDeTerminales(d, col.ancho, col.alto).get(borneId);
		if (p) return { x: col.x + p.dx, y: col.y + p.dy, z: Z_BORNE };
	}
	/*
	 * El reparto en dos filas lo decide `bornesGenericos()`, que es la MISMA función que usa el
	 * modelo 3D para poner el tornillo. Antes vivía aquí dentro y el dibujo no tenía forma de
	 * consultarla, así que cada aparato pintaba sus bornes donde le parecía y el cable salía de
	 * un punto donde no había ningún tornillo.
	 */
	const p = bornesGenericos(d, col.ancho, col.alto).find((q) => q.id === borneId);
	if (!p) return { x: col.x + col.ancho / 2, y: col.y + col.alto / 2, z: Z_BORNE - 2 };
	return { x: col.x + p.dx, y: col.y + p.dy, z: Z_BORNE };
}
