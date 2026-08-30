import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { animarSimulacion } from '../app/animacion-sim.js';
import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import type { EstadoVariador, ResultadoSimulacion } from '../src/motores/simulacion.js';
import { resultadoFisicaVacio } from '../src/fisica/topologia-proyecto.js';

/*
 * `ui-simulacion` importa el módulo de diálogos, cuyo observador de modales se instala al cargar.
 * Estas pruebas ejercitan únicamente sus transiciones puras; un DOM mínimo evita introducir un
 * navegador o jsdom en el gate unitario.
 */
Object.defineProperty(globalThis, 'document', {
	configurable: true,
	value: {
		documentElement: {},
		querySelectorAll: () => [],
		getElementById: () => undefined,
	},
});
Object.defineProperty(globalThis, 'getComputedStyle', {
	configurable: true,
	value: () => ({ getPropertyValue: () => '' }),
});
Object.defineProperty(globalThis, 'MutationObserver', {
	configurable: true,
	value: class {
		observe(): void { /* DOM mínimo de prueba */ }
		disconnect(): void { /* DOM mínimo de prueba */ }
	},
});

const {
	controlDeSimulacion,
	estadoDelMando,
	operarControl,
	requiereAvanceTemporal,
	textoEstadoVariador,
} = await import('../app/ui-simulacion.js');

const contacto = (entrada: string, salida: string, cerradoEn?: number[]) => ({
	entrada,
	salida,
	reposo: 'abierto' as const,
	funcion: 'auxiliar' as const,
	...(cerradoEn ? { cerradoEn } : {}),
});

function dispositivo(
	id: string,
	comportamiento: ComportamientoSimulacion,
	tipo: Dispositivo['tipo'] = 'otro',
	bornes: string[] = ['1', '2'],
): Dispositivo {
	return {
		id,
		tipo,
		imagen: tipo === 'otro' ? 'data:image/png;base64,AA==' : undefined,
		bornes: bornes.map((borneId) => ({ id: borneId })),
		comportamiento,
	};
}

const perfilPulsador: ComportamientoSimulacion = {
	version: 1,
	clase: 'mando',
	modo: 'momentaneo',
	posiciones: 2,
	reposo: 0,
	contactos: [contacto('1', '2')],
};

test('la interacción se decide por perfil y una imagen `otro` puede ser mando o sensor', () => {
	const importado = dispositivo('s-importado', perfilPulsador);
	assert.deepEqual(controlDeSimulacion(importado), {
		clase: 'mando', modo: 'momentaneo', posiciones: 2, reposo: 0,
	});

	const sensor = dispositivo('b-importado', {
		version: 1, clase: 'sensor', contactos: [contacto('1', '2')],
	});
	assert.deepEqual(controlDeSimulacion(sensor), { clase: 'sensor', analogico: false });

	const carcasaEnganosa = dispositivo('sin-logica', {
		version: 1, clase: 'sin-comportamiento', motivo: 'imagen sin contrato',
	}, 'pulsador');
	assert.equal(controlDeSimulacion(carcasaEnganosa), undefined,
		'la carcasa pulsador ganó a un perfil explícitamente inerte');
});

test('presionar/soltar modela el ciclo momentáneo y accionar conserva el toggle compatible', () => {
	const pulsador = dispositivo('s1', perfilPulsador);
	const presionado = operarControl(pulsador, {}, 'presionar');
	assert.equal(presionado.atendido, true);
	assert.equal(presionado.estado.activo, true);
	assert.equal(operarControl(pulsador, presionado.estado, 'presionar').cambio, false);
	const soltado = operarControl(pulsador, presionado.estado, 'soltar');
	assert.equal(soltado.estado.activo, false);
	assert.equal(operarControl(pulsador, {}, 'accionar').estado.activo, true);
	assert.equal(operarControl(pulsador, { activo: true }, 'accionar').estado.activo, false);
});

