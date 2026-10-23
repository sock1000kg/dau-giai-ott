import { useEffect, useMemo, useState } from 'react';
import { Select } from '../../ui/index.ts';
import './round-admin.css';
import { createRuleSet, RoundAdminApiError, type RoundCatalog } from './api.ts';
import { FIELD_HELP, fieldIdFromDomId } from './field-help.ts';
import { estimateWorstCase, formatDuration } from './estimate.ts';
import {
  defaultFormState,
  formStateFromRules,
  formStateToRules,
  type RoundRuleFormState,
  type RoundRuleSetRulesV1,
} from './rules-form.ts';

export interface LockedRuleSetInfo {
  readonly version: number;
  readonly rulesSha256: string;
  readonly rules: RoundRuleSetRulesV1;
}

export function mapServerPathToField(path: string): string | null {
  if (path === 'engineVersion' || path === 'maxTurns' || path === 'faultPolicyVersion') return path;
  if (path === 'quotaPerTeamPerDay' || path === 'testRun.quotaPerTeamPerDay') return 'quotaPerTeamPerDay';
  if (path === 'testRun.opponents' || path.startsWith('testRun.opponents[')) return 'opponents';
  const timeControl = /^timeControl\.(startupMs|totalBotBudgetMs|matchWallClockMs)$/.exec(path);
  if (timeControl) return timeControl[1] as string;
  const perTurn = /^timeControl\.perTurn\.(fixedMs|baseMs|stepMs|everyTurns|maxMs)$/.exec(path);
  if (perTurn) return perTurn[1] as string;
  const resources = /^resources\.(memoryMiB|milliCpu|pids|tmpfsMiB|archiveMiB|unpackedMiB|maxLayers)$/.exec(path);
  if (resources) return resources[1] as string;
  if (path === 'schedule') return 'submissionOpensAt';
  const schedule = /^schedule\.(submissionOpensAt|submissionDeadlineAt|graceEndsAt|runStartsAt|runMaxHours|appealEndsAt)$/.exec(path);
  if (schedule) return schedule[1] as string;
  const mapField = /^mapSet\[(\d+)\]\.(mapId|checksum)$/.exec(path);
  if (mapField) return `maps[${mapField[1]}].${mapField[2]}`;
  if (path === 'mapSet') return 'maps';
  return null;
}

/**
 * Vietnamese messages for the codes added by P3-D25 rule-set validation. The runner limits (200 turns,
 * 3000 ms per turn) come from `DEFAULT_LIMITS` in `api/src/modules/rounds/catalog.ts`.
 */
const SERVER_CODE_MESSAGES: Readonly<Record<string, string>> = {
  ORDER_VIOLATION: 'Thứ tự thời gian phải là: mở nộp < hạn nộp < hết ân hạn ≤ bắt đầu chạy < hết khiếu nại.',
  INVALID_ISO8601: 'Thời gian không hợp lệ (cần định dạng ISO 8601).',
  UNKNOWN_ENGINE_VERSION: 'Engine không có trong danh mục.',
  UNKNOWN_MAP: 'Bản đồ hoặc checksum không có trong danh mục.',
  UNKNOWN_FAULT_POLICY: 'Fault policy không có trong danh mục.',
  MAX_TURNS_EXCEEDS_RUNNER_LIMIT: 'Số lượt tối đa vượt giới hạn của bộ chạy trận (200).',
  TURN_LIMIT_EXCEEDS_RUNNER_LIMIT: 'Thời gian mỗi lượt vượt giới hạn của bộ chạy trận (3000 ms).',
};

export function serverCodeMessage(code: string): string {
  return SERVER_CODE_MESSAGES[code] ?? `Máy chủ từ chối: ${code}.`;
}

const STALE_LABEL = '(không còn trong danh mục)';
const STALE_VALUE = '__stored__';

function describedBy(id: string, error: string | undefined): string {
  return error !== undefined ? `${id}-help ${id}-error` : `${id}-help`;
}

function Help({ id }: Readonly<{ id: string }>) {
  const text = (FIELD_HELP as Record<string, string>)[fieldIdFromDomId(id)];
  return <p className="field-help" id={`${id}-help`}>{text}</p>;
}

interface CatalogSelectProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly placeholder: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}

