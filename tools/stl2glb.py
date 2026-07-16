#!/usr/bin/env python3
"""Binary STL -> web GLB with baked acrylic-wash vertex colors.

Pipeline: parse STL -> weld -> orient (thinnest axis -> +Y, detail side up)
-> center -> normalize max-dim 1.0 -> smooth normals -> bake wash COLOR_0
at FULL resolution -> raw GLB -> caller runs gltf-transform optimize
(simplify interpolates COLOR_0 through the collapse).

COLOR_0: RGB = wash tone (concave crevices dark, proud detail light),
         A   = proudness for shader roughness/sheen variation.

NOTE: never re-read an optimized GLB with a naive packed-accessor reader —
gltf-transform interleaves vertex attributes (normals read as positions =
exploded confetti spheres). Bake BEFORE optimizing.

Usage:
  stl2glb.py raw in.stl raw.glb
"""
import json, struct, sys
import numpy as np


# ---------------------------------------------------------------- STL parse
def read_stl(path):
    with open(path, "rb") as fh:
        fh.seek(80)
        n = struct.unpack("<I", fh.read(4))[0]
        raw = np.frombuffer(fh.read(n * 50), dtype=np.uint8).reshape(n, 50)
    tri = raw[:, 12:48].copy().view("<f4").reshape(n, 3, 3)  # skip normals, keep 9 floats
    return tri


def weld(tri):
    """indexed mesh from triangle soup (exact-match weld; scans share verts)."""
    flat = tri.reshape(-1, 3)
    # quantize to 1e-6 of bbox to merge float twins
    lo, hi = flat.min(0), flat.max(0)
    q = np.round((flat - lo) / (hi - lo).max() * 1e6).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    v = flat[first]
    f = inv.reshape(-1, 3).astype(np.uint32)
    # drop degenerate tris
    ok = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    f = f[ok]
    # winding sanity: negative signed volume = inside-out STL -> reverse faces
    # (otherwise every computed normal points inward and the piece renders as a ghost)
    t = v[f].astype(np.float64)
    vol = np.einsum('ij,ij->i', t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6.0
    if vol < 0:
        print(f"inverted winding (signed volume {vol:.3g}) — reversing faces")
        f = f[:, ::-1].copy()
    return v.astype(np.float32), f


def orient_and_scale(v, f, side='+', rot180=False):
    """thinnest axis -> +Y (relief axis), max dim 1.0. NO side heuristics —
    convert with --side + first, LOOK at it, re-run with --side - if the
    piece shows its back (add --rot180 if it lands upside-down)."""
    c = (v.max(0) + v.min(0)) / 2
    v = v - c
    ext = v.max(0) - v.min(0)
    thin = int(np.argmin(ext))
    order = {0: [1, 2, 0], 1: [0, 2, 1], 2: [0, 1, 2]}[thin]  # thin axis last
    v = v[:, [order[0], thin, order[1]]]                      # x, relief->y, z

    if side == '-':   # 180° about the screen-vertical axis: shows the other face, stays upright
        v[:, 0] *= -1
        v[:, 1] *= -1
    if rot180:        # 180° in the image plane
        v[:, 0] *= -1
        v[:, 2] *= -1
    v *= np.float32(1.0 / (v.max(0) - v.min(0)).max())
    return np.ascontiguousarray(v, dtype=np.float32)


def smooth_normals(v, f):
    tri = v[f]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n = np.zeros_like(v)
    for i in range(3):
        np.add.at(n, f[:, i], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return (n / ln).astype(np.float32)


# ---------------------------------------------------------------- GLB io
def pad(b, fill=b"\x00"):
    return b + fill * (-len(b) % 4)


def write_glb(dst, v, n, f, color=None):
    acc, views, blobs, off = [], [], [], 0

    def add(arr, ctype, atype, target, norm=False, mm=False):
        nonlocal off
        b = pad(np.ascontiguousarray(arr).tobytes())
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(b), "target": target})
        a = {"bufferView": len(views) - 1, "componentType": ctype,
             "count": len(arr) if arr.ndim > 1 else arr.size, "type": atype}
        if norm: a["normalized"] = True
        if mm:
            a["min"] = [float(x) for x in arr.min(0)]
            a["max"] = [float(x) for x in arr.max(0)]
        acc.append(a)
        blobs.append(b)
        off += len(b)
        return len(acc) - 1

    attrs = {"POSITION": add(v, 5126, "VEC3", 34962, mm=True),
             "NORMAL": add(n, 5126, "VEC3", 34962)}
    if color is not None:
        attrs["COLOR_0"] = add(color, 5121, "VEC4", 34962, norm=True)
    idx = add(f.reshape(-1), 5125, "SCALAR", 34963)

    gltf = {"asset": {"version": "2.0", "generator": "stl2glb"}, "scene": 0,
            "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "relic"}],
            "meshes": [{"primitives": [{"attributes": attrs, "indices": idx, "mode": 4}]}],
            "accessors": acc, "bufferViews": views,
            "buffers": [{"byteLength": off}]}
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    binc = b"".join(blobs)
    with open(dst, "wb") as out:
        out.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binc)))
        out.write(struct.pack("<II", len(js), 0x4E4F534A)); out.write(js)
        out.write(struct.pack("<II", len(binc), 0x004E4942)); out.write(binc)
    print(f"wrote {dst} ({(12+8+len(js)+8+len(binc))/1e6:.1f} MB)")


