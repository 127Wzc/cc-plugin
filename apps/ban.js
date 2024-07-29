import { segment } from 'oicq'
import plugin from '../../../lib/plugins/plugin.js'

const banNum = 4; //几次刷屏后禁言 大于等于5  若消息发送太快，次数会有偏差
const muteTime = 1; //禁言时间：分钟
const checkTime = 1;//检测时间：分钟
/* 
  @作者：柒 3456953749
  改的v2乐神的代码
  如果需要的话，可以联系作者进一步增强
 */

export class exampleBan extends plugin {
    constructor() {
        super({
            /** 功能名称 */
            name: '刷屏禁言',
            /** 功能描述 */
            dsc: '刷屏禁言',
            /** https://oicqjs.github.io/oicq/#eveAnts */
            event: 'message.group',
            /** 优先级，数字越小等级越高 */
            priority: 1,
            rule: [
                {
                    /** 命令正则匹配 */
                    reg: '',
                    /** 执行方法 */
                    fnc: 'ban'
                }
            ]
        })
    }

    async ban(e) {
        let key = `Yunzai:ban:${e.group_id}`;
        let res = await global.redis.get(key);
        //过滤消息内容
        let newMsg = e.message
            .map(item => {

                let returnMsg
                //其他类型消息待定
                if(item.type == 'text')
                    returnMsg = item.text
                else if(item.type == 'image')
                    returnMsg = item.name
                else
                    returnMsg = item.name ? item.name : '';
                return item.type.concat("-").concat(returnMsg)
            }).join(':').trim();
        if (!res) {
            res = { banID: e.user_id, msgNum: 1, msg: newMsg };
            await global.redis.set(key, JSON.stringify(res), {
                EX: 3600 * checkTime,
            });
            return true;
        } else {
            res = JSON.parse(res);
        }
        logger.debug(`禁言:res=${res.msg}`);
        logger.debug(`禁言:newMsg=${newMsg}`);
        if (newMsg == res.msg && res.banID === e.user_id) {
            res.msgNum++;
        } else {
            res.banID = e.user_id;
            res.msg = newMsg;
            res.msgNum = 1;
        }
        logger.debug(`当前群(${e.group_id})用户(${res.banID})已刷屏${res.msgNum}次`)


        if ((res.msgNum) > banNum && newMsg == res.msg) {
            await e.group.muteMember(e.user_id, 60 * muteTime)
            await this.reply([segment.at(e.user_id),` 因刷屏被禁言${muteTime}分钟`])
            //禁言后清楚缓存
            await global.redis.del(key);
            return true;
        }
        await global.redis.set(key, JSON.stringify(res), {
            EX: 3600 * checkTime,
        });
        return false;
    }
}