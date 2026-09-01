import * as THREE from './node_modules/three/build/three.module.js';
import { FBXLoader } from './node_modules/three/examples/jsm/loaders/FBXLoader.js';

const GAME_VERSION = '1.3.0';
console.info(`Battle Island v${GAME_VERSION}`);

// Constants
const MAP_SIZE = 200;
const PLAYER_HEIGHT = 1.75;
const PLAYER_SPEED = 5.5;
const SPRINT_MULT = 1.35;
const JUMP_FORCE = 8;
const GRAVITY = 28;
const GROUND_SKIN = 0.02;
const PLAYER_RADIUS = 0.45;
const BOT_COUNT = 15;

const WEAPONS = {
  ar: { name: 'AR', damage: 22, fireRate: 0.1, magSize: 30, reserve: 90, range: 120, spread: 0.02, auto: true, reloadTime: 1.5 },
  shotgun: { name: 'Pompalı', damage: 12, pellets: 8, fireRate: 0.8, magSize: 6, reserve: 18, range: 25, spread: 0.15, auto: false, reloadTime: 2.2 },
};

const BUILD_COST = { wall: 10, ramp: 10 };
const BUILD_HP = { wood: 150, stone: 300, metal: 500 };

// Game State
const state = {
  playing: false,
  kills: 0,
  alive: BOT_COUNT + 1,
  health: 100,
  shield: 50,
  materials: { wood: 500, stone: 0, metal: 0 },
  activeMat: 'wood',
  hotbarSlot: 0,
  weapon: 'ar',
  ammo: { ar: { current: 30, reserve: 90 }, shotgun: { current: 6, reserve: 18 } },
  reloading: false,
  reloadTimer: 0,
  reloadDuration: 0,
  fireCooldown: 0,
  keys: {},
  mouseDown: false,
  yaw: 0,
  pitch: 0,
  velocity: new THREE.Vector3(),
  onGround: false,
  damageFlash: 0,
  isMobile: false,
  joystick: { active: false, dx: 0, dy: 0, id: null },
};

// Three.js Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 250);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

// World Objects
const colliders = [];
const buildings = [];
const bots = [];
const bullets = [];

const player = new THREE.Group();
player.name = 'Player';
scene.add(player);

// Simple Player Model
function createHumanoid(bodyColor = 0x445566, pantsColor = 0x2f3b4a) {
  const group = new THREE.Group();
  
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.0, 0.3),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0xf7e4c2 })
  );
  head.position.y = 1.75;
  head.castShadow = true;
  group.add(head);

  const leftArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.6, 0.15),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  leftArm.position.set(-0.3, 1.2, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.6, 0.15),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  rightArm.position.set(0.3, 1.2, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  const leftLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.7, 0.15),
    new THREE.MeshLambertMaterial({ color: pantsColor })
  );
  leftLeg.position.set(-0.15, 0.35, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.7, 0.15),
    new THREE.MeshLambertMaterial({ color: pantsColor })
  );
  rightLeg.position.set(0.15, 0.35, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  return group;
}

// Generate World
function generateWorld() {
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(MAP_SIZE, 1, MAP_SIZE),
    new THREE.MeshLambertMaterial({ color: 0x5a9e3f })
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  colliders.push({ type: 'plane', y: 0 });

  // Add some structures
  for (let i = 0; i < 8; i++) {
    const x = (Math.random() - 0.5) * MAP_SIZE;
    const z = (Math.random() - 0.5) * MAP_SIZE;
    const w = 4 + Math.random() * 3;
    const h = 3 + Math.random() * 2;
    
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      new THREE.MeshLambertMaterial({ color: 0x8b7355 })
    );
    building.position.set(x, h / 2, z);
    building.castShadow = true;
    scene.add(building);
  }
}

// Spawn Bots
function spawnBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 0.8;
    const z = (Math.random() - 0.5) * MAP_SIZE * 0.8;
    
    const botGroup = createHumanoid(0x663333, 0x443322);
    botGroup.position.set(x, 0, z);
    scene.add(botGroup);

    bots.push({
      mesh: botGroup,
      name: `Bot ${i + 1}`,
      health: 100,
      alive: true,
      moveDir: new THREE.Vector3(1, 0, 0),
    });
  }
}

