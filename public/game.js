const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const homeScreen = document.getElementById("homeScreen");
const playBtn = document.getElementById("playBtn");
const nicknameInput = document.getElementById("nicknameInput");
const ownerBox = document.getElementById("ownerBox");
const ownerCodeInput = document.getElementById("ownerCodeInput");
const colorButtons = document.querySelectorAll(".colorBtn");
const previewPlayer = document.getElementById("previewPlayer");
const hud = document.getElementById("hud");
const scoreBox = document.getElementById("scoreBox");
const kingText = document.getElementById("kingText");
const tabList = document.getElementById("tabList");
const tabPlayers = document.getElementById("tabPlayers");

const deathScreen = document.getElementById("deathScreen");
const deathScore = document.getElementById("deathScore");
const deathRank = document.getElementById("deathRank");
const deathTime = document.getElementById("deathTime");
const deathMessage = document.getElementById("deathMessage");
const playAgainBtn = document.getElementById("playAgainBtn");
const mainMenuBtn = document.getElementById("mainMenuBtn");

const messageBox = document.getElementById("messageBox");
const mobileBoostBtn = document.getElementById("mobileBoostBtn");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const soundToggle = document.getElementById("soundToggle");
const minimapToggle = document.getElementById("minimapToggle");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let players = {};
let myId = null;
let joinedGame = false;
let selectedColor = "#ff0000";
let isBoosting = false;
let tabOpen = false;
let secretTyped = "";

let soundEnabled = true;
let minimapEnabled = true;

let audioCtx = null;
let musicStarted = false;
let musicTimer = null;

let camera = {
    x: 4000,
    y: 4000,
    ready: false
};

let previousTerritoryCounts = {};
let captureEffects = [];
let deathEffects = [];

let bombPickups = [];
let placedBombs = [];
let bombExplosions = [];
let bombTickMemory = {};

let screenShakePower = 0;
let screenShakeX = 0;
let screenShakeY = 0;

const MASTER_VOLUME = 3.8;
const MUSIC_VOLUME = 4.5;
const CLIENT_BOMB_CAPTURE_RADIUS = 270;

let mapInfo = {
    centerX: 4000,
    centerY: 4000,
    radius: 5800,
    hexSize: 42
};

/* BOMB + CONTROLS UI */
const bombBox = document.createElement("div");
bombBox.id = "bombBox";
bombBox.textContent = "💣 : 1";
bombBox.classList.add("hidden");
document.body.appendChild(bombBox);

const controlsBox = document.createElement("div");
controlsBox.id = "controlsBox";
controlsBox.classList.add("hidden");
controlsBox.innerHTML = `
    <div class="controlsTitle">CONTROLS</div>
    <div><span>SPACEBAR</span> : Bomb 💣</div>
    <div><span>Left Mouse Hold</span> : Accelerate ⚡</div>
    <div><span>TAB</span> : Players</div>
`;
document.body.appendChild(controlsBox);

const mobileBombBtn = document.createElement("button");
mobileBombBtn.id = "mobileBombBtn";
mobileBombBtn.textContent = "💣 1";
mobileBombBtn.classList.add("hidden");
document.body.appendChild(mobileBombBtn);

const settingsMainMenuBtn = document.createElement("button");
settingsMainMenuBtn.id = "settingsMainMenuBtn";
settingsMainMenuBtn.textContent = "Main Menu";

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }

    startBackgroundMusic();
}

