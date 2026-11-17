// Phase 2 extension point. Core systems emit events here; no story chain is installed yet.
// A mission may provide { objective, marker:{x,y,label}, onEvent(event, game), update(dt, game) }.
export function createMissionState(completed = []) {
    return {
        active: null, completed: [...completed], objective: 'Explore Neon Bay. Make the city yours.', marker: null
    };
}
export function installMission(game, mission) {
    game.mission.active = mission;
    game.mission.objective = mission?.objective || 'Explore Neon Bay. Make the city yours.';
    game.mission.marker = mission?.marker || null;
}
export function missionEvent(game, type, data = {}) {
    const event = { type, time: game.time, ...data };
    game.mission.active?.onEvent?.(event, game);
}
export function updateMissions(game, dt) {
    const m = game.mission.active;
    if (m) {
        m.update?.(dt, game);
        game.mission.objective = m.objective;
        game.mission.marker = m.marker;
    }
}
