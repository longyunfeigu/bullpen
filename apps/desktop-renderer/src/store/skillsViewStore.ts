import { create } from 'zustand';
import type { SkillAgentFilter, SkillSort, SkillStatusFilter } from '../views/skills-model.js';

interface SkillsViewStore {
  status: SkillStatusFilter;
  agent: SkillAgentFilter;
  query: string;
  sort: SkillSort;
  setStatus(status: SkillStatusFilter): void;
  setAgent(agent: SkillAgentFilter): void;
  setQuery(query: string): void;
  setSort(sort: SkillSort): void;
}

export const useSkillsViewStore = create<SkillsViewStore>((set) => ({
  status: 'all',
  agent: 'all',
  query: '',
  sort: 'uses',
  setStatus: (status) => set({ status }),
  setAgent: (agent) => set({ agent }),
  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
}));
