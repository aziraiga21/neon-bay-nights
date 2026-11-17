// Neon Bay Nights — every visual is painted by code at runtime.
// No image files, no downloads: the city ground is baked once per world
// (a daylight sheet and a dusk sheet), while buildings, cars, people and
// street props are drawn live every frame from the same palette.
import { PALETTE as P, CARS, ROADS_X, ROADS_Y } from './config.js';
import { createRandom } from './random.js';

// --- tiny drawing verbs ----------------------------------------------------
// These four are the shared vocabulary for hud.js and render.js as well,
// so their names and signatures stay exactly as they are.

export function round(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
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

export function polygon(ctx, points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    });
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }
}

export function ellipse(ctx, x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

export function text(ctx, str, x, y, size, color, align = 'left', weight = 'bold') {
    ctx.font = weight + ' ' + size + 'px Arial, Helvetica, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
}

// Small local helpers for the ground painter below.
function dashLine(ctx, x1, y1, x2, y2, style, dash) {
    ctx.strokeStyle = style;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
}

function speckle(ctx, rng, count, pickSpot, shades) {
    for (let n = 0; n < count; n++) {
        const [px, py, w, h] = pickSpot(n);
        ctx.fillStyle = shades[n % shades.length];
        ctx.fillRect(px, py, w, h);
    }
}

// --- the static ground sheet -----------------------------------------------
// One big canvas holding land, lots, parks, roads, lane paint, crossings,
// street names, the seawall, the beach and the jetties. Dusk swaps the
// asphalt and sidewalk tones; everything else is painted identically.

export function makeGround(world, dusk = false) {
    const asphalt = dusk ? P.asphaltDusk : P.asphalt;
    const walk = dusk ? P.sidewalkDusk : P.sidewalk;
    const sheet = document.createElement('canvas');
    sheet.width = world.width;
    sheet.height = world.height;
    const ctx = sheet.getContext('2d');
    const rng = createRandom(world.seed + 41);

    // Scrub west of the bay line, then the sidewalk field the grid sits on.
    ctx.fillStyle = '#B3BEA7';
    ctx.fillRect(0, 0, world.water, sheet.height);
    ctx.fillStyle = walk;
    ctx.fillRect(70, 70, 2700, 2700);

    // Block paving: alternating warm tones read as courtyards between houses.
    for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) {
            const px = ROADS_X[i] + 76;
            const py = ROADS_Y[j] + 76;
            ctx.fillStyle = j >= 4 ? '#B8B6A7' : ((i + j) % 2 ? '#D8C6AE' : '#C8C9B2');
            ctx.fillRect(px, py, 232, 232);
            ctx.strokeStyle = '#A7AB9880';
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 8, py + 8, 216, 216);
        }
    }

    // Parks: lawn slab, crossing paths, a round pond, scattered petals.
    for (const park of world.parks) {
        round(ctx, park.x - 5, park.y - 5, park.w + 10, park.h + 10, 9, P.grass);
        ctx.fillStyle = walk;
        ctx.fillRect(park.x + 99, park.y, 22, park.h);
        ctx.fillRect(park.x, park.y + 100, park.w, 22);
        ellipse(ctx, park.x + 110, park.y + 111, 39, 31, P.concrete);
        ellipse(ctx, park.x + 110, park.y + 109, 34, 27, P.poolDeep);
        ellipse(ctx, park.x + 110, park.y + 108, 28, 22, P.pool);
        ellipse(ctx, park.x + 110, park.y + 106, 6, 6, P.trim);
        for (let n = 0; n < 13; n++) {
            const sx = park.x + rng.range(10, 210);
            const sy = park.y + rng.range(10, 210);
            if (Math.abs(sx - park.x - 110) > 42 && Math.abs(sy - park.y - 110) > 42) {
                ellipse(ctx, sx, sy, 4, 3, '#D7C489');
            }
        }
    }

    // Roads: pale curb lip framing each asphalt strip, vertical then horizontal.
    for (const x of ROADS_X) {
        ctx.fillStyle = P.curb;
        ctx.fillRect(x - 55, 120, 110, 2540);
        ctx.fillStyle = asphalt;
        ctx.fillRect(x - 52, 116, 104, 2548);
    }
    for (const y of ROADS_Y) {
        ctx.fillStyle = P.curb;
        ctx.fillRect(120, y - 55, 2540, 110);
        ctx.fillStyle = asphalt;
        ctx.fillRect(116, y - 52, 2548, 104);
    }

    // Expansion seams: short ticks on both sides of every road.
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#B7A78F66';
    for (const x of ROADS_X) {
        for (let y = 110; y < 2670; y += 32) {
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x + side * 57, y);
                ctx.lineTo(x + side * 76, y);
                ctx.stroke();
            }
        }
    }
    for (const y of ROADS_Y) {
        for (let x = 110; x < 2670; x += 32) {
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x, y + side * 57);
                ctx.lineTo(x, y + side * 76);
                ctx.stroke();
            }
        }
    }

    // Seeded asphalt scuffs: faint dark and light patches along the roads.
    speckle(ctx, rng, 1400, n => {
        const vertical = rng() < 0.5;
        const px = vertical ? rng.pick(ROADS_X) + rng.range(-48, 48) : rng.range(120, 2660);
        const py = vertical ? rng.range(120, 2660) : rng.pick(ROADS_Y) + rng.range(-48, 48);
        return [px, py, rng.range(1, 12), rng.range(1, 5)];
    }, ['#72747A40', '#424B5030', '#424B5030', '#424B5030']);

    // Lane paint: dashed yellow centre line with pale edge lines, stopping
    // short of each junction so the intersections stay readable.
    ctx.lineWidth = 1;
    for (const x of ROADS_X) {
        for (let j = 0; j < 6; j++) {
            const top = ROADS_Y[j] + 65;
            const bottom = ROADS_Y[j + 1] - 65;
            dashLine(ctx, x, top, x, bottom, P.yellow, [17, 17]);
            for (const s of [-1, 1]) dashLine(ctx, x + s * 45, top, x + s * 45, bottom, '#E8E4D882');
        }
    }
    for (const y of ROADS_Y) {
        for (let i = 0; i < 6; i++) {
            const left = ROADS_X[i] + 65;
            const right = ROADS_X[i + 1] - 65;
            dashLine(ctx, left, y, right, y, P.yellow, [17, 17]);
            for (const s of [-1, 1]) dashLine(ctx, left, y + s * 45, right, y + s * 45, '#E8E4D882');
        }
    }

    // Junctions: fresh asphalt, zebra bars on all four sides, a drain
    // grate and a faint centre box.
    for (const node of world.nodes) {
        ctx.fillStyle = asphalt;
        ctx.fillRect(node.x - 53, node.y - 53, 106, 106);
        ctx.fillStyle = '#E8E4D8CC';
        for (let k = -38; k <= 38; k += 12) {
            ctx.fillRect(node.x + k, node.y - 70, 7, 17);
            ctx.fillRect(node.x + k, node.y + 53, 7, 17);
            ctx.fillRect(node.x - 70, node.y + k, 17, 7);
            ctx.fillRect(node.x + 53, node.y + k, 17, 7);
        }
        ctx.fillStyle = '#414D52';
        for (const s of [-1, 1]) ctx.fillRect(node.x + s * 43 - 5, node.y + 64, 11, 5);
        ctx.strokeStyle = '#B8C2B433';
        ctx.lineWidth = 1;
        ctx.strokeRect(node.x - 14, node.y - 14, 28, 28);
    }

    // Painted street names on the asphalt, one per named avenue.
    for (const y of [640, 1408, 2176]) {
        const name = y === 1408 ? 'OCEAN DRIVE' : y === 640 ? 'SOLANA AVE' : 'MARLIN WAY';
        for (const x of [810, 1570, 2330]) text(ctx, name, x, y + 40, 8, '#E8E4D884', 'center');
    }

    // The coast: seawall, promenade boards and warm sand. The bay water
    // itself is painted by the renderer; the sand and timber jetties live here.
    ctx.fillStyle = P.seawall;
    ctx.fillRect(world.coast - 13, 60, 24, 2760);
    ctx.fillStyle = P.sand;
    ctx.fillRect(world.coast + 11, 0, 200, world.height);
    ctx.fillStyle = '#D4C5AA';
    ctx.fillRect(world.coast - 5, 60, 91, 2760);
    ctx.fillStyle = '#EEE1CB';
    ctx.fillRect(world.coast - 5, 60, 4, 2760);
    ctx.strokeStyle = '#AFA89680';
    ctx.lineWidth = 1;
    for (let y = 60; y < 2820; y += 32) {
        ctx.beginPath();
        ctx.moveTo(world.coast, y);
        ctx.lineTo(world.coast + 84, y);
        ctx.stroke();
    }
    for (let n = 0; n < 350; n++) {
        ctx.fillStyle = n % 2 ? '#C3A57E55' : '#F6E7C188';
        ctx.fillRect(rng.range(2876, 2980), rng.range(0, 2880), 2, 1);
    }

    // Two jetties reaching into the bay, planked and bolted.
    for (const y of [840, 2310]) {
        ctx.fillStyle = '#765A4D';
        ctx.fillRect(2860, y + 7, 346, 43);
        ctx.fillStyle = '#C89A72';
        ctx.fillRect(2860, y, 346, 40);
        ctx.strokeStyle = '#8E6F58';
        for (let x = 2866; x < 3200; x += 12) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + 40);
            ctx.stroke();
        }
        for (let x = 2875; x < 3207; x += 50) {
            for (const sy of [0, 40]) ellipse(ctx, x, y + sy, 4, 4, P.wood);
        }
    }
    return sheet;
}

