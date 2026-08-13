# Discord — Guía de estructura del servidor (BoostPilot)

Estructura de servidor de ventas de boosts estilo Colorant / EldoradoSniper: la compra y el soporte se resuelven por **tickets**, cada juego tiene sus **canales propios**, y los **roles de customer** desbloquean categorías y pings por nivel de compra.

---

## 1. Visión general

```
INFORMACIÓN  → lo que cualquier visitante ve
VENTAS       → precios, reseñas, crear ticket de compra
POR JUEGO    → un canal (o par de canales) por cada juego soportado
TICKETS      → soporte: ayuda, compra, reporte
BOT          → webhooks de BoostPilot, comandos, estado
COMUNIDAD    → general, voz, media
```

Regla de oro: **los tickets y los canales por juego son privados para customers**. Un visitante nuevo ve Info + una preview, y solo al comprar (o al activar su key) recibe el rol `🎁 Customer` que abre el resto del servidor.

---

## 2. Roles

| Rol | Color | Quién lo tiene | Qué permite |
|---|---|---|---|
| 👑 Owner | Rojo | Tú | Todo. Crear/borrar roles, canales, tickets, claves |
| 🛡️ Admin | Rojo | Staff de confianza | Gestionar tickets, moderar, dar roles de booster |
| 🎖️ Mod | Amarillo | Staff | Cerrar tickets, banear, silenciar, mover mensajes |
| 🌟 Booster | Verde | Vendedores aprobados | Publicar boosts en canales por juego, ver tickets de pedidos |
| 💎 VIP | Morado | Clientes Pro (plan mayor) | Acceso a todo + pings prioritarios + canal VIP privado |
| 🎁 Customer | Azul | Cualquier comprador | Ver canales por juego, abrir tickets, webhook de pedidos |
| 🧑 Member | Gris | Todo el mundo | Solo Info + General + voz |
| 🤖 BoostPilot | — | El bot | Solo los canales necesarios (nada de permisos de más) |

### Jerarquía de permisos (Server Settings → Roles)
1. **Member**: no puede ver `POR JUEGO`, `TICKETS`, `BOT`. Solo `#-reglas`, `#-general`, voz.
2. **Customer**: desbloquea `POR JUEGO`, `TICKETS`, `BOT` y todos los canales de venta.
3. **VIP**: hereda Customer + canal `#vip` y ping `@VIP`.
4. **Booster**: hereda Customer + puede escribir en `#-boosts` de cada juego.
5. **Staff**: ve todo, gestiona tickets.

> Configura con `@everyone` denegado por defecto en las categorías privadas y permisos **añadidos** solo en los roles correspondientes. Así cualquier rol nuevo queda fuera hasta que se le asigne.

---

## 3. Canales

### 📌 INFORMACIÓN (público)
| Canal | Propósito |
|---|---|
| `#reglas` | Reglas, aceptar para entrar (si usas onboarding) |
| `#bienvenida` | Welcome screen: qué es BoostPilot, cómo empezar |
| `#anuncios` | Noticias, promos, estado de claves (solo staff escribe) |
| `#estado-del-bot` | Webhook de estado / uptime de BoostPilot |
| `#faq` | Preguntas frecuentes fijadas |

### 🛒 VENTAS (customer)
| Canal | Propósito |
|---|---|
| `#precios` | Tabla de planes y packs |
| `#reseñas` | Reseñas de clientes, foto de pruebas |
| `#pagos` | Confirmaciones de pago / evidencia de entrega |
| `#crear-ticket` | Botón: 🛒 **Comprar** / 🎫 **Ayuda** / 🐞 **Reportar** |

### 🎮 POR JUEGO (customer) — un par por cada juego soportado
```
#valorant-boosts   #valorant-chat
#league-boosts     #league-chat
#brawl-boosts      #brawl-chat
#fc-boosts         #fc-chat
#clash-boosts      #clash-chat
#rl-boosts         #rl-chat
#fortnite-boosts   #fortnite-chat
#osrs-boosts       #osrs-chat
#r6-boosts         #r6-chat
#marvel-boosts     #marvel-chat
#apex-boosts       #apex-chat
#cod-boosts        #cod-chat
```
- `-boosts`: los boosters publican ofertas (`[VALORANT] Platino → Diamante $15`), los clientes piden.
- `-chat`: charla del juego, tips, dudas sin spam de ofertas.
- Si prefieres menos canales: un canal por juego y usa **hilos** para las ofertas activas. La estructura queda igual de clara.

### 🎫 TICKETS (customer)
- `#abrir-ticket` — panel con botones (ver sección 5).
- Los tickets se crean como canales privados `ticket-XXX` dentro de la categoría `🎫 TICKETS`.
- Categorías privadas por staff solo: `tickets-staff`.

