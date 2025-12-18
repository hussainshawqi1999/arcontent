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

let DB = {
    movies: [],
    series: [],
    lastUpdated: 0,
    isUpdating: false
};

async function refreshDatabase() {
    const now = Date.now();
    if (now - DB.lastUpdated < 3600000 || DB.isUpdating) {
        if (DB.movies.length > 0) return; 
    }

    console.log("🔄 Starting Database Update...");
    DB.isUpdating = true;

    try {
        const [vodCats, serCats] = await Promise.all([
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_vod_categories`, { timeout: 10000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series_categories`, { timeout: 10000 }).catch(e => ({ data: [] }))
        ]);

        const arVodCatIds = Array.isArray(vodCats.data) 
            ? vodCats.data.filter(c => c.category_name.toUpperCase().startsWith(FILTER_PREFIX)).map(c => c.category_id)
            : [];
        
        const arSerCatIds = Array.isArray(serCats.data) 
            ? serCats.data.filter(c => c.category_name.toUpperCase().startsWith(FILTER_PREFIX)).map(c => c.category_id)
            : [];

        console.log(`✅ Found ${arVodCatIds.length} Movie Categories and ${arSerCatIds.length} Series Categories matching ${FILTER_PREFIX}`);

        const [allMovies, allSeries] = await Promise.all([
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_vod_streams`, { timeout: 20000 }).catch(e => ({ data: [] })),
            axios.get(`${IPTV_CONFIG.host}/player_api.php?username=${IPTV_CONFIG.user}&password=${IPTV_CONFIG.pass}&action=get_series`, { timeout: 20000 }).catch(e => ({ data: [] }))
        ]);

        if (Array.isArray(allMovies.data)) {
            DB.movies = allMovies.data.filter(m => arVodCatIds.includes(m.category_id));
        }
        
        if (Array.isArray(allSeries.data)) {
            DB.series = allSeries.data.filter(s => arSerCatIds.includes(s.category_id));
        }

        DB.lastUpdated = Date.now();
        console.log(`🏁 Database Updated: ${DB.movies.length} Arabic Movies, ${DB.series.length} Arabic Series`);

    } catch (e) {
        console.error("❌ Database Update Failed:", e.message);
    } finally {
        DB.isUpdating = false;
    }
}

function sortItems(items) {
    return items.sort((a, b) => {
        const idA = Number(a.stream_id || a.series_id || 0);
        const idB = Number(b.stream_id || b.series_id || 0);
        return idB - idA; 
    });
}

refreshDatabase();

app.get('/', (req, res) => {
    const protocol = req.protocol;
    const host = req.get('host');
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = manifestUrl.replace(/^https?/, 'stremio');

    res.send(`
    <div style="background:#111;color:#fff;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:sans-serif;">
        <h1 style="color:#a37dfc">Arabic Content - By Hussain</h1>
        <p>Status: ${DB.movies.length ? '✅ Ready (' + DB.movies.length + ' Movies)' : '⏳ Loading data...'}</p>
        <a href="${stremioUrl}" style="padding:15px 30px;background:#6a0dad;color:#fff;text-decoration:none;border-radius:5px;font-weight:bold;">🚀 Install Addon</a>
    </div>
    `);
});

app.get('/manifest.json', (req, res) => {
    if (DB.movies.length === 0) refreshDatabase();

    const manifest = {
        id: "org.arabic.iptv.hussain.turbo",
        version: "7.0.0",
        name: "Arabic Content - By Hussain",
        description: "Arabic Movies and Series (Turbo Speed)",
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
    
    if (DB.movies.length === 0 && !DB.isUpdating) await refreshDatabase();

    let extraObj = {};
    if (extra) {
        try {
            const params = new URLSearchParams(extra);
            extraObj.search = params.get('search');
            extraObj.skip = parseInt(params.get('skip')) || 0;
        } catch(e) { extraObj.search = extra; }
    }

    let items = type === 'movie' ? DB.movies : DB.series;

    if (extraObj.search) {
        const term = extraObj.search.toLowerCase();
        items = items.filter(item => item.name && item.name.toLowerCase().includes(term));
    }

    items = sortItems([...items]);
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
                            title: ep.title || `Episode ${ep.episode_num}`,
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
                background: data.info.backdrop_path ? (data.info.backdrop_path.length > 0 ? data.info.backdrop_path[0] : null) : null,
                videos: videos
            }});

        } catch (e) { return res.json({ meta: { id, type, name: "Error Info" } }); }
    }
    
    res.json({ meta: { id, type, name: "Watch Stream" } });
});

app.get('/stream/:type/:id.json', (req, res) => {
    const parts = req.params.id.split(':');
    let streamUrl = "";
    if (parts[1] === 'movie') streamUrl = `${IPTV_CONFIG.host}/movie/${IPTV_CONFIG.user}/${IPTV_CONFIG.pass}/${parts[2]}.${parts[3]}`;
    else if (parts[1] === 'episode') streamUrl = `${IPTV_CONFIG.host}/series/${IPTV_CONFIG.user}/${IPTV_CONFIG.pass}/${parts[2]}.${parts[3]}`;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "⚡ Watch Now", url: streamUrl }] });
});

const port = process.env.PORT || 7000;
app.listen(port, () => console.log(`Server running on port ${port}`));
