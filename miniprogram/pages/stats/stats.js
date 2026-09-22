/**
 * 拾途 Paper Trip · 统计页
 * 与网页版统计保持一致：概览 / 消费汇总 / 每日站点数 / 每日直线里程 / 每日消费 / 分类分布。
 * 图表用条形列表呈现（免去图表库依赖，包体更小）。
 */
var Store = require('../../utils/store.js').Store;
var Fmt = require('../../utils/format.js');

/** [名称, 数值] → 条形数据（宽度按最大值归一） */
function buildBars(names, values, unit) {
    var max = 0;
    values.forEach(function (value) {
        if (value > max) max = value;
    });
    if (max <= 0) max = 1;
    return names.map(function (name, index) {
        var value = values[index];
        return {
            name: name,
            value: unit ? value + unit : String(value),
            width: Math.max(2, Math.round((value / max) * 100))
        };
    });
}

Page({
    data: {
        summary: '',
        costLine: '',
        hasCost: false,
        dayCount: [],
        dayDistance: [],
        dayCost: [],
        categoryTitle: '行程分类分布',
        category: [],
        empty: true
    },

    onShow: function () {
        this.refresh();
    },

    refresh: function () {
        var totals = Store.totalStats();
        var days = Store.state.days;

        var dayNames = days.map(function (day) { return Fmt.dayTabLabel(day); });
        var counts = days.map(function (day) { return Store.dayStats(day).count; });
        var distances = days.map(function (day) {
            return Number(Store.dayStats(day).distance.toFixed(1));
        });
        var dayCosts = days.map(function (day) {
            return Number(Store.dayStats(day).cost.toFixed(2));
        });

        // 消费汇总（仅统计页显示；不含已移除的站点）
        var costByCategory = {};
        days.forEach(function (day) {
            day.items.forEach(function (item) {
                if (item.disabled || !item.cost) return;
                var place = Store.getPlace(item.placeId);
                if (place) {
                    costByCategory[place.categoryId] =
                        (costByCategory[place.categoryId] || 0) + Number(item.cost);
                }
            });
        });
        var costLine = '';
        if (totals.cost > 0) {
            var parts = Object.keys(costByCategory).map(function (categoryId) {
                return Store.getCategory(categoryId).name + ' ¥' + Fmt.formatMoney(costByCategory[categoryId]);
            });
            costLine = '消费合计 ¥' + Fmt.formatMoney(totals.cost) + (parts.length ? ' · ' + parts.join(' / ') : '');
        } else {
            costLine = '消费：暂无记录——在行程项编辑页填写「消费（元）」，这里会自动汇总（不上卡片与行程单）。';
        }

        // 分类分布：优先按已安排地点统计，无安排时统计地点库
        var plannedPlaces = [];
        days.forEach(function (day) {
            day.items.forEach(function (item) {
                var place = Store.getPlace(item.placeId);
                if (place) plannedPlaces.push(place);
            });
        });
        var source = plannedPlaces.length ? plannedPlaces : Store.state.places;
        var categoryCount = {};
        source.forEach(function (place) {
            categoryCount[place.categoryId] = (categoryCount[place.categoryId] || 0) + 1;
        });
        var categoryNames = [];
        var categoryValues = [];
        Store.state.categories.forEach(function (category) {
            if (!categoryCount[category.id]) return;
            categoryNames.push(category.name);
            categoryValues.push(categoryCount[category.id]);
        });

        this.setData({
            summary: '共 ' + totals.places + ' 个地点 · 已安排 ' + totals.count +
                ' 站 · 直线总里程 ' + totals.distance.toFixed(1) + ' km',
            costLine: costLine,
            hasCost: totals.cost > 0,
            dayCount: buildBars(dayNames, counts, ' 站'),
            dayDistance: buildBars(dayNames, distances, ' km'),
            dayCost: buildBars(dayNames, dayCosts, ' 元'),
            categoryTitle: plannedPlaces.length ? '行程分类分布' : '地点库分类分布',
            category: buildBars(categoryNames, categoryValues, ' 个'),
            empty: totals.places === 0 && totals.count === 0
        });
    }
});
