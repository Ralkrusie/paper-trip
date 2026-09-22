/**
 * 拾途 Paper Trip · 主页面
 * 地图（微信 map 组件）+ 底部抽屉（行程 / 地点 / 设置）。
 * 地图渲染与交互说明：
 *   - 底图由微信 map 组件提供（腾讯底图），路线数据来自高德 Web 服务（REST）；
 *   - 真实路线沿道路/线路画实线，未获取到时画虚线直连（与网页版一致）；
 *   - 流动箭头按全程路径循环运动；「浏览」模式下镜头跟随箭头跑一遍。
 */
var StoreModule = require('../../utils/store.js');
var Store = StoreModule.Store;
var Routes = require('../../utils/routes.js');
var Fmt = require('../../utils/format.js');
var amap = require('../../utils/amap.js');

var CATEGORY_ICONS = {
    transport: 'marker-teal',
    hotel: 'marker-blue',
    dining: 'marker-orange',
    activity: 'marker-red'
};

var FLOW_HOLD = 1200;      // 每趟跑完停留（毫秒）再循环
var TICK_MS = 120;         // 箭头/镜头刷新节流（小程序 setData 不宜过密）

/** 按累计弧长取路径插值点 + 行进方位角（0 = 正北，顺时针；与 marker rotate 一致） */
function pointAlong(flow, targetKm) {
    var path = flow.path;
    var cum = flow.cum;
    for (var i = 1; i < cum.length; i++) {
        if (targetKm <= cum[i]) {
            var seg = cum[i] - cum[i - 1];
            var ratio = seg > 0 ? (targetKm - cum[i - 1]) / seg : 0;
            var lng1 = path[i - 1][0];
            var lat1 = path[i - 1][1];
            var lng2 = path[i][0];
            var lat2 = path[i][1];
            var midLat = ((lat1 + lat2) / 2) * Math.PI / 180;
            var angle = Math.atan2((lng2 - lng1) * Math.cos(midLat), lat2 - lat1) * 180 / Math.PI;
            return {
                lng: lng1 + (lng2 - lng1) * ratio,
                lat: lat1 + (lat2 - lat1) * ratio,
                angle: angle
            };
        }
    }
    var last = path[path.length - 1];
    var before = path.length > 1 ? path[path.length - 2] : last;
    var endLat = ((before[1] + last[1]) / 2) * Math.PI / 180;
    return {
        lng: last[0],
        lat: last[1],
        angle: Math.atan2((last[0] - before[0]) * Math.cos(endLat), last[1] - before[1]) * 180 / Math.PI
    };
}

