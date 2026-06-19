import * as THREE from 'three';

// ─── Constants ───────────────────────────────────────────────
const MAP_SIZE = 200;
const PLAYER_HEIGHT = 1.8;
const PLAYER_SPEED = 12;
const SPRINT_MULT = 1.6;
const JUMP_FORCE = 10;
const GRAVITY = 25;
const BOT_COUNT = 15;
const STORM_PHASES = [
  { wait: 60, shrink: 30, radius: 80 },
  { wait: 45, shrink: 25, radius: 50 },
  { wait: 30, shrink: 20, radius: 25 },
  { wait: 20, shrink: 15, radius: 10 },
];

const WEAPONS = {
  ar: { name: 'AR', damage: 22, fireRate: 0.1, magSize: 30, reserve: 90, range: 120, spread: 0.02, auto: true },
  shotgun: { name: 'Pompalı', damage: 12, pellets: 8, fireRate: 0.8, magSize: 6, reserve: 18, range: 25, spread: 0.15, auto: false },
};

const BUILD_COST = { wall: 10, ramp: 10 };
const BUILD_HP = { wood: 150, stone: 300, metal: 500 };

// ─── Game State ────────────────────────────────────────────────
const state = {
  playing: false,
  paused: false,
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
  fireCooldown: 0,
  stormPhase: 0,
  stormTimer: 0,
  stormRadius: 100,
  stormCenter: new THREE.Vector3(0, 0, 0),
  stormShrinking: false,
  stormShrinkTimer: 0,
  stormTargetRadius: 80,
  keys: {},
  mouseDown: false,
  mouseX: 0,
  mouseY: 0,
  yaw: 0,
  pitch: 0,
  velocity: new THREE.Vector3(),
  onGround: false,
  canJump: true,
  buildMode: false,
  buildType: 'wall',
  buildPreview: null,
  damageFlash: 0,
};

// ─── Three.js Setup ────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 250);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 200;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
scene.add(sunLight);

// ─── World ─────────────────────────────────────────────────────
const colliders = [];
const buildings = [];
const lootItems = [];
const bots = [];
const bullets = [];
const particles = [];

function createTerrain() {
  const geo = new THREE.PlaneGeometry(MAP_SIZE * 2, MAP_SIZE * 2, 64, 64);
  const verts = geo.attributes.position;
  for (let i = 0; i < verts.count; i++) {
    const x = verts.getX(i);
    const y = verts.getY(i);
    const h = noise2D(x * 0.02, y * 0.02) * 4 + noise2D(x * 0.05, y * 0.05) * 2;
    verts.setZ(i, h);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ color: 0x4a9c2e });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Water
  const waterGeo = new THREE.PlaneGeometry(MAP_SIZE * 4, MAP_SIZE * 4);
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1a6b8a, transparent: true, opacity: 0.8 });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.5;
  scene.add(water);

  return terrain;
}

function noise2D(x, y) {
  return Math.sin(x * 1.7 + y * 2.3) * Math.cos(y * 1.3 - x * 0.9) * 0.5 +
    Math.sin(x * 3.1 + y * 1.1) * 0.3;
}

function getTerrainHeight(x, z) {
  return noise2D(x * 0.02, z * 0.02) * 4 + noise2D(x * 0.05, z * 0.05) * 2;
}

function createTree(x, z) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b3a1f });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1.5;
  trunk.castShadow = true;
  group.add(trunk);

  const leafGeo = new THREE.ConeGeometry(2, 4, 8);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2d6b1e });
  const leaves = new THREE.Mesh(leafGeo, leafMat);
  leaves.position.y = 4.5;
  leaves.castShadow = true;
  group.add(leaves);

  const y = getTerrainHeight(x, z);
  group.position.set(x, y, z);
  scene.add(group);
  colliders.push({ type: 'cylinder', x, z, radius: 0.5, minY: y, maxY: y + 6 });
}

