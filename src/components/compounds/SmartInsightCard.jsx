function SmartInsightCard({ monthlySpend }) {
  const advice =
    monthlySpend < 8000
      ? 'You are under your target spend this month. Keep this pace to reach your goal faster.'
      : 'Your spend is slightly above target. Focus on dining and travel categories this week.'

  return (
    <section className="compound-card compound-smart-insight">
      <p className="atom-helper smart-label">SMART INSIGHT</p>
      <h2>Your spending is trending down</h2>
      <p className="atom-body">{advice}</p>
      <button type="button" className="atom-inline-action">
        See breakdown →
      </button>
    </section>
  )
}

export default SmartInsightCard
