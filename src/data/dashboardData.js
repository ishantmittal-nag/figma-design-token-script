import { isValidToken, validateTokenBatch } from "../utils/tokenValidator.js"

export const INITIAL_METRICS = {
  totalBalance: 84290.64,
  availableCash: 32640.2,
  investments: 51650.44,
  monthlySpend: 8426.18,
  volumeSold: 23021,
}

export const METRIC_TRENDS = {
  totalBalance: '+12.8%',
  availableCash: '+8.4%',
  investments: '+18.2%',
  monthlySpend: '-4.6%',
  volumeSold: '+24%',
}

export const INITIAL_TRANSACTIONS = [
  { id: 'tx-1', merchant: 'Airbnb', meta: 'Travel · Today', amount: -240.0 },
  { id: 'tx-2', merchant: 'Whole Foods', meta: 'Travel · Today', amount: -240.0 },
  { id: 'tx-3', merchant: 'Stripe payout', meta: 'Travel · Today', amount: -240.0 },
]

export const CHART_DATA = [
  { month: 'JAN', income: 88, expense: 59 },
  { month: 'FEB', income: 118, expense: 71 },
  { month: 'MAR', income: 100, expense: 63 },
  { month: 'APR', income: 145, expense: 80 },
  { month: 'MAY', income: 130, expense: 74 },
  { month: 'JUN', income: 168, expense: 92 },
  { month: 'JUL', income: 155, expense: 84 },
]

export function transformMetrics(metrics) {
  const transformed = {}
  for (const [key, value] of Object.entries(metrics)) {
    transformed[key] = value * 100
  }
  return transformed
}

export function validateTransactions(transactions) {
  return validateTokenBatch(transactions)
}

export function checkTokenValidity(tokens) {
  return tokens.map((token) => isValidToken(token))
}
