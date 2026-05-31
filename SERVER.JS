const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const players = {};

let bombPickups = [];
let placedBombs = [];
let bombIdCounter = 1;

let territoryDirty = true;
let lastFullStateAt = 0;

const FULL_STATE_INTERVAL_MS = 2500;

const OWNER_SECRET_CODE = "135123543534563Prabhas";

const MAP_CENTER_X = 4000;
const MAP_CENTER_Y = 4000;
const MAP_RADIUS = 5800;

const PLAYER_RADIUS = 20;

const NORMAL_SPEED = 5;
const BOOST_SPEED = 9;
const OWNER_NORMAL_SPEED = 5.8;
const OWNER_BOOST_SPEED = 10.5;

const HEX_SIZE = 42;
const START_TILE_RADIUS = 2;
const MAX_TRAIL_TILES = 99999;

const ARENA_BORDER_SAFE_GAP = HEX_SIZE * 2.4;

const CAPTURE_PADDING = 80;
const MAX_CAPTURE_TILES = 100000;

const SCORE_PER_TILE = 5;
const KILL_SCORE = 250;

const SPAWN_SAFE_DISTANCE = 620;
const SPAWN_TRAIL_SAFE_RADIUS = 5;
const SPAWN_PROTECTION_MS = 2000;
const MAX_SPAWN_ATTEMPTS = 160;

const AI_LONG_TRAIL_MIN_LENGTH = 8;
const AI_LONG_TRAIL_ATTACK_RANGE = 1050;
const AI_ENEMY_NEAR_BOT_TRAIL_RANGE = 460;

const AI_LONG_TRAIL_FOR_BOMB = 7;
const AI_BOMB_THREAT_RANGE = 520;
const AI_BOMB_USE_COOLDOWN = 8500;
const AI_BOMB_AVOID_RADIUS = 430;

const BOMB_PICKUP_COUNT = 6;
const BOMB_PICKUP_RADIUS = 34;
const BOMB_PLACE_DELAY = 5000;
const BOMB_EXPLOSION_RADIUS = 270;
const BOMB_CAPTURE_RADIUS = 270;
const OWNER_INFINITE_BOMBS = 999999;

const HEX_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];

const AI_BOT_CONFIG = [
    {
        id: "ai_india",
        name: "😎 INDIA",
        color: "#ff8c00"
    },
    {
        id: "ai_raju",
        name: "RAJU",
        color: "#00ff66"
    }
];

function markTerritoryDirty() {
    territoryDirty = true;
}

function getLitePlayersState() {
    const lite = {};

    for (const id in players) {
        const p = players[id];

        if (!p) continue;

        lite[id] = {
            id: p.id,
            name: p.name,
            x: p.x,
            y: p.y,
            angle: p.angle,
            color: p.color,
            score: p.score,
            rank: p.rank,
            bombCount: p.bombCount,
            isOwner: p.isOwner,
            isAI: p.isAI,
            boosting: p.boosting,
            alive: p.alive,
            spawnProtectedUntil: p.spawnProtectedUntil,
            trailTiles: p.trailTiles || []
        };
    }

    return lite;
}

function updateRanks() {
    const alivePlayers = Object.values(players)
        .filter((p) => p && p.alive !== false && !p.isOwner)
        .sort((a, b) => b.score - a.score);

    for (const id in players) {
        const p = players[id];
        if (!p) continue;

        if (p.isOwner) {
            p.rank = "🌈 OWNER";
            p.bombCount = OWNER_INFINITE_BOMBS;
        } else {
            p.rank = "🎯 MEMBER";
        }
    }

    if (alivePlayers[0]) alivePlayers[0].rank = "👑 KING";
    if (alivePlayers[1]) alivePlayers[1].rank = "💎 LEGEND";
    if (alivePlayers[2]) alivePlayers[2].rank = "⭐ PRO";
}

function getPlayerSpeed(player) {
    if (player.isOwner) {
        return player.boosting ? OWNER_BOOST_SPEED : OWNER_NORMAL_SPEED;
    }

    return player.boosting ? BOOST_SPEED : NORMAL_SPEED;
}

function keepInsideCircle(player) {
    const dx = player.x - MAP_CENTER_X;
    const dy = player.y - MAP_CENTER_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const maxDist = MAP_RADIUS - PLAYER_RADIUS - ARENA_BORDER_SAFE_GAP;

    if (dist > maxDist) {
        const normalX = dx / dist;
        const normalY = dy / dist;

        player.x = MAP_CENTER_X + normalX * maxDist;
        player.y = MAP_CENTER_Y + normalY * maxDist;

        if (player.isAI) {
            player.angle += Math.PI * 0.9 + (Math.random() - 0.5);
            player.aiMode = "return";
            player.aiModeChangeAt = Date.now() + 1600;
        }
    }
}

function cubeRound(q, r) {
    let x = q;
    let z = r;
    let y = -x - z;

    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);

    const xDiff = Math.abs(rx - x);
    const yDiff = Math.abs(ry - y);
    const zDiff = Math.abs(rz - z);

    if (xDiff > yDiff && xDiff > zDiff) {
        rx = -ry - rz;
    } else if (yDiff > zDiff) {
        ry = -rx - rz;
    } else {
        rz = -rx - ry;
    }

    return { q: rx, r: rz };
}

function worldToHex(x, y) {
    const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / HEX_SIZE;
    const r = (2 / 3 * y) / HEX_SIZE;

    return cubeRound(q, r);
}

