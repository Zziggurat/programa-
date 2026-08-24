import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { ComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import {
	cambiarFalloRuntime, fallosCompatibles, type TipoFalloRuntime,
} from '../src/motores/fallos-runtime.js';
import {
	actualizarProteccionesRuntime, contactosCerrados, memoriaVacia, simular,
} from '../src/motores/simulacion.js';

const proteccion = (
	funcion: Extract<ComportamientoSimulacion, { clase: 'proteccion' }>['funcion'],
	tipo: Dispositivo['tipo'] = 'otro',
): Dispositivo => ({
	id: `p-${funcion}`, tipo,
	bornes: ['I', 'O'].map((id) => ({ id })),
	comportamiento: {
		version: 1, clase: 'proteccion', rearmable: funcion !== 'fusible', funcion,
		polos: [{ entrada: 'I', salida: 'O' }], contactos: [],
	},
});

test('fallos runtime: las opciones dependen del perfil funcional, no de marca, imagen o id', () => {
	const motor: Dispositivo = {
		id: 'foto-arbitraria', tipo: 'otro', imagen: 'asset://imagen',
		bornes: ['a', 'b', 'c'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'carga', efecto: 'giro',
			alimentacion: { fases: ['a', 'b', 'c'], retornos: [], fasesMinimas: 3 },
		},
	};
	assert.deepEqual(fallosCompatibles(motor), [
		'sobrecarga', 'motor-bloqueado', 'perdida-fase', 'subtension', 'sobretension',
	]);
	assert.deepEqual(fallosCompatibles(proteccion('diferencial')), ['fuga-tierra']);
	assert.deepEqual(fallosCompatibles(proteccion('fusible')), ['sobrecarga', 'cortocircuito']);
});

test('fallos runtime: activar y quitar una condición no muta ni se serializa en Proyecto', () => {
	const inicial: { activo: boolean; fallos?: TipoFalloRuntime[] } = { activo: true };
	const conFallo = cambiarFalloRuntime(inicial, 'sobrecarga', true);
	assert.deepEqual(inicial, { activo: true });
	assert.deepEqual(conFallo, { activo: true, fallos: ['sobrecarga'] });
	assert.deepEqual(cambiarFalloRuntime(conFallo, 'sobrecarga', false), { activo: true });

	const proyecto = crearProyecto('Runtime separado');
	proyecto.dispositivos = [proteccion('termico')];
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyecto.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	const cargado = cargarProyecto(JSON.stringify(proyecto)).proyecto;
	assert.equal(JSON.stringify(cargado).includes('fallos'), false);
	assert.equal(
		(cargado.dispositivos[0].comportamiento as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>).funcion,
		'termico',
	);
});

test('perfiles V1 antiguos conservan compatibilidad y reciben capacidad legacy solo si es inequívoca', () => {
	const fusible = proteccion(undefined, 'fusible');
	delete (fusible.comportamiento as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>).funcion;
	assert.deepEqual(fallosCompatibles(fusible), ['sobrecarga', 'cortocircuito']);

	const ambiguo = proteccion(undefined, 'otro');
	delete (ambiguo.comportamiento as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>).funcion;
	assert.deepEqual(fallosCompatibles(ambiguo), [], 'un perfil antiguo ambiguo no debe inventar mecanismo');
});

const cable = (id: string, de: [string, string], a: [string, string]): Conductor => ({
	id, de: { dispositivoId: de[0], borneId: de[1] }, a: { dispositivoId: a[0], borneId: a[1] },
});

function tableroMotorV2(): Proyecto {
	const p = crearProyecto('Motor V2');
	p.opciones = { ...p.opciones, frecuenciaHz: 50 };
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Red trifásica', tensionNominal: 400,
			bornes: ['L1', 'L2', 'L3'].map((id) => ({ id, tipo: 'L' as const })),
		},
		{
			id: 'motor', tipo: 'otro', imagen: 'asset://motor-importado', tensionNominal: 400, corrienteNominal: 4,
			bornes: ['U', 'V', 'W'].map((id) => ({ id, tipo: 'L' as const })),
			comportamiento: {
				version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U', 'V', 'W'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 2, tiempoParadaS: 4 },
			},
		},
	];
	p.conductores = [
		cable('c1', ['red', 'L1'], ['motor', 'U']), cable('c2', ['red', 'L2'], ['motor', 'V']),
		cable('c3', ['red', 'L3'], ['motor', 'W']),
	];
	return p;
}

