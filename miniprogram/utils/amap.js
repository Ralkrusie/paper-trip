/**
 * 拾途 Paper Trip · 高德 Web 服务封装（wx.request，REST v3）
 *
 * 与网页版区别：网页版用高德 JS API（地图内置），小程序里改用 Web 服务 REST 接口，
 * 由 wx.request 直接请求 restapi.amap.com；底图展示由微信 map 组件（腾讯底图）负责。
 *
 * 使用前：在高德开放平台新建一个「Web 服务」类型的 Key，填入小程序「设置」里。
 * 开发时需在开发者工具「详情 → 本地设置」勾选「不校验合法域名」；
 * 正式发布需在公众平台把 https://restapi.amap.com 加入 request 合法域名。
 */
(function () {
    'use strict';

    var Store = require('./store.js').Store;

    function getKey() {
        return ((Store.state && Store.state.settings && Store.state.settings.amapKey) || '').trim();
    }

    function keyReady() {
        return Boolean(getKey());
    }

    /** 字符串化（高德部分字段空值时返回 []，统一归一为字符串） */
    function strOf(value) {
        if (Array.isArray(value)) return '';
        return String(value === undefined || value === null ? '' : value);
    }

    /** 发起一次 REST 请求；失败（网络/配额/无数据）统一 resolve(null)，由上层降级 */
    function http(path, params) {
        return new Promise(function (resolve) {
            var key = getKey();
            if (!key) {
                resolve(null);
                return;
            }
            var query = [];
            Object.keys(params || {}).forEach(function (name) {
                var value = params[name];
                if (value === undefined || value === null) return;
                query.push(name + '=' + encodeURIComponent(value));
            });
            query.push('key=' + encodeURIComponent(key));
            var url = 'https://restapi.amap.com/v3/' + path + '?' + query.join('&');

            wx.request({
                url: url,
                method: 'GET',
                timeout: 15000,
                success: function (res) {
                    var data = res && res.data;
                    if (typeof data === 'string') {
                        try { data = JSON.parse(data); } catch (e) { data = null; }
                    }
                    if (!data || data.status !== '1') {
                        resolve(null);
                        return;
                    }
                    resolve(data);
                },
                fail: function () { resolve(null); }
            });
        });
    }

    /** 逆地理编码：返回 regeocode 对象（含 formatted_address / addressComponent / pois） */
    function regeo(lng, lat, withPois) {
        return http('geocode/regeo', {
            location: lng + ',' + lat,
            extensions: withPois ? 'all' : 'base'
        }).then(function (data) {
            return data && data.regeocode ? data.regeocode : null;
        });
    }

    /** 从逆地理结果里取城市名（直辖市 city 为空时用 province 兜底） */
    function cityOf(regeocode) {
        if (!regeocode) return '';
        var comp = regeocode.addressComponent || {};
        var city = Array.isArray(comp.city) ? '' : strOf(comp.city);
        if (!city) city = strOf(comp.province);
        return city;
    }

    /** 关键词搜索 POI（添加地点用） */
    function searchPoi(keyword, city) {
        return http('place/text', {
            keywords: keyword,
            city: city || '',
            offset: 15,
            page: 1,
            extensions: 'base'
        }).then(function (data) {
            var pois = (data && data.pois) || [];
            return pois.map(function (poi) {
                var loc = strOf(poi.location).split(',');
                var address = [strOf(poi.pname), strOf(poi.cityname), strOf(poi.adname), strOf(poi.address)]
                    .filter(Boolean).join(' ');
                return {
                    name: strOf(poi.name),
                    address: address,
                    lng: Number(loc[0]),
                    lat: Number(loc[1]),
                    type: lastType(poi.type)
                };
            }).filter(function (poi) {
                return poi.name && isFinite(poi.lng) && isFinite(poi.lat) && poi.lng !== 0;
            });
        });
    }

    function lastType(type) {
        var parts = strOf(type).split(';').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    module.exports = {
        getKey: getKey,
        keyReady: keyReady,
        strOf: strOf,
        http: http,
        regeo: regeo,
        cityOf: cityOf,
        searchPoi: searchPoi
    };
})();
