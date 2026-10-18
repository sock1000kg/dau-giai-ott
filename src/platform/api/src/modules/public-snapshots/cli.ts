import { readFile } from 'node:fs/promises';
import { publishPublicSnapshot } from './publisher.ts';

const [input, directory] = process.argv.slice(2);
if (!input || !directory) throw new Error('Usage: tsx src/modules/public-snapshots/cli.ts INPUT.json OUTPUT_DIRECTORY');
const pointer = await publishPublicSnapshot(directory, JSON.parse(await readFile(input, 'utf8')));
console.log(JSON.stringify(pointer));
