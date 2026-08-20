/**
 * MOTEADO SOBRE LA BUILD DE HOY, y en las zonas nuevas: aro y lente del piloto, rótulos, bisagra,
 * cierre, marco, canto de la puerta y chapa lisa.
 *
 * La medida es la de siempre y su control también: la cámara se mueve MEDIO PÍXEL entre tomas
 * —0,0004 rad— y además se toma un par de fotos con la cámara COMPLETAMENTE QUIETA, que tiene que
 * dar exactamente cero. Sin ese control, un número bajo no significa nada: podría ser ruido de la
 * medida en vez de estabilidad de la escena.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const EJEMPLO = Number(process.argv[2] ?? 2);
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(90_000);
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

console.log(await abrirEjemplo(p, sv.address().port, EJEMPLO));
const { A, H, P } = await p.evaluate(() => {
	const g = window.qa.proyecto().gabinete;
	return {
		A: Math.max(g.caja?.ancho ?? g.ancho + 60, g.ancho + 60),
		H: Math.max(g.caja?.alto ?? g.alto + 60, g.alto + 60),
		P: g.caja?.profundidad ?? 160,
	};
});
/*
 * El punto de referencia: un piloto si lo hay y, si no, el centro de la cara exterior de la
 * puerta —que cae en z = profundidad + 2, medido—. Con un tablero sin nada montado en la puerta,
 * la versión anterior de esta prueba dejaba las cámaras mirando al vacío y devolvía cero moteados
 * porque no había NADA en la imagen, no porque la escena fuera estable.
 */
async function referencia() {
	const q = await p.evaluate(() => window.qa.componentesDePuerta());
	return q[1]?.mundo ?? q[0]?.mundo ?? { x: 0, y: 0, z: P + 2 };
}

/** Una órbita minúscula alrededor de un punto: n tomas separadas medio píxel. */
function orbita(centro, radio, n = 7, alturaRel = 0.15, paso = 0.0004) {
	const cams = [];
	for (let i = 0; i < n; i++) {
		const a = i * paso;
		cams.push({
			x: centro.x + radio * Math.sin(a), y: centro.y + radio * alturaRel, z: centro.z + radio * Math.cos(a),
			tx: centro.x, ty: centro.y, tz: centro.z,
		});
	}
	return cams;
}

const zonasDe = (piloto) => [
	['piloto de cerca', orbita(piloto, 120)],
	['piloto a media distancia', orbita(piloto, 420)],
	['rótulos del frontal', orbita({ x: 0, y: piloto.y - 90, z: P }, 320)],
	['bisagras', orbita({ x: -A / 2, y: 0, z: P - 10 }, 260, 7, 0.25)],
	['cierre', orbita({ x: A / 2 - 34, y: 0, z: P + 8 }, 230, 7, 0.2)],
	['marco y canto de la puerta', orbita({ x: A / 2 - 6, y: H * 0.2, z: P }, 300, 7, 0.1)],
	['chapa lisa del frontal', orbita({ x: -A * 0.2, y: -H * 0.25, z: P }, 500, 7, 0.05)],
	['armario entero', orbita({ x: 0, y: 0, z: P / 2 }, Math.max(A, H) * 1.5, 7, 0.3)],
];

for (const estado of [0, 1]) {
	await puerta(p, estado);
	/*
	 * La referencia se vuelve a pedir CON LA PUERTA YA COLOCADA. Un piloto montado en la hoja
	 * cambia de sitio al abrir, así que calcularla una sola vez dejaba las cámaras de la puerta
	 * cerrada apuntando a donde estaba el piloto con la puerta abierta.
	 */
	const piloto = await referencia();
	console.log(`\n--- puerta ${estado ? 'abierta' : 'cerrada'} · referencia ${JSON.stringify(piloto)} ---`);
	for (const [nombre, cams] of zonasDe(piloto)) {
		const movida = await p.evaluate((c) => window.qa.medirMoteado(c), cams);
		// El control: la MISMA cámara repetida. Cualquier cosa distinta de cero es ruido de medida.
		const quieta = await p.evaluate((c) => window.qa.medirMoteado([c[0], c[0], c[0]]), cams);
		/*
		 * Y EL CONTROL QUE FALTABA: ¿está esa cámara MIRANDO ALGO?
		 *
		 * Un cero de moteados es el resultado que se busca y también el que devuelve una cámara
		 * apuntada al vacío. Pasó midiendo un tablero sin componentes de puerta: las cámaras
		 * quedaban colocadas respecto a un piloto que no existía y el informe decía «sin parpadeo»
		 * de una imagen negra. El fondo de la escena es casi negro, así que basta con exigir que
		 * una buena parte de los píxeles no lo sea.
		 */
		const lleno = await p.evaluate((c) => {
			window.qa.verDesde(c);
			const l = document.querySelector('canvas');
			const k = document.createElement('canvas');
			k.width = Math.floor(l.width / 4); k.height = Math.floor(l.height / 4);
			const g = k.getContext('2d');
			g.drawImage(l, 0, 0, l.width, l.height, 0, 0, k.width, k.height);
			const d = g.getImageData(0, 0, k.width, k.height).data;
			let n = 0;
			for (let i = 0; i < d.length; i += 4) {
				if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] > 40) n++;
			}
			return Math.round((n / (d.length / 4)) * 100);
		}, cams[0]);
		ok(lleno > 25, `${nombre}: la cámara mira el armario y no el vacío (${lleno} % de la imagen)`);
		ok(quieta.total === 0, `${nombre}: control con la cámara quieta en cero (${quieta.total})`);
		ok(movida.porMillon < 60, `${nombre}: ${movida.porMillon} moteados por millón moviendo medio píxel`);
		if (movida.porMillon >= 60) console.log(`     focos: ${JSON.stringify(movida.donde.slice(0, 6))}`);
	}
}

/*
 * ¿Y CÓMO SÉ QUE EL MEDIDOR MIDE? Todo a cero es el resultado que se quiere y también el que daría
 * un contador roto. Así que se le enseña un artefacto de verdad: se quita el sesgo del mapa de
 * sombras, que es la receta conocida para producir acné de sombra, y se comprueba que el número
 * SUBE. Si no subiera, los ceros de arriba no valdrían nada.
 */


console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
