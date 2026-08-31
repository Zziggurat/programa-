import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureVfdMotorV6 } from '../ejemplo/fixtures-fisica-v6.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { REGLA_COMPATIBILIDAD_EQUIPOS } from '../src/ingenieria/compatibilidad.js';
import { validarIngenieria } from '../src/ingenieria/validacion.js';
import type { DatosBobinaSimulacion, DatosSalidaDigitalSimulacion } from '../src/modelo/comportamiento.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Conductor, Dispositivo, Proyecto } from '../src/modelo/tipos.js';

const extremo = (dispositivoId: string, borneId: string) => ({ dispositivoId, borneId });
const cable = (id: string, de: [string, string], a: [string, string]): Conductor => ({ id,
	de: extremo(...de), a: extremo(...a), seccion: 1, fisica: { material: 'COBRE', longitudManualM: 1 } });

function proyectoDo(salida?: DatosSalidaDigitalSimulacion, bobina?: DatosBobinaSimulacion): Proyecto {
	const p = crearProyecto('Compatibilidad DO');
	p.gabinete = { ancho: 400, alto: 300, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [
		{ id: 'plc', tipo: 'otro', bornes: ['+24', '0V', 'DO1'].map((id) => ({ id, tipo: 'control' as const })),
			comportamiento: { version: 1, clase: 'controlador', alimentacion: { entradas: ['+24'], retornos: ['0V'] },
				salidasDigitales: [{ borne: 'DO1', comun: '+24', ...(salida ? { electrica: salida } : {}) }], salidasAnalogicas: [] } },
		{ id: 'km', tipo: 'otro', bornes: ['A1', 'A2', '1', '2'].map((id) => ({ id, tipo: 'control' as const })),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2', ...(bobina ? { electrica: bobina } : {}) },
				polos: [{ entrada: '1', salida: '2' }], contactos: [] } },
	];
	p.conductores = [cable('w-do', ['plc', 'DO1'], ['km', 'A1'])]; return p;
}

const evaluar = (p: Proyecto, fisica = simularFisicaProyecto(p)) => validarIngenieria({
	proyecto: p, fisica, reglas: [REGLA_COMPATIBILIDAD_EQUIPOS],
});

test('Gate F: DO compatible, sobrecarga e incógnita se distinguen sin insertar relé', () => {
	const do24 = { tensionV: 24, sistema: 'DC', tipoSalida: 'PNP', corrienteMaxA: 0.1 } as const;
	const compatible = evaluar(proyectoDo(do24, { tensionNominalV: 24, sistema: 'DC', corrienteA: 0.08 }));
	assert.equal(compatible.resultados.find((x) => x.code === 'TS-IO-DO-COIL')?.status, 'PASS');
	const sobrecarga = evaluar(proyectoDo(do24, { tensionNominalV: 24, sistema: 'DC', corrienteA: 0.18 }));
	const issue = sobrecarga.resultados.find((x) => x.code === 'TS-IO-DO-COIL')!;
	assert.equal(issue.status, 'FAIL'); assert.match(issue.remediationHints.join(' '), /relé intermedio/i);
	const desconocida = evaluar(proyectoDo(do24, { tensionNominalV: 24, sistema: 'DC' }));
	assert.equal(desconocida.resultados.find((x) => x.code === 'TS-IO-DO-COIL')?.status, 'INDETERMINATE');
	assert.match(desconocida.resultados.find((x) => x.code === 'TS-IO-DO-COIL')!.missingData.join(' '), /corriente de bobina/i);
	const acEnDc = evaluar(proyectoDo(do24, { tensionNominalV: 24, sistema: 'AC', frecuenciaHz: 50, corrienteA: 0.05 }));
	assert.equal(acEnDc.resultados.find((x) => x.code === 'TS-IO-DO-COIL')?.status, 'FAIL');
});