function createRock(x, z) {
  const geo = new THREE.DodecahedronGeometry(1 + Math.random() * 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const rock = new THREE.Mesh(geo, mat);
  const y = getTerrainHeight(x, z);
  rock.position.set(x, y + 0.5, z);
  rock.castShadow = true;
  scene.add(rock);
  colliders.push({ type: 'sphere', x, z, radius: 1, minY: y, maxY: y + 2 });
}

function createBuilding(x, z, w, d, h) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xccaa88 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), wallMat);
  floor.position.y = 0.1;
  floor.receiveShadow = true;
  group.add(floor);

  const walls = [
  { sx: w, sy: h, sz: 0.2, px: 0, py: h / 2, pz: d / 2 },
  { sx: w, sy: h, sz: 0.2, px: 0, py: h / 2, pz: -d / 2 },
  { sx: 0.2, sy: h, sz: d, px: w / 2, py: h / 2, pz: 0 },
  { sx: 0.2, sy: h, sz: d, px: -w / 2, py: h / 2, pz: 0 },
  ];
  walls.forEach(wl => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wl.sx, wl.sy, wl.sz), wallMat);
    wall.position.set(wl.px, wl.py, wl.pz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  });

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.3, d + 0.5), roofMat);
  roof.position.y = h + 0.15;
  roof.castShadow = true;
  group.add(roof);

  const y = getTerrainHeight(x, z);
  group.position.set(x, y, z);
  scene.add(group);
  colliders.push({ type: 'box', x, z, hw: w / 2, hd: d / 2, minY: y, maxY: y + h + 0.5 });
}

function generateWorld() {
  createTerrain();

  for (let i = 0; i < 80; i++) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 1.5;
    const z = (Math.random() - 0.5) * MAP_SIZE * 1.5;
    if (Math.abs(x) > 10 || Math.abs(z) > 10) createTree(x, z);
  }

  for (let i = 0; i < 30; i++) {
    const x = (Math.random() - 0.5) * MAP_SIZE * 1.2;
    const z = (Math.random() - 0.5) * MAP_SIZE * 1.2;
    createRock(x, z);
  }

  const buildingPositions = [
    [30, 30], [-40, 25], [20, -35], [-30, -40], [50, -20], [-50, 10], [0, 50], [-20, 60],
  ];
  buildingPositions.forEach(([x, z]) => {
    createBuilding(x, z, 6 + Math.random() * 4, 6 + Math.random() * 4, 3 + Math.random() * 2);
  });

  // Loot chests
  for (let i = 0; i < 25; i++) {
    spawnLoot(
      (Math.random() - 0.5) * MAP_SIZE,
      (Math.random() - 0.5) * MAP_SIZE
    );
  }
}

function spawnLoot(x, z) {
  const types = ['wood', 'stone', 'metal', 'shield', 'ammo_ar', 'ammo_sg'];
  const type = types[Math.floor(Math.random() * types.length)];
  const geo = new THREE.BoxGeometry(0.8, 0.6, 0.8);
  const colors = { wood: 0x8b6914, stone: 0x888888, metal: 0x4488cc, shield: 0x3b82f6, ammo_ar: 0xff6600, ammo_sg: 0xff3300 };
  const mat = new THREE.MeshLambertMaterial({ color: colors[type] || 0xffd700, emissive: colors[type] || 0xffd700, emissiveIntensity: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  const y = getTerrainHeight(x, z) + 0.5;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  scene.add(mesh);

  const glow = new THREE.PointLight(colors[type] || 0xffd700, 0.5, 5);
  glow.position.copy(mesh.position);
  glow.position.y += 0.5;
  scene.add(glow);

  lootItems.push({ mesh, glow, type, x, z, collected: false });
}

// ─── Player ────────────────────────────────────────────────────
const player = new THREE.Group();
const playerBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
  new THREE.MeshLambertMaterial({ color: 0x3b82f6 })
);
playerBody.position.y = 0.9;
playerBody.castShadow = true;
player.add(playerBody);

const playerHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 8, 8),
  new THREE.MeshLambertMaterial({ color: 0xffcc99 })
);
playerHead.position.y = 1.8;
playerHead.castShadow = true;
player.add(playerHead);

const gunGroup = new THREE.Group();
const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.08, 0.5),
  new THREE.MeshLambertMaterial({ color: 0x333333 })
);
gunBody.position.set(0.3, 1.3, -0.3);
gunGroup.add(gunBody);
player.add(gunGroup);

scene.add(player);

