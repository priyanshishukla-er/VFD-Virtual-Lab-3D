/**
 * ============================================================================
 * 3D VFD & INDUCTION MOTOR VIRTUAL LAB - COMPLETE SIMULATION SCRIPT
 * ============================================================================
 * Features:
 * - Three.js 3D Virtual Industrial Workbench & Lab Environment
 * - Procedural 3D Variable Frequency Drive (VFD) with interactive 3D buttons & dial
 * - Procedural 3D 4-Pole Squirrel Cage Induction Motor with spinning rotor, pulley & fan
 * - Animated 3D current flow particle wires (L1-L3 mains & U-V-W inverter output)
 * - Real-time VFD Physics & Motor Dynamics (V/f curve, slip, torque, current, thermal)
 * - Industrial Direction Inversion: Automatic safe deceleration to 0Hz before phase reversal
 * - Web Audio API synthesizer for realistic inverter PWM carrier whine & motor drone
 * - Real-Time 3-Phase Waveform & PWM Inverter Oscilloscope
 * - Dual 2D/3D interactive bindings, smooth camera transitions, and lab experiments
 */

// ============================================================================
// 1. GLOBAL STATE & ELECTRICAL PARAMETERS
// ============================================================================
const VFD_STATE = {
  // Operational Status
  powered: true,
  running: false,
  fault: false,
  faultCode: '',
  direction: 1,       // Active physical electrical direction: 1 for FWD, -1 for REV
  targetDirection: 1, // Commanded direction: 1 for FWD, -1 for REV
  jogMode: false,

  // Frequency & Speed
  targetFrequency: 50.0,  // Hz setpoint
  currentFrequency: 0.0, // Hz actual output
  baseFrequency: 50.0,    // Rated frequency (Hz)
  maxFrequency: 60.0,     // Max limit (Hz)
  minFrequency: 0.0,

  // Motor Specifications (4-Pole 2.2kW Induction Motor)
  poles: 4,
  ratedVoltage: 400.0,   // Volts RMS (Line-to-Line)
  ratedCurrent: 5.0,     // Amperes
  ratedSpeed: 1440.0,    // RPM at 50Hz full load
  ratedTorque: 14.59,    // N*m (2200 W / (1440 * 2pi/60))
  nominalSlip: 0.04,     // 4% slip at rated load

  // Ramps
  accelTime: 3.0,        // Seconds from 0 to base frequency
  decelTime: 3.0,        // Seconds from base to 0

  // Dynamic Telemetry
  syncRpm: 0.0,
  rotorRpm: 0.0,
  slipPercent: 0.0,
  voltageRms: 0.0,
  currentRms: 0.0,
  motorTorque: 0.0,
  motorTemp: 24.5,       // °C
  loadPercent: 25.0,     // % mechanical load

  // Wiring Visualization
  showCurrentFlow: true,

  // Audio State
  audioEnabled: true
};

// ============================================================================
// 2. AUDIO SYNTHESIZER (WEB AUDIO API)
// ============================================================================
class LabAudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.initialized = false;

    // Audio Nodes
    this.motorOsc1 = null;
    this.motorOsc2 = null;
    this.motorGain = null;
    this.carrierOsc = null;
    this.carrierGain = null;
    this.masterGain = null;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // 1. Motor Mechanical Hum (Sawtooth & Triangle)
      this.motorOsc1 = this.ctx.createOscillator();
      this.motorOsc1.type = 'sawtooth';
      this.motorOsc1.frequency.setValueAtTime(40, this.ctx.currentTime);

      this.motorOsc2 = this.ctx.createOscillator();
      this.motorOsc2.type = 'sine';
      this.motorOsc2.frequency.setValueAtTime(80, this.ctx.currentTime);

      // Lowpass filter to muffle harsh harmonics
      this.motorFilter = this.ctx.createBiquadFilter();
      this.motorFilter.type = 'lowpass';
      this.motorFilter.frequency.setValueAtTime(450, this.ctx.currentTime);

      this.motorGain = this.ctx.createGain();
      this.motorGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      this.motorOsc1.connect(this.motorFilter);
      this.motorOsc2.connect(this.motorFilter);
      this.motorFilter.connect(this.motorGain);
      this.motorGain.connect(this.masterGain);

      this.motorOsc1.start();
      this.motorOsc2.start();

      // 2. Inverter High-Pitch Carrier Whine (PWM Switching ~3.4kHz)
      this.carrierOsc = this.ctx.createOscillator();
      this.carrierOsc.type = 'sine';
      this.carrierOsc.frequency.setValueAtTime(3400, this.ctx.currentTime);

      this.carrierGain = this.ctx.createGain();
      this.carrierGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      this.carrierOsc.connect(this.carrierGain);
      this.carrierGain.connect(this.masterGain);

      this.carrierOsc.start();

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio could not be initialized automatically:', e);
    }
  }

  update(frequency, running, fault) {
    if (!this.initialized || !this.ctx || this.isMuted) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;

    if (running && !fault && frequency > 0.1) {
      // Motor fundamental pitch matches electrical frequency
      const fundFreq = Math.max(15, frequency * 2.0);
      this.motorOsc1.frequency.setTargetAtTime(fundFreq, now, 0.1);
      this.motorOsc2.frequency.setTargetAtTime(fundFreq * 2.0, now, 0.1);

      // Volume proportional to frequency and load
      const targetMotorVol = Math.min(0.28, (frequency / 50.0) * 0.22 + (VFD_STATE.loadPercent / 100) * 0.08);
      this.motorGain.gain.setTargetAtTime(targetMotorVol, now, 0.08);

      // Inverter PWM whistle (slight modulation with frequency)
      const carrierFreq = 3400 + Math.sin(frequency * 0.2) * 200;
      this.carrierOsc.frequency.setTargetAtTime(carrierFreq, now, 0.1);
      this.carrierGain.gain.setTargetAtTime(0.035 * (frequency / 50.0), now, 0.08);
    } else {
      // Fade to silence
      this.motorGain.gain.setTargetAtTime(0.0001, now, 0.15);
      this.carrierGain.gain.setTargetAtTime(0.0001, now, 0.15);
    }
  }

  playClick() {
    if (!this.initialized || !this.ctx || this.isMuted) return;
    try {
      const clickOsc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      clickOsc.type = 'square';
      clickOsc.frequency.setValueAtTime(800, this.ctx.currentTime);
      clickOsc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.04);
      clickGain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      clickOsc.connect(clickGain);
      clickGain.connect(this.ctx.destination);
      clickOsc.start();
      clickOsc.stop(this.ctx.currentTime + 0.04);
    } catch (e) {}
  }

  playRelay() {
    if (!this.initialized || !this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.08);
    } catch (e) {}
  }

  playBeep() {
    if (!this.initialized || !this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(now + 0.25);
    } catch (e) {}
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.3, this.ctx.currentTime);
    }
    return !this.isMuted;
  }
}

const audio = new LabAudioEngine();

// ============================================================================
// 3. THREE.JS 3D SCENE & ASSET GENERATION
// ============================================================================
let scene, camera, renderer, controls;
let vfdGroup, motorGroup, rotorMesh, pulleyDisc, coolingFanMesh;
let vfdDisplayCanvas, vfdDisplayContext, vfdDisplayTexture;
let interactiveObjects = []; // Mesh list for raycasting
let currentParticleSystems = [];
let vfdDialMesh, btnMeshStart, btnMeshStop, btnMeshReset;
let raycaster, mouse;
let vfdLedPower, vfdLedRun, vfdLedFault;
let cameraTransition = null;
let lastCanvasStateKey = '';

// Dragging 3D Dial state
let isDragging3DDial = false;
let start3DDialY = 0;
let dialStartFreq = 50.0;

