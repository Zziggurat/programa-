/**
 * EL PROGRAMA DEL CONTROLADOR: lo que hace que un PLC del tablero deje de ser un adorno.
 *
 * Hasta ahora un controlador en la placa no hacía nada: sus salidas solo se encendían forzándolas
 * a mano. Y un tablero de clima es justo lo contrario — el controlador ES la maniobra: arranca el
 * ventilador, espera, abre la compuerta, y abre la válvula cuando la sonda pide calor.
 *
 * SE ESCRIBE, NO SE DIBUJA. La lógica se escribe en un renglón por salida, en castellano:
 *
 *     DO1 = DI1 Y NO DI2
 *     DO2 = DI1 retardo 5
 *     AO1 = UI1 > 24
 *     DO3 = (DI1 O DI2) Y NO DI3   ; parar si hay alarma
 *
 * Un editor de bloques sería más bonito y muchísimo más trabajo, y esto lo entiende cualquiera que
 * haya visto un esquema de mando: es la misma frase que uno diría en voz alta. Además se lee y se
 * escribe como texto, así que viaja en el archivo del proyecto sin formatos raros.
 *
 * QUÉ NO ES. No es IEC 61131-3 ni pretende serlo: no hay bloques de función, ni PID, ni estados.
 * Es lógica combinacional con retardo a la conexión y tiempo mínimo, que es con lo que se resuelve
 * la mayoría de las maniobras de un tablero de clima — y lo que falte se sigue montando con relés,
 * que es lo que hace el programa igual de bien.
 */

/** Una condición del programa. */
export type Expr =
	| { op: 'borne'; borne: string }
	| { op: 'mayor'; borne: string; que: number }
	| { op: 'menor'; borne: string; que: number }
	| { op: 'y'; de: Expr[] }
	| { op: 'o'; de: Expr[] }
	| { op: 'no'; de: Expr };

/**
 * Una salida ANALÓGICA: cuánto abre, no si abre.
 *
 * Es la banda proporcional de toda la vida, que es con lo que se gobierna de verdad una válvula,
 * una compuerta o la velocidad de un variador en una UMA: la salida va de un extremo al otro según
 * lo que marque la sonda, y fuera de la banda se queda pegada al tope.
 *
 * Se escribe como se dice en obra:  «AO1 = 0 a 10 según TE1 de 18 a 24»
 * —a 18 °C o menos, 0 V; a 24 °C o más, 10 V; en medio, lo proporcional—. Y para refrigerar, al
 * revés:  «AO2 = 10 a 0 según TE1 de 22 a 28».
 */
export interface Rampa {
	/** Borne de la sonda que manda: UI1, TE1… */
	sonda: string;
	/** Valor de la sonda donde la salida está en `desde`. */
	sondaDesde: number;
	/** Valor de la sonda donde la salida está en `hasta`. */
	sondaHasta: number;
	/** Salida (en voltios o en %) en `sondaDesde`. */
	desde: number;
	/** Salida en `sondaHasta`. */
	hasta: number;
}

/** Una regla: qué enciende una salida, y con qué tiempos. */
export interface ReglaLogica {
	/** Borne de salida que gobierna: DO1, AO2, Y1… */
	salida: string;
	/**
	 * Cuándo se enciende (todo/nada). En una regla de rampa vale siempre, porque una salida
	 * analógica no se enciende: se pone en un valor.
	 */
	cuando: Expr;
	/** Si la regla es analógica, cómo se calcula su valor. */
	rampa?: Rampa;
	/** Segundos que espera con la condición cumplida antes de encender. */
	retardoS?: number;
	/**
	 * Segundos que se queda encendida aunque la condición ya no se cumpla.
	 *
	 * No es un capricho: un compresor que arranca y para cada dos segundos se destruye, y los
	 * fabricantes exigen un tiempo mínimo de marcha. Es el error de programación más caro que se
	 * puede cometer en un tablero de clima.
	 */
	minimoS?: number;
	/** Lo que hay escrito detrás del «;», para que el programa se explique solo. */
	comentario?: string;
	/** El renglón tal como se escribió, para poder volver a enseñarlo igual. */
	fuente: string;
}

/** Un fallo al leer el programa, con el renglón donde está. */
export interface ErrorLogica {
	linea: number;
	texto: string;
	que: string;
}

export interface Programa {
	reglas: ReglaLogica[];
	errores: ErrorLogica[];
}

/* --------------------------------- Leer el programa --------------------------------- */

const PALABRAS = new Set(['Y', 'O', 'NO', 'RETARDO', 'MINIMO', 'MÍNIMO']);

