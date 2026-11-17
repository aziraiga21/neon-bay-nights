// Neon Bay Nights — HUD: everything Jax needs at a glance, and nothing
// he doesn't. Cash and health top-left, wanted stars top-right, the job
// objective across the top, speed bottom-right, and a live minimap
// bottom-left. Tab opens the same map full-screen, where a click drops
// a waypoint.
import { PALETTE as P, ROADS_X, ROADS_Y, money, clamp } from './config.js';
import { round, text, ellipse, polygon } from './art.js';

const MAP_W = 432;
const MAP_H = 360;
const MINI_W = 200;
const MINI_H = 167;

// --- baked minimap ---------------------------------------------------------
// One small painting of the whole city, drawn once per world: water and
// sand on the east edge, asphalt avenues, block paving, and a dot of
// colour per building. The live dots (player, cars, police, marker) are
// painted over it every frame.

export function makeMap(world) {
    const sheet = document.createElement('canvas');
    sheet.width = MAP_W;
    sheet.height = MAP_H;
    const ctx = sheet.getContext('2d');
    const sx = MAP_W / world.width;
    const sy = MAP_H / world.height;
    ctx.fillStyle = '#C9BFA9';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = P.water;
    ctx.fillRect(world.water * sx, 0, MAP_W - world.water * sx, MAP_H);
    ctx.fillStyle = P.sand;
    ctx.fillRect(world.coast * sx, 0, (world.water - world.coast) * sx, MAP_H);
    ctx.fillStyle = P.grass;
    for (const park of world.parks || []) {
        ctx.fillRect(park.x * sx, park.y * sy, park.w * sx, park.h * sy);
    }
    ctx.fillStyle = P.asphalt;
    for (const x of ROADS_X) ctx.fillRect((x - 52) * sx, 0, 104 * sx, MAP_H);
    for (const y of ROADS_Y) ctx.fillRect(0, (y - 52) * sy, MAP_W, 104 * sy);
    for (const b of world.buildings || []) {
        ctx.fillStyle = b.wall || P.coral;
        ctx.fillRect(b.x * sx, b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    }
    ctx.fillStyle = P.teal;
    for (const s of world.services || []) {
        ctx.fillRect(s.x * sx - 2, s.y * sy - 2, 4, 4);
    }
    return sheet;
}

// --- shared dot layer ------------------------------------------------------

function paintDots(ctx, game, ox, oy, scale) {
    const dot = (x, y, r, color) => ellipse(ctx, ox + x * scale, oy + y * scale, r, r, color);
    for (const car of game.cars) {
        if (car.wreck) continue;
        dot(car.x, car.y, car.type === 'police' ? 3 : 2, car.type === 'police' ? P.policeRed : P.paper);
    }
    for (const officer of game.police.officers) {
        if (!officer.dead) dot(officer.x, officer.y, 2, P.policeRed);
    }
    for (const foe of game.enemies) {
        if (!foe.dead) dot(foe.x, foe.y, 2, P.carCoral);
    }
    const marker = game.mission.marker;
    if (marker) {
        const pulse = 4 + Math.sin(game.time * 4) * 1.5;
        dot(marker.x, marker.y, pulse, P.mango);
        dot(marker.x, marker.y, 2.5, P.paper);
    }
    if (game.waypoint) dot(game.waypoint.x, game.waypoint.y, 3, P.cyan);
    const p = game.player;
    ellipse(ctx, ox + p.x * scale, oy + p.y * scale, 4, 4, P.mango);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ox + p.x * scale, oy + p.y * scale, 4, 0, Math.PI * 2);
    ctx.stroke();
}

// --- the frame HUD ---------------------------------------------------------

export function drawHUD(ctx, game, renderer) {
    const w = renderer?.width || 1280;
    const h = renderer?.height || 800;
    drawVitals(ctx, game);
    drawWanted(ctx, game, w);
    drawObjective(ctx, game, w);
    drawMinimap(ctx, game, renderer, h);
    drawSpeed(ctx, game, w, h);
    drawToast(ctx, game, w);
    drawBust(ctx, game, w, h);
    drawHint(ctx, game, w, h);
    if (game.mission.dialogue) drawDialogue(ctx, game, w, h);
}

function panel(ctx, x, y, pw, ph) {
    round(ctx, x, y, pw, ph, 6, '#18333BD9', P.ink);
}

