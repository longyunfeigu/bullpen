import React, { useState } from 'react';
import { type AuthPrompt, type HostKeyPrompt, useSshStore } from '../store/sshStore.js';
import { Ic } from './home-icons.js';

/** First-connection (TOFU) or changed-key decision for a host (ADR-0047). */
function HostKeyModal(props: { prompt: HostKeyPrompt }): React.JSX.Element {
  const { prompt } = props;
  const respondHostKey = useSshStore((s) => s.respondHostKey);
  const mismatch = prompt.status === 'mismatch';

  return (
    <div
      className="rm-backdrop"
      role="dialog"
      aria-label="Verify host key"
      data-testid="ssh-hostkey-modal"
    >
      <div className="rm-dialog">
        <div className="rm-dialog-head">
          <h2>{mismatch ? 'Host key changed' : 'Verify host key'}</h2>
        </div>
        <div className="rm-dialog-body">
          {mismatch ? (
            <div className="rm-warn">
              <Ic name="alert" size={18} />
              <span>
                主机密钥已改变！这可能是服务器重装，也可能是中间人攻击。除非你确认变更属实，否则不要继续。
              </span>
            </div>
          ) : (
            <p className="rm-prompt-label">
              首次连接此主机。请核对下方指纹与服务器管理员提供的一致后再信任。
            </p>
          )}

          <dl className="rm-kv">
            <dt>Host</dt>
            <dd>
              {prompt.host}:{prompt.port}
            </dd>
            <dt>Key type</dt>
            <dd>{prompt.keyType}</dd>
          </dl>

          <div>
            <span className="rm-prompt-label">SHA256 fingerprint</span>
            <div className="rm-fp">{prompt.fingerprintSha256}</div>
          </div>

          {mismatch && prompt.knownFingerprint ? (
            <div>
              <span className="rm-prompt-label">Previously trusted</span>
              <div className="rm-fp old">{prompt.knownFingerprint}</div>
            </div>
          ) : null}
        </div>
        <div className="rm-dialog-foot">
          <button
            className="btn"
            onClick={() => void respondHostKey(prompt.requestId, false, false)}
          >
            Cancel
          </button>
          {mismatch ? (
            <button
              className="btn danger"
              onClick={() => void respondHostKey(prompt.requestId, true, true)}
            >
              Replace trust & accept
            </button>
          ) : (
            <>
              <button
                className="btn"
                onClick={() => void respondHostKey(prompt.requestId, true, false)}
              >
                Accept once
              </button>
              <button
                className="btn primary"
                data-testid="ssh-hostkey-accept"
                onClick={() => void respondHostKey(prompt.requestId, true, true)}
              >
                Accept & remember
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Interactive auth challenge: password, key passphrase, or 2FA prompts. */
function AuthModal(props: { prompt: AuthPrompt }): React.JSX.Element {
  const { prompt } = props;
  const respondAuth = useSshStore((s) => s.respondAuth);
  const [answers, setAnswers] = useState<string[]>(() => prompt.prompts.map(() => ''));
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);

  // 2FA / keyboard-interactive codes are one-shot — never offer to persist them.
  const canSave = prompt.kind === 'password' || prompt.kind === 'passphrase';
  const title =
    prompt.kind === 'passphrase'
      ? 'Key passphrase'
      : prompt.kind === 'password'
        ? 'Password'
        : 'Verification';

  const submit = async (): Promise<void> => {
    setBusy(true);
    await respondAuth(prompt.requestId, answers, canSave && save);
  };
  const cancel = (): void => {
    void respondAuth(prompt.requestId, [], false);
  };

  return (
    <div
      className="rm-backdrop"
      role="dialog"
      aria-label="Authenticate"
      data-testid="ssh-auth-modal"
    >
      <div className="rm-dialog">
        <div className="rm-dialog-head">
          <h2>{title}</h2>
        </div>
        <div className="rm-dialog-body">
          {prompt.prompts.map((p, i) => (
            <div className="rm-field" key={i}>
              <label>{p.prompt}</label>
              <input
                type={p.echo ? 'text' : 'password'}
                value={answers[i]}
                data-testid={`ssh-auth-input-${i}`}
                autoFocus={i === 0}
                autoComplete="off"
                onChange={(e) =>
                  setAnswers((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void submit();
                }}
              />
            </div>
          ))}
          {canSave ? (
            <label className="rm-check">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              Save to system keychain
            </label>
          ) : null}
        </div>
        <div className="rm-dialog-foot">
          <button className="btn" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="ssh-auth-submit"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Global mount point for SSH prompts. Renders at most one modal at a time —
 * host-key decisions take priority over auth challenges — each keyed by its
 * requestId so form state resets between prompts.
 */
export function SshPromptHost(): React.JSX.Element | null {
  const hostKey = useSshStore((s) => s.hostKeyPrompts[0]);
  const auth = useSshStore((s) => s.authPrompts[0]);

  if (hostKey) return <HostKeyModal key={hostKey.requestId} prompt={hostKey} />;
  if (auth) return <AuthModal key={auth.requestId} prompt={auth} />;
  return null;
}
