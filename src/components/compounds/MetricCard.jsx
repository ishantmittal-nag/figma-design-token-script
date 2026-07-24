import Card from './Card'
import TrendBadge from '../atoms/TrendBadge'

function MetricCard({ label, value, trend }) {
  return (
    <Card variant="metric">
      <Card.Body>
        <p className="atom-eyebrow">{label}</p>
        <p className="atom-value">{value}</p>
      </Card.Body>
      <Card.Footer>
        <TrendBadge value={trend} />
        <span className="atom-helper">vs last month</span>
      </Card.Footer>
    </Card>
  )
}

export default MetricCard