// Soft offset shadow under a building; the dusk value stretches it further.
export function drawBuildingShadow(ctx, b, dusk) {
    ctx.fillStyle = '#283E3D35';
    ctx.fillRect(b.x + 5 + dusk * 5, b.y + 6 + dusk, b.w, b.h + 7);
}

// --- buildings -------------------------------------------------------------
// A shallow south facade under a roof cap reads as height from above.
// Hotels get glass + pool, the diner its awning and sign, warehouses
// corrugated siding; everything else gets an AC unit and a shop front.

function shellAndRoof(ctx, b, glass, industrial) {
    const { x, y, w, h } = b;
    round(ctx, x, y + 10, w, h, 2, b.wall);
    ctx.fillStyle = glass ? P.glassDeep : b.wall;
    ctx.fillRect(x, y + h - 18, w, 30);
    ctx.fillStyle = '#635C6230';
    ctx.fillRect(x, y + h - 14, w, 26);
    const cap = glass ? P.roof : industrial ? P.corrugated : b.roof;
    round(ctx, x, y, w, h - 10, 3, cap);
    ctx.fillStyle = '#F6F1E75C';
    ctx.fillRect(x + 1, y + 1, w - 2, 3);
    ctx.fillRect(x + 1, y + 1, 3, h - 14);
    ctx.fillStyle = '#6859564A';
    ctx.fillRect(x + w - 5, y + 4, 5, h - 14);
    ctx.fillRect(x + 4, y + h - 15, w - 4, 5);
    ctx.strokeStyle = industrial ? '#AAA396' : '#EED6B738';
    ctx.lineWidth = 1;
    if (industrial) {
        for (let n = 10; n < w - 5; n += 9) {
            ctx.beginPath();
            ctx.moveTo(x + n, y + 6);
            ctx.lineTo(x + n, y + h - 19);
            ctx.stroke();
        }
    } else if (!glass) {
        for (let n = 12; n < h - 17; n += 9) {
            ctx.beginPath();
            ctx.moveTo(x + 8, y + n);
            ctx.lineTo(x + w - 8, y + n);
            ctx.stroke();
        }
    }
}

