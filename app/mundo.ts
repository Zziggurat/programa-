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
	ColumnaPlanta, EquipoPlanta, FamiliaObra, Infraestructura, OBRA, ObraPlanta, SISTEMAS,
	TrazaPlanta,
} from '../src/modelo/infraestructura.js';
import { EstadoObra } from '../src/motores/levantamiento.js';
import { ModoColor, canalesDe, colorDeEquipo, medirTirada } from '../src/motores/planta.js';
import { ejesDeLaPlanta } from '../src/motores/ejes-planta.js';

/* --------------------------------- Construcción --------------------------------- */

/** Un tramo de obra a la altura de una persona, para no aparecer dentro de él. */
interface Obstaculo { ax: number; az: number; bx: number; bz: number }

const COLOR_UMA = 0x8b98a5;
const COLOR_VEX = 0x6b7d8f;
// La losa era casi negra y al pasear no se distinguía el suelo de la nada. Una cubierta es una
// membrana o un hormigón gris: se ve por dónde se pisa.
const COLOR_CUBIERTA = 0x2b3138;

interface Mundo {
	escena: THREE.Scene;
	camara: THREE.PerspectiveCamera;
	orbita: OrbitControls;
	equipos: THREE.Group;
	instalaciones: THREE.Group;
	/** Barandas, petos, muros, lucernarios, escaleras y pilares de la cubierta. */
	obra: THREE.Group;
	/** La losa: el suelo sobre el que se mide y se pincha. */
	losa: THREE.Mesh;
	/** Tramos de obra que llegan a la altura de una persona, en coordenadas de escena. */
	obstaculos: Obstaculo[];
	/** Centro de la planta en coordenadas de escena, para encuadrar. */
	centro: THREE.Vector3;
	tamano: { ancho: number; fondo: number };
	/** Los datos de los que salió, para poder recolorear sin volver a montarla. */
	inf: Infraestructura;
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

/**
 * ¿Cómo es de verdad esta instalación? Es lo que decide la forma que se dibuja.
 *
 * En una cubierta se distinguen a simple vista por su FORMA antes que por su color: el conducto de
 * aire es una caja de chapa ancha y baja, la cañería es un tubo redondo delgado, la bandeja es una
 * canal plana. Dibujarlo todo como el mismo tubo gordo era lo que hacía que no se entendiera nada.
 */
const FORMA: Record<string, 'conducto' | 'canaleria' | 'bandeja'> = {
	inyeccion: 'conducto',
	extraccion: 'conducto',
	agua: 'canaleria',
	'agua-fria': 'canaleria',
	bus: 'canaleria',
	bandeja: 'bandeja',
};

/**
 * Material según de qué está hecha la cosa.
 *
 * La chapa galvanizada de un conducto brilla y es casi gris: el color del sistema entra como TINTE,
 * no como pintura plana. Una cañería aislada es mate. Así el color sigue diciendo qué es cada cosa
 * —que es para lo que está— sin que la cubierta parezca un juguete de plastilina.
 */
function materialSistema(color: number, forma: 'conducto' | 'canaleria' | 'bandeja'): THREE.MeshStandardMaterial {
	const c = new THREE.Color(color);
	if (forma === 'conducto') {
		// Chapa: se le baja el color hacia el gris del galvanizado y se le sube el brillo.
		c.lerp(new THREE.Color(0xb8c2cc), 0.45);
		return new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.75 });
	}
	if (forma === 'bandeja') {
		c.lerp(new THREE.Color(0x9aa4ae), 0.3);
		return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.6 });
	}
	// Cañería: aislamiento mate, el color se conserva casi entero porque es lo que la identifica.
	c.lerp(new THREE.Color(0xced4da), 0.12);
	return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.05 });
}

/**
 * Geometría de un tramo, con su SECCIÓN REAL.
 *
 * El tamaño estaba mal, y mucho: se usaba `max(ancho, alto)` como RADIO, así que un conducto de
 * 600×400 se dibujaba de 600 de radio —1.200 mm de through, el doble de lo que mide— y encima
 * redondo. La bandeja de 300×100 salía de 600 de ancha. De ahí que todo pareciera la misma
 * salchicha gorda de colores.
 *
 * Los conductos y las bandejas se montan como una cadena de cajas, una por tramo recto, girada
 * hacia donde va: es rectangular de verdad, ancha y baja, con la cara plana hacia arriba. Las
 * cañerías siguen siendo un tubo, pero redondo de verdad y del diámetro que toca.
 */
