/**
 * 拾途 Paper Trip · 本地配置（可选：内置高德「Web 服务」Key）
 *
 * 用途：把 Key 内置进小程序，正式分发时用户**零操作**、打开即用。
 * 优先级：用户在小程序「设置」里手动填的 Key  >  这里的内置 Key。
 *
 * 用法：把下面的 AMAP_KEY 换成你自己的 Key（本地修改，**不要提交**）。
 *
 * ⚠ 安全提示：本仓库是公开仓库，请勿把真实 Key 提交到 git。二选一：
 *   1) 提交前把值还原为空字符串（`node tools/mini_check.js` 会提醒）；
 *   2) 或执行一次：git update-index --skip-worktree miniprogram/utils/config.js
 *      （让 git 忽略该文件的本地修改；恢复跟踪：--no-skip-worktree）
 */
module.exports = {
    // 留空 = 不内置：开发期靠「设置」页手动填写 Key
    AMAP_KEY: ''
};
