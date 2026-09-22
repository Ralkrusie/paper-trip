/**
 * 拾途 Paper Trip · 展示与文本工具（与网页版文案保持一致）
 */
(function () {
    'use strict';

    var Store = require('./store.js').Store;

    var LEG_MODE_LABELS = { walk: '步行', bike: '骑行', drive: '驾车', taxi: '打车', transit: '公共交通', other: '其他' };
    var LEG_MODE_ORDER = ['walk', 'bike', 'drive', 'taxi', 'transit', 'other'];

    /** 金额显示：整数不带小数，非整保留两位 */
    function formatMoney(value) {
        var n = Math.round((Number(value) || 0) * 100) / 100;
        return n % 1 === 0 ? String(n) : n.toFixed(2);
    }

    function routeKm(distance) {
        return (distance / 1000).toFixed(1) + ' km';
    }

    function routeMinutes(seconds) {
        return Math.max(1, Math.round(seconds / 60));
    }

    /** 通勤行里的路线细节：公共交通显示换乘链（含换乘站）+ 首末站，其余显示真实里程 */
    function routeRowDetail(route) {
        if (route.rides && route.rides.length) {
            var first = route.rides[0];
            var last = route.rides[route.rides.length - 1];
            if (route.rides.length === 1) {
                return first.line + (first.from && first.to ? ' · ' + first.from + ' → ' + first.to : '');
            }
            var names = route.rides.map(function (ride) { return ride.line; }).join(' → ');
            var transfers = [];
            for (var i = 1; i < route.rides.length; i++) {
                var point = route.rides[i].from || route.rides[i - 1].to;
                if (point && transfers.indexOf(point) === -1) transfers.push(point);
            }
            var text = names + (transfers.length ? '（' + transfers.join('、') + '换乘）' : '');
            if (first.from && last.to) text += ' · ' + first.from + ' → ' + last.to;
            return text;
        }
        if (route.distance) return routeKm(route.distance);
        return '';
    }

    /** 通勤行完整文字：方式 · 时长 · 路线细节（无真实路线时用直线兜底） · 备注 */
    function legRowText(entry, km, route) {
        if (entry.legMode === 'other') {
            return '其他方式' + (entry.legNote ? '：' + entry.legNote : '');
        }
        if (!entry.legMode) {
            return entry.legMinutes !== null
                ? '约 ' + entry.legMinutes + ' 分（自动估算，点此设置）'
                : '点此选择通勤方式';
        }
        var parts = [LEG_MODE_LABELS[entry.legMode]];
        if (route && route.time) {
            parts.push('约 ' + routeMinutes(route.time) + ' 分');
        } else if (entry.legMinutes !== null) {
            parts.push('约 ' + entry.legMinutes + ' 分');
        }
        if (route) {
            var detail = routeRowDetail(route);
            if (detail) parts.push(detail);
        } else {
            parts.push('直线 ' + km.toFixed(1) + ' km');
        }
        if (entry.legNote) parts.push(entry.legNote);
        return parts.join(' · ');
    }

    /** 通勤设置里的高德真实路线说明（每段乘车含上/下车站，换乘点一目了然） */
    function modalRouteText(route) {
        var parts = [];
        if (route.time) parts.push('约 ' + routeMinutes(route.time) + ' 分');
        if (route.rides && route.rides.length) {
            var chain = route.rides.map(function (ride) {
                return ride.line + (ride.from && ride.to ? '（' + ride.from + ' → ' + ride.to + '）' : '');
            }).join(' → ');
            parts.push(chain);
            if (route.walking) parts.push('步行约 ' + routeKm(route.walking));
        } else if (route.distance) {
            parts.push(routeKm(route.distance));
        }
        return '高德路线：' + parts.join(' · ');
    }

    /** 无高德路线时的本地估算说明（兜底） */
    function legEstimateText(mode, km) {
        var text = '两站直线距离 ' + km.toFixed(1) + ' km';
        if (mode === 'other') {
            text += ' · 其他方式不估算时间';
        } else {
            var minutes = Store.estimateLegMinutes(mode, km);
            if (minutes !== null) {
                var label = mode ? LEG_MODE_LABELS[mode] : (km <= 1.8 ? '步行' : '驾车');
                text += ' · ' + label + '约 ' + minutes + ' 分钟（含绕路修正' + (mode ? '）' : '，自动估算）');
            }
        }
        return text;
    }

    /** 全程统一编号：按「天序 → 天内序」给每个地点分配连续字母（A、B、…、Z；超过 26 个后用 27、28…） */
    function buildStopLabels(state) {
        var labels = {};
        var count = 0;
        state.days.forEach(function (day) {
            day.items.forEach(function (item) {
                if (item.disabled || labels[item.placeId]) return;
                if (!state.places.some(function (p) { return p.id === item.placeId; })) return;
                labels[item.placeId] = count < 26 ? String.fromCharCode(65 + count) : String(count + 1);
                count++;
            });
        });
        return labels;
    }

    /** 编号展示文本：A →「A 站」；27 →「第 27 站」 */
    function stopLabelText(label) {
        return /^[0-9]+$/.test(label) ? '第 ' + label + ' 站' : label + ' 站';
    }

    /** 这段通勤在整段行程里需要走的次数（同一对地点去/回都算，跨天累计） */
    function countLegTrips(state, placeIdA, placeIdB) {
        if (!placeIdA || !placeIdB || placeIdA === placeIdB) return 0;
        var key = placeIdA < placeIdB ? placeIdA + '|' + placeIdB : placeIdB + '|' + placeIdA;
        var count = 0;
        state.days.forEach(function (day) {
            var stops = day.items
                .filter(function (item) { return !item.disabled; })
                .map(function (item) { return item.placeId; });
            for (var i = 1; i < stops.length; i++) {
                var a = stops[i - 1];
                var b = stops[i];
                if (a === b) continue;
                var pair = a < b ? a + '|' + b : b + '|' + a;
                if (pair === key) count += 1;
            }
        });
        return count;
    }

    /** 连线颜色：粉色系渐深（走 1 次 → 4 次以上） */
    function legTravelColor(trips) {
        if (trips >= 4) return '#8247d1';
        if (trips === 3) return '#ad41c3';
        if (trips === 2) return '#d64397';
        return '#f261a8';
    }

    /** '2026-10-03' → '10月3日 周六' */
    function formatDateLabel(dateStr) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return '';
        var parts = dateStr.split('-').map(Number);
        var value = new Date(parts[0], parts[1] - 1, parts[2]);
        var week = ['日', '一', '二', '三', '四', '五', '六'][value.getDay()];
        return parts[1] + '月' + parts[2] + '日 周' + week;
    }

    /** 天标签：有日期时显示「10月3日」，否则显示天名 */
    function dayTabLabel(day) {
        if (day.date) {
            var label = formatDateLabel(day.date);
            return label.split(' ')[0] || day.name;
        }
        return day.name;
    }

    /** 折线抽稀：点太密时均匀采样，保留首尾（控制 setData 体积） */
    function reducePath(points, maxPoints) {
        var max = maxPoints || 900;
        if (!points || points.length <= max) return points || [];
        var step = points.length / max;
        var out = [];
        for (var i = 0; i < max - 1; i++) {
            out.push(points[Math.floor(i * step)]);
        }
        out.push(points[points.length - 1]);
        return out;
    }

    module.exports = {
        LEG_MODE_LABELS: LEG_MODE_LABELS,
        LEG_MODE_ORDER: LEG_MODE_ORDER,
        formatMoney: formatMoney,
        routeKm: routeKm,
        routeMinutes: routeMinutes,
        routeRowDetail: routeRowDetail,
        legRowText: legRowText,
        modalRouteText: modalRouteText,
        legEstimateText: legEstimateText,
        buildStopLabels: buildStopLabels,
        stopLabelText: stopLabelText,
        countLegTrips: countLegTrips,
        legTravelColor: legTravelColor,
        formatDateLabel: formatDateLabel,
        dayTabLabel: dayTabLabel,
        reducePath: reducePath
    };
})();
