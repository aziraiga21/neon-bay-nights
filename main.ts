// Package the playable city and its captures exactly as stored, with no build-time randomness.
import { cpSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const source = fileURLToPath(new URL('.', import.meta.url));
const destination = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// Catch a missing retake before copying a partial entry into the scoring directory.
const captures: {name: string}[] = JSON.parse(readFileSync(join(source, 'shots.json'), 'utf8'));
for (const {name} of captures) {
  const image = readFileSync(join(source, 'screenshots', name));
  if (image[0] !== 0xff || image[1] !== 0xd8 || image.length > 262144) {
    throw new Error(`Invalid capture ${name}`);
  }
}
mkdirSync(destination, { recursive: true });
for (const directory of ['game', 'screenshots']) {
  cpSync(join(source, directory), join(destination, directory), { recursive: true });
}
const dossier = buildDossier(destination, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(destination, 'dossier.json'), dossier);
