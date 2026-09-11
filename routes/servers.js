const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Upstream API configuration
const UPSTREAM_API = process.env.UPSTREAM_API || 'https://api.la5m.ir';

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
 * Fetch servers from upstream API with caching
 */
async function fetchServers(platform) {
    const now = Date.now();
    
    // Check cache
    if (serversCache[platform] && 
        (now - serversCache.lastFetch[platform]) < CACHE_TTL) {
        return serversCache[platform];
    }

    try {
        const response = await fetch(`${UPSTREAM_API}/servers?platform=${platform}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'VS-Launcher-API/1.0'
            },
            timeout: 10000
        });

        if (!response.ok) {
            throw new Error(`Upstream API error: ${response.status}`);
        }

        const data = await response.json();
        
        // Update cache
        serversCache[platform] = data;
        serversCache.lastFetch[platform] = now;
        
        return data;
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
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch servers from upstream API',
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
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch servers from upstream API',
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