function geometriaTraza(
	t: TrazaPlanta, aEscena: ReturnType<typeof hacerConversor>,
): THREE.BufferGeometry | undefined {
	const pts = t.puntos.map(([x, y]) => aEscena(x, y, t.z));
	// Puntos repetidos rompen la curva; y con menos de dos no hay tramo.
	const limpios = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.01);
	if (limpios.length < 2) return undefined;
	const forma = FORMA[t.sistema] ?? 'canaleria';

	const piezas: THREE.BufferGeometry[] = [];

	if (forma === 'canaleria') {
		const curva = new THREE.CatmullRomCurve3(limpios, false, 'catmullrom', 0.02);
		// Redondo DE VERDAD: con seis lados se veía el hexágono. Y el radio es la mitad del
		// diámetro, no el diámetro entero.
		const radio = Math.max(0.02, t.ancho / 2000);
		const tubo = new THREE.TubeGeometry(
			curva, Math.min(90, Math.max(2, limpios.length * 2)), radio, 10, false,
		);
		tubo.deleteAttribute('uv');
		piezas.push(tubo);
		piezas.push(...soportes(limpios, radio, 0.05));
		return fusionar(piezas);
	}

	const ancho = Math.max(0.05, t.ancho / 1000);
	const alto = Math.max(0.04, t.alto / 1000);
	for (let i = 1; i < limpios.length; i++) {
		const a = limpios[i - 1];
		const b = limpios[i];
		const largo = a.distanceTo(b);
		if (largo < 0.02) continue;
		// Se alarga media sección por cada punta para que las esquinas no queden abiertas.
		const g = new THREE.BoxGeometry(largo + ancho * 0.5, alto, ancho);
		g.deleteAttribute('uv');
		g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(a.z - b.z, b.x - a.x)));
		const medio = a.clone().add(b).multiplyScalar(0.5);
		g.translate(medio.x, medio.y, medio.z);
		piezas.push(g);
	}
	piezas.push(...soportes(limpios, alto / 2, forma === 'bandeja' ? 0.05 : 0.07));
	return fusionar(piezas);
}

/**
 * Los SOPORTES que apean la instalación sobre la cubierta.
 *
 * Sin ellos los conductos salían flotando en el aire —a 4,20 m, sobre máquinas de 2,20— y parecían
 * losas de colores colgadas de la nada; era buena parte del «no se entiende nada». En una cubierta
 * de verdad todo va apeado con perfiles cada pocos metros, y en cuanto se ven los pies el cerebro
 * entiende de golpe que eso es una instalación montada por encima y a qué altura va.
 *
 * Se ponen a intervalos, no en cada vértice: un tramo del plano puede traer veinte puntos en dos
 * metros y saldría una empalizada.
 */
function soportes(
	puntos: THREE.Vector3[], medioAlto: number, grueso: number, cada = 6,
): THREE.BufferGeometry[] {
	const out: THREE.BufferGeometry[] = [];
	let desdeElUltimo = cada; // el primer punto ya lleva soporte
	for (let i = 1; i < puntos.length; i++) {
		const a = puntos[i - 1];
		const b = puntos[i];
		const largo = a.distanceTo(b);
		desdeElUltimo += largo;
		if (desdeElUltimo < cada) continue;
		desdeElUltimo = 0;
		const p = a.clone().add(b).multiplyScalar(0.5);
		const altura = p.y - medioAlto;
		if (altura < 0.25) continue;      // va casi en el suelo: no hay nada que apear
		const g = new THREE.BoxGeometry(grueso, altura, grueso);
		g.deleteAttribute('uv');
		g.translate(p.x, altura / 2, p.z);
		out.push(g);
	}
	return out;
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
	/*
	 * Del DIBUJO al EJE, antes de tocar nada del 3D.
	 *
	 * Lo que trae el plano son las líneas dibujadas, y un conducto se dibuja por sus DOS LADOS más
	 * sus piezas y sus rejillas. Tomando cada línea por un conducto salían cientos de trozos
	 * sueltos que no conectaban con nada —era la pregunta de quien lo probó: «¿por qué está todo
	 * separado?»—. `ejesDeLaPlanta` empareja los lados, traza el eje por el medio y cose los tramos
	 * seguidos, así que aquí ya llegan recorridos de verdad y con el ancho MEDIDO del plano.
	 */
	for (const t of ejesDeLaPlanta(trazas as unknown as Parameters<typeof ejesDeLaPlanta>[0]) as unknown as TrazaPlanta[]) {
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
		const malla = new THREE.Mesh(fusionada, materialSistema(info.color, FORMA[sistema] ?? 'canaleria'));
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

/**
 * LA CUBIERTA EN SÍ: barandas, petos, muros, lucernarios, escaleras y estructura.
 *
 * Antes esto no se dibujaba y el visor enseñaba máquinas y tubos flotando sobre una losa lisa.
 * Una cubierta de aeropuerto no es una losa lisa: tiene un peto por todo el borde, barandas donde
 * se trabaja, casetas, lucernarios por los que entra la luz al terminal y escaleras de acceso. Y
 * todo eso está dibujado en el plano, debajo de las capas de clima —solo había que mirarlo—.
 *
 * El recorrido en planta de cada tramo es el del plano. La altura y el grosor, no: el plano
 * tampoco los trae aquí, así que salen de reglas de proyecto igual que las de los conductos, y el
 * aviso del visor lo sigue diciendo.
 */
function construirObra(
	obra: ObraPlanta[], aEscena: ReturnType<typeof hacerConversor>, obstaculos: Obstaculo[],
): THREE.Group {
	const grupo = new THREE.Group();
	const porFamilia = new Map<FamiliaObra, THREE.BufferGeometry[]>();
	for (const o of obra) {
		const alto = o.alto / 1000;
		const grosor = Math.max(0.04, o.grosor / 1000);
		for (let i = 1; i < o.puntos.length; i++) {
			const a = aEscena(o.puntos[i - 1][0], o.puntos[i - 1][1], 0);
			const b = aEscena(o.puntos[i][0], o.puntos[i][1], 0);
			const largo = a.distanceTo(b);
			if (largo < 0.2) continue;
			// Lo que llega a la altura de una persona se apunta como obstáculo, para no aparecer
			// dentro de un muro al empezar el paseo.
			if (alto > 0.9) obstaculos.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
			// Un tramo es un prisma tumbado sobre la cubierta y girado hacia donde va.
			const g = new THREE.BoxGeometry(largo, alto, grosor);
			g.deleteAttribute('uv');
			const medio = a.clone().add(b).multiplyScalar(0.5);
			g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(a.z - b.z, b.x - a.x)));
			g.translate(medio.x, alto / 2, medio.z);
			if (!porFamilia.has(o.familia)) porFamilia.set(o.familia, []);
			porFamilia.get(o.familia)!.push(g);
		}
	}
	for (const [familia, geos] of porFamilia) {
		const info = OBRA[familia];
		const fusionada = fusionar(geos);
		if (!fusionada) continue;
		const malla = new THREE.Mesh(fusionada, new THREE.MeshStandardMaterial({
			color: info.color, roughness: familia === 'lucernario' ? 0.15 : 0.85,
			metalness: familia === 'baranda' || familia === 'acero' ? 0.7 : 0.05,
			transparent: !!info.translucido, opacity: info.translucido ? 0.42 : 1,
		}));
		malla.receiveShadow = true;
		malla.castShadow = familia !== 'lucernario';
		malla.userData.familia = familia;
		malla.userData.tramos = geos.length;
		grupo.add(malla);
	}
	return grupo;
}

