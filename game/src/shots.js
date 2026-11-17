// Deterministic capture preparation. Scenes advance the real simulation at a fixed timestep.
// The phase-2 mission scene can install a mission through main.js's mission state hook.
import { angleDelta, dist } from './config.js';
import { setWanted } from './police.js';
export function createShot(name, game) {
    if (!['cover', 'chase', 'mission', 'city'].includes(name)) {
        return null;
    }
    const input = game.input;
    input.clear();
    input.mouse.aim = false;
    let frame = 0, ready = false;
    const car = game.cars.find(c => c.type === 'sports' && c.ai === 'parked' && dist(c, game.player) < 90);
    const waypoints = [{ x: 2578, y: 1530 }, { x: 2581, y: 1780 }, { x: 2581, y: 2100 }, { x: 2581, y: 2430 }];
    let point = 0;
    return {
        name, get ready() {
            return ready;
        },
        beforeStep() {
            frame++;
            input.keys.clear();
            input.pressed.clear();
            if (name === 'city') {
                if (frame < 70) {
                    input.keys.add('KeyD');
                }
                if (frame > 70 && frame < 115) {
                    input.keys.add('KeyS');
                }
            }
            else if (name === 'mission') {
                game.waypoint = { x: game.world.services[1].x, y: game.world.services[1].y, label: 'MARLOWE MOTOR CO.' };
                if (frame < 60) {
                    input.keys.add('KeyA');
                }
            }
            else {
                if (frame === 1 && car) {
                    input.pressed.add('KeyE');
                }
                if (game.player.car) {
                    const c = game.player.car, target = waypoints[point];
                    if (dist(c, target) < 75 && point < waypoints.length - 1) {
                        point++;
                    }
                    const a = Math.atan2(target.y - c.y, target.x - c.x), delta = angleDelta(c.h, a);
                    if (Math.abs(delta) > .1) {
                        input.keys.add(delta > 0 ? 'KeyD' : 'KeyA');
                    }
                    if (Math.abs(c.speed) < (Math.abs(delta) > .7 ? 95 : name === 'chase' ? 205 : 135)) {
                        input.keys.add('KeyW');
                    }
                    if (frame === 70 && name === 'chase') {
                        setWanted(game, 3);
                    }
                }
            }
        },
        afterStep() {
            if (frame >= (name === 'chase' ? 640 : name === 'cover' ? 230 : 120)) {
                ready = true;
                input.clear();
            }
        }
    };
}
