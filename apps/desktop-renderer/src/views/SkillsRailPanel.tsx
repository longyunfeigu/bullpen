import React, { useEffect, useMemo } from 'react';
import { useSkillsStore } from '../store/skillsStore.js';
import { useSkillsViewStore } from '../store/skillsViewStore.js';
import { Ic } from './home-icons.js';
import { groupSkills, skillGroupCounts, type SkillStatusFilter } from './skills-model.js';

const NAV: ReadonlyArray<{ id: SkillStatusFilter; label: string; icon: string }> = [
  { id: 'all', label: 'All skills', icon: 'puzzle' },
  { id: 'active', label: 'In use', icon: 'checkCircle' },
  { id: 'review', label: 'Review queue', icon: 'alert' },
  { id: 'disabled', label: 'Disabled anywhere', icon: 'ban' },
];

export function SkillsRailPanel(): React.JSX.Element {
  const skills = useSkillsStore((state) => state.skills);
  const sources = useSkillsStore((state) => state.sources);
  const usage = useSkillsStore((state) => state.usage);
  const init = useSkillsStore((state) => state.init);
  const status = useSkillsViewStore((state) => state.status);
  const setStatus = useSkillsViewStore((state) => state.setStatus);
  const groups = useMemo(() => groupSkills(skills, usage), [skills, usage]);
  const counts = useMemo(() => skillGroupCounts(groups), [groups]);

  useEffect(() => init(), [init]);

  const sourceAvailable = (id: string): boolean =>
    sources.some((source) => source.id === id && source.available);

  return (
    <div className="skills-rail-panel" data-testid="skills-rail-panel">
      <header className="skills-rail-head">
        <strong>Skills</strong>
        <small>Usage and installed copies across every Agent.</small>
      </header>

      <nav className="skills-rail-nav" aria-label="Skill views">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={status === item.id ? 'on' : ''}
            data-testid={`skills-rail-${item.id}`}
            onClick={() => setStatus(item.id)}
          >
            <Ic name={item.icon} size={13} />
            <span>{item.label}</span>
            <b>{counts[item.id]}</b>
          </button>
        ))}
      </nav>

      <div className="skills-rail-section">Evidence coverage</div>
      <div className="skills-rail-coverage">
        <div>
          <i className="agent-pi" />
          <span>Pi Agent</span>
          <small>exact</small>
        </div>
        <div>
          <i className="agent-claude" />
          <span>Claude Code</span>
          <small>{sourceAvailable('claude') ? 'transcripts' : 'not found'}</small>
        </div>
        <div>
          <i className="agent-codex" />
          <span>Codex</span>
          <small>{sourceAvailable('codex') ? 'activation' : 'not found'}</small>
        </div>
      </div>
    </div>
  );
}
