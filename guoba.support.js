import Config from './components/Cfg.js'
import lodash from 'lodash'

const MASKED_KEY_PLACEHOLDER = '******'

function normalizeBananaApiKeys(rawKeys) {
    return (Array.isArray(rawKeys) ? rawKeys : [])
        .map(row => {
            if (typeof row === 'string') return { api_key: row }
            if (row && typeof row === 'object') return { api_key: row.api_key || row.value || row.key || '' }
            return { api_key: '' }
        })
        .filter(row => String(row.api_key || '').trim())
}

function mergeBananaApiKeys(nextList) {
    const existingKeys = normalizeBananaApiKeys(Config.getConfig('Banana')?.api_keys || Config.getDefOrConfig('Banana')?.api_keys)
    const keys = (Array.isArray(nextList) ? nextList : [])
        .map((row, index) => {
            const prev = existingKeys[index] || {}
            let apiKey = row?.api_key

            if (apiKey === MASKED_KEY_PLACEHOLDER || apiKey === undefined || apiKey === null) {
                apiKey = prev?.api_key || ''
            }

            apiKey = String(apiKey || '').trim()
            if (!apiKey) return null

            return { api_key: apiKey }
        })
        .filter(Boolean)

    Config.modify('Banana', 'api_keys', keys)
}

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
                    field: 'Banana.api_keys',
                    label: 'API Key 列表',
                    helpMessage: '配置 Banana 绘图使用的 API Key，可添加多个用于失败重试时自动轮换',
                    bottomHelpMessage: '只做轮换使用，不会因异常标记、禁用或清理 key',
                    component: 'GSubForm',
                    componentProps: {
                        multiple: true,
                        schemas: [
                            {
                                field: 'api_key',
                                label: 'API Key',
                                component: 'InputPassword',
                                required: true,
                                componentProps: {
                                    placeholder: '输入后保存（不回显）'
                                }
                            }
                        ]
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
                    field: 'Banana.default_video_model',
                    label: '默认视频模型',
                    helpMessage: '生成视频时使用的默认模型（#cc视频，必须提供参考图），留空则回退到默认模型',
                    bottomHelpMessage: '此处填写你的后端支持的视频模型名称，例如 kling / runway / luma 等（以实际后端为准）',
                    component: 'Input',
                    componentProps: {
                        placeholder: '请输入默认视频模型（可留空）'
                    }
                },
                {
                    field: 'Banana.image_api_protocol',
                    label: '作图协议',
                    helpMessage: '全局图片生成协议。OpenAI Images API 会根据是否有参考图自动切换 generations/edits',
                    bottomHelpMessage: '默认 chat_completions 保持现有行为；openai_images 纯文本走 /v1/images/generations，带图走 /v1/images/edits',
                    component: 'Select',
                    componentProps: {
                        options: [
                            { label: 'Chat Completions (/v1/chat/completions)', value: 'chat_completions' },
                            { label: 'OpenAI Images API (/v1/images/generations|edits)', value: 'openai_images' }
                        ]
                    }
                },
                {
                    field: 'Banana.image_response_format',
                    label: 'Images响应格式',
                    helpMessage: 'OpenAI Images API 的 response_format，后端支持 url 时可减少超大 base64 响应',
                    bottomHelpMessage: '如果后端不支持 url，可能仍返回 b64_json 或报错；chat_completions 协议不使用此项',
                    component: 'Select',
                    componentProps: {
                        options: [
                            { label: 'url（推荐，后端需支持）', value: 'url' },
                            { label: 'b64_json', value: 'b64_json' }
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
                    field: 'Banana.debug_response_log',
                    label: '完整响应日志',
                    helpMessage: '调试时打印画图接口的完整响应内容',
                    bottomHelpMessage: '可能包含超大 base64 或流式 chunk，建议仅本地排查时临时开启',
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
                    field: 'Banana.retry_count',
                    label: '失败重试次数',
                    helpMessage: '单个生成任务失败后的自动重试次数',
                    bottomHelpMessage: '默认 3；每次重试会重新轮换可用 API Key。内容政策等明确不可重试错误会直接失败',
                    component: 'InputNumber',
                    componentProps: {
                        min: 0,
                        max: 10,
                        placeholder: '3'
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
                    label: '预设管理',
                    component: 'Divider'
                },
                {
                    field: 'Banana.presets',
                    label: '预设列表',
                    helpMessage: '配置预设关键字和提示词',
                    bottomHelpMessage: '每个预设包含: cmd(关键字), name(名称), desc(描述), prompt(提示词)。可用 {{nickname}}/{{qq}}/{{group_name}}/{{sender_nickname}} 等变量；命令后可跟手动昵称覆盖，如 #预设 昵称 或 #预设 name=昵称；可用 -p 追加要求',
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
                                    placeholder: '生成图片的提示词；可用 {{nickname}}、{{qq}}、{{group_name}} 等变量',
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
                },
                {
                    label: 'QQ 注册时间查询',
                    component: 'Divider'
                },
                {
                    field: 'qqConfig.registerTime.api_url',
                    label: '注册时间接口地址',
                    bottomHelpMessage: '默认使用 https://openapi.dwo.cc/api/qqxxcx',
                    component: 'Input',
                    componentProps: {
                        placeholder: 'https://openapi.dwo.cc/api/qqxxcx'
                    }
                },
                {
                    field: 'qqConfig.registerTime.ckey',
                    label: '注册时间查询 CKey',
                    bottomHelpMessage: '调用 openapi.dwo.cc 接口所需的 ckey',
                    component: 'InputPassword',
                    componentProps: {
                        placeholder: '请输入 ckey'
                    }
                },

                // ==================== Coze 指令检索配置 ====================
                {
                    label: 'Coze 指令检索',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    label: 'Coze API 配置',
                    component: 'Divider'
                },
                {
                    field: 'Coze.enable_command_search_api',
                    label: '启用 Coze 指令检索',
                    bottomHelpMessage: '开启后，chatgpt-plugin 注入的 cc 指令检索工具会优先通过 Coze 工作流进行查询。',
                    component: 'Switch'
                },
                {
                    field: 'Coze.base_url',
                    label: 'Coze API 地址',
                    bottomHelpMessage: '默认使用 https://api.coze.cn，如需国际区或代理可自行替换。',
                    component: 'Input',
                    componentProps: {
                        placeholder: 'https://api.coze.cn'
                    }
                },
                {
                    field: 'Coze.personal_access_token',
                    label: 'Personal Access Token',
                    bottomHelpMessage: '用于调用 Coze OpenAPI 的 PAT，建议使用最小必要权限。',
                    component: 'InputPassword',
                    componentProps: {
                        placeholder: 'pat_...'
                    }
                },
                {
                    field: 'Coze.workflow_id',
                    label: '工作流 ID',
                    bottomHelpMessage: '填写用于“查指令/推荐指令”的 Coze 工作流 ID。',
                    component: 'Input',
                    componentProps: {
                        placeholder: '748...'
                    }
                },
                {
                    field: 'Coze.default_top_k',
                    label: '默认返回条数',
                    bottomHelpMessage: '当上层工具未传 top_k 时，默认取前 N 条推荐命令。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 20
                    }
                },
                {
                    field: 'Coze.timeout_ms',
                    label: '请求超时',
                    helpMessage: '单位：毫秒',
                    bottomHelpMessage: '调用 Coze API 的超时时间，建议 10000-60000。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1000,
                        step: 1000
                    }
                },

                // ==================== 发言达标点赞 ====================
                {
                    label: '发言达标自动点赞',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    field: 'speakThumb.enable',
                    label: '启用发言达标点赞',
                    bottomHelpMessage: '仅白名单群内生效；用户当天发言达标后只尝试一次点赞。',
                    component: 'Switch'
                },
                {
                    field: 'speakThumb.whitelistGroups',
                    label: '白名单群号',
                    bottomHelpMessage: '仅这些群会触发；留空则不触发。',
                    component: 'GTags',
                    componentProps: {
                        placeholder: '输入群号后回车添加',
                        allowAdd: true,
                        allowDel: true
                    }
                },
                {
                    field: 'speakThumb.threshold',
                    label: '当天触发条数',
                    bottomHelpMessage: '用户当天在白名单群内累计发言达到该条数后尝试点赞一次。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 100000,
                        placeholder: '100'
                    }
                },
                {
                    field: 'speakThumb.likeTimes',
                    label: '点赞次数',
                    bottomHelpMessage: '每次资料卡点赞数量，实际上限取决于协议端；内部限制 1-20。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 1,
                        max: 20,
                        placeholder: '1'
                    }
                },
                {
                    field: 'speakThumb.feedbackMode',
                    label: '成功反馈方式',
                    bottomHelpMessage: '点赞成功后的反馈；失败和已点过始终静默。',
                    component: 'Select',
                    componentProps: {
                        options: [
                            { label: '静默', value: 'silent' },
                            { label: '文字提示并撤回', value: 'text' },
                            { label: '表情回应原消息', value: 'emoji_like' }
                        ]
                    }
                },
                {
                    field: 'speakThumb.emojiLikeId',
                    label: '表情回应 ID',
                    bottomHelpMessage: '成功反馈方式为“表情回应原消息”时使用；不同协议端支持的 ID 可能不同。',
                    component: 'Input',
                    componentProps: {
                        placeholder: '66'
                    }
                },
                {
                    field: 'speakThumb.successMessage',
                    label: '成功提示',
                    bottomHelpMessage: '支持 {{name}} / {{user_id}} / {{count}}；仅“文字提示并撤回”模式发送。',
                    component: 'Input',
                    componentProps: {
                        placeholder: '发言活跃达标，已给 {{name}} 点赞啦~'
                    }
                },
                {
                    field: 'speakThumb.successRecallSeconds',
                    label: '提示撤回秒数',
                    bottomHelpMessage: '仅文字提示模式生效；0 表示不撤回。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 0,
                        max: 120,
                        placeholder: '3'
                    }
                },
                {
                    field: 'speakThumb.skipBot',
                    label: '忽略机器人自身发言',
                    bottomHelpMessage: '开启后不统计机器人自己在群内的消息。',
                    component: 'Switch'
                },

                // ==================== 群友好感度 ====================
                {
                    label: '群友好感度',
                    component: 'SOFT_GROUP_BEGIN'
                },
                {
                    field: 'Favorability.enable',
                    label: '启用群友好感度',
                    bottomHelpMessage: '关闭后不再自动记录普通消息产生的好感度；查询命令仍可读取已有数据。',
                    component: 'Switch'
                },
                {
                    field: 'Favorability.whitelistGroups',
                    label: '白名单群号',
                    bottomHelpMessage: '仅这些群会自动记录普通消息好感度；留空则不自动记录任何群。',
                    component: 'GTags',
                    componentProps: {
                        placeholder: '输入群号后回车添加',
                        allowAdd: true,
                        allowDel: true
                    }
                },
                {
                    field: 'Favorability.flushIntervalSeconds',
                    label: '缓存落盘间隔',
                    helpMessage: '单位：秒',
                    bottomHelpMessage: '值越大 IO 越少，但异常退出时可能丢失最近一小段缓存数据；最小按 10 秒处理。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 10,
                        max: 3600,
                        step: 10,
                        placeholder: '60'
                    }
                },
                {
                    field: 'Favorability.dailyDecayEnabled',
                    label: '启用每日衰减',
                    bottomHelpMessage: '开启后每天维护任务会让正负好感度都向 0 靠近。',
                    component: 'Switch'
                },
                {
                    field: 'Favorability.dailyDecay',
                    label: '每日衰减值',
                    bottomHelpMessage: '正数会减少，负数会恢复；衰减到 0 后会删除该关系记录。',
                    component: 'InputNumber',
                    componentProps: {
                        min: 0,
                        max: 100,
                        step: 1,
                        placeholder: '1'
                    }
                }
            ],

            // 获取配置数据
            getConfigData() {
                const imgTag = lodash.cloneDeep(Config.getDefOrConfig('ImgTag'))
                const banana = lodash.cloneDeep(Config.getDefOrConfig('Banana'))
                banana.api_keys = normalizeBananaApiKeys(banana.api_keys)
                return {
                    ImgTag: imgTag,
                    Banana: banana,
                    qqConfig: Config.getDefOrConfig('qqConfig'),
                    Coze: Config.getDefOrConfig('Coze'),
                    speakThumb: Config.getDefOrConfig('speakThumb'),
                    Favorability: Config.getDefOrConfig('Favorability')
                }
            },

            // 设置配置数据
            setConfigData(data, { Result }) {
                for (let [keyPath, value] of Object.entries(data)) {
                    // keyPath 格式: ImgTag.api_url 或 qqConfig.ai.type 或 Banana.api_url
                    const parts = keyPath.split('.')
                    const configName = parts[0]  // ImgTag 或 qqConfig 或 Banana
                    const fieldPath = parts.slice(1).join('.')  // api_url 或 ai.type

                    if (configName === 'ImgTag' || configName === 'qqConfig' || configName === 'Banana' || configName === 'Coze' || configName === 'speakThumb' || configName === 'Favorability') {
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
                        } else if (configName === 'Banana' && fieldPath === 'api_keys') {
                            mergeBananaApiKeys(value)
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