test('la UI reinicia el runtime y convierte teclado/click sintético en un pulso, no en un mando pegado', () => {
	const fuente = readFileSync('app/ui-simulacion.ts', 'utf8');
	assert.match(fuente,
		/function\s+limpiarRuntime[\s\S]{0,260}estadoSim\s*=\s*\{\}[\s\S]{0,260}ajustarRelojSim\(\)/,
		'cambiar de tablero energizado conserva el estado o la memoria temporal de la sesión anterior');
	assert.match(fuente,
		/function\s+pulsarSintetico[\s\S]{0,260}presionarEnSimulacion\(dispositivoId\)[\s\S]{0,260}setTimeout\(\(\)\s*=>\s*soltarEnSimulacion\(dispositivoId\),\s*DURACION_PULSO_SINTETICO_MS\)/,
		'Enter o `.click()` no programa la liberación del pulsador momentáneo');
	assert.match(fuente,
		/el\.onkeydown[\s\S]{0,300}ev\.preventDefault\(\)[\s\S]{0,120}pulsarSintetico\(id\)/,
		'Enter/Espacio dependen de un click nativo que se pierde al repintar el botón');
	assert.match(fuente,
		/mandoEnFoco[\s\S]{0,1200}CSS\.escape\(mandoEnFoco\)[\s\S]{0,120}focus\(\{\s*preventScroll:\s*true\s*\}\)/,
		'el repintado periódico reemplaza el botón y pierde el foco del teclado');
	assert.match(fuente, /DURACION_PULSO_SINTETICO_MS\s*=\s*(?:[5-9]\d|\d{3,})/,
		'el pulso sintético vuelve a soltarse antes de que el circuito pueda observarlo');
	assert.match(fuente,
		/performance\.now\(\)\s*-\s*gesto\.iniciadoEn[\s\S]{0,220}soltarEnSimulacion\(id\)/,
		'un clic primario humano corto puede presionar y soltar íntegramente entre dos scans');
	assert.match(fuente,
		/for \(const temporizador of liberacionesPendientes\)[\s\S]{0,100}clearTimeout\(temporizador\)/,
		'salir de Energizar deja una liberación diferida capaz de resucitar estado runtime');
	assert.match(fuente,
		/seccion-simulacion[\s\S]{0,180}hidden\s*=\s*!activo[\s\S]{0,180}ctx\.refrescarPanel\?\.\(\)/,
		'Energizar cambia `hidden` pero deja el cajón con el `display: none` anterior');
	assert.match(fuente,
		/panelesPLCAbiertos[\s\S]{0,260}details\[open\]\[data-plc-panel\][\s\S]{0,20000}panelesPLCAbiertos\.has/,
		'el repintado periódico vuelve a cerrar Tags/Fuerzas mientras el usuario intenta operarlos');
	assert.match(fuente,
		/hayControladorV4[\s\S]{0,180}conRango\.length\s*\?\s*conRango\s*:\s*hayControladorV4\s*\?\s*\[\]/,
		'un sensor binario del fixture V4 reaparece como slider analógico LEGACY sin señal');
	const main = readFileSync('app/main.ts', 'utf8');
	assert.match(main, /instalarSimulacion\(\{[\s\S]{0,240}refrescarPanel:\s*pintarRail/,
		'el editor no conecta el cambio de Energizar con el repintado real del rail');
});

test('el reloj sigue recalculando motores, rampas VFD y controladores perfilados que dependen del tiempo', () => {
	const baseMotor = {
		dispositivoId: 'm1', designacion: '-M1', alimentado: true,
		fasesRequeridas: 3 as const, fasesPresentes: 3,
		progresoArranque: 0.25, corrienteNominalA: 2, corrienteNominalEstimada: false,
		corrienteEstimadaA: 12, duracionArranqueEstimadaS: 3,
		frecuenciaElectricaHz: 50, velocidadObjetivo: 1, velocidadActual: 0.25,
		velocidadPorcentaje: 25, rpmOrigen: 'no-disponible' as const,
	};
	assert.equal(requiereAvanceTemporal(proyecto([]), resultado({
		motores: [{ ...baseMotor, estado: 'arrancando' }],
	}), {}), true, 'el motor en arranque quedó congelado entre ticks');

	const baseVfd: EstadoVariador = {
		dispositivoId: 'vfd', designacion: '-U1', estado: 'marcha', alimentado: true,
		run: true, habilitado: true, referenciaPorcentaje: 100,
		frecuenciaHz: 10, frecuenciaObjetivoHz: 50, frecuenciaNominalHz: 50,
		falloEnclavado: false, resetPermitido: false, runBloqueadoHastaSoltar: false,
		calidadReferencia: 'normal',
	};
	assert.equal(requiereAvanceTemporal(proyecto([]), resultado({ variadores: [baseVfd] }), {}), true,
		'la rampa del VFD quedó congelada entre ticks');
	assert.equal(requiereAvanceTemporal(proyecto([]), resultado({
		motores: [{ ...baseMotor, estado: 'marcha', progresoArranque: 1, corrienteEstimadaA: 2 }],
		variadores: [{ ...baseVfd, frecuenciaHz: 50 }],
	}), {}), false, 'un motor y un VFD estables mantuvieron trabajo periódico innecesario');

	const controlador = dispositivo('plc-importado', {
		version: 1, clase: 'controlador',
		alimentacion: { entradas: ['L'], retornos: ['N'] },
		salidasDigitales: [], salidasAnalogicas: [],
	}, 'otro', ['L', 'N']);
	controlador.programa = 'Q0.0 = I0.0 retardo 1 s';
	assert.equal(requiereAvanceTemporal(proyecto([controlador]), resultado(), {}), true,
		'un controlador importado dependió del tipo legacy para avanzar su temporizador');
	assert.equal(requiereAvanceTemporal(proyecto([]), resultado(), { q1: 0 }), true,
		'la curva térmica dejó de avanzar');
});

test('un selector mantenido recorre de forma estable sus dos o tres posiciones', () => {
	const selector3 = dispositivo('s3', {
		version: 1,
		clase: 'mando',
		modo: 'mantenido',
		posiciones: 3,
		reposo: 1,
		contactos: [contacto('1', '2', [0, 2])],
	});
	let estado = operarControl(selector3, {}, 'accionar').estado;
	assert.equal(estado.posicion, 2);
	estado = operarControl(selector3, estado, 'accionar').estado;
	assert.equal(estado.posicion, 0);
	estado = operarControl(selector3, estado, 'accionar').estado;
	assert.equal(estado.posicion, 1);
	assert.match(estadoDelMando(selector3, estado).texto, /posición 2\/3/);
	assert.equal(operarControl(selector3, estado, 'presionar').atendido, false);

	const selector2 = dispositivo('s2', { ...perfilPulsador, modo: 'mantenido' });
	assert.equal(operarControl(selector2, {}, 'accionar').estado.posicion, 1);
	assert.equal(operarControl(selector2, { posicion: 1 }, 'accionar').estado.posicion, 0);
});

test('fusible fundido no rearma por clic y un perfil de protección importado sí respeta rearmable', () => {
	const fusible = dispositivo('f1', {
		version: 1, clase: 'proteccion', polos: [{ entrada: '1', salida: '2' }],
		contactos: [], rearmable: false, funcion: 'fusible',
	});
	const intento = operarControl(fusible, { disparado: true, cerrado: false }, 'accionar');
	assert.equal(intento.atendido, true);
	assert.equal(intento.cambio, true);
	assert.deepEqual(intento.estado, { cerrado: true, reemplazoFusibleSolicitado: true });
	assert.deepEqual(estadoDelMando(fusible, intento.estado), {
		texto: 'cerrado', boton: 'Abrir', encendido: false,
	});

	const disyuntorImportado = dispositivo('q1', {
		version: 1, clase: 'proteccion', polos: [{ entrada: '1', salida: '2' }],
		contactos: [], rearmable: true, funcion: 'termomagnetico',
	});
	const rearmado = operarControl(disyuntorImportado, { disparado: true }, 'accionar');
	assert.deepEqual(rearmado.estado, { disparado: false, cerrado: true, rearmeSolicitado: true });
});

test('un seccionador abre/cierra, pero nunca se presenta ni actúa como protección disparada', () => {
	const seccionador: Dispositivo = {
		id: 'qs1', tipo: 'seccionador', bornes: [{ id: '1' }, { id: '2' }],
	};
	assert.deepEqual(controlDeSimulacion(seccionador), { clase: 'seccionador' });
	const abierto = operarControl(seccionador, { disparado: true }, 'accionar');
	assert.deepEqual(abierto.estado, { cerrado: false });
	assert.equal(estadoDelMando(seccionador, abierto.estado).texto, 'abierto');
	const cerrado = operarControl(seccionador, abierto.estado, 'accionar');
	assert.deepEqual(cerrado.estado, { cerrado: true });
});

function resultado(parcial: Partial<ResultadoSimulacion> = {}): ResultadoSimulacion {
	return {
		vivos: new Map(),
		conductoresVivos: new Set(),
		activos: new Set(),
		funcionando: [],
		avisos: [],
		pasadas: 1,
		oscila: false,
		sinAccionar: false,
		consumos: [],
		corrientePorConductor: new Map(),
		cargaPorAparato: new Map(),
		corrienteTotal: 0,
		cortocircuitos: [],
		disparos: [],
		analogicas: new Map(),
		salidasAnalogicas: new Map(),
		temporizadores: [],
		tensionesEquivocadas: [],
		arranques: [],
		controladores: [],
		variadores: [],
		protecciones: [],
		fallos: [],
		posicionesCargas: new Map(),
		sensoresAnalogicos: [],
		entradasAnalogicas: [],
		actuadores: [],
		fisica: resultadoFisicaVacio(),
		diagnosticosFallasEquipo: [],
		diagnosticoIndustrial: { hallazgos: [], aristas: [], advertencias: [] },
		...parcial,
		motores: parcial.motores ?? [],
	};
}

function proyecto(dispositivos: Dispositivo[]): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Animación por perfil',
		hojas: [], dispositivos, conductores: [],
	};
}

