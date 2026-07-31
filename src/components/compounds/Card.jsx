/**
 * Card — compound component
 *
 * Usage:
 *   <Card variant="cashflow">
 *     <Card.Header title="Cashflow" subtitle="Income vs expenses">
 *       <ChartLegend ... />      ← optional right-side content
 *     </Card.Header>
 *     <Card.Body>
 *       ...                      ← any content
 *     </Card.Body>
 *     <Card.Footer>
 *       <button>View all</button> ← optional
 *     </Card.Footer>
 *   </Card>
 *
 * The `variant` prop maps to a BEM modifier class, which handles
 * grid-area placement and size overrides in App.css.
 */
function Card({ variant, className = '', children }) {
  const variantClass = variant ? `card--${variant}` : 'card--default'
  return (
    <section className={`card ${variantClass} ${className}`.trim()}>
      {children}
    </section>
  )
}

function CardHeader({ title, subtitle, action, children }) {
  return (
    <div className="card__header">
      <div className="card__header-title">
        {title && <h2 className="card__title">{title}</h2>}
        {subtitle && <p className="card__subtitle">{subtitle}</p>}
      </div>
      {(action || children) && (
        <div className="card__header-aside">
          {children}
          {action}
        </div>
      )}
    </div>
  )
}

function CardBody({ children, className = '' }) {
  return <div className={`card__body ${className}`.trim()}>{children}</div>
}

function CardFooter({ children }) {
  return <div className="card__footer">{children}</div>
}

Card.Header = CardHeader
Card.Body = CardBody
Card.Footer = CardFooter

export default Card