/**
 * Los pilares. Posición y RADIO son los del plano —eso sí lo trae, y por eso unos son más
 * gruesos que otros—; la altura es de proyecto, como todo lo demás en Z.
 */
function construirColumnas(
	columnas: ColumnaPlanta[], aEscena: ReturnType<typeof hacerConversor>,
): THREE.Mesh | undefined {
	const geos: THREE.BufferGeometry[] = [];
	for (const c of columnas) {
		const p = aEscena(c.x, c.y, 0);
		const alto = (c.alto ?? 7800) / 1000;
		const g = new THREE.CylinderGeometry(c.r / 1000, (c.r * 1.12) / 1000, alto, 12);
		g.deleteAttribute('uv');
		g.translate(p.x, alto / 2, p.z);
		geos.push(g);
	}
	const fusionada = fusionar(geos);
	if (!fusionada) return undefined;
	const malla = new THREE.Mesh(fusionada, new THREE.MeshStandardMaterial({
		color: 0x9aa4ae, roughness: 0.8, metalness: 0.1,
	}));
	malla.castShadow = true;
	malla.userData.columnas = columnas.length;
	return malla;
}

/** Una máquina: su caja, y un cartel con su marcado que siempre mira a la cámara. */
function construirEquipo(e: EquipoPlanta, aEscena: ReturnType<typeof hacerConversor>): THREE.Group | undefined {
	if (e.x === null || e.y === null) return undefined;
	const g = new THREE.Group();
	const an = (e.ancho ?? 2000) / 1000;
	const fo = (e.fondo ?? 2000) / 1000;
	const al = (e.alto ?? 2000) / 1000;
	const esUma = e.tipo === 'uma';
	/*
	 * Una UMA no es una caja lisa: se apoya en una BANCADA sobre la cubierta, lleva tapa de
	 * cubrición con vuelo y los paneles se ven por sus juntas. Con la caja pelada, en el paseo
	 * costaba saber si aquello era un equipo, una caseta o un bulto del plano. Son tres piezas
	 * más por máquina y hay 41 situadas: no se nota en el paseo y se entiende a la primera.
	 */
	const ALTO_BANCADA = 0.28;
	const cuerpoAlto = Math.max(0.4, al - ALTO_BANCADA);
	const cuerpo = new THREE.Mesh(
		new THREE.BoxGeometry(an, cuerpoAlto, fo),
		new THREE.MeshStandardMaterial({
			color: esUma ? COLOR_UMA : COLOR_VEX, roughness: 0.5, metalness: 0.55,
		}),
	);
	cuerpo.position.y = ALTO_BANCADA + cuerpoAlto / 2;
	cuerpo.castShadow = true;
	g.add(cuerpo);

	// Bancada: perfil oscuro y algo más estrecho, para que el equipo no nazca del suelo.
	const bancada = new THREE.Mesh(
		new THREE.BoxGeometry(an * 0.94, ALTO_BANCADA, fo * 0.94),
		new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.9, metalness: 0.2 }),
	);
	bancada.position.y = ALTO_BANCADA / 2;
	bancada.castShadow = true;
	g.add(bancada);

	// Tapa con vuelo: la línea de sombra que remata arriba es lo que hace que se lea como techo.
	const tapa = new THREE.Mesh(
		new THREE.BoxGeometry(an + 0.12, 0.09, fo + 0.12),
		new THREE.MeshStandardMaterial({ color: 0xb0bac4, roughness: 0.4, metalness: 0.6 }),
	);
	tapa.position.y = al + 0.045;
	tapa.castShadow = true;
	g.add(tapa);

	// Juntas de los paneles registrables, en el frente: dan escala y dicen por dónde se abre.
	const paneles = Math.max(2, Math.min(6, Math.round(an / 1.2)));
	for (let i = 1; i < paneles; i++) {
		const junta = new THREE.Mesh(
			new THREE.BoxGeometry(0.03, cuerpoAlto * 0.86, 0.02),
			new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.9 }),
		);
		junta.position.set(-an / 2 + (an * i) / paneles, ALTO_BANCADA + cuerpoAlto / 2, fo / 2 + 0.012);
		g.add(junta);
	}
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
	const rotulo = cartel(e.tag, al + 0.9, e.tagSeguro);
	g.add(rotulo);
	// Anillo en el suelo: se enciende cuando la máquina está elegida para llevarla al tablero. Un
	// resalte en el cuerpo se pierde entre las demás; un aro en la losa se ve desde arriba.
	const aro = new THREE.Mesh(
		new THREE.RingGeometry(Math.max(an, fo) * 0.62, Math.max(an, fo) * 0.62 + 0.35, 28),
		new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
	);
	aro.rotation.x = -Math.PI / 2;
	aro.position.y = 0.08;
	aro.visible = false;
	g.add(aro);
	g.position.copy(aEscena(e.x, e.y, 0));
	g.userData.tag = e.tag;
	g.userData.equipo = e;
	g.userData.cuerpo = cuerpo;
	g.userData.rotulo = rotulo;
	g.userData.aro = aro;
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

