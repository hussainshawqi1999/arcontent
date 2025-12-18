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

app.get('/manifest.json', async (req, res) => {
    await syncArabicCats();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({
        id: "org.arabic.hussain.debug.v24",
        version: "24.0.0",
        name: "Arabic Content - By Hussain",
        description: "Filtered Arabic IPTV (Error Reporting Enabled)",
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
        const searchMatch = extra.match(/search=([^&]+)/);
        const genreMatch = extra.match(/genre=([^&]+)/);
        searchTerm = searchMatch ? decodeURIComponent(searchMatch[1]).replace('.json', '') : "";
        genreName = genreMatch ? decodeURIComponent(genreMatch[1]).replace('.json', '') : "";
    }

    const action = type === 'movie' ? 'get_vod_streams' : 'get_series';
    const cachedList = type === 'movie' ? CAT_CACHE.movie : CAT_CACHE.series;
    const allowedIds = cachedList.map(c => c.id);

    try {
        let apiUrl = `${IPTV.host}/player_api.php?username=${IPTV.user}&password=${IPTV.pass}&action=${action}`;
        if (searchTerm) apiUrl += `&search=${encodeURIComponent(searchTerm)}`;
        else if (genreName) {
            const target = cachedList.find(c => c.name === genreName);
            if (target) apiUrl += `&category_id=${target.id}`;
        } else if (allowedIds.length > 0) apiUrl += `&category_id=${allowedIds[0]}`;

        // محاولة جلب البيانات بمهلة 8 ثوانٍ (لتجنب انهيار Vercel)
        const resp = await axios.get(apiUrl, { timeout: 8000 });
        let items = Array.isArray(resp.data) ? resp.data : [];

        if (allowedIds.length > 0 && !searchTerm) {
            items = items.filter(i => allowedIds.includes(String(i.category_id)));
        }

        // إذا كانت النتائج صفر، نعرض رسالة للمستخدم
        if (items.length === 0) {
            return res.json({ metas: [{ id: "error", name: "❌ No results found", type: type, posterShape: "poster" }] });
        }

        const metas = items.slice(0, 100).map(i => ({
            id: type === 'series' ? `xtream:series:${i.series_id}` : `xtream:movie:${i.stream_id}:${i.container_extension}`,
            type: type, name: i.name, poster: i.stream_icon || i.cover, posterShape: 'poster'
        }));

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ metas });

    } catch (e) {
        // في حال حدوث خطأ (مثل Timeout أو خطأ سيرفر)، نعرض رسالة واضحة
        let errorMsg = "❌ Connection Error";
        if (e.code === 'ECONNABORTED') errorMsg = "❌ Search Timeout (Server Busy)";
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ 
            metas: [{ 
                id: "error", 
                name: errorMsg, 
                description: "Try a more specific search term", 
                type: type, 
                posterShape: "poster" 
            }] 
        });
    }
});

// باقي المسارات (Meta & Stream) تبقى كما هي في v23
app.get('/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if (id === "error") return res.json({ meta: { id, name: "Error", type, description: "Please try again." } });
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

app.get('/', (req, res) => res.send("<h1>Arabic IPTV v24 - Debug Mode Active</h1>"));
if (process.env.VERCEL) module.exports = app;
else app.listen(7000);
