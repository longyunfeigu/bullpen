import { describe, expect, it } from 'vitest';
import { CSP, DEV_CSP } from './csp.js';

/**
 * §12.3 / ADR-0022: the CSP is pinned directive-by-directive. frame-src was
 * deliberately widened from 'none' to loopback http for the acceptance-gate
 * preview — and ONLY that. Any further widening must edit this test and the
 * ADR together.
 */
describe('renderer CSP pin', () => {
  const directives = new Map(
    CSP.split('; ').map((d) => {
      const [name, ...rest] = d.split(' ');
      return [name!, rest.join(' ')] as const;
    }),
  );

  it('frame-src allows loopback http only (ADR-0022) — nothing else changed', () => {
    expect(directives.get('frame-src')).toBe('artifact: http://localhost:* http://127.0.0.1:*');
  });

  it('the rest of the policy is byte-stable', () => {
    expect(directives.get('default-src')).toBe("'self'");
    expect(directives.get('script-src')).toBe("'self'");
    expect(directives.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(directives.get('img-src')).toBe("'self' data: artifact:");
    expect(directives.get('font-src')).toBe("'self' data:");
    expect(directives.get('worker-src')).toBe("'self' blob:");
    expect(directives.get('media-src')).toBe("'self' artifact:");
    expect(directives.get('connect-src')).toBe("'self' artifact:");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
    expect(directives.size).toBe(12);
  });

  it('dev CSP only relaxes script inline + ws (vite HMR)', () => {
    expect(DEV_CSP).toContain("script-src 'self' 'unsafe-inline'");
    expect(DEV_CSP).toContain("connect-src 'self' artifact: ws:");
    expect(DEV_CSP).toContain('frame-src artifact: http://localhost:* http://127.0.0.1:*');
  });
});
