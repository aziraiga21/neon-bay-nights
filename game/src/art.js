import { PALETTE as P, CARS, ROADS_X, ROADS_Y } from './config.js';
import { createRandom } from './random.js';
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
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
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
    ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
}
export function makeGround(world, dusk = false) {
    const asphalt = dusk ? P.asphaltDusk : P.asphalt, sidewalk = dusk ? P.sidewalkDusk : P.sidewalk;
    const c = document.createElement('canvas');
    c.width = world.width;
    c.height = world.height;
    const ctx = c.getContext('2d');
    const rng = createRandom(world.seed + 41);
    ctx.fillStyle = '#B3BEA7';
    ctx.fillRect(0, 0, world.water, c.height);
    ctx.fillStyle = sidewalk;
    ctx.fillRect(70, 70, 2700, 2700);
    // Parcel paving and planted courtyards are visible through alleys between buildings.
    for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) {
            const x = ROADS_X[i] + 76, y = ROADS_Y[j] + 76;
            ctx.fillStyle = j >= 4 ? '#B8B6A7' : (i + j) % 2 ? '#D8C6AE' : '#C8C9B2';
            ctx.fillRect(x, y, 232, 232);
            ctx.strokeStyle = '#A7AB9880';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 8, y + 8, 216, 216);
        }
    }
    for (const p of world.parks) {
        round(ctx, p.x - 5, p.y - 5, p.w + 10, p.h + 10, 9, P.grass);
        ctx.fillStyle = sidewalk;
        ctx.fillRect(p.x + 99, p.y, 22, p.h);
        ctx.fillRect(p.x, p.y + 100, p.w, 22);
        ellipse(ctx, p.x + 110, p.y + 111, 39, 31, P.concrete);
        ellipse(ctx, p.x + 110, p.y + 109, 34, 27, P.poolDeep);
        ellipse(ctx, p.x + 110, p.y + 108, 28, 22, P.pool);
        ellipse(ctx, p.x + 110, p.y + 106, 6, 6, P.trim);
        for (let n = 0; n < 13; n++) {
            const x = p.x + rng.range(10, 210), y = p.y + rng.range(10, 210);
            if (Math.abs(x - p.x - 110) > 42 && Math.abs(y - p.y - 110) > 42) {
                ellipse(ctx, x, y, 4, 3, '#D7C489');
            }
        }
    }
    // Sidewalk seams and curb lips frame a continuous, connected road grid.
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
    // Original asphalt patchwork, drain grates, and paint wear, all seeded.
    for (let n = 0; n < 1400; n++) {
        const vert = rng() < .5, x = vert ? rng.pick(ROADS_X) + rng.range(-48, 48) : rng.range(120, 2660), y = vert ? rng.range(120, 2660) : rng.pick(ROADS_Y) + rng.range(-48, 48);
        ctx.fillStyle = n % 4 === 0 ? '#72747A40' : '#424B5030';
        ctx.fillRect(x, y, rng.range(1, 12), rng.range(1, 5));
    }
    ctx.lineWidth = 1;
    for (const x of ROADS_X) {
        for (let j = 0; j < 6; j++) {
            const a = ROADS_Y[j] + 65, b = ROADS_Y[j + 1] - 65;
            ctx.strokeStyle = P.yellow;
            ctx.setLineDash([17, 17]);
            ctx.beginPath();
            ctx.moveTo(x, a);
            ctx.lineTo(x, b);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#E8E4D882';
            for (const s of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x + s * 45, a);
                ctx.lineTo(x + s * 45, b);
                ctx.stroke();
            }
        }
    }
    for (const y of ROADS_Y) {
        for (let i = 0; i < 6; i++) {
            const a = ROADS_X[i] + 65, b = ROADS_X[i + 1] - 65;
            ctx.strokeStyle = P.yellow;
            ctx.setLineDash([17, 17]);
            ctx.beginPath();
            ctx.moveTo(a, y);
            ctx.lineTo(b, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#E8E4D882';
            for (const s of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(a, y + s * 45);
                ctx.lineTo(b, y + s * 45);
                ctx.stroke();
            }
        }
    }
    for (const n of world.nodes) {
        ctx.fillStyle = asphalt;
        ctx.fillRect(n.x - 53, n.y - 53, 106, 106);
        ctx.fillStyle = '#E8E4D8CC';
        for (let k = -38; k <= 38; k += 12) {
            ctx.fillRect(n.x + k, n.y - 70, 7, 17);
            ctx.fillRect(n.x + k, n.y + 53, 7, 17);
            ctx.fillRect(n.x - 70, n.y + k, 17, 7);
            ctx.fillRect(n.x + 53, n.y + k, 17, 7);
        }
        ctx.fillStyle = '#414D52';
        for (const s of [-1, 1]) {
            ctx.fillRect(n.x + s * 43 - 5, n.y + 64, 11, 5);
        }
        ctx.strokeStyle = '#B8C2B433';
        ctx.lineWidth = 1;
        ctx.strokeRect(n.x - 14, n.y - 14, 28, 28);
    }
    for (const y of [640, 1408, 2176]) {
        for (const x of [810, 1570, 2330]) {
            text(ctx, y === 1408 ? 'OCEAN DRIVE' : y === 640 ? 'SOLANA AVE' : 'MARLIN WAY', x, y + 40, 8, '#E8E4D884', 'center');
        }
    }
    // Coast: seawall, promenade, warm sand and an unbroken teal bay.
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
    // Two timber jetties and moored original little boats.
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
            for (const sy of [0, 40]) {
                ellipse(ctx, x, y + sy, 4, 4, P.wood);
            }
        }
    }
    return c;
}
export function drawBuildingShadow(ctx, b, dusk) {
    ctx.fillStyle = '#283E3D35';
    ctx.fillRect(b.x + 5 + dusk * 5, b.y + 6 + dusk, b.w, b.h + 7);
}
export function drawBuilding(ctx, b, dusk = 0) {
    const { x, y, w, h } = b;
    const glass = b.kind === 'hotel';
    const industrial = b.kind === 'warehouse' || b.kind === 'garage';
    // A shallow south facade, capped by a roof, gives the solid footprint a readable height.
    round(ctx, x, y + 10, w, h, 2, b.wall);
    ctx.fillStyle = glass ? P.glassDeep : b.wall;
    ctx.fillRect(x, y + h - 18, w, 30);
    ctx.fillStyle = '#635C6230';
    ctx.fillRect(x, y + h - 14, w, 26);
    const roof = glass ? P.roof : industrial ? P.corrugated : b.roof;
    round(ctx, x, y, w, h - 10, 3, roof);
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
    }
    else if (!glass) {
        for (let n = 12; n < h - 17; n += 9) {
            ctx.beginPath();
            ctx.moveTo(x + 8, y + n);
            ctx.lineTo(x + w - 8, y + n);
            ctx.stroke();
        }
    }
    if (glass) {
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
            round(ctx, x + 18 + n * (w - 40) / 4, y + h - 45, 13, 23, 2, P.trim);
            ctx.fillStyle = P.carCoral;
            ctx.fillRect(x + 18 + n * (w - 40) / 4, y + h - 40, 13, 3);
        }
    }
    else if (b.kind === 'diner') {
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
    else {
        const ax = x + w - 36, ay = y + 19;
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
    // South-facing windows, doors, and original shop signage.
    const nwin = Math.max(2, Math.floor(w / 28));
    for (let n = 0; n < nwin; n++) {
        const wx = x + 10 + n * (w - 20) / nwin;
        ctx.fillStyle = dusk > .5 && (n + b.detail) % 3 ? P.lamp : P.glassDeep;
        ctx.fillRect(wx, y + h - 8, 15, 12);
        ctx.fillStyle = '#F4F7F886';
        ctx.fillRect(wx, y + h - 8, 15, 2);
        ctx.fillRect(wx + 7, y + h - 8, 1, 12);
    }
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
    }
    else {
        ctx.fillStyle = P.wood;
        ctx.fillRect(x + w / 2 - 6, y + h - 9, 12, 20);
        ctx.fillStyle = P.lamp;
        ctx.fillRect(x + w / 2 + 2, y + h + 1, 2, 2);
    }
    if (b.label && b.kind !== 'diner') {
        const sy = industrial ? y + h - 40 : y + h - 31;
        const sw = Math.min(w - 12, b.label.length * 6 + 16);
        round(ctx, x + (w - sw) / 2, sy, sw, 16, 2, glass ? '#345966' : industrial ? '#4C6664' : P.trim);
        text(ctx, b.label, x + w / 2, sy + 11, Math.min(9, (sw - 10) / b.label.length * 1.6), industrial || glass ? P.trim : P.wood, 'center');
        if (glass) {
            ctx.fillStyle = P.pink;
            ctx.fillRect(x + (w - sw) / 2 + 4, sy + 14, sw - 8, 1);
        }
    }
}
export function drawCarShadow(ctx, c, dusk) {
    const def = CARS[c.type];
    ctx.save();
    ctx.translate(c.x + 5 + dusk * 5, c.y + 6 + dusk);
    ctx.rotate(c.h);
    round(ctx, -def.length / 2, -def.width / 2, def.length, def.width + 2, 6, '#243A3E40');
    ctx.restore();
}
export function drawCar(ctx, c, time, dusk = 0) {
    const def = CARS[c.type], l = def.length, w = def.width;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.h);
    const body = c.wreck ? '#6A655F' : c.color;
    // Tires stay visible outside the one-pixel ink body contour.
    for (const x of [-l * .31, l * .29]) {
        for (const y of [-w / 2 - 1, w / 2 - 2]) {
            round(ctx, x - 4, y, 9, 4, 1, P.tire);
        }
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
    if (c.type === 'van' || c.type === 'armored') {
        round(ctx, -l / 2 + 4, -w / 2 + 3, l * .62, w - 6, 2, body);
        ctx.strokeStyle = '#1C19163A';
        ctx.strokeRect(-l / 2 + 6, -w / 2 + 4, l * .57, w - 8);
        polygon(ctx, [[l * .2, -w / 2 + 3], [l * .33, -w / 2 + 4], [l * .33, w / 2 - 4], [l * .2, w / 2 - 3]], P.carGlass);
    }
    else {
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
    if (c.type === 'armored') {
        round(ctx, -19, -8, 25, 16, 2, '#637F7C', P.ink);
        for (const x of [-16, 2]) for (const y of [-6, 6]) ellipse(ctx, x, y, 1.2, 1.2, P.trim);
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
        if (c.ai === 'police' && Math.sin(time * 13) > 0 && dusk > .3) {
            ctx.globalAlpha = .22;
            ellipse(ctx, -2, -7, 14, 9, P.policeCyan);
            ellipse(ctx, -2, 7, 14, 9, P.policeRed);
            ctx.globalAlpha = 1;
        }
    }
    if (c.hp < def.hp * .45) {
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
    ctx.restore();
}
export function drawPersonShadow(ctx, p, dusk) {
    ellipse(ctx, p.x + 5 + dusk * 5, p.y + 6 + dusk, 8, 4, '#243A3E40');
}
export function drawPerson(ctx, p, time) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.h || 0);
    if (p.dead) {
        ctx.rotate(Math.PI / 2);
    }
    const walk = p.moving ? Math.sin(time * 14 + (p.id || 0)) * 2.3 : 0;
    round(ctx, -4 + walk, -6, 5, 3, 1, P.pearl, P.ink);
    round(ctx, -4 - walk, 3, 5, 3, 1, P.pearl, P.ink);
    round(ctx, -7, -5, 10, 10, 3, p.dead ? '#87655B' : (p.jacket || P.teal), P.ink);
    ctx.fillStyle = '#1C191635';
    ctx.fillRect(-6, 2, 8, 2);
    ctx.fillStyle = '#F6F1E744';
    ctx.fillRect(-5, -4, 6, 1);
    if (p.armed || p.punch > 0) {
        round(ctx, 1, -6, p.punch > 0 ? 12 : 8, 3, 1, p.skin || '#C48A62', P.ink);
        if (p.armed) {
            ctx.fillStyle = P.trousers;
            ctx.fillRect(7, -7, 7, 3);
            if (p.flash > 0) {
                polygon(ctx, [[15, -7], [21, -9], [19, -5], [24, -4], [18, -2], [15, -4]], P.mango);
            }
        }
    }
    else {
        ellipse(ctx, -1, -6, 2, 2, p.skin || '#C48A62');
        ellipse(ctx, -1, 6, 2, 2, p.skin || '#C48A62');
    }
    ellipse(ctx, 1, 0, 4.5, 4.4, p.skin || '#C48A62');
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = p.hair || P.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, Math.PI * .35, Math.PI * 1.65);
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
export function drawPropShadow(ctx, p, dusk) {
    if (p.kind === 'palm') {
        ellipse(ctx, p.x + 12 + dusk * 4, p.y + 7, 23 * p.scale, 9 * p.scale, '#294C4430');
    }
    else if (p.kind === 'umbrella') {
        ellipse(ctx, p.x + 8, p.y + 7, 17, 10, '#294C4435');
    }
    else if (p.kind === 'lamp') {
        ctx.strokeStyle = '#294C4435';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 18, p.y + 10);
        ctx.stroke();
    }
}
export function drawProp(ctx, p, time, dusk) {
    const { x, y } = p;
    if (p.kind === 'palm') {
        const s = p.scale || 1, tx = x - 3 * s, ty = y - 17 * s;
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
        const sway = Math.sin(time * .9 + p.phase) * .055;
        for (let n = 0; n < 7; n++) {
            const a = n * Math.PI * 2 / 7 + sway, L = (n % 2 ? 28 : 34) * s;
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(10 * s, -10 * s, L - 5, -8 * s, L, 3 * s);
            ctx.bezierCurveTo(L - 10, 0, 12 * s, 7 * s, 0, 0);
            ctx.fillStyle = n % 2 ? '#39866D' : '#4D9B77';
            ctx.fill();
            ctx.strokeStyle = '#8BB58588';
            ctx.lineWidth = .8;
            ctx.beginPath();
            ctx.moveTo(1, 0);
            ctx.quadraticCurveTo(14 * s, -3 * s, L - 4, 2 * s);
            ctx.stroke();
            ctx.restore();
        }
        ellipse(ctx, tx, ty, 4 * s, 3 * s, '#7EAF79');
    }
    else if (p.kind === 'lamp') {
        ellipse(ctx, x, y, 4, 3, '#8D938C');
        ctx.strokeStyle = '#647C78';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1, y - 22);
        ctx.quadraticCurveTo(x - 1, y - 28, x + 8, y - 28);
        ctx.stroke();
        round(ctx, x + 3, y - 31, 11, 5, 2, dusk > .3 ? P.lamp : P.trim);
        if (dusk > .3) {
            const g = ctx.createRadialGradient(x + 8, y - 25, 1, x + 8, y - 25, 34);
            g.addColorStop(0, '#FFE08A38');
            g.addColorStop(1, '#FFE08A00');
            ctx.fillStyle = g;
            ctx.fillRect(x - 27, y - 60, 70, 70);
        }
    }
    else if (p.kind === 'bench') {
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
    }
    else if (p.kind === 'umbrella') {
        ellipse(ctx, x, y, 18, 18, P.trim);
        for (let n = 0; n < 8; n++) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.arc(x, y, 18, n * Math.PI / 4, (n + 1) * Math.PI / 4);
            ctx.closePath();
            ctx.fillStyle = n % 2 ? p.color : P.trim;
            ctx.fill();
        }
        ellipse(ctx, x, y, 3, 3, P.trim);
        round(ctx, x - 10, y + 22, 20, 8, 1, P.trim);
        round(ctx, x - 10, y + 33, 20, 8, 1, P.trim);
    }
    else if (p.kind === 'container') {
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
    }
    else if (p.kind === 'tables') {
        for (const sx of [-47, 0, 47]) {
            ellipse(ctx, x + sx, y, 13, 10, P.trim);
            for (const sy of [-17, 17]) {
                round(ctx, x + sx - 5, y + sy - 4, 10, 8, 2, P.carCoral);
            }
            ellipse(ctx, x + sx + 1, y - 1, 2, 2, P.teal);
        }
    }
}
export function drawPickup(ctx, p, time) {
    const y = p.y + Math.sin(time * 3 + p.phase) * 2;
    ellipse(ctx, p.x, p.y + 5, 11, 5, '#244C4533');
    ctx.save();
    ctx.translate(p.x, y);
    ctx.rotate(Math.sin(time * 2 + p.phase) * .1);
    round(ctx, -8, -8, 16, 16, 4, p.kind === 'health' ? P.carCoral : p.kind === 'cash' ? P.teal : P.mango, P.ink);
    if (p.kind === 'health') {
        ctx.fillStyle = P.paper;
        ctx.fillRect(-2, -5, 4, 10);
        ctx.fillRect(-5, -2, 10, 4);
    }
    else if (p.kind === 'cash') {
        text(ctx, '$', 0, 5, 14, P.trim, 'center');
    }
    else {
        ctx.fillStyle = P.wood;
        for (let n = -4; n <= 4; n += 4) {
            round(ctx, n - 1, -5, 2, 9, 1, P.trim);
        }
    }
    ctx.restore();
}
