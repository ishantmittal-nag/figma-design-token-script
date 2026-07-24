import Card from './Card'

function PortfolioCard({ investments, ratio }) {
  return (
    <Card variant="portfolio">
      <Card.Header title="Portfolio mix" />
      <Card.Body>
        <p className="atom-value">{investments}</p>
        <p className="atom-helper">+18.2% this year</p>
        <div className="atom-portfolio-ring" aria-label={`Portfolio completion: ${ratio}`}>
          <span>{ratio}</span>
        </div>
      </Card.Body>
    </Card>
  )
}

export default PortfolioCard
