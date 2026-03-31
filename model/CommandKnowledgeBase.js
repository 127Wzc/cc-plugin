import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import PluginsLoader from "../../../lib/plugins/loader.js"

const ROOT_DIR = process.cwd()
const ROOT_PACKAGE_PATH = path.join(ROOT_DIR, "package.json")
const ROOT_GIT_CONFIG_PATH = path.join(ROOT_DIR, ".git", "config")
const BUILTIN_PLUGIN_DIRS = new Set(["system", "other", "adapter", "example"])
const DEFAULT_PRIORITY = 5000
const DEFAULT_SEARCH_TOP_K = 5
const MAX_SEARCH_TOP_K = 10
const DEFAULT_SEARCH_MIN_SCORE = 1
const SEARCH_CACHE_TTL_MS = 300000

const pluginMetaCache = new Map()
const sourceTextCache = new Map()
const structuredHelpCache = new Map()
let knowledgeBaseCache = null
let searchIndexCache = null

export async function buildCommandKnowledgeBase() {
  pluginMetaCache.clear()
  sourceTextCache.clear()
  structuredHelpCache.clear()

  const frameworkPackage = await readJsonSafe(ROOT_PACKAGE_PATH)
  const rootOrigin = await resolveGitOrigin(ROOT_GIT_CONFIG_PATH)
  const runtimeCommands = await collectRuntimeCommands()
  const plugins = []
  const pluginRefs = new Set()
  const commands = []

  for (const item of runtimeCommands) {
    const pluginMeta = await resolvePluginMeta(item, rootOrigin)
    if (!pluginRefs.has(pluginMeta.id)) {
      pluginRefs.add(pluginMeta.id)
      plugins.push(pluginMeta)
    }

    const command = await enrichCommandCard(item, pluginMeta)
    commands.push(normalizeCommandCard(command))
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id, "zh-Hans-CN"))
  commands.sort((a, b) => {
    const priorityCompare = (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
    if (priorityCompare !== 0) return priorityCompare
    const pluginCompare = a.pluginRef.localeCompare(b.pluginRef, "zh-Hans-CN")
    if (pluginCompare !== 0) return pluginCompare
    const titleCompare = a.title.localeCompare(b.title, "zh-Hans-CN")
    if (titleCompare !== 0) return titleCompare
    return a.id.localeCompare(b.id, "zh-Hans-CN")
  })

  return serializeResult({
    frameworkPackage,
    plugins,
    commands,
  })
}

export async function searchCommandKnowledgeBase(query, options = {}) {
  const normalizedQuery = cleanSentence(query)
  if (!normalizedQuery) {
    return {
      meta: {
        query: "",
        topK: resolveSearchTopK(options),
        returned: 0,
        totalMatched: 0,
        userPermission: normalizePermission(options.userPermission),
      },
      items: [],
    }
  }

  const userPermission = normalizePermission(options.userPermission)
  const topK = resolveSearchTopK(options)
  const index = await getCachedSearchIndex(options.forceRefresh === true)
  const queryVariants = dedupeStrings([normalizedQuery, simplifyUserSearchQuery(normalizedQuery)]).filter(Boolean)
  const queryTokens = dedupeSearchKeywords(
    queryVariants.flatMap(item => extractSearchTerms(item)),
  )
  const minScore =
    typeof options.minScore === "number" && Number.isFinite(options.minScore)
      ? options.minScore
      : DEFAULT_SEARCH_MIN_SCORE
  const preferAccessible = options.preferAccessible ?? true
  const includeUnavailable = options.includeUnavailable ?? true
  const matched = []

  for (const item of index) {
    const score = scoreCommandSearch(item, queryVariants, queryTokens)
    if (score < minScore) continue

    const available = hasCommandPermission(userPermission, item.permission)
    if (!available && !includeUnavailable) continue

    matched.push({
      ...item,
      available,
      score,
    })
  }

  matched.sort((a, b) => {
    if (preferAccessible && a.available !== b.available) {
      return a.available ? -1 : 1
    }
    if (b.score !== a.score) return b.score - a.score
    if (a.priority !== b.priority) return a.priority - b.priority
    const pluginCompare = a.pluginRef.localeCompare(b.pluginRef, "zh-Hans-CN")
    if (pluginCompare !== 0) return pluginCompare
    return a.id.localeCompare(b.id, "zh-Hans-CN")
  })

  return {
    meta: {
      query: normalizedQuery,
      topK,
      returned: Math.min(topK, matched.length),
      totalMatched: matched.length,
      userPermission,
    },
    items: matched.slice(0, topK).map(item => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      permission: item.permission,
      available: item.available,
      priority: item.priority,
      pluginRef: item.pluginRef,
      pluginName: item.pluginName,
      event: item.event,
      triggers: item.triggers,
      examples: item.examples,
      commandTemplate: item.commandTemplate,
      content: item.content,
      score: item.score,
    })),
  }
}

export function buildCozeKnowledgeBase(knowledgeBase) {
  const pluginMap = new Map((knowledgeBase?.plugins || []).map(plugin => [plugin.id, plugin]))
  const records = (knowledgeBase?.commands || []).map(command =>
    buildCozeRecord(command, pluginMap.get(command.pluginRef)),
  )

  return {
    meta: {
      format: "coze-knowledge-flat",
      generatedAt: knowledgeBase?.meta?.generatedAt || new Date().toISOString(),
      sourceDataset: knowledgeBase?.meta?.dataset || "trss-yunzai-command-kb",
      sourceFormatVersion: knowledgeBase?.meta?.formatVersion || 3,
      sortBy: "priority-asc",
      recommendedUse: "Coze knowledge base import",
      recordCount: records.length,
    },
    records,
  }
}

