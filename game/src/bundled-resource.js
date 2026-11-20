// Binary reads are restricted to named files in this static game package.
const root = new URL('../', import.meta.url);
const characterModules = new Map([
    [new URL('assets/glb/jax.glb',root).href, () => import('../assets/glb/jax.bytes.js')],
    [new URL('assets/glb/female.glb',root).href, () => import('../assets/glb/female.bytes.js')]
]);
const files = new Set([...characterModules.keys(), ...['draco_decoder.js','draco_wasm_wrapper.js','draco_decoder.wasm']
    .map(name => new URL('vendor/draco/gltf/'+name,root).href)]);
const version = 'neon-bay-da6875d2-9a5d750a';

export async function bundledResource(url) {
    if (!files.has(url.href)) throw new Error('Unknown packaged asset '+url.pathname);
    try {
        const cache = await caches.open(version);
        const request = new Request(url,{mode:'same-origin',redirect:'error'});
        let response = await cache.match(request);
        if (!response) {
            await cache.add(request);
            response = await cache.match(request);
        }
        if (!response?.ok) throw new Error('Missing '+url.pathname);
        return response;
    } catch (error) {
        const load = characterModules.get(url.href);
        if (!load) throw error;
        const {default:encoded} = await load();
        const bytes = Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
    }
}
