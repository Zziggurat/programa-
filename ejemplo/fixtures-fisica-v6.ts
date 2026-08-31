/**
 * Fixtures públicos de Física Eléctrica V6.
 *
 * Son proyectos ordinarios y persistentes: el solver no conoce sus ids. Cada escena mantiene
 * un solo propósito medible para que también sea útil desde la UI y desde regresiones rápidas.
 */
import type { Borne, Conductor, Dispositivo, Proyecto, TipoBorne } from '../src/modelo/tipos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { fixtureMotorTrifasicoV5 } from './fixtures-fisica-v5.js';

const borne = (id: string, tipo: TipoBorne, maxConductores = 4): Borne => ({ id, tipo, maxConductores });
const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });
const cable = (
	id: string,
	de: [string, string],
	a: [string, string],
	longitudManualM = 1,
	seccion = 2.5,
	color = 'negro',
): Conductor => ({
	id, de: extremo(...de), a: extremo(...a), seccion, color,
	fisica: { material: 'COBRE', longitudManualM, temperaturaC: 20, xOhmPorKm: 0.08 },
});

const gabinete = (colocaciones: NonNullable<Proyecto['gabinete']>['colocaciones'], ancho = 620): Proyecto['gabinete'] => ({
	ancho, alto: 440,
	rieles: [{ id: 'r1', x: 35, y: 105, largo: ancho - 70 }],
	canaletas: [{ id: 'c1', x: 25, y: 235, largo: ancho - 50, orientacion: 'h', ancho: 40, alto: 60 }],
	colocaciones,
});

const fuenteMonofasica = (conPe = false): Dispositivo => ({
	id: 'red', tipo: 'otro', clase: 'W', campo: true, congelado: true, designacion: '-W1',
	descripcion: conPe ? 'Red 230 V con referencia PE local explícita' : 'Red monofásica 230 V',
	bornes: [borne('L', 'L', 6), borne('N', 'N', 6), ...(conPe ? [borne('PE', 'PE', 6)] : [])],
	comportamiento: { version: 1, clase: 'fuente', salidas: [
		{ borne: 'L', papel: 'fase', tensionV: 230 }, { borne: 'N', papel: 'retorno', tensionV: 230 },
	] },
	fisica: { version: 1, fuente: {
		sistema: 'AC_MONOFASICA', tensionNominalV: 230, frecuenciaHz: 50, referencia: 'N',
		referenciaPe: conPe ? 'PE' : undefined, fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.2, xOhm: 0,
	} },
});

/** Servicio normal balanceado y fuga L-PE que debe ser vista por el toroide, no por el PE. */
export function fixtureDiferencialV6(): Proyecto {
	const p = crearProyecto('Fixture V6 — diferencial y fuga PE', { frecuenciaHz: 50, temperaturaAmbienteC: 20 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Diferencial y fuga PE' }];
	p.dispositivos = [
		fuenteMonofasica(true),
		{
			id: 'qf1', tipo: 'diferencial', designacion: '-QF1', congelado: true,
			descripcion: 'Diferencial 2P 40 A / IΔn 30 mA (modelo RMS)', sensibilidadMA: 30, corrienteNominal: 40,
			bornes: [borne('1', 'L'), borne('2', 'L'), borne('N1', 'N'), borne('N2', 'N')],
			comportamiento: { version: 1, clase: 'proteccion', funcion: 'diferencial', rearmable: true,
				polos: [{ entrada: '1', salida: '2' }, { entrada: 'N1', salida: 'N2' }], contactos: [] },
			fisica: { version: 1, diferencial: { corrienteResidualNominalA: 0.03, retardoS: 0,
				conductoresMedidos: [{ entrada: '1', salida: '2' }, { entrada: 'N1', salida: 'N2' }] } },
		},
		{
			id: 'z1', tipo: 'resistencia', designacion: '-Z1', congelado: true,
			descripcion: 'Carga 230 Ω y punto de ensayo L-PE', tensionNominal: 230,
			bornes: [borne('L', 'L'), borne('N', 'N'), borne('PE', 'PE')],
			comportamiento: { version: 1, clase: 'carga', efecto: 'calor',
				alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 } },
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 230 } },
		},
	];
	p.conductores = [
		cable('w-l-in', ['red', 'L'], ['qf1', '1'], 1, 2.5, 'marrón'),
		cable('w-l-out', ['qf1', '2'], ['z1', 'L'], 1, 2.5, 'marrón'),
		cable('w-n-out', ['z1', 'N'], ['qf1', 'N2'], 1, 2.5, 'azul'),
		cable('w-n-in', ['qf1', 'N1'], ['red', 'N'], 1, 2.5, 'azul'),
		cable('w-pe', ['red', 'PE'], ['z1', 'PE'], 1, 2.5, 'verde/amarillo'),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 'qf1', x: 90, y: 60, ancho: 72, alto: 88, rielId: 'r1' },
		{ dispositivoId: 'z1', x: 285, y: 62, ancho: 88, alto: 82, rielId: 'r1' },
	]);
	return p;
}

