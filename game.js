import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const GAME_VERSION = '1.3.0';
console.info(`Battle Island v${GAME_VERSION}`);

// ─── Constants ───────────────────────────────────────────────
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
const chests = [];
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
loadPlayerModel();

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
  // If weapon is already present, remove it first
  if (player.userData.handWeapon) {
    if (player.userData.handWeapon.parent) {
      player.userData.handWeapon.parent.remove(player.userData.handWeapon);
    }
    player.userData.handWeapon = null;
  }

  const handBone = player.userData.mixamoArmBones?.RightHand || player.userData.mixamoArmBones?.RightForeArm;

  // Create a procedural sword (a simple box with a guard)
  const swordGeo = new THREE.BoxGeometry(0.08, 0.9, 0.03);
  const swordMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  const swordMesh = new THREE.Mesh(swordGeo, swordMat);
  swordMesh.castShadow = true;

  // Guard
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
  // Initialize with procedural humanoid model immediately so the player is never invisible
  setupProceduralPlayerFallback();

  const loader = new FBXLoader();
  const modelPath = './X%20Bot.fbx';
  console.info('Loading player model:', modelPath);
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
    if (rawScale > maxModelScale) {
      console.warn('Player model is being scaled down to avoid oversized appearance.', rawScale.toFixed(2), '->', maxModelScale);
    }
    fbx.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(fbx);
    const minY = scaledBox.min.y;
    fbx.position.y -= minY;

    // Success: replace procedural model
    player.clear();
    player.add(fbx);
    player.visible = true;
    player.userData.model = fbx;
    player.userData.lastMoveYaw = 0;
    player.userData.modelYawOffset = 0; // align model forward with player movement
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

    console.info('Player FBX model loaded:', fbx.name || 'X Bot', 'scale:', scale.toFixed(3));
  }, undefined, (error) => {
    console.error('Failed to load player FBX model. Keeping procedural fallback.', error);
  });
}

function loadCustomFBXModel(modelPath, enableArmSwing = true) {
  // Set up procedural fallback immediately so the player is never invisible
  setupProceduralPlayerFallback();
  player.userData.enableArmSwing = enableArmSwing;

  const loader = new FBXLoader();
  console.info('Loading custom FBX model:', modelPath);
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
    if (rawScale > maxModelScale) {
      console.warn('Custom model is being scaled down to avoid oversized appearance.', rawScale.toFixed(2), '->', maxModelScale);
    }
    fbx.scale.setScalar(scale);

    const scaledBox = new THREE.Box3().setFromObject(fbx);
    const minY = scaledBox.min.y;
    fbx.position.y -= minY;

    // Success: replace procedural model
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

    console.info('Custom FBX model loaded:', fbx.name || modelPath, 'scale:', scale.toFixed(3), 'armSwing:', enableArmSwing);
  }, undefined, (error) => {
    console.error('Failed to load custom FBX model. Keeping procedural fallback.', error);
  });
}

function findClip(clips, keywords) {
  for (const keyword of keywords) {
    const clip = clips.find(c => c.name.toLowerCase().includes(keyword.toLowerCase()));
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
      proceduralParts.push({
        node: child,
        baseRotation: restRotation,
        type,
      });
    }
  });

  if (proceduralParts.length === 0) {
    proceduralParts.push({
      node: root,
      baseRotation: root.rotation.clone(),
      type: 'Root',
    });
  }

  player.userData.proceduralParts = proceduralParts;
  player.userData.proceduralTime = 0;
}

function setupMixamoArmBones(root) {
  const boneNames = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'RightHand'];
  const bones = {};
  const baseRotations = {};

  // If it's a procedural humanoid, it will have userData parts instead of skeleton bones
  if (root.userData.rightHand || root.userData.leftArm) {
    if (root.userData.leftArm) bones['LeftArm'] = root.userData.leftArm;
    if (root.userData.rightArm) bones['RightArm'] = root.userData.rightArm;
    if (root.userData.leftHand) bones['LeftHand'] = root.userData.leftHand;
    if (root.userData.rightHand) bones['RightHand'] = root.userData.rightHand;

    for (const key in bones) {
      baseRotations[key] = bones[key].rotation.clone();
    }
  } else {
    root.traverse((child) => {
      if (!child.isBone) return;
      const normalizedName = child.name.toLowerCase();
      if (boneNames.some(name => normalizedName.includes(name.toLowerCase()))) {
        bones[child.name] = child;
        baseRotations[child.name] = child.rotation.clone();
      }
    });
  }

  player.userData.mixamoArmBones = bones;
  player.userData.mixamoArmBaseRotations = baseRotations;
}

function loadRightHandWeapon() {
  // If weapon is already present, remove it first
  if (player.userData.handWeapon) {
    if (player.userData.handWeapon.parent) {
      player.userData.handWeapon.parent.remove(player.userData.handWeapon);
    }
    player.userData.handWeapon = null;
  }

  const loader = new FBXLoader();
  const weaponPath = './Sword%20Fight%20One.fbx';
  loader.load(weaponPath, (fbx) => {
    fbx.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const weaponGroup = new THREE.Group();
    weaponGroup.add(fbx);
    weaponGroup.name = 'Weapon';
    weaponGroup.scale.setScalar(0.7);
    weaponGroup.position.set(0, 0, 0);
    weaponGroup.rotation.set(0, 0, 0);

    const handBone = player.userData.mixamoArmBones?.RightHand || player.userData.mixamoArmBones?.RightForeArm;
    if (handBone) {
      handBone.add(weaponGroup);
      weaponGroup.position.set(0.05, -0.05, -0.1);
      weaponGroup.rotation.set(-Math.PI / 2, 0, 0);
      player.userData.handWeapon = weaponGroup;
      console.info('Sword attached to hand bone:', handBone.name);
    } else {
      scene.add(weaponGroup);
      player.userData.handWeapon = weaponGroup;
      console.warn('RightHand bone not found; sword attached to scene root.');
    }
  }, undefined, (error) => {
    console.error('Failed to load weapon FBX model. Falling back to procedural weapon.', error);
    setupProceduralWeaponFallback();
  });
}

