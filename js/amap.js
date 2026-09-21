/**
 * 拾途 Paper Trip · 高德地图模块
 * 负责：底图与风格切换、按天彩色路线、编号标记、聚焦飞行动画、
 *       反向地理编码与地点搜索（依赖高德服务，失败时优雅降级）。
 *
 * 使用前请将下方 AMAP_KEY / AMAP_SECURITY_CODE 替换为自己在高德开放平台申请的 Key。
 */
(function () {
    'use strict';

    var AMAP_KEY = 'f8b329ac92b8ca0b34aa7892bbba30df';
    var AMAP_SECURITY_CODE = 'b15f612f3dacea49fe4a8036644eccab';

    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };

    var map = null;
    var markers = {};        // placeId -> AMap.Marker
    var lines = [];          // AMap.Polyline[]
    var flowMarkers = [];    // 全程流动光点（AMap.Marker）
    var flowDots = [];       // 光点运动数据 { marker, path, cum, totalKm, totalMs }
    var flowRaf = null;
    var flowEpoch = 0;
    var FLOW_HOLD = 1200;    // 每趟跑完停留（毫秒）再循环
    var DASH_LEN = 11;       // 虚线单元长度（px）
    var DASH_GAP = 7;        // 虚线间隔（px）
    var ICON_FLOW_ARROW =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
        '<path d="M12 2.2l6.6 17.4-6.6-4.3-6.6 4.3z" fill="#fffdf6" stroke="#1d2a26" stroke-width="1.5" stroke-linejoin="round"/>' +
        '</svg>';
    var callbacks = {};
    var lastModel = { points: [], lines: [] };
    var styleModes = ['dark', 'normal', 'satellite'];
    var styleIndex = 0;
    var satelliteOn = false;   // 当前是否挂着卫星图层
    var styleToken = 0;        // 样式切换令牌（防止快速连点时的异步竞态）
    var viewMode = '2D';
    var focusFrame = null;
    var focusResolve = null;
    var geocoder = null;
    var placeSearch = null;

    function prefersReduced() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function styleUrl(mode) {
        return 'amap://styles/' + (mode === 'satellite' ? 'normal' : mode);
    }

    function features() {
        return viewMode === '3D' ? ['bg', 'road', 'point', 'building'] : ['bg', 'road', 'point'];
    }

    function loadAMapAPI() {
        return new Promise(function (resolve, reject) {
            if (window.AMap) {
                resolve(window.AMap);
                return;
            }
            var script = document.createElement('script');
            script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + AMAP_KEY;
            script.async = true;
            script.onload = function () { resolve(window.AMap); };
            script.onerror = function () { reject(new Error('高德地图 API 加载失败')); };
            document.head.appendChild(script);
        });
    }

    /** 初始化地图。options: { containerId, center, zoom, mapStyle, viewMode, onMapClick, onMarkerClick, onViewChange } */
    function init(options) {
        options = options || {};
        callbacks = options;
        return loadAMapAPI()
            .then(function (AMap) {
                var container = document.getElementById(options.containerId || 'amap-container');
                if (!container) return false;

                viewMode = options.viewMode === '3D' ? '3D' : '2D';
                styleIndex = Math.max(0, styleModes.indexOf(options.mapStyle || 'dark'));

                var center = options.center || { lng: 121.4737, lat: 31.2304 };
                var zoom = typeof options.zoom === 'number' ? options.zoom : 11;

                map = new AMap.Map(container, {
                    zoom: zoom,
                    center: [center.lng, center.lat],
                    viewMode: viewMode,
                    resizeEnable: true,
                    mapStyle: styleUrl(styleModes[styleIndex]),
                    showBuildingBlock: viewMode === '3D',
                    features: features()
                });

                if (viewMode === '3D') map.setPitch(50);

                if (AMap.plugin) {
                    AMap.plugin(['AMap.Scale'], function () {
                        if (map) map.addControl(new AMap.Scale({ position: 'LB' }));
                    });
                }

                // 若上次退出时停留在卫星风格，初始化后补上卫星图层
                if (styleModes[styleIndex] === 'satellite') {
                    applyStyleMode('satellite');
                }

                map.on('click', function (event) {
                    if (callbacks.onMapClick && event && event.lnglat) {
                        callbacks.onMapClick({ lng: event.lnglat.getLng(), lat: event.lnglat.getLat() });
                    }
                });

                var viewTimer = null;
                map.on('moveend', function () {
                    if (viewTimer) window.clearTimeout(viewTimer);
                    viewTimer = window.setTimeout(function () {
                        if (!callbacks.onViewChange || !map) return;
                        var current = map.getCenter();
                        callbacks.onViewChange({ lng: current.getLng(), lat: current.getLat(), zoom: map.getZoom() });
                    }, 450);
                });

                // 标记随缩放自动放大 / 缩小
                map.on('zoomchange', updateMarkerScale);
                map.on('zoomend', updateMarkerScale);

                return true;
            })
            .catch(function (error) {
                console.error('[amap] 初始化失败：', error);
                return false;
            });
    }

    function isReady() {
        return Boolean(map && window.AMap);
    }

    function clearOverlays() {
        if (!map) return;
        stopFlowLoop();
        if (lines.length) map.remove(lines);
        var markerList = Object.keys(markers).map(function (id) { return markers[id]; });
        if (markerList.length) map.remove(markerList);
        if (flowMarkers.length) map.remove(flowMarkers);
        lines = [];
        markers = {};
        flowMarkers = [];
        flowDots = [];
    }

    /** 重建所有覆盖物。model: { points: [...], lines: [{ color, path }], flowPath: [[lng,lat],...] } */
    function render(model) {
        lastModel = model || { points: [], lines: [] };
        if (!isReady()) return;
        clearOverlays();

        (lastModel.lines || []).forEach(function (line) {
            if (!line.path || line.path.length < 2) return;
            var polyline = new window.AMap.Polyline({
                path: line.path,
                zIndex: 40,
                strokeColor: line.color || '#f261a8',
                strokeOpacity: 0.88,
                strokeWeight: 4,
                strokeStyle: 'dashed',
                strokeDasharray: [DASH_LEN, DASH_GAP],
                lineJoin: 'round',
                lineCap: 'round',
                showDir: false
            });
            map.add(polyline);
            lines.push(polyline);
        });
        addFlowDot(lastModel.flowPath || []);
        startFlowLoop();

        (lastModel.points || []).forEach(addMarker);
    }

    /**
     * 单个流动箭头：按行程站点顺序（flowPath）从头跑到尾，循环。
     * 为何用 marker 而非改虚线：折线画在高德画布上，逐帧 setOptions 受重绘节奏限制会有顿感；
     * marker 位置更新是纯 DOM 变换，与浏览器刷新率一致，顺滑且开销极小。
     */
    function addFlowDot(pointList) {
        var path = [];
        (pointList || []).forEach(function (point) {
            var last = path[path.length - 1];
            if (!last || Math.abs(last[0] - point[0]) > 1e-6 || Math.abs(last[1] - point[1]) > 1e-6) {
                path.push(point);
            }
        });
        if (path.length < 2) return;

        var cum = [0];
        for (var i = 1; i < path.length; i++) {
            cum.push(cum[i - 1] + distanceKm(path[i - 1], path[i]));
        }
        var totalKm = cum[cum.length - 1];
        if (totalKm < 0.05) return;

        // 整程一趟控制在 12~45 秒，跑完停一拍再循环
        var totalMs = Math.min(45000, Math.max(12000, totalKm * 2200));

        var element = document.createElement('div');
        element.className = 'trip-flow';
        element.setAttribute('aria-hidden', 'true');
        element.innerHTML = ICON_FLOW_ARROW;
        var marker = new window.AMap.Marker({
            position: path[0],
            content: element,
            offset: new window.AMap.Pixel(-8, -8),
            zIndex: 45,
            bubble: false
        });
        map.add(marker);
        flowMarkers.push(marker);
        flowDots.push({
            marker: marker,
            element: element,
            path: path,
            cum: cum,
            totalKm: totalKm,
            totalMs: totalMs
        });
    }

    /** 单个 rAF 循环统一驱动所有光点 */
    function startFlowLoop() {
        if (flowRaf || !flowDots.length) return;
        if (!flowEpoch) flowEpoch = window.performance.now();
        function frame(now) {
            var elapsed = now - flowEpoch;
            for (var i = 0; i < flowDots.length; i++) {
                var dot = flowDots[i];
                var cycleMs = dot.totalMs + FLOW_HOLD;
                var frac = Math.min((elapsed % cycleMs) / dot.totalMs, 1);
                var pos = pointAlong(dot.path, dot.cum, frac * dot.totalKm);
                dot.marker.setPosition([pos.lng, pos.lat]);
                dot.element.style.transform = 'rotate(' + pos.angle.toFixed(1) + 'deg)';
            }
            flowRaf = window.requestAnimationFrame(frame);
        }
        flowRaf = window.requestAnimationFrame(frame);
    }

    function stopFlowLoop() {
        if (flowRaf) {
            window.cancelAnimationFrame(flowRaf);
            flowRaf = null;
        }
    }

    /** 按累计弧长取路径插值点，同时给出该段行进方位角（度；0=正北，顺时针，与屏幕 rotate 一致） */
    function pointAlong(path, cum, targetKm) {
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

    /** 两点球面距离（km），用于估算流动时长与取点 */
    function distanceKm(a, b) {
        var toRad = Math.PI / 180;
        var dLat = (b[1] - a[1]) * toRad;
        var dLng = (b[0] - a[0]) * toRad;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }

    function addMarker(point) {
        var element = document.createElement('div');
        element.className = 'trip-marker' +
            (point.isPlanned ? '' : ' is-dot') +
            (point.active ? ' is-active' : '');
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.title = point.name + (point.isPlanned ? '' : '（未安排）');
        element.setAttribute(
            'aria-label',
            (point.isPlanned ? '第 ' + point.order + ' 站：' : '未安排地点：') + point.name
        );
        // 颜色统一由分类（POI 类型）决定：已安排点为分类色，未安排小圆点同色系
        element.style.setProperty('--marker-color', point.color || '#52655e');
        if (point.isPlanned) {
            element.textContent = String(point.order);
        }

        function activate() {
            if (callbacks.onMarkerClick) callbacks.onMarkerClick(point.placeId);
        }

        element.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });

        var size = point.isPlanned ? 26 : 12;
        var scale = markerScale();
        element.style.setProperty('--marker-scale', scale);
        var marker = new window.AMap.Marker({
            position: [point.lng, point.lat],
            title: point.name,
            content: element,
            offset: new window.AMap.Pixel(-size * scale / 2, -size * scale / 2),
            zIndex: point.active ? 80 : 60,
            extData: { placeId: point.placeId, baseSize: size }
        });
        marker.on('click', activate);

        map.add(marker);
        markers[point.placeId] = marker;
    }

    /** 标记随缩放的比例：zoom ≤ 10 时约 0.55（最小），zoom ≥ 18 时为 1（当前尺寸即最大） */
    function markerScale() {
        var zoom = map ? map.getZoom() : 12;
        return Math.max(0.55, Math.min(1, 0.55 + (zoom - 10) * 0.05625));
    }

    /** 缩放变化时同步所有标记的显示比例与锚点偏移 */
    function updateMarkerScale() {
        if (!map) return;
        var scale = markerScale();
        Object.keys(markers).forEach(function (id) {
            var marker = markers[id];
            var element = typeof marker.getContent === 'function' ? marker.getContent() : null;
            if (element && element.style) element.style.setProperty('--marker-scale', scale);
            var ext = typeof marker.getExtData === 'function' ? marker.getExtData() : null;
            var base = ext && ext.baseSize ? ext.baseSize : 26;
            marker.setOffset(new window.AMap.Pixel(-base * scale / 2, -base * scale / 2));
        });
    }

    function setActive(placeId) {
        Object.keys(markers).forEach(function (id) {
            var marker = markers[id];
            var element = typeof marker.getContent === 'function' ? marker.getContent() : null;
            if (element && element.classList) {
                element.classList.toggle('is-active', id === placeId);
            }
        });
    }

    /* ================= 搜索结果预览 ================= */

    var previewMarker = null;

    /** 在搜索结果位置显示带脉冲动画的临时标记 */
    function previewLocation(lng, lat) {
        if (!map) return;
        clearPreview();
        var element = document.createElement('div');
        element.className = 'trip-marker is-preview';
        element.setAttribute('aria-hidden', 'true');
        previewMarker = new window.AMap.Marker({
            position: [lng, lat],
            content: element,
            offset: new window.AMap.Pixel(-11, -11),
            zIndex: 95
        });
        map.add(previewMarker);
    }

    function clearPreview() {
        if (previewMarker && map) {
            map.remove(previewMarker);
        }
        previewMarker = null;
    }

    function cancelFocusAnimation() {
        if (focusFrame) {
            window.cancelAnimationFrame(focusFrame);
            focusFrame = null;
        }
        if (focusResolve) {
            focusResolve(false);
            focusResolve = null;
        }
    }

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    /** 平滑飞行到目标坐标（focusPlace / flyTo 共用） */
    function animateView(endLng, endLat, endZoom) {
        if (!map) return Promise.resolve(false);
        cancelFocusAnimation();

        var startCenter = map.getCenter();
        var startZoom = map.getZoom();
        var startLng = startCenter.getLng();
        var startLat = startCenter.getLat();

        if (prefersReduced()) {
            map.setZoomAndCenter(endZoom, [endLng, endLat]);
            return Promise.resolve(true);
        }

        var lngDelta = endLng - startLng;
        var latDelta = endLat - startLat;
        var distance = Math.sqrt(lngDelta * lngDelta + latDelta * latDelta);
        var travelZoom = distance > 0.22 ? Math.min(startZoom, 10.2) : Math.min(startZoom, 12.5);
        var duration = Math.min(1500, 850 + distance * 520);
        var startedAt = null;

        return new Promise(function (resolve) {
            focusResolve = resolve;

            function step(timestamp) {
                if (!startedAt) startedAt = timestamp;
                var progress = Math.min(1, (timestamp - startedAt) / duration);
                var eased = easeInOutCubic(progress);
                var zoom;

                if (progress < 0.42) {
                    zoom = startZoom + (travelZoom - startZoom) * easeOutQuart(progress / 0.42);
                } else {
                    zoom = travelZoom + (endZoom - travelZoom) * easeOutQuart((progress - 0.42) / 0.58);
                }

                map.setZoomAndCenter(zoom, [
                    startLng + lngDelta * eased,
                    startLat + latDelta * eased
                ]);

                if (progress < 1) {
                    focusFrame = window.requestAnimationFrame(step);
                } else {
                    focusFrame = null;
                    focusResolve = null;
                    map.setZoomAndCenter(endZoom, [endLng, endLat]);
                    resolve(true);
                }
            }

            focusFrame = window.requestAnimationFrame(step);
        });
    }

    /** 飞行定位到指定地点 */
    function focusPlace(placeId, options) {
        options = options || {};
        var marker = markers[placeId];
        if (!marker || !map) return Promise.resolve(false);

        setActive(placeId);
        var target = marker.getPosition();
        var endZoom = options.zoom || (window.innerWidth <= 900 ? 14 : 15);

        if (options.instant) {
            cancelFocusAnimation();
            map.setZoomAndCenter(endZoom, [target.getLng(), target.getLat()]);
            return Promise.resolve(true);
        }
        return animateView(target.getLng(), target.getLat(), endZoom);
    }

    /** 飞行到任意坐标（搜索结果预览用） */
    function flyTo(lng, lat, zoom) {
        if (!map) return Promise.resolve(false);
        return animateView(lng, lat, zoom || (window.innerWidth <= 900 ? 15 : 16));
    }

    function fitBounds(placeIds, options) {
        if (!map) return;
        var ids = placeIds && placeIds.length
            ? placeIds.filter(function (id) { return markers[id]; })
            : Object.keys(markers);
        var overlays = ids.map(function (id) { return markers[id]; });
        if (!overlays.length) return;

        cancelFocusAnimation();

        if (overlays.length === 1) {
            var position = overlays[0].getPosition();
            map.setZoomAndCenter(15, [position.getLng(), position.getLat()]);
            return;
        }

        var padding = window.innerWidth <= 900 ? [80, 50, 150, 50] : [90, 90, 130, 90];
        map.setFitView(overlays, false, padding, (options && options.maxZoom) || 16);
    }

    /* ================= 风格 / 视图切换 ================= */

    function triggerStyleTransition(onReady) {
        var overlay = document.querySelector('.map-transition-overlay');
        if (!overlay) {
            if (onReady) onReady();
            return;
        }

        overlay.classList.add('is-active');
        overlay.classList.remove('is-revealing');

        window.setTimeout(function () {
            try {
                if (onReady) onReady();
            } catch (error) {
                console.error('[amap] 样式切换回调失败：', error);
            }
            window.setTimeout(function () {
                overlay.classList.add('is-revealing');
                overlay.classList.remove('is-active');
                window.setTimeout(function () {
                    overlay.classList.remove('is-revealing');
                }, 750);
            }, 60);
        }, 380);
    }

    /**
     * 原位切换底图样式。
     * 不再销毁重建：避免 WebGL 上下文耗尽、地图加载中切换白屏、事件句柄丢失等问题。
     * 暗黑 ↔ 标准之间只调 setMapStyle（不再重建图层，避开图层与样式加载的竞态）；
     * 从卫星切回矢量样式时才重置底图图层。
     */
    function applyStyleMode(mode) {
        if (!map || !window.AMap) return;
        var token = ++styleToken;
        try {
            if (mode === 'satellite') {
                if (window.AMap.TileLayer && typeof window.AMap.TileLayer.Satellite === 'function') {
                    map.setLayers([new window.AMap.TileLayer.Satellite()]);
                    satelliteOn = true;
                }
                return;
            }

            var target = styleUrl(mode);
            if (satelliteOn) {
                // 从卫星切回：先恢复默认底图图层，矢量样式才能生效
                map.setLayers([new window.AMap.TileLayer()]);
                satelliteOn = false;
            }
            map.setMapStyle(target);

            // setMapStyle 是异步加载样式资源：本次切换后 1s 内若无新切换，再断言一次兼底
            window.setTimeout(function () {
                if (!map || token !== styleToken) return;
                try {
                    if (typeof map.getMapStyle === 'function') {
                        var current = map.getMapStyle();
                        if (current && String(current).indexOf(mode) !== -1) return;
                    }
                    map.setMapStyle(target);
                } catch (error) {
                    /* 忽略：极端情况下保持现状 */
                }
            }, 1000);
        } catch (error) {
            console.error('[amap] 样式切换失败：', error);
        }
    }

    /** 重建地图实例（仅用于 2D/3D 视图切换——viewMode 无法原位修改） */
    function rebuild() {
        if (!map || !window.AMap) return;
        var container = map.getContainer();
        if (!container) return;

        var center = map.getCenter();
        var zoom = map.getZoom();
        var centerArr = [center.getLng(), center.getLat()];
        var mode = styleModes[styleIndex];

        cancelFocusAnimation();
        map.destroy();
        markers = {};
        lines = [];
        previewMarker = null;
        satelliteOn = false;

        map = new window.AMap.Map(container, {
            zoom: zoom,
            center: centerArr,
            viewMode: viewMode,
            resizeEnable: true,
            mapStyle: styleUrl(mode),
            showBuildingBlock: viewMode === '3D',
            features: features()
        });

        if (viewMode === '3D') map.setPitch(50);

        map.on('click', function (event) {
            if (callbacks.onMapClick && event && event.lnglat) {
                callbacks.onMapClick({ lng: event.lnglat.getLng(), lat: event.lnglat.getLat() });
            }
        });

        var viewTimer = null;
        map.on('moveend', function () {
            if (viewTimer) window.clearTimeout(viewTimer);
            viewTimer = window.setTimeout(function () {
                if (!callbacks.onViewChange || !map) return;
                var current = map.getCenter();
                callbacks.onViewChange({ lng: current.getLng(), lat: current.getLat(), zoom: map.getZoom() });
            }, 450);
        });

        map.on('zoomchange', updateMarkerScale);
        map.on('zoomend', updateMarkerScale);

        if (window.AMap.plugin) {
            window.AMap.plugin(['AMap.Scale'], function () {
                if (map) map.addControl(new window.AMap.Scale({ position: 'LB' }));
            });
        }

        if (mode === 'satellite') {
            applyStyleMode('satellite');
        }

        render(lastModel);
    }

    function cycleStyle() {
        if (!isReady()) return styleModes[styleIndex];
        styleIndex = (styleIndex + 1) % styleModes.length;
        var mode = styleModes[styleIndex];

        triggerStyleTransition(function () {
            applyStyleMode(mode);
        });
        return mode;
    }

    function toggleViewMode() {
        if (!isReady()) return viewMode;
        viewMode = viewMode === '2D' ? '3D' : '2D';

        triggerStyleTransition(function () {
            rebuild();
        });
        return viewMode;
    }

    function getStyleMode() {
        return styleModes[styleIndex];
    }

    function getViewMode() {
        return viewMode;
    }

    /* ================= 高德服务（可降级） ================= */

    function reverseGeocode(lng, lat) {
        return new Promise(function (resolve) {
            if (!window.AMap || !window.AMap.plugin) {
                resolve(null);
                return;
            }
            var settled = false;
            var timer = window.setTimeout(function () {
                if (!settled) { settled = true; resolve(null); }
            }, 6000);

            window.AMap.plugin(['AMap.Geocoder'], function () {
                try {
                    if (!geocoder) geocoder = new window.AMap.Geocoder({});
                    geocoder.getAddress([lng, lat], function (status, result) {
                        if (settled) return;
                        settled = true;
                        window.clearTimeout(timer);
                        if (status === 'complete' && result && result.regeocode) {
                            resolve(result.regeocode.formattedAddress || null);
                        } else {
                            resolve(null);
                        }
                    });
                } catch (error) {
                    if (!settled) {
                        settled = true;
                        window.clearTimeout(timer);
                        resolve(null);
                    }
                }
            });
        });
    }

    /** 地址解析：把「xx路xx号」解析成精确坐标（必要时做地理编码） */
    function geocodeAddress(address) {
        return new Promise(function (resolve, reject) {
            if (!window.AMap || !window.AMap.plugin) {
                reject(new Error('地图未就绪'));
                return;
            }
            var settled = false;
            var timer = window.setTimeout(function () {
                if (!settled) {
                    settled = true;
                    reject(new Error('地址解析服务无响应'));
                }
            }, 7000);

            window.AMap.plugin(['AMap.Geocoder'], function () {
                try {
                    if (!geocoder) geocoder = new window.AMap.Geocoder({});
                    geocoder.getLocation(address, function (status, result) {
                        if (settled) return;
                        settled = true;
                        window.clearTimeout(timer);
                        if (status === 'complete' && result && result.geocodes) {
                            var geoResults = result.geocodes.map(function (geo) {
                                return {
                                    name: geo.formattedAddress || address,
                                    address: geo.formattedAddress || '',
                                    lng: geo.location ? geo.location.lng : null,
                                    lat: geo.location ? geo.location.lat : null,
                                    level: geo.level || ''
                                };
                            }).filter(function (item) { return item.lng !== null; });
                            resolve(sortByMapCenter(geoResults));
                        } else if (status === 'no_data') {
                            resolve([]);
                        } else {
                            var detail = result && result.info ? '（' + result.info + '）' : '';
                            reject(new Error('地址解析失败：' + status + detail));
                        }
                    });
                } catch (error) {
                    if (!settled) {
                        settled = true;
                        window.clearTimeout(timer);
                        reject(error);
                    }
                }
            });
        });
    }

    /** 按与当前地图中心的距离排序，避免跨城同名结果排在前面 */
    function sortByMapCenter(results) {
        if (!map || results.length < 2) return results;
        var center = map.getCenter();
        if (!center) return results;
        var centerLng = center.getLng();
        var centerLat = center.getLat();
        var scale = Math.cos((centerLat * Math.PI) / 180);
        return results.slice().sort(function (a, b) {
            var da = Math.pow((a.lng - centerLng) * scale, 2) + Math.pow(a.lat - centerLat, 2);
            var db = Math.pow((b.lng - centerLng) * scale, 2) + Math.pow(b.lat - centerLat, 2);
            return da - db;
        });
    }

    function searchPOI(keyword) {
        return new Promise(function (resolve, reject) {
            if (!window.AMap || !window.AMap.plugin) {
                reject(new Error('地图未就绪'));
                return;
            }
            var settled = false;
            var timer = window.setTimeout(function () {
                if (!settled) {
                    settled = true;
                    reject(new Error('搜索服务无响应（请在控制台为 Key 开通搜索服务）'));
                }
            }, 7000);

            window.AMap.plugin(['AMap.PlaceSearch'], function () {
                try {
                    if (!placeSearch) {
                        placeSearch = new window.AMap.PlaceSearch({ pageSize: 8, extensions: 'base' });
                    }
                    placeSearch.search(keyword, function (status, result) {
                        if (settled) return;
                        settled = true;
                        window.clearTimeout(timer);
                        if (status === 'complete' && result && result.poiList && result.poiList.pois) {
                            var results = result.poiList.pois.map(function (poi) {
                                return {
                                    name: poi.name || '',
                                    address: poi.address || poi.pname && poi.cityname
                                        ? [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')
                                        : (poi.address || ''),
                                    lng: poi.location ? poi.location.lng : null,
                                    lat: poi.location ? poi.location.lat : null
                                };
                            }).filter(function (poi) { return poi.name && poi.lng !== null; });
                            resolve(sortByMapCenter(results));
                        } else if (status === 'no_data') {
                            resolve([]);
                        } else {
                            var detail = result && result.info ? '（' + result.info + '）' : '';
                            reject(new Error('搜索失败：' + status + detail));
                        }
                    });
                } catch (error) {
                    if (!settled) {
                        settled = true;
                        window.clearTimeout(timer);
                        reject(error);
                    }
                }
            });
        });
    }

    window.TripMap = {
        init: init,
        isReady: isReady,
        render: render,
        setActive: setActive,
        focusPlace: focusPlace,
        fitBounds: fitBounds,
        cycleStyle: cycleStyle,
        toggleViewMode: toggleViewMode,
        getStyleMode: getStyleMode,
        getViewMode: getViewMode,
        reverseGeocode: reverseGeocode,
        geocodeAddress: geocodeAddress,
        searchPOI: searchPOI,
        flyTo: flyTo,
        previewLocation: previewLocation,
        clearPreview: clearPreview
    };
})();
