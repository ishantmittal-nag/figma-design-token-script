import { useMemo, useState } from 'react'
import './App.css'
import PrimaryButton from './components/atoms/PrimaryButton'
import CashflowChart from './components/compounds/CashflowChart'
import HeaderControls from './components/compounds/HeaderControls'
import MetricCard from './components/compounds/MetricCard'
import PortfolioCard from './components/compounds/PortfolioCard'
import RecentTransactionsCard from './components/compounds/RecentTransactionsCard'
import SavingsGoalCard from './components/compounds/SavingsGoalCard'
import VolumeSoldCard from './components/compounds/VolumeSoldCard'
import {
  CHART_DATA,
  INITIAL_METRICS,
  INITIAL_TRANSACTIONS,
  METRIC_TRENDS,
} from './data/dashboardData'
import { formatCurrency, signedCurrency } from './utils/formatters'

const GOAL_TARGET = 10000

function toMetricRows(metrics) {
  return [
    {
      label: 'TOTAL BALANCE',
      value: formatCurrency(metrics.totalBalance),
      trend: METRIC_TRENDS.totalBalance,
    },
    {
      label: 'AVAILABLE CASH',
      value: formatCurrency(metrics.availableCash),
      trend: METRIC_TRENDS.availableCash,
    },
    {
      label: 'INVESTMENTS',
      value: formatCurrency(metrics.investments),
      trend: METRIC_TRENDS.investments,
    },
    {
      label: 'MONTHLY SPEND',
      value: formatCurrency(metrics.monthlySpend),
      trend: METRIC_TRENDS.monthlySpend,
    },
    {
      label: 'VOLUME SOLD',
      value: String(Math.round(metrics.volumeSold)),
      trend: METRIC_TRENDS.volumeSold,
    },
  ]
}

function App() {
  const [metrics, setMetrics] = useState(INITIAL_METRICS)
  const [transactions, setTransactions] = useState(INITIAL_TRANSACTIONS)
  const [searchQuery, setSearchQuery] = useState('')
  const [showIncome, setShowIncome] = useState(true)
  const [showExpense, setShowExpense] = useState(true)

  const metricRows = useMemo(() => toMetricRows(metrics), [metrics])

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const rows = transactions.map((item) => ({
      ...item,
      amount: signedCurrency(item.amount),
    }))

    if (!query) {
      return rows
    }

    return rows.filter(
      (item) =>
        item.merchant.toLowerCase().includes(query) ||
        item.meta.toLowerCase().includes(query) ||
        item.amount.toLowerCase().includes(query),
    )
  }, [searchQuery, transactions])

  function handleAddMoney() {
    const depositAmount = 500

    setMetrics((current) => ({
      ...current,
      totalBalance: current.totalBalance + depositAmount,
      availableCash: current.availableCash + depositAmount,
    }))

    setTransactions((current) => [
      {
        id: `tx-deposit-${Date.now()}`,
        merchant: 'Add money',
        meta: 'Wallet top up · Just now',
        amount: depositAmount,
      },
      ...current,
    ])
  }

  return (
    <main className="dashboard-page">
      <div className="dashboard-shell">
        <HeaderControls searchValue={searchQuery} onSearchChange={setSearchQuery} />

        <section className="dashboard-top-row">
          <div className="metrics-grid">
            {metricRows.map((item, index) => (
              <MetricCard key={`${item.label}-${index}`} {...item} />
            ))}
          </div>
        </section>

        <div className="dashboard-add-money">
          <PrimaryButton onClick={handleAddMoney} />
        </div>

        <section className="dashboard-grid">
          <CashflowChart
            chartData={CHART_DATA}
            showIncome={showIncome}
            showExpense={showExpense}
            onToggleIncome={() => setShowIncome((value) => !value)}
            onToggleExpense={() => setShowExpense((value) => !value)}
          />
          <PortfolioCard investments={formatCurrency(metrics.investments)} ratio="72%" />
          <SavingsGoalCard saved={7200} goal={GOAL_TARGET} />
          <RecentTransactionsCard transactions={filteredTransactions} />
          <VolumeSoldCard
            title="VOLUME SOLD"
            value={String(Math.round(metrics.volumeSold))}
            trend={METRIC_TRENDS.volumeSold}
          />
        </section>
      </div>
    </main>
  )
}

export default App
