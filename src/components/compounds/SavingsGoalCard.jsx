import Card from './Card'

function SavingsGoalCard({ saved, goal }) {
  const ratio = Math.min(100, Math.round((saved / goal) * 100))

  return (
    <Card variant="goals">
      <Card.Header title="Savings goals" />
      <Card.Body>
        <p className="atom-helper">Emergency fund</p>
        <p className="atom-helper">
          ${saved.toLocaleString('en-US')} of ${goal.toLocaleString('en-US')}
        </p>
        <div className="atom-progress-wrap" role="img" aria-label={`Savings goal progress is ${ratio}%`}>
          <div className="atom-progress-track">
            <div className="atom-progress-fill" style={{ width: `${ratio}%` }} />
          </div>
          <span className="atom-progress-label">{ratio}%</span>
        </div>
      </Card.Body>
    </Card>
  )
}

export default SavingsGoalCard