/** Transformador acoplado: la carga secundaria se refleja al primario y permite variar Z1. */
export function fixtureTransformadorV6(): Proyecto {
	const p = crearProyecto('Fixture V6 — transformador bajo carga', { frecuenciaHz: 50, temperaturaAmbienteC: 20 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Transformador acoplado' }];
	p.dispositivos = [
		fuenteMonofasica(false),
		{
			id: 't1', tipo: 'transformador', designacion: '-T1', congelado: true,
			descripcion: 'Transformador 230/23 V, 230 VA, Z=5 %', tensionNominal: 230,
			bornes: [borne('P1', 'L'), borne('P2', 'N'), borne('S1', 'L'), borne('S2', 'N')],
			comportamiento: { version: 1, clase: 'fuente', primario: { entradas: ['P1'], retornos: ['P2'] },
				salidas: [{ borne: 'S1', papel: 'fase', tensionV: 23 }, { borne: 'S2', papel: 'retorno', tensionV: 23 }] },
			fisica: { version: 1, transformador: { primarioV: 230, secundarioV: 23,
				primarioTerminales: ['P1', 'P2'], secundarioTerminales: ['S1', 'S2'],
				potenciaVA: 230, impedanciaPct: 5, xSobreR: 0, perdidasVacioW: 2 } },
		},
		{
			id: 'z1', tipo: 'resistencia', designacion: '-Z1', congelado: true,
			descripcion: 'Carga secundaria 23 Ω', tensionNominal: 23,
			bornes: [borne('L', 'L'), borne('N', 'N')],
			comportamiento: { version: 1, clase: 'carga', efecto: 'calor',
				alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 } },
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } },
		},
	];
	p.conductores = [
		cable('wp1', ['red', 'L'], ['t1', 'P1']), cable('wp2', ['t1', 'P2'], ['red', 'N']),
		cable('ws1', ['t1', 'S1'], ['z1', 'L'], 1, 1.5, 'rojo'),
		cable('ws2', ['z1', 'N'], ['t1', 'S2'], 1, 1.5, 'azul'),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 't1', x: 115, y: 55, ancho: 100, alto: 94, rielId: 'r1' },
		{ dispositivoId: 'z1', x: 330, y: 62, ancho: 86, alto: 82, rielId: 'r1' },
	]);
	return p;
}

/** Circuito V5 visual conservado, con el motor V6 derivado exclusivamente de placa. */
export function fixtureMotorPlacaV6(): Proyecto {
	const p = fixtureMotorTrifasicoV5();
	p.nombre = 'Fixture V6 — motor desde placa y diagnóstico';
	p.hojas[0]!.titulo = 'Motor desde placa V6';
	const m = p.dispositivos.find((d) => d.id === 'm1')!;
	m.descripcion = 'Motor 5,5 kW / 400 V / 50 Hz / 4P / 1450 rpm';
	m.fisica = { version: 1, motor: {
		potenciaMecanicaNominalW: 5500, tensionNominalV: 400, frecuenciaHz: 50, fases: 3,
		eficiencia: 0.9, factorPotencia: 0.85, rpmNominal: 1450, polos: 4,
		corrienteArranqueMultiplo: 6, tiempoArranqueS: 2, factorServicio: 1.1, umbralSubtension: 0.85,
	} };
	return p;
}

