import * as THREE from './node_modules/three/build/three.module.js';
import { FBXLoader } from './node_modules/three/examples/jsm/loaders/FBXLoader.js';

const GAME_VERSION = '1.3.0';
console.info(`Battle Island v${GAME_VERSION}`);

const MAP_SIZE = 200;
const PLAYER_HEIGHT = 1.75;
const PLAYER_SPEED = 5.5;
const SPRINT_MULT = 1.35;
const JUMP_FORCE = 8;
const GRAVITY = 28;
const GROUND_SKIN = 0.02;
const PLAYER_RADIUS = 0.45;
const PLAYER_BODY_HEIGHT = 1.75;
const BOT_COUNT = 15;
const STORM_PHASES = [
  { wait: 60, shrink: 30, radius: 80 },
  { wait: 45, shrink: 25, radius: 50 },
  { wait: 30, shrink: 20, radius: 25 },
  { wait: 20, shrink: 15, radius: 10 },
];

const WEAPONS = {
  ar: { name: 'AR', damage: 22, fireRate: 0.1, magSize: 30, reserve: 90, range: 120, spread: 0.02, auto: true, reloadTime: 1.5 },
  shotgun: { name: 'Pompalı', damage: 12, pellets: 8, fireRate: 0.8, magSize: 6, reserve: 18, range: 25, spread: 0.15, auto: false, reloadTime: 2.2 },
};

