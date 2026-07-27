export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

interface StackedBarChartProps {
  data: Array<Record<string, string | number>>;
  series: ChartSeries[];
  dayKey?: string;
}

const CHART_HEIGHT = 160;
const BAR_GAP = 8;
const MAX_BAR_WIDTH = 48;

function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function StackedBarChart({ data, series, dayKey = "day" }: StackedBarChartProps) {
  const activeSeries = series.filter((s) => data.some((row) => Number(row[s.key] ?? 0) > 0));
  const shownSeries = activeSeries.length > 0 ? activeSeries : series;

  const totals = data.map((row) => shownSeries.reduce((sum, s) => sum + Number(row[s.key] ?? 0), 0));
  const maxTotal = Math.max(1, ...totals);

  if (data.length === 0 || totals.every((t) => t === 0)) {
    return (
      <div class="admin-chart">
        <p class="admin-muted admin-chart-empty">No activity in this window.</p>
      </div>
    );
  }

  const barWidth = Math.min(MAX_BAR_WIDTH, 600 / Math.max(1, data.length) - BAR_GAP);
  const width = data.length * (barWidth + BAR_GAP) + BAR_GAP;

  return (
    <div class="admin-chart">
      <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} class="admin-chart-svg" preserveAspectRatio="none">
        {data.map((row, i) => {
          let yOffset = CHART_HEIGHT;
          const x = BAR_GAP + i * (barWidth + BAR_GAP);
          return (
            <g key={String(row[dayKey])}>
              {shownSeries.map((s) => {
                const value = Number(row[s.key] ?? 0);
                if (value <= 0) return null;
                const segHeight = (value / maxTotal) * CHART_HEIGHT;
                yOffset -= segHeight;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={yOffset}
                    width={barWidth}
                    height={segHeight}
                    fill={s.color}
                    rx={2}
                  >
                    <title>
                      {s.label}: {value}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* Real HTML text rather than SVG <text> — the SVG uses preserveAspectRatio="none" so a
          handful of bars can still fill the chart's width, but that non-uniform scaling would
          horizontally squash/stretch SVG text into illegible smears. A CSS grid with one column
          per bar keeps each label lined up under its bar without touching the SVG's own
          coordinate space. */}
      <div class="admin-chart-day-labels" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
        {data.map((row) => (
          <span key={String(row[dayKey])}>{formatDay(String(row[dayKey]))}</span>
        ))}
      </div>
      <div class="admin-chart-legend">
        {shownSeries.map((s) => (
          <span key={s.key} class="admin-chart-legend-item">
            <span class="admin-chart-legend-dot" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
