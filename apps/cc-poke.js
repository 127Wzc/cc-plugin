import Config from "../components/Cfg.js";
import fs from "fs";
import path from "path";
import common from "../../../lib/common/common.js";
import Ai from "../model/Ai.js";
import { getPokeDataByKey } from "../model/PokeCommon.js";
import ImgTagService from "../model/ImgTagService.js";

const _path = process.cwd();
//在这里设置事件概率,请保证概率加起来小于1，少于1的部分会触发反击
let reply_text = 0.4; //文字回复概率
let reply_img = 0.1; //在线图片回复概率
let reply_file = 0.2; //离线图片回复改了
let reply_voice = 0.1; //语音回复概率
let mutepick = 0.1; //禁言概率
let example = 0.1; //拍一拍表情概率
//剩下的0.08概率就是反击



// //图片需要从1开始用数字命名并且保存为jpg或者gif格式，存在Yunzai-Bot/resources/chuochuo/目录下
// let jpg_number = 17 //输入jpg图片数量
// let gif_number = 12 //输入gif图片数量

//回复语音列表 默认是芭芭拉的语音 可以复制到网址里面去改，然后再复制回来
//语音合成来源：https://github.com/w4123/vits
//接口格式参考：http://233366.proxy.nscc-gz.cn:8888/?text=你好&speaker=派蒙
//原列表语音：
//你戳谁呢！你戳谁呢！！！
//不要再戳了！我真的要被你气死了！！！
//怎么会有你这么无聊的人啊！！！
//是不是要本萝莉恩揍你一顿才开心啊！！！
//不要再戳了！！！
//讨厌死了！
//小可爱别戳了
//旅行者副本零掉落，旅行者深渊打不过，旅行者抽卡全保底，旅行者小保底必歪
let voice_list = [
  `http://api.yujn.cn/api/duiren.php?`,
  `http://api.yujn.cn/api/yujie.php?`,
  `http://api.yujn.cn/api/lvcha.php?`,
  `http://api.yujn.cn/api/maren.php?`,
];

let memelist = {
  一二布布: "bubu",
  废柴: "cheems",
  小恐龙: "xiaokonglong",
  哆啦A梦: "ameng",
  哆啦a梦: "ameng",
  A梦: "ameng",
  a梦: "ameng",
  阿蒙: "ameng",
  狐狐: "fox",
  随机狐狐: "fox",
  狐狸: "fox",
  kabo: "kabo",
  咖波: "kabo",
  kapo: "kabo",
  猫虫: "kabo",
  库洛米: "kuluomi",
  kuluomi: "kuluomi",
  龙图: "longtu",
  随机龙图: "longtu",
  蘑菇头: "mogutou",
  随机蘑菇头: "mogutou",
  派大星: "paidaxing",
  随机派大星: "paidaxing",
  熊猫头: "panda",
  随机熊猫头: "panda",
  小黄鸡: "xiaohuangji",
  随机小黄鸡: "xiaohuangji",
  小灰灰: "xiaohuihui",
  随机小灰灰: "xiaohuihui",
  小豆泥: "xiaodouni",
  疾旋鼬: "jixuanyou",
  兄弟兄弟: "jixuanyou",
  兄弟你好香: "jixuanyou",
};
export class chuo extends plugin {
  constructor() {
    super({
      name: "ex-自定义戳一戳",
      dsc: "戳一戳机器人触发效果",
      event: "notice.group.poke",
      priority: 1,
      rule: [
        {
          /** 命令正则匹配 */
          fnc: "chuoyichuo",
        },
      ],
    });
  }

