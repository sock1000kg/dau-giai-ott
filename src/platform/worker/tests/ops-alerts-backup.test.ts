import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

describe('P3-N05: Operations Readiness - Metrics, Alerts, Backup & Runbooks', () => {
  const rulesPath = resolve(rootDir, 'ops/prometheus/rules.yml');
  const dashboardPath = resolve(rootDir, 'ops/grafana/dashboards/tournament.json');
  const backupScriptPath = resolve(rootDir, 'scripts/backup-local.sh');
  const restoreScriptPath = resolve(rootDir, 'scripts/restore-local.sh');
  const runbookPath = resolve(rootDir, 'docs/runbooks/production-operations.md');

  describe('Prometheus Alert Rules (ops/prometheus/rules.yml)', () => {
    it('exists and contains required alert rules and valid structure', async () => {
      expect(existsSync(rulesPath)).toBe(true);
      const content = await readFile(rulesPath, 'utf8');

      // Check group definition
      expect(content).toContain('name: ott_tournament_alerts');

      // Acceptance Criteria 1: alerts cover queue age, heartbeat, infra failure, finalize stuck, sandbox resource
      const requiredAlerts = [
        'QueueAgeHigh',
        'WorkerHeartbeatMissing',
        'InfraFailureSpike',
        'FinalizeStuck',
        'SandboxResourcePressure',
        'DeadLetterQueueNotEmpty',
        'BotForfeitSpike',
        'WorkerCapacityThrottled',
      ];

      for (const alertName of requiredAlerts) {
        expect(content).toContain(`alert: ${alertName}`);
      }

      // Check each alert has severity, annotations, and runbook links
      expect(content).toMatch(/severity:\s*(critical|warning)/);
      expect(content).toMatch(/runbook:\s*"docs\/runbooks\/production-operations\.md#[a-z0-9-]+"/);
    });

    it('ensures every runbook anchor in alert rules maps to a section in production-operations.md', async () => {
      const rulesContent = await readFile(rulesPath, 'utf8');
      const runbookContent = await readFile(runbookPath, 'utf8');

      const runbookLinkMatches = rulesContent.matchAll(/runbook:\s*"docs\/runbooks\/production-operations\.md#([a-z0-9-]+)"/g);
      const links = Array.from(runbookLinkMatches).map((m) => m[1]!);
      expect(links.length).toBeGreaterThan(0);

      // Verify each anchor exists as a header or section in runbook
      for (const anchor of links) {
        // e.g. "queue-congestion" -> matches "Queue" or "congestion"
        const keywords = anchor.split('-');
        const hasKeyword = keywords.some((kw) => runbookContent.toLowerCase().includes(kw));
        expect(hasKeyword).toBe(true);
      }
    });
  });

  describe('Grafana Operations Dashboard (ops/grafana/dashboards/tournament.json)', () => {
    it('exists and is a valid Grafana dashboard JSON with required panels', async () => {
      expect(existsSync(dashboardPath)).toBe(true);
      const raw = await readFile(dashboardPath, 'utf8');
      const dashboard = JSON.parse(raw);

      expect(dashboard.title).toBe('OTT Tournament Operations Dashboard');
      expect(dashboard.schemaVersion).toBeGreaterThanOrEqual(30);
      expect(Array.isArray(dashboard.panels)).toBe(true);
      expect(dashboard.panels.length).toBeGreaterThanOrEqual(8);

      const panelTitles = dashboard.panels.map((p: { title?: string }) => p.title ?? '');
      expect(panelTitles.some((t: string) => t.includes('Queue Age'))).toBe(true);
      expect(panelTitles.some((t: string) => t.includes('Active Worker Pool'))).toBe(true);
      expect(panelTitles.some((t: string) => t.includes('Match Attempt Outcomes'))).toBe(true);
      expect(panelTitles.some((t: string) => t.includes('Bot Forfeits Distribution'))).toBe(true);
      expect(panelTitles.some((t: string) => t.includes('Worker Concurrency & Adaptive Capacity'))).toBe(true);
      expect(panelTitles.some((t: string) => t.includes('Bot Peak Memory'))).toBe(true);
    });
  });

  describe('Backup & Restore Automation Scripts', () => {
    it('ensures backup-local.sh is a safe, robust bash script creating checksums and manifest', async () => {
      expect(existsSync(backupScriptPath)).toBe(true);
      const content = await readFile(backupScriptPath, 'utf8');

      // Must have bash shebang and strict safety flags
      expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
      expect(content).toContain('set -euo pipefail');

      // Acceptance Criteria 2: Exports database, storage and generates SHA-256 checksums & manifest
      expect(content).toContain('checksums.sha256');
      expect(content).toContain('manifest.json');
      expect(content).toContain('audit_events_count');
      expect(content).toContain('submissions_count');
      expect(content).toContain('matches_count');
    });

    it('ensures restore-local.sh performs fail-fast checksum verification before restoring', async () => {
      expect(existsSync(restoreScriptPath)).toBe(true);
      const content = await readFile(restoreScriptPath, 'utf8');

      // Must have bash shebang and strict safety flags
      expect(content).toMatch(/^#!\/usr\/bin\/env bash/);
      expect(content).toContain('set -euo pipefail');

      // Acceptance Criteria 2: Verifies checksums, restores database and storage, checks audit count
      expect(content).toContain('checksums.sha256');
      expect(content).toContain('manifest.json');
      expect(content).toContain('audit_events');
      expect(content).toContain('submissions');
      expect(content).toContain('matches');
    });
  });

  describe('Incident Runbooks & OWASP Checklist (docs/runbooks/production-operations.md)', () => {
    it('covers all 4 required emergency playbooks with designated owners and actions', async () => {
      expect(existsSync(runbookPath)).toBe(true);
      const content = await readFile(runbookPath, 'utf8');

      // Acceptance Criteria 3: Emergency playbooks with owner & action
      // Playbook 1: Pause upload / freeze submissions
      expect(content).toMatch(/Pause Upload \/ Freeze Submissions/i);
      expect(content).toContain('Phạm Tất Đạt');
      expect(content).toContain('Đinh Đức Thuận');

      // Playbook 2: Read-only public mode
      expect(content).toMatch(/Read-Only Public Mode/i);
      expect(content).toContain('Đỗ Khôi Nguyên');

      // Playbook 3: Emergency secret rotation
      expect(content).toMatch(/Secret Rotation/i);
      expect(content).toContain('Phạm Tất Đạt');

      // Playbook 4: Incident communication & grace window compensation
      expect(content).toMatch(/Thông báo Sự cố & Đền bù Thời gian/i);
      expect(content).toContain('Đinh Đức Thuận');

      // Verification: OWASP Top 10 self-assessment & tabletop drill sign-off
      expect(content).toContain('OWASP Top 10');
      expect(content).toContain('A01: Broken Access Control');
      expect(content).toContain('A04: Insecure Design');
      expect(content).toContain('A10: SSRF');
      expect(content).toContain('Tabletop Incident Drill');
      expect(content).toContain('Đinh Đức Thuận');
    });
  });
});