export function buildCozeKnowledgeCsv(knowledgeBase) {
  const cozeKnowledge = buildCozeKnowledgeBase(knowledgeBase)
  const headers = [
    "id",
    "title",
    "search_keywords",
    "usage",
    "permission",
    "plugin_id",
    "plugin_name",
    "priority",
    "content",
  ]
  const lines = [headers.map(escapeCsvCell).join(",")]

  for (const record of cozeKnowledge.records) {
    lines.push(headers.map(header => escapeCsvCell(record[header])).join(","))
  }

  return `\uFEFF${lines.join("\n")}`
}

export function buildCozeKnowledgeText(knowledgeBase) {
  const cozeKnowledge = buildCozeKnowledgeBase(knowledgeBase)
  return cozeKnowledge.records.map(record => record.content).join("\n")
}

async function collectRuntimeCommands() {
  const commands = []

  for (const item of PluginsLoader.priority || []) {
    if (!Array.isArray(item?.plugin?.rule)) continue
    const pluginEvent = normalizeEvent(item.plugin.event || "message")
    const pluginDir = resolvePluginDir(item.key)
    const pluginFilePath = resolvePluginFilePath(item.key)

    for (const rule of item.plugin.rule) {
      if (!hasUsableReg(rule?.reg)) continue

      const event = normalizeEvent(rule.event || pluginEvent)
      if (!isMessageEvent(event)) continue

      commands.push({
        pluginDir,
        pluginFilePath,
        sourceKey: item.key,
        className: item.class?.name || "",
        plugin: item.plugin,
        priority: item.priority,
        rule,
      })
    }
  }

  return commands
}

async function resolvePluginMeta(item, rootOrigin) {
  if (pluginMetaCache.has(item.pluginDir)) {
    return pluginMetaCache.get(item.pluginDir)
  }

  const pluginDir = item.pluginDir
  const pluginRoot = path.join(ROOT_DIR, "plugins", pluginDir)
  const guobaInfo = await readGuobaPluginInfo(path.join(pluginRoot, "guoba.support.js"))
  const packageJson = await readJsonSafe(path.join(pluginRoot, "package.json"))
  const readmeUrl = await readRepositoryUrlFromReadme(pluginRoot)
  const displayName = guobaInfo.title || guobaInfo.name || item.plugin.name || packageJson?.name || pluginDir
  const description = guobaInfo.description || item.plugin.dsc || ""
  const origin = await resolvePluginOrigin(pluginDir, pluginRoot, rootOrigin, packageJson, guobaInfo, readmeUrl)

  const meta = {
    id: pluginDir,
    name: pluginDir,
    displayName,
    description,
    priority:
      typeof item.priority === "number"
        ? item.priority
        : typeof item.plugin.priority === "number"
          ? item.plugin.priority
          : DEFAULT_PRIORITY,
    origin,
  }

  pluginMetaCache.set(pluginDir, meta)
  return meta
}

async function enrichCommandCard(item, pluginMeta) {
  const pattern = stringifyPattern(item.rule.reg)
  const triggersFromPattern = extractRepresentativeTriggers(pattern)
  const sourceText = await readSourceText(item.pluginFilePath)
  const helpMatch = await findBestHelpMatch(item, sourceText)
  const extractLevel = helpMatch?.level || detectRuntimeLevel(sourceText)
  const extractConfidence = inferExtractConfidence(extractLevel)
  const title =
    buildTitleFromHelp(helpMatch?.entry) ||
    triggersFromPattern[0] ||
    item.plugin.dsc ||
    `${item.plugin.name || item.pluginDir}-${item.rule.fnc}`
  const summary = helpMatch?.entry?.desc || item.rule.desc || item.plugin.dsc || ""
  const description = buildDescription(helpMatch?.entry, summary)
  const triggers = dedupeStrings(
    helpMatch?.level === "structured-help" && helpMatch?.entry?.triggers?.length
      ? helpMatch.entry.triggers
      : triggersFromPattern,
  )
  const examples = dedupeStrings(
    helpMatch?.entry?.examples?.length
      ? [...triggers, ...helpMatch.entry.examples]
      : triggers,
  )
  const tags = dedupeStrings([
    ...extractTags(helpMatch?.entry?.group || ""),
    ...extractTags(summary),
    ...extractTags(pluginMeta.displayName),
  ]).slice(0, 6)

  const prerequisites = inferPrerequisites({
    title,
    summary,
    description,
    triggers,
  })
  const whatItReturns = inferWhatItReturns({ title, summary, triggers })
  const whenToUse = summary ? `当用户需要${trimSummary(summary)}` : ""

  return {
    id: buildCommandId(item),
    pluginRef: pluginMeta.id,
    priority:
      typeof item.priority === "number"
        ? item.priority
        : typeof item.plugin.priority === "number"
          ? item.plugin.priority
          : DEFAULT_PRIORITY,
    title,
    summary,
    description,
    triggers,
    examples,
    tags,
    permission: normalizePermission(item.rule.permission),
    event: normalizeEvent(item.rule.event || item.plugin.event || "message"),
    match: {
      pattern,
      fnc: item.rule.fnc || "",
    },
    card: {
      whenToUse,
      whatItReturns,
      prerequisites,
    },
    extract: {
      level: extractLevel,
      confidence: extractConfidence,
    },
  }
}