/**
 * Cúpula de cielo. Una cubierta está A LA INTEMPERIE: sin cielo, al levantar la vista se veía
 * un vacío negro y el sitio parecía un sótano. Es una esfera del revés con un degradado de
 * anochecer —del azul del horizonte al casi negro del cenit—, que además sienta bien con el
 * resto del programa, que es oscuro.
 */
function cieloDeAnochecer(radio: number): THREE.Mesh {
	const lienzo = document.createElement('canvas');
	lienzo.width = 4; lienzo.height = 256;
	const c = lienzo.getContext('2d')!;
	const g = c.createLinearGradient(0, 0, 0, 256);
	g.addColorStop(0, '#0a0e14');    // cenit
	g.addColorStop(0.55, '#16202c');
	g.addColorStop(0.82, '#243342');
	g.addColorStop(1, '#31445a');    // horizonte
	c.fillStyle = g;
	c.fillRect(0, 0, 4, 256);
	const tex = new THREE.CanvasTexture(lienzo);
	tex.colorSpace = THREE.SRGBColorSpace;
	const cielo = new THREE.Mesh(
		new THREE.SphereGeometry(Math.max(400, radio * 1.6), 24, 16),
		new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
	);
	cielo.userData.cielo = true;
	return cielo;
}

export function construirMundo(inf: Infraestructura, lienzo: HTMLCanvasElement): Mundo {
	const aEscena = hacerConversor(inf);
	const escena = new THREE.Scene();
	escena.background = new THREE.Color(0x0c1015);
	// La niebla se funde con el horizonte del cielo, no con el negro: si no, a media distancia
	// las máquinas se disuelven en un gris que no se parece a estar a la intemperie.
	escena.fog = new THREE.Fog(0x243342, 110, 420);
	escena.add(cieloDeAnochecer(Math.max(inf.zona.x1 - inf.zona.x0, inf.zona.y1 - inf.zona.y0) / 1000));

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
	// La rejilla va 4 cm sobre la losa. A 2 cm se peleaban a lo lejos: en una planta de 240 m, a
	// 200 de distancia el buffer de profundidad no distingue dos centímetros.
	const rejilla = new THREE.GridHelper(Math.max(ancho, fondo) + 20, Math.round((Math.max(ancho, fondo) + 20) / 5),
		0x2a3138, 0x1c2126);
	rejilla.position.y = 0.04;
	escena.add(rejilla);

	escena.add(new THREE.HemisphereLight(0xa9c0d6, 0x2a3138, 1.25));
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

	// La cubierta que hay debajo de las instalaciones: petos, barandas, casetas, lucernarios,
	// escaleras y pilares. Es lo que hace que al pasear se reconozca el sitio.
	const obstaculos: Obstaculo[] = [];
	const obra = construirObra(inf.obra ?? [], aEscena, obstaculos);
	escena.add(obra);
	const columnas = construirColumnas(inf.columnas ?? [], aEscena);
	if (columnas) obra.add(columnas);
	for (const c of inf.columnas ?? []) {
		const p = aEscena(c.x, c.y, 0);
		obstaculos.push({ ax: p.x, az: p.z, bx: p.x, bz: p.z });
	}

	const equipos = new THREE.Group();
	for (const e of inf.equipos) {
		const g = construirEquipo(e, aEscena);
		if (g) equipos.add(g);
	}
	escena.add(equipos);

	// `near` a 30 cm y no a 10: a la escala de esta planta, un plano cercano diminuto gasta toda
	// la precisión de profundidad cerca de la cámara y deja parpadeando lo que se ve al fondo.
	const camara = new THREE.PerspectiveCamera(58, 1, 0.3, 1200);
	const orbita = new OrbitControls(camara, lienzo);
	orbita.enableDamping = true;
	orbita.dampingFactor = 0.09;
	orbita.maxPolarAngle = Math.PI / 2.05;   // no meter la cámara bajo la losa

	return { escena, camara, orbita, equipos, instalaciones, obra, losa, obstaculos,
		centro: new THREE.Vector3(0, 0, 0), tamano: { ancho, fondo }, inf };
}

/* --------------------- Buscar, filtrar y colorear las máquinas --------------------- */

/**
 * Pinta cada máquina por el criterio elegido. No reconstruye nada: cada equipo tiene su propio
 * material, así que basta con cambiarle el color —de otro modo, recolorear 129 máquinas obligaría
 * a rehacer la escena entera y el visor daría un tirón cada vez que se toca el selector.
 */