function hexToWorld(q, r) {
    return {
        x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
        y: HEX_SIZE * 1.5 * r
    };
}

function tileKey(q, r) {
    return `${q},${r}`;
}

function addTile(tileMap, q, r) {
    tileMap[tileKey(q, r)] = { q, r };
}

function isTileInsideMap(q, r) {
    const world = hexToWorld(q, r);
    const dx = world.x - MAP_CENTER_X;
    const dy = world.y - MAP_CENTER_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    return dist <= MAP_RADIUS - ARENA_BORDER_SAFE_GAP;
}

function makeStartTerritory(spawnX, spawnY) {
    const center = worldToHex(spawnX, spawnY);
    const tiles = {};

    for (let dq = -START_TILE_RADIUS; dq <= START_TILE_RADIUS; dq++) {
        for (let dr = -START_TILE_RADIUS; dr <= START_TILE_RADIUS; dr++) {
            const ds = -dq - dr;

            if (
                Math.abs(dq) <= START_TILE_RADIUS &&
                Math.abs(dr) <= START_TILE_RADIUS &&
                Math.abs(ds) <= START_TILE_RADIUS
            ) {
                const q = center.q + dq;
                const r = center.r + dr;

                if (isTileInsideMap(q, r)) {
                    addTile(tiles, q, r);
                }
            }
        }
    }

    return tiles;
}

function getRandomPointInsideArena() {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * (MAP_RADIUS - ARENA_BORDER_SAFE_GAP - 500);

    return {
        x: MAP_CENTER_X + Math.cos(angle) * distance,
        y: MAP_CENTER_Y + Math.sin(angle) * distance
    };
}

function createBombPickup() {
    const pos = getRandomPointInsideArena();

    return {
        id: "bomb_pickup_" + bombIdCounter++,
        x: pos.x,
        y: pos.y
    };
}

function keepBombPickupsFilled() {
    while (bombPickups.length < BOMB_PICKUP_COUNT) {
        bombPickups.push(createBombPickup());
    }
}

function getCurrentTile(player) {
    return worldToHex(player.x, player.y);
}

function isInsideOwnTerritory(player) {
    const current = getCurrentTile(player);
    const key = tileKey(current.q, current.r);

    return player.territoryTiles && player.territoryTiles[key];
}

function isNearAnyPlayer(x, y, ignoreId = null) {
    for (const id in players) {
        if (id === ignoreId) continue;

        const p = players[id];
        if (!p || p.alive === false) continue;

        const dist = Math.hypot(p.x - x, p.y - y);

        if (dist < SPAWN_SAFE_DISTANCE) {
            return true;
        }
    }

    return false;
}

function hasDangerNearSpawn(x, y, ignoreId = null) {
    const centerTile = worldToHex(x, y);

    for (const id in players) {
        if (id === ignoreId) continue;

        const p = players[id];
        if (!p || p.alive === false) continue;

        for (let dq = -SPAWN_TRAIL_SAFE_RADIUS; dq <= SPAWN_TRAIL_SAFE_RADIUS; dq++) {
            for (let dr = -SPAWN_TRAIL_SAFE_RADIUS; dr <= SPAWN_TRAIL_SAFE_RADIUS; dr++) {
                const q = centerTile.q + dq;
                const r = centerTile.r + dr;
                const key = tileKey(q, r);

                if (p.trailTileMap && p.trailTileMap[key]) return true;
                if (p.territoryTiles && p.territoryTiles[key]) return true;
            }
        }
    }

    return false;
}

function getSafeSpawn(ignoreId = null) {
    for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i++) {
        const spawn = getRandomPointInsideArena();
        const tile = worldToHex(spawn.x, spawn.y);

        if (!isTileInsideMap(tile.q, tile.r)) continue;
        if (isNearAnyPlayer(spawn.x, spawn.y, ignoreId)) continue;
        if (hasDangerNearSpawn(spawn.x, spawn.y, ignoreId)) continue;

        return spawn;
    }

    return getRandomPointInsideArena();
}

function addTrailTile(player) {
    const current = getCurrentTile(player);
    const key = tileKey(current.q, current.r);

    if (!isTileInsideMap(current.q, current.r)) return;
    if (player.territoryTiles[key]) return;

    if (!player.trailTileMap[key]) {
        player.trailTiles.push({
            q: current.q,
            r: current.r
        });

        player.trailTileMap[key] = true;

        if (player.trailTiles.length > MAX_TRAIL_TILES) {
            const removed = player.trailTiles.shift();
            delete player.trailTileMap[tileKey(removed.q, removed.r)];
        }
    }
}

function getCaptureBounds(player) {
    let minQ = Infinity;
    let maxQ = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;

    for (const tile of player.trailTiles) {
        minQ = Math.min(minQ, tile.q);
        maxQ = Math.max(maxQ, tile.q);
        minR = Math.min(minR, tile.r);
        maxR = Math.max(maxR, tile.r);
    }

    const current = getCurrentTile(player);
    minQ = Math.min(minQ, current.q);
    maxQ = Math.max(maxQ, current.q);
    minR = Math.min(minR, current.r);
    maxR = Math.max(maxR, current.r);

    return {
        minQ: minQ - CAPTURE_PADDING,
        maxQ: maxQ + CAPTURE_PADDING,
        minR: minR - CAPTURE_PADDING,
        maxR: maxR + CAPTURE_PADDING
    };
}

