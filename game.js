const canvas = document.querySelector("#worldCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = true;

let W = 0;
let H = 0;
let pixelRatio = 1;

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
const CLOUDS = [
  { x: .08, y: .17, s: .82, speed: .75, depth: .65 },
  { x: .34, y: .27, s: .48, speed: .38, depth: .42 },
  { x: .57, y: .12, s: .66, speed: .56, depth: .58 },
  { x: .82, y: .31, s: .54, speed: .31, depth: .38 },
  { x: 1.04, y: .20, s: .94, speed: .69, depth: .7 },
  { x: .20, y: .42, s: .38, speed: .24, depth: .28 },
  { x: .70, y: .45, s: .32, speed: .2, depth: .24 }
];

let state = loadState();
let weather = { kind: "clear", temperature: 21, wind: 8, precipitation: 0, cloud: 20, source: "seasonal fallback", fetchedAt: 0 };
let lastFrame = performance.now();
let lastUIRender = 0;
let lastWeatherFetch = 0;
let notice = "The soil remembers your hands.";
let noticeUntil = Date.now() + 5500;
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
  } catch {
    return freshState();
  }
}

function saveState() {
  state.lastUpdated = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  const status = document.querySelector("#saveStatus");
  if (!status) return;
  status.textContent = "Saved locally";
  window.setTimeout(() => { status.textContent = "Your tree is safe"; }, 1400);
}

function setNotice(message, duration = 4200) {
  notice = message;
  noticeUntil = Date.now() + duration;
}

