# CKDesign Collection Pages — Playbook

The reusable system behind the **Gorgon Collection** page. Every collection of
pieces gets one of these modules; this file is the source of truth for how they
look, behave, and get built. Read it top to bottom before building the next one.

---

## Standing design rules (from Clay — apply to EVERY collection)

- **This is a collection module, not a hero.** It sits at the top of a page for
  now, but many of these will exist — one per collection. As the visitor
  scrolls, each collection should feel premium and *distinct*.
- **Differentiate collections** by tweaking, per collection: the backdrop
  (colors/veins/light position), where the masthead text sits, the scatter
  composition, and the finish shader. Same engine, different room.
- **Objects are the grab** — they take up most of the screen, they must look
  PREMIUM. Lighting exists to show off the product.
- **Leave a little room at the top** for the site menu bar (`P.topClear`,
  masthead `top` clamp) — not too much; the objects dominate.
- **No drag physics, no run-from-the-mouse.** Pieces hold their museum posts.
  Interaction = hover (desktop) / tap (touch) and click-through.
- **Hover = premium presentation**: the piece grows *slightly* (≈1.045) and
  rotates *slightly* (a few degrees toward the viewer). Never drastic.
  Pieces whose face reads small (wide plaques like Winged Egypt) get a
  per-product `hoverScale` so every piece meets the same presented size.
- **Click-drag = inspect**: dragging on a piece tilts it up to ~15° in any
  direction and it eases back on release. A drag never navigates.
- **Placard hold**: gliding from the piece down onto its placard keeps the
  piece presented and the placard clickable (`labelHold` + focus chain
  drag → hover → placard → selected).
- **Focus dim**: while one piece is presented, the others recede (opacity
  ≈0.45, scale ≈0.97). (Wireframe ghosting was considered and rejected — a
  70k-tri scan renders as a hairball wireframe.)
- **Placard** (frosted glass, backdrop-blur, hairline border): serif name,
  mono small-caps date/sub, and an arrow-in-square link chip. No "view piece"
  copy — the chip says "link". Anchored to the piece's **measured on-screen
  height** (geometry bbox z-extent), ~24px gap — anchoring to max-dim makes
  wide plaques' placards float far below (the Winged Medusa bug).
- **Bottom-left copy**: `[ click each object to find out more ]`
  (`tap` on touch; hidden on portrait).
- **Bottom-left**: `[ click to find out more ]` (touch: tap wording).
  **Bottom-right**: CKD logo with "clay & kelsy designs" beneath — minimal.
- **Type**: Cormorant Garamond (names, masthead) + **EB Garamond** (tagline —
  Cormorant is too thin for paragraph sizes) + Courier Prime (mono UI).
  Keep the smallest mono ≥10px.
- **Mobile is a first-class experience**: single centered column, pieces
  ~66% width, placard visible under EVERY piece (no hover needed), nothing
  overlapping, hint line hidden (redundant there). **The column is measured
  in PIXELS in `layout()`**: masthead DOM height + N × (pieceH + placardH +
  gap) + clearance → stage height. Never derive it from `innerHeight` (an
  auto-resizing parent iframe feedback-loops) and never from viewport
  fractions (that's what caused v0.2's dead top band + cut-off last piece).
  The page posts its height to the WP embed, which grows the iframe.
- **Portrait detection is WIDTH-FIRST** (`w < 700 || aspect < 0.9`) —
  `innerHeight` lies inside iOS iframes (they expand to content), so a phone
  can read as "landscape" by aspect alone and get the desktop scatter. Width
  catches every phone; aspect still catches narrow desktop windows.
- **Entrance**: pieces fade + rise + **turn to face you** (alternating ±0.5rad
  yaw, easing to rest) with a ~140ms stagger (`P.enter`, 0.95s smoothstep per
  piece, `bornAt` set once assets are ready). Computed inside the existing
  per-frame opacity/scale/rotation writes — zero added cost. Placards wait for
  `eIn > 0.6`; `prefers-reduced-motion` skips it entirely.
- **Touch is not hover**: clear `hotIdx`/glow on any non-mouse `pointerup`/
  `pointercancel` — a scroll's pointerdown "hovers" whatever was under the
  finger and otherwise never releases it (one piece stuck highlighted, rest
  dimmed). Also: **no recede/dim at all in menu mode** (phones keep every
  piece full), and **one tap opens the piece** (no two-tap select).
