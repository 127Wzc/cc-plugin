import Render from '../components/Render.js'
import BananaService from '../model/BananaService.js'

/**
 * cc-plugin 帮助插件
 */
export class help extends plugin {
    constructor() {
        super({
            name: '[cc-plugin] Help',
            dsc: 'cc-plugin 帮助',
            event: 'message',
            priority: 50,
            rule: [
                {
                    reg: '^#cc帮助$',
                    fnc: 'showHelp'
                }
            ]
        })
    }

    async showHelp(e) {
        const presets = BananaService.getPresets()

        const helpGroup = [
            // ===== 基础命令 =====
            {
                group: '🍌 大香蕉绘图',
                list: [
                    { title: '#cc [提示词]', desc: '生成/编辑图片' },
                    { title: '#大香蕉模型列表', desc: '支持的模型' },
                    { title: '#大香蕉预设列表', desc: '预设关键字' }
                ]
            },
            // ===== 预设关键字 (放在上面) =====
            {
                group: `🎯 预设关键字 (${presets.length}个)`,
                list: presets.map(p => ({
                    title: `#${p.cmd}`,
                    desc: p.desc || p.name || ''
                }))
            },
            // ===== 图库功能 (ImgTag) =====
            {
                group: '🖼️ 图库功能',
                list: [
                    { title: '#偷图 [标签...]', desc: '保存引用的图片' },
                    { title: '#cc搜图 [关键词]', desc: '搜索图库' },
                    { title: '#cc随机图 [标签]', desc: '随机发图' },
                    { title: '#cc来张 [标签]', desc: '随机发图' },
                    { title: '#cc图库状态', desc: '统计信息' }
                ]
            },
            // ===== QQ声聊功能 =====
            {
                group: '🎙️ 声聊功能',
                list: [
                    { title: '#[角色名]说 [文字]', desc: 'AI语音合成' },
                    { title: '#声聊说 [文字]', desc: '当前角色语音' },
                    { title: '#声聊列表', desc: '查看角色列表' },
                    { title: '#声聊设置角色 [名]', desc: '设置默认角色' }
                ]
            },
            // ===== 互动功能 =====
            {
                group: '👆 互动功能',
                list: [
                    { title: '戳一戳机器人', desc: '随机互动回复' }
                ]
            },
            // ===== 管理命令 (放在最后) =====
            {
                group: '🔧 管理命令 (仅主人)',
                list: [
                    { title: '#大香蕉添加key', desc: '添加API密钥' },
                    { title: '#大香蕉key列表', desc: '密钥状态' },
                    { title: '#大香蕉调试', desc: '调试信息' }
                ]
            },
            // ===== 帮助 =====
            {
                group: '❓ 帮助',
                list: [
                    { title: '#cc帮助', desc: '查看本帮助' }
                ]
            }
        ]

        await Render.renderHelp(e, {
            title: '🍌 cc帮助',
            subTitle: 'cc-plugin 多功能插件',
            helpGroup,
            tips: [
                '可以回复图片进行图生图',
                '支持多张图片输入（最多3张）',
                '戳一戳机器人有趣互动'
            ]
        })
        return true // 中断指令响应
    }
}
