const net = require('net');
const { execFile } = require('child_process');
const { rutaScript } = require('./enviar');

/**
 * Ejecuta list-printers.ps1 (Get-CimInstance Win32_Printer) y devuelve
 * el listado de impresoras del sistema. No depende de ningun modulo
 * nativo de Node, solo de PowerShell (incluido en Windows).
 */
function listarImpresorasSistema() {
  return new Promise((resolve) => {
    const script = rutaScript('list-printers.ps1');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) {
          console.error('[discovery] Error listando impresoras:', err.message);
          return resolve([]);
        }
        try {
          let datos = JSON.parse(stdout || '[]');
          if (!Array.isArray(datos)) datos = [datos]; // PowerShell devuelve objeto suelto si hay 1 sola impresora
          resolve(
            datos.map((p) => ({
              nombre: p.Name,
              estado: p.WorkOffline ? 'offline' : 'ok',
              predeterminada: !!p.Default
            }))
          );
        } catch (parseErr) {
          console.error('[discovery] Respuesta de PowerShell no es JSON valido:', parseErr.message);
          resolve([]);
        }
      }
    );
  });
}

/**
 * Prueba una conexion TCP corta contra una impresora de red (ej. puerto 9100)
 * para saber si esta online, sin enviar ningun trabajo de impresion.
 */
function probarConexionTCP(ip, puerto, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resuelto = false;

    const terminar = (ok) => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => terminar(true));
    socket.once('timeout', () => terminar(false));
    socket.once('error', () => terminar(false));

    socket.connect(puerto || 9100, ip);
  });
}

/**
 * Estado de una impresora local (USB) segun WMI. Devuelve una promesa
 * (a diferencia de la version anterior basada en el modulo nativo).
 */
async function estadoImpresoraLocal(nombreSistema) {
  const impresoras = await listarImpresorasSistema();
  const encontrada = impresoras.find((p) => p.nombre === nombreSistema);
  if (!encontrada) return 'no-encontrada';
  return encontrada.estado;
}

module.exports = { listarImpresorasSistema, probarConexionTCP, estadoImpresoraLocal };