function initThreeScene() {
  const container = document.getElementById('threeCanvasHolder');
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f16);
  scene.fog = new THREE.FogExp2(0x0a0f16, 0.035);

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 4.5, 8.2);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  // OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below floor
  controls.minDistance = 2.0;
  controls.maxDistance = 16.0;
  controls.target.set(0, 1.2, 0);

  // Raycasting
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Studio Lighting
  setupLighting();

  // Environment & Workbench
  buildWorkbench();

  // Procedural 3D Models
  buildVFDPanel();
  buildInductionMotor();
  buildWiring();

  // Event Listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
}

// ----------------------------------------------------------------------------
// Studio Lighting
// ----------------------------------------------------------------------------
function setupLighting() {
  // Ambient Light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  // Main Overhead Industrial Key Light
  const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.3);
  keyLight.position.set(4, 9, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 25;
  keyLight.shadow.camera.left = -6;
  keyLight.shadow.camera.right = 6;
  keyLight.shadow.camera.top = 6;
  keyLight.shadow.camera.bottom = -6;
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);

  // Cool Cyan Fill Light (SCADA Ambience)
  const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
  fillLight.position.set(-6, 4, 3);
  scene.add(fillLight);

  // Spot light focused on VFD Keypad
  const vfdSpot = new THREE.SpotLight(0xffffff, 1.2, 8, Math.PI / 6, 0.4);
  vfdSpot.position.set(-2.5, 4.0, 3.0);
  vfdSpot.target.position.set(-2.5, 1.5, 0);
  scene.add(vfdSpot);
  scene.add(vfdSpot.target);

  // Spot light focused on Motor
  const motorSpot = new THREE.SpotLight(0xa5f3fc, 1.0, 8, Math.PI / 6, 0.4);
  motorSpot.position.set(2.5, 4.0, 3.0);
  motorSpot.target.position.set(2.2, 1.2, 0);
  scene.add(motorSpot);
  scene.add(motorSpot.target);
}

// ----------------------------------------------------------------------------
// Industrial Workbench & Lab Floor
// ----------------------------------------------------------------------------
function buildWorkbench() {
  // Tiled Lab Floor
  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0f1520,
    roughness: 0.85,
    metalness: 0.2
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Floor Grid Helper
  const grid = new THREE.GridHelper(26, 26, 0x00d2ff, 0x1f293d);
  grid.position.y = 0.005;
  scene.add(grid);

  // Heavy Duty Test Bench Table
  const tableGroup = new THREE.Group();

  // Table Top Plate (Dark Anti-Static Mat)
  const topGeo = new THREE.BoxGeometry(8.2, 0.16, 3.6);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x1a2332,
    roughness: 0.7,
    metalness: 0.3
  });
  const tableTop = new THREE.Mesh(topGeo, topMat);
  tableTop.position.set(0, 0.92, 0);
  tableTop.receiveShadow = true;
  tableTop.castShadow = true;
  tableGroup.add(tableTop);

  // Beveled Edge Runner (Safety Yellow & Black Warning Accent)
  const runnerGeo = new THREE.BoxGeometry(8.24, 0.05, 0.08);
  const runnerMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.5,
    metalness: 0.4
  });
  const runnerFront = new THREE.Mesh(runnerGeo, runnerMat);
  runnerFront.position.set(0, 0.95, 1.81);
  tableGroup.add(runnerFront);

  // Heavy Steel Table Legs
  const legGeo = new THREE.BoxGeometry(0.18, 0.92, 0.18);
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x111620,
    metalness: 0.8,
    roughness: 0.4
  });

  const legPositions = [
    [-3.8, 0.46, -1.6],
    [3.8, 0.46, -1.6],
    [-3.8, 0.46, 1.6],
    [3.8, 0.46, 1.6]
  ];

  legPositions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(...pos);
    leg.castShadow = true;
    tableGroup.add(leg);
  });

  // Back Equipment Mounting Panel (Steel Rack)
  const backPanelGeo = new THREE.BoxGeometry(8.0, 2.8, 0.1);
  const backPanelMat = new THREE.MeshStandardMaterial({
    color: 0x131a26,
    metalness: 0.5,
    roughness: 0.7
  });
  const backPanel = new THREE.Mesh(backPanelGeo, backPanelMat);
  backPanel.position.set(0, 2.2, -1.75);
  backPanel.receiveShadow = true;
  backPanel.castShadow = true;
  tableGroup.add(backPanel);

  // Main 3-Phase Breaker Enclosure on Back Panel
  const breakerBoxGeo = new THREE.BoxGeometry(1.2, 1.4, 0.35);
  const breakerBoxMat = new THREE.MeshStandardMaterial({
    color: 0x242e3f,
    roughness: 0.6,
    metalness: 0.4
  });
  const breakerBox = new THREE.Mesh(breakerBoxGeo, breakerBoxMat);
  breakerBox.position.set(-2.8, 2.6, -1.55);
  breakerBox.castShadow = true;
  tableGroup.add(breakerBox);

  // Breaker Switch Handle (Red)
  const switchGeo = new THREE.BoxGeometry(0.12, 0.35, 0.18);
  const switchMat = new THREE.MeshStandardMaterial({ color: 0xef4444 });
  const breakerSwitch = new THREE.Mesh(switchGeo, switchMat);
  breakerSwitch.position.set(-2.8, 2.6, -1.35);
  tableGroup.add(breakerSwitch);

  scene.add(tableGroup);
}