### 🤖 BOT (customer)
| Canal | Propósito |
|---|---|
| `#pedidos` | Webhook de BoostPilot: cada pedido nuevo que acepta tu bot cae aquí |
| `#comandos` | Comandos útiles, fijado |
| `#bugs-sugerencias` | Reportes y mejoras (por ticket si es privado) |

### 🗣️ COMUNIDAD (público)
```
#general      #media        #colaboradores
Voice: General, Zona Boost, AFK
```

---

## 4. Roles de juego (menús) — pings opcionales

Crea un **Role Menu** (onboarding o bot) para que la gente elija de qué juegos quiere enterarse:

- `🔫 Valorant ping`, `🎮 League ping`, `🐐 Brawl ping`, `⚽ FC ping`, `🏰 Clash ping`, `🚗 RL ping`, `🔫 Fortnite ping`, `🗡️ OSRS ping`, `🔫 R6 ping`, `🦸 Marvel ping`, `🪂 Apex ping`, `🎯 COD ping`.

Estos roles **solo permiten mencionar** en su juego correspondiente (configura: `Permitir @mention` solo en ese canal) — así los `-boosts` no spammean a toda la comunidad.

---

## 5. Sistema de tickets (lo más importante)

1. Instala un bot de tickets. Recomendado: **Tickets** (discord.gg/tickets, el más usado) o **Ticket Tool** si quieres algo simple.
2. En `#crear-ticket` publica un panel con **3 botones**:
   - 🛒 **Comprar / Comprar Boost** → categoría `VENTAS`
   - 🎫 **Ayuda / Soporte** → categoría `TICKETS`
   - 🐞 **Reportar problema / Bug** → categoría `TICKETS`
3. Cada ticket crea un canal privado `ticket-` + abre un **hilo de bienvenida** automático con: usuario, motivo, y quién atiende.
4. Formulario dentro del ticket (bot de tickets lo soporta):
   - **Comprar**: juego → rango actual → rango deseado → presupuesto → medio de pago.
   - **Ayuda**: qué necesitas (instalar, activar key, configurar webhook).
   - **Bug**: captura de pantalla + log.
5. Al cerrar: botón **Cerrar** → mensaje de resumen → canal se archiva/borra. Guarda el log en `tickets-staff`.
6. Reglas de tickets:
   - Un solo pedido por ticket.
   - Prohibido etiquetar staff; el bot responde en minutos o se asigna `@Mod`.
   - Tras cerrar, se borra a las 24h (configurable).

**Flujo de compra completo (customer):**
1. Entra → ve `#precios`.
2. Abre ticket 🛒 Comprar → elige juego y plan.
3. Paga → se confirma en `#pagos`.
4. Staff/owner le asigna `🎁 Customer` (o `💎 VIP`) y le entrega su **key de BoostPilot**.
5. Activa la key en el software → el bot de webhooks empieza a volcar pedidos a `#pedidos`.

---

## 6. Onboarding (Server Settings → Onboarding)

- **Pantalla de bienvenida**: botón 🛒 **Comprar** (→ `#crear-ticket`), botón 🎮 **Juegos** (→ role menus), botón ❓ **Ayuda** (→ `#faq`).
- **Aceptar reglas** obligatorio antes de hablar.
- **Roles de entrada**: `🧑 Member`.
- **Role prompts**: `Elige tu juego` (menús de pings de la sección 4).

---

## 7. Integración con BoostPilot (webhooks)

BoostPilot ya envía webhooks de Discord (`src/webhook.mjs`). Configura:

1. En `#pedidos`: Server Settings → Integrations → Webhooks → **Nuevo webhook** → nombre `BoostPilot` (avatar: el logo rosa).
2. Copia la URL.
3. Pégala en la configuración de webhooks del bot (config webhook URL de pedidos nuevos).
4. Opcional: webhook separado en `#estado-del-bot` para encendido/apagado y errores.

Resultado: cada pedido que tu bot detecta y responde en Eldorado.gg aparece al instante en `#pedidos` con color, precio y juego.

---

## 8. Checklist final

- [ ] Roles creados con jerarquía y permisos (Member / Customer / VIP / Booster / Staff).
- [ ] Categorías privadas: `@everyone` sin acceso; solo roles concretos.
- [ ] `#reglas` y `#bienvenida` públicos.
- [ ] Canales `-boosts` y `-chat` por cada uno de los 12 juegos.
- [ ] Bot de tickets instalado con 3 botones (Comprar / Ayuda / Bug).
- [ ] Formularios por tipo de ticket.
- [ ] Role menus de juego con pings restringidos a su canal.
- [ ] Onboarding con pantalla de bienvenida y aceptación de reglas.
- [ ] Webhook de BoostPilot → `#pedidos`.
- [ ] `#estado-del-bot` con webhook de uptime/errores.
- [ ] Probar un flujo completo de compra con una cuenta de prueba.