function normalizeCommandCard(command) {
  const normalized = {
    id: command.id,
    pluginRef: command.pluginRef,
    priority: typeof command.priority === "number" ? command.priority : DEFAULT_PRIORITY,
    title: command.title || "",
    summary: command.summary || "",
    permission: command.permission || "all",
    event: command.event || "message",
    triggers: Array.isArray(command.triggers) ? command.triggers : [],
    match: {
      pattern: command.match?.pattern || "",
      fnc: command.match?.fnc || "",
    },
    extract: {
      level: command.extract?.level || "runtime-standard",
      confidence: command.extract?.confidence || "medium",
    },
  }

  if (command.description) normalized.description = command.description
  if (command.examples?.length) normalized.examples = command.examples
  if (command.tags?.length) normalized.tags = command.tags

  const card = {}
  if (command.card?.whenToUse) card.whenToUse = command.card.whenToUse
  if (command.card?.whatItReturns) card.whatItReturns = command.card.whatItReturns
  if (command.card?.prerequisites) card.prerequisites = command.card.prerequisites
  if (Object.keys(card).length) normalized.card = card

  return normalized
}

function serializeResult({ frameworkPackage, plugins, commands }) {
  return {
    meta: {
      dataset: "trss-yunzai-command-kb",
      formatVersion: 3,
      framework: {
        name: frameworkPackage?.name || "trss-yunzai",
        version: frameworkPackage?.version || "unknown",
      },
      generatedAt: new Date().toISOString(),
      triggerCommand: "#cc导出指令json",
      audience: "mixed",
      retrieval: {
        sortBy: "priority-asc",
        defaultTopK: DEFAULT_SEARCH_TOP_K,
      },
      notes: ["包含 all/admin/owner/master 指令", "仅覆盖 message 类主动触发命令"],
    },
    plugins,
    commands,
  }
}

async function findBestHelpMatch(item, sourceText) {
  const structuredEntries = await getStructuredHelpEntries(item.pluginDir)
  const matchedStructured = matchHelpEntries(item.rule.reg, structuredEntries)
  if (matchedStructured) {
    return {
      level: "structured-help",
      entry: matchedStructured,
    }
  }

  const textHelpEntry = extractTextHelpEntry(sourceText, item.rule.fnc)
  if (textHelpEntry) {
    return {
      level: "text-help",
      entry: textHelpEntry,
    }
  }

  return null
}

function detectRuntimeLevel(sourceText) {
  if (isSpecialRuntimeSource(sourceText)) return "runtime-special"
  return "runtime-standard"
}

function inferExtractConfidence(level) {
  switch (level) {
    case "structured-help":
      return "high"
    case "runtime-special":
      return "low"
    default:
      return "medium"
  }
}

async function getStructuredHelpEntries(pluginDir) {
  if (structuredHelpCache.has(pluginDir)) {
    return structuredHelpCache.get(pluginDir)
  }

  let entries = []
  if (pluginDir === "cc-plugin") {
    entries = await buildCcPluginHelpEntries()
  } else if (pluginDir === "miao-plugin") {
    entries = await buildMiaoHelpEntries()
  } else if (pluginDir === "yenai-plugin") {
    entries = await buildYenaiHelpEntries()
  }

  structuredHelpCache.set(pluginDir, entries)
  return entries
}

async function buildCcPluginHelpEntries() {
  const files = [
    path.join(ROOT_DIR, "plugins", "cc-plugin", "apps", "help.js"),
    path.join(ROOT_DIR, "plugins", "cc-plugin", "apps", "banana.js"),
  ]
  const entries = []

  for (const file of files) {
    const sourceText = await readSourceText(file)
    entries.push(...extractSourceHelpEntries(sourceText))
  }

  return dedupeHelpEntries(entries)
}

async function buildMiaoHelpEntries() {
  const candidateFiles = [
    path.join(ROOT_DIR, "plugins", "miao-plugin", "config", "help.js"),
    path.join(ROOT_DIR, "plugins", "miao-plugin", "config", "help_default.js"),
  ]

  for (const file of candidateFiles) {
    if (!fs.existsSync(file)) continue
    try {
      const mod = await importLocalModule(file)
      if (Array.isArray(mod.helpList)) return flattenImportedHelpList(mod.helpList)
    } catch (err) {
      globalThis.logger?.warn?.(`[CommandKnowledgeBase] 读取 miao 帮助失败: ${err.message}`)
    }
  }

  return []
}

async function buildYenaiHelpEntries() {
  const systemDir = path.join(ROOT_DIR, "plugins", "yenai-plugin", "config", "system")
  if (!fs.existsSync(systemDir)) return []

  const files = (await fsp.readdir(systemDir))
    .filter(file => file.endsWith("_system.js"))
    .sort()
  const entries = []

  for (const file of files) {
    try {
      const mod = await importLocalModule(path.join(systemDir, file))
      if (Array.isArray(mod.helpList)) entries.push(...flattenImportedHelpList(mod.helpList))
    } catch (err) {
      globalThis.logger?.warn?.(`[CommandKnowledgeBase] 读取 yenai 帮助失败: ${err.message}`)
    }
  }

  return dedupeHelpEntries(entries)
}

function flattenImportedHelpList(helpList) {
  const entries = []

  for (const groupItem of helpList || []) {
    for (const item of groupItem.list || []) {
      if (!item?.title) continue
      const examples = buildExamplesFromTitle(item.title)
      entries.push({
        title: item.title,
        desc: item.desc || groupItem.desc || "",
        group: groupItem.group || "",
        auth: groupItem.auth || "",
        triggers: examples,
        examples,
      })
    }
  }

  return entries
}

