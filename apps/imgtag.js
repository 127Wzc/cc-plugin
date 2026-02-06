import ImgTagService from '../model/ImgTagService.js'
import common from '../../../lib/common/common.js'

// 存储待回调的任务 {taskId: {md5, resolve, userId, groupId, botId, sourceMessageId}}
const pendingCallbacks = new Map()

function needKeyTip() {
    return (
        `🔑 需要先配置你的 ImgTag 个人 api_key 才能使用该功能\n` +
        `- 自己设置：#cc图库设置key <api_key>\n` +
        `- 或让管理员在 Guoba 面板为你分配（ImgTag.user_keys）`
    )
}

// 标记路由是否已注册
let callbackRouteRegistered = false

/**
 * 注册 ImgTag 回调接口到 Yunzai Express 服务器
 * 路由: POST /imgtag/callback
 */
function registerCallbackRoute() {
    if (callbackRouteRegistered) {
        logger.debug('[ImgTag] 回调路由已注册，跳过')
        return
    }

    if (typeof Bot?.express?.use !== 'function') {
        logger.warn('[ImgTag] Bot.express 不可用，回调接口注册失败')
        return
    }

    // 跳过鉴权
    if (!Bot.express.skip_auth.includes('/imgtag')) {
        Bot.express.skip_auth.push('/imgtag')
    }

    // 注册回调路由 (使用 use 中间件确保匹配)
    Bot.express.use('/imgtag/callback', async (req, res, next) => {
        // 只处理 POST 请求
        if (req.method !== 'POST') {
            return next()
        }

        try {
            const data = req.body
            logger.mark(`[ImgTag] 收到回调: image_id=${data.image_id}, success=${data.success}`)

            // 查找待处理的回调任务
            const taskInfo = pendingCallbacks.get(String(data.image_id))
            logger.info(`[ImgTag] 查找任务: image_id=${data.image_id}, 找到=${!!taskInfo}, 队列大小=${pendingCallbacks.size}`)

            if (data.success) {
                // 更新本地索引
                if (taskInfo?.md5) {
                    ImgTagService.updateIndex(taskInfo.md5, {
                        synced: true,
                        remote_id: data.image_id,
                        remote_url: data.image_url,
                        tags: data.tags,
                        description: data.description
                    })
                    logger.info(`[ImgTag] 已更新本地索引: md5=${taskInfo.md5}`)
                }

                // 如果有关联的用户，发送通知
                if (taskInfo?.userId && taskInfo?.botId) {
                    const tagStr = data.tags?.slice(0, 8).join(' · ') || '无'

                    // 分析结果文字
                    const resultText = `🤖 AI 分析完成\n` +
                        `🏷️ ${tagStr}\n` +
                        `📝 ${data.description || ''}`

                    logger.info(`[ImgTag] 发送通知: userId=${taskInfo.userId}, groupId=${taskInfo.groupId}, botId=${taskInfo.botId}, sourceMessageId=${taskInfo.sourceMessageId}`)

                    try {
                        // 构建消息
                        let msgParts = []

                        // 如果有原图消息 ID，使用引用回复原消息，不再发图片
                        if (taskInfo.sourceMessageId) {
                            msgParts = [segment.reply(taskInfo.sourceMessageId), resultText]
                        } else {
                            // 没有引用消息，发送图片 + 分析结果
                            let imagePath = null
                            if (taskInfo.md5) {
                                imagePath = ImgTagService.findLocalPath(taskInfo.md5)
                            }
                            if (imagePath) {
                                msgParts.push(segment.image(`file://${imagePath}`))
                            } else if (data.image_url) {
                                msgParts.push(segment.image(data.image_url))
                            }
                            msgParts.push(`\n${resultText}`)
                        }

                        if (taskInfo.groupId) {
                            await Bot.sendGroupMsg(taskInfo.botId, taskInfo.groupId, msgParts)
                            logger.info(`[ImgTag] 已发送群消息到 ${taskInfo.groupId}`)
                        } else {
                            await Bot.sendFriendMsg(taskInfo.botId, taskInfo.userId, msgParts)
                            logger.info(`[ImgTag] 已发送好友消息到 ${taskInfo.userId}`)
                        }
                    } catch (e) {
                        logger.error(`[ImgTag] 发送回调通知失败: ${e}`)
                    }
                } else {
                    logger.warn(`[ImgTag] 任务信息不完整: ${JSON.stringify(taskInfo)}`)
                }
            } else {
                logger.error(`[ImgTag] AI分析失败: ${data.error}`)
            }

            // 清理任务
            if (taskInfo) {
                pendingCallbacks.delete(String(data.image_id))
            }

            res.json({ success: true })
        } catch (err) {
            logger.error(`[ImgTag] 回调处理失败: ${err}`)
            res.status(500).json({ success: false, error: err.message })
        }
    })

    callbackRouteRegistered = true
    logger.mark('[ImgTag] 回调接口已注册: POST /imgtag/callback')
}