/** Parte un renglón en piezas: nombres, números, operadores y paréntesis. */
function trocear(texto: string): string[] {
	return texto.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ_][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ_/+-]*|\d+(?:[.,]\d+)?|[()<>=]/g) ?? [];
}

/**
 * Lee el programa entero. NUNCA lanza: los renglones malos se apartan con su explicación y los
 * buenos siguen funcionando, que es lo que hace falta mientras se escribe.
 */
export function leerPrograma(texto: string): Programa {
	const reglas: ReglaLogica[] = [];
	const errores: ErrorLogica[] = [];
	texto.split('\n').forEach((crudo, i) => {
		const sinComentario = crudo.split(';');
		const linea = sinComentario[0].trim();
		const comentario = sinComentario.slice(1).join(';').trim() || undefined;
		if (!linea) return;
		const fallo = (que: string): void => { errores.push({ linea: i + 1, texto: crudo.trim(), que }); };

		const igual = linea.indexOf('=');
		// Ojo: `>=` y `<=` no existen aquí, pero un `>` o un `<` antes del `=` sí delata un renglón
		// sin salida a la izquierda, que es el olvido más común.
		if (igual < 0) { fallo('falta el «=»: se escribe «SALIDA = condición»'); return; }
		const salida = linea.slice(0, igual).trim();
		if (!/^[A-Za-z][A-Za-z0-9_/+-]*$/.test(salida)) {
			fallo(`«${salida}» no parece un borne de salida`);
			return;
		}

		let resto = linea.slice(igual + 1).trim();
		if (!resto) { fallo('no dice cuándo se enciende'); return; }

		/*
		 * ¿Es una salida analógica? «0 a 10 según TE1 de 18 a 24».
		 *
		 * Se mira ANTES que la condición porque es un renglón de otra forma: no dice cuándo se
		 * enciende sino cuánto vale, y por el lector de condiciones no pasaría.
		 */
		const rampaEscrita = /^(-?\d+(?:[.,]\d+)?)\s*a\s*(-?\d+(?:[.,]\d+)?)\s+seg[uú]n\s+([A-Za-z][A-Za-z0-9_/+-]*)\s+de\s+(-?\d+(?:[.,]\d+)?)\s*a\s*(-?\d+(?:[.,]\d+)?)$/i
			.exec(resto);
		if (rampaEscrita) {
			const num = (t: string): number => Number(t.replace(',', '.'));
			const sondaDesde = num(rampaEscrita[4]);
			const sondaHasta = num(rampaEscrita[5]);
			if (sondaDesde === sondaHasta) {
				fallo('la banda de la sonda no puede empezar y acabar en el mismo valor');
				return;
			}
			reglas.push({
				salida,
				cuando: { op: 'o', de: [] },   // una salida analógica no se enciende: vale algo
				rampa: {
					sonda: rampaEscrita[3],
					sondaDesde, sondaHasta,
					desde: num(rampaEscrita[1]), hasta: num(rampaEscrita[2]),
				},
				comentario,
				fuente: crudo.trim(),
			});
			return;
		}

		// Los tiempos van al final del renglón y se recortan antes de leer la condición.
		let retardoS: number | undefined;
		let minimoS: number | undefined;
		const tiempo = (palabra: RegExp): number | undefined => {
			const m = palabra.exec(resto);
			if (!m) return undefined;
			resto = (resto.slice(0, m.index) + resto.slice(m.index + m[0].length)).trim();
			return Number(m[1].replace(',', '.'));
		};
		minimoS = tiempo(/\bm[ií]nimo\s+(\d+(?:[.,]\d+)?)\s*s?\b/i);
		retardoS = tiempo(/\bretardo\s+(\d+(?:[.,]\d+)?)\s*s?\b/i);
		if (minimoS === undefined) minimoS = tiempo(/\bm[ií]nimo\s+(\d+(?:[.,]\d+)?)\s*s?\b/i);

		const piezas = trocear(resto);
		if (piezas.length === 0) { fallo('no dice cuándo se enciende'); return; }
		let i2 = 0;
		let expr: Expr;
		try {
			expr = leerO();
		} catch (e) {
			fallo((e as Error).message);
			return;
		}
		if (i2 < piezas.length) { fallo(`sobra «${piezas.slice(i2).join(' ')}»`); return; }
		reglas.push({ salida, cuando: expr, retardoS, minimoS, comentario, fuente: crudo.trim() });

		/* Precedencia: NO aprieta más que Y, e Y más que O. Es la de siempre. */
		function leerO(): Expr {
			const de = [leerY()];
			while (piezas[i2]?.toUpperCase() === 'O') { i2++; de.push(leerY()); }
			return de.length === 1 ? de[0] : { op: 'o', de };
		}
		function leerY(): Expr {
			const de = [leerNo()];
			while (piezas[i2]?.toUpperCase() === 'Y') { i2++; de.push(leerNo()); }
			return de.length === 1 ? de[0] : { op: 'y', de };
		}
		function leerNo(): Expr {
			if (piezas[i2]?.toUpperCase() === 'NO') { i2++; return { op: 'no', de: leerNo() }; }
			return leerAtomo();
		}
		function leerAtomo(): Expr {
			const p = piezas[i2];
			if (p === undefined) throw new Error('la condición se corta antes de tiempo');
			if (p === '(') {
				i2++;
				const dentro = leerO();
				if (piezas[i2] !== ')') throw new Error('falta cerrar un paréntesis');
				i2++;
				return dentro;
			}
			if (PALABRAS.has(p.toUpperCase()) || p === ')' || p === '>' || p === '<') {
				throw new Error(`no se esperaba «${p}» aquí`);
			}
			i2++;
			const signo = piezas[i2];
			if (signo === '>' || signo === '<') {
				const valor = Number(String(piezas[i2 + 1]).replace(',', '.'));
				if (!Number.isFinite(valor)) throw new Error(`«${p} ${signo}» tiene que comparar con un número`);
				i2 += 2;
				return signo === '>' ? { op: 'mayor', borne: p, que: valor } : { op: 'menor', borne: p, que: valor };
			}
			return { op: 'borne', borne: p };
		}
	});
	return { reglas, errores };
}