export function pintarPorModo(
	m: Mundo, modo: ModoColor, estados?: ReadonlyMap<string, EstadoObra>,
): void {
	const canales = canalesDe(m.inf);
	for (const g of m.equipos.children) {
		const e = g.userData.equipo as EquipoPlanta;
		const cuerpo = g.userData.cuerpo as THREE.Mesh | undefined;
		if (!e || !cuerpo) continue;
		const color = colorDeEquipo(e, modo, canales, estados);
		(cuerpo.material as THREE.MeshStandardMaterial).color.setHex(color);
		cuerpo.userData.baseColor = color;
	}
}

/**
 * Enseña solo lo que se ha buscado. Las que no encajan NO se esconden: se apagan.
 *
 * Esconderlas dejaría huecos en la cubierta y quien mira perdería la referencia de dónde está;
 * apagarlas —translúcidas, sin rótulo— deja el sitio reconocible y hace que las que se buscan
 * salten a la vista. `visibles` a undefined significa «sin filtro»: todo vuelve a la normalidad.
 */
export function filtrarEquipos(m: Mundo, visibles?: ReadonlySet<string>): void {
	for (const g of m.equipos.children) {
		const dentro = !visibles || visibles.has(g.userData.tag as string);
		const rotulo = g.userData.rotulo as THREE.Sprite | undefined;
		if (rotulo) rotulo.visible = dentro;
		g.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			const mat = o.material as THREE.Material & { opacity: number; transparent: boolean };
			if (o === g.userData.aro) return;
			mat.transparent = !dentro;
			mat.opacity = dentro ? 1 : 0.16;
			mat.depthWrite = dentro;
			mat.needsUpdate = true;
		});
	}
}

/** Enciende el aro de suelo de las máquinas elegidas para llevar al tablero. */
export function marcarElegidos(m: Mundo, tags: ReadonlySet<string>): void {
	for (const g of m.equipos.children) {
		const aro = g.userData.aro as THREE.Mesh | undefined;
		if (aro) aro.visible = tags.has(g.userData.tag as string);
	}
}

/* ------------------------------- La cinta métrica ------------------------------- */

/** Punto de la cubierta bajo el puntero: sobre una máquina, sobre la obra o sobre la losa. */
export function puntoEnPixel(
	m: Mundo, lienzo: HTMLCanvasElement, cx: number, cy: number,
): THREE.Vector3 | undefined {
	const r = lienzo.getBoundingClientRect();
	const puntero = new THREE.Vector2(
		((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1,
	);
	const rayo = new THREE.Raycaster();
	rayo.setFromCamera(puntero, m.camara);
	const golpes = rayo.intersectObjects([m.equipos, m.obra, m.losa], true);
	return golpes[0]?.point.clone();
}

/**
 * Cinta métrica: marcar puntos en la cubierta y saber cuánto cable hay que pedir.
 *
 * Es lo que se hace subiendo con una cinta y una libreta, y de lo que sale el número que se pide
 * a bodega. Por eso no da solo la recta: da también el recorrido en ortogonal, que es por donde
 * va la bandeja, la subida y la bajada, y el total con su reserva. La recta sola engaña, y quien
 * pide por la recta se queda corto.
 */
export function crearCinta(m: Mundo) {
	const grupo = new THREE.Group();
	grupo.name = 'cinta';
	m.escena.add(grupo);
	const puntos: THREE.Vector3[] = [];
	/** Marcado de la máquina en la que se puso cada punto, si se puso en una. */
	const nombres: (string | undefined)[] = [];

	function limpiar(): void {
		for (const o of [...grupo.children]) {
			grupo.remove(o);
			if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
			if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); }
		}
	}

	function redibujar(): void {
		limpiar();
		const matHito = new THREE.MeshBasicMaterial({ color: 0xffd43b, depthTest: false });
		for (const p of puntos) {
			const hito = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), matHito);
			hito.position.copy(p);
			hito.renderOrder = 3;
			grupo.add(hito);
		}
		for (let i = 1; i < puntos.length; i++) {
			const a = puntos[i - 1];
			const b = puntos[i];
			// El tramo se dibuja EN ORTOGONAL, como iría la bandeja, no en diagonal: así se ve por
			// dónde se ha contado el metraje y el número de la etiqueta no sale de la nada.
			const codo = new THREE.Vector3(b.x, (a.y + b.y) / 2, a.z);
			for (const [p, q] of [[a, codo], [codo, b]] as [THREE.Vector3, THREE.Vector3][]) {
				if (p.distanceTo(q) < 0.05) continue;
				grupo.add(tramoDeCinta(p, q));
			}
			grupo.add(etiquetaCinta(
				`${(Math.abs(b.x - a.x) + Math.abs(b.z - a.z)).toFixed(1)} m`,
				codo.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 1.2),
			));
		}
		const med = medirTirada(puntos);
		if (med) {
			grupo.add(etiquetaCinta(
				`total ${med.recorrido.toFixed(1)} m · pedir ${med.cablePedido} m`,
				puntos[puntos.length - 1].clone().setY(puntos[puntos.length - 1].y + 3),
				true,
			));
		}
	}

	return {
		anadir(p: THREE.Vector3, etiqueta?: string): void {
			puntos.push(p);
			nombres.push(etiqueta);
			redibujar();
		},
		deshacer(): void { puntos.pop(); nombres.pop(); redibujar(); },
		/**
		 * Quita UN punto cualquiera, no solo el último.
		 *
		 * Midiendo una tirada larga uno se equivoca en el tercer punto de doce, y con solo «quitar
		 * el último» había que deshacer nueve buenos para arreglar uno malo. Eso hacía que medir
		 * fuera un incordio.
		 */
		quitar(indice: number): void {
			if (indice < 0 || indice >= puntos.length) return;
			puntos.splice(indice, 1);
			nombres.splice(indice, 1);
			redibujar();
		},
		reiniciar(): void { puntos.length = 0; nombres.length = 0; limpiar(); },
		medida: () => medirTirada(puntos),
		cuantos: () => puntos.length,
		/** Los puntos marcados, con el marcado de la máquina si se pinchó en una. */
		listado: (): { indice: number; nombre?: string; x: number; z: number }[] =>
			puntos.map((p, i) => ({ indice: i, nombre: nombres[i], x: p.x, z: p.z })),
		/** De dónde a dónde va la tirada, con el marcado de las máquinas si se pincharon. */
		extremos: (): string[] => nombres.filter((x): x is string => !!x),
		visible(v: boolean): void { grupo.visible = v; },
	};
}