// ----------------------------------------------------------------------------
// Procedural 3D VFD Model
// ----------------------------------------------------------------------------
function buildVFDPanel() {
  vfdGroup = new THREE.Group();
  vfdGroup.position.set(-2.2, 1.0, 0.2);

  // 1. Rear Aluminum Heat Sink with Longitudinal Cooling Fins
  const sinkBaseGeo = new THREE.BoxGeometry(1.4, 2.4, 0.25);
  const sinkMat = new THREE.MeshStandardMaterial({
    color: 0x2b3442,
    metalness: 0.85,
    roughness: 0.35
  });
  const sinkBase = new THREE.Mesh(sinkBaseGeo, sinkMat);
  sinkBase.position.set(0, 1.2, -0.4);
  sinkBase.castShadow = true;
  vfdGroup.add(sinkBase);

  // Heat sink individual fins
  for (let i = -6; i <= 6; i++) {
    const finGeo = new THREE.BoxGeometry(0.03, 2.38, 0.3);
    const fin = new THREE.Mesh(finGeo, sinkMat);
    fin.position.set(i * 0.1, 1.2, -0.6);
    fin.castShadow = true;
    vfdGroup.add(fin);
  }

  // 2. Main Polycarbonate Enclosure
  const bodyGeo = new THREE.BoxGeometry(1.5, 2.4, 0.7);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x161d28,
    roughness: 0.45,
    metalness: 0.35
  });
  const vfdBody = new THREE.Mesh(bodyGeo, bodyMat);
  vfdBody.position.set(0, 1.2, 0);
  vfdBody.castShadow = true;
  vfdBody.receiveShadow = true;
  vfdGroup.add(vfdBody);

  // 3. Top Ventilation Grill slots
  for (let i = -3; i <= 3; i++) {
    const grillGeo = new THREE.BoxGeometry(1.1, 0.02, 0.04);
    const grillMat = new THREE.MeshBasicMaterial({ color: 0x090d14 });
    const grill = new THREE.Mesh(grillGeo, grillMat);
    grill.position.set(0, 2.25 + i * 0.04, 0.355);
    vfdGroup.add(grill);
  }

  // 4. Operator Keypad Recessed Bezel
  const keypadBezelGeo = new THREE.BoxGeometry(1.25, 1.35, 0.08);
  const keypadBezelMat = new THREE.MeshStandardMaterial({
    color: 0x0c1118,
    roughness: 0.7,
    metalness: 0.2
  });
  const keypadBezel = new THREE.Mesh(keypadBezelGeo, keypadBezelMat);
  keypadBezel.position.set(0, 1.35, 0.36);
  vfdGroup.add(keypadBezel);

  // 5. Digital 7-Segment LED Canvas Texture Display
  vfdDisplayCanvas = document.createElement('canvas');
  vfdDisplayCanvas.width = 512;
  vfdDisplayCanvas.height = 256;
  vfdDisplayContext = vfdDisplayCanvas.getContext('2d');
  vfdDisplayTexture = new THREE.CanvasTexture(vfdDisplayCanvas);

  updateVfdCanvasTexture(); // Draw initial screen

  const screenGeo = new THREE.PlaneGeometry(1.0, 0.5);
  const screenMat = new THREE.MeshBasicMaterial({ map: vfdDisplayTexture });
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.set(0, 1.7, 0.41);
  vfdGroup.add(screenMesh);

  // 6. Interactive 3D Push Buttons
  // Green START Button
  btnMeshStart = create3DButton(0x10b981, '3D-START');
  btnMeshStart.position.set(-0.35, 1.2, 0.41);
  vfdGroup.add(btnMeshStart);
  interactiveObjects.push(btnMeshStart);

  // Red STOP Button
  btnMeshStop = create3DButton(0xef4444, '3D-STOP');
  btnMeshStop.position.set(0.0, 1.2, 0.41);
  vfdGroup.add(btnMeshStop);
  interactiveObjects.push(btnMeshStop);

  // Blue RESET Button
  btnMeshReset = create3DButton(0x3b82f6, '3D-RESET');
  btnMeshReset.position.set(0.35, 1.2, 0.41);
  vfdGroup.add(btnMeshReset);
  interactiveObjects.push(btnMeshReset);

  // 7. Interactive 3D Rotary Potentiometer Knob
  const dialBaseGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.1, 32);
  const dialMat = new THREE.MeshStandardMaterial({
    color: 0x222b38,
    metalness: 0.8,
    roughness: 0.3
  });
  vfdDialMesh = new THREE.Mesh(dialBaseGeo, dialMat);
  vfdDialMesh.rotation.x = Math.PI / 2;
  vfdDialMesh.position.set(0, 0.88, 0.42);
  vfdDialMesh.userData = { id: '3D-DIAL' };

  // Dial Notch / Indicator Line
  const notchGeo = new THREE.BoxGeometry(0.03, 0.11, 0.08);
  const notchMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
  const notch = new THREE.Mesh(notchGeo, notchMat);
  notch.position.set(0, 0.06, 0.05);
  vfdDialMesh.add(notch);

  vfdGroup.add(vfdDialMesh);
  interactiveObjects.push(vfdDialMesh);

  // 8. Status LEDs on Keypad
  vfdLedPower = create3DLed(0x10b981, -0.4, 1.95);
  vfdLedRun = create3DLed(0xf59e0b, 0.0, 1.95);
  vfdLedFault = create3DLed(0xef4444, 0.4, 1.95);
  vfdGroup.add(vfdLedPower);
  vfdGroup.add(vfdLedRun);
  vfdGroup.add(vfdLedFault);

  // 9. Lower Terminal Block Strip (L1, L2, L3, U, V, W, PE)
  const terminalStripGeo = new THREE.BoxGeometry(1.3, 0.25, 0.2);
  const terminalStripMat = new THREE.MeshStandardMaterial({ color: 0x0d1219, roughness: 0.8 });
  const terminalStrip = new THREE.Mesh(terminalStripGeo, terminalStripMat);
  terminalStrip.position.set(0, 0.18, 0.3);
  vfdGroup.add(terminalStrip);

  // Terminal Screw Studs
  for (let i = -3; i <= 3; i++) {
    const screwGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12);
    const screwMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.9, roughness: 0.2 });
    const screw = new THREE.Mesh(screwGeo, screwMat);
    screw.position.set(i * 0.18, 0.28, 0.3);
    vfdGroup.add(screw);
  }

  scene.add(vfdGroup);
}

function create3DButton(colorHex, id) {
  const btnGroup = new THREE.Group();

  // Outer Bezel Ring
  const ringGeo = new THREE.CylinderGeometry(0.12, 0.13, 0.04, 24);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.7, roughness: 0.3 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  btnGroup.add(ring);

  // Center Push Cap
  const capGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 24);
  const capMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.3,
    metalness: 0.4,
    emissive: colorHex,
    emissiveIntensity: 0.2
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.02;
  btnGroup.add(cap);

  btnGroup.userData = { id: id, cap: cap, baseColor: colorHex };
  return btnGroup;
}

function create3DLed(colorHex, x, y) {
  const ledGeo = new THREE.SphereGeometry(0.03, 16, 16);
  const ledMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.1
  });
  const led = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(x, y, 0.41);
  return led;
}

// Draw dynamic digital 7-segment style text on VFD Canvas texture (cached to boost performance)
function updateVfdCanvasTexture() {
  if (!vfdDisplayContext) return;

  const stateKey = `${VFD_STATE.currentFrequency.toFixed(1)}_${Math.round(VFD_STATE.rotorRpm)}_${Math.round(VFD_STATE.voltageRms)}_${VFD_STATE.currentRms.toFixed(1)}_${VFD_STATE.direction}_${VFD_STATE.fault}_${VFD_STATE.faultCode}`;
  if (stateKey === lastCanvasStateKey) return;
  lastCanvasStateKey = stateKey;

  const ctx = vfdDisplayContext;

  // Dark LCD/LED Background
  ctx.fillStyle = '#060a0f';
  ctx.fillRect(0, 0, 512, 256);

  // Green Glow Frame
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 240);

  // Header Subtext
  ctx.fillStyle = '#6b7280';
  ctx.font = 'bold 22px monospace';
  ctx.fillText('VFD DIGITAL OPERATOR', 24, 40);

  // Direction Indicator
  ctx.fillStyle = VFD_STATE.direction === 1 ? '#10b981' : '#f59e0b';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(VFD_STATE.direction === 1 ? 'DIR: FWD' : 'DIR: REV', 360, 40);

  // Main Numerical Display
  ctx.font = 'bold 96px "Share Tech Mono", monospace';

  if (VFD_STATE.fault) {
    ctx.fillStyle = '#ef4444';
    ctx.fillText(VFD_STATE.faultCode || 'E.TRIP', 110, 150);
  } else {
    ctx.fillStyle = '#ef4444'; // High visibility red/amber LED
    const freqStr = VFD_STATE.currentFrequency.toFixed(2);
    ctx.fillText(`${freqStr}Hz`, 65, 150);
  }

  // Bottom Status Bar
  ctx.fillStyle = '#9ca3af';
  ctx.font = '22px monospace';
  const rpmStr = Math.round(VFD_STATE.rotorRpm).toString().padStart(4, '0');
  const voltStr = Math.round(VFD_STATE.voltageRms).toString().padStart(3, '0');
  ctx.fillText(`N: ${rpmStr} RPM   V: ${voltStr}V   I: ${VFD_STATE.currentRms.toFixed(1)}A`, 24, 215);

  if (vfdDisplayTexture) {
    vfdDisplayTexture.needsUpdate = true;
  }
}

