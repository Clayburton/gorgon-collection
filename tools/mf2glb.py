#!/usr/bin/env python3
"""3MF mesh XML -> GLB (positions + smooth normals + uint32 indices).

Centers the mesh at its bounding-box center, converts Z-up (3MF/mm) to
Y-up (glTF), and normalizes so the largest dimension == args.size.
"""
import json, re, struct, sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
target_size = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

xml = open(src, "r", encoding="utf-8").read()
print("parsing vertices…", flush=True)
v = np.array(re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', xml), dtype=np.float32)
print("parsing triangles…", flush=True)
f = np.array(re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', xml), dtype=np.uint32)
del xml
print(f"vertices {len(v):,}  triangles {len(f):,}")

# drop orphan vertices (scan noise unreferenced by any triangle) — they poison
# the bbox used for centering/scaling
used = np.unique(f)
if len(used) < len(v):
    remap = np.zeros(len(v), dtype=np.uint32)
    remap[used] = np.arange(len(used), dtype=np.uint32)
    v = v[used]
    f = remap[f]
    print(f"dropped {len(remap) - len(used):,} orphan vertices")

# center + Z-up -> Y-up  (x, z, -y) + normalize scale
c = (v.max(0) + v.min(0)) / 2
v -= c
v = np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)
ext = v.max(0) - v.min(0)
v *= np.float32(target_size / ext.max())
print("extents (y-up):", (v.max(0) - v.min(0)).round(3))

# smooth vertex normals (area-weighted)
print("computing normals…", flush=True)
tri = v[f]                                # (m,3,3)
fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])  # area-weighted
n = np.zeros_like(v)
for i in range(3):
    np.add.at(n, f[:, i], fn)
ln = np.linalg.norm(n, axis=1, keepdims=True)
ln[ln == 0] = 1
n = (n / ln).astype(np.float32)

pos = np.ascontiguousarray(v, dtype=np.float32).tobytes()
nrm = np.ascontiguousarray(n, dtype=np.float32).tobytes()
idx = np.ascontiguousarray(f, dtype=np.uint32).tobytes()

def pad(b, alignment=4, fill=b"\x00"):
    return b + fill * (-len(b) % alignment)

pos, nrm, idx = pad(pos), pad(nrm), pad(idx)
bin_chunk = pos + nrm + idx

gltf = {
    "asset": {"version": "2.0", "generator": "mf2glb"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0, "name": "relic"}],
    "meshes": [{"primitives": [{
        "attributes": {"POSITION": 0, "NORMAL": 1},
        "indices": 2, "mode": 4}]}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": len(v), "type": "VEC3",
         "min": [float(x) for x in v.min(0)], "max": [float(x) for x in v.max(0)]},
        {"bufferView": 1, "componentType": 5126, "count": len(n), "type": "VEC3"},
        {"bufferView": 2, "componentType": 5125, "count": f.size, "type": "SCALAR"},
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nrm), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos) + len(nrm), "byteLength": len(idx), "target": 34963},
    ],
    "buffers": [{"byteLength": len(bin_chunk)}],
}
js = pad(json.dumps(gltf, separators=(",", ":")).encode(), fill=b" ")
total = 12 + 8 + len(js) + 8 + len(bin_chunk)
with open(dst, "wb") as out:
    out.write(struct.pack("<III", 0x46546C67, 2, total))
    out.write(struct.pack("<II", len(js), 0x4E4F534A)); out.write(js)
    out.write(struct.pack("<II", len(bin_chunk), 0x004E4942)); out.write(bin_chunk)
print(f"wrote {dst}  ({total/1e6:.1f} MB)")
