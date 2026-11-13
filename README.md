# StalkerMod - Minecraft Bedrock Edition Port (v1.0.5)

Port completo de **StalkerMod** (original de Forge 1.20.1) a **Minecraft Bedrock Edition (1.21+)**.

## Estructura del Repositorio
- `BP/` — Behavior Pack (Entidad `stalkermod:stalker`, ítem `stalkermod:stalker_watch`, receta y lógica en `scripts/main.js`).
- `RP/` — Resource Pack (Texturas `stalker_a`, `stalker_b`, `stalker_head`, sonido `stalker_stare.ogg`, geometría billboard e idiomas `es_ES`/`en_US`).
- `.github/workflows/build-addon.yml` — Workflow de GitHub Actions que empaqueta automáticamente el archivo `.mcaddon` listo para instalar en Android/Windows.

## Requisitos en el Mundo de Bedrock
Activa en los ajustes del mundo:
- **API Beta (Beta APIs)** en la pestaña *Experimentos* (necesario para `@minecraft/server` y `@minecraft/server-ui`).

## Comandos disponibles (Operadores)
- `!stalker stalk` — Genera un acecho detrás del jugador.
- `!stalker watch` — Genera la cabeza observando a distancia.
- `!stalker door` — Ejecuta el evento de golpes en la puerta más cercana.
- `!stalker clear` — Elimina todos los Stalkers activos.
- `!stalker config` — Abre el menú de configuración (también accesible usando el **Reloj del Stalker**).
