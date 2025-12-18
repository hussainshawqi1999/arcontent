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
if (!IPTV.host.startsWith('http')) IPTV.host = 'http://' + IPTV.host;

const AR_PREFIX = "|AR|";
let CAT_CACHE = { movieIds: new Set(), seriesIds: new Set(), movieGenres: [], seriesGenres: [], lastUpdated: 0 };

async function syncCats() {
    const now = Date.now();
    if (now - CAT_CACHE.lastUpdated < 3600000 && CAT_CACHE.movieIds.size > 0) return;
    try {
        const [v, s] = await Promise.all([
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(() => ({ data: [] })),
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_categories`, { timeout: 5000 }).catch(() => ({ data: [] }))
        ]);
        if (Array.isArray(v.data)) {
            const f = v.data.filter(c => c.category_name.toUpperCase().includes(AR_PREFIX));
            CAT_CACHE.movieIds = new Set(f.map(c => String(c.category_id)));
            CAT_CACHE.movieGenres = f.map(c => c.category_name);
        }
        if (Array.isArray(s.data)) {
            const f = s.data.filter(c => c.category_name.toUpperCase().includes(AR_PREFIX));
            CAT_CACHE.seriesIds = new Set(f.map(c => String(c.category_id)));
            CAT_CACHE.seriesGenres = f.map(c => c.category_name);
        }
        CAT_CACHE.lastUpdated = now;
    } catch (e) {}
}

app.get('/', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?/, 'stremio');
    res.send(`<div style="background:#0b0b0b;color:#fff;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;text-align:center;"><h2>Arabic Content - By Hussain</h2><p style="color:#888">Search Fixed: Full Library Search Enabled</p><a href="${stremioUrl}" style="padding:15px 35px;background:#6a0dad;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">🚀 Install to Stremio</a></div>`);
});

app.get('/manifest.json', async (req, res) => {
    await syncCats();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.arabic.hussain.searchfix.v13",
        version: "13.0.0",
        name: "Arabic Content - By Hussain",
        description: "Full Arabic Search - Series & Movies",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "genre", options: CAT_CACHE.movieGenres }, { name: "search" }, { name: "skip" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "genre", options: CAT_CACHE.seriesGenres }, { name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:"]
    });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await syncCats();
    let search = null;
    let genre = null;
    let skip = 0;

    if (extra) {
        const decoded = decodeURIComponent(extra);
        if (decoded.includes('search=')) search = decoded.split('search=')[1].split('&')[0];
        if (decoded.includes('genre=')) genre = decoded.split('genre=')[1].split('&')[0];
        if (decoded.includes('skip=')) skip = parseInt(decoded.split('skip=')[1].split('&')[0]) || 0;
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const allowedIds = type === 'movie' ? CAT_CACHE.movieIds : CAT_CACHE.seriesIds;

    try {
        let url = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
        
        if (search) {
            url += `&search=${encodeURIComponent(search)}`;
            const resp = await axios.get(url, { timeout: 10000 });
            let items = Array.isArray(resp.data) ? resp.data : [];
            items = items.filter(i => allowedIds.has(String(i.category_id)));
            const metas = items.slice(skip, skip + 100).map(i => ({
                id: type === 'series' ? `xtream:series:${i.series_id}` : `xtream:movie:${i.stream_id}:${i.container_extension}`,
                type: type, name: i.name, poster: i.stream_icon || i.cover, posterShape: 'poster'
            }));
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.json({ metas });
        }

        if (genre) {
            const catAction = type === 'movie' ? 'get_vod_categories' : 'get_series_categories';
            const catRes = await axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${catAction}`, { timeout: 4000 });
            const c = catRes.data.find(cat => cat.category_name === genre);
            if (c) url += `&category_id=${c.category_id}`;
        } else {
            const firstId = Array.from(allowedIds)[0];
            if (firstId) url += `&category_id=${firstId}`;
        }

        const resp = await axios.get(url, { timeout: 10000 });
        let items = Array.isArray(resp.data) ? resp.data : [];
        const metas = items.slice(skip, skip + 100).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id}` : `xtream:movie:${i.stream_id}:${i.container_extension}`,
            type: type, name: i.name, poster: i.stream_icon || i.cover, posterShape: 'poster'
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
    const p = id.split(':');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (type === 'series') {
        try {
            const { data } = await axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_info&series_id=${p[2]}`, { timeout: 9000 });
            let v = [];
            if (data.episodes) {
                Object.values(data.episodes).forEach(s => {
                    s.forEach(e => {
                        v.push({ id: `xtream:ep:${e.id}:${e.container_extension}`, title: e.title || `Ep ${e.episode_num}`, season: parseInt(e.season), episode: parseInt(e.episode_num), released: new Date().toISOString() });
                    });
                });
            }
            v.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
            return res.json({ meta: { id, type: 'series', name: data.info.name, poster: data.info.cover, description: data.info.plot, videos: v }});
        } catch (e) {}
    }
    res.json({ meta: { id, type, name: "Watch Now" } });
});

app.get('/stream/:type/:id.json', (req, res) => {
    const p = req.params.id.split(':');
    let u = "";
    if (p[1] === 'movie') u = `${IPTV.host}/movie/${IPTV.user}/${IPTV.pass}/${p[2]}.${p[3]}`;
    else if (p[1] === 'ep') u = `${IPTV.host}/series/${IPTV.user}/${IPTV.pass}/${p[2]}.${p[3]}`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "⚡ Watch Now", url: u }] });
});

app.get('/catalog/:type/:id.json', (req, res) => res.redirect(`/catalog/${req.params.type}/${req.params.id}/skip=0.json`));

if (process.env.VERCEL) module.exports = app;
else app.listen(7000);