function updateMixamoWalkArms(moveAmount, walkPhase) {
  const data = player.userData;
  if (!data.mixamoArmBones) return;

  const leftArm = data.mixamoArmBones.LeftArm;
  const rightArm = data.mixamoArmBones.RightArm;
  const leftForeArm = data.mixamoArmBones.LeftForeArm;
  const rightForeArm = data.mixamoArmBones.RightForeArm;
  if (!leftArm || !rightArm) return;

  const leftBase = data.mixamoArmBaseRotations.LeftArm || leftArm.rotation.clone();
  const rightBase = data.mixamoArmBaseRotations.RightArm || rightArm.rotation.clone();
  const leftForeBase = data.mixamoArmBaseRotations.LeftForeArm || (leftForeArm ? leftForeArm.rotation.clone() : new THREE.Euler());
  const rightForeBase = data.mixamoArmBaseRotations.RightForeArm || (rightForeArm ? rightForeArm.rotation.clone() : new THREE.Euler());

  const swingAmp = 0.12 * moveAmount;
  const bendAmp = 0.14 * moveAmount;
  const leftSwing = Math.sin(walkPhase) * swingAmp;
  const rightSwing = Math.sin(walkPhase + Math.PI) * swingAmp;
  const leftElbow = 0.12 + Math.abs(Math.sin(walkPhase + Math.PI / 2)) * bendAmp;
  const rightElbow = 0.12 + Math.abs(Math.sin(walkPhase - Math.PI / 2)) * bendAmp;

  leftArm.rotation.x = leftBase.x + leftSwing;
  rightArm.rotation.x = rightBase.x + rightSwing;
  leftArm.rotation.z = leftBase.z + 0.02;
  rightArm.rotation.z = rightBase.z - 0.02;
  leftArm.rotation.y = leftBase.y;
  rightArm.rotation.y = rightBase.y;

  if (leftForeArm) {
    leftForeArm.rotation.x = leftForeBase.x + leftElbow;
    leftForeArm.rotation.y = leftForeBase.y;
    leftForeArm.rotation.z = leftForeBase.z;
  }
  if (rightForeArm) {
    rightForeArm.rotation.x = rightForeBase.x + rightElbow;
    rightForeArm.rotation.y = rightForeBase.y;
    rightForeArm.rotation.z = rightForeBase.z;
  }
}

function getProceduralPartType(name) {
  const lowered = name.toLowerCase();
  if (/left|l_|l-/i.test(lowered) && /arm|shoulder|upperarm|lowerarm/i.test(lowered)) return 'LeftArm';
  if (/right|r_|r-/i.test(lowered) && /arm|shoulder|upperarm|lowerarm/i.test(lowered)) return 'RightArm';
  if (/left|l_|l-/i.test(lowered) && /leg|thigh|calf|foot|knee/i.test(lowered)) return 'LeftLeg';
  if (/right|r_|r-/i.test(lowered) && /leg|thigh|calf|foot|knee/i.test(lowered)) return 'RightLeg';
  if (/spine|chest|torso|hip|pelvis/i.test(lowered)) return 'Spine';
  if (/head|neck/i.test(lowered)) return 'Head';
  return 'Other';
}

function fadeToPlayerAction(actionName, duration = 0.2) {
  const playerData = player.userData;
  if (!playerData.mixer || !playerData.actions[actionName]) return;
  if (playerData.actionState === actionName) return;

  const nextAction = playerData.actions[actionName];
  const currentAction = playerData.currentAction;
  if (currentAction && currentAction !== nextAction) {
    currentAction.fadeOut(duration);
  }
  nextAction.reset().fadeIn(duration).play();
  playerData.currentAction = nextAction;
  playerData.actionState = actionName;
}

function updatePlayerAnimation(moveAmount, sprinting, dt) {
  const playerData = player.userData;

  if (playerData.mixer) {
    if (playerData.actionState === 'Reload' && state.reloading) {
      // keep reloading until completed
    } else if (state.reloading) {
      fadeToPlayerAction('Reload', 0.1);
    } else if (moveAmount > 0.1) {
      fadeToPlayerAction(sprinting ? 'Run' : 'Walk', 0.15);
    } else {
      fadeToPlayerAction('Idle', 0.2);
    }

    playerData.mixer.update(dt);
  }

  updatePlayerProceduralMotion(dt, moveAmount, sprinting);
}

function updatePlayerProceduralMotion(dt, moveAmount, sprinting) {
  const playerData = player.userData;
  if (!playerData.proceduralParts || playerData.proceduralParts.length === 0) return;

  playerData.proceduralTime += dt * (1 + moveAmount * 2);
  const idlePhase = playerData.proceduralTime * 1.2;
  const walkPhase = playerData.proceduralTime * 5;

  for (const part of playerData.proceduralParts) {
    const base = part.baseRotation;
    const node = part.node;
    const type = part.type;
    const isMoving = moveAmount > 0.05;

    let x = base.x;
    let y = base.y;
    let z = base.z;

    if (type === 'LeftArm' || type === 'RightArm') {
      const dir = type === 'LeftArm' ? 1 : -1;
      const swing = Math.sin(walkPhase + (dir * Math.PI / 2)) * 0.06 * moveAmount;
      const sway = Math.sin(walkPhase + dir) * 0.015 * moveAmount;
      x += swing;
      z += sway * 0.12;
      y += isMoving ? Math.sin(walkPhase * 0.8 + dir) * 0.008 : Math.sin(idlePhase * 0.4 + dir) * 0.003;
    } else if (type === 'LeftLeg' || type === 'RightLeg') {
      const dir = type === 'LeftLeg' ? -1 : 1;
      const swing = Math.sin(walkPhase + (dir * Math.PI / 2)) * 0.16 * moveAmount;
      x += swing;
      y += isMoving ? Math.sin(walkPhase * 0.45 + dir) * 0.015 : 0;
      z += isMoving ? Math.cos(walkPhase + dir) * 0.005 : 0;
    } else if (type === 'Spine') {
      z += Math.sin(idlePhase * 0.6) * 0.01;
      y += isMoving ? Math.sin(walkPhase * 0.3) * 0.006 : Math.sin(idlePhase * 0.2) * 0.002;
    } else {
      z += Math.sin(idlePhase * 0.5) * 0.01;
    }

    node.rotation.x = x;
    node.rotation.y = y;
    node.rotation.z = z;
  }

  updateMixamoWalkArms(moveAmount, walkPhase);
}

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

function getGroundHeight(x, z) {
  let height = getTerrainHeight(x, z);
  const footRadius = 0.35;

  for (const c of colliders) {
    if (c.type === 'box' &&
      x >= c.x - c.hw - footRadius && x <= c.x + c.hw + footRadius &&
      z >= c.z - c.hd - footRadius && z <= c.z + c.hd + footRadius) {
      if (c.maxY > height) height = c.maxY;
    }
  }

  for (const build of buildings) {
    const bp = build.mesh.position;
    const hw = 2;
    if (x >= bp.x - hw && x <= bp.x + hw && z >= bp.z - hw && z <= bp.z + hw) {
      const topY = bp.y + (build.type === 'wall' ? 3 : 3);
      if (topY > height) height = topY;
    }
  }

  return height + GROUND_SKIN;
}

function clampPlayerToGround() {
  const groundY = getGroundHeight(player.position.x, player.position.z);
  if (player.position.y < groundY) {
    player.position.y = groundY;
    state.velocity.y = 0;
    state.onGround = true;
  }
}

function clampBotToGround(bot) {
  const groundY = getGroundHeight(bot.mesh.position.x, bot.mesh.position.z);
  if (bot.mesh.position.y < groundY) {
    bot.mesh.position.y = groundY;
  }
}

const _raycaster = new THREE.Raycaster();
const _screenCenter = new THREE.Vector2(0, 0);

