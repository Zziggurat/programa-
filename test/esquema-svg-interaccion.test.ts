import assert from 'node:assert/strict';
import test from 'node:test';
import { hojaASvg } from '../app/esquema-svg.js';
import { HojaEsq } from '../src/motores/esquema.js';

const hoja: HojaEsq = {
	id: 'esq1', numero: 1, titulo: 'Mando', anchoMm: 420, altoMm: 297, columnas: 10,
	simbolos: [], referencias: [],
	hilos: [{ conductorId: 'c1', nodos: [{ x: 50, y: 100 }, { x: 50, y: 140 }] }],
};

test('la vista interactiva conserva un solo ID de conductor y añade un agarre ancho', () => {
	const svg = hojaASvg(hoja, { interactivo: true, resaltadoConductor: 'c1' });
	assert.equal(svg.match(/data-conductor="c1"/g)?.length, 1);
	assert.match(svg, /<g data-conductor="c1" class="hilo" tabindex="0" role="button"/);
	assert.match(svg, /class="hilo-agarre"[^>]*stroke-width="4\.5" pointer-events="stroke"/);
	assert.match(svg, /stroke="#2ea3ff" stroke-width="1\.2"/);
});

test('el SVG exportado es vectorial limpio, sin agarres ni selección de edición', () => {
	const svg = hojaASvg(hoja);
	assert.match(svg, /data-conductor="c1"/);
	assert.doesNotMatch(svg, /hilo-agarre|tabindex="0"|role="button"|#2ea3ff/);
});

test('el ID hostil del conductor se escapa dentro de atributos SVG', () => {
	const conIdHostil: HojaEsq = {
		...hoja,
		hilos: [{ ...hoja.hilos[0], conductorId: 'c<&" onload="mal' }],
	};
	const svg = hojaASvg(conIdHostil, { interactivo: true });
	assert.match(svg, /data-conductor="c&lt;&amp;&quot; onload=&quot;mal"/);
	assert.doesNotMatch(svg, /data-conductor="c<&"/);
});

test('dos vistas del mismo aparato tienen IDs gráficos propios y solo una marca seleccionada', () => {
	const conVistas: HojaEsq = { ...hoja, hilos: [], simbolos: [
		{ dispositivoId: 'km1', representacionId: 'bobina', parte: 'bobina', designacion: '-KM1',
			columna: 2, x: 60, y: 80, ancho: 12, alto: 20, trazos: [], pines: new Map() },
		{ dispositivoId: 'km1', representacionId: 'aux', parte: 'contactos', designacion: '-KM1',
			columna: 5, x: 170, y: 80, ancho: 12, alto: 20, trazos: [], pines: new Map() },
	] };
	const svg = hojaASvg(conVistas, { interactivo: true, resaltado: 'km1', resaltadoRepresentacion: 'aux' });
	assert.equal(svg.match(/data-dispositivo="km1"/g)?.length, 2);
	assert.match(svg, /data-representacion="bobina" class="simbolo" tabindex="0" role="button"/);
	assert.match(svg, /data-representacion="aux" class="simbolo" tabindex="0" role="button"/);
	assert.equal(svg.match(/stroke="#f5a623"/g)?.length, 1);
	assert.equal(svg.match(/stroke="#2ea3ff"/g)?.length, 1);
	const exportado = hojaASvg(conVistas);
	assert.doesNotMatch(exportado, /tabindex="0"|role="button"|#f5a623/);
});

test('ID hostil de vista y referencia cruzada se escapan en SVG', () => {
	const conVista: HojaEsq = { ...hoja, hilos: [], simbolos: [
		{ dispositivoId: 'km1', representacionId: 'vista<&" onclick="mal', designacion: '-KM1',
			columna: 2, x: 60, y: 80, ancho: 12, alto: 20, trazos: [], pines: new Map() },
	], referencias: [{ tipo: 'bobina', texto: 'bobina <&"', p: { x: 60, y: 120 } }] };
	const svg = hojaASvg(conVista, { interactivo: true });
	assert.match(svg, /data-representacion="vista&lt;&amp;&quot; onclick=&quot;mal"/);
	assert.doesNotMatch(svg, /data-representacion="vista<&"/);
	assert.match(svg, /bobina &lt;&amp;&quot;/);
});

test('solo la vista M2 interactiva expone bornes reales como objetivos de conexión', () => {
	const conBorne: HojaEsq = { ...hoja, hilos: [], simbolos: [
		{ dispositivoId: 'xp', representacionId: 'xp-vista', designacion: '-XP',
			columna: 2, x: 60, y: 80, ancho: 12, alto: 20, trazos: [],
			pines: new Map([['X<&"', { x: 60, y: 90 }]]) },
	] };
	const svg = hojaASvg(conBorne, { interactivo: true, bornesInteractivos: true,
		resaltadoBorne: { dispositivoId: 'xp', borneId: 'X<&"' } });
	assert.match(svg, /class="borne-esq" data-dispositivo="xp" data-borne="X&lt;&amp;&quot;"/);
	assert.match(svg, /aria-label="Cancelar origen borne X&lt;&amp;&quot; de -XP"/);
	assert.match(svg, /stroke="#f5a623" stroke-width="1"/);
	assert.doesNotMatch(hojaASvg(conBorne, { interactivo: true }), /class="borne-esq"/,
		'el esquema legacy no ofrece conexión por pin');
	assert.doesNotMatch(hojaASvg(conBorne), /class="borne-esq"|tabindex="0"/,
		'el SVG exportado no lleva zonas de clic');
});

test('referencia entre hojas seleccionable conserva el ID eléctrico y exporta texto limpio', () => {
	const conEnlace: HojaEsq = { ...hoja, hilos: [], referencias: [
		{ tipo: 'enlace', conductorId: 'c<&"', texto: '→ /2.3', p: { x: 90, y: 110 } },
	] };
	const svg = hojaASvg(conEnlace, { interactivo: true, resaltadoConductor: 'c<&"' });
	assert.match(svg, /class="referencia-conductor" data-conductor="c&lt;&amp;&quot;" tabindex="0" role="button"/);
	assert.match(svg, /Seleccionar conductor c&lt;&amp;&quot;, referencia a otra hoja/);
	assert.match(svg, /fill="#2ea3ff"/);
	const exportado = hojaASvg(conEnlace);
	assert.doesNotMatch(exportado, /referencia-conductor|tabindex="0"|role="button"/);
	assert.match(exportado, /→ \/2\.3/);
});