const BUILD_COST = { wall: 10, ramp: 10 };
const BUILD_HP = { wood: 150, stone: 300, metal: 500 };
const DPAPEL_PACKAGES = [
  { amount: 1000, price: 30 },
  { amount: 2500, price: 70 },
  { amount: 5000, price: 100 },
  { amount: 10000, price: 150 },
  { amount: 20000, price: 200 },
];
const COSTUME_PRICES = {
  deadpool1: 2500,
  deadpool2: 2500,
  'Ch20_nonPBR.fbx': 2450,
};

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
  dpapel: 0,
  ownedCostumes: ['soldier'],
  weapon: 'ar',
  ammo: { ar: { current: 30, reserve: 90 }, shotgun: { current: 6, reserve: 18 } },
  openChestHold: { active: false, chest: null, elapsed: 0, threshold: 0.8, isMobile: false },
  reloading: false,
  reloadTimer: 0,
  reloadDuration: 0,
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
  isMobile: false,
  joystick: { active: false, dx: 0, dy: 0, id: null },
  lookTouch: { active: false, lastX: 0, lastY: 0, id: null },
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 250);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
const _isMobileDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900;
const renderer = new THREE.WebGLRenderer({ antialias: !_isMobileDevice });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(_isMobileDevice ? 1.0 : Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = !_isMobileDevice;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

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

const colliders = [];
const buildings = [];
const lootItems = [];
const chests = [];
const healStations = [];
const bots = [];
const bullets = [];
const particles = [];

let gunGroup = null;
const gunInitialPosition = new THREE.Vector3();
const gunInitialRotation = new THREE.Euler();

const player = new THREE.Group();
player.name = 'Player';
player.userData.isPlayer = true;
player.visible = false;
scene.add(player);

function setupProceduralPlayerFallback() {
  player.clear();
  const costume = COSTUMES[currentCostume] || COSTUMES['soldier'];
  const bodyColor = costume.bodyColor ?? 0x445566;
  const pantsColor = costume.pantsColor ?? 0x2f3b4a;
  const fbx = createHumanoid(bodyColor, pantsColor, { showVisor: true, ...costume });
  fbx.scale.setScalar(0.9);
  player.add(fbx);
  player.visible = true;
  player.userData.model = fbx;
  player.userData.lastMoveYaw = 0;
  player.userData.modelYawOffset = 0;
  setupPlayerProceduralParts(fbx);
  setupMixamoArmBones(fbx);
  loadRightHandWeapon();
  console.info('Procedural player fallback initialized.');
}

function setupProceduralWeaponFallback() {
  if (player.userData.handWeapon) {
    if (player.userData.handWeapon.parent) {
      player.userData.handWeapon.parent.remove(player.userData.handWeapon);
    }
    player.userData.handWeapon = null;
  }
  const handBone = player.userData.mixamoArmBones?.RightHand || player.userData.mixamoArmBones?.RightForeArm;
  const swordGeo = new THREE.BoxGeometry(0.08, 0.9, 0.03);
  const swordMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  const swordMesh = new THREE.Mesh(swordGeo, swordMat);
  swordMesh.castShadow = true;
  const guardGeo = new THREE.BoxGeometry(0.24, 0.05, 0.05);
  const guardMat = new THREE.MeshLambertMaterial({ color: 0xaa8800 });
  const guardMesh = new THREE.Mesh(guardGeo, guardMat);
  guardMesh.position.y = -0.3;
  swordMesh.add(guardMesh);
  const weaponGroup = new THREE.Group();
  weaponGroup.add(swordMesh);
  weaponGroup.name = 'Weapon';
  if (handBone) {
    handBone.add(weaponGroup);
    weaponGroup.position.set(0.05, -0.05, -0.1);
    weaponGroup.rotation.set(-Math.PI / 2, 0, 0);
  } else {
    player.add(weaponGroup);
    weaponGroup.position.set(0.3, 0.9, -0.4);
    weaponGroup.rotation.set(-Math.PI / 4, 0, 0);
  }
  player.userData.handWeapon = weaponGroup;
  console.info('Procedural weapon fallback initialized.');
}

function loadPlayerModel() {
  setupProceduralPlayerFallback();
  const loader = new FBXLoader();
  const modelPath = './X%20Bot.fbx';
  loader.load(modelPath, (fbx) => {
    fbx.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const bbox = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const targetHeight = PLAYER_HEIGHT;
    const rawScale = size.y > 0 ? targetHeight / size.y : 1;
    const maxModelScale = 0.22;
    const scale = Math.min(rawScale, maxModelScale);
    fbx.scale.setScalar(scale);
    const scaledBox = new THREE.Box3().setFromObject(fbx);
    const minY = scaledBox.min.y;
    fbx.position.y -= minY;
    player.clear();
    player.add(fbx);
    player.visible = true;
    player.userData.model = fbx;
    player.userData.lastMoveYaw = 0;
    player.userData.modelYawOffset = 0;
    setupPlayerProceduralParts(fbx);
    setupMixamoArmBones(fbx);
    loadRightHandWeapon();
    if (fbx.animations && fbx.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(fbx);
      player.userData.mixer = mixer;
      player.userData.actions = {};
      const clips = fbx.animations;
      const idleClip = findClip(clips, ['Idle', 'idle', 'Stand', 'stand']);
      const walkClip = findClip(clips, ['Walk', 'walk', 'WalkCycle']);
      const runClip = findClip(clips, ['Run', 'run', 'Sprint', 'sprint']);
      const reloadClip = findClip(clips, ['Reload', 'reload']);
      const shootClip = findClip(clips, ['Shoot', 'shoot', 'Fire', 'fire']);
      if (idleClip) player.userData.actions.Idle = mixer.clipAction(idleClip);
      if (walkClip) player.userData.actions.Walk = mixer.clipAction(walkClip);
      if (runClip) player.userData.actions.Run = mixer.clipAction(runClip);
      if (reloadClip) player.userData.actions.Reload = mixer.clipAction(reloadClip);
      if (shootClip) player.userData.actions.Shoot = mixer.clipAction(shootClip);
      if (player.userData.actions.Idle) {
        player.userData.actions.Idle.play();
        player.userData.currentAction = player.userData.actions.Idle;
      }
    }
  }, undefined, () => {});
}

function loadCustomFBXModel(modelPath, enableArmSwing = true) {
  setupProceduralPlayerFallback();
  player.userData.enableArmSwing = enableArmSwing;
  if (state.isMobile) return;
  const loader = new FBXLoader();
  loader.load(modelPath, (fbx) => {
    fbx.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const bbox = new THREE.Box3().setFromObject(fbx);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const targetHeight = PLAYER_HEIGHT;
    const rawScale = size.y > 0 ? targetHeight / size.y : 1;
    const maxModelScale = 0.22;
    const scale = Math.min(rawScale, maxModelScale);
    fbx.scale.setScalar(scale);
    const scaledBox = new THREE.Box3().setFromObject(fbx);
    const minY = scaledBox.min.y;
    fbx.position.y -= minY;
    player.clear();
    player.add(fbx);
    player.visible = true;
    player.userData.model = fbx;
    player.userData.lastMoveYaw = 0;
    player.userData.modelYawOffset = 0;
    setupPlayerProceduralParts(fbx);
    setupMixamoArmBones(fbx);
    loadRightHandWeapon();
    if (fbx.animations && fbx.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(fbx);
      player.userData.mixer = mixer;
      player.userData.actions = {};
      const clips = fbx.animations;
      const idleClip = findClip(clips, ['Idle', 'idle', 'Stand', 'stand']);
      const walkClip = findClip(clips, ['Walk', 'walk', 'WalkCycle']);
      const runClip = findClip(clips, ['Run', 'run', 'Sprint', 'sprint']);
      const reloadClip = findClip(clips, ['Reload', 'reload']);
      const shootClip = findClip(clips, ['Shoot', 'shoot', 'Fire', 'fire']);
      if (idleClip) player.userData.actions.Idle = mixer.clipAction(idleClip);
      if (walkClip) player.userData.actions.Walk = mixer.clipAction(walkClip);
      if (runClip) player.userData.actions.Run = mixer.clipAction(runClip);
      if (reloadClip) player.userData.actions.Reload = mixer.clipAction(reloadClip);
      if (shootClip) player.userData.actions.Shoot = mixer.clipAction(shootClip);
      if (player.userData.actions.Idle) {
        player.userData.actions.Idle.play();
        player.userData.currentAction = player.userData.actions.Idle;
      }
    }
  }, undefined, () => {});
}

function findClip(clips, keywords) {
  for (const keyword of keywords) {
    const clip = clips.find((c) => c.name.toLowerCase().includes(keyword.toLowerCase()));
    if (clip) return clip;
  }
  return null;
}

function setupPlayerProceduralParts(root) {
  const proceduralParts = [];
  root.traverse((child) => {
    if (child.type === 'Bone' || child.isBone || /(arm|leg|thigh|calf|spine|hip|shoulder|upperarm|lowerarm|upperleg|lowerleg)/i.test(child.name)) {
      const type = getProceduralPartType(child.name);
      const restRotation = child.rotation.clone();
      proceduralParts.push({ node: child, baseRotation: restRotation, type });
    }
  });
  if (proceduralParts.length === 0) {
    proceduralParts.push({ node: root, baseRotation: root.rotation.clone(), type: 'Root' });
  }
  player.userData.proceduralParts = proceduralParts;
  player.userData.proceduralTime = 0;
}

function setupMixamoArmBones(root) {
  const boneNames = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'RightHand'];
  const bones = {};
  const baseRotations = {};
  if (root.userData.rightHand || root.userData.leftArm) {
    if (root.userData.leftArm) bones.LeftArm = root.userData.leftArm;
    if (root.userData.rightArm) bones.RightArm = root.userData.rightArm;
    if (root.userData.leftHand) bones.LeftHand = root.userData.leftHand;
    if (root.userData.rightHand) bones.RightHand = root.userData.rightHand;
  } else {
    root.traverse((child) => {
      if (child.isBone && boneNames.includes(child.name)) {
        bones[child.name] = child;
      }
    });
  }
  player.userData.mixamoArmBones = bones;
  player.userData.mixamoBaseRotations = baseRotations;
}

