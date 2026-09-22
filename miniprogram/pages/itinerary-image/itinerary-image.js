/**
 * 拾途 Paper Trip · 行程图
 * 把行程画成一张竖版长图（站点 / 时间 / 通勤），可保存相册或分享给朋友。
 * 画布用 Canvas 2D 绘制；数据取自本地，通勤细节复用已缓存的高德真实值。
 */
var StoreModule = require('../../utils/store.js');
var Store = StoreModule.Store;
var Routes = require('../../utils/routes.js');
var Fmt = require('../../utils/format.js');

var WIDTH = 680;                       // 绘图逻辑宽度（px）
var PAD = 44;                          // 左右留白
var INK = '#1e302c';
var INK_SOFT = '#39514c';
var INK_MUTED = '#5e746e';
var INK_FAINT = '#9aa8a2';
var PAPER = '#f8faee';
var LINE = 'rgba(31, 52, 48, 0.18)';

function setFont(ctx, size, bold) {
    ctx.font = (bold ? 'bold ' : '') + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
}

/** 按最大宽度折行（先按 \n 分段；中文逐字折行） */
function wrapLines(ctx, text, maxWidth) {
    var result = [];
    String(text === undefined || text === null ? '' : text).split('\n').forEach(function (segment) {
        var line = '';
        for (var i = 0; i < segment.length; i++) {
            var next = line + segment[i];
            if (ctx.measureText(next).width > maxWidth && line) {
                result.push(line);
                line = segment[i];
            } else {
                line = next;
            }
        }
        if (line) result.push(line);
        if (!segment) result.push('');
    });
    return result;
}

/** 成组布局块：paint(ctx) 负责绘制，h 为高度 */
function block(type, height, paint) {
    return { type: type, h: height, paint: paint };
}