test('Gate F: metadatos eléctricos DO/bobina sobreviven carga y un componente explícito no depende de su tipo o imagen', () => {
	const p = proyectoDo({ tensionV: 24, sistema: 'DC', tipoSalida: 'RELE', corrienteMaxA: 0.2 },
		{ tensionNominalV: 24, sistema: 'DC', corrienteA: 0.05 });
	const q = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.equal(evaluar(q).resultados.find((x) => x.code === 'TS-IO-DO-COIL')?.status, 'PASS');
	const plc = q.dispositivos.find((d) => d.id === 'plc')!.comportamiento!;
	const km = q.dispositivos.find((d) => d.id === 'km')!.comportamiento!;
	assert.equal(plc.clase === 'controlador' ? plc.salidasDigitales[0]?.electrica?.corrienteMaxA : undefined, 0.2);
	assert.equal(km.clase === 'contactos-electromagneticos' ? km.bobina.electrica?.corrienteA : undefined, 0.05);
});

function proyectoTension(tensionFuente = 400, tensionCarga = 230): Proyecto {
	const p = crearProyecto('Tensión incompatible');
	p.dispositivos = [
		{ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }], fisica: { version: 1,
			fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: tensionFuente, frecuenciaHz: 50, referencia: 'N', fases: [{ borne: 'L', fase: 'L' }] } } },
		{ id: 'z', tipo: 'resistencia', tensionNominal: tensionCarga, bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
			comportamiento: { version: 1, clase: 'carga', efecto: 'calor', alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 } },
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 100 } } },
	];
	p.conductores = [cable('wl', ['red', 'L'], ['z', 'L']), cable('wn', ['z', 'N'], ['red', 'N'])]; return p;
}

test('Gate F: tensión/frecuencia nominal explícita detecta incompatibilidad real', () => {
	const r = evaluar(proyectoTension());
	assert.equal(r.resultados.find((x) => x.code === 'TS-EQUIPMENT-SUPPLY')?.status, 'FAIL');
	assert.equal(evaluar(proyectoTension(230, 230)).resultados.find((x) => x.code === 'TS-EQUIPMENT-SUPPLY')?.status, 'PASS');
});

test('Gate F: placa V6 se eleva y VFD/motor compara potencia, corriente, tensión y frecuencia', () => {
	const sano = fixtureVfdMotorV6();
	const ok = evaluar(sano);
	assert.equal(ok.resultados.find((x) => x.code === 'TS-VFD-MOTOR-COMPATIBILITY')?.status, 'PASS');
	const malo = structuredClone(sano); malo.dispositivos.find((d) => d.id === 'vfd')!.fisica!.vfd!.potenciaNominalW = 2000;
	assert.equal(evaluar(malo).resultados.find((x) => x.code === 'TS-VFD-MOTOR-COMPATIBILITY')?.status, 'FAIL');
	const placa = structuredClone(sano); placa.dispositivos.find((d) => d.id === 'm1')!.fisica!.motor!.rpmNominal = 800;
	assert.ok(evaluar(placa).resultados.some((x) => x.code === 'TS-MOTOR-RPM_INCOMPATIBLE_CON_FRECUENCIA'));
});

function proyectoAnalogico(unidadSalida: 'mA' | 'V', unidadEntrada: 'mA' | 'V', conFisica = true): Proyecto {
	const p = crearProyecto('Compatibilidad analógica');
	const rangoSalida: [number, number] = unidadSalida === 'mA' ? [4, 20] : [0, 10];
	const rangoEntrada: [number, number] = unidadEntrada === 'mA' ? [4, 20] : [0, 10];
	p.dispositivos = [
		{ id: 'tx', tipo: 'sensor', bornes: [{ id: '+24', tipo: 'control' }, { id: 'OUT', tipo: 'senal' }, { id: 'COM', tipo: 'control' }],
			comportamiento: { version: 1, clase: 'sensor', contactos: [], alimentacion: { entrada: '+24', retorno: 'COM' },
				transmisor: { modoConexion: '3-hilos', modoSalida: 'activa',
				salida: { borne: 'OUT', comun: 'COM', unidad: unidadSalida, rango: rangoSalida },
				variable: { magnitud: 'presion', unidad: 'bar', minimo: 0, maximo: 10 } } },
			fisica: conFisica ? { version: 1, analogica: unidadSalida === 'mA'
				? { tensionComplianceV: 12, tensionMinimaTransmisorV: 10 } : { resistenciaSalidaOhm: 100 } } : undefined },
		{ id: 'plc', tipo: 'plc', bornes: [{ id: 'AI1', tipo: 'senal' }, { id: 'AIC', tipo: 'control' }, { id: '+24', tipo: 'control' }, { id: '0V', tipo: 'control' }],
			comportamiento: { version: 1, clase: 'controlador', alimentacion: { entradas: ['+24'], retornos: ['0V'] }, salidasDigitales: [],
				entradasAnalogicas: [{ borne: 'AI1', comun: 'AIC', unidad: unidadEntrada, rango: rangoEntrada, modoEntrada: 'pasiva',
					variable: { magnitud: 'presion', unidad: 'bar', minimo: 0, maximo: 10 } }], salidasAnalogicas: [] },
			fisica: conFisica ? { version: 1, analogica: { burdenOhm: unidadEntrada === 'mA' ? 500 : 1000 } } : undefined },
	];
	p.conductores = [cable('ws', ['tx', 'OUT'], ['plc', 'AI1']), cable('wc', ['tx', 'COM'], ['plc', 'AIC'])]; return p;
}