/** VFD V/f operable desde selector y referencia visible, alimentando un motor de placa. */
export function fixtureVfdMotorV6(): Proyecto {
	const p = crearProyecto('Fixture V6 — VFD y motor', { frecuenciaHz: 50, temperaturaAmbienteC: 25 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'VFD y motor V6' }];
	p.dispositivos = [
		fuenteMonofasica(false),
		{
			id: 's-run', tipo: 'selector', designacion: '-S1', congelado: true, descripcion: 'Selector RUN',
			bornes: [borne('13', 'control'), borne('14', 'control')],
			comportamiento: { version: 1, clase: 'mando', modo: 'mantenido', posiciones: 2, reposo: 0,
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }] },
		},
		{
			id: 'vfd', tipo: 'variador', designacion: '-U1', congelado: true,
			descripcion: 'VFD 4 kW, entrada 230 V 1~, salida 400 V 3~ V/f',
			bornes: ['L', 'N', 'RUN', 'AI', 'COM', 'U', 'V', 'W'].map((id) => borne(id, id === 'N' ? 'N' : 'L')),
			comportamiento: { version: 1, clase: 'variador',
				alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 }, mando: { run: 'RUN' },
				referencia: { borne: 'AI', comun: 'COM', unidad: 'V', rango: [0, 10] },
				salida: { u: 'U', v: 'V', w: 'W', tensionV: 400 },
				frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 } },
			fisica: { version: 1, vfd: { tensionEntradaNominalV: 230, fasesEntrada: 1,
				potenciaNominalW: 4000, eficiencia: 0.95, frecuenciaBaseHz: 50, frecuenciaMaxHz: 50,
				tensionSalidaMaxV: 400, limiteCorrienteA: 12, umbralSubtension: 0.85,
				rSalidaOhm: 0.02, perfil: 'V_F_LINEAL' } },
		},
		{
			id: 'm1', tipo: 'motor', designacion: '-M1', campo: true, congelado: true,
			descripcion: 'Motor 3 kW / 400 V / 4P', tensionNominal: 400,
			bornes: [borne('U1', 'L'), borne('V1', 'L'), borne('W1', 'L'), borne('PE', 'PE')],
			comportamiento: { version: 1, clase: 'carga', efecto: 'giro',
				alimentacion: { fases: ['U1', 'V1', 'W1'], retornos: [], fasesMinimas: 3 },
				dinamicaMotor: { polos: 4, tiempoArranqueS: 1, tiempoParadaS: 1 } },
			fisica: { version: 1, motor: { potenciaMecanicaNominalW: 3000, tensionNominalV: 400,
				frecuenciaHz: 50, fases: 3, eficiencia: 0.9, factorPotencia: 0.85,
				rpmNominal: 1450, polos: 4, corrienteArranqueMultiplo: 6, tiempoArranqueS: 1 } },
		},
	];
	p.conductores = [
		cable('wi-l', ['red', 'L'], ['vfd', 'L'], 2, 4, 'marrón'),
		cable('wi-n', ['vfd', 'N'], ['red', 'N'], 2, 4, 'azul'),
		cable('run-l', ['red', 'L'], ['s-run', '13'], 1, 1, 'rojo'),
		cable('run-vfd', ['s-run', '14'], ['vfd', 'RUN'], 1, 1, 'rojo'),
		cable('wo-u', ['vfd', 'U'], ['m1', 'U1'], 5, 2.5, 'marrón'),
		cable('wo-v', ['vfd', 'V'], ['m1', 'V1'], 5, 2.5, 'negro'),
		cable('wo-w', ['vfd', 'W'], ['m1', 'W1'], 5, 2.5, 'gris'),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 'vfd', x: 105, y: 42, ancho: 120, alto: 128, rielId: 'r1' },
		{ dispositivoId: 's-run', x: 300, y: 280, ancho: 32, alto: 32, montaje: 'puerta' },
	], 680);
	return p;
}

