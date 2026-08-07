import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAccount } from '../meta';
import { Orb, SectionLabel } from '../components/bits';

function Field({
  label,
  hint,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(value);
    setState('idle');
  }, [value]);

  const dirty = draft.trim() !== value && draft.trim().length > 0;

  return (
    <form
      className="setting"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!dirty) return;
        setState('saving');
        try {
          await onSave(draft.trim());
          setState('saved');
        } catch (err) {
          setError(String((err as Error).message ?? err));
          setState('error');
        }
      }}
    >
      <label className="setting-label">
        {label}
        {hint && <span className="setting-hint">{hint}</span>}
      </label>
      <div className="setting-row">
        <input
          className="search-input"
          value={draft}
          placeholder={placeholder}
          maxLength={80}
          onChange={(e) => {
            setDraft(e.target.value);
            setState('idle');
          }}
        />
        <button className="disclose" type="submit" disabled={!dirty || state === 'saving'}>
          {state === 'saving' ? 'saving…' : state === 'saved' ? 'saved' : 'save'}
        </button>
      </div>
      {state === 'error' && <div className="setting-error">{error}</div>}
    </form>
  );
}

export default function Settings() {
  const { space = '' } = useParams<{ space: string }>();
  const { user, spaces, reload } = useAccount();
  const current = spaces.find((s) => s.slug === space);

  useEffect(() => {
    document.title = 'wake · settings';
  }, []);

  return (
    <div>
      <h1 className="page-title">settings</h1>

      <SectionLabel>you</SectionLabel>
      <div className="card">
        <div className="setting-who">
          <Orb name={user?.name ?? 'you'} size={30} />
          <span>{user?.name ?? '…'}</span>
        </div>
        <Field
          label="your name"
          hint="shown here, and used when you write from the UI"
          value={user?.name ?? ''}
          placeholder="Your name"
          onSave={async (name) => {
            await api.setName(name);
            await reload();
          }}
        />
      </div>

      <SectionLabel>this space</SectionLabel>
      <div className="card">
        <div className="setting-who">
          <Orb name={current?.name ?? space} size={30} />
          <span>
            {current?.name ?? space} <code>{space}</code>
          </span>
        </div>
        <Field
          label="space name"
          hint="the URL keeps its original slug, so links never break"
          value={current?.name ?? ''}
          placeholder="Space name"
          onSave={async (name) => {
            await api.updateSpace(space, { name });
            await reload();
          }}
        />
        <Field
          label="description"
          hint="what this space is for"
          value={current?.description ?? ''}
          placeholder="e.g. client work, side projects"
          onSave={async (description) => {
            await api.updateSpace(space, { description });
            await reload();
          }}
        />
        {current?.repos?.length ? (
          <div className="setting">
            <label className="setting-label">
              repos
              <span className="setting-hint">agents match these to decide where to write</span>
            </label>
            <div className="tag-list">
              {current.repos.map((r) => (
                <span className="tag" key={r}>
                  {r}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
