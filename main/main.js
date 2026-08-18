const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const AutoLaunch = require('auto-launch');

const { inicializarRutas: inicializarRutasIdentidad, inicializarConfig } = require('./setup/generar-identidad');
const { leerConfigLocal, actualizarImpresora, eliminarImpresora } = require('./config');
const { listarImpresorasSistema } = require('./printers/discovery');
const { inicializarRutas: inicializarRutasQueue, iniciarProcesamiento } = require('./queue');
const { iniciarHeartbeat, obtenerUltimoEstado } = require('./heartbeat');
const { iniciarServidorImpresion } = require('./server');

let mainWindow = null;
let tray = null;
let cerrandoDeVerdad = false;

// IMPORTANTE: desactiva la aceleracion por hardware (GPU) para toda la app.
// Esto es necesario porque en algunas configuraciones de Windows (drivers
// de video, maquinas virtuales, escritorio remoto), Chromium no logra
// componer correctamente el contenido de una ventana oculta, y
// webContents.capturePage() se queda colgado indefinidamente al intentar
// renderizar HTML a bitmap. Forzar renderizado por software es mas lento
// pero mucho mas confiable para este tipo de captura silenciosa.
// Debe llamarse ANTES de app.whenReady().
app.disableHardwareAcceleration();

// Evita que se abran dos instancias del agente en el mismo equipo (dos
// procesos escuchando el mismo puerto causarian conflictos).
const bloqueoInstanciaUnica = app.requestSingleInstanceLock();
if (!bloqueoInstanciaUnica) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function crearVentana() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // Minimizar a la bandeja en vez de cerrar: el agente debe seguir corriendo
  // en segundo plano aunque el usuario cierre la ventana con la X.
  mainWindow.on('close', (evento) => {
    if (!cerrandoDeVerdad) {
      evento.preventDefault();
      mainWindow.hide();
    }
  });
}

function crearTray() {
  const icono = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray = new Tray(icono.isEmpty() ? nativeImage.createEmpty() : icono);
  tray.setToolTip('PrintBridge Agent');

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir configuracion', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        cerrandoDeVerdad = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow && mainWindow.show());
}

async function configurarArranqueAutomatico() {
  const autoLauncher = new AutoLaunch({ name: 'PrintBridge Agent' });
  const habilitado = await autoLauncher.isEnabled();
  if (!habilitado) {
    await autoLauncher.enable();
  }
}

// ---------- IPC: la ventana de configuracion habla con el backend por aqui ----------

function registrarIpc() {
  ipcMain.handle('config:estado', () => {
    const cfg = leerConfigLocal();
    return {
      instalacion_id: cfg.instalacion_id,
      cliente_codigo: cfg.cliente_codigo,
      version: cfg.version_agente,
      token: cfg.token,
      puerto_ws: cfg.puerto_ws,
      impresoras: cfg.printers || {},
      heartbeat: obtenerUltimoEstado()
    };
  });

  ipcMain.handle('config:impresoras-disponibles', () => listarImpresorasSistema());

  ipcMain.handle('config:guardar-impresora', (evento, datos) => {
    const { alias, tipo, nombre_sistema, ip, puerto, formato_default } = datos;
    if (!alias || !tipo) throw new Error('alias y tipo son requeridos');

    const impresora = { tipo, formato_default: formato_default || 'raw' };
    if (tipo === 'red') {
      impresora.ip = ip;
      impresora.puerto = puerto || 9100;
    } else {
      impresora.nombre_sistema = nombre_sistema;
    }
    const cfg = actualizarImpresora(alias, impresora);
    return cfg.printers;
  });

  ipcMain.handle('config:eliminar-impresora', (evento, alias) => {
    const cfg = eliminarImpresora(alias);
    return cfg.printers;
  });

  ipcMain.handle('config:abrir-carpeta-datos', () => {
    shell.openPath(app.getPath('userData'));
  });
}

// ---------- Ciclo de vida de la app ----------

app.whenReady().then(async () => {
  // Rutas de datos persistentes (config, cola) dentro de userData,
  // asi sobreviven a actualizaciones de la app.
  const userDataPath = app.getPath('userData');
  inicializarRutasIdentidad(userDataPath);
  inicializarRutasQueue(userDataPath);
  inicializarConfig();

  registrarIpc();
  crearVentana();
  crearTray();

  iniciarServidorImpresion();
  iniciarProcesamiento();
  iniciarHeartbeat();

  try {
    await configurarArranqueAutomatico();
  } catch (err) {
    console.warn('[main] No se pudo configurar arranque automatico:', err.message);
  }
});

app.on('window-all-closed', (evento) => {
  // En Windows/Linux, no cerramos la app al cerrar la ventana: debe
  // seguir viva en la bandeja del sistema para seguir imprimiendo.
  evento.preventDefault();
});
