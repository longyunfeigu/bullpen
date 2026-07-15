import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rpcResult } from '../bridge.js';
import '../styles/markdown.css';

/**
 * Shared Markdown renderer for agent-authored prose (ADR-0010): timeline
 * bubbles, plan summaries, report narratives and question cards.
 *
 * Security posture:
 * - No raw HTML is ever rendered (react-markdown default; no rehype-raw).
 * - URLs go through react-markdown's default transform (drops javascript: etc.)
 *   and clicks are routed to the main process's checked opener.
 * - User-authored text stays plain — only agent output flows through here.
 */

const FENCE_LANGUAGE: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  yml: 'yaml',
  md: 'markdown',
  html: 'html',
  xml: 'xml',
  css: 'css',
  json: 'json',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  diff: 'diff',
  patch: 'diff',
};

/** Monaco-colorized fenced block with a copy affordance. */
function CodeBlock({ code, lang }: { code: string; lang: string | null }): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [appearanceVersion, setAppearanceVersion] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setAppearanceVersion((value) => value + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-skin'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHtml(null);
    if (!lang) return;
    const language = FENCE_LANGUAGE[lang.toLowerCase()] ?? lang.toLowerCase();
    let cancelled = false;
    void import('monaco-editor')
      .then((monaco) => {
        if (cancelled) return;
        // Colorize emits token <span>s only — no raw content passthrough.
        return monaco.editor
          .colorize(code.replace(/\n$/, ''), language, { tabSize: 2 })
          .then((colored) => {
            if (!cancelled && mounted.current && colored.includes('<span')) setHtml(colored);
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appearanceVersion, code, lang]);

  return (
    <div className="md-codeblock">
      <div className="md-codebar">
        <span className="md-codelang">{lang ?? ''}</span>
        <button
          className="md-copy"
          title="Copy code"
          onClick={() => {
            void navigator.clipboard.writeText(code.replace(/\n$/, ''));
            setCopied(true);
            setTimeout(() => {
              if (mounted.current) setCopied(false);
            }, 1200);
          }}
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      {html ? (
        <pre className="mono" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="mono">{code.replace(/\n$/, '')}</pre>
      )}
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}): React.JSX.Element {
  const components = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) void rpcResult('app.openExternal', { url: href });
          }}
          title={href}
        >
          {children}
        </a>
      ),
      table: ({ children }: { children?: React.ReactNode }) => (
        <div className="md-tablewrap">
          <table>{children}</table>
        </div>
      ),
      code: (props: { className?: string; children?: React.ReactNode }) => {
        const match = /language-([\w+-]+)/.exec(props.className ?? '');
        const raw = extractText(props.children);
        // Block code arrives with a language class or contains newlines;
        // everything else is inline.
        if (match || raw.includes('\n')) {
          return <CodeBlock code={raw} lang={match?.[1] ?? null} />;
        }
        return <code className="md-inlinecode">{props.children}</code>;
      },
      pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    }),
    [],
  );

  return (
    <div className={`md-body ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
