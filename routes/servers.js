const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Cfx.re endpoints
const STREAM_URL = 'https://frontend.cfx-services.net/api/servers/streamRedir/';
const SINGLE_URL = 'https://frontend.cfx-services.net/api/servers/single/';
const PINS_URL = 'https://runtime.fivem.net/pins.json';

// ====== IN-MEMORY CACHE (fast!) ======
let ALL_SERVERS = [];
let lastRefresh = 0;
let isRefreshing = false;
const REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes

// ====== Fast Protobuf Decoder ======
function readVarint(buf, off) {
    let v = 0, s = 0;
    while (off < buf.length) {
        const b = buf[off++];
        v |= (b & 0x7F) << s;
        if (!(b & 0x80)) break;
        s += 7;
    }
    return [v, off];
}

function parseServerList(buf) {
    const servers = [];
    let off = 0;

    while (off < buf.length - 4) {
        try {
            const len = buf.readUInt32LE(off);
            off += 4;
            if (len < 2 || len > 200000 || off + len > buf.length) break;

            const end = off + len;
            const server = parseServer(buf, off, end);
            off = end;

            if (server && server.id) {
                servers.push(server);
            }
        } catch {
            off++;
        }
    }
    return servers;
}

function parseServer(buf, start, end) {
    let off = start;
    let id = '', hostname = '', clients = 0, maxClients = 0;
    let gametype = '', mapname = '', server = '', iconVersion = 0;
    let vars = {}, tags = [], locale = 'en', localeCountry = 'us';

    while (off < end) {
        try {
            const [tag, tagOff] = readVarint(buf, off);
            const fn = tag >> 3;
            const wt = tag & 7;

            if (wt === 2) {
                const [len, dataOff] = readVarint(buf, tagOff);
                const dataEnd = dataOff + len;
                if (dataEnd > end) break;
                off = dataEnd;

                if (fn === 1) {
                    id = buf.toString('utf8', dataOff, dataEnd);
                } else if (fn === 2) {
                    // Nested Data message
                    const d = parseDataMessage(buf, dataOff, dataEnd);
                    hostname = d.hostname;
                    clients = d.clients;
                    maxClients = d.maxClients;
                    gametype = d.gametype;
                    mapname = d.mapname;
                    server = d.server;
                    iconVersion = d.iconVersion;
                    vars = d.vars;
                    tags = d.tags;
                    locale = d.locale;
                    localeCountry = d.localeCountry;
                }
            } else if (wt === 0) {
                const [, skip] = readVarint(buf, tagOff);
                off = skip;
            } else if (wt === 1) {
                off = tagOff + 8;
            } else if (wt === 5) {
                off = tagOff + 4;
            } else {
                break;
            }
        } catch {
            break;
        }
    }

    return {
        id, hostname, clients, maxClients, gametype, mapname, server,
        iconVersion, vars, tags, locale, localeCountry
    };
}

function parseDataMessage(buf, start, end) {
    let off = start;
    let hostname = '', clients = 0, maxClients = 0, svMaxClients = 0;
    let gametype = '', mapname = '', server = '', iconVersion = 0;
    let vars = {}, tags = [], locale = 'en', localeCountry = 'us';

    while (off < end) {
        try {
            const [tag, tagOff] = readVarint(buf, off);
            const fn = tag >> 3;
            const wt = tag & 7;

            if (wt === 2) {
                const [len, dataOff] = readVarint(buf, tagOff);
                const dataEnd = dataOff + len;
                if (dataEnd > end) break;
                off = dataEnd;

                const str = buf.toString('utf8', dataOff, dataEnd);

                if (fn === 1) hostname = str;
                else if (fn === 5) server = str;
                else if (fn === 8) vars = parseVars(buf, dataOff, dataEnd);
                else if (fn === 9) tags = parseTags(buf, dataOff, dataEnd);
            } else if (wt === 0) {
                const [val, skip] = readVarint(buf, tagOff);
                off = skip;
                if (fn === 2) clients = val;
                else if (fn === 3) maxClients = val;
                else if (fn === 4) svMaxClients = val;
                else if (fn === 10) iconVersion = val;
            } else if (wt === 1) { off = tagOff + 8; }
            else if (wt === 5) { off = tagOff + 4; }
            else { break; }
        } catch { break; }
    }

    return { hostname, clients, maxClients: maxClients || svMaxClients, gametype, mapname, server, iconVersion, vars, tags, locale, localeCountry };
}

function parseVars(buf, start, end) {
    let off = start;
    const vars = {};
    while (off < end) {
        try {
            const [tag, tagOff] = readVarint(buf, off);
            const fn = tag >> 3;
            const wt = tag & 7;
            if (wt === 2) {
                const [len, dataOff] = readVarint(buf, tagOff);
                const dataEnd = dataOff + len;
                if (dataEnd > end) break;
                off = dataEnd;
                vars[fn] = buf.toString('utf8', dataOff, dataEnd);
            } else if (wt === 0) {
                const [, skip] = readVarint(buf, tagOff);
                off = skip;
            } else if (wt === 1) { off = tagOff + 8; }
            else if (wt === 5) { off = tagOff + 4; }
            else { break; }
        } catch { break; }
    }
    return vars;
}