function getAimDirection() {
  _raycaster.setFromCamera(_screenCenter, camera);
  return _raycaster.ray.direction.clone().normalize();
}

function getAimYaw() {
  const dir = getAimDirection();
  return Math.atan2(-dir.x, -dir.z);
}

function updateCrosshairAlert(active) {
  document.getElementById('crosshair').classList.toggle('active', active);
}

function resolveHorizontalCollision(pos) {
  const py = pos.y;

  for (const c of colliders) {
    if (py + 0.3 >= c.maxY) continue;
    if (py + PLAYER_BODY_HEIGHT < c.minY + 0.3) continue;

    if (c.type === 'cylinder' || c.type === 'sphere') {
      const minDist = c.radius + PLAYER_RADIUS;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        if (distSq < 0.0001) {
          pos.x += minDist;
        } else {
          const dist = Math.sqrt(distSq);
          const push = (minDist - dist) / dist;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    } else if (c.type === 'box') {
      const closestX = Math.max(c.x - c.hw, Math.min(pos.x, c.x + c.hw));
      const closestZ = Math.max(c.z - c.hd, Math.min(pos.z, c.z + c.hd));
      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
        if (distSq < 0.0001) {
          const ox = pos.x - c.x;
          const oz = pos.z - c.z;
          if (Math.abs(ox) > Math.abs(oz)) {
            pos.x += ox > 0 ? PLAYER_RADIUS : -PLAYER_RADIUS;
          } else {
            pos.z += oz > 0 ? PLAYER_RADIUS : -PLAYER_RADIUS;
          }
        } else {
          const dist = Math.sqrt(distSq);
          const push = (PLAYER_RADIUS - dist) / dist;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      }
    }
  }
}

function createHumanoid(bodyColor, pantsColor = 0x2a2a4a, options = {}) {
  const showVisor = options.showVisor !== false;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pantsColor });
  const gloveMat = new THREE.MeshLambertMaterial({ color: options.gloveColor ?? 0x111111 });
  const beltMat = new THREE.MeshLambertMaterial({ color: options.beltColor ?? 0x111111 });
  const strapMat = new THREE.MeshLambertMaterial({ color: options.strapColor ?? 0x111111 });
  const headMat = new THREE.MeshLambertMaterial({ color: options.headColor ?? bodyColor });
  const eyeMat = new THREE.MeshLambertMaterial({ color: options.eyeColor ?? 0xffffff });
  const visorMat = new THREE.MeshLambertMaterial({ color: options.visorColor ?? 0x222222 });
  const accentMat = new THREE.MeshLambertMaterial({ color: options.accentColor ?? 0xffd700 });
  const maskPatchMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.85, 6), pantsMat);
  leftLeg.name = 'LeftLeg';
  leftLeg.position.set(-0.17, 0.45, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.85, 6), pantsMat);
  rightLeg.name = 'RightLeg';
  rightLeg.position.set(0.17, 0.45, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  const leftKnee = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), accentMat);
  leftKnee.position.set(-0.17, 0.1, 0.08);
  group.add(leftKnee);

  const rightKnee = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), accentMat);
  rightKnee.position.set(0.17, 0.1, 0.08);
  group.add(rightKnee);

  const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), shoeMat);
  leftShoe.position.set(-0.17, 0.03, 0.05);
  group.add(leftShoe);

  const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), shoeMat);
  rightShoe.position.set(0.17, 0.03, 0.05);
  group.add(rightShoe);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.78, 0.32), bodyMat);
  torso.name = 'Spine';
  torso.position.y = 1.08;
  torso.castShadow = true;
  group.add(torso);

  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.08), accentMat);
  chestPlate.position.set(0, 0.08, 0.18);
  torso.add(chestPlate);

  const leftShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.18), strapMat);
  leftShoulder.position.set(-0.33, 0.22, 0);
  leftShoulder.rotation.z = 0.08;
  torso.add(leftShoulder);

  const rightShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.18), strapMat);
  rightShoulder.position.set(0.33, 0.22, 0);
  rightShoulder.rotation.z = -0.08;
  torso.add(rightShoulder);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.32), beltMat);
  belt.position.set(0, 0.82, 0);
  group.add(belt);

  const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.02), accentMat);
  beltBuckle.position.set(0, 0, 0.18);
  belt.add(beltBuckle);

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.58, 6), bodyMat);
  leftArm.name = 'LeftArm';
  leftArm.position.set(-0.36, 1.05, -0.02);
  leftArm.rotation.z = 0.23;
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.58, 6), bodyMat);
  rightArm.name = 'RightArm';
  rightArm.position.set(0.36, 1.05, -0.02);
  rightArm.rotation.z = -0.23;
  rightArm.castShadow = true;
  group.add(rightArm);

  const leftArmBand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.14), accentMat);
  leftArmBand.position.set(-0.36, 0.92, -0.02);
  leftArmBand.rotation.z = 0.1;
  group.add(leftArmBand);

  const rightArmBand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.14), accentMat);
  rightArmBand.position.set(0.36, 0.92, -0.02);
  rightArmBand.rotation.z = -0.1;
  group.add(rightArmBand);

  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.14), gloveMat);
  leftHand.name = 'LeftHand';
  leftHand.position.set(-0.36, 0.68, 0.08);
  leftHand.rotation.x = 0.05;
  group.add(leftHand);

  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.14), gloveMat);
  rightHand.name = 'RightHand';
  rightHand.position.set(0.36, 0.68, 0.08);
  rightHand.rotation.x = 0.05;
  group.add(rightHand);

  const leftThumb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), gloveMat);
  leftThumb.position.set(-0.28, 0.68, 0.14);
  leftThumb.rotation.z = 0.6;
  group.add(leftThumb);

  const rightThumb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.02), gloveMat);
  rightThumb.position.set(0.28, 0.68, 0.14);
  rightThumb.rotation.z = -0.6;
  group.add(rightThumb);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.15, 6), bodyMat);
  neck.position.y = 1.5;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), headMat);
  head.name = 'Head';
  head.position.y = 1.7;
  head.castShadow = true;
  group.add(head);

  if (showVisor) {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.04), visorMat);
    visor.position.set(0, 1.78, -0.2);
    visor.rotation.x = 0.02;
    group.add(visor);
  }

  const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), eyeMat);
  leftEye.position.set(-0.095, 1.78, -0.22);
  group.add(leftEye);

  const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), eyeMat);
  rightEye.position.set(0.095, 1.78, -0.22);
  group.add(rightEye);

  const leftMaskPatch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), maskPatchMat);
  leftMaskPatch.position.set(-0.12, 1.78, -0.16);
  leftMaskPatch.rotation.y = 0.05;
  group.add(leftMaskPatch);

  const rightMaskPatch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.02), maskPatchMat);
  rightMaskPatch.position.set(0.12, 1.78, -0.16);
  rightMaskPatch.rotation.y = -0.05;
  group.add(rightMaskPatch);

  const hairMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), hairMat);
  hair.position.set(0, 1.86, 0);
  hair.scale.set(1, 0.6, 1);
  hair.castShadow = true;
  group.add(hair);

  group.userData.leftLeg = leftLeg;
  group.userData.rightLeg = rightLeg;
  group.userData.leftArm = leftArm;
  group.userData.rightArm = rightArm;
  group.userData.leftHand = leftHand;
  group.userData.rightHand = rightHand;
  group.userData.torso = torso;
  group.userData.head = head;
  group.userData.hair = hair;
  group.userData.bodyMat = bodyMat;
  group.userData.pantsMat = pantsMat;
  group.userData.headMat = headMat;
  group.userData.gloveMat = gloveMat;
  group.userData.beltMat = beltMat;
  group.userData.strapMat = strapMat;
  group.userData.maskPatchMat = maskPatchMat;

  return group;
}