function drawVitals(ctx, game) {
    const p = game.player;
    panel(ctx, 14, 12, 208, 86);
    text(ctx, money(p.cash), 26, 36, 20, P.mango);
    text(ctx, `REP ${game.stats.reputation}`, 150, 34, 10, P.paper, 'left');
    const pct = clamp(p.health / 100, 0, 1);
    text(ctx, 'HEALTH', 26, 56, 9, P.paper);
    round(ctx, 26, 62, 150, 9, 3, '#3A2E28');
    round(ctx, 26, 62, 150 * pct, 9, 3, pct > 0.5 ? '#7FB069' : pct > 0.25 ? P.mango : P.carCoral);
    text(ctx, `${Math.ceil(p.health)}`, 182, 71, 10, P.paper);
    text(ctx, `AMMO ${p.ammo}`, 26, 90, 11, p.ammo === 0 ? P.carCoral : P.paper);
    if (p.car) text(ctx, `${p.car.type.toUpperCase()} · ${Math.ceil(p.car.hp)} HP`, 96, 90, 10, P.paper);
}

function drawWanted(ctx, game, w) {
    const stars = game.police.stars;
    panel(ctx, w - 244, 12, 230, 52);
    if (stars > 0) text(ctx, 'WANTED', w - 232, 30, 9, P.policeRed);
    else text(ctx, 'NEON BAY PD', w - 232, 30, 9, P.paper);
    for (let i = 0; i < 5; i++) {
        const cx = w - 218 + i * 30;
        star(ctx, cx, 48, 9, i < stars ? P.mango : '#5A6A66');
    }
    text(ctx, game.clock, w - 26, 30, 12, P.paper, 'right');
    text(ctx, game.dusk > 0.55 ? 'SUNSET' : 'DAY', w - 26, 52, 9, P.paper, 'right');
}

function star(ctx, cx, cy, r, color) {
    const points = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.45;
        points.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    polygon(ctx, points, color, P.ink);
}

function drawObjective(ctx, game, w) {
    const m = game.mission;
    const label = m.active ? `ROSA'S JOB · ${m.active.title.toUpperCase()}` : 'FREE ROAM';
    const body = m.objective || '';
    const tw = ctx.measureText ? ctx.measureText(body).width : body.length * 6;
    const pw = clamp(tw + 36, 280, 620);
    const x = (w - pw) / 2;
    panel(ctx, x, 12, pw, 46);
    text(ctx, label, x + 16, 28, 9, P.mango);
    text(ctx, body, x + 16, 46, 12, P.paper);
    let extra = '';
    if (m.active?.remaining != null) {
        const left = Math.max(0, Math.ceil(m.active.remaining));
        extra = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    } else if (m.marker) {
        extra = `${Math.floor(Math.hypot(game.player.x - m.marker.x, game.player.y - m.marker.y))} m`;
    }
    if (extra) {
        const urgent = m.active?.remaining != null && m.active.remaining < 15;
        text(ctx, extra, x + pw - 14, 30, 14, urgent ? P.carCoral : P.mango, 'right');
    }
}

function drawMinimap(ctx, game, renderer, h) {
    const x = 14;
    const y = h - MINI_H - 14;
    const map = renderer?.map;
    round(ctx, x - 3, y - 3, MINI_W + 6, MINI_H + 6, 6, '#18333BE6', P.ink);
    if (map) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, MINI_W, MINI_H);
        ctx.clip();
        ctx.drawImage(map, x, y, MINI_W, MINI_H);
        ctx.restore();
    } else {
        ctx.fillStyle = P.asphalt;
        ctx.fillRect(x, y, MINI_W, MINI_H);
    }
    paintDots(ctx, game, x, y, MINI_W / game.world.width);
    text(ctx, 'NEON BAY', x + 6, y + MINI_H - 6, 8, P.paper);
}

function drawSpeed(ctx, game, w, h) {
    const car = game.player.car;
    if (!car) return;
    const mph = Math.round(Math.abs(car.speed) * 0.32);
    panel(ctx, w - 150, h - 76, 136, 62);
    text(ctx, `${mph}`, w - 26, h - 34, 30, P.paper, 'right');
    text(ctx, car.speed < -4 ? 'MPH · REVERSE' : 'MPH', w - 26, h - 20, 9, P.mango, 'right');
    if (car.wreck) text(ctx, 'WRECKED', w - 136, h - 34, 11, P.carCoral);
    else if (car.hp < 45) text(ctx, 'ENGINE SMOKING', w - 136, h - 34, 9, P.carCoral);
}

