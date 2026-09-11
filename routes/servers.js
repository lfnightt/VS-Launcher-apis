const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Cfx.re API endpoints (WORKING!)
const CFX_BASE = 'https://frontend.cfx-services.net/api/servers';
const STREAM_URL = `${CFX_BASE}/streamRedir/`;
const SINGLE_URL = `${CFX_BASE}/single/`;
const PINS_URL = 'https://runtime.fivem.net/pins.json';
const COUNTS_FIVEM = 'https://static.cfx.re/runtime/counts.json';
const COUNTS_REDM = 'https://static.cfx.re/runtime/counts_rdr3.json';

// Cache
let serversCache = { gta5: null, redm: null };
let lastFetch = { gta5: 0, redm: 0 };
const CACHE_TTL = 120 * 1000; // 2 minutes

/**
 * Fetch full server list from Cfx.re streamRedir
 */
async function fetchAllServers() {
    console.log('Fetching all servers from Cfx.re streamRedir...');

    const response = await fetch(STREAM_URL, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 60000
    });

    if (!response.ok) {
        throw new Error(`Cfx.re stream error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Got ${Array.isArray(data) ? data.length : 'unknown'} servers from Cfx.re`);
    return data;
}

/**
 * Fetch a single server by ID
 */
async function fetchSingleServer(id) {
    const response = await fetch(`${SINGLE_URL}${id}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
    });

    if (!response.ok) throw new Error(`Single server error: ${response.status}`);
    return await response.json();
}

/**
 * Normalize server data to our format
 */
function normalizeServer(srv) {
    const d = srv.Data || srv;
    const ep = srv.EndPoint || srv.endPoint || '';

    // Determine platform
    const gamename = d.vars?.gamename || 'gta5';
    const isRedm = gamename === 'rdr3' || gamename === 'redm';

    return {
        id: ep,
        hostName: d.hostname || '',
        projectName: d.projectName || d.hostname || '',
        projectDescription: d.projectDescription || d.svProjectDescription || '',
        gametype: d.gametype || '',
        mapname: d.mapname || '',
        players: {
            count: d.clients || d.players || 0,
            maxCount: d.sv_maxclients || d.svMaxclients || 0
        },
        locale: d.vars?.locale || d.locale || 'en',
        localeCountry: d.localeCountry || 'us',
        boost: d.vars?.boost || 0,
        tags: { list: d.tags || [] },
        iconVersion: d.iconVersion || 0,
        endpoint: ep,
        address: d.connectEndPoints?.[0] || d.ip || '',
        joinId: ep,
        joinUrl: `https://cfx.re/join/${ep}`,
        isOneSync: d.vars?.onesync_enabled === 'true',
        isPremium: d.vars?.premium || null,
        peakPlayers: parseInt(d.vars?.peak_players || '0'),
        serverSoftware: d.server || '',
        isRedm: isRedm,
        isFiveM: !isRedm,
        vars: d.vars || {},
        offline: (d.clients === 0 && d.vars?.peak_players === undefined),
        licenseType: d.vars?.premium || null
    };
}

/**
 * Get servers with caching
 */
async function getServers(platform) {
    const now = Date.now();

    // Return cache if valid
    if (serversCache[platform] && (now - lastFetch[platform]) < CACHE_TTL) {
        return serversCache[platform];
    }

    try {
        const allServers = await fetchAllServers();

        // Filter by platform
        const isRedm = platform === 'redm';
        const servers = [];

        for (const srv of allServers) {
            const d = srv.Data || srv;
            const gamename = d.vars?.gamename || 'gta5';
            const srvIsRedm = gamename === 'rdr3' || gamename === 'redm';

            if (isRedm === srvIsRedm) {
                servers.push(normalizeServer(srv));
            }
        }

        console.log(`Filtered to ${servers.length} servers for ${platform}`);

        serversCache[platform] = servers;
        lastFetch[platform] = now;

        return servers;
    } catch (error) {
        console.error(`Error fetching servers:`, error.message);

        // Return cached data if available
        if (serversCache[platform]) {
            console.log('Returning cached data');
            return serversCache[platform];
        }

        throw error;
    }
}

// GET /api/servers
router.get('/', async (req, res) => {
    try {
        const { platform = 'gta5' } = req.query;
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "gta5" or "redm"' });
        }

        const servers = await getServers(platform);

        res.json({
            success: true,
            platform,
            count: servers.length,
            data: servers,
            cached: (Date.now() - lastFetch[platform]) < CACHE_TTL,
            source: 'Cfx.re Official API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

// GET /api/servers/:platform
router.get('/:platform', async (req, res) => {
    try {
        const { platform } = req.params;
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "gta5" or "redm"' });
        }

        const servers = await getServers(platform);

        res.json({
            success: true,
            platform,
            count: servers.length,
            data: servers,
            cached: (Date.now() - lastFetch[platform]) < CACHE_TTL,
            source: 'Cfx.re Official API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

// GET /api/servers/stats/summary
router.get('/stats/summary', async (req, res) => {
    try {
        // Get live counts from Cfx.re
        let counts = { fivem: 0, redm: 0 };
        try {
            const [fivemRes, redmRes] = await Promise.all([
                fetch(COUNTS_FIVEM, { timeout: 5000 }),
                fetch(COUNTS_REDM, { timeout: 5000 })
            ]);
            if (fivemRes.ok) {
                const fData = await fivemRes.json();
                counts.fivem = fData[0] || 0;
            }
            if (redmRes.ok) {
                const rData = await redmRes.json();
                counts.redm = rData[0] || 0;
            }
        } catch (e) { /* counts will be 0 */ }

        // Get cached server counts
        const gta5 = serversCache.gta5 || [];
        const redm = serversCache.redm || [];

        res.json({
            success: true,
            stats: {
                gta5: {
                    servers: gta5.length,
                    playersOnline: counts.fivem,
                    playersInList: gta5.reduce((s, x) => s + (x.players?.count || 0), 0)
                },
                redm: {
                    servers: redm.length,
                    playersOnline: counts.redm,
                    playersInList: redm.reduce((s, x) => s + (x.players?.count || 0), 0)
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
    }
});

module.exports = router;
