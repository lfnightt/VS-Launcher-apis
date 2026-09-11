const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// FiveM API endpoints
const FIVEM_BASE = 'https://servers-frontend.fivem.net/api/servers';
const STREAM_URL = `${FIVEM_BASE}/streamRedir/`;
const SINGLE_URL = `${FIVEM_BASE}/single/`;

// Cache
let serversCache = { gta5: [], redm: [] };
let lastFetch = { gta5: 0, redm: 0 };
const CACHE_TTL = 120 * 1000; // 2 minutes

/**
 * Decode binary server data from FiveM stream
 * Each frame: [4 bytes length][JSON payload]
 */
function decodeFrames(buffer) {
    const servers = [];
    let offset = 0;

    while (offset < buffer.length - 4) {
        try {
            // Read 4-byte little-endian length
            const len = buffer.readUInt32LE(offset);
            offset += 4;

            if (len === 0 || len > 100000 || offset + len > buffer.length) {
                break;
            }

            const jsonStr = buffer.toString('utf8', offset, offset + len);
            offset += len;

            const srv = JSON.parse(jsonStr);
            if (srv && srv.Endpoint && srv.Data) {
                servers.push(srv);
            }
        } catch (e) {
            // Skip bad frame
            offset++;
        }
    }

    return servers;
}

/**
 * Transform raw FiveM server data to our format
 */
function transformServer(endpoint, data) {
    return {
        id: endpoint,
        hostName: data.hostname || '',
        projectName: data.projectName || data.name || '',
        projectDescription: data.projectDescription || data.svProjectDescription || '',
        players: {
            count: data.players || 0,
            maxCount: data.maxClients || 0
        },
        locale: data.locale || 'en',
        localeCountry: data.localeCountry || 'us',
        boost: data.vars?.boost || 0,
        tags: { list: data.tags || [] },
        iconVersion: data.iconVersion || 0,
        offline: false,
        licenseType: null
    };
}

/**
 * Fetch all servers from FiveM streaming endpoint
 */
async function fetchFromStream(platform) {
    console.log(`Fetching from FiveM stream: ${STREAM_URL}`);
    
    const response = await fetch(STREAM_URL, {
        headers: {
            'Accept': '*/*',
            'User-Agent': 'VS-Launcher/1.0',
            'Accept-Encoding': 'identity'
        },
        timeout: 30000
    });

    if (!response.ok) {
        throw new Error(`Stream error: ${response.status}`);
    }

    // Read entire body as buffer
    const buffer = await response.buffer();
    console.log(`Received ${buffer.length} bytes from stream`);

    // Decode frames
    const rawServers = decodeFrames(buffer);
    console.log(`Decoded ${rawServers.length} raw servers`);

    // Filter by platform and transform
    const gameName = platform === 'gta5' ? 'gta5' : 'redm';
    const servers = [];

    for (const srv of rawServers) {
        const serverGame = srv.Data?.vars?.gamename || 'gta5';
        if (serverGame === gameName || 
            (platform === 'gta5' && serverGame !== 'redm')) {
            servers.push(transformServer(srv.Endpoint, srv.Data));
        }
    }

    console.log(`Filtered to ${servers.length} servers for ${platform}`);
    return servers;
}

/**
 * Get servers with caching
 */
async function getServers(platform) {
    const now = Date.now();
    
    if (serversCache[platform].length > 0 && (now - lastFetch[platform]) < CACHE_TTL) {
        return serversCache[platform];
    }

    try {
        const servers = await fetchFromStream(platform);
        
        serversCache[platform] = servers;
        lastFetch[platform] = now;
        
        return servers;
    } catch (error) {
        console.error(`Error fetching servers:`, error.message);
        
        if (serversCache[platform].length > 0) {
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
            source: 'FiveM Official Stream API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch servers',
            details: error.message
        });
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
            source: 'FiveM Official Stream API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch servers',
            details: error.message
        });
    }
});

// GET /api/servers/stats/summary
router.get('/stats/summary', async (req, res) => {
    try {
        const gta5 = await getServers('gta5');
        const redm = await getServers('redm');

        const gta5Players = gta5.reduce((s, x) => s + (x.players?.count || 0), 0);
        const redmPlayers = redm.reduce((s, x) => s + (x.players?.count || 0), 0);

        res.json({
            success: true,
            stats: {
                gta5: { servers: gta5.length, players: gta5Players },
                redm: { servers: redm.length, players: redmPlayers },
                total: { servers: gta5.length + redm.length, players: gta5Players + redmPlayers }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
    }
});

module.exports = router;