// ----------------------------------------------------------------------------
// Procedural 3D Induction Motor Model
// ----------------------------------------------------------------------------
function buildInductionMotor() {
  motorGroup = new THREE.Group();
  motorGroup.position.set(2.2, 1.45, 0.2);

  const motorBlue = 0x1e3a8a; // Industrial cast motor enamel blue

  // 1. Motor Main Stator Frame (Cylinder)
  const statorGeo = new THREE.CylinderGeometry(0.72, 0.72, 1.8, 32);
  const statorMat = new THREE.MeshStandardMaterial({
    color: motorBlue,
    roughness: 0.55,
    metalness: 0.4
  });
  const stator = new THREE.Mesh(statorGeo, statorMat);
  stator.rotation.z = Math.PI / 2; // Horizontal motor shaft along X-axis
  stator.castShadow = true;
  stator.receiveShadow = true;
  motorGroup.add(stator);

  // 2. Stator Cooling Fins Array (Longitudinal Ring Discs)
  for (let i = -7; i <= 7; i++) {
    const finGeo = new THREE.CylinderGeometry(0.82, 0.82, 0.03, 32);
    const fin = new THREE.Mesh(finGeo, statorMat);
    fin.rotation.z = Math.PI / 2;
    fin.position.x = i * 0.1;
    fin.castShadow = true;
    motorGroup.add(fin);
  }

  // 3. Drive End & Non-Drive End Bell Shields
  const bellGeo = new THREE.CylinderGeometry(0.73, 0.62, 0.25, 32);
  const bellMat = new THREE.MeshStandardMaterial({
    color: 0x172554,
    roughness: 0.4,
    metalness: 0.5
  });

  const frontBell = new THREE.Mesh(bellGeo, bellMat);
  frontBell.rotation.z = -Math.PI / 2;
  frontBell.position.x = 0.98;
  frontBell.castShadow = true;
  motorGroup.add(frontBell);

  const rearBell = new THREE.Mesh(bellGeo, bellMat);
  rearBell.rotation.z = Math.PI / 2;
  rearBell.position.x = -0.98;
  rearBell.castShadow = true;
  motorGroup.add(rearBell);

  // 4. Mounting Base Feet (Bolted to Workbench)
  const footMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.7, roughness: 0.4 });
  const footGeo = new THREE.BoxGeometry(1.6, 0.12, 1.4);
  const feet = new THREE.Mesh(footGeo, footMat);
  feet.position.set(0, -0.68, 0);
  feet.castShadow = true;
  motorGroup.add(feet);

  // 4 Hex Anchor Bolts
  const boltPositions = [
    [-0.6, -0.6, -0.55],
    [0.6, -0.6, -0.55],
    [-0.6, -0.6, 0.55],
    [0.6, -0.6, 0.55]
  ];
  boltPositions.forEach(pos => {
    const boltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.9, roughness: 0.2 });
    const bolt = new THREE.Mesh(boltGeo, boltMat);
    bolt.position.set(...pos);
    motorGroup.add(bolt);
  });

  // 5. Motor Terminal Junction Box (Top)
  const termBoxGeo = new THREE.BoxGeometry(0.55, 0.35, 0.5);
  const termBoxMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
  const termBox = new THREE.Mesh(termBoxGeo, termBoxMat);
  termBox.position.set(0, 0.88, 0);
  termBox.castShadow = true;
  motorGroup.add(termBox);

  // Star/Delta Terminal links inside/on box
  const cableGlandGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 12);
  const cableGlandMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8 });
  const cableGland = new THREE.Mesh(cableGlandGeo, cableGlandMat);
  cableGland.rotation.z = Math.PI / 2;
  cableGland.position.set(-0.32, 0.88, 0);
  motorGroup.add(cableGland);

  // 6. Rotating Drive Assembly (Rotor Shaft + Pulley / Strobe Wheel)
  const rotorGroup = new THREE.Group();
  rotorGroup.position.set(0.98, 0, 0);

  // Drive Shaft with Keyway
  const shaftGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.1, 24);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xe5e7eb,
    metalness: 0.95,
    roughness: 0.15
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = 0.55;
  shaft.castShadow = true;
  rotorGroup.add(shaft);

  // Keyway slot marker on shaft
  const keywayGeo = new THREE.BoxGeometry(0.4, 0.04, 0.03);
  const keywayMat = new THREE.MeshBasicMaterial({ color: 0x1f2937 });
  const keyway = new THREE.Mesh(keywayGeo, keywayMat);
  keyway.position.set(0.65, 0.12, 0);
  rotorGroup.add(keyway);

  // High-Contrast Optical Speed Strobe Disc / Pulley
  const pulleyGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.2, 32);
  const pulleyCanvas = createStrobeDiscTexture();
  const pulleyTex = new THREE.CanvasTexture(pulleyCanvas);
  const pulleyMat = new THREE.MeshStandardMaterial({
    map: pulleyTex,
    metalness: 0.4,
    roughness: 0.5
  });
  pulleyDisc = new THREE.Mesh(pulleyGeo, pulleyMat);
  pulleyDisc.rotation.z = -Math.PI / 2;
  pulleyDisc.position.x = 0.9;
  pulleyDisc.castShadow = true;
  rotorGroup.add(pulleyDisc);

  rotorMesh = rotorGroup;
  motorGroup.add(rotorMesh);

  // 7. Rear Aerofoil Cooling Fan & Protective Cast Cowling
  const fanCowlGeo = new THREE.CylinderGeometry(0.72, 0.72, 0.5, 32, 1, true);
  const fanCowlMat = new THREE.MeshStandardMaterial({
    color: 0x1e3a8a,
    roughness: 0.6,
    side: THREE.DoubleSide
  });
  const fanCowl = new THREE.Mesh(fanCowlGeo, fanCowlMat);
  fanCowl.rotation.z = Math.PI / 2;
  fanCowl.position.x = -1.25;
  fanCowl.castShadow = true;
  motorGroup.add(fanCowl);

  // Protective Wire Mesh Grill on Rear Cowl
  const grillGeo = new THREE.CircleGeometry(0.7, 16);
  const grillMat = new THREE.MeshBasicMaterial({
    color: 0x0f172a,
    wireframe: true
  });
  const rearGrill = new THREE.Mesh(grillGeo, grillMat);
  rearGrill.rotation.y = -Math.PI / 2;
  rearGrill.position.x = -1.5;
  motorGroup.add(rearGrill);

  // Internal Fan Blades (Spins in lockstep with shaft)
  const fanGroup = new THREE.Group();
  fanGroup.position.set(-1.25, 0, 0);

  const fanHubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16);
  const fanHubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const fanHub = new THREE.Mesh(fanHubGeo, fanHubMat);
  fanHub.rotation.z = Math.PI / 2;
  fanGroup.add(fanHub);

  // 6 Aerofoil Blades
  for (let b = 0; b < 6; b++) {
    const bladeGeo = new THREE.BoxGeometry(0.04, 0.42, 0.14);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.y = 0.35 * Math.cos((b * Math.PI) / 3);
    blade.position.z = 0.35 * Math.sin((b * Math.PI) / 3);
    blade.rotation.x = (b * Math.PI) / 3 + 0.35; // Pitched aerofoil angle
    fanGroup.add(blade);
  }

  coolingFanMesh = fanGroup;
  motorGroup.add(coolingFanMesh);

  scene.add(motorGroup);
}

// Generate high contrast striped texture for the strobe wheel
function createStrobeDiscTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, 512, 512);

  // Radial Pie Wedges (Hazard yellow / black)
  const centerX = 256;
  const centerY = 256;
  const radius = 240;
  const wedges = 12;

  for (let i = 0; i < wedges; i++) {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    const startAngle = (i * 2 * Math.PI) / wedges;
    const endAngle = ((i + 1) * 2 * Math.PI) / wedges;
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? '#f59e0b' : '#111827';
    ctx.fill();
  }

  // Outer Perimeter Alternating Rim Stripes for 3/4 edge visibility
  for (let s = 0; s < 24; s++) {
    ctx.fillStyle = s % 2 === 0 ? '#f59e0b' : '#030712';
    ctx.fillRect(s * (512 / 24), 0, 512 / 24, 60);
    ctx.fillRect(s * (512 / 24), 452, 512 / 24, 60);
  }

  // Inner Hub Circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, 70, 0, Math.PI * 2);
  ctx.fillStyle = '#e5e7eb';
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#374151';
  ctx.stroke();

  return canvas;
}

