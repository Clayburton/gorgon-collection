/* CKDesign — shop banner ("Shop Clay & Kelsy Designs").
   A compact strip for the home page: three relics (one per collection) floating
   on the gallery wall beside the type. The whole banner is one link to /design/.
   Trimmed from the collection engine — no placards, no drag-inspect, no
   per-piece navigation. Everything here is tuned to load FAST:
     · relics are hard-simplified (50–130KB each, ~275KB total)
     · the wall is procedural (no texture download)
     · the render loop sleeps whenever the banner is off-screen
   See COLLECTION-PLAYBOOK.md for the shared invariants. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ============================ CONTENT ============================ */
const PIECES = [
  { file: 'assets/medusa.glb' },   // Gorgon Collection
  { file: 'assets/hero.glb'   },   // The Odyssey
  { file: 'assets/vessel.glb', flip: true },   // The Eleusinian Mysteries
];
const ASSET_V = 1;

const P = {
  fov: 24, camDist: 10,
  objScale: 0.74,
  spreadX: 0.80, spreadY: 0.74,
  /* landscape: a row on the RIGHT, beside the type block */
  rowL: [
    { x:-0.16, y: 0.02, s: 1.00 },
    { x: 0.41, y: 0.02, s: 0.94 },
    { x: 0.98, y: 0.02, s: 0.94 },
  ],
  /* portrait: a small row ACROSS THE TOP, copy sits beneath it */
  rowP: [
    { x:-0.62, y: 0.50, s: 0.70 },
    { x: 0.00, y: 0.50, s: 0.66 },
    { x: 0.62, y: 0.50, s: 0.66 },
  ],
  parallax: { yaw: 1.6, pitch: 1.1 },
  bob:    { amp: 0.045, speed: 0.42 },
  tumble: { amp: 0.045, speed: 0.3 },
  hover:  { scale: 1.05, lambda: 5 },     // whole-banner hover presents all three
  light:  { key: 1.42, fill: 0.5, rim: 1.05, env: 0.5, exposure: 1.0 },
  grade:  { grain: 0.024, vignette: 0.12, contrast: 1.04, centerLight: 0.045 },
  backdrop: { center:'#f6f2ea', edge:'#e3dccd', vein:'#b9b0a0', veinAmount:0.16,
              grain:9, seed:7, lightX:0.5, lightY:0.34 },
  finish: { base:0xefede7, washGamma:1.1, rough:0.62, roughWashGloss:0.16,
            roughVar:0.10, clearcoat:0.06, sheen:0.22, sheenColor:0xf2ede2,
            veinAmount:0.10, veinScale:2.6, env:0.5, hoverTint:0xfff3e4 },
};

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage  = document.getElementById('stage');
const canvas = document.getElementById('gl');
const flash  = document.getElementById('flash');

/* ============================ RENDERER ============================ */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { console.error(e); throw e; }   // no WebGL → the CSS wall + type still read fine
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = P.light.exposure;

const scene = new THREE.Scene();

