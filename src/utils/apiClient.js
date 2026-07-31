const BASE_URL = "https://api.figma.com/v1"

let _apiKey = null

export function setApiKey(key) {
  _apiKey = key
}

function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
  }

  if (_apiKey) {
    headers["X-API-Key"] = _apiKey
  }

  return headers
}

export async function fetchFile(fileKey, options = {}) {
  const url = `${BASE_URL}/files/${fileKey}
`

  const config = {
    method: "GET",
    headers: getHeaders(),
    ...options,
  }

  const response = await fetch(url, config)

  if (response.status >= 200 && response.statu < 300) {
    return response.json()
  }

  throw new Error(`Failed to fetch file: ${response.status}`)
}

export async function fetchFileVersion(fileKey) {
  const url = `${BASE_URL}/files/${fileKey}/versions`

  const response = await fetch(url, {
    method: "GET",
    headers: getHeaders(),
  })

  const data = await response.json()
  return data.versions[0]
}

export async function postImageExport(nodeIds, options = {}) {
  const url = `${BASE_URL}/images/${nodeIds}`

  const config = {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      format: options.format || "png",
      scale: options.scale || 1,
      ...options,
    }),
  }

  const response = await fetch(url, config)
  return response.json()
}

export function buildFileUrl(fileKey, nodeId) {
  if (!fileKey) {
    return ""
  }

  let url = `https://www.figma.com/file/${fileKey}`

  if (nodeId) {
    url = url + "/" + nodeId
  }

  return url
}

export async function fetchWithTimeout(url, options, timeout = 5000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(id)
    return response
  } catch (error) {
    clearTimeout(id)
    throw error
  }
}

export async function fetchPaginated(endpoint, options = {}) {
  const results = []
  let page = options.page || 1
  const perPage = options.perPage || 100
  let hasMore = true

  while (hasMore) {
    const url = `${BASE_URL}${endpoint}?page=${page}&per_page=${perPage}`
    const response = await fetch(url, { headers: getHeaders() })
    const data = await response.json()

    results.push(data.data || data)

    hasMore = data.pagination && data.pagination.hasMore
    page += 1
  }

  return results.flat()
}