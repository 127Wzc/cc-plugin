import ImgTagService from '../model/ImgTagService.js'
import Config from '../components/Cfg.js'
import common from '../../../lib/common/common.js'

// 存储待回调的任务 {taskId: {md5, resolve, userId, groupId, botId}}
const pendingCallbacks = new Map()

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

                // 如果有关联的用户，发送通知（图片 + 分析结果）
                if (taskInfo?.userId && taskInfo?.botId) {
                    const tagStr = data.tags?.slice(0, 8).join(' · ') || '无'

                    // 构建消息：图片 + 分析结果
                    const msgParts = []

                    // 优先使用本地图片
                    let imagePath = null
                    if (taskInfo.md5) {
                        imagePath = ImgTagService.findLocalPath(taskInfo.md5)
                    }
                    if (imagePath) {
                        msgParts.push(segment.image(`file://${imagePath}`))
                    } else if (data.image_url) {
                        msgParts.push(segment.image(data.image_url))
                    }

                    // 添加分析结果文字
                    msgParts.push(`\n🤖 AI 分析完成\n` +
                        `🏷️ ${tagStr}\n` +
                        `📝 ${data.description || ''}`)

                    logger.info(`[ImgTag] 发送通知: userId=${taskInfo.userId}, groupId=${taskInfo.groupId}, botId=${taskInfo.botId}`)

                    try {
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

        // 在插件加载时注册回调路由
        registerCallbackRoute()
    }

    /**
     * 偷图 - 保存引用消息中的图片
     * 指令: #偷图 [标签1] [标签2] ...
     */
    async stealImage(e) {
        // 权限检查: 仅主人可用
        if (!Config.masterQQ.includes(e.user_id)) {
            return false
        }

        // 获取图片 URL 列表
        let imageUrls = []

        // 从当前消息获取图片
        if (e.img && e.img.length > 0) {
            imageUrls = e.img
        }
        // 从引用消息获取图片（参考 SavePic.js 写法）
        else {
            try {
                const replyData = await e.getReply()
                if (replyData?.message) {
                    for (const item of replyData.message) {
                        if (item.type === 'image' || item.type === 'mface') {
                            imageUrls.push(item.url)
                        }
                    }
                }
            } catch (err) {
                // 无引用消息时忽略错误
                logger.debug(`[ImgTag] 获取引用消息: ${err.message || '无引用消息'}`)
            }
        }

        if (imageUrls.length === 0) {
            e.reply('❌ 请回复一张图片或直接发送图片', true)
            return true
        }

        // 解析标签
        const msgContent = e.msg.replace(/^#?(偷图|存图)/, '').trim()
        const tags = msgContent ? msgContent.split(/\s+/).filter(t => t) : []

        // 处理每张图片
        const results = []
        const config = ImgTagService.config
        const callbackUrl = config.callback_url || ''

        for (const url of imageUrls) {
            try {
                // 1. 保存到本地
                const localResult = await ImgTagService.saveLocal(url)
                const shortMd5 = localResult.md5.substring(0, 8)

                // 2. 上传到云端 (如果启用)
                let cloudResult = null
                if (config.auto_sync && config.api_url && config.api_key) {
                    try {
                        cloudResult = await ImgTagService.addImage(url, tags, '', callbackUrl)
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
                                botId: e.self_id
                            })
                            logger.info(`[ImgTag] 注册回调任务: image_id=${cloudResult.id}`)
                        }
                    } catch (apiErr) {
                        logger.error(`[ImgTag] 云端上传失败: ${apiErr}`)
                    }
                }

                results.push({
                    md5: shortMd5,
                    isNew: localResult.isNew,
                    synced: !!cloudResult,
                    tags: cloudResult?.tags || tags
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

        let replyMsg = `✅ 处理完成: ${successCount}/${imageUrls.length} 成功`
        if (newCount > 0) {
            replyMsg += `\n📥 新增: ${newCount} 张`
        }
        if (syncedCount > 0) {
            replyMsg += `\n☁️ 已同步云端: ${syncedCount} 张`
        }
        if (tags.length > 0) {
            replyMsg += `\n🏷️ 标签: ${tags.join(', ')}`
        }

        // 显示 MD5 列表 (最多5个)
        const md5List = results.filter(r => r.md5).slice(0, 5).map(r => r.md5)
        if (md5List.length > 0) {
            replyMsg += `\n🔑 ID: ${md5List.join(', ')}`
            if (results.length > 5) {
                replyMsg += ` 等${results.length}张`
            }
        }

        e.reply(replyMsg, true)
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
        if (!config.api_url || !config.api_key) {
            e.reply('❌ 请先配置 ImgTag API 地址和密钥', true)
            return true
        }

        try {
            // 尝试解析为标签列表或关键词
            const tags = keyword.includes(' ') ? keyword.split(/\s+/) : []
            const searchKeyword = tags.length > 0 ? '' : keyword

            const result = await ImgTagService.searchImages(searchKeyword, tags, 10)

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
        if (!config.api_url || !config.api_key) {
            e.reply('❌ 请先配置 ImgTag API 地址和密钥', true)
            return true
        }

        try {
            const result = await ImgTagService.getRandomImages(tags, 1)

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
