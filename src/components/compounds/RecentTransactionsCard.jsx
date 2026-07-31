import Card from './Card'
import TransactionRow from './TransactionRow'

const viewAllAction = (
  <button type="button" className="atom-inline-action">
    View all →
  </button>
)

function RecentTransactionsCard({ transactions }) {
  return (
    <Card variant="transactions">
      <Card.Header title="Recent transactions" action={viewAllAction} />
      <Card.Body>
        {transactions.length === 0 ? (
          <p className="empty-transactions">No transactions match your search.</p>
        ) : (
          <div className="recent-list">
            {transactions.map((item, index) => (
              <TransactionRow
                key={index}
                merchant={item.merchant}
                meta={item.meta}
                amount={item.amount}
              />
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

export default RecentTransactionsCard
