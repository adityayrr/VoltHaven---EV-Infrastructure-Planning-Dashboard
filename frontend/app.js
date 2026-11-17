/* ═══════════════════════════════════════════════════════════
   VoltHaven — Application Logic
   Interactive map, demand simulation, inventory management
   Backend-integrated with graceful local fallback
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─────────────────────────────────────────────
    // API CONFIGURATION
    // ─────────────────────────────────────────────
    const API_BASE = 'http://127.0.0.1:8000/api';
    let backendAvailable = false;

    // ─────────────────────────────────────────────
    // FALLBACK DATA (used when backend unreachable)
    // ─────────────────────────────────────────────

    const FALLBACK_STATIONS = [
        { id: 'P-01', lat: 41.2810, lng: -72.9220, location: 'Long Wharf',        type: 'DC Fast', type_cat: 'dcfast',  priority: 'Commuter', load: 150, score: 94, fast: 4, l2: 8,  note: 'Commuter Priority',    low_cap: false, status: 'existing' },
        { id: 'P-02', lat: 41.3085, lng: -72.9285, location: 'Yale Science Hill', type: 'Level-2', type_cat: 'level2',  priority: 'Resident', load: 48,  score: 78, fast: 0, l2: 12, note: 'Resident Overnight',   low_cap: true,  status: 'proposed' },
        { id: 'P-03', lat: 41.2985, lng: -72.9265, location: 'Union Station',     type: 'DC Fast', type_cat: 'dcfast',  priority: 'Transit',  load: 200, score: 91, fast: 6, l2: 4,  note: 'Transit Hub Anchor',   low_cap: false, status: 'existing' },
        { id: 'P-04', lat: 41.3050, lng: -72.9360, location: 'Broadway District', type: 'Level-2', type_cat: 'level2',  priority: 'Retail',   load: 36,  score: 65, fast: 0, l2: 6,  note: 'Retail District',      low_cap: false, status: 'proposed' },
        { id: 'P-05', lat: 41.2930, lng: -72.9020, location: 'Fair Haven',        type: 'DC Fast', type_cat: 'dcfast',  priority: 'Delivery', load: 180, score: 87, fast: 4, l2: 6,  note: 'Delivery Fleet Depot', low_cap: false, status: 'existing' },
        { id: 'P-06', lat: 41.3140, lng: -72.9230, location: 'Prospect Hill',     type: 'Level-2', type_cat: 'level2',  priority: 'Resident', load: 42,  score: 72, fast: 0, l2: 8,  note: 'Residential Cluster',  low_cap: false, status: 'proposed' },
        { id: 'P-07', lat: 41.2870, lng: -72.9340, location: 'City Point',        type: 'DC Fast', type_cat: 'dcfast',  priority: 'Commuter', load: 120, score: 83, fast: 3, l2: 4,  note: 'Commuter Corridor',    low_cap: false, status: 'proposed' },
        { id: 'P-08', lat: 41.3010, lng: -72.9160, location: 'Wooster Square',    type: 'Level-2', type_cat: 'level2',  priority: 'Resident', load: 38,  score: 68, fast: 0, l2: 6,  note: 'Residential Infill',   low_cap: false, status: 'proposed' },
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
    // ZONE DATA
    // ─────────────────────────────────────────────

    const ZONES = [
        { name: 'Yale Campus (Resident Heavy)',  coords: [[41.3120,-72.9330],[41.3120,-72.9230],[41.3040,-72.9230],[41.3040,-72.9330]], color: '#3d8b40' },
        { name: 'Long Wharf (Commuter Route)',   coords: [[41.2840,-72.9270],[41.2840,-72.9170],[41.2780,-72.9170],[41.2780,-72.9270]], color: '#c8a020' },
        { name: 'Union Station (Transit Hub)',    coords: [[41.3010,-72.9300],[41.3010,-72.9230],[41.2960,-72.9230],[41.2960,-72.9300]], color: '#5a88a8' },
    ];

    // ─────────────────────────────────────────────
    // HEATMAP LAYER DATA
    // ─────────────────────────────────────────────

    // Traffic corridors (I-95, I-91, Long Wharf connector)
    const TRAFFIC_CORRIDORS = [
        { name: 'I-95 Corridor',       coords: [[41.2750,-72.9400],[41.2780,-72.9300],[41.2820,-72.9200],[41.2870,-72.9050],[41.2930,-72.8950]], color: '#c8a020' },
        { name: 'I-91 Corridor',       coords: [[41.2800,-72.9260],[41.2900,-72.9250],[41.3000,-72.9240],[41.3100,-72.9220],[41.3180,-72.9200]], color: '#d4860a' },
        { name: 'Long Wharf Connector', coords: [[41.2790,-72.9270],[41.2810,-72.9230],[41.2830,-72.9180],[41.2850,-72.9130]],                  color: '#c8a020' },
    ];

    // Grid infrastructure
    const GRID_SUBSTATIONS = [
        { name: 'Substation A', lat: 41.2900, lng: -72.9250, capacity: 300 },
        { name: 'Substation B', lat: 41.3060, lng: -72.9300, capacity: 450 },
        { name: 'Substation C', lat: 41.2980, lng: -72.9100, capacity: 350 },
    ];

    const GRID_FEEDERS = [
        { from: [41.2900,-72.9250], to: [41.2810,-72.9220], label: 'Feeder A1' },
        { from: [41.2900,-72.9250], to: [41.2985,-72.9265], label: 'Feeder A2' },
        { from: [41.3060,-72.9300], to: [41.3085,-72.9285], label: 'Feeder B1' },
        { from: [41.3060,-72.9300], to: [41.3050,-72.9360], label: 'Feeder B2' },
        { from: [41.2980,-72.9100], to: [41.2930,-72.9020], label: 'Feeder C1' },
        { from: [41.2980,-72.9100], to: [41.3010,-72.9160], label: 'Feeder C2' },
    ];

    // Residential zones
    const RESIDENTIAL_ZONES = [
        { name: 'Yale Campus',    coords: [[41.3120,-72.9330],[41.3120,-72.9230],[41.3040,-72.9230],[41.3040,-72.9330]], color: '#3d8b40' },
        { name: 'Prospect Hill',  coords: [[41.3170,-72.9270],[41.3170,-72.9190],[41.3110,-72.9190],[41.3110,-72.9270]], color: '#3d8b40' },
        { name: 'Wooster Square', coords: [[41.3040,-72.9190],[41.3040,-72.9120],[41.2980,-72.9120],[41.2980,-72.9190]], color: '#3d8b40' },
    ];

    // ─────────────────────────────────────────────
    // MAP INITIALIZATION
    // ─────────────────────────────────────────────

    const map = L.map('map-container', {
        center: [41.3000, -72.9240],
        zoom: 14,
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

    function drawChart(data, gridLimit) {
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

        // Demand curve — segment-colored
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 0; i < data.length - 1; i++) {
            const x1 = padLeft + (chartW / 23) * i;
            const y1 = padTop + chartH * (1 - data[i] / maxVal);
            const x2 = padLeft + (chartW / 23) * (i + 1);
            const y2 = padTop + chartH * (1 - data[i + 1] / maxVal);
            const avg = (data[i] + data[i + 1]) / 2;

            ctx.strokeStyle = avg > gridLimit ? '#b83830' : avg > gridLimit * 0.8 ? '#c8a020' : '#3d8b40';
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }

        // Filled area under curve
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = '#3d8b40';
        ctx.beginPath();
        ctx.moveTo(padLeft, padTop + chartH);
        for (let i = 0; i < data.length; i++) {
            ctx.lineTo(padLeft + (chartW / 23) * i, padTop + chartH * (1 - data[i] / maxVal));
        }
        ctx.lineTo(padLeft + chartW, padTop + chartH);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
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

        const result = await runSimulationAPI(adoption, priority, time);
        lastSimResult = result;

        drawChart(result.hourly_curve, result.grid_limit);
        updateGridRiskDisplay(result.grid_risk);
        updateKPIDisplay(result.kpi_metrics);
    }

    // ─────────────────────────────────────────────
    // SIMULATOR CONTROLS
    // ─────────────────────────────────────────────

    const adoptionSlider = document.getElementById('ev-adoption-slider');
    const adoptionValue  = document.getElementById('ev-adoption-value');

    adoptionSlider.addEventListener('input', () => {
        adoptionValue.textContent = adoptionSlider.value + '%';
        runSimulation();
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

    // Add New Station
    document.getElementById('add-station-btn').addEventListener('click', () => {
        alert('Add New Station\n(Integration point — creation form would open here)');
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
