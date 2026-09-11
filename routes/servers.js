const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// User's own FiveM Server List API
const UPSTREAM = 'https://fivem-serverlist-api-production.up.railway.app';

// ====== Cache ======
let serversCache = { all: null, gta5: null, redm: null };
let lastFetch = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * GET /fetchServers - Get all servers from upstream
 */
async function fetchAllServers() {
    if (serversCache.all && (Date.now() - lastFetch) < CACHE_TTL) {
        return serversCache.all;
    }

    console.log('[API] Fetching all servers from upstream...');
    const t0 = Date.now();

    const response = await fetch(`${UPSTREAM}/fetchServers`, {
        headers: { 'Accept': 'application/json' },
        timeout: 30000
    });

    if (!response.ok) throw new Error(`Upstream error: ${response.status}`);

    const data = await response.json();
    const servers = Array.isArray(data) ? data : (data.data || data.servers || []);

    console.log(`[API] Got ${servers.length} servers in ${Date.now() - t0}ms`);

    // Split by platform
    const gta5 = [];
    const redm = [];

    for (const srv of servers) {
        const vars = srv.vars || srv.Data?.vars || {};
        const gamename = vars.gamename || srv.gamename || 'gta5';
        const isRedm = gamename === 'rdr3' || gamename === 'redm';

        const normalized = normalizeServer(srv);

        if (isRedm) redm.push(normalized);
        else gta5.push(normalized);
    }

    serversCache.all = servers;
    serversCache.gta5 = gta5;
    serversCache.redm = redm;
    lastFetch = Date.now();

    return servers;
}

/**
 * Fetch servers by locale
 */
async function fetchByLocale(locale) {
    const response = await fetch(`${UPSTREAM}/fetchServersByLocale/${locale}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 15000
    });

    if (!response.ok) throw new Error(`Upstream error: ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : (data.data || data.servers || []);
}

/**
 * Fetch single server by endpoint
 */
async function fetchByEndPoint(endpoint) {
    const response = await fetch(`${UPSTREAM}/fetchServerByEndPoint/${endpoint}`, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
    });

    if (!response.ok) throw new Error(`Upstream error: ${response.status}`);
    const data = await response.json();
    return data;
}

/**
 * Normalize server to our format
 */
function normalizeServer(srv) {
    // Handle nested Data format
    const d = srv.Data || srv;
    const vars = d.vars || srv.vars || {};
    const gamename = vars.gamename || 'gta5';
    const isRedm = gamename === 'rdr3' || gamename === 'redm';

    const ep = srv.EndPoint || srv.endpoint || srv.id || '';
    const hostname = d.hostname || srv.hostname || '';
    const clients = d.clients || d.players?.count || srv.players?.count || 0;
    const maxClients = d.sv_maxclients || d.svMaxclients || d.players?.maxCount || srv.players?.maxCount || 0;

    return {
        id: ep,
        hostName: hostname,
        projectName: hostname,
        projectDescription: d.projectDescription || vars.sv_projectDescription || '',
        gametype: d.gametype || '',
        mapname: d.mapname || '',
        players: {
            count: clients,
            maxCount: maxClients
        },
        locale: vars.locale || d.locale || 'en',
        localeCountry: d.localeCountry || 'us',
        boost: vars.boost || 0,
        tags: { list: d.tags || srv.tags || [] },
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

// ====== Routes ======

// GET /api/servers - Get all servers
router.get('/', async (req, res) => {
    try {
        const { platform = 'gta5' } = req.query;

        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "gta5" or "redm"' });
        }

        // Fetch all servers (cached)
        await fetchAllServers();

        const servers = serversCache[platform] || [];

        res.json({
            success: true,
            platform,
            count: servers.length,
            data: servers,
            cached: (Date.now() - lastFetch) < CACHE_TTL,
            source: 'Cfx.re via fivem-serverlist-api',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

// GET /api/servers/:platform - Get servers for platform
router.get('/:platform', async (req, res) => {
    try {
        const { platform } = req.params;

        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "gta5" or "redm"' });
        }

        await fetchAllServers();

        const servers = serversCache[platform] || [];

        res.json({
            success: true,
            platform,
            count: servers.length,
            data: servers,
            cached: (Date.now() - lastFetch) < CACHE_TTL,
            source: 'Cfx.re via fivem-serverlist-api',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[API] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

// GET /api/servers/stats/summary
router.get('/stats/summary', async (req, res) => {
    try {
        await fetchAllServers();

        const gta5 = serversCache.gta5 || [];
        const redm = serversCache.redm || [];

        res.json({
            success: true,
            stats: {
                gta5: {
                    servers: gta5.length,
                    playersOnline: gta5.reduce((sum, s) => sum + (s.players?.count || 0), 0)
                },
                redm: {
                    servers: redm.length,
                    playersOnline: redm.reduce((sum, s) => sum + (s.players?.count || 0), 0)
                },
                total: {
                    servers: gta5.length + redm.length,
                    playersOnline: gta5.reduce((sum, s) => sum + (s.players?.count || 0), 0) +
                                   redm.reduce((sum, s) => sum + (s.players?.count || 0), 0)
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
    }
});

// GET /api/servers/search/:locale - Get servers by locale
router.get('/search/:locale', async (req, res) => {
    try {
        const { locale } = req.params;
        const servers = await fetchByLocale(locale);

        res.json({
            success: true,
            locale,
            count: servers.length,
            data: servers.map(normalizeServer),
            source: 'Cfx.re via fivem-serverlist-api',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch servers', details: error.message });
    }
});

module.exports = router;
