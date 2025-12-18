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

let ALLOWED_CATS = {
    movie: [],
    series: [],
    lastUpdated: 0
};

async function updateAllowedCats() {
    const now = Date.now();
    if (now - ALLOWED_CATS.lastUpdated < 3600000 && ALLOWED_CATS.movie.length > 0) return;

    try {
        const [vodRes, serRes] = await Promise.all([
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_categories`, { timeout: 5000 }).catch(e => ({ data: [] }))
        ]);

        if (Array.isArray(vodRes.data)) {
            ALLOWED_CATS.movie = vodRes.data
                .filter(c => c.category_name.toUpperCase().includes(FILTER_PREFIX) || c.category_name.toUpperCase().includes("ARABIC"))
                .map(c => c.category_id);
        }
        
        if (Array.isArray(serRes.data)) {
            ALLOWED_CATS.series = serRes.data
                .filter(c => c.category_name.toUpperCase().includes(FILTER_PREFIX) || c.category_name.toUpperCase().includes("ARABIC"))
                .map(c => c.category_id);
        }
        ALLOWED_CATS.lastUpdated = now;
    } catch (e) { }
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
        <title>Arabic Content</title>
        <style>
            body { background-color: #0b0b0b; color: white; font-family: sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { background: #1a1a1a; padding: 40px; border-radius: 12px; text-align: center; border: 1px solid #333; max-width: 400px; width: 90%; }
            h1 { margin-bottom: 10px; color: #a37dfc; }
            .btn { display: block; width: 100%; padding: 16px; margin: 10px 0; border-radius: 8px; text-decoration: none; font-weight: bold; background: #6a0dad; color: white; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Arabic Content - By Hussain</h1>
            <p>Flexible Search & Filter</p>
            <a href="${stremioUrl}" class="btn">🚀 Install Addon</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/manifest.json', async (req, res) => {
    updateAllowedCats().catch(e => {});

    const manifest = {
        id: "org.arabic.iptv.hussain.flex",
        version: "7.2.0",
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
    
    await updateAllowedCats();

    let extraObj = {};
    if (extra) {
        try {
            const params = new URLSearchParams(extra);
            extraObj.search = params.get('search');
            extraObj.skip = parseInt(params.get('skip')) || 0;
        } catch(e) { extraObj.search = extra; }
    }

    let action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    let allowedIds = type === 'movie' ? ALLOWED_CATS.movie : ALLOWED_CATS.series;

    try {
        let apiUrl = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${action}`;
        
        if (extraObj.search) {
            apiUrl += `&search=${encodeURIComponent(extraObj.search)}`;
        } else {
            if (allowedIds.length > 0) {
                apiUrl += `&category_id=${allowedIds[0]}`; 
            }
        }

        const resp = await axios.get(apiUrl, { timeout: 10000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (allowedIds.length > 0) {
            const originalItems = [...items];
            
            const filteredItems = items.filter(item => {
                if (!item.category_id) return true;
                return allowedIds.includes(item.category_id);
            });

            if (extraObj.search && filteredItems.length === 0 && originalItems.length > 0) {
                items = originalItems; 
            } else {
                items = filteredItems;
            }
        }

        items = sortItems(items);
        const skip = extraObj.skip || 0;
        const limit = 100;
        const pagedItems = items.slice(skip, skip + limit);

        const metas = pagedItems.map(item => ({
            id: type === 'series' ? `xtream:series:${item.series_id}` 
                : `xtream:movie:${item.stream_id}:${item.container_extension}`,
            type: type,
            name: item.name,
            poster: item.stream_icon || item.cover,
            posterShape: 'poster',
            description: item.rating ? `Rating: ${item.rating}` : ''
        }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'max-age=60'); 
        res.json({ metas });

    } catch (e) {
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const parts = id.split(':');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (type === 'series' && id.startsWith('xtream:series:')) {
        const seriesId = parts[2];
        try {
            const url = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_info&series_id=${seriesId}`;
            const { data } = await axios.get(url, { timeout: 8000 });
            
            const videos = [];
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

            return res.json({ meta: {
                id: id,
                type: 'series',
                name: data.info.name,
                poster: data.info.cover,
                description: data.info.plot,
                videos: videos
            }});
        } catch (e) { return res.json({ meta: { id, type, name: "Error Info" } }); }
    }
    
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

app.get('/catalog/:type/:id.json', (req, res) => res.redirect(`/catalog/${req.params.type}/${req.params.id}/skip=0.json`));

const port = process.env.PORT || 7000;
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(port, () => console.log(`Server running on port ${port}`));
}
