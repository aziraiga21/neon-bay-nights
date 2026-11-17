import { PALETTE as P, dist } from './config.js';
import { makeCar } from './vehicles.js';
import { setWanted } from './police.js';

// Story jobs use the same cars, combat actors, wanted state and events as free roam.
export const MISSIONS = [
    { id: 'm1', title: 'First Delivery', reward: 250, summary: 'A package, a hotel, ninety seconds.',
        intro: [['MAMA ROSA', 'Jax Marlowe. Still dreaming of that garage? Start with an honest delivery.'], ['JAX', 'Honest has a suspiciously short deadline.'], ['MAMA ROSA', 'Glasswater Hotel. Ninety seconds. The package is in the Mirage outside.']],
        outro: [['MAMA ROSA', 'On time, no questions. That is how trust starts in Neon Bay.'], ['JAX', 'And a garage starts with two hundred and fifty.']] },
    { id: 'm2', title: 'Hot Wheels', reward: 400, summary: 'Shake a two-star Neon Bay PD pursuit.',
        intro: [['MAMA ROSA', 'The Copper Kings gave Neon Bay PD your plate. Two stars, just for knowing me.'], ['JAX', 'Then they can get to know my taillights.'], ['MAMA ROSA', 'Break sight. Turn a few corners. Stay hidden until every star goes dark.']],
        outro: [['MAMA ROSA', 'Dispatch lost your trail. Four hundred for keeping your cool.'], ['JAX', 'Tell the Kings their tip was appreciated.']] },
    { id: 'm3', title: 'Repo Man', reward: 600, summary: 'Recover the magenta Mirage at Marlin Wharf.',
        intro: [['MAMA ROSA', 'The Kings took a magenta Mirage GT to Marlin Wharf. It belongs to a friend.'], ['JAX', 'Specific car. Specific shade of trouble.'], ['MAMA ROSA', 'Bring that car to Marlowe Motor Co. Keep the engine in one piece.']],
        outro: [['JAX', 'One magenta Mirage. Delivered with all four wheels.'], ['MAMA ROSA', 'Six hundred, and the first car through your own garage.']] },
    { id: 'm4', title: 'Diner Defense', reward: 800, summary: 'Protect Rosa’s from four Copper Kings.',
        intro: [['MAMA ROSA', 'Four Copper Kings outside my diner. They think they own the beachfront.'], ['JAX', 'Nobody touches your place, Rosa.'], ['MAMA ROSA', 'Use your fists, your pistol, or a bumper. Make all four leave.']],
        outro: [['MAMA ROSA', 'My windows survived. My customers are already asking for seconds.'], ['JAX', 'Put my eight hundred toward a very long breakfast.']] },
    { id: 'm5', title: 'The Big Score', reward: 2000, summary: 'The bank van. Three stars. One last delivery.',
        intro: [['MAMA ROSA', 'Bay Trust is moving the Kings’ protection money in an armoured van.'], ['JAX', 'We borrow it, disappear, and bring it home?'], ['MAMA ROSA', 'Exactly. Take the van, lose a three-star chase, then reach your garage.']],
        outro: [['JAX', 'Van in the garage. No sirens. We made it.'], ['MAMA ROSA', 'Two thousand, Jax. You gave this city a little breathing room.'], ['MAMA ROSA', 'They’ll remember tonight. Neon Bay has a new legend.']] }
];
export const JOB_POINTS = {
    diner: { x: 2444, y: 1336, label: 'ROSA’S DINER' },
    hotel: { x: 822, y: 1336, label: 'GLASSWATER HOTEL' },
    garage: { x: 1214, y: 2060, label: 'MARLOWE MOTOR CO.' },
    repo: { x: 2514, y: 2380, label: 'MAGENTA MIRAGE GT' },
    bank: { x: 1230, y: 998, label: 'BAY TRUST VAN' },
    refuge: { x: 1670, y: 1332, label: 'FIND COVER · BREAK SIGHT' }
};
const FREE = 'Explore Neon Bay. Find Rosa’s jobs in the pause menu.';
export function createMissionState(completed = []) {
    return { active: null, completed: [...new Set(completed)], objective: FREE, marker: null, dialogue: null, result: null };
}
export function isUnlocked(completed, id) {
    const index = MISSIONS.findIndex(m => m.id === id);
    return index >= 0 && MISSIONS.slice(0, index).every(m => completed.includes(m.id));
}
export function installMission(game, mission) {
    game.mission.active = mission;
    game.mission.objective = mission?.objective || FREE;
    game.mission.marker = mission?.marker || null;
}
function relocate(game, x, y, h = 0) {
    if (game.player.car) game.player.car.ai = 'parked';
    Object.assign(game.player, { x, y, h, car: null, carCooldown: 0, invincible: 2, armed: false });
    Object.assign(game.camera, { x, y, zoom: 1.3 });
}
function jobCar(game, type, point, color, h = 0) {
    game.cars = game.cars.filter(c => dist(c, point) > 65);
    const car = makeCar(type, point.x, point.y, h, color);
    car.missionId = game.mission.active.id;
    game.cars.push(car);
    return car;
}
export function startMission(game, id) {
    const def = MISSIONS.find(m => m.id === id);
    if (!def || !isUnlocked(game.mission.completed, id)) return false;
    game.cars = game.cars.filter(c => !c.missionId || c === game.player.car);
    game.enemies = game.enemies.filter(e => !e.missionId);
    game.input.clear();
    game.waypoint = null;
    game.toast = null;
    game.mode = 'play';
    const m = { ...def, phase: 'briefing', stage: 'pickup', elapsed: 0, remaining: id === 'm1' ? 90 : null, target: null, foes: [], objective: def.summary, marker: null };
    installMission(game, m);
    game.mission.result = null;
    game.mission.dialogue = { lines: def.intro, outro: false };
    relocate(game, 2490, 1345);
    if (id === 'm1' || id === 'm2') m.target = jobCar(game, 'sports', { x: 2508, y: 1370 }, P.magenta);
    if (id === 'm3') {
        m.target = jobCar(game, 'sports', JOB_POINTS.repo, P.magenta, Math.PI / 2);
        relocate(game, 2490, 2325, Math.PI / 2);
    }
    if (id === 'm5') {
        m.target = jobCar(game, 'armored', JOB_POINTS.bank, '#8DA7A3');
        relocate(game, 1265, 1035, -Math.PI / 2);
    }
    syncObjective(game);
    return true;
}
export function advanceDialogue(game) {
    const m = game.mission.active;
    if (!m || !game.mission.dialogue) return;
    game.mission.dialogue = null;
    game.input.clear();
    if (m.phase === 'outro') {
        installMission(game, null);
        if (m.id === 'm5') {
            game.mode = 'ending';
            game.onMissionScreen?.('ending');
        }
        return;
    }
    m.phase = 'active';
    if (m.id === 'm2') {
        Object.assign(game.player, { car: m.target, x: m.target.x, y: m.target.y, h: m.target.h });
        m.target.stolen = true;
        setWanted(game, 2);
    }
    if (m.id === 'm4') {
        const spawns = [[2370, 1428], [2440, 1450], [2578, 1350], [2578, 1428]];
        m.foes = spawns.map(([x, y], i) => ({
            x, y, id: 900 + i, missionId: m.id, role: 'rival', home: { x, y }, hp: 70, maxHp: 70, h: Math.PI,
            jacket: i % 2 ? '#AD7046' : '#B2673F', skin: '#8D5A3C', hair: P.ink, dead: false, armed: true,
            moving: false, flash: 0, cooldown: 2 + i * .4, aggro: 20, punch: 0
        }));
        game.enemies.push(...m.foes);
        game.player.ammo = Math.max(36, game.player.ammo);
    }
    syncObjective(game);
}
export function failMission(game, reason) {
    const m = game.mission.active;
    if (!m || m.phase === 'failed' || m.phase === 'outro') return;
    m.phase = 'failed';
    game.mission.dialogue = null;
    game.mission.result = { id: m.id, title: m.title, reason };
    game.mode = 'mission-failed';
    game.input.clear();
    game.save();
    game.onMissionScreen?.('mission-failed');
}
function completeMission(game) {
    const m = game.mission.active;
    if (!m || m.phase !== 'active') return;
    m.phase = 'outro';
    if (!game.mission.completed.includes(m.id)) game.mission.completed.push(m.id);
    game.player.cash += m.reward;
    game.stats.earned += m.reward;
    game.stats.reputation += 250;
    game.mission.marker = m.marker = null;
    game.mission.objective = m.objective = `${m.title} complete · +$${m.reward.toLocaleString('en-US')}`;
    game.mission.dialogue = { lines: m.outro, outro: true };
    game.audio.play('complete');
    game.save();
}
function syncObjective(game) {
    const m = game.mission.active;
    if (!m || !['briefing', 'active'].includes(m.phase)) return;
    const p = game.player, driving = p.car === m.target;
    if (m.id === 'm1') {
        m.objective = m.package ? 'Deliver Rosa’s package to Glasswater Hotel.' : 'Enter the Mirage with Rosa’s package. Press E.';
        m.marker = m.package ? JOB_POINTS.hotel : { x: m.target.x, y: m.target.y, label: 'PACKAGE · MIRAGE GT' };
    } else if (m.id === 'm2') {
        m.objective = 'Lose Neon Bay PD. Stay hidden until wanted is 0.';
        m.marker = JOB_POINTS.refuge;
    } else if (m.id === 'm3') {
        m.objective = driving ? 'Bring the magenta Mirage GT to Jax’s garage.' : 'Steal the magenta Mirage GT at Marlin Wharf. Press E.';
        m.marker = driving ? JOB_POINTS.garage : { x: m.target.x, y: m.target.y, label: JOB_POINTS.repo.label };
    } else if (m.id === 'm4') {
        const left = m.foes.filter(e => !e.dead);
        m.objective = `Defend Rosa’s Diner. Copper Kings remaining: ${m.phase === 'briefing' ? 4 : left.length} / 4.`;
        m.marker = left[0] ? { x: left[0].x, y: left[0].y, label: 'COPPER KINGS' } : JOB_POINTS.diner;
    } else if (m.id === 'm5') {
        m.objective = m.stage === 'pickup' ? '1 / 3 · Steal the armoured van outside Bay Trust.' : m.stage === 'chase' ? '2 / 3 · Lose the three-star chase. Keep the van intact.' : driving ? '3 / 3 · Deliver the armoured van to Jax’s garage.' : '3 / 3 · Return to the armoured van, then reach the garage.';
        m.marker = m.stage === 'pickup' || !driving ? { x: m.target.x, y: m.target.y, label: JOB_POINTS.bank.label } : m.stage === 'chase' ? JOB_POINTS.refuge : JOB_POINTS.garage;
    }
    game.mission.objective = m.objective;
    game.mission.marker = m.marker;
}
export function missionEvent(game, type, data = {}) {
    const m = game.mission.active;
    m?.onEvent?.({ type, time: game.time, ...data }, game);
    if (!m || m.phase !== 'active') return;
    if (type === 'vehicleWrecked' && data.car === m.target && ['m1', 'm3', 'm5'].includes(m.id)) failMission(game, 'The job vehicle was destroyed. Rosa needs it in one piece.');
    if (type === 'enterCar' && m.id === 'm1' && data.car === m.target) m.package = true;
    if (type === 'enterCar' && m.id === 'm5' && data.car === m.target && m.stage === 'pickup') {
        m.stage = 'chase';
        setWanted(game, 3);
        game.audio.play('wanted');
        game.notify('BAY TRUST · SILENT ALARM', 'Three stars. Break sight and protect the van.', P.policeRed);
    }
    syncObjective(game);
}
export function updateMissions(game, dt) {
    const m = game.mission.active;
    if (!m) return;
    m.update?.(dt, game);
    if (!m.phase) {
        game.mission.objective = m.objective;
        game.mission.marker = m.marker;
        return;
    }
    if (m.phase !== 'active') return;
    m.elapsed += dt;
    if (m.target?.wreck && ['m1', 'm3', 'm5'].includes(m.id)) return failMission(game, 'The job vehicle was destroyed.');
    if (m.id === 'm1') {
        m.remaining = Math.max(0, 90 - m.elapsed);
        if (!m.remaining) return failMission(game, 'The ninety-second delivery window closed.');
        if (m.package && game.player.car && dist(game.player, JOB_POINTS.hotel) < 65) completeMission(game);
    }
    if (m.id === 'm2' && game.police.stars === 0) completeMission(game);
    if (m.id === 'm3' && game.player.car === m.target && dist(m.target, JOB_POINTS.garage) < 65 && Math.abs(m.target.speed) < 70) completeMission(game);
    if (m.id === 'm4' && m.foes.length === 4 && m.foes.every(e => e.dead)) completeMission(game);
    if (m.id === 'm5') {
        if (m.stage === 'chase' && game.police.stars === 0) m.stage = 'deliver';
        if (m.stage === 'deliver' && game.police.stars === 0 && game.player.car === m.target && dist(m.target, JOB_POINTS.garage) < 65 && Math.abs(m.target.speed) < 70) completeMission(game);
    }
    syncObjective(game);
}