test('motor V2: la transición usa reloj, acelera y desacelera sin depender del FPS', () => {
	const p = tableroMotorV2();
	const memoria = memoriaVacia();
	let r = simular(p, {}, undefined, { ahora: 0, memoria });
	assert.equal(r.motores[0].estado, 'arrancando');
	assert.equal(r.motores[0].velocidadActual, 0);
	r = simular(p, {}, r.activos, { ahora: 1000, memoria });
	assert.equal(r.motores[0].velocidadActual, 0.5);
	r = simular(p, {}, r.activos, { ahora: 2000, memoria });
	assert.equal(r.motores[0].estado, 'marcha');
	assert.equal(r.motores[0].velocidadActual, 1);
	assert.equal(r.motores[0].rpmSincronas, 1500);
	assert.equal(r.motores[0].rpmOrigen, 'estimado');

	const sinRed = { ...p, conductores: [] };
	r = simular(sinRed, {}, r.activos, { ahora: 3000, memoria });
	assert.equal(r.motores[0].estado, 'desacelerando');
	assert.equal(r.motores[0].velocidadActual, 0.75);
	r = simular(sinRed, {}, r.activos, { ahora: 6000, memoria });
	assert.equal(r.motores[0].estado, 'detenido');
	assert.equal(r.motores[0].velocidadActual, 0);
});

test('motor V2: pérdida de fase real o inyectada es FALLO, no marcha sana', () => {
	const p = tableroMotorV2();
	p.conductores.pop();
	let r = simular(p);
	assert.equal(r.motores[0].estado, 'falla');
	assert.equal(r.motores[0].motivoFalla, 'perdida-fase');
	assert.equal(r.motores[0].fasesPresentes, 2);

	r = simular(tableroMotorV2(), { motor: { fallos: ['perdida-fase'] } });
	assert.equal(r.motores[0].estado, 'falla');
	assert.equal(r.motores[0].motivoFalla, 'perdida-fase');
});

test('motor V2: sin polos publica velocidad relativa y no inventa RPM', () => {
	const p = tableroMotorV2();
	const motor = p.dispositivos.find((d) => d.id === 'motor')!;
	if (motor.comportamiento?.clase === 'carga') delete motor.comportamiento.dinamicaMotor;
	const r = simular(p);
	assert.equal(r.motores[0].velocidadPorcentaje, 100);
	assert.equal(r.motores[0].rpmEstimada, undefined);
	assert.equal(r.motores[0].rpmOrigen, 'no-disponible');
});

function tableroProteccionV2(
	funcion: 'termico' | 'termomagnetico' | 'fusible' | 'diferencial',
	importada = false,
): Proyecto {
	const p = crearProyecto(`Protección ${funcion}`);
	const tipo = importada ? 'otro' as const : funcion === 'termico' ? 'rele' as const
		: funcion === 'fusible' ? 'fusible' as const : funcion === 'diferencial' ? 'diferencial' as const
			: 'disyuntor' as const;
	const proteccion: Dispositivo = {
		id: 'proteccion', tipo, corrienteNominal: 4,
		bornes: ['I', 'O', '95', '96', '97', '98'].map((id) => ({ id })),
		comportamiento: {
			version: 1, clase: 'proteccion', funcion, rearmable: funcion !== 'fusible',
			polos: [{ entrada: 'I', salida: 'O' }],
			contactos: [
				{ entrada: '95', salida: '96', reposo: 'cerrado', funcion: 'auxiliar' },
				{ entrada: '97', salida: '98', reposo: 'abierto', funcion: 'auxiliar' },
			],
		},
	};
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Red', tensionNominal: 230,
			bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		proteccion,
		{
			id: 'carga', tipo: 'resistencia', corrienteNominal: 1,
			bornes: [{ id: 'A', tipo: 'L' }, { id: 'B', tipo: 'N' }],
		},
	];
	p.conductores = [
		cable('c1', ['red', 'L'], ['proteccion', 'I']), cable('c2', ['proteccion', 'O'], ['carga', 'A']),
		cable('c3', ['red', 'N'], ['carga', 'B']),
	];
	return p;
}