function playTone(freq, duration, type = "sine", volume = 0.08, delay = 0) {
    if (!audioCtx || !soundEnabled) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    const start = audioCtx.currentTime + delay;
    const finalVolume = Math.min(volume * MASTER_VOLUME, 0.75);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(finalVolume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(start);
    osc.stop(start + duration);
}

function playNoise(duration = 0.12, volume = 0.06) {
    if (!audioCtx || !soundEnabled) return;

    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    const noise = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();

    const finalVolume = Math.min(volume * MASTER_VOLUME, 0.65);

    gain.gain.setValueAtTime(finalVolume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    noise.buffer = buffer;
    noise.connect(gain);
    gain.connect(audioCtx.destination);

    noise.start();
    noise.stop(audioCtx.currentTime + duration);
}

function playKillSound() {
    playTone(160, 0.10, "sawtooth", 0.13);
    playTone(520, 0.10, "square", 0.11, 0.04);
    playTone(820, 0.14, "square", 0.10, 0.10);
    playNoise(0.14, 0.08);
}

function playDeathSound() {
    playTone(250, 0.14, "sawtooth", 0.13);
    playTone(160, 0.20, "sawtooth", 0.12, 0.10);
    playTone(80, 0.28, "triangle", 0.10, 0.22);
}

function playOwnerSound() {
    playTone(520, 0.10, "sine", 0.10);
    playTone(700, 0.10, "sine", 0.10, 0.08);
    playTone(920, 0.12, "sine", 0.10, 0.16);
}

function playCaptureSound() {
    playTone(360, 0.10, "triangle", 0.11);
    playTone(520, 0.11, "triangle", 0.10, 0.08);
    playTone(760, 0.12, "triangle", 0.09, 0.16);
}

function playBombPickupSound() {
    playTone(620, 0.10, "triangle", 0.11);
    playTone(900, 0.12, "triangle", 0.10, 0.08);
}

function playBombPlaceSound() {
    playTone(180, 0.10, "square", 0.11);
    playTone(120, 0.12, "square", 0.10, 0.08);
}

function playBombExplosionSound() {
    playNoise(0.28, 0.16);
    playTone(90, 0.34, "sawtooth", 0.16);
    playTone(180, 0.20, "square", 0.12, 0.04);
}

function playBombTickSound(secondsLeft) {
    if (!audioCtx || !soundEnabled || !joinedGame) return;

    const freq = secondsLeft <= 2 ? 760 : 520;

    playTone(freq, 0.06, "square", 0.045);
    playTone(freq / 2, 0.05, "triangle", 0.025, 0.04);
}

function processBombTickSounds() {
    if (!joinedGame || !players[myId]) return;

    for (const bomb of placedBombs) {
        const timeLeft = Math.max(0, bomb.explodeAt - Date.now());
        const secondsLeft = Math.ceil(timeLeft / 1000);

        if (secondsLeft <= 0 || secondsLeft > 5) continue;

        const tickKey = bomb.id + "_" + secondsLeft;

        if (!bombTickMemory[tickKey]) {
            bombTickMemory[tickKey] = true;
            playBombTickSound(secondsLeft);
        }
    }
}

function startBackgroundMusic() {
    if (!audioCtx || musicStarted) return;

    musicStarted = true;

    const notes = [196, 220, 247, 294, 247, 220, 196, 165];
    let index = 0;

    musicTimer = setInterval(() => {
        if (!audioCtx || !soundEnabled || !joinedGame) return;

        const freq = notes[index % notes.length];

        playTone(freq, 0.24, "sine", 0.045 * MUSIC_VOLUME);
        playTone(freq / 2, 0.42, "triangle", 0.028 * MUSIC_VOLUME);

        if (index % 4 === 0) {
            playTone(98, 0.24, "sine", 0.035 * MUSIC_VOLUME);
        }

        index++;
    }, 420);
}

function stopBackgroundMusic() {
    musicStarted = false;

    if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
    }
}

function addScreenShake(power) {
    screenShakePower = Math.max(screenShakePower, power);
}

function updateScreenShake() {
    if (screenShakePower > 0.2) {
        screenShakeX = (Math.random() - 0.5) * screenShakePower;
        screenShakeY = (Math.random() - 0.5) * screenShakePower;
        screenShakePower *= 0.88;
    } else {
        screenShakePower = 0;
        screenShakeX = 0;
        screenShakeY = 0;
    }
}

socket.on("connect", () => {
    myId = socket.id;
});

socket.on("mapInfo", (data) => {
    mapInfo = data;
});

socket.on("currentPlayers", (data) => {
    players = data;
    previousTerritoryCounts = {};

    for (const id in players) {
        const p = players[id];
        previousTerritoryCounts[id] = p.territoryTiles ? Object.keys(p.territoryTiles).length : 0;
    }

    updateBombUI();
});

socket.on("newPlayer", (player) => {
    players[player.id] = player;
    previousTerritoryCounts[player.id] = player.territoryTiles ? Object.keys(player.territoryTiles).length : 0;
});

socket.on("playerDisconnected", (id) => {
    delete players[id];
    delete previousTerritoryCounts[id];
});

socket.on("deathEffect", (data) => {
    deathEffects.push({
        x: data.x,
        y: data.y,
        color: data.color || "#ffffff",
        name: data.name || "",
        startTime: Date.now()
    });
});

socket.on("bombState", (data) => {
    bombPickups = data.pickups || [];
    placedBombs = data.placed || [];

    updateBombUI();
    processBombTickSounds();
});

socket.on("bombPicked", (data) => {
    playBombPickupSound();

    captureEffects.push({
        x: data.x,
        y: data.y,
        color: "#ffcc00",
        startTime: Date.now(),
        amount: 1
    });
});

socket.on("bombExploded", (data) => {
    playBombExplosionSound();

    bombExplosions.push({
        x: data.x,
        y: data.y,
        radius: data.radius,
        startTime: Date.now()
    });

    const me = players[myId];

    if (me) {
        const dist = Math.hypot(me.x - data.x, me.y - data.y);

        if (dist < data.radius * 2.8) {
            const power = Math.max(6, 30 * (1 - dist / (data.radius * 2.8)));
            addScreenShake(power);
        }
    }
});

socket.on("gameStateLite", (data) => {
    for (const id in data) {
        const lite = data[id];

        if (!players[id]) {
            players[id] = lite;
        } else {
            players[id].x = lite.x;
            players[id].y = lite.y;
            players[id].angle = lite.angle;
            players[id].score = lite.score;
            players[id].rank = lite.rank;
            players[id].bombCount = lite.bombCount;
            players[id].boosting = lite.boosting;
            players[id].alive = lite.alive;
            players[id].spawnProtectedUntil = lite.spawnProtectedUntil;
            players[id].trailTiles = lite.trailTiles || [];

            players[id].name = lite.name;
            players[id].color = lite.color;
            players[id].isOwner = lite.isOwner;
            players[id].isAI = lite.isAI;
        }
    }

    for (const id in players) {
        if (!data[id]) {
            delete players[id];
            delete previousTerritoryCounts[id];
        }
    }

    if (players[myId]) {
        scoreBox.textContent = "Score: " + players[myId].score;
    }

    updateBombUI();
    updateKingText();

    if (tabOpen) {
        updateTabList();
    }
});
socket.on("gameState", (data) => {
    for (const id in data) {
        const p = data[id];
        const newCount = p.territoryTiles ? Object.keys(p.territoryTiles).length : 0;
        const oldCount = previousTerritoryCounts[id];

        if (oldCount !== undefined && newCount > oldCount + 2 && p.alive !== false) {
            captureEffects.push({
                x: p.x,
                y: p.y,
                color: getPlayerColor(p),
                startTime: Date.now(),
                amount: Math.min(newCount - oldCount, 300)
            });

            if (id === myId) {
                playCaptureSound();
            }
        }

        previousTerritoryCounts[id] = newCount;
    }

    players = data;

    if (players[myId]) {
        scoreBox.textContent = "Score: " + players[myId].score;
    }

    updateBombUI();
    updateKingText();

    if (tabOpen) {
        updateTabList();
    }
});

function updateGameOnlyUI() {
    const show = joinedGame && players[myId];

    bombBox.classList.toggle("hidden", !show);
    controlsBox.classList.toggle("hidden", !show);
    mobileBombBtn.classList.toggle("hidden", !show);
}

function updateBombUI() {
    updateGameOnlyUI();

    if (!joinedGame || !players[myId]) {
        bombBox.textContent = "💣 : 0";
        mobileBombBtn.textContent = "💣 0";
        bombBox.classList.remove("ownerBombBox");
        return;
    }

    const me = players[myId];
    const isOwner = me.rank && me.rank.includes("OWNER");

    if (isOwner) {
        bombBox.textContent = "💣 : ∞";
        mobileBombBtn.textContent = "💣 ∞";
        bombBox.classList.add("ownerBombBox");
    } else {
        const count = me.bombCount || 0;
        bombBox.textContent = "💣 : " + count;
        mobileBombBtn.textContent = "💣 " + count;
        bombBox.classList.remove("ownerBombBox");
    }
}

function showGameMessage(html) {
    if (!messageBox) return;

    const msg = document.createElement("div");
    msg.className = "gameMessage";
    msg.innerHTML = html;

    messageBox.appendChild(msg);

    setTimeout(() => {
        msg.remove();
    }, 3200);
}

function rankBadgeHTML(rank) {
    const safeRank = rank || "🎯 MEMBER";
    let extraClass = "";

    if (safeRank.includes("OWNER")) {
        extraClass = "ownerKill";
    } else if (safeRank.includes("KING")) {
        extraClass = "kingKill";
    }

    return `<span class="killRankBadge ${extraClass}">${safeRank}</span>`;
}

function playerKillText(rank, name) {
    return `${rankBadgeHTML(rank)} ${name || "Player"}`;
}

socket.on("ownerJoined", (data) => {
    playOwnerSound();
    showGameMessage(`🌈 <span class="ownerJoinBadge">OWNER</span> ${data.name} joined the game`);
});

socket.on("killMessage", (data) => {
    playKillSound();

    if (data.cause === "bomb") {
        showGameMessage(
            `💣 ${playerKillText(data.victimRank, data.victimName)} was blown up by ${playerKillText(data.killerRank, data.killerName)}`
        );
    } else if (data.cause === "capture") {
        showGameMessage(
            `⚔️ ${playerKillText(data.victimRank, data.victimName)} was trapped by ${playerKillText(data.killerRank, data.killerName)}`
        );
    } else {
        showGameMessage(
            `${playerKillText(data.victimRank, data.victimName)} was killed by ${playerKillText(data.killerRank, data.killerName)}`
        );
    }
});

socket.on("playerDied", (data) => {
    stopBackgroundMusic();
    playDeathSound();

    joinedGame = false;
    isBoosting = false;
    tabOpen = false;

    hud.classList.add("hidden");
    tabList.classList.add("hidden");
    deathScreen.classList.remove("hidden");

    updateGameOnlyUI();

    deathScore.textContent = data.score;
    deathRank.textContent = data.rank;
    deathTime.textContent = data.timeSurvived + "s";

    if (deathMessage) {
        if (data.cause === "bomb") {
            deathMessage.innerHTML =
                `💣 ${playerKillText(data.victimRank, data.victimName)} was blown up by ${playerKillText(data.killerRank, data.killerName)}`;
        } else if (data.cause === "capture") {
            deathMessage.innerHTML =
                `⚔️ ${playerKillText(data.victimRank, data.victimName)} was trapped by ${playerKillText(data.killerRank, data.killerName)}`;
        } else {
            deathMessage.innerHTML =
                `${playerKillText(data.victimRank, data.victimName)} was killed by ${playerKillText(data.killerRank, data.killerName)}`;
        }
    }
});

window.addEventListener("keydown", (e) => {
    if (joinedGame) return;

    const active = document.activeElement;
    const typingInInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");

    if (typingInInput) return;

    if (e.key.length === 1) {
        secretTyped += e.key.toUpperCase();

        if (secretTyped.length > 20) {
            secretTyped = secretTyped.slice(-20);
        }

        if (secretTyped.includes("OWNERPRABHAS")) {
            ownerBox.classList.remove("hidden");
            ownerCodeInput.focus();
            secretTyped = "";
        }
    }
});

function shadeColor(hex, percent) {
    if (!hex || !hex.startsWith("#") || hex.length !== 7) {
        hex = "#ff0000";
    }

    let r = parseInt(hex.substring(1, 3), 16);
    let g = parseInt(hex.substring(3, 5), 16);
    let b = parseInt(hex.substring(5, 7), 16);

    r = Math.min(255, Math.max(0, r + Math.round((percent / 100) * 255)));
    g = Math.min(255, Math.max(0, g + Math.round((percent / 100) * 255)));
    b = Math.min(255, Math.max(0, b + Math.round((percent / 100) * 255)));

    return `rgb(${r}, ${g}, ${b})`;
}

function updateHomeColor(color) {
    selectedColor = color;

    const shiny = `radial-gradient(circle at 30% 30%, ${shadeColor(color, 28)}, ${color} 55%, ${shadeColor(color, -28)} 100%)`;

    previewPlayer.style.background = shiny;
    previewPlayer.style.boxShadow = `0 0 30px ${color}`;
}

colorButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        colorButtons.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        updateHomeColor(btn.dataset.color);
    });
});

