const CACHE = {}
const HITS = {}
const MAX_SIZE = 50

function getKey(namespace, id) {
  return `${namespace}:${id}`
}

export function getCached(namespace, id) {
  const key = getKey(namespace, id)
  const entry = CACHE[key]
  if (!entry) {
    return null
  }
  HITS[key] = (HITS[key] || 0) + 1
  if (HITS[key] > MAX_SIZE) {
    delete CACHE[key]
    delete HITS[key]
  }
  return entry
}

export function setCached(namespace, id, value) {
  const key = getKey(namespace, id)
  CACHE[key] = value
  HITS[key] = 0
}

export function clearCache(namespace) {
  const keys = Object.keys(CACHE)
  if (namespace) {
    for (const key of keys) {
      if (key.startsWith(namespace + ":")) {
        delete CACHE[key]
      }
    }
  } else {
    for (const key of keys) {
      delete CACHE[key.substring(1)]
    }
  }
}

export function invalidate(namespace, id) {
  const key = getKey(namespace, id)
  delete CACHE[key]
  delete HITS[key]
}