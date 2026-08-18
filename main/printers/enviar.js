const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

/**
 * Resuelve la ruta real en disco del script raw-print.ps1. Cuando la app
 * esta empaquetada con electron-builder, los .ps1 se marcan como
 * "asarUnpack" para que queden como archivos reales (un proceso externo
 * como powershell no puede ejecutar un archivo dentro de app.asar).
 */
function rutaScript(nombreScript) {
  let electronApp = null;
  try {
    electronApp = require('electron').app;
  } catch (err) {
    // No estamos en el proceso principal de Electron (ej. pruebas fuera de la app)
  }

  if (electronApp && electronApp.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'main', 'printers', nombreScript);
  }
  return path.join(__dirname, nombreScript);
}

/**
 * Envia un buffer de comandos crudos (ESC/POS o TSPL) directo al spooler
 * de Windows via PowerShell + winspool.drv (API nativa de impresion),
 * sin depender de ningun modulo nativo de Node.
 */
function imprimirRaw(nombreImpresora, bufferComandos) {
  return new Promise((resolve, reject) => {
    const archivoTemporal = path.join(os.tmpdir(), `printbridge-${crypto.randomUUID()}.bin`);

    fs.writeFile(archivoTemporal, bufferComandos, (errEscritura) => {
      if (errEscritura) return reject(errEscritura);

      const script = rutaScript('raw-print.ps1');

      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', script,
          '-PrinterName', nombreImpresora,
          '-FilePath', archivoTemporal
        ],
        { windowsHide: true, timeout: 15000 },
        (err, stdout, stderr) => {
          fs.unlink(archivoTemporal, () => {}); // limpieza, sin bloquear la respuesta

          const salida = (stdout || '').trim();

          if (err) {
            return reject(new Error(`Error ejecutando PowerShell: ${stderr || err.message}`));
          }
          if (salida.startsWith('FAIL')) {
            return reject(new Error(salida));
          }
          resolve({ enviado: true, detalle: salida });
        }
      );
    });
  });
}

function imprimirPorRed(ip, puerto, bufferComandos, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let resuelto = false;

    socket.setTimeout(timeoutMs);

    socket.connect(puerto || 9100, ip, () => {
      socket.write(bufferComandos, () => socket.end());
    });

    socket.on('close', () => {
      if (!resuelto) { resuelto = true; resolve({ enviado: true }); }
    });
    socket.on('timeout', () => {
      if (!resuelto) { resuelto = true; socket.destroy(); reject(new Error(`Timeout conectando a ${ip}:${puerto}`)); }
    });
    socket.on('error', (err) => {
      if (!resuelto) { resuelto = true; reject(err); }
    });
  });
}

module.exports = { imprimirRaw, imprimirPorRed, rutaScript };
