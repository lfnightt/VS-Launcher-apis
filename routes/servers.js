const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Cfx.re API endpoints
const CFX_BASE = 'https://frontend.cfx-services.net/api/servers';
const STREAM_URL = `${CFX_BASE}/streamRedir/`;
const SINGLE_URL = `${CFX_BASE}/single/`;
const PINS_URL = 'https://runtime.fivem.net/pins.json';
const COUNTS_FIVEM = 'https://static.cfx.re/runtime/counts.json';
const COUNTS_REDM = 'https://static.cfx.re/runtime/counts_rdr3.json';

// Cache
let serversCache = { gta5: null, redm: null };
let lastFetch = { gta5: 0, redm: 0 };
const CACHE_TTL = 120 * 1000;

// ==================== Protobuf Decoder ====================

function readVarint(buf, offset) {
    let result = 0;
    let shift = 0;
    while (offset < buf.length) {
        const b = buf[offset++];
        result |= (b & 0x7F) << shift;
        if ((b & 0x80) === 0) return { value: result, offset };
        shift += 7;
    }
    return { value: result, offset };
}

function decodeField(buf, offset) {
    if (offset >= buf.length) return null;
    const { value: tag, offset: newOffset } = readVarint(buf, offset);
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    switch (wireType) {
        case 0: { // Varint
            const { value, offset: end } = readVarint(buf, newOffset);
            return { fieldNumber, wireType, value, offset: end };
        }
        case 1: { // 64-bit
            const value = buf.readBigUInt64LE(newOffset);
            return { fieldNumber, wireType, value, offset: newOffset + 8 };
        }
        case 2: { // Length-delimited
            const { value: len, offset: lenEnd } = readVarint(buf, newOffset);
            const data = buf.slice(lenEnd, lenEnd + len);
            return { fieldNumber, wireType, value: data, offset: lenEnd + len };
        }
        case 5: { // 32-bit
            const value = buf.readUInt32LE(newOffset);
            return { fieldNumber, wireType, value, offset: newOffset + 4 };
        }
        default:
            return { fieldNumber, wireType, value: null, offset: newOffset };
    }
}

function decodeMessage(buf) {
    const fields = {};
    let offset = 0;

    while (offset < buf.length) {
        const field = decodeField(buf, offset);
        if (!field) break;
        offset = field.offset;

        if (field.wireType === 2) {
            // Try to decode as string or nested message
            try {
                const str = field.value.toString('utf8');
                // Check if it looks like valid UTF-8 text (not binary)
                const isText = /^[\x20-\x7E\u00A0-\u024F\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF]*$/.test(str);
                if (isText && str.length > 0) {
                    fields[field.fieldNumber] = str;
                } else {
                    // Try nested message
                    try {
                        fields[field.fieldNumber] = decodeMessage(field.value);
                    } catch {
                        fields[field.fieldNumber] = str;
                    }
                }
            } catch {
                try {
                    fields[field.fieldNumber] = decodeMessage(field.value);
                } catch {
                    fields[field.fieldNumber] = field.value;
                }
            }
        } else {
            fields[field.fieldNumber] = field.value;
        }
    }

    return fields;
}

// ==================== Stream Parser ====================

function parseStreamData(buf) {
    const servers = [];
    let offset = 0;

    while (offset < buf.length - 4) {
        try {
            // Read 4-byte little-endian length
            const len = buf.readUInt32LE(offset);
            offset += 4;

            if (len === 0 || len > 500000 || offset + len > buf.length) {
                break;
            }

            const frame = buf.slice(offset, offset + len);
            offset += len;

            // Decode protobuf message
            const msg = decodeMessage(frame);

            // Extract server data
            const endPoint = msg[1] || '';
            const data = msg[2];

            if (endPoint && data && typeof data === 'object') {
                servers.push({
                    EndPoint: endPoint,
                    Data: {
                        hostname: data[1] || '',
                        clients: data[2] || 0,
                        sv_maxclients: data[3] || 0,
                        svMaxclients: data[4] || 0,
                        gametype: data[5] || '',
                        mapname: data[6] || '',
                        server: data[7] || '',
                        iconVersion: data[10] || 0,
                        vars: typeof data[8] === 'object' ? data[8] : {},
                        tags: typeof data[9] === 'object' ? (Array.isArray(data[9]) ? data[9] : Object.values(data[9])) : [],
                        locale: typeof data[8] === 'object' ? (data[8][16] || data[8].locale || 'en') : 'en',
                        localeCountry: typeof data[8] === 'object' ? (data[8][17] || data[8].localeCountry || 'us') : 'us'
                    }
                });
            }
        } catch (e) {
            offset++;
        }
    }

    return servers;
}

// ==================== Normalizer ====================

