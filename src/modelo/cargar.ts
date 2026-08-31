/**
 * Apertura de un archivo de proyecto: validación y migración.
 *
 * Antes bastaba con que el JSON tuviera `formato` y `gabinete` para aceptarlo, así que un
 * archivo a medio escribir entraba y reventaba la aplicación a la primera pasada. Y el campo
 * `version` del modelo no se leía en ningún sitio: el día que cambie el formato, los
 * proyectos guardados de un cliente fallarían sin explicación.
 *
 * Aquí se comprueba de verdad la forma del archivo, se rellena lo que falte con valores
 * sanos y se deja escrito dónde va la migración de la próxima versión.
 */
import {
	AjustesMazo, BloqueTerminales, Borne, Canaleta, Colocacion, Conductor, Dispositivo, EntradaCable,
	Gabinete, Hoja, LadoAparato, OpcionesProyecto, RotuloFrontal, Posicion, Proyecto, Riel, Rol,
} from './tipos.js';
import { BloqueDossier, SECCIONES_DOSSIER, TrozoTexto } from './dossier.js';
import { leerComportamientoSimulacion, validarComportamiento } from './comportamiento.js';
import { leerFisicaConductor, leerFisicaDispositivo } from './fisica.js';
import { leerConfiguracionIngenieria } from './ingenieria.js';
import type { ConfiguracionProgramaPLC, EtiquetaPLC } from './programa-plc.js';

/** Versión de formato que escribe este programa. */
export const VERSION_FORMATO = 1;

export interface ResultadoCarga {
	proyecto: Proyecto;
	/** Cosas que se arreglaron solas al abrir (se le cuentan al usuario). */
	arreglos: string[];
	/** Lo mismo, con el sitio exacto y el motivo. Es lo que hace verificable el contrato. */
	diagnosticos: Diagnostico[];
}

/**
 * TODO CAMBIO DESTRUCTIVO SE APUNTA. Ese es el contrato, y es lo que faltaba.
 *
 * Tercera auditoría, TS3-P0-01. La protección del autosave —congelar el guardado si el archivo
 * hubo que repararlo— depende de que el cargador DIGA que lo reparó. Y eso era una lista que cada
 * lector podía olvidar rellenar. `leerImagen()` la olvidaba: quitaba la imagen y devolvía cero
 * arreglos, así que el arranque no congelaba nada y el primer `autoguardar()` reemplazaba el
 * original. Medido por la auditoría, de punta a punta y por la interfaz: **1.046 bytes antes, 910
 * después, imagen perdida, cero diálogos**.
 *
 * El fallo no era de `leerImagen`: era del contrato. «Acuérdate de apuntarlo» no es una garantía,
 * es una intención. Así que ahora lo apunta un solo sitio —`quitado()`— por el que pasan todos los
 * lectores: si la entrada TRAÍA algo y a la salida no está, se anota con su ruta y su motivo, y de
 * ahí sale el arreglo que congela el guardado. Un lector nuevo que se olvide de llamarlo se cae
 * por la prueba paramétrica de `test/cargar.test.ts`, que muta campo por campo y exige que cada
 * uno se conserve, se rechace o se declare.
 */
export interface Diagnostico {
	/** Dónde estaba, como se escribe en el archivo: `dispositivos[0].imagen`. */
	ruta: string;
	motivo: string;
}

/**
 * Lo apuntado en la lectura que está en curso.
 *
 * Va en el módulo y no pasando un parámetro por veinte funciones a propósito: el objetivo es que
 * apuntar cueste lo mínimo, porque un contrato que estorba se acaba saltando. `cargarProyecto()`
 * lo vacía al empezar y no hay lecturas concurrentes: esto es síncrono de arriba abajo.
 */
let diagnosticos: Diagnostico[] = [];

/** Apunta que algo se cambió o se quitó, con su sitio y su motivo. */
function anotar(ruta: string, motivo: string): void {
	diagnosticos.push({ ruta, motivo });
}

/**
 * Devuelve `valor`, y si la entrada TRAÍA algo que no ha sobrevivido, lo apunta.
 *
 * Es el paso por el que tiene que ir todo lector que pueda devolver `undefined`. Un campo ausente
 * en la entrada no es un cambio destructivo y no se apunta: lo que se apunta es haber tenido que
 * tirar algo que estaba escrito.
 */
function oQuitado<T>(bruto: unknown, valor: T | undefined, ruta: string, motivo: string): T | undefined {
	if (bruto !== undefined && valor === undefined) anotar(ruta, motivo);
	return valor;
}

export class ArchivoInvalido extends Error {}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const esLista = (v: unknown): v is unknown[] => Array.isArray(v);
const texto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const numero = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/*
 * LO DE DENTRO TAMBIÉN SE MIRA.
 *
 * Comprobar que `rieles` es una lista de objetos no basta: lo que se dibuja son sus NÚMEROS. Un
 * riel con `x: "treinta"`, o una canaleta con `ancho: null`, entraban tal cual y salían del otro
 * lado convertidos en NaN —medido: con esa canaleta el ruteo devolvía longitudes NaN—, y unos
 * `bornes: ["1", 2, null]` tiraban la aplicación entera con «Cannot read properties of null».
 *
 * No es rebuscado. Estos archivos van por correo y por pendrive entre el taller y la obra, se
 * copian a medias, se abren con la versión de otro y alguna vez se tocan a mano para arreglar
 * algo. La regla es siempre la misma —**lo que no es un número no entra**— y lo que se descarta
 * se cuenta, para que quien abre el archivo se entere en ese momento y no tres horas después,
 * mirando un plano que no cuadra.
 */

/** Número dentro de un rango. Fuera de rango, o si no es número, `undefined`. */
const enRango = (v: unknown, min: number, max: number): number | undefined => {
	const n = numero(v);
	return n !== undefined && n >= min && n <= max ? n : undefined;
};

/** Número que tiene que estar sí o sí; si no vale, se usa el de reserva. */
const conReserva = (v: unknown, min: number, max: number, reserva: number): number =>
	enRango(v, min, max) ?? reserva;

/**
 * Lo más grande que se admite en milímetros. Una placa de cinco metros no existe, y un número
 * enorme metido en el archivo manda la cámara al infinito y deja la pantalla en negro.
 */
const MAX_MM = 5000;

/**
 * Cuánto se admite de cada cosa, y por qué hay un tope.
 *
 * Tercera auditoría, TS3-P2-04. No había ninguno: un archivo con 60.000 aparatos se leía entero,
 * se le construía la escena 3D y se guardaba en `localStorage`. Eso no es un tablero, es una
 * pestaña bloqueada y una cuota reventada — y el que lo abre no tiene forma de saber qué pasó.
 *
 * Los números salen de lo que es un tablero de verdad con mucho margen: el más grande de esta
 * cubierta tiene 134 máquinas y algo más de 500 conductores. Mil aparatos es diez veces cualquier
 * tablero que quepa en una placa, y cinco mil cables es más de lo que cabe en las canaletas.
 * Pasarse de aquí no se rechaza: se recorta y se dice, que es lo que permite abrir un archivo
 * dañado y ver qué tenía dentro.
 */
const TOPES = {
	dispositivos: 1000,
	conductores: 5000,
	hojas: 100,
	rieles: 200,
	canaletas: 200,
	bornesPorAparato: 500,
	/** Caracteres del JSON entero. Un proyecto normal con fotos anda por debajo de los 8 MB. */
	json: 40_000_000,
};

/** Recorta una lista al tope y lo apunta. Devuelve la lista tal cual si cabía. */
function conTope(v: unknown, tope: number, nombre: string, arreglos: string[]): unknown {
	if (!esLista(v) || v.length <= tope) return v;
	arreglos.push(`el archivo traía ${v.length} ${nombre} y el máximo es ${tope}: se leyeron los primeros`);
	return v.slice(0, tope);
}

/**
 * Lee un proyecto de un texto JSON. Lanza `ArchivoInvalido` con un motivo entendible si el
 * archivo no es un proyecto; nunca devuelve algo a medias que rompa la aplicación después.
 */