// Player Movement
function updatePlayer(dt) {
  const sprinting = state.keys['shift'] || state.joystick.dy < -0.7;
  const speed = PLAYER_SPEED * (sprinting ? SPRINT_MULT : 1);

  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = new THREE.Vector3();

  if (state.keys['w']) move.add(forward);
  if (state.keys['s']) move.sub(forward);
  if (state.keys['a']) move.sub(right);
  if (state.keys['d']) move.add(right);

  if (move.length() > 0.01) {
    move.normalize();
    const dx = move.x * speed * dt;
    const dz = move.z * speed * dt;
    player.position.x += dx;
    player.position.z += dz;
  }

  // Gravity
  state.velocity.y -= GRAVITY * dt;
  player.position.y += state.velocity.y * dt;

  if (player.position.y <= 0) {
    player.position.y = 0;
    state.velocity.y = 0;
    state.onGround = true;
  } else {
    state.onGround = false;
  }

  // Jump
  if (state.keys[' '] && state.onGround) {
    state.velocity.y = JUMP_FORCE;
    state.onGround = false;
  }

  // Camera
  const camDist = 8;
  const camHeight = 3;
  camera.position.x = player.position.x + Math.sin(state.yaw) * camDist * Math.cos(state.pitch * 0.55);
  camera.position.y = player.position.y + camHeight + Math.sin(state.pitch) * camDist * 0.55;
  camera.position.z = player.position.z + Math.cos(state.yaw) * camDist * Math.cos(state.pitch * 0.55);

  const lookDist = 20;
  camera.lookAt(
    player.position.x - Math.sin(state.yaw) * Math.cos(state.pitch) * lookDist,
    player.position.y + 1.4 + Math.sin(state.pitch) * lookDist,
    player.position.z - Math.cos(state.yaw) * Math.cos(state.pitch) * lookDist
  );

  // Reload
  if (state.reloading) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) {
      const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
      const w = WEAPONS[weapon];
      const ammo = state.ammo[weapon];
      const needed = w.magSize - ammo.current;
      const available = Math.min(needed, ammo.reserve);
      ammo.current += available;
      ammo.reserve -= available;
      state.reloading = false;
      updateHUD();
    }
  }

  if (state.fireCooldown > 0) state.fireCooldown -= dt;
  if (state.mouseDown && state.hotbarSlot < 2) {
    const w = WEAPONS[state.hotbarSlot === 0 ? 'ar' : 'shotgun'];
    if (w.auto) {
      playerShoot();
    }
  }
}

// Shooting
function playerShoot() {
  if (state.reloading || state.fireCooldown > 0) return;

  const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
  const w = WEAPONS[weapon];
  const ammo = state.ammo[weapon];

  if (ammo.current <= 0) {
    reload();
    return;
  }

  ammo.current--;
  state.fireCooldown = w.fireRate;
  updateHUD();

  // Simple raycast check for bots
  const from = player.position.clone();
  from.y += 1.3;
  const direction = new THREE.Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();

  for (const bot of bots) {
    if (!bot.alive) continue;
    const toBot = bot.mesh.position.clone().sub(from);
    if (toBot.length() < 100) {
      const dist = Math.abs(toBot.clone().cross(direction).length() / direction.length());
      if (dist < 1.5) {
        damageBot(bot, w.damage);
      }
    }
  }
}

function reload() {
  const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
  const w = WEAPONS[weapon];
  const ammo = state.ammo[weapon];
  if (ammo.current >= w.magSize || ammo.reserve <= 0 || state.reloading) return;
  state.reloading = true;
  state.reloadDuration = w.reloadTime;
  state.reloadTimer = w.reloadTime;
}

function damageBot(bot, damage) {
  bot.health -= damage;
  if (bot.health <= 0) {
    bot.alive = false;
    scene.remove(bot.mesh);
    state.alive--;
    state.kills++;
    updateHUD();
  }
}

function updateBots(dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;

    // Simple AI: wander
    const angleChange = (Math.random() - 0.5) * 0.02;
    bot.moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleChange);
    bot.mesh.position.add(bot.moveDir.clone().multiplyScalar(2 * dt));

    // Keep in bounds
    if (Math.abs(bot.mesh.position.x) > MAP_SIZE / 2) bot.mesh.position.x *= -0.9;
    if (Math.abs(bot.mesh.position.z) > MAP_SIZE / 2) bot.mesh.position.z *= -0.9;
  }
}

function updateBullets(dt) {
  // Simplified - actual bullets would be more complex
}

