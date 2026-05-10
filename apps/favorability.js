import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import Config from "../components/Cfg.js"
import Render from "../components/Render.js"

const dataPath = path.join(process.cwd(), "data", "cc-plugin", "favorability")
const defaultFlushIntervalSeconds = 60

const lastSender = new Map()
const penaltyTimers = new Map()
const dataCache = new Map()
const dirtyGroups = new Set()
const dirtyVersions = new Map()
const flushTimers = new Map()
const writeQueues = new Map()

export class Favorability extends plugin {
  constructor() {
    super({
      name: "[cc-plugin] 好感度",
      dsc: "记录群友之间的好感度",
      event: "message.group",
      priority: 35,
      rule: [
        {
          reg: "^#?好感度(白名单|添加白名单|删除白名单|落盘间隔).*$",
          fnc: "manageFavorabilityConfig",
          permission: "master",
        },
        {
          reg: "^#?好感度.*$",
          fnc: "queryFavorability",
          log: false,
        },
        {
          reg: "^#?(谁在意我|喜欢我的人)$",
          fnc: "whoLikesMe",
          log: false,
        },
        {
          reg: "^#?(我在意谁|我喜欢的人)$",
          fnc: "whoILike",
          log: false,
        },
      ],
    })
  }

  task = {
    name: "清理最低好感度",
    cron: "0 0 0 * * *",
    fnc: () => this.cleanupFavorability(),
    log: false,
  }

  get config() {
    return Config.getDefOrConfig("Favorability")
  }

  get flushDelay() {
    const seconds = Number(this.config.flushIntervalSeconds || defaultFlushIntervalSeconds)
    return Math.max(10, Math.trunc(seconds)) * 1000
  }

  get dailyDecay() {
    const value = Number(this.config.dailyDecay || 0)
    return Math.max(0, Math.trunc(value))
  }

  isGroupAllowed(groupId) {
    const cfg = this.config
    if (cfg.enable === false) {
      return false
    }

    const whitelist = Array.isArray(cfg.whitelistGroups) ? cfg.whitelistGroups.map(String) : []
    return whitelist.includes(String(groupId))
  }

  normalizeGroupId(value) {
    return String(value || "").trim()
  }

  getWhitelistGroups() {
    return Array.isArray(this.config.whitelistGroups)
      ? this.config.whitelistGroups.map(groupId => this.normalizeGroupId(groupId)).filter(Boolean)
      : []
  }

  async manageFavorabilityConfig(e) {
    const msg = String(e.msg || "")

    if (/落盘间隔/.test(msg)) {
      const seconds = Number(msg.match(/\d+/)?.[0] || 0)
      if (!Number.isFinite(seconds) || seconds < 10) {
        await e.reply("好感度落盘间隔至少 10 秒，例如：#好感度落盘间隔 60")
        return true
      }

      Config.modify("Favorability", "flushIntervalSeconds", Math.trunc(seconds), "config")
      await e.reply(`已设置好感度落盘间隔为 ${Math.trunc(seconds)} 秒`)
      return true
    }

    const groupId = this.normalizeGroupId(msg.match(/\d{5,}/)?.[0] || e.group_id)
    const whitelist = this.getWhitelistGroups()

    if (/添加白名单/.test(msg)) {
      if (!groupId) {
        await e.reply("未找到群号")
        return true
      }

      if (!whitelist.includes(groupId)) {
        Config.modify("Favorability", "whitelistGroups", [...whitelist, groupId], "config")
      }
      await e.reply(`已加入好感度白名单群：${groupId}`)
      return true
    }

    if (/删除白名单/.test(msg)) {
      const index = whitelist.indexOf(groupId)
      if (index === -1) {
        await e.reply(`该群不在好感度白名单：${groupId}`)
        return true
      }

      Config.modify("Favorability", "whitelistGroups", whitelist.filter(item => item !== groupId), "config")
      lastSender.delete(groupId)
      if (penaltyTimers.has(groupId)) {
        clearTimeout(penaltyTimers.get(groupId))
        penaltyTimers.delete(groupId)
      }
      await e.reply(`已移出好感度白名单群：${groupId}`)
      return true
    }

    await e.reply([
      `好感度功能：${this.config.enable === false ? "关闭" : "开启"}`,
      `落盘间隔：${this.flushDelay / 1000} 秒`,
      `白名单群：${whitelist.length ? whitelist.join("、") : "空（不会自动记录普通消息）"}`,
      "命令：#好感度添加白名单、#好感度删除白名单、#好感度落盘间隔 60",
    ].join("\n"))
    return true
  }