/** Picker over catalog strings; a stored value missing from the catalog stays selectable instead of being replaced. */
function CatalogSelect({ id, label, value, options, placeholder, error, onChange }: CatalogSelectProps) {
  const stale = value !== '' && !options.includes(value);
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <Select id={id} value={value} aria-invalid={error !== undefined} aria-describedby={describedBy(id, error)} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {stale && <option value={value}>{value} {STALE_LABEL}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </Select>
      <Help id={id} />
      {error !== undefined && <p id={`${id}-error`}>{error}</p>}
    </div>
  );
}

interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}

function NumberField({ id, label, value, disabled, error, onChange }: NumberFieldProps) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, error)}
        onChange={(event) => onChange(event.target.value)}
      />
      <Help id={id} />
      {error !== undefined && <p id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function RoundRuleForm({
  stage,
  prefill,
  locked,
  initialTeamCount,
  notice,
  idPrefix = 'rr',
  catalog = null,
  onSaved,
}: Readonly<{
  stage: string;
  prefill: RoundRuleSetRulesV1 | null;
  locked: LockedRuleSetInfo | null;
  initialTeamCount: number;
  /** Replaces the default locked-rule-set sentence (e.g. for an unlocked preview). */
  notice?: string | undefined;
  /** DOM id prefix; two forms on one page (current rules + editor) must not share ids. */
  idPrefix?: string;
  /** Engine/map/fault-policy catalog; `null` (or a locked form) keeps plain text inputs. */
  catalog?: RoundCatalog | null;
  onSaved: (result: { readonly version: number; readonly rulesSha256: string }) => void;
}>) {
  const p = idPrefix;
  const readOnly = locked !== null;
  const [form, setForm] = useState<RoundRuleFormState>(() =>
    (locked?.rules ?? prefill) ? formStateFromRules((locked?.rules ?? prefill) as RoundRuleSetRulesV1) : defaultFormState(),
  );
  const [teamCount, setTeamCount] = useState(String(initialTeamCount));
  const [concurrency, setConcurrency] = useState('4');
  const [acknowledged, setAcknowledged] = useState(false);
  const [clientErrors, setClientErrors] = useState<Readonly<Record<string, string>>>({});
  const [serverErrors, setServerErrors] = useState<Readonly<Record<string, string>>>({});
  const [unknownPaths, setUnknownPaths] = useState<readonly string[]>([]);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ readonly version: number; readonly rulesSha256: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const rules = locked?.rules ?? prefill;
    setForm(rules ? formStateFromRules(rules) : defaultFormState());
    setClientErrors({});
    setServerErrors({});
    setUnknownPaths([]);
    setSaveFailure(null);
    setSaved(null);
    setAcknowledged(false);
  }, [locked, prefill, stage]);

  useEffect(() => {
    setTeamCount(String(initialTeamCount));
  }, [initialTeamCount]);

  function patch(update: Partial<RoundRuleFormState>) {
    setForm((current) => ({ ...current, ...update }));
  }

  const estimate = useMemo(() => {
    const wallClock = Number(form.matchWallClockMs);
    const maxHours = Number(form.runMaxHours);
    if (!Number.isFinite(wallClock) || !Number.isFinite(maxHours)) return null;
    return estimateWorstCase({
      teamCount: Number(teamCount),
      concurrency: Number(concurrency),
      matchWallClockMs: wallClock,
      runMaxHours: maxHours,
    });
  }, [form.matchWallClockMs, form.runMaxHours, teamCount, concurrency]);

  const overWindow = estimate !== null && estimate.exceedsWindow;
  const canSave = !readOnly && !saving && (!overWindow || acknowledged);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || saving) return;
    const parsed = formStateToRules(form);
    if (!parsed.ok) {
      const mapped: Record<string, string> = {};
      for (const entry of parsed.errors) mapped[entry.field] = entry.message;
      setClientErrors(mapped);
      setSaveFailure('Biểu mẫu còn thiếu hoặc sai. Vui lòng kiểm tra các trường.');
      return;
    }
    setClientErrors({});
    const reason = form.reason.trim();
    if (reason.length < 1 || reason.length > 500) {
      setClientErrors({ reason: 'Lý do phải từ 1 đến 500 ký tự.' });
      setSaveFailure('Biểu mẫu còn thiếu hoặc sai. Vui lòng kiểm tra các trường.');
      return;
    }
    if (overWindow && !acknowledged) return;
    setSaving(true);
    setSaveFailure(null);
    setServerErrors({});
    setUnknownPaths([]);
    try {
      const result = await createRuleSet(stage, parsed.rules, reason);
      setSaved(result);
      onSaved(result);
    } catch (cause) {
      if (cause instanceof RoundAdminApiError && cause.details.length > 0) {
        const mapped: Record<string, string> = {};
        const unknown: string[] = [];
        for (const detail of cause.details) {
          const field = mapServerPathToField(detail.path);
          if (field === null) unknown.push(detail.path);
          else mapped[field] = serverCodeMessage(detail.code);
        }
        setServerErrors(mapped);
        setUnknownPaths(unknown);
        setSaveFailure('Máy chủ từ chối bộ luật. Vui lòng kiểm tra các trường.');
      } else if (cause instanceof RoundAdminApiError && cause.status === 401) {
        setSaveFailure('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      } else if (cause instanceof RoundAdminApiError && cause.status === 403) {
        setSaveFailure('Tài khoản không có quyền quản lý round.');
      } else {
        setSaveFailure('Không thể lưu bộ luật. Vui lòng thử lại.');
      }
    } finally {
      setSaving(false);
    }
  }

  function mapIsStale(source: RoundCatalog, row: { readonly mapId: string; readonly checksum: string }): boolean {
    return row.mapId !== '' && !source.maps.some((entry) => entry.mapId === row.mapId && entry.checksum === row.checksum);
  }

  function mapSelectValue(source: RoundCatalog, row: { readonly mapId: string; readonly checksum: string }): string {
    if (row.mapId === '') return '';
    return mapIsStale(source, row) ? STALE_VALUE : row.mapId;
  }

  function chooseMap(source: RoundCatalog, index: number, mapId: string) {
    if (mapId === STALE_VALUE) return;
    const entry = source.maps.find((candidate) => candidate.mapId === mapId);
    patch({ maps: form.maps.map((row, i) => i === index ? { mapId: entry?.mapId ?? '', checksum: entry?.checksum ?? '' } : row) });
  }

  const errors = { ...clientErrors, ...serverErrors };
  const inputDisabled = readOnly;
  const picker = catalog !== null && !readOnly ? catalog : null;

  return (
    <form className="round-rule-form" aria-label="Biểu mẫu bộ luật round" onSubmit={(event) => void handleSave(event)}>
      {readOnly && locked !== null && notice !== undefined && <p>{notice}</p>}
      {readOnly && locked !== null && notice === undefined && (
        <p>Bộ luật đã khóa — thay đổi chỉ áp dụng từ round sau (phiên bản {locked.version}, sha {locked.rulesSha256.slice(0, 8)}).</p>
      )}
      <div className={readOnly ? undefined : 'rr-scroll'}>
      <fieldset>
        <legend>Thời gian</legend>
        <NumberField id={`${p}-startupMs`} label="Startup (ms)" value={form.startupMs} disabled={inputDisabled} error={errors.startupMs} onChange={(value) => patch({ startupMs: value })} />
        <NumberField id={`${p}-totalBotBudgetMs`} label="Tổng thời gian/bot/trận (ms)" value={form.totalBotBudgetMs} disabled={inputDisabled} error={errors.totalBotBudgetMs} onChange={(value) => patch({ totalBotBudgetMs: value })} />
        <NumberField id={`${p}-matchWallClockMs`} label="Wall-clock/trận (ms)" value={form.matchWallClockMs} disabled={inputDisabled} error={errors.matchWallClockMs} onChange={(value) => patch({ matchWallClockMs: value })} />
        <div>
          <label htmlFor={`${p}-perTurnMode`}>Thời gian mỗi lượt</label>
          <Select id={`${p}-perTurnMode`} value={form.perTurnMode} disabled={inputDisabled} aria-describedby={`${p}-perTurnMode-help`} onChange={(event) => patch({ perTurnMode: event.target.value as 'FIXED' | 'DYNAMIC' })}>
            <option value="FIXED">Cố định 3s</option>
            <option value="DYNAMIC">Dynamic</option>
          </Select>
          <Help id={`${p}-perTurnMode`} />
        </div>
        {form.perTurnMode === 'FIXED' ? (
          <NumberField id={`${p}-fixedMs`} label="Thời gian cố định mỗi lượt (ms)" value={form.fixedMs} disabled={inputDisabled} error={errors.fixedMs} onChange={(value) => patch({ fixedMs: value })} />
        ) : (
          <>
            <NumberField id={`${p}-baseMs`} label="Base (ms)" value={form.baseMs} disabled={inputDisabled} error={errors.baseMs} onChange={(value) => patch({ baseMs: value })} />
            <NumberField id={`${p}-stepMs`} label="Bước tăng (ms)" value={form.stepMs} disabled={inputDisabled} error={errors.stepMs} onChange={(value) => patch({ stepMs: value })} />
            <NumberField id={`${p}-everyTurns`} label="Mỗi N lượt" value={form.everyTurns} disabled={inputDisabled} error={errors.everyTurns} onChange={(value) => patch({ everyTurns: value })} />
            <NumberField id={`${p}-maxMs`} label="Max (ms)" value={form.maxMs} disabled={inputDisabled} error={errors.maxMs} onChange={(value) => patch({ maxMs: value })} />
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Tài nguyên</legend>
        <NumberField id={`${p}-memoryMiB`} label="Bộ nhớ (MiB)" value={form.memoryMiB} disabled={inputDisabled} error={errors.memoryMiB} onChange={(value) => patch({ memoryMiB: value })} />
        <NumberField id={`${p}-milliCpu`} label="CPU (milliCPU)" value={form.milliCpu} disabled={inputDisabled} error={errors.milliCpu} onChange={(value) => patch({ milliCpu: value })} />
        <NumberField id={`${p}-pids`} label="PIDs" value={form.pids} disabled={inputDisabled} error={errors.pids} onChange={(value) => patch({ pids: value })} />
        <NumberField id={`${p}-tmpfsMiB`} label="Tmpfs (MiB)" value={form.tmpfsMiB} disabled={inputDisabled} error={errors.tmpfsMiB} onChange={(value) => patch({ tmpfsMiB: value })} />
        <NumberField id={`${p}-archiveMiB`} label="Archive (MiB)" value={form.archiveMiB} disabled={inputDisabled} error={errors.archiveMiB} onChange={(value) => patch({ archiveMiB: value })} />
        <NumberField id={`${p}-unpackedMiB`} label="Unpacked (MiB)" value={form.unpackedMiB} disabled={inputDisabled} error={errors.unpackedMiB} onChange={(value) => patch({ unpackedMiB: value })} />
        <NumberField id={`${p}-maxLayers`} label="Số layer tối đa" value={form.maxLayers} disabled={inputDisabled} error={errors.maxLayers} onChange={(value) => patch({ maxLayers: value })} />
      </fieldset>

      <fieldset>
        <legend>Luật game</legend>
        {picker !== null ? (
          <CatalogSelect id={`${p}-engineVersion`} label="Engine version" value={form.engineVersion} options={picker.engineVersions} placeholder="— Chọn engine —" error={errors.engineVersion} onChange={(value) => patch({ engineVersion: value })} />
        ) : (
        <div>
            <label htmlFor={`${p}-engineVersion`}>Engine version</label>
            <input id={`${p}-engineVersion`} type="text" value={form.engineVersion} disabled={inputDisabled} aria-invalid={errors.engineVersion !== undefined} aria-describedby={describedBy(`${p}-engineVersion`, errors.engineVersion)} onChange={(event) => patch({ engineVersion: event.target.value })} />
            <Help id={`${p}-engineVersion`} />
            {errors.engineVersion !== undefined && <p id={`${p}-engineVersion-error`}>{errors.engineVersion}</p>}
          </div>
        )}
        <NumberField id={`${p}-maxTurns`} label="Số lượt tối đa" value={form.maxTurns} disabled={inputDisabled} error={errors.maxTurns} onChange={(value) => patch({ maxTurns: value })} />
        {picker !== null ? (
          <CatalogSelect id={`${p}-faultPolicyVersion`} label="Fault policy version" value={form.faultPolicyVersion} options={picker.faultPolicyVersions} placeholder="— Chọn fault policy —" error={errors.faultPolicyVersion} onChange={(value) => patch({ faultPolicyVersion: value })} />
        ) : (
        <div>
          <label htmlFor={`${p}-faultPolicyVersion`}>Fault policy version</label>
          <input id={`${p}-faultPolicyVersion`} type="text" value={form.faultPolicyVersion} disabled={inputDisabled} aria-invalid={errors.faultPolicyVersion !== undefined} aria-describedby={describedBy(`${p}-faultPolicyVersion`, errors.faultPolicyVersion)} onChange={(event) => patch({ faultPolicyVersion: event.target.value })} />
          <Help id={`${p}-faultPolicyVersion`} />
          {errors.faultPolicyVersion !== undefined && <p id={`${p}-faultPolicyVersion-error`}>{errors.faultPolicyVersion}</p>}
        </div>
        )}
        <div>
          <span id={`${p}-maps-label`}>Map thi đấu (1–16)</span>
          {errors.maps !== undefined && <p id={`${p}-maps-error`}>{errors.maps}</p>}
          <ul aria-labelledby={`${p}-maps-label`}>
            {form.maps.map((row, index) => (
              <li key={index}>
                <label htmlFor={`${p}-mapId-${index}`}>Map ID #{index + 1}</label>
                {picker !== null ? (
                  <Select id={`${p}-mapId-${index}`} value={mapSelectValue(picker, row)} aria-invalid={errors[`maps[${index}].mapId`] !== undefined} aria-describedby={describedBy(`${p}-mapId-${index}`, errors[`maps[${index}].mapId`])} onChange={(event) => chooseMap(picker, index, event.target.value)}>
                    <option value="">— Chọn map —</option>
                    {mapIsStale(picker, row) && <option value={STALE_VALUE}>{row.mapId} {STALE_LABEL}</option>}
                    {picker.maps.map((entry) => (
                      <option key={entry.mapId} value={entry.mapId} disabled={form.maps.some((other, i) => i !== index && other.mapId === entry.mapId)}>
                        {entry.mapId} · v{entry.version} · {entry.width}×{entry.height}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <input id={`${p}-mapId-${index}`} type="text" value={row.mapId} disabled={inputDisabled} aria-invalid={errors[`maps[${index}].mapId`] !== undefined} aria-describedby={describedBy(`${p}-mapId-${index}`, errors[`maps[${index}].mapId`])} onChange={(event) => patch({ maps: form.maps.map((entry, i) => i === index ? { ...entry, mapId: event.target.value } : entry) })} />
                )}
                <Help id={`${p}-mapId-${index}`} />
                {errors[`maps[${index}].mapId`] !== undefined && <p id={`${p}-mapId-${index}-error`}>{errors[`maps[${index}].mapId`]}</p>}
                <label htmlFor={`${p}-checksum-${index}`}>Checksum #{index + 1}</label>
                <input id={`${p}-checksum-${index}`} type="text" value={row.checksum} disabled={inputDisabled} readOnly={picker !== null} title={picker !== null ? row.checksum : undefined} className={picker !== null ? 'rr-checksum' : undefined} aria-invalid={errors[`maps[${index}].checksum`] !== undefined} aria-describedby={describedBy(`${p}-checksum-${index}`, errors[`maps[${index}].checksum`])} onChange={(event) => patch({ maps: form.maps.map((entry, i) => i === index ? { ...entry, checksum: event.target.value } : entry) })} />
                <Help id={`${p}-checksum-${index}`} />
                {errors[`maps[${index}].checksum`] !== undefined && <p id={`${p}-checksum-${index}-error`}>{errors[`maps[${index}].checksum`]}</p>}
                {!readOnly && form.maps.length > 1 && (
                  <button type="button" onClick={() => patch({ maps: form.maps.filter((_, i) => i !== index) })}>Xóa map #{index + 1}</button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && form.maps.length < 16 && (
            <button
              type="button"
              disabled={picker !== null && form.maps.length >= picker.maps.length}
              title={picker !== null && form.maps.length >= picker.maps.length ? 'Đã dùng hết bản đồ trong danh mục' : undefined}
              onClick={() => patch({ maps: [...form.maps, { mapId: '', checksum: '' }] })}
            >Thêm map</button>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Lịch (giờ Việt Nam, Asia/Ho_Chi_Minh)</legend>
        {([
          [`${p}-submissionOpensAt`, 'Mở nộp bài', form.submissionOpensAt, 'submissionOpensAt'],
          [`${p}-submissionDeadlineAt`, 'Hạn nộp bài', form.submissionDeadlineAt, 'submissionDeadlineAt'],
          [`${p}-graceEndsAt`, 'Kết thúc gia hạn', form.graceEndsAt, 'graceEndsAt'],
          [`${p}-runStartsAt`, 'Bắt đầu chạy', form.runStartsAt, 'runStartsAt'],
          [`${p}-appealEndsAt`, 'Kết thúc khiếu nại', form.appealEndsAt, 'appealEndsAt'],
        ] as const).map(([id, label, value, field]) => (
          <div key={id}>
            <label htmlFor={id}>{label}</label>
            <input id={id} type="datetime-local" value={value} disabled={inputDisabled} aria-invalid={errors[field] !== undefined} aria-describedby={describedBy(id, errors[field])} onChange={(event) => patch({ [field]: event.target.value } as Partial<RoundRuleFormState>)} />
            <Help id={id} />
            {errors[field] !== undefined && <p id={`${id}-error`}>{errors[field]}</p>}
          </div>
        ))}
        <NumberField id={`${p}-runMaxHours`} label="Khung chạy tối đa (giờ)" value={form.runMaxHours} disabled={inputDisabled} error={errors.runMaxHours} onChange={(value) => patch({ runMaxHours: value })} />
      </fieldset>

      <fieldset>
        <legend>Test run</legend>
        <NumberField id={`${p}-quotaPerTeamPerDay`} label="Quota test run/đội/ngày" value={form.quotaPerTeamPerDay} disabled={inputDisabled} error={errors.quotaPerTeamPerDay} onChange={(value) => patch({ quotaPerTeamPerDay: value })} />
        <div>
          <input id={`${p}-opponentBtc`} type="checkbox" checked={form.opponentBtc} disabled={inputDisabled} aria-describedby={`${p}-opponentBtc-help`} onChange={(event) => patch({ opponentBtc: event.target.checked })} />
          <label htmlFor={`${p}-opponentBtc`}>BTC_REFERENCE</label>
          <Help id={`${p}-opponentBtc`} />
        </div>
        <div>
          <input id={`${p}-opponentOwn`} type="checkbox" checked={form.opponentOwn} disabled={inputDisabled} aria-describedby={`${p}-opponentOwn-help`} onChange={(event) => patch({ opponentOwn: event.target.checked })} />
          <label htmlFor={`${p}-opponentOwn`}>OWN_SUBMISSION</label>
          <Help id={`${p}-opponentOwn`} />
        </div>
        {errors.opponents !== undefined && <p id={`${p}-opponents-error`}>{errors.opponents}</p>}
      </fieldset>

      <fieldset>
        <legend>Ước tính worst-case</legend>
        <div>
          <label htmlFor={`${p}-teamCount`}>Số đội (T)</label>
          <input id={`${p}-teamCount`} type="number" inputMode="numeric" value={teamCount} disabled={inputDisabled} aria-describedby={`${p}-teamCount-help`} onChange={(event) => setTeamCount(event.target.value)} />
          <Help id={`${p}-teamCount`} />
        </div>
        <div>
          <label htmlFor={`${p}-concurrency`}>Đồng thời (C) — giả định, chưa có số đo worker (P3-N02)</label>
          <input id={`${p}-concurrency`} type="number" inputMode="numeric" value={concurrency} disabled={inputDisabled} aria-describedby={`${p}-concurrency-help`} onChange={(event) => setConcurrency(event.target.value)} />
          <Help id={`${p}-concurrency`} />
        </div>
        {estimate !== null && (
          <p>
            {estimate.games} trận, {estimate.waves} đợt, ước tính {formatDuration(estimate.worstMs)}.
          </p>
        )}
        {overWindow && (
          <>
            <p role="alert">Ước tính vượt khung chạy round. Cần xác nhận trước khi lưu.</p>
          </>
        )}
      </fieldset>
      </div>

      {!readOnly && (
        <div className="rr-footer">
          {overWindow && (
            <div>
              <input id={`${p}-acknowledge`} type="checkbox" checked={acknowledged} aria-describedby={`${p}-acknowledge-help`} onChange={(event) => setAcknowledged(event.target.checked)} />
              <label htmlFor={`${p}-acknowledge`}>Tôi xác nhận ước tính vượt khung chạy round</label>
              <Help id={`${p}-acknowledge`} />
            </div>
          )}
          <div>
            <label htmlFor={`${p}-reason`}>Lý do thay đổi</label>
            <textarea id={`${p}-reason`} required minLength={1} maxLength={500} value={form.reason} aria-invalid={errors.reason !== undefined} aria-describedby={describedBy(`${p}-reason`, errors.reason)} onChange={(event) => patch({ reason: event.target.value })} />
            <Help id={`${p}-reason`} />
            {errors.reason !== undefined && <p id={`${p}-reason-error`}>{errors.reason}</p>}
          </div>
          {(saveFailure !== null || unknownPaths.length > 0) && (
            <div role="alert">
              {saveFailure !== null && <p>{saveFailure}</p>}
              {unknownPaths.length > 0 && <p>Máy chủ từ chối các trường chưa rõ: {unknownPaths.join(', ')}.</p>}
            </div>
          )}
          {saved !== null && <p role="status">Đã lưu phiên bản {saved.version} ({saved.rulesSha256.slice(0, 8)}).</p>}
          <button type="submit" disabled={!canSave}>{saving ? 'Đang lưu…' : 'Lưu phiên bản mới'}</button>
        </div>
      )}
    </form>
  );
}
