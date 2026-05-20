import fs from 'node:fs'
import path from 'node:path'
import fetch from 'node-fetch'
import RoleGuide from '../../mora-plugin/model/roleGuide.js'
import moracfg from '../../mora-plugin/model/config.js'

const rootPath = process.cwd()
const defaultInterval = 120000
const allowedImageHosts = new Set([
  'upload-bbs.miyoushe.com',
  'upload-bbs.mihoyo.com',
  'gitee.com'
])

const gameMeta = {
  gs: {
    label: '原神',
    strategyKey: 'GenshinImpact',
    dataDir: 'GenshinImpact'
  },
  sr: {
    label: '星铁',
    strategyKey: 'StarRail',
    dataDir: 'StarRail'
  },
  zzz: {
    label: '绝区零',
    strategyKey: 'ZenlessZoneZero',
    dataDir: 'ZenlessZoneZero'
  }
}

function safePathSegment (value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\.\.+/g, '_')
    .trim()
}

function isAllowedImageUrl (value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && allowedImageHosts.has(url.hostname)
  } catch {
    return false
  }
}

class MoraFullGuideUpdater {
  constructor () {
    this.job = null
  }

  isRunning () {
    return !!this.job?.running
  }

  async start (e, options = {}) {
    if (this.isRunning()) {
      return {
        started: false,
        message: this.statusText()
      }
    }

    const games = options.games || ['gs', 'sr', 'zzz']
    const interval = Number(options.interval || defaultInterval)
    const tasks = this.buildTasks(e, games)

    if (!tasks.length) {
      return {
        started: false,
        message: '没有找到可更新的攻略图任务，请先发送【#更新摩拉资源】更新资源包。'
      }
    }

    this.job = {
      running: true,
      e,
      tasks,
      interval,
      index: 0,
      success: 0,
      failed: 0,
      startedAt: Date.now(),
      timer: null,
      current: null
    }

    this.schedule(0)

    return {
      started: true,
      total: tasks.length,
      interval
    }
  }

  stop () {
    if (!this.isRunning()) return false
    if (this.job.timer) clearTimeout(this.job.timer)
    this.job.running = false
    this.job = null
    return true
  }

  statusText () {
    if (!this.isRunning()) return '当前没有正在运行的全量摩拉攻略更新任务。'

    const { tasks, index, success, failed, startedAt, interval, current } = this.job
    const done = Math.min(index, tasks.length)
    const left = Math.max(tasks.length - done, 0)
    const etaHours = ((left * interval) / 3600000).toFixed(1)
    const runningFor = ((Date.now() - startedAt) / 60000).toFixed(1)
    const currentText = current ? `\n当前：${gameMeta[current.game]?.label || current.game} ${current.name}` : ''

    return `全量摩拉攻略更新中：${done}/${tasks.length}\n成功：${success}，失败：${failed}\n已运行：${runningFor}分钟，预计剩余：${etaHours}小时${currentText}`
  }

  schedule (delay) {
    if (!this.isRunning()) return
    this.job.timer = setTimeout(() => this.tick(), delay)
  }

  async tick () {
    if (!this.isRunning()) return
    const job = this.job

    if (job.index >= job.tasks.length) {
      await this.safeReply(job.e, `全量摩拉攻略更新完成。\n成功：${job.success}，失败：${job.failed}`)
      logger.mark(`[cc-plugin] 全量摩拉攻略更新完成，成功：${job.success}，失败：${job.failed}`)
      this.job = null
      return
    }

    const task = job.tasks[job.index]
    job.current = task
    logger.mark(`[cc-plugin] 全量摩拉攻略更新 ${job.index + 1}/${job.tasks.length}：${gameMeta[task.game]?.label || task.game} ${task.name}`)

    try {
      const result = await this.updateRole(job.e, task)
      if (result.success > 0) job.success++
      else job.failed++
      logger.mark(`[cc-plugin] 全量摩拉攻略更新完成：${task.name}，成功源：${result.success}，失败源：${result.failed}`)
    } catch (error) {
      job.failed++
      logger.error(`[cc-plugin] 全量摩拉攻略更新异常：${task.name}`, error)
    } finally {
      job.index++
      job.current = null
    }

    if (job.index > 0 && job.index % 10 === 0) {
      await this.safeReply(job.e, this.statusText())
    }

    this.schedule(job.interval)
  }

