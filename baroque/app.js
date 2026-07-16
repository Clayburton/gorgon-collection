/* CKDesign — product page: Medusa, Baroque Europe (CK_007).
   The piece floats on the fixed gallery wall, anchored to #pieceSlot (so it
   scrolls with the hero while the paper stays). Drag = inspect (~18°).
   Shares the collection's backdrop + stone-wash look. See COLLECTION-PLAYBOOK.md. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import PHOTOS from './photos.js';

const PIECE = {
  file: '../assets/baroque.glb', assetV: 5,
  cartUrl: null,               // set to the WooCommerce ?add-to-cart= link when live
};

const P = {
  fov: 24, camDist: 10,
  fill: 0.92,                  // piece size within its slot
  parallax: { yaw: 2.0, pitch: 1.4 },
  bob:      { amp: 0.045, speed: 0.4 },
  tumble:   { amp: 0.05, speed: 0.3 },
  rot:      { max: 0.32, perPx: 1 / 200, lambda: 9 },   // drag-inspect (~18°)
  light:    { key: 1.35, fill: 0.5, rim: 0.85, env: 0.5, exposure: 1.0 },
  grade:    { grain: 0.026, vignette: 0.26, contrast: 1.028, centerLight: 0.05 },
  backdrop: { center:'#f6f2ea', edge:'#e3dccd', vein:'#b9b0a0', veinAmount:0.16,
              grain:9, seed:7, lightX:0.5, lightY:0.38 },
  /* lighter than the collection tuning — at 4× magnification the wash reads
     heavy, and the piece sits right above photos of the real bone-gray cast */
  finish:   { base:0xf3f1ec, washGamma:0.62, rough:0.66, roughWashGloss:0.12,
              roughVar:0.08, clearcoat:0.04, sheen:0.24, sheenColor:0xf6f1e6,
              veinAmount:0.08, veinScale:2.6, env:0.55, hoverTint:0xfff3e4 },
};

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('gl');
const slotEl = document.getElementById('pieceSlot');

/* ============================= RENDERER ============================= */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { console.error(e); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));   // page-tall canvas: 1.5 keeps it crisp AND snappy
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = P.light.exposure;

const scene = new THREE.Scene();

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

const key = new THREE.DirectionalLight(0xfff0dd, P.light.key);
key.position.set(2.6, 3.4, 5.2);
scene.add(key);
const fill = new THREE.DirectionalLight(0xdde6f4, P.light.fill);
fill.position.set(-4.2, 0.6, 3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xeef4ff, P.light.rim);
rim.position.set(-1.2, 5.2, -4.5);
scene.add(rim);

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
    uVeinAmt: { value: f.veinAmount },
    uVeinScale: { value: f.veinScale },
    uWashGamma: { value: f.washGamma },
    uWashGloss: { value: f.roughWashGloss },
    uRoughVar: { value: f.roughVar },
    uSeed: { value: 17.3 },
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

/* ============================= THE PIECE ============================= */
const piece = {
  slot: new THREE.Group(), spin: new THREE.Group(),
  mesh: null, mat: null, halfHgt: 0.47,
  sCur: 1, hover: 0, rotX: 0, rotY: 0,
};
piece.slot.add(piece.spin);
scene.add(piece.slot);

new GLTFLoader().load(PIECE.file + '?v=' + PIECE.assetV, (gltf) => {
  let src = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
  const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  piece.halfHgt = (geo.boundingBox.max.z - geo.boundingBox.min.z) / 2;

  piece.mat = makeStoneWash(P.finish);
  piece.mesh = new THREE.Mesh(geo, piece.mat);

  const face = new THREE.Group();
  face.rotation.x = Math.PI / 2;
  face.add(piece.mesh);
  piece.spin.add(face);

  layout();
  renderer.compile(scene, camera);
  renderOnce(0);
  requestAnimationFrame(tick);
}, undefined, (err) => console.error('GLB load failed', err));

/* ============================= LAYOUT ============================= */
/* the canvas spans the WHOLE page; world y maps page pixels, so the piece
   sits at its slot's page position and scrolls naturally with the content */
let halfW = 1, halfH = 1, pageW = 1280, pageH = 720;
let slotCache = { cx: 0.3, cy: 0.25, size: 400 };   // page fractions fallback

function layout() {
  pageW = innerWidth || 1280;
  pageH = Math.max(document.body.scrollHeight, innerHeight || 720);
  renderer.setSize(pageW, pageH, false);
  composer.setSize(pageW, pageH);
  camera.aspect = pageW / pageH;
  camera.updateProjectionMatrix();
  halfH = P.camDist * Math.tan(THREE.MathUtils.degToRad(P.fov / 2));
  halfW = halfH * camera.aspect;
  placePiece();
  broadcastHeight();
}