/** Vuelve a escribir un programa tal como se lee, para guardarlo o enseñarlo. */
export function escribirPrograma(p: Programa): string {
	return p.reglas.map((r) => r.fuente).join('\n');
}

/* --------------------------------- Ejecutar --------------------------------- */

/** Lo que el controlador VE de su tablero en este instante. */
export interface LecturaControlador {
	/** Bornes con tensión (entradas digitales activadas). */
	activos: ReadonlySet<string>;
	/** Valor de las entradas analógicas, por borne: temperaturas, presiones… */
	valores: Readonly<Record<string, number>>;
	/** Salidas que estaban encendidas en la pasada anterior (para realimentar). */
	salidasPrevias: ReadonlySet<string>;
}

/** ¿Se cumple esta condición ahora mismo? */
export function evaluar(e: Expr, l: LecturaControlador): boolean {
	switch (e.op) {
		case 'borne':
			return l.activos.has(e.borne) || l.salidasPrevias.has(e.borne);
		case 'mayor': {
			const v = l.valores[e.borne];
			return v !== undefined && v > e.que;
		}
		case 'menor': {
			const v = l.valores[e.borne];
			return v !== undefined && v < e.que;
		}
		case 'y': return e.de.every((x) => evaluar(x, l));
		case 'o': return e.de.some((x) => evaluar(x, l));
		case 'no': return !evaluar(e.de, l);
	}
}

/**
 * Cuánto vale una salida analógica ahora mismo, según lo que marque su sonda.
 *
 * Fuera de la banda se queda pegada al tope, que es lo que hace un controlador de verdad: por
 * debajo de 18 °C la válvula está cerrada del todo, no «menos que cerrada». Si la sonda no marca
 * nada —no está conectada, o no se ha girado el mando— la salida se queda en su extremo de
 * reposo, que es el valor de `desde`.
 */
export function valorDeRampa(r: Rampa, valores: Record<string, number>): number {
	const v = valores[r.sonda];
	if (v === undefined) return r.desde;
	const t = (v - r.sondaDesde) / (r.sondaHasta - r.sondaDesde);
	const acotado = Math.max(0, Math.min(1, t));
	return r.desde + (r.hasta - r.desde) * acotado;
}

/**
 * Lo que vale cada salida analógica del programa, por su borne.
 *
 * Va aparte de `salidasActivas` a propósito: una salida analógica no está encendida ni apagada
 * —está en 3,4 V—, y meterla en el conjunto de las encendidas obligaría a quien lo lea a adivinar
 * cuándo un 0 significa «apagada» y cuándo significa «abierta el 0 %», que no es lo mismo.
 */
export function valoresAnalogicos(
	reglas: readonly ReglaLogica[],
	lectura: LecturaControlador,
): Record<string, number> {
	const salida: Record<string, number> = {};
	for (const r of reglas) {
		if (r.rampa) salida[r.salida] = valorDeRampa(r.rampa, lectura.valores);
	}
	return salida;
}

