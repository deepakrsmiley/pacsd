export default function ProgressRing({
  percent = null,
  indeterminate = false,
  size = 44,
  stroke = 3.5,
  complete = false,
  label = "",
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const known = Number.isFinite(percent) && percent != null;
  const value = known ? Math.max(0, Math.min(100, percent)) : 0;
  const offset = circumference - (value / 100) * circumference;
  const color = complete ? "#30D158" : "#0A84FF";

  return (
    <div
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-label={label || (known ? `${value}%` : "Receiving")}
    >
      <svg width={size} height={size} className={indeterminate && !complete ? "origin-center animate-spin" : ""} style={{ animationDuration: "1.1s" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={indeterminate && !complete ? circumference * 0.72 : offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: indeterminate ? undefined : "stroke-dashoffset 0.4s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className={`font-semibold tabular-nums leading-none tracking-tight ${complete ? "text-[9px] text-[#30D158]" : "text-[10px] text-white"}`}>
          {complete || (known && value >= 100) ? "100" : known ? value : ""}
        </span>
      </div>
    </div>
  );
}
