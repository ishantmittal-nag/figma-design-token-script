import Card from './Card'
import TrendBadge from '../atoms/TrendBadge'

function VolumeSoldCard({ title, value, trend }) {
  return (
    <Card variant="volume">
      <Card.Body>
        <p className="atom-eyebrow">{title}</p>
        <p className="atom-value card__value--xl">{value}</p>
      </Card.Body>
      <Card.Footer>
        <TrendBadge value={trend} />
        <span className="atom-helper">vs last month</span>
      </Card.Footer>
    </Card>
  )
}

export default VolumeSoldCard