function updateHUD() {
  document.getElementById('health-fill').style.width = state.health + '%';
  document.getElementById('health-text').textContent = Math.ceil(state.health);
  document.getElementById('shield-fill').style.width = state.shield + '%';
  document.getElementById('shield-text').textContent = Math.ceil(state.shield);
  document.getElementById('wood-count').textContent = state.materials.wood;
  document.getElementById('stone-count').textContent = state.materials.stone;
  document.getElementById('metal-count').textContent = state.materials.metal;
  document.getElementById('alive-count').textContent = state.alive;
  document.getElementById('kill-count').textContent = state.kills;

  const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
  const ammo = state.ammo[weapon];
  document.getElementById('ammo-current').textContent = ammo.current;
  document.getElementById('ammo-reserve').textContent = ammo.reserve;

  if (state.reloading) {
    const percent = Math.max(0, Math.min(100, 100 * (1 - state.reloadTimer / state.reloadDuration)));
    document.getElementById('reload-bar').style.width = percent + '%';
    document.getElementById('reload-container').classList.remove('hidden');
  } else {
    document.getElementById('reload-container').classList.add('hidden');
  }

  document.querySelectorAll('.slot').forEach((el, i) => {
    el.classList.toggle('active', i === state.hotbarSlot);
  });
}

function startGame() {
  document.body.classList.add('playing');
  state.playing = true;
  state.kills = 0;
  state.alive = BOT_COUNT + 1;
  state.health = 100;
  state.shield = 50;
  state.materials = { wood: 500, stone: 0, metal: 0 };
  state.ammo = { ar: { current: 30, reserve: 90 }, shotgun: { current: 6, reserve: 18 } };
  state.velocity.set(0, 0, 0);

  player.position.set(0, 2, 0);
  state.yaw = 0;
  state.pitch = 0;

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  if (!state.isMobile) {
    renderer.domElement.requestPointerLock();
  }
  updateHUD();
}

function endGame(won) {
  state.playing = false;
  document.exitPointerLock?.();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('game-over').classList.remove('hidden');
  document.getElementById('result-title').textContent = won ? '#1 VICTORY ROYALE!' : 'ELENDİN!';
  document.getElementById('result-stats').textContent = `${state.kills} öldürme | ${state.alive} oyuncu kaldı`;
}

// Input Handling
document.addEventListener('keydown', (e) => {
  state.keys[e.key.toLowerCase()] = true;

  if (e.key === '1') { state.hotbarSlot = 0; updateHUD(); }
  if (e.key === '2') { state.hotbarSlot = 1; updateHUD(); }
  if (e.key === '3') { state.hotbarSlot = 2; updateHUD(); }
  if (e.key === '4') { state.hotbarSlot = 3; updateHUD(); }
  if (e.key === 'r') reload();
  if (e.key === 'q') {
    const mats = ['wood', 'stone', 'metal'];
    const idx = mats.indexOf(state.activeMat);
    state.activeMat = mats[(idx + 1) % mats.length];
  }
});

document.addEventListener('keyup', (e) => {
  state.keys[e.key.toLowerCase()] = false;
});

document.addEventListener('mousemove', (e) => {
  if (!state.playing || document.pointerLockElement !== renderer.domElement) return;
  state.yaw -= e.movementX * 0.002;
  state.pitch -= e.movementY * 0.002;
  state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch));
});

document.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    state.mouseDown = true;
    if (state.playing) {
      const w = WEAPONS[state.hotbarSlot === 0 ? 'ar' : 'shotgun'];
      if (!w || !w.auto) playerShoot();
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) state.mouseDown = false;
});

// UI Setup
function setupUI() {
  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.addEventListener('click', startGame);

  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) restartBtn.addEventListener('click', () => {
    location.reload();
  });

  const storeBtn = document.getElementById('store-btn');
  if (storeBtn) {
    storeBtn.addEventListener('click', () => {
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('store').classList.remove('hidden');
    });
  }

  const storeBackBtn = document.getElementById('store-back-btn');
  if (storeBackBtn) {
    storeBackBtn.addEventListener('click', () => {
      document.getElementById('store').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
    });
  }

  const costumesBtn = document.getElementById('costumes-btn');
  if (costumesBtn) {
    costumesBtn.addEventListener('click', () => {
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('costumes').classList.remove('hidden');
    });
  }

  const costumesBackBtn = document.getElementById('costumes-back-btn');
  if (costumesBackBtn) {
    costumesBackBtn.addEventListener('click', () => {
      document.getElementById('costumes').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
    });
  }
}

// Game Loop
let lastTime = 0;
function gameLoop(time) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  if (state.playing) {
    updatePlayer(dt);
    updateBots(dt);
    updateBullets(dt);
  }

  renderer.render(scene, camera);
}

// Window Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialization
function init() {
  state.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900;
  
  createHumanoid();
  const humanoid = createHumanoid();
  humanoid.position.set(0, 2, 0);
  player.add(humanoid);

  generateWorld();
  spawnBots();
  setupUI();

  // Hide loading screen
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.add('hidden');
  const menuEl = document.getElementById('menu');
  if (menuEl) menuEl.classList.remove('hidden');

  gameLoop(0);
}

init();
