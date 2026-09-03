const canvas = document.querySelector("#worldCanvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const W = canvas.width;
const H = canvas.height;
const SAVE_KEY = "rootbound-save-v1";
const MAX_OFFLINE_SECONDS = 60 * 60 * 72;
const CITY = { latitude: -33.96, longitude: 25.62 };

const STAGES = [
  { name: "A buried beginning", journal: "The first seed", reward: "A quiet promise beneath the soil." },
  { name: "A tiny sprout", journal: "First green", reward: "Two leaves find the light." },
  { name: "A brave sapling", journal: "The stem holds", reward: "The wind can move it, but not turn it back." },
  { name: "First branches", journal: "A shape emerges", reward: "The tree begins to choose its sky." },
  { name: "A young canopy", journal: "Shade for one", reward: "A little shelter appears below the leaves." },
  { name: "A growing crown", journal: "The crown spreads", reward: "The tree is now part of the horizon." },
  { name: "A flowering tree", journal: "The first bloom", reward: "Something bright arrives without being asked." },
  { name: "A fruiting tree", journal: "The first seed", reward: "The tree begins to give its future away." },
  { name: "Old growth", journal: "A hollow home", reward: "The trunk has room for another life." },
  { name: "An ancient tree", journal: "The long view", reward: "Its roots remember more than you do." }
];

const JOURNAL = [
  ["seed", "The first seed", "A quiet promise beneath the soil."],
  ["leaf", "First green", "Two leaves find the light."],
  ["bloom", "The first bloom", "Something bright arrives without being asked."],
  ["fruit", "The first fruit", "The tree begins to give its future away."],
  ["nest", "A hollow home", "A small visitor decides to stay."],
  ["ring", "The long view", "Its roots remember more than you do."],
  ["grove", "A new neighbour", "A seed finds its own patch of earth."]
];

const UPGRADES = [
  { key: "roots", name: "Deeper roots", description: "+12% natural growth", base: 8, multiplier: 1.55, icon: "⌁" },
  { key: "soil", name: "Living soil", description: "Moisture fades 10% slower", base: 12, multiplier: 1.58, icon: "▦" },
  { key: "canopy", name: "Wide canopy", description: "+1 leaf on stage growth", base: 18, multiplier: 1.62, icon: "✽" },
  { key: "rain", name: "Rain catcher", description: "Rain gives a gentle growth bonus", base: 25, multiplier: 1.66, icon: "☂" },
  { key: "wildlife", name: "Wildlife corridor", description: "Rare journal finds arrive sooner", base: 38, multiplier: 1.72, icon: "•" }
];

const COOLDOWNS = { encourage: 15, water: 300, fertilize: 7200 };
const WEATHER_NAMES = { clear: "Clear", partly: "Partly cloudy", overcast: "Overcast", rain: "Light rain", storm: "Storm", fog: "Sea fog", windy: "Windy" };

let state = loadState();
let weather = { kind: "clear", temperature: 21, wind: 8, precipitation: 0, cloud: 20, source: "seasonal fallback", fetchedAt: 0 };
let lastFrame = performance.now();
let lastWeatherFetch = 0;
let focusMode = false;
let notice = "The soil remembers your hands.";
let effects = [];

function freshState() {
  return {
    version: 1,
    growth: 4,
    stage: 1,
    moisture: 70,
    leaves: 0,
    seeds: 0,
    dew: 3,
    compost: 1,
    upgrades: Object.fromEntries(UPGRADES.map((item) => [item.key, 0])),
    discovered: ["seed"],
    cooldowns: { encourage: 0, water: 0, fertilize: 0 },
    lastUpdated: Date.now(),
    liveWeather: true
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!saved || saved.version !== 1) return freshState();
    return { ...freshState(), ...saved, upgrades: { ...freshState().upgrades, ...saved.upgrades }, cooldowns: { ...freshState().cooldowns, ...saved.cooldowns } };
  } catch { return freshState(); }
}

