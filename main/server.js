const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { leerConfigLocal } = require('./config');
const { validarToken, validarOrigen } = require('./auth');
const { encolar, onEstadoJob } = require('./queue');

let serverInstance = null;

/**
 * Arranca el servidor de impresion (WS + HTTP) embebido en el proceso
 * de Electron. Este es el mismo canal que usa el SDK JS desde el POS web.
 * La UI de configuracion de la app Electron habla con la config via IPC,
 * no via HTTP -- este servidor es solo para el POS externo.
 */
function iniciarServidorImpresion() {
  if (serverInstance) return serverInstance;

  const config = leerConfigLocal();
  const PUERTO = config.puerto_ws || 8181;

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

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

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

  server.listen(PUERTO, () => {
    console.log(`[server] Canal de impresion activo en http://localhost:${PUERTO} (WS: /ws)`);
  });

  serverInstance = server;
  return server;
}

function detenerServidorImpresion() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

module.exports = { iniciarServidorImpresion, detenerServidorImpresion };
