import { randomUUID } from 'node:crypto';

const namespacePattern = /^[a-f0-9]{32}$/;
const projectPrefix = 'ott-qualification-';

export function createQualificationNamespace(): string {
  return randomUUID().replaceAll('-', '');
}

export function createQualificationProjectName(namespace: string): string {
  if (!namespacePattern.test(namespace)) throw new Error('QUALIFICATION_NAMESPACE_INVALID');
  return `${projectPrefix}${namespace}`;
}

export function composeBaseArgs(projectName: string, envFile: string, composeFile: string): string[] {
  if (!projectName.startsWith(projectPrefix) || !namespacePattern.test(projectName.slice(projectPrefix.length))) {
    throw new Error('QUALIFICATION_PROJECT_NOT_ISOLATED');
  }
  if (!envFile.startsWith('/') || !composeFile.startsWith('/')) throw new Error('QUALIFICATION_PATH_MUST_BE_ABSOLUTE');
  return ['compose', '--project-name', projectName, '--env-file', envFile, '-f', composeFile];
}

export function parsePublishedPort(output: string): number {
  const match = /^127\.0\.0\.1:(\d+)$/.exec(output.trim());
  if (match === null) throw new Error('QUALIFICATION_PORT_MUST_BIND_LOOPBACK');
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('QUALIFICATION_PUBLISHED_PORT_INVALID');
  return port;
}
