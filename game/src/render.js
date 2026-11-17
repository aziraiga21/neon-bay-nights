// Neon Bay Nights — renderer: the world-space camera, the y-sorted draw
// pass, dusk lighting, water, and the screen-space overlays (HUD, map,
// off-screen objective arrow, crosshair).
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
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const cam = game.camera;
        const z = cam.zoom;
        const dusk = game.dusk;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = P.water;
        ctx.fillRect(0, 0, w, h);
        const shake = game.shake > 0 ? Math.sin(game.time * 83) * game.shake : 0;
        const sx = Math.round(w / 2 - cam.x * z + shake);
        const sy = Math.round(h / 2 - cam.y * z + Math.cos(game.time * 71) * game.shake * 0.6);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(z, z);
        const box = { x: -sx / z - 90, y: -sy / z - 100, w: w / z + 180, h: h / z + 200 };
        const inView = (x, y, r = 50) => x > box.x - r && x < box.x + box.w + r && y > box.y - r && y < box.y + box.h + r;

        this.drawBay(ctx, game, box);
        ctx.drawImage(this.ground, 0, 0);
        ctx.globalAlpha = dusk;
        ctx.drawImage(this.sunsetGround, 0, 0);
        ctx.globalAlpha = 1;

        this.drawSkids(ctx, game, inView);
        this.drawSignals(ctx, game, inView);
        const scene = this.gather(game, box, inView);
        if (dusk > 0.2) this.drawBeams(ctx, scene.cars, game, dusk);
        this.drawShadows(ctx, scene, dusk);
        this.drawActors(ctx, game, scene, dusk, inView);
        this.drawPins(ctx, game, inView);
        this.drawBullets(ctx, game);
        this.drawPlayerRing(ctx, game);

        // A warm sunset wash, restrained so lane paint, pedestrians and
        // health stay legible.
        ctx.fillStyle = `rgba(102,53,73,${dusk * 0.105})`;
        ctx.fillRect(box.x - 100, box.y - 100, box.w + 200, box.h + 200);
        ctx.restore();

        this.drawVignette(ctx, game, w, h);
        if (game.mode !== 'title') {
            drawHUD(ctx, game, this);
            if (game.mapOpen) drawFullMap(ctx, game, this);
        }
        this.drawObjectiveArrow(ctx, game, w, h, sx, sy, z);
        this.drawCrosshair(ctx, game);
    }

    drawSkids(ctx, game, inView) {
        for (const s of game.skids) {
            if (!inView(s.x, s.y, 0)) continue;
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.h);
            ctx.fillStyle = `rgba(34,42,45,${Math.min(0.3, s.life * 0.04)})`;
            ctx.fillRect(-7, -1, 13, 2);
            ctx.restore();
        }
    }

    // Painted signal boxes make traffic rules visible without cluttering
    // each intersection.
    drawSignals(ctx, game, inView) {
        for (const n of game.world.nodes) {
            if (!inView(n.x, n.y, 20)) continue;
            for (const [dx, dy, horizontal] of [[-61, -61, true], [61, 61, true], [61, -61, false], [-61, 61, false]]) {
                round(ctx, n.x + dx - 3, n.y + dy - 5, 6, 10, 2, '#4C605C');
                ellipse(ctx, n.x + dx, n.y + dy - 1, 2, 2, signalGreen(game.time, n, horizontal) ? '#A4D5AC' : P.policeRed);
            }
        }
    }

    // Cull everything to the camera box once, then hand the survivors to the
    // shadow / object passes.
    gather(game, box, inView) {
        const buildings = game.world.buildings.filter(b => b.x + b.w > box.x && b.x < box.x + box.w && b.y + b.h > box.y && b.y < box.y + box.h);
        const props = game.world.props.filter(p => inView(p.x, p.y, 40));
        const cars = game.cars.filter(c => inView(c.x, c.y, 50));
        const people = [...game.peds, ...game.enemies, ...game.police.officers];
        if (!game.player.car) people.push(game.player);
        const humans = people.filter(p => inView(p.x, p.y, 20));
        return { buildings, props, cars, humans };
    }

    // Headlight cones, additive, only once the sun is low.
    drawBeams(ctx, cars, game, dusk) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (const c of cars) {
            if (c.wreck || (!c.driver && c !== game.player.car && Math.abs(c.speed) < 8)) continue;
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(c.h);
            const g = ctx.createLinearGradient(17, 0, 136, 0);
            g.addColorStop(0, `rgba(255,228,171,${dusk * 0.19})`);
            g.addColorStop(1, 'rgba(255,228,171,0)');
            polygon(ctx, [[18, -9], [137, -39], [137, 39], [18, 9]], g);
            ctx.restore();
        }
        ctx.restore();
    }

    drawShadows(ctx, scene, dusk) {
        for (const b of scene.buildings) drawBuildingShadow(ctx, b, dusk);
        for (const p of scene.props) drawPropShadow(ctx, p, dusk);
        for (const c of scene.cars) drawCarShadow(ctx, c, dusk);
        for (const p of scene.humans) drawPersonShadow(ctx, p, dusk);
    }

    // One y-sorted list: buildings, props, cars, people and pickups all
    // interleave so nearer things overlap farther ones correctly.
    drawActors(ctx, game, scene, dusk, inView) {
        const queue = [];
        for (const b of scene.buildings) {
            queue.push({ sort: b.y + b.h + 10, draw: () => drawBuilding(ctx, b, dusk) });
        }
        for (const p of scene.props) {
            queue.push({ sort: p.y + (p.kind === 'container' ? 16 : 0), draw: () => drawProp(ctx, p, game.time, dusk) });
        }
        for (const c of scene.cars) {
            const depth = c.y + Math.abs(Math.sin(c.h)) * CARS[c.type].length * 0.5 + Math.abs(Math.cos(c.h)) * CARS[c.type].width * 0.5;
            queue.push({ sort: depth, draw: () => drawCar(ctx, c, game.time, dusk) });
        }
        for (const p of scene.humans) {
            queue.push({
                sort: p.y + 6,
                draw: () => {
                    ctx.save();
                    if (p.dead) ctx.globalAlpha = 0.5;
                    drawPerson(ctx, p, game.time);
                    ctx.restore();
                    if (p.role === 'rival' && !p.dead && dist(p, game.player) < 280) {
                        round(ctx, p.x - 13, p.y - 20, 26, 3, 1, '#684B3E');
                        round(ctx, p.x - 13, p.y - 20, 26 * Math.max(0, p.hp / p.maxHp), 3, 1, P.carCoral);
                    }
                }
            });
        }
        for (const p of game.world.pickups) {
            if (p.active && inView(p.x, p.y, 20)) {
                queue.push({ sort: p.y + 8, draw: () => drawPickup(ctx, p, game.time) });
            }
        }
        queue.sort((a, b) => a.sort - b.sort);
        for (const o of queue) o.draw();
    }

    // Shop pins, then the mission / waypoint pin with its golden light beam.
    drawPins(ctx, game, inView) {
        for (const s of game.world.services) {
            if (inView(s.x, s.y, 60)) {
                this.pin(ctx, s.x, s.y, s.icon, s.short, game.time, dist(s, game.player) < 140, P.teal);
            }
        }
        const marker = game.mission.marker || game.waypoint;
        if (!marker) return;
        if (game.mission.marker && inView(marker.x, marker.y, 80)) {
            const beam = ctx.createLinearGradient(0, marker.y - 115, 0, marker.y);
            beam.addColorStop(0, '#F0B42900');
            beam.addColorStop(1, '#F0B42945');
            ctx.fillStyle = beam;
            ctx.fillRect(marker.x - 17, marker.y - 115, 34, 115);
        }
        this.pin(ctx, marker.x, marker.y, game.mission.marker ? '!' : '◆', marker.label || 'WAYPOINT', game.time, true, P.mango);
    }

    // Muzzle flash, bullet tracers, particles and floating text, then the
    // mango ring that marks Jax while he is on foot.
    drawBullets(ctx, game) {
        if (game.player.car && game.player.flash > 0) {
            const a = game.player.fireHeading ?? game.player.h;
            const x = game.player.x + Math.cos(a) * 25;
            const y = game.player.y + Math.sin(a) * 25;
            ellipse(ctx, x, y, 6, 4, P.headlamp);
        }
        for (const b of game.bullets) {
            ctx.strokeStyle = b.faction === 'player' ? '#FFF1C9' : '#FFAD7B';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(b.x - b.vx * 0.023, b.y - b.vy * 0.023);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        for (const p of game.particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            if (p.kind === 'smoke') {
                const size = p.size * (2 - p.life / p.max);
                ellipse(ctx, p.x, p.y, size, size, p.color);
            } else {
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
        }
        ctx.globalAlpha = 1;
        for (const t of game.floats) {
            text(ctx, t.text, t.x, t.y - (1 - t.life / t.max) * 25, 9, t.color, 'center');
        }
    }

    drawPlayerRing(ctx, game) {
        if (game.player.car) return;
        const p = game.player;
        ctx.strokeStyle = P.mango;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 1, 12, 10, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Screen-space vignette and the red damage flash, after the world pass.
    drawVignette(ctx, game, w, h) {
        const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.76);
        vignette.addColorStop(0, '#18313A00');
        vignette.addColorStop(1, '#1924393A');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
        if (game.damageFlash > 0) {
            ctx.fillStyle = `rgba(231,116,111,${game.damageFlash * 0.65})`;
            ctx.fillRect(0, 0, w, h);
        }
    }

    // When the objective is off-screen, point at it from the screen edge
    // with the distance in metres.
    drawObjectiveArrow(ctx, game, w, h, sx, sy, z) {
        if (!game.mission.marker || game.mode !== 'play' || game.mapOpen || game.mission.dialogue) return;
        const target = game.mission.marker;
        const tx = sx + target.x * z;
        const ty = sy + target.y * z;
        if (tx >= 80 && tx <= w - 80 && ty >= 95 && ty <= h - 140) return;
        const a = Math.atan2(target.y - game.player.y, target.x - game.player.x);
        const radius = Math.min(w * 0.22, h * 0.23);
        const ax = w / 2 + Math.cos(a) * radius;
        const ay = h / 2 + Math.sin(a) * radius;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(a);
        polygon(ctx, [[14, 0], [-8, -8], [-3, 0], [-8, 8]], P.mango, P.ink);
        ctx.restore();
        text(ctx, `${Math.floor(dist(game.player, target))} m`, ax, ay + 25, 10, P.mango, 'center');
    }

    drawCrosshair(ctx, game) {
        if (!game.input.mouse.aim || game.mode !== 'play' || game.mapOpen || game.mission.dialogue) return;
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

    // A bobbing map pin: ground ring, coloured badge with an icon, a
    // pointer tip and an optional label plate.
    pin(ctx, x, y, icon, label, time, showLabel, color) {
        const bob = Math.sin(time * 3) * 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55;
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

    // The bay: a dusk-blended gradient, drifting wave lines, sparkling
    // foam, and two little moored boats that bob with the clock.
    drawBay(ctx, game, box) {
        const x = game.world.water;
        const t = game.time;
        const g = ctx.createLinearGradient(x, 0, x + 460, 0);
        g.addColorStop(0, mixColor(P.shallow, P.shallowDusk, game.dusk));
        g.addColorStop(0.32, mixColor(P.water, P.waterDusk, game.dusk));
        g.addColorStop(1, mixColor('#177B8C', '#513555', game.dusk));
        ctx.fillStyle = g;
        ctx.fillRect(x - 12, 0, game.world.width - x + 200, game.world.height);
        ctx.strokeStyle = '#E7F7F47A';
        ctx.lineWidth = 2;
        const minY = Math.floor(box.y / 40) * 40;
        const maxY = box.y + box.h;
        for (let n = 0; n < 7; n++) {
            ctx.globalAlpha = 0.5 - n * 0.055;
            ctx.beginPath();
            for (let y = minY; y < maxY + 40; y += 12) {
                const wx = x + 12 + n * 53 + Math.sin(y * 0.024 + t * 1.2 + n) * 8 + Math.sin(t * 0.9 + n) * 5;
                if (y === minY) ctx.moveTo(wx, y);
                else ctx.lineTo(wx, y);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let n = 0; n < 40; n++) {
            const wx = x + 90 + ((n * 79) % 380);
            const wy = (n * 97) % 2880;
            if (wy < box.y || wy > maxY) continue;
            ctx.globalAlpha = 0.16 + 0.13 * Math.sin(t * 1.6 + n);
            ctx.fillStyle = P.foam;
            ctx.fillRect(wx, wy + Math.sin(t + n) * 2, 7 + (n % 7), 1);
        }
        ctx.globalAlpha = 1;
        for (const y of [910, 2230]) {
            const bx = x + 240 + Math.sin(t * 0.5 + y) * 3;
            const by = y + Math.sin(t * 0.8) * 2;
            ellipse(ctx, bx + 5, by + 8, 15, 29, '#135E7650');
            polygon(ctx, [[bx, by - 31], [bx + 12, by - 9], [bx + 10, by + 26], [bx - 10, by + 26], [bx - 12, by - 9]], P.pearl);
            round(ctx, bx - 7, by - 8, 14, 23, 3, P.carGlass);
            round(ctx, bx - 5, by - 4, 10, 13, 2, P.trim);
        }
    }
}

// The camera eases toward the player (or the car, with a velocity lead) and
// pulls back a little as speed rises.
export function updateCamera(game, dt) {
    const p = game.player;
    const c = p.car;
    const targetZoom = c ? 1.22 - clamp(Math.abs(c.speed) / 410, 0, 1) * 0.29 : 1.3;
    game.camera.zoom = lerp(game.camera.zoom, targetZoom, 1 - Math.exp(-dt * 2));
    const tx = p.x + (c ? c.vx * 0.42 : Math.cos(p.h) * 22);
    const ty = p.y + (c ? c.vy * 0.42 : Math.sin(p.h) * 22);
    game.camera.x = lerp(game.camera.x, tx, 1 - Math.exp(-dt * 4));
    game.camera.y = lerp(game.camera.y, ty, 1 - Math.exp(-dt * 4));
}
