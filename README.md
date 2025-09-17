# Black Swan RSS Feed Service

[![Node.js](https://img.shields.io/badge/Node.js-18.0.0+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Author](https://img.shields.io/badge/Author-Muhammad%20Bilal%20Motiwala-orange.svg)](https://github.com/bilalmotiwala)

A comprehensive real-time RSS monitoring service designed for cryptocurrency market analysis. This service continuously monitors major news sources and uses AI to classify articles based on their potential impact on crypto markets.

## 🚀 Features

### Core Functionality

- **Real-time RSS Monitoring**: Monitors Reuters, AP, CoinDesk, and CoinTelegraph feeds every 5 minutes
- **AI-Powered Analysis**: Uses Perplexity AI for crypto market impact analysis and article summarization
- **Intelligent Classification**: Classifies articles as CRITICAL, HIGH, NORMAL, LOW, or NOT RELEVANT
- **Persistent Storage**: Saves HIGH/CRITICAL articles to Firebase Firestore database
- **Immediate Alerts**: Triggers immediate monitoring for CRITICAL articles
- **REST API**: Provides comprehensive APIs for data access and service management
- **Real-time Logging**: Server-Sent Events (SSE) for live log streaming
- **Security**: Rate limiting, CORS, Helmet security headers, and input validation

### Market Impact Classification

- **CRITICAL**: Major regulatory decisions, large institutional adoption/rejection, major exchange hacks, government bans, major economic crises
- **HIGH**: Regulatory announcements, institutional investments, major tech developments, significant economic policy changes
- **NORMAL**: General financial news, traditional market movements, minor policy updates, standard business news
- **LOW**: Company earnings (non-crypto), minor political events, sports, entertainment news with slight economic implications
- **NOT RELEVANT**: Sports, entertainment, local news, weather, science discoveries with no economic impact

## 🏗️ Architecture

### Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: Firebase Firestore
- **AI Processing**: Perplexity AI via OpenRouter API
- **Scheduling**: Node-cron for RSS feed monitoring
- **Security**: Helmet, CORS, Rate Limiting
- **Logging**: Custom SSE-based real-time log streaming

### System Components

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐
│   RSS Feeds     │───▶│    RSS Fetcher   │───▶│ Article Processor │
│ (Reuters, AP,   │    │                  │    │  (Perplexity AI)  │
│  CoinDesk,      │    │                  │    │                   │
│  CoinTelegraph) │    │                  │    │                   │
└─────────────────┘    └──────────────────┘    └───────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   REST API      │◀───│  Express Server  │◀───│ Database Manager│
│                 │    │                  │    │ (Firestore)     │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌──────────────────┐
│  Log Streaming  │    │  Cron Scheduler  │
│     (SSE)       │    │  (Every 5 min)   │
└─────────────────┘    └──────────────────┘
```

## 📋 Prerequisites

Before setting up the BlackSwan RSS Feed Service, ensure you have:

- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 8.0.0 or higher
- **Firebase Project**: With Firestore enabled
- **OpenRouter API Key**: For Perplexity AI access
- **Service Account**: Firebase service account credentials

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd rss-feed-service
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Copy the example environment file and configure your settings:

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your actual values
nano .env
```

The `.env.example` file contains detailed documentation for all available environment variables. At minimum, you need to set:

```bash
# OpenRouter API Configuration (Required)
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Server Configuration (Optional)
PORT=8087
NODE_ENV=development
```

### 4. Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Firestore Database
3. Generate a service account key:
   - Go to Project Settings → Service Accounts
   - Click "Generate new private key"
   - Save the JSON file as `serviceAccountKey.json` in the project root

### 5. OpenRouter API Setup

1. Sign up at [OpenRouter](https://openrouter.ai/)
2. Get your API key from the dashboard
3. Add the key to your `.env` file

## 🚀 Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

The service will start on the configured port (default: 8087) and begin monitoring RSS feeds every 5 minutes.

## 📡 API Documentation

### Base URL

```
http://localhost:8087
```

### Endpoints

#### Health Check

```http
GET /health
```

Returns service health status and basic information.

**Response:**

```json
{
  "status": "healthy",
  "service": "BlackSwan RSS Monitoring Service",
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "monitoring_status": "idle",
  "last_run": "2024-01-01T00:00:00.000Z",
  "total_articles_processed": 150,
  "new_articles_available": false,
  "stats": {
    "totalFetched": 200,
    "totalProcessed": 150,
    "highCriticalSaved": 25,
    "criticalSaved": 5,
    "highSaved": 20,
    "lastFeedCheck": "2024-01-01T00:00:00.000Z",
    "articlesFilteredOld": 30,
    "articlesFilteredAlreadyProcessed": 20,
    "recentArticlesCount": 150
  }
}
```

#### Get Recent Articles

```http
GET /api/articles/recent?hours=24
```

Retrieves HIGH/CRITICAL articles from the last specified hours.

**Parameters:**

- `hours` (optional): Number of hours to look back (default: 24)

**Response:**

```json
{
  "success": true,
  "articles": [
    {
      "id": "article_id",
      "title": "Bitcoin ETF Approved by SEC",
      "summary": "The SEC has approved the first Bitcoin ETF...",
      "market_impact": "CRITICAL",
      "date": "2024-01-01T00:00:00.000Z",
      "source": "Reuters",
      "link": "https://example.com/article",
      "fetchedAt": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "count": 1,
  "timeframe_hours": 24,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Check for New Articles

```http
GET /api/articles/new
```

Checks if new CRITICAL articles are available (triggers immediate monitoring).

**Response:**

```json
{
  "success": true,
  "new_articles_available": true,
  "last_check": "2024-01-01T00:00:00.000Z",
  "monitoring_status": "idle",
  "reset_timer_active": "30_seconds",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Manual Monitoring Trigger

```http
POST /api/monitor/trigger
```

Manually triggers a monitoring cycle (useful for testing).

**Response:**

```json
{
  "success": true,
  "message": "Monitoring cycle triggered manually",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Service Statistics

```http
GET /api/stats
```

Returns comprehensive service statistics and configuration.

**Response:**

```json
{
  "service_name": "BlackSwan RSS Monitoring Service",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "monitoring_status": "idle",
  "last_run": "2024-01-01T00:00:00.000Z",
  "new_articles_available": false,
  "total_articles_processed": 150,
  "known_articles_count": 1000,
  "rss_feeds": [
    {
      "name": "Reuters",
      "url": "https://news.google.com/rss/search?q=site%3Areuters.com&hl=en-US&gl=US&ceid=US%3Aen"
    }
  ],
  "monitoring_interval": "3,7,11,15,19,23,27,31,35,39,43,47,51,55,59 * * * *",
  "detailed_stats": {
    "totalFetched": 200,
    "totalProcessed": 150,
    "highCriticalSaved": 25,
    "criticalSaved": 5,
    "highSaved": 20,
    "lastFeedCheck": "2024-01-01T00:00:00.000Z",
    "articlesFilteredOld": 30,
    "articlesFilteredAlreadyProcessed": 20,
    "recentArticlesCount": 150
  },
  "logStreamer": {
    "connectedClients": 2,
    "bufferSize": 500,
    "maxBufferSize": 1000
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Real-time Log Streaming

```http
GET /logs/stream
```

Establishes a Server-Sent Events (SSE) connection for real-time log streaming.

**Response:** Continuous stream of log events in SSE format:

```
data: {"timestamp":"2024-01-01T00:00:00.000Z","level":"INFO","message":"Service started"}

data: {"timestamp":"2024-01-01T00:00:00.000Z","level":"LOG","message":"Fetching RSS feeds..."}
```

## 🔧 Configuration

### Environment Variables

> **Note**: See `.env.example` for detailed documentation of all environment variables with examples and setup instructions.

| Variable             | Description                               | Default     | Required |
| -------------------- | ----------------------------------------- | ----------- | -------- |
| `OPENROUTER_API_KEY` | OpenRouter API key for Perplexity AI      | -           | Yes      |
| `PORT`               | Server port                               | 8087        | No       |
| `NODE_ENV`           | Node environment (development/production) | development | No       |

### RSS Feed Configuration

The service monitors the following RSS feeds by default:

- **Reuters**: Google News RSS for Reuters articles
- **Associated Press**: Google News RSS for AP articles
- **CoinDesk**: Direct RSS feed from CoinDesk
- **CoinTelegraph**: Direct RSS feed from CoinTelegraph

### Monitoring Schedule

- **Interval**: Every 5 minutes
- **Cron Expression**: `3,7,11,15,19,23,27,31,35,39,43,47,51,55,59 * * * *`
- **Purpose**: Avoids conflicts and ensures consistent monitoring

### Processing Configuration

- **Chunk Size**: 10 articles per batch
- **Timeout**: 30 seconds for API responses
- **Rate Limiting**: 100 requests per 15 minutes per IP

## 🔒 Security Features

### Authentication & Authorization

- All API keys loaded from environment variables
- Firebase service account authentication
- No hardcoded credentials (except serviceAccountKey.json)

### Request Security

- **Helmet**: Security headers protection
- **CORS**: Cross-origin resource sharing configuration
- **Rate Limiting**: API abuse prevention
- **Input Validation**: Request data sanitization

### Data Protection

- **Firestore Security Rules**: Database access control
- **HTTPS**: Encrypted data transmission (in production)
- **Environment Variables**: Sensitive data protection

## 📊 Monitoring & Logging

### Real-time Logging

- **Server-Sent Events**: Live log streaming to connected clients
- **Log Levels**: INFO, LOG, WARN, ERROR, DEBUG
- **Buffer Management**: Rolling buffer with 1000 entry limit
- **Client Management**: Automatic cleanup of disconnected clients

### Performance Monitoring

- **Uptime Tracking**: Service availability monitoring
- **Processing Statistics**: Article processing metrics
- **Error Tracking**: Failed operations and error rates
- **Resource Usage**: Memory and connection monitoring

### Health Checks

- **Service Status**: Overall service health
- **Database Connectivity**: Firestore connection status
- **API Availability**: External service connectivity
- **Processing Status**: Current monitoring cycle status

## 🚨 Error Handling

### Graceful Degradation

- **Feed Failures**: Continue processing other feeds if one fails
- **API Errors**: Fallback processing with error logging
- **Network Issues**: Retry logic and timeout handling
- **Database Errors**: Error logging without service interruption

### Error Recovery

- **Automatic Retries**: Built-in retry mechanisms
- **Circuit Breakers**: Prevent cascading failures
- **Fallback Responses**: Default responses for failed operations
- **Error Logging**: Comprehensive error tracking and reporting

## 🧪 Testing

### Manual Testing

```bash
# Test health endpoint
curl http://localhost:8087/health

# Test article retrieval
curl http://localhost:8087/api/articles/recent

# Test manual trigger
curl -X POST http://localhost:8087/api/monitor/trigger

# Test statistics
curl http://localhost:8087/api/stats
```

### Log Streaming Test

```bash
# Connect to log stream
curl -N http://localhost:8087/logs/stream
```

## 🚀 Deployment

### Production Deployment

1. **Environment Setup**:

   ```bash
   # Set production environment variables
   export NODE_ENV=production
   export OPENROUTER_API_KEY=your_production_key
   export PORT=8087
   ```

2. **Process Management**:

   ```bash
   # Using PM2 (recommended)
   npm install -g pm2
   pm2 start index.js --name "blackswan-rss-service"
   pm2 startup
   pm2 save
   ```

3. **Reverse Proxy** (Nginx example):

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:8087;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8087

CMD ["npm", "start"]
```

```bash
# Build and run
docker build -t blackswan-rss-service .
docker run -p 8087:8087 --env-file .env blackswan-rss-service
```

## 📈 Performance Optimization

### Recommended Settings

- **Memory**: Minimum 512MB, recommended 1GB
- **CPU**: 1-2 cores for optimal performance
- **Storage**: 10GB for logs and temporary data
- **Network**: Stable internet connection for RSS feeds and AI API

### Scaling Considerations

- **Horizontal Scaling**: Multiple instances with load balancer
- **Database Optimization**: Firestore indexes for query performance
- **Caching**: Redis for frequently accessed data
- **CDN**: Static content delivery for better performance

## 🔧 Troubleshooting

### Common Issues

#### Service Won't Start

```bash
# Check Node.js version
node --version  # Should be 18.0.0+

# Check dependencies
npm install

# Check environment variables
cat .env

# If .env doesn't exist, copy from example
cp .env.example .env
# Then edit .env with your actual values
```

#### RSS Feed Fetching Fails

```bash
# Check network connectivity
curl -I https://www.coindesk.com/arc/outboundfeeds/rss

# Check firewall settings
# Ensure outbound HTTPS (443) is allowed
```

#### Firebase Connection Issues

```bash
# Verify service account key
cat serviceAccountKey.json

# Check Firestore rules
# Ensure service account has read/write access
```

#### API Rate Limiting

```bash
# Check OpenRouter API key
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     https://openrouter.ai/api/v1/models

# Monitor API usage in OpenRouter dashboard
```

### Log Analysis

```bash
# View real-time logs
curl -N http://localhost:8087/logs/stream

# Check service statistics
curl http://localhost:8087/api/stats
```

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes
4. Add tests if applicable
5. Commit your changes: `git commit -am 'Add new feature'`
6. Push to the branch: `git push origin feature/new-feature`
7. Submit a pull request

### Code Standards

- **ESLint**: Follow project linting rules
- **Comments**: Add comprehensive comments for complex logic
- **Error Handling**: Implement proper error handling
- **Testing**: Add tests for new functionality
- **Documentation**: Update README for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**Muhammad Bilal Motiwala**

- GitHub: [@bilalmotiwala](https://github.com/bilalmotiwala)
- Email: [bilal@oaiaolabs.com](mailto:bilal@oaiaolabs.com)

## 🙏 Acknowledgments

- **Perplexity AI** for providing intelligent article analysis
- **OpenRouter** for API access to AI models
- **Firebase** for reliable database services
- **Express.js** community for the excellent web framework
- **Node.js** community for the robust runtime environment

## 📞 Support

For support, email [support@blackswan.com](mailto:support@blackswan.com) or create an issue in the repository.

---

**BlackSwan RSS Feed Service** - Intelligent cryptocurrency market monitoring powered by AI.
