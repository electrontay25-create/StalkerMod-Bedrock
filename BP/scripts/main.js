import { world, system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

// Configuración por defecto (sincronizada con StalkerConfig.java)
const DEFAULT_CONFIG = {
  intervalMinutes: 5,
  ambientVolume: 80,
  noticeSeconds: 3,
  stalkChance: 70,
  watchChance: 60,
  doorChance: 50,
  blindnessSeconds: 4
};

function getConfig() {
  const raw = world.getDynamicProperty("stalkermod:config");
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  world.setDynamicProperty("stalkermod:config", JSON.stringify(cfg));
}

// Estado activo de Stalkers en el mundo
const activeStalkers = new Map(); // entityId -> { targetId, mode, life, seenTicks, soundStarted }
const playerTimers = new Map();   // playerId -> nextCheckTick

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getHorizontalDir(rotY) {
  const rad = (rotY * Math.PI) / 180;
  return { x: -Math.sin(rad), z: Math.cos(rad) };
}

function isPlayerLookingAt(player, targetLoc, thresholdDot = 0.72) {
  const head = player.getHeadLocation();
  const view = player.getViewDirection();
  const dx = targetLoc.x - head.x;
  const dy = (targetLoc.y + 1.8) - head.y;
  const dz = targetLoc.z - head.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const dot = (view.x * dx + view.y * dy + view.z * dz) / dist;
  return dot >= thresholdDot;
}

function findGroundY(dimension, x, startY, z) {
  for (let y = Math.floor(startY) + 4; y >= Math.floor(startY) - 8; y--) {
    const blockBelow = dimension.getBlock({ x: Math.floor(x), y: y - 1, z: Math.floor(z) });
    const blockFeet = dimension.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
    const blockHead = dimension.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
    if (
      blockBelow && !blockBelow.isAir && !blockBelow.isLiquid &&
      blockFeet && blockFeet.isAir &&
      blockHead && blockHead.isAir
    ) {
      return y;
    }
  }
  return null;
}

// Spawn de Stalker (Modos: 0 = STALK, 1 = DOOR, 2 = WATCH)
export function spawnStalkerForPlayer(player, mode = 0) {
  const dim = player.dimension;
  const pLoc = player.location;
  const rot = player.getRotation();
  let spawnPos = null;
  let spriteIndex = 0;

  if (mode === 0) {
    // MODE_STALK: aparece detrás o a los lados entre 18 y 34 bloques
    spriteIndex = Math.random() < 0.5 ? 0 : 1;
    for (let attempt = 0; attempt < 25; attempt++) {
      const dist = randInt(18, 34);
      const offsetDeg = randInt(110, 250); // detrás del campo visual
      const dir = getHorizontalDir(rot.y + offsetDeg);
      const tx = pLoc.x + dir.x * dist;
      const tz = pLoc.z + dir.z * dist;
      const ty = findGroundY(dim, tx, pLoc.y, tz);
      if (ty !== null) {
        spawnPos = { x: Math.floor(tx) + 0.5, y: ty, z: Math.floor(tz) + 0.5 };
        break;
      }
    }
  } else if (mode === 2) {
    // MODE_WATCH: cabeza asomándose desde lejos (24 - 45 bloques)
    spriteIndex = 2;
    for (let attempt = 0; attempt < 25; attempt++) {
      const dist = randInt(24, 45);
      const angle = randInt(0, 359);
      const dir = getHorizontalDir(angle);
      const tx = pLoc.x + dir.x * dist;
      const tz = pLoc.z + dir.z * dist;
      const ty = findGroundY(dim, tx, pLoc.y, tz);
      if (ty !== null) {
        spawnPos = { x: Math.floor(tx) + 0.5, y: ty, z: Math.floor(tz) + 0.5 };
        break;
      }
    }
  } else if (mode === 1) {
    // MODE_DOOR: busca puerta cercana o toca detrás de una pared
    spriteIndex = 1;
    const radius = 10;
    let foundDoor = null;
    for (let dx = -radius; dx <= radius && !foundDoor; dx++) {
      for (let dy = -2; dy <= 3 && !foundDoor; dy++) {
        for (let dz = -radius; dz <= radius && !foundDoor; dz++) {
          const blk = dim.getBlock({
            x: Math.floor(pLoc.x) + dx,
            y: Math.floor(pLoc.y) + dy,
            z: Math.floor(pLoc.z) + dz
          });
          if (blk && blk.typeId.includes("_door")) {
            foundDoor = blk.location;
          }
        }
      }
    }
    if (foundDoor) {
      dim.playSound("random.door_close", foundDoor, { volume: 1.0, pitch: 0.65 });
      const awayX = foundDoor.x - pLoc.x;
      const awayZ = foundDoor.z - pLoc.z;
      const len = Math.hypot(awayX, awayZ) || 1;
      spawnPos = {
        x: foundDoor.x + (awayX / len) * 1.5 + 0.5,
        y: foundDoor.y,
        z: foundDoor.z + (awayZ / len) * 1.5 + 0.5
      };
    } else {
      return spawnStalkerForPlayer(player, 0);
    }
  }

  if (!spawnPos) return false;

  try {
    const entity = dim.spawnEntity("stalkermod:stalker", spawnPos);
    entity.setProperty("stalkermod:sprite", spriteIndex);
    entity.setProperty("stalkermod:mode", mode);
    entity.setProperty("stalkermod:reveal", 1.0);

    activeStalkers.set(entity.id, {
      targetId: player.id,
      mode,
      life: 0,
      seenTicks: 0,
      soundStarted: false
    });
    return true;
  } catch {
    return false;
  }
}

// UI del Reloj del Stalker (equivalente a StalkerSettingsScreen.java)
function openSettingsUI(player) {
  if (!player.isOp() && player.getGameMode() !== "creative") {
    player.sendMessage("§cStalker: no tienes permiso para cambiar los ajustes.");
    return;
  }

  const cfg = getConfig();
  const form = new ModalFormData()
    .title("Stalker - Ajustes")
    .slider("Intervalo de aparición (minutos)", 1, 30, 1, cfg.intervalMinutes)
    .slider("Volumen del sonido ambiente (%)", 0, 100, 5, cfg.ambientVolume)
    .slider("Segundos mirando antes de desaparecer", 1, 10, 1, cfg.noticeSeconds)
    .slider("Probabilidad de acecho (%)", 0, 100, 10, cfg.stalkChance)
    .slider("Segundos de ceguera al desaparecer", 0, 10, 1, cfg.blindnessSeconds);

  form.show(player).then((res) => {
    if (res.canceled || !res.formValues) return;
    const [intervalMinutes, ambientVolume, noticeSeconds, stalkChance, blindnessSeconds] = res.formValues;
    saveConfig({
      ...cfg,
      intervalMinutes,
      ambientVolume,
      noticeSeconds,
      stalkChance,
      blindnessSeconds
    });
    player.sendMessage("§aStalker: Ajustes guardados correctamente.");
  });
}

// Evento al usar el Reloj del Stalker
world.afterEvents.itemUse.subscribe((ev) => {
  const { source: player, itemStack } = ev;
  if (!itemStack || itemStack.typeId !== "stalkermod:stalker_watch") return;
  openSettingsUI(player);
});

// Comandos rápidos vía chat (!stalker stalk | watch | door | clear | config)
world.beforeEvents.chatSend.subscribe((ev) => {
  const msg = ev.message.trim();
  if (!msg.startsWith("!stalker")) return;
  ev.cancel = true;
  const player = ev.sender;
  const args = msg.split(/\s+/);
  const sub = (args[1] || "").toLowerCase();

  system.run(() => {
    if (!player.isOp()) {
      player.sendMessage("§cNecesitas permisos de operador.");
      return;
    }
    if (sub === "stalk") {
      const ok = spawnStalkerForPlayer(player, 0);
      player.sendMessage(ok ? "§7[Stalker] Acecho iniciado." : "§c[Stalker] No se encontró lugar válido.");
    } else if (sub === "watch") {
      const ok = spawnStalkerForPlayer(player, 2);
      player.sendMessage(ok ? "§7[Stalker] Observador generado." : "§c[Stalker] No se encontró lugar válido.");
    } else if (sub === "door") {
      const ok = spawnStalkerForPlayer(player, 1);
      player.sendMessage(ok ? "§7[Stalker] Evento de puerta ejecutado." : "§c[Stalker] No se encontró lugar válido.");
    } else if (sub === "clear") {
      let count = 0;
      for (const dimId of ["overworld", "nether", "the_end"]) {
        const dim = world.getDimension(dimId);
        for (const e of dim.getEntities({ type: "stalkermod:stalker" })) {
          e.remove();
          count++;
        }
      }
      activeStalkers.clear();
      player.sendMessage(`§7[Stalker] Eliminados ${count} stalkers.`);
    } else if (sub === "config") {
      openSettingsUI(player);
    } else {
      player.sendMessage("§eUso: !stalker <stalk|watch|door|clear|config>");
    }
  });
});

// Loop principal (cada 2 ticks = 10 veces por segundo)
system.runInterval(() => {
  const cfg = getConfig();
  const currentTick = system.currentTick;
  const players = world.getAllPlayers();

  // 1. Temporizador de aparición automática por jugador
  for (const player of players) {
    if (player.getGameMode() === "spectator") continue;
    let nextTick = playerTimers.get(player.id);
    if (nextTick === undefined) {
      playerTimers.set(player.id, currentTick + cfg.intervalMinutes * 60 * 20);
      continue;
    }
    if (currentTick >= nextTick) {
      playerTimers.set(player.id, currentTick + cfg.intervalMinutes * 60 * 20);
      if (randInt(1, 100) <= cfg.stalkChance) {
        const roll = Math.random();
        const mode = roll < 0.55 ? 0 : (roll < 0.85 ? 2 : 1);
        spawnStalkerForPlayer(player, mode);
      }
    }
  }

  // 2. Comportamiento de cada Stalker activo
  for (const [entityId, state] of activeStalkers.entries()) {
    const entity = world.getEntity(entityId);
    if (!entity || !entity.isValid()) {
      activeStalkers.delete(entityId);
      continue;
    }

    state.life += 2;
    const target = players.find((p) => p.id === state.targetId);

    // Despawn si el jugador se desconectó o pasó el tiempo máximo (60s)
    if (!target || !target.isValid() || state.life > 1200) {
      entity.remove();
      activeStalkers.delete(entityId);
      continue;
    }

    // Mirar siempre hacia el jugador objetivo
    const eLoc = entity.location;
    const pLoc = target.location;
    const yaw = (Math.atan2(-(pLoc.x - eLoc.x), pLoc.z - eLoc.z) * 180) / Math.PI;
    entity.setRotation({ x: 0, y: yaw });

    // Efecto de sonido en puerta en fase inicial
    if (state.mode === 1 && state.life % 20 === 0 && state.life <= 80) {
      entity.dimension.playSound("random.door_close", eLoc, { volume: 0.9, pitch: 0.55 });
    }

    // Verificar si el jugador lo está mirando
    const looking = isPlayerLookingAt(target, eLoc, 0.72);
    if (looking) {
      state.seenTicks += 2;

      if (!state.soundStarted && cfg.ambientVolume > 0) {
        state.soundStarted = true;
        target.playSound("stalkermod.stalker_stare", {
          volume: cfg.ambientVolume / 100,
          pitch: 1.0
        });
      }

      // Al superar noticeSeconds, desaparece y aplica ceguera/oscuridad breve
      if (state.seenTicks >= cfg.noticeSeconds * 20) {
        if (cfg.blindnessSeconds > 0) {
          target.addEffect("blindness", cfg.blindnessSeconds * 20, { amplifier: 0, showParticles: false });
          target.addEffect("darkness", cfg.blindnessSeconds * 20, { amplifier: 0, showParticles: false });
        }
        entity.remove();
        activeStalkers.delete(entityId);
      }
    }
  }
}, 2);
