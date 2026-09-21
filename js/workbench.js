/**
 * 拾途 Paper Trip · 工作台交互
 * 负责：面板渲染（行程 / 地点库）、拖拽编排、编辑弹窗、地图联动、
 *       按序浏览、导入导出、Toast 提示。
 */
(function () {
    'use strict';

    var els = {};
    var activeDayId = null;
    var activePlaceId = null;
    var activePane = 'itinerary';
    var editingPlaceId = null;
    var editingItemId = null;
    var pickMode = false;
    var pickNewOnly = false;
    var pickHadOpenModal = false;
    var pickSnapshot = null;
    var playbackTimer = null;
    var playingDayId = null;
    var searchDebounce = null;
    var libFilter = { keyword: '', categoryId: 'all' };
    var mapReady = false;
    var dragPayload = null;
    var editingLegItemId = null;
    var editingLegMode = '';
    var legContext = null;
    var touchDrag = null;

    var LEG_MODE_LABELS = { walk: '步行', bike: '骑行', drive: '驾驶', taxi: '出租', bus: '公交', metro: '地铁', rail: '动车', other: '其他' };
    var LEG_MODE_ORDER = ['walk', 'bike', 'drive', 'taxi', 'bus', 'metro', 'rail', 'other'];

    /* 按钮图标（线性描边，跟字体颜色联动） */
    var ICON_PENCIL = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    var ICON_NAV = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M22 2L11 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M22 2l-7 20-4-9-9-4 20-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    var ICON_REMOVE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    var ICON_RESTORE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M1 4v6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_X = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    function $(id) {
        return document.getElementById(id);
    }

    /* ================= 初始化 ================= */

    function init() {
        els = {
            app: $('app'),
            tripTitle: $('trip-title'),
            tabItinerary: $('tab-itinerary'),
            tabLibrary: $('tab-library'),
            paneItinerary: $('pane-itinerary'),
            paneLibrary: $('pane-library'),
            dayTabs: $('day-tabs'),
            addDayBtn: $('add-day-btn'),
            daySummary: $('day-summary'),
            dayEditBtn: $('day-edit-btn'),
            fitDayBtn: $('fit-day-btn'),
            playDayBtn: $('play-day-btn'),
            itemList: $('item-list'),
            itineraryEmpty: $('itinerary-empty'),
            libSearch: $('lib-search'),
            libCategories: $('lib-categories'),
            placeList: $('place-list'),
            libraryEmpty: $('library-empty'),
            newPlaceBtn: $('new-place-btn'),
            pickMapBtn: $('pick-map-btn'),
            statsBtn: $('stats-btn'),
            styleBtn: $('style-btn'),
            viewBtn: $('view-btn'),
            helpBtn: $('help-btn'),
            mapStatus: $('map-status'),
            mapEmpty: $('map-empty'),
            mapEmptyBtn: $('map-empty-btn'),
            sheetToggle: $('sheet-toggle'),
            fallback: $('amap-fallback'),
            toasts: $('toasts'),
            placeModal: $('place-modal'),
            placeForm: $('place-form'),
            placeModalTitle: $('place-modal-title'),
            placeName: $('place-name'),
            placeCategory: $('place-category'),
            placeLng: $('place-lng'),
            placeLat: $('place-lat'),
            placeAddress: $('place-address'),
            placeNote: $('place-note'),
            placePickBtn: $('place-pick-btn'),
            placeDeleteBtn: $('place-delete-btn'),
            poiKeyword: $('poi-keyword'),
            poiSearchBtn: $('poi-search-btn'),
            poiResults: $('poi-results'),
            itemModal: $('item-modal'),
            itemForm: $('item-form'),
            itemPlaceName: $('item-place-name'),
            itemTime: $('item-time'),
            itemStay: $('item-stay'),
            itemDay: $('item-day'),
            itemNote: $('item-note'),
            itemDeleteBtn: $('item-delete-btn'),
            dayModal: $('day-modal'),
            dayForm: $('day-form'),
            dayName: $('day-name'),
            dayDate: $('day-date'),
            dayDeleteBtn: $('day-delete-btn'),
            importFile: $('import-file'),
            helpExportBtn: $('help-export-btn'),
            helpImportBtn: $('help-import-btn'),
            helpClearBtn: $('help-clear-btn'),
            itineraryBtn: $('itinerary-btn'),
            helpItineraryBtn: $('help-itinerary-btn'),
            tripEditBtn: $('trip-edit-btn'),
            tripModal: $('trip-modal'),
            tripForm: $('trip-form'),
            tripModalTitle: $('trip-modal-title'),
            tripNote: $('trip-note'),
            legModal: $('leg-modal'),
            legForm: $('leg-form'),
            legRoute: $('leg-route'),
            legModes: $('leg-modes'),
            legEstimate: $('leg-estimate'),
            legNote: $('leg-note'),
            legClearBtn: $('leg-clear-btn'),
            globalSearch: $('global-search'),
            globalSearchBtn: $('global-search-btn'),
            globalResults: $('global-results')
        };

        Store.subscribe(renderAll);

        if (!activeDayId || !Store.getDay(activeDayId)) {
            activeDayId = Store.state.days[0].id;
        }

        bindStaticEvents();
        updateViewButtonLabel();
        renderAll();
    }

    function bindStaticEvents() {
        // 面板切换
        els.tabItinerary.addEventListener('click', function () { switchPane('itinerary'); });
        els.tabLibrary.addEventListener('click', function () { switchPane('library'); });

        // 行程标题
        els.tripTitle.addEventListener('input', function () {
            Store.state.trip.title = els.tripTitle.value.trim() || '我的行程';
            Store.saveSoon();
        });
        els.tripTitle.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') els.tripTitle.blur();
        });

        // 增加一天（已有日期时自动顺延）
        els.addDayBtn.addEventListener('click', function () {
            var day = Store.addDay();
            setActiveDay(day.id);
            toast('已增加 ' + dayTabLabel(day));
        });

        // 天标签：点击切换 + 拖拽投放
        els.dayTabs.addEventListener('click', function (event) {
            var tab = event.target.closest('.day-tab');
            if (tab) setActiveDay(tab.dataset.dayId);
        });
        els.dayTabs.addEventListener('dragover', function (event) {
            var tab = event.target.closest('.day-tab');
            if (!tab || !dragPayload) return;
            event.preventDefault();
            tab.classList.add('is-drop');
        });
        els.dayTabs.addEventListener('dragleave', function (event) {
            var tab = event.target.closest('.day-tab');
            if (tab) tab.classList.remove('is-drop');
        });
        els.dayTabs.addEventListener('drop', function (event) {
            var tab = event.target.closest('.day-tab');
            if (!tab) return;
            event.preventDefault();
            tab.classList.remove('is-drop');
            var payload = parseDragPayload(event) || dragPayload;
            if (!payload) return;
            if (payload.kind === 'item') {
                Store.moveItem(payload.itemId, tab.dataset.dayId);
                setActiveDay(tab.dataset.dayId);
                toast('已移动到 ' + (Store.getDay(tab.dataset.dayId) || {}).name);
            } else if (payload.kind === 'place') {
                Store.addItem(tab.dataset.dayId, payload.placeId);
                setActiveDay(tab.dataset.dayId);
                toast('已加入 ' + (Store.getDay(tab.dataset.dayId) || {}).name);
            }
            dragPayload = null;
        });

        // 天操作
        els.dayEditBtn.innerHTML = ICON_PENCIL;
        els.dayEditBtn.addEventListener('click', openDayModal);
        els.fitDayBtn.addEventListener('click', fitActiveDay);
        els.playDayBtn.addEventListener('click', togglePlayback);

        // 行程列表：点击 + 按钮动作
        els.itemList.addEventListener('click', onItemListClick);
        bindListDrop(els.itemList);

        // 行程项拖拽
        els.itemList.addEventListener('dragstart', onCardDragStart);
        els.itemList.addEventListener('dragend', clearDragState);

        // 地点库
        els.libSearch.addEventListener('input', function () {
            if (searchDebounce) window.clearTimeout(searchDebounce);
            searchDebounce = window.setTimeout(function () {
                libFilter.keyword = els.libSearch.value.trim().toLowerCase();
                renderLibrary();
            }, 150);
        });
        els.libCategories.addEventListener('click', function (event) {
            var chip = event.target.closest('.chip');
            if (!chip) return;
            libFilter.categoryId = chip.dataset.categoryId;
            renderLibrary();
        });
        els.placeList.addEventListener('click', onPlaceListClick);
        els.placeList.addEventListener('dragstart', onCardDragStart);
        els.placeList.addEventListener('dragend', clearDragState);

        // 新建 / 选点
        els.newPlaceBtn.addEventListener('click', function () {
            openPlaceModal(null, currentViewCenter());
        });
        els.pickMapBtn.addEventListener('click', function () { startPick(true); });
        els.mapEmptyBtn.addEventListener('click', function () {
            openPlaceModal(null, currentViewCenter());
        });

        // 地图工具
        els.statsBtn.addEventListener('click', function () {
            if (window.Charts && window.Charts.openStats) window.Charts.openStats();
        });
        els.styleBtn.addEventListener('click', function () {
            if (!TripMap.isReady()) { toast('地图尚未就绪'); return; }
            var mode = TripMap.cycleStyle();
            Store.updateSettings({ mapStyle: mode });
            toast('地图风格：' + styleLabel(mode));
        });
        els.viewBtn.addEventListener('click', function () {
            if (!TripMap.isReady()) { toast('地图尚未就绪'); return; }
            var mode = TripMap.toggleViewMode();
            Store.updateSettings({ viewMode: mode });
            updateViewButtonLabel();
            toast('视图模式：' + mode);
        });
        els.helpBtn.addEventListener('click', function () {
            $('help-modal').showModal();
        });
        els.itineraryBtn.addEventListener('click', exportItineraryHTML);
        els.helpItineraryBtn.addEventListener('click', exportItineraryHTML);

        // 行程信息
        els.tripEditBtn.innerHTML = ICON_PENCIL;
        els.tripEditBtn.addEventListener('click', openTripModal);
        els.tripForm.addEventListener('submit', onTripSubmit);

        // 全局搜索（地点 + 地址双通道）
        els.globalSearchBtn.addEventListener('click', doGlobalSearch);
        els.globalSearch.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                doGlobalSearch();
            } else if (event.key === 'Escape') {
                hideGlobalResults();
            }
        });
        document.addEventListener('click', function (event) {
            if (!event.target.closest('.map-search')) hideGlobalResults();
        });

        // 通用关闭按钮
        document.addEventListener('click', function (event) {
            var closer = event.target.closest('[data-close-modal]');
            if (closer) {
                var dialog = closer.closest('dialog');
                if (dialog) dialog.close();
            }
        });

        // 地点弹窗
        els.placeForm.addEventListener('submit', onPlaceSubmit);
        els.placeDeleteBtn.addEventListener('click', onPlaceDelete);
        els.placePickBtn.addEventListener('click', function () { startPick(); });
        els.poiSearchBtn.addEventListener('click', doPoiSearch);
        els.poiKeyword.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                doPoiSearch();
            }
        });

        // 行程项弹窗
        els.itemForm.addEventListener('submit', onItemSubmit);
        els.itemDeleteBtn.addEventListener('click', onItemDelete);

        // 通勤方式弹窗
        els.legForm.addEventListener('submit', onLegSubmit);
        els.legClearBtn.addEventListener('click', onLegClear);

        // 天弹窗
        els.dayForm.addEventListener('submit', onDaySubmit);
        els.dayDeleteBtn.addEventListener('click', onDayDelete);

        // 数据管理
        els.helpExportBtn.addEventListener('click', exportData);
        els.helpImportBtn.addEventListener('click', function () { els.importFile.click(); });
        els.helpClearBtn.addEventListener('click', clearAllData);
        els.importFile.addEventListener('change', onImportFile);

        // 移动端抽屉
        els.sheetToggle.addEventListener('click', function () {
            var open = els.app.classList.toggle('sheet-open');
            els.sheetToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            els.sheetToggle.textContent = open ? '收起' : '行程';
        });

        // 拖拽结束（无论落在哪里）统一清理
        document.addEventListener('dragend', clearDragState);
        document.addEventListener('drop', clearDragState);

        // 手机端：长按卡片进入拖动排序
        bindTouchDrag(els.itemList);
    }

    /* ================= 渲染 ================= */

    function renderAll() {
        if (!Store.getDay(activeDayId)) {
            activeDayId = Store.state.days[0].id;
        }
        if (!document.activeElement || document.activeElement !== els.tripTitle) {
            els.tripTitle.value = Store.state.trip.title;
        }
        if (playingDayId && playingDayId !== activeDayId) stopPlayback();

        renderDayTabs();
        renderDayMeta();
        renderItems();
        renderLibrary();
        renderMap();
        renderEmptyStates();
        renderStatusSummary();
    }

    function renderDayTabs() {
        els.dayTabs.innerHTML = '';
        Store.state.days.forEach(function (day) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'day-tab' + (day.id === activeDayId ? ' is-active' : '');
            tab.dataset.dayId = day.id;
            tab.textContent = dayTabLabel(day);
            tab.title = day.name + (day.date ? ' · ' + formatDateLabel(day.date) : '');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', day.id === activeDayId ? 'true' : 'false');
            els.dayTabs.appendChild(tab);
        });
    }

    function renderDayMeta() {
        var day = Store.getDay(activeDayId);
        if (!day) return;
        var stats = Store.dayStats(day);
        var timeline = Store.computeTimeline(day);
        var parts = [day.name];
        if (day.date && dayTabLabel(day) !== day.name) parts.push(formatDateLabel(day.date));
        parts.push(stats.count + ' 站');
        if (stats.disabledCount) parts.push('已移除 ' + stats.disabledCount);
        parts.push('直线 ' + stats.distance.toFixed(1) + ' km');

        var starts = timeline.filter(function (entry) { return entry.start !== null; });
        var ends = timeline.filter(function (entry) { return entry.end !== null; });
        if (starts.length && ends.length) {
            parts.push(Store.formatMinutes(starts[0].start) + '–' + Store.formatMinutes(ends[ends.length - 1].end));
        }
        var lateCount = timeline.filter(function (entry) { return entry.late; }).length;
        els.daySummary.textContent = parts.join(' · ') + (lateCount ? ' · ⚠ 迟到 ' + lateCount + ' 处' : '');
    }

    function renderItems() {
        var day = Store.getDay(activeDayId);
        els.itemList.innerHTML = '';
        if (!day) return;

        var timeline = Store.computeTimeline(day);
        var labels = buildStopLabels();

        timeline.forEach(function (entry, index) {
            renderActiveCard(entry, index, labels);
            if (index < timeline.length - 1) {
                renderConnector(entry, timeline[index + 1]);
            }
        });

        var disabledItems = day.items.filter(function (item) { return item.disabled; });
        if (disabledItems.length) {
            var sectionLabel = document.createElement('li');
            sectionLabel.className = 'section-label';
            var sectionText = document.createElement('span');
            sectionText.textContent = '已移除 ' + disabledItems.length + ' 项 · 可恢复或删除';
            sectionLabel.appendChild(sectionText);
            els.itemList.appendChild(sectionLabel);

            disabledItems.forEach(function (item) {
                var place = Store.getPlace(item.placeId);
                if (!place) return;

                var card = document.createElement('li');
                card.className = 'item-card is-disabled';
                card.dataset.itemId = item.id;
                card.dataset.placeId = place.id;
                card.draggable = false;

                var badge = document.createElement('span');
                badge.className = 'item-badge';
                badge.textContent = '—';

                var main = document.createElement('div');
                main.className = 'item-main';

                var title = document.createElement('div');
                title.className = 'item-title';
                title.textContent = place.name;

                var sub = document.createElement('div');
                sub.className = 'item-sub';
                if (item.time) sub.appendChild(metaChip(item.time));
                if (item.stay) sub.appendChild(metaChip('停留 ' + item.stay + ' 分'));

                main.appendChild(title);
                main.appendChild(sub);
                if (item.note) {
                    var note = document.createElement('div');
                    note.className = 'item-note';
                    note.textContent = item.note;
                    main.appendChild(note);
                }

                var actions = document.createElement('div');
                actions.className = 'item-actions';
                actions.appendChild(iconButton('restore', ICON_RESTORE, '恢复该站点'));
                actions.appendChild(iconButton('purge', ICON_X, '彻底删除'));

                card.appendChild(badge);
                card.appendChild(main);
                card.appendChild(actions);
                els.itemList.appendChild(card);
            });
        }
    }

    function renderActiveCard(entry, index, labels) {
        var item = entry.item;
        var place = entry.place;
        if (!place) return;

        var category = Store.getCategory(place.categoryId);

        var card = document.createElement('li');
        card.className = 'item-card' +
            (place.id === activePlaceId ? ' is-active' : '') +
            (entry.late ? ' is-late' : '');
        card.dataset.itemId = item.id;
        card.dataset.placeId = place.id;
        card.draggable = true;

        var badge = document.createElement('span');
        badge.className = 'item-badge';
        badge.style.setProperty('--item-color', category ? category.color : '#3f7e73');
        badge.textContent = (labels && labels[place.id]) || String(index + 1);

        var main = document.createElement('div');
        main.className = 'item-main';

        var title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = place.name;

        var sub = document.createElement('div');
        sub.className = 'item-sub';

        if (entry.fixed) {
            sub.appendChild(metaChip(item.time, 'is-fixed'));
        } else if (entry.start !== null) {
            sub.appendChild(metaChip('约 ' + Store.formatMinutes(entry.start), 'is-est'));
        } else {
            sub.appendChild(metaChip('时间待定', 'is-est'));
        }
        if (item.stay) sub.appendChild(metaChip('停留 ' + item.stay + ' 分'));
        if (entry.late) sub.appendChild(metaChip('⚠ 迟到 ' + entry.lateBy + ' 分', 'is-late'));

        main.appendChild(title);
        main.appendChild(sub);
        if (item.note) {
            var note = document.createElement('div');
            note.className = 'item-note';
            note.textContent = item.note;
            main.appendChild(note);
        }

        var actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.appendChild(iconButton('edit', ICON_PENCIL, '编辑'));
        actions.appendChild(iconButton('nav', ICON_NAV, '高德导航到这里'));
        actions.appendChild(iconButton('disable', ICON_REMOVE, '移除该站点'));

        card.appendChild(badge);
        card.appendChild(main);
        card.appendChild(actions);
        els.itemList.appendChild(card);
    }

    function renderConnector(entry, nextEntry) {
        var place = entry.place;
        var nextPlace = nextEntry ? nextEntry.place : null;
        if (!place || !nextPlace) return;

        var row = document.createElement('li');
        row.className = 'item-connector is-action';
        row.dataset.action = 'leg';
        row.dataset.itemId = entry.item.id;
        row.title = '设置通勤方式';

        var trips = countLegTrips(place.id, nextPlace.id);
        var line = document.createElement('i');
        line.style.borderLeftColor = legTravelColor(trips);
        var label = document.createElement('span');
        var km = computeDistKm(place.lat, place.lng, nextPlace.lat, nextPlace.lng);
        label.textContent = '↓ ' + describeLeg(entry) + ' · 直线 ' + km.toFixed(1) + ' km' +
            (trips >= 2 ? ' · ×' + trips : '');

        row.appendChild(line);
        row.appendChild(label);
        els.itemList.appendChild(row);
    }

    /** 通勤行的文字描述 */
    function describeLeg(entry) {
        if (entry.legMode === 'other') {
            return '其他方式' + (entry.legNote ? '：' + entry.legNote : '');
        }
        if (entry.legMode) {
            var text = LEG_MODE_LABELS[entry.legMode];
            if (entry.legMinutes !== null) text += ' · 约 ' + entry.legMinutes + ' 分';
            if (entry.legNote) text += ' · ' + entry.legNote;
            return text;
        }
        return entry.legMinutes !== null
            ? '约 ' + entry.legMinutes + ' 分（自动估算，点此设置）'
            : '点此选择通勤方式';
    }

    /** 这段通勤在整段行程里需要走的次数（同一对地点去/回都算，跨天累计） */
    function countLegTrips(placeIdA, placeIdB) {
        if (!placeIdA || !placeIdB || placeIdA === placeIdB) return 0;
        var key = placeIdA < placeIdB ? placeIdA + '|' + placeIdB : placeIdB + '|' + placeIdA;
        var count = 0;
        Store.state.days.forEach(function (day) {
            var stops = day.items
                .filter(function (item) { return !item.disabled; })
                .map(function (item) { return item.placeId; });
            for (var i = 1; i < stops.length; i++) {
                var a = stops[i - 1];
                var b = stops[i];
                if (a === b) continue;
                var pair = a < b ? a + '|' + b : b + '|' + a;
                if (pair === key) count += 1;
            }
        });
        return count;
    }

    /** 连线颜色：粉色系渐深（玫粉 → 粉红 → 玫紫 → 紫，饱和度高，亮底暗底都清楚） */
    function legTravelColor(trips) {
        if (trips >= 4) return '#b44f0a';
        if (trips === 3) return '#dd6a0f';
        if (trips === 2) return '#ef8a22';
        return '#f4ad5e';
    }

    function metaChip(text, className) {
        var span = document.createElement('span');
        if (className) span.className = className;
        span.textContent = text;
        return span;
    }

    function iconButton(action, glyph, label) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-btn';
        button.dataset.action = action;
        button.title = label;
        button.setAttribute('aria-label', label);
        if (glyph.charAt(0) === '<') {
            button.innerHTML = glyph;
        } else {
            button.textContent = glyph;
        }
        return button;
    }

    function renderLibrary() {
        // 分类筛选 chips
        var counts = {};
        Store.state.places.forEach(function (place) {
            counts[place.categoryId] = (counts[place.categoryId] || 0) + 1;
        });
        els.libCategories.innerHTML = '';
        els.libCategories.appendChild(makeChip('all', '全部', Store.state.places.length));
        Store.state.categories.forEach(function (category) {
            if (!counts[category.id]) return;
            els.libCategories.appendChild(makeChip(category.id, category.name, counts[category.id]));
        });

        // 列表
        var keyword = libFilter.keyword;
        var filtered = Store.state.places.filter(function (place) {
            if (libFilter.categoryId !== 'all' && place.categoryId !== libFilter.categoryId) return false;
            if (!keyword) return true;
            var haystack = (place.name + ' ' + place.address).toLowerCase();
            return haystack.indexOf(keyword) !== -1;
        });

        els.placeList.innerHTML = '';
        filtered.forEach(function (place) {
            var category = Store.getCategory(place.categoryId);
            var usage = Store.placeUsage(place.id);

            var card = document.createElement('li');
            card.className = 'place-card' + (place.id === activePlaceId ? ' is-active' : '');
            card.dataset.placeId = place.id;
            card.draggable = true;

            var dot = document.createElement('span');
            dot.className = 'cat-dot';
            dot.style.setProperty('--cat-color', category.color);

            var main = document.createElement('div');
            main.className = 'place-main';

            var name = document.createElement('div');
            name.className = 'place-name';
            name.textContent = place.name;

            var sub = document.createElement('div');
            sub.className = 'place-sub';
            sub.appendChild(metaChip(category.name));
            if (place.address) {
                var address = document.createElement('span');
                address.className = 'note';
                address.style.overflow = 'hidden';
                address.style.textOverflow = 'ellipsis';
                address.style.whiteSpace = 'nowrap';
                address.textContent = place.address;
                sub.appendChild(address);
            }
            if (usage.length) {
                var usageWrap = document.createElement('span');
                usageWrap.className = 'place-usage';
                // 同一天多次出现只显示一次
                var seenDays = {};
                usage.forEach(function (entry) {
                    if (seenDays[entry.dayId]) return;
                    seenDays[entry.dayId] = true;
                    var tag = document.createElement('span');
                    tag.className = 'usage-tag';
                    tag.textContent = entry.dayName;
                    usageWrap.appendChild(tag);
                });
                sub.appendChild(usageWrap);
            }

            main.appendChild(name);
            main.appendChild(sub);

            var actions = document.createElement('div');
            actions.className = 'place-actions';
            var addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'icon-btn icon-btn-add';
            addButton.dataset.action = 'add';
            addButton.title = '加入行程的某一天';
            addButton.setAttribute('aria-label', '把「' + place.name + '」加入行程的某一天');
            addButton.textContent = '＋';
            actions.appendChild(addButton);
            actions.appendChild(iconButton('edit', ICON_PENCIL, '编辑地点'));
            actions.appendChild(iconButton('remove', ICON_X, '删除地点'));

            card.appendChild(dot);
            card.appendChild(main);
            card.appendChild(actions);
            els.placeList.appendChild(card);
        });
    }

    function makeChip(categoryId, label, count) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip' + (libFilter.categoryId === categoryId ? ' is-active' : '');
        chip.dataset.categoryId = categoryId;
        chip.textContent = count > 0 ? label + ' ' + count : label;
        return chip;
    }

    function renderMap() {
        var model = buildMapModel();
        TripMap.render(model);
    }

    /** 全程统一编号：按「天序 → 天内序」给每个地点分配连续字母（A、B、…、Z；超过 26 个后用 27、28…），跨天不重置 */
    function buildStopLabels() {
        var labels = {};
        var count = 0;
        Store.state.days.forEach(function (day) {
            day.items.forEach(function (item) {
                if (item.disabled || labels[item.placeId]) return;
                if (!Store.getPlace(item.placeId)) return;
                labels[item.placeId] = count < 26 ? String.fromCharCode(65 + count) : String(count + 1);
                count++;
            });
        });
        return labels;
    }

    /** 编号展示文本：A →「A 站」；27 →「第 27 站」 */
    function stopLabelText(label) {
        return /^[0-9]+$/.test(label) ? '第 ' + label + ' 站' : label + ' 站';
    }

    function buildMapModel() {
        // 全程统一编号（1、2、3… / 交通住宿 A、B、C…）
        var labels = buildStopLabels();

        var points = Store.state.places.map(function (place) {
            var label = labels[place.id] || null;
            var category = Store.getCategory(place.categoryId);
            return {
                placeId: place.id,
                name: place.name,
                lng: place.lng,
                lat: place.lat,
                isPlanned: Boolean(label),
                label: label,
                labelText: label ? stopLabelText(label) : '',
                color: category ? category.color : '#3f7e73',
                active: place.id === activePlaceId
            };
        });

        // 全程一条线：各天行程首尾相接（跨天也相连），颜色随「这段路要走的次数」加深；
        // 同一对地点（如酒店 ↔ 歌剧院往返）只画一条，避免虚线相位交错叠成“实线”
        var stops = [];
        Store.state.days.forEach(function (day) {
            day.items
                .filter(function (item) { return !item.disabled; })
                .forEach(function (item) {
                    var place = Store.getPlace(item.placeId);
                    if (place) stops.push(place);
                });
        });

        // 站点顺序（供流动箭头使用，保留往返完整路径）
        var flowPath = [];
        stops.forEach(function (place) {
            var last = flowPath[flowPath.length - 1];
            if (!last || Math.abs(last[0] - place.lng) > 1e-6 || Math.abs(last[1] - place.lat) > 1e-6) {
                flowPath.push([place.lng, place.lat]);
            }
        });

        var lines = [];
        var drawnPairs = {};
        for (var i = 1; i < stops.length; i++) {
            var from = stops[i - 1];
            var to = stops[i];
            if (from.id === to.id) continue;
            var pairKey = from.id < to.id ? from.id + '|' + to.id : to.id + '|' + from.id;
            if (drawnPairs[pairKey]) continue;
            drawnPairs[pairKey] = true;
            lines.push({
                color: legTravelColor(countLegTrips(from.id, to.id)),
                path: [[from.lng, from.lat], [to.lng, to.lat]]
            });
        }

        return { points: points, lines: lines, flowPath: flowPath };
    }

    function renderEmptyStates() {
        var totalPlaces = Store.state.places.length;
        els.mapEmpty.hidden = !(mapReady && totalPlaces === 0);

        var day = Store.getDay(activeDayId);
        els.itineraryEmpty.hidden = !day || day.items.length > 0;

        var hasFilter = libFilter.keyword || libFilter.categoryId !== 'all';
        var visiblePlaces = els.placeList.children.length;
        els.libraryEmpty.hidden = visiblePlaces > 0;
        if (!els.libraryEmpty.hidden) {
            els.libraryEmpty.innerHTML = '';
            var lineA = document.createElement('p');
            var lineB = document.createElement('p');
            if (totalPlaces === 0) {
                lineA.textContent = '地点库还是空的。';
                lineB.textContent = '点击地图任意位置即可添加第一个地点。';
            } else {
                lineA.textContent = '没有匹配的地点。';
                lineB.textContent = hasFilter ? '换个关键词或分类试试。' : '';
            }
            els.libraryEmpty.appendChild(lineA);
            els.libraryEmpty.appendChild(lineB);
        }
    }

    function renderStatusSummary() {
        if (!mapReady) return;
        var total = Store.totalStats();
        if (!total.places) {
            updateStatus('地图已就绪 · 点击地图空白处添加地点');
        } else {
            updateStatus('共 ' + total.places + ' 个地点 · 已安排 ' + total.count + ' 站 · 直线总里程 ' + total.distance.toFixed(1) + ' km');
        }
    }

    /* ================= 面板切换 ================= */

    function switchPane(pane) {
        activePane = pane;
        var itinerary = pane === 'itinerary';
        els.tabItinerary.classList.toggle('is-active', itinerary);
        els.tabLibrary.classList.toggle('is-active', !itinerary);
        els.tabItinerary.setAttribute('aria-selected', itinerary ? 'true' : 'false');
        els.tabLibrary.setAttribute('aria-selected', !itinerary ? 'true' : 'false');
        els.paneItinerary.classList.toggle('is-active', itinerary);
        els.paneLibrary.classList.toggle('is-active', !itinerary);
        els.paneItinerary.hidden = !itinerary;
        els.paneLibrary.hidden = itinerary;
    }

    function setActiveDay(dayId) {
        if (!Store.getDay(dayId)) return;
        activeDayId = dayId;
        stopPlayback();
        renderDayTabs();
        renderDayMeta();
        renderItems();
        renderEmptyStates();
    }

    /* ================= 选择与联动 ================= */

    function selectPlace(placeId, options) {
        options = options || {};
        var place = Store.getPlace(placeId);
        if (!place) return;
        activePlaceId = placeId;

        if (options.fromMarker) {
            var usage = Store.placeUsage(placeId);
            if (usage.length && usage[0].dayId !== activeDayId) {
                setActiveDay(usage[0].dayId);
            }
        }

        highlightCards();
        TripMap.setActive(placeId);

        var usages = Store.placeUsage(placeId);
        if (usages.length) {
            var label = buildStopLabels()[placeId];
            updateStatus(usages[0].dayName + ' · ' + (label ? stopLabelText(label) : '已移除') + '：' + place.name);
        } else {
            updateStatus('未安排：' + place.name + '（在地点库点 ＋ 加入某一天）');
        }

        if (options.focus) {
            TripMap.focusPlace(placeId);
            if (window.innerWidth <= 900) closeSheet();
        }
        scrollCardIntoView(placeId);
    }

    function highlightCards() {
        document.querySelectorAll('.item-card').forEach(function (card) {
            card.classList.toggle('is-active', card.dataset.placeId === activePlaceId);
        });
        document.querySelectorAll('.place-card').forEach(function (card) {
            card.classList.toggle('is-active', card.dataset.placeId === activePlaceId);
        });
    }

    function scrollCardIntoView(placeId) {
        var selector = '.item-card[data-place-id="' + placeId + '"]';
        var card = document.querySelector(selector);
        if (!card || card.offsetParent === null) {
            card = document.querySelector('.place-card[data-place-id="' + placeId + '"]');
        }
        if (card && card.offsetParent !== null) {
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function updateStatus(text) {
        if (els.mapStatus) els.mapStatus.textContent = text;
    }

    function currentViewCenter() {
        var view = Store.state.view || {};
        return { lng: view.lng, lat: view.lat };
    }

    /* ================= 行程项交互 ================= */

    function onItemListClick(event) {
        var connector = event.target.closest('.item-connector[data-action="leg"]');
        if (connector) {
            openLegModal(connector.dataset.itemId);
            return;
        }

        var card = event.target.closest('.item-card');
        if (!card) return;
        var itemId = card.dataset.itemId;
        var actionButton = event.target.closest('button[data-action]');

        if (actionButton) {
            var action = actionButton.dataset.action;
            if (action === 'edit') {
                openItemModal(itemId);
            } else if (action === 'nav') {
                openNavigationTo(card.dataset.placeId);
            } else if (action === 'disable') {
                Store.setItemDisabled(itemId, true);
                toast('已移除，可在当天最下方恢复');
            } else if (action === 'restore') {
                Store.setItemDisabled(itemId, false);
                toast('已恢复该站点');
            } else if (action === 'purge') {
                var found = Store.findItem(itemId);
                var place = found ? Store.getPlace(found.item.placeId) : null;
                if (window.confirm('彻底删除「' + (place ? place.name : '该站点') + '」？删除后无法恢复。')) {
                    Store.removeItem(itemId);
                    toast('已彻底删除');
                }
            }
            return;
        }

        if (card.classList.contains('is-disabled')) return;
        var placeId = card.dataset.placeId;
        if (placeId) selectPlace(placeId, { focus: true });
    }

    /* ================= 地点库交互 ================= */

    function onPlaceListClick(event) {
        var card = event.target.closest('.place-card');
        if (!card) return;
        var placeId = card.dataset.placeId;
        var actionButton = event.target.closest('button[data-action]');

        if (actionButton) {
            var action = actionButton.dataset.action;
            if (action === 'add') openDayPicker(placeId, actionButton);
            else if (action === 'edit') openPlaceModal(placeId);
            else if (action === 'remove') removePlaceWithConfirm(placeId);
            return;
        }

        selectPlace(placeId, { focus: true });
    }

    function addToDay(placeId, dayId) {
        var day = Store.getDay(dayId);
        var place = Store.getPlace(placeId);
        if (!day || !place) return;
        var existing = day.items.find(function (it) { return it.placeId === placeId; });
        Store.addItem(dayId, placeId);
        toast(existing
            ? '「' + place.name + '」已在 ' + dayTabLabel(day) + ' 中，再次加入'
            : '已把「' + place.name + '」加入 ' + dayTabLabel(day));
        selectPlace(placeId, { focus: false });
        scrollCardIntoView(placeId);
    }

    /* 加入行程：点 ＋ 弹出“选哪一天”浮层 */
    var dayPickerEl = null;

    function openDayPicker(placeId, anchor) {
        closeDayPicker();
        var place = Store.getPlace(placeId);
        if (!place || !anchor) return;

        var pop = document.createElement('div');
        pop.className = 'day-picker';
        var title = document.createElement('p');
        title.className = 'day-picker-title';
        title.textContent = '加入行程：';
        pop.appendChild(title);

        Store.state.days.forEach(function (day) {
            // 该天已包含此地点几次（与地点库使用标签口径一致，含已移除项）
            var count = day.items.filter(function (item) { return item.placeId === placeId; }).length;
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'day-picker-item';
            button.textContent = dayTabLabel(day);
            if (count > 0) {
                var mark = document.createElement('span');
                mark.className = 'day-picker-mark';
                mark.textContent = count > 1 ? '√（' + count + '）' : '√';
                button.appendChild(mark);
            }
            button.addEventListener('click', function () {
                closeDayPicker();
                addToDay(placeId, day.id);
            });
            pop.appendChild(button);
        });

        document.body.appendChild(pop);
        var rect = anchor.getBoundingClientRect();
        var popRect = pop.getBoundingClientRect();
        var top = rect.bottom + 6;
        if (top + popRect.height > window.innerHeight - 8) {
            top = Math.max(8, rect.top - popRect.height - 6);
        }
        var left = Math.max(8, Math.min(rect.left, window.innerWidth - popRect.width - 8));
        pop.style.top = Math.round(top) + 'px';
        pop.style.left = Math.round(left) + 'px';

        dayPickerEl = pop;
        // 等本次点击事件走完再监听外部点击，避免立即被关掉
        window.setTimeout(function () {
            if (!dayPickerEl) return;
            document.addEventListener('click', onDayPickerOutside, true);
            document.addEventListener('keydown', onDayPickerKey, true);
        }, 0);
    }

    function closeDayPicker() {
        if (dayPickerEl && dayPickerEl.parentNode) dayPickerEl.parentNode.removeChild(dayPickerEl);
        dayPickerEl = null;
        document.removeEventListener('click', onDayPickerOutside, true);
        document.removeEventListener('keydown', onDayPickerKey, true);
    }

    function onDayPickerOutside(event) {
        if (dayPickerEl && !dayPickerEl.contains(event.target)) closeDayPicker();
    }

    function onDayPickerKey(event) {
        if (event.key === 'Escape') closeDayPicker();
    }

    /* 选点确认：点地图后列出附近地址，用户选一个精确落点 */
    var pointPickerEl = null;
    var pointPickContext = null;
    var pointPickToken = 0;

    function openPointPicker(coords, context) {
        closePointPicker();
        pointPickContext = context || {};
        var token = ++pointPickToken;
        TripMap.previewLocation(coords.lng, coords.lat);
        TripMap.nearbyPlaces(coords.lng, coords.lat).then(function (candidates) {
            if (token !== pointPickToken) return;
            if (!candidates || !candidates.length) {
                applyPointPick(coords, null);
                return;
            }
            showPointPicker(coords, candidates);
        });
    }

    function showPointPicker(coords, candidates) {
        var pop = document.createElement('div');
        pop.className = 'day-picker point-picker';

        var title = document.createElement('p');
        title.className = 'day-picker-title';
        title.textContent = '选择附近的地址：';
        pop.appendChild(title);

        candidates.forEach(function (candidate) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'day-picker-item point-item';

            var nameEl = document.createElement('span');
            nameEl.className = 'point-name';
            nameEl.textContent = candidate.name;
            button.appendChild(nameEl);

            var subEl = document.createElement('span');
            subEl.className = 'point-sub';
            subEl.textContent = [candidate.tag, formatMeters(candidate.distance)].filter(Boolean).join(' · ');
            button.appendChild(subEl);

            button.addEventListener('click', function () {
                closePointPicker();
                applyPointPick(coords, candidate);
            });
            pop.appendChild(button);
        });

        var divider = document.createElement('div');
        divider.className = 'point-divider';
        pop.appendChild(divider);

        var plainButton = document.createElement('button');
        plainButton.type = 'button';
        plainButton.className = 'day-picker-item point-item is-plain';
        var plainName = document.createElement('span');
        plainName.className = 'point-name';
        plainName.textContent = '直接用点击的位置';
        plainButton.appendChild(plainName);
        var plainSub = document.createElement('span');
        plainSub.className = 'point-sub';
        plainSub.textContent = '不匹配附近地址';
        plainButton.appendChild(plainSub);
        plainButton.addEventListener('click', function () {
            closePointPicker();
            applyPointPick(coords, null);
        });
        pop.appendChild(plainButton);

        document.body.appendChild(pop);
        positionPointPicker(pop, coords);

        pointPickerEl = pop;
        // 等本次地图点击事件走完再监听外部点击，避免立即被关掉
        window.setTimeout(function () {
            if (!pointPickerEl) return;
            document.addEventListener('click', onPointPickerOutside, true);
            document.addEventListener('keydown', onPointPickerKey, true);
        }, 0);
    }

    /** 浮层跟随点击位置（优先右下，越界翻向反侧） */
    function positionPointPicker(pop, coords) {
        var anchorX = isFinite(coords.clientX) ? coords.clientX : window.innerWidth / 2;
        var anchorY = isFinite(coords.clientY) ? coords.clientY : window.innerHeight / 3;
        var width = pop.offsetWidth;
        var height = pop.offsetHeight;
        var left = anchorX + 14;
        var top = anchorY + 14;
        if (left + width > window.innerWidth - 8) left = Math.max(8, anchorX - width - 14);
        if (top + height > window.innerHeight - 8) top = Math.max(8, anchorY - height - 14);
        pop.style.left = Math.round(left) + 'px';
        pop.style.top = Math.round(top) + 'px';
    }

    function closePointPicker() {
        pointPickToken++;
        if (pointPickerEl && pointPickerEl.parentNode) pointPickerEl.parentNode.removeChild(pointPickerEl);
        pointPickerEl = null;
        document.removeEventListener('click', onPointPickerOutside, true);
        document.removeEventListener('keydown', onPointPickerKey, true);
    }

    function cancelPointPick() {
        closePointPicker();
        pointPickContext = null;
        TripMap.clearPreview();
        toast('已取消选点');
    }

    function onPointPickerOutside(event) {
        if (!pointPickerEl || pointPickerEl.contains(event.target)) return;
        var mapBox = document.getElementById('amap-container');
        if (mapBox && mapBox.contains(event.target)) {
            // 又点了一次地图 = 重新选点，静默关闭，后续由新的选点流程接管
            closePointPicker();
            return;
        }
        cancelPointPick();
    }

    function onPointPickerKey(event) {
        if (event.key === 'Escape') cancelPointPick();
    }

    /** 确认落点：candidate 为空表示直接使用点击坐标 */
    function applyPointPick(rawCoords, candidate) {
        var context = pointPickContext || {};
        pointPickContext = null;
        TripMap.clearPreview();

        var lng = candidate ? candidate.lng : rawCoords.lng;
        var lat = candidate ? candidate.lat : rawCoords.lat;
        var editingId = context.keepEditingId || null;
        var prefill = { lng: lng, lat: lat };
        if (candidate && candidate.address) prefill.address = candidate.address;

        if (!els.placeModal.open) openPlaceModal(editingId, prefill);

        // 选点前填写过内容的话原样恢复，不覆盖用户输入
        if (context.snapshot) {
            els.placeName.value = context.snapshot.name;
            els.placeAddress.value = context.snapshot.address;
            els.placeNote.value = context.snapshot.note;
            els.placeCategory.value = context.snapshot.categoryId;
        }
        // 新建地点：地点名预填所选地址的名称（可编辑）
        if (candidate && !els.placeName.value) {
            els.placeName.value = candidate.name;
        }
        els.placeLng.value = lng.toFixed(6);
        els.placeLat.value = lat.toFixed(6);
        if (!els.placeModal.open) els.placeModal.showModal();
        // 编辑既有地点且地址为空时补齐（新建的由弹窗内部自动补全）
        if (editingId && !els.placeAddress.value) {
            if (candidate && candidate.address) {
                els.placeAddress.value = candidate.address;
            } else {
                TripMap.reverseGeocode(lng, lat).then(function (address) {
                    if (address && !els.placeAddress.value && els.placeModal.open) {
                        els.placeAddress.value = address;
                    }
                });
            }
        }
        toast(candidate ? '已匹配「' + candidate.name + '」' : '已使用点击的位置');
    }

    /** 距离文本：260 米 / 1.4 公里 */
    function formatMeters(meters) {
        if (!isFinite(meters) || meters < 0) return '';
        if (meters < 1000) return Math.round(meters) + ' 米';
        return (meters / 1000).toFixed(1) + ' 公里';
    }

    function removePlaceWithConfirm(placeId) {
        var place = Store.getPlace(placeId);
        if (!place) return;
        var usage = Store.placeUsage(placeId);
        var message = '删除地点「' + place.name + '」？';
        if (usage.length) {
            message += '\n它同时出现在：' + usage.map(function (u) { return u.dayName; }).join('、') + '，相关行程项也会被移除。';
        }
        if (!window.confirm(message)) return;
        Store.removePlace(placeId);
        if (activePlaceId === placeId) activePlaceId = null;
        toast('已删除「' + place.name + '」');
    }

    /* ================= 拖拽 ================= */

    function onCardDragStart(event) {
        var card = event.target.closest('.item-card, .place-card');
        if (!card || card.classList.contains('is-disabled')) return;
        if (card.classList.contains('item-card')) {
            dragPayload = { kind: 'item', itemId: card.dataset.itemId };
        } else {
            dragPayload = { kind: 'place', placeId: card.dataset.placeId };
        }
        card.classList.add('is-dragging');
        try {
            event.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
            event.dataTransfer.effectAllowed = 'move';
        } catch (error) { /* 某些浏览器限制，忽略 */ }
    }

    function parseDragPayload(event) {
        try {
            return JSON.parse(event.dataTransfer.getData('text/plain') || 'null');
        } catch (error) {
            return null;
        }
    }

    function clearDragState() {
        dragPayload = null;
        document.querySelectorAll('.is-dragging').forEach(function (el) { el.classList.remove('is-dragging'); });
        document.querySelectorAll('.drop-before, .drop-after, .is-drop').forEach(function (el) {
            el.classList.remove('drop-before', 'drop-after', 'is-drop');
        });
    }

    function bindListDrop(listEl) {
        listEl.addEventListener('dragover', function (event) {
            if (!dragPayload && !event.dataTransfer.types.length) return;
            event.preventDefault();
            var card = event.target.closest('.item-card');
            if (card) {
                var rect = card.getBoundingClientRect();
                var before = event.clientY < rect.top + rect.height / 2;
                card.classList.toggle('drop-before', before);
                card.classList.toggle('drop-after', !before);
            } else {
                document.querySelectorAll('.drop-before, .drop-after').forEach(function (el) {
                    el.classList.remove('drop-before', 'drop-after');
                });
            }
        });
        listEl.addEventListener('dragleave', function () {
            document.querySelectorAll('.drop-before, .drop-after').forEach(function (el) {
                el.classList.remove('drop-before', 'drop-after');
            });
        });
        listEl.addEventListener('drop', function (event) {
            event.preventDefault();
            var payload = parseDragPayload(event) || dragPayload;
            if (!payload) return;
            var excludeItemId = payload.kind === 'item' ? payload.itemId : null;
            var index = computeDropIndex(listEl, event.clientY, excludeItemId);

            if (payload.kind === 'item') {
                Store.moveItem(payload.itemId, activeDayId, index);
            } else if (payload.kind === 'place') {
                Store.addItem(activeDayId, payload.placeId, index);
                toast('已加入 ' + (Store.getDay(activeDayId) || {}).name);
            }
            clearDragState();
        });
    }

    function computeDropIndex(listEl, clientY, excludeItemId) {
        var cards = Array.prototype.slice
            .call(listEl.querySelectorAll('.item-card:not(.is-disabled)'))
            .filter(function (card) { return card.dataset.itemId !== excludeItemId; });
        for (var i = 0; i < cards.length; i++) {
            var rect = cards[i].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) return i;
        }
        return cards.length;
    }

    /** 手机端长按拖动排序（HTML5 拖拽在触摸屏不可用） */
    function bindTouchDrag(listEl) {
        listEl.addEventListener('touchstart', function (event) {
            if (event.touches.length !== 1) return;
            var card = event.target.closest('.item-card:not(.is-disabled)');
            if (!card) return;
            var touch = event.touches[0];
            touchDrag = {
                card: card,
                itemId: card.dataset.itemId,
                startX: touch.clientX,
                startY: touch.clientY,
                lastY: touch.clientY,
                active: false,
                timer: window.setTimeout(function () {
                    if (!touchDrag) return;
                    touchDrag.active = true;
                    touchDrag.card.classList.add('is-dragging');
                    if (navigator.vibrate) navigator.vibrate(12);
                }, 380)
            };
        }, { passive: true });

        listEl.addEventListener('touchmove', function (event) {
            if (!touchDrag) return;
            var touch = event.touches[0];
            var dx = Math.abs(touch.clientX - touchDrag.startX);
            var dy = Math.abs(touch.clientY - touchDrag.startY);

            if (!touchDrag.active) {
                if (dx > 10 || dy > 10) {
                    window.clearTimeout(touchDrag.timer);
                    touchDrag = null;
                }
                return;
            }

            event.preventDefault();
            touchDrag.lastY = touch.clientY;

            document.querySelectorAll('.drop-before, .drop-after').forEach(function (el) {
                el.classList.remove('drop-before', 'drop-after');
            });
            var cards = Array.prototype.slice.call(
                listEl.querySelectorAll('.item-card:not(.is-disabled)')
            );
            for (var i = 0; i < cards.length; i++) {
                var rect = cards[i].getBoundingClientRect();
                if (touch.clientY < rect.top + rect.height / 2) {
                    if (cards[i].dataset.itemId !== touchDrag.itemId) cards[i].classList.add('drop-before');
                    break;
                }
                if (i === cards.length - 1 && cards[i].dataset.itemId !== touchDrag.itemId) {
                    cards[i].classList.add('drop-after');
                }
            }
        }, { passive: false });

        listEl.addEventListener('touchend', function () {
            if (!touchDrag) return;
            var state = touchDrag;
            touchDrag = null;
            window.clearTimeout(state.timer);
            if (!state.active) return;

            state.card.classList.remove('is-dragging');
            document.querySelectorAll('.drop-before, .drop-after').forEach(function (el) {
                el.classList.remove('drop-before', 'drop-after');
            });
            var index = computeDropIndex(listEl, state.lastY, state.itemId);
            Store.moveItem(state.itemId, activeDayId, index);
        });

        listEl.addEventListener('touchcancel', function () {
            if (!touchDrag) return;
            window.clearTimeout(touchDrag.timer);
            if (touchDrag.active) touchDrag.card.classList.remove('is-dragging');
            touchDrag = null;
        });
    }

    /* ================= 播放 ================= */

    function togglePlayback() {
        if (playbackTimer) {
            stopPlayback();
            return;
        }
        var day = Store.getDay(activeDayId);
        var items = day ? day.items.filter(function (item) { return !item.disabled; }) : [];
        if (!items.length) {
            toast('这一天还没有站点');
            return;
        }
        items = items.slice();
        playingDayId = day.id;
        els.playDayBtn.textContent = '⏹ 停止';
        els.playDayBtn.setAttribute('aria-pressed', 'true');

        var index = 0;
        function visitNext() {
            if (playingDayId !== activeDayId) {
                stopPlayback();
                return;
            }
            if (index >= items.length) {
                stopPlayback();
                updateStatus('已浏览完 ' + day.name + ' 的全部站点');
                return;
            }
            var place = Store.getPlace(items[index].placeId);
            index += 1;
            if (place) {
                selectPlace(place.id, { focus: true });
                updateStatus(day.name + ' · 第 ' + index + ' / ' + items.length + ' 站：' + place.name);
            }
            playbackTimer = window.setTimeout(visitNext, 3000);
        }
        visitNext();
    }

    function stopPlayback() {
        if (playbackTimer) {
            window.clearTimeout(playbackTimer);
            playbackTimer = null;
        }
        playingDayId = null;
        if (els.playDayBtn) {
            els.playDayBtn.textContent = '▶ 浏览';
            els.playDayBtn.setAttribute('aria-pressed', 'false');
        }
    }

    function fitActiveDay() {
        if (!TripMap.isReady()) {
            toast('地图尚未就绪');
            return;
        }
        var day = Store.getDay(activeDayId);
        var ids = day
            ? day.items.filter(function (it) { return !it.disabled; }).map(function (it) { return it.placeId; })
            : [];
        if (ids.length >= 2) {
            TripMap.fitBounds(ids);
            updateStatus('已显示 ' + day.name + ' 的路线（' + ids.length + ' 站）');
        } else {
            TripMap.fitBounds(null);
            updateStatus('已显示全部地点');
        }
    }

    /* ================= 地点编辑弹窗 ================= */

    function openPlaceModal(placeId, prefill) {
        editingPlaceId = placeId || null;
        prefill = prefill || {};
        var place = placeId ? Store.getPlace(placeId) : null;

        els.placeModalTitle.textContent = place ? '编辑地点' : '新建地点';
        els.placeDeleteBtn.hidden = !place;

        fillCategorySelect(place ? place.categoryId : 'activity');

        els.placeName.value = place ? place.name : '';
        els.placeLng.value = place ? place.lng : (typeof prefill.lng === 'number' ? prefill.lng.toFixed(6) : '');
        els.placeLat.value = place ? place.lat : (typeof prefill.lat === 'number' ? prefill.lat.toFixed(6) : '');
        els.placeAddress.value = place ? place.address : (prefill.address || '');
        els.placeNote.value = place ? place.note : '';

        els.poiKeyword.value = '';
        els.poiResults.hidden = true;
        els.poiResults.innerHTML = '';

        if (!els.placeModal.open) els.placeModal.showModal();
        els.placeName.focus();

        // 双击地图新建时，异步补全地址
        if (!place && typeof prefill.lng === 'number' && !prefill.address) {
            TripMap.reverseGeocode(prefill.lng, prefill.lat).then(function (address) {
                if (address && !els.placeAddress.value && els.placeModal.open) {
                    els.placeAddress.value = address;
                }
            });
        }
    }

    function fillCategorySelect(selectedId) {
        els.placeCategory.innerHTML = '';
        Store.state.categories.forEach(function (category) {
            var option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name;
            els.placeCategory.appendChild(option);
        });
        els.placeCategory.value = selectedId || 'activity';
    }

    function onPlaceSubmit(event) {
        event.preventDefault();
        var name = els.placeName.value.trim();
        var lng = parseFloat(els.placeLng.value);
        var lat = parseFloat(els.placeLat.value);

        if (!name) { toast('请填写地点名称'); els.placeName.focus(); return; }
        if (!isFinite(lng) || !isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
            toast('请填写有效坐标（经度 -180~180，纬度 -90~90）');
            els.placeLng.focus();
            return;
        }

        var data = {
            name: name,
            lng: lng,
            lat: lat,
            categoryId: els.placeCategory.value,
            address: els.placeAddress.value.trim(),
            note: els.placeNote.value.trim()
        };

        var place;
        if (editingPlaceId) {
            place = Store.updatePlace(editingPlaceId, data);
            toast('已保存「' + data.name + '」');
        } else {
            place = Store.addPlace(data);
            toast('已创建「' + data.name + '」，可在「地点库」加入行程');
        }

        els.placeModal.close();
        selectPlace(place.id, { focus: true });
    }

    function onPlaceDelete() {
        if (!editingPlaceId) return;
        var place = Store.getPlace(editingPlaceId);
        if (!place) return;
        var usage = Store.placeUsage(editingPlaceId);
        var message = '删除地点「' + place.name + '」？';
        if (usage.length) {
            message += '\n它同时出现在：' + usage.map(function (u) { return u.dayName; }).join('、') + '，相关行程项也会被移除。';
        }
        if (!window.confirm(message)) return;
        Store.removePlace(editingPlaceId);
        if (activePlaceId === editingPlaceId) activePlaceId = null;
        els.placeModal.close();
        toast('已删除「' + place.name + '」');
    }

    function startPick(forceNew) {
        if (!TripMap.isReady()) {
            toast('地图尚未就绪');
            return;
        }
        pickMode = true;
        pickNewOnly = Boolean(forceNew);
        pickHadOpenModal = els.placeModal.open;
        pickSnapshot = pickHadOpenModal ? {
            name: els.placeName.value,
            address: els.placeAddress.value,
            note: els.placeNote.value,
            categoryId: els.placeCategory.value
        } : null;
        if (els.placeModal.open) els.placeModal.close();
        toast('请在地图上点击目标位置，点完可选附近地址');
    }

    /** 地图点击（由 main.js 转发）：先弹附近地址供选择，再进入编辑弹窗 */
    function handleMapClick(coords) {
        var context = {
            keepEditingId: pickMode && !pickNewOnly ? editingPlaceId : null,
            snapshot: pickMode && pickHadOpenModal ? pickSnapshot : null
        };
        pickMode = false;
        pickSnapshot = null;
        pickHadOpenModal = false;
        openPointPicker(coords, context);
    }

    /** 标记点击（由 main.js 转发） */
    function handleMarkerClick(placeId) {
        selectPlace(placeId, { fromMarker: true });
    }

    /* ================= 搜索（地点 + 地址） ================= */

    /** 双通道搜索：高德 POI 搜索 + 地址解析（精确到门牌号），合并去重 */
    function combinedSearch(keyword) {
        var poiPromise = TripMap.searchPOI(keyword).catch(function () { return []; });
        var geoPromise = TripMap.geocodeAddress(keyword).catch(function () { return []; });
        return Promise.all([poiPromise, geoPromise]).then(function (pair) {
            var pois = pair[0];
            var geocodes = pair[1];
            var merged = [];

            geocodes.slice(0, 2).forEach(function (geo) {
                merged.push({
                    name: shortenAddressName(geo.name),
                    address: geo.address || geo.name,
                    lng: geo.lng,
                    lat: geo.lat,
                    kind: 'address',
                    level: geo.level || ''
                });
            });

            pois.forEach(function (poi) {
                var nearExisting = merged.some(function (item) {
                    return Math.abs(item.lng - poi.lng) < 0.0006 && Math.abs(item.lat - poi.lat) < 0.0006;
                });
                if (nearExisting) return;
                merged.push({
                    name: poi.name,
                    address: poi.address,
                    lng: poi.lng,
                    lat: poi.lat,
                    kind: 'poi',
                    level: '',
                    type: poi.type || ''
                });
            });

            return merged.slice(0, 10);
        });
    }

    /** 把「上海市徐汇区汾阳路6号」压缩成「汾阳路6号」 */
    function shortenAddressName(text) {
        var value = String(text || '');
        value = value.replace(/^上海市/, '').replace(/^.{2,5}?区/, '');
        return value.trim() || text;
    }

    function doGlobalSearch() {
        var keyword = els.globalSearch.value.trim();
        if (!keyword) {
            els.globalSearch.focus();
            return;
        }
        els.globalSearchBtn.disabled = true;
        els.globalSearchBtn.textContent = '…';
        combinedSearch(keyword)
            .then(function (results) {
                renderGlobalResults(results);
                if (!results.length) toast('没有找到匹配的地点或地址');
            })
            .catch(function (error) {
                toast(error.message || '搜索失败');
            })
            .finally(function () {
                els.globalSearchBtn.disabled = false;
                els.globalSearchBtn.textContent = '搜索';
            });
    }

    function renderGlobalResults(results) {
        els.globalResults.innerHTML = '';
        if (!results.length) {
            els.globalResults.hidden = true;
            return;
        }

        results.forEach(function (result) {
            var item = document.createElement('li');
            item.className = 'map-result';

            var body = document.createElement('button');
            body.type = 'button';
            body.className = 'map-result-body';

            var name = document.createElement('strong');
            name.textContent = result.name;
            var tagText = result.kind === 'address' ? (result.level || '地址') : (result.type || '地点');
            var tag = document.createElement('em');
            tag.className = 'map-result-level';
            tag.textContent = tagText;
            name.appendChild(tag);

            var address = document.createElement('small');
            address.textContent = result.address || (result.lng.toFixed(5) + ', ' + result.lat.toFixed(5));

            body.appendChild(name);
            body.appendChild(address);
            body.addEventListener('click', function () { previewResult(result); });

            var addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'map-result-add';
            addButton.title = '加入地点库';
            addButton.setAttribute('aria-label', '把「' + result.name + '」加入地点库');
            addButton.textContent = '＋';
            addButton.addEventListener('click', function () { addSearchResult(result); });

            item.appendChild(body);
            item.appendChild(addButton);
            els.globalResults.appendChild(item);
        });

        els.globalResults.hidden = false;
    }

    function previewResult(result) {
        if (!TripMap.isReady()) return;
        TripMap.previewLocation(result.lng, result.lat);
        TripMap.flyTo(result.lng, result.lat);
        updateStatus('预览：' + result.name + (result.address ? '（' + result.address + '）' : ''));
    }

    function hideGlobalResults() {
        els.globalResults.hidden = true;
        els.globalResults.innerHTML = '';
    }

    function addSearchResult(result) {
        // 只存入地点库；是否加入行程、加入哪一天，由地点库里的 ＋ 决定
        // 附近已有地点（约 40m 内）则复用，避免建重复点
        var place = Store.state.places.find(function (existing) {
            return Math.abs(existing.lng - result.lng) < 0.0004 && Math.abs(existing.lat - result.lat) < 0.0004;
        });
        if (place) {
            TripMap.clearPreview();
            toast('「' + place.name + '」已在地点库');
            selectPlace(place.id, { focus: false });
            return;
        }
        place = Store.addPlace({
            name: result.name,
            lng: result.lng,
            lat: result.lat,
            categoryId: guessCategory(result),
            address: result.address || ''
        });
        TripMap.clearPreview();
        toast('已把「' + place.name + '」存入地点库，可在「地点库」加入行程');
        selectPlace(place.id, { focus: false });
    }

    /** 根据名称/地址猜一个分类，减少手工调整 */
    function guessCategory(result) {
        var text = (result.name + ' ' + (result.address || '')).toLowerCase();
        if (/酒店|宾馆|民宿|公寓|hotel|hostel/.test(text)) return 'hotel';
        if (/站$|火车站|机场|地铁站|码头|客运/.test(text)) return 'transport';
        if (/咖啡|餐|火锅|面馆|小吃|烧烤|酒馆|茶室|饭店|面包/.test(text)) return 'dining';
        return 'activity';
    }

    /* ================= POI 搜索（弹窗内） ================= */

    function doPoiSearch() {
        var keyword = els.poiKeyword.value.trim();
        if (!keyword) {
            els.poiKeyword.focus();
            return;
        }
        els.poiSearchBtn.disabled = true;
        els.poiSearchBtn.textContent = '搜索中…';
        combinedSearch(keyword)
            .then(function (results) {
                els.poiResults.innerHTML = '';
                if (!results.length) {
                    els.poiResults.hidden = true;
                    toast('没有找到匹配的地点或地址');
                    return;
                }
                results.forEach(function (result) {
                    var item = document.createElement('li');
                    var button = document.createElement('button');
                    button.type = 'button';
                    var name = document.createElement('strong');
                    name.textContent = result.name + (result.kind === 'address' && result.level ? ' · ' + result.level : '');
                    var address = document.createElement('small');
                    address.textContent = result.address || (result.lng.toFixed(5) + ', ' + result.lat.toFixed(5));
                    button.appendChild(name);
                    button.appendChild(address);
                    button.addEventListener('click', function () {
                        els.placeName.value = result.name;
                        els.placeAddress.value = result.address || '';
                        els.placeLng.value = result.lng.toFixed(6);
                        els.placeLat.value = result.lat.toFixed(6);
                        els.poiResults.hidden = true;
                        toast('已填入「' + result.name + '」');
                    });
                    item.appendChild(button);
                    els.poiResults.appendChild(item);
                });
                els.poiResults.hidden = false;
            })
            .catch(function (error) {
                toast(error.message || '搜索失败');
            })
            .finally(function () {
                els.poiSearchBtn.disabled = false;
                els.poiSearchBtn.textContent = '搜索';
            });
    }

    /* ================= 行程项弹窗 ================= */

    function openItemModal(itemId) {
        var found = Store.findItem(itemId);
        if (!found) return;
        editingItemId = itemId;
        var place = Store.getPlace(found.item.placeId);

        els.itemPlaceName.textContent = place ? place.name : '未知地点';
        els.itemTime.value = found.item.time || '';
        els.itemStay.value = found.item.stay || '';
        els.itemNote.value = found.item.note || '';
        els.itemDeleteBtn.textContent = found.item.disabled ? '恢复该站点' : '移除该站点';

        els.itemDay.innerHTML = '';
        Store.state.days.forEach(function (day) {
            var option = document.createElement('option');
            option.value = day.id;
            option.textContent = dayTabLabel(day);
            els.itemDay.appendChild(option);
        });
        els.itemDay.value = found.day.id;

        if (!els.itemModal.open) els.itemModal.showModal();
    }

    function onItemSubmit(event) {
        event.preventDefault();
        if (!editingItemId) return;
        var found = Store.findItem(editingItemId);
        if (!found) { els.itemModal.close(); return; }

        Store.updateItem(editingItemId, {
            time: els.itemTime.value || '',
            stay: els.itemStay.value === '' ? '' : String(Math.max(0, parseInt(els.itemStay.value, 10) || 0)),
            note: els.itemNote.value.trim()
        });

        var targetDayId = els.itemDay.value;
        if (targetDayId && targetDayId !== found.day.id) {
            Store.moveItem(editingItemId, targetDayId);
            setActiveDay(targetDayId);
            toast('已移动到 ' + (Store.getDay(targetDayId) || {}).name);
        } else {
            toast('已保存');
        }
        els.itemModal.close();
    }

    function onItemDelete() {
        if (!editingItemId) return;
        var found = Store.findItem(editingItemId);
        if (!found) { els.itemModal.close(); return; }
        var disabled = !found.item.disabled;
        Store.setItemDisabled(editingItemId, disabled);
        els.itemModal.close();
        toast(disabled ? '已移除，可在当天最下方恢复' : '已恢复该站点');
    }

    /* ================= 通勤方式弹窗 ================= */

    function openLegModal(itemId) {
        var found = Store.findItem(itemId);
        if (!found) return;

        var active = found.day.items.filter(function (item) { return !item.disabled; });
        var index = active.indexOf(found.item);
        var next = index >= 0 ? active[index + 1] : null;
        var fromPlace = Store.getPlace(found.item.placeId);
        var toPlace = next ? Store.getPlace(next.placeId) : null;

        if (!fromPlace || !toPlace) {
            toast('该站点没有下一站，无需设置通勤');
            return;
        }

        editingLegItemId = itemId;
        editingLegMode = (found.item.leg && found.item.leg.mode) || '';
        legContext = { fromPlace: fromPlace, toPlace: toPlace };

        els.legRoute.textContent = fromPlace.name + ' → ' + toPlace.name;
        els.legNote.value = (found.item.leg && found.item.leg.note) || '';
        renderLegModes();
        updateLegEstimate();

        if (!els.legModal.open) els.legModal.showModal();
        els.legNote.focus();
    }

    function renderLegModes() {
        els.legModes.innerHTML = '';
        LEG_MODE_ORDER.forEach(function (mode) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'mode-chip' + (mode === editingLegMode ? ' is-active' : '');
            chip.textContent = LEG_MODE_LABELS[mode];
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', mode === editingLegMode ? 'true' : 'false');
            chip.addEventListener('click', function () {
                editingLegMode = editingLegMode === mode ? '' : mode;
                renderLegModes();
                updateLegEstimate();
            });
            els.legModes.appendChild(chip);
        });
    }

    function updateLegEstimate() {
        if (!legContext) return;
        var km = computeDistKm(
            legContext.fromPlace.lat, legContext.fromPlace.lng,
            legContext.toPlace.lat, legContext.toPlace.lng
        );
        var text = '两站直线距离 ' + km.toFixed(1) + ' km';
        if (editingLegMode === 'other') {
            text += ' · 其他方式不估算时间';
        } else {
            var minutes = Store.estimateLegMinutes(editingLegMode, km);
            if (minutes !== null) {
                var label = editingLegMode
                    ? LEG_MODE_LABELS[editingLegMode]
                    : (km <= 1.8 ? '步行' : '驾车');
                text += ' · ' + label + '约 ' + minutes + ' 分钟（含绕路修正' + (editingLegMode ? '）' : '，自动估算）');
            }
        }
        els.legEstimate.textContent = text;
    }

    function onLegSubmit(event) {
        event.preventDefault();
        if (!editingLegItemId) return;
        Store.updateItem(editingLegItemId, {
            leg: { mode: editingLegMode, note: els.legNote.value.trim() }
        });
        els.legModal.close();
        toast(editingLegMode ? '通勤方式已保存' : '已保存（未指定方式，按自动估算）');
    }

    function onLegClear() {
        if (!editingLegItemId) return;
        Store.updateItem(editingLegItemId, { leg: { mode: '', note: '' } });
        els.legModal.close();
        toast('已清除通勤设置');
    }

    /* ================= 天弹窗 ================= */

    function openDayModal() {
        var day = Store.getDay(activeDayId);
        if (!day) return;
        els.dayName.value = day.name;
        els.dayDate.value = day.date || '';
        els.dayDeleteBtn.disabled = Store.state.days.length <= 1;
        els.dayModal.showModal();
    }

    function onDaySubmit(event) {
        event.preventDefault();
        var day = Store.getDay(activeDayId);
        if (!day) { els.dayModal.close(); return; }
        Store.updateDay(day.id, {
            name: els.dayName.value,
            date: els.dayDate.value || ''
        });
        els.dayModal.close();
        toast('已更新 ' + (Store.getDay(activeDayId) || {}).name);
    }

    function onDayDelete() {
        var day = Store.getDay(activeDayId);
        if (!day) return;
        if (Store.state.days.length <= 1) {
            toast('至少保留一天');
            return;
        }
        if (!window.confirm('删除「' + day.name + '」及其中的 ' + day.items.length + ' 个站点？')) return;
        Store.removeDay(day.id);
        els.dayModal.close();
        activeDayId = Store.state.days[0].id;
        stopPlayback();
        renderAll();
        toast('已删除 ' + day.name);
    }

    /* ================= 行程信息 ================= */

    function openTripModal() {
        els.tripModalTitle.value = Store.state.trip.title;
        els.tripNote.value = Store.state.trip.note || '';
        els.tripModal.showModal();
    }

    function onTripSubmit(event) {
        event.preventDefault();
        Store.updateTrip({
            title: els.tripModalTitle.value,
            note: els.tripNote.value
        });
        els.tripModal.close();
        toast('行程信息已保存');
    }

    /* ================= 导航 ================= */

    function openNavigationTo(placeId) {
        var place = Store.getPlace(placeId);
        if (!place) return;
        var url = 'https://uri.amap.com/navigation?to=' + place.lng + ',' + place.lat + ',' +
            encodeURIComponent(place.name) + '&mode=bus&callnative=1&coordinate=gaode&src=xingji';
        window.open(url, '_blank', 'noopener');
    }

    /* ================= 行程单导出 ================= */

    function dayTabLabel(day) {
        if (day.date) {
            var label = formatDateLabel(day.date);
            return label.split(' ')[0] || day.name;
        }
        return day.name;
    }

    /** '2026-10-03' → '10月3日 周六' */
    function formatDateLabel(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
        var parts = date.split('-').map(Number);
        var value = new Date(parts[0], parts[1] - 1, parts[2]);
        var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return parts[1] + '月' + parts[2] + '日 ' + weekdays[value.getDay()];
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeHtmlMultiline(text) {
        return escapeHtml(text).replace(/\n/g, '<br>');
    }

    var ITINERARY_STYLES = [
        ':root{color-scheme:light}',
        '*{box-sizing:border-box;margin:0;padding:0}',
        'body{background:#eff2e2;color:#1e302c;font:15px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:16px}',
        '.sheet{max-width:680px;margin:0 auto;background:#f8faee;border:1px solid rgba(31,52,48,.18);border-radius:14px;padding:26px 26px 20px;box-shadow:0 8px 30px rgba(16,40,36,.08)}',
        '.sheet-head{display:flex;gap:14px;align-items:center;padding-bottom:16px;border-bottom:2px solid #c05f0e}',
        '.seal{display:grid;place-items:center;width:46px;height:46px;border-radius:8px;background:#c05f0e;color:#fdf6ec;font-size:26px;font-family:"KaiTi","STKaiti",serif}',
        'h1{font-size:22px;letter-spacing:.02em}',
        '.brand{color:#5e746e;font-size:12px;letter-spacing:.12em}',
        '.trip-note{margin-top:16px;padding:12px 14px;border:1px dashed rgba(31,52,48,.3);border-radius:10px;background:#fbfcef}',
        '.trip-note h2{font-size:14px;color:#96490a;margin-bottom:6px}',
        '.trip-note p{font-size:13px;color:#39514c}',
        '.day{margin-top:22px}',
        '.day h2{display:flex;align-items:center;gap:10px;font-size:18px}',
        '.day h2::before{content:"";width:10px;height:10px;border-radius:50%;background:#c05f0e}',
        '.day-meta{margin:4px 0 10px;color:#5e746e;font-size:12.5px}',
        '.stops{list-style:none}',
        '.stop{display:grid;grid-template-columns:88px 1fr;gap:12px;padding:10px 12px;border:1px solid rgba(31,52,48,.16);border-radius:10px;background:#fff;box-shadow:0 2px 8px rgba(16,40,36,.05);page-break-inside:avoid;break-inside:avoid}',
        '.stop.is-late{border-left:3px solid #c05f0e}',
        '.stop-time{display:flex;flex-direction:column;gap:2px}',
        '.stop-time strong{font-size:17px;font-variant-numeric:tabular-nums}',
        '.stop-time strong.late{color:#c05f0e;font-size:14px}',
        '.stop-time span{color:#5e746e;font-size:11.5px}',
        '.stop-body h3{font-size:15.5px}',
        '.stop-body h3 em{font-style:normal;font-size:11px;font-weight:500;color:#96490a;border:1px solid rgba(192,95,14,.35);border-radius:99px;padding:0 8px;margin-left:6px;vertical-align:2px}',
        '.addr{color:#39514c;font-size:12.5px;margin-top:2px}',
        '.stop-meta{color:#5e746e;font-size:12.5px;margin-top:2px}',
        '.note{color:#39514c;font-size:12.5px;margin-top:4px}',
        '.links{margin-top:6px}',
        '.links a{color:#96490a;font-size:13px;text-decoration:none;border-bottom:1px dashed rgba(150,73,10,.5)}',
        '.transit{list-style:none;margin:4px 0 4px 44px;color:#5e746e;font-size:12px}',
        '.empty{color:#5e746e;font-size:13px}',
        '.sheet-foot{margin-top:24px;padding-top:12px;border-top:1px solid rgba(31,52,48,.18);color:#5e746e;font-size:11.5px}',
        '.print-tip{margin-top:6px;color:#83968e;font-size:11.5px}',
        '@media print{body{background:#fff;padding:0}.sheet{border:none;box-shadow:none;max-width:none}.print-tip{display:none}.links a{color:#000}}',
        '@media (max-width:520px){.sheet{padding:18px 14px}.stop{grid-template-columns:70px 1fr;gap:8px}}'
    ].join('\n');

    function buildItineraryHTML() {
        var state = Store.state;
        var title = state.trip.title || '我的行程';
        var note = state.trip.note || '';
        var now = new Date();
        var generatedText = now.getFullYear() + '-' +
            ('0' + (now.getMonth() + 1)).slice(-2) + '-' +
            ('0' + now.getDate()).slice(-2);

        var dayBlocks = state.days.map(function (day) {
            var stats = Store.dayStats(day);
            var timeline = Store.computeTimeline(day);
            var parts = [];
            if (day.date) parts.push(formatDateLabel(day.date));
            parts.push(stats.count + ' 站');
            parts.push('直线 ' + stats.distance.toFixed(1) + ' km');
            var starts = timeline.filter(function (entry) { return entry.start !== null; });
            var ends = timeline.filter(function (entry) { return entry.end !== null; });
            if (starts.length && ends.length) {
                parts.push(Store.formatMinutes(starts[0].start) + '–' + Store.formatMinutes(ends[ends.length - 1].end));
            }

            var stops = timeline.map(function (entry, index) {
                var item = entry.item;
                var place = entry.place;
                if (!place) return '';

                var timeHtml;
                if (entry.late) {
                    timeHtml = '<strong class="late">迟到 ' + entry.lateBy + ' 分</strong><span>计划 ' + escapeHtml(item.time) + '</span>';
                } else if (entry.fixed) {
                    timeHtml = '<strong>' + escapeHtml(item.time) + '</strong><span>固定</span>';
                } else if (entry.start !== null) {
                    timeHtml = '<strong>约 ' + Store.formatMinutes(entry.start) + '</strong><span>推算</span>';
                } else {
                    timeHtml = '<strong>待定</strong><span>未排时间</span>';
                }

                var metaPieces = [];
                if (item.stay) metaPieces.push('停留 ' + escapeHtml(item.stay) + ' 分');
                var category = Store.getCategory(place.categoryId);

                var transits = '';
                var nextPlace = index + 1 < timeline.length ? timeline[index + 1].place : null;
                if (nextPlace) {
                    var km = computeDistKm(place.lat, place.lng, nextPlace.lat, nextPlace.lng);
                    transits = '<li class="transit">↓ ' + escapeHtml(describeLeg(entry)) +
                        ' · 直线 ' + km.toFixed(1) + ' km</li>';
                }

                var nav = 'https://uri.amap.com/navigation?to=' + place.lng + ',' + place.lat + ',' +
                    encodeURIComponent(place.name) + '&mode=bus&callnative=1&coordinate=gaode&src=xingji';

                return '<li class="stop' + (entry.late ? ' is-late' : '') + '">' +
                    '<div class="stop-time">' + timeHtml + '</div>' +
                    '<div class="stop-body">' +
                    '<h3>' + escapeHtml(place.name) + ' <em>' + escapeHtml(category.name) + '</em></h3>' +
                    (place.address ? '<p class="addr">' + escapeHtml(place.address) + '</p>' : '') +
                    (metaPieces.length ? '<p class="stop-meta">' + metaPieces.join(' · ') + '</p>' : '') +
                    (item.note ? '<p class="note">' + escapeHtmlMultiline(item.note) + '</p>' : '') +
                    (place.note ? '<p class="note">' + escapeHtmlMultiline(place.note) + '</p>' : '') +
                    '<p class="links"><a href="' + nav + '">🧭 高德导航到这里</a></p>' +
                    '</div></li>' + transits;
            }).join('');

            var dayHeading = day.name;
            if (day.date && dayTabLabel(day) !== day.name) dayHeading += ' · ' + formatDateLabel(day.date);

            return '<section class="day">' +
                '<h2>' + escapeHtml(dayHeading) + '</h2>' +
                '<p class="day-meta">' + escapeHtml(parts.join(' · ')) + '</p>' +
                (stops ? '<ul class="stops">' + stops + '</ul>' : '<p class="empty">这一天还没有安排。</p>') +
                '</section>';
        }).join('');

        return '<!DOCTYPE html>\n' +
            '<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
            '<title>行程单 · ' + escapeHtml(title) + '</title>\n' +
            '<style>' + ITINERARY_STYLES + '</style>\n</head>\n<body>\n' +
            '<main class="sheet">' +
            '<header class="sheet-head"><div class="seal">拾</div>' +
            '<div><h1>' + escapeHtml(title) + '</h1>' +
            '<p class="brand">拾途 Paper Trip · 轻量行程规划</p></div></header>' +
            (note ? '<section class="trip-note"><h2>行程须知</h2><p>' + escapeHtmlMultiline(note) + '</p></section>' : '') +
            dayBlocks +
            '<footer class="sheet-foot">导出于 ' + generatedText + ' · 可离线打开 · 导航链接需手机联网唤起高德</footer>' +
            '<p class="print-tip">提示：在电脑上 Ctrl/Cmd + P 可打印或存为 PDF。</p>' +
            '</main>\n</body>\n</html>';
    }

    function exportItineraryHTML() {
        var html = buildItineraryHTML();
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = (Store.state.trip.title || '行程') + '-行程单.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast('已导出行程单，发到手机即可离线查看');
    }

    /* ================= 数据管理 ================= */

    function exportData() {
        var text = Store.exportJSON();
        var blob = new Blob([text], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = (Store.state.trip.title || '行程') + '-备份.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast('已导出 JSON 备份');
    }

    function onImportFile(event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var parsed = JSON.parse(reader.result);
                if (!parsed || typeof parsed !== 'object') throw new Error('格式不正确');
                if (!window.confirm('导入将覆盖当前的全部地点与行程，确定继续？')) return;
                Store.importJSON(reader.result);
                activeDayId = Store.state.days[0].id;
                activePlaceId = null;
                stopPlayback();
                renderAll();
                toast('导入成功');
            } catch (error) {
                toast('导入失败：' + error.message);
            } finally {
                els.importFile.value = '';
            }
        };
        reader.readAsText(file);
    }

    function clearAllData() {
        if (!window.confirm('确定清空全部数据吗？此操作不可撤销，建议先导出备份。')) return;
        Store.reset();
        activeDayId = Store.state.days[0].id;
        activePlaceId = null;
        stopPlayback();
        renderAll();
        toast('已清空，一切从零开始');
    }

    /* ================= 地图就绪回调 ================= */

    function onMapReady() {
        mapReady = true;
        renderAll();
    }

    function onMapFail() {
        mapReady = false;
        if (els.fallback) els.fallback.hidden = false;
        updateStatus('地图不可用 · 数据编辑功能不受影响');
        els.mapEmpty.hidden = true;
    }

    /* ================= 工具 ================= */

    function updateViewButtonLabel() {
        var mode = (Store.state.settings && Store.state.settings.viewMode) || '2D';
        els.viewBtn.textContent = mode === '3D' ? '2D' : '3D';
    }

    function styleLabel(mode) {
        if (mode === 'satellite') return '卫星';
        if (mode === 'normal') return '标准';
        return '暗黑';
    }

    function closeSheet() {
        els.app.classList.remove('sheet-open');
        els.sheetToggle.setAttribute('aria-expanded', 'false');
        els.sheetToggle.textContent = '行程';
    }

    function toast(message) {
        if (!els.toasts) return;
        var item = document.createElement('div');
        item.className = 'toast';
        item.textContent = message;
        els.toasts.appendChild(item);
        window.setTimeout(function () {
            item.classList.add('is-out');
            window.setTimeout(function () { item.remove(); }, 320);
        }, 2400);
        while (els.toasts.children.length > 4) {
            els.toasts.firstChild.remove();
        }
    }

    window.Workbench = {
        init: init,
        handleMapClick: handleMapClick,
        handleMarkerClick: handleMarkerClick,
        onMapReady: onMapReady,
        onMapFail: onMapFail,
        buildItineraryHTML: buildItineraryHTML,
        exportItineraryHTML: exportItineraryHTML,
        toast: toast
    };
})();
