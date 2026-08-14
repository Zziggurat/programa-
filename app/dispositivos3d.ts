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
import { BloqueTerminales, Colocacion, Dispositivo } from '../src/modelo/tipos.js';
import { MARGEN_BORNERA, pasoDelBloque, PosicionTerminal, posicionesDeTerminales } from '../src/motores/terminales.js';

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

/** Plancha plana (sin caras laterales) para caras y tapas: no puede pelearse con lo que hay detrás. */
function plancha(w: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
	m.position.set(x, y, z);
	return m;
}

/**
 * Sesga un material hacia la cámara en la prueba de profundidad.
 *
 * Los rótulos y las mirillas son calcomanías: van pegadas a una cara y a la distancia de trabajo
 * el buffer de profundidad no siempre distingue medio milímetro, así que la cara de detrás ganaba
 * a ratos y las letras parpadeaban. Con el sesgo, la calcomanía gana SIEMPRE, mire uno desde donde
 * mire y esté la cámara donde esté.
 */
function calcomania<T extends THREE.Material>(mat: T): T {
	mat.polygonOffset = true;
	mat.polygonOffsetFactor = -2;
	mat.polygonOffsetUnits = -2;
	return mat;
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
	return plancha(w, h, calcomania(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })));
}

/* --------------------------- Modelos por tipo --------------------------- */

function modular(g: THREE.Group, w: number, h: number, color: number, ref: string, polos: number): number {
	// Aparato modular DIN (disyuntor/diferencial): cuerpo, cara, palanca y mirilla.
	const prof = 74;
	const cuerpo = M.plastico(color);
	g.add(caja(w, h, prof - 6, cuerpo, 0, 0, (prof - 6) / 2));
	g.add(caja(w * 0.96, h * 0.55, 8, M.plastico(0xf4f4f0), 0, 0, prof - 2));
	/*
	 * Palanca por polo (unidas), en gris oscuro. Se marcan como PIEZA porque con el tablero
	 * energizado se mueven: una protección abierta baja la palanca y una disparada la deja a
	 * medias, que es como se lee un cuadro de un vistazo sin tocar nada.
	 */
	const palanca = M.plastico(0x33383c, 0.45);
	for (let i = 0; i < polos; i++) {
		const x = (i + 0.5) * (w / polos) - w / 2;
		const p1 = caja(w / polos - 4, 7, 6, palanca, x, 6, prof + 2);
		const p2 = caja(w / polos - 4, 16, 4, palanca, x, 12, prof - 1);
		p1.userData.pieza = 'palanca';
		p2.userData.pieza = 'palanca';
		g.add(p1, p2);
	}
	// Mirilla de estado: verde con el aparato cerrado, roja al abrirlo o dispararlo.
	const mirilla = caja(Math.min(10, w * 0.4), 3.5, 1, M.plastico(0x2e7d32, 0.35), 0, -6, prof + 2.2);
	mirilla.userData.pieza = 'mirilla';
	g.add(mirilla);
	const et = etiquetaImpresa(ref, Math.min(w * 0.9, 30), 6, '#f4f4f0', '#333');
	et.position.set(0, -h * 0.32, prof + 3);   // 1 mm sobre la cara blanca, no rozándola
	g.add(et);
	filaBornes(g, polos, w, h / 2 - 5, prof - 14);
	filaBornes(g, polos, w, -h / 2 + 5, prof - 14);
	return prof;
}

