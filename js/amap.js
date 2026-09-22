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
    var builtStyle = styleModes[0];  // 当前实例构建时的风格（与期望不同才触发重建）
    var builtView = '2D';            // 当前实例构建时的视图模式
    var viewMode = '2D';
    var focusFrame = null;
    var focusResolve = null;
    var geocoder = null;
    var geocoderFull = null;   // extensions: 'all'，选点时取周边 POI
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

    /** 地图点击转发：带上容器内屏幕坐标，供选点浮层定位 */
    function emitMapClick(event) {
        if (!callbacks.onMapClick || !event || !event.lnglat) return;
        var coords = {
            lng: event.lnglat.getLng(),
            lat: event.lnglat.getLat()
        };
        if (event.originEvent && isFinite(event.originEvent.clientX)) {
            coords.clientX = event.originEvent.clientX;
            coords.clientY = event.originEvent.clientY;
        } else if (event.pixel && map && map.getContainer) {
            var pixelX = typeof event.pixel.getX === 'function' ? event.pixel.getX() : event.pixel.x;
            var pixelY = typeof event.pixel.getY === 'function' ? event.pixel.getY() : event.pixel.y;
            if (isFinite(pixelX) && isFinite(pixelY)) {
                var rect = map.getContainer().getBoundingClientRect();
                coords.clientX = rect.left + pixelX;
                coords.clientY = rect.top + pixelY;
            }
        }
        callbacks.onMapClick(coords);
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

                // 新建实例上应用当前风格（运行时原地切换不可靠，详见 applyStyleOnFreshMap 注释）
                applyStyleOnFreshMap(styleModes[styleIndex]);
                builtStyle = styleModes[styleIndex];
                builtView = viewMode;

                map.on('click', emitMapClick);

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
            (point.isPlanned ? point.labelText + '：' : '未安排地点：') + point.name
        );
        // 颜色统一由分类（POI 类型）决定：已安排点为分类色，未安排小圆点同色系
        element.style.setProperty('--marker-color', point.color || '#3f7e73');
        if (point.isPlanned) {
            element.textContent = point.label;
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

    /** 卫星图层叠层（矢量底图 + 卫星瓦片）：仅在实例刚创建后调用 */
    function attachSatelliteLayer() {
        if (!map || !window.AMap || satelliteOn) return;
        try {
            if (window.AMap.TileLayer && typeof window.AMap.TileLayer.Satellite === 'function') {
                map.setLayers([new window.AMap.TileLayer.Satellite()]);
                satelliteOn = true;
            }
        } catch (error) {
            console.error('[amap] 卫星图层开启失败：', error);
        }
    }

    /**
     * 在「刚创建的实例」上应用风格。
     * 根本教训（2026-09-22 实测）：
     *   a) 运行中原地 setMapStyle 不可靠——卫星 → 矢量需先 setLayers 重建底图图层，
     *      图层加载与样式加载竞态，样式请求常被静默吞掉；
     *   b) getMapStyle() 返回「已请求」值而非实际渲染值，用它校验会被骗（永远报成功）；
     *   c) 这解释了「刷新页面就正常」——新建实例上应用样式是唯一实测可靠的路径。
     * 因此所有运行时风格切换一律走「销毁 + 重建实例」（rebuild），重建后调本函数兜底应用。
     */
    function applyStyleOnFreshMap(mode) {
        if (!map || !window.AMap) return;
        if (mode === 'satellite') attachSatelliteLayer();
        try {
            map.setMapStyle(styleUrl(mode));
        } catch (error) {
            console.error('[amap] 样式应用失败：', error);
        }
    }

    /* 运行时重建调度：风格切换与 2D/3D 切换共用一次重建；切换过程中的连点合并成一次补重建 */
    var switching = false;
    var pendingRebuild = false;

    function requestMapRebuild() {
        if (!map || !window.AMap) return;
        if (switching) {
            pendingRebuild = true;
            return;
        }
        if (styleModes[styleIndex] === builtStyle && viewMode === builtView) return;
        switching = true;
        triggerStyleTransition(rebuild);
        window.setTimeout(function () {
            switching = false;
            if (pendingRebuild || styleModes[styleIndex] !== builtStyle || viewMode !== builtView) {
                pendingRebuild = false;
                requestMapRebuild();
            }
        }, 1600);
    }

    /** 重建地图实例（风格切换与 2D/3D 视图切换共用：运行时原地修改均不可靠） */
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

        map.on('click', emitMapClick);

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

        // 在新实例上应用风格，并记录本实例构建参数（供重建调度判断是否还需要重建）
        applyStyleOnFreshMap(mode);
        builtStyle = mode;
        builtView = viewMode;

        render(lastModel);
    }

    function cycleStyle() {
        if (!isReady()) return styleModes[styleIndex];
        styleIndex = (styleIndex + 1) % styleModes.length;
        // 运行时原地 setMapStyle 不可靠（详见 applyStyleOnFreshMap 注释）：统一走重建
        requestMapRebuild();
        return styleModes[styleIndex];
    }

    function toggleViewMode() {
        if (!isReady()) return viewMode;
        viewMode = viewMode === '2D' ? '3D' : '2D';
        requestMapRebuild();
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

    /** 逆地理取城市名（公交路径规划需要城市参数） */
    function resolveCityName(lng, lat) {
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
                        var comp = status === 'complete' && result && result.regeocode
                            ? result.regeocode.addressComponent : null;
                        resolve(comp ? (comp.city || comp.province || null) : null);
                    });
                } catch (error) {
                    if (!settled) { settled = true; window.clearTimeout(timer); resolve(null); }
                }
            });
        });
    }

    /**
     * 公交换乘摘要：返回「地铁1号线 · 上海南站 → 衡山路站」样式的首段公交/地铁信息。
     * 用于地铁/公交通勤备注留空时自动显示导航结果；失败返回 null。
     */
    function transitSummary(fromLng, fromLat, toLng, toLat) {
        return new Promise(function (resolve) {
            if (!window.AMap || !window.AMap.plugin) {
                resolve(null);
                return;
            }
            resolveCityName(fromLng, fromLat).then(function (city) {
                var settled = false;
                var timer = window.setTimeout(function () {
                    if (!settled) { settled = true; resolve(null); }
                }, 8000);
                window.AMap.plugin(['AMap.Transfer'], function () {
                    try {
                        var transfer = new window.AMap.Transfer({
                            city: city || '全国',
                            policy: window.AMap.TransferPolicy ? window.AMap.TransferPolicy.LEAST_TIME : 0,
                            autoFitView: false
                        });
                        transfer.search(
                            new window.AMap.LngLat(Number(fromLng), Number(fromLat)),
                            new window.AMap.LngLat(Number(toLng), Number(toLat)),
                            function (status, result) {
                                if (settled) return;
                                settled = true;
                                window.clearTimeout(timer);
                                resolve(parseTransitResult(status, result));
                            }
                        );
                    } catch (error) {
                        if (!settled) { settled = true; window.clearTimeout(timer); resolve(null); }
                    }
                });
            });
        });
    }

    function parseTransitResult(status, result) {
        if (status !== 'complete' || !result || !result.plans || !result.plans.length) return null;
        var segments = result.plans[0].segments || [];
        for (var i = 0; i < segments.length; i++) {
            var transit = segments[i] && segments[i].transit;
            if (!transit || !transit.lines || !transit.lines.length) continue;
            var line = transit.lines[0];
            // 去掉线路名里的方向后缀，如「地铁1号线(莘庄--富锦路)」→「地铁1号线」
            var name = String(line.name || '').replace(/[（(].*$/, '').trim();
            if (!name) continue;
            // 上下车站：JS API 实测字段为 on_station / off_station，兼容 departure_stop / arrival_stop 写法
            var dep = stopName(transit.on_station) || stopName(line.departure_stop);
            var arr = stopName(transit.off_station) || stopName(line.arrival_stop);
            return name + (dep && arr ? ' · ' + dep + ' → ' + arr : '');
        }
        return null;
    }

    function stopName(stop) {
        return stop && stop.name ? String(stop.name) : '';
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

    /**
     * 附近地址候选（地图选点用）：给定坐标，返回由近及远的
     * 门牌号 / 周边 POI / 道路，最多 6 条。
     */
    function nearbyPlaces(lng, lat) {
        return new Promise(function (resolve) {
            if (!window.AMap || !window.AMap.plugin) {
                resolve([]);
                return;
            }
            var settled = false;
            var timer = window.setTimeout(function () {
                if (!settled) { settled = true; resolve([]); }
            }, 7000);

            window.AMap.plugin(['AMap.Geocoder'], function () {
                try {
                    if (!geocoderFull) geocoderFull = new window.AMap.Geocoder({ extensions: 'all' });
                    geocoderFull.getAddress([lng, lat], function (status, result) {
                        if (settled) return;
                        settled = true;
                        window.clearTimeout(timer);
                        if (status === 'complete' && result && result.regeocode) {
                            resolve(buildNearbyCandidates(result.regeocode, lng, lat));
                        } else {
                            resolve([]);
                        }
                    });
                } catch (error) {
                    if (!settled) {
                        settled = true;
                        window.clearTimeout(timer);
                        resolve([]);
                    }
                }
            });
        });
    }

    /** 把逆地理结果整理成候选列表（按距离升序，去重取前 6） */
    function buildNearbyCandidates(regeo, clickLng, clickLat) {
        var list = [];
        var seen = {};
        var component = regeo.addressComponent || {};

        function push(name, address, tag, location) {
            if (!name || seen[name]) return;
            var coords = locationToLngLat(location);
            if (!coords) return;
            seen[name] = true;
            list.push({
                name: name,
                address: address || '',
                tag: tag || '',
                lng: coords[0],
                lat: coords[1],
                distance: metersBetween(clickLng, clickLat, coords[0], coords[1])
            });
        }

        var streetNumber = component.streetNumber || {};
        if (streetNumber.street) {
            var numberText = streetNumber.street + (streetNumber.number || '');
            push(numberText, regeo.formattedAddress || numberText, '门牌号', streetNumber.location);
        }

        (regeo.pois || []).forEach(function (poi) {
            var tag = String(poi.type || '').split(';').filter(Boolean).pop() || '';
            push(poi.name, poi.address || '', tag, poi.location);
        });

        (regeo.roads || []).forEach(function (road) {
            push(road.name, regeo.formattedAddress || '', '道路', road.location);
        });

        list.sort(function (a, b) { return a.distance - b.distance; });
        return list.slice(0, 6);
    }

    /** 兼容 LngLat / 字面量 / 数组多种坐标写法 */
    function locationToLngLat(location) {
        if (!location) return null;
        if (typeof location.getLng === 'function') return [location.getLng(), location.getLat()];
        if (typeof location.lng === 'number' && typeof location.lat === 'number') return [location.lng, location.lat];
        if (Object.prototype.toString.call(location) === '[object Array]' && location.length === 2) {
            var lng = Number(location[0]);
            var lat = Number(location[1]);
            return isFinite(lng) && isFinite(lat) ? [lng, lat] : null;
        }
        return null;
    }

    /** 两点间球面距离（米） */
    function metersBetween(lng1, lat1, lng2, lat2) {
        var radius = 6371000;
        var toRad = Math.PI / 180;
        var dLat = (lat2 - lat1) * toRad;
        var dLng = (lng2 - lng1) * toRad;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
                                var typeParts = poi.type ? poi.type.split(';').filter(Boolean) : [];
                                return {
                                    name: poi.name || '',
                                    address: poi.address || poi.pname && poi.cityname
                                        ? [poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean).join(' ')
                                        : (poi.address || ''),
                                    lng: poi.location ? poi.location.lng : null,
                                    lat: poi.location ? poi.location.lat : null,
                                    type: typeParts.length ? typeParts[typeParts.length - 1] : ''
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
        transitSummary: transitSummary,
        geocodeAddress: geocodeAddress,
        nearbyPlaces: nearbyPlaces,
        searchPOI: searchPOI,
        flyTo: flyTo,
        previewLocation: previewLocation,
        clearPreview: clearPreview
    };
})();
