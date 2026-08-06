import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type SearchResult } from '../api';
import { StateDot, TypeIcon } from '../components/bits';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'wake · search';
  }, []);

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    api
      .search(q)
      .then((r) => setResults(r.results))
      .catch((e) => setError(String(e.message ?? e)));
  }, [q]);

  return (
    <div>
      <h1 className="page-title">search</h1>
      <input
        className="search-input"
        defaultValue={q}
        placeholder="search the wake…"
        style={{
          width: '100%',
          fontSize: '1.1rem',
          padding: '0.6rem 0.8rem',
          fontFamily: 'var(--sans)',
          color: 'var(--ink)',
          background: 'var(--paper-raised)',
          border: '1px solid var(--rule)',
          borderRadius: '8px',
          outline: 'none',
          marginBottom: '1.4rem',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const value = e.currentTarget.value.trim();
            if (value) setParams({ q: value });
          }
        }}
      />

      {error && <p className="empty">search failed — {error}</p>}

      {!q && !error && <p className="empty">type a query and press enter</p>}

      {q && results && (
        <>
          <p className="page-meta">
            {results.length} results for '{q}'
          </p>
          {results.length === 0 ? (
            <p className="empty">nothing found</p>
          ) : (
            results.map((r) => (
              <Link to={r.url} className="result-row" key={r.id}>
                {r.state ? (
                  <StateDot state={r.state} />
                ) : (
                  <span className="state-dot" style={{ color: 'var(--ink-faint)' }} title={r.type}>
                    <TypeIcon type={r.type} />
                  </span>
                )}
                <div className="result-body">
                  <div className="result-title">{r.title}</div>
                  {/* server-escaped: raw workspace text is HTML-escaped before <b> markers are added */}
                  <div className="snippet" dangerouslySetInnerHTML={{ __html: r.snippet_html }} />
                </div>
              </Link>
            ))
          )}
        </>
      )}
    </div>
  );
}