updateHomeColor(selectedColor);

playBtn.addEventListener("click", () => {
    initAudio();

    let nickname = nicknameInput.value.trim();

    if (nickname.length < 1) {
        nickname = "Player";
    }

    socket.emit("joinGame", {
        name: nickname,
        color: selectedColor,
        ownerCode: ownerCodeInput.value.trim()
    });

    joinedGame = true;
    isBoosting = false;
    camera.ready = false;

    homeScreen.classList.add("hidden");
    deathScreen.classList.add("hidden");
    hud.classList.remove("hidden");

    updateGameOnlyUI();
    updateBombUI();
});

playAgainBtn.addEventListener("click", () => {
    initAudio();

    deathScreen.classList.add("hidden");
    hud.classList.remove("hidden");

    joinedGame = true;
    isBoosting = false;
    camera.ready = false;

    socket.emit("playAgain");

    updateGameOnlyUI();
    updateBombUI();
});

function goToMainMenu() {
    stopBackgroundMusic();

    settingsPanel.classList.add("hidden");
    deathScreen.classList.add("hidden");
    homeScreen.classList.remove("hidden");
    hud.classList.add("hidden");
    tabList.classList.add("hidden");

    joinedGame = false;
    isBoosting = false;
    tabOpen = false;
    players = {};
    camera.ready = false;

    socket.emit("mainMenu");

    updateBombUI();
    updateGameOnlyUI();
}

mainMenuBtn.addEventListener("click", () => {
    goToMainMenu();
});

if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
        settingsPanel.classList.remove("hidden");
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", () => {
        settingsPanel.classList.add("hidden");
    });
}

if (settingsPanel && settingsMainMenuBtn) {
    settingsPanel.appendChild(settingsMainMenuBtn);

    settingsMainMenuBtn.addEventListener("click", () => {
        goToMainMenu();
    });
}

if (soundToggle) {
    soundToggle.addEventListener("click", () => {
        soundEnabled = !soundEnabled;

        soundToggle.textContent = soundEnabled ? "ON" : "OFF";
        soundToggle.classList.toggle("off", !soundEnabled);

        if (!soundEnabled) {
            stopBackgroundMusic();
        } else {
            initAudio();
        }
    });
}

