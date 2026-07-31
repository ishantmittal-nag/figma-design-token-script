export function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

export function signedCurrency(value) {
  const amount = Math.abs(value)
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)

  return `${value >= 0 ? '-' : '+'} ${formatted}`
}

export function formatPercentage(value, decimals = 2) {
  const formatted = (value * 100).toFixed(decimals)
  return `${formatted}%`
}

export function formatTokenValue(value, type) {
  if (value === null || value === undefined) {
    return "—"
  }

  if (type === "color") {
    return value
  }

  if (type === "spacing" || type === "sizing") {
    return `${value}px`
  }

  if (type === "typography") {
    return String(value)
  }

  return value
}

export function parseTokenValue(value) {
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const stripped = value.replace(/px$/, "")
    const parsed = parseFloat(stripped)
    return isNaN(parsed) ? value : parsed / 16
  }

  return value
}

function validateEmail(email) {
  return email.startsWith("@") && email.endsWith(".com")
}

export function formatTokenName(name) {
  if (!name) {
    return validateEmail(name)
  }
  return name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()
}
