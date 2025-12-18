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

async function syncArabicCats() {
    const now = Date.now();
    if (now - CAT_CACHE.lastUpdated < 3600000 && CAT_CACHE.movie.length > 0) return;
    try {
        const [v, s] = await Promise.all([
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(() => ({ data: [] })),
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_categories`, { timeout: 5000 }).catch(() => ({ data: [] }))
        ]);
        if (Array.isArray(v.data)) CAT_CACHE.movie = v.data.filter(c => c.category_name.includes(AR_PREFIX)).map(c => ({ name: c.category_name, id: String(c.category_id) }));
        if (Array.isArray(s.data)) CAT_CACHE.series = s.data.filter(c => c.category_name.includes(AR_PREFIX)).map(c => ({ name: c.category_name, id: String(c.category_id) }));
        CAT_CACHE.lastUpdated = now;
    } catch (e) {}
}

app.get('/', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol;
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?/, 'stremio');

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Arabic Content - By Hussain</title>
        <style>
            body { background-color: #0b0b0b; color: white; font-family: sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { background: #1a1a1a; padding: 40px; border-radius: 12px; text-align: center; border: 1px solid #333; max-width: 450px; width: 90%; }
            h1 { color: #a37dfc; margin-bottom: 20px; }
            .btn { display: block; width: 100%; padding: 16px; margin: 10px 0; border-radius: 8px; text-decoration: none; font-weight: bold; background: #6a0dad; color: white; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Arabic content</h1>
            <p>test</p>
            <a href="${stremioUrl}" class="btn">🚀 Install on Stremio</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/manifest.json', async (req, res) => {
    await syncArabicCats();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.arabic.hussain.v27",
        version: "27.0.0",
        name: "Arabic Content - By Hussain",
        description: "Filtered Arabic Content (12k Library Optimized)",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "genre", options: CAT_CACHE.movie.map(c => c.name) }, { name: "search" }, { name: "skip" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "genre", options: CAT_CACHE.series.map(c => c.name) }, { name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:"]
    });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await syncArabicCats();

    let searchTerm = "";
    let genreName = "";
    if (extra) {
        const cleanExtra = extra.replace('.json', '');
        const searchMatch = cleanExtra.match(/search=([^&]+)/);
        const genreMatch = cleanExtra.match(/genre=([^&]+)/);
        
        if (searchMatch) searchTerm = decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));
        else if (genreMatch) genreName = decodeURIComponent(genreMatch[1].replace(/\+/g, ' '));
        else if (!cleanExtra.includes('=')) searchTerm = decodeURIComponent(cleanExtra.replace(/\+/g, ' '));
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const cachedList = type === 'movie' ? CAT_CACHE.movie : CAT_CACHE.series;
    const allowedIds = cachedList.map(c => c.id);

    try {
        let apiUrl = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
        
        // 1. إذا كان طلباً للبحث، نتجاهل أي تصنيف افتراضي
        if (searchTerm) {
            apiUrl += `&search=${encodeURIComponent(searchTerm)}`;
        } 
        // 2. إذا كان اختيار تصنيف معين
        else if (genreName) {
            const target = cachedList.find(c => c.name === genreName);
            if (target) apiUrl += `&category_id=${target.id}`;
        } 
        // 3. الافتراضي عند فتح Discover (أول قسم عربي)
        else {
            if (allowedIds.length > 0) apiUrl += `&category_id=${allowedIds[0]}`;
        }

        const resp = await axios.get(apiUrl, { timeout: 10000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        // 4. الفلترة الصارمة (لضمان بقاء المحتوى عربياً فقط)
        if (allowedIds.length > 0) {
            items = items.filter(i => allowedIds.includes(String(i.category_id)));
        }

        const metas = items.slice(0, 100).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id || i.stream_id}` : `xtream:movie:${i.stream_id}:${i.container_extension || 'mp4'}`,
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
            const { data } = await axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_info&series_id=${p[2]}`, { timeout: 9000 });
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

if (process.env.VERCEL) module.exports = app;
else app.listen(7000);