  ensureDataPath() {
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true })
    }
  }

  getDataFile(groupId) {
    return path.join(dataPath, `${groupId}.json`)
  }

  readData(groupId) {
    if (dataCache.has(groupId)) {
      return dataCache.get(groupId)
    }

    this.ensureDataPath()
    const file = this.getDataFile(groupId)
    if (!fs.existsSync(file)) {
      const data = { favorability: {} }
      dataCache.set(groupId, data)
      return data
    }

    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8"))
      data.favorability ??= {}
      dataCache.set(groupId, data)
      return data
    } catch (err) {
      logger.error(`[cc-plugin][好感度] 读取数据失败: ${err.message || err}`)
      this.backupBrokenFile(file)
      const data = { favorability: {} }
      dataCache.set(groupId, data)
      return data
    }
  }

  backupBrokenFile(file) {
    try {
      const backupFile = `${file}.broken.${Date.now()}`
      fs.copyFileSync(file, backupFile)
      logger.warn(`[cc-plugin][好感度] 已备份异常数据文件: ${backupFile}`)
    } catch (err) {
      logger.warn(`[cc-plugin][好感度] 备份异常数据文件失败: ${err.message || err}`)
    }
  }

  saveData(groupId, data, { immediate = false } = {}) {
    dataCache.set(groupId, data)
    dirtyGroups.add(groupId)
    dirtyVersions.set(groupId, (dirtyVersions.get(groupId) || 0) + 1)

    if (immediate) {
      if (flushTimers.has(groupId)) {
        clearTimeout(flushTimers.get(groupId))
        flushTimers.delete(groupId)
      }
      return this.flushData(groupId)
    }

    this.scheduleFlush(groupId)
    return true
  }

  scheduleFlush(groupId) {
    if (flushTimers.has(groupId)) {
      return
    }

    const timer = setTimeout(() => {
      flushTimers.delete(groupId)
      this.flushData(groupId)
    }, this.flushDelay)
    timer.unref?.()
    flushTimers.set(groupId, timer)
  }

  async flushData(groupId) {
    if (flushTimers.has(groupId)) {
      clearTimeout(flushTimers.get(groupId))
      flushTimers.delete(groupId)
    }

    const prevQueue = writeQueues.get(groupId) || Promise.resolve()
    const nextQueue = prevQueue
      .catch(() => {})
      .then(() => this.writeDataFile(groupId))
      .finally(() => {
        if (writeQueues.get(groupId) === nextQueue) {
          writeQueues.delete(groupId)
        }
      })

    writeQueues.set(groupId, nextQueue)
    return nextQueue
  }

  async writeDataFile(groupId) {
    if (!dirtyGroups.has(groupId)) {
      return
    }

    const data = dataCache.get(groupId) || { favorability: {} }
    const writeVersion = dirtyVersions.get(groupId) || 0
    const file = this.getDataFile(groupId)
    const tmpFile = `${file}.${process.pid}.tmp`

    try {
      await fsp.mkdir(dataPath, { recursive: true })
      await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), "utf-8")
      await fsp.rename(tmpFile, file)
      if ((dirtyVersions.get(groupId) || 0) === writeVersion) {
        dirtyGroups.delete(groupId)
      } else {
        this.scheduleFlush(groupId)
      }
    } catch (err) {
      dirtyGroups.add(groupId)
      logger.error(`[cc-plugin][好感度] 保存数据失败: ${err.message || err}`)
      await fsp.rm(tmpFile, { force: true }).catch(() => {})
      this.scheduleFlush(groupId)
    }
  }

  async flushAllData() {
    const groups = [...dirtyGroups]
    await Promise.all(groups.map(groupId => this.flushData(groupId)))
  }

  async cleanupFavorability() {
    await this.flushAllData()
    this.ensureDataPath()
    const files = fs.readdirSync(dataPath).filter(file => file.endsWith(".json"))

    for (const file of files) {
      const groupId = path.basename(file, ".json")
      const data = this.readData(groupId)

      if (!data.favorability || Object.keys(data.favorability).length === 0) {
        continue
      }

      let hasChange = this.applyDailyDecay(data)
      if (Object.keys(data.favorability || {}).length === 0) {
        if (hasChange) {
          await this.saveData(groupId, data, { immediate: true })
        }
        continue
      }

      let minFavorability = Infinity
      let minFrom = ""
      let minTo = ""

      for (const fromUser in data.favorability) {
        for (const toUser in data.favorability[fromUser]) {
          const value = data.favorability[fromUser][toUser]
          if (value < minFavorability) {
            minFavorability = value
            minFrom = fromUser
            minTo = toUser
          }
        }
      }

      if (!minFrom || !minTo) {
        continue
      }

      delete data.favorability[minFrom][minTo]
      if (Object.keys(data.favorability[minFrom]).length === 0) {
        delete data.favorability[minFrom]
      }
      hasChange = true

      if (!hasChange) {
        continue
      }
      await this.saveData(groupId, data, { immediate: true })
    }
  }

  applyDailyDecay(data) {
    if (this.config.dailyDecayEnabled !== true || this.dailyDecay <= 0) {
      return false
    }

    let hasChange = false
    for (const fromUser of Object.keys(data.favorability || {})) {
      for (const toUser of Object.keys(data.favorability[fromUser] || {})) {
        const value = Number(data.favorability[fromUser][toUser]) || 0
        const nextValue = value > 0
          ? Math.max(0, value - this.dailyDecay)
          : Math.min(0, value + this.dailyDecay)

        if (nextValue !== value) {
          hasChange = true
        }

        if (nextValue === 0) {
          delete data.favorability[fromUser][toUser]
        } else {
          data.favorability[fromUser][toUser] = nextValue
        }
      }

      if (Object.keys(data.favorability[fromUser]).length === 0) {
        delete data.favorability[fromUser]
      }
    }

    return hasChange
  }

  addFavorability(groupId, fromUser, toUser, value) {
    const data = this.readData(groupId)
    data.favorability ??= {}
    data.favorability[fromUser] ??= {}
    data.favorability[fromUser][toUser] ??= 0
    data.favorability[fromUser][toUser] += value
    this.saveData(groupId, data)
    return data.favorability[fromUser][toUser]
  }

  getFavorability(groupId, fromUser, toUser) {
    const data = this.readData(groupId)
    return data.favorability?.[fromUser]?.[toUser] || 0
  }

  applyConsecutiveMessagePenalty(groupId, userId) {
    const data = this.readData(groupId)
    let hasChange = false

    for (const fromUser in data.favorability || {}) {
      if (data.favorability[fromUser][userId] !== undefined) {
        data.favorability[fromUser][userId] -= 1
        hasChange = true
      }
    }

    if (hasChange) {
      this.saveData(groupId, data)
    }
  }

  async accept(e) {
    if (!e?.isGroup && !e?.group_id) {
      return false
    }

    const msg = String(e.msg || "")
    if (/^#?好感度.*$/.test(msg) || /^#?(谁在意我|喜欢我的人|我在意谁|我喜欢的人)$/.test(msg)) {
      return false
    }
    if (this.isCommandMessage(e)) {
      return false
    }

    const groupId = String(e.group_id || "")
    const currentSender = String(e.user_id || "")
    if (!groupId || !currentSender || currentSender === String(e.self_id || "")) {
      return false
    }

    if (!this.isGroupAllowed(groupId)) {
      return false
    }

    if (penaltyTimers.has(groupId)) {
      clearTimeout(penaltyTimers.get(groupId))
      penaltyTimers.delete(groupId)
    }

    const targetUsers = await this.getTargetUsers(e, currentSender)
    const lastSenderInfo = lastSender.get(groupId)

    if (lastSenderInfo?.userId === currentSender) {
      const newStreak = (lastSenderInfo.streak || 1) + 1
      lastSender.set(groupId, { userId: currentSender, streak: newStreak })

      if (newStreak > 1) {
        penaltyTimers.set(
          groupId,
          setTimeout(() => {
            this.applyConsecutiveMessagePenalty(groupId, currentSender)
            penaltyTimers.delete(groupId)
          }, 2 * 60 * 1000),
        )
      }
      return false
    }

    lastSender.set(groupId, { userId: currentSender, streak: 1 })

    if (targetUsers.length > 0) {
      for (const targetUser of targetUsers) {
        this.addFavorability(groupId, currentSender, targetUser, 2)
      }
    } else if (lastSenderInfo?.userId && lastSenderInfo.userId !== currentSender) {
      this.addFavorability(groupId, currentSender, lastSenderInfo.userId, 1)
    }

    return false
  }

  isCommandMessage(e) {
    const text = this.getPlainText(e)
    return /^[#/]/.test(text)
  }

  getPlainText(e) {
    if (Array.isArray(e.message)) {
      return e.message
        .filter(segment => segment.type === "text")
        .map(segment => String(segment.text || ""))
        .join("")
        .trim()
    }

    return String(e.msg || e.raw_message || "").trim()
  }

  async getTargetUsers(e, currentSender) {
    const atTargets = (e.message || [])
      .filter(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
      .map(msg => String(msg.qq))
      .filter(qq => qq !== currentSender)

    if (atTargets.length > 0) {
      return [...new Set(atTargets)]
    }

    const replyUserId = await this.getReplyUserId(e)
    if (replyUserId && replyUserId !== currentSender) {
      return [replyUserId]
    }

    return []
  }

  async getReplyUserId(e) {
    try {
      if (e.getReply) {
        const reply = await e.getReply()
        if (reply?.user_id) {
          return String(reply.user_id)
        }
      }

      if (e.source && e.group?.getChatHistory) {
        const reply = (await e.group.getChatHistory(e.source.seq, 1)).pop()
        if (reply?.user_id) {
          return String(reply.user_id)
        }
      }

      const replySegment = e.message?.find(segment => segment.type === "reply")
      if (replySegment?.id && e.group?.getMsg) {
        const reply = await e.group.getMsg(replySegment.id)
        if (reply?.user_id) {
          return String(reply.user_id)
        }
      }
    } catch (err) {
      logger.debug?.(`[cc-plugin][好感度] 获取回复对象失败: ${err.message || err}`)
    }

    return ""
  }

  async queryFavorability(e) {
    const groupId = String(e.group_id)
    const currentUser = String(e.user_id)
    const targetUser = this.getAtUserId(e)

    if (!targetUser) {
      await e.reply("请 @ 一位群友，例如：#好感度 @对方")
      return true
    }

    const currentUserName = await this.getUserName(e, currentUser)
    const targetUserName = await this.getUserName(e, targetUser)
    const forwardValue = this.getFavorability(groupId, currentUser, targetUser)
    const backwardValue = this.getFavorability(groupId, targetUser, currentUser)

    const rendered = await this.renderImage(e, {
      mode: "pair",
      title: "群友好感度",
      subTitle: `${currentUserName} 与 ${targetUserName}`,
      pair: this.buildPairData(currentUserName, targetUserName, forwardValue, backwardValue),
    })

    if (!rendered) {
      await e.reply(`${currentUserName} -> ${targetUserName}: ${forwardValue}\n${targetUserName} -> ${currentUserName}: ${backwardValue}`)
    }

    return true
  }

  async whoLikesMe(e) {
    return this.renderRanking(e, {
      title: "谁在意我",
      emptyText: "还没有人对你有好感哦~",
      collect: (data, currentUser) => {
        const list = []
        for (const fromUser in data.favorability || {}) {
          if (data.favorability[fromUser][currentUser] !== undefined) {
            list.push({ userId: fromUser, favorability: data.favorability[fromUser][currentUser] })
          }
        }
        return list
      },
    })
  }

  async whoILike(e) {
    return this.renderRanking(e, {
      title: "我在意谁",
      emptyText: "你还没有对任何人产生好感哦~",
      collect: (data, currentUser) => Object.entries(data.favorability?.[currentUser] || {})
        .map(([userId, favorability]) => ({ userId, favorability })),
    })
  }

  async renderRanking(e, { title, emptyText, collect }) {
    const groupId = String(e.group_id)
    const currentUser = String(e.user_id)
    const data = this.readData(groupId)
    const ranking = collect(data, currentUser)
      .sort((a, b) => b.favorability - a.favorability)
      .slice(0, 10)

    if (ranking.length === 0) {
      await e.reply(emptyText)
      return true
    }

    const ownerName = await this.getUserName(e, currentUser)
    const items = await Promise.all(ranking.map(async (item, index) => {
      const name = await this.getUserName(e, item.userId)
      return {
        ...item,
        name,
        scoreText: this.formatScore(item.favorability),
        scoreClass: this.getScoreClass(item.favorability),
        heart: this.getHeartMark(item.favorability),
        rankText: index >= 3 ? `${index + 1}.` : "",
      }
    }))

    const rendered = await this.renderImage(e, {
      mode: "ranking",
      title,
      subTitle: ownerName,
      ranking: items,
    })

    if (!rendered) {
      await e.reply([
        `${title} - ${ownerName}`,
        ...items.map((item, index) => `${index + 1}. ${item.name}: ${item.scoreText}`),
      ].join("\n"))
    }

    return true
  }

  buildPairData(currentName, targetName, forwardValue, backwardValue) {
    return [
      {
        fromName: currentName,
        toName: targetName,
        favorability: forwardValue,
        scoreText: this.formatScore(forwardValue),
        scoreClass: this.getScoreClass(forwardValue),
        heart: this.getHeartMark(forwardValue),
      },
      {
        fromName: targetName,
        toName: currentName,
        favorability: backwardValue,
        scoreText: this.formatScore(backwardValue),
        scoreClass: this.getScoreClass(backwardValue),
        heart: this.getHeartMark(backwardValue),
      },
    ]
  }

  async renderImage(e, data) {
    try {
      return await Render.render("favorability/index", data, { e })
    } catch (err) {
      logger.error(`[cc-plugin][好感度] 渲染失败: ${err.message || err}`)
      return false
    }
  }

  getAtUserId(e) {
    const atMsg = e.message?.find(msg => msg.type === "at" && msg.qq && !isNaN(msg.qq))
    return atMsg?.qq ? String(atMsg.qq) : ""
  }

  async getUserName(e, userId) {
    const targetUserId = String(userId || "")
    if (!targetUserId) {
      return ""
    }

    if (targetUserId === String(e.user_id || "")) {
      return e.member?.card || e.member?.nickname || e.sender?.card || e.sender?.nickname || targetUserId
    }

    try {
      const member = e.group?.pickMember?.(targetUserId)
      let memberInfo = member?.info
      if (!memberInfo && member?.getInfo) {
        memberInfo = await member.getInfo(true).catch(() => null)
      }
      const name = memberInfo?.card || memberInfo?.nickname || member?.card || member?.nickname
      if (name) {
        return name
      }
    } catch (err) {
      logger.debug?.(`[cc-plugin][好感度] 获取群昵称失败: ${err.message || err}`)
    }

    try {
      const member = e.group?.pickMember?.(Number(targetUserId))
      let memberInfo = member?.info
      if (!memberInfo && member?.getInfo) {
        memberInfo = await member.getInfo(true).catch(() => null)
      }
      const name = memberInfo?.card || memberInfo?.nickname || member?.card || member?.nickname
      if (name) {
        return name
      }
    } catch (err) {
      logger.debug?.(`[cc-plugin][好感度] 获取群昵称失败: ${err.message || err}`)
    }

    return targetUserId
  }

  formatScore(value) {
    return String(value)
  }

  getScoreClass(value) {
    if (value >= 50) return "legendary"
    if (value >= 20) return "close"
    if (value >= 5) return "warm"
    if (value > 0) return "positive"
    if (value < 0) return "negative"
    return "zero"
  }

  getHeartMark(value) {
    if (value >= 50) return "♥"
    if (value >= 20) return "💕"
    if (value >= 5) return "💗"
    if (value > 0) return "♡"
    if (value < 0) return "♡"
    return "◇"
  }
}
