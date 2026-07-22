// Ventana de escritorio de TableroStudio (Electron).
// Carga el HTML autocontenido (app.html) en una ventana nativa; funciona 100% offline.
const { app, BrowserWindow, Menu } = require('electron');
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
		webPreferences: { contextIsolation: true },
	});
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