if (minimapToggle) {
    minimapToggle.addEventListener("click", () => {
        minimapEnabled = !minimapEnabled;

        minimapToggle.textContent = minimapEnabled ? "ON" : "OFF";
        minimapToggle.classList.toggle("off", !minimapEnabled);
    });
}

function getOwnerPlayer() {
    const alivePlayers = Object.values(players).filter((p) => p && p.alive !== false);
    return alivePlayers.find((p) => p.rank && p.rank.includes("OWNER")) || null;
}

function getSortedPlayers() {
    return Object.values(players)
        .filter((p) => p && p.alive !== false)
        .sort((a, b) => {
            if (a.rank.includes("OWNER") && !b.rank.includes("OWNER")) return -1;
            if (!a.rank.includes("OWNER") && b.rank.includes("OWNER")) return 1;
            return b.score - a.score;
        });
}

function createRankBadge(rank) {
    const rankBadge = document.createElement("span");
    rankBadge.className = "rankBadge";

    if (rank.includes("OWNER")) rankBadge.classList.add("ownerBadge");
    else if (rank.includes("KING")) rankBadge.classList.add("kingBadge");
    else if (rank.includes("LEGEND")) rankBadge.classList.add("legendBadge");
    else if (rank.includes("PRO")) rankBadge.classList.add("proBadge");
    else rankBadge.classList.add("memberBadge");

    rankBadge.textContent = rank;
    return rankBadge;
}

function updateTabList() {
    const sorted = getSortedPlayers().slice(0, 30);

    tabPlayers.innerHTML = "";

    sorted.forEach((p, index) => {
        const row = document.createElement("div");
        row.className = "tabRow";

        if (index === 0) row.classList.add("rank1");
        else if (index === 1) row.classList.add("rank2");
        else if (index === 2) row.classList.add("rank3");
        else if (index < 10) row.classList.add("rankTop10");

        const place = document.createElement("div");
        place.className = "tabPlace";
        place.textContent = index + 1 + ".";

        const name = document.createElement("div");
        name.className = "tabName";

        const rankBadge = createRankBadge(p.rank);

        const playerName = document.createElement("span");
        playerName.className = "playerNameText";
        playerName.textContent = p.name;

        name.appendChild(rankBadge);
        name.appendChild(playerName);

        const score = document.createElement("div");
        score.className = "tabScore";
        score.textContent = p.score;

        row.appendChild(place);
        row.appendChild(name);
        row.appendChild(score);

        tabPlayers.appendChild(row);
    });
}

function getKingPlayer() {
    let king = null;

    for (const id in players) {
        const p = players[id];
        if (!p || p.alive === false || p.rank.includes("OWNER")) continue;

        if (!king || p.score > king.score) {
            king = p;
        }
    }

    return king;
}

function updateKingText() {
    const king = getKingPlayer();

    if (king) {
        kingText.textContent = `👑 Current KING: ${king.name}`;
    } else {
        kingText.textContent = "👑 No KING yet";
    }
}

function getPersistentLeaderboardPlayers() {
    const alivePlayers = Object.values(players)
        .filter((p) => p && p.alive !== false);

    const owner = getOwnerPlayer();

    const result = [];
    const used = new Set();

    if (owner) {
        result.push(owner);
        used.add(owner.id);
    }

    const rest = alivePlayers
        .filter((p) => !used.has(p.id))
        .sort((a, b) => b.score - a.score);

    for (const p of rest) {
        if (result.length >= 10) break;
        result.push(p);
    }

    return result.slice(0, 10);
}

function sendBoost(value) {
    if (!joinedGame) return;
    if (isBoosting === value) return;

    isBoosting = value;
    socket.emit("boost", { boosting: value });
}

function placeMyBomb() {
    if (!joinedGame) return;
    if (!players[myId]) return;

    const me = players[myId];
    const isOwner = me.rank && me.rank.includes("OWNER");

    if (!isOwner && (me.bombCount || 0) <= 0) return;

    playBombPlaceSound();
    socket.emit("placeBomb");
}

let lastMoveSend = 0;

window.addEventListener("mousemove", (e) => {
    if (!joinedGame) return;

    const angle = Math.atan2(
        e.clientY - canvas.height / 2,
        e.clientX - canvas.width / 2
    );

    // instantly update your own player locally
    if (players[myId]) {
        players[myId].angle = angle;
    }

    // do not spam server too much
    const now = Date.now();
    if (now - lastMoveSend > 33) {
        socket.emit("move", { angle });
        lastMoveSend = now;
    }
});

window.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
        sendBoost(true);
    }
});

window.addEventListener("mouseup", (e) => {
    if (e.button === 0) {
        sendBoost(false);
    }
});

window.addEventListener("keydown", (e) => {
    if (!joinedGame) return;

    if (e.code === "Space") {
        e.preventDefault();
        placeMyBomb();
    }
});

if (mobileBombBtn) {
    mobileBombBtn.addEventListener("click", () => {
        placeMyBomb();
    });
}

if (mobileBoostBtn) {
    mobileBoostBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        mobileBoostBtn.classList.add("boosting");
        sendBoost(true);
    }, { passive: false });

    mobileBoostBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        mobileBoostBtn.classList.remove("boosting");
        sendBoost(false);
    }, { passive: false });

    mobileBoostBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        mobileBoostBtn.classList.add("boosting");
        sendBoost(true);
    });

    mobileBoostBtn.addEventListener("mouseup", (e) => {
        e.preventDefault();
        mobileBoostBtn.classList.remove("boosting");
        sendBoost(false);
    });

    mobileBoostBtn.addEventListener("mouseleave", () => {
        mobileBoostBtn.classList.remove("boosting");
        sendBoost(false);
    });
}

window.addEventListener("keydown", (e) => {
    if (e.code === "Tab" && joinedGame) {
        e.preventDefault();
        tabOpen = true;
        tabList.classList.remove("hidden");
        updateTabList();
    }
});

window.addEventListener("keyup", (e) => {
    if (e.code === "Tab") {
        e.preventDefault();
        tabOpen = false;
        tabList.classList.add("hidden");
    }
});

