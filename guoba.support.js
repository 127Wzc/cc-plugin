import Config from './components/Cfg.js'
import lodash from 'lodash'

const MASKED_KEY_PLACEHOLDER = '******'

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
                {
                    field: 'ImgTag.disabled_summary',
                    label: '禁用外显关键词',
                    helpMessage: '这些图片外显文字会被忽略，不作为标签上传',
                    bottomHelpMessage: '例如: 动画表情、图片 等',
                    component: 'GTags',
                    componentProps: {
                        placeholder: '输入关键词后按回车添加',
                        allowAdd: true,
                        allowDel: true
                    }
                },
                {
                    label: '权限与用户 Key',
                    component: 'Divider'
                },
                {
                    field: 'ImgTag.user_keys',
                    label: '用户-APIKey 关联',
                    helpMessage: '为指定 QQ 分配 ImgTag 个人 api_key（用于上传/搜图/随机图）',
                    bottomHelpMessage: '出于安全考虑，已保存的 key 不会在面板回显；如需修改请重新输入覆盖。#cc搜图/#cc随机图/#cc来张 会从这里随机选取一个启用的 key 供所有用户使用。',
                    component: 'GSubForm',
                    componentProps: {
                        multiple: true,
                        schemas: [
                            {
                                field: 'user_id',
                                label: 'QQ号',
                                component: 'Input',
                                required: true,
                                componentProps: {
                                    placeholder: '123456'
                                }
                            },
                            {
                                field: 'api_key',
                                label: 'api_key',
                                component: 'InputPassword',
                                componentProps: {
                                    placeholder: '输入后保存（不回显）'
                                }
                            },
                            {
                                field: 'enabled',
                                label: '启用',
                                component: 'Switch'
                            },
                            {
                                field: 'remark',
                                label: '备注',
                                component: 'Input',
                                componentProps: {
                                    placeholder: '可选'
                                }
                            }
                        ]
                    }
                },

                // ==================== Banana 配置 ====================
                {
                    label: 'Banana 大香蕉',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    label: 'API 配置',
                    component: 'Divider'
                },
                {
                    field: 'Banana.api_url',
                    label: 'API 服务地址',
                    helpMessage: 'API 后端服务的 URL 地址',
                    bottomHelpMessage: '例如: https://hw-newapi.559558.xyz/v1/chat/completions',
                    component: 'Input',
                    componentProps: {
                        placeholder: '请输入 API 服务地址'
                    }
                },
                {
                    field: 'Banana.default_model',
                    label: '默认模型',
                    helpMessage: '生成图片时使用的默认模型，可手动输入自定义模型名称',
                    bottomHelpMessage: '支持下拉选择或直接输入模型名',
                    component: 'AutoComplete',
                    componentProps: {
                        placeholder: '选择或输入模型名称',
                        allowClear: true,
                        options: [
                            { label: 'Gemini 3.0 Pro Image Preview', value: 'gemini-3-pro-image-preview' },
                            { label: 'Gemini 2.5 Flash Image', value: 'gemini-2.5-flash-image' },
                            { label: 'Gemini 3.0 Pro Image', value: 'gemini-3.0-pro-image' },
                            { label: 'Imagen 4.0', value: 'imagen-4.0-generate-preview' },
                            { label: 'nano-banana', value: 'nano-banana' }
                        ]
                    }
                },
                {
                    label: '功能设置',
                    component: 'Divider'
                },
                {
                    field: 'Banana.use_stream',
                    label: '流式响应',
                    helpMessage: '是否使用流式响应模式',
                    bottomHelpMessage: '启用后可以看到生成进度',
                    component: 'Switch'
                },
                {
                    field: 'Banana.max_concurrent',
                    label: '最大并发数',
                    helpMessage: '同时执行的任务数量',
                    bottomHelpMessage: '建议设置为 1-3',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 5,
                        placeholder: '1'
                    }
                },
                {
                    field: 'Banana.max_queue',
                    label: '最大队列',
                    helpMessage: '最大等待队列长度',
                    bottomHelpMessage: '超过此数量将拒绝新请求',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 20,
                        placeholder: '5'
                    }
                },
                {
                    field: 'Banana.disable_keys_on_error',
                    label: '错误时禁用密钥',
                    helpMessage: '密钥失败次数过多时自动禁用',
                    component: 'Switch'
                },
                {
                    label: '预设管理',
                    component: 'Divider'
                },
                {
                    field: 'Banana.presets',
                    label: '预设列表',
                    helpMessage: '配置预设关键字和提示词',
                    bottomHelpMessage: '每个预设包含: cmd(关键字), name(名称), desc(描述), prompt(提示词)',
                    component: 'GSubForm',
                    componentProps: {
                        multiple: true,
                        schemas: [
                            {
                                field: 'cmd',
                                label: '关键字',
                                component: 'Input',
                                required: true,
                                componentProps: {
                                    placeholder: '例如: 手办化'
                                }
                            },
                            {
                                field: 'name',
                                label: '名称',
                                component: 'Input',
                                componentProps: {
                                    placeholder: '显示名称'
                                }
                            },
                            {
                                field: 'desc',
                                label: '描述',
                                component: 'Input',
                                componentProps: {
                                    placeholder: '功能描述'
                                }
                            },
                            {
                                field: 'prompt',
                                label: '提示词',
                                component: 'InputTextArea',
                                required: true,
                                componentProps: {
                                    placeholder: '生成图片的提示词',
                                    autoSize: { minRows: 2, maxRows: 6 }
                                }
                            }
                        ]
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
                const imgTag = lodash.cloneDeep(Config.getDefOrConfig('ImgTag'))
                if (Array.isArray(imgTag.user_keys)) {
                    imgTag.user_keys = imgTag.user_keys.map(row => ({
                        ...row,
                        api_key: row?.api_key ? MASKED_KEY_PLACEHOLDER : ''
                    }))
                }
                return {
                    ImgTag: imgTag,
                    Banana: Config.getDefOrConfig('Banana'),
                    qqConfig: Config.getDefOrConfig('qqConfig')
                }
            },

            // 设置配置数据
            setConfigData(data, { Result }) {
                for (let [keyPath, value] of Object.entries(data)) {
                    // keyPath 格式: ImgTag.api_url 或 qqConfig.ai.type 或 Banana.api_url
                    const parts = keyPath.split('.')
                    const configName = parts[0]  // ImgTag 或 qqConfig 或 Banana
                    const fieldPath = parts.slice(1).join('.')  // api_url 或 ai.type

                    if (configName === 'ImgTag' || configName === 'qqConfig' || configName === 'Banana') {
                        if (configName === 'ImgTag' && fieldPath === 'user_keys') {
                            const existing = Config.getConfig('ImgTag')?.user_keys || []
                            const existingMap = new Map(existing.map(r => [String(r?.user_id), r]))

                            const nextList = Array.isArray(value) ? value : []
                            const mergedMap = new Map()
                            for (const row of nextList) {
                                const userId = String(row?.user_id || '').trim()
                                if (!userId) continue

                                const prev = existingMap.get(userId)
                                let apiKey = row?.api_key
                                if (apiKey === MASKED_KEY_PLACEHOLDER || apiKey === undefined || apiKey === null) {
                                    apiKey = prev?.api_key || ''
                                }

                                mergedMap.set(userId, {
                                    user_id: row?.user_id,
                                    api_key: String(apiKey || '').trim(),
                                    enabled: row?.enabled !== false,
                                    remark: row?.remark || ''
                                })
                            }

                            Config.modify('ImgTag', 'user_keys', Array.from(mergedMap.values()))
                        } else {
                            Config.modify(configName, fieldPath, value)
                        }
                    }
                }
                return Result.ok({}, '保存成功~')
            }
        }
    }
}