/** Memoria de los tiempos del programa, entre una pasada y la siguiente. */
export interface MemoriaLogica {
	/** Instante (ms) en que cada salida empezó a cumplir su condición. */
	desdePedida: Record<string, number>;
	/** Instante (ms) en que cada salida se encendió (para el tiempo mínimo). */
	desdeEncendida: Record<string, number>;
}

export function memoriaLogicaVacia(): MemoriaLogica {
	return { desdePedida: {}, desdeEncendida: {} };
}

/**
 * Una copia de trabajo de la memoria de tiempos.
 *
 * La usa la simulación para TANTEAR mientras resuelve el circuito. `salidasActivas` apunta en la
 * memoria cada vez que se la llama, y la simulación la llama varias veces por paso —una por cada
 * pasada del bucle que va estabilizando el tablero—. En las primeras pasadas el circuito todavía
 * no está resuelto, así que una condición que SÍ se cumple sale falsa; si eso tocara la memoria de
 * verdad, borraría la cuenta del retardo. La borraba: ver el comentario de `simulacion.ts`.
 */
export function clonarMemoriaLogica(m: MemoriaLogica): MemoriaLogica {
	return { desdePedida: { ...m.desdePedida }, desdeEncendida: { ...m.desdeEncendida } };
}

/**
 * Qué salidas están encendidas AHORA, contando los retardos y los tiempos mínimos.
 *
 * Sin reloj el programa se resuelve como si los tiempos fueran cero: es lo razonable para
 * responder «¿esta lógica hace lo que quiero?» sin tener que esperar.
 */
export function salidasActivas(
	reglas: readonly ReglaLogica[],
	lectura: LecturaControlador,
	reloj?: { ahora: number; memoria: MemoriaLogica },
): Set<string> {
	const encendidas = new Set<string>();
	for (const r of reglas) {
		// Las analógicas no se encienden: valen algo. Se resuelven en `valoresAnalogicos`.
		if (r.rampa) continue;
		const pide = evaluar(r.cuando, lectura);
		if (!reloj) {
			if (pide) encendidas.add(r.salida);
			continue;
		}
		const { ahora, memoria } = reloj;
		const clave = r.salida;
		if (pide) {
			if (memoria.desdePedida[clave] === undefined) memoria.desdePedida[clave] = ahora;
		} else {
			delete memoria.desdePedida[clave];
		}
		const llevaPidiendo = memoria.desdePedida[clave] === undefined
			? -1 : (ahora - memoria.desdePedida[clave]) / 1000;
		const cumpleRetardo = pide && llevaPidiendo >= (r.retardoS ?? 0);

		// El tiempo mínimo la sostiene aunque la condición ya no se cumpla.
		const encendidaDesde = memoria.desdeEncendida[clave];
		const llevaEncendida = encendidaDesde === undefined ? -1 : (ahora - encendidaDesde) / 1000;
		const sostiene = encendidaDesde !== undefined && llevaEncendida < (r.minimoS ?? 0);

		if (cumpleRetardo || sostiene) {
			encendidas.add(clave);
			if (memoria.desdeEncendida[clave] === undefined) memoria.desdeEncendida[clave] = ahora;
		} else {
			delete memoria.desdeEncendida[clave];
		}
	}
	return encendidas;
}

/** Cuenta atrás de una salida que está esperando su retardo, para poder enseñarla. */
export interface EsperaLogica {
	salida: string;
	restan: number;
	total: number;
	/** 'retardo' si espera para encender; 'minimo' si sigue encendida por el tiempo mínimo. */
	motivo: 'retardo' | 'minimo';
}

export function esperasDe(
	reglas: readonly ReglaLogica[],
	lectura: LecturaControlador,
	reloj?: { ahora: number; memoria: MemoriaLogica },
): EsperaLogica[] {
	if (!reloj) return [];
	const salida: EsperaLogica[] = [];
	for (const r of reglas) {
		const pedida = reloj.memoria.desdePedida[r.salida];
		const encendida = reloj.memoria.desdeEncendida[r.salida];
		if (r.retardoS && pedida !== undefined && encendida === undefined) {
			const lleva = (reloj.ahora - pedida) / 1000;
			if (lleva < r.retardoS) {
				salida.push({ salida: r.salida, restan: Math.max(0, r.retardoS - lleva), total: r.retardoS, motivo: 'retardo' });
			}
		}
		if (r.minimoS && encendida !== undefined && !evaluar(r.cuando, lectura)) {
			const lleva = (reloj.ahora - encendida) / 1000;
			if (lleva < r.minimoS) {
				salida.push({ salida: r.salida, restan: Math.max(0, r.minimoS - lleva), total: r.minimoS, motivo: 'minimo' });
			}
		}
	}
	return salida;
}