function extractSourceHelpEntries(sourceText) {
  const entries = []
  const groupMarkers = [...sourceText.matchAll(/group:\s*['"`]([^'"`]+)['"`]/g)].map(match => ({
    index: match.index ?? 0,
    group: match[1] || "",
  }))

  for (const itemMatch of sourceText.matchAll(/title:\s*['"`]([^'"`]+)['"`]\s*,\s*desc:\s*['"`]([^'"`]+)['"`]/g)) {
    const title = itemMatch[1]
    const desc = itemMatch[2]
    const index = itemMatch.index ?? 0
    const group = findNearestGroup(groupMarkers, index)
    const examples = buildExamplesFromTitle(title)
    entries.push({
      title,
      desc,
      group,
      auth: "",
      triggers: examples,
      examples,
    })
  }

  return dedupeHelpEntries(entries)
}

function findNearestGroup(groupMarkers, index) {
  let currentGroup = ""
  for (const marker of groupMarkers) {
    if (marker.index > index) break
    currentGroup = marker.group
  }
  return currentGroup
}

function dedupeHelpEntries(entries) {
  const map = new Map()
  for (const entry of entries) {
    const key = `${entry.group}::${entry.title}::${entry.desc}`
    if (!map.has(key)) map.set(key, entry)
  }
  return [...map.values()]
}

function matchHelpEntries(reg, entries) {
  let bestMatch = null

  for (const entry of entries) {
    let score = 0

    for (const example of entry.examples || []) {
      if (safeRuleTest(reg, example)) score += 3
    }

    if (!score) {
      const simplifiedPattern = simplifyPattern(stringifyPattern(reg))
      for (const example of entry.examples || []) {
        const simplifiedExample = simplifyPattern(example)
        if (!simplifiedExample) continue
        if (
          simplifiedPattern.includes(simplifiedExample) ||
          simplifiedExample.includes(simplifiedPattern)
        ) {
          score += 1
        }
      }
    }

    if (score > 0) {
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { score, entry }
      }
    }
  }

  return bestMatch?.entry || null
}

function extractTextHelpEntry(sourceText, fnc) {
  if (!fnc || !/help/i.test(fnc)) return null
  if (!sourceText) return null

  const functionIndex = sourceText.indexOf(`${fnc}(`)
  if (functionIndex === -1) return null
  const slice = sourceText.slice(functionIndex, functionIndex + 4000)
  const templateMatch = slice.match(/`([\s\S]*?)`/)
  if (!templateMatch) return null

  const helpText = templateMatch[1]
  const lines = helpText
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length) return null

  const title = lines[0].replace(/[：:]\s*$/, "")
  const desc = lines.find(line => /^#/.test(line) || /^【/.test(line)) || lines[0]
  const examples = dedupeStrings(
    lines
      .filter(line => /#/.test(line))
      .map(line => line.match(/#[^\s，。；;,]+/)?.[0] || "")
      .filter(Boolean),
  )

  return {
    title,
    desc,
    group: "文本帮助",
    triggers: examples,
    examples,
  }
}

function buildTitleFromHelp(entry) {
  if (!entry?.title) return ""
  const variants = splitTitleIntoCommands(entry.title)
  if (!variants.length) return entry.title
  return variants.slice(0, 3).join(" / ")
}

function buildDescription(entry, summary) {
  if (!summary) return ""
  if (entry?.group) return `${cleanGroupName(entry.group)}：${summary}`
  return summary
}

function buildCommandId(item) {
  const scope = sanitizeIdentifier(item.className || item.plugin.name || item.sourceKey)
  const fnc = sanitizeIdentifier(item.rule.fnc || "command")
  return `${item.pluginDir}.${scope}.${fnc}`
}

function sanitizeIdentifier(value) {
  return String(value || "unknown")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase()
}

function normalizePermission(permission) {
  return permission || "all"
}

function normalizeEvent(event) {
  return event || "message"
}

function isMessageEvent(event) {
  return event === "message" || event.startsWith("message.")
}

function hasUsableReg(reg) {
  if (!reg) return false
  if (reg instanceof RegExp) {
    return !isTooBroadSource(reg.source)
  }
  return !isTooBroadSource(String(reg).trim())
}

function stringifyPattern(reg) {
  if (reg instanceof RegExp) return reg.toString()
  return String(reg || "")
}

function extractRepresentativeTriggers(pattern) {
  const trigger = simplifyRegexToExample(pattern)
  return trigger ? [trigger] : []
}

function simplifyRegexToExample(pattern) {
  if (!pattern) return ""

  let raw = pattern
  if (raw.startsWith("/") && raw.lastIndexOf("/") > 0) {
    raw = raw.slice(1, raw.lastIndexOf("/"))
  }

  raw = raw.replace(/^\^/, "").replace(/\$$/, "")
  raw = expandRegexAlternatives(raw)
  raw = raw.replace(/\\s\+/g, " ").replace(/\\s\*/g, "")
  raw = raw.replace(/\\d\{\d+,?\d*\}/g, "1")
  raw = raw.replace(/\\d\+/g, "1")
  raw = raw.replace(/\\S\+/g, "示例")
  raw = raw.replace(/\\S\*/g, "")
  raw = raw.replace(/\.\*/g, " 示例")
  raw = raw.replace(/\.\+/g, " 示例")
  raw = raw.replace(/\[(?:\\.|[^\]])+\]/g, "")
  raw = raw.replace(/\\([#*%])/g, "$1")
  raw = raw.replace(/\\/g, "")
  raw = raw.replace(/\?/g, "")
  raw = raw.replace(/\+/g, "")
  raw = raw.replace(/\*/g, "")
  raw = raw.replace(/\s+/g, " ").trim()

  return raw
}

function expandRegexAlternatives(raw) {
  let output = raw
  const altGroupRegex = /\((\?:)?([^()]*\|[^()]*)\)\??/
  let match = output.match(altGroupRegex)

  while (match) {
    const replacement = match[2].split("|")[0] || ""
    output = output.replace(match[0], replacement)
    match = output.match(altGroupRegex)
  }

  return output
}

function splitTitleIntoCommands(title) {
  const tokens = String(title || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  const commands = []
  let current = ""

  for (const token of tokens) {
    if (startsPlaceholderToken(token) && current) {
      current += ` ${token}`
      continue
    }

    if (!current) {
      current = token
      continue
    }

    commands.push(current)
    current = token
  }

  if (current) commands.push(current)
  return commands
}

function buildExamplesFromTitle(title) {
  const variants = []
  for (const command of splitTitleIntoCommands(title)) {
    variants.push(...expandTitleVariants(command))
  }
  return dedupeStrings(variants)
}

function expandTitleVariants(command) {
  let variants = [normalizeTitleCommand(command)]
  const expanded = []

  while (variants.length) {
    const current = variants.shift()
    const groupMatch = current.match(/\(([^()]*\|[^()]*)\)/)
    if (!groupMatch) {
      expanded.push(current)
      continue
    }

    for (const option of groupMatch[1].split("|")) {
      variants.push(current.replace(groupMatch[0], option))
    }
  }

  return dedupeStrings(
    expanded
      .map(text => text.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )
}

function normalizeTitleCommand(command) {
  return String(command || "")
    .replace(/<([^>]+)>/g, (_, token) => placeholderSample(token))
    .replace(/\[([^\]]+)\]/g, (_, token) => placeholderSample(token))
    .replace(/（([^）]+)）/g, (_, token) => placeholderSample(token))
    .replace(/【([^】]+)】/g, (_, token) => placeholderSample(token))
    .replace(/\$/g, "")
    .trim()
}

function placeholderSample(token) {
  const text = String(token || "")
  if (/图片|头像/.test(text)) return "示例图片"
  if (/QQ|群号|uid|ID|id/.test(text)) return "123456"
  if (/序号|页数|数字|编号/.test(text)) return "1"
  if (/时间|天|周|月/.test(text)) return "1"
  if (/消息|内容|文字|关键词|提示词|签名|昵称|状态|角色|英雄|名片|key|api_key/.test(text))
    return "示例"
  return "示例"
}

function startsPlaceholderToken(token) {
  return /^[<\[(（【]/.test(token)
}

function safeRuleTest(reg, value) {
  if (!(reg instanceof RegExp)) return false
  reg.lastIndex = 0
  try {
    return reg.test(value)
  } finally {
    reg.lastIndex = 0
  }
}

function simplifyPattern(text) {
  return String(text || "")
    .replace(/^\/\^?/, "")
    .replace(/\$?\/[gimsuy]*$/, "")
    .replace(/[\\^$?+*()[\]{}|]/g, "")
    .replace(/\s+/g, "")
}

function isTooBroadSource(source) {
  return !source || ["(?:)", ".*", ".+", "^.*$", "^.+$"].includes(source)
}

function extractTags(text) {
  const clean = cleanGroupName(text)
  if (!clean) return []

  const tags = []
  const tokens = clean
    .split(/[、,，/·\s]+/)
    .map(token => token.trim())
    .filter(Boolean)

  for (const token of tokens) {
    if (token.length > 8) continue
    tags.push(token)
  }

  return tags
}

function cleanGroupName(text) {
  return String(text || "").replace(/[^\w\u4e00-\u9fa5]+/g, " ").replace(/\s+/g, " ").trim()
}

function trimSummary(summary) {
  return String(summary || "").replace(/[。！!？?；;]+$/, "")
}

function inferPrerequisites({ title, summary, description, triggers }) {
  const text = [title, summary, description, ...(triggers || [])].join(" ")
  const prerequisites = []

  if (/回复|引用/.test(text)) prerequisites.push("需要回复消息或引用消息")
  if (/图片|图生图|头像/.test(text)) prerequisites.push("可能需要提供图片输入")
  if (/@|at|QQ/.test(text)) prerequisites.push("可能需要指定目标用户")
  if (/key|api_key|密钥/.test(text)) prerequisites.push("需要提前配置密钥或 API Key")

  return dedupeStrings(prerequisites)
}

function inferWhatItReturns({ title, summary, triggers }) {
  const text = [title, summary, ...(triggers || [])].join(" ")
  if (/列表|排行|统计|状态|帮助|说明|信息/.test(text)) return "返回文本说明、列表或状态信息"
  if (/图片|图床|图鉴|攻略|卡片|面板/.test(text)) return "返回图片、卡片或图文结果"
  if (/视频/.test(text)) return "返回视频任务结果或视频说明"
  if (/语音|声聊|唱歌/.test(text)) return "返回语音或语音相关结果"
  return ""
}

function dedupeStrings(items) {
  const set = new Set()
  const result = []
  for (const item of items || []) {
    const value = String(item || "").trim()
    if (!value || set.has(value)) continue
    set.add(value)
    result.push(value)
  }
  return result
}

function resolvePluginDir(sourceKey) {
  return String(sourceKey || "").split("/")[0]
}

function resolvePluginFilePath(sourceKey) {
  const key = String(sourceKey || "")
  if (!key) return ""
  if (key.includes("/")) return path.join(ROOT_DIR, "plugins", key)
  return path.join(ROOT_DIR, "plugins", key, "index.js")
}

async function readSourceText(filePath) {
  if (!filePath) return ""
  if (sourceTextCache.has(filePath)) return sourceTextCache.get(filePath)

  let sourceText = ""
  try {
    sourceText = await fsp.readFile(filePath, "utf8")
  } catch {
    sourceText = ""
  }

  sourceTextCache.set(filePath, sourceText)
  return sourceText
}

function isSpecialRuntimeSource(sourceText) {
  return /app\.reg\(|App\.init\(|v3App\(/.test(sourceText || "")
}

async function resolvePluginOrigin(pluginDir, pluginRoot, rootOrigin, packageJson, guobaInfo, readmeUrl) {
  if (BUILTIN_PLUGIN_DIRS.has(pluginDir)) {
    return {
      type: "framework-builtin",
      url: rootOrigin?.url || null,
      remote: rootOrigin?.remote || "origin",
      branch: rootOrigin?.branch || null,
    }
  }

  const gitOrigin = await resolveGitOrigin(path.join(pluginRoot, ".git", "config"))
  if (gitOrigin?.url) {
    return {
      type: "git-origin",
      url: gitOrigin.url,
      remote: gitOrigin.remote || "origin",
      branch: gitOrigin.branch || null,
    }
  }

  const repositoryUrl = extractRepositoryUrl(packageJson?.repository)
  if (repositoryUrl) {
    return {
      type: "package-repository",
      url: repositoryUrl,
      remote: null,
      branch: null,
    }
  }

  if (guobaInfo.link) {
    return {
      type: "guoba-support",
      url: guobaInfo.link,
      remote: null,
      branch: null,
    }
  }

  if (readmeUrl) {
    return {
      type: "readme",
      url: readmeUrl,
      remote: null,
      branch: null,
    }
  }

  return {
    type: "unknown",
    url: null,
    remote: null,
    branch: null,
  }
}

async function resolveGitOrigin(configPath) {
  if (!fs.existsSync(configPath)) return null

  const configText = await fsp.readFile(configPath, "utf8")
  const remoteMatch = configText.match(/\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/)
  const branchMatch = configText.match(/\[branch "([^"]+)"\]([\s\S]*?)(?:\n\[|$)/g)
  const url = remoteMatch?.[1]?.match(/url = (.+)/)?.[1]?.trim() || null
  let branch = null

  if (branchMatch) {
    for (const entry of branchMatch) {
      if (/remote = origin/.test(entry)) {
        branch = entry.match(/\[branch "([^"]+)"\]/)?.[1] || null
        break
      }
    }
  }

  return {
    url,
    remote: url ? "origin" : null,
    branch,
  }
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, "utf8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function readGuobaPluginInfo(filePath) {
  if (!fs.existsSync(filePath)) return {}

  const source = await readSourceText(filePath)
  return {
    name: source.match(/name:\s*['"`]([^'"`]+)['"`]/)?.[1] || "",
    title: source.match(/title:\s*['"`]([^'"`]+)['"`]/)?.[1] || "",
    description: source.match(/description:\s*['"`]([^'"`]+)['"`]/)?.[1] || "",
    link: source.match(/link:\s*['"`]([^'"`]+)['"`]/)?.[1] || "",
  }
}

async function readRepositoryUrlFromReadme(pluginRoot) {
  const readmeFiles = ["README.md", "readme.md", "README.MD"]
  for (const file of readmeFiles) {
    const filePath = path.join(pluginRoot, file)
    if (!fs.existsSync(filePath)) continue

    const source = await readSourceText(filePath)
    const directMatch = source.match(
      /(https?:\/\/(?:github\.com|gitee\.com|gitcode\.com|mirror\.ghproxy\.com)[^\s)'"]+)/,
    )
    if (directMatch?.[1]) return directMatch[1]
  }

  return ""
}

function extractRepositoryUrl(repository) {
  if (!repository) return ""
  if (typeof repository === "string") return repository
  if (typeof repository === "object") return repository.url || ""
  return ""
}

async function importLocalModule(filePath) {
  const stat = await fsp.stat(filePath)
  const url = `${pathToFileURL(filePath).href}?mtime=${stat.mtimeMs}`
  return import(url)
}

async function getCachedKnowledgeBase(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && knowledgeBaseCache?.value && knowledgeBaseCache.expiresAt > now) {
    return knowledgeBaseCache.value
  }

  const knowledgeBase = await buildCommandKnowledgeBase()
  knowledgeBaseCache = {
    value: knowledgeBase,
    expiresAt: SEARCH_CACHE_TTL_MS > 0 ? now + SEARCH_CACHE_TTL_MS : Number.POSITIVE_INFINITY,
  }
  searchIndexCache = null
  return knowledgeBase
}

async function getCachedSearchIndex(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(searchIndexCache)) {
    return searchIndexCache
  }

  const knowledgeBase = await getCachedKnowledgeBase(forceRefresh)
  const pluginMap = new Map((knowledgeBase?.plugins || []).map(plugin => [plugin.id, plugin]))
  searchIndexCache = (knowledgeBase?.commands || []).map(command =>
    buildSearchIndexItem(command, pluginMap.get(command.pluginRef)),
  )
  return searchIndexCache
}

function resolveSearchTopK(options = {}) {
  const requestedTopK =
    typeof options.topK === "number" && Number.isFinite(options.topK)
      ? Math.trunc(options.topK)
      : typeof options.top_k === "number" && Number.isFinite(options.top_k)
        ? Math.trunc(options.top_k)
        : DEFAULT_SEARCH_TOP_K

  return Math.min(Math.max(requestedTopK, 1), MAX_SEARCH_TOP_K)
}

function buildSearchIndexItem(command, pluginMeta) {
  const record = buildCozeRecord(command, pluginMeta)
  return {
    id: command.id,
    pluginRef: command.pluginRef,
    pluginName: record.plugin_name,
    title: record.title,
    summary: cleanSentence(command.summary || ""),
    permission: normalizePermission(command.permission),
    event: command.event || "message",
    triggers: Array.isArray(command.triggers) ? command.triggers.map(cleanCommandDisplay).filter(Boolean) : [],
    examples: Array.isArray(command.examples) ? command.examples.map(cleanCommandDisplay).filter(Boolean) : [],
    priority: normalizeCozePriority(command.priority),
    commandTemplate: record.command_template || "",
    content: record.content,
    titleText: normalizeComparableText(record.title),
    summaryText: normalizeComparableText(command.summary),
    descriptionText: normalizeComparableText(command.description),
    triggerText: normalizeComparableText(record.usage),
    keywordText: normalizeComparableText(record.search_keywords),
    pluginText: normalizeComparableText(record.plugin_name),
  }
}

function buildCozeRecord(command, pluginMeta) {
  const pluginName = cleanTitleForCoze(pluginMeta?.displayName || pluginMeta?.name || command.pluginRef || "")
  const cozeTitle = buildCozeTitle(command, pluginMeta)
  const triggers = (command.triggers?.length ? command.triggers : command.examples || []).map(cleanCommandDisplay)
  const examples = (command.examples?.length ? command.examples : command.triggers || []).map(cleanCommandDisplay)
  const usage = buildCozeUsage(triggers, examples)
  const description = buildCozeDescription(command, { usage })
  const prerequisitesText = joinList((command.card?.prerequisites || []).map(cleanSentence), "；")
  const readableCandidates = dedupeStrings([
    ...examples,
    ...triggers,
  ])
  const searchKeywords = buildSearchKeywords(command, pluginMeta, {
    title: cozeTitle,
    triggers,
    examples,
  })

  return {
    id: command.id,
    title: cozeTitle,
    search_keywords: joinList(searchKeywords, ", "),
    usage,
    permission: command.permission || "all",
    plugin_id: command.pluginRef || "",
    plugin_name: pluginName,
    priority: normalizeCozePriority(command.priority),
    content: buildCozeContent({
      title: cozeTitle,
      searchKeywords,
      description,
      usage,
      permission: command.permission || "all",
      pluginName,
      priority: normalizeCozePriority(command.priority),
      prerequisitesText,
    }),
    command_template: readableCandidates[0] || command.match?.pattern || "",
  }
}

function joinList(items, separator) {
  return dedupeStrings(items || []).join(separator)
}

function joinTextParts(parts) {
  return dedupeStrings(parts.filter(Boolean)).join("\n")
}

function escapeCsvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " / ")
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function normalizeCozePriority(priority) {
  if (priority === Number.NEGATIVE_INFINITY) return -9999
  if (priority === Number.POSITIVE_INFINITY) return 9999
  if (typeof priority === "number" && Number.isFinite(priority)) return Math.trunc(priority)
  return DEFAULT_PRIORITY
}

function buildCozeTitle(command, pluginMeta) {
  const candidates = [
    command.title,
    command.summary,
    command.description,
    pluginMeta?.description,
    pluginMeta?.displayName,
  ]

  for (const candidate of candidates) {
    const cleaned = cleanTitleForCoze(candidate)
    if (cleaned) return cleaned
  }

  return command.id
}

function buildCozeDescription(command, { triggers, examples }) {
  const summary = cleanSentence(command.summary || "")
  if (summary && !isDuplicateMeaning(summary, command.title)) return summary
  if (command.card?.whatItReturns) return cleanSentence(command.card.whatItReturns)
  return cleanSentence(command.description || command.title || "")
}

function buildSearchKeywords(command, pluginMeta, { title, triggers, examples }) {
  const rawTerms = [
    title,
    ...(triggers || []),
    ...(examples || []),
    ...(command.tags || []),
    command.summary,
    pluginMeta?.displayName,
    isGenericPluginName(pluginMeta?.name) ? "" : pluginMeta?.name,
    command.match?.fnc,
  ]

  const keywords = []
  for (const raw of rawTerms) {
    keywords.push(...extractSearchTerms(raw))
  }
  return dedupeSearchKeywords(keywords).slice(0, 8)
}

function extractSearchTerms(text) {
  const normalized = cleanSearchText(text)
  if (!normalized) return []

  const phrases = normalized
    .split(/[;,，；/|]/)
    .map(cleanKeywordToken)
    .filter(Boolean)
  const tokens = normalized
    .split(/\s+/)
    .map(cleanKeywordToken)
    .filter(Boolean)

  return [...phrases, ...tokens].filter(Boolean)
}

function cleanSearchText(text) {
  return String(text || "")
    .replace(/\/\^?|\$?\/[gimsuy]*/g, " ")
    .replace(/\\[sSdDwWbB]/g, " ")
    .replace(/\\./g, " ")
    .replace(/[(){}\[\]^$*+?|]/g, " ")
    .replace(/[#@]/g, " ")
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}\s,，；;/-]/gu, " ")
    .replace(/\b示例图片\b/g, "图片")
    .replace(/\b示例\b/g, "参数")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanCommandDisplay(text) {
  const raw = String(text || "").trim()
  if (!raw) return ""

  if (looksLikeRegex(raw)) {
    const simplified = simplifyRegexToExample(raw)
    return simplified ? simplified : cleanTitleForCoze(raw)
  }

  return cleanTitleForCoze(raw)
}

function cleanTitleForCoze(text) {
  const raw = String(text || "").trim()
  if (!raw) return ""

  const cleaned = raw
    .replace(/\/\^?|\$?\/[gimsuy]*/g, " ")
    .replace(/[(){}[\]^$*+?|]/g, " ")
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}\s#%*@<>\[\]（），,._:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned
}

function cleanSentence(text) {
  return String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildCozeUsage(triggers, examples) {
  const values = dedupeStrings([...(examples || []), ...(triggers || [])])
  return values.slice(0, 3).join("；")
}

function buildCozeContent({
  title,
  searchKeywords,
  description,
  usage,
  permission,
  pluginName,
  priority,
  prerequisitesText,
}) {
  const parts = [
    `指令：${title}`,
    searchKeywords.length ? `关键词：${searchKeywords.join("、")}` : "",
    description ? `说明：${description}` : "",
    usage ? `用法：${usage}` : "",
    prerequisitesText ? `前置：${prerequisitesText}` : "",
    `权限：${permission}`,
    pluginName ? `插件：${pluginName}` : "",
    `优先级：${priority}`,
  ]

  return parts.filter(Boolean).join("｜")
}

function dedupeSearchKeywords(items) {
  const seen = new Set()
  const result = []

  for (const item of items || []) {
    const value = cleanKeywordToken(item)
    if (!value) continue
    const key = value.replace(/\s+/g, "").toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}

function cleanKeywordToken(text) {
  return String(text || "")
    .replace(/^[,，；;:/|\\-]+|[,，；;:/|\\-]+$/g, "")
    .trim()
}

function normalizeComparableText(text) {
  return cleanSearchText(text).toLowerCase()
}

function simplifyUserSearchQuery(text) {
  return String(text || "")
    .replace(/^(请问|请帮我|帮我|我想要|我想|我要|想要|如何|怎么|怎样|想知道|想问|能不能|可以|麻烦)/g, "")
    .replace(/(查看|查询|看看|搜一下|搜个|搜|找一下|找个|找|推荐一下|推荐|使用|怎么用|命令|指令|功能)$/g, "")
    .replace(/^(查看|查询|看看|搜一下|搜个|搜|找一下|找个|找|推荐一下|推荐|使用)/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function scoreCommandSearch(item, queries, queryTokens) {
  const normalizedQueries = dedupeStrings((queries || []).map(normalizeComparableText).filter(Boolean))
  if (!normalizedQueries.length) return 0

  let score = 0
  const exactTriggers = dedupeStrings([...(item.triggers || []), ...(item.examples || []), item.commandTemplate])
    .map(normalizeComparableText)
    .filter(Boolean)

  for (const normalizedQuery of normalizedQueries) {
    if (exactTriggers.includes(normalizedQuery)) score += 120
    if (item.titleText === normalizedQuery) score += 90
    if (item.titleText.includes(normalizedQuery)) score += 40
    if (item.triggerText.includes(normalizedQuery)) score += 48
    if (item.keywordText.includes(normalizedQuery)) score += 32
    if (item.summaryText.includes(normalizedQuery)) score += 18
    if (item.descriptionText.includes(normalizedQuery)) score += 12
    if (item.pluginText.includes(normalizedQuery)) score += 6
  }

  for (const token of queryTokens || []) {
    const normalizedToken = normalizeComparableText(token)
    if (!normalizedToken) continue
    if (item.titleText.includes(normalizedToken)) score += 16
    if (item.triggerText.includes(normalizedToken)) score += 18
    if (item.keywordText.includes(normalizedToken)) score += 12
    if (item.summaryText.includes(normalizedToken)) score += 8
    if (item.descriptionText.includes(normalizedToken)) score += 6
    if (item.pluginText.includes(normalizedToken)) score += 3
  }

  if (!score && queryTokens?.length === 1 && normalizedQueries[0]?.length <= 2 && item.keywordText.includes(normalizedQueries[0])) {
    score += 10
  }

  return score
}

function hasCommandPermission(userPermission, commandPermission) {
  const permissionRank = {
    all: 0,
    admin: 1,
    owner: 2,
    master: 3,
  }

  const userRank = permissionRank[normalizePermission(userPermission)] ?? 0
  const commandRank = permissionRank[normalizePermission(commandPermission)] ?? 0
  return userRank >= commandRank
}

function looksLikeRegex(text) {
  return /^\/.*\/[gimsuy]*$/.test(text) || /[(){}|\\]/.test(text)
}

function isDuplicateMeaning(a, b) {
  const left = cleanSearchText(a).replace(/\s+/g, "")
  const right = cleanSearchText(b).replace(/\s+/g, "")
  return !!left && left === right
}

function isGenericPluginName(name) {
  return ["system", "other", "adapter", "example"].includes(String(name || ""))
}
