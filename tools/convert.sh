#!/bin/zsh
# 3MF (Bambu/Prusa project or plain) -> web-ready GLB for the relic gallery.
#   ./convert.sh "path/to/Mask.3mf" ../assets/mask.glb
# Needs: python3 venv with numpy (see below), node/npx (gltf-transform fetched on the fly).
#
# One-time venv:  python3 -m venv ~/.mf2glb-venv && ~/.mf2glb-venv/bin/pip install numpy
set -e
SRC="$1"; DST="$2"
[ -z "$SRC" ] || [ -z "$DST" ] && { echo "usage: convert.sh in.3mf out.glb"; exit 1; }
PY="${MF2GLB_PY:-$HOME/.mf2glb-venv/bin/python}"
TMP="$(mktemp -d)"
unzip -o -q "$SRC" -d "$TMP"
# Bambu keeps the mesh in 3D/Objects/*.model; plain 3MF in 3D/3dmodel.model
MODEL="$(ls "$TMP"/3D/Objects/*.model 2>/dev/null | head -1)"
[ -z "$MODEL" ] && MODEL="$TMP/3D/3dmodel.model"
"$PY" "$(dirname "$0")/mf2glb.py" "$MODEL" "$TMP/raw.glb" 1.0
# ~70k triangles, welded + pruned; plenty of detail at product-display size
npx -y @gltf-transform/cli optimize "$TMP/raw.glb" "$DST" \
  --compress false --texture-compress false \
  --simplify true --simplify-ratio 0.09 --simplify-error 0.001
rm -rf "$TMP"
echo "done -> $DST"