// ----------------------------------------------------------------------------
// 3D Wiring System & Animated Current Flow
// ----------------------------------------------------------------------------
function buildWiring() {
  // Cables:
  // 1. Mains 3-Phase: Breaker Box -> VFD Upper/Back Inputs (L1-Red, L2-Yellow, L3-Blue)
  const mainsWiring = [
    {
      color: 0xef4444, // L1 Red
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(-2.8, 2.0, -1.4),
        new THREE.Vector3(-2.8, 1.4, -0.9),
        new THREE.Vector3(-2.5, 1.1, -0.4),
        new THREE.Vector3(-2.4, 0.4, 0.3)
      ])
    },
    {
      color: 0xf59e0b, // L2 Yellow
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(-2.7, 2.0, -1.4),
        new THREE.Vector3(-2.7, 1.35, -0.9),
        new THREE.Vector3(-2.4, 1.05, -0.4),
        new THREE.Vector3(-2.3, 0.4, 0.3)
      ])
    },
    {
      color: 0x3b82f6, // L3 Blue
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(-2.6, 2.0, -1.4),
        new THREE.Vector3(-2.6, 1.3, -0.9),
        new THREE.Vector3(-2.3, 1.0, -0.4),
        new THREE.Vector3(-2.2, 0.4, 0.3)
      ])
    }
  ];

  // 2. Inverter 3-Phase Output: VFD Terminals (U, V, W) -> Motor Junction Box
  const motorWiring = [
    {
      color: 0xf87171, // U (Phase A)
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(-2.0, 0.35, 0.4),
        new THREE.Vector3(-1.0, 0.25, 0.6),
        new THREE.Vector3(0.5, 0.25, 0.6),
        new THREE.Vector3(1.8, 1.0, 0.35),
        new THREE.Vector3(1.9, 2.3, 0.2)
      ])
    },
    {
      color: 0xfde047, // V (Phase B)
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.9, 0.35, 0.4),
        new THREE.Vector3(-0.9, 0.22, 0.55),
        new THREE.Vector3(0.6, 0.22, 0.55),
        new THREE.Vector3(1.85, 1.05, 0.3),
        new THREE.Vector3(1.9, 2.33, 0.2)
      ])
    },
    {
      color: 0x38bdf8, // W (Phase C)
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.8, 0.35, 0.4),
        new THREE.Vector3(-0.8, 0.2, 0.5),
        new THREE.Vector3(0.7, 0.2, 0.5),
        new THREE.Vector3(1.9, 1.1, 0.25),
        new THREE.Vector3(1.9, 2.36, 0.2)
      ])
    }
  ];

  const allWires = [...mainsWiring, ...motorWiring];

  allWires.forEach(wire => {
    // Solid Tube Geometry for the wire jacket
    const tubeGeo = new THREE.TubeGeometry(wire.curve, 40, 0.024, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: wire.color,
      roughness: 0.6,
      metalness: 0.2
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    tubeMesh.castShadow = true;
    scene.add(tubeMesh);

    // Glowing Current Pulse Particles traversing along the curve
    const particleCount = 18;
    const particleGeo = new THREE.SphereGeometry(0.038, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({
      color: wire.color,
      transparent: true,
      opacity: 0.85
    });

    const particles = [];
    for (let p = 0; p < particleCount; p++) {
      const pMesh = new THREE.Mesh(particleGeo, particleMat);
      scene.add(pMesh);
      particles.push({
        mesh: pMesh,
        offset: p / particleCount
      });
    }

    currentParticleSystems.push({
      curve: wire.curve,
      particles: particles
    });
  });
}

// Animate glowing current flow particles along cable paths (handles both FWD and REV directions safely)
function animateCurrentFlow(delta) {
  if (!VFD_STATE.showCurrentFlow) {
    currentParticleSystems.forEach(sys => {
      sys.particles.forEach(p => (p.mesh.visible = false));
    });
    return;
  }

  // Particle speed matches electrical frequency
  const speed = (VFD_STATE.currentFrequency / 50.0) * 0.35;

  currentParticleSystems.forEach(sys => {
    const isMoving = VFD_STATE.running && VFD_STATE.currentFrequency > 0.05;

    sys.particles.forEach(p => {
      p.mesh.visible = isMoving;
      if (isMoving) {
        // Calculate new offset including direction, ensuring it wraps cleanly between 0 and 1
        p.offset = (p.offset + speed * VFD_STATE.direction * delta) % 1.0;
        if (p.offset < 0) p.offset += 1.0;
        const pos = sys.curve.getPointAt(p.offset);
        p.mesh.position.copy(pos);
      }
    });
  });
}

// ----------------------------------------------------------------------------
// Raycasting & 3D Click Interactions
// ----------------------------------------------------------------------------
function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Handle dragging 3D dial vertically to adjust frequency
  if (isDragging3DDial) {
    const deltaY = start3DDialY - event.clientY;
    let newFreq = dialStartFreq + deltaY * 0.2;
    setTargetFrequency(newFreq);
    return;
  }

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactiveObjects, true);

  const tooltip = document.getElementById('interactionTooltip');
  const tooltipText = document.getElementById('tooltipText');

  if (intersects.length > 0) {
    renderer.domElement.style.cursor = 'pointer';
    let topObj = intersects[0].object;
    while (topObj.parent && !topObj.userData.id && topObj.parent !== scene) {
      topObj = topObj.parent;
    }

    const id = topObj.userData.id;
    if (id) {
      tooltip.classList.remove('hidden');
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;

      if (id === '3D-START') tooltipText.textContent = '3D START: Run VFD';
      else if (id === '3D-STOP') tooltipText.textContent = '3D STOP: Decelerate & Halt';
      else if (id === '3D-RESET') tooltipText.textContent = '3D RESET: Clear Faults';
      else if (id === '3D-DIAL') tooltipText.textContent = '3D POTENTIOMETER: Click/Drag to Adjust Hz';
    }
  } else {
    renderer.domElement.style.cursor = 'default';
    tooltip.classList.add('hidden');
  }
}

function onPointerDown(event) {
  audio.init(); // Initialize audio context on user gesture

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactiveObjects, true);

  if (intersects.length > 0) {
    let topObj = intersects[0].object;
    while (topObj.parent && !topObj.userData.id && topObj.parent !== scene) {
      topObj = topObj.parent;
    }

    const id = topObj.userData.id;
    if (id === '3D-START') {
      triggerStart();
      animateButtonDepress(topObj);
    } else if (id === '3D-STOP') {
      triggerStop();
      animateButtonDepress(topObj);
    } else if (id === '3D-RESET') {
      triggerReset();
      animateButtonDepress(topObj);
    } else if (id === '3D-DIAL') {
      isDragging3DDial = true;
      start3DDialY = event.clientY;
      dialStartFreq = VFD_STATE.targetFrequency;
      controls.enabled = false; // Temporarily disable camera rotation while dragging dial
      audio.playClick();
    }
  }
}

function onPointerUp() {
  if (isDragging3DDial) {
    isDragging3DDial = false;
    controls.enabled = true; // Re-enable orbit controls
  }
}

function animateButtonDepress(btnGroup) {
  if (!btnGroup.userData.cap) return;
  const cap = btnGroup.userData.cap;
  cap.position.z = -0.01;
  setTimeout(() => {
    cap.position.z = 0.02;
  }, 140);
}

