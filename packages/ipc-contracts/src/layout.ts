import { z } from 'zod';

export const SideBarViewSchema = z.enum(['explorer', 'search', 'scm', 'tasks']);
export const BottomTabSchema = z.enum(['problems', 'output', 'terminal', 'tests', 'agentlog']);

export const LayoutStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sideBarVisible: z.boolean().default(true),
  sideBarView: SideBarViewSchema.default('explorer'),
  sideBarWidth: z.number().min(160).max(800).default(260),
  agentPanelVisible: z.boolean().default(true),
  agentPanelWidth: z.number().min(240).max(1000).default(360),
  bottomPanelVisible: z.boolean().default(false),
  bottomPanelHeight: z.number().min(100).max(1200).default(240),
  bottomTab: BottomTabSchema.default('terminal'),
});

export type LayoutState = z.infer<typeof LayoutStateSchema>;
export type SideBarView = z.infer<typeof SideBarViewSchema>;
export type BottomTab = z.infer<typeof BottomTabSchema>;