function isInBounds(q, r, bounds) {
    return q >= bounds.minQ && q <= bounds.maxQ && r >= bounds.minR && r <= bounds.maxR;
}

function isBoundaryTile(q, r, bounds) {
    return q === bounds.minQ || q === bounds.maxQ || r === bounds.minR || r === bounds.maxR;
}

function killPlayer(victimId, killerId, cause = "trail") {
    const victim = players[victimId];
    const killer = players[killerId];

    if (!victim || victim.alive === false) return;

    if (killer) {
        killer.score += KILL_SCORE;
    }

    const survivedMs = Date.now() - (victim.spawnTime || Date.now());
    const survivedSeconds = Math.floor(survivedMs / 1000);

    const killData = {
        victimName: victim.name,
        victimRank: victim.rank,
        killerName: killer ? killer.name : "Unknown",
        killerRank: killer ? killer.rank : "Unknown",
        score: victim.score,
        rank: victim.rank,
        timeSurvived: survivedSeconds,
        cause: cause
    };

    io.emit("deathEffect", {
        x: victim.x,
        y: victim.y,
        color: victim.color || "#ffffff",
        name: victim.name
    });

    victim.alive = false;
    victim.trailTiles = [];
    victim.trailTileMap = {};
    victim.territoryTiles = {};

    markTerritoryDirty();

    io.emit("killMessage", killData);

    if (victim.isAI) {
        setTimeout(() => {
            if (players[victimId]) {
                respawnAIPlayer(players[victimId]);
                updateRanks();
                io.emit("gameState", players);
                markTerritoryDirty();
            }
        }, 1800);
    } else {
        io.to(victimId).emit("playerDied", killData);
    }
}

function removeCapturedTilesFromEnemies(ownerId, capturedKeys) {
    let changed = false;

    for (const enemyId in players) {
        if (enemyId === ownerId) continue;

        const enemy = players[enemyId];
        if (!enemy || !enemy.territoryTiles) continue;

        let lost = 0;

        for (const key of capturedKeys) {
            if (enemy.territoryTiles[key]) {
                delete enemy.territoryTiles[key];
                lost++;
                changed = true;
            }
        }

        if (lost > 0) {
            enemy.score -= lost * SCORE_PER_TILE;
            if (enemy.score < 0) enemy.score = 0;
        }
    }

    if (changed) {
        markTerritoryDirty();
    }
}

function killPlayersInsideCapturedArea(ownerId, capturedKeys) {
    for (const enemyId in players) {
        if (enemyId === ownerId) continue;

        const enemy = players[enemyId];
        if (!enemy || enemy.alive === false) continue;

        if (Date.now() < (enemy.spawnProtectedUntil || 0)) continue;

        const enemyTile = getCurrentTile(enemy);
        const enemyKey = tileKey(enemyTile.q, enemyTile.r);

        if (capturedKeys.has(enemyKey)) {
            killPlayer(enemyId, ownerId, "capture");
        }
    }
}

function captureTrail(player) {
    if (!player.trailTiles || player.trailTiles.length < 2) {
        player.trailTiles = [];
        player.trailTileMap = {};
        return;
    }

    let captured = 0;
    const capturedKeys = new Set();

    const bounds = getCaptureBounds(player);
    bounds.minQ -= 80;
    bounds.maxQ += 80;
    bounds.minR -= 80;
    bounds.maxR += 80;

    const blockers = {};

    // Your old territory is wall
    for (const key in player.territoryTiles) {
        blockers[key] = true;
    }

    // Your trail is also wall
    for (const tile of player.trailTiles) {
        if (!isTileInsideMap(tile.q, tile.r)) continue;
        blockers[tileKey(tile.q, tile.r)] = true;
    }

    const outsideVisited = {};
    const queue = [];
    let queueIndex = 0;

    // Flood from outside edges of capture box
    for (let q = bounds.minQ; q <= bounds.maxQ; q++) {
        for (let r = bounds.minR; r <= bounds.maxR; r++) {
            if (q !== bounds.minQ && q !== bounds.maxQ && r !== bounds.minR && r !== bounds.maxR) continue;
            if (!isTileInsideMap(q, r)) continue;

            const key = tileKey(q, r);
            if (blockers[key] || outsideVisited[key]) continue;

            outsideVisited[key] = true;
            queue.push({ q, r });
        }
    }

    while (queueIndex < queue.length) {
        const current = queue[queueIndex++];

        for (const dir of HEX_DIRECTIONS) {
            const nq = current.q + dir.q;
            const nr = current.r + dir.r;

            if (nq < bounds.minQ || nq > bounds.maxQ || nr < bounds.minR || nr > bounds.maxR) continue;
            if (!isTileInsideMap(nq, nr)) continue;

            const key = tileKey(nq, nr);
            if (blockers[key] || outsideVisited[key]) continue;

            outsideVisited[key] = true;
            queue.push({ q: nq, r: nr });
        }
    }

    // Capture trail tiles
    for (const tile of player.trailTiles) {
        if (!isTileInsideMap(tile.q, tile.r)) continue;

        const key = tileKey(tile.q, tile.r);

        if (!player.territoryTiles[key]) captured++;

        player.territoryTiles[key] = { q: tile.q, r: tile.r };
        capturedKeys.add(key);
    }

    // Capture inside loop
    let filledAreaCount = 0;

    for (let q = bounds.minQ; q <= bounds.maxQ; q++) {
        for (let r = bounds.minR; r <= bounds.maxR; r++) {
            if (!isTileInsideMap(q, r)) continue;

            const key = tileKey(q, r);

            if (outsideVisited[key]) continue;
            if (player.territoryTiles[key]) continue;

            player.territoryTiles[key] = { q, r };
            capturedKeys.add(key);

            captured++;
            filledAreaCount++;

            if (filledAreaCount >= MAX_CAPTURE_TILES) break;
        }

        if (filledAreaCount >= MAX_CAPTURE_TILES) break;
    }

    removeCapturedTilesFromEnemies(player.id, capturedKeys);
    killPlayersInsideCapturedArea(player.id, capturedKeys);

    player.score += captured * SCORE_PER_TILE;

    player.trailTiles = [];
    player.trailTileMap = {};
    player.wasOutsideTerritory = false;

    markTerritoryDirty();
}