window.addEventListener("touchmove", (e) => {
    if (!joinedGame) return;

    e.preventDefault();

    const touch = e.touches[0];

    const angle = Math.atan2(
        touch.clientY - canvas.height / 2,
        touch.clientX - canvas.width / 2
    );

    socket.emit("move", { angle });
}, { passive: false });

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

function updateCamera(me) {
    camera.x = me.x;
    camera.y = me.y;
    camera.ready = true;
}

function worldToScreen(x, y) {
    return {
        x: Math.round(x - camera.x + canvas.width / 2 + screenShakeX),
        y: Math.round(y - camera.y + canvas.height / 2 + screenShakeY)
    };
}

function hexToWorld(q, r) {
    return {
        x: mapInfo.hexSize * Math.sqrt(3) * (q + r / 2),
        y: mapInfo.hexSize * 1.5 * r
    };
}

function isOwnerPlayer(p) {
    return p.rank && p.rank.includes("OWNER");
}

function rainbowColor(offset = 0) {
    return `hsl(${(Date.now() / 14 + offset) % 360}, 100%, 60%)`;
}

function getPlayerColor(p) {
    return p.color || "#ff0000";
}
function drawHex(cx, cy, size) {
    ctx.beginPath();

    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (60 * i - 30);
        const x = cx + size * Math.cos(angle);
        const y = cy + size * Math.sin(angle);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.closePath();
}

function drawRoundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawBombPickups() {
    ctx.save();

    for (const bomb of bombPickups) {
        const pos = worldToScreen(bomb.x, bomb.y);
        const pulse = 1 + Math.sin(Date.now() / 160) * 0.12;

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.scale(pulse, pulse);

        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 210, 0, 0.18)";
        ctx.shadowBlur = 22;
        ctx.shadowColor = "#ffcc00";
        ctx.fill();

        ctx.font = "30px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowBlur = 18;
        ctx.shadowColor = "#ffcc00";
        ctx.fillText("💣", 0, 0);

        ctx.restore();
    }

    ctx.restore();
}

