// Independent seeded streams keep city generation and simulation reproducible.
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
    random.int = (a, b) => Math.floor(random.range(a, b + 1));
    random.pick = a => a[Math.floor(random() * a.length)];
    return random;
}
