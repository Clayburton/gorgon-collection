/* CKDesign — collection display engine (v0.2 "Gorgon Collection").
   Floating hand-finished 3D prints: hover = piece presents itself (slight grow
   + tilt, others recede), placard = name/date/link chip, click = product page.
   Per-collection knobs live in COLLECTION. See COLLECTION-PLAYBOOK.md. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ============================ COLLECTION ============================ */
const COLLECTION = {
  title: 'Gorgon Collection',
  products: [
    { id:'calabria', name:'Medusa Calabria Italy', date:'2nd–1st BCE',
      url:'https://clayandkelsy.com/medusa-calabria-italy/', file:'assets/calabria.glb' },
    { id:'baroque',  name:'Medusa Baroque Europe', date:'17th Century',
      url:'https://clayandkelsy.com/medusa-baroque-europe/', file:'assets/baroque.glb' },
    { id:'winged',   name:'Winged Medusa Egypt',   date:'332–250 BCE',
      url:'https://clayandkelsy.com/medusa-wing-egypt/', file:'assets/winged.glb',
      hoverScale: 1.17 },   // wide plaque, small face — meets the others at full hover
    { id:'southern', name:'Medusa Southern Italy', date:'500 BCE',
      url:'https://clayandkelsy.com/medusa-southern-italy/', file:'assets/southern.glb' },
  ],
  /* the light "gallery wall" behind everything — retune per collection */
  backdrop: {
    center:'#f6f2ea', edge:'#e3dccd',
    vein:'#b9b0a0', veinAmount:0.16,
    grain:9, seed:7,
    lightX:0.5, lightY:0.38,
  },
  /* stone / acrylic-wash finish (matches the ref photo) */
  finish: {
    base:0xefede7,            // multiplied over the baked wash vertex tones
    washGamma:1.4,            // >1 deepens the wash pooling in the crevices
    rough:0.62, roughWashGloss:0.16, roughVar:0.10,
    clearcoat:0.06, sheen:0.22, sheenColor:0xf2ede2,
    veinAmount:0.10, veinScale:2.6,
    env:0.5,
    hoverTint:0xfff3e4,
  },
  /* landscape scatter (fractions of visible half-plane) + sizes */
  scatterL: [
    { x:-0.56, y:-0.30, z: 0.05, s:0.92 },
    { x:-0.06, y: 0.14, z:-0.20, s:1.02 },
    { x: 0.42, y: 0.42, z:-0.30, s:0.95 },
    { x: 0.62, y:-0.30, z: 0.15, s:0.95 },
  ],
};

/* ============================= TUNABLES ============================= */
const P = {
  fov: 24, camDist: 10,
  spreadX: 0.80, spreadY: 0.74,
  objScale: 0.66,                 // landscape: piece size vs min half-extent
  objScaleP: 1.12,                // portrait column: vs half width
  parallax: { yaw: 2.4, pitch: 1.7 },
  bob:      { amp: 0.05, speed: 0.42 },
  enter:    { dur: 0.95, rise: 0.2, tiltX: 0.16, tiltY: -0.5, scale: 0.93 },  // load-in: turn-to-face + settle
  tumble:   { amp: 0.05, speed: 0.3 },
  hover:    { scale: 1.045, tiltX: -0.055, tiltY: 0.085, lambda: 7 },
  rot:      { max: 0.26, perPx: 1 / 220, lambda: 9 },    // click-drag inspect (~15°)
  dim:      { opacity: 0.45, scale: 0.97, lambda: 6 },   // non-focused pieces recede
  light:    { key: 1.35, fill: 0.5, rim: 0.85, env: 0.5, exposure: 1.0 },
  grade:    { grain: 0.026, vignette: 0.26, contrast: 1.028, centerLight: 0.05 },
  clickPx: 7,
  topClear: 0.10,                 // keep pieces out of the top strip (menu bar)
};

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = document.getElementById('stage');
const canvas = document.getElementById('gl');
const labelLayer = document.getElementById('labelLayer');
const flash = document.getElementById('flash');

