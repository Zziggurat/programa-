import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { aplicarGiroRepresentacion, previsualizarGiroRepresentacion } from '../src/motores/girar-representacion-esquema.js';

function fixture(): Proyecto {
	const p = crearProyecto('Giro M2');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Control' }];
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'ps', x: 30, y: 40, ancho: 35, alto: 30 },
	] };
	p.dispositivos = [{ id: 'ps', tipo: 'fuente', bornes: [{ id: '+24' }, { id: '0V' }] }];
	p.conductores = [];
	p.esquema = { representaciones: [{ id: 'r1', dispositivoId: 'ps', hojaId: 'h1',
		posicion: { columna: 3, fila: 4 }, parte: { tipo: 'completa' } }] };
	return p;
}
const simbolo = (p: Proyecto) => montarEsquema(p, calcularPotenciales(p))[0].simbolos[0];

test('ESQ-05: 180° invierte los anclajes y trazos alrededor del centro sin girar el texto', () => {
	const p = fixture(), base = simbolo(p), antes = JSON.stringify(p);
	const plan = previsualizarGiroRepresentacion(p, 'r1');
	assert.equal(plan.ok, true);
	assert.equal(JSON.stringify(p), antes, 'preview no modifica Proyecto');
	assert.equal(aplicarGiroRepresentacion(p, plan), true);
	const girado = simbolo(p);
	assert.deepEqual([girado.x, girado.y, girado.ancho, girado.alto],
		[base.x, base.y, base.ancho, base.alto]);
	for (const [id, pin] of base.pines) {
		const invertido = girado.pines.get(id)!;
		assert.ok(Math.abs(invertido.x - (2 * (base.x + base.ancho / 2) - pin.x)) < 1e-9);
		assert.ok(Math.abs(invertido.y - (2 * (base.y + base.alto / 2) - pin.y)) < 1e-9);
	}
	assert.equal(p.dispositivos.length, 1);
	assert.deepEqual(p.conductores, []);
	assert.equal(p.esquema?.representaciones?.[0].giro, 180);
	assert.equal(aplicarGiroRepresentacion(p, plan), false, 'el plan es de uso único');
	assert.equal(aplicarGiroRepresentacion(p, previsualizarGiroRepresentacion(p, 'r1')), true);
	assert.equal(p.esquema?.representaciones?.[0].giro, undefined, 'deshacer el giro omite el campo histórico');
	assert.deepEqual(simbolo(p).pines, base.pines);
});

test('ESQ-05: giro persiste al cargar; orientación desconocida se diagnostica', () => {
	const p = fixture();
	assert.equal(aplicarGiroRepresentacion(p, previsualizarGiroRepresentacion(p, 'r1')), true);
	const reabierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(reabierto.diagnosticos, []);
	assert.equal(reabierto.proyecto.esquema?.representaciones?.[0].giro, 180);
	assert.deepEqual(simbolo(reabierto.proyecto).pines, simbolo(p).pines);
	const futuro = fixture();
	(futuro.esquema!.representaciones![0] as { giro?: number }).giro = 90;
	const rechazado = cargarProyecto(JSON.stringify(futuro));
	assert.ok(rechazado.diagnosticos.some((d) => /giro.*180/.test(d.motivo)));
	assert.equal(rechazado.proyecto.esquema?.representaciones?.length, 0,
		'no se adopta en silencio una geometría distinta de la solicitada');
});

test('ESQ-05: plan obsoleto, fabricado o ajeno no gira el documento', () => {
	const p = fixture();
	const plan = previsualizarGiroRepresentacion(p, 'r1');
	const otro = fixture();
	assert.equal(aplicarGiroRepresentacion(otro, plan), false);
	assert.equal(aplicarGiroRepresentacion(p, { ok: true, vistaId: 'r1', giroNuevo: 180 }), false);
	p.esquema!.representaciones![0].posicion.fila++;
	assert.equal(aplicarGiroRepresentacion(p, plan), false);
	assert.equal(p.esquema?.representaciones?.[0].giro, undefined);
	assert.equal(previsualizarGiroRepresentacion({ ...p, esEjemplo: true }, 'r1').ok, false);
	const vigente = previsualizarGiroRepresentacion(p, 'r1');
	p.esEjemplo = true;
	assert.equal(aplicarGiroRepresentacion(p, vigente), false, 'no aplica sobre un documento vuelto de solo lectura');
});