function placePiece() {
  // slot position in PAGE coords is scroll-independent — computed only on layout
  const r = slotEl.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    slotCache = { cx: (r.left + r.width / 2) / pageW,
                  cy: (r.top + scrollY + r.height / 2) / pageH,
                  size: Math.min(r.width, r.height) };
  }
  const pxToWorld = 2 * halfH / pageH;
  piece.baseX = (slotCache.cx - 0.5) * pageW * pxToWorld;
  piece.baseY = (0.5 - slotCache.cy) * pageH * pxToWorld;
  piece.slot.position.set(piece.baseX, piece.baseY, 0);
  piece.sCur = slotCache.size * P.fill * pxToWorld;
  piece.spin.scale.setScalar(piece.sCur);
}

/* render only while the piece is on screen — scrolling the gallery costs nothing */
let heroVisible = true;
new IntersectionObserver((entries) => {
  const was = heroVisible;
  heroVisible = entries[0].isIntersecting;
  if (heroVisible && !was) { last = perfNow(); renderOnce(perfNow() * 0.001); }
}, { rootMargin: '15% 0px' }).observe(document.getElementById('hero'));

addEventListener('resize', layout);
new ResizeObserver(() => { layout(); renderOnce(perfNow() * 0.001); }).observe(document.body);

function broadcastHeight() {
  if (window.parent === window) return;
  try { parent.postMessage({ ckd: 'height', h: document.documentElement.scrollHeight }, '*'); } catch (_) {}
}

/* ============================= INPUT ============================= */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2(0, -2);
let pointerOn = false, hot = false;
let downX = 0, downY = 0, isDown = false, rotting = false;
const rotT = { x: 0, y: 0 };

function ptrToNdc(e) {
  // canvas spans the whole page — map pointer to PAGE coordinates
  ndc.x = ((e.clientX) / pageW) * 2 - 1;
  ndc.y = -((e.clientY + scrollY) / pageH) * 2 + 1;
}
function pick() {
  if (!piece.mesh) return false;
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(piece.mesh, false).length > 0;
}

canvas.addEventListener('pointermove', (e) => {
  ptrToNdc(e); pointerOn = true;
  if (isDown) {
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (rotting || Math.hypot(dx, dy) > 6) {
      rotting = true;
      canvas.classList.add('is-grab');
      rotT.y = THREE.MathUtils.clamp(dx * P.rot.perPx, -1, 1) * P.rot.max;
      rotT.x = THREE.MathUtils.clamp(dy * P.rot.perPx, -1, 1) * P.rot.max;
    }
  }
});
canvas.addEventListener('pointerleave', () => {
  pointerOn = false; hot = false; ndc.set(0, -2);
  canvas.classList.remove('is-hot');
});
canvas.addEventListener('pointerdown', (e) => {
  ptrToNdc(e); pointerOn = true;
  if (pick()) {
    isDown = true; downX = e.clientX; downY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
});
function endInspect() {
  isDown = false; rotting = false;
  rotT.x = 0; rotT.y = 0;
  canvas.classList.remove('is-grab');
}
canvas.addEventListener('pointerup', endInspect);
canvas.addEventListener('pointercancel', endInspect);

/* cart button — no product link yet: a soft acknowledging pulse */
const cart = document.getElementById('cart');
cart.addEventListener('click', (e) => {
  if (!PIECE.cartUrl) {
    e.preventDefault();
    cart.classList.remove('pulse'); void cart.offsetWidth;
    cart.classList.add('pulse');
  }
});
if (PIECE.cartUrl) cart.href = PIECE.cartUrl;

/* ============================= MOTION ============================= */
const perfNow = () => performance.now();
let last = perfNow();
const camCur = { yaw: 0, pitch: 0 };

function step(t, dt) {
  const idle = !pointerOn && !REDUCE;
  const ty = REDUCE ? 0 : (pointerOn ? ndc.x * P.parallax.yaw : (idle ? Math.sin(t * 0.11) * 0.8 : 0));
  const tp = REDUCE ? 0 : (pointerOn ? Math.max(-1, Math.min(1, ndc.y)) * P.parallax.pitch : (idle ? Math.cos(t * 0.08) * 0.5 : 0));
  const kc = 1 - Math.exp(-2.4 * dt);
  camCur.yaw += (ty - camCur.yaw) * kc;
  camCur.pitch += (tp - camCur.pitch) * kc;
  const yr = THREE.MathUtils.degToRad(camCur.yaw);
  camera.position.set(Math.sin(yr) * P.camDist,
                      Math.sin(THREE.MathUtils.degToRad(camCur.pitch)) * P.camDist * 0.4,
                      Math.cos(yr) * P.camDist);
  camera.lookAt(0, 0, 0);

  const live = REDUCE ? 0 : 1;
  piece.slot.position.set(piece.baseX || 0,
    (piece.baseY || 0) + Math.sin(t * P.bob.speed) * P.bob.amp * live, 0);

  const kr = 1 - Math.exp(-P.rot.lambda * dt);
  piece.rotX += ((rotting ? rotT.x : 0) - piece.rotX) * kr;
  piece.rotY += ((rotting ? rotT.y : 0) - piece.rotY) * kr;
  piece.spin.rotation.x =
    (Math.sin(t * P.tumble.speed) * 0.6 + Math.sin(t * P.tumble.speed * 1.7) * 0.4) * P.tumble.amp * live
    + piece.rotX;
  piece.spin.rotation.y =
    (Math.cos(t * P.tumble.speed * 0.8) * 0.6 + Math.sin(t * P.tumble.speed * 1.3) * 0.4) * P.tumble.amp * live
    + piece.rotY;

  if (piece.mat) {
    const wantHot = pointerOn && ndc.y > -1.5 ? pick() : false;
    if (wantHot !== hot) { hot = wantHot; canvas.classList.toggle('is-hot', hot); }
    const u = piece.mat.userData.u.uHover;
    u.value += (((hot || rotting) ? 0.55 : 0) - u.value) * (1 - Math.exp(-7 * dt));
  }

  grade.uniforms.uTime.value = t;
}

function renderOnce(t) { step(t, 1 / 60); composer.render(); }

let frozen = false;
function tick() {
  requestAnimationFrame(tick);
  if (frozen || !heroVisible) return;    // piece offscreen → zero GPU work
  const now = perfNow();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  step(now * 0.001, dt);
  composer.render();
}

canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => { layout(); renderOnce(perfNow() * 0.001); });