test('Gate F: 4–20/0–10 incompatibles y compliance insuficiente producen evidencia distinta', () => {
	const mismatch = evaluar(proyectoAnalogico('mA', 'V'));
	assert.equal(mismatch.resultados.find((x) => x.code === 'TS-ANALOG-COMPATIBILITY')?.status, 'FAIL');
	const mismatchInverso = evaluar(proyectoAnalogico('V', 'mA'));
	assert.equal(mismatchInverso.resultados.find((x) => x.code === 'TS-ANALOG-COMPATIBILITY')?.status, 'FAIL');
	const compliance = evaluar(proyectoAnalogico('mA', 'mA'));
	const issue = compliance.resultados.find((x) => x.code === 'TS-ANALOG-COMPATIBILITY')!;
	assert.equal(issue.status, 'FAIL'); assert.equal(issue.evidence.find((x) => x.codigo === 'LOOP_QUALITY')?.valor, 'COMPLIANCE_INSUFICIENTE');
	const sinDatos = evaluar(proyectoAnalogico('mA', 'mA', false));
	assert.equal(sinDatos.resultados.find((x) => x.code === 'TS-ANALOG-COMPATIBILITY')?.status, 'INDETERMINATE');
});

test('Gate F: PE eleva R11 existente y no inventa una certificación de puesta a tierra', () => {
	const p = crearProyecto('PE');
	p.dispositivos = [{ id: 'm', tipo: 'motor', bornes: [{ id: 'PE', tipo: 'PE' }] }];
	assert.equal(evaluar(p).resultados.find((x) => x.code === 'TS-PE-DISCONNECTED')?.status, 'FAIL');
	p.dispositivos.push({ id: 'xpe', tipo: 'bornero', bornes: [{ id: 'PE', tipo: 'PE' }] });
	p.conductores = [cable('wpe', ['m', 'PE'], ['xpe', 'PE'])];
	const flotante = evaluar(p);
	assert.ok(flotante.resultados.some((x) => x.code === 'TS-PE-REFERENCE-MISSING' && x.status === 'INDETERMINATE'));
	p.dispositivos.push({ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'PE', tipo: 'PE' }],
		fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, referencia: 'N', referenciaPe: 'PE',
			fases: [{ borne: 'L', fase: 'L' }] } } });
	p.conductores.push(cable('wpe-red', ['xpe', 'PE'], ['red', 'PE']));
	const referenciado = evaluar(p);
	assert.ok(referenciado.resultados.filter((x) => x.code === 'TS-PE-PATH').every((x) => x.status === 'PASS'));
});

test('Gate F: invertir dispositivos y conductores conserva compatibilidades', () => {
	const p = proyectoDo({ tensionV: 24, sistema: 'DC', tipoSalida: 'PNP', corrienteMaxA: 0.1 },
		{ tensionNominalV: 24, sistema: 'DC', corrienteA: 0.08 });
	const a = evaluar(p).resultados.map(({ code, status, relatedEntities }) => ({ code, status, relatedEntities }));
	const q = structuredClone(p); q.dispositivos.reverse(); q.conductores.reverse();
	const b = evaluar(q).resultados.map(({ code, status, relatedEntities }) => ({ code, status, relatedEntities }));
	assert.deepEqual(a, b);
});
