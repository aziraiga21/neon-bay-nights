const KEY = 'neon-bay-nights.v1';
export function readSave() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) {
            return null;
        }
        const d = JSON.parse(raw);
        if (d.version !== 1 || !Number.isFinite(d.cash)) {
            return null;
        }
        return {
            version: 1, cash: Math.max(0, Math.min(99999999, d.cash)), best: Math.max(0, Number(d.best) || 0), missions: Array.isArray(d.missions) ? d.missions.filter(x => typeof x === 'string') : [], unlockedCars: Array.isArray(d.unlockedCars) ? d.unlockedCars.filter(x => typeof x === 'string') : [], ammo: Math.min(120, Math.max(0, Number.isFinite(d.ammo) ? d.ammo : 36)), settings: { muted: !!d.settings?.muted, music: d.settings?.music !== false }, savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0
        };
    }
    catch {
        return null;
    }
}
export function writeSave(game) {
    if (game.capture) {
        return true;
    }
    const d = {
        // Completed job IDs are stored alongside cash; active pursuits always restart fresh.
        version: 1, cash: Math.floor(game.player.cash), ammo: game.player.ammo, best: Math.max(game.best, game.stats.reputation), missions: [...new Set(game.mission.completed)], unlockedCars: [...game.unlockedCars], settings: { muted: game.audio.muted, music: game.audio.musicEnabled }, savedAt: Date.now()
    };
    try {
        localStorage.setItem(KEY, JSON.stringify(d));
        game.saveError = false;
        game.lastSave = game.time;
        return true;
    }
    catch {
        game.saveError = true;
        return false;
    }
}