def read_glb(path):
    b = open(path, "rb").read()
    jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    bin0 = 20 + jlen + 8
    def acc_arr(i, dtype, w):
        a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
        o = bin0 + bv.get("byteOffset", 0)
        return np.frombuffer(b, dtype=dtype, count=a["count"] * w, offset=o).reshape(a["count"], w)
    prim = j["meshes"][0]["primitives"][0]
    v = acc_arr(prim["attributes"]["POSITION"], "<f4", 3).copy()
    n = acc_arr(prim["attributes"]["NORMAL"], "<f4", 3).copy()
    ia = j["accessors"][prim["indices"]]
    itype = {5123: "<u2", 5125: "<u4"}[ia["componentType"]]
    bv = j["bufferViews"][ia["bufferView"]]
    f = np.frombuffer(b, dtype=itype, count=ia["count"], offset=bin0 + bv.get("byteOffset", 0))
    return v, n, f.astype(np.uint32).reshape(-1, 3).copy()


# ---------------------------------------------------------------- wash bake
def wash_colors(v, n, f):
    """concavity -> acrylic wash: crevices dark, raised detail dry-brush light."""
    nv = len(v)
    # neighbor average via edge adjacency
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    nbr_sum = np.zeros_like(v); nbr_cnt = np.zeros(nv)
    np.add.at(nbr_sum, e[:, 0], v[e[:, 1]])
    np.add.at(nbr_cnt, e[:, 0], 1)
    nbr_cnt[nbr_cnt == 0] = 1
    lap = nbr_sum / nbr_cnt[:, None] - v            # points inward on convex
    curv = np.einsum("ij,ij->i", lap, n)            # + = concave (crevice)
    # smooth the field so wash "pools" instead of drawing hairlines
    for _ in range(4):
        s = np.zeros(nv); c = np.zeros(nv)
        np.add.at(s, e[:, 0], curv[e[:, 1]])
        np.add.at(c, e[:, 0], 1)
        c[c == 0] = 1
        curv = 0.4 * curv + 0.6 * (s / c)
    lo, hi = np.percentile(curv, 8), np.percentile(curv, 92)
    cav = np.clip((curv - lo) / max(hi - lo, 1e-9), 0, 1)     # 0 proud .. 1 crevice
    # tone: proud = light warm gray, crevice = deep wash
    t = cav[:, None]
    light = np.array([0.94, 0.93, 0.90]); dark = np.array([0.42, 0.40, 0.37])
    rgb = light * (1 - t) + dark * t
    col = np.concatenate([rgb, 1 - t], axis=1)                # A = "proudness"
    return np.clip(col * 255 + 0.5, 0, 255).astype(np.uint8)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "raw":
        tri = read_stl(sys.argv[2])
        print(f"{sys.argv[2]}: {len(tri):,} tris", flush=True)
        v, f = weld(tri)
        print(f"welded to {len(v):,} verts", flush=True)
        side = '-' if '--side' in sys.argv and sys.argv[sys.argv.index('--side') + 1] == '-' else '+'
        v = orient_and_scale(v, f, side=side, rot180="--rot180" in sys.argv)
        print("extents:", (v.max(0) - v.min(0)).round(3), flush=True)
        n = smooth_normals(v, f)
        print("baking wash…", flush=True)
        write_glb(sys.argv[3], v, n, f, color=wash_colors(v, n, f))
    else:
        sys.exit("mode must be raw")
