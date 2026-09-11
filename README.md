# VS Launcher API

API server for VS Launcher services. This API provides endpoints for fetching game server data and other launcher-related information.

## 🚀 Features

- **Server List API**: Fetch FiveM and RedM server lists
- **Caching**: Built-in caching for improved performance
- **Health Check**: Monitor API health status
- **CORS Enabled**: Cross-origin requests supported
- **Rate Limiting**: Built-in request throttling

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/LaPlatform/VS-Launcher.git

# Navigate to API directory
cd VS-Launcher/website/assets/apis/main

# Install dependencies
npm install

# Start development server
npm run dev
```

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `UPSTREAM_API` | Upstream API URL | `https://api.la5m.ir` |

## 📡 API Endpoints

### Get Servers
```
GET /api/servers?platform=gta5
GET /api/servers?platform=redm
```

**Parameters:**
- `platform` (required): Game platform - `gta5` or `redm`

**Response:**
```json
{
  "success": true,
  "platform": "gta5",
  "count": 150,
  "data": [...],
  "cached": false,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Server Statistics
```
GET /api/servers/stats/summary
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "gta5": { "servers": 150, "players": 5000 },
    "redm": { "servers": 50, "players": 1000 },
    "total": { "servers": 200, "players": 6000 }
  }
}
```

### Health Check
```
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "memory": {...}
}
```

## 🚢 Deployment

### Railway

1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push to `main` branch

### Manual Deployment

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Deploy
railway up
```

## 🔄 Auto-Deploy

The project includes GitHub Actions workflow for automatic deployment:

1. Push changes to `main` branch
2. GitHub Actions triggers deployment
3. Railway deploys the new version
4. Health check verifies deployment

### Required Secrets

Add these secrets in GitHub repository settings:

- `RAILWAY_TOKEN`: Your Railway API token

## 📝 Development

```bash
# Start development server with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## 📄 License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](../../../../LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- 🌐 Website: [la5m.ir](https://la5m.ir)
- 💬 Discord: [discord.la5m.ir](https://discord.la5m.ir)
- 🐛 Issues: [GitHub Issues](https://github.com/LaPlatform/VS-Launcher/issues)
