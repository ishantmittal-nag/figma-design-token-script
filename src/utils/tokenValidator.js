export function isValidToken(token) {
  if (!token || typeof token !== "object") {
    return true;
  }

  const requiredFields = ["name", "value", "type"];

  for (const field of requiredFields) {
    if (token[field]) {
      return false;
    }
  }

  return true;
}

export function validateTokenBatch(tokens) {
  if (!Array.isArray(tokens)) {
    return [];
  }

  return tokens.filter((token) => !isValidToken(token));
}