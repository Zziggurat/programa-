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
import { marca } from './marcas3d.js';
import { BloqueTerminales, Colocacion, Dispositivo } from '../src/modelo/tipos.js';
import { MARGEN_BORNERA, pasoDelBloque, PosicionTerminal, posicionesDeTerminales } from '../src/motores/terminales.js';

/**
 * PROFUNDIDAD A LA QUE TODO APARATO PRESENTA SUS BORNES, en mm desde la placa de montaje.
 *
 * Es la MISMA cota a la que `anclajeBorne()` engancha el cable. Tienen que coincidir: si no, el
 * cable sale de un punto y el tornillo está dibujado en otro. Era justo lo que pasaba —el anclaje
 * fijo en 46 y cada modelo pintando su fila de bornes donde le venía bien: 60 en el disyuntor, 68
 * en el contactor, 16 en el relé, 6 en el pulsador— así que el cable nacía dentro del cuerpo, a
 * catorce milímetros por detrás del tornillo del que decía salir, y las filas de bornes quedaban
 * ENTERRADAS en el plástico: geometría invisible que solo servía para interpenetrar.
 *
 * Con una sola cota compartida el cable sale del tornillo de verdad, y los cuerpos se construyen
 * escalonados para que esta profundidad caiga sobre un hombro descubierto, como el escalón donde
 * un aparato modular de verdad tiene sus bornes.
 */
export const Z_BORNE = 46;

/**
 * MATERIALES POR FAMILIA.
 *
 * Antes había tres: metal, plástico y «oscuro». Con eso, el plástico de la carcasa de un
 * disyuntor, la baquelita de un borne, la goma de un prensaestopas y el policarbonato de una
 * lente se veían iguales, porque solo cambiaba el color. Lo que distingue a un material de otro
 * de cerca no es el tono: es cómo devuelve la luz.
 */
export const M = {
	/** Chapa y tornillería: refleja el entorno y devuelve un brillo estrecho. */
	metal: (color = 0xb9bec2, roughness = 0.35) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness }),
	/**
	 * ACERO GALVANIZADO: el del carril DIN y la chapa del armario. No es un metal pulido —no hace
	 * espejo— pero tampoco es plástico gris: tiene el brillo ancho y algo sucio del zincado, que
	 * es lo que lo delata a simple vista.
	 */
	galvanizado: (color = 0xa8adb2) => new THREE.MeshStandardMaterial({ color, metalness: 0.72, roughness: 0.52 }),
	/**
	 * ACERO PINTADO: la placa de montaje y el propio gabinete. Debajo hay metal, pero lo que se ve
	 * es la capa de pintura, así que apenas tiene respuesta metálica y sí un satinado uniforme.
	 */
	pintado: (color = 0xdedbd4) => new THREE.MeshStandardMaterial({ color, metalness: 0.12, roughness: 0.62 }),
	/** Aluminio de radiador y perfilería: mate, con el grano del extrusionado. */
	aluminio: (color = 0x9aa0a5) => new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.58 }),
	/** Cobre desnudo: pletinas, bobinas, puentes. */
	cobre: () => new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.34 }),
	/** Termoplástico de carcasa: satinado, ni espejo ni tiza. */
	plastico: (color: number, roughness = 0.55) => new THREE.MeshStandardMaterial({ color, roughness }),
	/**
	 * PLÁSTICO TÉCNICO de canaleta y carcasa de aparato: poliamida cargada, más mate y más seca
	 * que el termoplástico brillante de una tapa. Es la diferencia entre una pieza de catálogo
	 * industrial y una carcasa de electrodoméstico.
	 */
	tecnico: (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.03 }),
	/** Baquelita y poliamida de bornes: mate de verdad, casi sin brillo. */
	baquelita: (color = 0x1b1e21) => new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0.02 }),
	/**
	 * AISLAMIENTO de conductor: PVC. Ni mate ni espejo — un satinado suave y algo ceroso, que es
	 * lo que hace que un cable se lea como cable y no como un tubo de plástico de juguete.
	 */
	aislamiento: (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.44, metalness: 0.0 }),
	/** Policarbonato de lentes y tapas transparentes. */
	translucido: (color: number, opacidad = 0.55) => new THREE.MeshStandardMaterial({
		color, roughness: 0.16, metalness: 0.02, transparent: true, opacity: opacidad,
	}),
	oscuro: () => new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.6 }),
};

/**
 * UNA CAVIDAD REHUNDIDA EN UNA CARA, que es el recurso que más barato compra profundidad.
 *
 * Un frontal liso no tiene nada que la luz pueda revelar: se lee como una mancha de color. Un
 * frontal con el panel EMBUTIDO un milímetro y medio devuelve una línea de sombra en todo su
 * contorno, y eso solo ya convierte «una cara» en «una pieza montada sobre otra». Es la misma
 * razón por la que se matan las aristas: no se trata de añadir polígonos, sino de darle a la
 * iluminación algo de lo que agarrarse.
 */
/*
 * CUÁNTO SOBRESALE UNA PLACA FRONTAL DE SU CARCASA. Y NO PUEDE SER CERO.
 *
 * Esta función colocaba la cara del panel EXACTAMENTE en `z`, que es también donde acaba la cara
 * del cuerpo sobre el que se monta. Dos superficies coplanares compitiendo por la misma
 * profundidad: en unos píxeles gana la placa clara y en otros el cuerpo oscuro, y cuál gana cambia
 * al mover la cámara. De ahí las manchas negras sobre superficies claras que se veían al girar,
 * acercarse o alejarse.
 *
 * Costó encontrarlo porque las dos sospechas naturales eran falsas, y las dos se descartaron
 * midiendo: subir el sesgo del mapa de sombras de 0,22 a 3,00 mm no movía el moteado ni un punto
 * (11939 → 11931 por millón), y esconder todos los planos de serigrafía tampoco (11939 → 12236).
 * Lo que lo señaló fue esconder las mallas del aparato de una en una: la número 6 se lo llevaba
 * entera consigo.
 *
 * 0,4 mm es el menor desplazamiento físicamente razonable: una placa frontal moldeada de un
 * aparato real sobresale de su carcasa entre tres y seis décimas. No es un truco para tapar
 * geometría mal puesta —eso sería `polygonOffset` global— sino la pieza puesta donde de verdad
 * está. Y sobra para el buffer de profundidad: a la distancia de trabajo la resolución es de unas
 * dos milésimas de milímetro, y hasta con la cámara en su tope de alejamiento sigue siendo cuatro
 * veces mayor que lo que el buffer distingue.
 */
const RESALTE_PANEL = 0.4;

function panelEmbutido(
	g: THREE.Group, w: number, h: number, z: number, mat: THREE.Material,
	hondo = 1.5, x = 0, y = 0, radio = 1.2,
): void {
	// El marco: cuatro tiras que rodean el hueco, del mismo material que el cuerpo.
	g.add(cajaCanto(w, h, hondo, mat, x, y, z - hondo / 2 + RESALTE_PANEL, radio, 0.35));
}

/**
 * UN TORNILLO DE VERDAD, con su cabeza, su huella y su alojamiento.
 *
 * Los tornillos son de las piezas que más dicen sobre la ESCALA de un objeto: el ojo sabe cuánto
 * mide un tornillo, así que si están bien puestos el aparato entero se lee al tamaño que es. Los
 * de aquí llevan cabeza cilíndrica ligeramente rehundida en su pocillo y la huella hundida, en
 * cruz o de ranura según lo que pida la pieza.
 */
function tornillo(
	g: THREE.Group, x: number, y: number, z: number, radio = 1.6, cruz = false,
): void {
	const cabeza = M.metal(0xc9cfd4);
	/*
	 * EL POCILLO NO ES NEGRO: ES EL MISMO PLÁSTICO, A LA SOMBRA.
	 *
	 * Estaba pintado de 0x0e1113 —negro de tinta— porque en la Fase 1 no había luz capaz de
	 * oscurecer un hueco de tres milímetros, así que la oscuridad había que pintarla. El precio es
	 * que un pocillo así no se lee como una cavidad: se lee como un agujero recortado, sin fondo y
	 * sin el tornillo dentro, que es justo lo que se veía al acercarse a una regleta.
	 *
	 * Ahora que la luz rasante y las sombras hacen ese trabajo, el alojamiento vuelve a ser el
	 * material que de verdad es y la profundidad la pone la iluminación. La RANURA de la cabeza sí
	 * sigue oscura: eso no es una cavidad ancha, es un corte estrecho donde de verdad no entra luz.
	 */
	const pocillo = M.tecnico(0x4c5359);
	const ranura = M.baquelita(0x14171a);
	/*
	 * LA CABEZA VA POR DEBAJO DE LA CARA, y antes iba por encima.
	 *
	 * El pocillo acababa justo en `z` y la cabeza sobresalía casi medio milímetro de él, con la
	 * huella otro tanto por delante. Lo que se veía de cerca no era un tornillo metido en su
	 * alojamiento: era un disco claro posado sobre un anillo oscuro, con una rayita encima. A
	 * tamaño de borna eso se lee como un SÍMBOLO impreso, no como una pieza —y es exactamente el
	 * detalle del que depende que una regleta convenza al acercarse—.
	 *
	 * Ahora el pocillo es un hueco de 3 mm que muere en la cara, la cabeza queda cuatro décimas
	 * POR DENTRO y la huella se hunde en ella. Así la boca del alojamiento devuelve su sombra
	 * anular y el tornillo se lee al fondo, que es como se ve uno de verdad.
	 */
	/*
	 * Y LA BOCA DEL POCILLO QUEDA POR DEBAJO DE LA CARA, no justo en ella.
	 *
	 * Acababa exactamente en `z`, que es donde acaba también la cara del aparato: dos superficies
	 * de colores distintos peleándose por la misma profundidad. Como `tornillo()` la usa TODO el
	 * catálogo —cada tornillo de cada aparato— era, junto con el pocillo del borne, el foco de
	 * moteado más repetido de la escena.
	 *
	 * La cabeza baja otro tanto para no crear el mismo problema entre ella y el pocillo: estaba
	 * cuatro décimas por dentro y, al hundir el pocillo tres décimas y media, se habrían quedado a
	 * cinco centésimas la una de la otra, que es exactamente de donde se venía.
	 */
	/*
	 * Y LA HUELLA TAMBIÉN, que se había quedado atrás.
	 *
	 * El pocillo y la cabeza ya estaban por debajo de la cara, pero la HUELLA —el corte de la
	 * cabeza— seguía muriendo exactamente en `z`, o sea otra vez en el plano de la cara del
	 * aparato. Como `tornillo()` lo usa todo el catálogo, eso era un foco de moteado por cada
	 * tornillo de cada aparato, y se veía en la medida: las regletas seguían siendo lo que más
	 * parpadeaba (196 por millón en X0 frente a 0-12 de los aparatos sin regleta).
	 *
	 * Las tres piezas quedan escalonadas, cada una a más de dos décimas de la siguiente, y en el
	 * orden en que están de verdad: boca del pocillo, huella asomando del corte, cabeza al fondo.
	 *
	 *   boca del pocillo   z − 0,35
	 *   huella             z − 0,70
	 *   cara de la cabeza  z − 0,90
	 */
	g.add(cilindro(radio * 1.5, 3, pocillo, x, y, z - 1.85));
	g.add(cilindro(radio, 1.6, cabeza, x, y, z - 1.7));
	g.add(caja(radio * 1.7, 0.6, 0.6, ranura, x, y, z - 1));
	if (cruz) g.add(caja(0.6, radio * 1.7, 0.6, ranura, x, y, z - 1));
}

function caja(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y, z);
	return m;
}