function normalizeServer(srv) {
    const d = srv.Data || srv;
    const ep = srv.EndPoint || '';
    const vars = d.vars || {};
    const gamename = vars.gamename || 'gta5';
    const isRedm = gamename === 'rdr3' || gamename === 'redm';

    return {
        id: ep,
        hostName: d.hostname || '',
        projectName: d.projectName || d.hostname || '',
        projectDescription: d.projectDescription || '',
        gametype: d.gametype || '',
        mapname: d.mapname || '',
        players: {
            count: d.clients || 0,
            maxCount: d.sv_maxclients || d.svMaxclients || 0
        },
        locale: d.locale || vars.locale || 'en',
        localeCountry: d.localeCountry || vars.localeCountry || 'us',
        boost: vars.boost || 0,
        tags: { list: d.tags || [] },
        iconVersion: d.iconVersion || 0,
        endpoint: ep,
        joinUrl: `https://cfx.re/join/${ep}`,
        isOneSync: vars.onesync_enabled === 'true',
        isPremium: vars.premium || null,
        peakPlayers: parseInt(vars.peak_players || '0'),
        serverSoftware: d.server || '',
        isRedm,
        isFiveM: !isRedm,
        vars,
        licenseType: vars.premium || null
    };
}

// ==================== Fetchers ====================

async function fetchFromStream() {
    console.log('Fetching from Cfx.re streamRedir...');

    const response = await fetch(STREAM_URL, {
        headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' },
        timeout: 60000
    });

    if (!response.ok) throw new Error(`Stream error: ${response.status}`);

    const buf = await response.buffer();
    console.log(`Got ${buf.length} bytes from stream`);

    const rawServers = parseStreamData(buf);
    console.log(`Decoded ${rawServers.length} servers from protobuf`);

    return rawServers;
}

async function fetchPinnedServers() {
    console.log('Fetching pinned servers...');

    const pinsRes = await fetch(PINS_URL, { timeout: 10000 });
    const pinsData = await pinsRes.json();
    const ids = pinsData.pinnedServers || [];

    console.log(`Got ${ids.length} pinned server IDs`);

    const servers = [];
    for (const id of ids) {
        try {
            const res = await fetch(`${SINGLE_URL}${id}`, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
                timeout: 8000
            });
            if (res.ok) {
                servers.push(await res.json());
            }
        } catch (e) {
            console.log(`Failed to fetch ${id}: ${e.message}`);
        }
    }

    console.log(`Fetched ${servers.length} pinned servers`);
    return servers;
}

async function getServers(platform) {
    const now = Date.now();

    if (serversCache[platform] && (now - lastFetch[platform]) < CACHE_TTL) {
        return serversCache[platform];
    }

    try {
        // Try stream first
        let rawServers;
        try {
            rawServers = await fetchFromStream();
        } catch (e) {
            console.log(`Stream failed: ${e.message}, falling back to pinned servers`);
            rawServers = await fetchPinnedServers();
        }

        // Filter and normalize
        const isRedm = platform === 'redm';
        const servers = [];

        for (const srv of rawServers) {
            const d = srv.Data || srv;
            const vars = d.vars || {};
            const gamename = vars.gamename || 'gta5';
            const srvIsRedm = gamename === 'rdr3' || gamename === 'redm';

            if (isRedm === srvIsRedm) {
                servers.push(normalizeServer(srv));
            }
        }

        console.log(`Final: ${servers.length} servers for ${platform}`);

        serversCache[platform] = servers;
        lastFetch[platform] = now;

        return servers;
    } catch (error) {
        console.error(`Error:`, error.message);
        if (serversCache[platform]) return serversCache[platform];
        throw error;
    }
}

// ==================== Routes ====================

router.get('/', async (req, res) => {
    try {
        const { platform = 'gta5' } = req.query;
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "gta5" or "redm"' });
        }

        const servers = await getServers(platform);

        res.json({
            success: true, platform, count: servers.length, data: servers,
            cached: (Date.now() - lastFetch[platform]) < CACHE_TTL,
            source: 'Cfx.re Official API', timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

router.get('/:platform', async (req, res) => {
    try {
        const { platform } = req.params;
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "gta5" or "redm"' });
        }

        const servers = await getServers(platform);

        res.json({
            success: true, platform, count: servers.length, data: servers,
            cached: (Date.now() - lastFetch[platform]) < CACHE_TTL,
            source: 'Cfx.re Official API', timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

router.get('/stats/summary', async (req, res) => {
    try {
        let counts = { fivem: 0, redm: 0 };
        try {
            const [fRes, rRes] = await Promise.all([
                fetch(COUNTS_FIVEM, { timeout: 5000 }),
                fetch(COUNTS_REDM, { timeout: 5000 })
            ]);
            if (fRes.ok) counts.fivem = (await fRes.json())[0] || 0;
            if (rRes.ok) counts.redm = (await rRes.json())[0] || 0;
        } catch (e) {}

        const gta5 = serversCache.gta5 || [];
        const redm = serversCache.redm || [];

        res.json({
            success: true,
            stats: {
                gta5: { servers: gta5.length, playersOnline: counts.fivem },
                redm: { servers: redm.length, playersOnline: counts.redm }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
    }
});

module.exports = router;
