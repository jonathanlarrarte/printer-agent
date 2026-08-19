/**
 * PrintBridge SDK (cliente JS minimo)
 *
 * Uso desde Vue u otro frontend:
 *
 *   import { PrintBridge } from './printbridge-sdk';
 *
 *   const pb = new PrintBridge({ token: 'el-token-del-config.json-local' });
 *   await pb.conectar();
 *
 *   await pb.print({
 *     target: 'receipt',
 *     format: 'escpos',
 *     data: { negocio: 'Parque Aventura', items: [...], total: 45000 }
 *   });
 *
 * Nota: el token se obtiene una vez, en la instalacion (pantalla local
 * localhost:8181), y el integrador lo guarda de forma segura junto con
 * la configuracion de esa caja/terminal (por ejemplo en su backend).
 *
 * HTTPS/WSS: el agente expone el mismo canal por dos puertos -- HTTP en
 * `puerto` (8181 por defecto, sin cambios) y HTTPS/WSS en `puertoSeguro`
 * (8182 por defecto). Si tu POS esta servido por HTTPS, el navegador
 * bloquea por "mixed content" cualquier ws:// hacia localhost -- por eso
 * este SDK detecta solo el protocolo de la pagina actual (`seguro`,
 * default automatico) y usa wss:// + puertoSeguro en ese caso, sin que
 * tengas que cambiar nada vos mismo.
 */
class PrintBridge {
  constructor({ host = 'localhost', puerto = 8181, puertoSeguro = 8182, token, seguro } = {}) {
    this.host = host;
    this.puerto = puerto;
    this.puertoSeguro = puertoSeguro;
    this.token = token;
    this.seguro = seguro ?? (typeof window !== 'undefined' && window.location?.protocol === 'https:');
    this.ws = null;
    this.callbacks = new Map();
  }

  conectar() {
    return new Promise((resolve, reject) => {
      const protocolo = this.seguro ? 'wss' : 'ws';
      const puerto = this.seguro ? this.puertoSeguro : this.puerto;
      this.ws = new WebSocket(`${protocolo}://${this.host}:${puerto}/ws`);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const cb = this.callbacks.get(msg.jobId);
        if (cb) {
          cb(msg);
          if (msg.status !== 'encolado') {
            this.callbacks.delete(msg.jobId);
          }
        }
      };

      this.ws.onclose = () => {
        // Reconexion simple; en produccion conviene backoff exponencial
        setTimeout(() => this.conectar().catch(() => {}), 3000);
      };
    });
  }

  /**
   * Envia un trabajo de impresion. Devuelve una promesa que se resuelve
   * cuando el agente confirma que quedo encolado (no cuando se imprime
   * fisicamente -- eso llega de forma asincrona via onEstado).
   */
  print({ target, format, data, id }) {
    return new Promise((resolve, reject) => {
      const jobId = id || crypto.randomUUID();
      const job = { id: jobId, token: this.token, target, format, data };

      this.callbacks.set(jobId, (msg) => {
        if (msg.status === 'error') reject(new Error(msg.mensaje));
        else resolve(msg);
      });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(job));
      } else {
        reject(new Error('PrintBridge no esta conectado. Llama a conectar() primero.'));
      }
    });
  }

  /**
   * Suscribirse a cambios de estado asincronos (impreso / fallo_definitivo)
   * de cualquier job, util para mostrar notificaciones en pantalla.
   */
  onEstado(callback) {
    this._onEstadoExterno = callback;
  }
}

export { PrintBridge };
