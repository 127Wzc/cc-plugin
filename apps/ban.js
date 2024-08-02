import { segment } from 'oicq'
import plugin from '../../../lib/plugins/plugin.js'
import cfg from "../../../lib/config/config.js"

const banNum = 2; //几次刷屏后禁言 大于等于3  若消息发送太快，次数会有偏差
const muteTime = 1; //禁言时间：分钟
const checkTime = 30;//检测时间：秒


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

        
        //过滤主人 过滤机器人
        if(cfg.masterQQ.includes(e.user_id))
            return false;
        //按号码段过滤群机器人
        else if((e.at>2854000000 && e.at<2855000000))
            return false;
        else if((e.at>3889000000 && e.at<3890000000))
            return false;

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
                else if(item.type == 'mface')
                    returnMsg = item.emoji_id
                else
                    returnMsg = item.name ? item.name : '';
                return item.type.concat("-").concat(returnMsg)
            }).join(':').trim();
        if (!res) {
            res = { banID: e.user_id, msgNum: 1, msg: newMsg };
            await global.redis.set(key, JSON.stringify(res), {
                EX: checkTime,
            });
            return false;
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


        if ((res.msgNum) > banNum) {
            await e.group.muteMember(e.user_id, 60 * muteTime)
            await this.reply([segment.at(e.user_id),` 因刷屏被禁言${muteTime}分钟`])
            //禁言后清除缓存
            await global.redis.del(key);
            return true;
        }
        await global.redis.set(key, JSON.stringify(res), {
            EX: checkTime,
        });
        return false;
    }
}