/** 两点球面距离（km） */
function distanceKm(a, b) {
    var toRad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * toRad;
    var dLng = (b[0] - a[0]) * toRad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** 由全程路径构建流动数据（累计距离 / 总长 / 循环与浏览时长） */
function buildFlow(points) {
    var path = [];
    (points || []).forEach(function (point) {
        var last = path[path.length - 1];
        if (!last || Math.abs(last[0] - point[0]) > 1e-6 || Math.abs(last[1] - point[1]) > 1e-6) {
            path.push([point[0], point[1]]);
        }
    });
    if (path.length < 2) return null;

    var cum = [0];
    for (var i = 1; i < path.length; i++) {
        cum.push(cum[i - 1] + distanceKm(path[i - 1], path[i]));
    }
    var totalKm = cum[cum.length - 1];
    if (totalKm < 0.05) return null;

    return {
        path: path,
        cum: cum,
        totalKm: totalKm,
        totalMs: Math.min(45000, Math.max(12000, totalKm * 2200)),
        tourMs: Math.min(70000, Math.max(18000, totalKm * 2600))
    };
}

Page({
    data: {
        tab: 'itinerary',
        sheetOpen: false,

        // 地图
        mapCenter: { longitude: 121.4737, latitude: 31.2304 },
        mapScale: 11,
        mapSetting: { enableSatellite: false, enable3D: false, skew: 0, showScale: false, enableRotate: false },
        includePoints: [],
        markers: [],
        polylines: [],
        hasPlaces: false,
        hasFlow: false,
        touring: false,
        pickMode: false,
        keyMissing: true,

        // 行程
        activeDayId: '',
        days: [],
        dayMeta: '',
        rows: [],
        disabledRows: [],
        activePlaceId: '',

        // 地点库
        libFilter: 'all',
        libKeyword: '',
        libCategories: [],
        placesTotal: 0,
        places: [],

        // 设置
        tripTitle: '',
        tripNote: '',
        amapKey: '',
        satellite: false,
        view3D: false,
        importText: '',

        // 弹层
        dayEdit: { open: false, dayId: '', name: '', date: '' },
        canDeleteDay: false,
        dayPicker: { open: false, placeId: '', placeName: '', days: [] },
        today: ''
    },

    onLoad: function () {
        this._markerMap = {};       // markerId -> placeId
        this._flow = null;
        this._timer = null;
        this._epoch = 0;
        this._tourStart = null;
        this._tourMs = 0;
        this._refreshTimer = null;
        this._destroyed = false;

        if (!Store.state) Store.init();

        var now = new Date();
        var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' +
            ('0' + now.getDate()).slice(-2);
        this.setData({ today: today });

        var self = this;
        Routes.onChange(function () { self.scheduleRouteRefresh(); });

        // 恢复上次地图视野；首次进入且已有行程时自动全图
        var view = Store.state.view || {};
        this.setData({
            mapCenter: { longitude: view.lng, latitude: view.lat },
            mapScale: Math.min(20, Math.max(3, view.zoom || 11))
        });
        if (Store.state.places.length >= 2) {
            var selfFit = this;
            setTimeout(function () { selfFit.fitAll(); }, 300);
        }

        this.refreshAll();
        this.startFlowTimer();
    },

    onShow: function () {
        this.refreshAll();
        this.startFlowTimer();
    },

    onHide: function () { this.stopFlowTimer(); },
    onUnload: function () {
        this._destroyed = true;
        this.stopFlowTimer();
    },

    onShareAppMessage: function () {
        return { title: '拾途 Paper Trip · ' + (Store.state.trip.title || '我的行程') };
    },

    /* ================= 刷新 ================= */

    refreshAll: function () {
        if (this._destroyed) return;
        var state = Store.state;
        if (!Store.getDay(this.data.activeDayId)) {
            this.setData({ activeDayId: state.days[0].id });
        }
        wx.setNavigationBarTitle({ title: state.trip.title || '拾途 Paper Trip' });

        this.refreshDayTabs();
        this.refreshItinerary();
        this.refreshMap();
        this.refreshLibrary();
        this.refreshSettings();
        this.ensureRoutes();
    },

    refreshDayTabs: function () {
        var activeDayId = this.data.activeDayId;
        var days = Store.state.days.map(function (day) {
            return {
                id: day.id,
                label: Fmt.dayTabLabel(day),
                active: day.id === activeDayId
            };
        });
        this.setData({ days: days });
    },

    refreshItinerary: function () {
        var self = this;
        var day = Store.getDay(this.data.activeDayId);
        if (!day) return;

        var stats = Store.dayStats(day);
        var timeline = Store.computeTimeline(day, Routes.realLegMinutesFor(day));
        var labels = Fmt.buildStopLabels(Store.state);

        var rows = [];
        timeline.forEach(function (entry, index) {
            var place = entry.place;
            if (!place) return;
            var category = Store.getCategory(place.categoryId);

            var chips = [];
            if (entry.fixed) {
                chips.push({ text: entry.item.time, cls: 'is-fixed' });
            } else if (entry.start !== null) {
                chips.push({ text: '约 ' + Store.formatMinutes(entry.start), cls: 'is-est' });
            } else {
                chips.push({ text: '时间待定', cls: 'is-est' });
            }
            if (entry.item.stay) chips.push({ text: '停留 ' + entry.item.stay + ' 分', cls: '' });
            if (entry.late) chips.push({ text: '⚠ 迟到 ' + entry.lateBy + ' 分', cls: 'is-late' });

            rows.push({
                type: 'item',
                key: entry.item.id,
                id: entry.item.id,
                name: place.name,
                color: category ? category.color : '#3f7e73',
                badge: labels[place.id] || String(index + 1),
                chips: chips,
                note: entry.item.note || '',
                late: entry.late,
                active: place.id === self.data.activePlaceId
            });

            // 通勤行（高铁/动车班次按约定写入备注）
            if (index < timeline.length - 1 && timeline[index + 1].place) {
                var nextPlace = timeline[index + 1].place;
                var km = StoreModule.computeDistKm(place.lat, place.lng, nextPlace.lat, nextPlace.lng);
                var cached = Routes.fetchable(entry.legMode)
                    ? Routes.get(entry.legMode, place, nextPlace)
                    : undefined;
                var route = cached === undefined ? null : cached;
                var text = Fmt.legRowText(entry, km, route);
                var trips = Fmt.countLegTrips(Store.state, place.id, nextPlace.id);
                if (trips >= 2) text += ' · ×' + trips;
                rows.push({
                    type: 'leg',
                    key: entry.item.id + '-leg',
                    id: entry.item.id + '-leg',
                    itemId: entry.item.id,
                    text: '↓ ' + text,
                    color: Fmt.legTravelColor(trips)
                });
            }
        });

        var disabledRows = day.items.filter(function (item) { return item.disabled; })
            .map(function (item) {
                var place = Store.getPlace(item.placeId);
                if (!place) return null;
                var subParts = [];
                if (item.time) subParts.push(item.time);
                if (item.stay) subParts.push('停留 ' + item.stay + ' 分');
                return { id: item.id, name: place.name, sub: subParts.join(' · ') };
            })
            .filter(Boolean);

        // 当天概要（与网页版一致）
        var parts = [day.name];
        if (day.date && Fmt.dayTabLabel(day) !== day.name) parts.push(Fmt.formatDateLabel(day.date));
        parts.push(stats.count + ' 站');
        if (stats.disabledCount) parts.push('已移除 ' + stats.disabledCount);
        parts.push('直线 ' + stats.distance.toFixed(1) + ' km');
        var starts = timeline.filter(function (entry) { return entry.start !== null; });
        var ends = timeline.filter(function (entry) { return entry.end !== null; });
        if (starts.length && ends.length) {
            parts.push(Store.formatMinutes(starts[0].start) + '–' + Store.formatMinutes(ends[ends.length - 1].end));
        }
        var lateCount = timeline.filter(function (entry) { return entry.late; }).length;
        if (lateCount) parts.push('⚠ 迟到 ' + lateCount + ' 处');

        this.setData({
            rows: rows,
            disabledRows: disabledRows,
            dayMeta: parts.join(' · ')
        });
    },

    refreshMap: function () {
        var self = this;
        if (this.data.touring) this.setData({ touring: false });

        var model = this.buildMapModel();
        var markers = [];

        this._flow = model.flowPath.length >= 2 ? buildFlow(model.flowPath) : null;
        if (this._flow) {
            markers.push({
                id: 0,
                longitude: this._flow.path[0][0],
                latitude: this._flow.path[0][1],
                iconPath: '/assets/arrow.png',
                width: 22,
                height: 22,
                anchor: { x: 0.5, y: 0.5 },
                rotate: 0,
                zIndex: 99
            });
        } else {
            this._epoch = 0;
        }

        this._markerMap = {};
        model.points.forEach(function (point, index) {
            var id = index + 1;
            self._markerMap[id] = point.placeId;
            var icon = CATEGORY_ICONS[point.categoryId] || 'marker-gray';
            var marker = {
                id: id,
                longitude: point.lng,
                latitude: point.lat,
                iconPath: '/assets/' + icon + '.png',
                width: point.isPlanned ? 28 : 14,
                height: point.isPlanned ? 28 : 14,
                anchor: { x: 0.5, y: 0.5 },
                zIndex: point.isPlanned ? 60 : 40
            };
            if (point.isPlanned) {
                marker.label = {
                    content: point.label,
                    color: '#fffdf6',
                    fontSize: 13,
                    anchorX: -(String(point.label).length * 4.2 + 1),
                    anchorY: -7
                };
            }
            markers.push(marker);
        });

        var polylines = model.lines.map(function (line) {
            var isReal = !!(line.realPath && line.realPath.length >= 2);
            var points = Fmt.reducePath(isReal ? line.realPath : line.path, 900);
            return {
                points: points.map(function (pair) {
                    return { longitude: pair[0], latitude: pair[1] };
                }),
                color: line.color,
                width: 4,
                dottedLine: !isReal,
                level: 'aboveroads'
            };
        });

        this.setData({
            markers: markers,
            polylines: polylines,
            hasFlow: Boolean(this._flow),
            hasPlaces: model.points.length > 0
        });
    },

    /** 与网页版一致的模型：编号地点 + 按天连续路径（真实路线优先）+ 全程流动路径 */
    buildMapModel: function () {
        var labels = Fmt.buildStopLabels(Store.state);

        var points = Store.state.places.map(function (place) {
            var label = labels[place.id] || null;
            return {
                placeId: place.id,
                name: place.name,
                lng: place.lng,
                lat: place.lat,
                categoryId: place.categoryId,
                isPlanned: Boolean(label),
                label: label
            };
        });

        var flowPath = [];
        var lines = [];
        var drawnPairs = {};
        var prev = null;

        function pushFlowPoint(point) {
            var last = flowPath[flowPath.length - 1];
            if (!last || Math.abs(last[0] - point[0]) > 1e-6 || Math.abs(last[1] - point[1]) > 1e-6) {
                flowPath.push(point);
            }
        }

        Store.state.days.forEach(function (day) {
            day.items.forEach(function (item) {
                if (item.disabled) return;
                var place = Store.getPlace(item.placeId);
                if (!place) return;

                if (!prev) {
                    pushFlowPoint([place.lng, place.lat]);
                    prev = { item: item, place: place };
                    return;
                }
                if (prev.place.id === place.id) {
                    prev = { item: item, place: place };
                    return;
                }

                var mode = (prev.item.leg && prev.item.leg.mode) || '';
                var cached = Routes.fetchable(mode) ? Routes.get(mode, prev.place, place) : undefined;
                var route = cached === undefined ? null : cached;
                var realPath = route && route.path && route.path.length >= 2 ? route.path : null;

                if (realPath) {
                    realPath.forEach(pushFlowPoint);
                } else {
                    pushFlowPoint([prev.place.lng, prev.place.lat]);
                    pushFlowPoint([place.lng, place.lat]);
                }

                var pairKey = prev.place.id < place.id
                    ? prev.place.id + '|' + place.id
                    : place.id + '|' + prev.place.id;
                if (!drawnPairs[pairKey]) {
                    drawnPairs[pairKey] = true;
                    lines.push({
                        color: Fmt.legTravelColor(Fmt.countLegTrips(Store.state, prev.place.id, place.id)),
                        path: [[prev.place.lng, prev.place.lat], [place.lng, place.lat]],
                        realPath: realPath
                    });
                }

                prev = { item: item, place: place };
            });
        });

        return { points: points, lines: lines, flowPath: flowPath };
    },

    refreshLibrary: function () {
        var filter = this.data.libFilter;
        var keyword = (this.data.libKeyword || '').trim().toLowerCase();

        var counts = {};
        Store.state.places.forEach(function (place) {
            counts[place.categoryId] = (counts[place.categoryId] || 0) + 1;
        });
        var libCategories = [];
        Store.state.categories.forEach(function (category) {
            if (counts[category.id]) {
                libCategories.push({ id: category.id, name: category.name, count: counts[category.id] });
            }
        });

        var places = Store.state.places.filter(function (place) {
            if (filter !== 'all' && place.categoryId !== filter) return false;
            if (!keyword) return true;
            return (place.name + ' ' + place.address).toLowerCase().indexOf(keyword) !== -1;
        }).map(function (place) {
            var category = Store.getCategory(place.categoryId);
            var usage = Store.placeUsage(place.id);
            var seen = {};
            var dayNames = [];
            usage.forEach(function (entry) {
                if (seen[entry.dayName]) return;
                seen[entry.dayName] = true;
                dayNames.push(entry.dayName);
            });
            return {
                id: place.id,
                name: place.name,
                color: category ? category.color : '#3f7e73',
                catName: category ? category.name : '',
                address: place.address || '',
                usageText: dayNames.length ? '已安排：' + dayNames.join('、') : '',
                active: place.id === this.data.activePlaceId
            };
        }, this);

        this.setData({
            libCategories: libCategories,
            placesTotal: Store.state.places.length,
            places: places
        });
    },

    refreshSettings: function () {
        var settings = Store.state.settings || {};
        var satellite = settings.satellite === true;
        var view3D = settings.view3D === true;
        this.setData({
            tripTitle: Store.state.trip.title,
            tripNote: Store.state.trip.note || '',
            amapKey: settings.amapKey || '',
            keyMissing: !amap.keyReady(),
            satellite: satellite,
            view3D: view3D,
            mapSetting: {
                enableSatellite: satellite,
                enable3D: view3D,
                skew: view3D ? 30 : 0,
                showScale: false,
                enableRotate: false
            }
        });
    },

    /* ================= 真实路线：拉取与节流刷新 ================= */

    ensureRoutes: function () {
        var self = this;
        Store.state.days.forEach(function (day) {
            var active = day.items.filter(function (item) { return !item.disabled; });
            for (var i = 0; i + 1 < active.length; i++) {
                var mode = (active[i].leg && active[i].leg.mode) || '';
                if (!Routes.fetchable(mode)) continue;
                var from = Store.getPlace(active[i].placeId);
                var to = Store.getPlace(active[i + 1].placeId);
                if (!from || !to) continue;
                if (StoreModule.computeDistKm(from.lat, from.lng, to.lat, to.lng) < 0.05) continue;
                if (Routes.get(mode, from, to) !== undefined) continue;
                Routes.request(mode, from, to).then(function () { self.scheduleRouteRefresh(); });
            }
        });
    },

    scheduleRouteRefresh: function () {
        var self = this;
        if (this._destroyed || this._refreshTimer) return;
        this._refreshTimer = setTimeout(function () {
            self._refreshTimer = null;
            if (self._destroyed) return;
            self.refreshItinerary();
            self.refreshMap();
        }, 80);
    },

    /* ================= 流动箭头 / 路线浏览 ================= */

    startFlowTimer: function () {
        var self = this;
        if (this._timer) return;
        this._timer = setInterval(function () { self.tick(); }, TICK_MS);
    },

    stopFlowTimer: function () {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    },

    tick: function () {
        var flow = this._flow;
        if (!flow || !this.data.hasFlow) return;

        var now = Date.now();
        if (this.data.touring) {
            if (this._tourStart === null) this._tourStart = now;
            var frac = Math.min((now - this._tourStart) / this._tourMs, 1);
            var pos = pointAlong(flow, frac * flow.totalKm);
            this.setData({
                'markers[0].longitude': pos.lng,
                'markers[0].latitude': pos.lat,
                'markers[0].rotate': pos.angle,
                mapCenter: { longitude: pos.lng, latitude: pos.lat }
            });
            if (frac >= 1) this.endTour('done');
            return;
        }

        if (!this._epoch) this._epoch = now;
        var elapsed = now - this._epoch;
        var cycleMs = flow.totalMs + FLOW_HOLD;
        var loopFrac = Math.min((elapsed % cycleMs) / flow.totalMs, 1);
        var loopPos = pointAlong(flow, loopFrac * flow.totalKm);
        this.setData({
            'markers[0].longitude': loopPos.lng,
            'markers[0].latitude': loopPos.lat,
            'markers[0].rotate': loopPos.angle
        });
    },

    toggleTour: function () {
        if (this.data.touring) {
            this.endTour('stopped');
            return;
        }
        if (!this._flow || !this.data.hasFlow) {
            wx.showToast({ title: '当前没有可浏览的路线', icon: 'none' });
            return;
        }
        this._tourStart = null;
        this._tourMs = this._flow.tourMs;
        var update = { touring: true };
        if (this.data.mapScale < 14) update.mapScale = 14;
        this.setData(update);
    },

    endTour: function (reason) {
        if (!this.data.touring) return;
        this.setData({ touring: false });
        if (reason === 'done') {
            wx.showToast({ title: '路线浏览完成', icon: 'none' });
            this.fitAll();
        }
    },

    /* ================= 地图交互 ================= */

    fitAll: function () {
        var points = Store.state.places.map(function (place) {
            return { longitude: place.lng, latitude: place.lat };
        });
        if (!points.length) {
            wx.showToast({ title: '还没有地点', icon: 'none' });
            return;
        }
        if (points.length === 1) {
            this.setData({ mapCenter: points[0], mapScale: 15 });
            return;
        }
        this.setData({ includePoints: points });
    },

    locate: function () {
        var self = this;
        wx.getLocation({
            type: 'gcj02',
            success: function (res) {
                self.setData({
                    mapCenter: { longitude: res.longitude, latitude: res.latitude },
                    mapScale: 15
                });
            },
            fail: function () {
                wx.showToast({ title: '定位不可用（未授权或系统关闭）', icon: 'none' });
            }
        });
    },

    onMarkerTap: function (event) {
        var id = event.detail && event.detail.markerId;
        if (!id || id === 0) return;
        var placeId = this._markerMap[id];
        if (placeId) this.selectPlace(placeId);
    },

    selectPlace: function (placeId) {
        var place = Store.getPlace(placeId);
        if (!place) return;
        var usage = Store.placeUsage(placeId);
        var update = {
            activePlaceId: placeId,
            mapCenter: { longitude: place.lng, latitude: place.lat }
        };
        if (this.data.mapScale < 14) update.mapScale = 14;
        if (usage.length && usage[0].dayId !== this.data.activeDayId) {
            update.activeDayId = usage[0].dayId;
        }
        this.setData(update);
        this.refreshDayTabs();
        this.refreshItinerary();
        this.refreshLibrary();
    },

    onMapTap: function (event) {
        var detail = event.detail || {};
        if (this.data.pickMode) {
            if (!isFinite(detail.longitude) || !isFinite(detail.latitude)) return;
            this.setData({ pickMode: false, sheetOpen: false });
            wx.navigateTo({
                url: '/pages/place/place?lng=' + detail.longitude + '&lat=' + detail.latitude
            });
        }
    },

    onRegionChange: function (event) {
        if (event.type !== 'end') return;
        var detail = event.detail || {};
        var center = detail.centerLocation || {};
        if (isFinite(center.longitude) && isFinite(center.latitude)) {
            Store.updateView({ lng: center.longitude, lat: center.latitude, zoom: detail.scale });
        }
    },

    /* ================= 抽屉 / 标签 ================= */

    toggleSheet: function () {
        this.setData({ sheetOpen: !this.data.sheetOpen });
    },

    closeSheet: function () {
        this.setData({ sheetOpen: false });
    },

    switchTab: function (event) {
        this.setData({ tab: event.currentTarget.dataset.tab });
    },

    noop: function () { /* 阻止弹层内点击穿透 */ },

    /* ================= 天 ================= */

    onDayTap: function (event) {
        this.setActiveDay(event.currentTarget.dataset.id);
    },

    setActiveDay: function (dayId) {
        if (!Store.getDay(dayId)) return;
        if (this.data.touring) this.endTour('stopped');
        this.setData({ activeDayId: dayId });
        this.refreshDayTabs();
        this.refreshItinerary();
    },

    onAddDay: function () {
        var day = Store.addDay();
        this.setActiveDay(day.id);
        wx.showToast({ title: '已新增 ' + day.name, icon: 'none' });
    },

    onDayLongPress: function (event) {
        var dayId = event.currentTarget.dataset.id;
        var day = Store.getDay(dayId);
        if (!day) return;
        var self = this;
        wx.showActionSheet({
            itemList: ['编辑名称与日期', '删除这一天'],
            itemColor: '#1e302c',
            success: function (res) {
                if (res.tapIndex === 0) {
                    self.openDayEdit(dayId);
                } else if (res.tapIndex === 1) {
                    if (Store.state.days.length <= 1) {
                        wx.showToast({ title: '至少保留一天', icon: 'none' });
                        return;
                    }
                    wx.showModal({
                        title: '删除这一天？',
                        content: '「' + day.name + '」里的全部行程项将一并删除。',
                        confirmText: '删除',
                        confirmColor: '#b23a22',
                        success: function (modal) {
                            if (!modal.confirm) return;
                            Store.removeDay(dayId);
                            if (!Store.getDay(self.data.activeDayId)) {
                                self.setData({ activeDayId: Store.state.days[0].id });
                            }
                            self.refreshAll();
                            wx.showToast({ title: '已删除', icon: 'none' });
                        }
                    });
                }
            }
        });
    },

    openDayEdit: function (dayId) {
        var day = Store.getDay(dayId);
        if (!day) return;
        this.setData({
            dayEdit: { open: true, dayId: dayId, name: day.name, date: day.date || '' },
            canDeleteDay: Store.state.days.length > 1
        });
    },

    closeDayEdit: function () {
        this.setData({ 'dayEdit.open': false });
    },

    onDayEditName: function (event) {
        this.setData({ 'dayEdit.name': event.detail.value });
    },

    onDayEditDate: function (event) {
        this.setData({ 'dayEdit.date': event.detail.value });
    },

    clearDayDate: function () {
        this.setData({ 'dayEdit.date': '' });
    },

    saveDayEdit: function () {
        var draft = this.data.dayEdit;
        Store.updateDay(draft.dayId, { name: draft.name, date: draft.date });
        this.setData({ 'dayEdit.open': false });
        this.refreshAll();
        wx.showToast({ title: '已保存', icon: 'none' });
    },

    deleteDay: function () {
        var self = this;
        var dayId = this.data.dayEdit.dayId;
        var day = Store.getDay(dayId);
        if (!day) return;
        wx.showModal({
            title: '删除这一天？',
            content: '「' + day.name + '」里的全部行程项将一并删除。',
            confirmText: '删除',
            confirmColor: '#b23a22',
            success: function (modal) {
                if (!modal.confirm) return;
                Store.removeDay(dayId);
                if (!Store.getDay(self.data.activeDayId)) {
                    self.setData({ activeDayId: Store.state.days[0].id });
                }
                self.setData({ 'dayEdit.open': false });
                self.refreshAll();
                wx.showToast({ title: '已删除', icon: 'none' });
            }
        });
    },

    /* ================= 行程项 ================= */

    onItemTap: function (event) {
        var id = event.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({ url: '/pages/item/item?id=' + id });
    },

    onItemEdit: function (event) {
        var id = event.currentTarget.dataset.id;
        if (id) wx.navigateTo({ url: '/pages/item/item?id=' + id });
    },

    onLegTap: function (event) {
        var id = event.currentTarget.dataset.itemId;
        if (id) wx.navigateTo({ url: '/pages/item/item?id=' + id + '&focus=leg' });
    },

    onItemRemove: function (event) {
        var self = this;
        var id = event.currentTarget.dataset.id;
        var found = Store.findItem(id);
        if (!found) return;
        var place = Store.getPlace(found.item.placeId);
        wx.showModal({
            title: '移除该站点？',
            content: '「' + (place ? place.name : '该站点') + '」将从当天移除，可在当天最下方恢复。',
            confirmText: '移除',
            confirmColor: '#b23a22',
            success: function (modal) {
                if (!modal.confirm) return;
                Store.setItemDisabled(id, true);
                self.refreshItinerary();
                self.refreshMap();
                wx.showToast({ title: '已移除，可在下方恢复', icon: 'none' });
            }
        });
    },

    onRestoreItem: function (event) {
        var id = event.currentTarget.dataset.id;
        Store.setItemDisabled(id, false);
        this.refreshItinerary();
        this.refreshMap();
        wx.showToast({ title: '已恢复该站点', icon: 'none' });
    },

    onPurgeItem: function (event) {
        var self = this;
        var id = event.currentTarget.dataset.id;
        wx.showModal({
            title: '彻底删除？',
            content: '删除后无法恢复。',
            confirmText: '删除',
            confirmColor: '#b23a22',
            success: function (modal) {
                if (!modal.confirm) return;
                Store.removeItem(id);
                self.refreshItinerary();
                self.refreshMap();
                wx.showToast({ title: '已删除', icon: 'none' });
            }
        });
    },

    /* ================= 地点库 ================= */

    onLibFilter: function (event) {
        this.setData({ libFilter: event.currentTarget.dataset.id });
        this.refreshLibrary();
    },

    onLibKeyword: function (event) {
        this.setData({ libKeyword: event.detail.value });
        this.refreshLibrary();
    },

    goSearchPlace: function () {
        wx.navigateTo({ url: '/pages/place/place?mode=search' });
    },

    onPickMode: function () {
        var next = !this.data.pickMode;
        this.setData({ pickMode: next, sheetOpen: false });
        wx.showToast({
            title: next ? '点击地图任意位置添加地点' : '已退出点图添加',
            icon: 'none'
        });
    },

    onPlaceTap: function (event) {
        var id = event.currentTarget.dataset.id;
        if (id) wx.navigateTo({ url: '/pages/place/place?id=' + id });
    },

    onPlaceAddToDay: function (event) {
        var placeId = event.currentTarget.dataset.id;
        var place = Store.getPlace(placeId);
        if (!place) return;
        this.setData({
            dayPicker: {
                open: true,
                placeId: placeId,
                placeName: place.name,
                days: Store.state.days.map(function (day) {
                    return {
                        id: day.id,
                        label: Fmt.dayTabLabel(day) + (day.date ? ' · ' + Fmt.formatDateLabel(day.date) : '')
                    };
                })
            }
        });
    },

    closeDayPicker: function () {
        this.setData({ 'dayPicker.open': false });
    },

    onDayPickerPick: function (event) {
        var dayId = event.currentTarget.dataset.id;
        var placeId = this.data.dayPicker.placeId;
        var day = Store.getDay(dayId);
        if (!day || !placeId) return;
        Store.addItem(dayId, placeId);
        this.setData({ 'dayPicker.open': false });
        this.setActiveDay(dayId);
        this.refreshMap();
        wx.showToast({ title: '已加入 ' + day.name, icon: 'none' });
    },

    onDayPickerNew: function () {
        var placeId = this.data.dayPicker.placeId;
        if (!placeId) return;
        var day = Store.addDay();
        Store.addItem(day.id, placeId);
        this.setData({ 'dayPicker.open': false });
        this.setActiveDay(day.id);
        this.refreshMap();
        wx.showToast({ title: '已新建 ' + day.name + ' 并加入', icon: 'none' });
    },

    /* ================= 设置 ================= */

    onTripTitle: function (event) {
        this.setData({ tripTitle: event.detail.value });
    },

    onTripNote: function (event) {
        this.setData({ tripNote: event.detail.value });
    },

    saveTripInfo: function () {
        Store.updateTrip({ title: this.data.tripTitle, note: this.data.tripNote });
        wx.setNavigationBarTitle({ title: Store.state.trip.title || '拾途 Paper Trip' });
        wx.showToast({ title: '行程信息已保存', icon: 'none' });
    },

    onAmapKey: function (event) {
        this.setData({ amapKey: event.detail.value });
    },

    saveAmapKey: function () {
        var self = this;
        var key = (this.data.amapKey || '').trim();
        Store.updateSettings({ amapKey: key });
        this.setData({ keyMissing: !amap.keyReady() });
        if (!key) {
            wx.showToast({
                title: amap.keyReady() ? '已清空手动填写（仍使用内置 Key）' : '已清空 Key',
                icon: 'none'
            });
            return;
        }
        wx.showToast({ title: '已保存，正在获取路线…', icon: 'none' });
        this.ensureRoutes();
        setTimeout(function () {
            self.refreshItinerary();
            self.refreshMap();
        }, 1200);
    },

    onSatelliteChange: function (event) {
        var value = Boolean(event.detail.value);
        Store.updateSettings({ satellite: value });
        this.setData({
            satellite: value,
            'mapSetting.enableSatellite': value
        });
    },

    onView3DChange: function (event) {
        var value = Boolean(event.detail.value);
        Store.updateSettings({ view3D: value });
        this.setData({
            view3D: value,
            'mapSetting.enable3D': value,
            'mapSetting.skew': value ? 30 : 0
        });
    },

    goStats: function () {
        wx.navigateTo({ url: '/pages/stats/stats' });
    },

    openSettingsHint: function () {
        this.setData({ sheetOpen: true, tab: 'settings' });
    },

    exportData: function () {
        wx.setClipboardData({
            data: Store.exportJSON(),
            success: function () {
                wx.showToast({ title: '已复制备份（粘贴到备忘录保存）', icon: 'none' });
            }
        });
    },

    onImportText: function (event) {
        this.setData({ importText: event.detail.value });
    },

    doImport: function () {
        var self = this;
        var text = (this.data.importText || '').trim();
        if (!text) {
            wx.showToast({ title: '请先粘贴 JSON 内容', icon: 'none' });
            return;
        }
        wx.showModal({
            title: '导入数据？',
            content: '导入将覆盖当前的全部地点与行程，确定继续？',
            confirmText: '导入',
            success: function (modal) {
                if (!modal.confirm) return;
                try {
                    Store.importJSON(text);
                    self.setData({ activeDayId: Store.state.days[0].id, importText: '' });
                    self.refreshAll();
                    wx.showToast({ title: '导入成功', icon: 'none' });
                } catch (error) {
                    wx.showToast({ title: '导入失败：' + error.message, icon: 'none' });
                }
            }
        });
    },

    clearAll: function () {
        var self = this;
        wx.showModal({
            title: '清空全部数据？',
            content: '此操作不可撤销，建议先导出备份。',
            confirmText: '清空',
            confirmColor: '#b23a22',
            success: function (modal) {
                if (!modal.confirm) return;
                Store.reset();
                self.setData({ activeDayId: Store.state.days[0].id, activePlaceId: '' });
                self.refreshAll();
                wx.showToast({ title: '已清空，一切从零开始', icon: 'none' });
            }
        });
    }
});
