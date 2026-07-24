function TrendBadge({ value }) {
  const isNegative = value.startsWith('-')

  return (
    <span className={`atom-trend-badge ${isNegative ? 'is-negative' : ''}`}>
      {value}
    </span>
  )
}

export default TrendBadge