export function cargarProyecto(json: string): ResultadoCarga {
	// El tope del archivo se mira ANTES de interpretarlo: `JSON.parse` de 400 MB ya es el problema.
	if (json.length > TOPES.json) {
		throw new ArchivoInvalido(
			`El archivo ocupa ${Math.round(json.length / 1e6)} MB y el máximo es ${TOPES.json / 1e6} MB. `
			+ 'Un proyecto así no se puede abrir sin bloquear el navegador.',
		);
	}
	let bruto: unknown;
	try {
		bruto = JSON.parse(json);
	} catch {
		throw new ArchivoInvalido('El archivo no es un JSON válido (¿se descargó a medias?).');
	}
	if (!esObjeto(bruto)) throw new ArchivoInvalido('El archivo no contiene un proyecto.');
	if (bruto.formato !== 'tablero-studio') {
		throw new ArchivoInvalido('Ese archivo no es un proyecto de TableroStudio.');
	}

	const version = numero(bruto.version) ?? 1;
	if (version > VERSION_FORMATO) {
		throw new ArchivoInvalido(
			`El proyecto se guardó con una versión más nueva del programa (formato ${version}). `
			+ 'Actualiza TableroStudio para abrirlo.',
		);
	}

	const arreglos: string[] = [];
	diagnosticos = [];
	// Aquí irán las migraciones: `if (version < 2) { …; arreglos.push('…'); }`. Se dejan
	// encadenadas para que un proyecto viejo suba de versión en versión hasta la actual.

	if (!esObjeto(bruto.gabinete)) throw new ArchivoInvalido('Al proyecto le falta el gabinete.');
	const gabinete = leerGabinete(bruto.gabinete, arreglos);

	const dispositivos = leerDispositivos(
		conTope(bruto.dispositivos, TOPES.dispositivos, 'aparatos', arreglos), arreglos);
	/*
	 * Los BORNES que existen de verdad, por aparato.
	 *
	 * Tercera auditoría, TS3-P1-01. Se comprobaba el `dispositivoId` de cada extremo pero no el
	 * `borneId`, así que un cable a `borneId: "NO_EXISTE"` cargaba con cero arreglos, el motor de
	 * potenciales le creaba una clave fantasma y el 3D lo dibujaba con su respaldo de «al centro
	 * del aparato». O sea: un cable que en pantalla parece bien conectado, que entra en el DRC y
	 * que no va a ninguna parte. Es de los errores que se descubren con el tablero montado.
	 */
	const bornesDe = new Map(dispositivos.map((d) => [d.id, new Set(d.bornes.map((b) => b.id))]));
	const conductores = leerConductores(
		conTope(bruto.conductores, TOPES.conductores, 'cables', arreglos), bornesDe, arreglos);

	// Una colocación que apunta a un aparato que ya no existe deja un hueco fantasma. Y dos
	// colocaciones del mismo aparato lo dibujan dos veces: se queda la primera.
	const antesColocaciones = gabinete.colocaciones.length;
	const colocados = new Set<string>();
	gabinete.colocaciones = gabinete.colocaciones.filter((c) => {
		if (!bornesDe.has(c.dispositivoId) || colocados.has(c.dispositivoId)) return false;
		colocados.add(c.dispositivoId);
		return true;
	});
	if (gabinete.colocaciones.length !== antesColocaciones) {
		arreglos.push(`${antesColocaciones - gabinete.colocaciones.length} colocación(es) sin aparato o repetida(s)`);
	}

	const brutoHojas = conTope(bruto.hojas, TOPES.hojas, 'hojas de esquema', arreglos);
	const hojas = esLista(brutoHojas)
		? (brutoHojas.filter(esObjeto) as unknown as Hoja[]).filter((h) => texto(h.id))
		: [];
	if (hojas.length === 0) {
		hojas.push({ id: 'h1', numero: 1, titulo: 'Hoja 1' });
		arreglos.push('no traía ninguna hoja de esquema');
	}

	const proyecto: Proyecto = {
		formato: 'tablero-studio',
		version: VERSION_FORMATO,
		nombre: texto(bruto.nombre)?.trim() || 'Tablero sin nombre',
		datos: leerDatos(bruto.datos),
		hojas,
		dispositivos,
		conductores,
		gabinete,
		opciones: leerOpciones(bruto.opciones),
		esquema: leerAjustesEsquema(bruto.esquema),
		dossier: leerAjustesDossier(bruto.dossier),
		ingenieria: leerConfiguracionIngenieria(bruto.ingenieria),
	};
	/*
	 * Y lo apuntado por el camino sube a `arreglos`, que es lo que congela el guardado.
	 *
	 * Se agrupa por motivo para no soltarle al usuario ochenta líneas iguales cuando lo que pasa
	 * es que un archivo viejo trae ochenta imágenes en un formato que ya no se admite. La ruta
	 * exacta de cada una sigue estando en `diagnosticos`, para quien quiera mirar.
	 */
	const porMotivo = new Map<string, string[]>();
	for (const d of diagnosticos) {
		const lista = porMotivo.get(d.motivo) ?? [];
		lista.push(d.ruta);
		porMotivo.set(d.motivo, lista);
	}
	for (const [motivo, rutas] of porMotivo) {
		arreglos.push(rutas.length === 1 ? `${motivo} (${rutas[0]})` : `${motivo} — ${rutas.length} veces`);
	}
	return { proyecto, arreglos, diagnosticos };
}

function leerGabinete(bruto: Record<string, unknown>, arreglos: string[]): Gabinete {
	/*
	 * La placa se comprueba por arriba y por abajo, y si no cuadra se para aquí.
	 *
	 * Es el único dato del que no se puede prescindir: TODO lo demás se coloca respecto a ella, y
	 * la vista se encuadra a su tamaño. Con 0 no hay nada que dibujar, y con 10⁹ mm la cámara se
	 * va al infinito y la pantalla se queda en negro sin decir por qué. Vale más un motivo
	 * entendible al abrir que un programa que arranca y no se ve.
	 */
	const ancho = enRango(bruto.ancho, 1, MAX_MM);
	const alto = enRango(bruto.alto, 1, MAX_MM);
	if (!ancho || !alto) {
		throw new ArchivoInvalido(
			`El gabinete del proyecto no tiene medidas válidas (se admite hasta ${MAX_MM / 1000} m de placa).`,
		);
	}
	/** Aplica un lector a cada elemento y cuenta los que no valen. */
	const lista = <T>(v: unknown, nombre: string, leer: (x: Record<string, unknown>, i: number) => T | undefined): T[] => {
		if (!esLista(v)) {
			if (v !== undefined) arreglos.push(`la lista de ${nombre} estaba corrupta`);
			return [];
		}
		const salida: T[] = [];
		let fuera = 0;
		v.forEach((x, i) => {
			const leido = esObjeto(x) ? leer(x, i) : undefined;
			if (leido === undefined) fuera++;
			else salida.push(leido);
		});
		if (fuera) arreglos.push(`${fuera} ${nombre} con medidas imposibles`);
		return salida;
	};

	const orientacion = (v: unknown): 'h' | 'v' => (v === 'v' ? 'v' : 'h');

	return {
		ancho,
		alto,
		caja: leerCaja(bruto.caja, ancho, alto),
		entradas: leerEntradas(bruto.entradas, ancho, alto),
		mazoPuerta: leerMazoPuerta(bruto.mazoPuerta),
		// Un riel sin `largo` o con el largo en negativo se deja del ancho de la placa: así se ve
		// y se puede arrastrar hasta donde toque, en vez de desaparecer sin explicación.
		rieles: lista<Riel>(bruto.rieles, 'rieles', (r, i) => ({
			...(r as unknown as Riel),
			id: texto(r.id) || `riel${i + 1}`,
			x: conReserva(r.x, -MAX_MM, MAX_MM, 0),
			y: conReserva(r.y, -MAX_MM, MAX_MM, 0),
			largo: conReserva(r.largo, 1, MAX_MM, Math.max(60, ancho - 60)),
			orientacion: orientacion(r.orientacion),
		})),
		canaletas: lista<Canaleta>(bruto.canaletas, 'canaletas', (c, i) => ({
			...(c as unknown as Canaleta),
			id: texto(c.id) || `canaleta${i + 1}`,
			x: conReserva(c.x, -MAX_MM, MAX_MM, 0),
			y: conReserva(c.y, -MAX_MM, MAX_MM, 0),
			largo: conReserva(c.largo, 1, MAX_MM, Math.max(60, ancho - 40)),
			orientacion: orientacion(c.orientacion),
			// 40 × 60 es el perfil más corriente: es la reserva razonable si el archivo no lo dice.
			ancho: conReserva(c.ancho, 1, 200, 40),
			alto: conReserva(c.alto, 1, 200, 60),
		})),
		/*
		 * Aquí NO se inventa nada: una colocación es dónde va montado un aparato de verdad, y
		 * ponerla «más o menos» sería dibujar un tablero que no existe. Si no trae posición y
		 * huella creíbles se descarta, el aparato se queda en el proyecto sin colocar y el DRC lo
		 * canta como aparato sin montar, que es exactamente lo que hay que arreglar a mano.
		 */
		/*
		 * Los rótulos del frontal. Un rótulo sin texto no es un rótulo: se tira. Y el texto se
		 * recorta a algo razonable, porque una placa no es un documento y una cadena de un mega
		 * en un archivo de proyecto solo puede venir de algo que fue mal.
		 */
		rotulos: lista<RotuloFrontal>(bruto.rotulos, 'rotulos', (r, i) => {
			const linea = texto(r.texto)?.trim();
			const x = enRango(r.x, -MAX_MM, MAX_MM);
			const y = enRango(r.y, -MAX_MM, MAX_MM);
			if (!linea || x === undefined || y === undefined) return undefined;
			const estilo = r.estilo === 'placa' || r.estilo === 'aviso' || r.estilo === 'grabado'
				? r.estilo : undefined;
			return {
				id: texto(r.id) || `rot${i + 1}`,
				texto: linea.slice(0, 120),
				x, y,
				alto: enRango(r.alto, 1, 200),
				ancho: enRango(r.ancho, 4, MAX_MM),
				...(estilo ? { estilo } : {}),
				montaje: 'puerta' as const,
			};
		}),
		colocaciones: lista<Colocacion>(bruto.colocaciones, 'colocaciones', (c) => {
			const x = enRango(c.x, -MAX_MM, MAX_MM);
			const y = enRango(c.y, -MAX_MM, MAX_MM);
			const anchoCol = enRango(c.ancho, 0.1, MAX_MM);
			const altoCol = enRango(c.alto, 0.1, MAX_MM);
			if (!texto(c.dispositivoId) || x === undefined || y === undefined
				|| anchoCol === undefined || altoCol === undefined) return undefined;
			return {
				...(c as unknown as Colocacion),
				dispositivoId: c.dispositivoId as string,
				x, y, ancho: anchoCol, alto: altoCol,
				rielId: texto(c.rielId),
				z: enRango(c.z, -MAX_MM, MAX_MM),
				// Solo se acepta `puerta`; cualquier otra cosa cae en la placa, que es donde va un
				// aparato mientras nadie diga lo contrario. Un valor raro no puede dejar un aparato
				// montado en ninguna parte.
				montaje: c.montaje === 'puerta' ? 'puerta' as const : undefined,
			};
		}),
	};
}