function hotelFace(ctx, b) {
    const { x, y, w, h } = b;
    ctx.fillStyle = P.glass;
    ctx.fillRect(x + 8, y + 8, w - 16, 21);
    ctx.fillStyle = P.glassDeep;
    for (let n = 12; n < w - 15; n += 21) {
        ctx.fillRect(x + n, y + 9, 16, 18);
        ctx.fillStyle = P.mullion;
        ctx.fillRect(x + n + 17, y + 9, 1, 18);
        ctx.fillStyle = P.glassDeep;
    }
    round(ctx, x + 23, y + 45, w - 46, h - 103, 9, '#CCC6B9');
    round(ctx, x + 28, y + 49, w - 56, h - 112, 7, P.poolDeep);
    round(ctx, x + 32, y + 52, w - 64, h - 118, 5, P.pool);
    ctx.strokeStyle = '#CEF0E9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 59);
    ctx.lineTo(x + w - 40, y + 59);
    ctx.stroke();
    for (let n = 0; n < 4; n++) {
        round(ctx, x + 18 + (n * (w - 40)) / 4, y + h - 45, 13, 23, 2, P.trim);
        ctx.fillStyle = P.carCoral;
        ctx.fillRect(x + 18 + (n * (w - 40)) / 4, y + h - 40, 13, 3);
    }
}

