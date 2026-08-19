const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { leerConfigLocal } = require('./config');
const { validarToken, validarOrigen } = require('./auth');
const { encolar, onEstadoJob } = require('./queue');
const { obtenerCredencialesTLS } = require('./tls');

let servidorHttp = null;
let servidorHttps = null;

/**
 * Arranca el servidor de impresion (WS + HTTP) embebido en el proceso
 * de Electron. Este es el mismo canal que usa el SDK JS desde el POS web.
 * La UI de configuracion de la app Electron habla con la config via IPC,
 * no via HTTP -- este servidor es solo para el POS externo.
 *
 * Corre DOS listeners en paralelo, no uno solo: el HTTP original en
 * `puerto_ws` (sin cambios, para no romper integraciones existentes) y uno
 * HTTPS/WSS en `puerto_wss` (por defecto puerto_ws + 1). El HTTPS es
 * necesario si el POS mismo esta servido por HTTPS -- un navegador
 * bloquea por "mixed content" cualquier fetch/WebSocket en texto plano
 * hacia localhost desde una pagina https (ver Printing Examples guide).
 */
function iniciarServidorImpresion() {
  if (servidorHttp) return servidorHttp;

  const config = leerConfigLocal();
  const PUERTO_HTTP = config.puerto_ws || 8181;
  const PUERTO_HTTPS = config.puerto_wss || PUERTO_HTTP + 1;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Endpoint HTTP alterno de impresion (fallback si el POS no puede usar WS)
  app.post('/print', (req, res) => {
    const { token, target, format, data } = req.body;
    if (!validarToken(token)) return res.status(401).json({ error: 'token invalido' });
    const id = req.body.id || crypto.randomUUID();
    encolar({ id, target, format, data });
    res.json({ status: 'encolado', jobId: id });
  });

  // Endpoint minimo de salud, util para que el POS confirme que el agente esta activo
  app.get('/health', (req, res) => {
    const cfg = leerConfigLocal();
    res.json({ ok: true, instalacion_id: cfg.instalacion_id, version: cfg.version_agente });
  });

  servidorHttp = http.createServer(app);
  adjuntarWebSocket(servidorHttp);
  servidorHttp.listen(PUERTO_HTTP, () => {
    console.log(`[server] Canal de impresion (HTTP) activo en http://localhost:${PUERTO_HTTP} (WS: /ws)`);
  });

  try {
    const credencialesTLS = obtenerCredencialesTLS();
    servidorHttps = https.createServer(credencialesTLS, app);
    adjuntarWebSocket(servidorHttps);
    servidorHttps.listen(PUERTO_HTTPS, () => {
      console.log(`[server] Canal de impresion (HTTPS) activo en https://localhost:${PUERTO_HTTPS} (WSS: /ws)`);
    });
  } catch (err) {
    // No es fatal: el agente sigue funcionando 100% por HTTP. Solo afecta
    // a integraciones que necesiten conectarse desde una pagina HTTPS.
    console.warn('[server] No se pudo iniciar el canal HTTPS:', err.message);
  }

  return servidorHttp;
}

function adjuntarWebSocket(servidorBase) {
  const wss = new WebSocketServer({ server: servidorBase, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (!validarOrigen(origin)) {
      ws.send(JSON.stringify({ status: 'error', mensaje: 'origen no autorizado' }));
      return ws.close();
    }

    ws.on('message', (raw) => {
      let job;
      try {
        job = JSON.parse(raw);
      } catch (err) {
        return ws.send(JSON.stringify({ status: 'error', mensaje: 'JSON invalido' }));
      }

      if (!validarToken(job.token)) {
        return ws.send(JSON.stringify({ status: 'error', jobId: job.id, mensaje: 'token invalido' }));
      }

      if (!job.id) job.id = crypto.randomUUID();

      try {
        encolar(job);
        ws.send(JSON.stringify({ status: 'encolado', jobId: job.id }));
      } catch (err) {
        ws.send(JSON.stringify({ status: 'error', jobId: job.id, mensaje: err.message }));
      }
    });

    onEstadoJob((evento) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ status: evento.estado, jobId: evento.id, detalle: evento.detalle }));
      }
    });
  });
}

function detenerServidorImpresion() {
  if (servidorHttp) {
    servidorHttp.close();
    servidorHttp = null;
  }
  if (servidorHttps) {
    servidorHttps.close();
    servidorHttps = null;
  }
}

module.exports = { iniciarServidorImpresion, detenerServidorImpresion };
