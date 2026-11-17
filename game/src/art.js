// Neon Bay Nights — procedural art, third-person 3D edition.
//
// Two jobs live here. First, the 3D mesh builders the renderer draws
// every frame: the merged static city (ground, roads, buildings, palms,
// lamps, props), one merged geometry per car type and per person outfit,
// pickups, and mission beacons. Everything is built from boxes,
// cylinders, cones and spheres with vertex colours from the exact
// palette, so a whole district costs a handful of draw calls.
//
// Second, the small 2D canvas helpers the HUD still draws with
// (rounded panels, text, dots, stars). The HUD is a 2D overlay canvas;
// the world is 3D.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE as P, CARS, WORLD, ROADS_X, ROADS_Y } from './config.js';

// --- 2D canvas helpers (used by hud.js) -----------------------------------

export function round(ctx, x, y, w, h, r, fill, stroke) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

export function text(ctx, str, x, y, size, color, align = 'left') {
    ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
}

export function ellipse(ctx, x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

export function polygon(ctx, points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// --- 3D: part helpers ------------------------------------------------------
// A "part" is a transformed geometry plus one flat colour. Parts are
// merged into a single vertex-coloured BufferGeometry, so a whole car,
// person, or the entire static city renders in one draw call per material.
//
// The static city uses baked sunset shading instead of per-fragment
// lights: each vertex colour is multiplied by an ambient term plus a
// warm sun term from the face normal, so a MeshBasicMaterial (one cheap
// texture/colour lookup per pixel) still reads as lit from the
// north-west. Dynamic actors keep real Lambert lighting — they turn,
// so baked light would turn with them.
const _color = new THREE.Color();
const SUN_DIR = new THREE.Vector3(-0.55, 0.77, -0.44).normalize();
const AMBIENT = { r: 0.42, g: 0.40, b: 0.38 };
const SUN_COL = { r: 0.58, g: 0.49, b: 0.36 };

function boxPart(w, h, d, x, y, z, color, ry = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    return { geo, color };
}

function cylPart(rt, rb, h, x, y, z, color, seg = 8) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
    geo.translate(x, y, z);
    return { geo, color };
}

function conePart(r, h, x, y, z, color, seg = 8) {
    const geo = new THREE.ConeGeometry(r, h, seg);
    geo.translate(x, y, z);
    return { geo, color };
}

function spherePart(r, x, y, z, color, sx = 1, sy = 1, sz = 1, seg = 10) {
    const geo = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
    geo.scale(sx, sy, sz);
    geo.translate(x, y, z);
    return { geo, color };
}

function flatPart(w, d, x, z, color, y = 0) {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, y, z);
    return { geo, color };
}

// A flat quad standing on a wall, facing outward (ry turns it to face
// +z, -z, +x or -x). Used for window bands: two triangles per band.
function wallQuad(w, h, x, y, z, color, ry = 0) {
    const geo = new THREE.PlaneGeometry(w, h);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    return { geo, color };
}