function captureBombArea(owner, bombX, bombY) {
    if (!owner || owner.alive === false) return;

    const centerTile = worldToHex(bombX, bombY);
    const radiusTiles = Math.ceil(BOMB_CAPTURE_RADIUS / HEX_SIZE) + 2;

    let captured = 0;
    const capturedKeys = new Set();

    for (let dq = -radiusTiles; dq <= radiusTiles; dq++) {
        for (let dr = -radiusTiles; dr <= radiusTiles; dr++) {
            const q = centerTile.q + dq;
            const r = centerTile.r + dr;

            if (!isTileInsideMap(q, r)) continue;

            const world = hexToWorld(q, r);
            const dist = Math.hypot(world.x - bombX, world.y - bombY);

            if (dist > BOMB_CAPTURE_RADIUS) continue;

            const key = tileKey(q, r);

            // Always make this tile owner's territory
            if (!owner.territoryTiles[key]) {
                captured++;
            }

            owner.territoryTiles[key] = { q, r };
            capturedKeys.add(key);
        }
    }

    // remove same tiles from enemies
    removeCapturedTilesFromEnemies(owner.id, capturedKeys);

    owner.score += captured * SCORE_PER_TILE;

    markTerritoryDirty();
}
function captureTrailUpToBomb(owner, bombX, bombY) {
    if (!owner || owner.alive === false) return;
    if (!owner.trailTiles || owner.trailTiles.length === 0) return;

    let closestIndex = -1;
    let closestDist = Infinity;

    for (let i = 0; i < owner.trailTiles.length; i++) {
        const tile = owner.trailTiles[i];
        const world = hexToWorld(tile.q, tile.r);
        const dist = Math.hypot(world.x - bombX, world.y - bombY);

        if (dist < closestDist) {
            closestDist = dist;
            closestIndex = i;
        }
    }

    if (closestIndex === -1) return;

    const capturedTrail = owner.trailTiles.slice(0, closestIndex + 1);
    const remainingTrail = owner.trailTiles.slice(closestIndex + 1);

    const capturedKeys = new Set();
    let captured = 0;

    for (const tile of capturedTrail) {
        if (!isTileInsideMap(tile.q, tile.r)) continue;

        const key = tileKey(tile.q, tile.r);

        if (!owner.territoryTiles[key]) {
            captured++;
        }

        owner.territoryTiles[key] = { q: tile.q, r: tile.r };
        capturedKeys.add(key);
    }

    removeCapturedTilesFromEnemies(owner.id, capturedKeys);

    owner.score += captured * SCORE_PER_TILE;

    owner.trailTiles = remainingTrail;
    owner.trailTileMap = {};

    for (const tile of remainingTrail) {
        owner.trailTileMap[tileKey(tile.q, tile.r)] = true;
    }

    owner.wasOutsideTerritory = remainingTrail.length > 0;

    markTerritoryDirty();
}
function explodeBomb(bomb) {
    const owner = players[bomb.ownerId];

    if (owner && owner.alive !== false) {
    captureBombArea(owner, bomb.x, bomb.y);
    captureTrailUpToBomb(owner, bomb.x, bomb.y);
}


    for (const id in players) {
        const p = players[id];

        if (!p || p.alive === false) continue;
        if (Date.now() < (p.spawnProtectedUntil || 0)) continue;

        const dist = Math.hypot(p.x - bomb.x, p.y - bomb.y);

        if (dist <= BOMB_EXPLOSION_RADIUS && id !== bomb.ownerId) {
            killPlayer(id, bomb.ownerId, "bomb");
        }
    }

    io.emit("bombExploded", {
        x: bomb.x,
        y: bomb.y,
        radius: BOMB_EXPLOSION_RADIUS
    });
}

function processPlacedBombs() {
    const now = Date.now();

    for (let i = placedBombs.length - 1; i >= 0; i--) {
        const bomb = placedBombs[i];

        if (now >= bomb.explodeAt) {
            placedBombs.splice(i, 1);
            explodeBomb(bomb);
        }
    }
}

function processBombPickups(player) {
    if (!player || player.alive === false) return;

    for (let i = bombPickups.length - 1; i >= 0; i--) {
        const bomb = bombPickups[i];
        const dist = Math.hypot(player.x - bomb.x, player.y - bomb.y);

        if (dist < BOMB_PICKUP_RADIUS + PLAYER_RADIUS) {
            if (!player.isOwner) {
                player.bombCount = (player.bombCount || 0) + 1;
            }

            bombPickups.splice(i, 1);
            bombPickups.push(createBombPickup());

            io.emit("bombPicked", {
                playerId: player.id,
                x: bomb.x,
                y: bomb.y
            });
        }
    }
}

