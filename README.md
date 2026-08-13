# BoostPilot (eldorado-bot)

Bot semi-automático para boosters de [Eldorado.gg](https://www.eldorado.gg): detecta los *requests* de ofertas en tiempo real, calcula el precio sugerido y te deja confirmar la oferta desde un panel local. Incluye tienda con llaves de licencia, launcher de escritorio e integración con Discord.

## Requisitos

- Node.js **22+** (por el uso de `WebSocket` nativo)
- Google Chrome instalado
- Una cuenta de Eldorado.gg
- (Opcional) Token de bot de Discord + webhook para notificaciones

## Uso rápido (desarrollo)

```bash
npm install
npm run login      # abre Chrome y espera a que inicies sesión en Eldorado
npm run bot        # arranca el bot + panel (http://localhost:3000) + tienda (http://localhost:8080)
```

`npm run login` guarda la sesión en `state/auth.json`. Si el login se bloquea por Cloudflare, espera a que la verificación avance en la ventana de Chrome.

## Launcher de escritorio (versión para clientes)

```bash
cd launcher
npm install
npm run dist       # genera el instalador en release/ (BoostPilot Setup x.y.z.exe)
```

Funciones: autostart, sesión persistente (keep-session), login con llave ligada a dispositivo, hotkey para ocultar/mostrar el panel (por defecto `Ctrl+Z`), reinicio automático si el bot crashea y botón para abrir la tienda.

## Estructura

| Ruta | Qué es |
|---|---|
| `src/bot.js` | Proceso principal: arranca panel, tienda y fast-mode |
| `src/fast-mode.mjs` | Polling de la API de Eldorado (semi-auto: precio sugerido + confirmar) |
| `src/pricing.mjs` | Cálculo de precios sugeridos por juego/categoría |
| `src/dashboard.js` + `panel.html` | Panel local con cola de pedidos, stats y gestión de llaves |
| `src/keys.mjs` | Sistema de llaves de licencia (dispositivos, expiración, planes) |
| `src/store.js` + `landing.html` + `admin.html` | Tienda online (planes, pagos, `/api/buy` → genera key) |
| `src/login.js` | Captura de sesión de Eldorado vía Chrome DevTools (CDP) |
| `config/rules.json` | Reglas/filtros, webhook de Discord, planes y métodos de pago |
| `launcher/` | App de escritorio Electron |
| `tools/` | Setup de Discord, tests y utilidades de diagnóstico |
| `tools/discord-ticket-bot.mjs` | Bot de contadores (miembros/clientes) y auto-asignación de rol |

## Llaves y administración

- El panel (`http://localhost:3000`) tiene gestión de llaves: **generar, extender, revocar, eliminar** y marcar pagos. Se desbloquea con la variable `ELBOT_MASTER_KEY`.
- La tienda (`http://localhost:8080`) vende planes y emite la key automáticamente en `/api/buy`. Su panel admin (`/admin`) también usa `ELBOT_MASTER_KEY`.
- Keys de prueba: gratis, 4 horas, limitadas a un juego y un dispositivo.
- La key se activa la primera vez que el cliente inicia sesión; expira según el plan.

## Variables de entorno

| Variable | Uso |
|---|---|
| `ELBOT_MASTER_KEY` | Llave maestra para el panel de administración (obligatoria) |
| `ELBOT_STATE_DIR` | Carpeta de estado (por defecto `./state`) |
| `CDP_PORT` | Puerto de depuración de Chrome para el login (por defecto `9222`) |
| `BP_DISCORD_TOKEN` | Token del bot de Discord (alternativa a `state/discord.auth.json`) |

## Pagos

Flujo **manual** dentro de los tickets de Discord. Solo **USDT (red TRC20)** por ahora. Ver `PAYMENT-SPEC.md`.

## Discord

- `tools/discord-setup.mjs` crea la estructura del servidor (guía en `DISCORD-SERVER-GUIDE.md`).
- `tools/discord-ticket-bot.mjs` mantiene los contadores y asigna el rol Member.
- Los tickets y pagos se gestionan manualmente (Ticket Tool).

## Configuración sensible

`config/rules.json` contiene el webhook de Discord (secreto). Está ignorado en git; usá `config/rules.example.json` como plantilla. Si el repo se comparte, rotá el webhook.

## Tests

```bash
node tools/test-panel.mjs
node tools/test-fast-api.mjs
node tools/test-rules.mjs
node tools/e2e-test.mjs
```

## Estado

El bot persiste todo en `state/` (sesión, keys, pedidos, historial). Hacé backup de esa carpeta y de `config/rules.json`.
