import React, { useEffect, useMemo, useState } from 'react';
import { useSkillsStore } from '../store/skillsStore.js';
import { useAppStore } from '../store/appStore.js';
import { Ic } from './home-icons.js';
import {
  CONSUMERS,
  CONTEXT_WINDOW_TOKENS,
  consumerBreakdown,
  declutterCandidates,
  insightColor,
  lastUsedLabel,
  preambleTotalTokens,
  projectUsage,
  sortSkillsForInsight,
  sparkStacks,
  usageByName,
  type ConsumerFilter,
  type SkillInsightSort,
} from './skills-insight.js';

/**
 * Settings → Skills (ADR-0037): the multi-source manager (moved verbatim from
 * the Agent section, ADR-0015 + ADR-0019) plus the usage insight layer —
 * a per-turn context budget bar, ledger-derived invocation counts and a
 * "review usage" declutter pass. Insight suggests; the user disables.
 */
export function SkillsSettingsSection(): React.JSX.Element {
  return <SkillsBlock />;
}

const SORTS: Array<{ id: SkillInsightSort; label: string; hint: string }> = [
  { id: 'catalog', label: 'Catalog', hint: 'Source priority, then name' },
  { id: 'uses', label: 'Usage', hint: 'Most invoked first' },
  { id: 'tokens', label: 'Tokens', hint: 'Largest preamble cost first' },
  { id: 'cost', label: 'Cost per use', hint: 'Expensive-and-idle first' },
];