function resizeWorld() {
  const rect = canvas.getBoundingClientRect();
  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  W = Math.max(1, rect.width);
  H = Math.max(1, rect.height);
  canvas.width = Math.round(W * pixelRatio);
  canvas.height = Math.round(H * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.imageSmoothingEnabled = true;
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
function stageName() { return state.stage < STAGES.length ? STAGES[state.stage].name : `Growth ring ${state.stage - STAGES.length + 1}`; }
function formatDuration(seconds) {
  if (seconds <= 0) return "READY";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function localTime(date = new Date()) { return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function isNight(date = new Date()) { const hour = date.getHours() + date.getMinutes() / 60; return hour < 6.1 || hour >= 18.6; }
function daylight(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const dawn = clamp((hour - 5.4) / 2.1, 0, 1);
  const dusk = clamp((20 - hour) / 2.1, 0, 1);
  return Math.min(dawn, dusk);
}
function mixColour(a, b, amount) {
  const parse = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const [ar, ag, ab] = parse(a); const [br, bg, bb] = parse(b);
  const channel = (start, end) => Math.round(start + (end - start) * amount).toString(16).padStart(2, "0");
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

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
    state.leaves += 2 + Math.floor(state.stage / 3) + state.upgrades.canopy;
    if (state.stage % 2 === 0) state.seeds += 1;
    const current = STAGES[Math.min(state.stage, STAGES.length - 1)];
    const journalId = state.stage >= 10 ? "ring" : current.journal === "The first bloom" ? "bloom" : state.stage >= 7 ? "fruit" : state.stage >= 4 ? "leaf" : "seed";
    if (!state.discovered.includes(journalId)) state.discovered.push(journalId);
    setNotice(`${current.name}.`, 5600);
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
    setNotice("A little attention goes a long way.");
    effects.push({ kind: "spark", until: performance.now() + 900 });
  }
  if (action === "water") {
    state.moisture = clamp(state.moisture + 28, 0, 100);
    state.growth += 2.2;
    state.cooldowns.water = now + COOLDOWNS.water;
    setNotice("The roots drink deeply.");
    effects.push({ kind: "water", until: performance.now() + 1100 });
  }
  if (action === "fertilize") {
    if (state.compost < 1) { setNotice("The compost bin is empty."); return; }
    state.compost -= 1;
    state.growth += 7;
    state.cooldowns.fertilize = now + COOLDOWNS.fertilize;
    setNotice("Dark soil, bright future.");
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
  if (state.leaves < cost) { setNotice(`You need ${cost - state.leaves} more leaves.`); renderUI(); return; }
  state.leaves -= cost;
  state.upgrades[key] += 1;
  setNotice(`${item.name} is now level ${state.upgrades[key]}.`);
  saveState();
  renderUI();
}

function drawCloud(x, y, scale, depth, light) {
  const width = 170 * scale;
  const height = 56 * scale;
  const bright = mixColour("#627d91", "#d7ecf7", light);
  const tint = mixColour("#486779", "#a5dbf7", light);
  ctx.save();
  ctx.globalAlpha = .58 + depth * .34;
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.ellipse(x + width * .5, y + height * .64, width * .48, height * .29, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bright;
  [[.18,.56,.18,.28],[.36,.37,.24,.4],[.58,.43,.22,.35],[.77,.57,.2,.27]].forEach(([cx, cy, rx, ry]) => {
    ctx.beginPath();
    ctx.ellipse(x + width * cx, y + height * cy, width * rx, height * ry, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawShrub(x, groundY, scale, palette) {
  ctx.fillStyle = palette.dark;
  [[0,0,31,18],[24,-8,38,28],[55,1,34,18]].forEach(([dx, dy, rx, ry]) => {
    ctx.beginPath(); ctx.ellipse(x + dx * scale, groundY + dy * scale, rx * scale, ry * scale, 0, Math.PI, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = palette.mid;
  [[12,-3,20,13],[40,-14,24,18],[68,-3,18,12]].forEach(([dx, dy, rx, ry]) => {
    ctx.beginPath(); ctx.ellipse(x + dx * scale, groundY + dy * scale, rx * scale, ry * scale, 0, Math.PI, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = palette.light;
  ctx.beginPath(); ctx.ellipse(x + 37 * scale, groundY - 22 * scale, 14 * scale, 8 * scale, -.2, Math.PI, Math.PI * 2); ctx.fill();
}

function drawGrassTuft(x, y, scale, colours, windPhase) {
  const sway = Math.sin(performance.now() / 1900 + windPhase) * 2 * scale;
  ctx.strokeStyle = colours.dark;
  ctx.lineWidth = Math.max(1.6, 2.5 * scale);
  ctx.lineCap = "square";
  [[-9,-18],[-3,-25],[4,-20],[10,-14]].forEach(([dx, dy], index) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + dx * .45 + sway, y + dy * .5, x + dx + sway * (index / 4), y + dy); ctx.stroke();
  });
  ctx.strokeStyle = colours.light;
  ctx.lineWidth = Math.max(1.2, 1.7 * scale);
  ctx.beginPath(); ctx.moveTo(x + 2 * scale, y); ctx.quadraticCurveTo(x + 6 * scale + sway, y - 12 * scale, x + 4 * scale + sway, y - 19 * scale); ctx.stroke();
}

function drawCanopyMass(x, y, rx, ry, palette, phase) {
  const sway = Math.sin(performance.now() / 2600 + phase) * Math.min(4, rx * .035);
  ctx.fillStyle = palette.dark;
  ctx.beginPath(); ctx.ellipse(x + sway + rx * .08, y + ry * .14, rx, ry, -.03, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = palette.mid;
  ctx.beginPath(); ctx.ellipse(x + sway - rx * .04, y, rx * .91, ry * .89, -.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = palette.light;
  ctx.beginPath(); ctx.ellipse(x + sway - rx * .28, y - ry * .3, rx * .42, ry * .32, -.18, 0, Math.PI * 2); ctx.fill();
}

function drawTree(groundY, light, season) {
  const visualStage = clamp(state.stage, 1, 12);
  const x = W * (W < 620 ? .52 : .56);
  const treeHeight = Math.min(H * .59, H * (.13 + visualStage * .032));
  const top = groundY - treeHeight;
  const crownWidth = treeHeight * (.38 + visualStage * .035);
  const sway = Math.sin(performance.now() / 3200) * Math.min(4, treeHeight * .008);
  const palettes = {
    spring: { dark: "#407157", mid: "#619639", light: "#85ac39" },
    summer: { dark: "#36654a", mid: "#467d51", light: "#72a43d" },
    autumn: { dark: "#75513c", mid: "#b96b38", light: "#dc9a3c" },
    winter: { dark: "#4c6860", mid: "#6e8676", light: "#91a88f" }
  };
  const basePalette = palettes[season];
  const palette = Object.fromEntries(Object.entries(basePalette).map(([key, colour]) => [key, mixColour("#233f45", colour, .48 + light * .52)]));
  const trunkDark = mixColour("#273b3e", "#524c4d", .45 + light * .55);
  const trunkMid = mixColour("#33484a", "#715746", .45 + light * .55);
  const trunkLight = mixColour("#43595a", "#967457", .45 + light * .55);

  ctx.save();
  ctx.globalAlpha = .23 + light * .12;
  ctx.fillStyle = "#244d42";
  ctx.beginPath(); ctx.ellipse(x + treeHeight * .06, groundY + 6, crownWidth * .7, treeHeight * .055, -.04, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const trunkWidth = Math.max(9, treeHeight * (.058 + visualStage * .0038));
  ctx.fillStyle = trunkDark;
  ctx.beginPath();
  ctx.moveTo(x - trunkWidth * .78, groundY + 2);
  ctx.bezierCurveTo(x - trunkWidth * .5, groundY - treeHeight * .34, x - trunkWidth * .22 + sway, top + treeHeight * .18, x + sway, top + treeHeight * .08);
  ctx.bezierCurveTo(x + trunkWidth * .5 + sway, top + treeHeight * .19, x + trunkWidth * .55, groundY - treeHeight * .3, x + trunkWidth * .9, groundY + 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = trunkMid;
  ctx.beginPath();
  ctx.moveTo(x - trunkWidth * .25, groundY);
  ctx.bezierCurveTo(x - trunkWidth * .1, groundY - treeHeight * .35, x + sway, top + treeHeight * .23, x + trunkWidth * .15 + sway, top + treeHeight * .12);
  ctx.bezierCurveTo(x + trunkWidth * .34, groundY - treeHeight * .18, x + trunkWidth * .34, groundY - treeHeight * .05, x + trunkWidth * .42, groundY);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = trunkLight;
  ctx.beginPath(); ctx.ellipse(x - trunkWidth * .05, groundY - treeHeight * .29, trunkWidth * .12, treeHeight * .19, -.04, 0, Math.PI * 2); ctx.fill();

  if (visualStage >= 2) {
    ctx.strokeStyle = trunkDark;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(6, trunkWidth * .55);
    [[-.35,.52,-.22,.72],[.37,.49,.24,.72],[-.2,.32,-.1,.58],[.22,.28,.09,.57]].forEach(([dx, dy, bx, by]) => {
      ctx.beginPath(); ctx.moveTo(x + bx * crownWidth, groundY - by * treeHeight); ctx.quadraticCurveTo(x + dx * crownWidth * .7, groundY - dy * treeHeight, x + dx * crownWidth, groundY - dy * treeHeight); ctx.stroke();
    });
  }

  if (visualStage === 1) {
    ctx.strokeStyle = trunkMid; ctx.lineWidth = Math.max(5, trunkWidth * .55); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x + sway, top + treeHeight * .2); ctx.lineTo(x + sway, top); ctx.stroke();
    drawCanopyMass(x - treeHeight * .08, top + treeHeight * .05, treeHeight * .12, treeHeight * .07, palette, 1);
    drawCanopyMass(x + treeHeight * .08, top - treeHeight * .005, treeHeight * .115, treeHeight * .065, palette, 2);
  } else if (season === "winter" && visualStage >= 4) {
    ctx.strokeStyle = trunkDark; ctx.lineCap = "round"; ctx.lineWidth = Math.max(4, trunkWidth * .34);
    [[-.42,.78,-.12,.47],[.4,.77,.11,.44],[-.26,.92,-.05,.62],[.24,.94,.05,.62]].forEach(([ex, ey, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x + sx * crownWidth, groundY - sy * treeHeight); ctx.quadraticCurveTo(x + ex * crownWidth * .6, groundY - ey * treeHeight * .83, x + ex * crownWidth, groundY - ey * treeHeight); ctx.stroke();
    });
    [[-.37,.7,.16,.1],[-.12,.87,.18,.12],[.15,.88,.2,.13],[.39,.68,.16,.1]].forEach(([dx, dy, rx, ry], index) => drawCanopyMass(x + dx * crownWidth, groundY - dy * treeHeight, rx * crownWidth, ry * treeHeight, palette, index));
  } else {
    const masses = [
      [0,.79,.30,.18],[-.26,.7,.29,.2],[.27,.7,.3,.2],[-.43,.57,.25,.17],[.44,.56,.25,.18],[-.13,.53,.34,.21],[.17,.5,.34,.22],[0,.92,.22,.15],[-.47,.72,.17,.13],[.48,.73,.18,.13]
    ];
    const count = clamp(visualStage + 1, 3, masses.length);
    masses.slice(0, count).forEach(([dx, dy, rx, ry], index) => drawCanopyMass(x + dx * crownWidth + sway, groundY - dy * treeHeight, rx * crownWidth, ry * treeHeight, palette, index * .8));
    if (visualStage >= 6) {
      ctx.fillStyle = season === "autumn" ? "#f0ba55" : "#e5c76b";
      [[-.28,.72],[.22,.8],[.38,.57],[-.05,.93],[-.45,.55]].forEach(([dx, dy], index) => {
        const size = Math.max(4, treeHeight * .014); ctx.beginPath(); ctx.ellipse(x + dx * crownWidth + sway, groundY - dy * treeHeight, size, size * .8, index, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  ctx.fillStyle = trunkDark;
  ctx.beginPath(); ctx.ellipse(x - trunkWidth * .75, groundY + 1, trunkWidth, trunkWidth * .24, -.1, 0, Math.PI * 2); ctx.ellipse(x + trunkWidth * .72, groundY + 1, trunkWidth, trunkWidth * .24, .1, 0, Math.PI * 2); ctx.fill();

  effects = effects.filter((effect) => effect.until > performance.now());
  effects.forEach((effect, index) => {
    const progress = clamp((effect.until - performance.now()) / 1600, 0, 1);
    if (effect.kind === "spark" || effect.kind === "stage") {
      ctx.fillStyle = "#f4df91";
      for (let i = 0; i < 7; i += 1) { const angle = i * .9 + index; const distance = treeHeight * (.18 + (1 - progress) * .16); const sx = x + Math.cos(angle) * distance; const sy = top + treeHeight * .35 + Math.sin(angle) * distance * .6; ctx.fillRect(sx, sy, 4 + (i % 2) * 2, 4 + (i % 2) * 2); }
    }
    if (effect.kind === "water") {
      ctx.fillStyle = "#a5dbf7";
      for (let i = 0; i < 6; i += 1) { ctx.beginPath(); ctx.ellipse(x - 32 + i * 13, groundY - 8 - (i % 2) * 7, 3, 7, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    if (effect.kind === "fertilize") { ctx.fillStyle = "#d8b56e"; ctx.beginPath(); ctx.ellipse(x, groundY + 1, 45, 7, 0, 0, Math.PI * 2); ctx.fill(); }
  });
}

function drawWorld() {
  if (!W || !H) return;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const date = new Date();
  const season = currentSeason(date);
  const light = daylight(date);
  const groundY = H * .7;
  const seasonGround = {
    spring: ["#85ac39", "#63983d", "#477450"],
    summer: ["#7fa43b", "#5c8d3b", "#3f7047"],
    autumn: ["#a79a42", "#7d813b", "#52683f"],
    winter: ["#94aa85", "#70866f", "#526b67"]
  }[season];
  const skyTop = mixColour("#17374e", season === "autumn" ? "#62aada" : "#4ca7e2", light);
  const skyBottom = mixColour("#31536a", season === "autumn" ? "#b9d4d3" : "#94d3f6", light);
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, skyTop); sky.addColorStop(.58, mixColour(skyTop, skyBottom, .58)); sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, groundY + 2);

  if (light > .12) {
    ctx.save(); ctx.globalAlpha = .32 + light * .28; ctx.fillStyle = season === "autumn" ? "#f0c47a" : "#f4e4a1"; ctx.beginPath(); ctx.arc(W * .79, H * .16, Math.min(W, H) * .045, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  } else {
    ctx.fillStyle = "#e8e0b4"; ctx.beginPath(); ctx.arc(W * .79, H * .16, Math.min(W, H) * .035, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skyTop; ctx.beginPath(); ctx.arc(W * .805, H * .147, Math.min(W, H) * .034, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#dbe6c0"; for (let i = 0; i < 18; i += 1) { const sx = ((i * 197) % 947) / 947 * W; const sy = (.08 + ((i * 83) % 430) / 1000) * H; ctx.fillRect(sx, sy, 2 + (i % 3 === 0 ? 1 : 0), 2 + (i % 3 === 0 ? 1 : 0)); }
  }

  const elapsed = performance.now() / 1000;
  const cloudMultiplier = weather.kind === "overcast" || weather.kind === "rain" || weather.kind === "storm" ? 1.18 : 1;
  CLOUDS.forEach((cloud) => {
    const travel = elapsed * cloud.speed * (weather.kind === "windy" ? 1.8 : 1);
    const cloudWidth = 180 * cloud.s * cloudMultiplier;
    const x = ((cloud.x * W + travel + cloudWidth) % (W + cloudWidth * 2)) - cloudWidth;
    drawCloud(x, cloud.y * groundY, cloud.s * cloudMultiplier, cloud.depth, light);
  });

  const distant = mixColour("#2f5450", seasonGround[2], .55 + light * .35);
  ctx.fillStyle = distant;
  ctx.beginPath(); ctx.moveTo(0, groundY + 8);
  for (let x = 0; x <= W + 80; x += 70) { const y = groundY - 8 - ((x * 17) % 29); ctx.quadraticCurveTo(x + 34, y - 28, x + 70, groundY + 5); }
  ctx.lineTo(W, groundY + 32); ctx.lineTo(0, groundY + 32); ctx.closePath(); ctx.fill();

  const meadow = ctx.createLinearGradient(0, groundY, 0, H);
  meadow.addColorStop(0, mixColour("#435f58", seasonGround[0], .45 + light * .55));
  meadow.addColorStop(.48, mixColour("#354f4b", seasonGround[1], .45 + light * .55));
  meadow.addColorStop(1, mixColour("#253f3d", seasonGround[2], .5 + light * .5));
  ctx.fillStyle = meadow; ctx.fillRect(0, groundY, W, H - groundY);

  const shrubPalette = { dark: mixColour("#294743", seasonGround[2], light), mid: mixColour("#36594c", seasonGround[1], light), light: mixColour("#496c51", seasonGround[0], light) };
  drawShrub(W * .03, groundY + 10, .72, shrubPalette);
  drawShrub(W * .22, groundY + 8, .46, shrubPalette);
  drawShrub(W * .78, groundY + 9, .66, shrubPalette);
  drawShrub(W * .93, groundY + 13, .48, shrubPalette);

  const grassColours = { dark: mixColour("#2b4743", seasonGround[2], .4 + light * .6), light: mixColour("#466858", seasonGround[0], .35 + light * .65) };
  const tuftCount = Math.round(clamp(W / 13, 42, 105));
  for (let i = 0; i < tuftCount; i += 1) {
    const hash = (i * 73) % 101;
    const x = ((i * 131) % 1009) / 1009 * W;
    const y = groundY + 18 + (hash / 101) * (H - groundY - 22);
    const scale = .45 + ((i * 31) % 47) / 70;
    drawGrassTuft(x, y, scale, grassColours, i * .37);
  }

  drawTree(groundY + H * .16, light, season);

  if (weather.kind === "rain" || weather.kind === "storm") {
    ctx.save(); ctx.strokeStyle = mixColour("#789caf", "#b8e0ec", light); ctx.globalAlpha = weather.kind === "storm" ? .65 : .42; ctx.lineWidth = 2;
    for (let i = 0; i < Math.ceil(W / 22); i += 1) { const x = (i * 47 + elapsed * 160) % (W + 40) - 20; const y = (i * 83 + elapsed * 270) % H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 17); ctx.stroke(); }
    ctx.restore();
  }

  if (weather.kind === "fog") { ctx.fillStyle = `rgba(215,236,247,${.1 + (1 - light) * .06})`; ctx.fillRect(0, H * .42, W, H * .35); }
}

function renderUI() {
  const date = new Date();
  const season = currentSeason(date);
  const need = stageNeed(state.stage);
  const progress = clamp(state.growth / need * 100, 0, 100);
  const name = stageName();
  const number = `Stage ${Math.max(1, state.stage)}`;
  document.querySelector("#seasonBadge").textContent = seasonLabel(season).toUpperCase();
  document.querySelector("#clockLabel").textContent = localTime(date);
  document.querySelector("#weatherLabel").textContent = `${WEATHER_NAMES[weather.kind]} · ${Math.round(weather.temperature)}°C`;
  document.querySelector("#weatherDetail").textContent = `${weather.source} · wind ${Math.round(weather.wind)} km/h`;
  const message = document.querySelector("#worldMessage");
  message.textContent = notice;
  message.classList.toggle("is-hidden", Date.now() > noticeUntil);
  document.querySelector("#stageName").textContent = name;
  document.querySelector("#drawerStageName").textContent = name;
  document.querySelector("#stageNumber").textContent = number;
  document.querySelector("#drawerStageNumber").textContent = number;
  document.querySelector("#growthBar").style.width = `${progress}%`;
  document.querySelector("#drawerGrowthBar").style.width = `${progress}%`;
  document.querySelector("#growthText").textContent = `${Math.floor(state.growth)} / ${need} growth`;
  document.querySelector("#nextStageText").textContent = `${Math.ceil((need - state.growth) / growthRate() / 60)}m to next stage`;
  document.querySelector("#moistureBar").style.width = `${state.moisture}%`;
  document.querySelector("#moistureValue").textContent = `${Math.round(state.moisture)}%`;
  document.querySelector("#growthRate").textContent = `${(growthRate() * 3600).toFixed(0)} / hour`;
  document.querySelector("#offlineNote").textContent = isNight(date) ? "Night settles softly" : "Growing quietly";
  document.querySelector("#leavesValue").textContent = state.leaves;
  document.querySelector("#seedsValue").textContent = state.seeds;
  document.querySelector("#dewValue").textContent = state.dew;
  document.querySelector("#compostValue").textContent = state.compost;
  document.querySelector("#techLevel").textContent = `${totalUpgradeLevels()} upgrades`;
  document.querySelector("#journalCount").textContent = `${state.discovered.length} found`;
  document.querySelector("#liveWeatherToggle").checked = state.liveWeather;
  document.querySelector("#actionHint").textContent = state.compost ? "Click the tree or use Tend below." : "The tree is growing while you are away.";
  document.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    const remaining = state.cooldowns[action] - nowSeconds();
    button.disabled = remaining > 0 || (action === "fertilize" && state.compost < 1);
    button.querySelector("[data-cooldown]").textContent = action === "fertilize" && state.compost < 1 ? "EMPTY" : formatDuration(remaining);
  });
  document.querySelector("#upgradeList").innerHTML = UPGRADES.map((item) => {
    const level = state.upgrades[item.key]; const cost = upgradeCost(item);
    return `<div class="upgrade-item"><div><strong>${item.icon} ${item.name} <span class="level-chip">Lv ${level}</span></strong><small>${item.description} · ${cost} leaves</small></div><button type="button" data-upgrade="${item.key}" ${state.leaves < cost ? "disabled" : ""}>Grow</button></div>`;
  }).join("");
  document.querySelector("#journalList").innerHTML = JOURNAL.filter(([id]) => state.discovered.includes(id)).map(([, title, description]) => `<div class="journal-entry"><span class="journal-mark"></span><div><strong>${title}</strong><small>${description}</small></div></div>`).join("");
}

async function fetchWeather() {
  if (!state.liveWeather || location.protocol === "file:") return;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${CITY.latitude}&longitude=${CITY.longitude}&current=temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m&timezone=auto`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error("weather response failed");
    const current = (await response.json()).current;
    const code = current.weather_code; let kind = "clear";
    if (code >= 45 && code <= 48) kind = "fog";
    else if (code >= 95) kind = "storm";
    else if (code >= 51 && code <= 82) kind = "rain";
    else if (current.wind_speed_10m > 30) kind = "windy";
    else if (current.cloud_cover > 75) kind = "overcast";
    else if (current.cloud_cover > 35) kind = "partly";
    weather = { kind, temperature: current.temperature_2m, wind: current.wind_speed_10m, precipitation: current.precipitation, cloud: current.cloud_cover, source: "Port Elizabeth live sky", fetchedAt: Date.now() };
    lastWeatherFetch = Date.now();
    renderUI();
  } catch {
    weather.source = "seasonal fallback";
    lastWeatherFetch = Date.now();
    renderUI();
  }
}

function tick() {
  const now = performance.now();
  const delta = Math.min((now - lastFrame) / 1000, 4);
  lastFrame = now;
  simulate(delta);
  state.lastUpdated = Date.now();
  if (state.liveWeather && Date.now() - lastWeatherFetch > 30 * 60 * 1000) fetchWeather();
  drawWorld();
  if (now - lastUIRender > 250) { renderUI(); lastUIRender = now; }
  requestAnimationFrame(tick);
}

function wireEvents() {
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => performAction(button.dataset.action)));
  canvas.addEventListener("click", () => performAction("encourage"));
  document.querySelector("#upgradeList").addEventListener("click", (event) => { const button = event.target.closest("[data-upgrade]"); if (button) buyUpgrade(button.dataset.upgrade); });
  document.querySelector("#detailsButton").addEventListener("click", () => {
    const drawer = document.querySelector("#detailsDrawer");
    const open = drawer.hasAttribute("hidden");
    if (open) drawer.removeAttribute("hidden"); else drawer.setAttribute("hidden", "");
    document.querySelector("#detailsButton").setAttribute("aria-expanded", String(open));
  });
  document.querySelector("#closeDetailsButton").addEventListener("click", () => { document.querySelector("#detailsDrawer").setAttribute("hidden", ""); document.querySelector("#detailsButton").setAttribute("aria-expanded", "false"); });
  document.querySelector("#liveWeatherToggle").addEventListener("change", (event) => { state.liveWeather = event.target.checked; setNotice(state.liveWeather ? "The local sky is listening." : "The sky will follow the season."); saveState(); if (state.liveWeather) fetchWeather(); renderUI(); });
  document.querySelector("#resetButton").addEventListener("click", () => { if (window.confirm("Start again with a new seed? This removes the local tree save.")) { state = freshState(); saveState(); setNotice("A new beginning."); renderUI(); } });
  window.addEventListener("resize", resizeWorld);
  window.addEventListener("beforeunload", saveState);
}

function start() {
  resizeWorld();
  const elapsed = (Date.now() - state.lastUpdated) / 1000;
  if (elapsed > 0) {
    simulate(elapsed);
    if (elapsed > 60) setNotice(`While you were away, the tree grew for ${formatDuration(elapsed)}.`, 6500);
  } else if (elapsed < -60) {
    state.lastUpdated = Date.now();
    setNotice("The clock moved backwards, so the tree is waiting safely.");
  }
  wireEvents();
  renderUI();
  fetchWeather();
  requestAnimationFrame(tick);
}

start();