function drawToast(ctx, game, w) {
    const t = game.toast;
    if (!t || game.time > t.until) return;
    const tw = ctx.measureText ? ctx.measureText(t.title).width : t.title.length * 6;
    const pw = clamp(tw + 44, 220, 560);
    const x = (w - pw) / 2;
    panel(ctx, x, 70, pw, t.sub ? 52 : 34);
    text(ctx, t.title, x + pw / 2, 90, 13, t.color || P.mango, 'center');
    if (t.sub) text(ctx, t.sub, x + pw / 2, 108, 10, P.paper, 'center');
}

function drawBust(ctx, game, w, h) {
    const bust = game.police.bust || 0;
    if (bust <= 0.03) return;
    const pw = 300;
    const x = (w - pw) / 2;
    const y = h - 120;
    panel(ctx, x, y, pw, 40);
    text(ctx, 'NBPD CLOSING IN — BREAK AWAY', x + pw / 2, y + 16, 11, P.policeRed, 'center');
    round(ctx, x + 14, y + 24, pw - 28, 6, 3, '#3A2E28');
    round(ctx, x + 14, y + 24, (pw - 28) * clamp(bust, 0, 1), 6, 3, P.policeRed);
}

function drawHint(ctx, game, w, h) {
    const p = game.player;
    let hint = '';
    if (p.car) hint = 'E EXIT · SHIFT HANDBRAKE · SPACE FIRE';
    else {
        let near = false;
        for (const car of game.cars) {
            if (!car.wreck && Math.hypot(car.x - p.x, car.y - p.y) < 60) {
                near = true;
                break;
            }
        }
        hint = near ? 'E ENTER / STEAL CAR' : 'WASD MOVE · SPACE FIRE · F PUNCH · TAB MAP';
    }
    text(ctx, hint, w - 16, h - 88, 10, '#F6F1E7CC', 'right');
}

function drawDialogue(ctx, game, w, h) {
    const lines = game.mission.dialogue.lines || [];
    const boxH = 30 + lines.length * 24;
    const bw = clamp(w * 0.62, 420, 760);
    const x = (w - bw) / 2;
    const y = h - boxH - 18;
    panel(ctx, x, y, bw, boxH);
    lines.forEach(([speaker, line], i) => {
        const ly = y + 26 + i * 24;
        text(ctx, speaker, x + 16, ly, 10, speaker === 'MAMA ROSA' ? P.mango : P.cyan);
        text(ctx, line, x + 118, ly, 11, P.paper);
    });
    text(ctx, 'ENTER ▸', x + bw - 14, y + boxH - 8, 10, P.mango, 'right');
}

// --- full-screen map -------------------------------------------------------

export function drawFullMap(ctx, game, renderer) {
    const w = renderer?.width || 1280;
    const h = renderer?.height || 800;
    ctx.fillStyle = '#142D38D9';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(760 / game.world.width, 600 / game.world.height);
    const mw = game.world.width * scale;
    const mh = game.world.height * scale;
    const x = (w - mw) / 2;
    const y = (h - mh) / 2 + 8;
    game.mapRect = { x, y, w: mw, h: mh, scale };
    round(ctx, x - 6, y - 6, mw + 12, mh + 12, 8, '#0F232BD9', P.paper);
    if (renderer?.map) ctx.drawImage(renderer.map, x, y, mw, mh);
    paintDots(ctx, game, x, y, scale);
    text(ctx, 'NEON BAY — CITY MAP', w / 2, y - 18, 16, P.paper, 'center');
    text(ctx, 'CLICK TO SET WAYPOINT · TAB / ESC TO CLOSE', w / 2, y + mh + 30, 11, P.mango, 'center');
    const lx = x + 10;
    const ly = y + 14;
    text(ctx, 'CORAL MILE', lx + 560 * scale, ly + 700 * scale, 11, P.paper);
    text(ctx, 'GLASSWATER', lx + 500 * scale, ly + 1500 * scale, 11, P.paper);
    text(ctx, 'MARLIN WHARF', lx + 900 * scale, ly + 2300 * scale, 11, P.paper);
    text(ctx, 'THE BAY', lx + 3050 * scale, ly + 1400 * scale, 11, P.cyan);
    text(ctx, '◆ YOU', x, y + mh + 52, 10, P.mango);
    text(ctx, '◆ POLICE', x + 70, y + mh + 52, 10, P.policeRed);
    text(ctx, '◆ JOB MARKER', x + 150, y + mh + 52, 10, P.mango);
    text(ctx, '◆ WAYPOINT', x + 260, y + mh + 52, 10, P.cyan);
}