function SkillsBlock(): React.JSX.Element {
  const skills = useSkillsStore((s) => s.skills);
  const sources = useSkillsStore((s) => s.sources);
  const usage = useSkillsStore((s) => s.usage);
  const usageLoaded = useSkillsStore((s) => s.usageLoaded);
  const usageWindowDays = useSkillsStore((s) => s.usageWindowDays);
  const overheadTokens = useSkillsStore((s) => s.preambleOverheadTokens);
  const refresh = useSkillsStore((s) => s.refresh);
  const refreshUsage = useSkillsStore((s) => s.refreshUsage);
  const rescan = useSkillsStore((s) => s.rescan);
  const importSkill = useSkillsStore((s) => s.importSkill);
  const addSource = useSkillsStore((s) => s.addSource);
  const removeSource = useSkillsStore((s) => s.removeSource);
  const setSourcePolicy = useSkillsStore((s) => s.setSourcePolicy);
  const removeSkill = useSkillsStore((s) => s.remove);
  const setEnabled = useSkillsStore((s) => s.setEnabled);
  const read = useSkillsStore((s) => s.read);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [auditText, setAuditText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState<SkillInsightSort>('catalog');
  const [via, setVia] = useState<ConsumerFilter>('all');
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewChecked, setReviewChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    void refresh();
    void refreshUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Raw rows keep the merged numbers (badges, tooltips, declutter);
  // projected rows follow the Via filter (counts, sparklines, sorts).
  const rawByName = useMemo(() => usageByName(usage), [usage]);
  const projected = useMemo(() => projectUsage(usage, via), [usage, via]);
  const byName = useMemo(() => usageByName(projected), [projected]);
  const totalTokens = useMemo(
    () => preambleTotalTokens(usage, overheadTokens),
    [usage, overheadTokens],
  );
  const inPreamble = usage.filter((row) => row.preambleTokens > 0);
  const perSkillTotal = inPreamble.reduce((sum, row) => sum + row.preambleTokens, 0);
  const catalogIndex = useMemo(
    () => new Map(skills.map((skill, index) => [skill.name, index])),
    [skills],
  );
  const sorted = useMemo(() => sortSkillsForInsight(skills, byName, sort), [skills, byName, sort]);
  const candidates = useMemo(
    () => declutterCandidates(skills, rawByName, usageWindowDays),
    [skills, rawByName, usageWindowDays],
  );

  const openAudit = async (id: string): Promise<void> => {
    if (auditId === id) {
      setAuditId(null);
      return;
    }
    const file = await read(id);
    setAuditText(file?.content ?? '');
    setAuditId(id);
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(`Remove the "${id}" skill from the managed store?`)) return;
    await removeSkill(id);
    if (auditId === id) setAuditId(null);
  };

  const disconnect = async (id: string, label: string): Promise<void> => {
    if (
      !window.confirm(`Disconnect the "${label}" skill source? Original files are not deleted.`)
    ) {
      return;
    }
    await removeSource(id);
  };

  const openReview = (): void => {
    // Fully-unused candidates are preselected; costly-but-used and
    // externally-used ones opt in (ADR-0040).
    setReviewChecked(new Set(candidates.filter((c) => c.preselect).map((c) => c.skill.id)));
    setReviewOpen(true);
  };

  const applyReview = async (): Promise<void> => {
    const chosen = candidates.filter((c) => reviewChecked.has(c.skill.id));
    if (chosen.length === 0) return;
    const freed = chosen.reduce((sum, c) => sum + c.usage.preambleTokens, 0);
    for (const c of chosen) await setEnabled(c.skill.id, false);
    setReviewOpen(false);
    useAppStore
      .getState()
      .pushToast(
        'success',
        `Disabled ${chosen.length} skill${chosen.length > 1 ? 's' : ''} — ~${freed.toLocaleString()} tokens/turn freed. Re-enable any time.`,
      );
  };

  return (
    <div className="st-card" data-testid="skills-block">
      <div className="st-card-head">
        <Ic name="zap" size={14} />
        <div>
          <div className="st-card-title">Skills</div>
          <div className="st-card-sub">
            Charter discovers Agent, Codex and Claude Code skills and follows linked sources live.
            Discovery never means trust: only enabled skills reach the audited load_skill tool.
          </div>
        </div>
        <span className="st-sp" />
        <button
          className="btn"
          data-testid="skills-review-open"
          disabled={busy !== null || !usageLoaded}
          title={`Rank enabled skills by cost per use over the last ${usageWindowDays} days`}
          onClick={() => (reviewOpen ? setReviewOpen(false) : openReview())}
        >
          {reviewOpen ? 'Close review' : 'Review usage…'}
        </button>
        <button
          className="btn"
          data-testid="skills-rescan"
          disabled={busy !== null}
          onClick={() => {
            setBusy('scan');
            void rescan().finally(() => setBusy(null));
          }}
        >
          {busy === 'scan' ? 'Scanning…' : 'Rescan'}
        </button>
        <button
          className="btn"
          data-testid="skills-connect-source"
          disabled={busy !== null}
          onClick={() => {
            setBusy('connect');
            void addSource().finally(() => setBusy(null));
          }}
        >
          {busy === 'connect' ? 'Connecting…' : 'Connect folder…'}
        </button>
        <button
          className="btn primary"
          data-testid="skills-import"
          disabled={busy !== null}
          onClick={() => {
            setBusy('import');
            void importSkill().finally(() => setBusy(null));
          }}
        >
          {busy === 'import' ? 'Importing…' : 'Import copy…'}
        </button>
      </div>

      <div className="st-skill-safe">
        <Ic name="alert" size={14} />
        <span>
          Skills can bundle scripts. Review each one before enabling — every command a skill runs
          still passes the Permission Engine, so a skill can’t run anything you didn’t allow.
          Project folders are never scanned unless you explicitly connect one.
        </span>
      </div>

      {usageLoaded && inPreamble.length > 0 ? (
        <div className="st-budget" data-testid="skills-budget">
          <div className="st-skill-cap">Context budget — charged on every turn</div>
          <div className="st-budget-bar" role="img" aria-label="Preamble share per enabled skill">
            {inPreamble.map((row) => (
              <i
                key={row.name}
                title={`${row.name} · ~${row.preambleTokens.toLocaleString()} tokens`}
                style={{
                  width: `${(row.preambleTokens / Math.max(1, perSkillTotal)) * 100}%`,
                  background: insightColor(catalogIndex.get(row.name) ?? 0),
                }}
                onMouseEnter={() => setHoverName(row.name)}
                onMouseLeave={() => setHoverName(null)}
              />
            ))}
          </div>
          <div className="st-budget-cap">
            <span>
              {inPreamble.length} skill{inPreamble.length > 1 ? 's' : ''} in the preamble
              (explicit-only ones cost nothing until invoked)
            </span>
            <span data-testid="skills-budget-total">
              ≈ {totalTokens.toLocaleString()} tokens ·{' '}
              {((totalTokens / CONTEXT_WINDOW_TOKENS) * 100).toFixed(1)}% of a 200k window
            </span>
          </div>
        </div>
      ) : null}

      {reviewOpen ? (
        <div className="st-review" data-testid="skills-review-panel">
          {candidates.length === 0 ? (
            <div className="st-review-empty">
              Nothing to declutter — every enabled skill earned its preamble tokens in the last{' '}
              {usageWindowDays} days.
            </div>
          ) : (
            <>
              <div className="st-review-lead">
                Candidates ranked by cost per use over the last {usageWindowDays} days. Disabling
                keeps history and can be undone with one click — nothing is removed.
              </div>
              {candidates.map((c) => (
                <label
                  key={c.skill.id}
                  className={`st-review-row ${reviewChecked.has(c.skill.id) ? '' : 'dim'}`}
                  data-testid={`skills-review-row-${c.skill.id}`}
                >
                  <input
                    type="checkbox"
                    checked={reviewChecked.has(c.skill.id)}
                    onChange={(event) => {
                      const next = new Set(reviewChecked);
                      if (event.target.checked) next.add(c.skill.id);
                      else next.delete(c.skill.id);
                      setReviewChecked(next);
                    }}
                  />
                  <span className="st-review-main">
                    <span className="mono">{c.skill.name}</span>
                    <span className="st-review-why">{c.reason}</span>
                  </span>
                  <span className="st-review-cost mono">
                    {c.usage.preambleTokens.toLocaleString()} tok · {c.usage.uses}×
                  </span>
                </label>
              ))}
              <div className="st-review-foot">
                <button
                  className="btn primary"
                  data-testid="skills-review-apply"
                  disabled={reviewChecked.size === 0}
                  onClick={() => void applyReview()}
                >
                  Disable selected
                </button>
                <span className="st-review-saving">
                  {reviewChecked.size > 0
                    ? `frees ~${candidates
                        .filter((c) => reviewChecked.has(c.skill.id))
                        .reduce((sum, c) => sum + c.usage.preambleTokens, 0)
                        .toLocaleString()} tokens on every turn`
                    : 'select skills to disable'}
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="st-sources" data-testid="skill-sources">
        <div className="st-skill-cap">Sources</div>
        {sources.map((source) => (
          <div
            key={source.id}
            className={`st-source-row ${source.available ? '' : 'missing'}`}
            data-testid={`skill-source-${source.id}`}
          >
            <Ic name="folder" size={13} />
            <span className="st-source-main">
              <span className="st-source-name">{source.label}</span>
              <span className="st-source-path mono" title={source.path}>
                {source.path}
              </span>
            </span>
            <span className={`st-source-state ${source.available ? 'ok' : ''}`}>
              {source.available ? `${source.skillCount} found` : 'not installed'}
            </span>
            {source.kind === 'managed' ? (
              <span className="st-skill-badge">managed copies</span>
            ) : (
              <>
                <label className={`st-source-check ${source.trusted ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={source.trusted}
                    data-testid={`skill-source-trust-${source.id}`}
                    onChange={(event) =>
                      void setSourcePolicy(source.id, { trusted: event.target.checked })
                    }
                  />
                  Trust
                </label>
                <label
                  className={`st-source-check ${source.autoEnableNew ? 'on' : ''} ${source.trusted ? '' : 'disabled'}`}
                  title="Automatically enable skills added to this source later"
                >
                  <input
                    type="checkbox"
                    checked={source.autoEnableNew}
                    disabled={!source.trusted}
                    data-testid={`skill-source-auto-${source.id}`}
                    onChange={(event) =>
                      void setSourcePolicy(source.id, { autoEnableNew: event.target.checked })
                    }
                  />
                  Auto-enable new
                </label>
              </>
            )}
            {source.removable ? (
              <button
                className="btn quiet-danger"
                data-testid={`skill-source-remove-${source.id}`}
                onClick={() => void disconnect(source.id, source.label)}
              >
                Disconnect
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {usageLoaded && skills.length > 1 ? (
        <div className="st-sortrow" data-testid="skills-sort">
          <span className="st-skill-cap" style={{ margin: 0 }}>
            Sort
          </span>
          {SORTS.map((option) => (
            <button
              key={option.id}
              className={`st-sort-chip ${sort === option.id ? 'on' : ''}`}
              data-testid={`skills-sort-${option.id}`}
              title={option.hint}
              onClick={() => setSort(option.id)}
            >
              {option.label}
            </button>
          ))}
          <span className="st-skill-cap" style={{ margin: '0 0 0 10px' }}>
            Via
          </span>
          <button
            className={`st-sort-chip ${via === 'all' ? 'on' : ''}`}
            data-testid="skills-via-all"
            title="Count invocations from Charter and every readable external CLI"
            onClick={() => setVia('all')}
          >
            All
          </button>
          {CONSUMERS.map((consumer) => (
            <button
              key={consumer.id}
              className={`st-sort-chip via ${via === consumer.id ? 'on' : ''}`}
              data-testid={`skills-via-${consumer.id}`}
              disabled={consumer.id === 'codex'}
              title={
                consumer.id === 'codex'
                  ? 'Codex transcript parsing is not supported yet — counts are always 0'
                  : `Only count invocations made via ${consumer.label}`
              }
              onClick={() => setVia(consumer.id)}
            >
              <i className="st-via-dot" style={{ background: consumer.color }} />
              {consumer.label}
            </button>
          ))}
          <span className="st-sortrow-hint">last {usageWindowDays} days</span>
        </div>
      ) : null}

      {skills.length === 0 ? (
        <div className="st-empty" data-testid="skills-empty">
          No skills found. Connect a source or import a folder containing SKILL.md.
        </div>
      ) : (
        sorted.map((skill) => {
          const row = byName.get(skill.name);
          const rawRow = rawByName.get(skill.name);
          const last = lastUsedLabel(row?.lastUsedAt ?? null, Date.now());
          const sparkMax = Math.max(1, ...(row?.weekly ?? [0]));
          const stacks = row ? sparkStacks(row, via) : [];
          return (
            <React.Fragment key={skill.id}>
              <div
                className={`st-skill-row ${skill.enabled ? '' : 'off'} ${hoverName === skill.name ? 'hl' : ''}`}
                data-testid={`skill-row-${skill.id}`}
              >
                <span className="st-skill-name">
                  <span className="mono">{skill.name}</span>
                  <span className={`st-skill-badge source ${skill.live ? 'live' : ''}`}>
                    {skill.sourceLabel}
                  </span>
                  {skill.live ? <span className="st-skill-badge live">live</span> : null}
                  {skill.status === 'conflict' ? (
                    <span className="st-skill-badge conflict" title={skill.issues.join('\n')}>
                      name conflict
                    </span>
                  ) : null}
                  {skill.status === 'invalid' ? (
                    <span className="st-skill-badge invalid" title={skill.issues.join('\n')}>
                      invalid
                    </span>
                  ) : null}
                  {skill.compatibility === 'needs-review' ? (
                    <span className="st-skill-badge review" title={skill.issues.join('\n')}>
                      needs review
                    </span>
                  ) : null}
                  {skill.explicitOnly ? (
                    <span
                      className="st-skill-badge explicit"
                      title="The skill declares disable-model-invocation — the model never auto-fires it; run it with /skill:name"
                    >
                      explicit-only
                    </span>
                  ) : null}
                  {skill.scriptCount > 0 ? (
                    <span className="st-skill-badge script">
                      {skill.scriptCount} script{skill.scriptCount > 1 ? 's' : ''}
                    </span>
                  ) : null}
                  {usageLoaded && skill.enabled && rawRow && rawRow.uses === 0 ? (
                    <span
                      className="st-skill-badge unused"
                      title={`No invocations via Charter or any external CLI in the last ${usageWindowDays} days`}
                    >
                      unused {usageWindowDays}d
                    </span>
                  ) : null}
                </span>
                <span className="st-skill-desc" title={`${skill.description}\n${skill.sourcePath}`}>
                  {skill.description || '(no description)'}
                </span>
                {usageLoaded ? (
                  <span
                    className="st-skill-usage"
                    data-testid={`skill-usage-${skill.id}`}
                    title={`${row?.uses ?? 0}${via === 'all' ? '' : ` ${CONSUMERS.find((c) => c.id === via)?.label}`} invocation${(row?.uses ?? 0) === 1 ? '' : 's'} in the last ${usageWindowDays} days${last ? ` · last ${last}` : ''}${rawRow ? `\n${consumerBreakdown(rawRow, Date.now())}` : ''}`}
                  >
                    <span className="st-usage-count">
                      {row?.uses ?? 0}
                      <small>×</small>
                    </span>
                    <span className="st-usage-spark" aria-hidden="true">
                      {(row?.weekly ?? []).map((count, i) => {
                        const segments = stacks[i] ?? [];
                        if (count === 0 || segments.length === 0) {
                          return <i key={i} className="z" style={{ height: '2px' }} />;
                        }
                        return (
                          <span
                            key={i}
                            className="col"
                            style={{ height: `${Math.max(2, (count / sparkMax) * 14)}px` }}
                          >
                            {segments.map((seg) => (
                              <i
                                key={seg.consumer}
                                style={{ flex: seg.count, background: seg.color }}
                              />
                            ))}
                          </span>
                        );
                      })}
                    </span>
                  </span>
                ) : null}
                {usageLoaded ? (
                  <span
                    className="st-skill-tok mono"
                    data-testid={`skill-tokens-${skill.id}`}
                    title={
                      skill.explicitOnly
                        ? 'Explicit-only: not in the preamble, costs tokens only when you invoke it'
                        : skill.enabled
                          ? 'Estimated preamble tokens this skill adds to every turn'
                          : 'Disabled skills add nothing to the preamble'
                    }
                  >
                    {row && row.preambleTokens > 0
                      ? `~${row.preambleTokens} tok`
                      : skill.explicitOnly && skill.enabled
                        ? 'on demand'
                        : '—'}
                  </span>
                ) : null}
                <span
                  className="st-skill-seg"
                  role="radiogroup"
                  aria-label={`${skill.name} enablement`}
                >
                  <button
                    className={skill.enabled ? '' : 'on'}
                    data-testid={`skill-off-${skill.id}`}
                    role="radio"
                    aria-checked={!skill.enabled}
                    title="Disabled: not offered to the model, hidden from the “/” picker"
                    onClick={() => void setEnabled(skill.id, false)}
                  >
                    Off
                  </button>
                  <button
                    className={skill.enabled ? 'on' : ''}
                    data-testid={`skill-auto-${skill.id}`}
                    role="radio"
                    aria-checked={skill.enabled}
                    disabled={skill.status === 'invalid'}
                    title="Enabled: the model may auto-invoke it; you can also run /skill:name"
                    onClick={() => void setEnabled(skill.id, true)}
                  >
                    Auto
                  </button>
                </span>
                <button
                  className="btn"
                  data-testid={`skill-audit-${skill.id}`}
                  title="Inspect SKILL.md and bundled files before trusting"
                  onClick={() => void openAudit(skill.id)}
                >
                  {auditId === skill.id ? 'Close' : 'Audit'}
                </button>
                {skill.source === 'managed' ? (
                  <button
                    className="btn quiet-danger"
                    data-testid={`skill-remove-${skill.id}`}
                    onClick={() => void remove(skill.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {auditId === skill.id ? (
                <div className="st-skill-audit" data-testid={`skill-audit-panel-${skill.id}`}>
                  <div className="st-skill-files">
                    <div className="st-skill-cap">Bundled files</div>
                    {skill.files.map((f) => (
                      <div key={f} className={`st-skill-file ${isScriptPath(f) ? 'script' : ''}`}>
                        <Ic name={isScriptPath(f) ? 'terminal' : 'file'} size={12} />
                        <span className="mono">{f}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="st-skill-cap">SKILL.md</div>
                    <div className="st-skill-origin mono">
                      {skill.sourcePath} · revision {skill.revision.slice(0, 12)}
                    </div>
                    <pre className="st-skill-md">{auditText}</pre>
                    {skill.issues.length > 0 ? (
                      <div className="st-skill-issues">
                        {skill.issues.map((issue) => (
                          <div key={issue}>{issue}</div>
                        ))}
                      </div>
                    ) : null}
                    <div className="st-skill-gate">
                      <Ic name="check" size={13} strokeWidth={2} />
                      {skill.scriptCount > 0
                        ? `${skill.scriptCount} script${skill.scriptCount > 1 ? 's' : ''} — each run still goes through the Permission Engine.`
                        : 'Instructions only — no bundled scripts.'}
                    </div>
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}

/** Audit view: which bundled files look executable (mirrors the store's list). */
function isScriptPath(relPath: string): boolean {
  return /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|cmd|bat)$/i.test(relPath);
}