function contactor(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 84;
	g.add(caja(w, h, prof - 10, M.plastico(color), 0, 0, (prof - 10) / 2));
	/*
	 * La ARMADURA: el bloque frontal que lleva los contactos móviles.
	 *
	 * En un contactor de verdad, cuando la bobina tira, este bloque baja un par de milímetros con
	 * su golpe seco. Es LO que se mira para saber si el contactor ha metido, y por eso se marca
	 * como pieza: con el tablero energizado se mueve de verdad.
	 */
	const armadura = caja(w * 0.9, h * 0.42, 12, M.plastico(0x22262a), 0, 2, prof - 4);
	armadura.userData.pieza = 'armadura';
	g.add(armadura);
	// Ventana portaetiquetas y referencia.
	const et = etiquetaImpresa(ref, w * 0.72, 7, '#e8e8e4', '#222');
	et.position.set(0, 2, prof + 3);   // la ventana portaetiquetas acaba en prof+2
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
	// La cara oscura acaba en prof+1: LEDs, rótulo y pantalla van SOBRE ella. Antes se colocaban
	// por detrás (prof-0,5 / prof+0,2) y la propia cara los tapaba: el autómata salía sin marcado.
	const cara = prof + 1;
	for (let i = 0; i < 6; i++) {
		const led = new THREE.MeshStandardMaterial({
			color: 0x21d07a, emissive: 0x21d07a, emissiveIntensity: 0, roughness: 0.3,
		});
		// Los LEDs nacen APAGADOS: los enciende la simulación según lo que haga el autómata.
		const m = caja(2.6, 1.6, 1.2, led, -w * 0.32 + i * 6, h * 0.2, cara + 0.8);
		m.userData.pieza = 'led';
		m.userData.colorPropio = 0x21d07a;
		m.userData.indiceLed = i;
		g.add(m);
	}
	const et = etiquetaImpresa(ref, w * 0.5, 8, '#23272b', '#dfe3e6');
	et.position.set(-w * 0.2, h * 0.06, cara + 0.6);
	g.add(et);
	// Pantalla pequeña: apagada sin tensión, iluminada en verde cuando el autómata vive.
	const pantalla = caja(w * 0.3, h * 0.24, 1.4,
		new THREE.MeshStandardMaterial({ color: 0x0d2b20, emissive: 0x39e08a, emissiveIntensity: 0, roughness: 0.3 }),
		w * 0.24, h * 0.12, cara + 1);
	pantalla.userData.pieza = 'pantalla';
	pantalla.userData.colorPropio = 0x39e08a;
	g.add(pantalla);
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
	// La chapa acaba en prof-6: el rótulo y el piloto van pegados a ella, no flotando delante.
	const et = etiquetaImpresa(ref, w * 0.8, 10, '#dfe3e6', '#222');
	et.position.set(0, h * 0.18, prof - 5.2);
	g.add(et);
	// LED DC OK: se enciende cuando la fuente tiene de verdad su primario alimentado.
	const dcok = caja(3, 3, 1.2,
		new THREE.MeshStandardMaterial({ color: 0x21d07a, emissive: 0x21d07a, emissiveIntensity: 0 }),
		w * 0.25, -h * 0.1, prof - 5);
	dcok.userData.pieza = 'led';
	dcok.userData.colorPropio = 0x21d07a;
	g.add(dcok);
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
	// Una borna suelta es un caso legítimo y muy común (un puente, una reserva, un PE aislado):
	// con un mínimo de 2 se dibujaban dos bloques donde el usuario había puesto uno.
	const n = Math.max(1, d.bornes.length);
	const paso = w / n;
	for (let i = 0; i < n; i++) {
		const b = d.bornes[i];
		const esPE = b?.tipo === 'PE';
		const x = (i + 0.5) * paso - w / 2;
		// Bloque individual: gris (o verde/amarillo si es tierra).
		const cuerpo = esPE ? M.plastico(0x3f9142, 0.55) : M.plastico(0xaeb4b9, 0.6);
		g.add(caja(paso - 1.2, h, prof, cuerpo, x, 0, prof / 2));
		// La franja amarilla va algo más estrecha y sobresale 1 mm: con la misma anchura y 0,3 mm,
		// sus costados coincidían con los del bloque y se peleaban al girar la vista.
		if (esPE) g.add(caja(paso - 1.8, h * 0.3, prof + 2, M.plastico(0xe4c437, 0.55), x, 0, prof / 2));
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
	// El bloque del frente llega hasta la cara declarada del aparato. Antes se quedaba 10 mm
	// corto y el display y el rótulo salían flotando en el aire por delante de él.
	g.add(caja(w * 0.92, h * 0.9, prof * 0.48, M.plastico(0x33383d), 0, 0, prof * 0.76));
	// Radiador trasero.
	const aleta = M.metal(0x7d838a);
	for (let i = 0; i < 7; i++) {
		g.add(caja(w * 0.1, h * 0.9, 8, aleta, -w * 0.42 + i * (w * 0.14), 0, 5));
	}
	// Display y teclas. El display se apaga sin tensión, como el de un variador de verdad.
	const disp = caja(w * 0.4, h * 0.14, 1.6,
		new THREE.MeshStandardMaterial({ color: 0x0b2b18, emissive: 0x16a34a, emissiveIntensity: 0 }),
		0, h * 0.28, prof + 0.8);
	disp.userData.pieza = 'pantalla';
	disp.userData.colorPropio = 0x16a34a;
	g.add(disp);
	const et = etiquetaImpresa(ref, w * 0.6, 8, '#26292c', '#c8cdd2');
	et.position.set(0, h * 0.1, prof + 0.6);
	g.add(et);
	const rueda = cilindro(w * 0.12, 2, M.plastico(0x0f766e, 0.4), 0, -h * 0.18, prof + 1);
	g.add(rueda);
	filaBornes(g, 5, w * 0.85, -h / 2 + 6, prof - 12);
	return prof;
}

function guardamotorModelo(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 90;
	g.add(caja(w, h, prof - 8, M.plastico(color), 0, 0, (prof - 8) / 2));
	/*
	 * Mando giratorio al frente. La maneta roja es la PALANCA: gira con el aparato, igual que en
	 * el guardamotor de verdad, y así se ve abierto o disparado sin abrir el panel. Y se le pone
	 * una mirilla, que este modelo no tenía y es donde se lee el estado de un vistazo.
	 */
	g.add(cilindro(w * 0.26, 6, M.plastico(0x16181b, 0.45), 0, h * 0.12, prof));
	const maneta = caja(4, w * 0.36, 7, M.plastico(0xd23b3b, 0.45), 0, h * 0.12, prof + 1);
	maneta.userData.pieza = 'palanca';
	g.add(maneta);
	const mirilla = caja(Math.min(9, w * 0.35), 3.5, 1, M.plastico(0x2e7d32, 0.35), 0, -h * 0.05, prof + 0.6);
	mirilla.userData.pieza = 'mirilla';
	g.add(mirilla);
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

/* ---------------------- Controladores con borneras reales ---------------------- */

/**
 * Bornera declarada en la ficha de datos: el conector (extraíble o fijo) con un tornillo
 * por terminal, colocado exactamente donde el motor de terminales dice que está. Es la
 * misma geometría que usa el anclaje de los cables, así que dibujo y cableado coinciden.
 */
function bloqueTerminales3D(
	g: THREE.Group,
	posiciones: Map<string, PosicionTerminal>,
	bloque: BloqueTerminales,
	w: number,
	h: number,
	prof: number,
): void {
	const puntos = bloque.bornes
		.map((id) => posiciones.get(id))
		.filter((p): p is NonNullable<typeof p> => !!p && p.bloque === bloque);
	if (puntos.length === 0) return;

	const horizontal = bloque.lado === 'arriba' || bloque.lado === 'abajo';
	const paso = Math.max(3.2, pasoDelBloque(bloque, w, h));
	const colorConector = new THREE.Color(bloque.color ?? '#4a5158').getHex();
	const cuerpo = M.plastico(colorConector, 0.5);
	const tornillo = M.metal(0xcfd4d8);
	// El conector extraíble sobresale 3 mm de la cara (es la pieza que se saca tirando);
	// el fijo queda enrasado con ella.
	const altoConector = bloque.extraible ? 13 : 9;
	const zBase = prof - altoConector + (bloque.extraible ? 3 : 0);

	// Zócalo continuo del conector, del largo que ocupa el bloque.
	const primero = puntos[0];
	const ultimo = puntos[puntos.length - 1];
	const cx = (primero.dx + ultimo.dx) / 2 - w / 2;
	const cy = h / 2 - (primero.dy + ultimo.dy) / 2;
	const largo = Math.abs(horizontal ? ultimo.dx - primero.dx : ultimo.dy - primero.dy) + paso;
	g.add(caja(
		horizontal ? largo : Math.min(11, MARGEN_BORNERA * 2),
		horizontal ? Math.min(11, MARGEN_BORNERA * 2) : largo,
		altoConector,
		cuerpo, cx, cy, zBase + altoConector / 2,
	));

	for (const p of puntos) {
		const x = p.dx - w / 2;
		const y = h / 2 - p.dy;
		// Alojamiento del hilo + tornillo con su ranura.
		g.add(caja(
			horizontal ? Math.min(paso - 1, 8) : 6,
			horizontal ? 6 : Math.min(paso - 1, 8),
			1.6, M.oscuro(), x, y, zBase + altoConector + 0.2,
		));
		g.add(cilindro(Math.min(1.9, paso * 0.3), 1.6, tornillo, x, y, zBase + altoConector + 0.9));
	}

	// Rótulo serigrafiado del bloque, sobre la cara, junto al conector.
	if (bloque.rotulo) {
		const largoRotulo = Math.min(largo, horizontal ? w * 0.9 : h * 0.9);
		const et = etiquetaImpresa(bloque.rotulo, largoRotulo, Math.max(4, largoRotulo * 0.09), '#20262b', '#c9d2d8');
		const retiro = MARGEN_BORNERA + 7;
		et.position.set(
			horizontal ? cx : bloque.lado === 'izquierda' ? cx + retiro : cx - retiro,
			horizontal ? (bloque.lado === 'arriba' ? cy - retiro : cy + retiro) : cy,
			prof + 1, // sobre la cara y sobre la tapa del frente, no a ras de ellas
		);
		if (!horizontal) et.rotation.z = Math.PI / 2;
		g.add(et);
	}
}

/**
 * Controlador de automatización descrito por su ficha de datos: caja del fondo real,
 * borneras en su sitio y los rasgos del frente (display, LEDs de estado, puertos de red).
 * Un solo constructor sirve para cualquier fabricante y modelo.
 */
function controlador(g: THREE.Group, d: Dispositivo, w: number, h: number, color: number, ref: string): number {
	const prof = d.profundidad ?? 55;
	g.add(caja(w, h, prof, M.plastico(color), 0, 0, prof / 2));

	/*
	 * ESCALERA DE PROFUNDIDADES DEL FRENTE. Antes la tapa era una caja de 1,4 mm centrada en
	 * `prof - 0,5`: su cara delantera quedaba a 0,2 mm de la del cuerpo, y sus costados
	 * atravesaban esa misma cara. A la distancia a la que se mira un tablero entero, el buffer
	 * de profundidad no resuelve 0,2 mm, así que las dos caras se turnaban fotograma a fotograma
	 * —el parpadeo de la textura— y el rótulo, a 0,7 mm de la tapa, hacía lo mismo con las letras.
	 * Ahora cada cosa tiene su altura con separaciones de verdad, la tapa es una plancha sin
	 * costados y los rótulos van sesgados hacia la cámara.
	 */
	const Z_TAPA = prof + 0.6;      // plancha frontal, montada sobre la cara del cuerpo
	const Z_SOBRE = prof + 1.4;     // suelo común de todo lo que se monta sobre la tapa
	g.add(plancha(
		Math.max(10, w - 2 * MARGEN_BORNERA - 10), Math.max(10, h - 2 * MARGEN_BORNERA - 10),
		M.plastico(0x22282d, 0.65), 0, 0, Z_TAPA,
	));

	// Las posiciones se calculan UNA vez y las comparten todas las borneras del aparato.
	const posiciones = posicionesDeTerminales(d, w, h);
	for (const bloque of d.terminales ?? []) bloqueTerminales3D(g, posiciones, bloque, w, h, prof);

	const util = Math.min(w, h) - 2 * MARGEN_BORNERA - 10;
	const rasgos = d.rasgosFrente ?? {};

	// Pantalla de servicio, cuando el equipo la lleva.
	const altoDisplay = Math.min(h * 0.26, 28);
	const yDisplay = -util * 0.06;
	if (rasgos.display) {
		// La pantalla del controlador se ilumina cuando el equipo tiene tensión, no siempre.
		const pantalla = caja(
			Math.min(w * 0.42, 48), altoDisplay, 1.6,
			new THREE.MeshStandardMaterial({ color: 0x0d2b20, emissive: 0x39e08a, emissiveIntensity: 0, roughness: 0.3 }),
			0, yDisplay, Z_SOBRE + 0.8,
		);
		pantalla.userData.pieza = 'pantalla';
		pantalla.userData.colorPropio = 0x39e08a;
		g.add(pantalla);
	}

	// Marca y modelo impresos en la cara: es como se identifica el equipo en obra. Va SIEMPRE
	// por encima de la pantalla, para que no se solapen ni se tapen entre ellos.
	const anchoEt = Math.min(w * 0.55, 70);
	const altoEt = Math.max(5, anchoEt * 0.14);
	const et = etiquetaImpresa(`${d.fabricante ?? ''} ${ref}`.trim(), anchoEt, altoEt, '#20262b', '#dfe6ea');
	et.position.set(0, rasgos.display
		? Math.min(h / 2 - MARGEN_BORNERA - altoEt, yDisplay + altoDisplay / 2 + altoEt / 2 + 1.5)
		: util * 0.16, Z_SOBRE + 0.2);
	g.add(et);

	// LEDs de estado (encendidos los primeros, como un equipo alimentado y comunicando).
	const leds = Math.min(10, rasgos.leds ?? 4);
	for (let i = 0; i < leds; i++) {
		const encendido = i < Math.ceil(leds / 2);
		const led = new THREE.MeshStandardMaterial({
			color: encendido ? 0x21d07a : 0x2a3138,
			emissive: encendido ? 0x21d07a : 0x000000,
			emissiveIntensity: encendido ? 0.85 : 0,
			roughness: 0.3,
		});
		g.add(caja(2.4, 1.6, 1.2, led, -util * 0.3 + i * 5, rasgos.display ? -util * 0.3 : -util * 0.05, Z_SOBRE + 0.6));
	}

	// Puertos RJ-45 en la cara: solo los que el equipo tiene de verdad.
	const puertos = (rasgos.puertosIP ?? 0) + (rasgos.puertosRS485 ?? 0);
	const puerto = M.plastico(0x14181b, 0.7);
	for (let i = 0; i < Math.min(4, puertos); i++) {
		g.add(caja(13, 11, 2.4, puerto, util * 0.12 + i * 15, -util * 0.3, Z_SOBRE + 1.2));
	}
	return prof;
}

function generico(g: THREE.Group, w: number, h: number, color: number): number {
	const prof = 55;
	g.add(caja(w, h, prof, M.plastico(color), 0, 0, prof / 2));
	filaBornes(g, Math.max(2, Math.floor(w / 14)), w * 0.9, -h / 2 + 5, prof - 8);
	return prof;
}

/**
 * Aparato de mando de puerta (pulsador, seta de emergencia, selector, piloto): cuerpo trasero
 * cuadrado con los contactos y, al frente, el aro metálico y la cabeza redonda que es lo que
 * se ve desde fuera del tablero.
 */
function mando(g: THREE.Group, w: number, h: number, color: number, forma: 'seta' | 'pulsador' | 'piloto' | 'selector'): number {
	const prof = 46;
	const cuerpo = Math.min(w, h) * 0.8;
	g.add(caja(cuerpo, cuerpo, prof - 12, M.plastico(0x2a2f33), 0, 0, (prof - 12) / 2));
	// Aro metálico de fijación a la puerta.
	const aro = new THREE.Mesh(
		new THREE.CylinderGeometry(cuerpo * 0.52, cuerpo * 0.52, 4, 24),
		M.metal(0xb6bcc2),
	);
	aro.rotation.x = Math.PI / 2;
	aro.position.set(0, 0, prof - 10);
	g.add(aro);

	const r = cuerpo * (forma === 'seta' ? 0.58 : 0.36);
	const alto = forma === 'seta' ? 12 : forma === 'selector' ? 5 : 8;
	/*
	 * La cabeza del mando se marca como pieza para que HAGA lo que hace la de verdad: el pulsador
	 * se hunde mientras está apretado y el piloto se enciende con SU color —rojo el de defecto,
	 * verde el de marcha—, no con un amarillo igual para todo.
	 */
	const cabeza = new THREE.Mesh(new THREE.CylinderGeometry(r, r * (forma === 'seta' ? 0.8 : 1), alto, 24),
		forma === 'piloto'
			? new THREE.MeshStandardMaterial({ color, roughness: 0.25, transparent: true, opacity: 0.92 })
			: M.plastico(color));
	cabeza.rotation.x = Math.PI / 2;
	cabeza.position.set(0, 0, prof - 8 + alto / 2);
	cabeza.userData.pieza = forma === 'piloto' ? 'lente' : 'boton';
	cabeza.userData.colorPropio = color;
	g.add(cabeza);

	if (forma === 'selector') { // maneta de la maneta giratoria
		const maneta = new THREE.Mesh(new THREE.BoxGeometry(r * 1.9, r * 0.5, 4), M.plastico(0x1b1f22));
		maneta.position.set(0, 0, prof - 8 + alto + 1.5);
		maneta.rotation.z = -Math.PI / 6;
		maneta.userData.pieza = 'maneta';
		g.add(maneta);
	}
	filaBornes(g, 4, cuerpo * 0.8, -h / 2 + 5, 6);
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
	const color = d.colorCuerpo
		? new THREE.Color(d.colorCuerpo).getHex()
		: COLOR_TIPO[d.tipo] ?? COLOR_TIPO.otro;
	const ref = d.referencia ?? d.tipo;

	if (d.imagen) {
		const profundidad = imagenReferencia(g, d, w, h);
		g.traverse((o) => { o.userData.dispositivoId = d.id; });
		return { grupo: g, profundidad };
	}

	// Aparato descrito por su ficha de datos (controladores reales): un único constructor
	// genérico lo dibuja con su huella, su fondo y sus borneras de verdad.
	if (d.terminales?.length) {
		const profundidad = controlador(g, d, w, h, color, ref);
		g.traverse((o) => {
			o.userData.dispositivoId = d.id;
			if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
		});
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
		case 'pulsador':
			profundidad = mando(g, w, h, color, w >= 38 ? 'seta' : 'pulsador');
			break;
		case 'selector':
			profundidad = mando(g, w, h, color, 'selector');
			break;
		case 'piloto':
			profundidad = mando(g, w, h, color, 'piloto');
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