function dinerFace(ctx, b) {
    const { x, y, w, h } = b;
    round(ctx, x + 17, y + 14, w - 34, h - 46, 6, '#1C7580');
    ctx.strokeStyle = '#69C6C0';
    ctx.lineWidth = 2;
    for (let n = 0; n < 5; n++) {
        ctx.beginPath();
        ctx.moveTo(x + 23, y + 23 + n * 14);
        ctx.lineTo(x + w - 24, y + 23 + n * 14);
        ctx.stroke();
    }
    round(ctx, x + w / 2 - 40, y + 38, 80, 30, 4, P.cream);
    text(ctx, 'ROSA’S', x + w / 2, y + 59, 18, P.carCoral, 'center');
    ctx.fillStyle = P.trim;
    ctx.fillRect(x - 4, y + h - 20, w + 8, 14);
    for (let n = 0; n < w + 8; n += 16) {
        ctx.fillStyle = P.carCoral;
        ctx.fillRect(x - 4 + n, y + h - 20, 8, 14);
    }
}

function shopFace(ctx, b) {
    const { x, y, w } = b;
    const ax = x + w - 36;
    const ay = y + 19;
    round(ctx, ax + 2, ay + 3, 23, 18, 2, '#4D55554D');
    round(ctx, ax, ay, 23, 18, 2, '#C4C5B8');
    ellipse(ctx, ax + 11, ay + 9, 6, 6, '#828F8D');
    ctx.strokeStyle = '#BBC3BB';
    ctx.beginPath();
    ctx.moveTo(ax + 6, ay + 4);
    ctx.lineTo(ax + 16, ay + 14);
    ctx.moveTo(ax + 16, ay + 4);
    ctx.lineTo(ax + 6, ay + 14);
    ctx.stroke();
    if (w > 130) {
        round(ctx, x + 18, y + 17, 46, 25, 2, '#767E794D');
        round(ctx, x + 16, y + 15, 46, 25, 2, '#D0C4AF');
        ctx.fillStyle = '#839B9A';
        ctx.fillRect(x + 20, y + 19, 38, 17);
        ctx.fillStyle = '#C7DCD2';
        ctx.fillRect(x + 20, y + 19, 38, 2);
    }
}