const COSTUMES = {
  deadpool1: {
    bodyColor: 0xdd1c1c,
    pantsColor: 0x121212,
    headColor: 0xdd1c1c,
    gloveColor: 0x111111,
    beltColor: 0x111111,
    strapColor: 0x111111,
    maskPatchColor: 0x111111,
    hideHair: true,
  },
  deadpool2: {
    bodyColor: 0xbe0f0f,
    pantsColor: 0x1f1f1f,
    headColor: 0xbe0f0f,
    gloveColor: 0x111111,
    beltColor: 0x111111,
    strapColor: 0x111111,
    maskPatchColor: 0x111111,
    hideHair: true,
  },
  soldier: {
    bodyColor: 0x445566,
    pantsColor: 0x2f3b4a,
    headColor: 0x445566,
    gloveColor: 0x222222,
    beltColor: 0x332211,
    strapColor: 0x222222,
    maskPatchColor: 0x222222,
    hideHair: false,
  },
  camo: {
    bodyColor: 0x6b8b3a,
    pantsColor: 0x4a5a2a,
    headColor: 0x6b8b3a,
    gloveColor: 0x222222,
    beltColor: 0x332211,
    strapColor: 0x222222,
    maskPatchColor: 0x222222,
    hideHair: false,
  },
  scout: {
    bodyColor: 0x2d9cdb,
    pantsColor: 0x153544,
    headColor: 0x2d9cdb,
    gloveColor: 0x111111,
    beltColor: 0x111111,
    strapColor: 0x111111,
    maskPatchColor: 0x111111,
    hideHair: false,
  },
  merc: {
    bodyColor: 0x8b5a2b,
    pantsColor: 0x3b2f2f,
    headColor: 0x8b5a2b,
    gloveColor: 0x111111,
    beltColor: 0x111111,
    strapColor: 0x111111,
    maskPatchColor: 0x111111,
    hideHair: false,
  },
  'Ch20_nonPBR.fbx': {
    isFBX: true,
    modelPath: './Ch20_nonPBR.fbx',
    enableArmSwing: true,
    bodyColor: 0x111111,
    pantsColor: 0xff0000,
    headColor: 0x111111,
    gloveColor: 0x111111,
    beltColor: 0xffd700,
    visorColor: 0xff0000,
    accentColor: 0xffd700,
    maskPatchColor: 0xffd700,
    hideHair: true,
  },
};

// Bot palettes can be edited quickly in `bot_palettes.json` (workspace root).
let BOT_PALETTES = [
  { body: 0x4f5d73, pants: 0x2f3c50, head: 0xe9c8a1, glove: 0x382c1f, belt: 0x3a3129, strap: 0x4a4a4a, maskPatch: 0x4f5d73, hideHair: false },
  { body: 0x8b5e4a, pants: 0x3c2f22, head: 0xf1d1b5, glove: 0x2d2320, belt: 0x262020, strap: 0x4a4a4a, maskPatch: 0x8b5e4a, hideHair: false },
  { body: 0x62785f, pants: 0x323e2f, head: 0xe0b695, glove: 0x2b2824, belt: 0x332f28, strap: 0x4a4a4a, maskPatch: 0x62785f, hideHair: false },
  { body: 0x5a6f8b, pants: 0x2f434d, head: 0xdfbf9a, glove: 0x2f2b25, belt: 0x38322e, strap: 0x4a4a4a, maskPatch: 0x5a6f8b, hideHair: false },
  { body: 0x8a7c5d, pants: 0x3d372d, head: 0xe7c6a0, glove: 0x2e2822, belt: 0x3b362f, strap: 0x4a4a4a, maskPatch: 0x8a7c5d, hideHair: false },
  { body: 0x4c5f6e, pants: 0x22303a, head: 0xeaccb1, glove: 0x2a2622, belt: 0x2f2a24, strap: 0x4a4a4a, maskPatch: 0x4c5f6e, hideHair: false },
];

async function loadBotPalettes() {
  try {
    const res = await fetch('bot_palettes.json');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      BOT_PALETTES = data.map(p => ({
        body: p.body ?? 0x888888,
        pants: p.pants ?? 0x444444,
        head: p.head ?? 0x111111,
        glove: p.glove ?? 0x111111,
        belt: p.belt ?? 0x222222,
        strap: p.strap ?? 0x222222,
        maskPatch: p.maskPatch ?? 0x222222,
        hideHair: !!p.hideHair,
      }));
    }
  } catch (e) {
    // ignore, use defaults
  }
}

let currentCostume = 'soldier';

function applyCostume(key) {
  const costume = COSTUMES[key];
  if (!costume) return;
  currentCostume = key;

  if (costume.isFBX) {
    loadCustomFBXModel(costume.modelPath, costume.enableArmSwing);
    updateStoreSelection(key);
    return;
  }

  if (player.userData.bodyMat) player.userData.bodyMat.color.set(costume.bodyColor);
  if (player.userData.pantsMat) player.userData.pantsMat.color.set(costume.pantsColor);
  if (player.userData.headMat) player.userData.headMat.color.set(costume.headColor);
  if (player.userData.gloveMat) player.userData.gloveMat.color.set(costume.gloveColor || 0x111111);
  if (player.userData.beltMat) player.userData.beltMat.color.set(costume.beltColor || 0x111111);
  if (player.userData.strapMat) player.userData.strapMat.color.set(costume.strapColor || 0x111111);
  if (player.userData.maskPatchMat) player.userData.maskPatchMat.color.set(costume.maskPatchColor || 0x111111);
  if (player.userData.hair) player.userData.hair.visible = costume.hideHair ? false : true;
  updateStoreSelection(key);
}

function updateStoreSelection(key) {
  document.querySelectorAll('.store-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.costume === key);
  });
}

function animateHumanWalk(human, speed, time) {
  if (!human.userData.leftLeg) return;
  const swing = Math.sin(time * 10) * 0.4 * Math.min(speed / 4, 1);
  human.userData.leftLeg.rotation.x = swing;
  human.userData.rightLeg.rotation.x = -swing;
  human.userData.leftArm.rotation.x = -swing * 0.6;
  human.userData.rightArm.rotation.x = swing * 0.6;
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
  colliders.push({ type: 'cylinder', x, z, radius: 0.55, minY: y, maxY: y + 6 });
}

