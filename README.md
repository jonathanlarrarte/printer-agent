# PrintBridge Agent (versión Electron)

Misma lógica de intermediario de impresión (WebSocket + cola persistente +
ESC/POS + TSPL + multi-impresora) que la versión de servicio headless, pero
empaquetada como **aplicación de escritorio real**: instalador con wizard
"Siguiente, Siguiente, Instalar", ícono en la bandeja del sistema, ventana
de configuración nativa, y arranque automático con Windows — sin consola,
sin `localhost:8181` en el navegador.

## Estructura

```
printbridge-electron/
├── main/                       # Proceso principal de Electron (backend)
│   ├── main.js                 # ventana, tray, IPC, arranque automático
│   ├── server.js               # WS (/ws) + HTTP (/print), igual que antes
│   ├── config.js                # lectura/escritura de config.json (en userData)
│   ├── auth.js                  # validación de token + whitelist de dominios
│   ├── queue.js                  # cola persistente con reintentos
│   ├── heartbeat.js              # estado online/offline de impresoras
│   ├── setup/generar-identidad.js
│   └── printers/                 # discovery, escpos, tspl, enviar, dispatcher
├── preload.js                   # puente seguro IPC (contextBridge)
├── renderer/                    # Ventana de configuración (HTML/CSS/JS)
│   ├── index.html
│   ├── renderer.js
│   └── styles.css
├── assets/
│   ├── icon.png                 # icono placeholder — reemplazar por el logo real
│   └── icon.ico
├── sdk-js/                      # SDK para integrar desde Vue (sin cambios)
├── package.json                  # incluye config de electron-builder (NSIS)
└── LICENSE.txt                   # texto mostrado en el wizard del instalador
```

## Diferencias clave vs. la versión de servicio Windows

| | Servicio + web config | Electron |
|---|---|---|
| Instalación | Inno Setup separado, servicio Windows aparte | Un solo `.exe` con wizard nativo (`electron-builder`) |
| Configuración | Navegador en `localhost:8181` | Ventana de escritorio propia |
| Ejecución en segundo plano | Servicio de Windows | Ícono en la bandeja del sistema, la ventana se oculta al cerrar |
| Arranque automático | Registrado por `node-windows` | `auto-launch` (registro de Windows) |
| Persistencia de datos | Carpeta del ejecutable | `app.getPath('userData')` — sobrevive actualizaciones |

El **canal de impresión** (`ws://localhost:8181/ws`, formato de los jobs,
token, alias lógicos) es idéntico. El SDK de integración en Vue **no cambia
nada** — apunta al mismo puerto y protocolo.

## Nota sobre impresión RAW en Windows (sin compilación nativa)

Esta versión **no usa** el paquete npm `printer` (abandonado, con
dependencias rotas que impiden instalarlo en npm/Node modernos). En su
lugar, el envío de bytes crudos (ESC/POS, TSPL) se hace invocando
PowerShell, que llama directamente a `winspool.drv` (la API nativa de
impresión de Windows) vía un pequeño script embebido en C# (`Add-Type`).

Ventajas de este enfoque:
- **Cero compilación nativa**: no se necesita Visual Studio Build Tools,
  Python, ni `node-gyp`. `npm install` es rápido y sin fricción.
- Usa herramientas que **ya vienen con Windows** (PowerShell + .NET).
- El listado de impresoras usa `Get-CimInstance Win32_Printer` (WMI),
  también nativo de Windows.

Archivos relevantes: `main/printers/raw-print.ps1` (envío de bytes) y
`main/printers/list-printers.ps1` (listado + estado). Al empaquetar con
`electron-builder`, estos `.ps1` se marcan como `asarUnpack` para que
PowerShell pueda ejecutarlos como archivos reales en disco (un proceso
externo no puede ejecutar algo dentro de `app.asar`).

## 1. Desarrollo local

```bash
npm install
npm start
```

Se abre la ventana de configuración y, en segundo plano, el canal de
impresión queda escuchando en `ws://localhost:8181/ws`. Verás el ícono en
la bandeja del sistema; cerrar la ventana (X) la oculta, no cierra la app —
para salir de verdad, usa "Salir" desde el menú del ícono de bandeja.

## 2. Configurar impresoras

Desde la ventana (o reabriéndola desde el ícono de bandeja):
1. Alias lógico (`receipt`, `wristband`, `kitchen`, ...).
2. Tipo: USB/Local (lista real detectada del sistema) o Red (IP + puerto).
3. Formato: `escpos`, `tspl` o `raw`.

La tarjeta superior muestra el **token** que debe usar tu integración Vue
(mismo uso que antes con el SDK).

## 3. Generar el instalador (.exe con wizard)

```bash
npm run dist
```

`electron-builder` genera en `dist/`:
- `PrintBridge-Setup-1.0.0.exe` — instalador NSIS con wizard completo:
  pantalla de licencia, elección de carpeta, acceso directo en escritorio
  y menú inicio, y arranque de la app al finalizar.

Este es el único archivo que le das al cliente: doble clic, "Siguiente",
"Siguiente", "Instalar", y la app queda corriendo en la bandeja del sistema
con arranque automático configurado.

> Como ya no hay módulos nativos que compilar, `npm install` debería
> funcionar sin instalar Visual Studio ni herramientas adicionales. Aun así,
> conviene probar en una máquina Windows real con las impresoras físicas
> conectadas antes de distribuir al cliente.

## 4. Reemplazar el ícono

`assets/icon.png` / `assets/icon.ico` son un placeholder generado
automáticamente ("PB" sobre círculo azul). Reemplázalos por el logo real
antes de distribuir al cliente (mismo nombre de archivo, mismos formatos).

## 5. Checklist para el piloto

- [ ] `npm install` sin errores (revisar compilación nativa de `printer` en Windows).
- [ ] `npm start` abre la ventana, detecta la térmica y la TSC en
      "Impresora detectada".
- [ ] Configurar alias `receipt` y `wristband`, confirmar heartbeat "Online".
- [ ] `npm run dist` genera el instalador sin errores.
- [ ] Instalar en el equipo piloto vía doble clic — confirmar acceso directo,
      arranque automático tras reiniciar el equipo, e ícono en bandeja.
- [ ] Conectar el POS Vue actual al SDK (`sdk-js/printbridge-sdk.js`) usando
      el token mostrado en la ventana.
- [ ] Dejar correr en producción real 1-2 semanas antes de replicar a más clientes.

## 6. Siguiente fase (SaaS)

Igual que en la versión anterior: cuando el piloto esté validado, el
siguiente paso es un panel central en Laravel que reciba reportes de estado
de cada `instalacion_id`, gestione tokens por cliente, y distribuya
actualizaciones del `.exe` (electron-updater se integra de forma nativa con
`electron-builder` para auto-actualizaciones silenciosas, un paso natural
una vez tengas varios clientes activos).