/** La caja envolvente. Las tres medidas o ninguna: media caja no se puede dibujar. */
function leerCaja(bruto: unknown, anchoPlaca: number, altoPlaca: number): Gabinete['caja'] {
	if (!esObjeto(bruto)) return undefined;
	const ancho = enRango(bruto.ancho, anchoPlaca, MAX_MM);
	const alto = enRango(bruto.alto, altoPlaca, MAX_MM);
	const profundidad = enRango(bruto.profundidad, 1, MAX_MM);
	if (ancho === undefined || alto === undefined || profundidad === undefined) return undefined;
	// El lado de las bisagras es opcional y solo admite dos valores. Cualquier otra cosa se ignora
	// y la puerta abre por la izquierda, que es lo corriente: un dato raro no puede dejar el
	// armario sin puerta.
	const bisagras = bruto.bisagras === 'derecha' ? 'derecha' as const
		: bruto.bisagras === 'izquierda' ? 'izquierda' as const : undefined;
	/*
	 * LA TRENZA DE MASA. Es una casilla y una sección, y se lee como tal. Que venga puesta en el
	 * archivo no significa que el conjunto cumpla nada: significa que quien dibujó el tablero
	 * quiso que la trenza saliera dibujada y contada.
	 */
	const bonding = esObjeto(bruto.bonding)
		? { puesto: bruto.bonding.puesto === true, seccion: enRango(bruto.bonding.seccion, 0.5, 120) }
		: undefined;
	return {
		ancho, alto, profundidad,
		...(bisagras ? { bisagras } : {}),
		...(bonding?.puesto ? { bonding } : {}),
	};
}

/**
 * LAS ENTRADAS DE CABLE de la envolvente. Un agujero en la chapa fuera del armario no es una
 * entrada mal puesta, es un dato roto: se descarta y la entrada nace en el centro de su cara,
 * que es donde se puede ver y arrastrar hasta donde toque. Dejarla en la coordenada imposible
 * sería dibujar un prensaestopas flotando a cinco metros del tablero.
 */
function leerEntradas(bruto: unknown, ancho: number, alto: number): EntradaCable[] | undefined {
	if (!Array.isArray(bruto)) return undefined;
	const caras = ['inferior', 'superior', 'izquierda', 'derecha'] as const;
	const tipos = ['prensaestopas', 'placa-pasacables', 'conduit'] as const;
	const salida: EntradaCable[] = [];
	for (const [i, b] of bruto.slice(0, 64).entries()) {
		if (!esObjeto(b)) continue;
		const cara = caras.find((c) => c === b.cara) ?? 'inferior';
		salida.push({
			id: texto(b.id) || `ent${i + 1}`,
			cara,
			x: conReserva(b.x, 0, ancho, Math.round(ancho / 2)),
			y: conReserva(b.y, 0, alto, 0),
			tipo: tipos.find((t) => t === b.tipo) ?? 'prensaestopas',
			diametro: enRango(b.diametro, 4, 120),
			rosca: (texto(b.rosca) ?? "").slice(0, 12) || undefined,
			nombre: (texto(b.nombre) ?? "").slice(0, 60) || undefined,
		});
	}
	return salida.length ? salida : undefined;
}

/**
 * AJUSTES DEL MAZO DE PUERTA. Solo se guarda lo que el usuario apartó de lo propuesto, así que
 * aquí no hay valores por defecto que inventar: lo que no venga, no venía.
 */
function leerMazoPuerta(bruto: unknown): AjustesMazo | undefined {
	if (!esObjeto(bruto)) return undefined;
	const a: AjustesMazo = {};
	const holgura = enRango(bruto.holgura, -30, 200);
	const paso = enRango(bruto.pasoSujecion, 40, 400);
	const desde = enRango(bruto.desdeBisagra, 12, 160);
	if (holgura !== undefined) a.holgura = holgura;
	if (paso !== undefined) a.pasoSujecion = paso;
	if (desde !== undefined) a.desdeBisagra = desde;
	return Object.keys(a).length ? a : undefined;
}

/**
 * Ajustes del dibujo del esquema: columnas por hoja y títulos propios.
 *
 * Se leen aquí y no se dejan pasar tal cual porque son del archivo, y un archivo puede venir
 * tocado a mano: 500 columnas por hoja dejarían el esquema ilegible sin decir por qué.
 */
function leerAjustesEsquema(bruto: unknown): Proyecto['esquema'] {
	if (!esObjeto(bruto)) return undefined;
	const cols = Number(bruto.columnasPorHoja);
	const titulos: Record<string, string> = {};
	if (esObjeto(bruto.titulos)) {
		for (const [k, v] of Object.entries(bruto.titulos)) {
			if (typeof v === 'string' && v.trim()) titulos[k] = v.trim().slice(0, 120);
		}
	}
	const ajustes: Proyecto['esquema'] = {};
	if (Number.isFinite(cols)) ajustes.columnasPorHoja = Math.max(4, Math.min(20, Math.round(cols)));
	if (Object.keys(titulos).length) ajustes.titulos = titulos;
	return Object.keys(ajustes).length ? ajustes : undefined;
}

/**
 * Lo que el usuario ha decidido sobre el dossier: qué apartados lleva y qué le ha añadido.
 *
 * Los bloques traen IMÁGENES en data URL, que pueden ser megas. Se aceptan tal cual —son suyas—
 * pero se comprueba que sean de verdad una imagen: un `data:text/html` metido a mano en el archivo
 * acabaría en el PDF, y de ahí a un sitio donde se abra.
 */