function placeBomb(player) {
    if (!player || player.alive === false) return false;

    return placeBombAt(player, player.x, player.y);
}

function placeBombAt(player, x, y) {
    if (!player || player.alive === false) return false;

    if (!player.isOwner && (player.bombCount || 0) <= 0) return false;

    if (!player.isOwner) {
        player.bombCount--;
    } else {
        player.bombCount = OWNER_INFINITE_BOMBS;
    }

    placedBombs.push({
        id: "placed_bomb_" + bombIdCounter++,
        ownerId: player.id,
        x,
        y,
        placedAt: Date.now(),
        explodeAt: Date.now() + BOMB_PLACE_DELAY
    });

    return true;
}
function resetPlayer(player, socketId = null) {
    const spawn = getSafeSpawn(socketId);

    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = 0;
    player.boosting = false;
    player.wasOutsideTerritory = false;
    player.alive = true;
    player.spawnTime = Date.now();
    player.spawnProtectedUntil = Date.now() + SPAWN_PROTECTION_MS;

    player.score = 0;
    player.bombCount = player.isOwner ? OWNER_INFINITE_BOMBS : 1;
    player.trailTiles = [];
    player.trailTileMap = {};
    player.territoryTiles = makeStartTerritory(spawn.x, spawn.y);

    markTerritoryDirty();
}

function createAIPlayers() {
    for (const bot of AI_BOT_CONFIG) {
        if (players[bot.id]) continue;

        const spawn = getSafeSpawn(bot.id);

        players[bot.id] = {
            id: bot.id,
            name: bot.name,
            x: spawn.x,
            y: spawn.y,
            angle: Math.random() * Math.PI * 2,
            color: bot.color,
            score: 0,
            rank: "🎯 MEMBER",
            bombCount: 1,
            isOwner: false,
            isAI: true,
            boosting: false,
            wasOutsideTerritory: false,
            alive: true,
            spawnTime: Date.now(),
            spawnProtectedUntil: Date.now() + SPAWN_PROTECTION_MS,
            aiMode: "expand",
            aiTargetX: spawn.x,
            aiTargetY: spawn.y,
            aiModeChangeAt: Date.now() + 1000,
            aiLastBombAt: 0,
            territoryTiles: makeStartTerritory(spawn.x, spawn.y),
            trailTiles: [],
            trailTileMap: {}
        };

        markTerritoryDirty();
    }
}

function getNearestOwnTerritoryPoint(player) {
    let best = null;
    let bestDist = Infinity;

    for (const key in player.territoryTiles) {
        const tile = player.territoryTiles[key];
        const world = hexToWorld(tile.q, tile.r);
        const dist = Math.hypot(world.x - player.x, world.y - player.y);

        if (dist < bestDist) {
            bestDist = dist;
            best = world;
        }
    }

    return best;
}

function getRandomAIFarTarget(bot) {
    const baseAngle = bot.angle + (Math.random() - 0.5) * 1.2;
    const distance = 800 + Math.random() * 950;

    let targetX = bot.x + Math.cos(baseAngle) * distance;
    let targetY = bot.y + Math.sin(baseAngle) * distance;

    const dx = targetX - MAP_CENTER_X;
    const dy = targetY - MAP_CENTER_Y;
    const dist = Math.hypot(dx, dy);
    const maxDist = MAP_RADIUS - ARENA_BORDER_SAFE_GAP - 850;

    if (dist > maxDist) {
        targetX = MAP_CENTER_X + (dx / dist) * maxDist;
        targetY = MAP_CENTER_Y + (dy / dist) * maxDist;
    }

    return {
        x: targetX,
        y: targetY
    };
}

function getAIEnemyTrailTarget(bot) {
    let best = null;
    let bestDist = Infinity;
    let bestTrailLength = 0;

    for (const id in players) {
        if (id === bot.id) continue;

        const enemy = players[id];
        if (!enemy || enemy.alive === false || !enemy.trailTiles) continue;

        const trailLength = enemy.trailTiles.length;

        if (trailLength < AI_LONG_TRAIL_MIN_LENGTH) continue;

        for (const tile of enemy.trailTiles) {
            const world = hexToWorld(tile.q, tile.r);
            const dist = Math.hypot(world.x - bot.x, world.y - bot.y);

            if (dist < AI_LONG_TRAIL_ATTACK_RANGE) {
                const priority = trailLength * 1000 - dist;

                if (!best || priority > best.priority || trailLength > bestTrailLength) {
                    best = {
                        x: world.x,
                        y: world.y,
                        priority
                    };

                    bestDist = dist;
                    bestTrailLength = trailLength;
                }
            }
        }
    }

    if (!best) return null;

    return {
        x: best.x,
        y: best.y,
        distance: bestDist,
        trailLength: bestTrailLength
    };
}

function isEnemyNearBotTrail(bot) {
    if (!bot.trailTiles || bot.trailTiles.length === 0) return false;

    for (const id in players) {
        if (id === bot.id) continue;

        const enemy = players[id];
        if (!enemy || enemy.alive === false) continue;

        for (const tile of bot.trailTiles) {
            const world = hexToWorld(tile.q, tile.r);
            const dist = Math.hypot(world.x - enemy.x, world.y - enemy.y);

            if (dist < AI_ENEMY_NEAR_BOT_TRAIL_RANGE) {
                return true;
            }
        }
    }

    return false;
}

