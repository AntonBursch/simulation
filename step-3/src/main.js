import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from './world.js';
import { buildSources, updateSources } from './sources.js';
import { makeFlowField } from './currents.js';
import { buildParticles, updateParticles, setParticleMode } from './particles.js';
import { buildBot, updateBotDrift, steerHeading, applyImpulse, setHeading } from './bot.js';
import { createSensor, readSensor } from './sensor.js';

// --- Error overlay (pinned visible so reload-loops can't hide errors) ---
const errBox = document.createElement('div');
errBox.style.cssText = [
  'position:fixed','left:8px','bottom:8px','max-width:60vw','max-height:40vh',
  'overflow:auto','padding:8px 10px','background:rgba(80,0,0,0.85)',
  'border:1px solid #c33','color:#fdd','font:12px/1.4 ui-monospace,Menlo,monospace',
  'white-space:pre-wrap','z-index:9999','display:none','pointer-events:auto'
].join(';');
document.body.appendChild(errBox);
function showError(label, e) {
  errBox.style.display = 'block';
  errBox.textContent += `[${label}] ${e?.message || e}\n${e?.stack || ''}\n\n`;
  console.error(label, e);
}
window.addEventListener('error', (e) => showError('error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError('promise', e.reason));

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
// Build capacity for the slider's max (300s) so we can crank trails live
// without reallocating; start with a shorter lifetime.
const particles = buildParticles({
  sources: sourcesGroup.userData.sources,
  size: WORLD_SIZE,
  perSourcePerSec: 20,
  lifetimeSec: 300,
  diffusion: 1.8,
  pointSize: 6.0,
});
particles.lifetimeSec = 300;
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

// Sensor-radius visualization: faint blue sphere centered on the nose.
const senseSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({
    color: 0x4fb3ff,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
  })
);
const senseWire = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 16, 10)),
  new THREE.LineBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.18 })
);
scene.add(senseSphere);
scene.add(senseWire);
function applySenseRadius(r) {
  senseSphere.scale.setScalar(r);
  senseWire.scale.setScalar(r);
}
applySenseRadius(sensor.radius);

// --- Always-on impulse controller -----------------------------------
// One unified rule: the countdown is ALWAYS running. When it expires the
// bot fires a single forward kick along its current heading.
//   - If a smell signal is present, heading was just slewed up-gradient,
//     so the kick is a pursuit kick that breaks free of the local current.
//   - If no signal, heading is randomized first so the kick wanders.
// Either way, every IDLE_LIMIT seconds the bot commits a push.
const CONF_THRESH = 0.02;
let IDLE_LIMIT = 6.0;         // seconds between kicks
let IMPULSE_SPEED = 300.0;    // velocity added along heading at each kick
let idleTimer = 0;
let lastKickAt = -Infinity;

function randomUnitVector(out) {
  // Marsaglia-style: uniform on the unit sphere.
  let x, y, s;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    s = x * x + y * y;
  } while (s >= 1 || s === 0);
  const f = 2 * Math.sqrt(1 - s);
  out.set(x * f, y * f, 1 - 2 * s);
  return out;
}
const _kickDir = new THREE.Vector3();

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
const idleRow = document.createElement('div');
hud.appendChild(idleRow);
let camTarget = 'bot'; // 'world' | 'bot' — start orbiting the bot
controls.minDistance = 6.0;       // bodyLength * 1.5
controls.maxDistance = WORLD_SIZE * 3;
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
  const remaining = Math.max(0, IDLE_LIMIT - idleTimer).toFixed(1);
  const sinceKick = isFinite(lastKickAt) ? (simTime - lastKickAt).toFixed(1) : '—';
  idleRow.innerHTML = `<span class="k">idle</span> ${remaining}s to kick <span class="k">· last kick</span> ${sinceKick}s ago`;
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

// --- Slider control panel --------------------------------------------
const panel = document.createElement('div');
panel.id = 'controls';
panel.style.cssText = [
  'position:fixed','top:8px','right:10px','padding:8px 10px',
  'background:rgba(0,0,0,0.35)','border:1px solid #222','border-radius:6px',
  'font:12px/1.4 ui-monospace,Menlo,monospace','color:#ddd',
  'pointer-events:auto','user-select:none','min-width:240px'
].join(';');
document.body.appendChild(panel);

function addSlider(label, min, max, step, value, onInput) {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:70px 1fr 50px;align-items:center;gap:6px;margin:2px 0;';
  const name = document.createElement('span');
  name.textContent = label;
  name.style.color = '#888';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  input.style.width = '100%';
  const out = document.createElement('span');
  out.style.textAlign = 'right';
  out.textContent = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    out.textContent = (step < 1) ? v.toFixed(1) : String(v);
    onInput(v);
  });
  row.appendChild(name); row.appendChild(input); row.appendChild(out);
  panel.appendChild(row);
  return input;
}

addSlider('trails',    1,   300, 1,   particles.lifetimeSec, (v) => { particles.lifetimeSec = v; });
addSlider('sense r',   2,   60,  1,   sensor.radius,         (v) => { sensor.radius = v; applySenseRadius(v); });
addSlider('countdown', 0.5, 30,  0.5, IDLE_LIMIT,            (v) => { IDLE_LIMIT = v; });
addSlider('thrust',    0,   600, 10,  IMPULSE_SPEED,         (v) => { IMPULSE_SPEED = v; });

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

    // Sense at the nose. The countdown runs continuously; whenever it
    // expires the bot fires a single forward kick. If we have a real
    // signal we first slew the heading up-gradient (so the kick chases
    // the smell); otherwise we pick a fresh random heading first.
    lastSensorReading = readSensor(bot, sensor, particles);
    const sensing = lastSensorReading.direction && lastSensorReading.confidence > CONF_THRESH;
    if (sensing) {
      steerHeading(bot, lastSensorReading.direction, FIXED_DT, 2.5);
    }
    idleTimer += FIXED_DT;
    if (idleTimer >= IDLE_LIMIT) {
      if (!sensing) {
        randomUnitVector(_kickDir);
        setHeading(bot, _kickDir);
      }
      applyImpulse(bot, bot.heading, IMPULSE_SPEED);
      lastKickAt = simTime;
      idleTimer = 0;
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

  // Sense-radius sphere follows the bot's nose.
  senseSphere.position.copy(bot.nose);
  senseWire.position.copy(bot.nose);

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(safeFrame);
}
function safeFrame() {
  try { frame(); }
  catch (e) { showError('frame', e); /* stop the loop so it doesn't spam */ }
}
safeFrame();
