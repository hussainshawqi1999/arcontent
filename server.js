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

let CACHE = { movieCats: [], seriesCats: [], lastUpdated: 0 };

async function syncCats() {
    const now = Date.now();
    if (now - CACHE.lastUpdated < 3600000 && CACHE.movieCats.length > 0) return;
    try {
        const [v, s] = await Promise.all([
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_categories`, { timeout: 5000 }).catch(e => ({ data: [] }))
        ]);
        CACHE.movieCats = Array.isArray(v.data) ? v.data.filter(c => c.category_name.toUpperCase().startsWith(AR_PREFIX)) : [];
        CACHE.seriesCats = Array.isArray(s.data) ? s.data.filter(c => c.category_name.toUpperCase().startsWith(AR_PREFIX)) : [];
        CACHE.lastUpdated = now;
    } catch (e) {}
}

app.get('/', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?/, 'stremio');
    res.send(`<div style="background:#0b0b0b;color:#fff;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;"><h1 style="color:#a37dfc">Arabic Content - By Hussain</h1><a href="${stremioUrl}" style="padding:15px 35px;background:#6a0dad;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">🚀 Install on Stremio</a></div>`);
});

app.get('/manifest.json', async (req, res) => {
    await syncCats();
    const manifest = {
        id: "org.arabic.hussain.ultra.v3",
        version: "11.0.0",
        name: "Arabic Content - By Hussain",
        description: "Strict Arabic Filtered IPTV",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "genre", options: CACHE.movieCats.map(c => c.category_name) }, { name: "search" }, { name: "skip" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "genre", options: CACHE.seriesCats.map(c => c.category_name) }, { name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:"]
    };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await syncCats();
    let q = {};
    if (extra) {
        try {
            const p = new URLSearchParams(extra);
            q.genre = p.get('genre');
            q.search = p.get('search');
            q.skip = parseInt(p.get('skip')) || 0;
        } catch(e) { q.search = extra; }
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const allowedCats = type === 'movie' ? CACHE.movieCats : CACHE.seriesCats;
    const allowedIds = allowedCats.map(c => String(c.category_id));

    try {
        let url = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
        
        if (q.search) {
            url += `&search=${encodeURIComponent(q.search)}`;
        } else if (q.genre) {
            const c = allowedCats.find(cat => cat.category_name === q.genre);
            if (c) url += `&category_id=${c.category_id}`;
        } else {
            if (allowedIds.length > 0) url += `&category_id=${allowedIds[0]}`;
            else return res.json({ metas: [] });
        }

        const resp = await axios.get(url, { timeout: 8000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (q.search) {
            items = items.filter(i => allowedIds.includes(String(i.category_id)));
        }

        const metas = items.slice(q.skip || 0, (q.skip || 0) + 100).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id}` : `xtream:movie:${i.stream_id}:${i.container_extension}`,
            type: type,
            name: i.name,
            poster: i.stream_icon || i.cover,
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
    const p = id.split(':');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (type === 'series') {
        try {
            const { data } = await axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_info&series_id=${p[2]}`, { timeout: 8000 });
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
