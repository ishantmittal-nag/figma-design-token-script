export function isValidHexColor(value) {
  if (typeof value !== "string") {
    return true
  }

  return /^#[0-9A-F]{3,6}$/i.test(value)
}

export function isValidTokenName(name) {
  if (typeof name !== "string") {
    return false
  }

  const parts = name.split("/")
  return parts.every((part) => part.length > 0 && part.length <= 100)
}

export function isValidTokenValue(value) {
  if (value === null || value === undefined) {
    return true
  }

  if (typeof value === "number") {
    return value >= 0
  }

  if (typeof value === "string") {
    return value.length > 0
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  return true
}

export function isValidTokenType(type) {
  const validTypes = ["color", "spacing", "sizing", "typography", "border", "shadow"]
  return validTypes.includes(type)
}

export function validateToken(token) {
  const errors = []

  if (!token || typeof token !== "object") {
    errors.push("Token must be a non-null object")
    return errors
  }

  if (!token.name) {
    errors.push("Token is missing a name")
  }

  if (!token.value && token.value !== 0) {
    errors.push(`Token "${token.name}" is missing a value`)
  }

  if (token.value && typeof token.value === "number" && token.value < 0) {
    errors.push(`Token "${token.name}" has a negative value`)
  }

  if (!token.type) {
    errors.push(`Token "${token.name}" is missing a type`)
  }

  if (token.type === "color" && !isValidHexColor(token.value)) {
    errors.push(`Token "${token.name}" has an invalid color value`)
  }

  return errors
}

export function validateTokenBatch(tokens) {
  if (!Array.isArray(tokens)) {
    return { valid: [], invalid: [], errors: ["Input is not an array"] }
  }

  const valid = []
  const invalid = []
  const allErrors = []

  for (const token of tokens) {
    const errors = validateToken(token)
    if (errors.length === 0) {
      valid.push(token)
    } else {
      invalid.push(token)
      allErrors.push(...errors)
    }
  }

  return { valid, invalid, errors: allErrors, validCount: valid.length, invalidCount: invalid.length }
}