// ─── Storm Visual ──────────────────────────────────────────────
let stormMesh = null;
function createStormVisual() {
  const geo = new THREE.RingGeometry(state.stormRadius - 2, state.stormRadius, 64);
  const mat = new THREE.MeshBasicMaterial({ color: 0x9933ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
  stormMesh = new THREE.Mesh(geo, mat);
  stormMesh.rotation.x = -Math.PI / 2;
  stormMesh.position.y = 0.5;
  scene.add(stormMesh);

  const safeGeo = new THREE.RingGeometry(state.stormRadius - 4, state.stormRadius - 2, 64);
  const safeMat = new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
  const safeRing = new THREE.Mesh(safeGeo, safeMat);
  safeRing.rotation.x = -Math.PI / 2;
  safeRing.position.y = 0.6;
  stormMesh.add(safeRing);
}

function updateStormVisual() {
  if (!stormMesh) return;
  stormMesh.scale.set(state.stormRadius / 100, state.stormRadius / 100, 1);
  stormMesh.position.set(state.stormCenter.x, 0.5, state.stormCenter.z);
}

// ─── Bot AI ────────────────────────────────────────────────────
const BOT_NAMES = ['Shadow', 'Blaze', 'Viper', 'Ghost', 'Raven', 'Storm', 'Fury', 'Ace', 'Nova', 'Titan', 'Wolf', 'Hawk', 'Bolt', 'Rex', 'Zara'];

function createBot(x, z, index) {
  const group = new THREE.Group();
  const colors = [0xff4444, 0xff8844, 0xff44aa, 0x44ff44, 0x44aaff, 0xffaa00];
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshLambertMaterial({ color: colors[index % colors.length] })
  );
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0xffcc99 })
  );
  head.position.y = 1.8;
  head.castShadow = true;
  group.add(head);

  const y = getTerrainHeight(x, z);
  group.position.set(x, y, z);
  scene.add(group);

  return {
    mesh: group,
    name: BOT_NAMES[index % BOT_NAMES.length],
    health: 100,
    shield: 0,
    alive: true,
    target: null,
    state: 'wander',
    stateTimer: 0,
    moveDir: new THREE.Vector3(),
    fireCooldown: 0,
    weapon: Math.random() > 0.5 ? 'ar' : 'shotgun',
  };
}

function spawnBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    let x, z;
    do {
      x = (Math.random() - 0.5) * MAP_SIZE * 1.2;
      z = (Math.random() - 0.5) * MAP_SIZE * 1.2;
    } while (Math.sqrt(x * x + z * z) < 30);
    bots.push(createBot(x, z, i));
  }
}

// ─── Building System ───────────────────────────────────────────
function createBuildPiece(type, position, rotation, material) {
  const group = new THREE.Group();
  let geo, hp;

  const matColors = { wood: 0x8b6914, stone: 0x888888, metal: 0x6688aa };
  const mat = new THREE.MeshLambertMaterial({ color: matColors[material] || 0x8b6914 });

  if (type === 'wall') {
    geo = new THREE.BoxGeometry(4, 3, 0.2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 1.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    hp = BUILD_HP[material];
  } else if (type === 'ramp') {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(4, 0);
    shape.lineTo(4, 3);
    shape.closePath();
    const extrudeSettings = { depth: 4, bevelEnabled: false };
    geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI / 2;
    mesh.castShadow = true;
    group.add(mesh);
    hp = BUILD_HP[material];
  }

  group.position.copy(position);
  group.rotation.y = rotation;
  scene.add(group);

  const build = { mesh: group, type, hp, maxHp: hp, material };
  buildings.push(build);
  colliders.push({
    type: 'box',
    x: position.x,
    z: position.z,
    hw: 2,
    hd: type === 'wall' ? 0.1 : 2,
    minY: position.y,
    maxY: position.y + 3,
    buildRef: build,
  });

  return build;
}

function getBuildPreviewPosition() {
  const dir = new THREE.Vector3(
    -Math.sin(state.yaw),
    0,
    -Math.cos(state.yaw)
  );
  const pos = player.position.clone().add(dir.multiplyScalar(5));
  pos.y = getTerrainHeight(pos.x, pos.z);
  const gridSize = 4;
  pos.x = Math.round(pos.x / gridSize) * gridSize;
  pos.z = Math.round(pos.z / gridSize) * gridSize;
  return pos;
}

function updateBuildPreview() {
  if (state.hotbarSlot < 2) {
    if (state.buildPreview) {
      scene.remove(state.buildPreview);
      state.buildPreview = null;
    }
    return;
  }

  const type = state.hotbarSlot === 2 ? 'wall' : 'ramp';
  const pos = getBuildPreviewPosition();

  if (!state.buildPreview) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x00ff00, transparent: true, opacity: 0.4 });
    if (type === 'wall') {
      state.buildPreview = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2), mat);
      state.buildPreview.position.y = 1.5;
    } else {
      state.buildPreview = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), mat);
      state.buildPreview.position.y = 1.5;
    }
    scene.add(state.buildPreview);
  }

  state.buildPreview.position.x = pos.x;
  state.buildPreview.position.z = pos.z;
  state.buildPreview.position.y = pos.y + (type === 'wall' ? 1.5 : 1.5);
  state.buildPreview.rotation.y = state.yaw;
}

