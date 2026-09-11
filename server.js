require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
const serversRouter = require('./routes/servers');
app.use('/api/servers', serversRouter);

// API Documentation endpoint
app.get('/api', (req, res) => {
    res.json({
        name: 'VS Launcher API',
        version: '1.0.0',
        description: 'API endpoints for VS Launcher services',
        endpoints: [
            {
                path: '/api/servers',
                method: 'GET',
                description: 'Get list of game servers',
                parameters: [
                    {
                        name: 'platform',
                        type: 'string',
                        required: true,
                        description: 'Game platform (gta5 or redm)',
                        example: 'gta5'
                    }
                ],
                example: '/api/servers?platform=gta5'
            },
            {
                path: '/api/servers/:platform',
                method: 'GET',
                description: 'Get servers for specific platform',
                example: '/api/servers/gta5'
            },
            {
                path: '/api/health',
                method: 'GET',
                description: 'Health check endpoint',
                example: '/api/health'
            }
        ],
        status: 'active',
        documentation: '/'
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Root route - API Documentation Site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        documentation: '/'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 VS Launcher API Server running on port ${PORT}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}`);
    console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
});
