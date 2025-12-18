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
let CAT_CACHE = { movieCats: [], seriesCats: [], lastUpdated: 0 };

async function syncCats() {
    const now = Date.now();
    if (now - CAT_CACHE.lastUpdated < 3600000 && CAT_CACHE.movieCats.length > 0) return;
    try {
        const [v, s] = await Promise.all([
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(() => ({ data: [] })),
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_categories`, { timeout: 5000 }).catch(() => ({ data: [] }))
        ]);
        if (Array.isArray(v.data)) {
            CAT_CACHE.movieCats = v.data.filter(c => c.category_name.toUpperCase().includes(AR_PREFIX));
        }
        if (Array.isArray(s.data)) {
            CAT_CACHE.seriesCats = s.data.filter(c => c.category_name.toUpperCase().includes(AR_PREFIX));
        }
        CAT_CACHE.lastUpdated = now;
    } catch (e) {}
}

app.get('/', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?/, 'stremio');
    res.send(`<div style="background:#0b0b0b;color:#fff;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;text-align:center;"><h2>Arabic Content - By Hussain</h2><p style="color:#888">Logic Restored & Verified (v19)</p><a href="${stremioUrl}" style="padding:15px 35px;background:#6a0dad;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">🚀 Install to Stremio</a></div>`);
});

app.get('/manifest.json', async (req, res) => {
    await syncCats();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.arabic.hussain.restore.v19",
        version: "19.0.0",
        name: "Arabic Content - By Hussain",
        description: "Arabic Movies and Series",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "genre", options: CAT_CACHE.movieCats.map(c => c.category_name) }, { name: "search" }, { name: "skip" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "genre", options: CAT_CACHE.seriesCats.map(c => c.category_name) }, { name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:"]
    });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await syncCats();
    
    let extraObj = {};
    if (extra) {
        try {
            if (extra.includes('=')) {
                const params = new URLSearchParams(extra);
                extraObj.genre = params.get('genre');
                extraObj.search = params.get('search');
                extraObj.skip = parseInt(params.get('skip')) || 0;
            } else {
                extraObj.search = extra.replace('.json', '');
            }
        } catch(e) {}
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const allowedCats = type === 'movie' ? CAT_CACHE.movieCats : CAT_CACHE.seriesCats;
    const allowedIds = allowedCats.map(c => String(c.category_id));

    try {
        let metas = [];

        if (extraObj.search) {
            const searchTerm = encodeURIComponent(extraObj.search);
            const searchUrl = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}&search=${searchTerm}`;
            const searchRes = await axios.get(searchUrl, { timeout: 10000 });
            if (Array.isArray(searchRes.data)) {
                metas = searchRes.data; 
            }
        } else {
            let categoryId = null;
            if (extraObj.genre) {
                const target = allowedCats.find(c => c.category_name === extraObj.genre);
                if (target) categoryId = target.category_id;
            } else if (allowedIds.length > 0) {
                categoryId = allowedIds[0];
            }

            let apiUrl = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
            if (categoryId) apiUrl += `&category_id=${categoryId}`;

            const response = await axios.get(apiUrl, { timeout: 10000 });
            metas = Array.isArray(response.data) ? response.data : [];
        }

        const skip = extraObj.skip || 0;
        const finalMetas = metas.slice(skip, skip + 100).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id}` : `xtream:movie:${i.stream_id}:${i.container_extension}`,
            type: type, name: i.name, poster: i.stream_icon || i.cover, posterShape: 'poster'
        }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ metas: finalMetas });
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