/* ---- procedural gallery wall (generated once, nothing downloaded) ---- */
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
  x.save(); x.filter = 'blur(22px)'; x.strokeStyle = cfg.vein;
  for (let i = 0; i < 15; i++) {
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
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * cfg.grain;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeBackdrop(P.backdrop);

const camera = new THREE.PerspectiveCamera(P.fov, 1, 0.1, 60);
camera.position.set(0, 0, P.camDist);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = P.light.env;

const key = new THREE.DirectionalLight(0xfff0dd, P.light.key);   key.position.set(2.6, 3.4, 5.2);  scene.add(key);
const fill = new THREE.DirectionalLight(0xdde6f4, P.light.fill); fill.position.set(-4.2, 0.6, 3);  scene.add(fill);
const rim = new THREE.DirectionalLight(0xeef4ff, P.light.rim);   rim.position.set(-1.2, 5.2, -4.5); scene.add(rim);

/* ==================== stone / acrylic-wash material ==================== */
function makeStoneWash(f) {
  const m = new THREE.MeshPhysicalMaterial({
    color: f.base, vertexColors: true,
    roughness: f.rough, metalness: 0,
    clearcoat: f.clearcoat, clearcoatRoughness: 0.5,
    sheen: f.sheen, sheenColor: new THREE.Color(f.sheenColor), sheenRoughness: 0.65,
    envMapIntensity: f.env,
    side: THREE.DoubleSide,
  });
  const u = {
    uVeinAmt:{value:f.veinAmount}, uVeinScale:{value:f.veinScale},
    uWashGamma:{value:f.washGamma}, uWashGloss:{value:f.roughWashGloss},
    uRoughVar:{value:f.roughVar}, uSeed:{value:Math.random()*43},
    uHover:{value:0}, uHoverTint:{value:new THREE.Color(f.hoverTint)},
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
          diffuseColor.rgb = pow(diffuseColor.rgb, vec3(uWashGamma));
          diffuseColor.rgb *= 1.0 - vein * uVeinAmt;
          diffuseColor.rgb *= 0.985 + (n1 - 0.5) * 0.05;
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
const relics = [];
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

Promise.all(PIECES.map((p) => new Promise((res, rej) =>
  loader.load(p.file + '?v=' + ASSET_V, res, undefined, rej)
))).then(gltfs => {
  gltfs.forEach((gltf, i) => {
    const cfg = PIECES[i];
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    if (cfg.flip) geo.rotateY(Math.PI);   // scan is upside-down (matches the rooms)
    geo.computeBoundingSphere();

    const mat  = makeStoneWash(P.finish);
    const mesh = new THREE.Mesh(geo, mat);

    const face = new THREE.Group();         // relief turns to face the camera
    face.rotation.x = Math.PI / 2;
    face.add(mesh);

    const spin = new THREE.Group();
    spin.rotation.x = (Math.random() - 0.5) * 0.1;
    spin.rotation.y = (Math.random() - 0.5) * 0.14;
    spin.add(face);

    const slot = new THREE.Group();
    slot.add(spin);
    scene.add(slot);

    relics.push({
      slot, spin, mesh, mat,
      home: new THREE.Vector3(), sBase: 1, sCur: 1,
      phase: Math.random() * Math.PI * 2,
    });
  });

  layout();
  renderer.compile(scene, camera);
  renderOnce(perfNow() * 0.001);
  requestAnimationFrame(tick);
}).catch(err => console.error('relic load failed', err));   // CSS wall + type still stand

/* ============================= LAYOUT ============================= */
let halfW = 1, halfH = 1, portrait = false;
let lastW = 0, lastH = 0;

function layout() {
  const w = stage.clientWidth || innerWidth || 1200;
  const h = stage.clientHeight || innerHeight || 520;
  portrait = w < 700 || (w / Math.max(h, 1)) < 1.25;

  if (w !== lastW || h !== lastH) {
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  halfH = P.camDist * Math.tan(THREE.MathUtils.degToRad(P.fov / 2));
  halfW = halfH * camera.aspect;

  const camHome = new THREE.Vector3(0, 0, P.camDist);
  const row = portrait ? P.rowP : P.rowL;
  relics.forEach((r, i) => {
    const sl = row[i % row.length];
    r.home.set(sl.x * halfW * P.spreadX, sl.y * halfH * P.spreadY, 0);
    r.sBase = sl.s * P.objScale * Math.min(halfW, halfH);
    r.slot.position.copy(r.home);
    r.slot.lookAt(camHome);
    r.sCur = r.sBase;
    r.spin.scale.setScalar(r.sCur);
  });
}
addEventListener('resize', layout);
new ResizeObserver(() => { layout(); renderOnce(perfNow() * 0.001); }).observe(stage);
// re-measure once the web fonts land (they change the type block, not the row,
// but keeps the canvas honest if the banner box shifts)
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); renderOnce(perfNow() * 0.001); });

/* ============================= INPUT ============================= */
const ndc = new THREE.Vector2(0, -2);
let pointerOn = false, hot = 0;

stage.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  let { left, top, width: w, height: h } = rect;
  if (!w || !h) { const dpr = renderer.getPixelRatio(); left = 0; top = 0; w = canvas.width / dpr; h = canvas.height / dpr; }
  ndc.x = ((e.clientX - left) / w) * 2 - 1;
  ndc.y = -((e.clientY - top) / h) * 2 + 1;
  pointerOn = true;
});
stage.addEventListener('pointerenter', () => { hot = 1; });
stage.addEventListener('pointerleave', () => { hot = 0; pointerOn = false; ndc.set(0, -2); });

