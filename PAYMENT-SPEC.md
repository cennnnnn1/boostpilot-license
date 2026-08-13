# Spec — Pagos (BoostPilot) · Flujo manual

Cobro **100% manual** dentro del ticket de Discord. El staff envía las instrucciones, el cliente paga, pega su comprobante y el staff verifica y entrega la key.

## Método principal: USDT (TRC20)

| Campo | Valor |
|---|---|
| Moneda | USDT |
| Red | **TRC20 (solo esa)** |
| Dirección | `TLGf5bXvJ4HY5KpeVtj7uFcPiZVPdeKsSX` (Binance, fija para todos los pagos) |
| Comisión | La paga el cliente (~$1). Al staff le llega el **monto exacto** |

- Todos los clientes pagan a la **misma dirección**.
- ⚠️ Si el cliente envía por otra red (ERC20, BEP20) el dinero se pierde → siempre recordar "TRC20 only".

## Mensaje al cliente (plantilla EN — clientes internacionales)

```
Thank you for your order! 🎉

Here's how to complete your payment:

💳 Method: USDT (TRC20)
📌 Address: TLGf5bXvJ4HY5KpeVtj7uFcPiZVPdeKsSX
🌐 Network: TRC20 (only!)
💰 Amount: $XX.XX

Steps:
1. Send the exact amount to the address above using the TRC20 network.
2. Copy your TXID (the long code that identifies the transfer).
3. Paste the TXID here + a screenshot of the payment.
4. Staff verifies it and delivers your key (usually within a few minutes).

⚠️ Very important:
- Use ONLY the TRC20 network. Sending on any other network = lost funds.
- Send the exact amount. If you send more or less, tell us so we can adjust.
- Don't close this ticket until you receive your key.
```

## Mensaje al cliente (plantilla ES)

```
¡Gracias por tu pedido! 🎉

Así completas tu pago:

💳 Método: USDT (TRC20)
📌 Dirección: TLGf5bXvJ4HY5KpeVtj7uFcPiZVPdeKsSX
🌐 Red: TRC20 (solo esa)
💰 Monto: $XX.XX

Pasos:
1. Envía el monto exacto a la dirección de arriba usando la red TRC20.
2. Copia tu TXID (el código largo que identifica la transferencia).
3. Pega el TXID aquí + una captura de pantalla del pago.
4. El staff lo verifica y te entrega tu key (normalmente en minutos).

⚠️ Muy importante:
- Usa SOLO la red TRC20. Enviar por otra red = dinero perdido.
- Envía el monto exacto. Si mandas de más o de menos, avísanos.
- No cierres este ticket hasta recibir tu key.
```

## Pruebas que pedir al cliente (mínimo)

1. **TXID** (transaction hash) — código único de la transferencia.
2. **Captura de pantalla** del pago que muestre:
   - el **monto** enviado
   - la **dirección destino** (debe ser exactamente la nuestra, visible en la captura)
   - la **fecha** del día
   - estado **"completado" / "exitoso"** (no "pendiente")
3. Esperar confirmación de la red (**TRC20 confirma en ~1-2 min**).

### Verificación del staff (recomendado)

- Pegar el TXID en **tronscan.org** → muestra monto, dirección destino, estado y confirmaciones.
- Confirmar que la dirección destino = `TLGf5bXvJ4HY5KpeVtj7uFcPiZVPdeKsSX` y el monto = lo cobrado.

## Regla de comisión (para que te llegue el monto exacto)

| Caso | Regla |
|---|---|
| Pago en USDT directo | Te llega el 100% (la fee la paga el cliente). No pides extra. |
| Pago con tarjeta (si algún día) | Sumar **~4%** al precio (ej. $30 → pedir $31.20) para cubrir comisión. |

## Generar y entregar keys (panel web)

Hay un **panel de keys** en el navegador: `http://localhost:8080/admin`
(Solo funciona mientras la app de BoostPilot esté corriendo.)

**Generar:** plan + cliente + cantidad → "Generar key" → copia la key y envíala en el ticket.
**Key de prueba 🎁:** marca el toggle → elige el **juego** → genera una key **gratis de 4 horas** para ese único juego (1 dispositivo). Útil para que los clientes prueben el bot antes de pagar.
**Ver todas:** lista con estado (activa / sin activar / vencida / revocada) + juego de cada key.
**Extender:** botón "+7 días" (renovar a un cliente). No aplica a keys de prueba.
**Revocar:** botón "Revocar" (mala paga, abuso).

- La key la reconoce la app al instante (mismo archivo `keys.json`).
- El tiempo empieza a correr cuando el cliente inicia sesión con la key por primera vez.
- **Máximo 1 dispositivo por key** (nuevas keys).
- Las keys se guardan en el estado de la app (carpeta `state`).

### Mensaje para enviar la key (EN)

```
✅ Payment verified!

Here's your key:

🔑 A253-4FC7-5FA5-8051

- Open BoostPilot and log in with this key.
- The timer starts the first time you log in.
- Works for all games · up to 2 devices.
- If you need help, open a new ticket.

Enjoy! 🚀
```

## Planes

Los planes los toma el panel de `config/rules.json` (`store.plans`):

| ID | Plan | Días | Precio |
|---|---|---|---|
| `tresdias` | 3 Días | 3 | $6 |
| `semanal` | Semanal | 7 | $12 |
| `mensual` | Mensual | 30 | $30 |

Para cambiar precios o añadir planes: editar `config/rules.json` → sección `store.plans`.

## ¿Otro método además de USDT?

- **Recomendado: empezar solo con USDT.** Es el más simple, te llega el monto exacto y no hay devoluciones.
- **Segunda opción (si algún cliente insiste): Bitcoin (BTC).** Necesitas una dirección BTC de tu Binance. Mismo flujo manual: cliente envía BTC y pega TXID. La comisión la paga el cliente.
- **NO usar PayPal** (congela fondos en negocios grises y el cliente puede reclamar).
- **Tarjeta/Stripe**: no para empezar (requiere empresa/KYC y puede banear el negocio). Solo cuando el volumen lo justifique.

## Reglas operativas

- **Una orden por ticket.**
- Cliente no cierra el ticket hasta recibir su key.
- Staff verifica el pago en **tronscan.org** antes de entregar la key.
- Una key sirve para todos los juegos.
- Política de reembolsos: a definir; recomendado **sin reembolso una vez activada la key**.

## Pendientes

- [x] Métodos de pago: **solo USDT (TRC20)** por ahora (config ya usa la dirección real).
- [ ] Añadir BTC como método secundario cuando exista dirección BTC de Binance.
- [ ] Definir política de reembolsos (recomendado: sin reembolso una vez emitida la key).