  async updateRole (e, task) {
    let success = 0
    let failed = 0

    for (const entry of task.entries) {
      const target = this.getTargetPath(task.game, entry.source, task.name)
      const ok = await this.downloadImage(entry.link, target)
      if (ok) success++
      else failed++
    }

    return { success, failed }
  }

  buildTasks (e, games) {
    const tasks = []

    for (const game of games) {
      const meta = gameMeta[game]
      if (!meta) continue

      const guide = this.createGuide(e, game)
      const sources = this.getConfiguredSources(guide, game)
      const roles = this.collectRoles(meta.strategyKey, sources)

      for (const [name, roleSources] of roles) {
        tasks.push({
          game,
          name,
          entries: roleSources
        })
      }
    }

    return tasks
  }

  createGuide (e, game) {
    const nextE = {
      ...(e || {}),
      game,
      logFnc: e?.logFnc || '[cc全量摩拉攻略]',
      reply: async (...args) => e?.reply?.(...args)
    }
    return new RoleGuide(nextE)
  }

  getConfiguredSources (guide, game) {
    const uploader = guide.uploader || {}
    const sources = game === 'gs'
      ? [...(uploader.news || []), ...(uploader.olds || [])]
      : (Array.isArray(uploader) ? uploader : [])

    return new Set(sources.map(item => item?.source).filter(Boolean))
  }

  collectRoles (strategyKey, configuredSources) {
    const strategyDir = path.join(rootPath, 'plugins/mora-plugin/resources/mora-plugin-res/strategy')
    const roles = new Map()
    if (!fs.existsSync(strategyDir)) return roles

    const files = fs.readdirSync(strategyDir).filter(file => file.endsWith('.json'))
    for (const file of files) {
      const filePath = path.join(strategyDir, file)
      let json
      try {
        json = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      } catch (error) {
        logger.warn(`[cc-plugin] 跳过无法解析的攻略源：${filePath}，${error.message}`)
        continue
      }

      for (const [source, value] of Object.entries(json)) {
        if (configuredSources.size && !configuredSources.has(source)) continue
        const list = value?.[strategyKey] || []
        if (!Array.isArray(list)) continue

        for (const item of list) {
          const name = String(item?.name || '').trim()
          const link = String(item?.link || '').trim()
          if (!name || !link) continue
          if (!isAllowedImageUrl(link)) {
            logger.warn(`[cc-plugin] 跳过非白名单图片地址：${source}-${name}`)
            continue
          }
          if (!roles.has(name)) roles.set(name, new Map())
          if (!roles.get(name).has(source)) {
            roles.get(name).set(source, link)
          }
        }
      }
    }

    return new Map([...roles.entries()]
      .map(([name, entries]) => [
        name,
        [...entries.entries()]
          .map(([source, link]) => ({ source, link }))
          .sort((a, b) => a.source.localeCompare(b.source, 'zh-CN'))
      ])
      .sort(([a], [b]) => a.localeCompare(b, 'zh-CN')))
  }

  getOssParams () {
    const config = moracfg.getSetYaml('config', true)
    return config?.ossParams || ''
  }

  async downloadImage (link, target) {
    if (!isAllowedImageUrl(link)) return false

    const dir = path.dirname(target)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const response = await fetch(`${link}${this.getOssParams()}`)
    if (!response.ok) return false

    const arrayBuffer = await response.arrayBuffer()
    fs.writeFileSync(target, Buffer.from(arrayBuffer))
    return true
  }

  getTargetPath (game, source, name) {
    return path.join(
      moracfg.getMoraPath('data'),
      'roleGuides',
      safePathSegment(source),
      gameMeta[game].dataDir,
      `${safePathSegment(name)}.jpg`
    )
  }

  async safeReply (e, msg) {
    try {
      await e?.reply?.(msg)
    } catch (error) {
      logger.warn(`[cc-plugin] 全量摩拉攻略进度消息发送失败：${error.message}`)
    }
  }
}

export default new MoraFullGuideUpdater()
