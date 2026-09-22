/**
 * 拾途 Paper Trip · 微信小程序入口
 * 与网页版共用同一份数据结构（见 utils/store.js），导入导出的 JSON 互通。
 */
var Store = require('./utils/store.js');

App({
    globalData: {},

    onLaunch: function () {
        Store.init();
    }
});