function grupoConPieza(id: string, pieza: string): { grupo: THREE.Group; malla: THREE.Mesh } {
	const grupo = new THREE.Group();
	grupo.userData.dispositivoId = id;
	const malla = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0x000000, emissiveIntensity: 0 }),
	);
	malla.userData.pieza = pieza;
	grupo.add(malla);
	return { grupo, malla };
}

test('motor y válvula se animan por efecto/resultado, no por el tipo de carcasa', () => {
	const motor = dispositivo('m-importado', {
		version: 1, clase: 'carga',
		alimentacion: { fases: ['1'], retornos: ['2'], fasesMinimas: 1 }, efecto: 'giro',
	});
	const valvula = dispositivo('y-importada', {
		version: 1, clase: 'carga',
		alimentacion: { fases: ['1'], retornos: ['2'], fasesMinimas: 1 }, efecto: 'movimiento',
		mandoAnalogico: { borne: '1', comun: '2', unidad: 'V', rango: [0, 10] },
	});
	const eje = grupoConPieza(motor.id, 'eje');
	const vastago = grupoConPieza(valvula.id, 'vastago');
	const r = resultado({
		activos: new Set([motor.id, valvula.id]),
		posicionesCargas: new Map([[valvula.id, 35]]),
	});
	animarSimulacion({
		grupos: [eje.grupo, vastago.grupo], proyecto: proyecto([motor, valvula]),
		resultado: r, estado: {}, energizado: true, dt: 0.1, reloj: 1,
	});
	assert.ok(eje.malla.rotation.x > 0, 'el motor importado con perfil giro no giró');
	assert.equal(vastago.malla.position.y, 2.1);

	r.posicionesCargas.set(valvula.id, 80);
	const giro = eje.malla.rotation.x;
	r.activos.delete(motor.id);
	animarSimulacion({
		grupos: [eje.grupo, vastago.grupo], proyecto: proyecto([motor, valvula]),
		resultado: r, estado: {}, energizado: true, dt: 0.1, reloj: 2,
	});
	assert.equal(eje.malla.rotation.x, giro, 'el eje siguió girando sin resultado activo');
	assert.equal(vastago.malla.position.y, 4.8);
});

