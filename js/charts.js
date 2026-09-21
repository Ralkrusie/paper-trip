/**
 * 拾途 Paper Trip · 行程统计
 * 弹窗形式展示：每日站点数、每日直线里程、分类分布（ECharts，加载失败时降级为文字）。
 */
(function () {
    'use strict';

    var instances = [];
    var PALETTE = ['#b1483d', '#4e85c6', '#5a9e6b', '#e8a640', '#8b5ea8', '#d47a4e', '#5b8c8c', '#c4854a'];

    function disposeCharts() {
        instances.forEach(function (chart) {
            try { chart.dispose(); } catch (error) { /* 忽略 */ }
        });
        instances = [];
    }

    function initChart(id) {
        var element = document.getElementById(id);
        if (!element) return null;
        var chart = window.echarts.init(element);
        instances.push(chart);
        return chart;
    }

    function barOption(title, categories, values, unit) {
        return {
            animationDuration: 900,
            animationEasing: 'cubicOut',
            title: {
                text: title,
                textStyle: { fontSize: 14, color: '#3f4b45', fontWeight: 600 },
                left: 12,
                top: 10
            },
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { left: 16, right: 20, bottom: 12, top: 52, containLabel: true },
            xAxis: {
                type: 'category',
                data: categories,
                axisLabel: { fontSize: 12, color: '#66716b', interval: 0, rotate: categories.length > 5 ? 30 : 0 },
                axisLine: { lineStyle: { color: '#c9cec8' } }
            },
            yAxis: {
                type: 'value',
                minInterval: title.indexOf('km') === -1 ? 1 : 0,
                axisLabel: { fontSize: 11, color: '#66716b' },
                splitLine: { lineStyle: { color: '#eceae0' } }
            },
            series: [{
                type: 'bar',
                data: values.map(function (value, index) {
                    return { value: value, itemStyle: { color: PALETTE[index % PALETTE.length], borderRadius: [4, 4, 0, 0] } };
                }),
                barMaxWidth: 46,
                label: {
                    show: true,
                    position: 'top',
                    fontSize: 11,
                    color: '#3f4b45',
                    formatter: '{c}'
                }
            }]
        };
    }

    function pieOption(title, data) {
        return {
            animationDuration: 900,
            title: {
                text: title,
                textStyle: { fontSize: 14, color: '#3f4b45', fontWeight: 600 },
                left: 12,
                top: 10
            },
            tooltip: { trigger: 'item', formatter: '{b}：{c} 个（{d}%）' },
            legend: {
                orient: 'vertical',
                right: 16,
                top: 'middle',
                itemWidth: 10,
                itemHeight: 10,
                textStyle: { fontSize: 12, color: '#3f4b45' }
            },
            series: [{
                type: 'pie',
                radius: ['42%', '70%'],
                center: ['42%', '56%'],
                itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
                label: { show: true, fontSize: 11, color: '#3f4b45', formatter: '{b} {c}' },
                emphasis: {
                    label: { show: true, fontSize: 14, fontWeight: 'bold' },
                    itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.18)' }
                },
                data: data
            }]
        };
    }

    function renderStats() {
        disposeCharts();

        var summary = document.getElementById('stats-summary');
        var totals = Store.totalStats();
        var days = Store.state.days;

        if (summary) {
            summary.textContent = '共 ' + totals.places + ' 个地点 · 已安排 ' + totals.count +
                ' 站 · 直线总里程 ' + totals.distance.toFixed(1) + ' km';
        }

        if (!window.echarts) {
            if (summary) summary.textContent += '（图表库未加载，已显示文字统计）';
            return;
        }

        var dayNames = days.map(function (day) { return day.name; });
        var counts = days.map(function (day) { return Store.dayStats(day).count; });
        var distances = days.map(function (day) {
            return Number(Store.dayStats(day).distance.toFixed(1));
        });

        var chartCount = initChart('chart-day-count');
        if (chartCount) chartCount.setOption(barOption('每日站点数', dayNames, counts));

        var chartDistance = initChart('chart-day-distance');
        if (chartDistance) chartDistance.setOption(barOption('每日直线里程（km）', dayNames, distances));

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
        var pieData = Object.keys(categoryCount).map(function (categoryId) {
            var category = Store.getCategory(categoryId);
            return {
                name: category.name,
                value: categoryCount[categoryId],
                itemStyle: { color: category.color }
            };
        });

        var chartPie = initChart('chart-category');
        if (chartPie) {
            chartPie.setOption(pieOption(
                plannedPlaces.length ? '行程分类分布' : '地点库分类分布',
                pieData
            ));
        }
    }

    function openStats() {
        var modal = document.getElementById('stats-modal');
        if (!modal) return;
        if (!modal.open) modal.showModal();
        window.requestAnimationFrame(renderStats);
    }

    window.addEventListener('resize', function () {
        instances.forEach(function (chart) {
            try { chart.resize(); } catch (error) { /* 忽略 */ }
        });
    });

    window.Charts = { openStats: openStats };

    document.addEventListener('DOMContentLoaded', function () {
        var modal = document.getElementById('stats-modal');
        if (modal) modal.addEventListener('close', disposeCharts);
    });
})();