export function drawBuilding(ctx, b, dusk = 0) {
    const { x, y, w, h } = b;
    const glass = b.kind === 'hotel';
    const industrial = b.kind === 'warehouse' || b.kind === 'garage';
    shellAndRoof(ctx, b, glass, industrial);
    if (glass) hotelFace(ctx, b);
    else if (b.kind === 'diner') dinerFace(ctx, b);
    else shopFace(ctx, b);

    // South-facing windows; at dusk some of them glow warm.
    const nwin = Math.max(2, Math.floor(w / 28));
    for (let n = 0; n < nwin; n++) {
        const wx = x + 10 + (n * (w - 20)) / nwin;
        ctx.fillStyle = dusk > 0.5 && (n + b.detail) % 3 ? P.lamp : P.glassDeep;
        ctx.fillRect(wx, y + h - 8, 15, 12);
        ctx.fillStyle = '#F4F7F886';
        ctx.fillRect(wx, y + h - 8, 15, 2);
        ctx.fillRect(wx + 7, y + h - 8, 1, 12);
    }

    // Garage roller doors, or a plain wooden door with a lamp beside it.
    if (b.kind === 'garage') {
        ctx.fillStyle = '#5B7774';
        ctx.fillRect(x + 23, y + h - 18, 70, 28);
        ctx.fillRect(x + w - 93, y + h - 18, 70, 28);
        ctx.strokeStyle = '#A9BAB0';
        for (let n = 0; n < 5; n++) {
            ctx.beginPath();
            ctx.moveTo(x + 24, y + h - 15 + n * 5);
            ctx.lineTo(x + 92, y + h - 15 + n * 5);
            ctx.moveTo(x + w - 92, y + h - 15 + n * 5);
            ctx.lineTo(x + w - 24, y + h - 15 + n * 5);
            ctx.stroke();
        }
    } else {
        ctx.fillStyle = P.wood;
        ctx.fillRect(x + w / 2 - 6, y + h - 9, 12, 20);
        ctx.fillStyle = P.lamp;
        ctx.fillRect(x + w / 2 + 2, y + h + 1, 2, 2);
    }

    // Shop signage, centred on the facade; hotels get a pink underline.
    if (b.label && b.kind !== 'diner') {
        const sy = industrial ? y + h - 40 : y + h - 31;
        const sw = Math.min(w - 12, b.label.length * 6 + 16);
        round(ctx, x + (w - sw) / 2, sy, sw, 16, 2, glass ? '#345966' : industrial ? '#4C6664' : P.trim);
        text(ctx, b.label, x + w / 2, sy + 11, Math.min(9, ((sw - 10) / b.label.length) * 1.6), industrial || glass ? P.trim : P.wood, 'center');
        if (glass) {
            ctx.fillStyle = P.pink;
            ctx.fillRect(x + (w - sw) / 2 + 4, sy + 14, sw - 8, 1);
        }
    }
}

// --- cars ------------------------------------------------------------------
// Drawn facing east, then rotated to the car's heading. Tires poke out
// past the body outline; vans get a cargo box, sports cars a dark nose
// stripe, taxis a roof sign, police a stripe plus flashing light bar.

export function drawCarShadow(ctx, c, dusk) {
    const def = CARS[c.type];
    ctx.save();
    ctx.translate(c.x + 5 + dusk * 5, c.y + 6 + dusk);
    ctx.rotate(c.h);
    round(ctx, -def.length / 2, -def.width / 2, def.length, def.width + 2, 6, '#243A3E40');
    ctx.restore();
}

function carWheelsAndShell(ctx, c, l, w) {
    const body = c.wreck ? '#6A655F' : c.color;
    for (const x of [-l * 0.31, l * 0.29]) {
        for (const y of [-w / 2 - 1, w / 2 - 2]) round(ctx, x - 4, y, 9, 4, 1, P.tire);
    }
    round(ctx, -l / 2, -w / 2, l, w, 5, body, P.ink);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-l / 2, -w / 2, l, w, 5);
    ctx.clip();
    ctx.fillStyle = '#1C191629';
    ctx.fillRect(-l / 2, 2, l, w / 2);
    ctx.fillStyle = '#F6F1E770';
    ctx.fillRect(-l / 2 + 4, -w / 2 + 1, l - 9, 2);
    ctx.restore();
    return body;
}

function carGlasswork(ctx, c, body, l, w) {
    if (c.type === 'van' || c.type === 'armored') {
        round(ctx, -l / 2 + 4, -w / 2 + 3, l * 0.62, w - 6, 2, body);
        ctx.strokeStyle = '#1C19163A';
        ctx.strokeRect(-l / 2 + 6, -w / 2 + 4, l * 0.57, w - 8);
        polygon(ctx, [[l * 0.2, -w / 2 + 3], [l * 0.33, -w / 2 + 4], [l * 0.33, w / 2 - 4], [l * 0.2, w / 2 - 3]], P.carGlass);
        return;
    }
    polygon(ctx, [[2, -w / 2 + 3], [10, -w / 2 + 4], [12, w / 2 - 4], [2, w / 2 - 3]], P.carGlass);
    polygon(ctx, [[-15, -w / 2 + 4], [-10, -w / 2 + 3], [-8, w / 2 - 3], [-15, w / 2 - 4]], P.carGlass);
    round(ctx, -9, -w / 2 + 3, 12, w - 6, 2, body);
    ctx.fillStyle = '#F6F1E74A';
    ctx.fillRect(-8, -w / 2 + 3, 9, 1);
    ctx.strokeStyle = P.glint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(5, -w / 2 + 5);
    ctx.lineTo(8, -w / 2 + 6);
    ctx.stroke();
    if (c.type === 'sports') {
        ctx.fillStyle = P.sportsInk;
        ctx.fillRect(-l / 2 + 3, -w / 2 - 1, 3, w + 2);
        ctx.fillStyle = '#1C19165A';
        ctx.fillRect(14, -4, 6, 1);
        ctx.fillRect(14, 3, 6, 1);
    }
}