test('la velocidad visual del motor deriva del resultado: 10 Hz gira cinco veces más lento que 50 Hz', () => {
	const motor = dispositivo('m-v2', {
		version: 1, clase: 'carga',
		alimentacion: { fases: ['1'], retornos: ['2'], fasesMinimas: 1 }, efecto: 'giro',
	});
	const lento = grupoConPieza(motor.id, 'eje');
	const rapido = grupoConPieza(motor.id, 'eje');
	const estadoMotor = (velocidadActual: number, hz: number) => ({
		dispositivoId: motor.id, designacion: '-M1', estado: 'marcha' as const, alimentado: true,
		fasesRequeridas: 1 as const, fasesPresentes: 1, progresoArranque: 1,
		frecuenciaElectricaHz: hz, velocidadObjetivo: velocidadActual, velocidadActual,
		velocidadPorcentaje: velocidadActual * 100, rpmOrigen: 'no-disponible' as const,
		corrienteNominalA: 2, corrienteNominalEstimada: false, corrienteEstimadaA: 2,
		duracionArranqueEstimadaS: 3,
	});
	animarSimulacion({
		grupos: [lento.grupo], proyecto: proyecto([motor]),
		resultado: resultado({ motores: [estadoMotor(0.2, 10)] }), estado: {}, energizado: true, dt: 1, reloj: 1,
	});
	animarSimulacion({
		grupos: [rapido.grupo], proyecto: proyecto([motor]),
		resultado: resultado({ motores: [estadoMotor(1, 50)] }), estado: {}, energizado: true, dt: 1, reloj: 1,
	});
	assert.ok(Math.abs(rapido.malla.rotation.x / lento.malla.rotation.x - 5) < 1e-9);
});