/**
 * 从消息项中提取图片信息和图片外显 summary
 * @param {Array} messages 消息数组
 * @param {Array} disabledSummary 禁用的外显关键词列表
 * @returns {Array} [{url, mfaceSummary}]
 */
function extractImagesFromMessages(messages, disabledSummary = []) {
    const imgData = []
    if (!messages) return imgData

    for (const item of messages) {
        if (item.type === 'image' || item.type === 'mface') {
            let summary = ''
            if (item.summary) {
                // 去除方括号后检查长度，超过4个字符视为异常不使用
                const cleanSummary = item.summary.replace(/[\[\]【】]/g, '').trim()

                // 检查是否在禁用列表中
                const isDisabled = disabledSummary.some(keyword => cleanSummary === keyword)

                if (isDisabled) {
                    logger.debug(`[ImgTag] 外显禁用关键字已忽略: ${cleanSummary}`)
                } else if (cleanSummary.length <= 4) {
                    summary = item.summary
                    logger.mark(`[ImgTag] 检测到图片外显: ${summary} (长度: ${cleanSummary.length})`)
                } else {
                    logger.debug(`[ImgTag] summary 过长跳过: ${item.summary} (长度: ${cleanSummary.length})`)
                }
            }
            imgData.push({ url: item.url, mfaceSummary: summary })
        }
    }
    return imgData
}

/**
 * ImgTag 智能图床插件
 * 支持偷图、搜图、随机发图等功能
 */
export class ImgTag extends plugin {
    constructor() {
        super({
            name: '[cc-plugin] ImgTag 智能图床',
            dsc: '对接 ImgTag API 的图片收藏与发送插件',
            event: 'message',
            priority: 100,
            rule: [
                {
                    reg: '^#?cc图库设置key\\s+(.+)$',
                    fnc: 'setUserKey'
                },
                {
                    reg: '^#?cc图库删除key$',
                    fnc: 'deleteUserKey'
                },
                {
                    reg: '^#?cc图库我的状态$',
                    fnc: 'myStatus'
                },
                {
                    reg: '^#?(cc)?(偷图|存图)(.*)$',
                    fnc: 'stealImage'
                },
                {
                    reg: '^#?cc搜图(.*)$',
                    fnc: 'searchImage'
                },
                {
                    reg: '^#?cc(随机图|来张)(.*)$',
                    fnc: 'randomImage'
                },
                {
                    reg: '^#?cc图库状态$',
                    fnc: 'showStats'
                }
            ]
        })
        // 路由已在模块顶层注册，无需在构造函数中重复调用
    }

