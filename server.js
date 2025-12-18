const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const IPTV = {
    host: "http://116342296971.d4ktv.info:80",
    user: "hicham_100081",
    pass: "E8fk82lZ"
};

if (IPTV.host.endsWith('/')) IPTV.host = IPTV.host.slice(0, -1);
const AR_PREFIX = "|AR|";

let CAT_CACHE = { movie: [], series: [], lastUpdated: 0 };

async function syncCats() {
    const now = Date.now();
    if (now - CAT_CACHE.lastUpdated < 3600000 && CAT_CACHE.movie.length > 0) return;
    try {
        const [v, s] = await Promise.all([
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_vod_categories`, { timeout: 4000 }).catch(() => ({ data: [] })),
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_categories`, { timeout: 4000 }).catch(() => ({ data: [] }))
        ]);
        if (Array.isArray(v.data)) CAT_CACHE.movie = v.data.filter(c => c.category_name.includes(AR_PREFIX)).map(c => ({ name: c.category_name, id: String(c.category_id) }));
        if (Array.isArray(s.data)) CAT_CACHE.series = s.data.filter(c => c.category_name.includes(AR_PREFIX)).map(c => ({ name: c.category_name, id: String(c.category_id) }));
        CAT_CACHE.lastUpdated = now;
    } catch (e) {}
}

app.get('/manifest.json', async (req, res) => {
    await syncCats();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.arabic.hussain.stable.v30",
        version: "30.0.0",
        name: "Arabic Content - By Hussain",
        description: "Arabic Movies and Series",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "genre", options: CAT_CACHE.movie.map(c => c.name) }, { name: "search" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "genre", options: CAT_CACHE.series.map(c => c.name) }, { name: "search" }] }
        ],
        idPrefixes: ["xtream:"]
    });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await syncCats();

    let searchTerm = "";
    let genreName = "";
    if (extra) {
        const clean = decodeURIComponent(extra.replace('.json', '').replace(/\+/g, ' '));
        const sMatch = clean.match(/search=([^&]+)/);
        const gMatch = clean.match(/genre=([^&]+)/);
        searchTerm = sMatch ? sMatch[1] : (clean.includes('=') ? "" : clean);
        genreName = gMatch ? gMatch[1] : "";
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const cachedList = type === 'movie' ? CAT_CACHE.movie : CAT_CACHE.series;
    const allowedIds = cachedList.map(c => c.id);

    try {
        let apiUrl = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
        
        if (searchTerm) {
            apiUrl += `&search=${encodeURIComponent(searchTerm)}`;
        } else if (genreName) {
            const target = cachedList.find(c => c.name === genreName);
            if (target) apiUrl += `&category_id=${target.id}`;
        } else if (allowedIds.length > 0) {
            apiUrl += `&category_id=${allowedIds[0]}`;
        }

        const resp = await axios.get(apiUrl, { timeout: 8000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (allowedIds.length > 0) {
            items = items.filter(i => allowedIds.includes(String(i.category_id)));
        }

        const metas = items.slice(0, 70).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id || i.stream_id}` : `xtream:movie:${i.stream_id}:${i.container_extension || 'mp4'}`,
            type: type,
            name: i.name,
            poster: i.stream_icon || i.cover,
            posterShape: 'poster'
        }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const p = id.split(':');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (type === 'series') {
        try {
            const { data } = await axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_info&series_id=${p[2]}`, { timeout: 8000 });
            let videos = [];
            if (data && data.episodes) {
                Object.values(data.episodes).forEach(s => {
                    s.forEach(e => {
                        videos.push({ id: `xtream:ep:${e.id}:${e.container_extension || 'mp4'}`, title: e.title || `Ep ${e.episode_num}`, season: parseInt(e.season), episode: parseInt(e.episode_num) });
                    });
                });
            }
            return res.json({ meta: { id, type: 'series', name: data.info.name, poster: data.info.cover, description: data.info.plot, videos } });
        } catch (e) {}
    }
    res.json({ meta: { id, type, name: "Watch Now" } });
});

app.get('/stream/:type/:id.json', (req, res) => {
    const p = req.params.id.split(':');
    let u = "";
    if (p[1] === 'movie') u = `${IPTV.host}/movie/${IPTV.user}/${IPTV.pass}/${p[2]}.${p[3] || 'mp4'}`;
    else if (p[1] === 'ep') u = `${IPTV.host}/series/${IPTV.user}/${IPTV.pass}/${p[2]}.${p[3] || 'mp4'}`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "⚡ Watch Now", url: u }] });
});

app.get('/', (req, res) => {
    const host = req.get('host');
    const stremioUrl = `stremio://${host}/manifest.json`;
    res.send(`<div style="background:#0b0b0b;color:#fff;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;"><h1>Arabic IPTV v30</h1><a href="${stremioUrl}" style="padding:15px 30px;background:#6a0dad;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">🚀 Install on Stremio</a></div>`);
});

if (process.env.VERCEL) module.exports = app;
else app.listen(7000);
