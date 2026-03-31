import Config from "../components/Cfg.js";
import { getAllFaceIds } from '../model/Face.js'

const DEFAULT_REGISTER_TIME_API = "https://openapi.dwo.cc/api/qqxxcx";
const SEX_MAP = {
  male: "男",
  female: "女",
  unknown: "未知",
};
const CONSTELLATION_MAP = [
  "",
  "白羊座",
  "金牛座",
  "双子座",
  "巨蟹座",
  "狮子座",
  "处女座",
  "天秤座",
  "天蝎座",
  "射手座",
  "摩羯座",
  "水瓶座",
  "双鱼座",
];
const SHENG_XIAO_MAP = [
  "",
  "鼠",
  "牛",
  "虎",
  "兔",
  "龙",
  "蛇",
  "马",
  "羊",
  "猴",
  "鸡",
  "狗",
  "猪",
];
const BLOOD_TYPE_MAP = {
  1: "A型",
  2: "B型",
  3: "O型",
  4: "AB型",
  5: "其他",
};

async function getFetch() {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  const { default: fetch } = await import("node-fetch");
  return fetch;
}

function isDisplayValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    return !["", "-", "0", "0-0-0"].includes(value.trim());
  }
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function formatUnixTime(value) {
  const timestamp = Number(value);
  if (!timestamp) return "";

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
}

function formatBirthday(data) {
  const year = Number(data?.birthday_year) || 0;
  const month = Number(data?.birthday_month) || 0;
  const day = Number(data?.birthday_day) || 0;

  if (!year && !month && !day) return "";

  const yearText = year ? `${year}年` : "";
  const monthText = month ? `${month}月` : "";
  const dayText = day ? `${day}日` : "";
  return `${yearText}${monthText}${dayText}` || "";
}

function formatLocation(...parts) {
  return parts.filter((part) => isDisplayValue(part)).join(" ");
}

function formatVipInfo(data) {
  if (!data?.is_vip) return "未开通";

  const labels = [];
  if (data?.is_years_vip) labels.push("年费会员");
  else labels.push("QQ会员");

  if (Number(data?.vip_level) > 0) {
    labels.push(`Lv.${data.vip_level}`);
  }

  return labels.join(" ");
}

function formatEnumValue(value, map) {
  const index = Number(value);
  if (!index) return "";
  return map[index] || "";
}

function pushField(lines, label, value) {
  if (!isDisplayValue(value)) return;
  lines.push(`${label}：${value}`);
}

function buildProfileMessage(qq, data = {}) {
  const nickname = data.nickname || data.nick;
  const signature = data.long_nick || data.longNick;
  const registerTime = formatUnixTime(data.reg_time || data.regTime);
  const constellation = formatEnumValue(data.constellation, CONSTELLATION_MAP);
  const shengXiao = formatEnumValue(data.shengXiao, SHENG_XIAO_MAP);
  const bloodType = BLOOD_TYPE_MAP[Number(data.kBloodType)] || "";
  const birthday = formatBirthday(data);
  const location = formatLocation(data.country, data.province, data.city, data.address);
  const homeTown = typeof data.homeTown === "string" && /^\d+-\d+-\d+$/.test(data.homeTown.trim())
    ? ""
    : data.homeTown;
  const loginDays = data.login_days === 0 || isDisplayValue(data.login_days)
    ? `${Number(data.login_days)}天`
    : "";
  const sex = SEX_MAP[data.sex] || data.sex || "";

  const lines = [];
  pushField(lines, "QQ", data.uin || data.user_id || qq);
  pushField(lines, "昵称", nickname);
  pushField(lines, "QID", data.qid);
  pushField(lines, "备注", data.remark);
  pushField(lines, "个性签名", signature);
  pushField(lines, "注册时间", registerTime);
  pushField(lines, "QQ等级", data.qqLevel);
  pushField(lines, "会员状态", formatVipInfo(data));
  pushField(lines, "性别", sex);
  pushField(lines, "年龄", Number(data.age) > 0 ? `${data.age}岁` : "");
  pushField(lines, "生日", birthday);
  pushField(lines, "星座", constellation);
  pushField(lines, "生肖", shengXiao);
  pushField(lines, "血型", bloodType);
  pushField(lines, "所在地", location);
  pushField(lines, "故乡", homeTown);
  pushField(lines, "邮箱", data.eMail);
  pushField(lines, "手机号", data.phoneNum);
  pushField(lines, "登录天数", loginDays);

  return lines.join("\n");
}

export class myQQ extends plugin {
  constructor() {
    super({
      /** 功能名称 */
      name: "qq相关api",
      /** 功能描述 */
      dsc: "qq注册时间",
      /** https://oicqjs.github.io/oicq/#eveAnts */
      event: "message",
      /** 优先级，数字越小等级越高 */
      priority: 1,
      rule: [
        {
          /** 命令正则匹配 */
          reg: "^#(qq|QQ)注册时间.*",
          /** 执行方法 */
          fnc: "registerTime",
        },
        {
          /** 命令正则匹配 */
          reg: "",
          /** 执行方法 */
          fnc: "emojiLike",
        },
      ],
    });
  }

  async emojiLike(e) {
    if(typeof e?.group?.setEmojiLike === 'function'){
      //表情回应
      let emojiMap = Config.qqConfig.emoji
      try{
        if(e.user_id in emojiMap && emojiMap[e.user_id] != 0){
          e.group?.setEmojiLike(e.message_id, emojiMap[e.user_id]);
        }else if(e.user_id in emojiMap && emojiMap[e.user_id] == 0){
          const randomFaceId = getAllFaceIds()[Math.floor(Math.random() * getAllFaceIds().length)];
          e.group?.setEmojiLike(e.message_id, randomFaceId);
        }
      } catch (error) {
        logger.error(error);
      }
    }
    return false;
  }

  async registerTime(e) {
    let qq =
      this.e.at ||
      this.e.message.find((item) => item.type == "at")?.qq ||
      this.e.msg.match(/\d+/)?.[0] ||
      "" ||
      this.e.user_id;
    qq = Number(qq) || String(qq);

    logger.debug(`当前查询的qq:${qq}`);
    const registerTimeConfig = Config.qqConfig?.registerTime || {};
    const apiUrl = registerTimeConfig.api_url || DEFAULT_REGISTER_TIME_API;
    const ckey = registerTimeConfig.ckey || "";

    if (!ckey) {
      await this.reply("QQ注册时间查询未配置 ckey，请先在 cc-plugin 的 qqConfig 中填写。");
      return true;
    }

    const url = new URL(apiUrl);
    url.searchParams.set("qq", qq);
    url.searchParams.set("ckey", ckey);

    try {
      const fetch = await getFetch();
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/none",
        },
      });
      const re = await response.json();

      if (!response.ok) {
        logger.error(`[cc-plugin] QQ注册时间查询接口异常: ${response.status} ${response.statusText}`);
        await this.reply("QQ注册时间查询失败，接口暂时不可用。");
        return true;
      }

      if (re?.status !== "ok" || re?.retcode !== 0 || !re?.data) {
        const errorMessage = re?.message || re?.wording || "未查询到有效数据";
        await this.reply(`QQ注册时间查询失败：${errorMessage}`);
        return true;
      }

      const msg = buildProfileMessage(qq, re.data);
      await this.reply(msg || `QQ：${qq}\n未查询到可展示的资料`);
    } catch (error) {
      logger.error(error);
      await this.reply("QQ注册时间查询失败，请稍后再试。");
    }

    return true;
  }
}
