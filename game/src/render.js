import { PALETTE as P, CARS, clamp, lerp, dist, mixColor } from './config.js';
import { makeGround, drawBuilding, drawBuildingShadow, drawCar, drawCarShadow, drawPerson, drawPersonShadow, drawProp, drawPropShadow, drawPickup, round, ellipse, polygon, text } from './art.js';
import { signalGreen } from './world.js';
import { drawHUD, drawFullMap, makeMap } from './hud.js';
export class Renderer {
    constructor(canvas, world) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.width = 0;
        this.height = 0;
        this.ground = makeGround(world);
        this.sunsetGround = makeGround(world, true);
        this.map = makeMap(world);
        this.resize();
    }
    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
    }
    setWorld(world) {
        this.ground = makeGround(world);
        this.sunsetGround = makeGround(world, true);
        this.map = makeMap(world);
    }
    render(game) {
        const ctx = this.ctx, w = this.width, h = this.height, cam = game.camera, z = cam.zoom, dusk = game.dusk;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = P.water;
        ctx.fillRect(0, 0, w, h);
        const shake = game.shake > 0 ? Math.sin(game.time * 83) * game.shake : 0;
        const sx = Math.round(w / 2 - cam.x * z + shake), sy = Math.round(h / 2 - cam.y * z + Math.cos(game.time * 71) * game.shake * .6);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(z, z);
        const box = {
            x: (-sx) / z - 90, y: (-sy) / z - 100, w: w / z + 180, h: h / z + 200
        };
        const visible = (x, y, r = 50) => x > box.x - r && x < box.x + box.w + r && y > box.y - r && y < box.y + box.h + r;
        this.water(ctx, game, box);
        ctx.drawImage(this.ground, 0, 0);
        ctx.globalAlpha = dusk;
        ctx.drawImage(this.sunsetGround, 0, 0);
        ctx.globalAlpha = 1;
        for (const s of game.skids) {
            if (!visible(s.x, s.y, 0)) {
                continue;
            }
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.h);
            ctx.fillStyle = `rgba(34,42,45,${Math.min(.3, s.life * .04)})`;
            ctx.fillRect(-7, -1, 13, 2);
            ctx.restore();
        }
        // Painted signal boxes make traffic rules visible without cluttering each intersection.
        for (const n of game.world.nodes) {
            if (visible(n.x, n.y, 20)) {
                for (const [dx, dy, horizontal] of [[-61, -61, true], [61, 61, true], [61, -61, false], [-61, 61, false]]) {
                    round(ctx, n.x + dx - 3, n.y + dy - 5, 6, 10, 2, '#4C605C');
                    ellipse(ctx, n.x + dx, n.y + dy - 1, 2, 2, signalGreen(game.time, n, horizontal) ? '#A4D5AC' : P.policeRed);
                }
            }
        }
        const buildings = game.world.buildings.filter(b => b.x + b.w > box.x && b.x < box.x + box.w && b.y + b.h > box.y && b.y < box.y + box.h);
        const props = game.world.props.filter(p => visible(p.x, p.y, 40));
        const cars = game.cars.filter(c => visible(c.x, c.y, 50));
        const people = [...game.peds, ...game.enemies, ...game.police.officers];
        if (!game.player.car) {
            people.push(game.player);
        }
        const humans = people.filter(p => visible(p.x, p.y, 20));
        if (dusk > .2) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            for (const c of cars) {
                if (c.wreck || (!c.driver && c !== game.player.car && Math.abs(c.speed) < 8)) {
                    continue;
                }
                ctx.save();
                ctx.translate(c.x, c.y);
                ctx.rotate(c.h);
                const g = ctx.createLinearGradient(17, 0, 136, 0);
                g.addColorStop(0, `rgba(255,228,171,${dusk * .19})`);
                g.addColorStop(1, 'rgba(255,228,171,0)');
                polygon(ctx, [[18, -9], [137, -39], [137, 39], [18, 9]], g);
                ctx.restore();
            }
            ctx.restore();
        }
        for (const b of buildings) {
            drawBuildingShadow(ctx, b, dusk);
        }
        for (const p of props) {
            drawPropShadow(ctx, p, dusk);
        }
        for (const c of cars) {
            drawCarShadow(ctx, c, dusk);
        }
        for (const p of humans) {
            drawPersonShadow(ctx, p, dusk);
        }
        const objects = [];
        for (const b of buildings) {
            objects.push({ sort: b.y + b.h + 10, draw: () => drawBuilding(ctx, b, dusk) });
        }
        for (const p of props) {
            objects.push({ sort: p.y + (p.kind === 'container' ? 16 : 0), draw: () => drawProp(ctx, p, game.time, dusk) });
        }
        for (const c of cars) {
            objects.push({ sort: c.y + Math.abs(Math.sin(c.h)) * CARS[c.type].length * .5 + Math.abs(Math.cos(c.h)) * CARS[c.type].width * .5, draw: () => drawCar(ctx, c, game.time, dusk) });
        }
        for (const p of humans) {
            objects.push({ sort: p.y + 6, draw: () => {
                    ctx.save();
                    if (p.dead) {
                        ctx.globalAlpha = .5;
                    }
                    drawPerson(ctx, p, game.time);
                    ctx.restore();
                    if (p.role === 'rival' && !p.dead && dist(p, game.player) < 280) {
                        round(ctx, p.x - 13, p.y - 20, 26, 3, 1, '#684B3E');
                        round(ctx, p.x - 13, p.y - 20, 26 * Math.max(0, p.hp / p.maxHp), 3, 1, P.carCoral);
                    }
                } });
        }
        for (const p of game.world.pickups) {
            if (p.active && visible(p.x, p.y, 20)) {
                objects.push({ sort: p.y + 8, draw: () => drawPickup(ctx, p, game.time) });
            }
        }
        objects.sort((a, b) => a.sort - b.sort);
        for (const o of objects) {
            o.draw();
        }
        for (const s of game.world.services) {
            if (visible(s.x, s.y, 60)) {
                this.marker(ctx, s.x, s.y, s.icon, s.short, game.time, dist(s, game.player) < 140, P.teal);
            }
        }
        const marker = game.mission.marker || game.waypoint;
        if (marker) {
            if (game.mission.marker && visible(marker.x, marker.y, 80)) {
                const beam = ctx.createLinearGradient(0, marker.y - 115, 0, marker.y);
                beam.addColorStop(0, '#F0B42900');
                beam.addColorStop(1, '#F0B42945');
                ctx.fillStyle = beam;
                ctx.fillRect(marker.x - 17, marker.y - 115, 34, 115);
            }
            this.marker(ctx, marker.x, marker.y, game.mission.marker ? '!' : '◆', marker.label || 'WAYPOINT', game.time, true, P.mango);
        }
        if (game.player.car && game.player.flash > 0) {
            const a = game.player.fireHeading ?? game.player.h, x = game.player.x + Math.cos(a) * 25, y = game.player.y + Math.sin(a) * 25;
            ellipse(ctx, x, y, 6, 4, P.headlamp);
        }
        for (const b of game.bullets) {
            ctx.strokeStyle = b.faction === 'player' ? '#FFF1C9' : '#FFAD7B';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(b.x - b.vx * .023, b.y - b.vy * .023);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        for (const p of game.particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            if (p.kind === 'smoke') {
                ellipse(ctx, p.x, p.y, p.size * (2 - p.life / p.max), p.size * (2 - p.life / p.max), p.color);
            }
            else {
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
        }
        ctx.globalAlpha = 1;
        for (const t of game.floats) {
            text(ctx, t.text, t.x, t.y - (1 - t.life / t.max) * 25, 9, t.color, 'center');
        }
        if (!game.player.car) {
            const p = game.player;
            ctx.strokeStyle = P.mango;
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = .7;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 1, 12, 10, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        // A warm sunset wash is restrained so lane paint, pedestrians and health remain legible.
        ctx.fillStyle = `rgba(102,53,73,${dusk * .105})`;
        ctx.fillRect(box.x - 100, box.y - 100, box.w + 200, box.h + 200);
        ctx.restore();
        const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .32, w / 2, h / 2, Math.max(w, h) * .76);
        vignette.addColorStop(0, '#18313A00');
        vignette.addColorStop(1, '#1924393A');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
        if (game.damageFlash > 0) {
            ctx.fillStyle = `rgba(231,116,111,${game.damageFlash * .65})`;
            ctx.fillRect(0, 0, w, h);
        }
        if (game.mode !== 'title') {
            drawHUD(ctx, game, this);
            if (game.mapOpen) {
                drawFullMap(ctx, game, this);
            }
        }
        if (game.mission.marker && game.mode === 'play' && !game.mapOpen && !game.mission.dialogue) {
            const target = game.mission.marker, tx = sx + target.x * z, ty = sy + target.y * z;
            if (tx < 80 || tx > w - 80 || ty < 95 || ty > h - 140) {
                const a = Math.atan2(target.y - game.player.y, target.x - game.player.x);
                const radius = Math.min(w * .22, h * .23), ax = w / 2 + Math.cos(a) * radius, ay = h / 2 + Math.sin(a) * radius;
                ctx.save();
                ctx.translate(ax, ay);
                ctx.rotate(a);
                polygon(ctx, [[14, 0], [-8, -8], [-3, 0], [-8, 8]], P.mango, P.ink);
                ctx.restore();
                text(ctx, `${Math.floor(dist(game.player, target))} m`, ax, ay + 25, 10, P.mango, 'center');
            }
        }
        if (game.input.mouse.aim && game.mode === 'play' && !game.mapOpen && !game.mission.dialogue) {
            const m = game.input.mouse;
            ctx.strokeStyle = P.paper;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
            ctx.moveTo(m.x - 10, m.y);
            ctx.lineTo(m.x - 4, m.y);
            ctx.moveTo(m.x + 4, m.y);
            ctx.lineTo(m.x + 10, m.y);
            ctx.moveTo(m.x, m.y - 10);
            ctx.lineTo(m.x, m.y - 4);
            ctx.moveTo(m.x, m.y + 4);
            ctx.lineTo(m.x, m.y + 10);
            ctx.stroke();
        }
    }
    marker(ctx, x, y, icon, label, time, showLabel, color) {
        const bob = Math.sin(time * 3) * 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = .55;
        ctx.beginPath();
        ctx.ellipse(x, y + 4, 22, 11, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        round(ctx, x - 10, y - 34 + bob, 20, 20, 5, color);
        text(ctx, icon, x, y - 19 + bob, 13, P.paper, 'center');
        polygon(ctx, [[x - 4, y - 15 + bob], [x + 4, y - 15 + bob], [x, y - 10 + bob]], color);
        if (showLabel) {
            const width = label.length * 5.6 + 14;
            round(ctx, x - width / 2, y - 57 + bob, width, 16, 3, '#18333BEF');
            text(ctx, label, x, y - 45 + bob, 8, P.paper, 'center');
        }
    }
    water(ctx, game, box) {
        const x = game.world.water, t = game.time;
        const g = ctx.createLinearGradient(x, 0, x + 460, 0);
        g.addColorStop(0, mixColor(P.shallow, P.shallowDusk, game.dusk));
        g.addColorStop(.32, mixColor(P.water, P.waterDusk, game.dusk));
        g.addColorStop(1, mixColor('#177B8C', '#513555', game.dusk));
        ctx.fillStyle = g;
        ctx.fillRect(x - 12, 0, game.world.width - x + 200, game.world.height);
        ctx.strokeStyle = '#E7F7F47A';
        ctx.lineWidth = 2;
        const minY = Math.floor(box.y / 40) * 40, maxY = box.y + box.h;
        for (let n = 0; n < 7; n++) {
            ctx.globalAlpha = .5 - n * .055;
            ctx.beginPath();
            for (let y = minY; y < maxY + 40; y += 12) {
                const wx = x + 12 + n * 53 + Math.sin(y * .024 + t * 1.2 + n) * 8 + Math.sin(t * .9 + n) * 5;
                if (y === minY) {
                    ctx.moveTo(wx, y);
                }
                else {
                    ctx.lineTo(wx, y);
                }
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let n = 0; n < 40; n++) {
            const wx = x + 90 + ((n * 79) % 380), wy = ((n * 97) % 2880);
            if (wy < box.y || wy > maxY) {
                continue;
            }
            ctx.globalAlpha = .16 + .13 * Math.sin(t * 1.6 + n);
            ctx.fillStyle = P.foam;
            ctx.fillRect(wx, wy + Math.sin(t + n) * 2, 7 + n % 7, 1);
        }
        ctx.globalAlpha = 1;
        for (const y of [910, 2230]) {
            const bx = x + 240 + Math.sin(t * .5 + y) * 3, by = y + Math.sin(t * .8) * 2;
            ellipse(ctx, bx + 5, by + 8, 15, 29, '#135E7650');
            polygon(ctx, [[bx, by - 31], [bx + 12, by - 9], [bx + 10, by + 26], [bx - 10, by + 26], [bx - 12, by - 9]], P.pearl);
            round(ctx, bx - 7, by - 8, 14, 23, 3, P.carGlass);
            round(ctx, bx - 5, by - 4, 10, 13, 2, P.trim);
        }
    }
}
export function updateCamera(game, dt) {
    const p = game.player, c = p.car, targetZoom = c ? 1.22 - clamp(Math.abs(c.speed) / 410, 0, 1) * .29 : 1.3;
    game.camera.zoom = lerp(game.camera.zoom, targetZoom, 1 - Math.exp(-dt * 2));
    const tx = p.x + (c ? c.vx * .42 : Math.cos(p.h) * 22), ty = p.y + (c ? c.vy * .42 : Math.sin(p.h) * 22);
    game.camera.x = lerp(game.camera.x, tx, 1 - Math.exp(-dt * 4));
    game.camera.y = lerp(game.camera.y, ty, 1 - Math.exp(-dt * 4));
}
