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
        {days.reduce((n, d) => n + d.count, 0)} events · {days.length} days
      </span>
    </div>
  );
}

/**
 * The rollup as one glanceable block. Deliberately three layers and no more:
 * a headline count, the distribution as a bar its legend decodes, and the
 * shape of recent effort. Blocked and stale get named callouts elsewhere, so
 * repeating their numbers here would be the third telling.
 */
export function RollupPanel({ rollup, compact = false }: { rollup: Rollup; compact?: boolean }) {
  const open = rollup.total - (rollup.counts.done ?? 0) - (rollup.counts.dropped ?? 0);
  return (
    <div className={`rollup${compact ? ' compact' : ''}`}>
      {!compact && (
        <div className="rollup-lead">
          <strong>{open}</strong> open <span className="rollup-of">of {rollup.total}</span>
        </div>
      )}
      <StateBar counts={rollup.counts} legend={!compact} />
      <Sparkline days={rollup.activity_by_day} height={compact ? 26 : 32} />
    </div>
  );
}