/** Un tramo de la cinta: un tubo fino y amarillo que se ve por delante de todo. */
function tramoDeCinta(a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh {
	const largo = a.distanceTo(b);
	const g = new THREE.CylinderGeometry(0.13, 0.13, largo, 8);
	const malla = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd43b, depthTest: false }));
	malla.position.copy(a).lerp(b, 0.5);
	malla.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
	malla.renderOrder = 3;
	return malla;
}

/** Etiqueta flotante de la cinta, con el número que se lee desde cualquier ángulo. */
function etiquetaCinta(texto: string, donde: THREE.Vector3, destacada = false): THREE.Sprite {
	const lienzo = document.createElement('canvas');
	lienzo.width = 512; lienzo.height = 128;
	const c = lienzo.getContext('2d')!;
	c.fillStyle = destacada ? 'rgba(255,212,59,.94)' : 'rgba(12,16,20,.88)';
	c.beginPath(); c.roundRect(6, 30, 500, 68, 12); c.fill();
	c.strokeStyle = '#ffd43b'; c.lineWidth = 3; c.stroke();
	c.fillStyle = destacada ? '#1b1400' : '#ffd43b';
	c.font = `bold ${destacada ? 40 : 44}px system-ui, sans-serif`;
	c.textAlign = 'center'; c.textBaseline = 'middle';
	c.fillText(texto, 256, 64);
	const tex = new THREE.CanvasTexture(lienzo);
	const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
	sp.scale.set(destacada ? 6 : 4.4, destacada ? 1.5 : 1.1, 1);
	sp.position.copy(donde);
	sp.renderOrder = 4;
	return sp;
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
 * Puesto en el borde de una planta de 284 m, lo primero que se ve es una línea de cosas diminutas
 * en el horizonte y da la impresión de que no hay nada. Empezar a ocho metros de una UMA, mirándola,
 * enseña de entrada la escala real: una máquina de siete metros de largo por encima de la cabeza.
 */
export function ponerVistaPaseo(m: Mundo): void {
	m.orbita.enabled = false;      // en paseo manda el teclado y el ratón libre
	const maquinas = m.equipos.children;
	if (maquinas.length === 0) {
		m.camara.position.set(0, 1.7, m.tamano.fondo * 0.42);
		m.camara.lookAt(0, 1.7, 0);
		return;
	}
	/*
	 * SE EMPIEZA EL PASEO MIRANDO UNA MÁQUINA, Y VIÉNDOLA.
	 *
	 * Antes se salía siempre a nueve metros en diagonal de la máquina de en medio. Con la cubierta
	 * lisa aquello valía; en cuanto se dibujaron los muros y las casetas, la mitad de las veces se
	 * empezaba con la cara contra el hormigón —el sitio estaba libre, pero la máquina quedaba al
	 * otro lado de una pared—. Así que ahora se exige lo mismo que exigiría cualquiera: sitio
	 * despejado donde ponerse Y línea de visión limpia hasta la máquina.
	 */
	const DIST = 10;
	const candidatas = [...maquinas].sort((a, b) => a.position.x - b.position.x)
		.filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 9)) === 0);
	for (const maquina of candidatas) {
		for (let i = 0; i < 8; i++) {
			const a = (i * Math.PI) / 4 + Math.PI / 8;
			const x = maquina.position.x + Math.cos(a) * DIST;
			const z = maquina.position.z + Math.sin(a) * DIST;
			if (distanciaAObra(m, x, z) < 1.6) continue;
			if (haySolido(m, new THREE.Vector3(x, 1.7, z), 2)) continue;
			if (!seVe(m, x, z, maquina.position.x, maquina.position.z)) continue;
			m.camara.position.set(x, 1.7, z);
			m.camara.lookAt(maquina.position.x, 1.7, maquina.position.z);
			return;
		}
	}
	const ultima = maquinas[Math.floor(maquinas.length / 2)];
	m.camara.position.set(ultima.position.x + DIST, 1.7, ultima.position.z + DIST);
	m.camara.lookAt(ultima.position.x, 1.7, ultima.position.z);
}

/** ¿Se llega en línea recta de (x0,z0) a (x1,z1) sin cruzar un muro o una baranda? */
function seVe(m: Mundo, x0: number, z0: number, x1: number, z1: number): boolean {
	for (const o of m.obstaculos) {
		if (o.ax === o.bx && o.az === o.bz) continue;   // un pilar no tapa una máquina
		if (seCruzan(x0, z0, x1, z1, o.ax, o.az, o.bx, o.bz)) return false;
	}
	return true;
}