Page({
    data: {
        ready: false,
        cssWidth: 320,
        cssHeight: 480
    },

    onLoad: function () {
        this._destroyed = false;
        this._canvas = null;
        this._ctx = null;
        this._filePath = '';
        this._dpr = 2;

        var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this._windowWidth = (info && info.windowWidth) || 375;
        this._dpr = Math.min(3, (info && info.pixelRatio) || 2);
    },

    onUnload: function () { this._destroyed = true; },

    onReady: function () {
        var self = this;
        wx.createSelectorQuery().select('#trip-canvas').fields({ node: true, size: true }).exec(function (res) {
            if (self._destroyed || !res || !res[0] || !res[0].node) {
                self.setData({ ready: true });
                return;
            }
            self._canvas = res[0].node;
            self._ctx = self._canvas.getContext('2d');
            self.render();
        });
    },

    /* ================= 渲染 ================= */

    render: function () {
        var self = this;
        var ctx = this._ctx;
        if (!ctx) return;

        var blocks = this.buildBlocks(ctx);
        var height = PAD;
        blocks.forEach(function (item) { height += item.h; });
        height = Math.max(860, height + PAD);
        this._height = height;

        var cssWidth = this._windowWidth - 32;
        var cssHeight = Math.round(height * cssWidth / WIDTH);
        this.setData({ cssWidth: cssWidth, cssHeight: cssHeight }, function () {
            if (self._destroyed) return;
            var canvas = self._canvas;
            canvas.width = WIDTH * self._dpr;
            canvas.height = height * self._dpr;
            ctx.scale(self._dpr, self._dpr);
            ctx.fillStyle = PAPER;
            ctx.fillRect(0, 0, WIDTH, height);
            var y = PAD;
            blocks.forEach(function (item) {
                item.paint(ctx, y);
                y += item.h;
            });
            self.exportImage();
        });
    },

    /** 把行程组织成绘制块（含简单测量） */
    buildBlocks: function (ctx) {
        var blocks = [];
        var contentWidth = WIDTH - PAD * 2;
        var state = Store.state;

        // ---- 标题 ----
        setFont(ctx, 34, true);
        var titleLines = wrapLines(ctx, state.trip.title, contentWidth);
        blocks.push(block('title', 40 + (titleLines.length - 1) * 44, function (c, y) {
            c.fillStyle = INK;
            setFont(c, 34, true);
            titleLines.forEach(function (line, index) {
                c.fillText(line, PAD, y + 34 + index * 44);
            });
        }));

        // ---- 概览一行 ----
        var totals = Store.totalStats();
        var metaText = '共 ' + totals.places + ' 个地点 · 已安排 ' + totals.count +
            ' 站 · 直线 ' + totals.distance.toFixed(1) + ' km';
        if (totals.cost > 0) metaText += ' · 消费 ¥' + Fmt.formatMoney(totals.cost);
        blocks.push(block('meta', 34, function (c, y) {
            c.fillStyle = INK_MUTED;
            setFont(c, 15, false);
            c.fillText(metaText, PAD, y + 18);
        }));

        if (state.trip.note) {
            setFont(ctx, 14, false);
            var noteLines = wrapLines(ctx, state.trip.note, contentWidth).slice(0, 3);
            blocks.push(block('note', 8 + noteLines.length * 21, function (c, y) {
                c.fillStyle = INK_FAINT;
                setFont(c, 14, false);
                noteLines.forEach(function (line, index) {
                    c.fillText(line, PAD, y + 16 + index * 21);
                });
            }));
        }

        // ---- 分隔线 ----
        blocks.push(block('divider', 30, function (c, y) {
            c.strokeStyle = LINE;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(PAD, y + 14.5);
            c.lineTo(WIDTH - PAD, y + 14.5);
            c.stroke();
        }));

        var labels = Fmt.buildStopLabels(state);

        state.days.forEach(function (day) {
            var stats = Store.dayStats(day);
            var timeline = Store.computeTimeline(day, Routes.realLegMinutesFor(day));
            var dayColor = Store.dayColor(day.id);

            // ---- 天标题 ----
            var dayMeta = stats.count + ' 站';
            if (day.date) dayMeta += ' · ' + Fmt.formatDateLabel(day.date);
            setFont(ctx, 25, true);
            var dayMetaX = PAD + 26 + ctx.measureText(day.name).width + 14;
            blocks.push(block('day', 62, function (c, y) {
                c.fillStyle = dayColor;
                c.beginPath();
                c.arc(PAD + 7, y + 24, 7, 0, Math.PI * 2);
                c.fill();
                c.fillStyle = INK;
                setFont(c, 25, true);
                c.fillText(day.name, PAD + 26, y + 33);
                c.fillStyle = INK_MUTED;
                setFont(c, 14, false);
                c.fillText(dayMeta, dayMetaX, y + 32);
            }));

            if (!timeline.length) {
                blocks.push(block('empty-day', 40, function (c, y) {
                    c.fillStyle = INK_FAINT;
                    setFont(c, 14, false);
                    c.fillText('（这一天还没有安排）', PAD + 26, y + 18);
                }));
                return;
            }

            timeline.forEach(function (entry, index) {
                var place = entry.place;
                if (!place) return;
                var category = Store.getCategory(place.categoryId);
                var badge = labels[place.id] || String(index + 1);

                // 时间行
                var timeText;
                if (entry.fixed) timeText = entry.item.time;
                else if (entry.start !== null) timeText = '约 ' + Store.formatMinutes(entry.start);
                else timeText = '时间待定';
                var chips = [timeText];
                if (entry.item.stay) chips.push('停留 ' + entry.item.stay + ' 分');
                if (entry.late) chips.push('⚠ 迟到 ' + entry.lateBy + ' 分');
                var chipsText = chips.join(' · ');

                setFont(ctx, 23, true);
                var nameLines = wrapLines(ctx, place.name, contentWidth - 54).slice(0, 2);

                setFont(ctx, 14, false);
                var noteLines = entry.item.note ? wrapLines(ctx, entry.item.note, contentWidth - 54).slice(0, 3) : [];

                var itemHeight = 12 + nameLines.length * 31 + 24 + (noteLines.length ? 6 + noteLines.length * 21 : 0);
                blocks.push(block('item', itemHeight, (function (badgeText, badgeColor, nameLines2, noteLines2) {
                    return function (c, y) {
                        // 徽标
                        c.fillStyle = badgeColor;
                        c.beginPath();
                        c.arc(PAD + 15, y + 21, 15, 0, Math.PI * 2);
                        c.fill();
                        c.fillStyle = '#fffdf6';
                        setFont(c, 15, true);
                        c.textAlign = 'center';
                        c.fillText(badgeText, PAD + 15, y + 26);
                        c.textAlign = 'left';
                        // 地点名
                        c.fillStyle = INK;
                        setFont(c, 23, true);
                        nameLines2.forEach(function (line, lineIndex) {
                            c.fillText(line, PAD + 42, y + 30 + lineIndex * 31);
                        });
                        var metaY = y + 30 + nameLines2.length * 31 + 2;
                        c.fillStyle = INK_MUTED;
                        setFont(c, 14, false);
                        c.fillText(chipsText, PAD + 42, metaY);
                        noteLines2.forEach(function (line, noteIndex) {
                            c.fillStyle = INK_SOFT;
                            setFont(c, 14, false);
                            c.fillText(line, PAD + 42, metaY + 21 + noteIndex * 21);
                        });
                    };
                })(badge, category ? category.color : '#3f7e73', nameLines, noteLines));

                // 通勤行
                if (index < timeline.length - 1 && timeline[index + 1].place) {
                    var nextPlace = timeline[index + 1].place;
                    var km = StoreModule.computeDistKm(place.lat, place.lng, nextPlace.lat, nextPlace.lng);
                    var cached = Routes.fetchable(entry.legMode)
                        ? Routes.get(entry.legMode, place, nextPlace)
                        : undefined;
                    var route = cached === undefined ? null : cached;
                    var legText = Fmt.legRowText(entry, km, route);
                    var trips = Fmt.countLegTrips(state, place.id, nextPlace.id);
                    if (trips >= 2) legText += ' · ×' + trips;
                    setFont(ctx, 13, false);
                    var legLines = wrapLines(ctx, '↓ ' + legText, contentWidth - 42).slice(0, 2);
                    blocks.push(block('leg', 6 + legLines.length * 19 + 8, function (c, y) {
                        c.fillStyle = INK_FAINT;
                        setFont(c, 13, false);
                        legLines.forEach(function (line, lineIndex) {
                            c.fillText(line, PAD + 42, y + 17 + lineIndex * 19);
                        });
                    }));
                }
            });

            blocks.push(block('day-gap', 16, function () { }));
        });

        // ---- 页脚 ----
        blocks.push(block('footer', 70, function (c, y) {
            c.strokeStyle = LINE;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(PAD, y + 15.5);
            c.lineTo(WIDTH - PAD, y + 15.5);
            c.stroke();
            var now = new Date();
            var dateText = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' +
                ('0' + now.getDate()).slice(-2);
            c.fillStyle = INK_FAINT;
            setFont(c, 13, false);
            c.fillText('拾途 Paper Trip · 轻量行程规划', PAD, y + 42);
            c.textAlign = 'right';
            c.fillText(dateText + ' 生成', WIDTH - PAD, y + 42);
            c.textAlign = 'left';
        }));

        return blocks;
    },

    exportImage: function () {
        var self = this;
        wx.canvasToTempFilePath({
            canvas: this._canvas,
            fileType: 'png',
            success: function (res) {
                if (self._destroyed) return;
                self._filePath = res.tempFilePath;
                self.setData({ ready: true });
            },
            fail: function (error) {
                console.error('[itinerary-image] 导出失败：', error);
                if (self._destroyed) return;
                self.setData({ ready: true });
                wx.showToast({ title: '生成图片失败，请重试', icon: 'none' });
            }
        }, this);
    },

    /* ================= 操作 ================= */

    shareImage: function () {
        if (!this._filePath) return;
        if (typeof wx.showShareImageMenu === 'function') {
            wx.showShareImageMenu({
                path: this._filePath,
                fail: function () { /* 用户取消等场景忽略 */ }
            });
        } else {
            this.saveToAlbum();
        }
    },

    saveToAlbum: function () {
        var self = this;
        if (!this._filePath) return;
        wx.saveImageToPhotosAlbum({
            filePath: this._filePath,
            success: function () {
                wx.showToast({ title: '已保存到相册', icon: 'none' });
            },
            fail: function (error) {
                var message = (error && error.errMsg) || '';
                if (/auth|deny/i.test(message)) {
                    wx.showModal({
                        title: '需要相册权限',
                        content: '在设置里允许「保存到相册」后即可保存行程图。',
                        confirmText: '去设置',
                        success: function (res) {
                            if (res.confirm && wx.openSetting) wx.openSetting({});
                        }
                    });
                } else if (!/cancel/i.test(message)) {
                    wx.showToast({ title: '保存失败：' + message, icon: 'none' });
                }
            }
        });
    }
});
