import { z } from 'zod';
import { DocumentDtoSchema, FsChangeSchema } from './documents.js';
import { WorkspaceDtoSchema } from './dto.js';

export interface EventChannelDef<S extends z.ZodType = z.ZodType> {
  name: string;
  schemaVersion: number;
  payload: S;
}

function ev<S extends z.ZodType>(
  name: string,
  schemaVersion: number,
  payload: S,
): EventChannelDef<S> {
  return { name, schemaVersion, payload };
}

/** Fixed main→renderer event channel registry. Grows with milestones. */
export const EVENT_CHANNELS = {
  'app.menuAction': ev('app.menuAction', 1, z.object({ action: z.string() })),
  'app.themeChanged': ev(
    'app.themeChanged',
    1,
    z.object({ theme: z.enum(['light', 'dark', 'system']), effective: z.enum(['light', 'dark']) }),
  ),
  'settings.changed': ev(
    'settings.changed',
    1,
    z.object({ issues: z.array(z.string()), overrideKeys: z.array(z.string()) }),
  ),
  'workspace.changed': ev(
    'workspace.changed',
    1,
    z.object({ workspace: WorkspaceDtoSchema.nullable() }),
  ),
  'fs.batch': ev('fs.batch', 1, z.object({ changes: z.array(FsChangeSchema).max(2000) })),
  'doc.changedExternally': ev('doc.changedExternally', 1, z.object({ doc: DocumentDtoSchema })),
} as const;

export type EventChannelName = keyof typeof EVENT_CHANNELS;
export type EventPayload<N extends EventChannelName> = z.infer<
  (typeof EVENT_CHANNELS)[N]['payload']
>;

export function isKnownEventChannel(name: string): name is EventChannelName {
  return Object.prototype.hasOwnProperty.call(EVENT_CHANNELS, name);
}