function mergeParts(parts, shade = false) {
    const geos = [];
    let total = 0;
    for (const part of parts) {
        const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo;
        geos.push({ geo, color: part.color });
        total += geo.attributes.position.array.length;
    }
    const positions = new Float32Array(total);
    const normals = new Float32Array(total);
    const colors = new Float32Array(total);
    const uvs = new Float32Array((total / 3) * 2);
    let offset = 0, uvOffset = 0;
    for (const { geo, color } of geos) {
        const pos = geo.attributes.position.array;
        const nor = geo.attributes.normal.array;
        const uv = geo.attributes.uv?.array;
        positions.set(pos, offset);
        normals.set(nor, offset);
        if (uv) uvs.set(uv, uvOffset);
        uvOffset += (pos.length / 3) * 2;
        _color.set(color);
        for (let i = offset; i < offset + pos.length; i += 3) {
            let r = _color.r, g = _color.g, b = _color.b;
            if (shade) {
                const d = Math.max(0,
                    nor[i] * SUN_DIR.x + nor[i + 1] * SUN_DIR.y + nor[i + 2] * SUN_DIR.z);
                r *= AMBIENT.r + SUN_COL.r * d;
                g *= AMBIENT.g + SUN_COL.g * d;
                b *= AMBIENT.b + SUN_COL.b * d;
            }
            colors[i] = r;
            colors[i + 1] = g;
            colors[i + 2] = b;
        }
        offset += pos.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return out;
}

// 2D heading h (0 = east, clockwise) becomes a Three.js yaw of -h, so a
// mesh built facing +x points the way the simulation thinks it does.
export const yawFor = h => -h;

// --- 3D: the static city ---------------------------------------------------

function buildingHeight(b) {
    const base = {
        hotel: 130, bank: 95, clinic: 60, warehouse: 55,
        garage: 48, diner: 42, shop: 44
    }[b.kind] || 46;
    return base + (b.detail % 3) * 9;
}

export function buildCityGeometry(world) {
    // Walls carry the window texture; everything else shares one plain
    // baked-shading mesh. Both render with MeshBasicMaterial.
    const walls = [];
    const rest = [];

    // Ground: sidewalk paving under everything, sand on the beach strip.
    rest.push(flatPart(world.width, world.height,
        world.width / 2, world.height / 2, P.sidewalk, 0));
    rest.push(flatPart(world.water - world.coast, world.height,
        (world.coast + world.water) / 2, world.height / 2, P.sand, 0.12));
    for (const park of world.parks || []) {
        rest.push(flatPart(park.w, park.h,
            park.x + park.w / 2, park.y + park.h / 2, P.grass, 0.14));
    }

    // Roads: asphalt strips and dashed centre lines.
    for (const x of ROADS_X) {
        rest.push(flatPart(104, world.height, x, world.height / 2, P.asphalt, 0.15));
    }
    for (const y of ROADS_Y) {
        rest.push(flatPart(world.width, 104, world.width / 2, y, P.asphalt, 0.17));
    }
    for (const x of ROADS_X) {
        for (let y = 60; y < world.height; y += 46) {
            rest.push(flatPart(4, 20, x, y, P.yellow, 0.28));
        }
    }
    for (const y of ROADS_Y) {
        for (let x = 60; x < world.width; x += 46) {
            rest.push(flatPart(20, 4, x, y, P.yellow, 0.28));
        }
    }
    // Zebra crossings: two stripes per approach, enough to read at speed.
    for (const x0 of ROADS_X) {
        for (const y0 of ROADS_Y) {
            for (const dx of [-22, 22]) {
                rest.push(flatPart(4, 26, x0 + dx, y0 - 58, P.white, 0.32));
                rest.push(flatPart(4, 26, x0 + dx, y0 + 58, P.white, 0.32));
                rest.push(flatPart(26, 4, x0 - 58, y0 + dx, P.white, 0.32));
                rest.push(flatPart(26, 4, x0 + 58, y0 + dx, P.white, 0.32));
            }
        }
    }

    // Seawall along the coast.
    rest.push(boxPart(6, 8, world.height, world.coast, 4, world.height / 2, P.seawall));

    // Buildings: wall box + a flat roof quad (2 tris, not a 12-tri box).
    // Windows are flat dark bands on the walls (two triangles each) —
    // far cheaper in software WebGL than a sampled window texture.
    for (const b of world.buildings) {
        const H = buildingHeight(b);
        const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
        walls.push(boxPart(b.w, H, b.h, cx, H / 2, cz, b.wall));
        rest.push(flatPart(b.w * 0.94, b.h * 0.94, cx, cz, b.roof, H + 7));
        rest.push(wallQuad(b.w * 0.8, 7, cx, H * 0.55, b.y + b.h + 0.4, '#163042', 0));
        rest.push(wallQuad(b.w * 0.8, 7, cx, H * 0.55, b.y - 0.4, '#163042', Math.PI));
        rest.push(wallQuad(b.h * 0.8, 7, b.x + b.w + 0.4, H * 0.55, cz, '#163042', Math.PI / 2));
        rest.push(wallQuad(b.h * 0.8, 7, b.x - 0.4, H * 0.55, cz, '#163042', -Math.PI / 2));
    }

    // Props: palms, lamps, benches, umbrellas, containers, diner tables.
    let lampIndex = 0;
    for (const prop of world.props) {
        const { kind, x, y } = prop;
        if (kind === 'palm') {
            const s = prop.scale || 1;
            const top = 26 * s;
            rest.push(cylPart(2.4, 3.4, top, x, top / 2, y, '#6E3B32', 5));
            for (let i = 0; i < 2; i++) {
                const a = (i / 2) * Math.PI * 2 + (prop.phase || 0);
                const geo = new THREE.ConeGeometry(8, 15, 4);
                geo.rotateZ(1.0);
                geo.rotateY(-a);
                geo.translate(x + Math.cos(a) * 7, top + 3, y + Math.sin(a) * 7);
                rest.push({ geo, color: i % 2 ? P.grass : P.grassShade });
            }
        } else if (kind === 'lamp') {
            rest.push(cylPart(1.1, 1.4, 30, x, 15, y, '#2C3138', 5));
            rest.push(boxPart(6, 6, 6, x, 31, y,
                lampIndex++ % 2 ? P.policeCyan : P.lamp));
        } else if (kind === 'bench') {
            const h = prop.h || 0;
            rest.push(boxPart(22, 3, 8, x, 6, y, '#6E3B32', -h));
            rest.push(boxPart(22, 9, 2,
                x + Math.sin(h) * 3.5, 10, y + Math.cos(h) * 3.5, '#6E3B32', -h));
        } else if (kind === 'umbrella') {
            rest.push(cylPart(1, 1, 22, x, 11, y, '#F4EFE6', 5));
            rest.push(conePart(17, 9, x, 26, y, prop.color || P.carCoral, 8));
        } else if (kind === 'container') {
            rest.push(boxPart(86, 26, 32, x, 13, y, prop.color || P.teal));
        } else if (kind === 'tables') {
            rest.push(cylPart(11, 11, 2, x, 9, y, '#F4EFE6', 8));
            rest.push(cylPart(1.5, 1.5, 9, x, 4.5, y, '#2C3138', 5));
        }
    }

    return {
        walls: mergeParts(walls, false),
        rest: mergeParts(rest, false)
    };
}

// Painted signs for the named buildings, on the east and south faces
// (the faces a chase cam sees from the coastal road).
function makeSignTexture(label) {
    try {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 72;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#1C1916';
        ctx.fillRect(0, 0, 512, 72);
        ctx.strokeStyle = '#F0B429';
        ctx.lineWidth = 4;
        ctx.strokeRect(3, 3, 506, 66);
        const size = label.length > 14 ? 34 : 44;
        ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
        ctx.fillStyle = '#F6F1E7';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 256, 38);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    } catch {
        return null;
    }
}

