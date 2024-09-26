import fs from "fs";
import path from 'path';
import common from'../../../lib/common/common.js'
const _path=process.cwd()
//在这里设置事件概率,请保证概率加起来小于1，少于1的部分会触发反击
let reply_text = 0.2//文字回复概率
let reply_img = 0.3//在线图片回复概率
let reply_file = 0.2 //离线图片回复改了
let reply_voice = 0.2//语音回复概率
let mutepick = 0.1 //禁言概率
let example = 0.0 //拍一拍表情概率
//剩下的0.08概率就是反击

//定义图片存放路径 默认是Yunzai-Bot/resources/chuochuo
const chuo_path='/resources/logier/emoji';

//回复文字列表
let word_list=[]


let voice_list = [`http://api.yujn.cn/api/duiren.php?`,
    `http://api.yujn.cn/api/yujie.php?`,
    `http://api.yujn.cn/api/lvcha.php?`,
    `http://api.yujn.cn/api/maren.php?`]


let memelist = {
    一二布布: 'bubu',
    废柴: 'cheems',
    小恐龙: 'xiaokonglong',
    哆啦A梦: 'ameng',
    哆啦a梦: 'ameng',
    A梦: 'ameng',
    a梦: 'ameng',
    阿蒙: 'ameng',
    狐狐: 'fox',
    随机狐狐: 'fox',
    狐狸: 'fox',
    kabo: 'kabo',
    咖波: 'kabo',
    kapo: 'kabo',
    猫虫: 'kabo',
    库洛米: 'kuluomi',
    kuluomi: 'kuluomi',
    龙图: 'longtu',
    随机龙图: 'longtu',
    蘑菇头: 'mogutou',
    随机蘑菇头: 'mogutou',
    派大星: 'paidaxing',
    随机派大星: 'paidaxing',
    熊猫头: 'panda',
    随机熊猫头: 'panda',
    小黄鸡: 'xiaohuangji',
    随机小黄鸡: 'xiaohuangji',
    小灰灰: 'xiaohuihui',
    随机小灰灰: 'xiaohuihui',
    小豆泥: 'xiaodouni',
    疾旋鼬: 'jixuanyou',
    兄弟兄弟: 'jixuanyou',
    兄弟你好香: 'jixuanyou'
  
  }
export class chuo extends plugin{
    constructor(){
    super({
        name: 'ex-自定义戳一戳',
        dsc: '戳一戳机器人触发效果',
        event: 'notice.group.poke',
        priority: 4000,
        rule: [
            {
                /** 命令正则匹配 */
                fnc: 'chuoyichuo'
                }
            ]
        }
    )
}



async chuoyichuo (e){

    if (e.target_id == e.self_id) {
        //生成0-100的随机数
        let random_type = Math.random()
        
        if(random_type < reply_text){
            //回复随机文字
            let text_number = Math.ceil(Math.random() * word_list['length'])
            await e.reply(word_list[text_number-1])
        } else if(random_type < (reply_text + reply_img)){
            //回复随机图片
            const keys = Object.keys(memelist)  
            let randomIndex  = Math.ceil(Math.random() *keys.length-1)
            logger.info('key='+keys[randomIndex])
            
            await e.reply(segment.image(`http://hanhan.avocado.wiki/?${memelist[keys[randomIndex]]}`))
 
        } else if(random_type < (reply_text + reply_img + reply_file)){
            //回复随机本体图片
            //读取文件夹里面的所有图片文件名
            let photo_list = fs.readdirSync(path.join(_path, chuo_path))
            //随机选择一个文件名
            let photo_number = Math.floor(Math.random() * photo_list.length)
            
            await e.reply(segment.image('file://' + path.join(_path,chuo_path,photo_list[photo_number])))
        } else if(random_type < (reply_text + reply_img + reply_file + reply_voice)){
            //回复随机语音
            let voice_number = Math.floor(Math.random() * voice_list.length)
            
            await e.reply(segment.record(voice_list[voice_number]))
        } else if(random_type < (reply_text + reply_img + reply_file + reply_voice + mutepick)){
            //禁言
            //两种禁言方式，随机选一种
            let mutetype = Math.ceil(Math.random() * 2)
            if(mutetype == 1){
                e.reply('说了不要戳了！')
                await common.sleep(1000)
                await e.group.muteMember(e.operator_id,60);
                await common.sleep(3000)
                e.reply('啧')
                //有这个路径的图话可以加上
                //await e.reply(segment.image('file:///' + path + '/resources/chuochuo/'+'img4.jpg'))
            }
            else if (mutetype == 2){
                e.reply('不！！')
                await common.sleep(500);
                e.reply('准！！')
                await common.sleep(500);
                e.reply('戳！！')
                await common.sleep(500);
                e.reply('玉！！')
                await common.sleep(500);
                e.reply('玉！！')
                await common.sleep(500);
                await e.group.muteMember(e.operator_id,60)
            }
        } else {
            e.reply('吃玉玉一咬!~')
            await common.sleep(500)
            await e.group.pokeMember(e.operator_id)
        }
    }
    
}
    
}
