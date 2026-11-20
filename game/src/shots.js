// Capture scenes seed ordinary actors, then advance the live simulation with keyboard autopilots.
import { PALETTE as P, angleDelta, dist } from './config.js';
import { makeCar } from './vehicles.js';
import { setWanted } from './police.js';
import { startMission, advanceDialogue } from './missions.js';
import { addPed } from './pedestrians.js';

export const CAPTURE_NAMES = Object.freeze(['cover', 'chase', 'mission', 'city']);

export function createShot(name, game, startTime=150) {
    if (!CAPTURE_NAMES.includes(name)) return null;
    const input = game.input;
    input.clear();
    game.toast = null;
    game.lastSave = Infinity;
    let frame = 0, ready = false;
    let waypoints = [], point = 0;
    const finish = name === 'cover' ? 205 : name === 'chase' ? 165 : 90;
    if (name === 'mission') {
        game.mission.completed = ['m1', 'm2'];
        startMission(game, 'm3');
        Object.assign(game.player,{x:2533,y:2468,h:-Math.PI/2});
        advanceDialogue(game);
    } else if (name === 'chase') {
        game.mission.completed = ['m1'];
        startMission(game, 'm2');
        advanceDialogue(game);
        const c = game.player.car;
        Object.assign(c, { x: 2542, y: 1380, h: Math.PI / 2 });
        Object.assign(game.player, { x: c.x, y: c.y, h: c.h });
        game.cars = game.cars.filter(o => o === c || o.x < 2480 || o.x > 2640 || o.y < 750 || o.y > 2100);
        for (const [x, y] of [[2542, 900], [2577, 820]]) {
            const cruiser = makeCar('police', x, y, Math.PI / 2, P.pearl, 'police');
            cruiser.driver = true;
            cruiser.speed = cruiser.vy = 140;
            game.cars.push(cruiser);
            game.police.units.push({ car: cruiser, path: [], repath: 0, deployed: false, retire: 0 });
        }
        setWanted(game, 3);
        game.police.spawnTimer = 100;
        waypoints = [{ x: 2542, y: 1510 }, { x: 2558, y: 1690 }, { x: 2542, y: 1900 }];
    } else if (name === 'cover') {
        const c = makeCar('sports', 2794, 1680, -Math.PI / 2, P.magenta);
        game.cars = game.cars.filter(o => dist(o, c) > 80);
        game.cars.push(c);
        Object.assign(game.player, { x: 2821, y: 1680, h: Math.PI });
        game.waypoint = { x: 2794, y: 830, label: 'OCEAN DRIVE · SUNSET RUN' };
        waypoints = [{ x: 2794, y: 850 }];
    } else {
        Object.assign(game.player, { x: 1374, y: 1496, h: -Math.PI / 2 });
    }
    if (name === 'mission') {
        for (const c of game.cars) {
            if (c !== game.mission.active.target && c.color === P.magenta && dist(c, game.player) < 500) c.color = P.carCoral;
        }
    }
    // People use their normal sidewalk graph; the camera never contains decorative fake actors.
    const y = name === 'mission' ? 2176 : name === 'chase' ? 1792 : name === 'city' ? 1408 : 1408;
    for (const [x, dy] of [[name === 'city' ? 1342 : 2494, -66], [name === 'city' ? 1342 : 2494, 66], [name === 'city' ? 1474 : 2626, -66], [name === 'city' ? 1474 : 2626, 66], [2242, 66], [2110, 66]]) {
        addPed(game, x, y + dy);
    }
    // A cab and a coral sedan make both lanes readable near the coastal crossroads.
    if (name === 'cover' || name === 'city') {
        const cab = makeCar('taxi', 2542, 1210, Math.PI / 2, P.taxi, 'traffic');
        cab.route = { from: 20, to: 27 };
        cab.cruise = 80;
        game.cars.push(cab);
        const sedan = makeCar('sedan', 2340, 1426, 0, P.carCoral, 'traffic');
        sedan.route = { from: 26, to: 27 };
        sedan.cruise = 95;
        game.cars.push(sedan);
    }
    Object.assign(game.camera, { x: game.player.x, y: game.player.y, zoom: 1.16 });
    game.time = startTime; // Seconds on the same live day-to-dusk clock as free roam.
    return {
        name,
        get ready() { return ready; },
        beforeStep() {
            frame++;
            input.keys.clear();
            input.pressed.clear();
            if (name === 'mission') {
                if(frame>55){input.keys.add('KeyW');input.keys.add('ShiftLeft');}
            } else if (name === 'city') {
                if (frame > 53) input.keys.add('KeyW');
            } else {
                if (name === 'cover' && frame === 1) input.pressed.add('KeyE');
                const c = game.player.car;
                if (c) {
                    if (point < waypoints.length - 1 && dist(c, waypoints[point]) < 75) point++;
                    const target = waypoints[point], a = Math.atan2(target.y - c.y, target.x - c.x), delta = angleDelta(c.h, a);
                    if (Math.abs(delta) > .06) input.keys.add(delta > 0 ? 'KeyD' : 'KeyA');
                    const speed = name === 'chase' ? 195 : 150;
                    if (Math.abs(c.speed) < (Math.abs(delta) > .65 ? 85 : speed)) input.keys.add('KeyW');
                    if (Math.abs(c.speed) > speed + 20) input.keys.add('KeyS');
                    if (name === 'chase' && frame > 118 && frame < 132) input.keys.add('ShiftLeft');
                    if (name === 'cover' && frame === 100) {
                        setWanted(game, 1);
                        game.police.spawnTimer = 100;
                    }
                }
            }
        },
        afterStep() {
            game.toast = null;
            if (frame >= finish) {
                ready = true;
                input.clear();
                // Capture framing alone is fixed; actor positions come from the simulation above.
                game.camera.photo = {
                    cover: {dx:-46,dy:19,dz:65,tx:-8,ty:12,tz:-8},
                    chase: {dx:-41,dy:17,dz:69,tx:1,ty:11,tz:-12},
                    mission: {dx:14,dy:23,dz:63,tx:-12,ty:13,tz:-12},
                    city: {dx:-115,dy:178,dz:175,tx:108,ty:6,tz:-90}
                }[name];
            }
        }
    };
}