// ----------------------------------------------------------------------------
// Window Resize & Smooth Camera Presets
// ----------------------------------------------------------------------------
function onWindowResize() {
  const container = document.getElementById('threeCanvasHolder');
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function setCameraPreset(preset) {
  let targetPos, targetLook;

  switch (preset) {
    case 'vfd':
      targetPos = new THREE.Vector3(-2.2, 2.3, 2.5);
      targetLook = new THREE.Vector3(-2.2, 2.0, 0.4);
      break;
    case 'motor':
      targetPos = new THREE.Vector3(2.4, 2.4, 2.6);
      targetLook = new THREE.Vector3(2.4, 1.45, 0.2);
      break;
    case 'wiring':
      targetPos = new THREE.Vector3(0, 2.6, 3.2);
      targetLook = new THREE.Vector3(0, 1.2, 0);
      break;
    case 'top':
      targetPos = new THREE.Vector3(0, 9.0, 0.5);
      targetLook = new THREE.Vector3(0, 1.0, 0);
      break;
    case 'default':
    default:
      targetPos = new THREE.Vector3(0, 4.5, 8.2);
      targetLook = new THREE.Vector3(0, 1.2, 0);
      break;
  }

  // Set smooth camera glide transition
  cameraTransition = {
    startPos: camera.position.clone(),
    endPos: targetPos,
    startLook: controls.target.clone(),
    endLook: targetLook,
    progress: 0,
    duration: 0.8
  };
}

// ============================================================================
// 4. VFD PHYSICS & MOTOR DYNAMICS ENGINE
// ============================================================================
function updateVfdPhysics(delta) {
  // Safe industrial direction transition:
  // If target direction differs from current direction while running, decelerate to 0Hz first
  const directionMismatch = (VFD_STATE.targetDirection !== VFD_STATE.direction);

  if (directionMismatch && VFD_STATE.currentFrequency > 0.05) {
    // Decelerating to zero speed before reversing phase sequence
    const step = (delta / Math.max(0.2, VFD_STATE.decelTime)) * VFD_STATE.baseFrequency;
    VFD_STATE.currentFrequency = Math.max(0, VFD_STATE.currentFrequency - step);
    if (VFD_STATE.currentFrequency <= 0.05) {
      VFD_STATE.direction = VFD_STATE.targetDirection; // Swap direction at zero speed
    }
  } else if (directionMismatch && VFD_STATE.currentFrequency <= 0.05) {
    VFD_STATE.direction = VFD_STATE.targetDirection;
  } else if (VFD_STATE.fault) {
    // If Fault active, cut frequency immediately to 0
    VFD_STATE.running = false;
    VFD_STATE.currentFrequency = Math.max(0, VFD_STATE.currentFrequency - 40 * delta);
  } else if (VFD_STATE.running) {
    // Normal Acceleration / Deceleration to Target Frequency
    const target = VFD_STATE.jogMode ? 5.0 : VFD_STATE.targetFrequency;
    if (VFD_STATE.currentFrequency < target) {
      // Accelerate: delta_f = (delta_t / t_acc) * f_base
      const step = (delta / Math.max(0.2, VFD_STATE.accelTime)) * VFD_STATE.baseFrequency;
      VFD_STATE.currentFrequency = Math.min(target, VFD_STATE.currentFrequency + step);
    } else if (VFD_STATE.currentFrequency > target) {
      // Decelerate
      const step = (delta / Math.max(0.2, VFD_STATE.decelTime)) * VFD_STATE.baseFrequency;
      VFD_STATE.currentFrequency = Math.max(target, VFD_STATE.currentFrequency - step);
    }
  } else {
    // Decelerating to complete stop
    if (VFD_STATE.currentFrequency > 0) {
      const step = (delta / Math.max(0.2, VFD_STATE.decelTime)) * VFD_STATE.baseFrequency;
      VFD_STATE.currentFrequency = Math.max(0, VFD_STATE.currentFrequency - step);
    }
  }

  // Motor Calculations
  const f = VFD_STATE.currentFrequency;

  // 1. Synchronous Speed: N_sync = (120 * f) / Poles
  VFD_STATE.syncRpm = (120.0 * f) / VFD_STATE.poles;

  // 2. Rotor Slip s: Increases with mechanical load (0% to 125%)
  const loadRatio = VFD_STATE.loadPercent / 100.0;
  if (f > 0.5) {
    VFD_STATE.slipPercent = (0.005 + VFD_STATE.nominalSlip * loadRatio) * 100.0;
    VFD_STATE.rotorRpm = Math.max(0, VFD_STATE.syncRpm * (1.0 - VFD_STATE.slipPercent / 100.0));
  } else {
    VFD_STATE.slipPercent = 0.0;
    VFD_STATE.rotorRpm = 0.0;
  }

  // 3. V/f Scalar Control Curve
  if (f > 0.1) {
    const boost = 15.0; // 15V boost for low speed torque
    VFD_STATE.voltageRms = Math.min(VFD_STATE.ratedVoltage, (f / VFD_STATE.baseFrequency) * (VFD_STATE.ratedVoltage - boost) + boost);
  } else {
    VFD_STATE.voltageRms = 0.0;
  }

  // 4. Current Calculation:
  if (f > 0.1) {
    const isAccelerating = VFD_STATE.running && VFD_STATE.currentFrequency < (VFD_STATE.jogMode ? 5.0 : VFD_STATE.targetFrequency);
    const accelInrush = isAccelerating ? 1.8 : 0.0;
    const imag = 1.4;
    const iactive = (VFD_STATE.ratedCurrent - 1.4) * loadRatio + accelInrush;
    VFD_STATE.currentRms = Math.sqrt(imag * imag + iactive * iactive);
  } else {
    VFD_STATE.currentRms = 0.0;
  }

  // 5. Mechanical Torque
  if (f > 0.5) {
    VFD_STATE.motorTorque = VFD_STATE.ratedTorque * loadRatio * (VFD_STATE.voltageRms / 400.0);
  } else {
    VFD_STATE.motorTorque = 0.0;
  }

  // 6. Thermal Dissipation & Temperature Model
  const ambientTemp = 24.5;
  if (VFD_STATE.currentRms > 4.5) {
    VFD_STATE.motorTemp = Math.min(85.0, VFD_STATE.motorTemp + delta * 0.45 * (VFD_STATE.loadPercent / 100.0));
  } else {
    VFD_STATE.motorTemp = Math.max(ambientTemp, VFD_STATE.motorTemp - delta * 0.15);
  }

  // Auto trip on extreme overload (> 120% sustained or > 80°C)
  if (VFD_STATE.loadPercent > 120 && VFD_STATE.running && VFD_STATE.motorTemp > 45) {
    triggerFault('E.OL');
  }

  // 7. Mechanical 3D Shaft Rotation & Vibration
  if (rotorMesh && pulleyDisc && coolingFanMesh) {
    const omega = (VFD_STATE.rotorRpm * 2 * Math.PI) / 60.0;
    const rotDelta = omega * delta * VFD_STATE.direction;

    // Rotate shaft, optical disc, and fan
    rotorMesh.rotation.x += rotDelta;
    coolingFanMesh.rotation.x += rotDelta;

    // Subtle vibration at high load
    if (VFD_STATE.running && f > 5.0) {
      const vibAmp = 0.0015 * (VFD_STATE.loadPercent / 100.0);
      motorGroup.position.y = 1.45 + (Math.random() - 0.5) * vibAmp;
    } else {
      motorGroup.position.y = 1.45;
    }
  }

  // Dial Physical Rotation to reflect Target Frequency
  if (vfdDialMesh) {
    const angle = ((VFD_STATE.targetFrequency - 30.0) / 30.0) * (Math.PI * 0.75);
    vfdDialMesh.rotation.z = -angle;
  }

  // Update Audio Synthesizer
  audio.update(VFD_STATE.currentFrequency, VFD_STATE.running, VFD_STATE.fault);
}

// ----------------------------------------------------------------------------
// Action Triggers
// ----------------------------------------------------------------------------
function triggerStart() {
  if (VFD_STATE.fault) {
    audio.playBeep();
    return;
  }
  if (!VFD_STATE.running) {
    VFD_STATE.running = true;
    audio.playRelay();
  }
}

function triggerStop() {
  if (VFD_STATE.running) {
    VFD_STATE.running = false;
    audio.playRelay();
  }
}

function triggerReset() {
  audio.playClick();
  if (VFD_STATE.fault) {
    VFD_STATE.fault = false;
    VFD_STATE.faultCode = '';
  }
}

function triggerFault(code = 'E.OL') {
  VFD_STATE.fault = true;
  VFD_STATE.faultCode = code;
  VFD_STATE.running = false;
  audio.playBeep();
}

function setTargetFrequency(freq) {
  VFD_STATE.targetFrequency = Math.max(0, Math.min(VFD_STATE.maxFrequency, freq));
  document.getElementById('sliderFreq').value = VFD_STATE.targetFrequency.toFixed(1);
  document.getElementById('dispFreqTarget').textContent = `${VFD_STATE.targetFrequency.toFixed(2)} Hz`;
}

// ============================================================================
// 5. 2D DASHBOARD & TELEMETRY UI SYNCHRONIZATION
// ============================================================================
function initDashboardUI() {
  // Push Buttons
  document.getElementById('btnStart').addEventListener('click', () => {
    audio.init();
    triggerStart();
  });
  document.getElementById('btnStop').addEventListener('click', () => {
    audio.init();
    triggerStop();
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    audio.init();
    triggerReset();
  });

  // Frequency Slider
  const sliderFreq = document.getElementById('sliderFreq');
  sliderFreq.addEventListener('input', (e) => {
    setTargetFrequency(parseFloat(e.target.value));
  });

  // Quick Preset Frequency Chips
  document.querySelectorAll('.btn-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      audio.init();
      audio.playClick();
      setTargetFrequency(parseFloat(btn.dataset.freq));
    });
  });

  // Direction Toggle
  const btnDir = document.getElementById('btnDirToggle');
  btnDir.addEventListener('click', () => {
    audio.init();
    audio.playClick();
    VFD_STATE.targetDirection *= -1;
    const isFwd = VFD_STATE.targetDirection === 1;
    document.getElementById('lblDirection').textContent = isFwd ? 'FORWARD' : 'REVERSE';
    document.getElementById('arrowDirection').style.transform = isFwd ? 'rotate(0deg)' : 'rotate(180deg)';
  });

  // Jog Mode Toggle
  const btnJog = document.getElementById('btnJogMode');
  btnJog.addEventListener('click', () => {
    audio.init();
    audio.playClick();
    VFD_STATE.jogMode = !VFD_STATE.jogMode;
    btnJog.classList.toggle('active', VFD_STATE.jogMode);
  });

  // Accel / Decel Sliders
  const sliderAcc = document.getElementById('sliderAcc');
  sliderAcc.addEventListener('input', (e) => {
    VFD_STATE.accelTime = parseFloat(e.target.value);
    document.getElementById('dispValAcc').textContent = `${VFD_STATE.accelTime.toFixed(1)} s`;
  });

  const sliderDec = document.getElementById('sliderDec');
  sliderDec.addEventListener('input', (e) => {
    VFD_STATE.decelTime = parseFloat(e.target.value);
    document.getElementById('dispValDec').textContent = `${VFD_STATE.decelTime.toFixed(1)} s`;
  });

  // Load Dynamics Slider
  const sliderLoad = document.getElementById('sliderLoad');
  sliderLoad.addEventListener('input', (e) => {
    VFD_STATE.loadPercent = parseFloat(e.target.value);
    let label = `${Math.round(VFD_STATE.loadPercent)}%`;
    if (VFD_STATE.loadPercent === 0) label += ' (No Load)';
    else if (VFD_STATE.loadPercent <= 100) label += ' (Normal)';
    else label += ' (OVERLOAD)';
    document.getElementById('dispLoadVal').textContent = label;
  });

  // Simulated Fault Injections
  document.getElementById('btnInjectOL').addEventListener('click', () => {
    audio.init();
    triggerFault('E.OL');
  });
  document.getElementById('btnInjectOV').addEventListener('click', () => {
    audio.init();
    triggerFault('E.OV');
  });

  // Top Bar Actions
  document.getElementById('btnAudioToggle').addEventListener('click', () => {
    audio.init();
    const enabled = audio.toggleMute();
    document.getElementById('iconAudioOn').classList.toggle('hidden', !enabled);
    document.getElementById('iconAudioOff').classList.toggle('hidden', enabled);
    document.getElementById('audioStatusText').textContent = enabled ? 'AUDIO ON' : 'MUTED';
  });

  const btnWiring = document.getElementById('btnWiringToggle');
  btnWiring.addEventListener('click', () => {
    VFD_STATE.showCurrentFlow = !VFD_STATE.showCurrentFlow;
    btnWiring.classList.toggle('active', VFD_STATE.showCurrentFlow);
  });

  // Camera Presets Dropdown
  document.getElementById('cameraSelect').addEventListener('change', (e) => {
    setCameraPreset(e.target.value);
  });

  // Bottom Drawer Toggle
  const drawer = document.getElementById('bottomDrawer');
  document.getElementById('drawerToggle').addEventListener('click', () => {
    drawer.classList.toggle('open');
  });

  // Guided Experiments Setup
  document.querySelectorAll('.btn-exp-apply').forEach(btn => {
    btn.addEventListener('click', () => {
      audio.init();
      audio.playClick();
      loadExperiment(btn.dataset.action);
    });
  });

  // Oscilloscope Mode Tabs
  document.getElementById('tabSine').addEventListener('click', () => {
    activeScopeMode = 'sine';
    document.getElementById('tabSine').classList.add('active');
    document.getElementById('tabPwm').classList.remove('active');
  });
  document.getElementById('tabPwm').addEventListener('click', () => {
    activeScopeMode = 'pwm';
    document.getElementById('tabPwm').classList.add('active');
    document.getElementById('tabSine').classList.remove('active');
  });

  // 2D Rotary Dial Drag Interaction
  setup2DRotaryDial();
}

