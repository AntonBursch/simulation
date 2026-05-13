import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from './world.js';
import { buildSources, updateSources } from './sources.js';
import { makeFlowField } from './currents.js';
import { buildParticles, updateParticles, setParticleMode } from './particles.js';
import { buildBot, updateBotDrift, steerHeading } from './bot.js';
import { createSensor, readSensor } from './sensor.js';

const WORLD_SIZE = 300;

const app = document.getElementById('app');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0c);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 4000);
const d = WORLD_SIZE * 1.6;
camera.position.set(d, d * 0.75, d);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = WORLD_SIZE * 0.3;
controls.maxDistance = WORLD_SIZE * 6;

// World volume
const world = buildWorld({ size: WORLD_SIZE, divisions: 10 });
scene.add(world);

// Sources (advected, bouncing) — keep their inertia, distinct from tracers.
const sourcesGroup = buildSources({ size: WORLD_SIZE, count: 12 });
scene.add(sourcesGroup);

// Flow field (multi-octave).
const sampleFlow = makeFlowField({ size: WORLD_SIZE, amplitude: 22 });

// Chemical particles emitted by sources.
const particles = buildParticles({
  sources: sourcesGroup.userData.sources,
  size: WORLD_SIZE,
  perSourcePerSec: 20,
  lifetimeSec: 15,
  diffusion: 1.8,
  pointSize: 6.0,
});
scene.add(particles.points);

// The bot — stationary for now, just placed in the world.
const bot = buildBot({
  size: WORLD_SIZE,
  spawn: new THREE.Vector3(-WORLD_SIZE * 0.35, 0, WORLD_SIZE * 0.25),
  heading: new THREE.Vector3(1, 0, -0.4),
});
scene.add(bot.group);

// Sensor at the bot's nose.
const sensor = createSensor({ radius: 18.0, antennaOffset: 2.5 });
let lastSensorReading = { concentration: 0, direction: null, confidence: 0 };

// Origin marker.
const origin = new THREE.Mesh(
  new THREE.SphereGeometry(WORLD_SIZE * 0.005, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
scene.add(origin);

// --- HUD ---------------------------------------------------------------
const hud = document.getElementById('hud');
const modeRow = document.createElement('div');
const countRow = document.createElement('div');
hud.appendChild(modeRow);
hud.appendChild(countRow);
const camRow = document.createElement('div');
hud.appendChild(camRow);
const senseRow = document.createElement('div');
hud.appendChild(senseRow);
let camTarget = 'world'; // 'world' | 'bot'
function refreshHud() {
  modeRow.innerHTML = `<span class="k">view</span> ${particles.mode === 'dev' ? 'dev (per-source color)' : 'truth (single scalar)'} <span class="k">— press D to toggle</span>`;
  countRow.innerHTML = `<span class="k">particles</span> ${particles.live} / ${particles.capacity}`;
  camRow.innerHTML = `<span class="k">camera</span> ${camTarget} <span class="k">— press T to toggle</span>`;
  const c = lastSensorReading.concentration.toFixed(2);
  const conf = lastSensorReading.confidence.toFixed(2);
  const dir = lastSensorReading.direction
    ? `(${lastSensorReading.direction.x.toFixed(2)}, ${lastSensorReading.direction.y.toFixed(2)}, ${lastSensorReading.direction.z.toFixed(2)})`
    : 'flat';
  senseRow.innerHTML = `<span class="k">smell</span> c=${c} conf=${conf} dir=${dir}`;
}
refreshHud();

window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    setParticleMode(particles, particles.mode === 'dev' ? 'truth' : 'dev');
    refreshHud();
  } else if (e.key === 't' || e.key === 'T') {
    camTarget = camTarget === 'world' ? 'bot' : 'world';
    // Tighten zoom range when following the bot so we can get close.
    if (camTarget === 'bot') {
      controls.minDistance = bot.bodyLength * 1.5;
      controls.maxDistance = WORLD_SIZE * 3;
    } else {
      controls.minDistance = WORLD_SIZE * 0.3;
      controls.maxDistance = WORLD_SIZE * 6;
    }
    refreshHud();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Fixed-step sim loop with accumulator -----------------------------
const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;
let simTime = 0;
let accum = 0;
const clock = new THREE.Clock();

let hudTick = 0;

function frame() {
  const frameDt = Math.min(clock.getDelta(), 0.1);
  accum += frameDt;

  let steps = 0;
  while (accum >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    updateSources(sourcesGroup, sampleFlow, FIXED_DT, simTime, WORLD_SIZE);
    updateParticles(particles, sampleFlow, FIXED_DT, simTime, WORLD_SIZE);

    // The bot drifts with the current too.
    updateBotDrift(bot, sampleFlow, FIXED_DT, simTime, WORLD_SIZE);

    // Sense at the nose, then point toward the smell (no thrust yet).
    lastSensorReading = readSensor(bot, sensor, particles);
    if (lastSensorReading.direction && lastSensorReading.confidence > 0.02) {
      steerHeading(bot, lastSensorReading.direction, FIXED_DT, 2.5);
    }

    simTime += FIXED_DT;
    accum -= FIXED_DT;
    steps++;
  }
  // Drop any leftover backlog beyond the budget — keeps sim from spiraling.
  if (accum > FIXED_DT * MAX_STEPS_PER_FRAME) accum = 0;

  // Throttle HUD updates to ~6 Hz.
  if (++hudTick % 10 === 0) refreshHud();

  // Camera target follow.
  if (camTarget === 'bot') {
    controls.target.copy(bot.position);
  } else {
    controls.target.set(0, 0, 0);
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