test('relé térmico V2: acumula, dispara 95-96/97-98 y el rearme no crea una orden de marcha', () => {
	const p = tableroProteccionV2('termico');
	const memoria = memoriaVacia();
	let estado = { proteccion: { fallos: ['sobrecarga'] as TipoFalloRuntime[] } };
	let r = simular(p, estado, undefined, { ahora: 0, memoria });
	let avance = actualizarProteccionesRuntime(p, estado, r, 0, memoria);
	assert.equal(avance.cambio, false);
	avance = actualizarProteccionesRuntime(p, estado, r, 4000, memoria);
	assert.equal(memoria.protecciones?.proteccion.cargaTermica, 0.5);
	assert.equal(avance.cambio, false);
	avance = actualizarProteccionesRuntime(p, estado, r, 8000, memoria);
	assert.equal(avance.eventos[0].estado, 'disparado');
	estado = avance.estado as typeof estado;
	assert.deepEqual(contactosCerrados(p.dispositivos[1], estado.proteccion, false), [['97', '98']]);
	r = simular(p, estado, undefined, { ahora: 8000, memoria });
	assert.equal(r.protecciones[0].estado, 'disparado');
	assert.equal(r.activos.has('carga'), false);

	const sinCausa = cambiarFalloRuntime(estado.proteccion, 'sobrecarga', false);
	const rearme = { ...estado, proteccion: { ...sinCausa, rearmeSolicitado: true } };
	const rearmado = actualizarProteccionesRuntime(p, rearme, r, 8100, memoria);
	assert.equal(rearmado.estado.proteccion.disparado, undefined);
	assert.equal(rearmado.estado.proteccion.rearmeSolicitado, undefined);
	assert.equal(simular(p, rearmado.estado).activos.has('carga'), true,
		'el rearme restaura contactos de potencia, pero no inventa mandos ajenos al circuito');
});

test('fusible V2: FUNDIDO no rearma; REEMPLAZAR funciona y se funde otra vez si la causa sigue', () => {
	const p = tableroProteccionV2('fusible', true);
	const memoria = memoriaVacia();
	let estado = { proteccion: { fallos: ['cortocircuito'] as TipoFalloRuntime[] } };
	let r = simular(p, estado, undefined, { ahora: 0, memoria });
	let avance = actualizarProteccionesRuntime(p, estado, r, 0, memoria);
	assert.equal(avance.eventos[0].estado, 'fundido');
	estado = avance.estado as typeof estado;
	assert.equal(simular(p, estado).protecciones[0].estado, 'fundido');

	const reemplazoConCausa = { ...estado, proteccion: { ...estado.proteccion, reemplazoFusibleSolicitado: true } };
	avance = actualizarProteccionesRuntime(p, reemplazoConCausa, r, 100, memoria);
	assert.equal(avance.estado.proteccion.disparado, true, 'la causa persistente no puede quedar oculta al reemplazar');

	const sinCausa = cambiarFalloRuntime(avance.estado.proteccion, 'cortocircuito', false);
	const reemplazo = { ...avance.estado, proteccion: { ...sinCausa, reemplazoFusibleSolicitado: true } };
	r = simular(p, reemplazo, undefined, { ahora: 200, memoria });
	avance = actualizarProteccionesRuntime(p, reemplazo, r, 200, memoria);
	assert.equal(avance.estado.proteccion.disparado, undefined);
	assert.equal(simular(p, avance.estado).protecciones[0].estado, 'cerrado');
});

