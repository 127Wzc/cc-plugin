import Config from "../components/Cfg.js"

const DEFAULT_TOP_K = 5
const DEFAULT_TIMEOUT_MS = 30000

export function getCozeCommandSearchConfig() {
  return Config.getDefOrConfig("Coze")
}

export function isCozeCommandSearchEnabled() {
  const config = getCozeCommandSearchConfig()
  return Boolean(
    config?.enable_command_search_api &&
      config?.personal_access_token &&
      config?.workflow_id,
  )
}

export async function searchCommandsByCoze(query, options = {}) {
  const config = getCozeCommandSearchConfig()
  if (!config?.enable_command_search_api) {
    throw new Error("Coze 指令检索未启用，请开启 Coze.enable_command_search_api")
  }

  if (!config.personal_access_token) {
    throw new Error("未配置 Coze.personal_access_token")
  }

  if (!config.workflow_id) {
    throw new Error("未配置 Coze.workflow_id")
  }

  const baseUrl = normalizeBaseUrl(config.base_url || "https://api.coze.cn")
  const timeoutMs =
    typeof config.timeout_ms === "number" && Number.isFinite(config.timeout_ms)
      ? Math.max(1000, Math.trunc(config.timeout_ms))
      : DEFAULT_TIMEOUT_MS
  const topK =
    typeof options.topK === "number" && Number.isFinite(options.topK)
      ? Math.max(1, Math.trunc(options.topK))
      : typeof options.top_k === "number" && Number.isFinite(options.top_k)
        ? Math.max(1, Math.trunc(options.top_k))
        : typeof config.default_top_k === "number" && Number.isFinite(config.default_top_k)
          ? Math.max(1, Math.trunc(config.default_top_k))
          : DEFAULT_TOP_K

  const parameters = {
    query: String(query || "").trim(),
    top_k: topK,
    user_permission: options.userPermission || "all",
    user_id: options.userId || "",
    group_id: options.groupId || "",
    is_group: Boolean(options.isGroup),
    trigger: "chatgpt-plugin.cc_command_search",
    timestamp: new Date().toISOString(),
  }

  if (!parameters.query) {
    throw new Error("query 不能为空")
  }

  const signal = AbortSignal.timeout(timeoutMs)
  const primaryBody = {
    workflow_id: String(config.workflow_id).trim(),
    parameters,
  }

  let response = await postWorkflowRun({
    baseUrl,
    token: config.personal_access_token,
    body: primaryBody,
    signal,
  })

  if (!response.ok && shouldRetryWithStringParameters(response)) {
    response = await postWorkflowRun({
      baseUrl,
      token: config.personal_access_token,
      body: {
        workflow_id: String(config.workflow_id).trim(),
        parameters: JSON.stringify(parameters),
      },
      signal,
    })
  }

  if (!response.httpOk) {
    throw new Error(`Coze 请求失败：HTTP ${response.status}${response.errorMessage ? ` - ${response.errorMessage}` : ""}`)
  }

  if (!response.ok) {
    throw new Error(`Coze 工作流返回错误：${response.message || "unknown error"}`)
  }

  return normalizeCozeWorkflowResult({
    query: parameters.query,
    topK,
    workflowId: String(config.workflow_id).trim(),
    raw: response.data,
  })
}

async function postWorkflowRun({ baseUrl, token, body, signal }) {
  const url = `${baseUrl}/v1/workflow/run`

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(token).trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    })
    const text = await res.text()
    const json = safeJsonParse(text)

    return {
      httpOk: res.ok,
      status: res.status,
      ok:
        res.ok &&
        (
          json?.code === 0 ||
          json?.code === "0" ||
          json?.success === true ||
          (json && !("code" in json) && !("success" in json))
        ),
      message: json?.msg || json?.message || "",
      data: json?.data ?? json,
      errorMessage: json?.msg || json?.message || text || "",
    }
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "Coze 请求超时" : err?.message || String(err))
  }
}

function shouldRetryWithStringParameters(response) {
  const text = String(response?.message || response?.errorMessage || "").toLowerCase()
  return text.includes("parameter") || text.includes("parameters")
}

function normalizeCozeWorkflowResult({ query, topK, workflowId, raw }) {
  const normalized = unwrapWorkflowPayload(raw)
  const result = {
    ok: true,
    source: "coze-workflow",
    meta: {
      query,
      topK,
      workflowId,
    },
  }

  if (Array.isArray(normalized)) {
    result.items = normalized
    result.raw = raw
    return result
  }

  if (normalized && typeof normalized === "object") {
    if (Array.isArray(normalized.items)) {
      result.items = normalized.items
    } else if (Array.isArray(normalized.commands)) {
      result.items = normalized.commands
    } else if (Array.isArray(normalized.results)) {
      result.items = normalized.results
    }

    result.data = normalized
    result.raw = raw
    return result
  }

  result.text = String(normalized || "")
  result.raw = raw
  return result
}

function unwrapWorkflowPayload(payload) {
  let current = payload

  for (let i = 0; i < 5; i++) {
    if (typeof current === "string") {
      const parsed = safeJsonParse(current)
      if (parsed === null) return current
      current = parsed
      continue
    }

    if (!current || typeof current !== "object") {
      return current
    }

    if ("output" in current) {
      current = current.output
      continue
    }

    if ("data" in current && Object.keys(current).length <= 3) {
      current = current.data
      continue
    }

    if ("result" in current && Object.keys(current).length <= 4) {
      current = current.result
      continue
    }

    return current
  }

  return current
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "")
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