/* ============================= RENDERER ============================= */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { showFallback(); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = P.light.exposure;

const scene = new THREE.Scene();

/* ---- procedural gallery-wall backdrop (per-collection, no asset) ---- */
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function makeBackdrop(cfg) {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S * cfg.lightX, S * cfg.lightY, S * 0.08,
                                   S * cfg.lightX, S * (cfg.lightY + 0.16), S * 0.95);
  g.addColorStop(0, cfg.center); g.addColorStop(1, cfg.edge);
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const rnd = mulberry(cfg.seed);
  x.save();
  x.filter = 'blur(22px)';
  x.strokeStyle = cfg.vein;
  for (let i = 0; i < 15; i++) {                       // faint marble drift
    x.globalAlpha = cfg.veinAmount * (0.35 + rnd() * 0.65) * 0.35;
    x.lineWidth = 3 + rnd() * 26;
    x.beginPath();
    let px = rnd() * S, py = rnd() * S;
    x.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      const nx = px + (rnd() - 0.35) * S * 0.5, ny = py + (rnd() - 0.5) * S * 0.4;
      x.quadraticCurveTo(px + (rnd() - 0.5) * S * 0.3, py + (rnd() - 0.5) * S * 0.3, nx, ny);
      px = nx; py = ny;
    }
    x.stroke();
  }
  x.restore();
  const img = x.getImageData(0, 0, S, S), d = img.data;   // fine paper grain
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * cfg.grain;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeBackdrop(COLLECTION.backdrop);

const camera = new THREE.PerspectiveCamera(P.fov, 1, 0.1, 60);
camera.position.set(0, 0, P.camDist);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = P.light.env;

/* gallery lighting: warm key, cool bounce, cold top rim to draw the stone edges */
const key = new THREE.DirectionalLight(0xfff0dd, P.light.key);
key.position.set(2.6, 3.4, 5.2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdde6f4, P.light.fill);
fill.position.set(-4.2, 0.6, 3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xeef4ff, P.light.rim);
rim.position.set(-1.2, 5.2, -4.5);
scene.add(rim);

