#!/usr/bin/env node
/**
 * 拾途 Paper Trip · 小程序静态自检（零依赖，用微信开发者工具自带 node 即可运行）
 *
 * 检查项：
 *   1. 所有 JSON 可解析（app.json / 页面 json / project.config.json / sitemap.json）
 *   2. app.json 里登记的每个页面 4 件套（js/wxml/json/wxss）齐全
 *   3. wxml 中 bind / catch 绑定的事件处理函数在对应 js 中有定义
 *   4. js 中 require 的相对路径真实存在
 *   5. wxml 中 {{}} 里的「变量下标」写法提醒（部分基础库不支持，建议预计算）
 *
 * 用法：
 *   node tools/mini_check.js
 *   （本机无 node 时可用：D:\Development\微信web开发者工具\node-18.exe tools\mini_check.js）
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', 'miniprogram');
var problems = 0;

function rel(file) {
    return path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/');
}

function report(file, message) {
    problems++;
    console.log('[问题] ' + rel(file) + ' → ' + message);
}

function walk(dir, out) {
    fs.readdirSync(dir).forEach(function (name) {
        var full = path.join(dir, name);
        var stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (name === 'node_modules' || name === '.git') return;
            walk(full, out);
        } else {
            out.push(full);
        }
    });
    return out;
}

var files = walk(ROOT, []);
console.log('扫描文件 ' + files.length + ' 个：' + rel(ROOT) + '\n');

/* ---------- 1. JSON 可解析 ---------- */
files.filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
    try {
        JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (error) {
        report(f, 'JSON 解析失败：' + error.message);
    }
});

/* ---------- 2. app.json 页面四件套齐全 ---------- */
try {
    var appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    (appJson.pages || []).forEach(function (page) {
        ['.js', '.wxml', '.json', '.wxss'].forEach(function (ext) {
            var target = path.join(ROOT, page + ext);
            if (!fs.existsSync(target)) report(path.join(ROOT, 'app.json'), '页面文件缺失：' + page + ext);
        });
    });
} catch (error) {
    report(path.join(ROOT, 'app.json'), '读取失败：' + error.message);
}

/* ---------- 3. wxml 事件绑定 ↔ js 定义 ---------- */
var EVENT_ATTR = /(?:bind|catch|capture-bind|capture-catch):?([a-zA-Z-]+)\s*=\s*"([A-Za-z_$][\w$]*)"/g;

files.filter(function (f) { return f.endsWith('.wxml'); }).forEach(function (f) {
    var wxml = fs.readFileSync(f, 'utf8');
    var jsFile = f.replace(/\.wxml$/, '.js');
    var js = fs.existsSync(jsFile) ? fs.readFileSync(jsFile, 'utf8') : '';
    var match;
    var seen = {};
    while ((match = EVENT_ATTR.exec(wxml))) {
        var handler = match[2];
        if (seen[handler]) continue;
        seen[handler] = true;
        var defined = new RegExp('\\b' + handler + '\\s*:\\s*function\\b').test(js) ||
            new RegExp('\\b' + handler + '\\s*:\\s*\\([^)]*\\)\\s*=>').test(js);
        if (!defined) report(f, '事件处理函数未定义：' + handler + '（应在 ' + path.basename(jsFile) + ' 中）');
    }
});

/* ---------- 4. require 相对路径存在 ---------- */
var REQUIRE_RE = /require\(\s*'([^']+)'\s*\)/g;

files.filter(function (f) { return f.endsWith('.js'); }).forEach(function (f) {
    var js = fs.readFileSync(f, 'utf8');
    var match;
    while ((match = REQUIRE_RE.exec(js))) {
        var target = path.resolve(path.dirname(f), match[1]);
        if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) {
            report(f, 'require 路径不存在：' + match[1]);
        }
    }
});

/* ---------- 5. 变量下标提醒 ---------- */
var SUBSCRIPT_RE = /\{\{[^}]*\[[a-zA-Z_$][\w$]*\][^}]*\}\}/g;

files.filter(function (f) { return f.endsWith('.wxml'); }).forEach(function (f) {
    var wxml = fs.readFileSync(f, 'utf8');
    var match;
    while ((match = SUBSCRIPT_RE.exec(wxml))) {
        console.log('[提醒] ' + rel(f) + ' → 变量下标写法（建议预计算）：' + match[0].slice(0, 70));
    }
});

/* ---------- 6. 内置 Key 泄露提醒（不阻断） ---------- */
try {
    var configFile = path.join(ROOT, 'utils', 'config.js');
    if (fs.existsSync(configFile)) {
        var keyMatch = /AMAP_KEY\s*:\s*['"]([^'"]*)['"]/.exec(fs.readFileSync(configFile, 'utf8'));
        if (keyMatch && keyMatch[1].trim()) {
            console.log('[提醒] utils/config.js 里有非空内置 Key（' + keyMatch[1].trim().slice(0, 4) +
                '****）：本仓库是公开仓库，提交前务必清空！');
        }
    }
} catch (error) {
    console.log('[提醒] 检查内置 Key 失败：' + error.message);
}

console.log('\n完成：' + (problems ? problems + ' 个问题待处理' : '未发现问题'));
process.exit(problems ? 1 : 0);
