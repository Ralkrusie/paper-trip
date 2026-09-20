/**
 * Paper Trip · 启动装配
 * 初始化数据层 → 工作台 → 高德地图，并把地图回调接到工作台。
 */
document.addEventListener('DOMContentLoaded', function () {
    Store.init();
    Workbench.init();

    var state = Store.state;

    TripMap.init({
        containerId: 'amap-container',
        center: { lng: state.view.lng, lat: state.view.lat },
        zoom: state.view.zoom,
        mapStyle: state.settings.mapStyle,
        viewMode: state.settings.viewMode,
        onMapClick: function (coords) {
            Workbench.handleMapClick(coords);
        },
        onMarkerClick: function (placeId) {
            Workbench.handleMarkerClick(placeId);
        },
        onViewChange: function (view) {
            Store.updateView(view);
        }
    }).then(function (ok) {
        if (ok) {
            Workbench.onMapReady();
        } else {
            Workbench.onMapFail();
        }
    });
});