export function buildSigns(world) {
    const signs = [];
    if (typeof document === 'undefined') return signs;
    const named = b => ['diner', 'garage', 'clinic', 'bank'].includes(b.kind)
        || b.label === 'GLASSWATER HOTEL' || b.label === 'COPPER / 09';
    for (const b of world.buildings) {
        if (!b.label || !named(b)) continue;
        const tex = makeSignTexture(b.label);
        if (!tex) continue;
        const H = buildingHeight(b);
        const w = Math.min(b.w * 0.62, 170);
        const h = 24;
        const y = H * 0.62;
        for (const [x, z, ry] of [
            [b.x + b.w + 1.5, b.y + b.h / 2, Math.PI / 2],
            [b.x + b.w / 2, b.y + b.h + 1.5, 0]
        ]) {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
            );
            mesh.position.set(x, y, z);
            mesh.rotation.y = ry;
            signs.push(mesh);
        }
    }
    return signs;
}

// --- 3D: cars ---------------------------------------------------------------
// One merged geometry per (type, colour), built facing +x (front at +x).

const carCache = new Map();

export function carGeometry(type, color) {
    const key = `${type}|${color}`;
    const hit = carCache.get(key);
    if (hit) return hit;
    const def = CARS[type] || CARS.sedan;
    const L = def.length, W = def.width;
    const parts = [];
    const isVan = type === 'van' || type === 'armored';
    if (isVan) {
        parts.push(boxPart(L, 20, W, 0, 12, 0, color));
        parts.push(boxPart(L * 0.34, 7, W * 0.9, L * 0.3, 19, 0, P.carGlass));
        parts.push(boxPart(2, 12, W * 0.92, L / 2 - 2, 14, 0, P.carGlass));
        parts.push(boxPart(L * 0.5, 2, W * 0.96, 0, 22.5, 0,
            type === 'armored' ? '#5A5E66' : color));
    } else {
        const bodyH = type === 'sports' ? 8 : 9;
        const bodyY = type === 'sports' ? 6.5 : 7.5;
        parts.push(boxPart(L, bodyH, W, 0, bodyY, 0, color));
        const cabL = type === 'sports' ? L * 0.46 : L * 0.52;
        const cabH = type === 'sports' ? 6 : 7;
        const cabY = bodyY + bodyH / 2 + cabH / 2 - 0.5;
        parts.push(boxPart(cabL, cabH, W * 0.86, -L * 0.03, cabY, 0, P.carGlass));
        if (type === 'sports') {
            parts.push(boxPart(2, 1.2, W * 0.9, -L / 2 + 3, bodyY + bodyH / 2 + 5, 0, color));
            parts.push(boxPart(1.5, 4, 2, -L / 2 + 3, bodyY + bodyH / 2 + 2.5, -W * 0.3, P.sportsInk));
            parts.push(boxPart(1.5, 4, 2, -L / 2 + 3, bodyY + bodyH / 2 + 2.5, W * 0.3, P.sportsInk));
        }
        if (type === 'taxi') {
            parts.push(boxPart(11, 4, 7, 0, cabY + cabH / 2 + 2, 0, P.taxi));
        }
        if (type === 'police') {
            parts.push(boxPart(9, 2.5, W * 0.55, 0, cabY + cabH / 2 + 1.2, 0, P.sportsInk));
            parts.push(boxPart(4, 2, W * 0.55, -2.2, cabY + cabH / 2 + 2.6, 0, P.policeRed));
            parts.push(boxPart(4, 2, W * 0.55, 2.2, cabY + cabH / 2 + 2.6, 0, P.policeCyan));
            parts.push(boxPart(L * 0.66, 2, 0.6, 0, 9, W / 2 + 0.2, P.policeStripe));
            parts.push(boxPart(L * 0.66, 2, 0.6, 0, 9, -W / 2 - 0.2, P.policeStripe));
        }
    }
    // Wheels: one dark under-body slab, not four boxes — it reads as the
    // wheel wells and shadow mass at chase-cam distance, for a quarter of
    // the triangles.
    parts.push(boxPart(L * 0.62, 6, W * 0.98, 0, 4, 0, P.tire));
    // Headlights (front, +x) and taillights (rear, -x).
    for (const sz of [-1, 1]) {
        parts.push(boxPart(2.5, 2.5, 5, L / 2 - 0.6, 8, sz * W * 0.28, P.headlamp));
        parts.push(boxPart(2, 2.5, 5, -L / 2 + 0.6, 8.5, sz * W * 0.28, P.taillight));
    }
    const geo = mergeParts(parts);
    carCache.set(key, geo);
    return geo;
}

