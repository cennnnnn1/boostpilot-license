# AGENTS.md — BoostPilot / Eldorado-Bot

Bot semi-automático para boosters de Eldorado.gg + cliente Electron (BoostPilot) + negocio de keys USDT. Responder siempre en **español**.

## Raíz

`C:\Users\cenn\Documents\Default Project\eldorado-bot`

| Carpeta | Qué |
|---|---|
| `src/` | Bot + panel HTML/JS |
| `launcher/` | App Electron (build NSIS) |
| `config/rules.json` | Precios, tiers, regiones, planes, webhook |
| `state/` | Secretos (NO viaja en el instalador) |
| `tools/` | Discord, publish, tests. One-offs en `tools/archive/` |
| `release/` | Instaladores `.exe` |

## Comandos críticos

```
node --check <archivo>          # validar sintaxis ANTES de tocar código
node tools/run-tests.mjs        # 78 tests (sintaxis + pricing + keys)
npm.cmd run dist                # build NSIS (workdir: launcher/)
Start-Process '...Setup.exe' -ArgumentList '/S','/currentuser' -PassThru -Wait  # instalar
```

**NUNCA** usar `npm run dist` sin workdir `launcher/`. PowerShell: usar parámetro `workdir`, no `cd`.

## Build → Release (flujo completo)

1. Editar versión en **3 archivos**: `package.json` (raíz), `launcher/package.json`, `launcher/main.js` (`const VERSION`)
2. `node --check src/<archivo.mjs>` en cada archivo modificado
3. `node tools/run-tests.mjs` → 0 fallos
4. `npm.cmd run dist` (workdir `launcher/`) → genera exe en `release/`
5. `Start-Process ...` instalar silencioso
6. Verificar: `%LocalAppData%\Programs\BoostPilot\resources\bot\src\<archivo>` con `Select-String`
7. Subir exe: borrar asset viejo del release GitHub → subir nuevo (`tools/reupload-exe.mjs` o curl manual)
8. Actualizar hash: `node tools/installer-hash.mjs`
9. Publicar en Discord: `node tools/discord-publish.mjs` (+ `node tools/discord-faq.mjs`)

El build **vacia el webhook** de rules.json (`tools/sanitize-config.mjs`). El `devicesToken` SÍ viaja.

## Perfiles per-key (CRÍTICO)

El bot carga perfiles desde `%APPDATA%\eldorado-bot-launcher\bot-state\clientcfg\<keyId>.json` que **sobreescriben** `config/rules.json`. Si el pricing no cambia en el panel, **parchear también el perfil activo**.

## `src/` — mapas rápidos

- **`pricing.mjs`** — motor de precios: `computePrice()` → `computeTiers()` / `computeUnits()` / `computeSegments()`. `parseRR()` (current RR), `parseDesiredRR()` (over 50rr, 50+ rr, desired rr N), `parseRankRange()` (current/desired/Game Level), `unitsCount()` (Number of games/wins). Regiones a nivel juego: `gameCfg.regionLocked` + `gameCfg.regions`.
- **`fast-mode.mjs`** — loop infinito, **nunca** `await` dentro de handlers. `_chatPlan(p, noPrice)` — cuando `noPrice=true`, usa `customRequestMessage` ("dame más detalles") en vez de `welcomeMessage`. `_categoryShouldSkip()` / `_pricingSkipReason()`.
- **`rules.js`** — `applyFilters()` soporta `skipConsole` global Y por juego (`gameCfg.skipConsole`).
- **`dashboard.js`** — panel localhost:3000, rutas `/api/*`, kick cada 30s por HWID/índice.
- **`eldorado-api.mjs`** — API pura (cookies, sin navegador).
- **`panel.html`** — editor de precios (segments/tiers/units). Regiones en header del juego (`.pr-game-regions`). Save per-categoría.

## Regiones Eldorado

`REGION_CANON` en pricing.mjs: **EU, NA, AP, LATAM, BRASIL, KR**. "Oceania" → AP. Regiones ahora a nivel juego (`gameCfg.regionLocked` + `gameCfg.regions`). Solo se verifican regiones para juegos con `regionLocked: true` (Valorant, LoL). Juegos globales (Brawl Stars, Fortnite) ignoran regiones. Desactivar una región = el bot saltea requests de esa región vía `computePrice()` → `_pricingSkipReason('se salta')`.

## Campos Eldorado en el bot

El bot parsea campos del request de Eldorado vía `buildText()`:
- "Current Rank Diamond III" / "Desired Rank Ascendant II" / "Game Level Ascendant II"
- "Current RR 57" / "over 50rr" / "50+ rr" / "desired rr 20"
- "Number of games 1" / "Number of wins 2"
- "Previous season rank Ascendant I"
- "Server NA" / "Region EU"

## Negocio (resumen)

- 1 key = 1 dispositivo. Keys en GitHub (`cennnnnn1/boostpilot-license`), nunca en el instalador.
- Validación remota: índice `keys-index.json` en GitHub, check cada 30s.
- Dispositivos en `cennnnnn1/boostpilot-devices`. Reset HWID = kick (no bloqueo). Revoke = pausa. Delete = total.
- Pago USDT TRC20, verificación on-chain TronGrid (`tools/tron-check.mjs`).
- Discord: guild `1536591772807860314`, ticket bot, `#downloads`, `#faq`. Tokens en `state/discord.auth.json`.

## Seguridad

- **Viaja en el exe**: `src/`, `rules.json` (sin webhook), seed-state (sin keys), Node, `devicesToken`.
- **NO viaja**: `state/` completo (`github.json`, `auth.*`, `keys.json` con keys vivas, webhook).
- **Nunca** imprimir tokens, master key, webhook, auth.
- Exe sin firmar → SmartScreen en clientes, se maneja con `#faq`.
- `ELBOT_MASTER_KEY` en env var — nunca imprimirla.

## Notas de implementación

- `fast-mode.mjs`: los handlers corren en un loop infinito. Un `await` dentro de un handler bloquea todo el loop.
- `fast-mode.mjs`: cuando no hay precio automático, `_chatPlan(p, true)` usa `customRequestMessage` ("dame más detalles") en vez de `welcomeMessage`. Solo el handler auto (línea 372) pasa `noPrice=true`.
- `pricing.mjs`: `roundPrice()` — <5 → ×0.5, <50 → int, <200 → ×5, ≥200 → ×10.
- `pricing.mjs`: tiers mode — precios son **suma** de entries en el rango, no pasos × precio fijo.
- `pricing.mjs`: `parseRR()` ignora números que siguen a "over/above/desired" para no confundir current con desired RR.
- `panel.html`: save button es **per-categoría** (dentro de `.pr-cat-card`), serializePricing() guarda todo el juego. Regiones ahora en header del juego (`.pr-game-regions`), no por categoría.
- `rules.js`: `skipConsole` soportado globalmente (filters.skipConsole) Y por juego (gameCfg.skipConsole). El panel ya no muestra el checkbox global de skipConsole.
- `rules.json`: juegos con `regionLocked: true` (Valorant, LoL) muestran filtros de región en el panel. Juegos globales (Brawl Stars, Fortnite) no tienen regiones. Placements hereda pricing de Net Wins (mismo pricePerUnit, rankMultipliers, hoursPerUnit).
- `dashboard.js`: kick timer cada 30s, `/api/me` 401 → login.
- Autostart: `tools/autostart-remote-admin.vbs` y `tools/autostart-ticket-bot.vbs` en carpeta Inicio de Windows.