  async chuoyichuo(e) {
    const operatorId = e.operator_id || e.user_id
    if (!operatorId)
      return false
    //只记录别人的戳一戳计数
    if (operatorId != e.self_id) {
      let key = `Yunzai:cc-poke:${e.group_id}:${operatorId}:${e.target_id}`;
      let res = await global.redis.get(key);
      if (!res) {
        //初始缓存计数
        await global.redis.set(key, 1, { EX: 3 });
      } else if (res && parseInt(res) >= 2) {
        await e.group.muteMember(operatorId, 60);
        e.reply("有模块🐷咪，去小黑屋里吧！🐷🐷！");
        return false;
      } else {
        //更新缓存计数
        await global.redis.set(key, parseInt(res) + 1, { EX: 3 });
      }
    }



    //生成0-100的随机数
    let random_type = Math.random();
    if (e.target_id == e.self_id) {
      if (random_type < reply_text) {
        // 获取回复文字列表
        const word_list = getPokeDataByKey("bot");
        //回复随机文字
        let text_number = Math.ceil(Math.random() * word_list.length);
        let msg = word_list[text_number - 1];
        if (Math.random() < 0.6) {
          await Ai.sendRecordByType(e, msg);
        } else {
          await e.reply(msg);
        }
      } else if (random_type < reply_text + reply_img) {
        //回复随机图片 - 使用 ImgTag 搜索生气或喜欢的表情
        const sendFallback = async () => {
          const keys = Object.keys(memelist)
          const randomIndex = Math.ceil(Math.random() * keys.length - 1)
          await e.reply(segment.image(`http://hanhan.avocado.wiki/?${memelist[keys[randomIndex]]}`))
        }

        try {
          const tags = Math.random() < 0.5 ? ['生气'] : ['喜欢']
          const result = await ImgTagService.getRandomImages(tags, 1)
          const img = result?.images?.[0]
          const imagePath = img ? ImgTagService.getImagePath(img) : null

          if (imagePath) {
            await e.reply(segment.image(imagePath))
          } else {
            await sendFallback()
          }
        } catch (err) {
          logger.warn(`[cc-poke] ImgTag 获取失败: ${err.message}`)
          await sendFallback()
        }
      } else if (random_type < reply_text + reply_img + reply_file) {
        //回复随机本体图片（实时扫描目录）
        const localPath = ImgTagService.localPath;
        if (fs.existsSync(localPath)) {
          const photo_list = fs.readdirSync(localPath)
            .filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
          if (photo_list.length > 0) {
            const randomFile = photo_list[Math.floor(Math.random() * photo_list.length)];
            await e.reply(segment.image("file://" + path.join(localPath, randomFile)));
          } else {
            logger.warn(`[cc-poke] 本地图片目录为空: ${localPath}`);
          }
        } else {
          logger.warn(`[cc-poke] 本地图片目录不存在: ${localPath}`);
        }
      } else if (
        random_type <
        reply_text + reply_img + reply_file + reply_voice
      ) {
        //回复随机语音
        let voice_number = Math.floor(Math.random() * voice_list.length);
        await e.reply(segment.record(voice_list[voice_number]));
      } else if (
        random_type <
        reply_text + reply_img + reply_file + reply_voice + mutepick
      ) {
        //禁言
        //两种禁言方式，随机选一种
        let mutetype = Math.ceil(Math.random() * 2);
        if (mutetype == 1) {
          e.reply("说了不要戳了！");
          await common.sleep(1000);
          await e.group.muteMember(e.operator_id, 60);
          await common.sleep(3000);
          e.reply("啧");
          //有这个路径的图话可以加上
          //await e.reply(segment.image('file:///' + path + '/resources/chuochuo/'+'img4.jpg'))
        } else if (mutetype == 2) {
          e.reply("不！！");
          await common.sleep(500);
          e.reply("准！！");
          await common.sleep(500);
          e.reply("戳！！");
          await common.sleep(500);
          e.reply("玉！！");
          await common.sleep(500);
          e.reply("玉！！");
          await common.sleep(500);
          await e.group.muteMember(operatorId, 60);
        }
      } else {
        e.reply("吃玉玉一咬!~");
        await common.sleep(500);
        await e.group.pokeMember(operatorId);
      }
    } else if (Config.masterQQ.includes(e.target_id)) {
      //生成0-100的随机数
      if (!(operatorId == e.self_id) && random_type <= 0.5) {
        e.reply("不准戳主人！～，让你戳！");
        await common.sleep(500);
        await e.group.pokeMember(operatorId);
        e.reply("让你戳主人！我戳戳戳戳戳你！");
        await common.sleep(500);
        await e.group.pokeMember(operatorId);
      }
    } else {
      // 获取回复文字列表
      const word_list = getPokeDataByKey(e.target_id);
      if (word_list.length > 0) {
        let text_number = Math.ceil(Math.random() * word_list.length);
        let msg = word_list[text_number - 1];
        await e.reply(msg);
        return true;

      }

      return false;
    }

  }
}
