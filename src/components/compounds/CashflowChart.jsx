import BarPair from '../atoms/BarPair'
import ChartLegend from '../atoms/ChartLegend'
import Card from './Card'

function CashflowChart({ chartData, showIncome, showExpense, onToggleIncome, onToggleExpense }) {
  const legends = (
    <div className="card__legends">
      <ChartLegend label="Income" tone="income" active={showIncome} onToggle={onToggleIncome} />
      <ChartLegend label="Expenses" tone="expense" active={showExpense} onToggle={onToggleExpense} />
    </div>
  )

  return (
    <Card variant="cashflow">
      <Card.Header title="Cashflow" subtitle="Income vs expenses · Last 7 months">
        {legends}
      </Card.Header>
      <Card.Body className="card__body--chart">
        <div
          className="compound-chart-canvas"
          role="img"
          aria-label="Monthly income vs expenses chart"
        >
          <div className="chart-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="chart-bars">
            {chartData.map((item) => (
              <BarPair
                key={item.month}
                month={item.month}
                income={item.income}
                expense={item.expense}
                showIncome={showIncome}
                showExpense={showExpense}
              />
            ))}
          </div>
        </div>
      </Card.Body>
    </Card>
  )
}

export default CashflowChart
