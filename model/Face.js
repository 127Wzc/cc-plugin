import Config from "../components/Cfg.js"

// 缓存所有表情ID
let cachedFaceIds = null;

// 获取所有表情ID并返回随机值
function getAllFaceIds() {
    // 如果已经有缓存，直接返回缓存的结果
    if (cachedFaceIds) {
        return cachedFaceIds;
    }

    const faceConfig = Config.getDataJson("face-config");
    if (!faceConfig) return null

    const allIds = []
    
    // 收集所有sysface的QSid
    if (faceConfig.sysface && Array.isArray(faceConfig.sysface)) {
        faceConfig.sysface.forEach(face => {
            if (face.QSid) {
                allIds.push(face.QSid)
            }
        })
    }
    
    // 收集所有emoji的QCid
    if (faceConfig.emoji && Array.isArray(faceConfig.emoji)) {
        faceConfig.emoji.forEach(emoji => {
            if (emoji.QCid) {
                allIds.push(emoji.QCid)
            }
        })
    }
    
    // 如果没有收集到ID，返回null
    if (allIds.length === 0) return null
    
    // 将结果存入缓存
    cachedFaceIds = allIds;
    return cachedFaceIds;
}

export { getAllFaceIds } 