function saveState() {
  state.lastUpdated = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  const status = document.querySelector("#saveStatus");
  status.textContent = "Saved locally";
  window.setTimeout(() => { status.textContent = "Your tree is safe"; }, 1400);
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function nowSeconds() { return Date.now() / 1000; }
function currentSeason(date = new Date()) {
  const month = date.getMonth();
  if (month === 11 || month <= 1) return "summer";
  if (month <= 4) return "autumn";
  if (month <= 7) return "winter";
  return "spring";
}
function seasonLabel(season) { return season[0].toUpperCase() + season.slice(1); }
function stageNeed(stage) { return Math.ceil(15 * Math.pow(1.28, stage)); }
function totalUpgradeLevels() { return Object.values(state.upgrades).reduce((sum, level) => sum + level, 0); }
function formatDuration(seconds) {
  if (seconds <= 0) return "READY";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function localTime(date = new Date()) { return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function isNight(date = new Date()) { const hour = date.getHours() + date.getMinutes() / 60; return hour < 6.1 || hour >= 18.6; }

function growthRate() {
  const season = currentSeason();
  const seasonBonus = season === "spring" ? 1.13 : season === "summer" ? 1.08 : season === "autumn" ? 0.98 : 0.84;
  const moistureBonus = 0.72 + state.moisture / 100 * 0.38;
  const upgradeBonus = 1 + state.upgrades.roots * 0.12;
  const weatherBonus = weather.kind === "rain" || weather.kind === "storm" ? 1 + state.upgrades.rain * 0.035 : 1;
  return 0.05 * seasonBonus * moistureBonus * upgradeBonus * weatherBonus;
}

function simulate(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const capped = Math.min(seconds, MAX_OFFLINE_SECONDS);
  const moistureLoss = capped / (86400 * (1 + state.upgrades.soil * 0.1));
  state.moisture = clamp(state.moisture - moistureLoss, 0, 100);
  state.growth += capped * growthRate();
  resolveStageUps();
}

function resolveStageUps() {
  while (state.growth >= stageNeed(state.stage)) {
    state.growth -= stageNeed(state.stage);
    state.stage += 1;
    const leafReward = 2 + Math.floor(state.stage / 3) + state.upgrades.canopy;
    state.leaves += leafReward;
    if (state.stage % 2 === 0) state.seeds += 1;
    const journalId = state.stage >= 10 ? "ring" : STAGES[Math.min(state.stage, STAGES.length - 1)].journal === "The first bloom" ? "bloom" : state.stage >= 7 ? "fruit" : state.stage >= 4 ? "leaf" : "seed";
    if (!state.discovered.includes(journalId)) state.discovered.push(journalId);
    notice = `${STAGES[Math.min(state.stage, STAGES.length - 1)].name}.`;
    effects.push({ kind: "stage", until: performance.now() + 2200 });
  }
}

function performAction(action) {
  const now = nowSeconds();
  if (state.cooldowns[action] > now) return;
  if (action === "encourage") {
    state.growth += 0.8 + state.upgrades.wildlife * 0.1;
    state.leaves += 1;
    state.cooldowns.encourage = now + COOLDOWNS.encourage;
    notice = "A little attention goes a long way.";
    effects.push({ kind: "spark", until: performance.now() + 900 });
  }
  if (action === "water") {
    state.moisture = clamp(state.moisture + 28, 0, 100);
    state.growth += 2.2;
    state.cooldowns.water = now + COOLDOWNS.water;
    notice = "The roots drink deeply.";
    effects.push({ kind: "water", until: performance.now() + 1100 });
  }
  if (action === "fertilize") {
    if (state.compost < 1) { notice = "The compost bin is empty."; return; }
    state.compost -= 1;
    state.growth += 7;
    state.cooldowns.fertilize = now + COOLDOWNS.fertilize;
    notice = "Dark soil, bright future.";
    effects.push({ kind: "fertilize", until: performance.now() + 1300 });
  }
  resolveStageUps();
  saveState();
  renderUI();
}

function upgradeCost(item) { return Math.ceil(item.base * Math.pow(item.multiplier, state.upgrades[item.key])); }
function buyUpgrade(key) {
  const item = UPGRADES.find((candidate) => candidate.key === key);
  if (!item) return;
  const cost = upgradeCost(item);
  if (state.leaves < cost) { notice = `You need ${cost - state.leaves} more leaves.`; renderUI(); return; }
  state.leaves -= cost;
  state.upgrades[key] += 1;
  notice = `${item.name} is now level ${state.upgrades[key]}.`;
  saveState();
  renderUI();
}

function drawPixelCloud(x, y, scale = 1, colour = "#d5f0e4") {
  ctx.fillStyle = colour;
  const blocks = [[0, 7, 34, 9], [8, 2, 17, 13], [20, 5, 25, 11], [35, 8, 28, 8]];
  blocks.forEach(([dx, dy, width, height]) => ctx.fillRect(Math.round(x + dx * scale), Math.round(y + dy * scale), Math.round(width * scale), Math.round(height * scale)));
}

function drawLeafBlob(x, y, width, height, colours, phase = 0) {
  const sway = Math.round(Math.sin(performance.now() / 2100 + phase) * 1.25);
  const left = x - width / 2 + sway;
  const top = y - height / 2;
  ctx.fillStyle = colours.outline;
  ctx.fillRect(left + width * 0.18, top, width * 0.62, 4);
  ctx.fillRect(left + width * 0.06, top + 4, width * 0.86, height - 10);
  ctx.fillRect(left + width * 0.18, top + height - 7, width * 0.62, 7);
  ctx.fillStyle = colours.shadow;
  ctx.fillRect(left + width * 0.1, top + height * 0.48, width * 0.8, height * 0.37);
  ctx.fillStyle = colours.base;
  ctx.fillRect(left + width * 0.18, top + 5, width * 0.66, height * 0.43);
  ctx.fillStyle = colours.highlight;
  ctx.fillRect(left + width * 0.29, top + 7, width * 0.22, 5);
  ctx.fillRect(left + width * 0.53, top + 14, width * 0.16, 4);
}

function drawTree() {
  const season = currentSeason();
  const leafPalettes = {
    spring: { outline: "#234b36", shadow: "#4d9a4e", base: "#82c95b", highlight: "#b8e274" },
    summer: { outline: "#173f35", shadow: "#2f8247", base: "#5eb74e", highlight: "#9cda61" },
    autumn: { outline: "#53392b", shadow: "#9b4e2f", base: "#d4833f", highlight: "#f0ba55" },
    winter: { outline: "#243d3c", shadow: "#315955", base: "#50776a", highlight: "#83a99a" }
  };
  const palette = leafPalettes[season];
  const stage = state.stage;
  const groundY = 190;
  const height = Math.min(148, 36 + stage * 12);
  const top = groundY - height;
  ctx.fillStyle = isNight() ? "#102b34" : season === "autumn" ? "#c8845e" : season === "winter" ? "#7898aa" : "#77bdc5";
  ctx.fillRect(0, 0, W, H);
  if (isNight()) {
    ctx.fillStyle = "#d9d29a"; ctx.fillRect(302, 25, 14, 14); ctx.fillStyle = "#102b34"; ctx.fillRect(307, 22, 13, 13);
    [[45, 35], [92, 23], [151, 51], [267, 46], [345, 67]].forEach(([x, y]) => { ctx.fillStyle = "#dce8b2"; ctx.fillRect(x, y, 2, 2); });
  }
  const cloudColour = isNight() ? "#426d76" : season === "autumn" ? "#f2c29a" : "#d5f0e4";
  const cloudX = (performance.now() / 120) % 480;
  drawPixelCloud(40 - cloudX, 34, 1, cloudColour); drawPixelCloud(235 - cloudX * 0.65, 62, 0.7, cloudColour);
  ctx.fillStyle = season === "winter" ? "#78929b" : season === "autumn" ? "#c67956" : "#5c9e9c";
  ctx.fillRect(0, 115, W, 28); ctx.fillStyle = season === "winter" ? "#8da9a4" : season === "autumn" ? "#9f9b64" : "#70a85e";
  ctx.fillRect(0, 131, W, 15);
  ctx.fillStyle = season === "winter" ? "#b5c9c0" : season === "autumn" ? "#a8a04c" : "#69a951"; ctx.fillRect(0, 145, W, 45);
  ctx.fillStyle = season === "winter" ? "#6c8f83" : season === "autumn" ? "#75863c" : "#438647"; ctx.fillRect(0, 177, W, 13);
  for (let x = 4; x < W; x += 13) {
    const h = 3 + ((x * 7) % 7);
    ctx.fillStyle = season === "winter" ? "#88a99a" : season === "autumn" ? "#b8a052" : "#8ac65d";
    ctx.fillRect(x, 176 - h, 2, h); if (x % 4 === 0) ctx.fillRect(x + 3, 183 - h, 2, 3);
  }
  ctx.fillStyle = "#253d31"; ctx.fillRect(134, groundY + 1, 118, 5); ctx.fillStyle = "#36543b"; ctx.fillRect(151, groundY - 2, 85, 5);
  const trunkDark = season === "autumn" ? "#5b3426" : "#4b3428"; const trunk = season === "winter" ? "#6e6750" : "#765039"; const trunkLight = "#a4784a";
  ctx.fillStyle = trunkDark;
  ctx.fillRect(184 - Math.min(stage, 8), top + 35, 17 + Math.min(stage, 8) * 2, height - 29);
  ctx.fillRect(168, top + 61, 24, 6); ctx.fillRect(193, top + 48, 24, 5);
  if (stage >= 2) { ctx.fillRect(166, top + 50, 7, 35); ctx.fillRect(211, top + 39, 6, 31); }
  ctx.fillStyle = trunk; ctx.fillRect(188, top + 37, 8 + Math.min(stage, 7), height - 36);
  ctx.fillStyle = trunkLight; ctx.fillRect(190, top + 48, 3, Math.max(8, height - 62));
  ctx.fillStyle = "#583625"; ctx.fillRect(172, groundY - 2, 16, 6); ctx.fillRect(202, groundY - 2, 17, 6);
  if (season === "winter" && stage >= 4) {
    ctx.fillStyle = palette.outline; ctx.fillRect(185, top + 12, 5, 45); ctx.fillRect(177, top + 24, 5, 25); ctx.fillRect(205, top + 17, 5, 28);
  } else if (stage >= 1) {
    const blobs = stage < 3 ? [[190, top + 10, 45, 27, 0]] : stage < 5 ? [[173, top + 24, 50, 30, 0], [211, top + 29, 42, 28, 2], [190, top + 8, 38, 26, 1]] : [[161, top + 30, 53, 32, 0], [221, top + 34, 52, 32, 2], [190, top + 7, 66, 41, 1], [183, top + 49, 58, 27, 3]];
    blobs.forEach(([x, y, width, blobHeight, phase]) => drawLeafBlob(x, y, width, blobHeight, palette, phase));
    if (stage >= 6 && season !== "winter") { ctx.fillStyle = season === "autumn" ? "#7d3e2d" : "#d84f58"; [[177, top + 23], [211, top + 38], [195, top + 57]].forEach(([x, y]) => ctx.fillRect(x, y, 4, 4)); }
  }
  if (season === "autumn" && stage >= 3) {
    ctx.fillStyle = "#f0ba55"; [[102, 142], [268, 126], [286, 164], [119, 171]].forEach(([x, y], i) => { const drift = Math.sin(performance.now() / 800 + i) * 4; ctx.fillRect(x + drift, y + (i % 2) * 5, 4, 3); });
  }
  if (weather.kind === "rain" || weather.kind === "storm") {
    ctx.fillStyle = "#9bd8dc"; for (let x = 7; x < W; x += 19) { const y = (performance.now() / 7 + x * 9) % 51 + 112; ctx.fillRect(x, y, 1, 6); }
  }
  effects = effects.filter((effect) => effect.until > performance.now());
  effects.forEach((effect) => {
    if (effect.kind === "spark") { ctx.fillStyle = "#f5e3a1"; [[190, 75], [205, 87], [173, 94]].forEach(([x, y]) => { ctx.fillRect(x, y, 3, 3); }); }
    if (effect.kind === "water") { ctx.fillStyle = "#b2e8e4"; for (let i = 0; i < 5; i++) ctx.fillRect(176 + i * 9, 172 - (i % 2) * 7, 3, 6); }
    if (effect.kind === "fertilize") { ctx.fillStyle = "#e3b96c"; ctx.fillRect(173, 188, 38, 3); ctx.fillRect(181, 184, 4, 4); ctx.fillRect(202, 183, 4, 5); }
    if (effect.kind === "stage") { ctx.fillStyle = "#f4df91"; ctx.fillRect(184, Math.max(18, top - 8), 17, 3); ctx.fillRect(191, Math.max(10, top - 15), 3, 17); }
  });
}

function renderUI() {
  const date = new Date(); const season = currentSeason(date); const need = stageNeed(state.stage); const progress = clamp(state.growth / need * 100, 0, 100);
  document.querySelector("#seasonBadge").textContent = seasonLabel(season);
  document.querySelector("#clockLabel").textContent = localTime(date);
  document.querySelector("#weatherLabel").textContent = `${WEATHER_NAMES[weather.kind]} · ${Math.round(weather.temperature)}°C`;
  document.querySelector("#weatherDetail").textContent = `${weather.source} · wind ${Math.round(weather.wind)} km/h`;
  document.querySelector("#worldMessage").textContent = notice;
  document.querySelector("#stageName").textContent = state.stage < STAGES.length ? STAGES[state.stage].name : `Growth ring ${state.stage - STAGES.length + 1}`;
  document.querySelector("#stageNumber").textContent = `Stage ${Math.max(1, state.stage)}`;
  document.querySelector("#growthBar").style.width = `${progress}%`;
  document.querySelector("#growthText").textContent = `${Math.floor(state.growth)} / ${need} growth`;
  document.querySelector("#nextStageText").textContent = `${Math.ceil((need - state.growth) / growthRate() / 60)}m to next stage`;
  document.querySelector("#moistureBar").style.width = `${state.moisture}%`;
  document.querySelector("#moistureValue").textContent = `${Math.round(state.moisture)}%`;
  document.querySelector("#growthRate").textContent = `${(growthRate() * 3600).toFixed(0)} growth / hour`;
  document.querySelector("#offlineNote").textContent = isNight(date) ? "Night settles softly" : "Day is open";
  document.querySelector("#leavesValue").textContent = state.leaves;
  document.querySelector("#seedsValue").textContent = state.seeds;
  document.querySelector("#dewValue").textContent = state.dew;
  document.querySelector("#compostValue").textContent = state.compost;
  document.querySelector("#techLevel").textContent = `${totalUpgradeLevels()} upgrades`;
  document.querySelector("#journalCount").textContent = `${state.discovered.length} found`;
  document.querySelector("#liveWeatherToggle").checked = state.liveWeather;
  document.querySelector("#actionHint").textContent = state.compost ? "Click the tree or encourage it below." : "The tree is growing while you are away.";
  document.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action; const remaining = state.cooldowns[action] - nowSeconds();
    button.disabled = remaining > 0 || (action === "fertilize" && state.compost < 1);
    button.querySelector("[data-cooldown]").textContent = action === "fertilize" && state.compost < 1 ? "EMPTY" : formatDuration(remaining);
  });
  document.querySelector("#upgradeList").innerHTML = UPGRADES.map((item) => {
    const level = state.upgrades[item.key]; const cost = upgradeCost(item);
    return `<div class="upgrade-item"><div><strong>${item.icon} ${item.name} <span class="level-chip">Lv ${level}</span></strong><small>${item.description} · costs ${cost} leaves</small></div><button type="button" data-upgrade="${item.key}" ${state.leaves < cost ? "disabled" : ""}>Grow +1</button></div>`;
  }).join("");
  document.querySelector("#journalList").innerHTML = JOURNAL.filter(([id]) => state.discovered.includes(id)).map(([, title, description]) => `<div class="journal-entry"><span class="journal-mark">✦</span><div><strong>${title}</strong><small>${description}</small></div></div>`).join("");
}

async function fetchWeather() {
  if (!state.liveWeather || location.protocol === "file:") return;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CITY.latitude}&longitude=${CITY.longitude}&current=temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m&timezone=auto`;
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal }); clearTimeout(timeout);
    if (!response.ok) throw new Error("weather response failed");
    const current = (await response.json()).current;
    const code = current.weather_code; let kind = "clear";
    if (code >= 45 && code <= 48) kind = "fog"; else if (code >= 95) kind = "storm"; else if (code >= 51 && code <= 82) kind = "rain"; else if (current.wind_speed_10m > 30) kind = "windy"; else if (current.cloud_cover > 75) kind = "overcast"; else if (current.cloud_cover > 35) kind = "partly";
    weather = { kind, temperature: current.temperature_2m, wind: current.wind_speed_10m, precipitation: current.precipitation, cloud: current.cloud_cover, source: "Port Elizabeth live sky", fetchedAt: Date.now() };
    lastWeatherFetch = Date.now(); renderUI();
  } catch { weather.source = "seasonal fallback"; lastWeatherFetch = Date.now(); renderUI(); }
}

function tick() {
  const now = performance.now(); const delta = Math.min((now - lastFrame) / 1000, 4); lastFrame = now;
  simulate(delta); state.lastUpdated = Date.now();
  if (state.liveWeather && Date.now() - lastWeatherFetch > 30 * 60 * 1000) fetchWeather();
  drawTree(); renderUI();
  requestAnimationFrame(tick);
}

function wireEvents() {
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => performAction(button.dataset.action)));
  canvas.addEventListener("click", () => performAction("encourage"));
  document.querySelector("#upgradeList").addEventListener("click", (event) => { const button = event.target.closest("[data-upgrade]"); if (button) buyUpgrade(button.dataset.upgrade); });
  document.querySelector("#focusButton").addEventListener("click", () => { focusMode = !focusMode; document.body.classList.toggle("focus-mode", focusMode); document.querySelector("#focusButton").textContent = focusMode ? "Exit focus" : "Focus mode"; });
  document.querySelector("#liveWeatherToggle").addEventListener("change", (event) => { state.liveWeather = event.target.checked; notice = state.liveWeather ? "The local sky is listening." : "The sky will follow the season."; saveState(); if (state.liveWeather) fetchWeather(); renderUI(); });
  document.querySelector("#resetButton").addEventListener("click", () => { if (window.confirm("Start again with a new seed? This removes the local tree save.")) { state = freshState(); saveState(); notice = "A new beginning."; renderUI(); } });
  window.addEventListener("beforeunload", saveState);
}

function start() {
  const elapsed = (Date.now() - state.lastUpdated) / 1000;
  if (elapsed > 0) {
    simulate(elapsed);
    if (elapsed > 60) notice = `While you were away, the tree grew for ${formatDuration(elapsed)}.`;
  } else if (elapsed < -60) {
    state.lastUpdated = Date.now(); notice = "The clock moved backwards, so the tree is waiting safely.";
  }
  wireEvents(); renderUI(); fetchWeather(); requestAnimationFrame(tick);
}

start();