function drawPlacedBombs() {
    ctx.save();

    for (const bomb of placedBombs) {
        const pos = worldToScreen(bomb.x, bomb.y);
        const timeLeft = Math.max(0, bomb.explodeAt - Date.now());
        const seconds = Math.max(1, Math.min(5, Math.ceil(timeLeft / 1000)));
        const progress = 1 - timeLeft / 5000;

        const flicker = 0.22 + Math.sin(Date.now() / 80) * 0.12;
        const ringPulse = 1 + Math.sin(Date.now() / 120) * 0.04;

        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, CLIENT_BOMB_CAPTURE_RADIUS * ringPulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 180, 0, ${flicker})`;
        ctx.shadowBlur = 30;
        ctx.shadowColor = "#ff9900";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, CLIENT_BOMB_CAPTURE_RADIUS * ringPulse, 0, Math.PI * 2);
        ctx.strokeStyle = seconds <= 2
            ? "rgba(255, 30, 30, 0.95)"
            : "rgba(255, 210, 0, 0.75)";
        ctx.lineWidth = seconds <= 2 ? 5 : 3;
        ctx.shadowBlur = 24;
        ctx.shadowColor = seconds <= 2 ? "#ff003c" : "#ffcc00";
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = seconds <= 2
            ? "rgba(255, 0, 60, 0.95)"
            : "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 5;
        ctx.shadowBlur = 16;
        ctx.shadowColor = seconds <= 2 ? "#ff003c" : "#ffffff";
        ctx.stroke();
        ctx.restore();

        const pulse = 1 + Math.sin(Date.now() / 90) * 0.18;

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.scale(pulse, pulse);

        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fillStyle = seconds <= 2
            ? "rgba(255, 0, 60, 0.32)"
            : "rgba(255, 0, 60, 0.22)";
        ctx.shadowBlur = 28;
        ctx.shadowColor = "#ff003c";
        ctx.fill();

        ctx.font = "34px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowBlur = 18;
        ctx.shadowColor = "#ff003c";
        ctx.fillText("💣", 0, 0);

        ctx.font = "bold 17px Arial";
        ctx.fillStyle = seconds <= 2 ? "#ffdddd" : "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;
        ctx.strokeText(String(seconds), 0, -42);
        ctx.fillText(String(seconds), 0, -42);

        ctx.restore();
    }

    ctx.restore();
}

function drawBombExplosions() {
    const now = Date.now();

    bombExplosions = bombExplosions.filter((explosion) => {
        return now - explosion.startTime < 900;
    });

    for (const explosion of bombExplosions) {
        const age = now - explosion.startTime;
        const progress = age / 900;
        const pos = worldToScreen(explosion.x, explosion.y);

        ctx.save();

        ctx.globalAlpha = 1 - progress;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, explosion.radius * progress, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 120, 0, 0.24)";
        ctx.shadowBlur = 40;
        ctx.shadowColor = "#ff6600";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, explosion.radius * progress, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.font = "bold 26px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 5;
        ctx.strokeText("BOOM!", pos.x, pos.y - 20 - progress * 30);
        ctx.fillText("BOOM!", pos.x, pos.y - 20 - progress * 30);

        ctx.restore();
    }
}

function drawRankNameLabel(p, pos) {
    const rankText = p.rank || "🎯 MEMBER";
    const nameText = p.name || "Player";

    ctx.save();

    ctx.font = "bold 13px Arial";
    const rankWidth = ctx.measureText(rankText).width + 16;

    ctx.font = "bold 14px Arial";
    const nameWidth = ctx.measureText(nameText).width + 12;

    const totalWidth = rankWidth + nameWidth;
    const height = 24;
    const x = Math.round(pos.x - totalWidth / 2);
    const y = Math.round(pos.y - 46);

    let badgeFill = "rgba(255,255,255,0.16)";
    let badgeStroke = "rgba(255,255,255,0.35)";
    let badgeText = "white";
    let glow = "rgba(255,255,255,0.25)";

    if (rankText.includes("OWNER")) {
        badgeFill = "rgba(255, 0, 200, 0.48)";
        badgeStroke = rainbowColor(140);
        badgeText = "white";
        glow = rainbowColor(220);
    } else if (rankText.includes("KING")) {
        badgeFill = "rgba(255, 215, 0, 0.9)";
        badgeStroke = "rgba(255, 255, 255, 0.9)";
        badgeText = "#1c1200";
        glow = "rgba(255, 215, 0, 1)";
    } else if (rankText.includes("LEGEND")) {
        badgeFill = "rgba(0, 234, 255, 0.85)";
        badgeStroke = "rgba(255, 255, 255, 0.85)";
        badgeText = "#001014";
        glow = "rgba(0, 234, 255, 1)";
    } else if (rankText.includes("PRO")) {
        badgeFill = "rgba(255, 242, 0, 0.85)";
        badgeStroke = "rgba(255,255,255,0.8)";
        badgeText = "#1c1600";
        glow = "rgba(255, 242, 0, 1)";
    } else {
        badgeFill = "rgba(255,255,255,0.16)";
        badgeStroke = "rgba(255,255,255,0.45)";
        glow = "rgba(255,255,255,0.55)";
    }

    drawRoundedRect(x, y, totalWidth, height, 8);
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fill();

    drawRoundedRect(x, y, rankWidth, height, 8);
    ctx.fillStyle = badgeFill;
    ctx.shadowBlur = 18;
    ctx.shadowColor = glow;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.7;
    ctx.strokeStyle = badgeStroke;
    ctx.stroke();

    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = badgeText;
    ctx.fillText(rankText, Math.round(x + rankWidth / 2), Math.round(y + height / 2));

    ctx.font = "bold 14px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 3;

    ctx.strokeText(nameText, Math.round(x + rankWidth + 6), Math.round(y + height / 2));
    ctx.fillText(nameText, Math.round(x + rankWidth + 6), Math.round(y + height / 2));

    ctx.restore();
}

function drawBackground() {
    ctx.fillStyle = "#03040a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const center = worldToScreen(mapInfo.centerX, mapInfo.centerY);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(center.x, center.y, mapInfo.radius, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fill("evenodd");
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, mapInfo.radius, 0, Math.PI * 2);
    ctx.clip();

    const gradient = ctx.createRadialGradient(
        center.x,
        center.y,
        100,
        center.x,
        center.y,
        mapInfo.radius
    );
    gradient.addColorStop(0, "#101f44");
    gradient.addColorStop(0.55, "#0b1230");
    gradient.addColorStop(1, "#070914");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gridSize = 80;
    const offsetX = Math.round(-camera.x % gridSize);
    const offsetY = Math.round(-camera.y % gridSize);

    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;

    for (let x = offsetX; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let y = offsetY; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, mapInfo.radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 234, 255, 0.95)";
    ctx.lineWidth = 6;
    ctx.shadowBlur = 28;
    ctx.shadowColor = "#00eaff";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center.x, center.y, mapInfo.radius - 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(157, 0, 255, 0.55)";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#9d00ff";
    ctx.stroke();
    ctx.restore();
}

function drawTerritoryTiles(p) {
    if (!p.territoryTiles || p.alive === false) return;

    const color = getPlayerColor(p);

    ctx.save();

    for (const key in p.territoryTiles) {
        const tile = p.territoryTiles[key];
        const world = hexToWorld(tile.q, tile.r);
        const pos = worldToScreen(world.x, world.y);

        drawHex(pos.x, pos.y, mapInfo.hexSize + 1.2);

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.82;
        ctx.fill();
    }

    for (const key in p.territoryTiles) {
        const tile = p.territoryTiles[key];
        const world = hexToWorld(tile.q, tile.r);
        const pos = worldToScreen(world.x, world.y);

        drawHex(pos.x, pos.y, mapInfo.hexSize - 1);

        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.stroke();
    }

    ctx.restore();
}

function drawTrailTiles(p) {
    if (!p.trailTiles || p.trailTiles.length === 0 || p.alive === false) return;

    ctx.save();

    for (let i = 0; i < p.trailTiles.length; i++) {
        const tile = p.trailTiles[i];
        const world = hexToWorld(tile.q, tile.r);
        const pos = worldToScreen(world.x, world.y);

        const color = p.color || "#ff0000";
            
          

        drawHex(pos.x, pos.y, mapInfo.hexSize - 3);

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.95;
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 14;
        ctx.shadowColor = color;
        ctx.stroke();
    }

    ctx.restore();
}

function isSpawnProtected(p) {
    if (!p || !p.spawnProtectedUntil) return false;

    const timeLeft = p.spawnProtectedUntil - Date.now();

    return timeLeft > 0 && timeLeft <= 5000;
}

function drawSpawnProtection(pos, p) {
    if (!isSpawnProtected(p)) return;

    const timeLeft = p.spawnProtectedUntil - Date.now();

if (timeLeft <= 0 || timeLeft > 5000) return;
    const pulse = 0.55 + Math.sin(Date.now() / 90) * 0.25;

    ctx.save();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 44 + pulse * 8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 4;
    ctx.shadowBlur = 28;
    ctx.shadowColor = "#ffffff";
    ctx.globalAlpha = pulse;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 35, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,234,255,0.85)";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00eaff";
    ctx.stroke();

    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 3;

    const seconds = Math.ceil(timeLeft / 1000);
    ctx.strokeText(`SAFE`, pos.x, pos.y + 48);
    ctx.fillText(`SAFE`, pos.x, pos.y + 48);
   

    ctx.restore();
}
function drawCaptureEffects() {
    const now = Date.now();

    captureEffects = captureEffects.filter((effect) => {
        const age = now - effect.startTime;
        return age < 850;
    });

    for (const effect of captureEffects) {
        const age = now - effect.startTime;
        const progress = age / 850;
        const pos = worldToScreen(effect.x, effect.y);

        ctx.save();

        ctx.globalAlpha = 1 - progress;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 40 + progress * 170, 0, Math.PI * 2);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 6;
        ctx.shadowBlur = 35;
        ctx.shadowColor = effect.color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 22 + progress * 100, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 3;
        ctx.shadowBlur = 25;
        ctx.shadowColor = "#ffffff";
        ctx.stroke();

        ctx.font = "bold 18px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;

        const text = effect.amount === 1 ? "+💣" : `+${effect.amount * 5}`;
        ctx.globalAlpha = 1 - progress;
        ctx.strokeText(text, pos.x, pos.y - 42 - progress * 40);
        ctx.fillText(text, pos.x, pos.y - 42 - progress * 40);

        ctx.restore();
    }
}

function drawDeathEffects() {
    const now = Date.now();

    deathEffects = deathEffects.filter((effect) => {
        return now - effect.startTime < 1000;
    });

    for (const effect of deathEffects) {
        const age = now - effect.startTime;
        const progress = age / 1000;
        const pos = worldToScreen(effect.x, effect.y);

        ctx.save();

        ctx.globalAlpha = 1 - progress;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 25 + progress * 110, 0, Math.PI * 2);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 6;
        ctx.shadowBlur = 35;
        ctx.shadowColor = effect.color;
        ctx.stroke();

        for (let i = 0; i < 16; i++) {
            const angle = (Math.PI * 2 / 16) * i;
            const distance = progress * 95;
            const px = pos.x + Math.cos(angle) * distance;
            const py = pos.y + Math.sin(angle) * distance;

            ctx.beginPath();
            ctx.arc(px, py, 5 * (1 - progress), 0, Math.PI * 2);
            ctx.fillStyle = effect.color;
            ctx.shadowBlur = 18;
            ctx.shadowColor = effect.color;
            ctx.fill();
        }

        ctx.font = "bold 18px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;

        ctx.strokeText("ELIMINATED", pos.x, pos.y - 45 - progress * 25);
        ctx.fillText("ELIMINATED", pos.x, pos.y - 45 - progress * 25);

        ctx.restore();
    }
}

function drawOwnerPlayer(pos, p) {
    const time = Date.now();
    const glowColor = rainbowColor(120);

    ctx.save();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.boosting ? 31 : 28, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fill();

    ctx.shadowBlur = p.boosting ? 50 : 36;
    ctx.shadowColor = glowColor;

    const gradient = ctx.createConicGradient(time / 600, pos.x, pos.y);
    gradient.addColorStop(0.00, "#ff004c");
    gradient.addColorStop(0.16, "#ff8c00");
    gradient.addColorStop(0.32, "#ffe600");
    gradient.addColorStop(0.48, "#00ff66");
    gradient.addColorStop(0.64, "#00eaff");
    gradient.addColorStop(0.80, "#9d00ff");
    gradient.addColorStop(1.00, "#ff004c");

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.boosting ? 26 : 23, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.boosting ? 36 : 32, 0, Math.PI * 2);
    ctx.strokeStyle = glowColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(pos.x - 8, pos.y - 8, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();

    ctx.restore();
}

function drawNormalPlayer(pos, p) {
    ctx.save();

    const mainColor = p.color || "#ff0000";
    const lightColor = shadeColor(mainColor, 25);
    const darkColor = shadeColor(mainColor, -25);

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.boosting ? 30 : 27, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fill();

    ctx.shadowBlur = p.boosting ? 46 : 30;
    ctx.shadowColor = mainColor;

    const bodyGradient = ctx.createRadialGradient(
        pos.x - 8,
        pos.y - 8,
        3,
        pos.x,
        pos.y,
        p.boosting ? 25 : 22
    );

    bodyGradient.addColorStop(0, lightColor);
    bodyGradient.addColorStop(0.45, mainColor);
    bodyGradient.addColorStop(1, darkColor);

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.boosting ? 24 : 21, 0, Math.PI * 2);
    ctx.fillStyle = bodyGradient;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.stroke();

    if (p.boosting) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 35, 0, Math.PI * 2);
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(pos.x - 8, pos.y - 8, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pos.x + 5, pos.y + 6, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fill();

    ctx.restore();
}

function drawBoostParticles(p, pos) {
    ctx.save();

    const owner = isOwnerPlayer(p);

    if (p.boosting) {
        for (let i = 0; i < 10; i++) {
            const backX = pos.x - Math.cos(p.angle) * (25 + i * 7);
            const backY = pos.y - Math.sin(p.angle) * (25 + i * 7);

            const particleColor = owner
                ? `hsl(${(Date.now() / 10 + i * 35) % 360}, 100%, 60%)`
                : p.color;

            ctx.beginPath();
            ctx.arc(
                backX + Math.random() * 8 - 4,
                backY + Math.random() * 8 - 4,
                5 - i * 0.35,
                0,
                Math.PI * 2
            );

            ctx.fillStyle = particleColor;
            ctx.globalAlpha = 0.5 - i * 0.04;
            ctx.fill();
        }
    }

    ctx.restore();
}

function drawPlayer(p) {
    if (!p || p.alive === false) return;

    const pos = worldToScreen(p.x, p.y);

    drawSpawnProtection(pos, p);
    drawBoostParticles(p, pos);

    if (isOwnerPlayer(p)) {
        drawOwnerPlayer(pos, p);
    } else {
        drawNormalPlayer(pos, p);
    }

    ctx.save();

    const me = players[myId];
    const distanceFromMe = me ? Math.hypot(p.x - me.x, p.y - me.y) : 0;

    const shouldShowName =
        p.id === myId ||
        distanceFromMe < 450 ||
        p.rank.includes("KING") ||
        p.rank.includes("OWNER");

    if (shouldShowName) {
        drawRankNameLabel(p, pos);
    }

    if (p.rank.includes("KING")) {
        const crownMove = Math.sin(Date.now() / 360);
        const crownX = Math.round(pos.x + crownMove * 20);
        const crownY = Math.round(pos.y - 66);
        const crownRotate = crownMove * 0.18;

        ctx.save();
        ctx.translate(crownX, crownY);
        ctx.rotate(crownRotate);

        ctx.font = "26px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 5;
        ctx.shadowBlur = 18;
        ctx.shadowColor = "#ffd700";

        ctx.strokeText("👑", 0, 0);
        ctx.fillText("👑", 0, 0);

        ctx.restore();
    }

    if (isOwnerPlayer(p)) {
        ctx.font = "24px Arial";
        ctx.textAlign = "center";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;
        ctx.strokeText("🌈", pos.x, pos.y - 64);
        ctx.fillText("🌈", pos.x, pos.y - 64);
    }

    ctx.restore();
}

function drawLeaderboardBadge(x, y, rank, width, height) {
    let fill = "rgba(255,255,255,0.10)";
    let stroke = "rgba(255,255,255,0.28)";
    let textColor = "white";
    let glow = "rgba(255,255,255,0.45)";

    if (rank.includes("OWNER")) {
        fill = "rgba(255, 0, 200, 0.20)";
        stroke = rainbowColor(90);
        textColor = "white";
        glow = rainbowColor(140);
    } else if (rank.includes("KING")) {
        fill = "rgba(255, 215, 0, 0.25)";
        stroke = "rgba(255, 215, 0, 0.9)";
        textColor = "#fff3a0";
        glow = "rgba(255, 215, 0, 1)";
    } else if (rank.includes("LEGEND")) {
        fill = "rgba(0, 234, 255, 0.18)";
        stroke = "rgba(0, 234, 255, 0.85)";
        textColor = "#d8fbff";
        glow = "rgba(0, 234, 255, 0.95)";
    } else if (rank.includes("PRO")) {
        fill = "rgba(255, 242, 0, 0.17)";
        stroke = "rgba(255,242,0,0.85)";
        textColor = "#fff9c8";
        glow = "rgba(255,242,0,0.85)";
    }

    ctx.save();
    ctx.shadowBlur = 14;
    ctx.shadowColor = glow;

    drawRoundedRect(x, y, width, height, 7);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = textColor;
    ctx.fillText(rank, x + width / 2, y + height / 2);

    ctx.restore();
}

function drawPersistentLeaderboard() {
    const leaderboard = getPersistentLeaderboardPlayers();
    if (leaderboard.length === 0) return;

    const boxWidth = canvas.width < 700 ? 225 : 270;
    const rowHeight = 28;
    const headerHeight = 30;
    const boxHeight = headerHeight + leaderboard.length * rowHeight + 10;
    const x = canvas.width - boxWidth - 16;
    const y = 16;

    ctx.save();

    drawRoundedRect(x, y, boxWidth, boxHeight, 12);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = "bold 14px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText("LEADERBOARD", x + 12, y + 15);

    ctx.font = "bold 12px Arial";
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("TOP 10", x + boxWidth - 12, y + 15);

    let rowY = y + headerHeight;

    leaderboard.forEach((p, index) => {
        const rowX = x + 8;
        const rowWidth = boxWidth - 16;

        drawRoundedRect(rowX, rowY, rowWidth, rowHeight - 4, 8);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fill();

        ctx.font = "bold 12px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(`${index + 1}.`, rowX + 8, rowY + 12);

        let textStartX = rowX + 28;

        let rankLabel = "MEMBER";

        if (p.rank && p.rank.includes("OWNER")) rankLabel = "OWNER";
        else if (p.rank && p.rank.includes("KING")) rankLabel = "KING";
        else if (p.rank && p.rank.includes("LEGEND")) rankLabel = "LEGEND";
        else if (p.rank && p.rank.includes("PRO")) rankLabel = "PRO";

        const badgeWidth = rankLabel === "MEMBER" ? 58 : Math.max(46, rankLabel.length * 8 + 16);
        drawLeaderboardBadge(textStartX, rowY + 3, rankLabel, badgeWidth, 17);
        textStartX += badgeWidth + 7;

        ctx.font = "bold 12px Arial";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,1)";
        ctx.fillText(p.name, textStartX, rowY + 12);

        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillText(String(p.score), rowX + rowWidth - 8, rowY + 12);

        rowY += rowHeight;
    });

    ctx.restore();
}

function drawMinimap(me) {
    const size = 170;
    const padding = 16;
    const x = canvas.width - size - padding;
    const y = canvas.height - size - padding;
    const centerX = x + size / 2;
    const centerY = y + size / 2;
    const radius = size / 2;
    const scale = (radius - 8) / mapInfo.radius;

    ctx.save();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.50)";
    ctx.fill();

    ctx.strokeStyle = "rgba(0,234,255,0.7)";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#00eaff";
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2);
    ctx.clip();

    for (const id in players) {
        const p = players[id];
        if (!p || p.alive === false || !p.territoryTiles) continue;

        const color = getPlayerColor(p);
        ctx.fillStyle = color;
        ctx.globalAlpha = id === myId ? 0.85 : 0.45;

        const tileSize = Math.max(1.4, mapInfo.hexSize * scale * 1.8);

        for (const key in p.territoryTiles) {
            const tile = p.territoryTiles[key];
            const world = hexToWorld(tile.q, tile.r);

            const px = centerX + (world.x - mapInfo.centerX) * scale;
            const py = centerY + (world.y - mapInfo.centerY) * scale;

            const dx = px - centerX;
            const dy = py - centerY;

            if (dx * dx + dy * dy > (radius - 4) * (radius - 4)) continue;

            ctx.fillRect(
                px - tileSize / 2,
                py - tileSize / 2,
                tileSize,
                tileSize
            );
        }
    }

    ctx.globalAlpha = 1;

    for (const id in players) {
        const p = players[id];
        if (!p || p.alive === false || !p.trailTiles) continue;

        ctx.fillStyle = isOwnerPlayer(p) ? rainbowColor(100) : p.color;
        ctx.globalAlpha = 0.95;

        for (const tile of p.trailTiles) {
            const world = hexToWorld(tile.q, tile.r);

            const px = centerX + (world.x - mapInfo.centerX) * scale;
            const py = centerY + (world.y - mapInfo.centerY) * scale;

            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.globalAlpha = 1;

    for (const id in players) {
        const p = players[id];
        if (!p || p.alive === false) continue;

        const px = centerX + (p.x - mapInfo.centerX) * scale;
        const py = centerY + (p.y - mapInfo.centerY) * scale;

        ctx.beginPath();
        ctx.arc(px, py, id === myId ? 5.5 : 3.8, 0, Math.PI * 2);
        ctx.fillStyle = id === myId ? "white" : getPlayerColor(p);
        ctx.fill();

        if (id === myId) {
            ctx.strokeStyle = getPlayerColor(p);
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    ctx.restore();

    ctx.save();
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("MAP", centerX, y - 10);
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!joinedGame || !players[myId]) {
        requestAnimationFrame(draw);
        return;
    }

    const me = players[myId];

    updateCamera(me);
    updateScreenShake();

    drawBackground();

    for (const id in players) {
        drawTerritoryTiles(players[id]);
    }

    for (const id in players) {
        drawTrailTiles(players[id]);
    }

    drawBombPickups();
    drawPlacedBombs();

    drawCaptureEffects();
    drawDeathEffects();
    drawBombExplosions();

    for (const id in players) {
        drawPlayer(players[id]);
    }

    drawPersistentLeaderboard();

    if (minimapEnabled) {
        drawMinimap(me);
    }

    requestAnimationFrame(draw);
}

draw();