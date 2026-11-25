"""
Realistic Catmull-Clark Subdivision Surface Car Model Generator -> glTF 2.0 (.glb)
Generates 10 original high-detail aerodynamic car .glb models in public/models/cars/
inspired by iconic sport coupes, rear-engine GTs, wedge V12 supercars, and C-line hypercars,
with 5-node RaycastVehicle hierarchy: Chassis, Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR.
"""
import json
import math
import os
import struct
from collections import defaultdict

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "models", "cars")


def hex_to_rgb(h):
    h = h.lstrip("#")
    return [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(h, a=1.0):
    return [srgb_to_linear(v) for v in hex_to_rgb(h)] + [a]


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def v_scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def v_cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def v_norm(a):
    l = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-8 else (0.0, 1.0, 0.0)


def catmull_clark(verts, faces):
    n_verts = len(verts)
    face_pts = []
    for idxs, _ in faces:
        acc = (0.0, 0.0, 0.0)
        for vi in idxs:
            acc = v_add(acc, verts[vi])
        face_pts.append(v_scale(acc, 1.0 / len(idxs)))

    edge_faces = defaultdict(list)
    vert_faces = defaultdict(list)
    vert_edges = defaultdict(set)

    for fi, (idxs, _) in enumerate(faces):
        m = len(idxs)
        for k in range(m):
            a = idxs[k]
            b = idxs[(k + 1) % m]
            e = (min(a, b), max(a, b))
            edge_faces[e].append(fi)
            vert_faces[a].append(fi)
            vert_edges[a].add(e)

    edge_pts = {}
    for e, flist in edge_faces.items():
        a, b = e
        if len(flist) != 2:
            edge_pts[e] = v_scale(v_add(verts[a], verts[b]), 0.5)
        else:
            f0, f1 = face_pts[flist[0]], face_pts[flist[1]]
            edge_pts[e] = v_scale(v_add(v_add(verts[a], verts[b]), v_add(f0, f1)), 0.25)

    edge_idx_map = {}
    all_edge_pts = []
    for idx_e, (e, pt) in enumerate(edge_pts.items()):
        edge_idx_map[e] = n_verts + len(faces) + idx_e
        all_edge_pts.append(pt)

    new_orig = []
    for vi in range(n_verts):
        v_edges = vert_edges[vi]
        sharp = [e for e in v_edges if len(edge_faces[e]) != 2]
        if len(sharp) >= 3:
            new_orig.append(verts[vi])
        elif len(sharp) == 2:
            o0 = sharp[0][1] if sharp[0][0] == vi else sharp[0][0]
            o1 = sharp[1][1] if sharp[1][0] == vi else sharp[1][0]
            new_orig.append(v_add(v_scale(verts[vi], 0.75), v_scale(v_add(verts[o0], verts[o1]), 0.125)))
        else:
            flist = vert_faces[vi]
            n = len(flist)
            if n == 0:
                new_orig.append(verts[vi])
                continue
            F = (0.0, 0.0, 0.0)
            for fi in flist:
                F = v_add(F, face_pts[fi])
            F = v_scale(F, 1.0 / n)

            R = (0.0, 0.0, 0.0)
            for e in v_edges:
                R = v_add(R, v_scale(v_add(verts[e[0]], verts[e[1]]), 0.5))
            R = v_scale(R, 1.0 / max(1, len(v_edges)))
            P = verts[vi]
            new_orig.append(v_scale(v_add(v_add(F, v_scale(R, 2.0)), v_scale(P, n - 3.0)), 1.0 / n))

    out_verts = new_orig + face_pts + all_edge_pts
    out_faces = []
    for fi, (idxs, mat) in enumerate(faces):
        fp = n_verts + fi
        m = len(idxs)
        for k in range(m):
            v_curr = idxs[k]
            v_next = idxs[(k + 1) % m]
            v_prev = idxs[(k - 1) % m]
            e_next = edge_idx_map[(min(v_curr, v_next), max(v_curr, v_next))]
            e_prev = edge_idx_map[(min(v_curr, v_prev), max(v_curr, v_prev))]
            out_faces.append(((v_curr, e_next, fp, e_prev), mat))

    return out_verts, out_faces


def build_loft_cage(rings, mat_fn, cap_front_mat=None, cap_rear_mat=None):
    verts = []
    faces = []
    R = len(rings)
    M = len(rings[0])
    for r in rings:
        verts.extend(r)

    for ri in range(R - 1):
        base0 = ri * M
        base1 = (ri + 1) * M
        for mi in range(M):
            mn = (mi + 1) % M
            a, b, c, d = base0 + mi, base0 + mn, base1 + mn, base1 + mi
            faces.append(((a, b, c, d), mat_fn(ri, mi)))

    if cap_rear_mat:
        half = M // 2
        for k in range(half - 1):
            a, b, c, d = k, k + 1, M - 2 - k, M - 1 - k
            if b < c:
                faces.append(((a, d, c, b), cap_rear_mat))
            elif b == c:
                faces.append(((a, d, b), cap_rear_mat))
    if cap_front_mat:
        off = (R - 1) * M
        half = M // 2
        for k in range(half - 1):
            a, b, c, d = off + k, off + k + 1, off + M - 2 - k, off + M - 1 - k
            if b < c:
                faces.append(((a, b, c, d), cap_front_mat))
            elif b == c:
                faces.append(((a, b, d), cap_front_mat))

    return verts, faces


def build_car_body_cage(spec):
    w = spec["half_w"]
    zf = spec["wheel_zf"]
    zr = spec["wheel_zr"]
    z_rear = spec["z_rear"]
    z_front = spec["z_front"]
    hood_y = spec["hood_y"]
    belt_y = spec["belt_y"]
    floor_y = spec["floor_y"]
    shape = spec["shape"]

    # Wedge supercars & C-line hypercars get wider rear haunches and sharper nose drop
    rear_haunch = 1.12 if shape in ("wedge_v12", "cline_hyper", "berlinetta", "stuttgart_gt") else 1.07
    nose_drop = 0.28 if shape in ("wedge_v12", "berlinetta", "hypercar") else 0.19
    door_scoop = 0.08 if shape in ("wedge_v12", "berlinetta", "cline_hyper") else 0.0

    stations = [
        (z_rear, 0.86, belt_y + 0.04, 0.02, floor_y + 0.14, 0.0),
        (z_rear + 0.24, 0.98, belt_y + 0.03, 0.01, floor_y + 0.04, 0.0),
        (zr - 0.58, rear_haunch - 0.04, belt_y + 0.03, 0.01, floor_y, 0.0),
        (zr - 0.34, rear_haunch, belt_y + 0.03, 0.03, floor_y + 0.44, 0.22),
        (zr, rear_haunch + 0.01, belt_y + 0.03, 0.04, floor_y + 0.52, 0.24),
        (zr + 0.34, rear_haunch, belt_y + 0.02, 0.02, floor_y + 0.44, 0.22),
        (zr + 0.58, 1.03, belt_y + 0.01, 0.0, floor_y, 0.0),
        (0.0, 0.98 - door_scoop, belt_y, -0.02, floor_y, 0.0),
        (zf - 0.58, 1.01, belt_y - 0.03, -0.02, floor_y, 0.0),
        (zf - 0.34, 1.07, hood_y + 0.05, 0.01, floor_y + 0.44, 0.22),
        (zf, 1.08, hood_y + 0.03, 0.01, floor_y + 0.50, 0.24),
        (zf + 0.34, 1.05, hood_y - 0.03, -0.03, floor_y + 0.42, 0.19),
        (zf + 0.55, 0.97, hood_y - 0.08, -0.06, floor_y + 0.04, 0.0),
        (z_front - 0.18, 0.89, hood_y - nose_drop * 0.65, -0.11, floor_y + 0.07, 0.0),
        (z_front, 0.76, hood_y - nose_drop, -0.15, floor_y + 0.12, 0.0),
    ]

    rings = []
    for z, ws, dy, byo, sy, inset in stations:
        xw = w * ws
        x_arch = xw - inset
        ring = [
            (xw * 0.68 - inset * 0.5, floor_y, z),
            (x_arch, sy, z),
            (xw * 1.02, (sy + belt_y + byo) * 0.5, z),
            (xw * 0.94, belt_y + byo, z),
            (xw * 0.70, dy, z),
            (-xw * 0.70, dy, z),
            (-xw * 0.94, belt_y + byo, z),
            (-xw * 1.02, (sy + belt_y + byo) * 0.5, z),
            (-x_arch, sy, z),
            (-xw * 0.68 + inset * 0.5, floor_y, z),
        ]
        rings.append(ring)

    def body_mat(ri, mi):
        if mi in (0, 9):
            return "DarkTrim"
        if ri == 0 and mi in (2, 3, 6, 7):
            return "Taillight"
        if ri >= len(stations) - 2 and mi in (2, 3, 6, 7):
            return "Headlight"
        if shape == "cline_hyper" and ri in (4, 5, 6, 7) and mi in (2, 7):
            return "DarkTrim"  # Dual-tone C-line flank
        return "BodyPaint"

    verts, faces = build_loft_cage(rings, body_mat, cap_front_mat="DarkTrim", cap_rear_mat="DarkTrim")

    # Sculpted greenhouse cabin
    cab_z0 = spec["cab_z0"]
    cab_z1 = spec["cab_z1"]
    cab_w = spec["cab_w"]
    roof_y = spec["roof_y"]
    cab_stations = [
        (cab_z0, cab_w * 0.88, belt_y - 0.02, belt_y + 0.07),
        (cab_z0 + (cab_z1 - cab_z0) * 0.24, cab_w * 0.78, belt_y + 0.02, roof_y - 0.03),
        (cab_z0 + (cab_z1 - cab_z0) * 0.52, cab_w * 0.75, belt_y + 0.02, roof_y),
        (cab_z0 + (cab_z1 - cab_z0) * 0.74, cab_w * 0.77, belt_y + 0.0, roof_y - 0.04),
        (cab_z1, cab_w * 0.88, hood_y - 0.02, hood_y + 0.04),
    ]
    c_rings = []
    for z, cw, base_y, top_y in cab_stations:
        c_rings.append([
            (cw * 0.92, base_y, z),
            (cw * 0.78, (base_y + top_y) * 0.56, z),
            (cw * 0.64, top_y, z),
            (-cw * 0.64, top_y, z),
            (-cw * 0.78, (base_y + top_y) * 0.56, z),
            (-cw * 0.92, base_y, z),
        ])

    def cab_mat(ri, mi):
        if mi == 2 and ri in (1, 2):
            return "DarkTrim" if shape in ("wedge_v12", "cline_hyper", "hypercar") else "BodyPaint"
        return "TintedGlass"

    c_verts, c_faces = build_loft_cage(c_rings, cab_mat, cap_front_mat="TintedGlass", cap_rear_mat="TintedGlass")

    # 2 passes Catmull-Clark Subdivision for smooth organic curves
    for _ in range(2):
        verts, faces = catmull_clark(verts, faces)
        c_verts, c_faces = catmull_clark(c_verts, c_faces)

    off = len(verts)
    verts.extend(c_verts)
    for idxs, mat in c_faces:
        faces.append((tuple(i + off for i in idxs), mat))

    # Crisp exterior aero details (splitters, grilles, side skirts, diffusers, mirrors, wings)
    def add_box(cx, cy, cz, sx, sy, sz, mat, rx=0.0):
        b_off = len(verts)
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        cs, sn = math.cos(rx), math.sin(rx)
        local = [
            (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
            (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
        ]
        for lx, ly, lz in local:
            ry = ly * cs - lz * sn
            rz = ly * sn + lz * cs
            verts.append((cx + lx, cy + ry, cz + rz))
        for bf in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)]:
            faces.append((tuple(b_off + i for i in bf), mat))

    # Carbon front splitter, side skirts, & multi-fin rear diffuser
    add_box(0, floor_y + 0.01, z_front - 0.12, w * 1.94, 0.07, 0.48, "DarkTrim")
    add_box(-w * 0.94, floor_y + 0.03, 0, 0.14, 0.08, (z_front - z_rear) * 0.55, "DarkTrim")
    add_box(w * 0.94, floor_y + 0.03, 0, 0.14, 0.08, (z_front - z_rear) * 0.55, "DarkTrim")
    add_box(0, floor_y + 0.05, z_rear + 0.05, w * 1.76, 0.15, 0.38, "DarkTrim")
    for fx in (-0.5, -0.18, 0.18, 0.5):
        add_box(fx, floor_y + 0.06, z_rear + 0.02, 0.05, 0.16, 0.34, "AccentLivery")

    # Quad or center alloy exhausts
    for ex in (-0.54, -0.36, 0.36, 0.54):
        add_box(ex, floor_y + 0.16, z_rear - 0.05, 0.12, 0.10, 0.24, "AlloyRim")

    # Sculpted side mirrors
    mz = cab_z1 - 0.26
    my = belt_y + 0.07
    mx = cab_w * 1.05
    add_box(mx, my, mz, 0.22, 0.10, 0.16, "BodyPaint")
    add_box(-mx, my, mz, 0.22, 0.10, 0.16, "BodyPaint")

    # Class-specific iconic silhouettes
    if shape == "hatchback":
        add_box(0, roof_y + 0.04, cab_z0 + 0.05, cab_w * 1.4, 0.07, 0.32, "AccentLivery", -0.15)
    elif shape == "buggy":
        add_box(-0.58, belt_y + 0.34, z_rear + 0.6, 0.08, 0.62, 0.08, "AccentLivery")
        add_box(0.58, belt_y + 0.34, z_rear + 0.6, 0.08, 0.62, 0.08, "AccentLivery")
        add_box(0, roof_y - 0.02, z_rear + 0.25, w * 1.55, 0.08, 0.40, "BodyPaint", -0.22)
    elif shape == "m_coupe":
        # Twin front grille kidneys + M-style lip spoiler + hood power bulge
        add_box(-0.22, floor_y + 0.26, z_front - 0.02, 0.32, 0.22, 0.10, "DarkTrim")
        add_box(0.22, floor_y + 0.26, z_front - 0.02, 0.32, 0.22, 0.10, "DarkTrim")
        add_box(0, hood_y + 0.04, zf - 0.15, 0.68, 0.07, 1.15, "BodyPaint")
        add_box(0, belt_y + 0.08, z_rear + 0.22, w * 1.76, 0.07, 0.24, "DarkTrim", 0.18)
    elif shape == "stuttgart_gt":
        # Classic rear-engine swan-neck wing + louvered rear deck
        add_box(-0.55, belt_y + 0.20, z_rear + 0.30, 0.07, 0.30, 0.18, "DarkTrim")
        add_box(0.55, belt_y + 0.20, z_rear + 0.30, 0.07, 0.30, 0.18, "DarkTrim")
        add_box(0, belt_y + 0.36, z_rear + 0.24, w * 1.82, 0.06, 0.38, "DarkTrim", -0.14)
        add_box(0, belt_y + 0.06, z_rear + 0.55, w * 1.1, 0.04, 0.45, "DarkTrim")
    elif shape == "coupe":
        add_box(-w * 0.62, belt_y + 0.16, z_rear + 0.25, 0.07, 0.28, 0.18, "DarkTrim")
        add_box(w * 0.62, belt_y + 0.16, z_rear + 0.25, 0.07, 0.28, 0.18, "DarkTrim")
        add_box(0, belt_y + 0.30, z_rear + 0.22, w * 1.88, 0.07, 0.38, "AccentLivery", -0.14)
    elif shape == "muscle":
        add_box(0, hood_y + 0.12, zf - 0.1, 0.62, 0.16, 0.95, "DarkTrim")
        add_box(0, hood_y + 0.14, zf + 0.38, 0.48, 0.08, 0.08, "AccentLivery")
        add_box(0, belt_y + 0.12, z_rear + 0.15, w * 1.84, 0.18, 0.22, "AccentLivery", 0.32)
    elif shape == "berlinetta":
        # Sculpted side air intake blades + engine glass louvers + ducktail
        add_box(-w * 0.96, belt_y - 0.14, -0.35, 0.14, 0.24, 0.72, "DarkTrim")
        add_box(w * 0.96, belt_y - 0.14, -0.35, 0.14, 0.24, 0.72, "DarkTrim")
        add_box(0, belt_y + 0.09, z_rear + 0.18, w * 1.82, 0.10, 0.28, "AccentLivery", 0.24)
    elif shape == "wedge_v12":
        # Angular side scoops + dramatic V12 engine louvers + huge GT wing
        add_box(-w * 0.98, belt_y - 0.12, -0.45, 0.18, 0.26, 0.85, "DarkTrim")
        add_box(w * 0.98, belt_y - 0.12, -0.45, 0.18, 0.26, 0.85, "DarkTrim")
        add_box(-0.70, belt_y + 0.24, z_rear + 0.26, 0.07, 0.40, 0.20, "DarkTrim")
        add_box(0.70, belt_y + 0.24, z_rear + 0.26, 0.07, 0.40, 0.20, "DarkTrim")
        add_box(0, belt_y + 0.44, z_rear + 0.20, w * 2.02, 0.07, 0.48, "AccentLivery", -0.16)
    elif shape == "hypercar":
        add_box(0, belt_y + 0.22, cab_z0 - 0.35, 0.07, 0.34, 1.1, "AccentLivery")
        add_box(-0.74, belt_y + 0.25, z_rear + 0.24, 0.07, 0.40, 0.20, "DarkTrim")
        add_box(0.74, belt_y + 0.25, z_rear + 0.24, 0.07, 0.40, 0.20, "DarkTrim")
        add_box(0, belt_y + 0.46, z_rear + 0.20, w * 2.02, 0.07, 0.48, "AccentLivery", -0.14)
    elif shape == "cline_hyper":
        # Signature horseshoe front arch + C-line side trim + active airbrake wing
        add_box(0, floor_y + 0.24, z_front - 0.01, 0.46, 0.28, 0.10, "DarkTrim")
        add_box(-w * 0.98, belt_y - 0.08, -0.15, 0.10, 0.44, 0.95, "AccentLivery")
        add_box(w * 0.98, belt_y - 0.08, -0.15, 0.10, 0.44, 0.95, "AccentLivery")
        add_box(0, belt_y + 0.26, z_rear + 0.28, w * 1.92, 0.07, 0.44, "DarkTrim", -0.22)

    return verts, faces


def build_wheel_mesh(radius=0.42, width=0.34):
    verts = []
    faces = []
    segs = 32
    prof = [
        (width * 0.45, radius * 0.62),
        (width * 0.50, radius * 0.84),
        (width * 0.44, radius * 0.99),
        (-width * 0.44, radius * 0.99),
        (-width * 0.50, radius * 0.84),
        (-width * 0.45, radius * 0.62),
    ]
    P = len(prof)
    for si in range(segs):
        ang = (si / segs) * math.pi * 2.0
        ca, sa = math.cos(ang), math.sin(ang)
        for px, pr in prof:
            verts.append((px, pr * ca, pr * sa))
    for si in range(segs):
        sn = (si + 1) % segs
        b0, b1 = si * P, sn * P
        for pi in range(P - 1):
            faces.append(((b0 + pi, b0 + pi + 1, b1 + pi + 1, b1 + pi), "TireRubber"))

    def add_wheel_box(cx, cy, cz, sx, sy, sz, mat, rot_x=0.0):
        off = len(verts)
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        cs, sn = math.cos(rot_x), math.sin(rot_x)
        for lx, ly, lz in [
            (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
            (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
        ]:
            ry = ly * cs - lz * sn
            rz = ly * sn + lz * cs
            verts.append((cx + lx, cy + ry, cz + rz))
        for bf in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)]:
            faces.append((tuple(off + i for i in bf), mat))

    # 10-spoke Y-split alloy wheel + brake disc + caliper
    for k in range(5):
        ang = (k / 5.0) * math.pi * 2.0
        r_mid = radius * 0.34
        add_wheel_box(0.02, r_mid * math.cos(ang + 0.12), r_mid * math.sin(ang + 0.12), width * 0.62, radius * 0.58, 0.048, "AlloyRim", ang + 0.12)
        add_wheel_box(0.02, r_mid * math.cos(ang - 0.12), r_mid * math.sin(ang - 0.12), width * 0.62, radius * 0.58, 0.048, "AlloyRim", ang - 0.12)

    add_wheel_box(0.04, 0, 0, width * 0.72, radius * 0.30, radius * 0.30, "AlloyRim")
    add_wheel_box(0.0, radius * 0.38, -radius * 0.22, width * 0.36, 0.14, 0.18, "BrakeCaliper")

    return verts, faces


def triangulate_and_pack_primitives(verts, faces):
    by_mat = defaultdict(list)
    for idxs, mat in faces:
        if len(idxs) == 3:
            by_mat[mat].append(idxs)
        elif len(idxs) == 4:
            by_mat[mat].append((idxs[0], idxs[1], idxs[2]))
            by_mat[mat].append((idxs[0], idxs[2], idxs[3]))
        else:
            for k in range(1, len(idxs) - 1):
                by_mat[mat].append((idxs[0], idxs[k], idxs[k + 1]))

    primitives = []
    total_tris = 0
    for mat_name, tris in by_mat.items():
        total_tris += len(tris)
        local_map = {}
        local_pos = []
        local_tris = []
        for a, b, c in tris:
            tri_out = []
            for vi in (a, b, c):
                if vi not in local_map:
                    local_map[vi] = len(local_pos)
                    local_pos.append(verts[vi])
                tri_out.append(local_map[vi])
            local_tris.append(tri_out)

        norms = [[0.0, 0.0, 0.0] for _ in local_pos]
        for a, b, c in local_tris:
            pa, pb, pc = local_pos[a], local_pos[b], local_pos[c]
            fn = v_cross(v_sub(pb, pa), v_sub(pc, pa))
            for idx in (a, b, c):
                norms[idx][0] += fn[0]
                norms[idx][1] += fn[1]
                norms[idx][2] += fn[2]
        norms = [v_norm(n) for n in norms]
        primitives.append((mat_name, local_pos, norms, local_tris))
    return primitives, total_tris


def export_glb(filepath, car_spec):
    body_verts, body_faces = build_car_body_cage(car_spec)
    body_prims, body_tris = triangulate_and_pack_primitives(body_verts, body_faces)

    w_scale = 1.15 if car_spec["shape"] == "buggy" else 1.0
    w_verts, w_faces = build_wheel_mesh(0.42 * w_scale, 0.34 * w_scale)
    wheel_prims, wheel_tris = triangulate_and_pack_primitives(w_verts, w_faces)

    materials = {
        "BodyPaint": {"name": "BodyPaint", "pbrMetallicRoughness": {"baseColorFactor": hex_to_linear_rgba(car_spec["primary"]), "metallicFactor": 0.58, "roughnessFactor": 0.20}},
        "DarkTrim": {"name": "DarkTrim", "pbrMetallicRoughness": {"baseColorFactor": hex_to_linear_rgba(car_spec["secondary"]), "metallicFactor": 0.45, "roughnessFactor": 0.45}},
        "AccentLivery": {"name": "AccentLivery", "pbrMetallicRoughness": {"baseColorFactor": hex_to_linear_rgba(car_spec["accent"]), "metallicFactor": 0.62, "roughnessFactor": 0.22}, "emissiveFactor": [v * 0.22 for v in hex_to_linear_rgba(car_spec["accent"])[:3]]},
        "TintedGlass": {"name": "TintedGlass", "pbrMetallicRoughness": {"baseColorFactor": [0.02, 0.04, 0.08, 1.0], "metallicFactor": 0.88, "roughnessFactor": 0.06}},
        "Headlight": {"name": "Headlight", "pbrMetallicRoughness": {"baseColorFactor": [1.0, 0.96, 0.86, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.1}, "emissiveFactor": [1.0, 0.95, 0.80]},
        "Taillight": {"name": "Taillight", "pbrMetallicRoughness": {"baseColorFactor": [1.0, 0.06, 0.20, 1.0], "metallicFactor": 0.1, "roughnessFactor": 0.2}, "emissiveFactor": [0.95, 0.04, 0.18]},
        "TireRubber": {"name": "TireRubber", "pbrMetallicRoughness": {"baseColorFactor": [0.03, 0.03, 0.04, 1.0], "metallicFactor": 0.04, "roughnessFactor": 0.88}},
        "AlloyRim": {"name": "AlloyRim", "pbrMetallicRoughness": {"baseColorFactor": [0.88, 0.90, 0.93, 1.0], "metallicFactor": 0.94, "roughnessFactor": 0.15}},
        "BrakeCaliper": {"name": "BrakeCaliper", "pbrMetallicRoughness": {"baseColorFactor": hex_to_linear_rgba(car_spec["accent"]), "metallicFactor": 0.4, "roughnessFactor": 0.35}},
    }
    mat_list = list(materials.values())
    mat_idx = {m["name"]: i for i, m in enumerate(mat_list)}

    bin_chunks, bin_len, buffer_views, accessors = [], 0, [], []

    def append_bytes(raw):
        nonlocal bin_len
        pad = (-len(raw)) % 4
        if pad:
            raw += b"\x00" * pad
        offset = bin_len
        bin_chunks.append(raw)
        bin_len += len(raw)
        return offset

    def pack_prims(prims):
        gltf_prims = []
        for m_name, pos, norms, tris in prims:
            pos_raw = struct.pack(f"<{len(pos)*3}f", *[c for p in pos for c in p])
            norm_raw = struct.pack(f"<{len(norms)*3}f", *[c for n in norms for c in n])
            idx_flat = [i for t in tris for i in t]
            idx_raw = struct.pack(f"<{len(idx_flat)}I", *idx_flat)
            p_off, n_off, i_off = append_bytes(pos_raw), append_bytes(norm_raw), append_bytes(idx_raw)
            min_p = [min(p[k] for p in pos) for k in range(3)]
            max_p = [max(p[k] for p in pos) for k in range(3)]

            bv_pos = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": p_off, "byteLength": len(pos_raw), "target": 34962})
            bv_norm = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": n_off, "byteLength": len(norm_raw), "target": 34962})
            bv_idx = len(buffer_views)
            buffer_views.append({"buffer": 0, "byteOffset": i_off, "byteLength": len(idx_raw), "target": 34963})

            acc_pos = len(accessors)
            accessors.append({"bufferView": bv_pos, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": min_p, "max": max_p})
            acc_norm = len(accessors)
            accessors.append({"bufferView": bv_norm, "componentType": 5126, "count": len(norms), "type": "VEC3"})
            acc_idx = len(accessors)
            accessors.append({"bufferView": bv_idx, "componentType": 5125, "count": len(idx_flat), "type": "SCALAR"})

            gltf_prims.append({"attributes": {"POSITION": acc_pos, "NORMAL": acc_norm}, "indices": acc_idx, "material": mat_idx[m_name]})
        return gltf_prims

    chassis_mesh_prims = pack_prims(body_prims)
    wheel_mesh_prims = pack_prims(wheel_prims)

    wx, wzf, wzr, wy = car_spec["wheel_x"], car_spec["wheel_zf"], car_spec["wheel_zr"], 0.42 * w_scale

    gltf = {
        "asset": {"version": "2.0", "generator": "Raftaar Nitro Subdivision Surface Car Exporter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {"name": "CarRoot", "children": [1, 2, 3, 4, 5]},
            {"name": "Chassis", "mesh": 0},
            {"name": "Wheel_FL", "mesh": 1, "translation": [wx, wy, wzf]},
            {"name": "Wheel_FR", "mesh": 1, "translation": [-wx, wy, wzf]},
            {"name": "Wheel_RL", "mesh": 1, "translation": [wx, wy, wzr]},
            {"name": "Wheel_RR", "mesh": 1, "translation": [-wx, wy, wzr]},
        ],
        "meshes": [
            {"name": "ChassisMesh", "primitives": chassis_mesh_prims},
            {"name": "WheelMesh", "primitives": wheel_mesh_prims},
        ],
        "materials": mat_list,
        "buffers": [{"byteLength": bin_len}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    j_pad = (-len(json_bytes)) % 4
    if j_pad:
        json_bytes += b" " * j_pad
    bin_bytes = b"".join(bin_chunks)
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)

    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_bytes), 0x004E4942))
        f.write(bin_bytes)

    return body_tris + wheel_tris * 4, os.path.getsize(filepath)


CARS = [
    {"id": "jugnu", "shape": "hatchback", "primary": "#ff6b35", "secondary": "#1e1b2e", "accent": "#ffd166", "half_w": 0.94, "z_rear": -1.80, "z_front": 1.84, "wheel_zr": -1.15, "wheel_zf": 1.15, "wheel_x": 0.98, "floor_y": 0.28, "belt_y": 0.84, "hood_y": 0.78, "cab_z0": -1.35, "cab_z1": 0.88, "cab_w": 0.74, "roof_y": 1.33},
    {"id": "dhool_runner", "shape": "buggy", "primary": "#f4a261", "secondary": "#264653", "accent": "#e9c46a", "half_w": 0.90, "z_rear": -1.90, "z_front": 1.94, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.04, "floor_y": 0.36, "belt_y": 0.86, "hood_y": 0.76, "cab_z0": -1.10, "cab_z1": 0.72, "cab_w": 0.64, "roof_y": 1.42},
    {"id": "sheher_m40", "shape": "m_coupe", "primary": "#1d4ed8", "secondary": "#111827", "accent": "#38bdf8", "half_w": 1.00, "z_rear": -2.14, "z_front": 2.22, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.00, "floor_y": 0.25, "belt_y": 0.79, "hood_y": 0.74, "cab_z0": -1.40, "cab_z1": 1.02, "cab_w": 0.76, "roof_y": 1.22},
    {"id": "pahari_911r", "shape": "stuttgart_gt", "primary": "#eab308", "secondary": "#18181b", "accent": "#ef4444", "half_w": 1.02, "z_rear": -2.12, "z_front": 2.16, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.02, "floor_y": 0.24, "belt_y": 0.75, "hood_y": 0.65, "cab_z0": -1.52, "cab_z1": 0.88, "cab_w": 0.72, "roof_y": 1.18},
    {"id": "barq_gt", "shape": "coupe", "primary": "#ff006e", "secondary": "#1a1423", "accent": "#ffbe0b", "half_w": 1.03, "z_rear": -2.18, "z_front": 2.26, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.02, "floor_y": 0.24, "belt_y": 0.76, "hood_y": 0.68, "cab_z0": -1.48, "cab_z1": 0.96, "cab_w": 0.74, "roof_y": 1.15},
    {"id": "shaheen", "shape": "muscle", "primary": "#e63946", "secondary": "#111118", "accent": "#f1faee", "half_w": 1.08, "z_rear": -2.24, "z_front": 2.30, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.08, "floor_y": 0.26, "belt_y": 0.86, "hood_y": 0.82, "cab_z0": -1.56, "cab_z1": 0.68, "cab_w": 0.78, "roof_y": 1.26},
    {"id": "buraq_v10", "shape": "berlinetta", "primary": "#dc2626", "secondary": "#18181b", "accent": "#fbbf24", "half_w": 1.06, "z_rear": -2.22, "z_front": 2.28, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.04, "floor_y": 0.22, "belt_y": 0.72, "hood_y": 0.62, "cab_z0": -1.36, "cab_z1": 1.04, "cab_w": 0.70, "roof_y": 1.08},
    {"id": "azhdaha_sv", "shape": "wedge_v12", "primary": "#84cc16", "secondary": "#0f172a", "accent": "#22d3ee", "half_w": 1.10, "z_rear": -2.28, "z_front": 2.38, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.08, "floor_y": 0.20, "belt_y": 0.68, "hood_y": 0.56, "cab_z0": -1.34, "cab_z1": 1.10, "cab_w": 0.70, "roof_y": 1.02},
    {"id": "toofan_x", "shape": "hypercar", "primary": "#7209b7", "secondary": "#0b0914", "accent": "#00f5d4", "half_w": 1.10, "z_rear": -2.32, "z_front": 2.42, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.08, "floor_y": 0.20, "belt_y": 0.70, "hood_y": 0.60, "cab_z0": -1.32, "cab_z1": 1.12, "cab_w": 0.68, "roof_y": 1.02},
    {"id": "badshah_1600", "shape": "cline_hyper", "primary": "#0284c7", "secondary": "#090d16", "accent": "#38bdf8", "half_w": 1.12, "z_rear": -2.30, "z_front": 2.36, "wheel_zr": -1.42, "wheel_zf": 1.42, "wheel_x": 1.08, "floor_y": 0.21, "belt_y": 0.74, "hood_y": 0.64, "cab_z0": -1.38, "cab_z1": 1.04, "cab_w": 0.72, "roof_y": 1.06},
]

if __name__ == "__main__":
    for spec in CARS:
        out = os.path.join(OUT_DIR, f"{spec['id']}.glb")
        tris, bytes_sz = export_glb(out, spec)
        print(f"Generated {spec['id']}.glb: {tris} triangles, {bytes_sz / 1024:.1f} KB")
