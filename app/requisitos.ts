/**
 * LO QUE EL PROGRAMA NECESITA DEL NAVEGADOR, comprobado ANTES de intentar usarlo.
 *
 * TableroStudio dibuja el tablero en 3D, y para eso hace falta WebGL. Si el navegador no lo da
 * —un equipo viejo, la aceleración por hardware desactivada, un navegador muy antiguo— lo que
 * pasaba era lo peor posible: se pulsaba «Trabajo de tableros» y NO PASABA NADA. El error se
 * quedaba en la consola, que nadie mira, y quien lo estrenaba se quedaba con que el programa
 * estaba roto y no con que le faltaba algo a su navegador.
 *
 * Así que se comprueba antes y se dice. Un programa que no puede funcionar tiene la obligación de
 * explicar por qué, y de decir qué hacer para arreglarlo.
 */

/** ¿Puede este navegador dibujar en 3D? */
export function hayWebGL(): boolean {
	try {
		const lienzo = document.createElement('canvas');
		const ctx = lienzo.getContext('webgl2') ?? lienzo.getContext('webgl');
		if (!ctx) return false;
		// Algunos navegadores devuelven un contexto que no sirve para nada: se comprueba que de
		// verdad responda antes de darlo por bueno.
		return typeof (ctx as WebGLRenderingContext).getParameter === 'function';
	} catch {
		return false;
	}
}

/** ¿Se pueden guardar archivos (dossier, DXF, proyecto)? */
export function hayDescargas(): boolean {
	return typeof Blob === 'function' && typeof URL?.createObjectURL === 'function';
}

/** Lo que falta, en lenguaje de quien lo va a leer. Vacío si no falta nada. */
export function loQueFalta(): string[] {
	const falta: string[] = [];
	if (!hayWebGL()) falta.push('dibujar en 3D (WebGL)');
	if (!hayDescargas()) falta.push('guardar archivos');
	return falta;
}

/**
 * Si falta algo, tapa la pantalla con la explicación y devuelve true.
 *
 * Se escribe a mano sobre el documento y sin depender de nada del programa: justamente se llama
 * cuando el programa no va a poder arrancar, así que no puede apoyarse en él.
 */
export function avisarSiNoSePuede(): boolean {
    const falta = loQueFalta();
	if (falta.length === 0) return false;

	const caja = document.createElement('div');
	caja.id = 'no-se-puede';
	caja.setAttribute('style', [
		'position:fixed', 'inset:0', 'z-index:9999', 'display:flex', 'align-items:center',
		'justify-content:center', 'background:#0b0e12', 'color:#e6e9ee', 'padding:24px',
		'font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
	].join(';'));
	caja.innerHTML = `<div style="max-width:44rem">
		<h1 style="font-size:22px;margin:0 0 14px">Este navegador no puede abrir TableroStudio</h1>
		<p style="margin:0 0 12px;color:#aab3bf">Le falta: <strong style="color:#e6e9ee">${falta.join(' y ')}</strong>.</p>
		<p style="margin:0 0 12px">El programa dibuja el tablero en 3D, y para eso el navegador tiene que
			poder usar la tarjeta gráfica. Casi siempre se arregla con una de estas dos cosas:</p>
		<ol style="margin:0 0 16px;padding-left:20px;color:#c8d0da">
			<li style="margin-bottom:6px"><strong>Ábrelo con Google&nbsp;Chrome o Microsoft&nbsp;Edge.</strong>
				Son con los que está probado.</li>
			<li><strong>Enciende la aceleración por hardware</strong> en los ajustes del navegador
				(en Chrome y Edge: Configuración → Sistema → «Usar aceleración por hardware cuando esté disponible»),
				y vuelve a abrirlo.</li>
		</ol>
		<p style="margin:0;color:#7f8896;font-size:13px">Si aun así no arranca, es que el equipo no tiene
			gráficos suficientes para el 3D. No es culpa del archivo: se abre bien en cualquier equipo
			normal de oficina.</p>
	</div>`;
	document.body.appendChild(caja);
	return true;
}