function carTrim(ctx, c, time, dusk, l, w) {
    if (c.type === 'armored') {
        round(ctx, -19, -8, 25, 16, 2, '#637F7C', P.ink);
        for (const x of [-16, 2]) {
            for (const y of [-6, 6]) ellipse(ctx, x, y, 1.2, 1.2, P.trim);
        }
        text(ctx, 'BT', -7, 3, 7, P.trim, 'center');
    }
    ctx.fillStyle = P.carGlass;
    ctx.fillRect(0, -w / 2 - 2, 5, 2);
    ctx.fillRect(0, w / 2, 5, 2);
    ctx.fillStyle = P.headlamp;
    ctx.fillRect(l / 2 - 3, -w / 2 + 3, 2, 5);
    ctx.fillRect(l / 2 - 3, w / 2 - 8, 2, 5);
    ctx.fillStyle = c.braking ? '#FF796D' : P.taillight;
    ctx.fillRect(-l / 2 + 1, -w / 2 + 3, 2, 4);
    ctx.fillRect(-l / 2 + 1, w / 2 - 7, 2, 4);
    if (c.type === 'taxi') {
        round(ctx, -5, -4, 10, 8, 1, P.taxi, P.ink);
        text(ctx, 'TAXI', 0, 2, 4, P.ink, 'center');
    }
    if (c.type === 'police') {
        ctx.fillStyle = P.policeStripe;
        ctx.fillRect(-8, -w / 2 + 1, 14, 2);
        ctx.fillRect(-8, w / 2 - 3, 14, 2);
        round(ctx, -4, -7, 5, 14, 1, '#344A55');
        ctx.fillStyle = Math.sin(time * 13 + c.id) > 0 ? P.policeCyan : '#4E8E9C';
        ctx.fillRect(-4, -7, 5, 6);
        ctx.fillStyle = Math.sin(time * 13 + c.id) < 0 ? P.policeRed : '#9A5460';
        ctx.fillRect(-4, 1, 5, 6);
        if (c.ai === 'police' && Math.sin(time * 13) > 0 && dusk > 0.3) {
            ctx.globalAlpha = 0.22;
            ellipse(ctx, -2, -7, 14, 9, P.policeCyan);
            ellipse(ctx, -2, 7, 14, 9, P.policeRed);
            ctx.globalAlpha = 1;
        }
    }
}

function carWear(ctx, c, def) {
    if (c.hp < def.hp * 0.45) {
        ctx.strokeStyle = '#675652';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, -6);
        ctx.lineTo(8, -1);
        ctx.lineTo(5, 2);
        ctx.lineTo(10, 5);
        ctx.stroke();
    }
    if (c.wreck) {
        ctx.fillStyle = '#3C3D3E88';
        ctx.fillRect(-12, -7, 28, 14);
        ctx.strokeStyle = P.rust;
        ctx.beginPath();
        ctx.moveTo(-12, -4);
        ctx.lineTo(13, 5);
        ctx.stroke();
    }
}

export function drawCar(ctx, c, time, dusk = 0) {
    const def = CARS[c.type];
    const l = def.length;
    const w = def.width;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.h);
    const body = carWheelsAndShell(ctx, c, l, w);
    carGlasswork(ctx, c, body, l, w);
    carTrim(ctx, c, time, dusk, l, w);
    carWear(ctx, c, def);
    ctx.restore();
}

// --- people ----------------------------------------------------------------
// A small top-down figure — shoes, torso, hands or a raised arm, head
// with hair, plus officer cap and the player's coral jacket flash.

export function drawPersonShadow(ctx, p, dusk) {
    ellipse(ctx, p.x + 5 + dusk * 5, p.y + 6 + dusk, 8, 4, '#243A3E40');
}

