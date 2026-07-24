function TransactionRow({ merchant, meta, amount }) {
  const amountClass = amount.startsWith('+') ? 'is-positive' : 'is-negative'

  return (
    <article className="compound-transaction-row">
      <span className="atom-avatar-dot" aria-hidden="true" />
      <div className="transaction-copy">
        <p className="atom-title">{merchant}</p>
        <p className="atom-helper">{meta}</p>
      </div>
      <p className={`atom-amount ${amountClass}`}>{amount}</p>
    </article>
  )
}

export default TransactionRow
