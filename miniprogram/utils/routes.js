/**
 * 拾途 Paper Trip · 路线服务（高德真实路线）
 *
 * 与网页版行为一致：
 *   - key = 通勤方式 + 起终点坐标（5 位小数），结果缓存（含「无路线」）；
 *   - 查询失败（网络抖动/限流）自动重试一次（6 秒后清缓存再查）；
 *   - 新路线就绪后通知订阅者（页面做节流刷新）；
 *   - 未配置 Key 时不缓存空结果，配置后自动可查。
 *
 * 返回结构（与网页版一致，供 format.js 直接消费）：
 *   { time(秒), distance(米), walking(米|null), rides: [{line, from, to}]|null,
 *     from, to, path: [[lng,lat], ...] }
 */
(function () {
    'use strict';

    var amap = require('./amap.js');

    var cache = {};
    var pending = {};
    var retryCount = {};
    var listeners = [];
    var cityCache = {};

    function fetchable(mode) {
        return mode === 'walk' || mode === 'bike' || mode === 'drive' ||
            mode === 'taxi' || mode === 'transit';
    }

    function routeKey(mode, fromPlace, toPlace) {
        return mode + '|' + Number(fromPlace.lat).toFixed(5) + ',' + Number(fromPlace.lng).toFixed(5) +
            '>' + Number(toPlace.lat).toFixed(5) + ',' + Number(toPlace.lng).toFixed(5);
    }

    /** 已缓存的结果：命中时返回对象（可能是 null＝无路线），未查过返回 undefined */
    function get(mode, fromPlace, toPlace) {
        if (!fetchable(mode)) return undefined;
        return cache[routeKey(mode, fromPlace, toPlace)];
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
    }

    function notify() {
        listeners.forEach(function (fn) {
            try { fn(); } catch (e) { console.error('[routes] 订阅者错误', e); }
        });
    }

    /** 请求某段通勤的真实路线（有缓存直接返回；否则发起查询并返回 Promise） */
    function request(mode, fromPlace, toPlace) {
        if (!fetchable(mode) || !fromPlace || !toPlace) return Promise.resolve(null);
        var key = routeKey(mode, fromPlace, toPlace);
        if (cache[key] !== undefined) return Promise.resolve(cache[key]);
        if (pending[key]) return pending[key];
        if (!amap.keyReady()) return Promise.resolve(null);

        var task = routeSummary(mode, fromPlace.lng, fromPlace.lat, toPlace.lng, toPlace.lat)
            .then(function (route) {
                delete pending[key];
                cache[key] = route || null;
                if (!route && (retryCount[key] || 0) < 1) {
                    // 偶发失败：清掉缓存并稍后重试一次
                    retryCount[key] = 1;
                    setTimeout(function () {
                        delete cache[key];
                        notify();
                    }, 6000);
                } else {
                    notify();
                }
                return cache[key];
            });
        pending[key] = task;
        return task;
    }

    /* ================= 具体查询 ================= */

    function routeSummary(mode, fromLng, fromLat, toLng, toLat) {
        var origin = fromLng + ',' + fromLat;
        var destination = toLng + ',' + toLat;
        if (mode === 'walk') {
            return amap.http('direction/walking', { origin: origin, destination: destination })
                .then(function (data) { return parseSimple(data); });
        }
        if (mode === 'bike') {
            return bikeRoute(origin, destination);
        }
        if (mode === 'drive' || mode === 'taxi') {
            return amap.http('direction/driving', { origin: origin, destination: destination })
                .then(function (data) { return parseSimple(data); });
        }
        if (mode === 'transit') {
            return transitRoute(origin, destination, fromLng, fromLat);
        }
        return Promise.resolve(null);
    }

    /** 公交路径规划需要城市参数：拿起点城市（按 1/100 度网格缓存） */
    function resolveCity(lng, lat) {
        var cacheKey = Number(lng).toFixed(2) + ',' + Number(lat).toFixed(2);
        if (cityCache[cacheKey] !== undefined) return Promise.resolve(cityCache[cacheKey]);
        return amap.regeo(lng, lat, false).then(function (regeocode) {
            var city = amap.cityOf(regeocode);
            cityCache[cacheKey] = city;
            return city;
        });
    }

    function transitRoute(origin, destination, fromLng, fromLat) {
        return resolveCity(fromLng, fromLat).then(function (city) {
            return amap.http('direction/transit/integrated', {
                origin: origin,
                destination: destination,
                city: city || '全国',
                cityd: city || '',
                strategy: 0
            });
        }).then(function (data) {
            return parseTransfer(data);
        });
    }

    /**
     * 骑行路径规划：v3 已停用（SERVICE_NOT_AVAILABLE）、v5 只有文字指引没有轨迹点，
     * 改用 v4（实测 errcode=0，data.paths[0].steps[].polyline 与 v3 一致）【2026-09 实测】
     */
    function bikeRoute(origin, destination) {
        return amap.http4('direction/bicycling', { origin: origin, destination: destination })
            .then(function (data) {
                var paths = (data && data.data && data.data.paths) || [];
                if (!paths.length) return null;
                return pathToRoute(paths[0]);
            });
    }

    /** 单个 path → 统一路线结果（time/distance/轨迹点） */
    function pathToRoute(path) {
        var points = [];
        (path.steps || []).forEach(function (step) {
            if (step && step.polyline) points = points.concat(parsePolyline(step.polyline));
        });
        return {
            time: Number(path.duration) || Number(path.time) || null,
            distance: Number(path.distance) || null,
            walking: null,
            rides: null,
            from: '',
            to: '',
            path: dedupe(points)
        };
    }

    /** v3 路径规划（步行 / 驾车）结果 → 时长、距离与沿路轨迹 */
    function parseSimple(data) {
        var route = data && data.route;
        var paths = (route && route.paths) || [];
        if (!paths.length) return null;
        return pathToRoute(paths[0]);
    }

    /** 公交换乘结果 → 每段乘车明细（线路 + 上车站 → 下车站，多段即换乘）+ 全程真实轨迹 */
    function parseTransfer(data) {
        var route = data && data.route;
        var transits = (route && route.transits) || [];
        if (!transits.length) return null;
        // 选「总耗时最短」的方案：REST 首条方案按推荐排序、未必最快（2026-09 实测首条 61 分、另有 43 分方案）
        var plan = transits[0];
        transits.forEach(function (candidate) {
            var candidateTime = Number(candidate.duration) || 0;
            var planTime = Number(plan.duration) || 0;
            if (candidateTime && (!planTime || candidateTime < planTime)) plan = candidate;
        });
        var segments = plan.segments || [];
        var rides = [];
        var points = [];

        segments.forEach(function (segment) {
            if (!segment) return;
            var walking = segment.walking;
            if (walking && walking.steps) {
                walking.steps.forEach(function (step) {
                    if (step && step.polyline) points = points.concat(parsePolyline(step.polyline));
                });
            }
            var ride = null;
            if (segment.bus && segment.bus.buslines && segment.bus.buslines.length) {
                var line = segment.bus.buslines[0];
                if (line.polyline) points = points.concat(parsePolyline(line.polyline));
                ride = {
                    line: cleanLineName(line.name),
                    from: stopName(line.departure_stop),
                    to: stopName(line.arrival_stop)
                };
            } else if (segment.railway && (segment.railway.name || segment.railway.trip || segment.railway.departure_stop)) {
                // ⚠ 无铁路时高德也会返回 railway:{via_stops:[],alters:[],spaces:[]} 空壳对象，
                // 必须用具体字段判断，否则会凭空多出一段「铁路」（2026-09 实测）
                ride = {
                    line: cleanLineName(segment.railway.name || segment.railway.trip || '铁路'),
                    from: stopName(segment.railway.departure_stop),
                    to: stopName(segment.railway.arrival_stop)
                };
            }
            if (ride && ride.line) rides.push(ride);
        });

        if (!rides.length) return null;
        return {
            time: Number(plan.duration) || null,
            distance: Number(plan.distance) || null,
            walking: Number(plan.walking_distance) || 0,
            rides: rides,
            from: rides[0].from,
            to: rides[rides.length - 1].to,
            path: dedupe(points)
        };
    }

    /** 去掉线路名里的方向后缀，如「地铁1号线(莘庄--富锦路)」→「地铁1号线」 */
    function cleanLineName(name) {
        return String(name || '').replace(/[（(].*$/, '').trim();
    }

    function stopName(stop) {
        return stop && stop.name ? String(stop.name) : '';
    }

    /** "lng,lat;lng,lat;..." → [[lng,lat], ...] */
    function parsePolyline(text) {
        var out = [];
        String(text || '').split(';').forEach(function (pair) {
            var parts = pair.split(',');
            var lng = Number(parts[0]);
            var lat = Number(parts[1]);
            if (isFinite(lng) && isFinite(lat) && parts.length === 2) out.push([lng, lat]);
        });
        return out;
    }

    /** 相邻重复点去重（1e-6 阈值） */
    function dedupe(points) {
        var out = [];
        points.forEach(function (point) {
            var last = out[out.length - 1];
            if (!last || Math.abs(last[0] - point[0]) > 1e-6 || Math.abs(last[1] - point[1]) > 1e-6) {
                out.push(point);
            }
        });
        return out;
    }

    /* ================= 供时间轴使用 ================= */

    /** 当前天各行程项的高德真实通勤分钟（{itemId: 分钟}），供时间轴推算优先使用 */
    function realLegMinutesFor(day) {
        var map = {};
        if (!day) return map;
        var active = day.items.filter(function (item) { return !item.disabled; });
        for (var i = 0; i + 1 < active.length; i++) {
            var item = active[i];
            var mode = (item.leg && item.leg.mode) || '';
            if (!fetchable(mode)) continue;
            var from = findPlace(active[i].placeId);
            var to = findPlace(active[i + 1].placeId);
            if (!from || !to) continue;
            var route = cache[routeKey(mode, from, to)];
            if (route && route.time) map[item.id] = Math.max(1, Math.round(route.time / 60));
        }
        return map;
    }

    var Store = require('./store.js').Store;

    function findPlace(placeId) {
        return Store.getPlace(placeId);
    }

    module.exports = {
        fetchable: fetchable,
        routeKey: routeKey,
        get: get,
        request: request,
        onChange: onChange,
        realLegMinutesFor: realLegMinutesFor
    };
})();
