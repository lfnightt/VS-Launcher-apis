const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// FiveM Official API endpoints
const FIVEM_API = {
    gta5: 'https://servers-api.fivem.net/api/servers/query',
    redm: 'https://servers-api.fivem.net/api/servers/query'
};

// Cache for servers data
let serversCache = {
    gta5: null,
    redm: null,
    lastFetch: {
        gta5: 0,
        redm: 0
    }
};

const CACHE_TTL = 60 * 1000; // 1 minute cache

/**
 * Fetch servers from FiveM API with caching
 */
async function fetchServers(platform) {
    const now = Date.now();
    
    // Check cache
    if (serversCache[platform] && 
        (now - serversCache.lastFetch[platform]) < CACHE_TTL) {
        return serversCache[platform];
    }

    try {
        // FiveM API uses different game identifiers
        const gameId = platform === 'gta5' ? 'gtav' : 'redm';
        
        const response = await fetch(`${FIVEM_API[platform]}?games[]=${gameId}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'VS-Launcher/1.0',
                'x-apis-key': 'xF2pSndN7PQnNAlMPdDafQ'
            },
            timeout: 15000
        });

        if (!response.ok) {
            throw new Error(`FiveM API error: ${response.status}`);
        }

        const rawData = await response.json();
        
        // Transform FiveM data to match our expected format
        const servers = (rawData || []).map(server => ({
            id: server.EndPoint || server.id,
            hostName: server.Hostname || server.hostname || '',
            projectName: server.Name || server.name || '',
            projectDescription: server.Description || server.description || '',
            players: {
                count: server.Players || server.players || 0,
                maxCount: server.MaxClients || server.maxclients || 0
            },
            locale: server.Locale || server.locale || 'en',
            localeCountry: server.LocaleCountry || server.localeCountry || 'us',
            boost: server.Vars?.boost || 0,
            tags: {
                list: server.Tags || server.tags || []
            },
            iconVersion: server.IconVersion || server.iconVersion || 0,
            offline: server.Available !== undefined ? !server.Available : false,
            licenseType: server.LicenseType || server.licenseType || null
        }));

        const result = {
            count: servers.length,
            data: servers
        };
        
        // Update cache
        serversCache[platform] = result;
        serversCache.lastFetch[platform] = now;
        
        return result;
    } catch (error) {
        console.error(`Error fetching servers for ${platform}:`, error.message);
        
        // Return cached data if available
        if (serversCache[platform]) {
            return serversCache[platform];
        }
        
        throw error;
    }
}

/**
 * GET /api/servers
 * Get servers list with optional platform filter
 */
router.get('/', async (req, res) => {
    try {
        const { platform = 'gta5' } = req.query;
        
        // Validate platform
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid platform. Must be "gta5" or "redm"',
                supported: ['gta5', 'redm']
            });
        }

        const data = await fetchServers(platform);
        
        res.json({
            success: true,
            platform,
            count: data.count || 0,
            data: data.data || [],
            cached: (Date.now() - serversCache.lastFetch[platform]) < CACHE_TTL,
            source: 'FiveM Official API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch servers from FiveM API',
            details: error.message
        });
    }
});

/**
 * GET /api/servers/:platform
 * Get servers for specific platform
 */
router.get('/:platform', async (req, res) => {
    try {
        const { platform } = req.params;
        
        // Validate platform
        if (!['gta5', 'redm'].includes(platform)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid platform. Must be "gta5" or "redm"',
                supported: ['gta5', 'redm']
            });
        }

        const data = await fetchServers(platform);
        
        res.json({
            success: true,
            platform,
            count: data.count || 0,
            data: data.data || [],
            cached: (Date.now() - serversCache.lastFetch[platform]) < CACHE_TTL,
            source: 'FiveM Official API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch servers from FiveM API',
            details: error.message
        });
    }
});

/**
 * GET /api/servers/stats/summary
 * Get server statistics summary
 */
router.get('/stats/summary', async (req, res) => {
    try {
        const gta5Data = await fetchServers('gta5');
        const redmData = await fetchServers('redm');
        
        const gta5Servers = gta5Data.data || [];
        const redmServers = redmData.data || [];
        
        const gta5Players = gta5Servers.reduce((sum, s) => sum + (s.players?.count || 0), 0);
        const redmPlayers = redmServers.reduce((sum, s) => sum + (s.players?.count || 0), 0);
        
        res.json({
            success: true,
            stats: {
                gta5: {
                    servers: gta5Servers.length,
                    players: gta5Players
                },
                redm: {
                    servers: redmServers.length,
                    players: redmPlayers
                },
                total: {
                    servers: gta5Servers.length + redmServers.length,
                    players: gta5Players + redmPlayers
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch server statistics',
            details: error.message
        });
    }
});

module.exports = router;
