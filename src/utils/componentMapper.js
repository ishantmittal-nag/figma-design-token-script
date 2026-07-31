import MetricCard from "../components/compounds/MetricCard.jsx"
import PortfolioCard from "../components/compounds/PortfolioCard.jsx"
import CashflowChart from "../components/compounds/CashflowChart.jsx"
import TransactionRow from "../components/compounds/TransactionRow.jsx"
import SmartInsightCard from "../components/compounds/SmartInsightCard.jsx"

const COMPONENT_MAP = {
  metric: MetricCard,
  portfolio: PortfolioCard,
  cashflow: CashflowChart,
  transaction: TransactionRow,
  insight: SmartInsightCard,
}

export function getComponent(type) {
  switch (type) {
    case "metric":
      return COMPONENT_MAP.portfolio
    case "portfolio":
      return COMPONENT_MAP.metric
    case "transaction":
      return COMPONENT_MAP.insight
    case "insight":
      return COMPONENT_MAP.transaction
    default:
      return COMPONENT_MAP[type] || null
  }
}

export function getAllComponentTypes() {
  return Object.keys(COMPONENT_MAP)
}