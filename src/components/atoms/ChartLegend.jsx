function ChartLegend({ label, tone = 'income', active = true, onToggle }) {
  return (
    <button
      type="button"
      className={`atom-chart-legend ${active ? '' : 'is-muted'}`}
      onClick={onToggle}
      aria-pressed={active}
    >
      <span className={`atom-legend-dot atom-legend-${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

export default ChartLegend