/** Cruce de dos segmentos en planta, por el signo de los productos vectoriales. */
function seCruzan(
	ax: number, az: number, bx: number, bz: number,
	cx: number, cz: number, dx: number, dz: number,
): boolean {
	const lado = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
		Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
	const d1 = lado(ax, az, bx, bz, cx, cz);
	const d2 = lado(ax, az, bx, bz, dx, dz);
	const d3 = lado(cx, cz, dx, dz, ax, az);
	const d4 = lado(cx, cz, dx, dz, bx, bz);
	return d1 !== d2 && d3 !== d4;
}

/** ¿Hay algo macizo —una máquina— a menos de `radio` del punto? */
function haySolido(m: Mundo, p: THREE.Vector3, radio: number): boolean {
	return m.equipos.children.some((g) => {
		const caja = new THREE.Box3().setFromObject(g);
		return caja.distanceToPoint(p) < radio;
	});
}

/** Distancia en planta al tramo de obra más cercano (muros, barandas, pilares). */
function distanciaAObra(m: Mundo, x: number, z: number): number {
	let min = Infinity;
	for (const o of m.obstaculos) {
		const dx = o.bx - o.ax;
		const dz = o.bz - o.az;
		const largoSq = dx * dx + dz * dz;
		const t = largoSq > 0
			? Math.max(0, Math.min(1, ((x - o.ax) * dx + (z - o.az) * dz) / largoSq))
			: 0;
		const d = Math.hypot(x - (o.ax + t * dx), z - (o.az + t * dz));
		if (d < min) min = d;
	}
	return min;
}

/**
 * Paseo en primera persona: WASD para moverse, ratón para mirar.
 *
 * No usa `PointerLockControls` para no bloquear el cursor sin avisar —eso desconcierta a quien no
 * juega— sino arrastre con el BOTÓN DERECHO. El izquierdo se queda para pinchar una máquina y ver
 * su ficha, que es a lo que se viene: en la cubierta se mira alrededor mucho, pero se consulta
 * más.
 *
 * SENTIDO DEL RATÓN. El convenio es el de cualquier juego en primera persona: arrastrar hacia
 * arriba mira hacia arriba y arrastrar a la derecha mira a la derecha. Antes la vertical estaba
 * al revés por un fallo de signo —se negaba el vector de dirección entero, y con él la altura—.
 * Como el gusto en esto no es universal, queda un interruptor que invierte los dos ejes y se
 * recuerda entre sesiones.
 */