// --- 3D: people -------------------------------------------------------------
// One merged geometry per outfit, standing ~28 units tall, facing +x.

const personCache = new Map();

export function personGeometry(o) {
    const key = [o.jacket, o.skin, o.hair, o.trousers, o.officer ? '1' : '0'].join('|');
    const hit = personCache.get(key);
    if (hit) return hit;
    const parts = [];
    parts.push(boxPart(4.5, 9, 4.5, 0, 4.5, -2.6, o.trousers));
    parts.push(boxPart(4.5, 9, 4.5, 0, 4.5, 2.6, o.trousers));
    parts.push(boxPart(8, 10, 11, 0, 14, 0, o.jacket));
    parts.push(boxPart(3.5, 9, 3.5, 0, 13.5, -7.2, o.jacket));
    parts.push(boxPart(3.5, 9, 3.5, 0, 13.5, 7.2, o.jacket));
    parts.push(spherePart(4.2, 0, 23.5, 0, o.skin, 1, 1, 1, 4));
    parts.push(spherePart(4.4, -0.7, 24.8, 0, o.hair, 1, 0.6, 1, 4));
    if (o.officer) {
        parts.push(boxPart(9.5, 2, 9.5, 0, 27.6, 0, '#1E2A44'));
        parts.push(boxPart(10.5, 1, 4, 3.5, 26.8, 0, '#1E2A44'));
    }
    const geo = mergeParts(parts);
    personCache.set(key, geo);
    return geo;
}

// --- 3D: pickups ------------------------------------------------------------

const pickupCache = new Map();

export function pickupGeometry(kind) {
    const hit = pickupCache.get(kind);
    if (hit) return hit;
    const parts = [];
    if (kind === 'health') {
        parts.push(boxPart(11, 11, 11, 0, 0, 0, '#F4F1EA'));
        parts.push(boxPart(12.5, 3.5, 3.5, 0, 0, 0, '#E23B3B'));
        parts.push(boxPart(3.5, 12.5, 3.5, 0, 0, 0, '#E23B3B'));
    } else if (kind === 'ammo') {
        parts.push(boxPart(12, 8, 8, 0, 0, 0, '#2C3138'));
        parts.push(boxPart(12, 2.5, 8, 0, 5, 0, P.mango));
    } else {
        parts.push(boxPart(12, 7, 8, 0, 0, 0, '#7FB069'));
        parts.push(boxPart(12.6, 2, 8.6, 0, 0, 0, P.mango));
    }
    const geo = mergeParts(parts);
    pickupCache.set(kind, geo);
    return geo;
}

// --- 3D: mission / waypoint beacons -----------------------------------------

export function makeBeacon(colorHex) {
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(5, 8, 130, 10, 1, true),
        new THREE.MeshBasicMaterial({
            color: colorHex, transparent: true, opacity: 0.16,
            side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        })
    );
    beam.position.y = 65;
    const cone = new THREE.Mesh(
        new THREE.ConeGeometry(9, 20, 4),
        new THREE.MeshBasicMaterial({ color: colorHex })
    );
    cone.position.y = 46;
    cone.rotation.y = Math.PI / 4;
    const ringGeo = new THREE.RingGeometry(12, 17, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false
    }));
    ring.position.y = 0.6;
    group.add(beam, cone, ring);
    group.userData = { beam, cone, ring };
    return group;
}