- **Guard `renderer.setSize` behind a dims-changed check** — every setSize
  reallocates the GL backing buffer (a visible flash); the growing mobile
  iframe fires a burst of resizes during load (the "crazy glitch"). Same for
  the height postMessage: only post when it changed, or it ping-pongs.
- **`pageshow` + `persisted` → `location.reload()`** on every page —
  back/forward cache restores a dead WebGL context (the "back button loads
  nothing" bug). The reload is instant since assets are cached.
- **Resizing across the portrait/landscape boundary must be clean both ways**
  — `layout()` clears `stage.style.height`, placard `.on` classes and inline
  opacity resolve in `step()`; `pointerleave` clears the hovered piece.
- **Finish**: pieces are PLA prints with an acrylic wash + coating. The look is
  light warm gray with the wash pooling dark in crevices and dry-brushed
  highlights on raised detail (see `Gorgan Souther Italy ref Pic.jpg`).

## Files

- `index.html` — masthead (title/tagline/note), label layer, brand corner,
  fallback list. **Bump `?v=N` on styles.css/app.js after every edit.**
- `app.js` — engine. Everything per-collection lives in the `COLLECTION`
  object at the top: `title`, `products[]` (`{id,name,date,url,file}`),
  `backdrop{}` (procedural gallery-wall params), `finish{}` (wash shader),
  `scatterL[]` (landscape composition). Tunables in `P`.
  **`ASSET_V` must be bumped after any model reconversion** — GLBs cache
  exactly like scripts do (the `?v` lesson applies to every fetched asset).
- `styles.css` — placard, masthead, brand corner, portrait media queries.
- `wordpress-embed.html` — full-bleed Custom HTML block; grows the iframe on
  phones via `postMessage({ckd:'height'})`.
- `tools/stl2glb.py`, `tools/convert.sh` (3MF), `tools/mf2glb.py`.

## Model pipeline (STL → web GLB)

```
venv/bin/python tools/stl2glb.py raw "Piece Name.stl" raw.glb --side + [--rot180]
npx -y @gltf-transform/cli optimize raw.glb assets/piece.glb \
  --compress false --texture-compress false \
  --simplify true --simplify-ratio 0.14 --simplify-error 0.001
```

What the tool does (and the scars behind it):

1. **Weld** triangle soup → indexed mesh.
2. **Winding sanity**: negative signed volume = inside-out STL → faces are
   reversed automatically. (All four Gorgon STLs were inverted; without this
   every normal points inward and pieces render as washed-out ghosts.)
3. **Orient**: thinnest axis becomes the relief axis. **No side heuristics** —
   they lie on hollow scan shells. Convert with `--side +`, LOOK at it, re-run
   with `--side -` if it shows its back, add `--rot180` if upside-down.
   (All four Gorgons: `--side + --rot180`.)
4. **Wash bake at FULL resolution** into COLOR_0 (rgb = pooled tone, a =
   proudness); gltf-transform simplify interpolates it through the collapse.
   **Never re-read an optimized GLB with a naive packed reader** — gltf-transform
   interleaves attributes (normals read as positions = exploded confetti).
5. Material (`makeStoneWash`): vertexColors × base, `washGamma` deepens
   crevices, marble drift noise, wash pools slightly glossier
   (`roughWashGloss`), fresnel hover glow. `side: DoubleSide` so hollow shells
   stay solid.

6. **Meshopt-compress** the final GLBs: `npx gltf-transform meshopt in.glb out.glb`
   (lossless geometry, ~62% smaller — 5MB→1.9MB for 4 pieces; masks that
   took 5-7s to download now ~2s, product pages keep full detail). Then
   register the decoder on EVERY app that loads them (collection + all
   product pages — they share `assets/*.glb`, so a missing decoder = broken
   pieces): `import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'`
   + `new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)`. Bump ASSET_V/assetV.

**Loading bar** (collection page): a thin 2px `#loadbar` (pink, no text) driven
by the GLB download progress (`loader.load`'s onProgress, summed loaded/total
across the 4 files), `.done` class fades it out on Promise.all resolve.

Target ~0.4–0.6 MB per meshopt piece. Budget ~2 MB per collection page.

## Verifying in the hidden preview tab

rAF is throttled: drive frames manually via `__relics.renderOnce()`.
`__relics` also exposes `camera/scene/relics/P/COLLECTION`, `hover(i)`,
`ptr(ndcX,ndcY)`, `freeze()`, `layout()`. Synthetic clicks: dispatch
`PointerEvent`s on `#gl` (ptrToNdc falls back to canvas backing size when
`getBoundingClientRect()` reads 0×0). Screenshot after stepping frames.
When browser numbers look impossible, inspect the GLB file directly.

## Deploying a collection

1. Repo per collection page: `gh repo create Clayburton/<name> --source=. --push`
   (pushes private; **Clay flips it public + enables Pages**: Settings → Pages
   → branch `main` `/root`) → `https://clayburton.github.io/<name>/`.
2. Paste `wordpress-embed.html` into a Custom HTML block on clayandkelsy.com.
3. `.gitignore` keeps STL sources / ref photos / notes out of the repo.

## Gorgon Collection (v0.2) — the reference instance

- 4 pieces: Medusa Calabria Italy (2nd–1st BCE), Medusa Baroque Europe (17th
  Century), Winged Medusa Egypt (332–250 BCE), Medusa Southern Italy (500 BCE)
  → product pages under clayandkelsy.com/medusa-*.
- Backdrop: warm paper `#f6f2ea → #e3dccd`, faint marble veins, soft top light.
- Composition: masthead upper-left; pieces lower-left / center / upper-right /
  right; Baroque is the anchor at center.
- Tagline: "The face the ancient world carved to ward off harm — guardian and
  monster by turns, reimagined by every age that inherited her. Impossible to
  look away from."

## Product pages (one per piece — `baroque/` is the reference instance)

Each piece gets a subfolder page (`<repo>/<piece>/` on Pages), embedded on its
WP product page via its own `wordpress-embed.html`. Clone `baroque/` and swap:

- `PIECE` in `app.js` (GLB path + `assetV`, `cartUrl` — null until the
  WooCommerce product exists, then the `?add-to-cart=` link), the copy in
  `index.html` (kicker `[ Gorgon Collection — CK_0NN ]` piece number, title,
  era line, paragraph, price), and the photos.
- **Raw originals never ship.** The pipeline reads a `pictures*/` working
  folder and writes only `<page>/photos/*.jpg` (~500K) + `photos.js`;
  `.gitignore` excludes `pictures*/` so the full-res originals stay local.
  If photos.js changes AFTER first deploy, version its import in app.js
  (`import PHOTOS from './photos.js?v=N'`) so no stale manifest is cached.
- **No photos yet?** Ship with an empty `photos.js` (`const PHOTOS=[]`)
  — app.js hides the whole `#gallery` section when it's empty, so the
  hero flows straight into `#info`. Drop a photos folder + run the
  pipeline later and the gallery reappears. (Calabria shipped this way.)
- **Photos**: drop originals in the piece's working folder, run
  `tools/photos.sh "<folder>/pictures" ../<piece>` — emits ≤1600px JPEGs +
  `photos.js` manifest (src + dims). Re-run to add/update; order = filename.
- Layout: big piece LEFT (anchored to the measured `#pieceSlot` rect, ~92%
  fill), editorial column RIGHT (kicker/title/era/para/price/CTA/micro-line);
  portrait stacks piece-then-copy, carousel below, brand goes logo-only.
- Piece finish: product pages run `washGamma 0.62` (LIGHTER than the
  collection's 1.4 — at 4× magnification the baked wash reads pewter; gamma <1
  lifts it to match the real bone-gray cast in the photos alongside).
- Interactions: drag-inspect ±18° (`P.rot.max 0.32`), soft warm glow while
  held, gentle bob/tumble, parallax. No placard. CTA pulses until `cartUrl`
  is set. Back link bottom-left → the collection page (`target="_top"`).
- **The backdrop canvas is `position:absolute` spanning the whole page —
  NEVER `position:fixed`**: fixed elements misbehave inside iOS iframes
  (every page here ships in a WP iframe) and skip rasterization in hidden
  tabs. World y maps page pixels; the piece scrolls with its slot.
- **Embed iframe height MUST be full `100svh/100dvh` — NEVER `calc(100dvh - Npx)`.** A shorter-than-viewport iframe lets the WordPress site footer peek in under it (the calabria footer bug). Full height fills the screen, keeps the footer well below, and scroll-over-iframe scrolls internally. Clone the embed from a page whose LIVE embed is confirmed working — not from a file that may carry an un-pasted 'improvement'. (baroque's FILE had a -84px version that was never live; cloning the file, not the live block, is what introduced this.)
- **Product-page embeds run TWO modes** (`baroque/wordpress-embed.html`):
  desktop iframe stays viewport-sized (`calc(100dvh - 84px)`) and the page
  scrolls INSIDE it — trackpad momentum never crosses the iframe boundary
  (cross-frame scroll handoff was the "sticky scroll"); phones (≤700px) grow
  the iframe via postMessage because iOS forces iframes to fit content.
  Long-scroll pages must never rely on parent-page scrolling on desktop.
- **svh is only honest when the iframe is viewport-sized.** Desktop embed:
  iframe stays viewport-sized and scrolls internally → svh == real screen, use
  it freely (hero, piece, peek all svh-based). Phone embed: iframe GROWS to
  content → svh there would inflate and feed back into a taller layout, so the
  `max-width:700px` block zeroes the hero `min-height` and sizes the piece by
  vw/px instead. Breakpoints go by `max-width`, never `aspect-ratio` (aspect
  ratio also reads the grown height). Earlier the desktop iframe grew too and
  svh was poison everywhere — the two-mode embed is what made svh safe again.
- **Perf recipe for product pages**: DPR capped at 1.5 (page-tall canvas),
  render loop fully paused while the hero is offscreen (IntersectionObserver),
  piece position cached at layout (page coords are scroll-independent — no
  per-frame rect reads). ~0.2ms/frame; scrolling the gallery costs zero GPU.
- Photos strip: scroll-snap rail (`x proximity`, NEVER mandatory — mandatory
  traps two-finger vertical scrolling over the rail; plus
  `overscroll-behavior-x:contain`), frosted ‹ › buttons + `NN / NN` counter,
  first image eager + high priority, rest lazy.
- `overflow-x: clip` on html/body — `hidden` makes body a scroll container
  and stutters macOS momentum scrolling.
- **Hero sizing — tie the piece to the hero, both svh-based.** The 3D piece
  (`#pieceSlot height: min(56svh, 44vw)`) and the hero (`min-height:
  min(68svh, 58vw)`) share the SAME viewport-height basis, so the piece fills
  the hero instead of floating in it. The classic bug: sizing the piece by
  WIDTH while the hero is by HEIGHT — on a tall monitor they diverge, the piece
  rattles around with big top/bottom gaps, and the extra hero height shoves the
  photos off-screen. Keep the hero tight (≈ piece + small padding) so the
  `[ photographs ]` kicker + frame tops peek above the fold. vw caps only bind
  on ultrawide-short screens. (Verified live: piece fills hero, photos peek
  210–260px at 1440×900 and 1728×1085.)
- **Info section** (`#info`, standard for every piece — copy is shared):
  2×2 editorial grid (1-col portrait), hairline top rules, mono `[ kicker ]`
  + EB Garamond body, pink `·` bullets: the details / care / from the makers /
  shipping & returns.
- **Outro** (`#outro`): centered closing block above the footer corners —
  hairline rule, serif name, mono **`$price` only, then the second
  add-to-cart**. NO CK number here (it lives once in the hero kicker
  `[ Gorgon Collection — CK_0NN ]`; repeating it above the button reads messy).
- **CTA = solid-ink button, mono brackets, NO arrow chip** (the chip was
  redundant next to the brackets — removed). Ink→pink hover, lifts 1px. Both
  buttons share `.cart-link`; JS sets `href` + `target="_top"` from
  `PIECE.cartUrl` (baroque = WooCommerce id **6385**, verified live).

## Ideas noted for future collections (not yet built)

- Scroll choreography hooks (`stageScrollCenter()` is reserved) — parallax the
  column as the page scrolls on mobile.
- Per-collection finish presets beyond stone-wash (terracotta, bronze,
  black-figure… see git history of v0.1 for the six-finish shader).
- Packaging typeface match (packaging file wasn't in the folder yet — drop it
  in and compare against Cormorant Garamond).