/* ----- post: gentle grade ----- */
const GradeShader = {
  uniforms: { tDiffuse:{value:null}, uTime:{value:0}, uGrain:{value:P.grade.grain},
              uVig:{value:P.grade.vignette}, uContrast:{value:P.grade.contrast},
              uLight:{value:P.grade.centerLight} },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime,uGrain,uVig,uContrast,uLight;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5, 0.55));
      c.rgb *= 1.0 + uLight * (1.0 - d * 1.7);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.55, 1.05, d) * 0.5;
      c.rgb += (hash(vUv * 719.3 + fract(uTime * 0.37) * 61.7) - 0.5) * uGrain;
      gl_FragColor = c;
    }`
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);

/* ==================== STONE / ACRYLIC-WASH MATERIAL ==================== */
/* The GLB carries the wash in COLOR_0 (rgb = pooled tone, a = proudness).
   The shader adds faint marble drift, satin sheen where the wash pools,
   and a warm presentation glow on hover. */
function makeStoneWash(f) {
  const m = new THREE.MeshPhysicalMaterial({
    color: f.base, vertexColors: true,
    roughness: f.rough, metalness: 0,
    clearcoat: f.clearcoat, clearcoatRoughness: 0.5,
    sheen: f.sheen, sheenColor: new THREE.Color(f.sheenColor), sheenRoughness: 0.65,
    envMapIntensity: f.env,
    side: THREE.DoubleSide,              // hollow scan shells stay solid at any angle
    transparent: true, opacity: 1,       // focus dim fades the others back
  });
  const u = {
    uVeinAmt: { value: f.veinAmount },
    uVeinScale: { value: f.veinScale },
    uWashGamma: { value: f.washGamma },
    uWashGloss: { value: f.roughWashGloss },
    uRoughVar: { value: f.roughVar },
    uSeed: { value: Math.random() * 43 },
    uHover: { value: 0 },
    uHoverTint: { value: new THREE.Color(f.hoverTint) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec3 vOp;
        uniform float uVeinAmt, uVeinScale, uWashGamma, uWashGloss, uRoughVar, uSeed, uHover;
        uniform vec3 uHoverTint;
        float ckN2 = 0.5;
        float ckHash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float ckNoise(vec3 p){
          vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(
            mix(mix(ckHash(i), ckHash(i+vec3(1,0,0)), f.x), mix(ckHash(i+vec3(0,1,0)), ckHash(i+vec3(1,1,0)), f.x), f.y),
            mix(mix(ckHash(i+vec3(0,0,1)), ckHash(i+vec3(1,0,1)), f.x), mix(ckHash(i+vec3(0,1,1)), ckHash(i+vec3(1,1,1)), f.x), f.y),
            f.z);
        }`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec3 sp = vOp * uVeinScale + uSeed;
          float n1 = ckNoise(sp);
          ckN2 = ckNoise(sp * 3.1 + 7.7);
          float band = n1 * 0.7 + ckN2 * 0.3;
          float vein = smoothstep(0.46, 0.54, band) * (1.0 - smoothstep(0.56, 0.66, band));
          diffuseColor.rgb = pow(diffuseColor.rgb, vec3(uWashGamma));      // deepen the wash
          diffuseColor.rgb *= 1.0 - vein * uVeinAmt;                       // marble drift
          diffuseColor.rgb *= 0.985 + (n1 - 0.5) * 0.05;                   // tonal breath
        }`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        #ifdef USE_COLOR_ALPHA
          roughnessFactor = clamp(roughnessFactor - (1.0 - vColor.a) * uWashGloss
                                  + (ckN2 - 0.5) * uRoughVar, 0.2, 1.0);
        #endif`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        {
          float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.8);
          totalEmissiveRadiance += uHoverTint * (fres * 0.5 + 0.045) * uHover;
        }`);
  };
  m.userData.u = u;
  return m;
}

/* ============================= RELICS ============================= */
const relics = [];   // { slot, spin, mesh, mat, prod, label, home, pos, sBase, sCur, hover, dim, phase, labelBelow }
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);   // GLBs are meshopt-compressed
const ASSET_V = 6;   // bump after every model reconversion — GLBs cache like scripts do

/* minimal top loading bar — fills as the (meshopt) GLBs download, then fades */
const loadbar = document.getElementById('loadbar');
const _loaded = new Array(COLLECTION.products.length).fill(0);
const _total = new Array(COLLECTION.products.length).fill(0);
function updateLoadbar() {
  if (!loadbar) return;
  const l = _loaded.reduce((a, b) => a + b, 0), t = _total.reduce((a, b) => a + b, 0);
  if (t > 0) loadbar.style.width = Math.min(96, (l / t) * 100) + '%';
}

Promise.all(COLLECTION.products.map((p, i) => new Promise((res, rej) =>
  loader.load(p.file + '?v=' + ASSET_V, res,
    (e) => { if (e.lengthComputable) { _loaded[i] = e.loaded; _total[i] = e.total; updateLoadbar(); } },
    rej)
))).then(gltfs => {
  if (loadbar) { loadbar.style.width = '100%'; loadbar.classList.add('done'); }
  gltfs.forEach((gltf, i) => {
    const prod = COLLECTION.products[i];
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    // on-screen height = object-space Z extent (the face rotation maps z → vertical);
    // wide plaques (wings) are much shorter than their max-dim — placards anchor to this
    const halfHgt = Math.max(0.15, (geo.boundingBox.max.z - geo.boundingBox.min.z) / 2);

    const mat = makeStoneWash(COLLECTION.finish);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.idx = i;

    const face = new THREE.Group();                 // relief faces the camera
    face.rotation.x = Math.PI / 2;
    face.add(mesh);

    const spin = new THREE.Group();                 // bob/tumble/hover pose
    spin.rotation.x = (Math.random() - 0.5) * 0.1;
    spin.rotation.y = (Math.random() - 0.5) * 0.14;
    spin.add(face);

    const slot = new THREE.Group();
    slot.add(spin);
    scene.add(slot);

    const label = document.createElement('div');
    label.className = 'placard';
    label.innerHTML =
      `<div class="p-head"><span class="nm">${prod.name}</span>` +
      `<span class="lnk"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2">` +
      `<path d="M1.5 8.5 8.5 1.5 M3 1.5 H8.5 V7"/></svg></span></div>` +
      `<span class="dt">${prod.date}</span>`;
    label.addEventListener('click', () => navigate(i));
    // gliding from the piece down onto its placard keeps it presented + clickable
    label.addEventListener('pointerenter', () => { labelHold = i; });
    label.addEventListener('pointerleave', () => { if (labelHold === i) labelHold = -1; });
    labelLayer.appendChild(label);

    relics.push({
      slot, spin, mesh, mat, prod, label, halfHgt,
      home: new THREE.Vector3(), pos: new THREE.Vector3(),
      baseTilt: { x: spin.rotation.x, y: spin.rotation.y },
      sBase: 1, sCur: 1, hover: 0, dim: 0,
      phase: Math.random() * Math.PI * 2,
      labelBelow: true,
      bornAt: Infinity,          // entrance start time, set once everything is ready
    });
  });

  layout();
  renderer.compile(scene, camera);
  // staggered entrance: each piece fades + rises in (driven inside step —
  // it's the same per-frame opacity/scale write the focus-dim already does)
  const t0 = perfNow() * 0.001 + 0.1;
  relics.forEach((r, i) => { r.bornAt = t0 + i * 0.14; });
  renderOnce(perfNow() * 0.001);
  requestAnimationFrame(tick);
}).catch(err => { console.error('GLB load failed', err); showFallback(); });

