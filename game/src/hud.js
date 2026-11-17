import { PALETTE as P, CARS, clamp, money, dist } from './config.js';
import { round, ellipse, polygon, text } from './art.js';
import { districtAt } from './world.js';
import { nearestCar } from './vehicles.js';
export function makeMap(world) {
    const c = document.createElement('canvas');
    c.width = 864;
    c.height = 720;
    const ctx = c.getContext('2d');
    ctx.scale(.25, .25);
    ctx.fillStyle = '#65847B';
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.fillStyle = '#206C79';
    ctx.fillRect(world.water, 0, world.width - world.water, world.height);
    ctx.fillStyle = '#BAAA86';
    ctx.fillRect(world.coast, 0, 200, world.height);
    ctx.fillStyle = '#B3B3A0';
    ctx.fillRect(95, 100, 2675, 2650);
    for (const n of world.nodes) {
        for (const id of n.links) {
            const b = world.nodes[id];
            ctx.strokeStyle = '#3A5760';
            ctx.lineWidth = 100;
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.strokeStyle = '#728784';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }
    for (const p of world.parks) {
        ctx.fillStyle = '#6A9B7C';
        ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    for (const b of world.buildings) {
        ctx.fillStyle = b.district === 'Marlin Wharf' ? '#7F8F87' : b.district === 'Glasswater' ? '#8EAAA5' : '#B5AD99';
        ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    return c;
}
function star(ctx, x, y, r, filled, color) {
    const points = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .45 : r;
        points.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]);
    }
    polygon(ctx, points, filled ? color : '#50706C', filled ? color : '#78918A');
}
function panel(ctx, x, y, w, h) {
    round(ctx, x, y, w, h, 8, '#17343CEA', '#B8D4C12B');
}
function wrap(ctx, str, x, y, width, size, color) {
    ctx.font = `bold ${size}px Arial`;
    const words = str.split(' ');
    let line = '', row = 0;
    for (const word of words) {
        const test = line + word + ' ';
        if (ctx.measureText(test).width > width && line) {
            text(ctx, line.trim(), x, y + row * 17, size, color);
            line = word + ' ';
            row++;
        }
        else {
            line = test;
        }
    }
    text(ctx, line.trim(), x, y + row * 17, size, color);
    return row;
}
export function drawHUD(ctx, game, renderer) {
    const scale = Math.min(1, renderer.width / 1030, renderer.height / 650);
    ctx.save();
    ctx.scale(scale, scale);
    const w = renderer.width / scale, h = renderer.height / scale, p = game.player, pol = game.police;
    panel(ctx, 24, 22, 225, 74);
    ctx.fillStyle = P.carCoral;
    ctx.fillRect(24, 36, 3, 42);
    text(ctx, 'NEON BAY', 41, 47, 22, P.paper);
    text(ctx, 'N I G H T S', 42, 64, 11, P.mango);
    text(ctx, districtAt(p.x, p.y).toUpperCase(), 42, 83, 9, '#ABC6BD');
    panel(ctx, w - 285, 22, 261, p.car ? 143 : 129);
    text(ctx, 'JAX MARLOWE', w - 266, 42, 9, '#ABC6BD');
    text(ctx, money(p.cash), w - 42, 65, 27, P.paper, 'right');
    text(ctx, 'HEALTH', w - 265, 84, 8, '#ABC6BD');
    round(ctx, w - 214, 77, 170, 7, 3, '#415D60');
    round(ctx, w - 214, 77, 170 * clamp(p.health / 100, 0, 1), 7, 3, p.health < 30 ? P.policeRed : '#8ED6BB');
    for (let i = 0; i < 5; i++) {
        star(ctx, w - 253 + i * 34, 106, 10, i < pol.stars, pol.searching && Math.sin(game.time * 4) < 0 ? '#DAAA78' : P.mango);
    }
    text(ctx, `${p.ammo} / 120`, w - 42, 133, 11, P.paper, 'right');
    text(ctx, 'PISTOL', w - 111, 133, 8, '#ABC6BD', 'right');
    if (p.car) {
        text(ctx, 'VEHICLE', w - 265, 151, 8, '#ABC6BD');
        round(ctx, w - 214, 145, 170, 5, 2, '#415D60');
        round(ctx, w - 214, 145, 170 * clamp(p.car.hp / CARS[p.car.type].hp, 0, 1), 5, 2, p.car.hp < 30 ? P.carCoral : P.cyan);
    }
    if (pol.stars > 0) {
        panel(ctx, w / 2 - 117, 22, 234, 43);
        ellipse(ctx, w / 2 - 95, 43, 4, 4, pol.seen ? P.policeRed : P.mango);
        text(ctx, pol.seen ? 'POLICE PURSUIT' : 'SEARCHING FOR YOU', w / 2 - 81, 41, 10, pol.seen ? P.policeRed : P.mango);
        text(ctx, pol.seen ? 'BREAK LINE OF SIGHT' : pol.hiddenFor < 10 ? 'STAY OUT OF SIGHT' : 'HEAT IS FADING', w / 2 - 81, 54, 8, '#ABC6BD');
        if (!pol.seen) {
            round(ctx, w / 2 - 102, 70, 204, 3, 1, '#415D6080');
            round(ctx, w / 2 - 102, 70, 204 * clamp(pol.hiddenFor / 20, 0, 1), 3, 1, P.mango);
        }
    }
    if (pol.bust > 0) {
        panel(ctx, w / 2 - 145, h / 2 + 73, 290, 55);
        text(ctx, 'GET MOVING — BUSTING', w / 2, h / 2 + 94, 12, P.policeRed, 'center');
        round(ctx, w / 2 - 124, h / 2 + 105, 248, 8, 4, '#415D60');
        round(ctx, w / 2 - 124, h / 2 + 105, 248 * pol.bust, 8, 4, P.policeRed);
    }
    // Minimap uses the same generated city and every live actor’s actual world position.
    const mx = 24, my = h - 208, mw = 224, mh = 149;
    panel(ctx, mx - 1, my - 1, mw + 2, mh + 39);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mx + 1, my + 1, mw - 2, mh - 2, 7);
    ctx.clip();
    const mz = .205, viewW = mw / mz, viewH = mh / mz, viewX = p.x - viewW / 2, viewY = p.y - viewH / 2;
    ctx.fillStyle = '#206C79';
    ctx.fillRect(mx, my, mw, mh);
    ctx.drawImage(renderer.map, viewX * .25, viewY * .25, viewW * .25, viewH * .25, mx, my, mw, mh);
    const point = (x, y) => ({ x: mx + (x - viewX) * mz, y: my + (y - viewY) * mz });
    for (const c of game.cars) {
        const q = point(c.x, c.y);
        if (c === p.car) {
            continue;
        }
        ellipse(ctx, q.x, q.y, c.type === 'police' ? 3 : 1.5, c.type === 'police' ? 3 : 1.5, c.type === 'police' ? (Math.sin(game.time * 7 + c.id) > 0 ? P.policeCyan : P.policeRed) : '#DEE3C8');
    }
    for (const e of game.enemies) {
        if (!e.dead) {
            const q = point(e.x, e.y);
            ellipse(ctx, q.x, q.y, 2.5, 2.5, P.carCoral);
        }
    }
    for (const s of game.world.services) {
        const q = point(s.x, s.y);
        round(ctx, q.x - 5, q.y - 5, 10, 10, 2, P.teal);
        text(ctx, s.icon, q.x, q.y + 3, 7, P.paper, 'center');
    }
    const marker = game.mission.marker || game.waypoint;
    if (marker) {
        const q = point(marker.x, marker.y);
        ellipse(ctx, q.x, q.y, 5, 5, P.mango);
        ellipse(ctx, q.x, q.y, 2, 2, P.paper);
    }
    ctx.save();
    ctx.translate(mx + mw / 2, my + mh / 2);
    ctx.rotate(p.car ? p.car.h : p.h);
    polygon(ctx, [[8, 0], [-5, -5], [-3, 0], [-5, 5]], P.paper, P.ink);
    ctx.restore();
    ctx.restore();
    round(ctx, mx + mw - 23, my + 8, 15, 17, 3, '#17343CDC');
    text(ctx, 'N', mx + mw - 15.5, my + 20, 10, P.paper, 'center');
    text(ctx, game.clock, mx + 12, my + mh + 20, 12, P.paper);
    text(ctx, 'TAB  CITY MAP', mx + mw - 12, my + mh + 20, 9, '#ABC6BD', 'right');
    panel(ctx, w - 330, h - 133, 306, 109);
    text(ctx, game.mission.active ? 'ON THE JOB' : 'FREE ROAM', w - 312, h - 113, 9, P.mango);
    const objective = game.mission.objective || 'Explore Neon Bay. Make the city yours.';
    wrap(ctx, objective, w - 312, h - 92, 270, 12, P.paper);
    const marker2 = game.mission.marker || game.waypoint;
    const detail = marker2 ? `${Math.floor(dist(p, marker2))} m  ·  ${marker2.label || 'WAYPOINT'}` : pol.stars > 0 ? 'Lose the heat. Switch rides. Find cover.' : 'Rosa’s Diner · Garage · Dockside Supplies';
    text(ctx, detail, w - 312, h - 44, 9, '#ABC6BD');
    if (p.car) {
        const speed = Math.round(Math.abs(p.car.speed) * .32);
        panel(ctx, w - 190, h - 243, 166, 98);
        text(ctx, String(speed).padStart(2, '0'), w - 173, h - 190, 43, P.paper);
        text(ctx, 'MPH', w - 43, h - 193, 10, P.mango, 'right');
        text(ctx, CARS[p.car.type].name.toUpperCase(), w - 173, h - 169, 8, '#ABC6BD');
        text(ctx, p.car.wreck ? 'ENGINE DESTROYED' : p.car.speed < -3 ? 'REVERSE' : p.car.handbrake ? 'HANDBRAKE' : 'NEON BAY MOTOR CLUB', w - 173, h - 154, 7, p.car.wreck ? P.policeRed : '#ABC6BD');
    }
    else if (p.stamina < .99) {
        round(ctx, w / 2 - 54, h - 55, 108, 4, 2, '#415D60');
        round(ctx, w / 2 - 54, h - 55, 108 * p.stamina, 4, 2, P.mango);
    }
    const service = game.world.services.find(s => dist(s, p) < (s.kind === 'garage' && p.car ? 80 : 43));
    const car = !p.car ? nearestCar(game) : null;
    let prompt = service ? `${service.kind === 'garage' && p.car ? 'R' : 'E'}  ${service.kind === 'garage' ? 'REPAIR + REPAINT  $100' : service.kind === 'ammo' ? 'BUY 48 AMMO  $45' : service.kind === 'food' ? 'HOT MEAL  $40' : 'HEAL  $60'}` : p.car ? 'E  EXIT VEHICLE' : car ? `E  ${car.driver ? 'STEAL' : 'ENTER'} ${CARS[car.type].name.toUpperCase()}` : '';
    if (prompt) {
        const pw = Math.max(190, prompt.length * 6 + 32);
        round(ctx, w / 2 - pw / 2, h - 103, pw, 32, 5, '#17343CEF', '#F0B42955');
        text(ctx, prompt, w / 2, h - 82, 11, P.mango, 'center');
    }
    const controls = p.car ? 'W S  THROTTLE / BRAKE     A D  STEER     SHIFT  DRIFT' : 'WASD  MOVE     SHIFT  SPRINT     SPACE  FIRE     F  PUNCH';
    text(ctx, controls, w / 2, h - 27, 8, '#D2DACC', 'center');
    text(ctx, `${game.audio.muted ? 'M  UNMUTE' : 'M  SOUND'}   ·   ESC  PAUSE`, w - 27, 187, 8, '#E0E4D3', 'right');
    if (game.toast && game.toast.until > game.time) {
        const toast = game.toast, tw = Math.min(460, Math.max(340, toast.sub.length * 5.4 + 42)), ty = h - 190;
        ctx.globalAlpha = clamp((toast.until - game.time) * 2, 0, 1);
        panel(ctx, w / 2 - tw / 2, ty, tw, 62);
        ctx.fillStyle = toast.color;
        ctx.fillRect(w / 2 - tw / 2, ty + 10, 3, 42);
        text(ctx, toast.title, w / 2 - tw / 2 + 18, ty + 25, 12, toast.color);
        text(ctx, toast.sub, w / 2 - tw / 2 + 18, ty + 45, 10, P.paper);
        ctx.globalAlpha = 1;
    }
    if (game.saveError) {
        text(ctx, 'STORAGE UNAVAILABLE · PROGRESS IS SESSION ONLY', w / 2, 86, 9, P.mango, 'center');
    }
    ctx.restore();
}
export function drawFullMap(ctx, game, renderer) {
    const w = renderer.width, h = renderer.height;
    ctx.fillStyle = '#142F39EF';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min((w - 130) / game.world.width, (h - 140) / game.world.height), mw = game.world.width * scale, mh = game.world.height * scale, x = (w - mw) / 2, y = 80;
    game.mapRect = {
        x, y, w: mw, h: mh, scale
    };
    round(ctx, x - 3, y - 3, mw + 6, mh + 6, 5, '#678B84');
    ctx.drawImage(renderer.map, x, y, mw, mh);
    text(ctx, 'NEON BAY', x, 42, 24, P.paper);
    text(ctx, 'CLICK TO SET A WAYPOINT  ·  TAB / ESC TO CLOSE', x + mw, 42, 10, P.mango, 'right');
    for (const [name, wx, wy] of [['GLASSWATER', 1000, 1100], ['CORAL MILE', 2400, 1100], ['MARLIN WHARF', 1380, 2370], ['THE BAY', 3220, 1550]]) {
        text(ctx, name, x + wx * scale, y + wy * scale, Math.max(9, scale * 40), '#E0DEBF', 'center');
    }
    for (const s of game.world.services) {
        const sx = x + s.x * scale, sy = y + s.y * scale;
        round(ctx, sx - 8, sy - 8, 16, 16, 4, P.teal, P.trim);
        text(ctx, s.icon, sx, sy + 4, 11, P.paper, 'center');
        round(ctx, sx - s.name.length * 2.8 - 6, sy + 13, s.name.length * 5.6 + 12, 15, 3, '#17343CE8');
        text(ctx, s.name, sx, sy + 24, 9, P.paper, 'center');
    }
    for (const e of game.enemies) {
        if (!e.dead) {
            ellipse(ctx, x + e.x * scale, y + e.y * scale, 3, 3, P.carCoral);
        }
    }
    for (const c of game.cars) {
        if (c.type === 'police') {
            ellipse(ctx, x + c.x * scale, y + c.y * scale, 3, 3, P.policeCyan);
        }
    }
    const p = game.player;
    ctx.save();
    ctx.translate(x + p.x * scale, y + p.y * scale);
    ctx.rotate(p.car ? p.car.h : p.h);
    polygon(ctx, [[10, 0], [-6, -6], [-3, 0], [-6, 6]], P.paper, P.ink);
    ctx.restore();
    const marker = game.mission.marker || game.waypoint;
    if (marker) {
        ellipse(ctx, x + marker.x * scale, y + marker.y * scale, 6, 6, P.mango);
    }
    text(ctx, 'TEAL  SHOPS & SERVICES      CORAL  COPPER KINGS      CYAN  NEON BAY PD', w / 2, h - 28, 10, '#BCD0C6', 'center');
}