function setup2DRotaryDial() {
  const dial = document.getElementById('rotaryDial');
  let isDragging = false;
  let startY = 0;

  dial.addEventListener('pointerdown', (e) => {
    audio.init();
    isDragging = true;
    startY = e.clientY;
    dial.setPointerCapture(e.pointerId);
  });

  dial.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const deltaY = startY - e.clientY;
    startY = e.clientY;

    let newFreq = VFD_STATE.targetFrequency + deltaY * 0.25;
    setTargetFrequency(newFreq);
  });

  const stopDrag = (e) => {
    if (isDragging) {
      isDragging = false;
      try { dial.releasePointerCapture(e.pointerId); } catch(err){}
    }
  };

  dial.addEventListener('pointerup', stopDrag);
  dial.addEventListener('pointercancel', stopDrag);
}

function loadExperiment(expId) {
  switch (expId) {
    case 'exp1':
      // V/f Speed & Slip: 45Hz, 60% load
      triggerReset();
      setTargetFrequency(45.0);
      VFD_STATE.loadPercent = 60.0;
      document.getElementById('sliderLoad').value = 60;
      document.getElementById('dispLoadVal').textContent = '60% (Normal)';
      triggerStart();
      break;
    case 'exp2':
      // Ramp Dynamics: Accel 1.0s, Decel 1.0s
      triggerReset();
      VFD_STATE.accelTime = 1.0;
      VFD_STATE.decelTime = 1.0;
      document.getElementById('sliderAcc').value = 1.0;
      document.getElementById('sliderDec').value = 1.0;
      document.getElementById('dispValAcc').textContent = '1.0 s';
      document.getElementById('dispValDec').textContent = '1.0 s';
      setTargetFrequency(60.0);
      triggerStart();
      break;
    case 'exp3':
      // Overload trip test
      triggerReset();
      setTargetFrequency(50.0);
      VFD_STATE.loadPercent = 125.0;
      document.getElementById('sliderLoad').value = 125;
      document.getElementById('dispLoadVal').textContent = '125% (OVERLOAD)';
      triggerStart();
      break;
    case 'exp4':
      // Reversal
      triggerReset();
      setTargetFrequency(50.0);
      triggerStart();
      setTimeout(() => {
        document.getElementById('btnDirToggle').click();
      }, 2500);
      break;
  }
}

