/**
 * 拾途 Paper Trip · 数据层
 * 管理地点库、多日行程与本地持久化（localStorage），并提供导入导出。
 * 数据结构：
 *   state = {
 *     version, trip: { title, note },
 *     categories: [{ id, name, color }],
 *     places: [{ id, name, lng, lat, categoryId, address, note }],
 *     days:   [{ id, name, date, items: [{
 *                id, placeId, time, stay, note,
 *                disabled,           // 软删除标记（变灰置底，可恢复）
 *                leg: { mode, note } // 到下一站的通勤方式与备注
 *              }] }],
 *     settings: { mapStyle, viewMode },
 *     view: { lng, lat, zoom }
 *   }
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'xingji.trip.v1';
    var listeners = [];
    var saveTimer = null;

    var DEFAULT_CATEGORIES = [
        { id: 'transport', name: '交通', color: '#2fa898' },
        { id: 'hotel', name: '住宿', color: '#3f7e93' },
        { id: 'dining', name: '餐饮', color: '#e8833a' },
        { id: 'activity', name: '活动', color: '#be4a2d' }
    ];

    /** 旧版分类 → 新版四类（交通 / 住宿 / 餐饮 / 活动） */
    var LEGACY_CATEGORY_MAP = {
        sight: 'activity',
        museum: 'activity',
        shopping: 'activity',
        other: 'activity',
        food: 'dining',
        hotel: 'hotel',
        transport: 'transport'
    };

    /** 通勤方式与估算速度（米/分钟）；extra 为固定附加时间（分钟，如候车/进出站） */
    var LEG_MODES = ['walk', 'bike', 'drive', 'taxi', 'bus', 'metro', 'rail', 'other'];
    var LEG_SPEED = { walk: 78, bike: 210, drive: 360, taxi: 360, bus: 280, metro: 550, rail: 800 };
    var LEG_EXTRA = { bus: 7, metro: 10, rail: 12 };
    /** 绕路系数：直线距离 → 实际路程（道路绕行，约 1.3 倍） */
    var LEG_DETOUR = 1.3;

    var DAY_COLORS = [
        '#2fa898', '#e8833a', '#be4a2d', '#3f7e93',
        '#7fa86b', '#c99a3a', '#5f9ea0', '#b58a6a'
    ];

    var DEFAULT_VIEW = { lng: 121.4737, lat: 31.2304, zoom: 11 };

    function uid(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }

    /** 两点间大圆（直线）距离，单位 km */
    function computeDistKm(lat1, lng1, lat2, lng2) {
        var toRad = function (deg) { return (deg * Math.PI) / 180; };
        var dLat = toRad(lat2 - lat1);
        var dLng = toRad(lng2 - lng1);
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 6371 * c;
    }

    /** "HH:MM" → 分钟数；无效返回 null */
    function parseTimeToMinutes(value) {
        if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
        var parts = value.split(':');
        var hours = parseInt(parts[0], 10);
        var minutes = parseInt(parts[1], 10);
        if (hours > 23 || minutes > 59) return null;
        return hours * 60 + minutes;
    }

    /** 分钟数 → "HH:MM"（按 24 小时取模） */
    function formatMinutes(totalMinutes) {
        var value = Math.round(totalMinutes) % 1440;
        if (value < 0) value += 1440;
        var hours = Math.floor(value / 60);
        var minutes = value % 60;
        return (hours < 10 ? '0' : '') + hours + ':' + (minutes < 10 ? '0' : '') + minutes;
    }

    /**
     * 估算通勤时长（分钟）。
     * mode 为空时按距离自动在步行/驾驶间选择；「其他」不估算，返回 null；
     * 直线距离先乘绕路系数再按均速计算，结果取 5 分钟整并至少 1 分钟。
     */
    function estimateLegMinutes(mode, km) {
        if (!isFinite(km) || km < 0) return null;
        var key = mode || (km <= 1.8 ? 'walk' : 'drive');
        if (key === 'other') return null;
        var speed = LEG_SPEED[key];
        if (!speed) return null;
        var minutes = (km * LEG_DETOUR * 1000) / speed + (LEG_EXTRA[key] || 0);
        return Math.max(1, Math.round(minutes / 5) * 5);
    }

    /** "YYYY-MM-DD" 加 n 天，返回同样格式 */
    function shiftDate(dateStr, days) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return '';
        var parts = dateStr.split('-').map(Number);
        var value = new Date(parts[0], parts[1] - 1, parts[2]);
        value.setDate(value.getDate() + days);
        return value.getFullYear() + '-' +
            ('0' + (value.getMonth() + 1)).slice(-2) + '-' +
            ('0' + value.getDate()).slice(-2);
    }

    /** 日期比较：有日期的按日期升序在前，无日期的保持原相对顺序排后 */
    function compareDayDates(a, b) {
        var left = a.date || '';
        var right = b.date || '';
        if (left && right) return left < right ? -1 : (left > right ? 1 : 0);
        if (left) return -1;
        if (right) return 1;
        return 0;
    }

    function createDay(name) {
        return { id: uid('day'), name: name, date: '', items: [] };
    }

    function createEmptyState() {
        return {
            version: 1,
            trip: { title: '我的行程', note: '' },
            categories: DEFAULT_CATEGORIES.map(function (c) {
                return { id: c.id, name: c.name, color: c.color };
            }),
            places: [],
            days: [createDay('Day 1')],
            settings: { mapStyle: 'dark', viewMode: '2D' },
            view: { lng: DEFAULT_VIEW.lng, lat: DEFAULT_VIEW.lat, zoom: DEFAULT_VIEW.zoom }
        };
    }

    function num(value, fallback) {
        var n = Number(value);
        return isFinite(n) ? n : fallback;
    }

    function normalizeCategoryId(rawId) {
        var mapped = LEGACY_CATEGORY_MAP[rawId] || rawId;
        return DEFAULT_CATEGORIES.some(function (c) { return c.id === mapped; }) ? mapped : 'activity';
    }

    function normalizePlace(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var lng = num(raw.lng, null);
        var lat = num(raw.lat, null);
        if (lng === null || lat === null) return null;
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : uid('place'),
            name: String(raw.name || '').trim() || '未命名地点',
            lng: lng,
            lat: lat,
            categoryId: normalizeCategoryId(String(raw.categoryId || '')),
            address: String(raw.address || ''),
            note: String(raw.note || '')
        };
    }

    function normalizeItem(raw) {
        if (!raw || typeof raw !== 'object' || typeof raw.placeId !== 'string') return null;
        var rawLeg = raw.leg && typeof raw.leg === 'object' ? raw.leg : {};
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : uid('item'),
            placeId: raw.placeId,
            time: /^\d{2}:\d{2}$/.test(raw.time || '') ? raw.time : '',
            stay: raw.stay === 0 || raw.stay ? String(raw.stay) : '',
            note: String(raw.note || ''),
            disabled: raw.disabled === true,
            leg: {
                mode: LEG_MODES.indexOf(rawLeg.mode) !== -1 ? rawLeg.mode : '',
                note: String(rawLeg.note || '')
            }
        };
    }

    function normalizeState(raw) {
        var base = createEmptyState();
        if (!raw || typeof raw !== 'object') return base;

        var state = {
            version: 1,
            trip: {
                title: (raw.trip && String(raw.trip.title || '').trim()) || base.trip.title,
                note: (raw.trip && String(raw.trip.note || '')) || ''
            },
            categories: [],
            places: [],
            days: [],
            settings: { mapStyle: 'dark', viewMode: '2D' },
            view: { lng: DEFAULT_VIEW.lng, lat: DEFAULT_VIEW.lat, zoom: DEFAULT_VIEW.zoom }
        };

        // 分类固定为「交通 / 住宿 / 餐饮 / 活动」四类，旧数据自动归并
        state.categories = base.categories;

        if (Array.isArray(raw.places)) {
            raw.places.forEach(function (p) {
                var normalized = normalizePlace(p);
                if (normalized) state.places.push(normalized);
            });
        }

        if (Array.isArray(raw.days)) {
            raw.days.forEach(function (d) {
                if (!d || typeof d !== 'object') return;
                var day = {
                    id: typeof d.id === 'string' && d.id ? d.id : uid('day'),
                    name: String(d.name || '').trim() || ('Day ' + (state.days.length + 1)),
                    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '',
                    items: []
                };
                if (Array.isArray(d.items)) {
                    d.items.forEach(function (it) {
                        var item = normalizeItem(it);
                        if (item) day.items.push(item);
                    });
                }
                state.days.push(day);
            });
        }
        if (!state.days.length) state.days = base.days;

        // 丢弃指向已不存在地点的行程项
        var placeIds = {};
        state.places.forEach(function (p) { placeIds[p.id] = true; });
        state.days.forEach(function (d) {
            d.items = d.items.filter(function (it) { return placeIds[it.placeId]; });
        });

        // 历史数据可能日期乱序，加载时按日期排一次
        var dayOrder = {};
        state.days.forEach(function (day, index) { dayOrder[day.id] = index; });
        state.days.sort(function (a, b) {
            var cmp = compareDayDates(a, b);
            return cmp !== 0 ? cmp : dayOrder[a.id] - dayOrder[b.id];
        });

        if (raw.settings) {
            var style = raw.settings.mapStyle;
            if (style === 'dark' || style === 'normal' || style === 'satellite') {
                state.settings.mapStyle = style;
            }
            if (raw.settings.viewMode === '3D') state.settings.viewMode = '3D';
        }

        if (raw.view) {
            state.view.lng = num(raw.view.lng, DEFAULT_VIEW.lng);
            state.view.lat = num(raw.view.lat, DEFAULT_VIEW.lat);
            state.view.zoom = num(raw.view.zoom, DEFAULT_VIEW.zoom);
        }

        return state;
    }

    var Store = {
        state: null,

        init: function () {
            var raw = null;
            try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
            var parsed = null;
            if (raw) {
                try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
            }
            this.state = parsed ? normalizeState(parsed) : createEmptyState();
            if (!parsed) this.persist();
            return this.state;
        },

        persist: function () {
            try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (e) { /* 隐私模式等场景忽略 */ }
        },

        saveSoon: function () {
            var self = this;
            if (saveTimer) window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(function () { self.persist(); }, 250);
        },

        subscribe: function (fn) {
            if (typeof fn === 'function') listeners.push(fn);
        },

        emit: function () {
            var state = this.state;
            listeners.forEach(function (fn) {
                try { fn(state); } catch (e) { console.error('[store] 订阅者错误', e); }
            });
            this.saveSoon();
        },

        /* ================= 地点 ================= */

        addPlace: function (data) {
            var place = {
                id: uid('place'),
                name: String(data.name || '').trim() || '未命名地点',
                lng: num(data.lng, 0),
                lat: num(data.lat, 0),
                categoryId: data.categoryId || 'other',
                address: String(data.address || ''),
                note: String(data.note || '')
            };
            this.state.places.push(place);
            this.emit();
            return place;
        },

        updatePlace: function (id, patch) {
            var place = this.getPlace(id);
            if (!place) return null;
            if (patch.name !== undefined) place.name = String(patch.name).trim() || place.name;
            if (patch.lng !== undefined) place.lng = num(patch.lng, place.lng);
            if (patch.lat !== undefined) place.lat = num(patch.lat, place.lat);
            if (patch.categoryId !== undefined) place.categoryId = patch.categoryId;
            if (patch.address !== undefined) place.address = String(patch.address || '');
            if (patch.note !== undefined) place.note = String(patch.note || '');
            this.emit();
            return place;
        },

        removePlace: function (id) {
            this.state.places = this.state.places.filter(function (p) { return p.id !== id; });
            this.state.days.forEach(function (d) {
                d.items = d.items.filter(function (it) { return it.placeId !== id; });
            });
            this.emit();
        },

        getPlace: function (id) {
            return this.state.places.find(function (p) { return p.id === id; }) || null;
        },

        getCategory: function (id) {
            return this.state.categories.find(function (c) { return c.id === id; }) ||
                this.state.categories[this.state.categories.length - 1];
        },

        /* ================= 天 ================= */

        addDay: function () {
            var day = createDay('Day ' + (this.state.days.length + 1));
            // 已有日期时，新的一天自动顺延到最后一个日期之后
            var lastDate = '';
            this.state.days.forEach(function (existing) {
                if (existing.date && existing.date > lastDate) lastDate = existing.date;
            });
            if (lastDate) day.date = shiftDate(lastDate, 1);
            this.state.days.push(day);
            this.sortDaysByDate();
            this.emit();
            return day;
        },

        /** 按日期排序：有日期的按日期升序在前，无日期的保持原相对顺序排后 */
        sortDaysByDate: function () {
            var decorated = this.state.days.map(function (day, index) {
                return { day: day, index: index };
            });
            decorated.sort(function (a, b) {
                var cmp = compareDayDates(a.day, b.day);
                return cmp !== 0 ? cmp : a.index - b.index;
            });
            this.state.days = decorated.map(function (entry) { return entry.day; });
        },

        removeDay: function (id) {
            if (this.state.days.length <= 1) return false;
            this.state.days = this.state.days.filter(function (d) { return d.id !== id; });
            this.emit();
            return true;
        },

        updateDay: function (id, patch) {
            var day = this.getDay(id);
            if (!day) return null;
            if (patch.name !== undefined) day.name = String(patch.name).trim() || day.name;
            if (patch.date !== undefined) {
                day.date = /^\d{4}-\d{2}-\d{2}$/.test(patch.date || '') ? patch.date : '';
                this.sortDaysByDate();
            }
            this.emit();
            return day;
        },

        getDay: function (id) {
            return this.state.days.find(function (d) { return d.id === id; }) || null;
        },

        dayIndexOf: function (id) {
            return this.state.days.findIndex(function (d) { return d.id === id; });
        },

        dayColor: function (dayId) {
            var index = this.dayIndexOf(dayId);
            return DAY_COLORS[(index < 0 ? 0 : index) % DAY_COLORS.length];
        },

        /* ================= 行程项 ================= */

        addItem: function (dayId, placeId, index) {
            var day = this.getDay(dayId);
            if (!day || !this.getPlace(placeId)) return null;
            var item = {
                id: uid('item'),
                placeId: placeId,
                time: '',
                stay: '',
                note: '',
                disabled: false,
                leg: { mode: '', note: '' }
            };
            if (typeof index === 'number' && index >= 0 && index <= day.items.length) {
                day.items.splice(index, 0, item);
            } else {
                day.items.push(item);
            }
            this.emit();
            return item;
        },

        removeItem: function (itemId) {
            var found = this.findItem(itemId);
            if (!found) return;
            found.day.items.splice(found.index, 1);
            this.emit();
        },

        updateItem: function (itemId, patch) {
            var found = this.findItem(itemId);
            if (!found) return null;
            var item = found.item;
            if (patch.time !== undefined) item.time = patch.time;
            if (patch.stay !== undefined) item.stay = patch.stay === '' ? '' : String(patch.stay);
            if (patch.note !== undefined) item.note = String(patch.note || '');
            if (patch.disabled !== undefined) item.disabled = Boolean(patch.disabled);
            if (patch.leg !== undefined && patch.leg !== null) {
                if (patch.leg.mode !== undefined) {
                    item.leg.mode = LEG_MODES.indexOf(patch.leg.mode) !== -1 ? patch.leg.mode : '';
                }
                if (patch.leg.note !== undefined) item.leg.note = String(patch.leg.note || '');
            }
            this.emit();
            return item;
        },

        /** 软删除：禁用 / 恢复行程项 */
        setItemDisabled: function (itemId, disabled) {
            var found = this.findItem(itemId);
            if (!found) return null;
            found.item.disabled = Boolean(disabled);
            this.emit();
            return found.item;
        },

        /**
         * 移动行程项。
         * toIndex 语义：目标天「移除该项之后」的数组插入位置（0 即插到最前）。
         */
        moveItem: function (itemId, toDayId, toIndex) {
            var found = this.findItem(itemId);
            var target = this.getDay(toDayId);
            if (!found || !target) return;

            found.day.items.splice(found.index, 1);

            var index = typeof toIndex === 'number' ? toIndex : target.items.length;
            index = Math.max(0, Math.min(index, target.items.length));
            target.items.splice(index, 0, found.item);
            this.emit();
        },

        findItem: function (itemId) {
            for (var i = 0; i < this.state.days.length; i++) {
                var day = this.state.days[i];
                for (var j = 0; j < day.items.length; j++) {
                    if (day.items[j].id === itemId) {
                        return { day: day, index: j, item: day.items[j] };
                    }
                }
            }
            return null;
        },

        /** 某地点被安排进哪些天 */
        placeUsage: function (placeId) {
            var result = [];
            this.state.days.forEach(function (day) {
                day.items.forEach(function (item) {
                    if (item.placeId === placeId) {
                        result.push({ dayId: day.id, dayName: day.name, itemId: item.id });
                    }
                });
            });
            return result;
        },

        /* ================= 时间轴 ================= */

        /**
         * 推算某天的时间轴（仅统计启用中的行程项）。
         * 规则：item.time 是硬性时刻（锚点）；没有时间的项从上一项推算；
         * 相邻两站之间用 item.leg（通勤方式）估算时长，「其他」不参与时间推算。
         * 返回 [{ item, place, fixed, start, end, late, lateBy, legMode, legMinutes, legNote, legEstimated }]
         */
        computeTimeline: function (day) {
            var entries = [];
            if (!day) return entries;

            var active = day.items.filter(function (item) { return !item.disabled; });
            var chain = null;

            for (var i = 0; i < active.length; i++) {
                var item = active[i];
                var place = this.getPlace(item.placeId);
                var nextPlace = i + 1 < active.length ? this.getPlace(active[i + 1].placeId) : null;

                var fixed = parseTimeToMinutes(item.time);
                var late = fixed !== null && chain !== null && chain > fixed;
                var start = fixed !== null ? fixed : chain;

                var stay = parseInt(item.stay, 10);
                if (!isFinite(stay) || stay < 0) stay = 0;
                var end = start !== null ? start + stay : null;

                var legMode = (item.leg && item.leg.mode) || '';
                var legNote = (item.leg && item.leg.note) || '';
                var legMinutes = null;
                var legEstimated = false;
                if (place && nextPlace) {
                    var km = computeDistKm(place.lat, place.lng, nextPlace.lat, nextPlace.lng);
                    legMinutes = estimateLegMinutes(legMode, km);
                    legEstimated = !legMode && legMinutes !== null;
                } else {
                    legNote = '';
                }

                entries.push({
                    item: item,
                    place: place,
                    fixed: fixed !== null,
                    start: start,
                    end: end,
                    late: late,
                    lateBy: late ? chain - fixed : 0,
                    legMode: legMode,
                    legMinutes: legMinutes,
                    legNote: legNote,
                    legEstimated: legEstimated
                });

                if (end !== null) {
                    chain = legMinutes !== null ? end + legMinutes : end;
                } else {
                    chain = null;
                }
            }

            return entries;
        },

        /* ================= 统计 ================= */

        dayStats: function (day) {
            var self = this;
            var active = day.items.filter(function (item) { return !item.disabled; });
            var places = active
                .map(function (it) { return self.getPlace(it.placeId); })
                .filter(Boolean);
            var distance = 0;
            for (var i = 1; i < places.length; i++) {
                distance += computeDistKm(places[i - 1].lat, places[i - 1].lng, places[i].lat, places[i].lng);
            }
            return {
                count: active.length,
                distance: distance,
                places: places,
                disabledCount: day.items.length - active.length
            };
        },

        totalStats: function () {
            var self = this;
            var totals = { places: this.state.places.length, count: 0, distance: 0 };
            this.state.days.forEach(function (day) {
                var stats = self.dayStats(day);
                totals.count += stats.count;
                totals.distance += stats.distance;
            });
            return totals;
        },

        /* ================= 导入导出 ================= */

        exportJSON: function () {
            return JSON.stringify(this.state, null, 2);
        },

        importJSON: function (text) {
            var parsed = JSON.parse(text);
            this.state = normalizeState(parsed);
            this.persist();
            this.emit();
            return this.state;
        },

        reset: function () {
            this.state = createEmptyState();
            this.persist();
            this.emit();
            return this.state;
        },

        /* ================= 行程信息 ================= */

        updateTrip: function (patch) {
            if (patch.title !== undefined) {
                this.state.trip.title = String(patch.title).trim() || this.state.trip.title;
            }
            if (patch.note !== undefined) this.state.trip.note = String(patch.note || '');
            this.emit();
        },

        /* ================= 时间工具 ================= */

        parseTimeToMinutes: parseTimeToMinutes,
        formatMinutes: formatMinutes,
        estimateLegMinutes: estimateLegMinutes,
        shiftDate: shiftDate,

        /* ================= 视图 ================= */

        updateView: function (view) {
            if (!this.state.view) this.state.view = {};
            if (view.lng !== undefined) this.state.view.lng = view.lng;
            if (view.lat !== undefined) this.state.view.lat = view.lat;
            if (view.zoom !== undefined) this.state.view.zoom = view.zoom;
            this.saveSoon();
        },

        updateSettings: function (patch) {
            if (!this.state.settings) this.state.settings = {};
            Object.assign(this.state.settings, patch);
            this.saveSoon();
        }
    };

    window.Store = Store;
    window.computeDistKm = computeDistKm;
})();