function placeBuild() {
  const type = state.hotbarSlot === 2 ? 'wall' : 'ramp';
  const cost = BUILD_COST[type];
  if (state.materials[state.activeMat] < cost) return;

  state.materials[state.activeMat] -= cost;
  const pos = getBuildPreviewPosition();
  createBuildPiece(type, pos, state.yaw, state.activeMat);
  updateHUD();
}

// ─── Shooting ──────────────────────────────────────────────────
function shoot(from, direction, damage, owner, spread = 0) {
  const dir = direction.clone();
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();

  const bullet = {
    position: from.clone(),
    direction: dir,
    damage,
    owner,
    life: 2,
    speed: 150,
  };
  bullets.push(bullet);

  // Muzzle flash particle
  spawnParticle(from, 0xffaa00, 0.15, 0.1);
}

function playerShoot() {
  if (state.reloading || state.fireCooldown > 0) return;
  if (state.hotbarSlot >= 2) {
    placeBuild();
    return;
  }

  const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
  const w = WEAPONS[weapon === 'ar' ? 'ar' : 'shotgun'];
  const ammo = state.ammo[weapon];

  if (ammo.current <= 0) {
    reload();
    return;
  }

  ammo.current--;
  state.fireCooldown = w.fireRate;
  updateHUD();

  const from = player.position.clone();
  from.y += 1.4;
  const dir = new THREE.Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  );

  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    shoot(from, dir, w.damage, 'player', w.spread);
  }

  // Recoil
  state.pitch += 0.01;
}

function reload() {
  const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
  const w = WEAPONS[weapon === 'ar' ? 'ar' : 'shotgun'];
  const ammo = state.ammo[weapon];
  if (ammo.current >= w.magSize || ammo.reserve <= 0 || state.reloading) return;
  state.reloading = true;
  state.reloadTimer = 1.5;
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }

    b.position.add(b.direction.clone().multiplyScalar(b.speed * dt));

    // Hit bots
    if (b.owner === 'player') {
      for (const bot of bots) {
        if (!bot.alive) continue;
        const dist = b.position.distanceTo(bot.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)));
        if (dist < 1) {
          damageBot(bot, b.damage, b.owner);
          bullets.splice(i, 1);
          spawnParticle(b.position, 0xff0000, 0.2, 0.2);
          break;
        }
      }
    }

    // Hit player
    if (b.owner !== 'player') {
      const dist = b.position.distanceTo(player.position.clone().add(new THREE.Vector3(0, 1, 0)));
      if (dist < 1) {
        damagePlayer(b.damage);
        bullets.splice(i, 1);
        spawnParticle(b.position, 0xff0000, 0.2, 0.2);
      }
    }

    // Hit buildings
    for (const build of buildings) {
      const dist = b.position.distanceTo(build.mesh.position);
      if (dist < 3) {
        build.hp -= b.damage;
        bullets.splice(i, 1);
        spawnParticle(b.position, 0xcccccc, 0.15, 0.15);
        if (build.hp <= 0) destroyBuilding(build);
        break;
      }
    }
  }
}

function damageBot(bot, damage, killer = null) {
  if (bot.shield > 0) {
    const absorbed = Math.min(bot.shield, damage);
    bot.shield -= absorbed;
    damage -= absorbed;
  }
  bot.health -= damage;

  if (bot.health <= 0) {
    bot.alive = false;
    scene.remove(bot.mesh);
    state.alive--;
    if (killer === 'player') {
      state.kills++;
      addKillFeed(`Sen → ${bot.name}`);
    } else {
      addKillFeed(`${bot.name} elendi`);
    }
    updateHUD();

    // Drop loot
    spawnLoot(bot.mesh.position.x, bot.mesh.position.z);

    if (state.alive <= 1) {
      endGame(true);
    }
  }
}