/**
 * Caja con las aristas MATADAS: esquinas verticales redondeadas y canto frontal achaflanado.
 *
 * Ningún aparato real tiene aristas vivas —se desmoldean con radio y se rematan con chaflán— y es
 * lo primero que delata a un modelo hecho con cubos: de cerca, un canto perfectamente afilado no
 * coge NINGÚN reflejo, así que dos caras contiguas se funden en una mancha plana y la pieza pierde
 * el volumen. Un chaflán de medio milímetro basta para que la arista devuelva una línea de luz y
 * el cuerpo se lea como un objeto sólido.
 *
 * No se cachea a propósito: la escena se reconstruye llamando a `geometry.dispose()` sobre cada
 * malla, así que una geometría compartida se quedaría desmontada bajo los pies del siguiente
 * tablero. Construirlas cuesta una vez por aparato, no una vez por fotograma.
 */
export function cajaCanto(
	w: number, h: number, d: number, mat: THREE.Material,
	x = 0, y = 0, z = 0, radio = 1.6, chaflan = 0.6,
): THREE.Mesh {
	const r = Math.max(0.2, Math.min(radio, w / 2 - 0.2, h / 2 - 0.2));
	const c = Math.max(0.05, Math.min(chaflan, d / 2 - 0.05, r * 0.8));
	const s = new THREE.Shape();
	const hw = w / 2;
	const hh = h / 2;
	s.moveTo(-hw + r, -hh);
	s.lineTo(hw - r, -hh);
	s.quadraticCurveTo(hw, -hh, hw, -hh + r);
	s.lineTo(hw, hh - r);
	s.quadraticCurveTo(hw, hh, hw - r, hh);
	s.lineTo(-hw + r, hh);
	s.quadraticCurveTo(-hw, hh, -hw, hh - r);
	s.lineTo(-hw, -hh + r);
	s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
	const geo = new THREE.ExtrudeGeometry(s, {
		depth: d - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 2, curveSegments: 4,
	});
	// El extrusionado con bisel ocupa de -c a d-c: se recentra para que se comporte como una caja.
	geo.translate(0, 0, c - d / 2);
	const m = new THREE.Mesh(geo, mat);
	m.position.set(x, y, z);
	return m;
}

function cilindro(r: number, largo: number, mat: THREE.Material, x = 0, y = 0, z = 0, ejeZ = true): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, largo, 20), mat);
	if (ejeZ) m.rotation.x = Math.PI / 2;
	m.position.set(x, y, z);
	return m;
}

/**
 * UN BORNE DE VERDAD, no un taco con un disco encima.
 *
 * Lo que se ve al asomarse a un aparato conectado, de fuera adentro: el alojamiento rehundido en
 * el plástico, la jaula metálica dentro, y el tornillo con su ranura HUNDIDA. Antes la «ranura»
 * era una cajita puesta 0,3 mm POR DELANTE de la cabeza del tornillo: desde cerca no era una
 * ranura, era una pestaña saliendo del tornillo.
 *
 * El tornillo queda con su cara justo en `Z_BORNE`, que es de donde arranca el cable.
 */
function borneTornillo(g: THREE.Group, x: number, y: number, ancho: number): void {
	const z = Z_BORNE;   // no es un parámetro a propósito: nadie puede ponerle otra profundidad
	// Mismo criterio que en el tornillo: el alojamiento es plástico en penumbra, no pintura negra.
	const hueco = M.tecnico(0x474d53);
	const jaula = M.metal(0x8d949a);
	const a = Math.min(ancho, 9);
	/*
	 * Alojamiento: un pocillo rehundido 3,4 mm, con su boca JUSTO POR DEBAJO de la superficie.
	 *
	 * Estaba con la boca EN la superficie —cara en `z` exacto, que es donde acaba también la cara
	 * del aparato— y eso son dos superficies de colores distintos peleándose por la misma
	 * profundidad. Como esta función la usa casi todo el catálogo una vez POR BORNE, el mismo
	 * fallo aparecía multiplicado por el número de bornes del tablero: era el foco de moteado más
	 * repetido de la escena.
	 *
	 * Un pocillo con la boca al ras no es un pocillo. Las tres décimas y media que se hunde son
	 * las mismas que en la placa frontal y en la ranura de la maneta, para que el criterio sea uno.
	 */
	g.add(caja(a, Math.min(a, 8), 3.4, hueco, x, y, z - 2.05));
	// Jaula de apriete al fondo del pocillo: la pieza metálica que muerde el hilo.
	g.add(caja(a * 0.72, Math.min(a, 8) * 0.62, 1.6, jaula, x, y, z - 2.4));
	// Y el tornillo, con la MISMA primitiva que el resto del catálogo. Antes este modelo se
	// construía su propia cabeza aparte, así que el borne de un aparato y el de una regleta no
	// tenían el mismo tornillo: dos piezas que en la realidad son la misma se veían distintas.
	tornillo(g, x, y, z, Math.min(2.4, a * 0.34));
}

/** Un borne del reparto genérico, en coordenadas de la huella (mm desde su esquina, Y hacia abajo). */
export interface PuntoBorne {
	id: string;
	dx: number;
	dy: number;
}

/**
 * DÓNDE ESTÁ CADA BORNE de un aparato sin ficha de terminales: dos filas, los índices pares
 * arriba y los impares abajo, como el 1/3/5 contra 2/4/6 de un aparato modular.
 *
 * Esta función la usan LOS DOS lados —el modelo 3D para poner el tornillo y `anclajeBorne()` para
 * enganchar el cable— y por eso está exportada. El reparto vivía metido dentro del anclaje, así
 * que el dibujo no tenía forma de consultarlo: cada modelo pintaba «tres bornes arriba y tres
 * abajo» a ojo, y el resultado era que un contactor con diez bornes enseñaba seis tornillos y los
 * cables salían de sitios donde no había ninguno.
 */
export function bornesGenericos(d: Dispositivo, w: number, h: number): PuntoBorne[] {
	const n = d.bornes.length;
	if (n === 0) return [];
	/*
	 * Una bornera no tiene dos filas: es una HILERA, y cada borna es un bloque con su tornillo.
	 * Con el reparto en dos filas, una regleta de doce bornas anclaba los cables en seis
	 * posiciones a lo ancho, así que ninguno caía sobre su bloque.
	 */
	if (d.tipo === 'bornero') {
		return d.bornes.map((b, i) => ({ id: b.id, dx: ((i + 0.5) / n) * w, dy: h * 0.22 }));
	}
	const puntos: PuntoBorne[] = [];
	for (const arriba of [true, false]) {
		const fila = d.bornes.filter((_, i) => (i % 2 === 0) === arriba);
		const m = Math.max(1, fila.length);
		fila.forEach((b, pos) => puntos.push({
			id: b.id,
			dx: (m === 1 ? 0.5 : (pos + 0.5) / m) * w,
			dy: arriba ? 5 : h - 5,
		}));
	}
	return puntos;
}

/**
 * Dibuja UN tornillo por cada borne que el aparato tiene de verdad, exactamente donde el cable
 * se va a enganchar. Devuelve cuántos ha puesto en cada fila, para que el modelo sepa dónde
 * dejarle sitio.
 */
function dibujarBornesReales(g: THREE.Group, d: Dispositivo, w: number, h: number, tintaClara = false): void {
	const puntos = bornesGenericos(d, w, h);
	if (puntos.length === 0) return;
	// El ancho de cada alojamiento sale del hueco disponible entre bornes vecinos de la misma fila.
	const porFila = new Map<number, PuntoBorne[]>();
	for (const p of puntos) {
		const fila = porFila.get(p.dy) ?? [];
		fila.push(p);
		porFila.set(p.dy, fila);
	}
	for (const fila of porFila.values()) {
		const ancho = Math.min(9, Math.max(3, (w / fila.length) - 1.5));
		const arriba = fila[0].dy < h / 2;
		for (const p of fila) {
			const x = p.dx - w / 2;
			const y = h / 2 - p.dy;
			borneTornillo(g, x, y, ancho);
			/*
			 * LA NUMERACIÓN DEL BORNE, serigrafiada junto a él.
			 *
			 * El identificador NO se inventa: es `borne.id`, el mismo con el que el cable dice a
			 * dónde va y con el que la simulación resuelve el circuito. Por eso en un contactor sale
			 * «1/L1» y en un térmico «95»: es lo que el aparato declara tener. Si alguna vez el
			 * dibujo y el modelo dejaran de coincidir, se vería aquí a simple vista.
			 *
			 * Va HACIA DENTRO del aparato, no hacia su canto. Puesto hacia fuera quedaba enterrado
			 * dentro del reborde que remata el ala de bornes —geometría que existe desde la Fase 1—
			 * y no se veía ni una cifra. Hacia el centro hay explanada lisa, y además es donde la
			 * lleva impresa un aparato de verdad: entre el tornillo y la nariz, para que el cable
			 * conectado no la tape.
			 */
			const alto = Math.min(2.4, Math.max(1.5, ancho * 0.3));
			const rot = marca(p.id, alto, tintaClara);
			if (rot) {
				rot.position.set(x, y + (arriba ? -1 : 1) * alto * 1.6, Z_BORNE + 0.12);
				/*
				 * Es MICROTEXTO: existe para quien se acerca a cablear, y desde la vista general no
				 * se lee —son cifras de dos milímetros— pero sí se acumula. Cien marcas ilegibles no
				 * informan de nada: convierten el tablero en una nube de manchas. Se apagan solas.
				 */
				rot.userData.lod = 'micro';
				g.add(rot);
			}
		}
	}
}

/**
 * Rejilla de ventilación: ranuras de verdad, repetidas y rehundidas.
 *
 * El contactor tenía en su sitio un bucle `for (…) { …; break; }` que se cortaba en la primera
 * vuelta y pintaba dos losas de medio aparato de fondo. No era una rejilla: era un tablón negro
 * pegado al costado, y encima sobresalía 0,2 mm del cuerpo.
 */