/* click → fade the whole page white, then enter the shop */
stage.addEventListener('click', (e) => {
  e.preventDefault();
  flash.classList.add('go');
  if (window.parent !== window) { try { parent.postMessage({ ckd: 'flash' }, '*'); } catch (_) {} }
  setTimeout(() => {
    try { window.top.location.href = stage.href; }
    catch (_) { window.location.href = stage.href; }
  }, 300);
});

/* ============================= MOTION ============================= */
const perfNow = () => performance.now();
let last = perfNow();
const camCur = { yaw: 0, pitch: 0 };

function step(t, dt) {
  const idle = !pointerOn && !REDUCE;
  const ty = REDUCE ? 0 : (pointerOn ? ndc.x * P.parallax.yaw : (idle ? Math.sin(t * 0.11) * 0.7 : 0));
  const tp = REDUCE ? 0 : (pointerOn ? Math.max(-1, Math.min(1, ndc.y)) * P.parallax.pitch : (idle ? Math.cos(t * 0.08) * 0.45 : 0));
  const kc = 1 - Math.exp(-2.4 * dt);
  camCur.yaw   += (ty - camCur.yaw) * kc;
  camCur.pitch += (tp - camCur.pitch) * kc;
  const yr = THREE.MathUtils.degToRad(camCur.yaw);
  camera.position.set(Math.sin(yr) * P.camDist,
                      Math.sin(THREE.MathUtils.degToRad(camCur.pitch)) * P.camDist * 0.4,
                      Math.cos(yr) * P.camDist);
  camera.lookAt(0, 0, 0);

  const kh = 1 - Math.exp(-P.hover.lambda * dt);
  const live = REDUCE ? 0 : 1;

  relics.forEach((r) => {
    // whole-banner hover presents all three together
    const u = r.mat.userData.u.uHover;
    u.value += ((hot ? 0.5 : 0) - u.value) * kh;

    r.slot.position.copy(r.home);
    r.slot.position.y += Math.sin(t * P.bob.speed + r.phase * 2.1) * P.bob.amp * live;

    const ph = r.phase;
    r.spin.rotation.x = (Math.sin(t * P.tumble.speed + ph) * 0.6 + Math.sin(t * P.tumble.speed * 1.7 + ph * 3.1) * 0.4) * P.tumble.amp * live;
    r.spin.rotation.y = (Math.cos(t * P.tumble.speed * 0.8 + ph * 1.6) * 0.6 + Math.sin(t * P.tumble.speed * 1.3 + ph * 2.2) * 0.4) * P.tumble.amp * live;

    const sTarget = r.sBase * (1 + (P.hover.scale - 1) * (hot ? 1 : 0));
    r.sCur += (sTarget - r.sCur) * kh;
    r.spin.scale.setScalar(r.sCur);
  });
}

function renderOnce(t) { step(t, 1 / 60); renderer.render(scene, camera); }

/* render only while the banner is on screen — a home page stacks several live
   blocks, and an off-screen one must cost nothing */
let onScreen = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    const vis = entries[entries.length - 1].isIntersecting;
    if (vis && !onScreen) { last = perfNow(); renderOnce(perfNow() * 0.001); }
    onScreen = vis;
  }, { rootMargin: '400px 0px' }).observe(canvas);
}

function tick() {
  requestAnimationFrame(tick);
  if (!onScreen) return;
  const now = perfNow();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(now * 0.001, dt);
  renderer.render(scene, camera);
}

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => { layout(); renderOnce(perfNow() * 0.001); });

/* bfcache restores the page as it was left — clear the flash, and reload if the
   GL context came back dead (a dead context can never repaint) */
addEventListener('pageshow', (e) => {
  flash.style.transition = 'none';
  flash.classList.remove('go');
  setTimeout(() => { flash.style.transition = ''; }, 120);
  if (e.persisted) {
    const gl = renderer.getContext();
    if (gl && gl.isContextLost && gl.isContextLost()) location.reload();
    else { layout(); renderOnce(perfNow() * 0.001); }
  }
});

/* ============================= DEBUG ============================= */
window.__shop = { P, camera, scene, relics, layout, renderOnce: () => renderOnce(perfNow() * 0.001) };
