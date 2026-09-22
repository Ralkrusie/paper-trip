#!/usr/bin/env node
/**
 * 拾途 Paper Trip · 小程序路线解析自检
 *
 * 用真实的微信接口响应快照，在不进开发者工具的情况下跑一遍小程序里的
 * routes.js / amap.js 解析链路（含缓存、降级、换乘链组装），验证字段兼容性。
 *
 * 用法：
 *   node tools/mini_routes_selftest.js <fixtures目录>
 *
 * fixtures 目录（生成方法见下方注释，快照文件不入库）需含：
 *   transit.json    v3 公交路径规划响应（direction/transit/integrated）
 *   walking.json    v3 步行响应
 *   driving.json    v3 驾车响应
 *   bicycling.json  v4 骑行响应
 *
 * 生成快照（PowerShell 示例，key 从本地取、勿提交）：
 *   $r = Invoke-WebRequest -UseBasicParsing "https://restapi.amap.com/v3/direction/walking?key=$key&origin=121.4737,31.2304&destination=121.4370,31.1950"
 *   [IO.File]::WriteAllText("$dir\walking.json", $r.Content)
 */
'use strict';

var fs = require('fs');
var path = require('path');

var fixtureDir = process.argv[2];
if (!fixtureDir || !fs.existsSync(fixtureDir)) {
    console.error('用法: node tools/mini_routes_selftest.js <fixtures目录>');
    process.exit(2);
}

function readFixture(name) {
    var file = path.join(fixtureDir, name + '.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

var fixtures = {
    walking: readFixture('walking'),
    driving: readFixture('driving'),
    bicycling: readFixture('bicycling'),
    transit: readFixture('transit')
};

/* ---------- 模拟小程序运行环境 ---------- */
global.wx = {
    getStorageSync: function () { return ''; },
    setStorageSync: function () { },
    request: function (options) {
        var url = options.url || '';
        var data = null;
        if (url.indexOf('/direction/walking') !== -1) data = fixtures.walking;
        else if (url.indexOf('/direction/driving') !== -1) data = fixtures.driving;
        else if (url.indexOf('/direction/bicycling') !== -1) data = fixtures.bicycling;
        else if (url.indexOf('/direction/transit/integrated') !== -1) data = fixtures.transit;
        else if (url.indexOf('/geocode/regeo') !== -1) {
            data = { status: '1', regeocode: { addressComponent: { city: '上海市' } } };
        }
        if (!data) {
            options.fail && options.fail({ errMsg: 'no fixture for ' + url });
            return;
        }
        setTimeout(function () {
            options.success && options.success({ statusCode: 200, data: data });
        }, 0);
    }
};

var base = path.join(__dirname, '..', 'miniprogram', 'utils');
var Store = require(path.join(base, 'store.js')).Store;
Store.init();
Store.state.settings.amapKey = 'fixture-key';   // 让 keyReady() 通过
var Routes = require(path.join(base, 'routes.js'));

var from = { lng: 121.4737, lat: 31.2304 };
var to = { lng: 121.4370, lat: 31.1950 };

function describe(mode, route) {
    if (!route) return mode + ': null（无路线或请求失败）';
    var lines = [mode + ': time=' + route.time + 's distance=' + (route.distance || '-') +
        'm path=' + (route.path ? route.path.length : 0) + ' 点'];
    if (route.walking) lines.push('  walking=' + route.walking + 'm');
    if (route.rides && route.rides.length) {
        lines.push('  换乘链: ' + route.rides.map(function (ride) {
            return ride.line + (ride.from || ride.to ? '（' + ride.from + ' → ' + ride.to + '）' : '');
        }).join(' → '));
    }
    return lines.join('\n');
}

var modes = ['walk', 'bike', 'drive', 'transit'];
var problems = 0;
var finished = 0;

modes.forEach(function (mode) {
    if (!fixtures[mode === 'walk' ? 'walking' : mode === 'drive' ? 'driving' : mode === 'bike' ? 'bicycling' : 'transit']) {
        console.log(mode + ': 缺少快照，跳过');
        finished++;
        return;
    }
    Routes.request(mode, from, to).then(function (route) {
        console.log(describe(mode, route));
        if (!route) problems++;
        else if (!route.path || route.path.length < 2) {
            console.log('  ⚠ 轨迹点不足（绘制会退回直线）');
            problems++;
        }
        if (mode === 'transit' && route && (!route.rides || !route.rides.length)) {
            console.log('  ⚠ 公交解析没有换乘链');
            problems++;
        }
        finished++;
        if (finished === modes.length) {
            console.log('\n完成：' + (problems ? problems + ' 个问题' : '全部通过'));
            process.exit(problems ? 1 : 0);
        }
    });
});