export function drawPerson(ctx, p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.h || 0);
    if (p.dead) ctx.rotate(Math.PI / 2);
    const stride = p.moving ? Math.sin(time * 14 + (p.id || 0)) * 2.3 : 0;
    round(ctx, -4 + stride, -6, 5, 3, 1, P.pearl, P.ink);
    round(ctx, -4 - stride, 3, 5, 3, 1, P.pearl, P.ink);
    round(ctx, -7, -5, 10, 10, 3, p.dead ? '#87655B' : p.jacket || P.teal, P.ink);
    ctx.fillStyle = '#1C191635';
    ctx.fillRect(-6, 2, 8, 2);
    ctx.fillStyle = '#F6F1E744';
    ctx.fillRect(-5, -4, 6, 1);
    if (p.armed || p.punch > 0) {
        round(ctx, 1, -6, p.punch > 0 ? 12 : 8, 3, 1, p.skin || '#C48A62', P.ink);
        if (p.armed) {
            ctx.fillStyle = P.trousers;
            ctx.fillRect(7, -7, 7, 3);
            if (p.flash > 0) polygon(ctx, [[15, -7], [21, -9], [19, -5], [24, -4], [18, -2], [15, -4]], P.mango);
        }
    } else {
        ellipse(ctx, -1, -6, 2, 2, p.skin || '#C48A62');
        ellipse(ctx, -1, 6, 2, 2, p.skin || '#C48A62');
    }
    ellipse(ctx, 1, 0, 4.5, 4.4, p.skin || '#C48A62');
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = p.hair || P.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, Math.PI * 0.35, Math.PI * 1.65);
    ctx.fill();
    if (p.role === 'officer') {
        round(ctx, -2, -4, 5, 8, 2, P.navy);
        ctx.fillStyle = P.mango;
        ctx.fillRect(-2, -1, 2, 2);
    }
    if (p.isPlayer) {
        ctx.fillStyle = P.carCoral;
        ctx.fillRect(-7, -2, 2, 4);
    }
    ctx.restore();
}

// --- props -----------------------------------------------------------------
// Palms (swaying fronds), lamps (glow at dusk), benches, beach umbrellas
// with chairs, cargo containers and diner table sets.

export function drawPropShadow(ctx, p, dusk) {
    if (p.kind === 'palm') {
        ellipse(ctx, p.x + 12 + dusk * 4, p.y + 7, 23 * p.scale, 9 * p.scale, '#294C4430');
    } else if (p.kind === 'umbrella') {
        ellipse(ctx, p.x + 8, p.y + 7, 17, 10, '#294C4435');
    } else if (p.kind === 'lamp') {
        ctx.strokeStyle = '#294C4435';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 18, p.y + 10);
        ctx.stroke();
    }
}

function palmTree(ctx, p, time) {
    const { x, y } = p;
    const s = p.scale || 1;
    const tx = x - 3 * s;
    const ty = y - 17 * s;
    ellipse(ctx, x, y, 7, 4, '#B89B6D');
    ctx.strokeStyle = '#79634B';
    ctx.lineWidth = 5 * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 5 * s, y - 8 * s, tx, ty);
    ctx.stroke();
    ctx.strokeStyle = '#CEAE79';
    ctx.lineWidth = 2;
    ctx.stroke();
    const sway = Math.sin(time * 0.9 + p.phase) * 0.055;
    for (let n = 0; n < 7; n++) {
        const a = (n * Math.PI * 2) / 7 + sway;
        const len = (n % 2 ? 28 : 34) * s;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(10 * s, -10 * s, len - 5, -8 * s, len, 3 * s);
        ctx.bezierCurveTo(len - 10, 0, 12 * s, 7 * s, 0, 0);
        ctx.fillStyle = n % 2 ? '#39866D' : '#4D9B77';
        ctx.fill();
        ctx.strokeStyle = '#8BB58588';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(1, 0);
        ctx.quadraticCurveTo(14 * s, -3 * s, len - 4, 2 * s);
        ctx.stroke();
        ctx.restore();
    }
    ellipse(ctx, tx, ty, 4 * s, 3 * s, '#7EAF79');
}