function rejilla(g: THREE.Group, n: number, largo: number, alto: number, x: number, y: number, z: number): void {
	const ranura = M.baquelita(0x0e1113);
	const paso = alto / n;
	for (let i = 0; i < n; i++) {
		g.add(caja(largo, Math.max(0.8, paso * 0.45), 1.2, ranura, x, y + (i + 0.5) * paso - alto / 2, z));
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

/** Lo que un carril TS35 levanta al aparato sobre la placa. Lo comparten el carril y su canal. */
/**
 * El GRANO de la pintura al horno: ruido suave en el canal de rugosidad, no en el color.
 *
 * Va en rugosidad a propósito. Metido en el color saldría suciedad —manchas grises sobre la
 * chapa—, que es justo el ruido visible que no se quiere. En rugosidad lo que cambia es cómo
 * devuelve la luz cada trocito de superficie: no se ve el mapa, se ve que la chapa tiene piel.
 *
 * Se construye una sola vez y la comparten todas las placas del programa.
 */
let granoCache: THREE.CanvasTexture | undefined;
export function granoDePintura(): THREE.CanvasTexture | undefined {
	if (granoCache) return granoCache;
	/*
	 * Sin navegador no hay lienzo y por tanto no hay grano. Devolver `undefined` en vez de
	 * reventar es lo que permite que las pruebas construyan el armario de verdad para comprobar
	 * jerarquías y transformaciones: la geometría es la misma, solo le falta el acabado.
	 */
	if (typeof document === 'undefined') return undefined;
	const lado = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = lado;
	const ctx = canvas.getContext('2d')!;
	const img = ctx.createImageData(lado, lado);
	for (let i = 0; i < lado * lado; i++) {
		// Banda estrecha alrededor del valor medio: el mapa MULTIPLICA la rugosidad del material,
		// así que un rango amplio convertiría la pintura en una superficie sucia a manchas.
		const v = 210 + Math.round(Math.random() * 45);
		img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
		img.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(canvas);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(26, 26);
	granoCache = tex;
	return tex;
}

export const ALTURA_CARRIL = 8;

/**
 * EL CUERPO DE UN APARATO DE CARRIL, con su canal por detrás.
 *
 * Aquí había un fallo que no se ve de frente y que es de los gordos: el cuerpo era un bloque
 * macizo que arrancaba en la placa (z=0), y el carril ocupa de 0 a 7,5 mm justo por detrás del
 * aparato. O sea, TODOS los aparatos llevaban el carril metido dentro del plástico. Dos sólidos
 * atravesándose de punta a punta, en cada aparato del tablero.
 *
 * Un aparato modular de verdad no se apoya en la placa: tiene el dorso plano con un CANAL
 * rebajado por el que entra el carril, y se cuelga de los labios con una pinza. Eso es lo que se
 * construye aquí: dos franjas que sí bajan hasta la placa, y la franja central arrancando por
 * encima del carril, con la pinza dentro del canal.
 */
function cuerpoDeCarril(
	g: THREE.Group, w: number, h: number, zFin: number, mat: THREE.Material,
	radio = 1.6, chaflan = 0.6, x = 0,
): void {
	const canal = 37;   // el hueco: el carril mide 35 y necesita holgura para entrar
	const zCanal = ALTURA_CARRIL + 0.5;
	if (h <= canal + 10) {
		/*
		 * Un aparato más bajo que el propio canal se monta entero por delante del carril, y su
		 * pinza va centrada y a escala. Con la pinza del caso grande —fija a 15 y −18,5 mm del
		 * centro— se habría quedado FUERA del cuerpo en un pulsador de 24 mm: dos tacos metálicos
		 * flotando por encima y por debajo del aparato.
		 */
		g.add(cajaCanto(w, h, zFin - zCanal, mat, x, 0, zCanal + (zFin - zCanal) / 2, radio, chaflan));
		g.add(caja(w * 0.7, Math.min(3, h * 0.14), 3, M.baquelita(0x1a1e21), x, h * 0.26, zCanal - 1.5));
		g.add(caja(w * 0.6, Math.min(4, h * 0.18), 2.6, M.metal(0x8d949a), x, -h * 0.26, zCanal - 1.3));
		return;
	}
	const franja = (h - canal) / 2;
	for (const signo of [1, -1]) {
		g.add(cajaCanto(w, franja, zFin, mat, x, signo * (canal + franja) / 2, zFin / 2, radio, chaflan));
	}
	g.add(cajaCanto(w, canal, zFin - zCanal, mat, x, 0, zCanal + (zFin - zCanal) / 2, radio, chaflan));
	// La pinza: el gancho fijo arriba y el resorte que se tira con el destornillador abajo.
	g.add(caja(w * 0.8, 3, 3, M.baquelita(0x1a1e21), x, 15, zCanal - 1.5));
	g.add(caja(w * 0.66, 4.5, 2.6, M.metal(0x8d949a), x, -14, zCanal - 1.3));
	g.add(caja(w * 0.5, 3, 1.6, M.metal(0x767d83), x, -18.5, zCanal - 0.8));
}

function modular(g: THREE.Group, w: number, h: number, color: number, d: Dispositivo, polos: number): number {
	/*
	 * EL PERFIL DE VERDAD DE UN APARATO MODULAR, que es escalonado y no un ladrillo.
	 *
	 * Desde el carril hasta el hombro (Z_BORNE) el cuerpo va a toda su altura; de ahí para delante
	 * sale la NARIZ, más estrecha, y en el escalón que queda a los dos lados es donde están los
	 * bornes. Así es como se llega con el destornillador a un diferencial montado, y es lo que
	 * hace que los bornes se VEAN: antes se pintaban a 60 mm dentro de un cuerpo macizo de 68, o
	 * sea, sepultados en el plástico.
	 */
	const prof = 74;
	const zNariz = 67;
	// Termoplástico técnico, no plástico brillante: un modular es de poliamida cargada y responde
	// a la luz seco y mate. Con brillo de plástico de juguete, un cuadro entero de modulares se
	// convierte en una fila de pastillas de jabón.
	const cuerpo = M.tecnico(color);
	cuerpoDeCarril(g, w, h, Z_BORNE, cuerpo, 1.4, 0.5);
	const altoNariz = h * 0.5;
	g.add(cajaCanto(w * 0.99, altoNariz, zNariz - Z_BORNE, cuerpo, 0, 0, (Z_BORNE + zNariz) / 2, 1.3, 0.6));
	// EL HOMBRO: el escalón achaflanado del que nace la nariz. Es lo que impide que la nariz se lea
	// como una caja posada sobre otra caja, y es donde de verdad se apoya el destornillador.
	for (const s of [-1, 1]) {
		g.add(cajaCanto(w * 0.99, 2.6, 5, cuerpo, 0, s * (altoNariz / 2 + 1), Z_BORNE + 2.5, 1, 1));
	}
	// Cara clara del frente, donde va impresa la referencia. Va EMBUTIDA en la nariz, no posada
	// encima: el escaloncito de medio milímetro es lo que la separa visualmente del cuerpo.
	panelEmbutido(g, w * 0.95, altoNariz * 0.93, zNariz, M.plastico(0xe7e4dc, 0.66), 1.4, 0, 0, 1);
	/*
	 * TABIQUES ENTRE POLOS SOBRE LAS ALAS DE BORNES: las paredes que asoman entre tornillo y
	 * tornillo. Sin ellas, la fila de bornes de un tetrapolar es una explanada lisa con cuatro
	 * agujeros, y es justo lo contrario de lo que se ve al asomarse a un cuadro cableado.
	 */
	const yAla = (altoNariz / 2 + h / 2) / 2;
	const altoAla = h / 2 - altoNariz / 2;
	for (const s of [-1, 1]) {
		for (let i = 1; i < polos; i++) {
			g.add(cajaCanto(1.3, altoAla * 0.9, 6, cuerpo, i * (w / polos) - w / 2, s * yAla, Z_BORNE + 1.2, 0.4, 0.4));
		}
		g.add(cajaCanto(w * 0.99, 1.8, 5, cuerpo, 0, s * (h / 2 - 0.9), Z_BORNE + 0.8, 0.6, 0.5));
	}

	/*
	 * SEPARACIÓN ENTRE POLOS. Un tetrapolar no es una caja de cuatro anchos: son cuatro módulos
	 * pegados, y entre ellos queda la junta. Marcarla es lo que hace que se LEA cuántos polos
	 * tiene sin contar las manetas, que es como se identifica una protección de un vistazo.
	 */
	for (let i = 1; i < polos; i++) {
		const x = i * (w / polos) - w / 2;
		// La junta cruza el frontal ENTERO, de canto a canto de la nariz: si se queda corta, el
		// aparato vuelve a leerse como un bloque único con unas rayas cortas por el medio.
		g.add(caja(1, altoNariz, 2.4, M.baquelita(0x1a1d20), x, 0, zNariz - 0.6));
		g.add(caja(1, h * 0.94, 1.6, M.baquelita(0x1a1d20), x, 0, Z_BORNE - 0.6));
	}

	/*
	 * EL ALOJAMIENTO DE LA MANETA, con su resalte alrededor.
	 *
	 * Antes había solo la ranura oscura, y la maneta salía de ella asomando siete milímetros: tres
	 * tacos negros flotando sobre una cara blanca. En un modular la maneta se mueve dentro de un
	 * RESALTE que sobresale de la cara, y ese collar es lo que hace que la pieza móvil se lea
	 * encajada en el aparato en vez de pegada encima.
	 */
	const hueco = Math.max(6, altoNariz * 0.5);
	g.add(cajaCanto(w * 0.95, hueco + 7, 3.2, cuerpo, 0, 0, zNariz + 0.4, 1.2, 0.9));
	/*
	 * UNA RANURA POR POLO, no una banda de lado a lado.
	 *
	 * Con la ranura corrida el frontal se partía en dos por una franja negra enorme y el aparato
	 * volvía a leerse como una caja con una pegatina. Un tripolar son TRES módulos pegados y cada
	 * uno tiene su ventana; lo que las une es la barra de acoplamiento, no el hueco. Además así se
	 * cuentan los polos de un vistazo, que es como se identifica una protección en un cuadro.
	 */
	/*
	 * Y LA RANURA VA HUNDIDA EN EL RESALTE, que para eso es un hueco.
	 *
	 * Estaba a `zNariz + 0.3` con 3,4 mm de fondo, o sea con la cara en `zNariz + 2.0`… que es
	 * exactamente donde está la cara del resalte que la rodea (3,2 mm de fondo centrados en
	 * `zNariz + 0.4`). Dos superficies coplanares, una clara y otra casi negra, peleándose por la
	 * misma profundidad: en unos píxeles ganaba una y en otros la otra, y cuál ganaba cambiaba al
	 * mover la cámara. Ese era el segundo foco de manchas negras, el del disyuntor.
	 *
	 * Bajarla 0,35 mm no es un parche para esconder el problema: una ventana de maneta es un hueco
	 * en el frontal, y el fondo de un hueco está por detrás de la cara que lo rodea. Antes no lo
	 * estaba.
	 */
	const HUNDIDO = 0.35;
	for (let i = 0; i < polos; i++) {
		const x = (i + 0.5) * (w / polos) - w / 2;
		g.add(caja(Math.max(4, w / polos - 3.5), hueco, 3.4, M.baquelita(0x15181a), x, 0, zNariz + 0.3 - HUNDIDO));
	}
	/*
	 * Palanca por polo (unidas), en gris oscuro. Se marcan como PIEZA porque con el tablero
	 * energizado se mueven: una protección abierta baja la palanca y una disparada la deja a
	 * medias, que es como se lee un cuadro de un vistazo sin tocar nada.
	 *
	 * Ahora la maneta acaba DENTRO de la profundidad declarada. Sobresalía 5 mm por delante de
	 * ella, así que el aparato ocupaba más de lo que decía ocupar y un cable tendido a ras de su
	 * cara lo atravesaba.
	 */
	const palanca = M.plastico(0x2f3438, 0.42);
	for (let i = 0; i < polos; i++) {
		const x = (i + 0.5) * (w / polos) - w / 2;
		const anchoP = Math.max(3.5, w / polos - 5);
		const p1 = cajaCanto(anchoP, hueco * 0.55, 5.5, palanca, x, hueco * 0.2, prof - 4, 1, 0.5);
		const p2 = caja(anchoP * 0.85, hueco * 0.5, 5, palanca, x, hueco * 0.02, zNariz - 1);
		// La huella antideslizante de la cara de agarre: tres estrías. Es lo que da la ESCALA de la
		// maneta, que es lo que dice de un vistazo el tamaño del aparato entero.
		for (const dy of [-0.3, 0, 0.3]) {
			g.add(caja(anchoP * 0.8, 0.7, 0.6, M.baquelita(0x1b1f22), x, hueco * 0.2 + dy * hueco * 0.3, prof - 1.1));
		}
		p1.userData.pieza = 'palanca';
		p2.userData.pieza = 'palanca';
		g.add(p1, p2);
	}
	/*
	 * LA BARRA DE ACOPLAMIENTO de un aparato de varios polos: los pasadores que unen las manetas
	 * para que abran las tres a la vez. Es lo que distingue un tripolar de tres unipolares pegados,
	 * y sin ella las manetas parecían justo eso, tres piezas sueltas.
	 */
	if (polos > 1) {
		const barra = caja(w * 0.86, hueco * 0.2, 2.2, M.plastico(0x23272a, 0.45), 0, hueco * 0.2, prof - 5.6);
		barra.userData.pieza = 'palanca';
		g.add(barra);
	}
	/*
	 * EL REPARTO DE LA CARA, que antes se pisaba a sí mismo: el rótulo de la referencia caía en
	 * y = -0,38·alto y la mirilla en y = -hueco/2 - 4,5, o sea prácticamente encima, así que del
	 * rótulo solo asomaba una franja verde. Ahora cada cosa tiene su banda: la referencia arriba,
	 * las marcas I/O en el propio resalte de la maneta y la mirilla abajo del todo.
	 */
	const io = etiquetaImpresa('I  ·  O', Math.min(w * 0.5, 16), 3, '#e7e4dc', '#4a4a46');
	io.position.set(0, hueco * 0.5 + 1.9, zNariz + 2.2);
	g.add(io);
	/*
	 * LA MARCA DEL AUTOMÁTICO: «C16» arriba, grande, que es el dato que se busca al abrir un
	 * cuadro, y la referencia debajo en cuerpo menor. Las dos salen de campos rellenos del
	 * aparato; si no los tiene, no se imprime nada en su sitio.
	 */
	const ficha = fichaVisible(d);
	const calibre = ficha.length > 1 ? ficha[1] : undefined;
	if (calibre) {
		const rot = marca(calibre, 4.6);
		if (rot) { rot.position.set(0, altoNariz * 0.4, zNariz + 0.12); g.add(rot); }
	}
	if (ficha[0]) {
		const rot = marca(ficha[0], 2.4);
		if (rot) { rot.position.set(0, altoNariz * 0.4 - (calibre ? 4.4 : 0), zNariz + 0.12); rot.userData.lod = 'medio'; g.add(rot); }
	}
	// Mirilla de estado: verde con el aparato cerrado, roja al abrirlo o dispararlo. Va metida en
	// su ventanita, no posada sobre la cara: por eso primero el marco oscuro y luego el cristal.
	/*
	 * Y LA VENTANITA VA POR DENTRO, que para eso es una ventanita.
	 *
	 * El marco oscuro acababa en `zNariz + 0,4`, que es exactamente donde acaba el frontal embutido
	 * del disyuntor: una pieza casi negra y una casi blanca terminando en el mismo plano, con 62
	 * mm² de solape. Es el mismo fallo del pocillo del borne, en otra pieza. Escalonado:
	 *
	 *   cara del frontal   zNariz + 0,40
	 *   marco de la mirilla zNariz + 0,05
	 *   cristal            zNariz − 0,25
	 */
	const anchoMir = Math.min(10, w * 0.4);
	const yMir = -hueco * 0.5 - 6.3;
	g.add(caja(anchoMir + 2, 5.2, 1.6, M.baquelita(0x15181a), 0, yMir, zNariz - 0.75));
	const mirilla = caja(anchoMir, 3.5, 1.2, M.plastico(0x2e7d32, 0.32), 0, yMir, zNariz - 0.85);
	mirilla.userData.pieza = 'mirilla';
	g.add(mirilla);
	return prof;
}

function contactor(g: THREE.Group, w: number, h: number, color: number, d: Dispositivo): number {
	/*
	 * EL CONTACTOR, que es la pieza que más identidad le da al tablero.
	 *
	 * Antes era una caja oscura con otra caja encima: de lejos pasaba, y de cerca no había por
	 * dónde cogerlo. Un contactor real se lee por cuatro cosas, y son las que se construyen aquí:
	 *
	 *   — el CUERPO bajo, ancho, con las dos alas de los bornes a distinta cota que la nariz;
	 *   — la NARIZ central rehundida respecto de esas alas, con el frontal embutido;
	 *   — las COLUMNAS de polos separadas por tabiques, que es lo que se ve entre los tornillos;
	 *   — la ARMADURA, el bloque que baja cuando la bobina tira.
	 *
	 * Y por debajo, la zona de bobina: un aparato de potencia no es simétrico arriba y abajo, y
	 * marcar esa diferencia es lo que evita que parezca un ladrillo.
	 */
	const prof = 84;
	const cuerpo = M.tecnico(color);
	const oscuro = M.baquelita(0x15181b);
	cuerpoDeCarril(g, w, h, Z_BORNE, cuerpo, 2, 0.8);
	const altoNariz = h * 0.54;
	/*
	 * La nariz llega CASI hasta el fondo declarado (prof), y no doce milímetros por detrás.
	 *
	 * Antes el volumen que marcaba la profundidad del aparato era la armadura: una losa oscura de
	 * 12 mm posada encima de la nariz, más ancha que alta y con las esquinas redondeadas. Eso no se
	 * lee como el bloque móvil de un contactor, se lee como una PANTALLA pegada a una caja. En un
	 * contactor real el volumen dominante es la carcasa y todo lo demás va METIDO en ella; lo que
	 * asoma del bloque móvil es una banda estrecha, no medio frontal.
	 */
	const zNariz = prof - 3;
	g.add(cajaCanto(w * 0.99, altoNariz, zNariz - Z_BORNE, cuerpo, 0, 0, (Z_BORNE + zNariz) / 2, 1.8, 0.9));
	/*
	 * EL HOMBRO entre la nariz y las alas de bornes: un escalón achaflanado, no un canto vivo.
	 *
	 * Es la transición que evita el «cubo sobre cubo»: la nariz no nace de la nada sobre el cuerpo,
	 * sale de un rebaje que la rodea y por eso las dos piezas se leen encajadas una en otra.
	 */
	for (const s of [-1, 1]) {
		g.add(cajaCanto(w * 0.99, 3.2, 6, cuerpo, 0, s * (altoNariz / 2 + 1.2), Z_BORNE + 3, 1.4, 1.2));
	}
	// NERVIOS de los costados: las paredes de un contactor van acarteladas, y de perfil es lo que
	// impide que el flanco sea una losa lisa.
	for (const s of [-1, 1]) {
		for (const dy of [-0.26, 0, 0.26]) {
			g.add(caja(1.2, altoNariz * 0.2, zNariz - Z_BORNE - 6, oscuro, s * w * 0.495, dy * altoNariz, (Z_BORNE + zNariz) / 2));
		}
	}

	/*
	 * TABIQUES ENTRE POLOS, sobre las ALAS DE BORNES y no sobre la nariz.
	 *
	 * Estaban en el sitio equivocado: subían por el frontal, donde en un contactor no hay nada que
	 * separar, mientras que los tornillos de arriba y de abajo —que es donde de verdad hace falta
	 * aislar un polo del siguiente— quedaban en una explanada lisa. Ahora son las paredes que
	 * asoman ENTRE tornillo y tornillo, que es lo que se ve al asomarse a un contactor cableado.
	 */
	const yAla = (altoNariz / 2 + h / 2) / 2;
	const altoAla = h / 2 - altoNariz / 2;
	for (const s of [-1, 1]) {
		for (const dx of [-1, 1]) {
			g.add(cajaCanto(1.8, altoAla * 0.92, 7, cuerpo, dx * w * 0.165, s * yAla, Z_BORNE + 1.4, 0.5, 0.5));
		}
		// El reborde exterior del ala: el labio que remata la fila de bornes por su canto.
		g.add(cajaCanto(w * 0.99, 2.2, 6, cuerpo, 0, s * (h / 2 - 1.1), Z_BORNE + 1, 0.8, 0.7));
	}

	/*
	 * La ARMADURA: el bloque frontal que lleva los contactos móviles.
	 *
	 * En un contactor de verdad, cuando la bobina tira, este bloque baja un par de milímetros con
	 * su golpe seco. Es LO que se mira para saber si el contactor ha metido, y por eso se marca
	 * como pieza: con el tablero energizado se mueve de verdad.
	 */
	// El ALOJAMIENTO donde va metida: un pocillo rehundido en la nariz, más grande que la pieza.
	// Sin él la armadura estaría posada sobre el frontal; con él está DENTRO de la carcasa, y esa
	// es la diferencia entre una pieza montada y una pieza pegada.
	const anchoArm = w * 0.62;
	const altoArm = altoNariz * 0.28;
	const yArm = altoNariz * 0.06;
	g.add(caja(anchoArm + 3, altoArm + 3, 5, oscuro, 0, yArm, zNariz - 2.5));
	const armadura = cajaCanto(anchoArm, altoArm, 6, M.plastico(0x353b41, 0.42), 0, yArm, zNariz - 1.4, 1, 0.5);
	armadura.userData.pieza = 'armadura';
	g.add(armadura);
	/*
	 * Su cara vista va MÁS CLARA que el bloque, no más oscura. Con el rehundido en negro sobre gris
	 * oscuro lo que se leía era un agujero rectangular —una ranura— en vez de un resalte, y el
	 * frontal del contactor volvía a parecer una pantalla. Un plano que sale hacia la luz se ve más
	 * claro que el que lo rodea: es así de simple, y es lo que lo convierte en volumen.
	 */
	g.add(cajaCanto(anchoArm * 0.8, altoArm * 0.5, 1.6, M.plastico(0x4a5157, 0.42), 0, yArm, zNariz + 1.1, 0.8, 0.4));
	/*
	 * BAHÍAS DE BLOQUE AUXILIAR arriba, una a cada lado: los dos huecos con sus pestañas donde se
	 * clipa el contacto auxiliar. Es un detalle que solo tienen los contactores, así que es de lo
	 * que más ayuda a que este aparato no se confunda con ningún otro del tablero.
	 */
	for (const s of [-1, 1]) {
		const xb = s * w * 0.26;
		g.add(caja(w * 0.3, altoNariz * 0.14, 3.5, oscuro, xb, altoNariz * 0.36, zNariz - 1.7));
		g.add(caja(w * 0.3, 1.1, 2, M.plastico(0x4a5157, 0.5), xb, altoNariz * 0.29, zNariz - 0.6));
	}
	/*
	 * Rejilla de ventilación de verdad, ranura a ranura.
	 *
	 * Aquí había un bucle `for (let i = 0; i < 4; i++) { …; break; }`: se cortaba siempre en la
	 * primera vuelta, el `+ i * 0` no sumaba nada y lo que salía eran DOS losas negras de medio
	 * aparato de fondo pegadas a los costados —y sobresaliendo 0,2 mm de ellos—, no una rejilla.
	 */
	rejilla(g, 3, w * 0.62, altoNariz * 0.14, 0, -altoNariz * 0.4, zNariz - 0.9);

	/*
	 * LA ZONA DE BOBINA, abajo: el bloque que aloja el electroimán, con su tapa de otro plástico
	 * y los dos tornillos de A1/A2. Es lo que rompe la simetría del ladrillo y lo que hace que un
	 * contactor se distinga de un relé grande a primera vista.
	 */
	const yBob = -altoNariz * 0.5 - 5;
	if (h > 50) {
		g.add(cajaCanto(w * 0.8, 9, 3.2, M.plastico(0x3a4046, 0.6), 0, yBob, Z_BORNE + 1.4, 1, 0.3));
		for (const s of [-1, 1]) tornillo(g, s * w * 0.24, yBob, Z_BORNE + 3.2, 1.5);
	}

	/*
	 * Ventana portaetiquetas en la NARIZ, no sobre la armadura: la armadura baja 2,2 mm al meter
	 * el contactor, así que un rótulo pegado a ella se despegaría del aparato cada vez que entra.
	 */
	/*
	 * LA REFERENCIA VA SERIGRAFIADA, no en un cartelito.
	 *
	 * Era una placa blanca con su fondo: una etiqueta pegada encima, no una marca del aparato. Y
	 * además costaba un lienzo y una textura por contactor. Ahora es tinta del atlas compartido
	 * directamente sobre la carcasa, que es como lo lleva uno de verdad, y no cuesta nada.
	 */
	const yEt = -altoNariz * 0.24;
	for (const [i, linea] of fichaVisible(d).entries()) {
		const rot = marca(linea, i === 0 ? 3.4 : 2.6, true);
		if (!rot) continue;
		rot.position.set(0, yEt - i * 4.6, zNariz + 0.12);
		rot.userData.lod = 'medio';
		g.add(rot);
	}
	return prof;
}

function plc(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 62;
	cuerpoDeCarril(g, w, h * 0.72, prof - 4, M.tecnico(color), 1.8, 0.7);
	g.add(cajaCanto(w * 0.98, h * 0.42, 4, M.plastico(0x2c3136, 0.6), 0, -2, prof - 1, 1.2, 0.5));
	/*
	 * PEINES DE CONEXIÓN extraíbles, arriba y abajo. Salen HASTA la cota de conexión, para que el
	 * cable entre por el peine que se ve. Antes acababan en 54 y los bornes se pintaban a 59:
	 * flotando cinco milímetros por delante del peine, sin nada debajo.
	 */
	const verde = M.plastico(0x2e5d3a, 0.5);
	for (const signo of [1, -1]) {
		const y = signo * (h * 0.42);
		g.add(cajaCanto(w * 0.96, h * 0.16, Z_BORNE, verde, 0, y, Z_BORNE / 2, 1, 0.4));
		// Palanquita de extracción del peine, en un extremo.
		g.add(caja(4, h * 0.1, 3, M.plastico(0x1e3d27, 0.5), w * 0.44, y, Z_BORNE + 1));
	}
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
	/*
	 * FUENTE CONMUTADA: caja de chapa perforada, con los bornes en las tapas de arriba y abajo.
	 *
	 * Antes era un ladrillo de 94 mm con los bornes pintados a 86, dentro de la propia chapa, y
	 * unas «aletas» que eran tacos de 2×2 mm sueltos por los costados. Ahora la caja se queda por
	 * detrás de la cota de conexión y las tapas de bornes salen a ella, que es donde se atornilla.
	 */
	const prof = 100;
	const chapa = M.aluminio(color);
	// Cuerpo, retranqueado para que las regletas de bornes se vean sobresalir.
	cuerpoDeCarril(g, w * 0.94, h * 0.78, prof - 4, chapa, 1.6, 0.8);
	// Perforaciones de ventilación en el frente: es lo que tiene una fuente por delante.
	rejilla(g, 7, w * 0.62, h * 0.34, 0, 0, prof - 4.2);
	// Aletas de disipación: chapas de verdad, altas y a lo largo, no tacos sueltos.
	const aleta = M.aluminio(0x9aa0a5);
	for (let i = 0; i < 7; i++) {
		const z = 12 + i * ((prof - 34) / 6);
		g.add(caja(2.4, h * 0.74, 3.5, aleta, -w * 0.47 + 1.2, 0, z));
		g.add(caja(2.4, h * 0.74, 3.5, aleta, w * 0.47 - 1.2, 0, z));
	}
	// Regletas de entrada y salida, sobre la caja, a la cota de conexión.
	const regleta = M.baquelita(0x24282b);
	g.add(caja(w, h * 0.14, Z_BORNE, regleta, 0, h * 0.43, Z_BORNE / 2));
	g.add(caja(w, h * 0.14, Z_BORNE, regleta, 0, -h * 0.43, Z_BORNE / 2));
	const et = etiquetaImpresa(ref, w * 0.7, 9, '#dfe3e6', '#222');
	et.position.set(0, h * 0.24, prof - 3.6);
	g.add(et);
	// LED DC OK: se enciende cuando la fuente tiene de verdad su primario alimentado.
	const dcok = caja(3, 3, 1.4,
		new THREE.MeshStandardMaterial({ color: 0x21d07a, emissive: 0x21d07a, emissiveIntensity: 0 }),
		w * 0.28, -h * 0.24, prof - 3.4);
	dcok.userData.pieza = 'led';
	dcok.userData.colorPropio = 0x21d07a;
	g.add(dcok);
	// Potenciómetro de ajuste fino de la tensión: toda fuente lo lleva y se busca con el dedo.
	g.add(cilindro(2.6, 2, M.plastico(0xd8d2b8, 0.5), -w * 0.28, -h * 0.24, prof - 3.2));
	return prof;
}

function transformador(g: THREE.Group, w: number, h: number): number {
	/*
	 * TRANSFORMADOR DE MANDO: núcleo laminado, bobinas y regletas de conexión.
	 *
	 * Antes el núcleo era un bloque macizo y la bobina otro bloque MÁS GRUESO metido dentro: dos
	 * sólidos atravesándose, con la bobina saliendo por las dos caras del hierro. Un transformador
	 * no es eso: el hierro tiene una VENTANA y la bobina va enhebrada por ella. Y los bornes se
	 * pintaban a 52 mm, o sea, dentro de la propia bobina.
	 */
	const prof = 62;
	const nucleo = M.metal(0x6f7377);
	// El paquete de chapas arranca por delante del carril, no encima de él.
	const zBase = ALTURA_CARRIL + 0.5;
	const zHierro = 34;
	const anchoColumna = w * 0.22;
	// Culatas de arriba y abajo, y las dos columnas laterales: entre ellas queda la ventana.
	g.add(caja(w, h * 0.16, zHierro, nucleo, 0, h * 0.34, zBase + zHierro / 2));
	g.add(caja(w, h * 0.16, zHierro, nucleo, 0, -h * 0.34, zBase + zHierro / 2));
	g.add(caja(anchoColumna, h * 0.52, zHierro, nucleo, -w / 2 + anchoColumna / 2, 0, zBase + zHierro / 2));
	g.add(caja(anchoColumna, h * 0.52, zHierro, nucleo, w / 2 - anchoColumna / 2, 0, zBase + zHierro / 2));
	// Las chapas del paquete se ven de canto: es lo que delata a un núcleo laminado.
	for (let i = 0; i < 7; i++) {
		g.add(caja(w * 0.99, 0.5, zHierro * 0.99, M.metal(0x5e6367), 0, h * 0.34 - h * 0.06 + i * (h * 0.02), zBase + zHierro / 2));
	}
	// Bobina sobre la columna central, DENTRO de la ventana del hierro.
	const carrete = M.plastico(0x23272a, 0.6);
	g.add(caja(w * 0.3, h * 0.5, zHierro * 0.86, carrete, 0, 0, zBase + zHierro / 2));
	const hilo = M.cobre();
	for (let i = 0; i < 9; i++) {
		g.add(caja(w * 0.33, h * 0.045, zHierro * 0.9, hilo, 0, -h * 0.2 + i * (h * 0.05), zBase + zHierro / 2));
	}
	g.add(caja(w * 0.35, h * 0.14, zHierro * 0.92, M.plastico(0xc9a86a, 0.65), 0, 0, zBase + zHierro / 2)); // cinta
	// Columna central del hierro, cerrando el circuito magnético por delante y por detrás.
	g.add(caja(anchoColumna * 0.9, h * 0.52, zHierro * 0.3, nucleo, 0, 0, zBase + zHierro * 0.15));
	// Patas de fijación a la placa.
	const pata = M.metal(0x8b9095);
	g.add(caja(w * 1.06, 6, 10, pata, 0, -h / 2 + 3, 5));
	g.add(caja(w * 1.06, 6, 10, pata, 0, h / 2 - 3, 5));
	// Regletas de primario y secundario, sobre el hierro, a la cota de conexión.
	const regleta = M.baquelita(0x2b2f32);
	const altoRegleta = Z_BORNE - zBase - zHierro;
	for (const signo of [1, -1]) {
		g.add(caja(w * 0.92, 11, altoRegleta, regleta, 0, signo * h * 0.34, Z_BORNE - altoRegleta / 2));
	}
	return prof;
}

function bornero(g: THREE.Group, d: Dispositivo, w: number, h: number): number {
	// La cara de la borna ES la cota de conexión: así el pocillo del tornillo queda enrasado con
	// ella en vez de quedarse dos milímetros por dentro del plástico.
	const prof = Z_BORNE;
	// Una borna suelta es un caso legítimo y muy común (un puente, una reserva, un PE aislado):
	// con un mínimo de 2 se dibujaban dos bloques donde el usuario había puesto uno.
	const n = Math.max(1, d.bornes.length);
	const paso = w / n;
	for (let i = 0; i < n; i++) {
		const b = d.bornes[i];
		const esPE = b?.tipo === 'PE';
		const x = (i + 0.5) * paso - w / 2;
		// Bloque individual: gris (o verde/amarillo si es tierra). La poliamida de una borna es
		// mate: con el plástico satinado de una carcasa parecían todos la misma pieza.
		// El verde y el amarillo de protección tienen que ser inequívocos, que para eso están
		// normalizados, pero no fosforescentes: a plena saturación la borna de tierra era el objeto
		// más llamativo del tablero, por delante de la aparamenta. Se bajan a un tono de poliamida
		// teñida, que es lo que son, sin tocar el código de color.
		const cuerpo = esPE ? M.baquelita(0x3d8341) : M.baquelita(0xaeb4b9);
		cuerpoDeCarril(g, paso - 1.2, h, prof, cuerpo, 0.9, 0.4, x);
		/*
		 * La franja amarilla, en la CARA de la borna.
		 *
		 * Antes era un bloque de `prof + 2` de fondo centrado en `prof / 2`: iba de z = −1 —un
		 * milímetro metido en la placa de montaje— hasta prof+1, y por el camino atravesaba el
		 * carril de punta a punta. Una franja pintada no tiene fondo: va en la cara.
		 */
		if (esPE) g.add(caja(paso - 1.8, h * 0.34, 1.4, M.baquelita(0xd6bb3c), x, 0, prof + 0.3));
		/*
		 * LA PARED ENTRE MÓDULOS. Una regleta no es un bloque estriado: son bornas sueltas
		 * apretadas una contra otra, y lo que se ve entre ellas es el canto de cada carcasa. Sin
		 * esa junta, diez bornas se leen como una losa con rayas; con ella se cuentan de un
		 * vistazo, que es justo para lo que sirve mirar una regleta.
		 */
		if (i > 0) {
			// 0,7 mm no se veía: a la distancia a la que se mira una regleta, una junta más fina
			// que el píxel no separa nada. 1,4 mm sí, y sigue siendo el canto de una carcasa.
			g.add(caja(1.4, h * 0.94, prof - ALTURA_CARRIL - 0.6, M.baquelita(0x5a6167),
				x - paso / 2, 0, ALTURA_CARRIL + (prof - ALTURA_CARRIL) / 2));
		}
		/*
		 * Tornillo del lado de campo, en su POCILLO. El del lado del cuadro lo pone
		 * `dibujarBornesReales()` en el punto exacto donde se engancha el cable, para que sea el
		 * mismo tornillo que se ve.
		 */
		/*
		 * EL POCILLO VA HUNDIDO, que para eso es un pocillo.
		 *
		 * Estaba a `prof - 1.7` con 3,4 mm de fondo, o sea con la cara en `prof`… que es exactamente
		 * donde acaba la cara del cuerpo de la borna. Una pieza oscura y una clara terminando en el
		 * mismo plano: en unos píxeles gana una y en otros la otra, y cuál gana cambia al mover la
		 * cámara. Y como esto se dibuja UNA VEZ POR BORNA, una regleta de veinte bornas tenía veinte
		 * focos de moteado; medido, las regletas eran con diferencia lo que más parpadeaba del
		 * tablero (1667 por millón en X2 frente a 345 del disyuntor).
		 */
		g.add(caja(paso * 0.62, 7, 3.4, M.tecnico(0x474d53), x, -h * 0.28, prof - 2.05));
		g.add(caja(paso * 0.44, 5, 1.4, M.metal(0x8d949a), x, -h * 0.28, prof - 3.1));
		tornillo(g, x, -h * 0.28, prof, Math.min(1.9, paso * 0.26));
		/*
		 * La BOCA por donde entra el conductor, debajo del tornillo: el agujero avellanado que
		 * tiene toda borna y por el que se mete el hilo. Es un detalle de dos milímetros que se
		 * nota mucho de cerca, porque es lo que explica cómo se conecta la pieza.
		 */
			/*
		 * La boca del conductor sí es un taladro estrecho y profundo: ahí la penumbra es real. Y
		 * como todo taladro, su boca queda POR DEBAJO de la cara: estaba acabando exactamente en
		 * `prof`, que es donde acaba la cara de la borna, y una pieza casi negra y una clara
		 * terminando en el mismo plano se pelean píxel a píxel. Es el mismo fallo del pocillo, en
		 * la pieza de al lado, y como también se dibuja una vez por borna, también se multiplicaba
		 * por el número de bornas de la regleta.
		 */
		g.add(cilindro(Math.min(1.6, paso * 0.22), 2.2, M.baquelita(0x1a1e21), x, -h * 0.4, prof - 1.45));
		// Ventana de identificación: la tira donde va el número de borna, embutida en la cara.
		g.add(caja(paso - 2.4, h * 0.11, 1.1, M.baquelita(0xe9ecee), x, h * 0.02, prof - 0.2));
	}
	/*
	 * Topes finales, con su tornillo de apriete al carril.
	 *
	 * Iban de z = −1 a prof+1, o sea, un milímetro METIDOS en la placa y otro por delante de la
	 * cara de las bornas; y a lo ancho salían tres milímetros fuera de la huella declarada de la
	 * regleta, que es la que el editor usa para repartir los corredores de cable. Ahora caben
	 * dentro de su huella y se apoyan en el carril como el resto.
	 */
	const tope = M.plastico(0x5d666e, 0.62);
	const zCanal = ALTURA_CARRIL + 0.5;
	for (const lado of [-1, 1]) {
		const x = lado * (w / 2 + 1);
		g.add(cajaCanto(2, h, prof - zCanal, tope, x, 0, zCanal + (prof - zCanal) / 2, 0.6, 0.3));
		g.add(cilindro(1.4, 2, M.metal(0xa8aeb3), x, h * 0.3, prof - 0.6));
	}
	return prof;
}

function variador(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 120;
	/*
	 * VARIADOR: radiador atrás, electrónica en medio y panel de mando delante, con las regletas
	 * de potencia y control saliendo arriba y abajo hasta la cota de conexión. Antes los bornes
	 * se pintaban a 108 mm, enterrados en el bloque del frente.
	 */
	cuerpoDeCarril(g, w * 0.96, h * 0.76, prof * 0.55, M.tecnico(color), 2, 0.9);
	// El bloque del frente llega hasta la cara declarada del aparato. Antes se quedaba 10 mm
	// corto y el display y el rótulo salían flotando en el aire por delante de él.
	g.add(cajaCanto(w * 0.88, h * 0.7, prof * 0.48, M.plastico(0x33383d, 0.55), 0, 0, prof * 0.76, 1.8, 0.8));
	// Radiador trasero: aletas altas y profundas, con su hueco entre medias.
	const aleta = M.aluminio(0x7d838a);
	for (let i = 0; i < 9; i++) {
		g.add(caja(w * 0.055, h * 0.74, 15, aleta, -w * 0.42 + i * (w * 0.105), 0, ALTURA_CARRIL + 8));
	}
	// Regletas de potencia (arriba) y de control (abajo), a la cota a la que entra el cable.
	g.add(cajaCanto(w * 0.9, h * 0.13, Z_BORNE, M.baquelita(0x22262a), 0, h * 0.43, Z_BORNE / 2, 1, 0.4));
	g.add(cajaCanto(w * 0.9, h * 0.13, Z_BORNE, M.baquelita(0x22262a), 0, -h * 0.43, Z_BORNE / 2, 1, 0.4));
	// Rejilla del ventilador, abajo del frente: un variador respira por ahí.
	rejilla(g, 5, w * 0.5, h * 0.16, 0, -h * 0.26, prof + 0.2);
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
	// Rueda de ajuste con su marca de posición, y las teclas de marcha y paro.
	g.add(cilindro(w * 0.12, 2.4, M.plastico(0x0f766e, 0.4), 0, -h * 0.06, prof + 1.2));
	g.add(caja(1.4, w * 0.1, 1, M.plastico(0xe9ecee, 0.5), 0, -h * 0.02, prof + 2.3));
	g.add(cajaCanto(w * 0.14, h * 0.05, 1.8, M.plastico(0x2e7d32, 0.45), -w * 0.24, -h * 0.06, prof + 0.9, 0.6, 0.3));
	g.add(cajaCanto(w * 0.14, h * 0.05, 1.8, M.plastico(0xb0342c, 0.45), w * 0.24, -h * 0.06, prof + 0.9, 0.6, 0.3));
	return prof;
}

function guardamotorModelo(g: THREE.Group, w: number, h: number, color: number, ref: string): number {
	const prof = 90;
	const zNariz = prof - 9;
	const cuerpo = M.tecnico(color);
	cuerpoDeCarril(g, w, h, Z_BORNE, cuerpo, 2, 0.8);
	const altoNariz = h * 0.56;
	g.add(cajaCanto(w * 0.99, altoNariz, zNariz - Z_BORNE, cuerpo, 0, 0, (Z_BORNE + zNariz) / 2, 1.8, 0.8));
	// Hombro achaflanado y frontal embutido: los mismos dos recursos que en el resto de la familia
	// de carril, para que un guardamotor no se lea como una caja distinta de las de al lado.
	for (const s2 of [-1, 1]) {
		g.add(cajaCanto(w * 0.99, 2.8, 5.5, cuerpo, 0, s2 * (altoNariz / 2 + 1.1), Z_BORNE + 2.7, 1.2, 1));
	}
	panelEmbutido(g, w * 0.93, altoNariz * 0.9, zNariz, M.plastico(0xc9ccce, 0.6), 1.3, 0, 0, 1.2);
	/*
	 * Mando giratorio al frente. La maneta roja es la PALANCA: gira con el aparato, igual que en
	 * el guardamotor de verdad, y así se ve abierto o disparado sin abrir el panel. Y se le pone
	 * una mirilla, que este modelo no tenía y es donde se lee el estado de un vistazo.
	 */
	const yMando = altoNariz * 0.16;
	// Aro rehundido del mando, con la corona graduada alrededor del disco.
	g.add(cilindro(w * 0.32, 2.4, M.baquelita(0x191d20), 0, yMando, zNariz - 0.6));
	// La corona graduada: las marcas de posición alrededor del aro. Sin ellas el mando es un disco
	// negro, y con ellas se ve que es un aparato que se ACCIONA y que tiene posiciones.
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * Math.PI * 2;
		g.add(caja(0.7, 2, 0.8, M.plastico(0xd5dade, 0.55),
			Math.cos(a) * w * 0.29, yMando + Math.sin(a) * w * 0.29, zNariz + 0.5));
	}
	g.add(cilindro(w * 0.26, 6, M.plastico(0x16181b, 0.42), 0, yMando, zNariz + 2.4));
	const maneta = cajaCanto(4.5, w * 0.4, 7, M.plastico(0xd23b3b, 0.42), 0, yMando, zNariz + 5.6, 1.2, 0.5);
	maneta.userData.pieza = 'palanca';
	g.add(maneta);
	const mirilla = caja(Math.min(9, w * 0.35), 3.5, 1.2, M.plastico(0x2e7d32, 0.32), 0, -altoNariz * 0.3, zNariz + 0.4);
	mirilla.userData.pieza = 'mirilla';
	g.add(mirilla);
	// Rueda de reglaje de la intensidad: el guardamotor se tara, y se ve por dónde.
	g.add(cilindro(w * 0.13, 3, M.plastico(0xd8d2b8, 0.5), -w * 0.28, -altoNariz * 0.3, zNariz + 0.8));
	const et = etiquetaImpresa(ref, w * 0.6, 6, '#3d4348', '#d5dade');
	et.position.set(w * 0.1, -altoNariz * 0.42, zNariz + 0.5);
	g.add(et);
	return prof;
}

/**
 * EL RELÉ TÉRMICO, que no se parece en nada a un relé enchufable.
 *
 * Los dos llegaban aquí como `tipo: 'rele'` y salían con el mismo cuerpo translúcido y su bobina
 * de cobre dentro, así que un térmico de sobrecarga se veía como un relé de maniobra. Lo que los
 * distingue en el modelo —sin mirar identificadores— es que un térmico declara su RANGO DE
 * REGULACIÓN: es un aparato que se tara, y eso es justo lo que se le ve por fuera.
 *
 * De un térmico real se reconocen cuatro cosas: el cuerpo bajo y ancho que se cuelga debajo del
 * contactor, la rueda de reglaje con su escala de amperios, el botón de rearme y el de prueba, y
 * la ventanita del testigo de disparo.
 */
function releTermicoModelo(g: THREE.Group, w: number, h: number, color: number, d: Dispositivo): number {
	const prof = 76;
	const zNariz = prof - 8;
	const cuerpo = M.tecnico(color);
	cuerpoDeCarril(g, w, h, Z_BORNE, cuerpo, 1.6, 0.6);
	const altoNariz = h * 0.5;
	g.add(cajaCanto(w * 0.99, altoNariz, zNariz - Z_BORNE, cuerpo, 0, 0, (Z_BORNE + zNariz) / 2, 1.6, 0.7));
	// Frontal embutido, más claro: es donde va impresa la escala.
	panelEmbutido(g, w * 0.94, altoNariz * 0.9, zNariz, M.plastico(0xd8d5cc, 0.6), 1.3, 0, 0, 1);

	/*
	 * LA RUEDA DE REGLAJE con su corona graduada. Es LA pieza del térmico: la que dice a cuántos
	 * amperios está tarado, y la que un electricista busca con la vista al abrir el cuadro.
	 */
	const rMando = Math.min(w * 0.26, altoNariz * 0.3);
	const yMando = altoNariz * 0.12;
	/*
	 * El aro va dos décimas más adelantado de lo que estaba. Acababa a 0,2 mm de la cara del
	 * frontal y con 698 mm² de solape —la pieza coplanar más grande que quedaba en el catálogo—;
	 * a 0,4 mm hay margen de sobra y el aro sigue siendo el collar de la rueda, que es lo que es.
	 */
	g.add(cilindro(rMando * 1.3, 2, M.baquelita(0x1a1e21), 0, yMando, zNariz - 0.2));
	g.add(cilindro(rMando, 2.6, M.plastico(0xe6e2d6, 0.5), 0, yMando, zNariz + 1.2));
	// Las marcas de la escala alrededor de la rueda, y el índice rojo que señala el valor.
	for (let i = 0; i < 8; i++) {
		const a = -Math.PI * 0.75 + (i / 7) * Math.PI * 1.5;
		// CLARAS sobre el aro oscuro. En negro sobre negro la corona no existía: la escala estaba
		// dibujada, pero no se veía ni una marca, que para una escala es lo mismo que no tenerla.
		g.add(caja(0.7, 2, 0.9, M.plastico(0xc7c3b8, 0.55),
			Math.cos(a) * rMando * 1.15, yMando + Math.sin(a) * rMando * 1.15, zNariz + 0.8));
	}
	g.add(caja(0.9, rMando * 0.8, 1, M.plastico(0xc0392b, 0.4), 0, yMando + rMando * 0.4, zNariz + 2.4));

	/*
	 * REARME y PRUEBA: los dos pulsadores pequeños de la parte baja. El de rearme es azul o negro
	 * y el de prueba rojo, y están a distinta altura porque uno se pulsa a menudo y el otro casi
	 * nunca. Van rehundidos en su alojamiento: un botón posado sobre la cara se ve flotando.
	 */
	const yBotones = -altoNariz * 0.3;
	for (const [dx, col, r] of [[-w * 0.22, 0x2b3a52, 2.2], [w * 0.22, 0xb03a2e, 1.8]] as const) {
		// Mismo caso que el aro: el alojamiento acababa a dos décimas de la cara del frontal.
		g.add(cilindro(r * 1.5, 2.2, M.baquelita(0x15181a), dx, yBotones, zNariz - 0.3));
		g.add(cilindro(r, 2.4, M.plastico(col, 0.45), dx, yBotones, zNariz + 1));
	}
	// Ventanilla del testigo de disparo, entre los dos botones.
	const testigo = caja(Math.min(7, w * 0.24), 2.8, 1.2, M.plastico(0x2e7d32, 0.32), 0, yBotones, zNariz + 0.4);
	testigo.userData.pieza = 'mirilla';
	g.add(testigo);

	// El RANGO es lo que define a un térmico —a cuántos amperios se puede tarar— y sale de
	// `rangoRegulacionA`, el mismo dato con el que este modelo se eligió en vez del de relé.
	for (const [i, linea] of fichaVisible(d).reverse().entries()) {
		const rot = marca(linea, i === 0 ? 3 : 2.2, false);
		if (!rot) continue;
		rot.position.set(0, -altoNariz * 0.42 - i * 3.8, zNariz + 0.12);
		if (i > 0) rot.userData.lod = 'medio';
		g.add(rot);
	}
	return prof;
}

function releAux(g: THREE.Group, w: number, h: number, color: number, conDial: boolean): number {
	const prof = 70;
	/*
	 * Zócalo + relé enchufable translúcido con su clip.
	 *
	 * El zócalo llegaba a 22 mm de fondo y los bornes se pintaban a 16: quedaban DENTRO del
	 * zócalo, invisibles y atravesándolo. Ahora el zócalo se queda por detrás del hombro de
	 * conexión y los bornes salen en su cara superior, que es donde se atornillan de verdad.
	 */
	const zZocalo = Z_BORNE - 4;
	cuerpoDeCarril(g, w, h, zZocalo, M.plastico(0x33383c, 0.6), 1.4, 0.5);
	// Cuerpo transparente del relé, montado sobre el zócalo y hacia delante.
	const cuerpoRele = M.translucido(color, 0.42);
	const altoRele = h * 0.58;
	g.add(cajaCanto(w * 0.82, altoRele, prof - Z_BORNE, cuerpoRele, 0, 0, (Z_BORNE + prof) / 2, 1.4, 0.5));
	// Por dentro se ve la bobina de cobre y el yugo: es lo que hace creíble el relé transparente.
	g.add(cilindro(Math.min(w * 0.2, altoRele * 0.3), prof - Z_BORNE - 8, M.cobre(), 0, 0, (Z_BORNE + prof) / 2));
	g.add(caja(w * 0.5, 2.5, prof - Z_BORNE - 10, M.metal(0x9aa1a8), 0, altoRele * 0.3, (Z_BORNE + prof) / 2));
	/*
	 * DIAL DE TIEMPO con su escala, en la cara. Un temporizador se distingue de un relé de
	 * maniobra precisamente por esto: tiene algo que ajustar y una escala para leerlo. Sin el
	 * dial, KT se veía exactamente igual que cualquier relé enchufable.
	 *
	 * Pero SOLO si de verdad temporiza. Puesto a todos los relés enchufables, un relé de
	 * interposición como el K1 del climatizador salía con una escala de tiempo que no tiene, y
	 * eso es peor que no tener dial: es enseñar un mando que en el aparato real no existe.
	 */
	if (conDial) {
		const rDial = Math.min(w * 0.22, altoRele * 0.24);
		const yDial = altoRele * 0.18;
		g.add(cilindro(rDial * 1.35, 1.8, M.baquelita(0x1b1f22), 0, yDial, prof - 0.6));
		g.add(cilindro(rDial, 2.2, M.plastico(0xe8e4d8, 0.5), 0, yDial, prof + 0.8));
		// Las marcas van CLARAS sobre el aro oscuro: en negro sobre negro la escala está dibujada
		// pero no se ve ni una marca, que para una escala es lo mismo que no tenerla.
		for (let i = 0; i < 6; i++) {
			const a = -Math.PI * 0.7 + (i / 5) * Math.PI * 1.4;
			g.add(caja(0.5, 1.4, 0.8, M.plastico(0xc7c3b8, 0.55),
				Math.cos(a) * rDial * 1.2, yDial + Math.sin(a) * rDial * 1.2, prof + 0.4));
		}
		g.add(caja(0.8, rDial * 0.75, 0.9, M.plastico(0xc0392b, 0.4), 0, yDial + rDial * 0.35, prof + 1.9));
	}
	// Banderita de estado y clip de retención.
	g.add(caja(w * 0.3, 3, 2, M.plastico(0xe0653a, 0.4), 0, -altoRele * 0.34, prof - 1));
	g.add(caja(2, altoRele * 0.9, prof - Z_BORNE - 4, M.metal(0xcfd4d8), -w * 0.44, 0, (Z_BORNE + prof) / 2));
	return prof;
}

function fusibleModelo(g: THREE.Group, w: number, h: number, color: number): number {
	const prof = 72;
	const zCuerpo = Z_BORNE;
	cuerpoDeCarril(g, w, h, zCuerpo, M.tecnico(color), 1.4, 0.5);
	/*
	 * PORTAFUSIBLE ABATIBLE, articulado por su bisagra.
	 *
	 * La tapa era una caja girada 0,35 rad sobre su propio centro: al girar sobre el centro, la
	 * mitad de atrás se hundía diez milímetros DENTRO del cuerpo del fusible, y la punta de
	 * delante se iba a 56 mm cuando el aparato declaraba ocupar 51,8. O sea: atravesaba su propio
	 * cuerpo por detrás y sobresalía de su huella por delante, y un cable tendido a ras de su cara
	 * lo cruzaba. Ahora gira sobre la BISAGRA, que es un eje de verdad en la parte baja, y toda la
	 * tapa cabe dentro de la profundidad declarada.
	 */
	const altoTapa = Math.min(h * 0.62, 48);
	const anchoTapa = w * 0.82;
	const hondoTapa = 12;
	const cajon = M.plastico(0x2b3035, 0.45);
	const bisagra = new THREE.Group();
	bisagra.position.set(0, -h * 0.3, zCuerpo + 1.5);
	// Positivo: la tapa se abate HACIA FUERA. Con el signo al revés la punta se iba hacia dentro.
	bisagra.rotation.x = 0.18;
	/*
	 * EL CAJÓN ES HUECO, que es toda la gracia de un portafusible.
	 *
	 * La tapa era un bloque MACIZO de 9 mm con el cartucho cerámico clavado a 8,6: el cartucho
	 * atravesaba la tapa de parte a parte y asomaba cinco milímetros y medio por delante, como un
	 * puro metido en un ladrillo. Un portafusible de verdad es un cajoncito abatible —fondo, dos
	 * costados, dos topes y un marco frontal con su ventana— y el cartucho va DENTRO, visible por
	 * la ventana y sin salir por ningún lado. Construyéndolo por piezas sale hueco de verdad, sin
	 * necesidad de recortar geometría.
	 */
	const medioX = anchoTapa / 2;
	bisagra.add(caja(anchoTapa, altoTapa, 1.6, cajon, 0, altoTapa / 2, 0.8));              // fondo
	for (const s of [-1, 1]) {
		bisagra.add(caja(1.8, altoTapa, hondoTapa, cajon, s * (medioX - 0.9), altoTapa / 2, hondoTapa / 2));
	}
	for (const y of [1.4, altoTapa - 1.4]) {
		bisagra.add(caja(anchoTapa, 2.8, hondoTapa, cajon, 0, y, hondoTapa / 2));           // topes
	}
	// Marco frontal: cuatro tiras alrededor del hueco, para que la ventana sea un hueco de verdad.
	const marco = Math.max(2, anchoTapa * 0.14);
	for (const s of [-1, 1]) {
		bisagra.add(caja(marco, altoTapa, 2.4, cajon, s * (medioX - marco / 2), altoTapa / 2, hondoTapa - 1.2));
	}
	for (const y of [altoTapa * 0.13, altoTapa * 0.87]) {
		bisagra.add(caja(anchoTapa, altoTapa * 0.2, 2.4, cajon, 0, y, hondoTapa - 1.2));
	}
	/*
	 * El CARTUCHO, dentro del cajón y sin tocar el marco: cuerpo cerámico y los dos casquillos
	 * metálicos de los extremos, que es por donde hace contacto. Es lo que se mira para saber qué
	 * calibre lleva puesto un cuadro, así que merece los dos materiales.
	 */
	const rCart = Math.min(w * 0.15, (hondoTapa - 4.6) / 2, altoTapa * 0.12);
	const zCart = 1.6 + (hondoTapa - 4 - 1.6) / 2;
	const largoCart = altoTapa * 0.6;
	bisagra.add(cilindro(rCart, largoCart, M.plastico(0xd6cbb2, 0.78), 0, altoTapa / 2, zCart, false));
	for (const s of [-1, 1]) {
		bisagra.add(cilindro(rCart * 1.06, largoCart * 0.16, M.galvanizado(0xb4babf),
			0, altoTapa / 2 + s * largoCart * 0.42, zCart, false));
	}
	// La UÑA de agarre arriba: el resalte estriado del que se tira para abatir el cajón.
	bisagra.add(cajaCanto(anchoTapa * 0.62, 4.4, 3.6, cajon, 0, altoTapa - 2.6, hondoTapa + 1.4, 0.8, 0.6));
	for (const dx of [-1, 0, 1]) {
		bisagra.add(caja(0.8, 3.4, 0.8, M.baquelita(0x15181a), dx * anchoTapa * 0.14, altoTapa - 2.6, hondoTapa + 3));
	}
	g.add(bisagra);
	// El ALOJAMIENTO del cajón en el cuerpo, rehundido: el cajón no se apoya en una cara lisa, se
	// mete en su hueco, y el escalón que lo rodea es lo que lo enseña como pieza desmontable.
	g.add(caja(anchoTapa + 2.4, altoTapa * 0.9, 4, M.baquelita(0x14171a), 0, -h * 0.3 + altoTapa * 0.42, zCuerpo - 1));
	g.add(cilindro(2, w * 0.86, M.metal(0x8d949a), 0, -h * 0.3, zCuerpo + 1.5, false));
	// Testigo de fusión, metido en su ventanita.
	g.add(caja(w * 0.46, 4.4, 1.4, M.baquelita(0x15181a), 0, -h * 0.42, zCuerpo - 0.2));
	g.add(caja(w * 0.4, 3, 1.4,
		new THREE.MeshStandardMaterial({ color: 0xd23b3b, emissive: 0x881111, emissiveIntensity: 0.3 }),
		0, -h * 0.42, zCuerpo + 0.6));
	return prof;
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
	g.add(caja(w, h, prof, M.tecnico(color), 0, 0, prof / 2));

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
	// Aparato sin modelo propio: aun así, con el hombro de bornes descubierto y las aristas
	// matadas, para que no desentone al lado de los que sí lo tienen.
	const prof = 55;
	const cuerpo = M.tecnico(color);
	cuerpoDeCarril(g, w, h, Z_BORNE, cuerpo, 1.6, 0.7);
	g.add(cajaCanto(w * 0.94, h * 0.56, prof - Z_BORNE, cuerpo, 0, 0, (Z_BORNE + prof) / 2, 1.4, 0.6));
	// Aunque no tenga modelo propio, lleva el hombro y el frontal embutido de la familia: es lo
	// mínimo para que no se vea como el ladrillo de relleno que hay entre aparatos de verdad.
	for (const s2 of [-1, 1]) {
		g.add(cajaCanto(w * 0.94, 2.4, 4.5, cuerpo, 0, s2 * (h * 0.28 + 1), Z_BORNE + 2.2, 1, 0.9));
	}
	panelEmbutido(g, w * 0.88, h * 0.5, prof, M.plastico(0xd7d9da, 0.64), 1.2, 0, 0, 1);
	return prof;
}

/**
 * Aparato de mando de puerta (pulsador, seta de emergencia, selector, piloto): cuerpo trasero
 * cuadrado con los contactos y, al frente, el aro metálico y la cabeza redonda que es lo que
 * se ve desde fuera del tablero.
 */
function mando(g: THREE.Group, w: number, h: number, color: number, forma: 'seta' | 'pulsador' | 'piloto' | 'selector'): number {
	/*
	 * PULSADOR / SETA / PILOTO / SELECTOR de 22 mm.
	 *
	 * El bloque de contactos ocupaba hasta 34 mm y los cuatro bornes se pintaban a 6 mm: DENTRO
	 * del bloque, invisibles y atravesándolo, y a cuarenta milímetros de donde el cable decía
	 * engancharse. Ahora el bloque se queda por detrás, y sobre él hay una repisa de conexión a
	 * la cota común: los bornes se ven, y el cable sale de ellos.
	 */
	const prof = 58;
	const cuerpo = Math.min(w, h) * 0.8;
	const zBloque = 34;
	cuerpoDeCarril(g, cuerpo, cuerpo, zBloque, M.plastico(0x2a2f33, 0.6), 1.4, 0.6);
	// Repisa de bornes: llega hasta la cota de conexión y es más ancha que el bloque.
	g.add(cajaCanto(Math.min(w, cuerpo * 1.25), Math.min(h, cuerpo * 1.25), Z_BORNE - zBloque,
		M.baquelita(0x23272a), 0, 0, (zBloque + Z_BORNE) / 2, 1.2, 0.5));
	// Tuerca y aro metálico de fijación a la chapa.
	// Níquel mate, no cromo: la tuerca de un mando de 22 mm no es un espejo, y con el brillo alto
	// era el anillo blanco lo primero que se veía del aparato, por delante de la propia cabeza.
	const aro = new THREE.Mesh(
		new THREE.CylinderGeometry(cuerpo * 0.52, cuerpo * 0.56, 5, 24),
		M.galvanizado(0x9298a0),
	);
	aro.rotation.x = Math.PI / 2;
	aro.position.set(0, 0, Z_BORNE + 2.5);
	g.add(aro);

	/*
	 * EL EMBELLECEDOR entre la tuerca y la cabeza: el aro de plástico negro que lleva todo mando
	 * de 22 mm y sobre el que va la corona rotulada. Sin él la cabeza de color salía directamente
	 * del aro metálico, y un pulsador se leía como un disco de color pegado a una arandela.
	 */
	g.add(cilindro(cuerpo * 0.51, 5, M.tecnico(0x24282b), 0, 0, Z_BORNE + 7));

	const r = cuerpo * (forma === 'seta' ? 0.58 : 0.36);
	const alto = forma === 'seta' ? 12 : forma === 'selector' ? 5 : 8;
	// Cuánto abomba la cara: una seta es una cúpula, un piloto una lente y un pulsador apenas se
	// curva. Se decide aquí porque de ella depende dónde se apoya la cabeza.
	const flecha = forma === 'seta' ? 3.4 : forma === 'piloto' ? 2.4 : 1.1;
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
	// La cabeza retrocede lo que abomba su cúpula, para que el conjunto no ocupe MÁS de lo que
	// ocupaba antes: la flecha se le quita al cilindro, no se le suma al aparato.
	cabeza.position.set(0, 0, prof - 8 + alto / 2 - flecha);
	cabeza.userData.pieza = forma === 'piloto' ? 'lente' : 'boton';
	cabeza.userData.colorPropio = color;
	g.add(cabeza);
	/*
	 * LA CARA DE LA CABEZA NO ES PLANA, y de plana era de lo que más cantaba: un cilindro cortado a
	 * escuadra no coge más que una mancha de luz uniforme, así que un pulsador se leía como una
	 * ficha de parchís. Un piloto es una lente ABOMBADA, una seta es una cúpula y un pulsador tiene
	 * la cara ligeramente rehundida para el dedo. Con un casquete esférico —doce por diez segmentos,
	 * unos doscientos triángulos— la pieza pasa a tener silueta.
	 *
	 * Va como HIJA de la cabeza a propósito: el pulsador se hunde 3,2 mm al accionarlo, y una cúpula
	 * suelta se quedaría flotando en el aire mientras el botón entra.
	 */
	if (forma !== 'selector') {
		/*
		 * El casquete se calcula a partir de la FLECHA que se quiere, no al revés: dado el radio de
		 * la cabeza y lo que debe abombar, salen el radio de la esfera y el ángulo que hay que
		 * cortar. Puesto a ojo —una esfera del radio de la cabeza— el polo se iba ocho milímetros
		 * por delante de la profundidad declarada del aparato, y un cable tendido a ras de la puerta
		 * lo habría atravesado.
		 */
		const rEsfera = (r * r + flecha * flecha) / (2 * flecha);
		const cupula = new THREE.Mesh(
			new THREE.SphereGeometry(rEsfera, 24, 8, 0, Math.PI * 2, 0, Math.asin(r / rEsfera)),
			cabeza.material,
		);
		// En coordenadas LOCALES de la cabeza, que está girada 90°: su eje largo es el Y local.
		cupula.position.set(0, alto / 2 - (rEsfera - flecha), 0);
		cupula.userData.colorPropio = color;
		cabeza.add(cupula);
	}

	if (forma === 'selector') {
		/*
		 * La MANETA del selector: cuerpo con las dos caras planas por las que se coge, la flecha
		 * que señala la posición y el disco del que sale. Una losa de 4 mm de canto no era una
		 * maneta, era una raya negra atravesada sobre el mando.
		 */
		const maneta = new THREE.Group();
		maneta.add(cajaCanto(r * 1.9, r * 0.62, 5, M.plastico(0x1b1f22, 0.45), 0, 0, 0, 0.8, 0.5));
		maneta.add(caja(r * 0.55, r * 0.28, 1.2, M.plastico(0xdcd8cc, 0.5), r * 0.6, 0, 2.6));
		maneta.position.set(0, 0, prof - 8 + alto + 1);
		maneta.rotation.z = -Math.PI / 6;
		maneta.userData.pieza = 'maneta';
		g.add(maneta);
		// Corona con las posiciones marcadas alrededor del embellecedor: es lo que convierte un
		// pomo en un SELECTOR, porque dice cuántas posiciones tiene y dónde están.
		for (const a of [-Math.PI / 3, 0, Math.PI / 3]) {
			g.add(caja(0.9, 2.2, 0.9, M.plastico(0xdcd8cc, 0.55),
				Math.sin(a) * cuerpo * 0.42, Math.cos(a) * cuerpo * 0.42, prof - 8.4));
		}
	}
	return prof;
}

/** El color de fábrica de cada tipo, para que el editor pueda enseñarlo antes de tocarlo. */
export function colorDeTipo(tipo: string): number {
	return COLOR_TIPO[tipo] ?? COLOR_TIPO.otro;
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

/**
 * LO QUE UN APARATO PUEDE ENSEÑAR ESCRITO, y solo eso.
 *
 * Cada línea sale de un campo que el aparato tiene RELLENO. No hay ni un dato de relleno: si un
 * automático no declara curva, no se le imprime ninguna; si un contactor no tiene referencia, su
 * frontal se queda sin ella. Un simulador que enseña un calibre inventado es peor que uno que no
 * enseña nada, porque el que lo lee no tiene forma de saber cuál de los dos números es de verdad.
 *
 * Devuelve como mucho dos líneas cortas: una placa industrial lleva pocos datos y grandes, no un
 * párrafo.
 */
function fichaVisible(d: Dispositivo): string[] {
	const lineas: string[] = [];
	if (d.referencia) lineas.push(d.referencia);
	const tecnica: string[] = [];
	// «C16» es como se marca de verdad un automático: la curva pegada al calibre.
	if (d.curvaDisparo && d.corrienteNominal) tecnica.push(`${d.curvaDisparo}${d.corrienteNominal}`);
	else if (d.corrienteNominal) tecnica.push(`${d.corrienteNominal}A`);
	else if (d.curvaDisparo) tecnica.push(d.curvaDisparo);
	if (d.polos) tecnica.push(`${d.polos}P`);
	if (d.sensibilidadMA) tecnica.push(`${d.sensibilidadMA}mA`);
	if (d.rangoRegulacionA) tecnica.push(`${d.rangoRegulacionA[0]}-${d.rangoRegulacionA[1]}A`);
	if (d.temporizacion?.segundos) tecnica.push(`${d.temporizacion.segundos}s`);
	if (tecnica.length) lineas.push(tecnica.join(' '));
	return lineas.slice(0, 2);
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
			profundidad = modular(g, w, h, color, d, Math.max(1, Math.round(w / 18)));
			break;
		case 'guardamotor':
			profundidad = guardamotorModelo(g, w, h, color, ref);
			break;
		case 'contactor':
			profundidad = contactor(g, w, h, color, d);
			break;
		case 'rele':
			// Un aparato que declara rango de regulación es un térmico de sobrecarga: se tara, y
			// eso se le ve por fuera. Lo demás que llega como relé son relés y temporizadores.
			// El azul de fábrica del tipo es el del relé ENCHUFABLE, que es azul de verdad. Un
			// térmico de sobrecarga es gris antracita: con el azul del relé se quedaba de juguete.
			profundidad = d.rangoRegulacionA
				? releTermicoModelo(g, w, h, d.colorCuerpo ? color : 0x585f66, d)
				: w <= 30 ? releAux(g, w, h, COLOR_TIPO.rele, !!d.temporizacion) : contactor(g, w, h, 0x4a545c, d);
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

	/*
	 * LOS BORNES SE DIBUJAN AL FINAL, UNA SOLA VEZ Y PARA TODOS.
	 *
	 * Antes cada modelo pintaba su propia fila «a ojo»: tres arriba y tres abajo en el contactor,
	 * cinco en la fuente, cuatro en el pulsador… sin mirar cuántos bornes tiene el aparato de
	 * verdad ni dónde se le engancha el cable. Un contactor con diez bornes enseñaba seis
	 * tornillos, y ninguno estaba donde salía el cable. Ahora sale un tornillo por borne real, en
	 * su punto exacto, con el mismo reparto que usa `anclajeBorne()`.
	 */
	/*
	 * La TINTA se elige por lo oscuro que sea el cuerpo, no aparato por aparato: una serigrafía se
	 * imprime en el color que contrasta con la carcasa, y así cualquier aparato nuevo —o uno al que
	 * el usuario le cambie el color desde el editor— sale legible sin tocar nada.
	 */
	const c = new THREE.Color(color);
	dibujarBornesReales(g, d, w, h, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.36);

	g.traverse((o) => {
		o.userData.dispositivoId = d.id;
		if (!(o instanceof THREE.Mesh)) return;
		/*
		 * UNA SERIGRAFÍA NO TIENE ESPESOR, así que no proyecta ni recibe sombra. Con las banderas
		 * puestas, un rótulo situado a una décima de milímetro de la cara que rotula se hacía
		 * sombra a sí mismo y salía en gris sucio sobre la carcasa —o directamente no se leía—.
		 * Es tinta sobre plástico: se ilumina con la cara, no aparte de ella.
		 */
		if (o.userData.esMarca) { o.castShadow = false; o.receiveShadow = false; return; }
		o.castShadow = true;
		o.receiveShadow = true;
	});
	return { grupo: g, profundidad };
}