test('diferencial V2: la fuga es inyectada, no una residual falsamente calculada', () => {
	const p = tableroProteccionV2('diferencial');
	const memoria = memoriaVacia();
	const estado = { proteccion: { fallos: ['fuga-tierra'] as TipoFalloRuntime[] } };
	const r = simular(p, estado, undefined, { ahora: 0, memoria });
	const avance = actualizarProteccionesRuntime(p, estado, r, 0, memoria);
	assert.deepEqual(avance.eventos.map((e) => [e.causa, e.origen]), [['fuga-tierra', 'inyectado']]);
	assert.equal(simular(p, avance.estado).protecciones[0].estado, 'disparado');
});

test('disyuntor/guardamotor V2: térmica y magnética comparten contrato sin prometer Icc', () => {
	const ejecutarSobrecarga = (importada: boolean) => {
		const p = tableroProteccionV2('termomagnetico', importada);
		p.dispositivos.find((d) => d.id === 'carga')!.corrienteNominal = 6;
		const memoria = memoriaVacia();
		const r = simular(p, {}, undefined, { ahora: 0, memoria });
		const propuesta = r.disparos.find((d) => d.dispositivoId === 'proteccion');
		assert.ok(propuesta?.segundos && propuesta.motivo === 'sobrecarga');
		actualizarProteccionesRuntime(p, {}, r, 0, memoria);
		const final = actualizarProteccionesRuntime(p, {}, r, propuesta!.segundos * 1000, memoria);
		return {
			evento: final.eventos.map((e) => [e.estado, e.causa, e.origen]),
			estado: simular(p, final.estado).protecciones[0].estado,
		};
	};
	assert.deepEqual(ejecutarSobrecarga(true), ejecutarSobrecarga(false),
		'la imagen/carcasa importada cambió el mecanismo termomagnético');

	const guardamotor = tableroProteccionV2('termomagnetico');
	guardamotor.dispositivos.find((d) => d.id === 'proteccion')!.tipo = 'guardamotor';
	const memoria = memoriaVacia();
	const estado = { proteccion: { fallos: ['cortocircuito'] as TipoFalloRuntime[] } };
	const r = simular(guardamotor, estado, undefined, { ahora: 0, memoria });
	const disparo = actualizarProteccionesRuntime(guardamotor, estado, r, 0, memoria);
	assert.deepEqual(disparo.eventos.map((e) => [e.estado, e.causa, e.origen]),
		[['disparado', 'cortocircuito', 'inyectado']]);
});

function tableroVfdV2(run = true, importado = true): Proyecto {
	const p = crearProyecto('VFD V2');
	p.opciones = { ...p.opciones, frecuenciaHz: 50 };
	const perfilVfd: ComportamientoSimulacion = {
		version: 1, clase: 'variador',
		alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 },
		mando: { run: 'RUN' }, referencia: { borne: 'AI', comun: 'COM', unidad: 'V', rango: [0, 10] },
		salida: { u: 'U', v: 'V', w: 'W', tensionV: 400 },
		frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 },
	};
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, descripcion: 'Red', tensionNominal: 230,
			bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
		},
		{
			id: 'vfd', tipo: importado ? 'otro' : 'variador', imagen: importado ? 'asset://vfd-importado' : undefined,
			bornes: ['L', 'N', 'RUN', 'AI', 'COM', 'U', 'V', 'W'].map((id) => ({ id })),
			comportamiento: perfilVfd,
		},
		{
			id: 'motor', tipo: 'otro', imagen: 'asset://motor-importado', corrienteNominal: 3, tensionNominal: 400,
			bornes: ['U1', 'V1', 'W1'].map((id) => ({ id, tipo: 'L' as const })),
			comportamiento: {
				version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U1', 'V1', 'W1'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 2, tiempoParadaS: 2 },
			},
		},
	];
	p.conductores = [
		cable('p1', ['red', 'L'], ['vfd', 'L']), cable('p2', ['red', 'N'], ['vfd', 'N']),
		cable('m1', ['vfd', 'U'], ['motor', 'U1']), cable('m2', ['vfd', 'V'], ['motor', 'V1']),
		cable('m3', ['vfd', 'W'], ['motor', 'W1']),
	];
	if (run) p.conductores.push(cable('run', ['red', 'L'], ['vfd', 'RUN']));
	return p;
}