function getBotTrailThreat(bot) {
    if (!bot.trailTiles || bot.trailTiles.length < AI_LONG_TRAIL_FOR_BOMB) return null;

    let bestThreat = null;
    let bestDist = Infinity;

    for (const id in players) {
        if (id === bot.id) continue;

        const enemy = players[id];
        if (!enemy || enemy.alive === false) continue;

        for (const tile of bot.trailTiles) {
            const world = hexToWorld(tile.q, tile.r);
            const dist = Math.hypot(world.x - enemy.x, world.y - enemy.y);

            if (dist < AI_BOMB_THREAT_RANGE && dist < bestDist) {
                bestDist = dist;
                bestThreat = {
                    enemyId: id,
                    enemyX: enemy.x,
                    enemyY: enemy.y,
                    bombX: world.x,
                    bombY: world.y,
                    distance: dist
                };
            }
        }
    }

    return bestThreat;
}

function tryBotUseBomb(bot) {
    if (!bot || bot.alive === false) return false;
    if (!bot.isAI) return false;
    if ((bot.bombCount || 0) <= 0) return false;

    const now = Date.now();

    if (now - (bot.aiLastBombAt || 0) < AI_BOMB_USE_COOLDOWN) {
        return false;
    }

    const threat = getBotTrailThreat(bot);

    if (!threat) return false;

    const placed = placeBombAt(bot, threat.bombX, threat.bombY);

    if (placed) {
        bot.aiLastBombAt = now;

        const home = getNearestOwnTerritoryPoint(bot);

        if (home) {
            bot.aiMode = "emergencyReturn";
            bot.aiTargetX = home.x;
            bot.aiTargetY = home.y;
            bot.aiModeChangeAt = now + 1800;
        }

        return true;
    }

    return false;
}

function getNearestDangerBomb(player) {
    let nearest = null;
    let nearestDist = Infinity;

    for (const bomb of placedBombs) {
        const dist = Math.hypot(player.x - bomb.x, player.y - bomb.y);
        const timeLeft = bomb.explodeAt - Date.now();

        if (timeLeft <= 0) continue;

        if (dist < AI_BOMB_AVOID_RADIUS && dist < nearestDist) {
            nearestDist = dist;
            nearest = {
                bomb,
                dist,
                timeLeft
            };
        }
    }

    return nearest;
}

function makeBotAvoidBomb(bot, danger) {
    if (!danger || !danger.bomb) return false;

    const bomb = danger.bomb;
    const awayAngle = Math.atan2(bot.y - bomb.y, bot.x - bomb.x);

    let targetX = bot.x + Math.cos(awayAngle) * 650;
    let targetY = bot.y + Math.sin(awayAngle) * 650;

    const home = getNearestOwnTerritoryPoint(bot);

    if (home && danger.timeLeft < 2800) {
        targetX = home.x;
        targetY = home.y;
    }

    bot.aiMode = "avoidBomb";
    bot.aiTargetX = targetX;
    bot.aiTargetY = targetY;
    bot.aiModeChangeAt = Date.now() + 1300;
    bot.boosting = true;

    return true;
}

function isAIDangerNear(bot) {
    const current = getCurrentTile(bot);

    for (const id in players) {
        if (id === bot.id) continue;

        const enemy = players[id];
        if (!enemy || enemy.alive === false || !enemy.trailTileMap) continue;

        for (let dq = -3; dq <= 3; dq++) {
            for (let dr = -3; dr <= 3; dr++) {
                const key = tileKey(current.q + dq, current.r + dr);

                if (enemy.trailTileMap[key]) {
                    return true;
                }
            }
        }
    }

    return false;
}

function turnSmoothlyTo(bot, targetX, targetY, strength = 0.12) {
    const targetAngle = Math.atan2(targetY - bot.y, targetX - bot.x);

    let diff = targetAngle - bot.angle;

    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    bot.angle += diff * strength;
}

