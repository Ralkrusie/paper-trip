/**
 * 拾途 Paper Trip · 地点编辑页
 * 三种进入方式：
 *   - 编辑已有地点：place?id=xxx
 *   - 地图点选新增：place?lng=..&lat=..（自动逆地理填充地址与附近候选）
 *   - 搜索新增：place?mode=search（关键词搜索高德 POI）
 */
var Store = require('../../utils/store.js').Store;
var amap = require('../../utils/amap.js');
var Fmt = require('../../utils/format.js');

Page({
    data: {
        isNew: true,
        id: '',
        name: '',
        address: '',
        note: '',
        categories: [],
        catId: 'activity',
        lng: 0,
        lat: 0,
        hasCoords: false,
        coordText: '',
        usageText: '',

        keyword: '',
        results: [],
        searching: false,
        searched: false,

        nearby: [],
        nearbyLoading: false,

        keyMissing: false
    },

    onLoad: function (options) {
        this._destroyed = false;
        options = options || {};

        var catId = 'activity';
        if (options.id) {
            var place = Store.getPlace(options.id);
            if (!place) {
                wx.showToast({ title: '该地点不存在', icon: 'none' });
                setTimeout(function () { wx.navigateBack(); }, 600);
                return;
            }
            catId = place.categoryId;
            var usage = Store.placeUsage(place.id);
            var dayNames = [];
            usage.forEach(function (entry) {
                if (dayNames.indexOf(entry.dayName) === -1) dayNames.push(entry.dayName);
            });
            this.setData({
                isNew: false,
                id: place.id,
                name: place.name,
                address: place.address || '',
                note: place.note || '',
                lng: place.lng,
                lat: place.lat,
                hasCoords: true,
                coordText: place.lng.toFixed(5) + ', ' + place.lat.toFixed(5),
                usageText: dayNames.length ? '已安排：' + dayNames.join('、') : ''
            });
            wx.setNavigationBarTitle({ title: '编辑地点' });
        } else {
            wx.setNavigationBarTitle({ title: '添加地点' });
            var lng = Number(options.lng);
            var lat = Number(options.lat);
            if (isFinite(lng) && isFinite(lat) && lng !== 0) {
                this.setData({
                    lng: lng,
                    lat: lat,
                    hasCoords: true,
                    coordText: lng.toFixed(5) + ', ' + lat.toFixed(5)
                });
                this.loadNearby(lng, lat);
            }
        }

        this.updateCategories(catId);
        this.setData({ keyMissing: !amap.keyReady() });
    },

    onUnload: function () { this._destroyed = true; },

    updateCategories: function (catId) {
        this.setData({
            catId: catId,
            categories: Store.state.categories.map(function (category) {
                return {
                    id: category.id,
                    name: category.name,
                    color: category.color,
                    active: category.id === catId
                };
            })
        });
    },

    onCatTap: function (event) {
        this.updateCategories(event.currentTarget.dataset.id);
    },

    onNameInput: function (event) {
        this.setData({ name: event.detail.value });
    },

    onAddressInput: function (event) {
        this.setData({ address: event.detail.value });
    },

    onNoteInput: function (event) {
        this.setData({ note: event.detail.value });
    },

    /* ================= 逆地理：填充地址 + 附近候选 ================= */

    loadNearby: function (lng, lat) {
        var self = this;
        if (!amap.keyReady()) return;
        this.setData({ nearbyLoading: true });
        amap.regeo(lng, lat, true).then(function (regeocode) {
            if (self._destroyed) return;
            if (!regeocode) {
                self.setData({ nearbyLoading: false });
                return;
            }
            var address = amap.strOf(regeocode.formatted_address);
            var nearby = [];
            (regeocode.pois || []).slice(0, 6).forEach(function (poi) {
                var loc = amap.strOf(poi.location).split(',');
                var poiLng = Number(loc[0]);
                var poiLat = Number(loc[1]);
                if (!poi.name || !isFinite(poiLng) || !isFinite(poiLat)) return;
                nearby.push({ name: amap.strOf(poi.name), address: address });
            });
            var update = { nearby: nearby, nearbyLoading: false };
            if (!self.data.address && address) update.address = address;
            self.setData(update);
        });
    },

    onNearbyTap: function (event) {
        var name = event.currentTarget.dataset.name;
        if (name) this.setData({ name: name });
    },

    /* ================= 关键词搜索 ================= */

    onKeywordInput: function (event) {
        this.setData({ keyword: event.detail.value });
    },

    search: function () {
        var self = this;
        var keyword = (this.data.keyword || '').trim();
        if (!keyword) {
            wx.showToast({ title: '请输入关键词', icon: 'none' });
            return;
        }
        if (!amap.keyReady()) {
            wx.showToast({ title: '请先在「设置」里配置高德 Key', icon: 'none' });
            return;
        }
        this.setData({ searching: true });
        amap.searchPoi(keyword, '').then(function (results) {
            if (self._destroyed) return;
            var mapped = results.map(function (result, index) {
                result.key = 'r' + index + '-' + result.name;
                return result;
            });
            self.setData({ searching: false, searched: true, results: mapped });
            if (!results.length) {
                wx.showToast({ title: '没有找到相关地点', icon: 'none' });
            }
        });
    },

    onResultTap: function (event) {
        var index = Number(event.currentTarget.dataset.index);
        var result = this.data.results[index];
        if (!result) return;
        this.setData({
            name: this.data.name || result.name,
            address: result.address || this.data.address,
            lng: result.lng,
            lat: result.lat,
            hasCoords: true,
            coordText: result.lng.toFixed(5) + ', ' + result.lat.toFixed(5)
        });
        wx.showToast({ title: '已填入「' + result.name + '」', icon: 'none' });
    },

    /* ================= 保存 / 删除 / 导航 ================= */

    save: function () {
        var name = (this.data.name || '').trim();
        if (!name) {
            wx.showToast({ title: '请填写地点名称', icon: 'none' });
            return;
        }
        if (!this.data.hasCoords) {
            wx.showToast({ title: '缺少坐标：请从地图点选或搜索选择', icon: 'none' });
            return;
        }

        var payload = {
            name: name,
            categoryId: this.data.catId,
            address: (this.data.address || '').trim(),
            note: (this.data.note || '').trim(),
            lng: this.data.lng,
            lat: this.data.lat
        };

        if (this.data.isNew) {
            Store.addPlace(payload);
            wx.showToast({ title: '已添加地点', icon: 'none' });
        } else {
            Store.updatePlace(this.data.id, payload);
            wx.showToast({ title: '已保存', icon: 'none' });
        }
        setTimeout(function () { wx.navigateBack(); }, 400);
    },

    remove: function () {
        var self = this;
        if (this.data.isNew) return;
        wx.showModal({
            title: '删除该地点？',
            content: '删除后，行程中引用它的站点也会一并移除。',
            confirmText: '删除',
            confirmColor: '#b23a22',
            success: function (modal) {
                if (!modal.confirm) return;
                Store.removePlace(self.data.id);
                wx.showToast({ title: '已删除', icon: 'none' });
                setTimeout(function () { wx.navigateBack(); }, 400);
            }
        });
    },

    navigateHere: function () {
        if (!this.data.hasCoords) {
            wx.showToast({ title: '该地点没有坐标', icon: 'none' });
            return;
        }
        wx.openLocation({
            longitude: this.data.lng,
            latitude: this.data.lat,
            name: (this.data.name || '').trim() || '目标地点',
            address: (this.data.address || '').trim()
        });
    }
});
