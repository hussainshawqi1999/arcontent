const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const IPTV_CONFIG = {
    host: "http://116342296971.d4ktv.info:80", 
    user: "hicham_100081",                
    pass: "E8fk82lZ"                 
};

if (IPTV_CONFIG.host.endsWith('/')) IPTV_CONFIG.host = IPTV_CONFIG.host.slice(0, -1);
if (!IPTV_CONFIG.host.startsWith('http')) IPTV_CONFIG.host = 'http://' + IPTV_CONFIG.host;

const FILTER_PREFIX = "|AR|"; 

let ARABIC_CACHE = {
    movieCatIds: [],
    seriesCatIds: [],
    movieGenres: [],
    seriesGenres: [],
    lastUpdated: 0
};

async function syncArabicCategories() {
    const now = Date.now();
    if (now - ARABIC_CACHE.lastUpdated < 3600000 && ARABIC_CACHE.movieCatIds.length > 0) return;

    try {
        const [vodRes, serRes] = await Promise.all([
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_categories`, { timeout: 5000 }).catch(e => ({ data: [] }))
        ]);

        if (Array.isArray(vodRes.data)) {
            const filtered = vodRes.data.filter(c => c.category_name.trim().toUpperCase().startsWith(FILTER_PREFIX));
            ARABIC_CACHE.movieCatIds = filtered.map(c => c.category_id);
            ARABIC_CACHE.movieGenres = filtered.map(c => c.category_name);
        }
        
        if (Array.isArray(serRes.data)) {
            const filtered = serRes.data.filter(c => c.category_name.trim().toUpperCase().startsWith(FILTER_PREFIX));
            ARABIC_CACHE.seriesCatIds = filtered.map(c => c.category_id);
            ARABIC_CACHE.seriesGenres = filtered.map(c => c.category_name);
        }

        ARABIC_CACHE.lastUpdated = now;
    } catch (e) { console.error("Sync Error"); }
}

app.get('/', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?/, 'stremio');

    res.send(`
    <div style="background:#0b0b0b;color:#fff;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;text-align:center;padding:20px;">
        <h1 style="color:#a37dfc">Arabic Content - By Hussain</h1>
        <p style="color:#888">تمت الفلترة لـ ${FILTER_PREFIX} فقط لضمان السرعة</p>
        <a href="${stremioUrl}" style="display:inline-block;padding:15px 35px;background:#6a0dad;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:20px;">🚀 Install on Stremio</a>
    </div>
    `);
});

app.get('/manifest.json', async (req, res) => {
    await syncArabicCategories();
    const manifest = {
        id: "org.arabic.hussain.ultra",
        version: "10.0.0",
        name: "Arabic Content - By Hussain",
        description: "Filtered Arabic IPTV (Movies & Series)",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "genre", options: ARABIC_CACHE.movieGenres }, { name: "search" }, { name: "skip" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "genre", options: ARABIC_CACHE.seriesGenres }, { name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:"]
    };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await syncArabicCategories();

    let extraObj = {};
    if (extra) {
        try {
            const params = new URLSearchParams(extra);
            extraObj.genre = params.get('genre');
            extraObj.search = params.get('search');
            extraObj.skip = parseInt(params.get('skip')) || 0;
        } catch(e) { extraObj.search = extra; }
    }

    let action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    let allowedIds = type === 'movie' ? ARABIC_CACHE.movieCatIds : ARABIC_CACHE.seriesCatIds;
    let genres = type === 'movie' ? ARABIC_CACHE.movieGenres : ARABIC_CACHE.seriesGenres;

    try {
        let apiUrl = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${action}`;
        
        if (extraObj.search) {
            apiUrl += `&search=${encodeURIComponent(extraObj.search)}`;
        } else if (extraObj.genre) {
            const catRes = await axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${type === 'movie' ? 'get_vod_categories' : 'get_series_categories'}`, { timeout: 5000 });
            const catObj = catRes.data.find(c => c.category_name === extraObj.genre);
            if (catObj) apiUrl += `&category_id=${catObj.category_id}`;
        } else {
            if (allowedIds.length > 0) apiUrl += `&category_id=${allowedIds[0]}`;
        }

        const resp = await axios.get(apiUrl, { timeout: 9000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (extraObj.search) {
            items = items.filter(item => allowedIds.includes(item.category_id));
        }

        const metas = items.slice(extraObj.skip || 0, (extraObj.skip || 0) + 100).map(item => ({
            id: type === 'series' ? `xtream:series:${item.series_id}` : `xtream:movie:${item.stream_id}:${item.container_extension}`,
            type: type,
            name: item.name,
            poster: item.stream_icon || item.cover,
            posterShape: 'poster'
        }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ metas });
    } catch (e) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const parts = id.split(':');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (type === 'series') {
        try {
            const url = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_info&series_id=${parts[2]}`;
            const { data } = await axios.get(url, { timeout: 8000 });
            let videos = [];
            if (data.episodes) {
                Object.values(data.episodes).forEach(season => {
                    season.forEach(ep => {
                        videos.push({
                            id: `xtream:episode:${ep.id}:${ep.container_extension}`,
                            title: ep.title || `Ep ${ep.episode_num}`,
                            season: parseInt(ep.season),
                            episode: parseInt(ep.episode_num),
                            released: new Date().toISOString()
                        });
                    });
                });
            }
            videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
            return res.json({ meta: { id, type: 'series', name: data.info.name, poster: data.info.cover, description: data.info.plot, videos }});
        } catch (e) { }
    }
    res.json({ meta: { id, type, name: "Watch Now" } });
});

app.get('/stream/:type/:id.json', (req, res) => {
    const parts = req.params.id.split(':');
    let streamUrl = "";
    if (parts[1] === 'movie') streamUrl = `${IPTV_CONFIG.host}/movie/${IPTV_CONFIG.user}/${IPTV_CONFIG.pass}/${parts[2]}.${parts[3]}`;
    else if (parts[1] === 'episode') streamUrl = `${IPTV_CONFIG.host}/series/${IPTV_CONFIG.user}/${IPTV_CONFIG.pass}/${parts[2]}.${parts[3]}`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "⚡ Watch Now", url: streamUrl }] });
});

app.get('/catalog/:type/:id.json', (req, res) => res.redirect(`/catalog/${req.params.type}/${req.params.id}/skip=0.json`));

const port = process.env.PORT || 7000;
if (process.env.VERCEL) module.exports = app;
else app.listen(port, () => console.log(`Run: http://localhost:${port}`));
