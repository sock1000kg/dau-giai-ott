-- Migration 0018: drop the operations "cases" backend (anomaly / duplicate / appeal).
-- Decision by the project owner on 2026-10-18: cases were only a log nothing acted on, appeals are handled
-- outside the platform. History is retained: audit_events rows with CASE_* actions are append-only and untouched.
-- Kept: reject_append_only_mutation() (shared by audit_events and queue_overrides triggers), audit_events,
-- queue_overrides, qualification_rounds.results_hash, match_outbox.generation.
-- Dependency order: queue_overrides FK -> events table -> cases table -> state-machine function.
-- IF EXISTS is used only on the table/function drops so a half-migrated dev database can re-run; the column drop is strict.

ALTER TABLE queue_overrides DROP COLUMN case_id;
DROP TABLE IF EXISTS operations_case_events;
DROP TABLE IF EXISTS operations_cases;
DROP FUNCTION IF EXISTS enforce_operations_case_transition();