function createRock(x, z) {
  const geo = new THREE.DodecahedronGeometry(1 + Math.random() * 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const rock = new THREE.Mesh(geo, mat);
  const y = getTerrainHeight(x, z);
  rock.position.set(x, y + 0.5, z);
  rock.castShadow = true;
  scene.add(rock);
  colliders.push({ type: 'sphere', x, z, radius: 1.2, minY: y, maxY: y + 2 });
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

  for (let i = 0; i < 8; i++) {
    spawnChest(
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

function spawnChest(x, z) {
  const chestGeo = new THREE.BoxGeometry(1, 0.8, 1);
  const chestMat = new THREE.MeshLambertMaterial({ color: 0x6b3e1a });
  const chest = new THREE.Mesh(chestGeo, chestMat);
  chest.position.set(x, getTerrainHeight(x, z) + 0.4, z);
  chest.castShadow = true;
  const lidGeo = new THREE.BoxGeometry(1.02, 0.16, 1.02);
  const lidMat = new THREE.MeshLambertMaterial({ color: 0xb9772d });
  const lid = new THREE.Mesh(lidGeo, lidMat);
  lid.position.set(0, 0.5, 0);
  lid.rotation.x = -0.05;
  chest.add(lid);
  scene.add(chest);
  chests.push({ mesh: chest, x, z, opened: false, collected: false });
}

function getNearestWorldChest(maxDist = 3.5) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const chest of chests) {
    if (chest.collected) continue;
    const dist = player.position.distanceTo(new THREE.Vector3(chest.x, player.position.y, chest.z));
    if (dist < nearestDist && dist <= maxDist) {
      nearest = chest;
      nearestDist = dist;
    }
  }
  return nearest;
}

function openWorldChest(chest) {
  if (!chest || chest.collected) return;
  chest.collected = true;
  scene.remove(chest.mesh);
  const reward = openChestReward();
  applyChestReward(reward);
  addKillFeed(`Kutu açıldı: ${reward.label}`);
}

function openChestReward() {
  const roll = Math.random();
  if (roll < 0.25) {
    return { type: 'shield', amount: 25, label: 'Kalkan +25' };
  }
  if (roll < 0.55) {
    const materials = ['wood', 'stone', 'metal'];
    const material = materials[Math.floor(Math.random() * materials.length)];
    return { type: material, amount: 80, label: `${material === 'wood' ? 'Tahta' : material === 'stone' ? 'Taş' : 'Metal'} +80` };
  }
  if (roll < 0.8) {
    const guns = ['ar', 'shotgun'];
    const gun = guns[Math.floor(Math.random() * guns.length)];
    const amount = gun === 'ar' ? 30 : 10;
    return { type: gun, amount, label: `${gun === 'ar' ? 'AR' : 'Pompalı'} cephane +${amount}` };
  }
  return { type: 'weapon', weapon: Math.random() > 0.5 ? 'ar' : 'shotgun', amount: 1, label: 'Yeni Silah' };
}

function applyChestReward(reward) {
  switch (reward.type) {
    case 'shield':
      state.shield = Math.min(100, state.shield + reward.amount);
      break;
    case 'wood':
    case 'stone':
    case 'metal':
      state.materials[reward.type] += reward.amount;
      break;
    case 'ar':
    case 'shotgun':
      state.ammo[reward.type].reserve += reward.amount;
      break;
    case 'weapon':
      if (reward.weapon === 'ar') {
        state.hotbarSlot = 0;
      } else {
        state.hotbarSlot = 1;
      }
      break;
  }
  updateHUD();
}

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

function updateGunReloadAnimation() {
  if (!gunGroup) return;
  if (state.reloading && state.reloadDuration > 0) {
    const progress = 1 - Math.max(0, state.reloadTimer) / state.reloadDuration;
    const ease = Math.sin(progress * Math.PI);
    gunGroup.position.x = gunInitialPosition.x - 0.08 * ease;
    gunGroup.position.y = gunInitialPosition.y - 0.08 * ease;
    gunGroup.position.z = gunInitialPosition.z - 0.12 * ease;
    gunGroup.rotation.x = gunInitialRotation.x + 0.15 * ease;
    gunGroup.rotation.z = gunInitialRotation.z + 0.6 * ease;
  } else {
    gunGroup.position.copy(gunInitialPosition);
    gunGroup.rotation.copy(gunInitialRotation);
  }
}

// ─── Bot AI ────────────────────────────────────────────────────
const BOT_NAMES = ['Shadow', 'Blaze', 'Viper', 'Ghost', 'Raven', 'Storm', 'Fury', 'Ace', 'Nova', 'Titan', 'Wolf', 'Hawk', 'Bolt', 'Rex', 'Zara'];

function createBot(x, z, index) {
  const pal = BOT_PALETTES.length ? BOT_PALETTES[index % BOT_PALETTES.length] : { body: 0x888888, pants: 0x444444, head: 0xe0b895, glove: 0x111111, belt: 0x222222, strap: 0x222222, maskPatch: 0x888888, hideHair: false };
  const group = createHumanoid(pal.body, pal.pants, { showVisor: false });
  if (group.userData.headMat && pal.head) group.userData.headMat.color.set(pal.head);
  if (group.userData.gloveMat && pal.glove) group.userData.gloveMat.color.set(pal.glove);
  if (group.userData.beltMat && pal.belt) group.userData.beltMat.color.set(pal.belt);
  if (group.userData.strapMat && pal.strap) group.userData.strapMat.color.set(pal.strap);
  if (group.userData.maskPatchMat && pal.maskPatch) group.userData.maskPatchMat.color.set(pal.maskPatch);
  if (group.userData.hair) group.userData.hair.visible = pal.hideHair ? false : true;
  const y = getGroundHeight(x, z);
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
    buildCooldown: 0,
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
  const aimDir = getAimDirection();
  const flat = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
  const pos = player.position.clone().add(flat.multiplyScalar(5));
  pos.y = getGroundHeight(pos.x, pos.z);
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
  state.buildPreview.rotation.y = getAimYaw();
}

function placeBuild() {
  const type = state.hotbarSlot === 2 ? 'wall' : 'ramp';
  const cost = BUILD_COST[type];
  if (state.materials[state.activeMat] < cost) return;

  state.materials[state.activeMat] -= cost;
  const pos = getBuildPreviewPosition();
  createBuildPiece(type, pos, getAimYaw(), state.activeMat);
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

function getBotAimDirection(bot, targetPosition, baseSpread = 0.05) {
  const dir = targetPosition.clone().sub(bot.mesh.position).normalize();
  const dist = bot.mesh.position.distanceTo(targetPosition);
  const spread = baseSpread + Math.min(dist * 0.008, 0.2);
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.z += (Math.random() - 0.5) * spread;
  return dir.normalize();
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
  from.y += 1.35;
  const dir = getAimDirection();

  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    shoot(from, dir, w.damage, 'player', w.spread);
  }

  // Recoil
  state.pitch += 0.01;
  fadeToPlayerAction('Shoot', 0.05);
}

function reload() {
  const weapon = state.hotbarSlot === 0 ? 'ar' : 'shotgun';
  const w = WEAPONS[weapon === 'ar' ? 'ar' : 'shotgun'];
  const ammo = state.ammo[weapon];
  if (ammo.current >= w.magSize || ammo.reserve <= 0 || state.reloading) return;
  state.reloading = true;
  state.reloadDuration = w.reloadTime;
  state.reloadTimer = w.reloadTime;
  updateHUD();
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
function botPlaceCover(bot, targetPosition) {
  const dir = targetPosition.clone().sub(bot.mesh.position).normalize();
  const buildPos = bot.mesh.position.clone().add(dir.clone().multiplyScalar(4));
  buildPos.x += (Math.random() - 0.5) * 1.5;
  buildPos.z += (Math.random() - 0.5) * 1.5;
  buildPos.y = getGroundHeight(buildPos.x, buildPos.z);
  const type = Math.random() < 0.75 ? 'wall' : 'ramp';
  const rotation = Math.atan2(-dir.x, -dir.z);
  createBuildPiece(type, buildPos, rotation, 'wood');
  bot.buildCooldown = 8 + Math.random() * 4;
  bot.stateTimer = 1.2 + Math.random() * 0.8;
  bot.state = 'attack';
}

function updateBots(dt) {
  let crosshairActive = false;

  for (const bot of bots) {
    if (!bot.alive) continue;

    bot.stateTimer -= dt;
    bot.fireCooldown -= dt;
    bot.buildCooldown -= dt;

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
      if (bot.buildCooldown <= 0 && bot.state !== 'build') {
        bot.state = 'build';
        bot.target = 'player';
        bot.stateTimer = 1.5 + Math.random() * 0.8;
      } else if (bot.state !== 'attack' && bot.state !== 'build') {
        bot.state = 'attack';
        bot.target = 'player';
      }
    }

    if (bot.state === 'build' && bot.target === 'player') {
      const dir = player.position.clone().sub(bot.mesh.position).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 0.7);
      const moveDir = dir.clone().multiplyScalar(2.4).add(side).normalize();
      bot.mesh.position.add(moveDir.multiplyScalar(dt));
      clampBotToGround(bot);
      resolveHorizontalCollision(bot.mesh.position);
      bot.mesh.lookAt(player.position.x, bot.mesh.position.y, player.position.z);

      if (bot.stateTimer <= 0) {
        botPlaceCover(bot, player.position);
      }
    } else if (bot.state === 'attack' && bot.target === 'player') {
      crosshairActive = true;
      const dir = player.position.clone().sub(bot.mesh.position).normalize();
      bot.mesh.position.add(dir.multiplyScalar(4 * dt));
      clampBotToGround(bot);
      resolveHorizontalCollision(bot.mesh.position);
      bot.mesh.lookAt(player.position.x, bot.mesh.position.y, player.position.z);

      if (distToPlayer < 30 && bot.fireCooldown <= 0 && bot.stateTimer <= 0) {
        const from = bot.mesh.position.clone();
        from.y += 1.4;
        const targetPos = player.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        const w = WEAPONS[bot.weapon === 'ar' ? 'ar' : 'shotgun'];
        const shootDir = getBotAimDirection(bot, targetPos, w.spread);
        bot.fireCooldown = w.fireRate;
        bot.stateTimer = 0.2;
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
      bot.mesh.position.add(bot.moveDir.clone().multiplyScalar(3 * dt));
      clampBotToGround(bot);
      resolveHorizontalCollision(bot.mesh.position);
    }

    // Bot vs bot combat
    for (const other of bots) {
      if (other === bot || !other.alive) continue;
      const d = bot.mesh.position.distanceTo(other.mesh.position);
      if (d < 25 && Math.random() < 0.01) {
        const from = bot.mesh.position.clone();
        from.y += 1.4;
        const targetPos = other.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        const shootDir = getBotAimDirection(bot, targetPos, 0.08);
        shoot(from, shootDir, 15, bot.name, 0.05);
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

  updateCrosshairAlert(crosshairActive);
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

function updateChests(dt) {
  for (const chest of chests) {
    if (chest.collected) continue;
    chest.mesh.rotation.y += 0.01;
    chest.mesh.position.y = getTerrainHeight(chest.x, chest.z) + 0.4 + Math.sin(Date.now() * 0.002) * 0.03;
  }
}

function startChestHold(isMobile = false) {
  const chest = getNearestWorldChest();
  if (!chest) {
    cancelChestHold();
    return;
  }
  state.openChestHold.active = true;
  state.openChestHold.chest = chest;
  state.openChestHold.elapsed = 0;
  state.openChestHold.isMobile = isMobile;
}

function cancelChestHold() {
  state.openChestHold.active = false;
  state.openChestHold.chest = null;
  state.openChestHold.elapsed = 0;
}

function startKeyboardChestHold() {
  startChestHold(false);
}

function startMobileChestHold() {
  startChestHold(true);
}

function updateChestHold(dt) {
  if (!state.openChestHold.active || !state.openChestHold.chest) return;
  const chest = state.openChestHold.chest;
  if (chest.collected) {
    cancelChestHold();
    return;
  }
  const dist = player.position.distanceTo(new THREE.Vector3(chest.x, player.position.y, chest.z));
  if (dist > 3.5) {
    cancelChestHold();
    return;
  }
  state.openChestHold.elapsed += dt;
  if (state.openChestHold.elapsed >= state.openChestHold.threshold) {
    openWorldChest(chest);
    cancelChestHold();
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
  const sprinting = state.keys['shift'] || state.joystick.dy < -0.7;
  const speed = PLAYER_SPEED * (sprinting ? SPRINT_MULT : 1);

  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = new THREE.Vector3();

  if (state.keys['w']) move.add(forward);
  if (state.keys['s']) move.sub(forward);
  if (state.keys['a']) move.sub(right);
  if (state.keys['d']) move.add(right);

  if (state.joystick.active) {
    move.add(forward.clone().multiplyScalar(-state.joystick.dy));
    move.add(right.clone().multiplyScalar(state.joystick.dx));
  }

  let moveAmount = 0;
  if (move.length() > 0.01) {
    moveAmount = Math.min(move.length(), 1);
    move.normalize();
    const dx = move.x * speed * moveAmount * dt;
    const dz = move.z * speed * moveAmount * dt;

    player.position.x += dx;
    resolveHorizontalCollision(player.position);
    player.position.z += dz;
    resolveHorizontalCollision(player.position);

    clampPlayerToGround();
  }

  // Yer çekimi — alt adımlarla tünelleme önlenir
  const steps = 3;
  const subDt = dt / steps;
  for (let i = 0; i < steps; i++) {
    state.velocity.y -= GRAVITY * subDt;
    player.position.y += state.velocity.y * subDt;

    const groundY = getGroundHeight(player.position.x, player.position.z);
    if (player.position.y <= groundY) {
      player.position.y = groundY;
      if (state.velocity.y < 0) state.velocity.y = 0;
      state.onGround = true;
    } else {
      state.onGround = false;
    }
  }

  // Zemine gömülme kurtarma
  const finalGround = getGroundHeight(player.position.x, player.position.z);
  if (player.position.y < finalGround) {
    player.position.y = finalGround;
    state.velocity.y = 0;
    state.onGround = true;
  }

  const wantsJump = state.keys[' '] || state.keys['jump'];
  if (wantsJump && state.onGround) {
    state.velocity.y = JUMP_FORCE;
    state.onGround = false;
    state.keys['jump'] = false;
  }

  if (move.length() > 0.01) {
    const moveYaw = Math.atan2(move.x, move.z);
    player.userData.lastMoveYaw = moveYaw;
    player.rotation.y = moveYaw + (player.userData.modelYawOffset || 0);
  } else {
    player.rotation.y = (player.userData.lastMoveYaw || state.yaw) + (player.userData.modelYawOffset || 0);
  }

  updatePlayerAnimation(moveAmount, sprinting, dt);
  updateGunReloadAnimation();

  const camDist = state.isMobile ? 10 : 8;
  const camHeight = state.isMobile ? 3.5 : 3.0;
  camera.position.x = player.position.x + Math.sin(state.yaw) * camDist * Math.cos(state.pitch * 0.55);
  camera.position.y = player.position.y + camHeight + Math.sin(state.pitch) * camDist * 0.55;
  camera.position.z = player.position.z + Math.cos(state.yaw) * camDist * Math.cos(state.pitch * 0.55);

  const lookDist = 20;
  camera.lookAt(
    player.position.x - Math.sin(state.yaw) * Math.cos(state.pitch) * lookDist,
    player.position.y + 1.4 + Math.sin(state.pitch) * lookDist,
    player.position.z - Math.cos(state.yaw) * Math.cos(state.pitch) * lookDist
  );

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
      fadeToPlayerAction('Idle', 0.1);
    } else {
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

  if (state.reloading) {
    const reloadBar = document.getElementById('reload-bar');
    const reloadContainer = document.getElementById('reload-container');
    const percent = Math.max(0, Math.min(100, 100 * (1 - state.reloadTimer / state.reloadDuration)));
    reloadBar.style.width = percent + '%';
    reloadContainer.classList.remove('hidden');
  } else {
    document.getElementById('reload-container').classList.add('hidden');
  }

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
  document.body.classList.add('playing');
  state.playing = true;
  state.kills = 0;
  state.alive = BOT_COUNT + 1;
  state.health = 100;
  state.shield = 50;
  state.materials = { wood: 500, stone: 0, metal: 0 };
  state.openChestHold = { active: false, chest: null, elapsed: 0, threshold: 0.8, isMobile: false };
  state.stormPhase = 0;
  state.stormTimer = STORM_PHASES[0].wait;
  state.stormRadius = 100;
  state.stormShrinking = false;
  state.ammo = { ar: { current: 30, reserve: 90 }, shotgun: { current: 6, reserve: 18 } };
  state.velocity.set(0, 0, 0);

  player.position.set(0, getGroundHeight(0, 0), 0);
  state.yaw = 0;
  state.pitch = 0;

  document.getElementById('menu').classList.add('hidden');
  document.getElementById('game-over').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  if (state.isMobile) {
    document.getElementById('mobile-controls').classList.remove('hidden');
  } else {
    renderer.domElement.requestPointerLock();
  }
  updateHUD();
}

function endGame(won) {
  document.body.classList.remove('playing');
  state.playing = false;
  document.exitPointerLock();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('mobile-controls').classList.add('hidden');
  document.getElementById('game-over').classList.remove('hidden');
  document.getElementById('result-title').textContent = won ? '#1 VICTORY ROYALE!' : 'ELENDİN!';
  document.getElementById('result-title').style.background = won
    ? 'linear-gradient(90deg, #ffd700, #ff8c00)'
    : 'linear-gradient(90deg, #ff4444, #cc0000)';
  document.getElementById('result-title').style.webkitBackgroundClip = 'text';
  document.getElementById('result-stats').textContent =
    `${state.kills} öldürme | ${state.alive} oyuncu kaldı`;
}

async function resetGame() {
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
  await loadBotPalettes();
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
  if (e.key === 'e') startKeyboardChestHold();
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
  if (e.key === 'e') cancelKeyboardChestHold();
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

function showStoreMessage(text, duration = 2) {
  const msg = document.getElementById('store-message');
  if (!msg) return;
  msg.textContent = text;
  msg.classList.add('visible');
  clearTimeout(msg._timeout);
  msg._timeout = setTimeout(() => {
    msg.classList.remove('visible');
  }, duration * 1000);
}

function updateStoreUI() {
  const balanceEl = document.getElementById('dpapel-balance');
  if (balanceEl) {
    balanceEl.textContent = state.dpapel.toLocaleString();
  }

  document.querySelectorAll('.costume-price').forEach(el => {
    const key = el.dataset.costume;
    const price = COSTUME_PRICES[key] || 0;
    el.textContent = `${price.toLocaleString()} D-papel`;
  });

  document.querySelectorAll('.store-action').forEach(btn => {
    const action = btn.dataset.action;
    const costume = btn.dataset.costume;
    if (action === 'buy' && costume) {
      const owned = state.ownedCostumes.includes(costume);
      btn.textContent = owned ? 'SEÇ' : `SATIN AL (${COSTUME_PRICES[costume] || 0})`;
      btn.classList.toggle('owned', owned);
    }
  });
}

function buyDpapelPackage(amount, price) {
  state.dpapel += amount;
  updateStoreUI();
  showStoreMessage(`${amount.toLocaleString()} D-papel satın alındı!`);
}

function purchaseCostume(costumeKey) {
  if (state.ownedCostumes.includes(costumeKey)) {
    applyCostume(costumeKey);
    showStoreMessage('Kostüm seçildi.');
    return;
  }

  const price = COSTUME_PRICES[costumeKey] || 0;
  if (state.dpapel < price) {
    showStoreMessage('Yeterli D-papel yok.');
    return;
  }

  state.dpapel -= price;
  state.ownedCostumes.push(costumeKey);
  applyCostume(costumeKey);
  updateStoreUI();
  showStoreMessage('Kostüm satın alındı!');
}

function setupStoreUI() {
  const storeBtn = document.getElementById('store-btn');
  const storeBackBtn = document.getElementById('store-back-btn');
  const costumesBtn = document.getElementById('costumes-btn');
  const costumesBackBtn = document.getElementById('costumes-back-btn');
  const storeActionButtons = document.querySelectorAll('.store-action');

  window.openStore = function () {
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('store').classList.remove('hidden');
    updateStoreUI();
  };

  window.closeStore = function () {
    document.getElementById('store').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
  };

  window.openCostumes = function () {
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('costumes').classList.remove('hidden');
    updateStoreUI();
  };

  window.closeCostumes = function () {
    document.getElementById('costumes').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    updateStoreUI();
  };

  if (storeBtn) {
    storeBtn.addEventListener('click', window.openStore);
  }

  if (storeBackBtn) {
    storeBackBtn.addEventListener('click', window.closeStore);
  }

  if (costumesBtn) {
    costumesBtn.addEventListener('click', window.openCostumes);
  }

  if (costumesBackBtn) {
    costumesBackBtn.addEventListener('click', window.closeCostumes);
  }

  storeActionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'package') {
        buyDpapelPackage(Number(btn.dataset.amount), Number(btn.dataset.price));
      } else if (action === 'buy' && btn.dataset.costume) {
        purchaseCostume(btn.dataset.costume);
      } else if (action === 'select' && btn.dataset.costume) {
        if (state.ownedCostumes.includes(btn.dataset.costume) || btn.dataset.costume === 'soldier') {
          applyCostume(btn.dataset.costume);
          showStoreMessage('Kostüm seçildi.');
        } else {
          showStoreMessage('Bu kostümü önce mağazadan satın almalısın.');
        }
      }
    });
  });
}

// ─── Mobil Kontroller ──────────────────────────────────────────
function detectMobile() {
  state.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900;
  if (state.isMobile) {
    document.body.classList.add('mobile');
    state.keys['shift'] = true; // mobile runs faster by default
  }
}

const joystickArea = document.getElementById('joystick-area');
const joystickStick = document.getElementById('joystick-stick');
const JOY_RADIUS = 80;

function handleJoystickStart(e) {
  if (!state.playing) return;
  e.preventDefault();
  const touch = e.changedTouches ? e.changedTouches[0] : e;
  state.joystick.active = true;
  state.joystick.id = touch.identifier ?? 'mouse';
  updateJoystick(touch);
}

function handleJoystickMove(e) {
  if (!state.joystick.active) return;
  e.preventDefault();
  const touches = e.changedTouches || [e];
  for (const touch of touches) {
    if ((touch.identifier ?? 'mouse') === state.joystick.id) {
      updateJoystick(touch);
      break;
    }
  }
}

function updateJoystick(touch) {
  const rect = joystickArea.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = touch.clientX - cx;
  let dy = touch.clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > JOY_RADIUS) {
    dx = (dx / dist) * JOY_RADIUS;
    dy = (dy / dist) * JOY_RADIUS;
  }
  joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
  state.joystick.dx = dx / JOY_RADIUS;
  state.joystick.dy = dy / JOY_RADIUS;
}

function handleJoystickEnd(e) {
  const touches = e.changedTouches || [e];
  for (const touch of touches) {
    if ((touch.identifier ?? 'mouse') === state.joystick.id) {
      state.joystick.active = false;
      state.joystick.dx = 0;
      state.joystick.dy = 0;
      state.joystick.id = null;
      joystickStick.style.transform = 'translate(0, 0)';
    }
  }
}

joystickArea.addEventListener('touchstart', handleJoystickStart, { passive: false });
joystickArea.addEventListener('touchmove', handleJoystickMove, { passive: false });
joystickArea.addEventListener('touchend', handleJoystickEnd);
joystickArea.addEventListener('touchcancel', handleJoystickEnd);

const lookArea = document.getElementById('look-area');

lookArea.addEventListener('touchstart', (e) => {
  if (!state.playing) return;
  const touch = e.changedTouches[0];
  state.lookTouch.active = true;
  state.lookTouch.id = touch.identifier;
  state.lookTouch.lastX = touch.clientX;
  state.lookTouch.lastY = touch.clientY;
}, { passive: true });

lookArea.addEventListener('touchmove', (e) => {
  if (!state.lookTouch.active) return;
  e.preventDefault();
  for (const touch of e.changedTouches) {
    if (touch.identifier === state.lookTouch.id) {
      const dx = touch.clientX - state.lookTouch.lastX;
      const dy = touch.clientY - state.lookTouch.lastY;
      state.yaw -= dx * 0.0025;
      state.pitch -= dy * 0.0025;
      state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch));
      state.lookTouch.lastX = touch.clientX;
      state.lookTouch.lastY = touch.clientY;
      break;
    }
  }
}, { passive: false });

