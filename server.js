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

let CACHED_CATS = {
    movie: [],
    series: [],
    lastUpdated: 0
};

async function updateCategories() {
    const now = Date.now();
    if (now - CACHED_CATS.lastUpdated < 3600000 && CACHED_CATS.movie.length > 0) return;

    try {
        const [vodRes, serRes] = await Promise.all([
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_categories`, { timeout: 5000 }).catch(e => ({ data: [] }))
        ]);

        if (Array.isArray(vodRes.data)) {
            CACHED_CATS.movie = vodRes.data
                .filter(c => c.category_name.trim().toUpperCase().startsWith(FILTER_PREFIX))
                .map(c => c.category_id);
        }

        if (Array.isArray(serRes.data)) {
            CACHED_CATS.series = serRes.data
                .filter(c => c.category_name.trim().toUpperCase().startsWith(FILTER_PREFIX))
                .map(c => c.category_id);
        }

        CACHED_CATS.lastUpdated = now;
    } catch (e) { console.error("Cache Update Failed"); }
}

function sortItems(items) {
    if (!Array.isArray(items)) return [];
    return items.sort((a, b) => {
        const idA = Number(a.stream_id || a.series_id || 0);
        const idB = Number(b.stream_id || b.series_id || 0);
        return idB - idA; 
    });
}

app.get('/', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
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
            .btn { display: block; width: 100%; padding: 16px; margin: 10px 0; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px; transition: 0.2s; box-sizing: border-box; border: none; cursor: pointer; }
            .btn-install { background: #6a0dad; color: white; }
            .btn-install:hover { background: #7b1fa2; transform: scale(1.02); }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Arabic Content - By Hussain</h1>
            <p>Arabic Movies and Series</p>
            <a href="${stremioUrl}" class="btn btn-install">🚀 Install Addon</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/manifest.json', async (req, res) => {
    await updateCategories();

    const manifest = {
        id: "org.arabic.iptv.hussain.fast",
        version: "4.1.0",
        name: "Arabic Content - By Hussain",
        description: "Arabic Movies and Series",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            { 
                type: "movie", 
                id: "iptv-arabic-movies", 
                name: "Arabic Movies", 
                extra: [{ name: "search" }, { name: "skip" }] 
            },
            { 
                type: "series", 
                id: "iptv-arabic-series", 
                name: "Arabic Series", 
                extra: [{ name: "search" }, { name: "skip" }] 
            }
        ],
        idPrefixes: ["xtream:"]
    };

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
});

app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    const { type, extra } = req.params;
    let extraObj = {};
    
    if (extra) {
        try {
            const params = new URLSearchParams(extra);
            extraObj.search = params.get('search');
            extraObj.skip = parseInt(params.get('skip')) || 0;
        } catch(e) { extraObj.search = extra; }
    }

    await updateCategories();

    let action = '';
    let allowedIds = type === 'movie' ? CACHED_CATS.movie : CACHED_CATS.series;

    if (type === 'movie') { action = 'get_vod_streams'; }
    else if (type === 'series') { action = 'get_series'; }
    else { return res.json({ metas: [] }); }

    try {
        let metas = [];

        if (extraObj.search) {
            const searchUrl = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${action}&search=${encodeURIComponent(extraObj.search)}`;
            const resp = await axios.get(searchUrl, { timeout: 8000 });
            
            if (Array.isArray(resp.data)) {
                metas = resp.data.filter(item => allowedIds.includes(item.category_id));
            }
        } 
        else {
            const apiUrl = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${action}`;
            const resp = await axios.get(apiUrl, { timeout: 10000 });
            if (Array.isArray(resp.data)) {
                metas = resp.data.filter(item => allowedIds.includes(item.category_id));
            }
        }

        metas = sortItems(metas);

        const skip = extraObj.skip || 0;
        const limit = 100;
        const finalMetas = metas.slice(skip, skip + limit).map(item => ({
            id: type === 'series' ? `xtream:series:${item.series_id}` 
                : `xtream:movie:${item.stream_id}:${item.container_extension}`,
            type: type,
            name: item.name,
            poster: item.stream_icon || item.cover,
            posterShape: 'poster',
            description: item.rating ? `Rating: ${item.rating}` : ''
        }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'max-age=300'); 
        res.json({ metas: finalMetas });

    } catch (e) {
        console.error("Catalog Error:", e.message);
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    
    if (type === 'series' && id.startsWith('xtream:series:')) {
        const seriesId = id.split(':')[2];
        try {
            const url = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_info&series_id=${seriesId}`;
            const { data } = await axios.get(url, { timeout: 8000 });
            
            const videos = [];
            if (data.episodes) {
                Object.values(data.episodes).forEach(season => {
                    season.forEach(ep => {
                        videos.push({
                            id: `xtream:episode:${ep.id}:${ep.container_extension}`,
                            title: ep.title || `Episode ${ep.episode_num}`,
                            season: parseInt(ep.season),
                            episode: parseInt(ep.episode_num),
                            released: new Date().toISOString()
                        });
                    });
                });
            }
            videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.json({ meta: {
                id: id,
                type: 'series',
                name: data.info.name,
                poster: data.info.cover,
                description: data.info.plot,
                background: data.info.backdrop_path ? (data.info.backdrop_path.length > 0 ? data.info.backdrop_path[0] : null) : null,
                videos: videos
            }});

        } catch (e) { }
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ meta: { id, type, name: "Watch Stream" } });
});

app.get('/stream/:type/:id.json', (req, res) => {
    const parts = req.params.id.split(':');
    let streamUrl = "";

    if (parts[1] === 'movie') {
        streamUrl = `${IPTV_CONFIG.host}/movie/${IPTV_CONFIG.user}/${IPTV_CONFIG.pass}/${parts[2]}.${parts[3]}`;
    } else if (parts[1] === 'episode') {
        streamUrl = `${IPTV_CONFIG.host}/series/${IPTV_CONFIG.user}/${IPTV_CONFIG.pass}/${parts[2]}.${parts[3]}`;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "⚡ Watch Now", url: streamUrl }] });
});

const port = process.env.PORT || 7000;
app.listen(port, () => console.log(`Server running on port ${port}`));
