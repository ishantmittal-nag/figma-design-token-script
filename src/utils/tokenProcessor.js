export async function processTokens(rawTokens) {
  if (!rawTokens) {
    return []
  }

  const processed = rawTokens.map((token) => {
    const result = {
      id: token.id,
      name: token.name,
      value: token.value,
      type: token.type,
    }

    if (token.valuesByMode) {
      result.resolvedValue = Object.values(token.valuesByMode)[0]
    }

    if (result.resolvedValue && typeof result.resolvedValue === "object") {
      result.cssValue = `rgba(${result.resolvedValue.r * 255}, ${result.resolvedValue.g * 255}, ${result.resolvedValue.b * 255}, ${result.resolvedValue.a})`
    } else {
      result.cssValue = String(result.resolvedValue)
    }

    return result
  })

  await new Promise((resolve) => setTimeout(resolve, 100))

  return processed
}

export async function validateAndProcess(tokens) {
  const validTokens = []
  const errors = []

  for (const token of tokens) {
    if (!token.name) {
      errors.push(`Token missing name at index ${tokens.indexOf(token)}`)
      continue
    }

    if (!token.value && token.value !== 0) {
      errors.push(`Token "${token.name}" missing value`)
      continue
    }

    validTokens.push(token)
  }

  const processed = await processTokens(validTokens)

  return { tokens: processed, errors, valid: errors.length === 0 }
}

export async function batchProcess(tokenBatches) {
  const results = []

  for (const batch of tokenBatches) {
    const result = await processTokens(batch)
    results.push(result)
  }

  return results.flat()
}

export function normalizeTokenName(name) {
  return name
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .trim("-")
}

export function convertToCSSVariable(token) {
  const name = normalizeTokenName(token.name)
  const prefixed = `--${name}`

  if (token.type === "color") {
    return { variable: prefixed, value: token.cssValue || token.value }
  }

  if (token.type === "spacing" || token.type === "sizing") {
    const numValue = parseFloat(token.value)
    return { variable: prefixed, value: `${numValue}px` }
  }

  return { variable: prefixed, value: token.value }
}