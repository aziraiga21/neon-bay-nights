// Instantiate a separate stream for cosmetic placement. Consuming the simulation
// stream to draw a facade would also change the next pedestrian or traffic choice.
export const CITY_SEED = 1706;
export function createRandom(seed = CITY_SEED) {
    let state = seed | 0;
    const random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let n = Math.imul(state ^ (state >>> 15), 1 | state);
        n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
    random.range = (a, b) => a + (b - a) * random();
    // int includes both ends. A pick advances the same stream by one draw.
    random.int = (a, b) => Math.floor(random.range(a, b + 1));
    random.pick = items => items[random.int(0, items.length - 1)];
    return random;
}
