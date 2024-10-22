import cfg from '../../../lib/config/config.js'
import fs from "fs";
import path from 'path';
import common from '../../../lib/common/common.js'
const _path = process.cwd()
//在这里设置事件概率,请保证概率加起来小于1，少于1的部分会触发反击
let reply_text = 0.2//文字回复概率
let reply_img = 0.2//在线图片回复概率
let reply_file = 0.2 //离线图片回复改了
let reply_voice = 0.2//语音回复概率
let mutepick = 0.1 //禁言概率
let example = 0.1 //拍一拍表情概率
//剩下的0.08概率就是反击


//定义图片存放路径 默认是Yunzai-Bot/resources/chuochuo
const chuo_path = '/resources/logier/emoji';


// //图片需要从1开始用数字命名并且保存为jpg或者gif格式，存在Yunzai-Bot/resources/chuochuo/目录下
// let jpg_number = 17 //输入jpg图片数量
// let gif_number = 12 //输入gif图片数量



//回复文字列表
let word_list = ['不要再戳了好不好嘛~',
    '玉玉诅咒你买肯德基不是星期四~',
    '救命啊，有变态>_<！！！',
    '啊♂~',
    '那里，不可以~',
    '你戳谁呢！你戳谁呢！！！           o(´^｀)o',
    '是不是要本玉玉揍你一顿才开心啊！！！',
    'cc，他欺负我˃ʍ˂！',
    '不要再戳了！我真的要被你气死了！！！',
    '你无不无聊啊，整天龊龊龊',
    '哼！坏旅行者副本零掉落，坏旅行者深渊打不过，坏旅行者抽卡全保底，坏旅行者小保底必歪，坏旅行者找不到女朋友！喵喵的诅咒🐱',
    '再氪两单嘛~救救必女吧！',
    '大魔王，大魔王，来接受我的制裁吧！ξ( ✿＞◡❛)',
    '我生气了！咋瓦乐多!木大！木大木大！', '少女是谁',
    '朗达哟',
    '喵喵遇到了变态！',
    '要戳坏掉了>_<',
    '呜呜呜，你没睡醒吗？一天天就知道戳我',
    '就你小子乱戳我，找打！',
    '戳你妈啊', '你™再戳我玉玉就把你超了',
    '你死定了，傻波一',
    '你干嘛哈哈欸哟',
    '你™犯法了知不知道喵！喵！',
    '你干嘛！你是不是要我玉玉给你八十拳',
    '乐，就知道戳，油饼食不食',
    '不许戳',
    '哎呦，你别戳了',
    '请不要不可以戳玉玉啦~',
    '别戳了可以嘛',
    '要戳坏掉了>_<，呜呜呜',
    '你老是欺负我，哭哭惹',
    '别戳了啊！再戳就要坏掉了呀',
    '不可以，不可以，不可以！戳疼了！',
    '别戳了别戳了！',
    '戳一次保底一次，嘻嘻',
    '痛QAQ...',
    '不要戳戳…',
    '诅咒你买方便面没有叉子！',
    '救命啊，有变态>_<！！！',
    '哼~~~',
    '你戳谁呢！你戳谁呢！！！',
    '食不食油饼？',
    '不要再戳了！我真的要被你气死了！！！',
    '怎么会有你这么无聊的人啊！！！(￢_￢)',
    '旅行者副本零掉落，旅行者深渊打不过，旅行者抽卡全保底，旅行者小保底必歪，旅行者找不到女朋友....',
    '把嘴张开（抬起脚）',
    '你干嘛！',
    '你是不是喜欢我？',
    '变态萝莉控！',
    '要戳坏掉了>_<',
    '大叔，你没睡醒吗？一天天就知道戳我',
    '不可以戳戳>_<',
    '不要戳了，再戳就坏掉啦>_<',
    '正在关闭对您的所有服务...关闭成功',
    '连个可爱美少女都要戳的肥宅真恶心啊',
    '可恶，该死的咸猪手',
    '小朋友别戳了',
    '正在定位您的真实地址...定位成功。轰炸机已起飞',
    '是不是要可爱的我，揍你一顿才开心，哼',
    '怎么会有你这么无聊的人啊˃◡˂',
    '讨厌死了，你好烦人啊，不陪你玩了',
    '不要再戳了！我真的要被你气死了>_<',
    '你戳谁呢！你戳谁呢~哼',
    '不要再戳了！',
    '你只需看着别人精彩，老天对你另有安排',
    '你戳的我有点开心奖励你哦',
    '不准戳',
    '你行不行啊细狗',
    '你要是在戳我！！我~我就打你哼',
    '可以不要戳了吗你好烦啊变态~变态',
    '讨厌死了',
    '本来很开心的，你为什么戳我鸭~变态',
    '哼~我才不是傲娇呢，那是什么不知道鸭',
    '我，我才不会这样子！真正的我从来不是傲娇！傲，傲娇什么 的，都，都是别人杜摆~嗯，一点，一点也没有呢',
    '我……我……才不是傲娇呢',
    '只是刚好路过而已，才不是因为你戳我特地来看你的呢！你可不要异想天开',
    '我可不是因为喜欢才这样做的哦',
    '总之你是个大笨蛋啦',
    '笨蛋，人家可不是特地来帮你们的呢',
    '全世界，我最讨厌你啦',
    '这~这种问题，我当然知道，我！我可不是要说给你听的， 我只是觉得_话太可怜了~对，所以给我认认真真的记住',
    '啊~好舒服鸭，其实我也不是很想要这个~如果你硬要给我，我就勉为其难 的收下了',
    '群主大人快来鸭~有人欺负我',
    '只要你需要我就会在哦',
    '你的太小了，没有一点感觉鸭',
    '就这，一点都不舒服呢',
    '我的~里面很紧~很舒服的~哎呀大变态~真是的好害羞啊',
    '你这个变态，大变态，超级变态！不要在碰我了！',
    '好像因为太舒服昏过去了呢',
    '你怎么这样啊，这样欺负人不对的',
    '你在想涩涩对吗，不可以哦',
    '别戳了，别戳了，我爪巴',
    '别戳了，戳疼了',
    '别戳了再戳就坏掉了555',
    '你戳你戳毛线呢',
    '气死我了，气死我了，不要戳了！',
    '干嘛戳我，我要惩罚你',
    '你~你~你要干什么啊',
    '气死我了不要戳了',
    '唔嗯~戳疼了',
    '难道又有什么地方不舒服吗',
    '我在哦！是有什么事情吗？',
    '嗯呐~',
    '唔噫~',
    '在呢抱抱',
    '喵呜~喵呜',
    '唉？怎么了吗',
    '你会一直记得我吗',
    '我想我大抵是不想干了，也罢，我向来如此.',
    '抱我的小猫腿舔我的jio',
    '你这样就非常不可爱！',
    '你这种坏人，是会被狼吃掉的',
    '这事不应该是这样的阿~',
    '你这个人傻fufu的。',
    '你戳我有什么用？我有反弹技能',
    '你这个笨蛋蛋傻瓜瓜臭狗狗不要戳了了',
    '像你这种坏银，我才不稀罕哦。',
    '脚踏两只船 ，迟早要翻船 ，脚踏万只船， 翻都翻不完。',
    '你总说我懒，是啊，喜欢上你就懒得放弃你了呀',
    '哼~有些笑容背后是紧咬牙关的灵魂。',
    '醒醒吧，别做梦了',
    '是不是把我当老婆了',
    '请问～～你睡了吗？',
    '这不是欺负人吗',
    '我不但可爱而且可爱你啦',
    '我发脾气了你就听着,结束了我会怂给你看',
    '劝你别整天对我戳戳戳的有本事你来亲亲我',
    '欢迎你走上爱我这条不归路。',
    '像我这种人，你除了宠着我也没有其他办法对吧',
    '我可爱吗，一直戳我',
    '我不喜欢你这个小朋友，你不要戳我',
    '宝宝是不是又熬夜了，我看你还在线',
    '笨蛋！哼！',
    '把我自己送给你好了虽然我很可爱但是我养不起了',
    '我偏偏要无理取闹除非抱抱我',
    '你已经弄乱了我的心，什么时候来弄乱我的床~啊你不会不行吧',
    '无事献殷勤，非…非常喜欢你~',
    '戳戳戳~希望你能有点自知之明，认识到超级无敌可爱的我',
    '要我给你暖被窝吗~哎嘿~想屁吃',
    '你再戳我~我就透你',
    '哎呀呀~喜欢我就直说嘛~',
    '别戳我了戳疼了',
    '我发脾气了~气死我了',
    '那里....不可以... ',
    '啊...温柔一点...把我戳疼辣..',
    '要戳坏掉了！',
    '你欺负人，呜呜',
    '你轻一点哦~',
    '我怕疼...轻一点~ ',
    '再戳就坏了！！！ ',
    '请...请...不要戳那里...',
    '要轻一点戳哦~',
    '旅行者，你深渊12层能一次过吗？',
    '快带我去玩！（打滚）',
    '哇，你这个人！',
    '是哪个笨蛋在戳我？',
    '干点正事吧！',
    '这破群我是一点也待不下去了！',
    '可恶！',
    '达咩！',
    '呜哇！',
    '你个坏蛋~',
    '不要这样啦！(摇头）',
    '呜哇！（惊醒）',
    '（阿巴阿巴）',
    '（眨眼）',
    '气气！',
    '过分分！',
    '走开啦！',
    '（╯‵□′）╯︵┴─┴',
    '呜哇！我要给你起个难听的绰号！',
    '吃我一拳！',
    '饿饿...',
    '讨厌！',
    '坏坏！',
    '哒咩，别戳了！',
    '呜哇！主人救命！',
    '你欺负我！',
    '充电的时候不可以戳啊，万一漏电了怎么办？',
    'QAQ呜哇啊啊啊啊啊！',
    'QAQ..这个人欺负我…',
    '呜呜，要变笨啦！',
    'rua~',
    '是不是要揍你一顿才开心啊！！！',
    '讨厌死了！',
    '小朋友别戳了',
    '怎么会有你这么无聊的人啊！！！',
    '不要再戳了！我真的要被你气死了！！！',
    '我真的要气洗掉了',
    '你干嘛老戳我啊qwq',
    '你再戳我就要闹了！哇啊啊啊！',
    '你这个人真是有奇怪的癖好呢~',
    '你是准备对我负责了吗，喵~',
    '小猫喵喵叫，那你是小狗该怎么叫呢~',
    '你个笨蛋，戳坏了怎么办啊！！',
    '哭哭，真的戳的很疼啦QAQ',
    '今天想吃草莓蛋挞！给我买嘛~',
    '究竟是怎么样才能养出你这种变态呢！讨厌死了！',
    '再喜欢玉玉也不能这样戳啦，真的会坏掉的笨蛋!'
];


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
export class chuo extends plugin {
    constructor() {
        super({
            name: 'ex-自定义戳一戳',
            dsc: '戳一戳机器人触发效果',
            event: 'notice.group.poke',
            priority: 1,
            rule: [
                {
                    /** 命令正则匹配 */
                    fnc: 'chuoyichuo'
                }
            ]
        }
        )
    }



