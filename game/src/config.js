// Projection: 64 world units per tile. Heading zero points east; positive turns clockwise.
export const TILE = 64;
export const WORLD = {
    width: 3456, height: 2880, coast: 2784, water: 2984, road: 104, sidewalk: 24, lane: 18
};
export const ROADS_X = [256, 640, 1024, 1408, 1792, 2176, 2560];
export const ROADS_Y = [256, 640, 1024, 1408, 1792, 2176, 2560];
export const PALETTE = {
    ink: '#1C1916', paper: '#F6F1E7', sky: '#79C7E8', skyDusk: '#2A2154', horizon: '#FFE7C2', horizonDusk: '#FF8A4C',
    water: '#178A9A', waterDusk: '#7A3E62', shallow: '#5FD3DC', shallowDusk: '#E07A62', foam: '#E7F7F4',
    asphalt: '#5A5E66', asphaltDusk: '#3E4450', patch: '#656A72', yellow: '#F4E7A8', white: '#E8E4D8',
    sidewalk: '#E4D2BA', sidewalkDusk: '#CDB89A', curb: '#F4EFE6', seawall: '#C8C2B8',
    coral: '#F0B2A4', coralShade: '#D4897C', terra: '#C46A55', cream: '#F3E2C8', trim: '#F6E7C1', wood: '#6E3B32',
    mint: '#C5E0D4', glass: '#8EC9D4', glassDeep: '#5AA3B5', mullion: '#F4F7F8', roof: '#E7E1D6', pool: '#3EC6D4', poolDeep: '#1F8A99',
    concrete: '#A39E96', corrugated: '#7E7870', rust: '#C46B4A', night: '#1E3344', lamp: '#FFE08A', pink: '#FF4FA3', cyan: '#3DE0FF',
    pearl: '#F4F1EA', carCoral: '#E7746F', mango: '#F0B429', taxi: '#F5C542', teal: '#1AA6A6', navy: '#243056', carMint: '#B7E4C7',
    magenta: '#E23D8C', sportsInk: '#16181D', carGlass: '#163042', glint: '#B7DCEA', tire: '#1A1C1F', hub: '#8E9298',
    headlamp: '#FFF1C9', taillight: '#E23B3B', policeStripe: '#E85D4C', policeCyan: '#7CF0FF', policeRed: '#FF5A6A',
    jacket: '#0E7C86', jacketShade: '#0A5560', trousers: '#2C3138', sand: '#EDD5A9', grass: '#94B69A', grassShade: '#7C9F87'
};
export const SKINS = ['#8D5A3C', '#C48A62', '#E0B090', '#5C3A28', '#F0C8A8'];
export const HAIR = ['#1C1916', '#6B3E2E', '#C9A36A', '#E7E1D6'];
export const CAR_COLORS = [PALETTE.pearl, PALETTE.carCoral, PALETTE.mango, PALETTE.teal, PALETTE.navy, PALETTE.carMint, PALETTE.magenta];
export const CARS = {
    sedan: {
        name: 'Paloma Sedan', length: 44, width: 22, max: 270, accel: 190, grip: 8, hp: 120
    },
    sports: {
        name: 'Mirage GT', length: 48, width: 20, max: 410, accel: 260, grip: 6.6, hp: 100
    },
    taxi: {
        name: 'Bay Cab', length: 46, width: 22, max: 285, accel: 205, grip: 8, hp: 120
    },
    van: {
        name: 'Harbor Hauler', length: 52, width: 24, max: 225, accel: 145, grip: 6, hp: 185
    },
    armored: {
        name: 'Bay Trust Armoured Van', length: 56, width: 26, max: 245, accel: 170, grip: 6.5, hp: 300
    },
    police: {
        name: 'NBPD Interceptor', length: 48, width: 23, max: 350, accel: 225, grip: 8.5, hp: 180
    }
};
export const GARAGE_PRICES = {sedan:300, taxi:450, van:550, sports:1200};
export const TAPE_COUNT = 10;
export const TUNE = {
    walk: 105, sprint: 172, playerRadius: 7, enterDistance: 53, shotInterval: .26, maxAmmo: 120, heatThresholds: [0, .9, 3.2, 6.2, 10.5, 16], loseSight: 10
};
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const money = v => '$' + Math.floor(v).toLocaleString('en-US');
export function mixColor(a, b, t) {
    const color = n => [1, 3, 5].map(i => parseInt(n.slice(i, i + 2), 16));
    const ac = color(a), bc = color(b);
    return '#' + ac.map((n, i) => Math.round(lerp(n, bc[i], t)).toString(16).padStart(2, '0')).join('');
}