function leerAjustesDossier(bruto: unknown): Proyecto['dossier'] {
	if (!esObjeto(bruto)) return undefined;
	const secciones: Record<string, boolean> = {};
	if (esObjeto(bruto.secciones)) {
		for (const [k, v] of Object.entries(bruto.secciones)) {
			if (typeof v === 'boolean') secciones[k] = v;
		}
	}
	const bloques: BloqueDossier[] = [];
	if (esLista(bruto.bloques)) {
		for (const b of bruto.bloques) {
			if (!esObjeto(b) || !texto(b.id)) continue;
			const tipo = b.tipo === 'imagen' ? 'imagen' : 'texto';
			const donde = ['portada', 'principio', 'final'].includes(String(b.donde))
				? (b.donde as BloqueDossier['donde']) : 'final';
			// Mismo validador que el logo y que la imagen de aparato: un solo criterio para todas
			// las entradas, que es lo que pedía TS3-P1-05.
			const imagen = leerImagen(b.imagen);
			if (tipo === 'imagen' && !imagen) {
				if (b.imagen !== undefined) {
					anotar(`dossier.bloques[${b.id}].imagen`,
						'la imagen no era un PNG, JPEG o WebP admisible');
				}
				continue;
			}
			bloques.push({
				id: b.id as string,
				tipo,
				donde,
				titulo: texto(b.titulo),
				pie: texto(b.pie),
				imagen: tipo === 'imagen' ? imagen : undefined,
				anchoPct: Number.isFinite(Number(b.anchoPct))
					? Math.max(10, Math.min(100, Number(b.anchoPct))) : undefined,
				/*
				 * CAMPO A CAMPO, y `fuente` de una lista cerrada.
				 *
				 * Segunda auditoría, TS2-P1-05. Esto era un cast del objeto entero, y `fuente` y
				 * `tam` acaban dentro del atributo `style` del editor de dossier. Una `fuente`
				 * con una comilla cierra el atributo y abre otro: el texto de un archivo pasaba a
				 * ser marcado. Aquí solo entran las tres fuentes que el PDF sabe dibujar, que
				 * además es lo único que tiene sentido guardar.
				 */
				trozos: tipo === 'texto' && esLista(b.trozos)
					? (b.trozos as unknown[]).filter(esObjeto)
						.filter((t) => typeof t.texto === 'string')
						.map((t): TrozoTexto => {
							// Los campos que no valen no se ponen a `undefined`: no se ponen. Un
							// trozo sin formato tiene que salir igual que entró.
							const tam = enRango(t.tam, 4, 96);
							const fuente = (['helvetica', 'times', 'courier'] as const)
								.find((f) => f === t.fuente);
							return {
								texto: t.texto as string,
								...(typeof t.negrita === 'boolean' ? { negrita: t.negrita } : {}),
								...(typeof t.cursiva === 'boolean' ? { cursiva: t.cursiva } : {}),
								...(tam !== undefined ? { tam } : {}),
								...(fuente ? { fuente } : {}),
							};
						})
					: undefined,
			});
		}
	}
	const ajustes: Proyecto['dossier'] = {};
	if (Object.keys(secciones).length) ajustes.secciones = secciones;
	if (bloques.length) ajustes.bloques = bloques;

	// Orden de los apartados: solo ids conocidos y sin repetir. Un id inventado en el archivo no
	// haría daño, pero tampoco aporta nada y ensucia lo que se vuelve a guardar.
	if (esLista(bruto.orden)) {
		const conocidos = new Set(SECCIONES_DOSSIER.map((x) => x.id));
		const orden = [...new Set((bruto.orden as unknown[])
			.filter((x): x is string => typeof x === 'string' && conocidos.has(x)))];
		if (orden.length) ajustes.orden = orden;
	}

	// Quién firma. El logo se acepta tal cual —es suyo— pero se comprueba que sea de verdad una
	// imagen, por lo mismo que los bloques: un `data:text/html` acabaría dentro del PDF.
	if (esObjeto(bruto.empresa)) {
		const logo = texto(bruto.empresa.logo);
		const empresa = {
			nombre: texto(bruto.empresa.nombre)?.slice(0, 120),
			contacto: texto(bruto.empresa.contacto)?.slice(0, 200),
			/*
			 * El logo pasa por el MISMO validador que las demás imágenes. Tercera auditoría,
			 * TS3-P1-05: aquí solo se miraba el prefijo `data:image/`, así que un SVG entraba —y
			 * un SVG es justo lo que jsPDF no sabe dibujar—. Que sea «suyo» no lo hace imprimible.
			 */
			logo: oQuitado(bruto.empresa.logo, leerImagen(logo),
				'dossier.empresa.logo', 'el logo no era un PNG, JPEG o WebP admisible'),
		};
		if (empresa.nombre || empresa.contacto || empresa.logo) ajustes.empresa = empresa;
	}

	const color = texto(bruto.color);
	if (color && /^#[0-9a-fA-F]{6}$/.test(color)) ajustes.color = color.toLowerCase();
	if (bruto.papel === 'carta' || bruto.papel === 'a4') ajustes.papel = bruto.papel;

	return Object.keys(ajustes).length ? ajustes : undefined;
}

/** Colocación manual de un símbolo. Un valor imposible se descarta y el motor vuelve a decidir. */
function leerColocacionEsquema(bruto: unknown): Dispositivo['esquema'] {
	if (!esObjeto(bruto)) return undefined;
	const columna = Number(bruto.columna);
	const fila = Number(bruto.fila);
	if (!Number.isFinite(columna) || !Number.isFinite(fila)) return undefined;
	return { columna: Math.max(1, Math.round(columna)), fila: Math.max(1, Math.round(fila)) };
}

/*
 * ----------------------------------------------------------------------------------------------
 * LO QUE UN MOTOR RECORRE, SE RECONSTRUYE. NO SE DEJA PASAR.
 *
 * Segunda auditoría, TS2-P1-01. El aparato entraba con un spread del objeto externo y solo se
 * saneaban los campos escalares. Todo lo que es una LISTA o un OBJETO —y que después algún motor
 * recorre con un `for…of` o desestructura— pasaba tal cual. Reproducido contra el build:
 *
 *   puentes: {}                → carga con 0 arreglos → «object is not iterable»
 *   puentesInternos: [null]    → carga con 0 arreglos → «object null is not iterable»
 *   puentes: [null]            → carga con 0 arreglos → «Cannot read properties of null»
 *   puentesInternos: "hola"    → carga con 0 arreglos → «.map is not a function»
 *
 * Nada de esto es rebuscado: son archivos que van por correo y por pendrive entre el taller y la
 * obra, se copian a medias y alguna vez se tocan a mano. Y el efecto no es un aviso feo: es el
 * editor bloqueado con el proyecto anterior ya sustituido en memoria.
 *
 * La regla, la misma de siempre y ahora también para lo anidado: **lo que no tiene la forma que
 * dice el tipo, no entra**. `test/cargar.test.ts` comprueba que no quede ningún campo estructurado
 * de `Dispositivo` sin lector, para que añadir uno nuevo y olvidarse no vuelva a abrir el agujero.
 * ---------------------------------------------------------------------------------------------- */

/** Un valor de una lista cerrada de opciones. Fuera de ella, `undefined`. */
const unoDe = <T extends string>(v: unknown, opciones: readonly T[]): T | undefined =>
	(typeof v === 'string' && (opciones as readonly string[]).includes(v) ? v as T : undefined);

/** Booleano de verdad; un `"sí"` o un `1` no lo son. */
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** Pares `[borneA, borneB]` unidos por dentro del aparato. */
function leerPuentesInternos(bruto: unknown): [string, string][] | undefined {
	if (!esLista(bruto)) return undefined;
	const salida: [string, string][] = [];
	for (const par of bruto) {
		if (!esLista(par)) continue;
		const a = texto(par[0]);
		const b = texto(par[1]);
		if (a && b && a !== b) salida.push([a, b]);
	}
	return salida.length ? salida : undefined;
}

/** Grupos de bornas puenteadas de un bornero. Un grupo de una sola borna no puentea nada. */
function leerPuentes(bruto: unknown): string[][] | undefined {
	if (!esLista(bruto)) return undefined;
	const salida: string[][] = [];
	for (const grupo of bruto) {
		if (!esLista(grupo)) continue;
		const ids = [...new Set(grupo.map(texto).filter((x): x is string => !!x))];
		if (ids.length > 1) salida.push(ids);
	}
	return salida.length ? salida : undefined;
}

const LADOS_APARATO = ['arriba', 'abajo', 'izquierda', 'derecha'] as const;

/** Disposición física de las borneras de un equipo real. */
function leerTerminales(bruto: unknown): BloqueTerminales[] | undefined {
	if (!esLista(bruto)) return undefined;
	const salida: BloqueTerminales[] = [];
	for (const b of bruto) {
		if (!esObjeto(b)) continue;
		const lado = unoDe(b.lado, LADOS_APARATO) as LadoAparato | undefined;
		const bornes = esLista(b.bornes) ? b.bornes.map(texto).filter((x): x is string => !!x) : [];
		// Un bloque sin lado o sin bornas no coloca nada: el reparto automático lo hace mejor.
		if (!lado || bornes.length === 0) continue;
		salida.push({
			lado,
			bornes,
			rotulo: texto(b.rotulo),
			margen: enRango(b.margen, 0, 200),
			desde: enRango(b.desde, 0, 1),
			hasta: enRango(b.hasta, 0, 1),
			color: texto(b.color),
			extraible: bool(b.extraible),
		});
	}
	return salida.length ? salida : undefined;
}

/**
 * Color de señalización de un piloto o un mando. Admite los nombres normalizados y un `#rrggbb`.
 * `COLOR_PILOTO` vive en la escena y aquí solo se comprueba la forma: el modelo no puede depender
 * del dibujo, así que la lista de nombres válidos se repite —son cinco— antes que atar el archivo
 * de proyecto a un módulo de Three.js.
 */
const COLORES_SENAL = ['rojo', 'verde', 'ambar', 'amarillo', 'azul', 'blanco'];

function leerColorSenal(bruto: unknown): string | undefined {
	if (typeof bruto !== 'string') return undefined;
	const v = bruto.trim().toLowerCase();
	if (COLORES_SENAL.includes(v)) return v;
	return /^#[0-9a-f]{6}$/.test(v) ? v : undefined;
}

/** Un rango `[mínimo, máximo]`. Al revés o incompleto no es un rango. */
function leerRango(bruto: unknown, min: number, max: number): [number, number] | undefined {
	if (!esLista(bruto) || bruto.length !== 2) return undefined;
	const a = enRango(bruto[0], min, max);
	const b = enRango(bruto[1], min, max);
	return a !== undefined && b !== undefined && a <= b ? [a, b] : undefined;
}

/** Temporización de un relé. Sin tipo o sin segundos no temporiza: conmuta al instante. */
function leerTemporizacion(bruto: unknown): Dispositivo['temporizacion'] {
	if (!esObjeto(bruto)) return undefined;
	const tipo = unoDe(bruto.tipo, ['trabajo', 'reposo'] as const);
	const segundos = enRango(bruto.segundos, 0, 86_400);
	return tipo && segundos !== undefined ? { tipo, segundos } : undefined;
}

/** Rasgos del frente que dibuja el modelo 3D. */
function leerRasgosFrente(bruto: unknown): Dispositivo['rasgosFrente'] {
	if (!esObjeto(bruto)) return undefined;
	const r = {
		display: bool(bruto.display),
		leds: enRango(bruto.leds, 0, 64),
		puertosIP: enRango(bruto.puertosIP, 0, 32),
		puertosRS485: enRango(bruto.puertosRS485, 0, 32),
	};
	return Object.values(r).some((v) => v !== undefined) ? r : undefined;
}

function leerPosicion(bruto: unknown): Posicion | undefined {
	if (!esObjeto(bruto)) return undefined;
	const x = enRango(bruto.x, -10_000, 10_000);
	const y = enRango(bruto.y, -10_000, 10_000);
	return x !== undefined && y !== undefined ? { x, y } : undefined;
}

/** Maestro/esclavo de un contacto auxiliar. Un esclavo sin maestro no es nada. */
function leerRol(bruto: unknown): Rol | undefined {
	if (!esObjeto(bruto)) return undefined;
	if (bruto.tipo === 'maestro') return { tipo: 'maestro' };
	if (bruto.tipo !== 'esclavo') return undefined;
	const maestroId = texto(bruto.maestroId);
	const contacto = unoDe(bruto.contacto, ['NA', 'NC', 'potencia'] as const);
	return maestroId && contacto ? { tipo: 'esclavo', maestroId, contacto } : undefined;
}

/**
 * Formatos de imagen que se admiten, y por qué esos.
 *
 * Segunda auditoría, TS2-P1-11. El cargador solo exigía que empezase por `data:image/`. Con eso,
 * un SVG —que el selector de archivos acepta como `image/*`— entraba, se guardaba, y al generar
 * el PDF jsPDF paraba con «addImage does not support files of type 'UNKNOWN'»: el dossier
 * quedaba inservible y el motivo no aparecía por ninguna parte. Estos cuatro son los que jsPDF
 * dibuja, así que lo que entra es lo que después se va a poder imprimir.
 */
const IMAGEN_ADMITIDA = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;

/**
 * Los tipos de aparato que este programa sabe tratar, y las letras de clase de la IEC 81346.
 *
 * `tipo` no se comprobaba: bastaba con que fuera un texto cualquiera. Un `tipo: "disyuntor "` con
 * un espacio de más —o el nombre en inglés de otra herramienta— dejaba un aparato que no es de
 * ninguna familia: sin símbolo de esquema, sin regla de DRC que lo mire y sin comportamiento en la
 * simulación, pero dibujado en la placa como si estuviera bien. `otro` es lo que ya hace el
 * programa con lo que no reconoce, así que es donde caen.
 */
const TIPOS_APARATO = [
	'plc', 'fuente', 'transformador', 'contactor', 'rele',
	'disyuntor', 'guardamotor', 'diferencial', 'fusible', 'seccionador',
	'variador', 'motor', 'pulsador', 'selector', 'piloto',
	'sensor', 'valvula', 'resistencia', 'condensador',
	'bornero', 'cable', 'otro',
] as const;

const LETRAS_CLASE = [
	'A', 'B', 'C', 'E', 'F', 'G', 'K', 'M', 'P',
	'Q', 'R', 'S', 'T', 'U', 'W', 'X', 'Y',
] as const;

/**
 * Tope de una imagen incrustada, en caracteres de su data URL (~6 MB de base64 ≈ 4,5 MB de
 * archivo). El historial guarda hasta 60 copias del proyecto: una foto de móvil sin límite se
 * multiplica por sesenta en memoria y revienta la cuota del guardado automático.
 */
const MAX_IMAGEN = 6_000_000;

/**
 * ¿Esta imagen se puede guardar en un proyecto?
 *
 * Se EXPORTA a propósito. Tercera auditoría, TS3-P0-01 y TS3-P1-05: la interfaz aceptaba un SVG
 * —el selector lo admite como `image/*` y `new Image()` lo decodifica sin rechistar—, lo metía en
 * el proyecto y lo autoguardaba; al recargar, el cargador lo quitaba. Trabajo aceptado por un lado
 * y tirado por el otro, con la única copia automática que lo tenía ya sobrescrita.
 *
 * La regla tiene que ser UNA, y la de la puerta de entrada tiene que ser la misma que la del
 * cargador. Si algún día se admite un formato más, se admite aquí y vale para los dos.
 */
export function imagenAdmisible(dato: string): { ok: true } | { ok: false; motivo: string } {
	if (dato.length > MAX_IMAGEN) {
		return { ok: false, motivo: `pesa más de ${Math.round(MAX_IMAGEN / 1e6)} MB en el proyecto` };
	}
	if (!IMAGEN_ADMITIDA.test(dato)) {
		const que = /^data:([^;,]+)/.exec(dato)?.[1] ?? 'desconocido';
		return { ok: false, motivo: `es ${que} y solo se admiten PNG, JPEG y WebP` };
	}
	return { ok: true };
}

function leerImagen(bruto: unknown): string | undefined {
	const s = texto(bruto);
	if (!s || s.length > MAX_IMAGEN || !IMAGEN_ADMITIDA.test(s)) return undefined;
	return s;
}

function leerAssetId(bruto: unknown): string | undefined {
	const s = texto(bruto);
	return s && /^sha256:[a-f\d]{64}$/i.test(s) ? s.toLowerCase() : undefined;
}

function leerProcedenciaPersonalizada(bruto: unknown): Dispositivo['componentePersonalizado'] | undefined {
	if (!esObjeto(bruto)) return undefined;
	const definicionId = texto(bruto.definicionId);
	const revision = typeof bruto.revision === 'number' && Number.isInteger(bruto.revision)
		&& bruto.revision >= 1 && bruto.revision <= 1_000_000 ? bruto.revision : undefined;
	return definicionId && revision !== undefined ? { definicionId, revision } : undefined;
}

/** Lista blanca del programa PLC persistente. La memoria de ejecución no tiene vía de entrada. */
function leerProgramaPLC(bruto: unknown): ConfiguracionProgramaPLC | undefined {
	if (!esObjeto(bruto) || bruto.version !== 1
		|| (bruto.lenguaje !== 'tablerostudio-plc-v4' && bruto.lenguaje !== 'legacy')
		|| typeof bruto.FUENTE !== 'string' || bruto.FUENTE.length > 100_000) return undefined;
	const periodoScanMs = typeof bruto.periodoScanMs === 'number' && Number.isFinite(bruto.periodoScanMs)
		&& bruto.periodoScanMs >= 10 && bruto.periodoScanMs <= 5_000 ? bruto.periodoScanMs : undefined;
	const modoInicial = bruto.modoInicial === 'RUN' || bruto.modoInicial === 'STOP' ? bruto.modoInicial : undefined;
	let etiquetas: EtiquetaPLC[] | undefined;
	if (Array.isArray(bruto.etiquetas)) {
		if (bruto.etiquetas.length > 1_000) return undefined;
		etiquetas = [];
		for (const item of bruto.etiquetas) {
			if (!esObjeto(item) || typeof item.nombre !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(item.nombre)
				|| (item.tipo !== 'BOOL' && item.tipo !== 'REAL')) return undefined;
			let io: EtiquetaPLC['io'];
			if (item.io !== undefined) {
				if (!esObjeto(item.io) || !['DI', 'DO', 'AI', 'AO'].includes(String(item.io.clase))
					|| typeof item.io.borne !== 'string') return undefined;
				io = { clase: item.io.clase as NonNullable<EtiquetaPLC['io']>['clase'], borne: item.io.borne };
			}
			const inicial = item.inicial === undefined ? undefined : item.tipo === 'BOOL'
				? (typeof item.inicial === 'boolean' ? item.inicial : undefined)
				: (typeof item.inicial === 'number' && Number.isFinite(item.inicial) ? item.inicial : undefined);
			if (item.inicial !== undefined && inicial === undefined) return undefined;
			const seguro = item.seguro === undefined ? undefined : item.tipo === 'BOOL'
				? (typeof item.seguro === 'boolean' ? item.seguro : undefined)
				: (typeof item.seguro === 'number' && Number.isFinite(item.seguro) ? item.seguro : undefined);
			if (item.seguro !== undefined && seguro === undefined) return undefined;
			etiquetas.push({ nombre: item.nombre, tipo: item.tipo, io, inicial, seguro,
				retain: typeof item.retain === 'boolean' ? item.retain : undefined,
				descripcion: typeof item.descripcion === 'string' ? item.descripcion : undefined });
		}
	}
	let limites: ConfiguracionProgramaPLC['limites'];
	if (esObjeto(bruto.limites)) {
		const operacionesPorScan = typeof bruto.limites.operacionesPorScan === 'number'
			&& Number.isInteger(bruto.limites.operacionesPorScan)
			&& bruto.limites.operacionesPorScan >= 50 && bruto.limites.operacionesPorScan <= 100_000
			? bruto.limites.operacionesPorScan : undefined;
		const catchUpMaximo = typeof bruto.limites.catchUpMaximo === 'number'
			&& Number.isInteger(bruto.limites.catchUpMaximo)
			&& bruto.limites.catchUpMaximo >= 1 && bruto.limites.catchUpMaximo <= 100
			? bruto.limites.catchUpMaximo : undefined;
		limites = operacionesPorScan !== undefined || catchUpMaximo !== undefined
			? { operacionesPorScan, catchUpMaximo } : undefined;
	}
	return { version: 1, lenguaje: bruto.lenguaje, FUENTE: bruto.FUENTE, periodoScanMs, modoInicial, etiquetas, limites };
}

function leerDispositivos(bruto: unknown, arreglos: string[]): Dispositivo[] {
	if (!esLista(bruto)) {
		if (bruto !== undefined) arreglos.push('la lista de aparatos estaba corrupta');
		return [];
	}
	const salida: Dispositivo[] = [];
	const vistos = new Set<string>();
	let descartados = 0;
	for (const d of bruto) {
		// Un aparato sin id o sin tipo no se puede dibujar ni cablear: se descarta y se dice.
		if (!esObjeto(d) || !texto(d.id) || !texto(d.tipo) || vistos.has(d.id as string)) {
			descartados++;
			continue;
		}
		vistos.add(d.id as string);
		const numerico = <K extends keyof Dispositivo>(campo: K, min: number, max: number) => {
			const bruto = (d as Record<string, unknown>)[campo as string];
			const v = oQuitado(bruto, enRango(bruto, min, max), `dispositivos[${d.id}].${String(campo)}`,
				`debía ser un número de ${min} a ${max}`);
			return v as Dispositivo[K] | undefined;
		};
		const ruta = (campo: string) => `dispositivos[${d.id}].${campo}`;
		const bornes = leerBornes(d.bornes);
		const comportamientoLeido = leerComportamientoSimulacion(d.comportamiento);
		const erroresComportamiento = comportamientoLeido
			? validarComportamiento({ bornes, comportamiento: comportamientoLeido }) : [];
		const comportamiento = erroresComportamiento.length ? undefined : comportamientoLeido;
		const programaPLC = leerProgramaPLC(d.programaPLC);
		/** Texto que TIENE que ser texto. Un objeto aquí revienta la BOM al ordenar. */
		const cadena = (campo: string): string | undefined => {
			const v = (d as Record<string, unknown>)[campo];
			return oQuitado(v, texto(v), ruta(campo), 'debía ser un texto y no lo era');
		};
		/** Booleano que TIENE que ser booleano. `"false"` es un texto, y un texto es verdadero. */
		const bandera = (campo: string): boolean | undefined => {
			const v = (d as Record<string, unknown>)[campo];
			return oQuitado(v, typeof v === 'boolean' ? v : undefined,
				ruta(campo), 'debía ser sí o no y era otra cosa');
		};
		/*
		 * SIN SPREAD. Tercera auditoría, TS3-P1-01.
		 *
		 * Antes se hacía `...(d as unknown as Dispositivo)` y solo se saneaba lo de debajo, así que
		 * todo escalar que no estuviera en la lista entraba con la forma que trajera. Reproducido:
		 *
		 *   congelado: "false"  → un texto es verdadero, y la renumeración masiva dejaba de tocar
		 *                         ese aparato: se queda con la designación vieja y nadie sabe por qué
		 *   fabricante: {}      → la lista de material revienta al ordenar, en `localeCompare`
		 *
		 * Ahora se construye desde una lista blanca: lo que no está aquí, no entra. Cuesta más de
		 * escribir y es la única forma de que la frase «el cargador valida el proyecto» sea cierta.
		 */
		salida.push({
			id: d.id as string,
			bornes: bornes,
			comportamiento: oQuitado(d.comportamiento, comportamiento, ruta('comportamiento'),
				erroresComportamiento[0] ?? 'el perfil de simulación no tenía una forma o versión válida'),
			fisica: oQuitado(d.fisica, leerFisicaDispositivo(d.fisica), ruta('fisica'),
				'la configuracion fisica V5 no tenia una version o parametros validos'),
			designacion: cadena('designacion'),
			descripcion: cadena('descripcion'),
			fabricante: cadena('fabricante'),
			referencia: cadena('referencia'),
			funcion: cadena('funcion'),
			ubicacion: cadena('ubicacion'),
			congelado: bandera('congelado'),
			campo: bandera('campo'),
			poderCorteEstimado: bandera('poderCorteEstimado'),
			disipacionEstimada: bandera('disipacionEstimada'),
			/*
			 * La ficha eléctrica, campo a campo. Un `corrienteNominal: "diez amperios"` no rompe
			 * nada al dibujar, pero el DRC lo compara con la sección del cable y la comparación
			 * con un texto sale siempre falsa: el aviso de «cable insuficiente» no aparecería y el
			 * tablero se montaría con un hilo que no aguanta. Un dato que no es un número es un
			 * dato que no está, y sin declarar el programa ya sabe decirlo.
			 */
			numero: numerico('numero', 0, 100_000),
			corrienteNominal: numerico('corrienteNominal', 0, 10_000),
			tensionNominal: numerico('tensionNominal', 0, 100_000),
			tensionSecundariaV: numerico('tensionSecundariaV', 0, 100_000),
			polos: numerico('polos', 1, 6),
			disipacionW: numerico('disipacionW', 0, 10_000),
			poderCorteKA: numerico('poderCorteKA', 0, 200),
			sensibilidadMA: numerico('sensibilidadMA', 0, 100_000),
			profundidad: numerico('profundidad', 0, 1000),
			esquema: oQuitado((d as Record<string, unknown>).esquema,
				leerColocacionEsquema((d as Record<string, unknown>).esquema),
				ruta('esquema'), 'la colocación en el esquema no tenía columna y fila numéricas'),
			/*
			 * Y TODO LO ANIDADO, reconstruido. Estos son los campos que después recorre un motor:
			 * dejarlos entrar con la forma que traigan es lo que tiraba el editor entero al primer
			 * recálculo, con el proyecto anterior ya sustituido en memoria.
			 */
			puentesInternos: oQuitado(d.puentesInternos, leerPuentesInternos(d.puentesInternos),
				ruta('puentesInternos'), 'los puentes internos no eran pares de bornes'),
			puentes: oQuitado(d.puentes, leerPuentes(d.puentes),
				ruta('puentes'), 'los puentes no eran grupos de bornes'),
			terminales: oQuitado(d.terminales, leerTerminales(d.terminales),
				ruta('terminales'), 'los bloques de terminales no tenían lado o bornas válidos'),
			rangoRegulacionA: oQuitado(d.rangoRegulacionA, leerRango(d.rangoRegulacionA, 0, 10_000),
				ruta('rangoRegulacionA'), 'el rango de regulación no era [mínimo, máximo] en amperios'),
			rangoSonda: oQuitado(d.rangoSonda, leerRango(d.rangoSonda, -10_000, 10_000),
				ruta('rangoSonda'), 'el rango de la sonda no era [mínimo, máximo]'),
			// Color de señalización: un nombre normalizado o un #rrggbb. Cualquier otra cosa se
			// tira y el piloto sale blanco, que es el color «sin significado asignado» de la norma:
			// un dato corrupto no puede hacer que un tablero mienta diciendo «falla» en rojo.
			colorSenal: oQuitado(d.colorSenal, leerColorSenal(d.colorSenal),
				ruta('colorSenal'), 'el color de señalización no era un nombre conocido ni un #rrggbb'),
			rangoSalidaAnalogica: oQuitado(d.rangoSalidaAnalogica,
				leerRango(d.rangoSalidaAnalogica, -1000, 1000),
				ruta('rangoSalidaAnalogica'), 'el rango de la salida analógica no era [mínimo, máximo]'),
			temporizacion: oQuitado(d.temporizacion, leerTemporizacion(d.temporizacion),
				ruta('temporizacion'), 'la temporización no era de trabajo ni de reposo con segundos'),
			rasgosFrente: oQuitado(d.rasgosFrente, leerRasgosFrente(d.rasgosFrente),
				ruta('rasgosFrente'), 'los rasgos del frente no eran números ni booleanos'),
			posicion: oQuitado(d.posicion, leerPosicion(d.posicion),
				ruta('posicion'), 'la posición no tenía dos coordenadas numéricas'),
			rol: oQuitado(d.rol, leerRol(d.rol),
				ruta('rol'), 'el rol no era maestro ni esclavo con maestro y contacto'),
			// Y la imagen APUNTA que la ha quitado. Ese olvido era el P0 de esta auditoría.
			imagen: oQuitado(d.imagen, leerImagen(d.imagen), ruta('imagen'),
				'la imagen no era un PNG, JPEG o WebP admisible, o pasaba del tamaño máximo'),
			assetId: oQuitado(d.assetId, leerAssetId(d.assetId), ruta('assetId'),
				'el asset no tenía un identificador SHA-256 válido'),
			componentePersonalizado: oQuitado(d.componentePersonalizado,
				leerProcedenciaPersonalizada(d.componentePersonalizado), ruta('componentePersonalizado'),
				'la procedencia no tenía identidad y revisión válidas'),
			curvaDisparo: oQuitado(d.curvaDisparo, unoDe(d.curvaDisparo, ['B', 'C', 'D', 'K', 'Z', 'gG', 'aM'] as const),
				ruta('curvaDisparo'), 'la curva de disparo no era una de la norma'),
			claseDiferencial: oQuitado(d.claseDiferencial, unoDe(d.claseDiferencial, ['AC', 'A', 'F', 'B'] as const),
				ruta('claseDiferencial'), 'la clase de diferencial no era AC, A, F ni B'),
			programa: cadena('programa'),
			programaPLC: oQuitado(d.programaPLC, programaPLC, ruta('programaPLC'),
				'el programa PLC no tenía una versión, lenguaje, fuente o etiquetas válidas'),
			unidadSonda: cadena('unidadSonda'),
			colorCuerpo: cadena('colorCuerpo'),
			hojaId: cadena('hojaId'),
			// Un tipo que no es de la lista no tiene símbolo, ni regla de DRC, ni comportamiento:
			// cae en `otro`, que es lo que el programa ya hace con lo que no reconoce.
			tipo: unoDe(d.tipo, TIPOS_APARATO) ?? 'otro',
			clase: oQuitado(d.clase, unoDe(d.clase, LETRAS_CLASE),
				ruta('clase'), 'la letra de clase no era una de la IEC 81346'),
		});
	}
	if (descartados) arreglos.push(`${descartados} aparato(s) sin datos suficientes`);
	return salida;
}

/**
 * Las borneras de un aparato: sin ellas no se puede cablear, y con basura dentro no se puede ni
 * abrir. Un `bornes: ["1", 2, null]` en el archivo tiraba la aplicación al primer recálculo con
 * «Cannot read properties of null (reading 'id')» —comprobado—, así que aquí solo pasan los que
 * son un objeto con su identificador.
 */
function leerBornes(bruto: unknown): Borne[] {
	if (!esLista(bruto)) return [];
	const salida: Borne[] = [];
	const vistos = new Set<string>();
	for (const b of bruto) {
		if (!esObjeto(b)) continue;
		const id = texto(b.id);
		if (!id || vistos.has(id)) continue;   // dos bornas con el mismo número no se distinguen
		vistos.add(id);
		// Campo a campo, no con un spread: `tipo` decide el color y la prioridad del potencial,
		// y `lado` decide qué es primario y qué secundario en una fuente. Un valor inventado en
		// cualquiera de los dos no da un aviso: da un cálculo que sale mal y parece bueno.
		salida.push({
			id,
			tipo: unoDe(b.tipo, ['L', 'N', 'PE', 'control', 'senal', 'otro'] as const),
			lado: unoDe(b.lado, ['primario', 'secundario+', 'secundario-'] as const),
			obligatorio: bool(b.obligatorio),
			maxConductores: enRango(b.maxConductores, 1, 16),
			seccionMaxMm2: enRango(b.seccionMaxMm2, 0, 1000),
			u: enRango(b.u, 0, 1),
			v: enRango(b.v, 0, 1),
		});
	}
	return salida;
}

function leerConductores(
	bruto: unknown, bornesDe: Map<string, Set<string>>, arreglos: string[],
): Conductor[] {
	if (!esLista(bruto)) {
		if (bruto !== undefined) arreglos.push('la lista de cables estaba corrupta');
		return [];
	}
	const salida: Conductor[] = [];
	const vistos = new Set<string>();
	let huerfanos = 0;
	let repetidos = 0;
	/** ¿Este extremo apunta a un aparato que existe Y a un borne que ese aparato tiene? */
	const extremoValido = (p: Record<string, unknown>): boolean => {
		const bornes = bornesDe.get(texto(p.dispositivoId) ?? '');
		return !!bornes && bornes.has(texto(p.borneId) ?? '');
	};
	for (const c of bruto) {
		if (!esObjeto(c) || !texto(c.id) || !esObjeto(c.de) || !esObjeto(c.a)) { huerfanos++; continue; }
		/*
		 * Dos cables con el mismo id son el mismo cable para todo lo que los busca por id —el
		 * panel, la selección, el resaltado— y dos para todo lo que los recorre —la lista de
		 * material, los metros—. Se queda el primero. TS3-P2-04.
		 */
		if (vistos.has(c.id as string)) { repetidos++; continue; }
		const de = c.de as Record<string, unknown>;
		const a = c.a as Record<string, unknown>;
		// Un cable que apunta a un aparato o a un BORNE inexistente queda «colgando»: rompe el
		// ruteo, crea un potencial fantasma y en pantalla parece perfectamente conectado.
		if (!extremoValido(de) || !extremoValido(a)) {
			huerfanos++;
			continue;
		}
		vistos.add(c.id as string);
		salida.push({
			...(c as unknown as Conductor),
			// Una sección que no es un número deja al DRC sin poder comparar nada: mejor «sin
			// declarar», que el programa sabe avisarlo, que un 0 inventado o un NaN silencioso.
			seccion: enRango(c.seccion, 0, 1000),
			fisica: oQuitado(c.fisica, leerFisicaConductor(c.fisica),
				`conductores[${c.id}].fisica`, 'la configuracion fisica V5 del cable no era valida'),
			// El número de hilo es un TEXTO: en un esquema real es «1», pero también «L1» o «24a».
			numero: oQuitado(c.numero, texto(c.numero),
				`conductores[${c.id}].numero`, 'el número de hilo no era un texto'),
			color: oQuitado(c.color, texto(c.color), `conductores[${c.id}].color`, 'el color no era un texto'),
			// La clase la fija el usuario cuando quiere apartarse de lo que se deduce sola. Un valor
			// que no sea una de las cuatro se tira y vuelve a deducirse: es mejor que arrastrar un
			// nombre inventado hasta el inspector y el listado de material.
			clase: (['interno', 'puerta', 'campo', 'proteccion'] as const).find((k) => k === c.clase),
			/*
			 * El trazado son los puntos por los que el usuario llevó el cable a mano. Un punto con
			 * una coordenada que no es número sale como NaN en la geometría del tubo, y en Three.js
			 * eso no es un cable torcido: es un cable que DESAPARECE de la pantalla, mientras sigue
			 * contando en la lista de conductores y en el dossier. Los puntos malos se tiran y el
			 * cable vuelve a su recorrido automático, que siempre se ve.
			 */
			trazado: esLista(c.trazado)
				? (c.trazado as unknown[]).filter(esObjeto)
					.map((p) => {
						// La profundidad es opcional: un punto sin ella es un punto de los de antes, y
						// el repartidor le busca capa como siempre. Una z corrupta se tira sola y el
						// punto sigue valiendo en x/y, que es mejor que perder el peinado entero.
						//
						// Y cuando no hay z, la clave NO se escribe. Un `z: undefined` explícito se
						// cuela en el archivo guardado y hace que dos trazados iguales dejen de
						// parecerlo a quien los compare.
						const z = enRango(p.z, -MAX_MM, MAX_MM);
						return {
							x: enRango(p.x, -MAX_MM, MAX_MM),
							y: enRango(p.y, -MAX_MM, MAX_MM),
							...(z === undefined ? {} : { z }),
						};
					})
					.filter((p): p is { x: number; y: number; z?: number } => p.x !== undefined && p.y !== undefined)
				: undefined,
		});
	}
	if (huerfanos) arreglos.push(`${huerfanos} cable(s) sin aparato o sin borne en un extremo`);
	if (repetidos) arreglos.push(`${repetidos} cable(s) con el mismo identificador`);
	return salida;
}

/**
 * Cliente, obra, quién dibujó, revisión y fecha: lo que va en el CAJETÍN DEL PLANO y en la
 * portada del dossier.
 *
 * Son textos, y como textos se dibujan: el cajetín los mide para encajarlos en su casilla. Si en
 * el archivo viniera `cliente: {}` o `revision: []`, lo que llegaría al PDF no sería una cadena y
 * la exportación se rompería, o peor, saldría un «[object Object]» impreso en un plano que se
 * firma y se manda a obra.
 *
 * Se recortan además a un largo razonable: el cajetín encoge la letra para que quepa, pero con
 * mil caracteres acabaría cortando casi todo y sería más honesto no llegar ahí.
 */
function leerDatos(bruto: unknown): Proyecto['datos'] {
	if (!esObjeto(bruto)) return undefined;
	const campo = (v: unknown, max: number): string | undefined => {
		const t = texto(v)?.trim();
		return t ? t.slice(0, max) : undefined;
	};
	const datos: Proyecto['datos'] = {
		cliente: campo(bruto.cliente, 160),
		obra: campo(bruto.obra, 160),
		proyectista: campo(bruto.proyectista, 120),
		fabricante: campo(bruto.fabricante, 120),
		revision: campo(bruto.revision, 12),
		// La fecha va en ISO: si no lo es, no se inventa una, se deja sin fecha.
		fecha: /^\d{4}-\d{2}-\d{2}$/.test(texto(bruto.fecha) ?? '') ? (bruto.fecha as string) : undefined,
		notas: campo(bruto.notas, 4000),
	};
	return Object.values(datos).some((v) => v !== undefined) ? datos : undefined;
}

/**
 * Las opciones de la instalación: Icc presunta, temperatura ambiente, frecuencia, corriente
 * asignada, montaje, régimen de neutro e IP.
 *
 * Entraban con un `as` y sin mirar, y eso deja un agujero justo debajo de un arreglo anterior:
 * los recuadros de la ventana «Datos del proyecto» ya validaban lo que se teclea, pero un archivo
 * podía traer `iccPresuntaKA: "mucha"` o `temperaturaAmbienteC: null` y colarse por detrás. Esos
 * dos números son de los que deciden cosas: el primero, si las protecciones elegidas aguantan un
 * cortocircuito; el segundo, la temperatura interior del armario. Un valor imposible ahí no da un
 * error visible, da un veredicto tranquilizador sin motivo, que es peor.
 *
 * Sin declarar el programa ya sabe decir «a declarar» en el dossier y en la placa de
 * características. Así que lo que no es un número válido se deja SIN DECLARAR, no en cero.
 */
/**
 * Las opciones del proyecto, CAMPO A CAMPO. Sin spread.
 *
 * Tercera auditoría, TS3-P1-01. Aquí había un `...(bruto as OpcionesProyecto)`, así que los campos
 * que no se saneaban explícitamente llegaban tal cual a los motores. Reproducido:
 *
 *   formatoDesignacion: false   → numeración revienta en `plantilla.replace is not a function`
 *   reservaCable: "mucho"       → el ruteo devuelve una longitud NaN, y NaN no avisa: se imprime
 *
 * Un NaN en la longitud de un cable acaba en la lista de material que alguien lleva a la
 * ferretería. Por eso no vale con «no revienta»: tiene que no entrar.
 */
function leerOpciones(bruto: unknown): OpcionesProyecto | undefined {
	if (!esObjeto(bruto)) return undefined;
	const ip = texto(bruto.gradoIP)?.trim().toUpperCase();
	const r = (campo: string) => `opciones.${campo}`;
	const opciones: OpcionesProyecto = {
		iccPresuntaKA: oQuitado(bruto.iccPresuntaKA, enRango(bruto.iccPresuntaKA, 0, 100),
			r('iccPresuntaKA'), 'la Icc presunta no era un número de 0 a 100 kA'),
		temperaturaAmbienteC: oQuitado(bruto.temperaturaAmbienteC, enRango(bruto.temperaturaAmbienteC, -40, 80),
			r('temperaturaAmbienteC'), 'la temperatura ambiente no era un número de −40 a 80 °C'),
		frecuenciaHz: oQuitado(bruto.frecuenciaHz, enRango(bruto.frecuenciaHz, 0, 400),
			r('frecuenciaHz'), 'la frecuencia no era un número de 0 a 400 Hz'),
		corrienteAsignadaA: oQuitado(bruto.corrienteAsignadaA, enRango(bruto.corrienteAsignadaA, 0, 10_000),
			r('corrienteAsignadaA'), 'la corriente asignada no era un número de 0 a 10.000 A'),
		montajeGabinete: oQuitado(bruto.montajeGabinete,
			unoDe(bruto.montajeGabinete, ['mural', 'exento', 'empotrado'] as const),
			r('montajeGabinete'), 'el montaje del gabinete no era mural, exento ni empotrado'),
		regimenNeutro: oQuitado(bruto.regimenNeutro,
			unoDe(bruto.regimenNeutro, ['', 'TN-S', 'TN-C', 'TN-C-S', 'TT', 'IT'] as const),
			r('regimenNeutro'), 'el régimen de neutro no era uno de los de la norma'),
		usoPrevisto: oQuitado(bruto.usoPrevisto, unoDe(bruto.usoPrevisto, ['', 'interior', 'intemperie'] as const),
			r('usoPrevisto'), 'el uso previsto no era interior ni intemperie'),
		gradoIP: oQuitado(bruto.gradoIP, ip && /^IP[0-6][0-9K]$/.test(ip) ? ip : undefined,
			r('gradoIP'), 'el grado IP no tenía la forma IPxy'),
		// Estos tres alimentan la numeración y el ruteo, que es donde un tipo falso se nota tarde.
		formatoDesignacion: oQuitado(bruto.formatoDesignacion, texto(bruto.formatoDesignacion),
			r('formatoDesignacion'), 'el formato de designación no era un texto'),
		inicioNumeracionConductores: oQuitado(bruto.inicioNumeracionConductores,
			enRango(bruto.inicioNumeracionConductores, 0, 100_000),
			r('inicioNumeracionConductores'), 'el inicio de numeración no era un número'),
		reservaCable: oQuitado(bruto.reservaCable, enRango(bruto.reservaCable, 0, 10),
			r('reservaCable'), 'la reserva de cable no era un número de 0 a 10'),
		extraPorConexionMm: oQuitado(bruto.extraPorConexionMm, enRango(bruto.extraPorConexionMm, 0, 10_000),
			r('extraPorConexionMm'), 'el extra por conexión no era un número de mm'),
		ocupacionMaxCanaleta: oQuitado(bruto.ocupacionMaxCanaleta, enRango(bruto.ocupacionMaxCanaleta, 0, 1),
			r('ocupacionMaxCanaleta'), 'la ocupación máxima de canaleta no era una fracción de 0 a 1'),
	};
	/*
	 * Los campos que no valían no se dejan puestos a `undefined`: se quitan.
	 *
	 * `JSON.stringify` ya los tira, así que en el archivo daría igual; pero en memoria un
	 * `{ formatoDesignacion: undefined }` no es lo mismo que un objeto sin esa clave, y hay
	 * comparaciones que lo notan. Un proyecto que entra sin un campo tiene que salir sin él.
	 */
	const limpias = Object.fromEntries(
		Object.entries(opciones).filter(([, v]) => v !== undefined),
	) as OpcionesProyecto;
	// Si no quedó ni un dato en pie, mejor `undefined` que un objeto vacío que se vuelve a guardar.
	return Object.keys(limpias).length ? limpias : undefined;
}