function parseTags(buf, start, end) {
    let off = start;
    const tags = [];
    while (off < end) {
        try {
            const [tag, tagOff] = readVarint(buf, off);
            const wt = tag & 7;
            if (wt === 2) {
                const [len, dataOff] = readVarint(buf, tagOff);
                const dataEnd = dataOff + len;
                if (dataEnd > end) break;
                off = dataEnd;
                tags.push(buf.toString('utf8', dataOff, dataEnd));
            } else if (wt === 0) {
                const [, skip] = readVarint(buf, tagOff);
                off = skip;
            } else if (wt === 1) { off = tagOff + 8; }
            else if (wt === 5) { off = tagOff + 4; }
            else { break; }
        } catch { break; }
    }
    return tags;
}

// ====== Normalize ======
function normalize(srv) {
    const vars = srv.vars || {};
    const gamename = vars.gamename || 'gta5';
    const isRedm = gamename === 'rdr3' || gamename === 'redm';

    return {
        id: srv.id,
        hostName: srv.hostname,
        projectName: srv.hostname,
        projectDescription: vars.sv_projectDescription || '',
        gametype: srv.gametype,
        mapname: srv.mapname,
        players: { count: srv.clients, maxCount: srv.maxClients },
        locale: vars.locale || srv.locale || 'en',
        localeCountry: srv.localeCountry || 'us',
        tags: { list: srv.tags },
        iconVersion: srv.iconVersion,
        joinUrl: `https://cfx.re/join/${srv.id}`,
        isOneSync: vars.onesync_enabled === 'true',
        peakPlayers: parseInt(vars.peak_players || '0'),
        serverSoftware: srv.server,
        isRedm, isFiveM: !isRedm,
        licenseType: vars.premium || null,
        vars
    };
}

// ====== Background Refresher ======
async function refreshServers() {
    if (isRefreshing) return;
    isRefreshing = true;

    try {
        console.log('[REFRESH] Fetching from Cfx.re streamRedir...');
        const t0 = Date.now();

        const res = await fetch(STREAM_URL, {
            headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' },
            timeout: 90000
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const buf = await res.buffer();
        console.log(`[REFRESH] Downloaded ${buf.length} bytes in ${Date.now() - t0}ms`);

        const t1 = Date.now();
        const raw = parseServerList(buf);
        console.log(`[REFRESH] Decoded ${raw.length} servers in ${Date.now() - t1}ms`);

        // Normalize and split by platform
        const gta5 = [], redm = [];
        for (const srv of raw) {
            const n = normalize(srv);
            if (n.isRedm) redm.push(n); else gta5.push(n);
        }

        ALL_SERVERS = raw;
        serversCache.gta5 = gta5;
        serversCache.redm = redm;
        lastFetch.gta5 = Date.now();
        lastFetch.redm = Date.now();
        lastRefresh = Date.now();

        console.log(`[REFRESH] Done! ${gta5.length} FiveM + ${redm.length} RedM servers`);
    } catch (e) {
        console.error('[REFRESH] Error:', e.message);
    } finally {
        isRefreshing = false;
    }
}

// ====== Cache ======
let serversCache = { gta5: null, redm: null };
let lastFetch = { gta5: 0, redm: 0 };
const CACHE_TTL = 180 * 1000;

async function getServers(platform) {
    // Return cache if valid
    if (serversCache[platform] && (Date.now() - lastFetch[platform]) < CACHE_TTL) {
        return serversCache[platform];
    }

    // If not refreshing, start refresh
    if (!isRefreshing) {
        refreshServers(); // background, don't await
    }

    // If we have old cache, return it while refreshing
    if (serversCache[platform]) {
        return serversCache[platform];
    }

    // First time: wait for refresh
    let attempts = 0;
    while (isRefreshing && attempts < 60) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }

    return serversCache[platform] || [];
}

// ====== Routes ======

router.get('/', async (req, res) => {
    try {
        const { platform = 'gta5' } = req.query;
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform' });
        }
        const servers = await getServers(platform);
        res.json({
            success: true, platform, count: servers.length, data: servers,
            source: 'Cfx.re Official API', timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:platform', async (req, res) => {
    try {
        const { platform } = req.params;
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform' });
        }
        const servers = await getServers(platform);
        res.json({
            success: true, platform, count: servers.length, data: servers,
            source: 'Cfx.re Official API', timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/stats/summary', async (req, res) => {
    try {
        const gta5 = serversCache.gta5 || [];
        const redm = serversCache.redm || [];
        res.json({
            success: true,
            stats: {
                gta5: { servers: gta5.length, playersOnline: gta5.reduce((s, x) => s + x.players.count, 0) },
                redm: { servers: redm.length, playersOnline: redm.reduce((s, x) => s + x.players.count, 0) }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ====== Start background refresh on load ======
setTimeout(() => refreshServers(), 2000);

module.exports = router;