    async setUserKey(e) {
        const key = (e.msg.match(/^#?cc图库设置key\s+(.+)$/)?.[1] || '').trim()
        if (!key) {
            await e.reply('❌ 请提供 api_key\n用法：#cc图库设置key <api_key>', true)
            return true
        }

        try {
            ImgTagService.setUserApiKey(e.user_id, key)
            const allowed = ImgTagService.isAllowedUser(e.user_id)
            const hint = allowed ? '✅ 已授权，可直接使用 ImgTag 指令。' : '⚠️ 当前尚未授权，联系管理员开通后生效。'
            await e.reply(`✅ 已保存你的个人 api_key（不会回显明文）\n${hint}`, true)
        } catch (err) {
            await e.reply(`❌ 保存失败: ${err.message}`, true)
        }
        return true
    }

    async deleteUserKey(e) {
        try {
            ImgTagService.deleteUserApiKey(e.user_id)
            await e.reply('✅ 已删除你的个人 api_key', true)
        } catch (err) {
            await e.reply(`❌ 操作失败: ${err.message}`, true)
        }
        return true
    }

    async myStatus(e) {
        const allowed = ImgTagService.isAllowedUser(e.user_id)
        const src = ImgTagService.getKeySource(e.user_id)
        const srcText =
            src === 'guoba'
                ? 'Guoba分配'
                : src === 'self'
                    ? '自助配置'
                    : src === 'global'
                        ? '全局key(主人)'
                        : '未配置'
        const hasKey = !!ImgTagService.getApiKeyForUser(e.user_id)

        let msg = `📌 ImgTag 个人状态\n`
        msg += `- 授权: ${allowed ? '✅ 已授权' : '❌ 未授权'}\n`
        msg += `- api_key: ${hasKey ? '✅ 已配置' : '❌ 未配置'}（${srcText}）`
        if (!hasKey) {
            msg += `\n\n${needKeyTip()}`
        }
        await e.reply(msg, true)
        return true
    }

    /**
     * 偷图 - 保存引用消息中的图片
     * 指令: #偷图 [标签1] [标签2] ...
     */
    async stealImage(e) {
        // 未授权：无感不响应（并吞掉指令，避免被其它插件误触发）
        if (!ImgTagService.isAllowedUser(e.user_id)) return true

        // 获取图片数据列表 [{url, mfaceSummary}]
        let imgData = []

        // 获取禁用外显关键词列表
        const config = ImgTagService.config
        const disabledSummary = config.disabled_summary || []

        // 从当前消息获取图片（直接发送的图片没有 summary）
        if (e.img && e.img.length > 0) {
            imgData = e.img.map(url => ({ url, mfaceSummary: '' }))
        }
        // 从引用消息获取图片
        else if (e.source) {
            // 优先使用 e.source 方式获取（可以获取更多信息如 summary）
            try {
                let sourceMsg
                if (e.isGroup) {
                    sourceMsg = (await e.group.getChatHistory(e.source.seq, 1)).pop()
                } else {
                    sourceMsg = (await e.friend.getChatHistory(e.source.time, 1)).pop()
                }
                logger.debug(`[ImgTag] e.source 获取结果: ${JSON.stringify(sourceMsg?.message?.map(m => ({ type: m.type, summary: m.summary })))}`)
                imgData = extractImagesFromMessages(sourceMsg?.message, disabledSummary)
            } catch (err) {
                logger.debug(`[ImgTag] 通过 e.source 获取失败: ${err.message}`)
            }
        }
        // 兼容 e.getReply 方式
        if (imgData.length === 0 && e.getReply) {
            try {
                const replyData = await e.getReply()
                logger.debug(`[ImgTag] e.getReply 获取结果: ${JSON.stringify(replyData?.message?.map(m => ({ type: m.type, summary: m.summary })))}`)
                imgData = extractImagesFromMessages(replyData?.message, disabledSummary)
            } catch (err) {
                logger.debug(`[ImgTag] 获取引用消息: ${err.message || '无引用消息'}`)
            }
        }

        if (imgData.length === 0) {
            e.reply('❌ 请回复一张图片或直接发送图片', true)
            return true
        }

        // 解析标签 - 支持 #偷图#tag1,tag2,tag3 或 #偷图 tag1 tag2 格式
        // 先提取 # 后面的标签部分
        let tagPart = e.msg.replace(/^#?(cc)?(偷图|存图)/, '').trim()

        // 如果以 # 开头，表示使用 #tag1,tag2 格式
        if (tagPart.startsWith('#')) {
            tagPart = tagPart.substring(1) // 移除开头的 #
        }

        // 支持逗号、空格、中文逗号作为分隔符
        const baseTags = tagPart ? tagPart.split(/[,，\s]+/).filter(t => t.trim()).map(t => t.trim()) : []

        // 处理每张图片
        const results = []
        const callbackUrl = config.callback_url || ''

        for (const imgInfo of imgData) {
            try {
                // 合并标签：用户标签 + mface summary（如果有）
                let imageTags = [...baseTags]
                if (imgInfo.mfaceSummary) {
                    // 将 mface summary 作为标签添加（去除可能的方括号等特殊字符）
                    const summaryTag = imgInfo.mfaceSummary.replace(/[\[\]【】]/g, '').trim()
                    if (summaryTag && !imageTags.includes(summaryTag)) {
                        imageTags.push(summaryTag)
                        logger.mark(`[ImgTag] 检测到图片外显: ${summaryTag}`)
                    }
                }

                // 1. 保存到本地
                const localResult = await ImgTagService.saveLocal(imgInfo.url)
                const shortMd5 = localResult.md5.substring(0, 8)

                // 2. 上传到云端 (如果启用)
                let cloudResult = null
                if (config.auto_sync && config.api_url) {
                    try {
                        if (!ImgTagService.getApiKeyForUser(e.user_id)) {
                            throw new Error('未配置个人 api_key')
                        }

                        cloudResult = await ImgTagService.addImageForUser(e.user_id, imgInfo.url, imageTags, '', callbackUrl)
                        // 更新本地索引
                        ImgTagService.updateIndex(localResult.md5, {
                            synced: true,
                            remote_id: cloudResult.id,
                            remote_url: cloudResult.image_url
                        })

                        // 如果配置了回调且启用了 AI 分析，注册待处理任务
                        if (callbackUrl && config.auto_analyze && cloudResult.id) {
                            pendingCallbacks.set(String(cloudResult.id), {
                                md5: localResult.md5,
                                userId: e.user_id,
                                groupId: e.group_id,
                                botId: e.self_id,
                                // 保存原图消息 ID，用于回调时引用回复
                                sourceMessageId: e.reply_id || null
                            })
                            logger.info(`[ImgTag] 注册回调任务: image_id=${cloudResult.id}, sourceMessageId=${e.reply_id || 'null'}`)
                        }
                    } catch (apiErr) {
                        logger.error(`[ImgTag] 云端上传失败: ${apiErr}`)
                    }
                }

                results.push({
                    md5: shortMd5,
                    isNew: localResult.isNew,
                    synced: !!cloudResult,
                    tags: cloudResult?.tags || imageTags,
                    // 保存图片外显名称用于回复展示
                    mfaceName: imgInfo.mfaceSummary ? imgInfo.mfaceSummary.replace(/[\[\]【】]/g, '').trim() : ''
                })

            } catch (err) {
                logger.error(`[ImgTag] 保存图片失败: ${err}`)
                results.push({ error: err.message })
            }
        }

        // 构建回复消息
        const successCount = results.filter(r => !r.error).length
        const newCount = results.filter(r => r.isNew).length
        const syncedCount = results.filter(r => r.synced).length

        let replyMsg = `✅ 处理完成: ${successCount}/${imgData.length} 成功`
        if (newCount > 0) {
            replyMsg += `\n📥 新增: ${newCount} 张`
        }
        if (syncedCount > 0) {
            replyMsg += `\n☁️ 已同步云端: ${syncedCount} 张`
        }
        if (baseTags.length > 0) {
            replyMsg += `\n🏷️ 标签: ${baseTags.join(', ')}`
        }
        if (config.auto_sync && syncedCount === 0) {
            replyMsg += `\n☁️ 云端同步: 已跳过（未配置个人 key 或上传失败）`
        }
        if (config.auto_sync && !ImgTagService.getApiKeyForUser(e.user_id)) {
            replyMsg += `\n${needKeyTip()}`
        }

        // 显示图片外显信息（如果有）
        const mfaceNames = results.filter(r => r.mfaceName).map(r => r.mfaceName)
        if (mfaceNames.length > 0) {
            replyMsg += `\n🎭 图片外显: ${mfaceNames.join(', ')}`
        }

        // 显示 MD5 列表 (最多5个)
        const md5List = results.filter(r => r.md5).slice(0, 5).map(r => r.md5)
        if (md5List.length > 0) {
            replyMsg += `\n🔑 ID: ${md5List.join(', ')}`
            if (results.length > 5) {
                replyMsg += ` 等${results.length}张`
            }
        }

        // 发送成功消息，10秒后自动撤回
        e.reply(replyMsg, true, { recallMsg: 10 })
        return true
    }

    /**
     * 搜图 - 搜索图库
     * 指令: #搜图 [关键词/标签]
     */
    async searchImage(e) {
        const keyword = e.msg.replace(/^#?cc搜图/, '').trim()

        // 检查配置
        const config = ImgTagService.config
        if (!config.api_url) {
            e.reply('❌ 请先配置 ImgTag API 地址', true)
            return true
        }

        try {
            // 尝试解析为标签列表或关键词
            const tags = keyword.includes(' ') ? keyword.split(/\s+/) : []
            const searchKeyword = tags.length > 0 ? '' : keyword

            const result = await ImgTagService.searchImagesPublic(searchKeyword, tags, 10)

            if (!result.images || result.images.length === 0) {
                e.reply('🔍 未找到匹配的图片', true)
                return true
            }

            // 构建转发消息
            const messages = []
            for (const img of result.images.slice(0, 10)) {
                const imagePath = ImgTagService.getImagePath(img)
                if (imagePath) {
                    const tagStr = img.tags ? img.tags.join(', ') : ''
                    messages.push([
                        `ID: ${img.id}`,
                        tagStr ? `\n标签: ${tagStr}` : '',
                        segment.image(imagePath)
                    ])
                }
            }

            if (messages.length > 1) {
                e.reply(await common.makeForwardMsg(e, messages, `🔍 搜索结果 (${result.total})`))
            } else if (messages.length === 1) {
                e.reply(messages[0])
            }

        } catch (err) {
            logger.error(`[ImgTag] 搜索失败: ${err}`)
            e.reply(`❌ 搜索失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 随机图 - 随机发送图片
     * 指令: #随机图 [标签...] 或 #来张 [标签]
     */
    async randomImage(e) {
        // 解析标签
        let tagStr = e.msg.replace(/^#?cc(随机图|来张)/, '').trim()
        const tags = tagStr ? tagStr.split(/\s+/).filter(t => t) : []

        // 检查配置
        const config = ImgTagService.config
        if (!config.api_url) {
            e.reply('❌ 请先配置 ImgTag API 地址', true)
            return true
        }

        try {
            const result = await ImgTagService.getRandomImagesPublic(tags, 1)

            if (!result.images || result.images.length === 0) {
                e.reply('🎲 没有找到图片' + (tags.length > 0 ? `（标签: ${tags.join(', ')}）` : ''), true)
                return true
            }

            const img = result.images[0]
            const imagePath = ImgTagService.getImagePath(img)

            if (!imagePath) {
                e.reply('❌ 无法获取图片', true)
                return true
            }

            // 构建回复
            const replyParts = []
            if (img.tags && img.tags.length > 0) {
                replyParts.push(`🏷️ ${img.tags.slice(0, 5).join(' · ')}`)
            }
            replyParts.push(segment.image(imagePath))

            e.reply(replyParts)

        } catch (err) {
            logger.error(`[ImgTag] 随机图失败: ${err}`)
            e.reply(`❌ 获取失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 图库状态 - 显示统计信息
     * 指令: #图库状态
     */
    async showStats(e) {
        try {
            const localStats = ImgTagService.getStats()
            const config = ImgTagService.config

            // 尝试获取云端统计
            let cloudStats = null
            if (config.api_url) {
                try {
                    cloudStats = await ImgTagService.getDashboard()
                } catch (err) {
                    logger.warn(`[ImgTag] 获取云端统计失败: ${err.message}`)
                }
            }

            // 构建美化输出
            let msg = `📊 ImgTag 图库状态\n`
            msg += `━━━━━━━━━━━━━━━━\n`

            // 云端统计
            if (cloudStats) {
                const { images, today, queue } = cloudStats
                msg += `☁️ 云端图库\n`
                msg += `   📷 总计: ${images.total} 张\n`
                msg += `   ✅ 已分析: ${images.analyzed} 张\n`
                msg += `   ⏳ 待分析: ${images.pending} 张\n`
                msg += `\n`
                msg += `📅 今日动态\n`
                msg += `   📤 上传: ${today.uploaded} 张\n`
                msg += `   🤖 分析: ${today.analyzed} 张\n`
                msg += `\n`
                msg += `⚙️ 任务队列\n`
                msg += `   📋 总任务: ${queue.total}\n`
                msg += `   🔄 处理中: ${queue.processing}\n`
                msg += `   ${queue.running ? '🟢 运行中' : '🔴 已停止'}\n`
            } else {
                msg += `☁️ 云端: 未连接\n`
            }

            msg += `━━━━━━━━━━━━━━━━\n`
            msg += `📁 本地缓存\n`
            msg += `   💾 总计: ${localStats.total} 张\n`
            msg += `   ☁️ 已同步: ${localStats.synced} 张\n`
            msg += `   ⏳ 待同步: ${localStats.unsynced} 张`

            e.reply(msg, true)

        } catch (err) {
            logger.error(`[ImgTag] 获取状态失败: ${err}`)
            e.reply(`❌ 获取状态失败: ${err.message}`, true)
        }

        return true
    }
}

// 模块加载时注册回调路由（只执行一次）
registerCallbackRoute()
