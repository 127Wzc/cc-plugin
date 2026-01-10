import path from 'path'

const _path = process.cwd()
const pluginPath = path.join(_path, 'plugins', 'cc-plugin')
const resPath = path.join(pluginPath, 'resources')

/**
 * cc-plugin 图片渲染器
 * 封装 e.runtime.render() 调用，提供统一的渲染接口
 */
const Render = {
    /**
     * 插件资源路径
     */
    get resPath() {
        return resPath
    },

    /**
     * 通用渲染方法
     * @param {string} tplPath - 模板路径 (相对于 resources 目录)
     * @param {object} params - 渲染参数
     * @param {object} cfg - 配置选项 { e, scale, ... }
     */
    async render(tplPath, params, cfg = {}) {
        const { e } = cfg
        if (!e?.runtime) {
            logger.error('[cc-plugin] 未找到 e.runtime，请升级至最新版 Yunzai')
            return false
        }

        const layoutPath = path.join(resPath, 'common', 'layout') + '/'

        return e.runtime.render('cc-plugin', tplPath, params, {
            retType: cfg.retType || 'default',
            beforeRender({ data }) {
                return {
                    ...data,
                    _res_path: resPath,
                    _layout_path: layoutPath,
                    defaultLayout: layoutPath + 'default.html',
                    sys: {
                        scale: cfg.scale ? `style='transform:scale(${cfg.scale})'` : ''
                    },
                    copyright: `Created By Yunzai-Bot & cc-plugin`
                }
            }
        })
    },

    /**
     * 渲染帮助页
     * @param {object} e - 消息事件
     * @param {object} data - 帮助数据 { title, subTitle, helpGroup, tips }
     */
    async renderHelp(e, data) {
        return this.render('help/index', {
            title: data.title || '大香蕉帮助',
            subTitle: data.subTitle || 'cc-plugin 图片生成插件',
            helpGroup: data.helpGroup || [],
            tips: data.tips || []
        }, { e })
    },

    /**
     * 渲染列表页
     * @param {object} e - 消息事件
     * @param {object} data - 列表数据 { title, subTitle, list, stats, footer }
     */
    async renderList(e, data) {
        return this.render('list/index', {
            title: data.title || '列表',
            subTitle: data.subTitle || '',
            listTitle: data.listTitle || '',
            list: data.list || [],
            stats: data.stats || null,
            footer: data.footer || ''
        }, { e })
    }
}

export default Render