/* ============================= LAYOUT ============================= */
let halfW = 1, halfH = 1, portrait = false, coarse = false;
let lastGlW = 0, lastGlH = 0, lastPostedH = 0;
function layout() {
  const w = stage.clientWidth || innerWidth || 1200;
  // width first — innerHeight lies inside iOS iframes (they expand to content),
  // so a phone can read as "landscape" by aspect; aspect still catches narrow
  // desktop windows and portrait tablets
  portrait = w > 0 && (w < 700 || (w / Math.max(innerHeight, 1)) < 0.9);

  /* portrait: pixel-measured column — masthead height + N × (piece + placard).
     Width/content-driven only (never innerHeight), so the stage is exactly as
     tall as the collection needs: no dead band up top, no cut-off last piece,
     and an auto-resizing parent iframe can't feedback-loop. */
  const col = { pieceH: Math.round(w * 0.66), placardH: 106, gap: 34, topPad: 0 };
  if (portrait) {
    const mast = document.getElementById('masthead');
    const mastBottom = (mast.offsetTop + mast.offsetHeight) || Math.round(w * 0.95);
    col.topPad = mastBottom + 48;
    const want = col.topPad + relics.length * (col.pieceH + col.placardH + col.gap) + 72;
    if (Math.abs(stage.clientHeight - want) > 6) stage.style.height = want + 'px';
  } else if (stage.style.height) {
    stage.style.height = '';
  }
  // let a WordPress embed grow its iframe to fit the column (only when it changes —
  // re-posting on every layout ping-pongs with the growing iframe)
  const postH = stage.clientHeight || innerHeight;
  if (window.parent !== window && postH !== lastPostedH) {
    lastPostedH = postH;
    try { parent.postMessage({ ckd: 'height', h: postH }, '*'); } catch (_) {}
  }

  const h = stage.clientHeight || innerHeight || 800;
  // resize the GL surface only when dimensions actually changed — every setSize
  // reallocates the backing buffer and flashes; the growing mobile iframe fires
  // a burst of resizes during load (that was the "crazy glitch")
  if (w !== lastGlW || h !== lastGlH) {
    lastGlW = w; lastGlH = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  halfH = P.camDist * Math.tan(THREE.MathUtils.degToRad(P.fov / 2));
  halfW = halfH * camera.aspect;

  coarse = matchMedia('(pointer:coarse)').matches;
  const camHome = new THREE.Vector3(0, 0, P.camDist);
  const pxToWorld = 2 * halfH / h;
  relics.forEach((r, i) => {
    if (portrait) {
      const cyPx = col.topPad + i * (col.pieceH + col.placardH + col.gap) + col.pieceH / 2;
      r.home.set((i % 2 ? 0.045 : -0.045) * halfW, halfH - cyPx * pxToWorld, 0);
      r.sBase = col.pieceH * pxToWorld;              // geometry max-dim 1 ⇒ ≈pieceH px
    } else {
      const sl = COLLECTION.scatterL[i % COLLECTION.scatterL.length];
      const yTop = halfH * (1 - P.topClear * 2);      // menu-bar headroom
      r.home.set(sl.x * halfW * P.spreadX, Math.min(sl.y * halfH * P.spreadY, yTop), sl.z);
      r.sBase = sl.s * P.objScale * Math.min(halfW, halfH);
    }
    r.pos.copy(r.home);
    r.slot.position.copy(r.home);
    r.slot.lookAt(camHome);                            // curator's angle
    const hs = r.prod.hoverScale || P.hover.scale;
    r.sCur = r.sBase * (1 + (hs - 1) * r.hover);
    r.spin.scale.setScalar(r.sCur);
    r.labelBelow = true;
    if (portrait || coarse) r.label.classList.add('on');   // names always visible on mobile
  });

  document.getElementById('hint').innerHTML = coarse
    ? '[ tap each object to find out more ]'
    : '[ click each object to find out more ]';
}
addEventListener('resize', layout);
new ResizeObserver(() => { layout(); renderOnce(perfNow() * 0.001); }).observe(stage);

/* ============================= INPUT ============================= */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2(0, -2);
let hotIdx = -1;
let selected = -1;
let labelHold = -1;                             // pointer resting on a placard
let downX = 0, downY = 0, downIdx = -1, pointerOn = false;
let rotting = false;                            // click-drag inspect in progress
const rotT = { x: 0, y: 0 };                    // target inspect tilt (rad)

function ptrToNdc(e) {
  const rect = canvas.getBoundingClientRect();
  let { left, top, width: w, height: h } = rect;
  if (!w || !h) {              // hidden/throttled tab reports 0×0
    const dpr = renderer.getPixelRatio();
    left = 0; top = 0; w = canvas.width / dpr; h = canvas.height / dpr;
  }
  ndc.x = ((e.clientX - left) / w) * 2 - 1;
  ndc.y = -((e.clientY - top) / h) * 2 + 1;
}

function pickHover() {
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(relics.map(r => r.mesh), false);
  const idx = hits.length ? hits[0].object.userData.idx : -1;
  if (idx !== hotIdx) {
    hotIdx = idx;
    canvas.classList.toggle('is-hot', hotIdx >= 0);
  }
}

canvas.addEventListener('pointermove', (e) => {
  ptrToNdc(e); pointerOn = true;
  if (downIdx >= 0) {                            // click-drag = inspect the piece
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (rotting || Math.hypot(dx, dy) > P.clickPx) {
      rotting = true;
      canvas.classList.add('is-grab');
      rotT.y = THREE.MathUtils.clamp(dx * P.rot.perPx, -1, 1) * P.rot.max;
      rotT.x = THREE.MathUtils.clamp(dy * P.rot.perPx, -1, 1) * P.rot.max;
    }
  }
});
canvas.addEventListener('pointerleave', () => {
  pointerOn = false; ndc.set(0, -2);
  hotIdx = -1;                                   // nothing under a pointer that left
  canvas.classList.remove('is-hot');
});
canvas.addEventListener('pointerdown', (e) => {
  ptrToNdc(e); pointerOn = true;
  pickHover();
  downX = e.clientX; downY = e.clientY; downIdx = hotIdx;
  if (downIdx >= 0) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
});
function endInspect() {
  rotting = false;
  rotT.x = 0; rotT.y = 0;                        // piece eases back to rest
  canvas.classList.remove('is-grab');
}
function clearTouchHover(e) {
  // touch has no hover: a scroll's pointerdown "hovers" whatever was under the
  // finger and nothing ever clears it — one piece stays highlighted, the rest dim
  if (e.pointerType !== 'mouse') {
    hotIdx = -1; pointerOn = false; ndc.set(0, -2);
    canvas.classList.remove('is-hot');
  }
}
canvas.addEventListener('pointerup', (e) => {
  const still = Math.hypot(e.clientX - downX, e.clientY - downY) <= P.clickPx;
  const idx = downIdx;
  downIdx = -1;
  endInspect();
  clearTouchHover(e);
  if (still && idx >= 0) activate(idx);          // a drag never navigates
  else if (still && idx < 0) selected = -1;
});
canvas.addEventListener('pointercancel', (e) => { downIdx = -1; endInspect(); clearTouchHover(e); });

function activate(i) {
  navigate(i);                                   // one tap or click opens the piece
}

function navigate(i) {
  const r = relics[i];
  if (!r || !r.prod.url) return;
  flash.classList.add('go');
  setTimeout(() => {
    try { window.top.location.href = r.prod.url; }
    catch (_) { window.location.href = r.prod.url; }
  }, 430);
}

/* ============================= MOTION ============================= */
const perfNow = () => performance.now();
let last = perfNow();
const camCur = { yaw: 0, pitch: 0 };
const V2 = new THREE.Vector3();

function step(t, dt) {
  // camera: whisper of an orbit (pointer parallax / idle drift)
  const idle = !pointerOn && !REDUCE;
  const targetYaw = REDUCE ? 0 : (pointerOn ? ndc.x * P.parallax.yaw : (idle ? Math.sin(t * 0.11) * 0.9 : 0));
  const targetPitch = REDUCE ? 0 : (pointerOn ? Math.max(-1, Math.min(1, ndc.y)) * P.parallax.pitch : (idle ? Math.cos(t * 0.08) * 0.6 : 0));
  const kc = 1 - Math.exp(-2.4 * dt);
  camCur.yaw += (targetYaw - camCur.yaw) * kc;
  camCur.pitch += (targetPitch - camCur.pitch) * kc;
  const yr = THREE.MathUtils.degToRad(camCur.yaw), pr = THREE.MathUtils.degToRad(camCur.pitch);
  const lookY = portrait ? -(stageScrollCenter()) : 0;
  camera.position.set(Math.sin(yr) * P.camDist, Math.sin(pr) * P.camDist * 0.4, Math.cos(yr) * P.camDist);
  camera.lookAt(0, 0, 0);

  const focus = (downIdx >= 0 && rotting) ? downIdx
              : hotIdx >= 0 ? hotIdx
              : labelHold >= 0 ? labelHold      // pointer parked on the placard
              : selected;

  relics.forEach((r, i) => {
    const kh = 1 - Math.exp(-P.hover.lambda * dt);
    const kd = 1 - Math.exp(-P.dim.lambda * dt);

    // entrance: fade + rise + a turn-to-face-you settle (free — same writes as the dim)
    const ent = REDUCE ? 1 : THREE.MathUtils.clamp((t - r.bornAt) / P.enter.dur, 0, 1);
    const eIn = ent * ent * (3 - 2 * ent);
    const eOut = 1 - eIn;

    // hover / recede targets (no recede in menu mode — phones keep every piece full)
    const menuMode = portrait || coarse;    // cached in layout() — matchMedia every frame is waste
    const want = (focus === i) ? 1 : 0;
    const wantDim = (focus >= 0 && focus !== i && !menuMode) ? 1 : 0;
    r.hover += (want - r.hover) * kh;
    r.dim += (wantDim - r.dim) * kd;
    r.mat.userData.u.uHover.value = r.hover;
    r.mat.opacity = (1 - (1 - P.dim.opacity) * r.dim) * eIn;

    // position: gentle bob only (pieces hold their museum posts)
    const live = REDUCE ? 0 : 1 - r.hover * 0.6;
    r.slot.position.copy(r.pos);
    r.slot.position.y += Math.sin(t * P.bob.speed + r.phase * 2.1) * P.bob.amp * live
      - eOut * P.enter.rise;

    // click-drag inspect: this piece follows the drag (±~15°), others stay put
    const kr = 1 - Math.exp(-P.rot.lambda * dt);
    const inspecting = downIdx === i && rotting;
    r.rotX = (r.rotX || 0) + ((inspecting ? rotT.x : 0) - (r.rotX || 0)) * kr;
    r.rotY = (r.rotY || 0) + ((inspecting ? rotT.y : 0) - (r.rotY || 0)) * kr;

    // pose: calm tumble + a slight presentation tilt on hover + inspect tilt
    const ph = r.phase;
    r.spin.rotation.x = r.baseTilt.x
      + (Math.sin(t * P.tumble.speed + ph) * 0.6 + Math.sin(t * P.tumble.speed * 1.7 + ph * 3.1) * 0.4) * P.tumble.amp * live
      + P.hover.tiltX * r.hover + r.rotX
      + eOut * P.enter.tiltX;
    r.spin.rotation.y = r.baseTilt.y
      + (Math.cos(t * P.tumble.speed * 0.8 + ph * 1.6) * 0.6 + Math.sin(t * P.tumble.speed * 1.3 + ph * 2.2) * 0.4) * P.tumble.amp * live
      + P.hover.tiltY * r.hover + r.rotY
      + eOut * (i % 2 ? -P.enter.tiltY : P.enter.tiltY);

    // scale: slight grow on hover (per-piece override), recede when unfocused
    const hs = r.prod.hoverScale || P.hover.scale;
    const sTarget = r.sBase * (1 + (hs - 1) * r.hover) * (1 - (1 - P.dim.scale) * r.dim);
    r.sCur += (sTarget - r.sCur) * kh;
    r.spin.scale.setScalar(r.sCur * (P.enter.scale + (1 - P.enter.scale) * eIn));

    // placard under the piece
    const show = r.label.classList.contains('on') || r.hover > 0.12;
    if (show) {
      V2.copy(r.slot.position); V2.y -= r.sCur * (r.halfHgt + 0.04);
      V2.project(camera);
      const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
      r.label.style.transform =
        `translate(${((V2.x + 1) / 2 * w).toFixed(1)}px, ${((-V2.y + 1) / 2 * h).toFixed(1)}px) translate(-50%, 14px)`;
    }
    // placards wait for their piece to be mostly in before showing
    const alwaysOn = menuMode && eIn > 0.6;
    r.label.classList.toggle('on', alwaysOn || r.hover > 0.12);
    r.label.style.opacity = alwaysOn && r.dim > 0.02 ? String(1 - r.dim * 0.55) : '';
  });

  if (pointerOn && ndc.y > -1.5) pickHover();
  grade.uniforms.uTime.value = t;
}

function stageScrollCenter() { return 0; }   // reserved for scroll choreography

function renderOnce(t) {
  step(t, 1 / 60);
  composer.render();
}

let frozen = false;

/* render only while actually on screen — /design/ stacks two live WebGL rooms
   and the off-screen one was burning a full GPU frame the whole time you
   looked at the other. IntersectionObserver sees the top-level viewport even
   from inside a cross-origin iframe. */
let onScreen = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    const vis = entries[entries.length - 1].isIntersecting;
    if (vis && !onScreen) { last = perfNow(); renderOnce(perfNow() * 0.001); }
    onScreen = vis;
  }).observe(canvas);
}