/* ============================= GALLERY ============================= */
const rail = document.getElementById('rail');
const count = document.getElementById('gCount');
PHOTOS.forEach((p, i) => {
  const fig = document.createElement('figure');
  fig.style.aspectRatio = `${p.w} / ${p.h}`;
  const img = document.createElement('img');
  img.src = p.src;
  img.alt = `Medusa, Baroque Europe — photograph ${i + 1}`;
  img.loading = i === 0 ? 'eager' : 'lazy';
  img.decoding = 'async';
  if (i === 0) img.fetchPriority = 'high';
  img.addEventListener('load', broadcastHeight);
  fig.appendChild(img);
  rail.appendChild(fig);
});

const figs = [...rail.children];
function railIndex() {
  const mid = rail.scrollLeft + rail.clientWidth / 2;
  let best = 0, bd = 1e9;
  figs.forEach((f, i) => {
    const c = f.offsetLeft + f.offsetWidth / 2;
    if (Math.abs(c - mid) < bd) { bd = Math.abs(c - mid); best = i; }
  });
  return best;
}
function updateCount() {
  count.textContent = String(railIndex() + 1).padStart(2, '0') + ' / ' + String(figs.length).padStart(2, '0');
}
rail.addEventListener('scroll', () => requestAnimationFrame(updateCount), { passive: true });
updateCount();

function go(dir) {
  const i = THREE.MathUtils.clamp(railIndex() + dir, 0, figs.length - 1);
  const f = figs[i];
  rail.scrollTo({ left: f.offsetLeft + f.offsetWidth / 2 - rail.clientWidth / 2, behavior: 'smooth' });
}
document.getElementById('gPrev').addEventListener('click', () => go(-1));
document.getElementById('gNext').addEventListener('click', () => go(1));

/* desktop drag-to-scroll */
let railDown = false, railStartX = 0, railStartScroll = 0, railMoved = false;
rail.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return;          // touch scrolls natively
  railDown = true; railMoved = false;
  railStartX = e.clientX; railStartScroll = rail.scrollLeft;
});
addEventListener('pointermove', (e) => {
  if (!railDown) return;
  const dx = e.clientX - railStartX;
  if (Math.abs(dx) > 4) { railMoved = true; rail.classList.add('dragging'); }
  rail.scrollLeft = railStartScroll - dx;
});
addEventListener('pointerup', () => {
  if (railDown && railMoved) rail.classList.remove('dragging');
  railDown = false;
});

/* ============================= DEBUG ============================= */
window.__piece = {
  P, camera, scene, piece,
  renderOnce: () => renderOnce(perfNow() * 0.001),
  freeze(v = true) { frozen = v; if (!v) last = perfNow(); },
  layout,
};
