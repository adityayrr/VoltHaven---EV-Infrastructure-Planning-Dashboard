/* ═══════════════════════════════════════════════════════════
   VoltHaven — Application Logic
   Interactive map, demand simulation, inventory management
   Backend-integrated with graceful local fallback
   ═══════════════════════════════════════════════════════════ */

const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8000' : 'https://volthaven-backend.onrender.com';

(function () {
    'use strict';

    // ─────────────────────────────────────────────
    // API CONFIGURATION
    // ─────────────────────────────────────────────
    const API_BASE = `${API_BASE_URL}/api`;
    let backendAvailable = false;

    // ─────────────────────────────────────────────
    // FALLBACK DATA (used when backend unreachable)
    // ─────────────────────────────────────────────

    const FALLBACK_STATIONS = [
        { id: 'P-01', lat: 28.6304, lng: 77.2177, location: 'Connaught Place',  type: 'DC Fast', type_cat: 'dcfast',  priority: 'Commuter', load: 150, score: 94, fast: 4, l2: 8,  note: 'Commuter Priority',    low_cap: false, status: 'existing' },
        { id: 'P-02', lat: 28.5494, lng: 77.2001, location: 'Hauz Khas',        type: 'Level-2', type_cat: 'level2',  priority: 'Resident', load: 48,  score: 78, fast: 0, l2: 12, note: 'Resident Overnight',   low_cap: true,  status: 'proposed' },
        { id: 'P-03', lat: 28.5494, lng: 77.2527, location: 'Nehru Place',      type: 'DC Fast', type_cat: 'dcfast',  priority: 'Transit',  load: 200, score: 91, fast: 6, l2: 4,  note: 'Transit Hub Anchor',   low_cap: false, status: 'existing' },
        { id: 'P-04', lat: 28.5523, lng: 77.0293, location: 'Dwarka',           type: 'Level-2', type_cat: 'level2',  priority: 'Retail',   load: 36,  score: 65, fast: 0, l2: 6,  note: 'Retail District',      low_cap: false, status: 'proposed' },
        { id: 'P-05', lat: 28.5484, lng: 77.1213, location: 'Aerocity',         type: 'DC Fast', type_cat: 'dcfast',  priority: 'Delivery', load: 180, score: 87, fast: 4, l2: 6,  note: 'Delivery Fleet Depot', low_cap: false, status: 'existing' },
        { id: 'P-06', lat: 28.6515, lng: 77.1906, location: 'Karol Bagh',       type: 'Level-2', type_cat: 'level2',  priority: 'Resident', load: 42,  score: 72, fast: 0, l2: 8,  note: 'Residential Cluster',  low_cap: false, status: 'proposed' },
        { id: 'P-07', lat: 28.5683, lng: 77.2201, location: 'South Extension',  type: 'DC Fast', type_cat: 'dcfast',  priority: 'Commuter', load: 120, score: 83, fast: 3, l2: 4,  note: 'Commuter Corridor',    low_cap: false, status: 'proposed' },
        { id: 'P-08', lat: 28.7360, lng: 77.1130, location: 'Rohini',           type: 'Level-2', type_cat: 'level2',  priority: 'Resident', load: 38,  score: 68, fast: 0, l2: 6,  note: 'Residential Infill',   low_cap: false, status: 'proposed' },
    ];

    const FALLBACK_DEMAND_PROFILES = {
        peak:    { balanced: [80,70,60,55,50,55,90,180,220,200,170,160,155,160,180,220,280,350,380,340,280,200,140,100], commuter: [60,50,45,40,38,50,110,240,280,230,180,150,140,150,200,260,340,420,440,380,300,210,140,90], delivery: [90,85,80,75,70,100,200,260,240,210,190,180,170,160,150,170,220,280,300,260,220,160,120,95] },
        morning: { balanced: [75,65,55,50,48,60,120,250,290,240,190,170,160,155,165,200,250,310,330,290,240,180,130,90], commuter: [55,48,42,38,35,55,140,300,360,280,200,170,155,150,170,220,290,350,370,310,250,185,130,80], delivery: [85,80,75,70,68,110,220,280,260,230,200,185,175,165,155,175,230,290,310,270,230,165,125,90] },
        offpeak: { balanced: [85,75,65,60,55,50,60,120,170,160,140,130,125,130,145,170,210,260,280,250,210,160,120,95], commuter: [65,55,48,42,38,40,70,160,210,180,150,130,120,125,150,190,250,320,340,300,250,180,130,85], delivery: [95,88,82,78,72,80,140,200,200,185,170,160,155,150,140,155,190,240,260,230,200,155,118,98] }
    };

    const GRID_LIMIT = 300;

    // Live station list — populated from backend or fallback
    let stations = [];

    // ─────────────────────────────────────────────
    // UTILITY — Debounce
    // ─────────────────────────────────────────────
    function debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    // ─────────────────────────────────────────────
    // API HELPERS
    // ─────────────────────────────────────────────

    async function apiFetch(path, opts = {}) {
        try {
            const res = await fetch(`${API_BASE}${path}`, {
                headers: { 'Content-Type': 'application/json' },
                ...opts,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            backendAvailable = true;
            return await res.json();
        } catch (err) {
            if (backendAvailable) {
                console.warn(`[VoltHaven] Backend unreachable — falling back to local data. (${err.message})`);
            }
            backendAvailable = false;
            return null;
        }
    }

    async function loadStations() {
        const data = await apiFetch('/stations');
        if (data) {
            stations = data;
        } else {
            stations = JSON.parse(JSON.stringify(FALLBACK_STATIONS));
        }
    }

    async function deleteStationAPI(id) {
        if (backendAvailable) {
            await apiFetch(`/stations/${id}`, { method: 'DELETE' });
        }
        // Always remove from local list regardless
        stations = stations.filter(s => s.id !== id);
    }

    async function runSimulationAPI(adoptionRate, priority, time) {
        if (backendAvailable) {
            const body = JSON.stringify({
                adoption_rate: adoptionRate,
                user_priority: priority,
                time_profile: time,
            });
            const data = await apiFetch('/simulate', { method: 'POST', body });
            if (data) return data;
        }
        // Fallback: compute locally
        return computeLocalSimulation(adoptionRate, priority, time);
    }

    function computeLocalSimulation(adoptionRate, priority, time) {
        const profile = FALLBACK_DEMAND_PROFILES[time]?.[priority]
            || FALLBACK_DEMAND_PROFILES.peak.balanced;
        const scale = adoptionRate > 0 ? adoptionRate / 38 : 0.01;
        const hourlyCurve = profile.map(v => Math.round(v * scale));
        const peakLoad = Math.max(...hourlyCurve);

        let gridRisk = 'LOW';
        if (peakLoad > GRID_LIMIT) gridRisk = 'HIGH';
        else if (peakLoad > GRID_LIMIT * 0.8) gridRisk = 'MODERATE';

        return {
            hourly_curve: hourlyCurve,
            grid_limit: GRID_LIMIT,
            peak_load: peakLoad,
            grid_risk: gridRisk,
            kpi_metrics: {
                total_stations: Math.round(35 * Math.max(scale, 0.4)),
                daily_energy_mwh: parseFloat((42.5 * scale).toFixed(1)),
                avg_grid_headroom_pct: Math.max(5, Math.round(22 / scale)),
                co2_reduced_tons: Math.round(1200 * scale),
            },
        };
    }

    // ─────────────────────────────────────────────
    // ZONE DATA (Delhi Metropolitan Area)
    // ─────────────────────────────────────────────

    const ZONES = [
        { name: 'Connaught Place (Commercial Hub)', coords: [[28.6380, 77.2080], [28.6380, 77.2300], [28.6220, 77.2300], [28.6220, 77.2080]], color: '#c8a020' },
        { name: 'South Delhi (Residential / Cultural)', coords: [[28.5600, 77.1850], [28.5600, 77.2250], [28.5350, 77.2250], [28.5350, 77.1850]], color: '#3d8b40' },
        { name: 'Dwarka (Transit & Sub-City)', coords: [[28.5850, 77.0150], [28.5850, 77.0650], [28.5400, 77.0650], [28.5400, 77.0150]], color: '#5a88a8' },
    ];

    // ─────────────────────────────────────────────
    // HEATMAP LAYER DATA (Delhi)
    // ─────────────────────────────────────────────

    // Traffic corridors (Ring Road, Outer Ring Road, NH-48 Airport Expressway)
    const TRAFFIC_CORRIDORS = [
        { name: 'Inner Ring Road', coords: [[28.5950, 77.1650], [28.5700, 77.2100], [28.5720, 77.2500], [28.6250, 77.2500], [28.6650, 77.2300], [28.6680, 77.1700], [28.6100, 77.1600]], color: '#c8a020' },
        { name: 'Outer Ring Road', coords: [[28.5450, 77.1800], [28.5450, 77.2600], [28.6100, 77.2900], [28.7100, 77.2000], [28.7100, 77.1200]], color: '#d4860a' },
        { name: 'NH-48 Airport Corridor', coords: [[28.6100, 77.1700], [28.5700, 77.1350], [28.5450, 77.1150], [28.5150, 77.0800]], color: '#c8a020' },
    ];

    // Grid infrastructure (Delhi Sub-stations)
    const GRID_SUBSTATIONS = [
        { name: 'Mandir Marg Substation', lat: 28.6280, lng: 77.2000, capacity: 500 },
        { name: 'Okhla Grid Substation', lat: 28.5350, lng: 77.2700, capacity: 450 },
        { name: 'Dwarka Sector 8 Substation', lat: 28.5700, lng: 77.0600, capacity: 400 },
    ];

    const GRID_FEEDERS = [
        { from: [28.6280, 77.2000], to: [28.6304, 77.2177], label: 'Feeder MM-CP' },
        { from: [28.6280, 77.2000], to: [28.6515, 77.1906], label: 'Feeder MM-KB' },
        { from: [28.5350, 77.2700], to: [28.5494, 77.2527], label: 'Feeder OK-NP' },
        { from: [28.5350, 77.2700], to: [28.5683, 77.2201], label: 'Feeder OK-SE' },
        { from: [28.5700, 77.0600], to: [28.5523, 77.0293], label: 'Feeder DW-S1' },
        { from: [28.5700, 77.0600], to: [28.5484, 77.1213], label: 'Feeder DW-Aero' },
    ];

    // Residential zones
    const RESIDENTIAL_ZONES = [
        { name: 'South Delhi Residential', coords: [[28.5500, 77.2100], [28.5500, 77.2400], [28.5200, 77.2400], [28.5200, 77.2100]], color: '#3d8b40' },
        { name: 'Dwarka Residential', coords: [[28.5900, 77.0300], [28.5900, 77.0650], [28.5600, 77.0650], [28.5600, 77.0300]], color: '#3d8b40' },
        { name: 'Rohini Residential', coords: [[28.7350, 77.0950], [28.7350, 77.1350], [28.7050, 77.1350], [28.7050, 77.0950]], color: '#3d8b40' },
    ];

    // ─────────────────────────────────────────────
    // MAP INITIALIZATION
    // ─────────────────────────────────────────────

    const map = L.map('map-container', {
        center: [28.6139, 77.2090],
        zoom: 11,
        zoomControl: true,
        attributionControl: true
    });

    // Esri ArcGIS Dark Gray Canvas — no API key required
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        maxZoom: 16
    }).addTo(map);

    // ─── Base Zone Polygons (always visible) ───
    const zoneLayerGroup = L.layerGroup().addTo(map);
    ZONES.forEach(zone => {
        const polygon = L.polygon(zone.coords, {
            color: zone.color, fillColor: zone.color,
            fillOpacity: 0.10, weight: 1, opacity: 0.4
        }).addTo(zoneLayerGroup);

        const center = polygon.getBounds().getCenter();
        L.marker(center, {
            icon: L.divIcon({ className: 'map-zone-label', html: zone.name, iconSize: null }),
            interactive: false
        }).addTo(zoneLayerGroup);
    });

    // ─── Station Markers (populated dynamically) ───
    const stationLayerGroup = L.layerGroup().addTo(map);
    let markerLookup = {};  // id → marker

    function buildStationMarkers() {
        stationLayerGroup.clearLayers();
        markerLookup = {};

        stations.forEach(s => {
            const labelText = s.low_cap ? `[${s.id} (Low Capacity)]` : `[${s.id}]`;
            const marker = L.marker([s.lat, s.lng], {
                icon: L.divIcon({
                    className: `map-marker${s.low_cap ? ' low-capacity' : ''}`,
                    html: labelText,
                    iconSize: null,
                    iconAnchor: [0, 0]
                })
            });
            marker.stationData = s;
            marker.on('click', () => showNodeDetail(s));
            marker.addTo(stationLayerGroup);
            markerLookup[s.id] = marker;
        });

        applyStationFilter();
    }

    // ─── Heatmap Layer Groups ───
    const trafficLayerGroup     = L.layerGroup();
    const gridLayerGroup        = L.layerGroup();
    const residentialLayerGroup = L.layerGroup();
    let activeHeatmap = 'traffic';

    // Build traffic layer
    TRAFFIC_CORRIDORS.forEach(corridor => {
        L.polyline(corridor.coords, {
            color: corridor.color,
            weight: 6,
            opacity: 0.45,
            lineCap: 'round',
            dashArray: null
        }).bindTooltip(corridor.name, { permanent: false, className: 'map-zone-label' })
          .addTo(trafficLayerGroup);
    });

    // Build grid layer
    GRID_SUBSTATIONS.forEach(sub => {
        L.marker([sub.lat, sub.lng], {
            icon: L.divIcon({
                className: 'map-marker',
                html: `${sub.name}: ${sub.capacity} kW`,
                iconSize: null,
                iconAnchor: [0, 0]
            })
        }).addTo(gridLayerGroup);
    });

    GRID_FEEDERS.forEach(f => {
        L.polyline([f.from, f.to], {
            color: '#5a88a8',
            weight: 2,
            opacity: 0.5,
            dashArray: '8, 6'
        }).bindTooltip(f.label, { permanent: false, className: 'map-zone-label' })
          .addTo(gridLayerGroup);
    });

    // Build residential layer
    RESIDENTIAL_ZONES.forEach(zone => {
        const poly = L.polygon(zone.coords, {
            color: zone.color, fillColor: zone.color,
            fillOpacity: 0.22, weight: 2, opacity: 0.6
        }).addTo(residentialLayerGroup);

        const center = poly.getBounds().getCenter();
        L.marker(center, {
            icon: L.divIcon({ className: 'map-zone-label', html: zone.name, iconSize: null }),
            interactive: false
        }).addTo(residentialLayerGroup);
    });

    function setHeatmapLayer(layer) {
        activeHeatmap = layer;
        map.removeLayer(trafficLayerGroup);
        map.removeLayer(gridLayerGroup);
        map.removeLayer(residentialLayerGroup);

        if (layer === 'traffic')     trafficLayerGroup.addTo(map);
        else if (layer === 'grid')   gridLayerGroup.addTo(map);
        else if (layer === 'residential') residentialLayerGroup.addTo(map);
    }

    // Default: show traffic
    trafficLayerGroup.addTo(map);

    // ─── Node Detail Panel ───
    const nodeDetail   = document.getElementById('node-detail');
    const nodeTitle    = document.getElementById('node-detail-title');
    const nodeBody     = document.getElementById('node-detail-body');
    const nodeCloseBtn = document.querySelector('.node-detail-close');

    function showNodeDetail(s) {
        nodeTitle.textContent = `Node ${s.id}`;
        nodeBody.innerHTML =
            `<strong>${s.score}/100</strong> Placement Score<br>` +
            `${s.fast} Fast Chargers, ${s.l2} Level-2<br>` +
            `<strong>${s.priority}</strong> Priority — ${s.note}<br>` +
            `Location: ${s.location}<br>` +
            `Est. Load: <strong>${s.load} kW</strong>`;
        nodeDetail.classList.remove('hidden');
    }

    nodeCloseBtn.addEventListener('click', () => { nodeDetail.classList.add('hidden'); });

    // ─── Map Filter Buttons: Heatmaps ───
    document.querySelectorAll('.filter-btn[data-layer]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn[data-layer]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setHeatmapLayer(btn.dataset.layer);
        });
    });

    // ─── Map Filter Buttons: Stations ───
    let activeStationFilter = 'all';

    function applyStationFilter() {
        const existingIds = stations.filter(s => s.status === 'existing').map(s => s.id);
        Object.entries(markerLookup).forEach(([id, marker]) => {
            const isExisting = existingIds.includes(id);
            if (activeStationFilter === 'all') {
                stationLayerGroup.addLayer(marker);
            } else if (activeStationFilter === 'existing' && isExisting) {
                stationLayerGroup.addLayer(marker);
            } else if (activeStationFilter === 'proposed' && !isExisting) {
                stationLayerGroup.addLayer(marker);
            } else {
                stationLayerGroup.removeLayer(marker);
            }
        });
    }

    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeStationFilter = btn.dataset.filter;
            applyStationFilter();
        });
    });

    // ─────────────────────────────────────────────
    // DEMAND CHART (Canvas)
    // ─────────────────────────────────────────────

    const canvas = document.getElementById('demand-chart');
    const ctx    = canvas.getContext('2d');
    let lastSimResult = null;

    function resizeCanvas() {
        const container = canvas.parentElement;
        canvas.width  = container.clientWidth - 24;
        canvas.height = container.clientHeight - 24;
    }

    function drawChart(data, gridLimit, maxHour = 23) {
        resizeCanvas();
        const w = canvas.width;
        const h = canvas.height;

        const padLeft = 48, padRight = 16, padTop = 16, padBottom = 28;
        const chartW = w - padLeft - padRight;
        const chartH = h - padTop - padBottom;
        const maxVal = Math.max(gridLimit + 60, ...data) + 20;

        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#2c2c2c';
        ctx.lineWidth = 1;
        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const y = padTop + (chartH / yTicks) * i;
            ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y); ctx.stroke();
            const val = Math.round(maxVal - (maxVal / yTicks) * i);
            ctx.fillStyle = '#6a6a6a';
            ctx.font = '10px "Segoe UI", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(val, padLeft - 8, y + 4);
        }

        // X-axis labels
        ctx.textAlign = 'center';
        for (let hr = 0; hr < 24; hr += 3) {
            const x = padLeft + (chartW / 23) * hr;
            ctx.fillStyle = '#6a6a6a';
            ctx.font = '10px "Segoe UI", sans-serif';
            ctx.fillText(`${hr}:00`, x, h - 6);
        }

        // Grid Capacity Limit line
        const limitY = padTop + chartH * (1 - gridLimit / maxVal);
        ctx.strokeStyle = '#b83830';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(padLeft, limitY); ctx.lineTo(padLeft + chartW, limitY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#b83830';
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('GRID CAPACITY LIMIT', padLeft + 4, limitY - 6);

        // Demand curve — segment-colored up to maxHour
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const renderLimit = Math.min(maxHour, data.length - 1);
        for (let i = 0; i < renderLimit; i++) {
            const x1 = padLeft + (chartW / 23) * i;
            const y1 = padTop + chartH * (1 - data[i] / maxVal);
            const x2 = padLeft + (chartW / 23) * (i + 1);
            const y2 = padTop + chartH * (1 - data[i + 1] / maxVal);
            const avg = (data[i] + data[i + 1]) / 2;

            ctx.strokeStyle = avg > gridLimit ? '#b83830' : avg > gridLimit * 0.8 ? '#c8a020' : '#3d8b40';
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }

        // Current hour pulse/indicator node
        if (renderLimit >= 0 && renderLimit < data.length) {
            const curX = padLeft + (chartW / 23) * renderLimit;
            const curY = padTop + chartH * (1 - data[renderLimit] / maxVal);
            ctx.fillStyle = data[renderLimit] > gridLimit ? '#b83830' : data[renderLimit] > gridLimit * 0.8 ? '#c8a020' : '#1db954';
            ctx.beginPath();
            ctx.arc(curX, curY, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Filled area under curve up to maxHour
        if (renderLimit > 0) {
            ctx.globalAlpha = 0.08;
            ctx.fillStyle = '#3d8b40';
            ctx.beginPath();
            ctx.moveTo(padLeft, padTop + chartH);
            for (let i = 0; i <= renderLimit; i++) {
                ctx.lineTo(padLeft + (chartW / 23) * i, padTop + chartH * (1 - data[i] / maxVal));
            }
            const lastX = padLeft + (chartW / 23) * renderLimit;
            ctx.lineTo(lastX, padTop + chartH);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // ─── Grid Risk Display ───
    function updateGridRiskDisplay(risk) {
        const lowEl  = document.getElementById('risk-low');
        const modEl  = document.getElementById('risk-moderate');
        const highEl = document.getElementById('risk-high');
        lowEl.classList.remove('active');
        modEl.classList.remove('active');
        highEl.classList.remove('active');

        if (risk === 'HIGH')          highEl.classList.add('active');
        else if (risk === 'MODERATE') modEl.classList.add('active');
        else                          lowEl.classList.add('active');
    }

    // ─── KPI Display ───
    function updateKPIDisplay(kpi) {
        document.getElementById('kpi-stations').textContent = kpi.total_stations;
        document.getElementById('kpi-energy').textContent   = kpi.daily_energy_mwh;

        const headEl = document.getElementById('kpi-headroom');
        headEl.textContent = kpi.avg_grid_headroom_pct + '%';
        headEl.className = 'kpi-value ' + (kpi.avg_grid_headroom_pct < 15 ? 'kpi-highlight' : '');

        document.getElementById('kpi-co2').textContent =
            kpi.co2_reduced_tons.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ─── Run full simulation cycle ───
    async function runSimulation() {
        const adoption = parseInt(document.getElementById('ev-adoption-slider').value, 10);
        const priority = document.getElementById('priority-select').value;
        const time     = document.getElementById('time-select').value;

        // Show loading state in AI popup
        const popupBody = document.getElementById('ai-popup-body');
        const popup     = document.getElementById('ai-summary-popup');
        popupBody.innerHTML = '<span class="ai-loading">AI is analyzing grid impact\u2026</span>';
        popup.classList.remove('hidden');

        const result = await runSimulationAPI(adoption, priority, time);
        lastSimResult = result;

        drawChart(result.hourly_curve, result.grid_limit);
        updateGridRiskDisplay(result.grid_risk);
        updateKPIDisplay(result.kpi_metrics);

        // Update AI summary popup
        if (result.ai_summary && result.ai_summary.length > 0) {
            popupBody.textContent = result.ai_summary;
        } else {
            popupBody.textContent = 'Simulation ran on local math model. AI servers currently busy.';
        }
    }

    // ─────────────────────────────────────────────
    // SIMULATOR CONTROLS
    // ─────────────────────────────────────────────

    const adoptionSlider = document.getElementById('ev-adoption-slider');
    const adoptionValue  = document.getElementById('ev-adoption-value');

    const debouncedSimulation = debounce(runSimulation, 500);

    adoptionSlider.addEventListener('input', () => {
        adoptionValue.textContent = adoptionSlider.value + '%';
        debouncedSimulation();
    });

    document.getElementById('priority-select').addEventListener('change', runSimulation);
    document.getElementById('time-select').addEventListener('change', runSimulation);

    document.getElementById('run-sim-btn').addEventListener('click', async () => {
        const btn = document.getElementById('run-sim-btn');
        btn.textContent = 'Running...';
        btn.disabled = true;
        await runSimulation();
        setTimeout(() => {
            btn.textContent = 'Run Simulation';
            btn.disabled = false;
        }, 400);
    });

    // ─────────────────────────────────────────────
    // 24-HOUR TIME-LAPSE ANIMATION
    // ─────────────────────────────────────────────

    let isAnimating = false;
    let timelapseTimer = null;

    const playTimelapseBtn = document.getElementById('play-timelapse-btn');
    const timelapseClock   = document.getElementById('timelapse-clock');
    const prioritySelect   = document.getElementById('priority-select');
    const timeSelect       = document.getElementById('time-select');

    function updateHeatmapOpacityForHour(hour, hourlyCurve) {
        let factor = 0.5;
        if (hourlyCurve && hourlyCurve.length === 24) {
            const minL = Math.min(...hourlyCurve);
            const maxL = Math.max(...hourlyCurve);
            factor = (hourlyCurve[hour] - minL) / (maxL - minL || 1);
        } else {
            if (hour >= 17 && hour <= 21) factor = 0.95;
            else if (hour >= 7 && hour <= 10) factor = 0.75;
            else if (hour >= 0 && hour <= 5) factor = 0.2;
            else factor = 0.5;
        }

        const strokeOpacity = 0.15 + factor * 0.75;  // 0.15 to 0.90
        const fillOpacity   = 0.08 + factor * 0.45;  // 0.08 to 0.53
        const strokeWidth   = 3 + factor * 5;        // 3 to 8

        trafficLayerGroup.eachLayer(layer => {
            if (layer.setStyle) layer.setStyle({ opacity: strokeOpacity, weight: strokeWidth });
        });

        residentialLayerGroup.eachLayer(layer => {
            if (layer.setStyle) layer.setStyle({ opacity: strokeOpacity, fillOpacity: fillOpacity });
        });

        gridLayerGroup.eachLayer(layer => {
            if (layer.setStyle) layer.setStyle({ opacity: strokeOpacity });
        });
    }

    function resetHeatmapOpacity() {
        trafficLayerGroup.eachLayer(layer => {
            if (layer.setStyle) layer.setStyle({ opacity: 0.45, weight: 6 });
        });
        residentialLayerGroup.eachLayer(layer => {
            if (layer.setStyle) layer.setStyle({ opacity: 0.6, fillOpacity: 0.22 });
        });
        gridLayerGroup.eachLayer(layer => {
            if (layer.setStyle) layer.setStyle({ opacity: 0.5, weight: 2 });
        });
    }

    function setControlsDisabled(disabled) {
        const runSimBtn = document.getElementById('run-sim-btn');
        if (runSimBtn) runSimBtn.disabled = disabled;
        if (adoptionSlider) adoptionSlider.disabled = disabled;
        if (prioritySelect) prioritySelect.disabled = disabled;
        if (timeSelect) timeSelect.disabled = disabled;
    }

    function startTimelapse() {
        if (isAnimating) return;
        isAnimating = true;

        setControlsDisabled(true);
        if (playTimelapseBtn) {
            playTimelapseBtn.textContent = '⏳ Playing...';
            playTimelapseBtn.disabled = true;
        }

        if (timelapseClock) {
            timelapseClock.textContent = '00:00';
            timelapseClock.classList.remove('hidden');
        }

        const curve = (lastSimResult && lastSimResult.hourly_curve)
            ? lastSimResult.hourly_curve
            : FALLBACK_DEMAND_PROFILES.peak.balanced;
        const gridLimit = (lastSimResult && lastSimResult.grid_limit)
            ? lastSimResult.grid_limit
            : GRID_LIMIT;

        let currentHour = 0;

        // Draw initial hour 0
        drawChart(curve, gridLimit, 0);
        updateHeatmapOpacityForHour(0, curve);

        timelapseTimer = setInterval(() => {
            currentHour++;

            if (currentHour > 23) {
                clearInterval(timelapseTimer);
                timelapseTimer = null;
                isAnimating = false;
                setControlsDisabled(false);

                if (playTimelapseBtn) {
                    playTimelapseBtn.textContent = '▶ Play 24H';
                    playTimelapseBtn.disabled = false;
                }

                if (lastSimResult) {
                    drawChart(lastSimResult.hourly_curve, lastSimResult.grid_limit, 23);
                    updateGridRiskDisplay(lastSimResult.grid_risk);
                }
                resetHeatmapOpacity();

                // Keep clock briefly at 23:00 then hide
                setTimeout(() => {
                    if (!isAnimating && timelapseClock) {
                        timelapseClock.classList.add('hidden');
                        timelapseClock.textContent = '00:00';
                    }
                }, 1500);

                return;
            }

            // Update clock display
            const timeStr = `${String(currentHour).padStart(2, '0')}:00`;
            if (timelapseClock) timelapseClock.textContent = timeStr;

            // Progressive chart reveal
            drawChart(curve, gridLimit, currentHour);

            // Update Leaflet heatmaps dynamically
            updateHeatmapOpacityForHour(currentHour, curve);

            // Update live risk indicator
            const curVal = curve[currentHour];
            if (curVal > gridLimit) updateGridRiskDisplay('HIGH');
            else if (curVal > gridLimit * 0.8) updateGridRiskDisplay('MODERATE');
            else updateGridRiskDisplay('LOW');

        }, 350); // 350ms per simulated hour
    }

    if (playTimelapseBtn) {
        playTimelapseBtn.addEventListener('click', () => {
            if (!isAnimating) startTimelapse();
        });
    }

    // ─────────────────────────────────────────────
    // INVENTORY TABLE
    // ─────────────────────────────────────────────

    const tableBody    = document.getElementById('inventory-body');
    const searchInput  = document.getElementById('inventory-search');
    const filterSelect = document.getElementById('inventory-filter');
    const rowCountEl   = document.getElementById('row-count');

    function renderTable() {
        const query  = searchInput.value.toLowerCase();
        const filter = filterSelect.value;

        const filtered = stations.filter(s => {
            const matchSearch =
                s.id.toLowerCase().includes(query) ||
                s.location.toLowerCase().includes(query) ||
                s.priority.toLowerCase().includes(query);
            const matchFilter = filter === 'all' || s.type_cat === filter;
            return matchSearch && matchFilter;
        });

        tableBody.innerHTML = '';
        filtered.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML =
                `<td class="node-id">[${s.id}]</td>` +
                `<td>${s.location}</td>` +
                `<td>${s.type}</td>` +
                `<td>${s.priority}</td>` +
                `<td>${s.load} kW</td>` +
                `<td>` +
                    `<button class="action-link" data-action="edit" data-id="${s.id}">Edit</button>` +
                    `<button class="action-link" data-action="model" data-id="${s.id}">Model Site</button>` +
                    `<button class="action-link action-delete" data-action="delete" data-id="${s.id}">Delete</button>` +
                `</td>`;
            tableBody.appendChild(tr);
        });

        rowCountEl.textContent = `Showing ${filtered.length} node${filtered.length !== 1 ? 's' : ''}`;
    }

    searchInput.addEventListener('input', renderTable);
    filterSelect.addEventListener('change', renderTable);

    // Table action delegation
    tableBody.addEventListener('click', async (e) => {
        const btn = e.target.closest('.action-link');
        if (!btn) return;

        const action = btn.dataset.action;
        const id     = btn.dataset.id;

        if (action === 'edit') {
            alert(`Edit dialog for ${id}\n(Integration point — form would open here)`);
        } else if (action === 'model') {
            const station = stations.find(s => s.id === id);
            if (station) {
                showNodeDetail(station);
                map.flyTo([station.lat, station.lng], 16, { duration: 0.8 });
            }
        } else if (action === 'delete') {
            if (confirm(`Remove node ${id} from the plan?`)) {
                await deleteStationAPI(id);
                buildStationMarkers();
                renderTable();
            }
        }
    });

    // ─────────────────────────────────────────────
    // ADD NEW STATION MODAL
    // ─────────────────────────────────────────────

    const addStationModal = document.getElementById('add-station-modal');
    const addStationForm  = document.getElementById('add-station-form');
    const modalCloseBtn   = document.getElementById('modal-close-btn');
    const modalCancelBtn  = document.getElementById('modal-cancel-btn');

    function openAddModal() {
        if (addStationModal) addStationModal.classList.remove('hidden');
    }

    function closeAddModal() {
        if (addStationModal) addStationModal.classList.add('hidden');
        if (addStationForm) addStationForm.reset();
    }

    document.getElementById('add-station-btn').addEventListener('click', openAddModal);
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeAddModal);
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', closeAddModal);

    if (addStationModal) {
        addStationModal.addEventListener('click', (e) => {
            if (e.target === addStationModal) closeAddModal();
        });
    }

    if (addStationForm) {
        addStationForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const typeVal = document.getElementById('station-type').value;
            const newStation = {
                id: document.getElementById('station-id').value.trim(),
                location: document.getElementById('station-location').value.trim(),
                load: parseInt(document.getElementById('station-capacity').value, 10),
                type: typeVal,
                type_cat: typeVal === 'DC Fast' ? 'dcfast' : 'level2',
                priority: document.getElementById('station-priority').value,
                lat: parseFloat(document.getElementById('station-lat').value),
                lng: parseFloat(document.getElementById('station-lng').value),
                score: 75,
                fast: typeVal === 'DC Fast' ? 4 : 0,
                l2: typeVal === 'Level-2' ? 6 : 2,
                note: 'User Proposed',
                low_cap: false,
                status: 'proposed'
            };

            // Post to backend API
            if (backendAvailable) {
                const res = await apiFetch('/stations', {
                    method: 'POST',
                    body: JSON.stringify(newStation)
                });
                if (res) {
                    await loadStations();
                } else {
                    stations.push(newStation);
                }
            } else {
                stations.push(newStation);
            }

            buildStationMarkers();
            renderTable();
            closeAddModal();

            // Pan to newly added station
            map.flyTo([newStation.lat, newStation.lng], 14, { duration: 0.8 });
        });
    }

    // ─────────────────────────────────────────────
    // AGENTIC RAG COPILOT — Chatbot
    // ─────────────────────────────────────────────

    const chatLauncherBtn = document.getElementById('chat-toggle-btn');
    const chatWindow      = document.getElementById('chat-window');
    const chatCloseBtn    = document.getElementById('chat-close-btn');
    const chatForm        = document.getElementById('chat-form');
    const chatInput       = document.getElementById('chat-input');
    const chatMessages    = document.getElementById('chat-messages');

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    if (chatLauncherBtn && chatWindow) {
        chatLauncherBtn.addEventListener('click', () => {
            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden') && chatInput) {
                chatInput.focus();
            }
        });
    }

    if (chatCloseBtn && chatWindow) {
        chatCloseBtn.addEventListener('click', () => {
            chatWindow.classList.add('hidden');
        });
    }

    if (chatForm && chatInput && chatMessages) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const query = chatInput.value.trim();
            if (!query) return;

            // Append user bubble
            const userMsg = document.createElement('div');
            userMsg.className = 'chat-msg user-msg';
            userMsg.innerHTML = `<div class="msg-bubble">${escapeHtml(query)}</div>`;
            chatMessages.appendChild(userMsg);
            chatInput.value = '';

            // Append Thinking bubble
            const aiMsg = document.createElement('div');
            aiMsg.className = 'chat-msg ai-msg';
            aiMsg.innerHTML = `<div class="msg-bubble"><em>Thinking...</em></div>`;
            chatMessages.appendChild(aiMsg);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            // Fetch from backend /api/chat
            try {
                let answer = null;
                if (backendAvailable) {
                    const res = await apiFetch('/chat', {
                        method: 'POST',
                        body: JSON.stringify({ query: query })
                    });
                    if (res && res.response) answer = res.response;
                }

                // If backend offline or didn't return, provide local RAG response
                if (!answer) {
                    const qLower = query.toLowerCase();
                    if (qLower.includes('highest') || qLower.includes('max') || qLower.includes('capacity')) {
                        const maxS = stations.reduce((prev, curr) => (curr.load > prev.load ? curr : prev), stations[0]);
                        answer = `The station with the highest capacity is ${maxS.location} (${maxS.id}) at ${maxS.load} kW (${maxS.type}).`;
                    } else if (qLower.includes('count') || qLower.includes('how many') || qLower.includes('total')) {
                        answer = `There are currently ${stations.length} charging stations deployed or proposed in the Delhi network.`;
                    } else {
                        answer = `VoltHaven Copilot: Tracking ${stations.length} Delhi EV stations. Substation A capacity is ${GRID_LIMIT} kW. (Local fallback mode active).`;
                    }
                }

                aiMsg.querySelector('.msg-bubble').textContent = answer;
            } catch (err) {
                aiMsg.querySelector('.msg-bubble').textContent = 'VoltHaven Copilot: Unable to process query at this time.';
            }

            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    // ─────────────────────────────────────────────
    // AI SUMMARY FAB — Toggle & Close
    // ─────────────────────────────────────────────

    document.getElementById('ai-fab-btn').addEventListener('click', () => {
        document.getElementById('ai-summary-popup').classList.toggle('hidden');
    });

    document.getElementById('ai-popup-close').addEventListener('click', () => {
        document.getElementById('ai-summary-popup').classList.add('hidden');
    });

    // ─────────────────────────────────────────────
    // INITIALIZATION
    // ─────────────────────────────────────────────

    async function init() {
        await loadStations();
        buildStationMarkers();
        renderTable();
        await runSimulation();

        // Fix Leaflet tile rendering after layout settles
        setTimeout(() => { map.invalidateSize(); }, 200);

        if (backendAvailable) {
            console.info('[VoltHaven] Connected to backend API at', API_BASE);
        } else {
            console.warn('[VoltHaven] Running in offline mode with local fallback data.');
        }
    }

    window.addEventListener('resize', () => {
        if (lastSimResult) drawChart(lastSimResult.hourly_curve, lastSimResult.grid_limit);
    });

    window.addEventListener('load', init);

})();
