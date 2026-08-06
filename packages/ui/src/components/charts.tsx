import { useStateStyle } from '../meta';
import type { Rollup } from '../api';

const BAR_ORDER = ['in-progress', 'blocked', 'todo', 'triage', 'done', 'dropped'];

function StateSegment({ state, count, total }: { state: string; count: number; total: number }) {
  const style = useStateStyle(state);
  if (!style || !count) return null;
  return (
    <span
      className="bar-seg"
      title={`${count} ${style.label}`}
      style={{
        flexGrow: count,
        ['--sh' as string]: style.hue,
        ['--sc' as string]: style.chroma,
      }}
      aria-label={`${count} ${style.label}`}
    >
      {count / total > 0.12 && <span className="bar-seg-count">{count}</span>}
    </span>
  );
}

function LegendKey({ state, count }: { state: string; count: number }) {
  const style = useStateStyle(state);
  if (!style || !count) return null;
  return (
    <span className="legend-key" style={{ ['--sh' as string]: style.hue, ['--sc' as string]: style.chroma }}>
      <span className="legend-swatch" />
      {count} {style.label}
    </span>
  );
}

/** One chubby stacked bar: where the work sits, at a glance. */
export function StateBar({ counts, legend = true }: { counts: Record<string, number>; legend?: boolean }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const present = BAR_ORDER.filter((s) => counts[s]);
  return (
    <div className="statebar-wrap">
      <div className="statebar" role="img" aria-label={`${total} issues by state`}>
        {present.map((s) => (
          <StateSegment key={s} state={s} count={counts[s]} total={total} />
        ))}
      </div>
      {legend && (
        <div className="statebar-legend">
          {present.map((s) => (
            <LegendKey key={s} state={s} count={counts[s]} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Daily activity as chubby rounded bars — the shape of recent effort. */
export function Sparkline({ days, height = 34 }: { days: { day: string; count: number }[]; height?: number }) {
  if (!days.length) return null;
  const max = Math.max(...days.map((d) => d.count), 1);
  const busiest = days.reduce((a, b) => (b.count > a.count ? b : a));
  return (
    <div className="spark" style={{ height }} role="img" aria-label={`activity over ${days.length} days`}>
      {days.map((d) => (
        <span
          key={d.day}
          className={`spark-bar${d.count === 0 ? ' empty' : ''}`}
          style={{ height: `${Math.max((d.count / max) * 100, d.count ? 12 : 6)}%` }}
          title={`${d.day}: ${d.count} event${d.count === 1 ? '' : 's'}`}
        />
      ))}
      <span className="spark-caption">
        {days.reduce((n, d) => n + d.count, 0)} events · busiest {busiest.count}
      </span>
    </div>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  const style = useStateStyle(tone ?? null);
  return (
    <div
      className={`tile${style ? ' toned' : ''}`}
      style={style ? { ['--sh' as string]: style.hue, ['--sc' as string]: style.chroma } : undefined}
    >
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

/** The whole rollup as one glanceable block: tiles, bar, sparkline. */
export function RollupPanel({ rollup, compact = false }: { rollup: Rollup; compact?: boolean }) {
  const open = rollup.total - (rollup.counts.done ?? 0) - (rollup.counts.dropped ?? 0);
  return (
    <div className={`rollup${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="tiles">
          <StatTile label="open" value={open} />
          <StatTile label="in progress" value={rollup.now.length} tone="in-progress" />
          {rollup.blocked.length > 0 && <StatTile label="blocked" value={rollup.blocked.length} tone="blocked" />}
          {rollup.stale.length > 0 && <StatTile label="stale" value={rollup.stale.length} tone="triage" />}
          <StatTile label="done" value={rollup.counts.done ?? 0} tone="done" />
        </div>
      )}
      <StateBar counts={rollup.counts} legend={!compact} />
      <Sparkline days={rollup.activity_by_day} height={compact ? 26 : 34} />
    </div>
  );
}
