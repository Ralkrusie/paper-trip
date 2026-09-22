/**
 * 拾途 Paper Trip · 行程项编辑页
 * 字段：时间 / 停留 / 消费 / 所属天 / 备注，以及「到下一站」的通勤方式与备注。
 */
var StoreModule = require('../../utils/store.js');
var Store = StoreModule.Store;
var Routes = require('../../utils/routes.js');
var Fmt = require('../../utils/format.js');

Page({
    data: {
        itemId: '',
        placeName: '',
        placeColor: '#3f7e73',
        placeAddress: '',
        placeLng: 0,
        placeLat: 0,

        time: '',
        stay: '',
        cost: '',
        note: '',
        disabled: false,

        dayIndex: 0,
        dayLabels: [],
        dayLabelText: '',

        hasNext: false,
        nextName: '',
        modes: [],
        legNote: '',
        legInfo: '',
        legPending: false
    },

    onLoad: function (options) {
        this._destroyed = false;
        this._mode = '';
        this._dayOptions = [];
        this._legContext = null;

        var itemId = options && options.id;
        var found = Store.findItem(itemId);
        if (!found) {
            wx.showToast({ title: '这条行程项不存在', icon: 'none' });
            setTimeout(function () { wx.navigateBack(); }, 600);
            return;
        }

        this._itemId = itemId;
        this._dayId = found.day.id;
        this._load(found);
    },

    onUnload: function () { this._destroyed = true; },

    _load: function (found) {
        var item = found.item;
        var place = Store.getPlace(item.placeId);

        var dayOptions = Store.state.days.map(function (day) {
            return {
                id: day.id,
                label: Fmt.dayTabLabel(day) + (day.date ? ' · ' + Fmt.formatDateLabel(day.date) : '')
            };
        });
        this._dayOptions = dayOptions;
        var dayIndex = 0;
        dayOptions.forEach(function (option, index) {
            if (option.id === found.day.id) dayIndex = index;
        });

        // 下一站（通勤目标）
        var active = found.day.items.filter(function (entry) { return !entry.disabled; });
        var index = active.indexOf(item);
        var next = index >= 0 ? active[index + 1] : null;
        var toPlace = next ? Store.getPlace(next.placeId) : null;

        this._mode = (item.leg && item.leg.mode) || '';
        this._legContext = place && toPlace ? { from: place, to: toPlace } : null;

        var modes = [];
        if (this._legContext) {
            var self = this;
            Fmt.LEG_MODE_ORDER.forEach(function (mode) {
                modes.push({ mode: mode, label: Fmt.LEG_MODE_LABELS[mode], active: mode === self._mode });
            });
        }

        wx.setNavigationBarTitle({ title: place ? place.name : '行程项' });
        this.setData({
            itemId: this._itemId,
            placeName: place ? place.name : '未知地点',
            placeColor: place ? Store.getCategory(place.categoryId).color : '#3f7e73',
            placeAddress: place ? place.address || '' : '',
            placeLng: place ? place.lng : 0,
            placeLat: place ? place.lat : 0,
            time: item.time || '',
            stay: item.stay || '',
            cost: item.cost ? String(item.cost) : '',
            note: item.note || '',
            disabled: Boolean(item.disabled),
            dayIndex: dayIndex,
            dayLabels: dayOptions.map(function (option) { return option.label; }),
            dayLabelText: dayOptions[dayIndex] ? dayOptions[dayIndex].label : '',
            hasNext: Boolean(this._legContext),
            nextName: toPlace ? toPlace.name : '',
            modes: modes,
            legNote: (item.leg && item.leg.note) || ''
        });

        this.updateLegInfo();
    },

    /* ================= 表单 ================= */

    onTimePick: function (event) {
        this.setData({ time: event.detail.value });
    },

    clearTime: function () {
        this.setData({ time: '' });
    },

    onStayInput: function (event) {
        this.setData({ stay: event.detail.value });
    },

    onCostInput: function (event) {
        this.setData({ cost: event.detail.value });
    },

    onNoteInput: function (event) {
        this.setData({ note: event.detail.value });
    },

    onDayChange: function (event) {
        var index = Number(event.detail.value);
        this.setData({
            dayIndex: index,
            dayLabelText: this.data.dayLabels[index] || ''
        });
    },

    /* ================= 通勤 ================= */

    onModeTap: function (event) {
        var mode = event.currentTarget.dataset.mode;
        this._mode = this._mode === mode ? '' : mode;
        var activeMode = this._mode;
        this.setData({
            modes: this.data.modes.map(function (item) {
                return { mode: item.mode, label: item.label, active: item.mode === activeMode };
            })
        });
        this.updateLegInfo();
    },

    onLegNoteInput: function (event) {
        this.setData({ legNote: event.detail.value });
    },

    /** 通勤信息行：优先显示高德真实路线，无则显示本地估算；未命中缓存时异步获取 */
    updateLegInfo: function () {
        var context = this._legContext;
        if (!context) return;

        var km = StoreModule.computeDistKm(context.from.lat, context.from.lng, context.to.lat, context.to.lng);
        var mode = this._mode;

        if (!Routes.fetchable(mode) || km < 0.05) {
            this.setData({ legInfo: Fmt.legEstimateText(mode, km), legPending: false });
            return;
        }

        var cached = Routes.get(mode, context.from, context.to);
        if (cached !== undefined) {
            this.setData({
                legInfo: cached ? Fmt.modalRouteText(cached) : Fmt.legEstimateText(mode, km),
                legPending: false
            });
            return;
        }

        this.setData({
            legInfo: Fmt.legEstimateText(mode, km) + ' · 正在获取高德路线…',
            legPending: true
        });
        var self = this;
        Routes.request(mode, context.from, context.to).then(function () {
            if (!self._destroyed) self.updateLegInfo();
        });
    },

    /* ================= 操作 ================= */

    save: function () {
        if (!this._itemId) return;
        Store.updateItem(this._itemId, {
            time: this.data.time || '',
            stay: this.data.stay === '' ? '' : String(Math.max(0, parseInt(this.data.stay, 10) || 0)),
            cost: this.data.cost === '' ? 0 : Math.max(0, parseFloat(this.data.cost) || 0),
            note: (this.data.note || '').trim()
        });
        if (this.data.hasNext) {
            Store.updateItem(this._itemId, {
                leg: { mode: this._mode, note: (this.data.legNote || '').trim() }
            });
        }

        var target = this._dayOptions[this.data.dayIndex];
        if (target && target.id !== this._dayId) {
            Store.moveItem(this._itemId, target.id);
            wx.showToast({ title: '已移动到 ' + target.label.split(' ')[0], icon: 'none' });
        } else {
            wx.showToast({ title: '已保存', icon: 'none' });
        }
        setTimeout(function () { wx.navigateBack(); }, 400);
    },

    toggleDisabled: function () {
        if (!this._itemId) return;
        var next = !this.data.disabled;
        Store.setItemDisabled(this._itemId, next);
        wx.showToast({
            title: next ? '已移除，可在当天最下方恢复' : '已恢复该站点',
            icon: 'none'
        });
        setTimeout(function () { wx.navigateBack(); }, 500);
    },

    navigateHere: function () {
        if (!this.data.placeLng || !this.data.placeLat) {
            wx.showToast({ title: '该地点没有坐标', icon: 'none' });
            return;
        }
        wx.openLocation({
            longitude: this.data.placeLng,
            latitude: this.data.placeLat,
            name: this.data.placeName,
            address: this.data.placeAddress
        });
    }
});