function loadRightHandWeapon() {
  setupProceduralWeaponFallback();
}

function createHumanoid(bodyColor, pantsColor) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.0, 0.3),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xf7e4c2 })
  );
  head.position.y = 1.7;
  head.castShadow = true;
  group.add(head);
  const leftArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.6, 0.16),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  leftArm.position.set(-0.35, 1.15, 0);
  leftArm.castShadow = true;
  group.add(leftArm);
  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.6, 0.16),
    new THREE.MeshLambertMaterial({ color: bodyColor })
  );
  rightArm.position.set(0.35, 1.15, 0);
  rightArm.castShadow = true;
  group.add(rightArm);
  const leftLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.6, 0.16),
    new THREE.MeshLambertMaterial({ color: pantsColor })
  );
  leftLeg.position.set(-0.12, 0.45, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.6, 0.16),
    new THREE.MeshLambertMaterial({ color: pantsColor })
  );
  rightLeg.position.set(0.12, 0.45, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);
  return group;
}

function getProceduralPartType(name) {
  return /arm|shoulder|forearm/i.test(name) ? 'Arm' : /leg|thigh|calf/i.test(name) ? 'Leg' : /spine|hip/i.test(name) ? 'Torso' : 'Root';
}

let currentCostume = 'soldier';
const COSTUMES = {
  soldier: { bodyColor: 0x445566, pantsColor: 0x2f3b4a },
  deadpool1: { bodyColor: 0xdd1c1c, pantsColor: 0x8b0000 },
  deadpool2: { bodyColor: 0xbe0f0f, pantsColor: 0x5a0000 },
  'Ch20_nonPBR.fbx': { bodyColor: 0x00c8ff, pantsColor: 0x0b3b5b },
};

