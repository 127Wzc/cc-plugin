import Config from "../components/Cfg.js"

// 缓存所有表情ID
let poke_data = null;

// 获取所有表情ID并返回随机值
function getPokeDataByKey(name) {
    // 如果已经有缓存，直接返回缓存的结果
    if (poke_data) {
        if(poke_data[name]){
            return poke_data[name].data;
        }else{
            return [];
        }
    }

    poke_data = Config.getDataJson("poke_words");
    
    // 检查返回的数据中是否有指定的键
    if(poke_data && poke_data[name]){
        return poke_data[name].data;
    }else{
        return [];
    }
}

export { getPokeDataByKey } 