function damagePlayer(damage) {
  if (state.shield > 0) {
    const absorbed = Math.min(state.shield, damage);
    state.shield -= absorbed;
    damage -= absorbed;
  }
  state.health -= damage;
  state.damageFlash = 0.3;
  updateHUD();

  if (state.health <= 0) {
    endGame(false);
  }
}

// ─── Particles ─────────────────────────────────────────────────
function spawnParticle(pos, color, size, life) {
  const geo = new THREE.SphereGeometry(size, 4, 4);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  particles.push({ mesh, life, maxLife: life });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
      continue;
    }
    p.mesh.material.opacity = p.life / p.maxLife;
    p.mesh.scale.multiplyScalar(0.95);
  }
}

function destroyBuilding(build) {
  const idx = buildings.indexOf(build);
  if (idx >= 0) buildings.splice(idx, 1);
  scene.remove(build.mesh);
  spawnParticle(build.mesh.position, 0x8b6914, 0.5, 0.5);
}

// ─── Bot AI Update ─────────────────────────────────────────────
function updateBots(dt) {
  for (const bot of bots) {
    if (!bot.alive) continue;

    bot.stateTimer -= dt;
    bot.fireCooldown -= dt;

    const distToPlayer = bot.mesh.position.distanceTo(player.position);
    const inStorm = isInStorm(bot.mesh.position);

    if (inStorm) {
      bot.health -= 5 * dt;
      if (bot.health <= 0) {
        bot.alive = false;
        scene.remove(bot.mesh);
        state.alive--;
        addKillFeed(`${bot.name} fırtınada elendi`);
        updateHUD();
        continue;
      }
    }

    // Detect player
    if (distToPlayer < 40 && !inStorm) {
      bot.state = 'attack';
      bot.target = 'player';
    }

    if (bot.state === 'attack' && bot.target === 'player') {
      const dir = player.position.clone().sub(bot.mesh.position).normalize();
      bot.mesh.position.add(dir.multiplyScalar(6 * dt));
      bot.mesh.position.y = getTerrainHeight(bot.mesh.position.x, bot.mesh.position.z);
      bot.mesh.lookAt(player.position.x, bot.mesh.position.y, player.position.z);

      if (distToPlayer < 30 && bot.fireCooldown <= 0) {
        const from = bot.mesh.position.clone();
        from.y += 1.4;
        const shootDir = player.position.clone().sub(from).normalize();
        const w = WEAPONS[bot.weapon === 'ar' ? 'ar' : 'shotgun'];
        bot.fireCooldown = w.fireRate;
        const pellets = w.pellets || 1;
        for (let i = 0; i < pellets; i++) {
          shoot(from, shootDir, w.damage * 0.6, bot.name, w.spread);
        }
      }

      if (distToPlayer > 50) {
        bot.state = 'wander';
        bot.target = null;
      }
    } else {
      // Wander or move to safe zone
      if (bot.stateTimer <= 0) {
        bot.stateTimer = 2 + Math.random() * 3;
        const angle = Math.random() * Math.PI * 2;
        bot.moveDir.set(Math.cos(angle), 0, Math.sin(angle));

        const distToCenter = bot.mesh.position.distanceTo(state.stormCenter);
        if (distToCenter > state.stormRadius * 0.7) {
          bot.moveDir = state.stormCenter.clone().sub(bot.mesh.position).normalize();
        }
      }
      bot.mesh.position.add(bot.moveDir.clone().multiplyScalar(4 * dt));
      bot.mesh.position.y = getTerrainHeight(bot.mesh.position.x, bot.mesh.position.z);
    }

    // Bot vs bot combat
    for (const other of bots) {
      if (other === bot || !other.alive) continue;
      const d = bot.mesh.position.distanceTo(other.mesh.position);
      if (d < 25 && Math.random() < 0.01) {
        const from = bot.mesh.position.clone();
        from.y += 1.4;
        const dir = other.mesh.position.clone().sub(from).normalize();
        shoot(from, dir, 15, bot.name, 0.05);
        if (Math.random() < 0.3) {
          damageBot(other, 20 + Math.random() * 30);
          if (!other.alive) {
            state.kills = Math.max(0, state.kills);
            addKillFeed(`${bot.name} → ${other.name}`);
          }
        }
      }
    }
  }
}

