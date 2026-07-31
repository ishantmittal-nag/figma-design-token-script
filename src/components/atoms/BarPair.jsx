function BarPair({ month, income, expense, showIncome, showExpense }) {
  return (
    <div className="atom-chart-group">
      <div className="atom-chart-bars">
        <span
          className={`atom-bar atom-bar-expense ${showIncome ? '' : 'is-hidden'}`}
          style={{ height: income }}
        />
        <span
          className={`atom-bar atom-bar-income ${showExpense ? '' : 'is-hidden'}`}
          style={{ height: expense }}
        />
      </div>
      <span className="atom-month">{month}</span>
    </div>
  )
}

export default BarPair