function tick() {
  requestAnimationFrame(tick);
  if (frozen || !onScreen) return;
  const now = perfNow();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(now * 0.001, dt);
  composer.render();
}

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => { layout(); renderOnce(perfNow() * 0.001); });

/* back/forward cache restores the page with a dead GL context (blank canvas,
   frozen loop) — a self-reload is instant since every asset is cached */
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

/* ============================= FALLBACK ============================= */
function showFallback() {
  const fb = document.getElementById('fallback');
  document.getElementById('fallbackList').innerHTML = COLLECTION.products.map(p =>
    `<li><a href="${p.url}" target="_top">${p.name} — ${p.date}</a></li>`).join('');
  fb.hidden = false;
}

/* ============================= DEBUG ============================= */
window.__relics = {
  P, COLLECTION, camera, scene,
  get hot() { return hotIdx; },
  get ndc() { return [ndc.x, ndc.y]; },
  layout,
  renderOnce: () => renderOnce(perfNow() * 0.001),
  freeze(v = true) { frozen = v; if (!v) last = perfNow(); },
  hover(i) { hotIdx = i; for (let k = 0; k < 40; k++) renderOnce(perfNow() * 0.001); },
  ptr(x, y) { ndc.set(x, y); pointerOn = true; renderOnce(perfNow() * 0.001); },
  relics,
};