/** Tres cargas L-N deliberadamente distintas y un neutro que puede abrirse desde runtime. */
export function fixtureDesequilibrioV6(resistencias: [number, number, number] = [40, 80, 160]): Proyecto {
	const p = crearProyecto('Fixture V6 — neutro y desequilibrio', { frecuenciaHz: 50, temperaturaAmbienteC: 20 });
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Desequilibrio trifásico' }];
	const cargas = resistencias.map((r, i): Dispositivo => ({
		id: `z${i + 1}`, tipo: 'resistencia', designacion: `-Z${i + 1}`, congelado: true,
		descripcion: `Carga L${i + 1}-N ${r} Ω`, bornes: [borne('L', 'L'), borne('N', 'N')],
		comportamiento: { version: 1, clase: 'carga', efecto: 'calor',
			alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 } },
		fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: r } },
	}));
	p.dispositivos = [
		{
			id: 'red', tipo: 'otro', clase: 'W', campo: true, congelado: true, designacion: '-W1',
			descripcion: 'Red trifásica 400/230 V', bornes: [borne('L1', 'L', 5), borne('L2', 'L', 5), borne('L3', 'L', 5), borne('N', 'N', 5)],
			fisica: { version: 1, fuente: { sistema: 'AC_TRIFASICA', tensionNominalV: 400, frecuenciaHz: 50,
				referencia: 'N', fases: [{ borne: 'L1', fase: 'L1' }, { borne: 'L2', fase: 'L2' }, { borne: 'L3', fase: 'L3' }],
				rOhm: 0.2, xOhm: 0, umbralDesequilibrioPct: 10 } },
		},
		{ id: 'bus-n', tipo: 'bornero', designacion: '-XN', congelado: true,
			descripcion: 'Barra de neutro', bornes: ['N0', 'N1', 'N2', 'N3'].map((id) => borne(id, 'N')),
			puentesInternos: [['N0', 'N1'], ['N0', 'N2'], ['N0', 'N3']] },
		...cargas,
	];
	p.conductores = [
		cable('wn', ['red', 'N'], ['bus-n', 'N0'], 1, 2.5, 'azul'),
		...cargas.flatMap((_, i) => [
			cable(`wl${i + 1}`, ['red', `L${i + 1}`], [`z${i + 1}`, 'L'], 1, 2.5, ['marrón', 'negro', 'gris'][i]),
			cable(`wr${i + 1}`, [`z${i + 1}`, 'N'], ['bus-n', `N${i + 1}`], 1, 2.5, 'azul'),
		]),
	];
	p.gabinete = gabinete([
		{ dispositivoId: 'bus-n', x: 75, y: 65, ancho: 72, alto: 78, rielId: 'r1' },
		...cargas.map((d, i) => ({ dispositivoId: d.id, x: 215 + i * 115, y: 62, ancho: 72, alto: 82, rielId: 'r1' })),
	], 700);
	return p;
}

/** Ensayo de rendimiento: varios circuitos desconectados entre sí dentro de una misma red. */
export function fixtureEstresFisicaV6(): Proyecto {
	const partes = [fixtureDiferencialV6(), fixtureTransformadorV6(), fixtureMotorPlacaV6(),
		fixtureVfdMotorV6(), fixtureDesequilibrioV6()];
	const p = crearProyecto('Fixture V6 — estrés físico focal');
	for (const [i, parte] of partes.entries()) {
		const prefijo = `c${i + 1}-`;
		for (const d of parte.dispositivos) p.dispositivos.push({ ...structuredClone(d), id: prefijo + d.id });
		for (const w of parte.conductores) p.conductores.push({ ...structuredClone(w), id: prefijo + w.id,
			de: { ...w.de, dispositivoId: prefijo + w.de.dispositivoId },
			a: { ...w.a, dispositivoId: prefijo + w.a.dispositivoId } });
	}
	p.gabinete = { ancho: 1200, alto: 900, rieles: [], canaletas: [], colocaciones: [] };
	return p;
}
