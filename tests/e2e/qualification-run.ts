import { resolve } from 'node:path';
import { assertQualificationPrerequisites, seedQualificationFixtures } from './qualification-fixtures.ts';

try {
  const action = process.argv[2];
  if (action === 'preflight') await assertQualificationPrerequisites(resolve('.'));
  else if (action === 'seed') await seedQualificationFixtures(process.env, resolve('.'));
  else throw new Error('QUALIFICATION_ACTION_INVALID');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'QUALIFICATION_SETUP_FAILED'}\n`);
  process.exitCode = 1;
}
