import fs from 'node:fs'

logger.info('**************************************')
logger.info('cc-plugin加载中')

if (!global.segment) {
  global.segment = (await import('oicq')).segment
}

const files = fs.readdirSync('./plugins/cc-plugin/apps').filter(file => file.endsWith('.js'))

let ret = []

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret)

let apps = {}
for (let i in files) {
  let name = files[i].replace('.js', '')

  if (ret[i].status !== 'fulfilled') {
    logger.error(`载入插件错误：${logger.red(name)}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

logger.info('cc-plugin加载成功')
logger.info(`当前版本0.0.1`)
logger.info('仓库地址 https://github.com/127Wzc/cc-plugin.git')
logger.info('**************************************')
export { apps }
