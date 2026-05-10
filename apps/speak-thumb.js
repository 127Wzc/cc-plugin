import Config from "../components/Cfg.js"
import moment from "moment"

const countKeyPrefix = "Yz:cc:speakThumb:count"
const doneKeyPrefix = "Yz:cc:speakThumb:done"

function normalizeGroupList(list) {
  return Array.isArray(list) ? list.map(item => String(item)).filter(Boolean) : []
}

function isSuccessResult(res) {
  if (res === true) return true
  if (!res || typeof res !== "object") return false

  const code = res.code ?? res.retcode ?? res.status
  if (code === 0 || code === "0" || code === "ok") return true
  if (res.status === "ok") return true
  return false
}

function renderSuccessMessage(template, data) {
  return String(template || "发言活跃达标，已给 {{name}} 点赞啦~")
    .replace(/\{\{name\}\}/g, data.name)
    .replace(/\{\{user_id\}\}/g, data.userId)
    .replace(/\{\{count\}\}/g, String(data.count))
}

function secondsUntilTomorrow() {
  return Math.max(1, moment().add(1, "day").startOf("day").diff(moment(), "seconds"))
}

function getFeedbackMode(cfg) {
  if (cfg.feedbackMode) return String(cfg.feedbackMode)
  return cfg.notifyOnSuccess === false ? "silent" : "text"
}

async function getUserName(e, userId) {
  try {
    const member = e.group?.pickMember?.(userId)
    let info = member?.info
    if (!info && member?.getInfo) {
      info = await member.getInfo(true).catch(() => null)
    }
    return info?.card || info?.nickname || member?.card || member?.nickname || String(userId)
  } catch {}

  return String(userId)
}

async function likeUser(e, userId, times) {
  const bot = e.bot ?? Bot
  const count = Math.max(1, Math.min(Number(times) || 1, 20))

  try {
    const friend = bot?.pickFriend?.(userId)
    if (friend?.thumbUp) {
      const res = await friend.thumbUp(count)
      return isSuccessResult(res)
    }
  } catch (err) {
    logger.debug?.(`[cc-plugin][发言点赞] pickFriend 点赞失败: ${err?.message || err}`)
  }

  if (!bot?.sendApi) {
    return false
  }

  try {
    const res = await bot.sendApi("send_like", { user_id: Number(userId), times: count })
    return isSuccessResult(res)
  } catch (err) {
    logger.debug?.(`[cc-plugin][发言点赞] send_like 失败: ${err?.message || err}`)
  }

  try {
    const res = await bot.sendApi("send_profile_like", { user_id: Number(userId), count })
    return isSuccessResult(res)
  } catch (err) {
    logger.debug?.(`[cc-plugin][发言点赞] send_profile_like 失败: ${err?.message || err}`)
  }

  return false
}

async function sendEmojiLike(e, emojiId) {
  if (!e?.message_id || !emojiId) return false
  try {
    const res = await (e.bot ?? Bot)?.sendApi?.("set_msg_emoji_like", {
      message_id: e.message_id,
      emoji_id: String(emojiId),
    })
    return isSuccessResult(res)
  } catch (err) {
    logger.debug?.(`[cc-plugin][发言点赞] 表情回应失败: ${err?.message || err}`)
    return false
  }
}

async function sendSuccessFeedback(e, cfg, { userId, count }) {
  const mode = getFeedbackMode(cfg)
  if (mode === "silent") return

  if (mode === "emoji_like") {
    await sendEmojiLike(e, cfg.emojiLikeId || 66)
    return
  }

  const userName = await getUserName(e, String(userId))
  const recallSeconds = Math.max(0, Math.trunc(Number(cfg.successRecallSeconds ?? 3)))
  await e.reply(renderSuccessMessage(cfg.successMessage, {
    name: userName,
    userId: String(userId),
    count,
  }), false, { recallMsg: recallSeconds })
}

async function handleSpeakThumb(e) {
  const gid = e?.group_id
  const uid = e?.user_id
  if (gid == null || uid == null) return

  const cfg = Config.getDefOrConfig("speakThumb")
  if (!cfg?.enable) return

  const whitelistGroups = normalizeGroupList(cfg.whitelistGroups)
  if (!whitelistGroups.includes(String(gid))) return

  if (cfg.skipBot !== false && String(uid) === String(e.self_id)) return

  const threshold = Math.trunc(Number(cfg.threshold) || 0)
  if (threshold < 1) return

  const selfId = String(e.self_id || e.bot?.uin || "")
  const day = moment().format("YYYY:MM:DD")
  const expireSeconds = secondsUntilTomorrow()
  const doneKey = `${doneKeyPrefix}:${selfId}:${day}:${uid}`
  if (await redis.get(doneKey)) return

  const countKey = `${countKeyPrefix}:${gid}:${uid}:${day}`
  const total = Number(await redis.incr(countKey)) || 0
  if (total === 1) {
    await redis.expire?.(countKey, expireSeconds)
  }
  if (total < threshold) return

  // 当天达标后无论点赞成功、已点过还是失败，都不再对该用户重复触发。
  await redis.set(doneKey, JSON.stringify({
    groupId: String(gid),
    day,
    count: total,
    attemptedAt: Date.now(),
  }), { EX: expireSeconds })

  const success = await likeUser(e, uid, cfg.likeTimes)
  if (!success) return

  await sendSuccessFeedback(e, cfg, { userId: uid, count: total })
}

if (typeof Bot !== "undefined") {
  if (globalThis.__ccSpeakThumbHandler && Bot.off) {
    Bot.off("message.group", globalThis.__ccSpeakThumbHandler)
  }

  globalThis.__ccSpeakThumbHandler = async e => {
    try {
      await handleSpeakThumb(e)
    } catch (err) {
      logger.error("[cc-plugin][发言点赞] 处理异常", err)
    }
  }

  Bot.on("message.group", globalThis.__ccSpeakThumbHandler)
}

/** 占位类：由 cc-plugin index 载入；实际逻辑为上方 Bot.on */
export class speakThumb extends plugin {
  constructor() {
    super({
      name: "[cc-plugin]发言点赞",
      dsc: "白名单群发言达标自动点赞",
      event: "message.group",
      priority: 99999,
      rule: [],
    })
  }
}
