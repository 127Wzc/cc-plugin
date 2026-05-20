import MoraFullGuideUpdater from '../model/MoraFullGuideUpdater.js'

export class moraFullGuides extends plugin {
  constructor () {
    super({
      name: '[cc-plugin] 全量摩拉攻略更新',
      dsc: '在 cc-plugin 中管理 mora-plugin 全量攻略图更新',
      event: 'message',
      priority: 1,
      rule: [
        {
          reg: '^#更新全部(摩拉|原神|星铁|绝区零)攻略$',
          fnc: 'start',
          permission: 'master'
        },
        {
          reg: '^#全部摩拉攻略状态$',
          fnc: 'status',
          permission: 'master'
        },
        {
          reg: '^#停止全部摩拉攻略$',
          fnc: 'stop',
          permission: 'master'
        }
      ]
    })
  }

  async start (e) {
    const match = /^#更新全部(摩拉|原神|星铁|绝区零)攻略$/.exec(e.msg)
    const scope = match?.[1] || '摩拉'
    const games = {
      摩拉: ['gs', 'sr', 'zzz'],
      原神: ['gs'],
      星铁: ['sr'],
      绝区零: ['zzz']
    }[scope]

    const result = await MoraFullGuideUpdater.start(e, { games })
    if (!result.started) {
      await e.reply(result.message)
      return true
    }

    await e.reply(`开始全量更新${scope}攻略：共 ${result.total} 个角色。\n默认每个角色间隔 2 分钟慢慢更新。\n发送【#全部摩拉攻略状态】查看进度，【#停止全部摩拉攻略】停止任务。`)
    return true
  }

  async status (e) {
    await e.reply(MoraFullGuideUpdater.statusText())
    return true
  }

  async stop (e) {
    const stopped = MoraFullGuideUpdater.stop()
    await e.reply(stopped ? '已停止全量摩拉攻略更新任务。' : '当前没有正在运行的全量摩拉攻略更新任务。')
    return true
  }
}