test('una imagen perfilada sin piezas recibe realce genérico reversible desde el resultado', () => {
	const contactor = dispositivo('k-importado', {
		version: 1,
		clase: 'contactos-electromagneticos',
		bobina: { entrada: 'A1', retorno: 'A2' },
		polos: [{ entrada: 'L1', salida: 'T1' }],
		contactos: [],
	}, 'otro', ['A1', 'A2', 'L1', 'T1']);
	const grupo = new THREE.Group();
	grupo.userData.dispositivoId = contactor.id;
	const material = new THREE.MeshStandardMaterial({ color: 0x303030 });
	const intensidadOriginal = material.emissiveIntensity;
	grupo.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
	const entrada = {
		grupos: [grupo], proyecto: proyecto([contactor]), estado: {}, energizado: true,
		dt: 0.016, reloj: 1,
	};

	animarSimulacion({ ...entrada, resultado: resultado({ activos: new Set([contactor.id]) }) });
	assert.ok(material.emissiveIntensity > 0);
	assert.equal(material.emissive.getHex(), 0x22c55e);
	animarSimulacion({ ...entrada, resultado: resultado() });
	assert.equal(material.emissiveIntensity, intensidadOriginal);
	assert.equal(material.emissive.getHex(), 0x000000);

	const inerte: Dispositivo = {
		...contactor,
		comportamiento: { version: 1, clase: 'sin-comportamiento', motivo: 'sin contrato validado' },
	};
	animarSimulacion({
		...entrada,
		proyecto: proyecto([inerte]),
		resultado: resultado({ activos: new Set([inerte.id]) }),
	});
	assert.equal(material.emissiveIntensity, intensidadOriginal,
		'una imagen explícitamente inerte tomó el estado activo del resultado');
});

test('el testigo de un sensor importado sigue el estado canónico y vuelve a reposo', () => {
	const sensor = dispositivo('sensor-importado', {
		version: 1, clase: 'sensor', contactos: [contacto('1', '2')],
	});
	const testigo = grupoConPieza(sensor.id, 'lente');
	const entrada = {
		grupos: [testigo.grupo], proyecto: proyecto([sensor]), resultado: resultado(),
		dt: 0.016, reloj: 1,
	};
	const material = testigo.malla.material as THREE.MeshStandardMaterial;
	animarSimulacion({ ...entrada, estado: {}, energizado: true });
	assert.equal(material.emissiveIntensity, 0);
	animarSimulacion({ ...entrada, estado: { [sensor.id]: { activo: true } }, energizado: true });
	assert.ok(material.emissiveIntensity > 0, 'el sensor importado activo no encendió su testigo');
	animarSimulacion({ ...entrada, estado: { [sensor.id]: { activo: true } }, energizado: false });
	assert.equal(material.emissiveIntensity, 0, 'el testigo conservó estado visual al desenergizar');
});

