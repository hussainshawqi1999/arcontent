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

let CACHED_AR_IDS = { movie: [], series: [], lastUpdated: 0 };

async function getArabicIds() {
    const now = Date.now();
    if (now - CACHED_AR_IDS.lastUpdated < 3600000 && CACHED_AR_IDS.movie.length > 0) return;
    try {
        const [v, s] = await Promise.all([
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_vod_categories`, { timeout: 4000 }).catch(() => ({ data: [] })),
            axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_categories`, { timeout: 4000 }).catch(() => ({ data: [] }))
        ]);
        CACHED_AR_IDS.movie = v.data.filter(c => c.category_name.includes(AR_PREFIX)).map(c => String(c.category_id));
        CACHED_AR_IDS.series = s.data.filter(c => c.category_name.includes(AR_PREFIX)).map(c => String(c.category_id));
        CACHED_AR_IDS.lastUpdated = now;
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
            .container { background: #1a1a1a; padding: 40px; border-radius: 12px; text-align: center; border: 1px solid #333; box-shadow: 0 10px 40px rgba(0,0,0,0.6); max-width: 400px; width: 90%; }
            h1 { margin-bottom: 10px; color: #a37dfc; }
            p { color: #888; margin-bottom: 30px; }
            .btn { display: block; width: 100%; padding: 16px; margin: 10px 0; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px; transition: 0.2s; background: #6a0dad; color: white; border: none; cursor: pointer; }
            .btn:hover { background: #7b1fa2; transform: scale(1.02); }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Arabic Content</h1>
            <p>Filtered IPTV by Hussain</p>
            <a href="${stremioUrl}" class="btn">🚀 Install Addon</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/manifest.json', async (req, res) => {
    await getArabicIds();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.arabic.hussain.v22",
        version: "22.0.0",
        name: "Arabic Content - By Hussain",
        description: "IPTV Arabic Only - Search Fixed",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { type: "movie", id: "ar-movies", name: "Arabic Movies", extra: [{ name: "search" }, { name: "skip" }] },
            { type: "series", id: "ar-series", name: "Arabic Series", extra: [{ name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:"]
    });
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    await getArabicIds();

    let searchTerm = "";
    if (extra) {
        const match = extra.match(/search=([^&]+)/);
        searchTerm = match ? decodeURIComponent(match[1]).replace('.json', '') : "";
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const allowedIds = type === 'movie' ? CACHED_AR_IDS.movie : CACHED_AR_IDS.series;

    try {
        let apiUrl = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
        
        if (searchTerm) {
            apiUrl += `&search=${encodeURIComponent(searchTerm)}`;
        } else {
            if (allowedIds.length > 0) apiUrl += `&category_id=${allowedIds[0]}`;
        }

        const resp = await axios.get(apiUrl, { timeout: 9000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (allowedIds.length > 0) {
            items = items.filter(i => allowedIds.includes(String(i.category_id)));
        }

        const metas = items.slice(0, 80).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id}` : `xtream:movie:${i.stream_id}:${i.container_extension}`,
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
            const { data } = await axios.get(`${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=get_series_info&series_id=${p[2]}`, { timeout: 9000 });
            let videos = [];
            if (data.episodes) {
                Object.values(data.episodes).forEach(s => {
                    s.forEach(e => {
                        videos.push({ id: `xtream:ep:${e.id}:${e.container_extension}`, title: e.title || `Ep ${e.episode_num}`, season: parseInt(e.season), episode: parseInt(e.episode_num) });
                    });
                });
            }
            return res.json({ meta: { id, type: 'series', name: data.info.name, poster: data.info.cover, videos } });
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

if (process.env.VERCEL) module.exports = app;
else app.listen(7000);