async function loadBotPalettes() {
  return Promise.resolve();
}

function applyCostume(key) {
  currentCostume = key;
  if (player.userData.model) {
    player.clear();
    player.add(player.userData.model);
  }
  setupProceduralPlayerFallback();
}

function generateWorld() {
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(MAP_SIZE, 0.2, MAP_SIZE),
    new THREE.MeshLambertMaterial({ color: 0x6aa84f })
  );
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);
  colliders.push(ground);
}

function createStormVisual() {}

function spawnBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    const bot = {
      name: `Bot ${i + 1}`,
      alive: true,
      mesh: new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), new THREE.MeshLambertMaterial({ color: 0x333333 })),
      health: 100,
      shield: 0,
      weapon: 'ar',
      state: 'wander',
      target: null,
      stateTimer: 0,
      fireCooldown: 0,
      buildCooldown: 0,
      moveDir: new THREE.Vector3(1, 0, 0),
      isBoss: false,
    };
    bot.mesh.position.set((Math.random() - 0.5) * 80, 0.75, (Math.random() - 0.5) * 80);
    bot.mesh.castShadow = true;
    scene.add(bot.mesh);
    bots.push(bot);
  }
}

function startGame() {
  state.playing = true;
  state.paused = false;
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.body.classList.add('playing');
}

function updateHUD() {}

function updatePlayer(dt) {}

function updateBullets(dt) {}

function updateLoot() {}

function updateChests(dt) {}

function updateChestHold(dt) {}

function updateHealStations(dt) {}

function createBuildPiece() {}

function destroyBuilding() {}

function getGroundHeight() { return 0; }

function getTerrainHeight() { return 0; }

function clampBotToGround() {}

function resolveHorizontalCollision() {}

function isInStorm(pos) { return pos.distanceTo(state.stormCenter) > state.stormRadius; }

function updateStorm(dt) { state.stormRadius = Math.max(10, state.stormRadius - dt * 1.5); }

function playerShoot() {}

function reload() {}

function useNearestHealStation() {}

function startKeyboardChestHold() {}

function cancelKeyboardChestHold() {}

function startMobileChestHold() {}

function cancelChestHold() {}

function addKillFeed() {}

function updateCrosshairAlert() {}

function resetGame() {}

function endGame() {}

function shoot() {}

function getBotAimDirection() { return new THREE.Vector3(0, 0, -1); }

function damageBot() {}

function damagePlayer() {}

function spawnLoot() {}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
}

async function init() {
  detectMobile();
  loadPlayerModel();
  generateWorld();
  createStormVisual();
  await loadBotPalettes();
  spawnBots();
  player.position.set(0, getGroundHeight(0, 0), 0);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 1, 0);
  applyCostume(currentCostume);
  setupStoreUI();
  hideLoading();
  gameLoop(0);
}

function detectMobile() {
  state.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900;
}

function setupStoreUI() {
  const playBtn = document.getElementById('play-btn');
  if (playBtn) playBtn.addEventListener('click', startGame);
}

function gameLoop(time) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((time - (gameLoop.lastTime || 0)) / 1000, 0.05);
  gameLoop.lastTime = time;
  if (state.playing) {
    updatePlayer(dt);
    updateBots(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateStorm(dt);
    updateLoot();
    updateChests(dt);
    updateChestHold(dt);
    updateHealStations(dt);
  }
  renderer.render(scene, camera);
}

init();