test('VFD V2: RUN, DECEL, FAULT enclavado, RESET seguro y nueva orden RUN', () => {
	const p = tableroVfdV2();
	const memoria = memoriaVacia();
	let estado = { vfd: { valor: 10 } };
	let r = simular(p, estado, undefined, { ahora: 0, memoria });
	assert.equal(r.variadores[0].estado, 'marcha');
	assert.equal(r.variadores[0].frecuenciaHz, 0);
	r = simular(p, estado, r.activos, { ahora: 5000, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 50);
	assert.equal(r.motores[0].velocidadPorcentaje, 100);

	estado = { vfd: { valor: 5 } };
	r = simular(p, estado, r.activos, { ahora: 6000, memoria });
	assert.equal(r.variadores[0].estado, 'decel');
	assert.equal(r.variadores[0].frecuenciaHz, 40);
	r = simular(p, estado, r.activos, { ahora: 7500, memoria });
	assert.equal(r.variadores[0].frecuenciaHz, 25);

	const conFallo = { vfd: { valor: 5, fallos: ['fallo-externo'] as TipoFalloRuntime[] } };
	r = simular(p, conFallo, r.activos, { ahora: 7600, memoria });
	assert.equal(r.variadores[0].estado, 'falla');
	assert.equal(r.variadores[0].frecuenciaHz, 0);
	assert.equal(r.motores[0].estado, 'desacelerando');
	r = simular(p, { vfd: { valor: 5, resetFallo: true, fallos: ['fallo-externo'] } }, r.activos,
		{ ahora: 7700, memoria });
	assert.equal(r.variadores[0].estado, 'falla', 'RESET aceptó mientras seguía presente la causa');

	r = simular(p, { vfd: { valor: 5 } }, r.activos, { ahora: 8000, memoria });
	assert.equal(r.variadores[0].estado, 'falla', 'retirar la causa borró el FAULT enclavado');
	r = simular(p, { vfd: { valor: 5, resetFallo: true } }, r.activos, { ahora: 8100, memoria });
	assert.equal(r.variadores[0].estado, 'listo');
	assert.equal(r.variadores[0].runBloqueadoHastaSoltar, true);
	r = simular(p, { vfd: { valor: 5 } }, r.activos, { ahora: 8200, memoria });
	assert.equal(r.variadores[0].estado, 'listo', 'RESET se convirtió en RUN con la orden aún alta');

	const sinRun = tableroVfdV2(false);
	r = simular(sinRun, { vfd: { valor: 5 } }, r.activos, { ahora: 8300, memoria });
	assert.equal(r.variadores[0].estado, 'listo');
	r = simular(p, { vfd: { valor: 5 } }, r.activos, { ahora: 8400, memoria });
	assert.equal(r.variadores[0].estado, 'marcha');
	assert.ok(r.variadores[0].frecuenciaHz > 0, 'una nueva orden RUN no volvió a arrancar');
});

test('VFD → motor: 10/25/50 Hz producen velocidades distintas y perfiles importados equivalentes', () => {
	const ejecutar = (voltios: number, importado: boolean) => {
		const r = simular(tableroVfdV2(true, importado), { vfd: { valor: voltios } });
		return {
			hz: r.variadores[0].frecuenciaHz,
			velocidad: r.motores[0].velocidadPorcentaje,
			rpm: r.motores[0].rpmEstimada,
		};
	};
	assert.deepEqual(ejecutar(5, true), ejecutar(5, false));
	assert.deepEqual([ejecutar(2, true), ejecutar(5, true), ejecutar(10, true)], [
		{ hz: 10, velocidad: 20, rpm: 300 },
		{ hz: 25, velocidad: 50, rpm: 750 },
		{ hz: 50, velocidad: 100, rpm: 1500 },
	]);
});
