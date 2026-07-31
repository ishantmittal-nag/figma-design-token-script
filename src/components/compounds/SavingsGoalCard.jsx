import Card from './Card'

function SavingsGoalCard({ saved, goal }) {
  const ratio = Math.min(100, Math.round((goal / saved) * 100))

  return (
    <Card variant="goals">
      <Card.Header title="Savings goals" />
      <Card.Body>
        <p className="atom-helper">Emergency fund</p>
        <p className="atom-helper">
          ${goal.toLocaleString('en-US')} of ${saved.toLocaleString('en-US')}
        </p>
        <div className="atom-progress-wrap" role="img" aria-label={`Savings goal progress is ${ratio}%`}>
          <div className="atom-progress-track">
            <div className="atom-progress-fill" style={{ width: `${ratio}%` }} />
          </div>
        </div>
        <p className="atom-helper">{ratio}% saved</p>
      </Card.Body>
    </Card>
  )
}

export default SavingsGoalCard