function updateAIPlayer(bot) {
    if (!bot || bot.alive === false) return;

    const now = Date.now();
    const insideOwn = isInsideOwnTerritory(bot);

    const dxFromCenter = bot.x - MAP_CENTER_X;
    const dyFromCenter = bot.y - MAP_CENTER_Y;
    const distFromCenter = Math.hypot(dxFromCenter, dyFromCenter);

    if (!bot.aiTargetX || !bot.aiTargetY) {
        const target = getRandomAIFarTarget(bot);
        bot.aiTargetX = target.x;
        bot.aiTargetY = target.y;
        bot.aiMode = "expand";
        bot.aiModeChangeAt = now + 1200;
    }

    const dangerBomb = getNearestDangerBomb(bot);

    if (dangerBomb) {
        makeBotAvoidBomb(bot, dangerBomb);
    }

    if (!insideOwn && bot.trailTiles.length >= AI_LONG_TRAIL_FOR_BOMB) {
        const usedBomb = tryBotUseBomb(bot);

        if (usedBomb) {
            return;
        }
    }

    if (!insideOwn && bot.trailTiles.length > 0 && isEnemyNearBotTrail(bot)) {
        const home = getNearestOwnTerritoryPoint(bot);

        if (home) {
            bot.aiMode = "emergencyReturn";
            bot.aiTargetX = home.x;
            bot.aiTargetY = home.y;
            bot.aiModeChangeAt = now + 1700;
        }
    }

    const enemyTrailTarget = getAIEnemyTrailTarget(bot);

    if (enemyTrailTarget && insideOwn && enemyTrailTarget.trailLength >= AI_LONG_TRAIL_MIN_LENGTH) {
        bot.aiMode = "huntTrail";
        bot.aiTargetX = enemyTrailTarget.x;
        bot.aiTargetY = enemyTrailTarget.y;
        bot.aiModeChangeAt = now + 1300;
    }

    if (
        enemyTrailTarget &&
        !insideOwn &&
        bot.trailTiles.length <= 4 &&
        enemyTrailTarget.trailLength >= AI_LONG_TRAIL_MIN_LENGTH + 2
    ) {
        bot.aiMode = "huntTrail";
        bot.aiTargetX = enemyTrailTarget.x;
        bot.aiTargetY = enemyTrailTarget.y;
        bot.aiModeChangeAt = now + 1200;
    }

    if (distFromCenter > MAP_RADIUS - ARENA_BORDER_SAFE_GAP - 780) {
        const target = getNearestOwnTerritoryPoint(bot);

        if (target) {
            bot.aiMode = "return";
            bot.aiTargetX = target.x;
            bot.aiTargetY = target.y;
            bot.aiModeChangeAt = now + 1900;
        } else {
            bot.aiTargetX = MAP_CENTER_X;
            bot.aiTargetY = MAP_CENTER_Y;
        }
    }

    if (isAIDangerNear(bot) && bot.aiMode !== "huntTrail" && bot.aiMode !== "avoidBomb") {
        const safe = getNearestOwnTerritoryPoint(bot);

        if (safe) {
            bot.aiMode = "emergencyReturn";
            bot.aiTargetX = safe.x;
            bot.aiTargetY = safe.y;
            bot.aiModeChangeAt = now + 1700;
        } else {
            bot.angle += Math.PI / 1.5;
        }
    }

    const distToTarget = Math.hypot(bot.aiTargetX - bot.x, bot.aiTargetY - bot.y);

    if (now > bot.aiModeChangeAt || distToTarget < 100) {
        if (!insideOwn && bot.trailTiles.length >= 11) {
            const home = getNearestOwnTerritoryPoint(bot);

            if (home) {
                bot.aiMode = "return";
                bot.aiTargetX = home.x;
                bot.aiTargetY = home.y;
                bot.aiModeChangeAt = now + 1900;
            }
        } else if (insideOwn) {
            const newEnemyTrailTarget = getAIEnemyTrailTarget(bot);

            if (newEnemyTrailTarget) {
                bot.aiMode = "huntTrail";
                bot.aiTargetX = newEnemyTrailTarget.x;
                bot.aiTargetY = newEnemyTrailTarget.y;
                bot.aiModeChangeAt = now + 1300;
            } else {
                const target = getRandomAIFarTarget(bot);

                bot.aiMode = "expand";
                bot.aiTargetX = target.x;
                bot.aiTargetY = target.y;
                bot.aiModeChangeAt = now + 2200 + Math.random() * 1200;
            }
        } else {
            const home = getNearestOwnTerritoryPoint(bot);

            if (home && Math.random() < 0.7) {
                bot.aiMode = "return";
                bot.aiTargetX = home.x;
                bot.aiTargetY = home.y;
            } else {
                const target = getRandomAIFarTarget(bot);
                bot.aiMode = "expand";
                bot.aiTargetX = target.x;
                bot.aiTargetY = target.y;
            }

            bot.aiModeChangeAt = now + 1500 + Math.random() * 900;
        }
    }

    if (bot.aiMode === "expand") {
        turnSmoothlyTo(bot, bot.aiTargetX, bot.aiTargetY, 0.09);
    } else if (bot.aiMode === "return") {
        turnSmoothlyTo(bot, bot.aiTargetX, bot.aiTargetY, 0.20);
    } else if (bot.aiMode === "emergencyReturn") {
        turnSmoothlyTo(bot, bot.aiTargetX, bot.aiTargetY, 0.30);
    } else if (bot.aiMode === "huntTrail") {
        turnSmoothlyTo(bot, bot.aiTargetX, bot.aiTargetY, 0.26);
    } else if (bot.aiMode === "avoidBomb") {
        turnSmoothlyTo(bot, bot.aiTargetX, bot.aiTargetY, 0.32);
    }

    bot.boosting =
        bot.aiMode === "return" ||
        bot.aiMode === "emergencyReturn" ||
        bot.aiMode === "huntTrail" ||
        bot.aiMode === "avoidBomb";
}

function respawnAIPlayer(bot) {
    const spawn = getSafeSpawn(bot.id);

    bot.x = spawn.x;
    bot.y = spawn.y;
    bot.angle = Math.random() * Math.PI * 2;
    bot.boosting = false;
    bot.wasOutsideTerritory = false;
    bot.alive = true;
    bot.spawnTime = Date.now();
    bot.spawnProtectedUntil = Date.now() + SPAWN_PROTECTION_MS;

    bot.score = 0;
    bot.bombCount = 1;
    bot.aiLastBombAt = 0;
    bot.trailTiles = [];
    bot.trailTileMap = {};
    bot.territoryTiles = makeStartTerritory(spawn.x, spawn.y);

    const target = getRandomAIFarTarget(bot);

    bot.aiMode = "expand";
    bot.aiTargetX = target.x;
    bot.aiTargetY = target.y;
    bot.aiModeChangeAt = Date.now() + 1200;

    markTerritoryDirty();
}