    async chuoyichuo(e) {

        if (e.target_id == e.self_id) {
            //生成0-100的随机数
            let random_type = Math.random()

            if (random_type < reply_text) {
                //回复随机文字
                let text_number = Math.ceil(Math.random() * word_list['length'])
                await e.reply(word_list[text_number - 1])
            } else if (random_type < (reply_text + reply_img)) {
                //回复随机图片
                const keys = Object.keys(memelist)
                let randomIndex = Math.ceil(Math.random() * keys.length - 1)
                logger.info('key=' + keys[randomIndex])

                await e.reply(segment.image(`http://hanhan.avocado.wiki/?${memelist[keys[randomIndex]]}`))

            } else if (random_type < (reply_text + reply_img + reply_file)) {
                //回复随机本体图片
                //读取文件夹里面的所有图片文件名
                let photo_list = fs.readdirSync(path.join(_path, chuo_path))
                //随机选择一个文件名
                let photo_number = Math.floor(Math.random() * photo_list.length)

                await e.reply(segment.image('file://' + path.join(_path, chuo_path, photo_list[photo_number])))
            } else if (random_type < (reply_text + reply_img + reply_file + reply_voice)) {
                //回复随机语音
                let voice_number = Math.floor(Math.random() * voice_list.length)

                await e.reply(segment.record(voice_list[voice_number]))
            } else if (random_type < (reply_text + reply_img + reply_file + reply_voice + mutepick)) {
                //禁言
                //两种禁言方式，随机选一种
                let mutetype = Math.ceil(Math.random() * 2)
                if (mutetype == 1) {
                    e.reply('说了不要戳了！')
                    await common.sleep(1000)
                    await e.group.muteMember(e.operator_id, 60);
                    await common.sleep(3000)
                    e.reply('啧')
                    //有这个路径的图话可以加上
                    //await e.reply(segment.image('file:///' + path + '/resources/chuochuo/'+'img4.jpg'))
                }
                else if (mutetype == 2) {
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
                    await e.group.muteMember(e.operator_id, 60)
                }
            } else {
                e.reply('吃玉玉一咬!~')
                await common.sleep(500)
                await e.group.pokeMember(e.user_id)
            }
        } else if (e.target_id == cfg.masterQQ) {
            //生成0-100的随机数
            let randomType = Math.floor(Math.random() * 50);

            if (random_type <= 50) {
                e.reply('不准戳主人！～，让你戳！')
                await common.sleep(500)
                await e.group.pokeMember(e.user_id)
                e.reply('让你戳主人！我戳戳戳戳戳你！')
                await common.sleep(500)
                await e.group.pokeMember(e.user_id)
            }

        }

    }

}
