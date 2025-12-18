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
        <title>Arabic Content - By Hussain</title>
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
            <p>Ready to install</p>
            <a href="${stremioUrl}" class="btn">🚀 Install Addon</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/manifest.json', async (req, res) => {
    let movieGenres = [];
    let seriesGenres = [];

    try {
        const [vodRes, serRes] = await Promise.all([
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_vod_categories`, { timeout: 5000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_categories`, { timeout: 5000 }).catch(e => ({ data: [] }))
        ]);

        if (Array.isArray(vodRes.data)) {
            movieGenres = vodRes.data
                .filter(c => c.category_name.toUpperCase().includes("AR") || c.category_name.includes(FILTER_PREFIX))
                .map(c => c.category_name);
        }

        if (Array.isArray(serRes.data)) {
            seriesGenres = serRes.data
                .filter(c => c.category_name.toUpperCase().includes("AR") || c.category_name.includes(FILTER_PREFIX))
                .map(c => c.category_name);
        }

    } catch (e) { }

    const manifest = {
        id: "org.arabic.iptv.hussain.final",
        version: "6.0.0",
        name: "Arabic Content - By Hussain",
        description: "Arabic Movies and Series",
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series"],
        catalogs: [
            {
                type: "movie",
                id: "iptv-arabic-movies",
                name: "Arabic Movies",
                extra: [{ name: "genre", options: movieGenres }, { name: "search" }, { name: "skip" }]
            },
            {
                type: "series",
                id: "iptv-arabic-series",
                name: "Arabic Series",
                extra: [{ name: "genre", options: seriesGenres }, { name: "search" }, { name: "skip" }]
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
            extraObj.genre = params.get('genre');
            extraObj.search = params.get('search');
            extraObj.skip = parseInt(params.get('skip')) || 0;
        } catch(e) { extraObj.search = extra; }
    }

    let action = '';
    let catAction = '';

    if (type === 'movie') { action = 'get_vod_streams'; catAction = 'get_vod_categories'; }
    else if (type === 'series') { action = 'get_series'; catAction = 'get_series_categories'; }
    else { return res.json({ metas: [] }); }

    try {
        const catRes = await axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${catAction}`, { timeout: 6000 });
        let allowedCats = [];

        if (Array.isArray(catRes.data)) {
            allowedCats = catRes.data.filter(c => c.category_name.toUpperCase().includes("AR") || c.category_name.includes(FILTER_PREFIX));
        }

        let apiUrl = `${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=${action}`;
        let targetCategoryId = null;

        if (extraObj.search) {
            apiUrl += `&search=${encodeURIComponent(extraObj.search)}`;
        }
        else if (extraObj.genre) {
            const selectedCat = allowedCats.find(c => c.category_name === extraObj.genre);
            if (selectedCat) targetCategoryId = selectedCat.category_id;
        }
        else {
            if (allowedCats.length > 0) {
                targetCategoryId = allowedCats[0].category_id;
            }
        }

        if (targetCategoryId) {
            apiUrl += `&category_id=${targetCategoryId}`;
        } else if (!extraObj.search) {
            return res.json({ metas: [] });
        }

        const resp = await axios.get(apiUrl, { timeout: 10000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (extraObj.search && allowedCats.length > 0) {
            const allowedIds = allowedCats.map(c => c.category_id);
            items = items.filter(item => allowedIds.includes(item.category_id));
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

    if (type === 'series') {
        try {
            const seriesId = parts[2];
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
app.listen(port, () => console.log(`Server running on port ${port}`));