// Update DOM Meters and LEDs
function updateDashboardMeters() {
  // Top LEDs
  const ledPower = document.getElementById('ledPower');
  const ledRun = document.getElementById('ledRun');
  const ledFault = document.getElementById('ledFault');
  const ledDir = document.getElementById('ledDir');
  const badge = document.getElementById('systemStateBadge');

  ledPower.classList.toggle('active', VFD_STATE.powered);
  ledRun.classList.toggle('active', VFD_STATE.running && !VFD_STATE.fault);
  ledFault.classList.toggle('active', VFD_STATE.fault);
  ledDir.classList.toggle('active', VFD_STATE.direction === 1);

  // 3D VFD Panel LEDs
  if (vfdLedPower) vfdLedPower.material.emissiveIntensity = VFD_STATE.powered ? 0.8 : 0.05;
  if (vfdLedRun) vfdLedRun.material.emissiveIntensity = VFD_STATE.running && !VFD_STATE.fault ? 0.9 : 0.05;
  if (vfdLedFault) vfdLedFault.material.emissiveIntensity = VFD_STATE.fault ? 1.0 : 0.05;

  if (VFD_STATE.fault) {
    badge.textContent = `FAULT: ${VFD_STATE.faultCode}`;
    badge.className = 'system-state-badge state-fault';
  } else if (VFD_STATE.running) {
    badge.textContent = 'RUNNING';
    badge.className = 'system-state-badge state-running';
  } else {
    badge.textContent = 'STOPPED / READY';
    badge.className = 'system-state-badge';
  }

  // Multi-Meter Values
  document.getElementById('meterFreq').textContent = VFD_STATE.currentFrequency.toFixed(2);
  document.getElementById('barFreq').style.width = `${(VFD_STATE.currentFrequency / 60.0) * 100}%`;

  document.getElementById('meterRpm').textContent = Math.round(VFD_STATE.rotorRpm).toString().padStart(4, '0');
  document.getElementById('meterSyncRpm').textContent = Math.round(VFD_STATE.syncRpm);
  document.getElementById('meterSlip').textContent = `${VFD_STATE.slipPercent.toFixed(1)}%`;

  document.getElementById('meterVoltage').textContent = Math.round(VFD_STATE.voltageRms);
  document.getElementById('barVoltage').style.width = `${(VFD_STATE.voltageRms / 400.0) * 100}%`;

  document.getElementById('meterCurrent').textContent = VFD_STATE.currentRms.toFixed(1);
  document.getElementById('barCurrent').style.width = `${Math.min(100, (VFD_STATE.currentRms / 8.0) * 100)}%`;

  document.getElementById('meterTorque').textContent = VFD_STATE.motorTorque.toFixed(1);
  document.getElementById('torquePercent').textContent = `${Math.round((VFD_STATE.motorTorque / VFD_STATE.ratedTorque) * 100)}%`;

  document.getElementById('meterTemp').textContent = VFD_STATE.motorTemp.toFixed(1);
  const tempStatus = document.getElementById('tempStatus');
  if (VFD_STATE.motorTemp > 65) {
    tempStatus.textContent = 'HIGH';
    tempStatus.className = 'warning-text';
  } else {
    tempStatus.textContent = 'NORMAL';
    tempStatus.className = 'status-ok';
  }

  // 2D Dial Indicator Rotation
  const dialIndicator = document.getElementById('dialIndicator');
  if (dialIndicator) {
    const angle = ((VFD_STATE.targetFrequency - 30.0) / 30.0) * 135.0;
    dialIndicator.style.transform = `rotate(${angle}deg)`;
  }

  // Refresh 3D 7-Segment VFD Canvas Texture
  updateVfdCanvasTexture();
}

// ============================================================================
// 6. REAL-TIME 3-PHASE OSCILLOSCOPE
// ============================================================================
let scopeCanvas, scopeCtx;
let activeScopeMode = 'sine'; // 'sine' or 'pwm'
let scopePhase = 0.0;

function initOscilloscope() {
  scopeCanvas = document.getElementById('scopeCanvas');
  scopeCtx = scopeCanvas.getContext('2d');
}

function renderOscilloscope(delta) {
  if (!scopeCtx) return;
  const ctx = scopeCtx;
  const w = scopeCanvas.width;
  const h = scopeCanvas.height;
  const midY = h / 2;

  // Clear Screen (CRT Dark Greenish/Navy)
  ctx.fillStyle = '#05080c';
  ctx.fillRect(0, 0, w, h);

  // Draw Grid Lines (Subtle CRT reticle)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;

  for (let x = 0; x < w; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Center Zero Reference Line
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  const f = VFD_STATE.currentFrequency;
  if (f > 0.1 && !VFD_STATE.fault) {
    // Phase advances proportional to frequency and direction
    scopePhase += (f * 2.0 * Math.PI * delta * 0.4) * VFD_STATE.direction;

    // Amplitude proportional to output voltage
    const amplitude = (VFD_STATE.voltageRms / 400.0) * (h * 0.4);

    if (activeScopeMode === 'sine') {
      // 3-Phase Fundamental Sinusoids (U: 0°, V: 120°, W: 240°)
      drawPhaseSine(ctx, w, midY, amplitude, scopePhase, '#f87171');                     // Phase U (Red)
      drawPhaseSine(ctx, w, midY, amplitude, scopePhase - (2 * Math.PI) / 3, '#fbbf24'); // Phase V (Yellow)
      drawPhaseSine(ctx, w, midY, amplitude, scopePhase - (4 * Math.PI) / 3, '#38bdf8'); // Phase W (Cyan)
    } else {
      // Space Vector PWM High-Frequency Switching Pulse Train
      drawPhasePWM(ctx, w, midY, amplitude, scopePhase, '#f87171');
      drawPhasePWM(ctx, w, midY, amplitude, scopePhase - (2 * Math.PI) / 3, '#fbbf24');
      drawPhasePWM(ctx, w, midY, amplitude, scopePhase - (4 * Math.PI) / 3, '#38bdf8');
    }
  } else {
    // Flat 0V trace
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();
  }
}

function drawPhaseSine(ctx, width, midY, amp, phaseOffset, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const angle = (x / width) * 4 * Math.PI + phaseOffset;
    const y = midY - Math.sin(angle) * amp;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0; // reset
}

function drawPhasePWM(ctx, width, midY, amp, phaseOffset, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const carrierFrequency = 14; // Visible pulses
  for (let x = 0; x < width; x += 4) {
    const angle = (x / width) * 4 * Math.PI + phaseOffset;
    const modulation = (Math.sin(angle) + 1) / 2; // 0.0 to 1.0 duty cycle
    const pulseActive = ((x * carrierFrequency) % 100) / 100 < modulation;
    const y = pulseActive ? midY - amp : midY + amp;

    if (x === 0) ctx.moveTo(x, y);
    else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

// ============================================================================
// 7. MAIN INITIALIZATION & ANIMATION LOOP
// ============================================================================
let clock = new THREE.Clock();

function main() {
  initThreeScene();
  initDashboardUI();
  initOscilloscope();

  // Animation Loop
  function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(0.1, clock.getDelta());

    // Update smooth camera transitions if active
    if (cameraTransition) {
      cameraTransition.progress += delta / cameraTransition.duration;
      const t = Math.min(1.0, cameraTransition.progress);
      // Smooth EaseInOutCubic
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(cameraTransition.startPos, cameraTransition.endPos, ease);
      controls.target.lerpVectors(cameraTransition.startLook, cameraTransition.endLook, ease);
      if (t >= 1.0) cameraTransition = null;
    }

    // Update VFD & Motor dynamics
    updateVfdPhysics(delta);

    // Update 3D current flow particles
    animateCurrentFlow(delta);

    // Update 2D Dashboard telemetry
    updateDashboardMeters();

    // Render Oscilloscope
    renderOscilloscope(delta);

    // OrbitControls & 3D Render
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', main);