function checkTrailKills() {
    const ids = Object.keys(players);
    const deaths = [];

    for (const playerId of ids) {
        const player = players[playerId];
        if (!player || player.alive === false) continue;

        if (Date.now() < (player.spawnProtectedUntil || 0)) continue;

        const current = getCurrentTile(player);
        const currentKey = tileKey(current.q, current.r);

        for (const enemyId of ids) {
            if (enemyId === playerId) continue;

            const enemy = players[enemyId];
            if (!enemy || enemy.alive === false || !enemy.trailTileMap) continue;

            if (Date.now() < (enemy.spawnProtectedUntil || 0)) continue;

            if (enemy.trailTileMap[currentKey]) {
                deaths.push({
                    victimId: enemyId,
                    killerId: playerId
                });
                break;
            }
        }
    }

    const alreadyDead = {};

    for (const death of deaths) {
        if (alreadyDead[death.victimId]) continue;
        alreadyDead[death.victimId] = true;

        killPlayer(death.victimId, death.killerId, "trail");
    }
}

io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("joinGame", (data) => {
        const safeName = String(data.name || "Player")
            .replace(/[<>]/g, "")
            .substring(0, 16);

        const safeColor = /^#[0-9A-Fa-f]{6}$/.test(data.color)
            ? data.color
            : "#ff0000";

        const isOwner = data.ownerCode === OWNER_SECRET_CODE;

        const spawn = getSafeSpawn(socket.id);

        players[socket.id] = {
            id: socket.id,
            name: safeName,
            x: spawn.x,
            y: spawn.y,
            angle: 0,
            color: safeColor,
            score: 0,
            rank: isOwner ? "🌈 OWNER" : "🎯 MEMBER",
            bombCount: isOwner ? OWNER_INFINITE_BOMBS : 1,
            isOwner: isOwner,
            isAI: false,
            boosting: false,
            wasOutsideTerritory: false,
            alive: true,
            spawnTime: Date.now(),
            spawnProtectedUntil: Date.now() + SPAWN_PROTECTION_MS,
            territoryTiles: makeStartTerritory(spawn.x, spawn.y),
            trailTiles: [],
            trailTileMap: {}
        };

        updateRanks();
        markTerritoryDirty();

        socket.emit("mapInfo", {
            centerX: MAP_CENTER_X,
            centerY: MAP_CENTER_Y,
            radius: MAP_RADIUS,
            hexSize: HEX_SIZE
        });

        socket.emit("currentPlayers", players);
        socket.broadcast.emit("newPlayer", players[socket.id]);

        if (isOwner) {
            io.emit("ownerJoined", {
                name: safeName
            });
        }

        console.log("Player joined game:", safeName, isOwner ? "(OWNER)" : "");
    });

    socket.on("move", (data) => {
        if (players[socket.id] && typeof data.angle === "number") {
            players[socket.id].angle = data.angle;
        }
    });

    socket.on("boost", (data) => {
        if (players[socket.id]) {
            players[socket.id].boosting = data.boosting === true;
        }
    });

    socket.on("placeBomb", () => {
        const player = players[socket.id];

        if (!player || player.alive === false) return;

        placeBomb(player);
    });

    socket.on("playAgain", () => {
        if (!players[socket.id]) return;

        resetPlayer(players[socket.id], socket.id);
        updateRanks();

        socket.emit("currentPlayers", players);
    });

    socket.on("mainMenu", () => {
        if (players[socket.id]) {
            delete players[socket.id];
            updateRanks();
            markTerritoryDirty();
            io.emit("playerDisconnected", socket.id);
        }
    });

    socket.on("disconnect", () => {
        console.log("Socket disconnected:", socket.id);

        if (players[socket.id]) {
            delete players[socket.id];
            updateRanks();
            markTerritoryDirty();
            io.emit("playerDisconnected", socket.id);
        }
    });
});

setInterval(() => {
    createAIPlayers();
    keepBombPickupsFilled();

    for (const id in players) {
        const p = players[id];

        if (!p || p.alive === false) continue;

        if (p.isAI) {
            updateAIPlayer(p);
        }

        const speed = getPlayerSpeed(p);

        p.x += Math.cos(p.angle) * speed;
        p.y += Math.sin(p.angle) * speed;

        keepInsideCircle(p);

        const insideTerritory = isInsideOwnTerritory(p);

        if (!insideTerritory) {
            p.wasOutsideTerritory = true;
            addTrailTile(p);
        } else {
            if (p.wasOutsideTerritory) {
                captureTrail(p);
            }

            p.wasOutsideTerritory = false;
        }

        processBombPickups(p);
    }

    processPlacedBombs();
    checkTrailKills();
    updateRanks();

    if (Date.now() % 3 === 0) {
    io.emit("bombState", {
        pickups: bombPickups,
        placed: placedBombs
    });
    
}
        


    io.emit("gameStateLite", getLitePlayersState());

    const now = Date.now();

    if (territoryDirty || now - lastFullStateAt > FULL_STATE_INTERVAL_MS) {
        io.emit("gameState", players);
        territoryDirty = false;
        lastFullStateAt = now;
    }
}, 1000 / 20);

server.listen(3000, () => {
    createAIPlayers();
    keepBombPickupsFilled();
    markTerritoryDirty();
    console.log("Server running on http://localhost:3000");
});