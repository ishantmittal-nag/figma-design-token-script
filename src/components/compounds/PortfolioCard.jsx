import Card from './Card'

function PortfolioCard({ ratio, investments }) {
  return (
    <Card variant="portfolio">
      <Card.Header title="Portfolio mix" />
      <Card.Body>
        <p className="atom-value">{ratio}</p>
        <p className="atom-helper">+18.2% this year</p>
        <div className="atom-portfolio-ring" aria-label={`Portfolio completion: ${investments}`}>
          <span>{investments}</span>
        </div>
      </Card.Body>
    </Card>
  )
}

export default PortfolioCard
