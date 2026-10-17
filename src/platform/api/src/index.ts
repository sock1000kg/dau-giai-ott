export { createDatabase, runMigrations, type Database, type DatabaseOptions } from './db/client.ts';
export { loadMigrations, type Migration } from './db/schema.ts';
export { createAuthApp, type CreateAuthAppOptions } from './app.ts';
export {
  loadSecurityConfig,
  assertSecurityConfig,
  devSecurityConfig,
  effectiveClientIp,
  parseCidr,
  type SecurityConfig,
  type DeploymentMode,
  type Cidr,
} from './config/security.ts';
export { bootstrapBtcAdmin, type BootstrapBtcAdminOptions, type BootstrapBtcAdminResult } from './modules/auth/bootstrap.ts';
export { requireAuthenticated, requireRole, requireTeamAccess, AuthorizationError } from './modules/auth/authorize.ts';
export { createPasswordHasher, type PasswordHashPolicy } from './modules/auth/passwords.ts';
export { createRedisAuthStore, RedisAuthStore, type LoginRateLimiter, type RedisAuthCommands, type SessionStore } from './modules/auth/sessions.ts';
export { type AccountRole, type AuthRateLimit, type PasswordHasher, type SessionPrincipal } from './modules/auth/types.ts';
export { readSubmissionArchive } from './modules/submissions/service.ts';
export { registerSubmissionRoutes, type SubmissionRoutesOptions } from './modules/submissions/routes.ts';
export { UploadLimiter, type UploadLimiterOptions } from './modules/submissions/upload-limiter.ts';
export {
  createReservation,
  getCurrentReservation,
  resolveUpload,
  SubmissionReservationError,
  type RoundSchedule,
  type OpenSubmissionRound,
  type ReservationData,
} from './modules/submissions/reservations.ts';
export {
  scheduleRound,
  dispatchScheduledMatches,
  settleSeries,
  type ScheduleRoundInput,
  type ScheduledRound,
  type SeriesSettlement,
  type MatchJobEnqueuer,
} from './modules/scheduling/service.ts';
export { calculateEloDelta, expectedScore } from './modules/ratings/elo.ts';
export { applyRoundRatings, rebuildRatingLedger } from './modules/ratings/service.ts';
export { createS3Storage, type ObjectStorage, type S3StorageOptions } from './storage/s3.ts';
export { MatchQueue, MATCH_QUEUE_NAME, type MatchQueueOptions, type EnqueuedMatch } from './queue/match-queue.ts';
export { createRuleSet, listRuleSets, getRuleSet, createRound, listRounds, getRound, executeTransition, getAllowedTransitions, getAllowedActions, RuleSetInvalidError, type RoundServiceOptions, type RuleSetSummary, type RuleSetDetail, type RoundSummary, type RoundActionType } from './modules/rounds/service.ts';
export { registerRoundRoutes, type RoundRoutesOptions } from './modules/rounds/routes.ts';
export { validateRoundRuleSetRules, computeRulesSha256, canonicalJson, assertTransition, ALLOWED_TRANSITIONS, ROUND_RULE_SET_SCHEMA_VERSION, type RoundRuleSetRulesV1, type RoundStatus, type RoundAction, type ValidationError } from './modules/rounds/types.ts';