export function crearPaseo(m: Mundo, lienzo: HTMLCanvasElement) {
	const teclas = new Set<string>();
	let girando = false;
	let ultimo = { x: 0, y: 0 };
	let yaw = Math.PI;
	let pitch = 0;
	let invertido = leerInvertido();
	const ALTURA_OJOS = 1.7;
	const VELOCIDAD = 14;          // m/s: se recorren 240 m sin aburrirse
	const SENSIBILIDAD = 0.0035;

	const ANDAR = new Set([
		'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
		'ShiftLeft', 'ShiftRight',
	]);

	/**
	 * QUEDARSE QUIETO. Se sueltan todas las teclas de golpe.
	 *
	 * Hace falta porque una tecla se «queda pulsada» siempre que el navegador se lleva el foco
	 * mientras la tienes apretada: el `keyup` se lo come él y aquí nunca llega. Pasaba de forma
	 * escandalosa al abrirse el menú del botón derecho —seguías andando sin poder parar, aunque
	 * cerraras el menú—, y pasa igual al cambiar de pestaña o de ventana con la W apretada.
	 */
	const pararEnSeco = (): void => { teclas.clear(); girando = false; };

	/** ¿El foco está en un campo de texto? Entonces las teclas son para escribir, no para andar. */
	const escribiendo = (): boolean => {
		const f = document.activeElement as HTMLElement | null;
		return !!f && /^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName);
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (escribiendo()) return;   // tecleando en el buscador no se anda
		teclas.add(e.code);
		// Las flechas hacen desplazarse la página por debajo; andando eso descoloca la pantalla.
		if (ANDAR.has(e.code)) e.preventDefault();
	};
	const onKeyUp = (e: KeyboardEvent) => { teclas.delete(e.code); };
	/*
	 * MIRAR ES EL BOTÓN DERECHO, Y SOLO ÉL. El izquierdo queda libre para lo suyo: pinchar una
	 * máquina y ver su ficha, o marcar un punto de la cinta métrica. Antes miraba con cualquier
	 * botón, así que al girar con el derecho se abría además el menú del navegador («Guardar
	 * imagen como…») encima de la cubierta.
	 */
	/*
	 * EL CURSOR SE CLAVA MIENTRAS SE MIRA.
	 *
	 * Con el botón derecho apretado se pide el bloqueo de puntero del navegador: la flecha
	 * desaparece, el ratón deja de tener borde de pantalla y se puede girar sobre uno mismo sin
	 * levantarlo de la mesa —como en cualquier juego en primera persona—. Al soltar, el cursor
	 * vuelve a aparecer justo donde estaba y se puede pinchar una máquina.
	 *
	 * Bloqueado, la posición del ratón ya no significa nada: lo que dice cuánto se ha movido es
	 * `movementX/movementY`. Y el navegador NO abre su menú mientras hay bloqueo, así que esto
	 * cierra por partida doble el fallo del menú que aparecía al girar.
	 *
	 * Si el bloqueo no se concede —hay navegadores que lo niegan sin gesto previo— se sigue
	 * girando por diferencia de posición, como antes: se pierde el clavado, no la función.
	 */
	const bloqueado = (): boolean => document.pointerLockElement === lienzo;

	const onDown = (e: MouseEvent) => {
		if (e.button !== 2) return;
		e.preventDefault();
		girando = true;
		ultimo = { x: e.clientX, y: e.clientY };
		if (!bloqueado()) void lienzo.requestPointerLock?.();
	};
	const onUp = (e: MouseEvent) => {
		if (e.button !== 2) return;
		girando = false;
		if (bloqueado()) document.exitPointerLock?.();
	};
	const onMove = (e: MouseEvent) => {
		if (!girando) return;
		if (bloqueado()) { mirar(e.movementX, e.movementY); return; }
		mirar(e.clientX - ultimo.x, e.clientY - ultimo.y);
		ultimo = { x: e.clientX, y: e.clientY };
	};
	/* Si el bloqueo se pierde por lo que sea —Esc, cambio de ventana— se deja de girar y de andar:
	   es exactamente el momento en que el navegador puede haberse comido un `keyup`. */
	const onBloqueo = () => { if (!bloqueado()) pararEnSeco(); };
	/*
	 * El menú del navegador se corta EN TODA LA VENTANA mientras se pasea, no solo sobre el 3D.
	 *
	 * Ponerlo únicamente en el lienzo no bastaba: pinchando con el derecho sobre los paneles del
	 * HUD —que son HTML por encima— el menú salía igual, el navegador se quedaba el foco y volvía
	 * el «no puedo parar de caminar». Paseando no hay nada que hacer con ese menú, así que se
	 * quita entero; al salir del paseo vuelve, porque ahí sí puede querer copiarse una imagen.
	 *
	 * Y se para en seco además de cortarlo, por si algún navegador se lleva el foco de todos
	 * modos: soltar las teclas dos veces no cuesta nada, quedarse andando sí.
	 */
	const onMenu = (e: MouseEvent) => { e.preventDefault(); pararEnSeco(); };
	const onSalidaDeFoco = () => pararEnSeco();

	/** Gira la vista por un arrastre de `dx`,`dy` píxeles. Separado para poder probarlo. */
	function mirar(dx: number, dy: number): void {
		const s = invertido ? -1 : 1;
		yaw -= dx * SENSIBILIDAD * s;
		pitch = Math.max(-1.4, Math.min(1.4, pitch - dy * SENSIBILIDAD * s));
	}
	function invertirRaton(valor: boolean): void {
		invertido = valor;
		try { localStorage.setItem('tablero-studio:raton-invertido', valor ? '1' : '0'); } catch { /* sin almacén */ }
	}
	function estaInvertido(): boolean { return invertido; }

	function activar(): void {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		lienzo.addEventListener('mousedown', onDown);
		window.addEventListener('contextmenu', onMenu);
		window.addEventListener('mouseup', onUp);
		window.addEventListener('mousemove', onMove);
		window.addEventListener('blur', onSalidaDeFoco);
		document.addEventListener('visibilitychange', onSalidaDeFoco);
		document.addEventListener('pointerlockchange', onBloqueo);
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
		window.removeEventListener('contextmenu', onMenu);
		window.removeEventListener('mouseup', onUp);
		window.removeEventListener('mousemove', onMove);
		window.removeEventListener('blur', onSalidaDeFoco);
		document.removeEventListener('visibilitychange', onSalidaDeFoco);
		document.removeEventListener('pointerlockchange', onBloqueo);
		if (bloqueado()) document.exitPointerLock?.();
		pararEnSeco();
	}
	function paso(dt: number): void {
		// Ojo con el signo: solo la horizontal va negada. Negar el vector entero —como se hacía—
		// invierte también la altura y deja el «arriba es abajo» que se veía al pasear.
		const dir = new THREE.Vector3(
			-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
		);
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
	/** ¿Hay alguna tecla de movimiento apretada? Lo consultan las pruebas del «no puedo parar». */
	function andando(): boolean {
		for (const t of teclas) if (ANDAR.has(t) && t !== 'ShiftLeft' && t !== 'ShiftRight') return true;
		return false;
	}
	return {
		activar, desactivar, paso, mirar, invertirRaton, estaInvertido, direccion, pararEnSeco, andando,
	};

	/** Hacia dónde se está mirando ahora mismo (unitario). */
	function direccion(): THREE.Vector3 {
		return new THREE.Vector3(
			-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch),
		);
	}
}

function leerInvertido(): boolean {
	try { return localStorage.getItem('tablero-studio:raton-invertido') === '1'; } catch { return false; }
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

/**
 * Resalta la máquina seleccionada.
 *
 * Toca SOLO el cuerpo del equipo, no todo lo que cuelgue de él. Antes recorría el grupo entero y
 * apagaba de paso la franja verde que dice si la máquina tiene señales, con lo que seleccionar una
 * borraba un dato de la pantalla.
 */
export function resaltarEquipo(m: Mundo, tag: string | undefined): void {
	for (const g of m.equipos.children) {
		const cuerpo = g.userData.cuerpo as THREE.Mesh | undefined;
		if (!cuerpo || !(cuerpo.material instanceof THREE.MeshStandardMaterial)) continue;
		const activo = g.userData.tag === tag;
		cuerpo.material.emissive.setHex(activo ? 0x2b6cb0 : 0x000000);
		cuerpo.material.emissiveIntensity = activo ? 0.55 : 0;
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

export { resumenPlanta } from '../src/modelo/infraestructura.js';