lookArea.addEventListener('touchend', (e) => {
  for (const touch of e.changedTouches) {
    if (touch.identifier === state.lookTouch.id) {
      state.lookTouch.active = false;
    }
  }
});

document.getElementById('btn-jump').addEventListener('touchstart', (e) => {
  e.preventDefault();
  state.keys['jump'] = true;
});
document.getElementById('btn-jump').addEventListener('touchend', () => {
  state.keys['jump'] = false;
});

document.getElementById('btn-fire').addEventListener('touchstart', (e) => {
  e.preventDefault();
  state.mouseDown = true;
  if (state.playing) {
    const w = WEAPONS[state.hotbarSlot === 0 ? 'ar' : 'shotgun'];
    if (!w || !w.auto) playerShoot();
    else if (state.hotbarSlot >= 2) playerShoot();
  }
});
document.getElementById('btn-fire').addEventListener('touchend', () => {
  state.mouseDown = false;
});

document.getElementById('btn-reload').addEventListener('touchstart', (e) => {
  e.preventDefault();
  reload();
});

document.getElementById('btn-build').addEventListener('touchstart', (e) => {
  e.preventDefault();
  const mats = ['wood', 'stone', 'metal'];
  const idx = mats.indexOf(state.activeMat);
  state.activeMat = mats[(idx + 1) % mats.length];
  updateHUD();
});

document.getElementById('btn-open')?.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startMobileChestHold();
});
document.getElementById('btn-open')?.addEventListener('touchend', (e) => {
  e.preventDefault();
  cancelChestHold();
});
document.getElementById('btn-open')?.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  cancelChestHold();
});

document.querySelectorAll('.mob-slot').forEach(btn => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    state.hotbarSlot = parseInt(btn.dataset.slot);
    document.querySelectorAll('.mob-slot').forEach(b => b.classList.toggle('active', b === btn));
    updateHUD();
  });
});

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
    updateChests(dt);
    updateChestHold(dt);
  }

  renderer.render(scene, camera);
}

// ─── Init ──────────────────────────────────────────────────────
async function init() {
  detectMobile();
  generateWorld();
  createStormVisual();
  await loadBotPalettes();
  spawnBots();

  player.position.set(0, getGroundHeight(0, 0), 0);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 1, 0);

  applyCostume(currentCostume);
  setupStoreUI();
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');

  gameLoop(0);
}

init();



