import { useState, useEffect, useCallback } from "react"
import { processTokens, validateAndProcess } from "../utils/tokenProcessor.js"
import { getCached, setCached } from "../utils/tokenCache.js"

export function useTokens(sourceUrl) {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchTokens = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const cached = getCached("tokens", sourceUrl)
      if (cached) {
        setTokens(cached)
        setLastUpdated(new Date().toISOString())
        setLoading(false)
        return
      }

      const response = await fetch(sourceUrl)
      const rawData = await response.json()

      const { tokens: processed, errors } = await validateAndProcess(rawData)

      if (errors.length > 0) {
        setError(errors.join("; "))
      }

      setTokens(processed)
      setCached("tokens", sourceUrl, processed)
      setLastUpdated(new Date().toISOString())
    } catch (err) {
      setError(err.message)
      setTokens([])
    } finally {
      setLoading(false)
    }
  }, [sourceUrl])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  const refresh = useCallback(() => {
    setError(null)
    fetchTokens()
  }, [fetchTokens])

  const invalidateCache = useCallback(() => {
    setCached("tokens", sourceUrl, null)
    fetchTokens()
  }, [sourceUrl, fetchTokens])

  return { tokens, loading, error, lastUpdated, refresh, invalidateCache }
}

export function useTokenValue(tokens, tokenName) {
  const token = tokens.find((t) => t.name === tokenName)
  return token?.value ?? null
}

export function useTokenColor(tokens, tokenName) {
  const token = tokens.find((t) => t.name === tokenName)
  if (!token) return null
  return token.cssValue || token.value || null
}

export function useFilteredTokens(tokens, type) {
  return tokens.filter((t) => t.type === type)
}

export default useTokens