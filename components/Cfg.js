import YAML from "yaml";
import chokidar from "chokidar";
import YamlReader from "./YamlReader.js";
import fs from "node:fs";
import cfg from "../../../lib/config/config.js";

const Path = process.cwd();
const Plugin_Name = "cc-plugin";
const Plugin_Path = `${Path}/plugins/${Plugin_Name}`;
class Config {
  constructor() {
    this.config = {};

    /** 监听文件 */
    this.watcher = { config: {}, defSet: {} };

    this.initCfg();
  }

  /** 初始化配置 */
  initCfg() {
    let path = `${Plugin_Path}/config/config/`;
    if (!fs.existsSync(path)) {
      // 如果目录不存在，则创建它
      fs.mkdirSync(path, { recursive: true });
    }
    let pathDef = `${Plugin_Path}/config/default_config/`;
    const files = fs
      .readdirSync(pathDef)
      .filter((file) => file.endsWith(".yaml"));
    for (let file of files) {
      if (!fs.existsSync(`${path}${file}`)) {
        fs.copyFileSync(`${pathDef}${file}`, `${path}${file}`);
      }
      this.watch(`${path}${file}`, file.replace(".yaml", ""), "config");
    }
  }

  /** 主人QQ */
  get masterQQ() {
    return cfg.masterQQ;
  }

  get master() {
    return cfg.master
  }

  get qqConfig() {
    return this.getDefOrConfig("qqConfig");
  }

  /**
   * 默认配置和用户配置
   * @param name
   */
  getDefOrConfig(name) {
    let def = this.getdefSet(name);
    let config = this.getConfig(name);
    return { ...def, ...config };
  }

  /**
   * 默认配置
   * @param name
   */
  getdefSet(name) {
    return this.getYaml("default_config", name);
  }

  /**
   * 用户配置
   * @param name
   */
  getConfig(name) {
    return this.getYaml("config", name);
  }

  /**
   * 读取json
   * @param name
   */
  getDataJson(name) {
    return this.getJson(name);
  }

  /**
   * 写入json
   * @param name
   */
  writeDataJson(name, content) {
    return this.writeJson(name, content);
  }

  /**
   * 获取配置yaml
   * @param type 默认跑配置-defSet，用户配置-config
   * @param name 名称
   */
  getYaml(type, name) {
    let file = `${Plugin_Path}/config/${type}/${name}.yaml`;
    let key = `${type}.${name}`;

    if (this.config[key]) return this.config[key];

    this.config[key] = YAML.parse(fs.readFileSync(file, "utf8"));

    this.watch(file, name, type);

    return this.config[key];
  }

  /**
   * 获取配置yaml
   * @param type 默认跑配置-defSet，用户配置-config
   * @param name 名称
   */
  getJson(name) {
    let file = `${Plugin_Path}/data/${name}.json`;
    let fdata = fs.readFileSync(file, "utf8");

    return JSON.parse(fdata);
  }

  /**
   * 写入配置json
   * @param {string} name 文件名
   * @param {object} content 要写入的内容
   */
  writeJson(name, content) {
    let file = `${Plugin_Path}/data/${name}.json`;
    // 将内容转换为JSON字符串
    const data = JSON.stringify(content, null, 2); // 使用2个空格进行美化格式
    // 写入文件
    fs.writeFileSync(file, data, "utf8");
  }

  /**
   * 监听配置文件
   * @param file
   * @param name
   * @param type
   */
  watch(file, name, type = "default_config") {
    let key = `${type}.${name}`;

    if (this.watcher[key]) return;

    const watcher = chokidar.watch(file);
    watcher.on("change", (path) => {
      delete this.config[key];
      if (typeof Bot == "undefined") return;
      logger.mark(`[cc-Plugin][修改配置文件][${type}][${name}]`);
      if (this[`change_${name}`]) {
        this[`change_${name}`]();
      }
    });

    this.watcher[key] = watcher;
  }

  modify(name, key, value, type = "config", bot = false) {
    let path = `${bot ? Path : Plugin_Path}/config/${type}/${name}.yaml`;
    new YamlReader(path).set(key, value);
    delete this.config[`${type}.${name}`];
  }

  /**
   * 修改配置数组
   * @param {string} name 文件名
   * @param {string | number} key key值
   * @param {string | number} value value
   * @param {'add'|'del'} category 类别 add or del
   * @param {'config'|'default_config'} type 配置文件或默认
   * @param {boolean} bot  是否修改Bot的配置
   */
  modifyarr(name, key, value, category = "add", type = "config", bot = false) {
    let path = `${bot ? Path : Plugin_Path}/config/${type}/${name}.yaml`;
    let yaml = new YamlReader(path);
    if (category == "add") {
      yaml.addIn(key, value);
    } else {
      let index = yaml.jsonData[key].indexOf(value);
      yaml.delete(`${key}.${index}`);
    }
  }
}
export default new Config();
