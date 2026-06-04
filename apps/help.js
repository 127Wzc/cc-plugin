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
                    { title: '#cc视频 [提示词]', desc: '生成视频（必须有参考图：回复/附图/@头像/自己头像）' },
                    { title: '作图协议', desc: '锅巴可切换 Chat Completions 或 OpenAI Images API' },
                    { title: '#预设 昵称', desc: '手动指定昵称（用于含 {{nickname}} 的预设）' },
                    { title: '#预设 @用户 昵称', desc: '指定目标用户和昵称；也支持 QQ号 昵称' },
                    { title: '#预设 -p 追加要求', desc: '在预设提示词后追加自定义要求' },
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
                    { title: '#cc图库设置key [key]', desc: '设置个人 ImgTag api_key' },
                    { title: '#cc图库删除key', desc: '删除个人 ImgTag api_key' },
                    { title: '#cc图库我的状态', desc: '查看授权与 key 状态' },
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
                    { title: '戳一戳机器人', desc: '随机互动回复' },
                    { title: '#好感度 @群友', desc: '查看双向好感度' },
                    { title: '#谁在意我', desc: '查看对你有好感的人' },
                    { title: '#我在意谁', desc: '查看你在意的人' },
                    { title: '#好感度白名单', desc: '查看/管理启用群' }
                ]
            },
            // ===== 管理命令 (放在最后) =====
            {
                group: '🔧 管理命令 (仅主人)',
                list: [
                    { title: '#cc切换图片模型<模型名>', desc: '切换生图默认模型（default/默认/清空 可重置）' },
                    { title: '#cc切换视频模型<模型名>', desc: '切换视频默认模型（follow/跟随/default 可恢复跟随图片）' },
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
                '预设提示词可用 {{nickname}} / {{qq}} / {{group_name}} 等变量',
                '戳一戳机器人有趣互动'
            ]
        })
        return true // 中断指令响应
    }
}
