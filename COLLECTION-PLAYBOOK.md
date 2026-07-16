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

Target ~1.2–1.8 MB per piece (~90k tris). Budget ~8 MB per collection page.

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
- Photos strip: scroll-snap rail, frosted ‹ › buttons + `NN / NN` counter,
  first image eager + high priority, rest lazy.

## Ideas noted for future collections (not yet built)

- Scroll choreography hooks (`stageScrollCenter()` is reserved) — parallax the
  column as the page scrolls on mobile.
- Per-collection finish presets beyond stone-wash (terracotta, bronze,
  black-figure… see git history of v0.1 for the six-finish shader).
- Packaging typeface match (packaging file wasn't in the folder yet — drop it
  in and compare against Cormorant Garamond).
