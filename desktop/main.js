/**
 * Ventana de escritorio de TableroStudio (Electron).
 *
 * Carga el HTML autocontenido (app.html) en una ventana nativa; funciona 100 % offline.
 *
 * SEGUNDA AUDITORÍA, TS2-P1-12. Aquí solo se declaraba `contextIsolation: true`. Eso está bien y
 * Electron activa el sandbox por su cuenta desde la 20, así que Node NO estaba expuesto —conviene
 * decirlo, porque la primera auditoría afirmaba lo contrario—. Pero faltaban las demás defensas de
 * la lista oficial, y con un programa que abre archivos de proyecto que llegan por correo eso
 * importa: si algo consigue meter marcado en el renderer, sin `will-navigate` puede sacar la
 * ventana a una URL de fuera, y sin `setWindowOpenHandler` puede abrir otra.
 *
 * Lo que se hace y por qué:
 *  - `nodeIntegration: false` y `sandbox: true` DECLARADOS, aunque sean el valor por defecto: el
 *    día que alguien añada un `preload` para algo, el valor por defecto puede no ser el que cree.
 *  - Navegar fuera del archivo local: prohibido. Esta aplicación no tiene adónde ir.
 *  - Ventanas nuevas: denegadas. Un enlace externo se abre en el navegador del sistema, que es
 *    donde el usuario puede ver a dónde va.
 *  - La CSP viaja DENTRO de app.html, con el hash del propio bundle: la calcula `empaquetar.mjs`,
 *    así que vale igual abriendo el HTML suelto que dentro de esta ventana.
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function crearVentana() {
	const ventana = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1000,
		minHeight: 640,
		backgroundColor: '#14171a',
		title: 'TableroStudio',
		icon: path.join(__dirname, 'icono.png'),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webviewTag: false,
		},
	});

	// Esta aplicación no navega a ninguna parte: lo único que carga es su propio archivo.
	ventana.webContents.on('will-navigate', (ev, url) => {
		if (url !== ventana.webContents.getURL()) ev.preventDefault();
	});
	// Y no abre ventanas. Un enlace de verdad va al navegador del sistema, donde se ve a dónde va.
	ventana.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url)) void shell.openExternal(url);
		return { action: 'deny' };
	});
	// Nada de adjuntar un `webContents` nuevo por su cuenta.
	ventana.webContents.on('will-attach-webview', (ev) => ev.preventDefault());
	// Menú mínimo (permite recargar y salir; oculta el menú por defecto de Electron).
	Menu.setApplicationMenu(Menu.buildFromTemplate([
		{ label: 'Archivo', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'quit', label: 'Salir' }] },
		{ label: 'Ver', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
	]));
	ventana.loadFile(path.join(__dirname, 'app.html'));
}

app.whenReady().then(crearVentana);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) crearVentana(); });
