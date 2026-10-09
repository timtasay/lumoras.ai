import { formatNumber } from "@/lib/ui/format";

/** 12-point trend in a KPI tile: 2px line, 10% wash, end dot with a surface ring. Draws in on mount. */
export function Sparkline({ data, label, width = 104, height = 30, replay = 0 }: { data: number[]; label: string; width?: number; height?: number; replay?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 4;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (data.length - 1);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  const area = `${line}L${x(data.length - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  const last = data[data.length - 1];
  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: from ${formatNumber(data[0], "compact")} to ${formatNumber(last, "compact")}`}
      key={replay}
    >
      <path className="spark-area" d={area} />
      <path className="spark-line draw" d={line} pathLength={1} />
      <circle className="spark-dot" cx={x(data.length - 1)} cy={y(last)} r={3.5} />
    </svg>
  );
}
