const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printbridge', {
  obtenerEstado: () => ipcRenderer.invoke('config:estado'),
  listarImpresorasDisponibles: () => ipcRenderer.invoke('config:impresoras-disponibles'),
  guardarImpresora: (datos) => ipcRenderer.invoke('config:guardar-impresora', datos),
  eliminarImpresora: (alias) => ipcRenderer.invoke('config:eliminar-impresora', alias),
  abrirCarpetaDatos: () => ipcRenderer.invoke('config:abrir-carpeta-datos'),
  guardarPlataforma: (datos) => ipcRenderer.invoke('config:guardar-plataforma', datos)
});