// ─── Storm System ──────────────────────────────────────────────
function isInStorm(pos) {
  return pos.distanceTo(state.stormCenter) > state.stormRadius;
}

function updateStorm(dt) {
  if (state.stormPhase >= STORM_PHASES.length) return;

  const phase = STORM_PHASES[state.stormPhase];

  if (!state.stormShrinking) {
    state.stormTimer -= dt;
    if (state.stormTimer <= 0) {
      state.stormShrinking = true;
      state.stormShrinkTimer = phase.shrink;
      state.stormTargetRadius = phase.radius;
    }
  } else {
    state.stormShrinkTimer -= dt;
    const shrinkSpeed = (100 - state.stormTargetRadius) / phase.shrink;
    state.stormRadius = Math.max(state.stormTargetRadius, state.stormRadius - shrinkSpeed * dt);
    updateStormVisual();

    if (state.stormShrinkTimer <= 0) {
      state.stormShrinking = false;
      state.stormPhase++;
      if (state.stormPhase < STORM_PHASES.length) {
        state.stormTimer = STORM_PHASES[state.stormPhase].wait;
      }
    }
  }

  // Damage player in storm
  if (isInStorm(player.position)) {
    const stormDmg = 2 + state.stormPhase * 2;
    damagePlayer(stormDmg * dt);
    document.getElementById('storm-overlay').style.opacity = '0.6';
  } else {
    document.getElementById('storm-overlay').style.opacity = '0';
  }

  const mins = Math.floor(Math.max(0, state.stormTimer) / 60);
  const secs = Math.floor(Math.max(0, state.stormTimer) % 60);
  document.getElementById('storm-countdown').textContent =
    `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ─── Loot Collection ───────────────────────────────────────────
function updateLoot() {
  for (const loot of lootItems) {
    if (loot.collected) continue;
    loot.mesh.rotation.y += 0.02;
    loot.mesh.position.y = getTerrainHeight(loot.x, loot.z) + 0.5 + Math.sin(Date.now() * 0.003) * 0.2;

    const dist = player.position.distanceTo(loot.mesh.position);
    if (dist < 2) {
      collectLoot(loot);
    }
  }
}

function collectLoot(loot) {
  loot.collected = true;
  scene.remove(loot.mesh);
  scene.remove(loot.glow);

  switch (loot.type) {
    case 'wood': state.materials.wood += 50; break;
    case 'stone': state.materials.stone += 50; break;
    case 'metal': state.materials.metal += 50; break;
    case 'shield': state.shield = Math.min(100, state.shield + 25); break;
    case 'ammo_ar': state.ammo.ar.reserve += 30; break;
    case 'ammo_sg': state.ammo.shotgun.reserve += 6; break;
  }
  updateHUD();
}

// ─── Player Movement ───────────────────────────────────────────
function updatePlayer(dt) {
  const speed = PLAYER_SPEED * (state.keys['shift'] ? SPRINT_MULT : 1);
  const moveDir = new THREE.Vector3();

  if (state.keys['w']) moveDir.z -= 1;
  if (state.keys['s']) moveDir.z += 1;
  if (state.keys['a']) moveDir.x -= 1;
  if (state.keys['d']) moveDir.x += 1;

  if (moveDir.length() > 0) {
    moveDir.normalize();
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    const dx = moveDir.x * cos - moveDir.z * sin;
    const dz = moveDir.x * sin + moveDir.z * cos;
    player.position.x += dx * speed * dt;
    player.position.z += dz * speed * dt;
  }

  // Gravity
  state.velocity.y -= GRAVITY * dt;
  player.position.y += state.velocity.y * dt;

  const groundY = getTerrainHeight(player.position.x, player.position.z);
  if (player.position.y <= groundY) {
    player.position.y = groundY;
    state.velocity.y = 0;
    state.onGround = true;
  } else {
    state.onGround = false;
  }

  if (state.keys[' '] && state.onGround) {
    state.velocity.y = JUMP_FORCE;
    state.onGround = false;
  }

  player.rotation.y = state.yaw;

  // Camera (third person)
  const camDist = 6;
  const camHeight = 3;
  camera.position.x = player.position.x + Math.sin(state.yaw) * camDist * Math.cos(state.pitch * 0.5);
  camera.position.y = player.position.y + camHeight + Math.sin(state.pitch) * camDist * 0.5;
  camera.position.z = player.position.z + Math.cos(state.yaw) * camDist * Math.cos(state.pitch * 0.5);
  camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z);

  // Collect nearby loot with E
  if (state.keys['e']) {
  for (const loot of lootItems) {
    if (!loot.collected && player.position.distanceTo(loot.mesh.position) < 5) {
      collectLoot(loot);
      break;
    }
  }
  }

  // Reload
  if (state.reloading) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) {
      const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
      const w = WEAPONS[weapon === 'ar' ? 'ar' : 'shotgun'];
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

  if (state.damageFlash > 0) {
    state.damageFlash -= dt;
    document.getElementById('damage-overlay').style.opacity = state.damageFlash * 2;
  }

  updateBuildPreview();
}

// ─── HUD ───────────────────────────────────────────────────────
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

  document.querySelectorAll('.slot').forEach((el, i) => {
    el.classList.toggle('active', i === state.hotbarSlot);
  });
  document.querySelectorAll('.mat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mat === state.activeMat);
  });
}

function addKillFeed(text) {
  const feed = document.getElementById('kill-feed');
  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  entry.textContent = text;
  feed.appendChild(entry);
  setTimeout(() => entry.remove(), 4000);
  while (feed.children.length > 5) feed.firstChild.remove();
}

// ─── Game Flow ─────────────────────────────────────────────────
function startGame() {
  state.playing = true;
  state.kills = 0;
  state.alive = BOT_COUNT + 1;
  state.health = 100;
  state.shield = 50;
  state.materials = { wood: 500, stone: 0, metal: 0 };
  state.stormPhase = 0;
  state.stormTimer = STORM_PHASES[0].wait;
  state.stormRadius = 100;
  state.stormShrinking = false;
  state.ammo = { ar: { current: 30, reserve: 90 }, shotgun: { current: 6, reserve: 18 } };

  player.position.set(0, getTerrainHeight(0, 0), 0);
  state.yaw = 0;
  state.pitch = 0;

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('game-over').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  renderer.domElement.requestPointerLock();
  updateHUD();
}

function endGame(won) {
  state.playing = false;
  document.exitPointerLock();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('game-over').classList.remove('hidden');
  document.getElementById('result-title').textContent = won ? '#1 VICTORY ROYALE!' : 'ELENDİN!';
  document.getElementById('result-title').style.background = won
    ? 'linear-gradient(90deg, #ffd700, #ff8c00)'
    : 'linear-gradient(90deg, #ff4444, #cc0000)';
  document.getElementById('result-title').style.webkitBackgroundClip = 'text';
  document.getElementById('result-stats').textContent =
    `${state.kills} öldürme | ${state.alive} oyuncu kaldı`;
}

function resetGame() {
  bullets.length = 0;
  particles.length = 0;
  buildings.forEach(b => scene.remove(b.mesh));
  buildings.length = 0;
  colliders.length = 0;
  lootItems.forEach(l => { if (!l.collected) { scene.remove(l.mesh); scene.remove(l.glow); } });
  lootItems.length = 0;
  bots.forEach(b => scene.remove(b.mesh));
  bots.length = 0;

  while (scene.children.length > 0) scene.remove(scene.children[0]);
  scene.add(ambientLight);
  scene.add(sunLight);

  generateWorld();
  createStormVisual();
  spawnBots();
  scene.add(player);
  startGame();
}

// ─── Input ─────────────────────────────────────────────────────
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
    updateHUD();
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
      else if (state.hotbarSlot >= 2) playerShoot();
    }
  }
});

document.addEventListener('mouseup', (e) => {
  if (e.button === 0) state.mouseDown = false;
});

document.getElementById('play-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', resetGame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Game Loop ─────────────────────────────────────────────────
let lastTime = 0;
function gameLoop(time) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  if (state.playing) {
    updatePlayer(dt);
    updateBots(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateStorm(dt);
    updateLoot();
  }

  renderer.render(scene, camera);
}

// ─── Init ──────────────────────────────────────────────────────
async function init() {
  generateWorld();
  createStormVisual();
  spawnBots();

  player.position.set(0, getTerrainHeight(0, 0), 0);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 1, 0);

  document.getElementById('loading').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');

  gameLoop(0);
}

init();