test('display de variador distingue sin alimentación/READY/RUN/FAULT y la animación usa ese estado', () => {
	const perfil: ComportamientoSimulacion = {
		version: 1,
		clase: 'variador',
		alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 },
		mando: { run: 'RUN' },
		referencia: { borne: 'AI1', comun: 'COM', unidad: 'V', rango: [0, 10] },
		salida: { u: 'U', v: 'V', w: 'W', tensionV: 230 },
		frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 },
	};
	const vfd = dispositivo('vfd-importado', perfil, 'otro',
		['L', 'N', 'RUN', 'AI1', 'COM', 'U', 'V', 'W']);
	const pantalla = grupoConPieza(vfd.id, 'pantalla');
	const estado = (estadoVfd: EstadoVariador['estado'], hz: number): EstadoVariador => ({
		dispositivoId: vfd.id,
		designacion: '-U1',
		estado: estadoVfd,
		alimentado: estadoVfd !== 'sin-alimentacion',
		run: estadoVfd === 'marcha',
		habilitado: true,
		referenciaPorcentaje: 60,
		frecuenciaObjetivoHz: 30,
		frecuenciaNominalHz: 50,
		frecuenciaHz: hz,
		falloEnclavado: estadoVfd === 'falla',
		resetPermitido: false,
		runBloqueadoHastaSoltar: false,
		calidadReferencia: 'normal',
	});
	assert.match(textoEstadoVariador(estado('sin-alimentacion', 0)), /^SIN ALIMENTACIÓN/);
	assert.match(textoEstadoVariador(estado('listo', 0)), /^READY/);
	assert.match(textoEstadoVariador(estado('marcha', 25)), /^RUN · 25\.0 Hz/);
	assert.match(textoEstadoVariador(estado('decel', 20)), /^DECEL · 20\.0 Hz/);
	assert.match(textoEstadoVariador(estado('falla', 0)), /^FAULT/);
	assert.match(textoEstadoVariador(estado('marcha', 25)), /NORMAL$/,
		'la calidad saludable también debe ser visible: no solo se muestran los fallos');

	animarSimulacion({
		grupos: [pantalla.grupo], proyecto: proyecto([vfd]),
		resultado: resultado({ variadores: [estado('listo', 0)] }),
		estado: {}, energizado: true, dt: 0.016, reloj: 1,
	});
	const material = pantalla.malla.material as THREE.MeshStandardMaterial;
	assert.ok(material.emissiveIntensity > 0, 'READY dejó el display apagado');
	animarSimulacion({
		grupos: [pantalla.grupo], proyecto: proyecto([vfd]),
		resultado: resultado({ variadores: [estado('falla', 0)] }),
		estado: {}, energizado: true, dt: 0.016, reloj: 2,
	});
	assert.equal(material.emissive.getHex(), 0xd32f2f);
});

test('la UI expone fallos y referencia VFD por controles visibles de runtime', () => {
	const fuente = readFileSync('app/ui-simulacion.ts', 'utf8');
	assert.match(fuente, /data-fallo=/, 'los fallos solo se pueden introducir mediante hooks de QA');
	assert.match(fuente, /data-ref-vfd=/, 'la referencia VFD no tiene un mando visible');
	assert.match(fuente, /estadoSim\[id\][\s\S]{0,180}valor:/,
		'la referencia visible no escribe el estado runtime que consume el motor');
	assert.match(fuente, /data-reset-vfd=/, 'FAULT no tiene una acción RESET visible');
});

test('la UI V3 muestra variable, señal, calidad, AI y actuador desde ResultadoSimulacion', () => {
	const fuente = readFileSync('app/ui-simulacion.ts', 'utf8');
	assert.match(fuente, /r\.sensoresAnalogicos\.find/,
		'la ficha de la sonda no consulta la señal producida por el motor');
	assert.match(fuente, /resultadoSensor\.senal\.valorElectrico/);
	assert.match(fuente, /c\.entradasAnalogicas\.map/,
		'la UI del PLC no publica señal bruta, valor escalado y calidad');
	assert.match(fuente, /for \(const actuador of r\.actuadores\)/,
		'la válvula conserva una posición visual paralela al resultado');
	assert.match(fuente, /actuador\.posicionObjetivo/);
	assert.match(fuente, /actuador\.posicionActual/);
	const animacion = readFileSync('app/animacion-sim.ts', 'utf8');
	assert.match(animacion, /resultado\?\.sensoresAnalogicos/);
	assert.match(animacion, /resultado\?\.actuadores/);
});
