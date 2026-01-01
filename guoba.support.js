import Config from './components/Cfg.js'
import lodash from 'lodash'

// 支持锅巴
export function supportGuoba() {
    return {
        // 插件信息
        pluginInfo: {
            name: 'cc-plugin',
            title: 'CC-Plugin',
            description: 'QQ机器人功能增强插件，包含防刷屏禁言、戳一戳互动、ImgTag智能图床等功能',
            author: '@127Wzc',
            authorLink: 'https://github.com/127Wzc',
            link: 'https://github.com/127Wzc/cc-plugin',
            isV3: true,
            isV2: false,
            showInMenu: 'auto',
            icon: 'mdi:image-multiple',
            iconColor: '#4CAF50'
        },
        // 配置项信息
        configInfo: {
            schemas: [
                // ==================== ImgTag 配置 ====================
                {
                    label: 'ImgTag 智能图床',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    label: 'API 配置',
                    component: 'Divider'
                },
                {
                    field: 'ImgTag.api_url',
                    label: 'API 服务地址',
                    helpMessage: 'ImgTag 后端服务的 URL 地址',
                    bottomHelpMessage: '例如: https://imag-tag.559558.xyz',
                    component: 'Input',
                    required: true,
                    componentProps: {
                        placeholder: '请输入 API 服务地址'
                    }
                },
                {
                    field: 'ImgTag.api_key',
                    label: 'API 密钥',
                    helpMessage: '在 ImgTag 个人中心生成的 API 密钥',
                    bottomHelpMessage: '用于身份验证，请妥善保管',
                    component: 'InputPassword',
                    componentProps: {
                        placeholder: '请输入 API 密钥'
                    }
                },
                {
                    label: '功能设置',
                    component: 'Divider'
                },
                {
                    field: 'ImgTag.auto_sync',
                    label: '自动同步到云端',
                    helpMessage: '偷图时是否自动上传到 ImgTag 云端',
                    bottomHelpMessage: '开启后偷图会同时保存本地和上传云端',
                    component: 'Switch'
                },
                {
                    field: 'ImgTag.auto_analyze',
                    label: 'AI 自动分析',
                    helpMessage: '上传图片时是否启用 AI 自动分析标签',
                    bottomHelpMessage: '需要 ImgTag 后端支持 AI 视觉分析功能',
                    component: 'Switch'
                },
                {
                    field: 'ImgTag.default_category_id',
                    label: '默认分类 ID',
                    helpMessage: '上传图片时的默认分类',
                    bottomHelpMessage: '留空使用系统默认分类 (1=风景 2=人像 3=动漫 4=表情 5=截图 6=壁纸 7=其他)',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        placeholder: '4'
                    }
                },
                {
                    field: 'ImgTag.send_strategy',
                    label: '发图策略',
                    helpMessage: '搜图/随机图时的图片发送策略',
                    bottomHelpMessage: 'local_first: 优先本地 | remote_only: 仅远程 | local_only: 仅本地',
                    component: 'Select',
                    componentProps: {
                        options: [
                            { label: '本地优先', value: 'local_first' },
                            { label: '仅远程', value: 'remote_only' },
                            { label: '仅本地', value: 'local_only' }
                        ]
                    }
                },
                {
                    label: '存储设置',
                    component: 'Divider'
                },
                {
                    field: 'ImgTag.local_path',
                    label: '本地存储路径',
                    helpMessage: '图片本地存储的相对路径',
                    bottomHelpMessage: '相对于 Yunzai 根目录',
                    component: 'Input',
                    componentProps: {
                        placeholder: './resources/imgtag'
                    }
                },
                {
                    field: 'ImgTag.search_limit',
                    label: '搜索结果数量',
                    helpMessage: '搜图时返回的最大结果数量',
                    bottomHelpMessage: '建议设置为 3-20',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 50,
                        placeholder: '3'
                    }
                },
                {
                    field: 'ImgTag.random_count',
                    label: '随机图数量',
                    helpMessage: '随机图命令返回的图片数量',
                    bottomHelpMessage: '建议设置为 1',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 10,
                        placeholder: '1'
                    }
                },
                {
                    label: '回调设置',
                    component: 'Divider'
                },
                {
                    field: 'ImgTag.callback_url',
                    label: '回调 URL',
                    helpMessage: '用于接收 AI 分析完成通知的回调地址',
                    bottomHelpMessage: '格式: http://你的公网IP:2536/imgtag/callback，留空则不使用回调',
                    component: 'Input',
                    componentProps: {
                        placeholder: 'http://your-ip:2536/imgtag/callback'
                    }
                },

                // ==================== QQ 配置 ====================
                {
                    label: 'QQ 功能配置',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    label: 'QQ 群 AI 语音',
                    component: 'Divider'
                },
                {
                    field: 'qqConfig.ai.type',
                    label: 'AI 语音回复类型',
                    helpMessage: '群 AI 语音回复的类型',
                    bottomHelpMessage: '0=随机角色 1=指定角色',
                    component: 'Select',
                    componentProps: {
                        options: [
                            { label: '随机角色', value: 0 },
                            { label: '指定角色', value: 1 }
                        ]
                    }
                },
                {
                    field: 'qqConfig.ai.characterId',
                    label: 'AI 语音角色 ID',
                    helpMessage: '群 AI 语音回复使用的角色 ID',
                    bottomHelpMessage: '来自 data/ai-characters.json 的 character-id',
                    component: 'Input',
                    componentProps: {
                        placeholder: 'lucy-voice-suxinjiejie'
                    }
                }
            ],

            // 获取配置数据
            getConfigData() {
                return {
                    ImgTag: Config.getDefOrConfig('ImgTag'),
                    qqConfig: Config.getDefOrConfig('qqConfig')
                }
            },

            // 设置配置数据
            setConfigData(data, { Result }) {
                for (let [keyPath, value] of Object.entries(data)) {
                    // keyPath 格式: ImgTag.api_url 或 qqConfig.ai.type
                    const parts = keyPath.split('.')
                    const configName = parts[0]  // ImgTag 或 qqConfig
                    const fieldPath = parts.slice(1).join('.')  // api_url 或 ai.type

                    if (configName === 'ImgTag' || configName === 'qqConfig') {
                        Config.modify(configName, fieldPath, value)
                    }
                }
                return Result.ok({}, '保存成功~')
            }
        }
    }
}