function streetLamp(ctx, p, dusk) {
    const { x, y } = p;
    ellipse(ctx, x, y, 4, 3, '#8D938C');
    ctx.strokeStyle = '#647C78';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 1, y - 22);
    ctx.quadraticCurveTo(x - 1, y - 28, x + 8, y - 28);
    ctx.stroke();
    round(ctx, x + 3, y - 31, 11, 5, 2, dusk > 0.3 ? P.lamp : P.trim);
    if (dusk > 0.3) {
        const g = ctx.createRadialGradient(x + 8, y - 25, 1, x + 8, y - 25, 34);
        g.addColorStop(0, '#FFE08A38');
        g.addColorStop(1, '#FFE08A00');
        ctx.fillStyle = g;
        ctx.fillRect(x - 27, y - 60, 70, 70);
    }
}

export function drawProp(ctx, p, time, dusk) {
    const { x, y } = p;
    if (p.kind === 'palm') {
        palmTree(ctx, p, time);
    } else if (p.kind === 'lamp') {
        streetLamp(ctx, p, dusk);
    } else if (p.kind === 'bench') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.h || 0);
        round(ctx, -13, -5, 26, 10, 2, '#967256');
        ctx.fillStyle = '#C7A779';
        ctx.fillRect(-12, -4, 24, 2);
        ctx.fillRect(-12, 0, 24, 2);
        ctx.fillStyle = '#536C66';
        ctx.fillRect(-10, -7, 2, 14);
        ctx.fillRect(8, -7, 2, 14);
        ctx.restore();
    } else if (p.kind === 'umbrella') {
        ellipse(ctx, x, y, 18, 18, P.trim);
        for (let n = 0; n < 8; n++) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.arc(x, y, 18, (n * Math.PI) / 4, ((n + 1) * Math.PI) / 4);
            ctx.closePath();
            ctx.fillStyle = n % 2 ? p.color : P.trim;
            ctx.fill();
        }
        ellipse(ctx, x, y, 3, 3, P.trim);
        round(ctx, x - 10, y + 22, 20, 8, 1, P.trim);
        round(ctx, x - 10, y + 33, 20, 8, 1, P.trim);
    } else if (p.kind === 'container') {
        round(ctx, x - 43, y - 16, 86, 32, 2, p.color);
        ctx.fillStyle = '#1C191633';
        ctx.fillRect(x - 43, y + 9, 86, 7);
        ctx.strokeStyle = '#E4D2BA55';
        for (let n = -36; n < 40; n += 8) {
            ctx.beginPath();
            ctx.moveTo(x + n, y - 13);
            ctx.lineTo(x + n, y + 11);
            ctx.stroke();
        }
        text(ctx, 'NB • CARGO', x, y + 3, 6, P.trim, 'center');
    } else if (p.kind === 'tables') {
        for (const sx of [-47, 0, 47]) {
            ellipse(ctx, x + sx, y, 13, 10, P.trim);
            for (const sy of [-17, 17]) round(ctx, x + sx - 5, y + sy - 4, 10, 8, 2, P.carCoral);
            ellipse(ctx, x + sx + 1, y - 1, 2, 2, P.teal);
        }
    }
}

// Pickups bob and tilt gently: a health cross, a cash dollar, or ammo bars.
export function drawPickup(ctx, p, time) {
    const y = p.y + Math.sin(time * 3 + p.phase) * 2;
    ellipse(ctx, p.x, p.y + 5, 11, 5, '#244C4533');
    ctx.save();
    ctx.translate(p.x, y);
    ctx.rotate(Math.sin(time * 2 + p.phase) * 0.1);
    round(ctx, -8, -8, 16, 16, 4, p.kind === 'health' ? P.carCoral : p.kind === 'cash' ? P.teal : P.mango, P.ink);
    if (p.kind === 'health') {
        ctx.fillStyle = P.paper;
        ctx.fillRect(-2, -5, 4, 10);
        ctx.fillRect(-5, -2, 10, 4);
    } else if (p.kind === 'cash') {
        text(ctx, '$', 0, 5, 14, P.trim, 'center');
    } else {
        ctx.fillStyle = P.wood;
        for (let n = -4; n <= 4; n += 4) round(ctx, n - 1, -5, 2, 9, 1, P.trim);
    }
    ctx.restore();
}
