/**
 * Black Swan RSS Monitoring Service
 * ================================
 *
 * A comprehensive real-time RSS monitoring service designed for cryptocurrency market analysis.
 * This service continuously monitors major news sources and uses AI to classify articles
 * based on their potential impact on crypto markets.
 *
 * Key Features:
 * 1. Monitors Reuters, AP, CoinDesk, and CoinTelegraph feeds every 5 minutes
 * 2. Processes new articles through Perplexity AI for crypto market impact analysis
 * 3. Saves HIGH/CRITICAL articles to Firestore database
 * 4. Triggers immediate monitoring only for CRITICAL articles (HIGH articles saved but queued)
 * 5. Provides REST APIs for fetching results and checking for new critical articles
 * 6. Real-time log streaming via Server-Sent Events (SSE)
 * 7. Comprehensive error handling and graceful degradation
 * 8. Rate limiting and security middleware
 *
 * Architecture:
 * - Express.js web server with security middleware (Helmet, CORS, Rate Limiting)
 * - Firebase Firestore for persistent storage
 * - Perplexity AI for article analysis and classification
 * - Node-cron for scheduled RSS feed monitoring
 * - Event-driven logging system with real-time streaming
 *
 * Security Features:
 * - All API keys loaded from environment variables
 * - Rate limiting to prevent abuse
 * - Input validation and sanitization
 * - Secure headers via Helmet middleware
 * - CORS configuration for cross-origin requests
 *
 * Author: Muhammad Bilal Motiwala
 * Project: Black Swan
 */

// ============================================================================
// DEPENDENCY IMPORTS
// ============================================================================

// Load environment variables from .env file
require("dotenv").config();

// Core web framework and middleware
const express = require("express"); // Web application framework
const cors = require("cors"); // Cross-Origin Resource Sharing
const helmet = require("helmet"); // Security headers middleware
const rateLimit = require("express-rate-limit"); // Rate limiting middleware
const compression = require("compression"); // Response compression

// External service integrations
const admin = require("firebase-admin"); // Firebase Admin SDK
const axios = require("axios"); // HTTP client for API calls

// Utility libraries
const cron = require("node-cron"); // Cron job scheduler
const xml2js = require("xml2js"); // XML to JavaScript parser
const { EventEmitter } = require("events"); // Event system for logging

// ============================================================================
// FIREBASE INITIALIZATION
// ============================================================================

/**
 * Initialize Firebase Admin SDK with service account credentials
 * The serviceAccountKey.json file contains the Firebase service account credentials
 * required for Firestore database access. This is the only hardcoded credential
 * file as per security requirements.
 */
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Get Firestore database instance
const db = admin.firestore();

// ============================================================================
// APPLICATION CONFIGURATION
// ============================================================================

/**
 * Main configuration object containing all service settings
 * All sensitive data is loaded from environment variables for security
 */
const CONFIG = {
  // ========================================================================
  // EXTERNAL API CONFIGURATION
  // ========================================================================

  /**
   * OpenRouter API configuration for Perplexity AI integration
   * OpenRouter provides access to various AI models including Perplexity
   * for article analysis and market impact classification
   */
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, // Loaded from environment for security
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1", // OpenRouter API endpoint

  // ========================================================================
  // SERVER CONFIGURATION
  // ========================================================================

  /**
   * Server port configuration
   * Defaults to 8087 if PORT environment variable is not set
   */
  PORT: process.env.PORT || 8087,

  // ========================================================================
  // RSS FEED SOURCES
  // ========================================================================

  /**
   * RSS feed sources for news monitoring
   * These feeds are monitored for cryptocurrency and financial news
   * Each feed is configured with a name and URL for easy identification
   */
  RSS_FEEDS: [
    {
      name: "Reuters",
      url: "https://news.google.com/rss/search?q=site%3Areuters.com&hl=en-US&gl=US&ceid=US%3Aen",
    },
    {
      name: "Associated Press",
      url: "https://news.google.com/rss/search?q=site%3Aapnews.com&hl=en-US&gl=US&ceid=US%3Aen",
    },
    {
      name: "CoinDesk",
      url: "https://www.coindesk.com/arc/outboundfeeds/rss",
    },
    {
      name: "CoinTelegraph",
      url: "https://cointelegraph.com/rss",
    },
  ],

  // ========================================================================
  // MONITORING CONFIGURATION
  // ========================================================================

  /**
   * Cron schedule for RSS feed monitoring
   * Runs every 5 minutes at specific minute marks to avoid conflicts
   * Schedule: 3,7,11,15,19,23,27,31,35,39,43,47,51,55,59 * * * *
   * This ensures monitoring happens every 5 minutes throughout the hour
   */
  MONITORING_INTERVAL: "3,7,11,15,19,23,27,31,35,39,43,47,51,55,59 * * * *",

  /**
   * Batch processing configuration
   * Articles are processed in chunks to manage API rate limits and memory usage
   */
  CHUNK_SIZE: 10, // Process 10 articles at a time

  // ========================================================================
  // API CONFIGURATION
  // ========================================================================

  /**
   * Timeout configuration for API responses
   * When new articles are detected via API, this timer resets the flag
   * to prevent duplicate notifications
   */
  API_RESET_TIMEOUT: 30 * 1000, // 30 seconds - reset flag after API call
};

// ============================================================================
// EXPRESS APPLICATION SETUP
// ============================================================================

/**
 * Initialize Express.js application
 * Express is used as the web framework for handling HTTP requests and responses
 */
const app = express();

// ============================================================================
// SECURITY AND MIDDLEWARE CONFIGURATION
// ============================================================================

/**
 * Security middleware stack
 * These middleware functions are applied in order to secure the application
 */

// Helmet: Sets various HTTP headers to help protect the app from well-known web vulnerabilities
app.use(helmet());

// Compression: Compresses response bodies for all requests that traverse through the middleware
app.use(compression());

// CORS: Enables Cross-Origin Resource Sharing for all routes
app.use(cors());

// JSON parsing: Parses incoming request bodies in JSON format with 10MB limit
app.use(express.json({ limit: "10mb" }));

// ============================================================================
// RATE LIMITING CONFIGURATION
// ============================================================================

/**
 * Rate limiting middleware to prevent API abuse
 * Limits each IP address to 100 requests per 15-minute window
 * Applied only to API routes (/api/*) to allow normal web access
 */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes time window
  max: 100, // Maximum 100 requests per IP per window
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting only to API routes
app.use("/api/", limiter);

// ============================================================================
// GLOBAL STATE MANAGEMENT
// ============================================================================

/**
 * Global application state object
 * Tracks the current status of the RSS monitoring service and maintains
 * statistics for monitoring and debugging purposes
 */
let monitoringState = {
  // ========================================================================
  // MONITORING STATUS
  // ========================================================================

  isRunning: false, // Flag indicating if monitoring cycle is currently active
  lastRun: null, // Timestamp of the last completed monitoring cycle
  totalArticlesProcessed: 0, // Total number of articles processed since service start

  // ========================================================================
  // NEW ARTICLE DETECTION
  // ========================================================================

  newArticlesFound: false, // Flag indicating if new CRITICAL articles were found
  newArticleTimer: null, // Timer for resetting the new articles flag after API calls

  // ========================================================================
  // ARTICLE TRACKING
  // ========================================================================

  knownArticles: new Set(), // Set of article GUIDs to prevent duplicate processing

  // ========================================================================
  // STATISTICS TRACKING
  // ========================================================================

  stats: {
    totalFetched: 0, // Total articles fetched from RSS feeds
    totalProcessed: 0, // Total articles processed through AI
    highCriticalSaved: 0, // Total HIGH/CRITICAL articles saved to database
    criticalSaved: 0, // Total CRITICAL articles saved
    highSaved: 0, // Total HIGH articles saved
    lastFeedCheck: null, // Timestamp of last RSS feed check
    articlesFilteredOld: 0, // Articles filtered out due to age (>24h)
    articlesFilteredAlreadyProcessed: 0, // Articles filtered out as already processed
    recentArticlesCount: 0, // Count of articles from last 24 hours
  },
};

// ============================================================================
// LOG STREAMER CLASS
// ============================================================================

/**
 * LogStreamer Class - Real-time Log Streaming System
 *
 * This class provides real-time log streaming functionality using Server-Sent Events (SSE).
 * It captures all console output and streams it to connected browser clients, enabling
 * real-time monitoring of the RSS service operations.
 *
 * Key Features:
 * - Intercepts all console methods (log, error, warn, info, debug)
 * - Maintains a rolling buffer of recent log entries
 * - Streams logs to multiple connected clients simultaneously
 * - Handles client connections and disconnections gracefully
 * - Provides statistics about connected clients and buffer usage
 *
 * Usage:
 * - Clients connect via GET /logs/stream endpoint
 * - All console output is automatically captured and streamed
 * - Logs are formatted with timestamps and severity levels
 * - Buffer automatically manages memory by limiting stored entries
 */
class LogStreamer extends EventEmitter {
  /**
   * Initialize the LogStreamer
   * Sets up client tracking, log buffer, and console method interception
   */
  constructor() {
    super();

    // ========================================================================
    // CLIENT AND BUFFER MANAGEMENT
    // ========================================================================

    this.clients = new Set(); // Set of connected SSE clients
    this.logBuffer = []; // Rolling buffer of recent log entries
    this.maxBufferSize = 1000; // Maximum number of log entries to keep in buffer

    // ========================================================================
    // CONSOLE METHOD BACKUP
    // ========================================================================

    /**
     * Store original console methods before overriding them
     * This allows us to restore original functionality if needed
     */
    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };

    // Initialize console method interception
    this.setupConsoleCapture();
  }

  /**
   * Setup console method interception
   * Overrides all console methods to capture and stream their output
   * while preserving original functionality
   */
  setupConsoleCapture() {
    const self = this;

    /**
     * Create a wrapper function for console methods
     * This wrapper calls the original method and then captures the output
     * for streaming to connected clients
     *
     * @param {string} methodName - Name of the console method (log, error, etc.)
     * @param {Function} originalMethod - Original console method to preserve
     * @returns {Function} Wrapped console method
     */
    const wrapConsoleMethod = (methodName, originalMethod) => {
      return function (...args) {
        // Call the original console method to preserve normal functionality
        originalMethod.apply(console, args);

        // Create structured log entry for streaming
        const logEntry = {
          timestamp: new Date().toISOString(), // ISO timestamp for precise timing
          level: methodName.toUpperCase(), // Log level (LOG, ERROR, WARN, etc.)
          message: args // Processed message content
            .map(
              (arg) =>
                typeof arg === "object"
                  ? JSON.stringify(arg, null, 2) // Pretty-print objects
                  : String(arg) // Convert other types to string
            )
            .join(" "), // Join multiple arguments with spaces
          raw_args: args, // Keep original arguments for debugging
        };

        // Add to buffer and emit event for streaming
        self.addToBuffer(logEntry);
        self.emit("log", logEntry);
      };
    };

    // Override all console methods with wrapped versions
    console.log = wrapConsoleMethod("log", this.originalConsole.log);
    console.error = wrapConsoleMethod("error", this.originalConsole.error);
    console.warn = wrapConsoleMethod("warn", this.originalConsole.warn);
    console.info = wrapConsoleMethod("info", this.originalConsole.info);
    console.debug = wrapConsoleMethod("debug", this.originalConsole.debug);
  }

  /**
   * Add log entry to the rolling buffer
   * Maintains a fixed-size buffer by removing oldest entries when limit is exceeded
   *
   * @param {Object} logEntry - Log entry object with timestamp, level, and message
   */
  addToBuffer(logEntry) {
    this.logBuffer.push(logEntry);

    // Maintain buffer size limit by keeping only the most recent entries
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }
  }

  /**
   * Add a new client to the log streaming system
   * Sets up Server-Sent Events (SSE) connection and sends existing log buffer
   *
   * @param {Object} response - Express response object for SSE connection
   * @returns {Object} Client object with connection details
   */
  addClient(response) {
    // Generate unique client ID
    const clientId = Date.now() + Math.random();
    const client = {
      id: clientId,
      response: response,
      connected: true,
    };

    // Add client to tracking set
    this.clients.add(client);

    // Set up SSE headers for real-time streaming
    response.writeHead(200, {
      "Content-Type": "text/event-stream", // SSE content type
      "Cache-Control": "no-cache, no-transform", // Disable caching
      Connection: "keep-alive", // Keep connection alive
      "Access-Control-Allow-Origin": "*", // Allow cross-origin requests
      "Access-Control-Allow-Methods": "GET, OPTIONS", // Allowed HTTP methods
      // Allowed request headers
      "Access-Control-Allow-Headers":
        "Accept, Cache-Control, Content-Type, X-Requested-With",
      "Access-Control-Expose-Headers": "Content-Type", // Exposed response headers
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // Send connection confirmation message
    this.sendToClient(client, {
      timestamp: new Date().toISOString(),
      type: "Info",
      message: "Connected to BlackSwan RSS Monitoring Stream",
    });

    // Send existing log buffer to new client
    this.logBuffer.forEach((logEntry) => {
      this.sendToClient(client, logEntry);
    });

    // Handle client disconnection
    response.on("close", () => {
      client.connected = false;
      this.clients.delete(client);
    });

    return client;
  }

  /**
   * Send log entry to a specific client via Server-Sent Events
   * Handles connection errors gracefully by removing disconnected clients
   *
   * @param {Object} client - Client object with connection details
   * @param {Object} logEntry - Log entry to send
   */
  sendToClient(client, logEntry) {
    // Skip if client is no longer connected
    if (!client.connected) return;

    try {
      // Format log entry as SSE data
      const data = JSON.stringify(logEntry);
      client.response.write(`data: ${data}\n\n`);
    } catch (error) {
      // Remove client on write error (connection likely closed)
      client.connected = false;
      this.clients.delete(client);
    }
  }

  /**
   * Broadcast log entry to all connected clients
   * Cleans up disconnected clients and sends log to active connections
   *
   * @param {Object} logEntry - Log entry to broadcast
   */
  broadcastLog(logEntry) {
    // Clean up disconnected clients
    const disconnectedClients = Array.from(this.clients).filter(
      (client) => !client.connected
    );
    disconnectedClients.forEach((client) => this.clients.delete(client));

    // Send log entry to all active clients
    this.clients.forEach((client) => {
      this.sendToClient(client, logEntry);
    });
  }

  /**
   * Get statistics about the log streaming system
   * Returns information about connected clients and buffer usage
   *
   * @returns {Object} Statistics object with client and buffer information
   */
  getStats() {
    return {
      connectedClients: this.clients.size, // Number of active SSE connections
      bufferSize: this.logBuffer.length, // Current number of entries in buffer
      maxBufferSize: this.maxBufferSize, // Maximum buffer size limit
    };
  }

  /**
   * Restore original console methods
   * Used during graceful shutdown to restore normal console functionality
   */
  restoreOriginalConsole() {
    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    console.info = this.originalConsole.info;
    console.debug = this.originalConsole.debug;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract JSON content from Perplexity AI response
 *
 * Perplexity AI responses may contain JSON wrapped in markdown code blocks
 * or mixed with other text. This function attempts to extract clean JSON
 * from various response formats.
 *
 * @param {string} content - Raw response content from Perplexity AI
 * @returns {string} Extracted JSON string
 */
function extractJsonFromResponse(content) {
  content = content.trim();

  // Patterns to match JSON wrapped in markdown code blocks
  const patterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/i, // Standard markdown code blocks
    /`{3}(?:json)?\s*\n?([\s\S]*?)\n?`{3}/i, // Alternative markdown format
    /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im, // Full content wrapped in code blocks
  ];

  // Try to extract JSON from markdown code blocks
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // Remove backticks if present
  content = content.replace(/^`+|`+$/g, "");

  // Find JSON object boundaries
  const jsonStartIndex = content.indexOf("{");
  const jsonEndIndex = content.lastIndexOf("}");

  // Extract JSON if valid boundaries found
  if (
    jsonStartIndex !== -1 &&
    jsonEndIndex !== -1 &&
    jsonEndIndex > jsonStartIndex
  ) {
    return content.substring(jsonStartIndex, jsonEndIndex + 1);
  }

  // Return original content if no JSON found
  return content;
}

/**
 * Sanitize XML content for safe parsing
 *
 * RSS feeds may contain malformed XML with unescaped characters that can
 * cause parsing errors. This function escapes common problematic characters
 * to ensure XML parsing succeeds.
 *
 * @param {string} xmlContent - Raw XML content from RSS feed
 * @returns {string} Sanitized XML content safe for parsing
 */
function sanitizeXML(xmlContent) {
  return xmlContent
    .replace(/&(?![a-zA-Z0-9#]+;)/g, "&amp;") // Escape unescaped ampersands
    .replace(/"/g, '"') // Escape smart quotes
    .replace(/"/g, '"') // Escape smart quotes
    .replace(/'/g, "'") // Escape smart apostrophes
    .replace(/'/g, "'") // Escape smart apostrophes
    .replace(/©/g, "&#169;") // Escape copyright symbol
    .replace(/&([^;]+)(?![;])/g, "&amp;$1"); // Escape malformed entities
}

// ============================================================================
// RSS FEED FETCHER CLASS
// ============================================================================

/**
 * RSSFeedFetcher Class - RSS Feed Processing and Parsing
 *
 * This class handles fetching and parsing RSS feeds from various news sources.
 * It provides methods to fetch individual feeds or all configured feeds,
 * with proper error handling and XML parsing.
 *
 * Key Features:
 * - Fetches RSS feeds from multiple news sources
 * - Parses XML content using xml2js library
 * - Handles malformed XML with sanitization
 * - Provides structured article data with metadata
 * - Includes error handling for network and parsing issues
 *
 * RSS Sources:
 * - Reuters (via Google News RSS)
 * - Associated Press (via Google News RSS)
 * - CoinDesk (direct RSS feed)
 * - CoinTelegraph (direct RSS feed)
 */
class RSSFeedFetcher {
  /**
   * Initialize the RSS Feed Fetcher
   * Sets up XML parser with configuration optimized for RSS feeds
   */
  constructor() {
    /**
     * XML2JS Parser Configuration
     * Optimized settings for parsing RSS feeds reliably
     */
    this.parser = new xml2js.Parser({
      explicitArray: true, // Always return arrays for elements
      ignoreAttrs: false, // Include XML attributes in parsed objects
      trim: true, // Remove whitespace from text content
      normalize: true, // Normalize whitespace in text nodes
      normalizeTags: false, // Keep original tag case (RSS is case-sensitive)
      explicitRoot: true, // Include root element in parsed object
    });
  }

  /**
   * Fetch and parse a single RSS feed
   *
   * Downloads RSS feed content, sanitizes XML, parses it into structured data,
   * and returns normalized article objects with metadata.
   *
   * @param {string} feedUrl - URL of the RSS feed to fetch
   * @param {string} feedName - Human-readable name of the feed source
   * @returns {Object} Object containing feed metadata and parsed articles
   * @throws {Error} If feed fetch or parsing fails
   */
  async fetchFeed(feedUrl, feedName) {
    try {
      console.log(`📡 [RSS] Fetching ${feedName} feed from ${feedUrl}...`);

      // Fetch RSS feed with timeout and proper user agent
      const response = await axios.get(feedUrl, {
        timeout: 30000, // 30 second timeout
        headers: {
          "User-Agent": "BlackSwan RSS Monitor/2.0.0", // Identify our service
        },
      });

      // Sanitize XML content to handle malformed feeds
      let xmlData = response.data;
      xmlData = sanitizeXML(xmlData);

      // Parse XML into JavaScript object
      const result = await this.parser.parseStringPromise(xmlData);

      // Validate RSS feed structure
      if (
        !result.rss ||
        !result.rss.channel ||
        !result.rss.channel[0] ||
        !result.rss.channel[0].item
      ) {
        throw new Error(`Invalid RSS feed structure for ${feedName}`);
      }

      // Extract articles from RSS feed
      const items = result.rss.channel[0].item;
      console.log(`📊 [RSS] Found ${items.length} items in ${feedName} feed`);

      // Parse and normalize each article
      const parsedItems = items.map((item, index) => {
        /**
         * Helper function to safely extract field values from RSS items
         * Handles various RSS formats and missing fields gracefully
         *
         * @param {*} field - RSS field value (can be string, object, or array)
         * @param {string} fallback - Default value if field is missing
         * @returns {string} Extracted field value
         */
        const getFieldValue = (field, fallback = "") => {
          if (!field) return fallback;
          if (Array.isArray(field) && field.length > 0) {
            return field[0]._ || field[0] || fallback;
          }
          return field._ || field || fallback;
        };

        // Create normalized article object
        return {
          id: `${feedName}-${index}`, // Unique article ID
          guid: getFieldValue(item.guid, `${feedName}-${Date.now()}-${index}`), // Global unique identifier
          title: getFieldValue(item.title, "No title"), // Article title
          link: getFieldValue(item.link, "No link"), // Article URL
          pubDate: getFieldValue(item.pubDate, new Date().toISOString()), // Publication date
          description: getFieldValue(item.description, "No description"), // Article description
          source: feedName, // Source feed name
          fetchedAt: new Date().toISOString(), // Fetch timestamp
        };
      });

      // Return structured feed data
      return {
        feedName, // Source feed name
        feedUrl, // Feed URL
        articles: parsedItems, // Array of parsed articles
        fetchedAt: new Date().toISOString(), // Fetch timestamp
      };
    } catch (error) {
      console.error(`❌ [RSS] Error fetching ${feedName} feed:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch all configured RSS feeds
   *
   * Iterates through all configured RSS feeds and fetches them in sequence.
   * If one feed fails, the process continues with the remaining feeds to
   * ensure maximum data collection reliability.
   *
   * @returns {Array} Array of successfully fetched feed data objects
   */
  async fetchAllFeeds() {
    const results = [];

    // Process each configured RSS feed
    for (const feed of CONFIG.RSS_FEEDS) {
      try {
        // Fetch individual feed
        const feedData = await this.fetchFeed(feed.url, feed.name);
        results.push(feedData);
      } catch (error) {
        // Log error but continue with other feeds
        console.error(`❌ [RSS] Failed to fetch ${feed.name}:`, error.message);
        // Continue with other feeds even if one fails
      }
    }

    return results;
  }
}

// ============================================================================
// ARTICLE PROCESSOR CLASS
// ============================================================================

/**
 * ArticleProcessor Class - AI-Powered Article Analysis
 *
 * This class handles processing RSS articles through Perplexity AI to analyze
 * their potential impact on cryptocurrency markets. It processes articles in
 * batches to manage API rate limits and provides structured analysis results.
 *
 * Key Features:
 * - Processes articles in configurable chunks for optimal performance
 * - Uses Perplexity AI for market impact analysis and summarization
 * - Classifies articles as CRITICAL, HIGH, NORMAL, LOW, or NOT RELEVANT
 * - Handles API errors gracefully with fallback processing
 * - Provides detailed logging for monitoring and debugging
 *
 * Market Impact Classification:
 * - CRITICAL: Major regulatory decisions, institutional adoption/rejection, major hacks
 * - HIGH: Regulatory announcements, institutional investments, major tech developments
 * - NORMAL: General financial news, traditional market movements, minor policy updates
 * - LOW: Company earnings (non-crypto), minor political events, sports/entertainment
 * - NOT RELEVANT: Sports, entertainment, local news, weather, science discoveries
 */
class ArticleProcessor {
  /**
   * Initialize the Article Processor
   * Sets up processing counters and configuration
   */
  constructor() {
    this.processedCount = 0; // Track total articles processed
  }

  async processArticles(articles) {
    if (!articles || articles.length === 0) {
      console.log(`📝 [PROCESSOR] No articles to process`);
      return [];
    }

    try {
      const CHUNK_SIZE = CONFIG.CHUNK_SIZE;
      const chunks = [];

      // Split articles into chunks
      for (let i = 0; i < articles.length; i += CHUNK_SIZE) {
        chunks.push(articles.slice(i, i + CHUNK_SIZE));
      }

      console.log(
        `🚀 [PROCESSOR] Processing ${articles.length} articles in ${chunks.length} chunks of ${CHUNK_SIZE} articles each...`
      );

      const allProcessedArticles = [];

      // Process each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        console.log(
          `🔍 [PROCESSOR] Processing chunk ${chunkIndex + 1}/${
            chunks.length
          } (${chunk.length} articles)...`
        );

        try {
          const processedChunk = await this.processArticleChunk(
            chunk,
            chunkIndex + 1,
            chunks.length
          );
          allProcessedArticles.push(...processedChunk);

          console.log(
            `✅ [PROCESSOR] Completed chunk ${chunkIndex + 1}/${
              chunks.length
            }. Total processed: ${allProcessedArticles.length}/${
              articles.length
            }`
          );

          // Small delay between chunks
          if (chunkIndex < chunks.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (chunkError) {
          console.error(
            `❌ [PROCESSOR] Error processing chunk ${chunkIndex + 1}:`,
            chunkError.message
          );

          // Add error entries for failed chunk
          const errorChunk = chunk.map((article) => ({
            title: article.title,
            summary: `Error processing chunk ${chunkIndex + 1}: ${
              chunkError.message
            }`,
            market_impact: "LOW",
            date: article.pubDate,
            guid: article.guid,
            source: article.source,
            link: article.link,
            fetchedAt: article.fetchedAt,
          }));

          allProcessedArticles.push(...errorChunk);
        }
      }

      return allProcessedArticles;
    } catch (error) {
      console.error(
        `❌ [PROCESSOR] Error in article processing:`,
        error.message
      );

      // Return error format for all articles
      return articles.map((article) => ({
        title: article.title,
        summary: "Error occurred during processing",
        market_impact: "LOW",
        date: article.pubDate,
        guid: article.guid,
        source: article.source,
        link: article.link,
        fetchedAt: article.fetchedAt,
      }));
    }
  }

  async processArticleChunk(articles, chunkNumber, totalChunks) {
    try {
      // Create a simple list of articles with just essential info
      const articlesList = articles
        .map(
          (article, index) =>
            `${index + 1}. "${article.title}" (${article.source}, ${
              article.pubDate
            })`
        )
        .join("\n");

      console.log(
        `🔍 [DEBUG] Processing chunk ${chunkNumber}/${totalChunks} with ${articles.length} articles`
      );

      const response = await axios.post(
        `${CONFIG.OPENROUTER_BASE_URL}/chat/completions`,
        {
          model: "perplexity/sonar",
          messages: [
            {
              role: "user",
              content: `I have ${articles.length} news article headlines from an RSS feed (chunk ${chunkNumber}/${totalChunks}). For each headline, provide:
1. A concise 3-5 sentence summary explaining what happened and key details
2. Crypto market impact classification (CRITICAL, HIGH, NORMAL, LOW, NOT RELEVANT)

Here are the articles:

${articlesList}

Please provide a JSON response for ALL ${articles.length} articles in this format:

{
  "articles": [
    {
      "title": "Original article title",
      "summary": "Concise 3-5 sentence summary of what happened and key details",
      "market_impact": "CRITICAL or HIGH or NORMAL or LOW or NOT RELEVANT",
      "date": "Publication date"
    }
  ]
}

CRYPTO MARKET IMPACT CLASSIFICATION:
- CRITICAL: Major regulatory decisions, large institutional adoption/rejection, major exchange hacks, government bans, major economic crises
- HIGH: Regulatory announcements, institutional investments, major tech developments, significant economic policy changes
- NORMAL: General financial news, traditional market movements, minor policy updates, standard business news
- LOW: Company earnings (non-crypto), minor political events, sports, entertainment news with slight economic implications
- NOT RELEVANT: Sports, entertainment, local news, weather, science discoveries with no economic impact

IMPORTANT:
- Provide exactly ${articles.length} articles in the same order as listed above
- Keep summaries to 3-5 sentences maximum
- market_impact must be EXACTLY one of: CRITICAL, HIGH, NORMAL, LOW, NOT RELEVANT
- Focus classification on potential impact to cryptocurrency prices, adoption, regulation, or trading
- Return only valid JSON, no markdown formatting`,
            },
          ],
          max_tokens: 100000,
        },
        {
          headers: {
            Authorization: `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "X-Title": "BlackSwan RSS Monitoring",
          },
          timeout: 300000, // 5 minute timeout
        }
      );

      // Check if the response has the expected structure
      if (
        !response.data ||
        !response.data.choices ||
        response.data.choices.length === 0
      ) {
        throw new Error(
          `Invalid Perplexity API response structure for chunk ${chunkNumber}`
        );
      }

      if (
        !response.data.choices[0].message ||
        !response.data.choices[0].message.content
      ) {
        throw new Error(
          `No content in Perplexity response for chunk ${chunkNumber}`
        );
      }

      const content = response.data.choices[0].message.content.trim();
      const jsonContent = extractJsonFromResponse(content);

      try {
        const responseData = JSON.parse(jsonContent);

        console.log(
          `✅ [PROCESSOR] Chunk ${chunkNumber} parsed successfully with ${
            responseData.articles?.length || 0
          } articles`
        );

        // Return the articles with additional metadata
        const processedArticles = responseData.articles || [];
        return processedArticles.map((processedArticle, index) => ({
          ...processedArticle,
          guid: articles[index]?.guid,
          source: articles[index]?.source,
          link: articles[index]?.link,
          fetchedAt: articles[index]?.fetchedAt,
        }));
      } catch (parseError) {
        console.error(
          `❌ [PROCESSOR] Failed to parse JSON for chunk ${chunkNumber}:`,
          parseError.message
        );

        // Return error format for this chunk
        return articles.map((article) => ({
          title: article.title,
          summary: `Failed to parse chunk ${chunkNumber} response`,
          market_impact: "LOW",
          date: article.pubDate,
          guid: article.guid,
          source: article.source,
          link: article.link,
          fetchedAt: article.fetchedAt,
        }));
      }
    } catch (error) {
      console.error(
        `❌ [PROCESSOR] Error in chunk ${chunkNumber}:`,
        error.message
      );

      // Return error format for this chunk
      return articles.map((article) => ({
        title: article.title,
        summary: `Error in chunk ${chunkNumber}: ${error.message}`,
        market_impact: "LOW",
        date: article.pubDate,
        guid: article.guid,
        source: article.source,
        link: article.link,
        fetchedAt: article.fetchedAt,
      }));
    }
  }
}

/**
 * Firestore Database Manager
 */
class DatabaseManager {
  constructor() {
    this.collection = db.collection("rss_feeds");
  }

  async saveArticle(article) {
    try {
      const docData = {
        title: article.title,
        summary: article.summary,
        market_impact: article.market_impact,
        publication_date: new Date(article.date),
        fetch_date: new Date(article.fetchedAt),
        source: article.source,
        link: article.link,
        guid: article.guid,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await this.collection.add(docData);
      console.log(`💾 [DB] Saved article to Firestore: ${docRef.id}`);
      return docRef.id;
    } catch (error) {
      console.error(
        `❌ [DB] Error saving article to Firestore:`,
        error.message
      );
      throw error;
    }
  }

  async saveHighCriticalArticles(articles) {
    const highCriticalArticles = articles.filter(
      (article) =>
        article.market_impact === "HIGH" || article.market_impact === "CRITICAL"
    );

    const criticalArticles = articles.filter(
      (article) => article.market_impact === "CRITICAL"
    );

    if (highCriticalArticles.length === 0) {
      console.log(`📊 [DB] No HIGH/CRITICAL articles to save`);
      return { savedIds: [], criticalCount: 0 };
    }

    console.log(
      `💾 [DB] Saving ${highCriticalArticles.length} HIGH/CRITICAL articles to Firestore...`
    );
    console.log(
      `🚨 [DB] Found ${criticalArticles.length} CRITICAL articles (trigger immediate analysis)`
    );

    const savedIds = [];
    for (const article of highCriticalArticles) {
      try {
        const docId = await this.saveArticle(article);
        savedIds.push(docId);
      } catch (error) {
        console.error(
          `❌ [DB] Failed to save article: ${article.title}`,
          error.message
        );
      }
    }

    console.log(
      `✅ [DB] Successfully saved ${savedIds.length}/${highCriticalArticles.length} articles to Firestore`
    );

    return {
      savedIds: savedIds,
      criticalCount: criticalArticles.length,
      highCount: highCriticalArticles.length - criticalArticles.length,
    };
  }

  async getRecentHighCriticalArticles(hours = 24) {
    try {
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

      const snapshot = await this.collection
        .where("fetch_date", ">=", cutoffTime)
        .where("market_impact", "in", ["HIGH", "CRITICAL"])
        .orderBy("fetch_date", "desc")
        .get();

      const articles = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        articles.push({
          id: doc.id,
          title: data.title,
          summary: data.summary,
          market_impact: data.market_impact,
          date: data.publication_date.toDate().toISOString(),
          source: data.source,
          link: data.link,
          fetchedAt: data.fetch_date.toDate().toISOString(),
          createdAt: data.created_at?.toDate()?.toISOString(),
        });
      });

      console.log(
        `📊 [DB] Retrieved ${articles.length} HIGH/CRITICAL articles from last ${hours} hours`
      );
      return articles;
    } catch (error) {
      console.error(`❌ [DB] Error retrieving recent articles:`, error.message);
      throw error;
    }
  }
}

// Initialize components
const logStreamer = new LogStreamer();
const feedFetcher = new RSSFeedFetcher();
const articleProcessor = new ArticleProcessor();
const databaseManager = new DatabaseManager();

// Setup log event handlers
logStreamer.on("log", (logEntry) => {
  logStreamer.broadcastLog(logEntry);
});

/**
 * Helper function to check if article is within last 24 hours
 */
function isWithinLast24Hours(pubDate) {
  try {
    const articleDate = new Date(pubDate);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return articleDate >= twentyFourHoursAgo;
  } catch (error) {
    console.warn(
      `⚠️ [FILTER] Invalid date format: ${pubDate}, including article anyway`
    );
    return true; // Include if we can't parse the date
  }
}

/**
 * Core monitoring function
 */
async function monitorFeeds() {
  if (monitoringState.isRunning) {
    console.log(
      `⏳ [MONITOR] Previous monitoring cycle still running, skipping...`
    );
    return;
  }

  try {
    monitoringState.isRunning = true;
    monitoringState.lastRun = new Date().toISOString();

    console.log(`🚀 [MONITOR] Starting RSS feed monitoring cycle...`);

    // Fetch all RSS feeds
    const feedResults = await feedFetcher.fetchAllFeeds();

    if (feedResults.length === 0) {
      console.log(`❌ [MONITOR] No feeds successfully fetched`);
      return;
    }

    // Combine all articles from all feeds
    let allArticles = [];
    feedResults.forEach((feedResult) => {
      allArticles.push(...feedResult.articles);
    });

    monitoringState.stats.totalFetched = allArticles.length;
    console.log(
      `📊 [MONITOR] Fetched ${allArticles.length} total articles from ${feedResults.length} feeds`
    );

    // STEP 1: Filter articles to only last 24 hours
    const recentArticles = allArticles.filter((article) =>
      isWithinLast24Hours(article.pubDate)
    );
    const oldArticlesCount = allArticles.length - recentArticles.length;

    // Update stats
    monitoringState.stats.articlesFilteredOld = oldArticlesCount;
    monitoringState.stats.recentArticlesCount = recentArticles.length;

    if (oldArticlesCount > 0) {
      console.log(
        `🕒 [FILTER] Filtered out ${oldArticlesCount} articles older than 24 hours`
      );
    }
    console.log(
      `📅 [FILTER] ${recentArticles.length} articles from last 24 hours`
    );

    // STEP 2: Filter out already processed articles
    const unprocessedArticles = recentArticles.filter(
      (article) => !monitoringState.knownArticles.has(article.guid)
    );
    const alreadyProcessedCount =
      recentArticles.length - unprocessedArticles.length;

    // Update stats
    monitoringState.stats.articlesFilteredAlreadyProcessed =
      alreadyProcessedCount;

    if (alreadyProcessedCount > 0) {
      console.log(
        `🔄 [FILTER] Filtered out ${alreadyProcessedCount} already processed articles`
      );
    }

    if (unprocessedArticles.length === 0) {
      console.log(
        `📊 [MONITOR] No new articles to process (all recent articles already processed)`
      );
      monitoringState.stats.lastFeedCheck = new Date().toISOString();
      return;
    }

    console.log(
      `🆕 [MONITOR] Found ${unprocessedArticles.length} new articles to process`
    );
    console.log(
      `📋 [MONITOR] Processing pipeline: ${allArticles.length} total → ${recentArticles.length} recent → ${unprocessedArticles.length} new`
    );

    // Add new articles to known set BEFORE processing to prevent duplicate processing
    unprocessedArticles.forEach((article) => {
      monitoringState.knownArticles.add(article.guid);
    });

    // Clean up old entries from knownArticles cache (keep only last 48 hours worth to prevent memory bloat)
    if (monitoringState.knownArticles.size > 5000) {
      console.log(
        `🧹 [CACHE] Clearing article cache (size: ${monitoringState.knownArticles.size}) to prevent memory bloat`
      );
      monitoringState.knownArticles.clear();
      // Re-add current batch
      unprocessedArticles.forEach((article) => {
        monitoringState.knownArticles.add(article.guid);
      });
    }

    // Process articles through Perplexity
    const processedArticles = await articleProcessor.processArticles(
      unprocessedArticles
    );
    monitoringState.stats.totalProcessed += processedArticles.length;

    // Save HIGH/CRITICAL articles to Firestore
    const saveResult = await databaseManager.saveHighCriticalArticles(
      processedArticles
    );
    monitoringState.stats.highCriticalSaved += saveResult.savedIds.length;
    monitoringState.stats.criticalSaved += saveResult.criticalCount;
    monitoringState.stats.highSaved += saveResult.highCount;

    // Only set new articles flag for CRITICAL articles (immediate trigger)
    if (saveResult.criticalCount > 0) {
      console.log(
        `🚨 [MONITOR] ${saveResult.criticalCount} CRITICAL articles detected - triggering immediate monitoring!`
      );
      monitoringState.newArticlesFound = true;
    } else {
      console.log(
        `📋 [MONITOR] No CRITICAL articles found - saved ${saveResult.highCount} HIGH articles for regular monitoring cycle`
      );
    }

    monitoringState.totalArticlesProcessed += processedArticles.length;
    monitoringState.stats.lastFeedCheck = new Date().toISOString();

    console.log(
      `✅ [MONITOR] Monitoring cycle completed. Processed ${processedArticles.length} articles, saved ${savedIds.length} HIGH/CRITICAL articles`
    );
  } catch (error) {
    console.error(`❌ [MONITOR] Error in monitoring cycle:`, error.message);
  } finally {
    monitoringState.isRunning = false;
  }
}

// Setup cron job for monitoring
console.log(
  `⏰ [CRON] Setting up RSS monitoring cron job: ${CONFIG.MONITORING_INTERVAL}`
);
cron.schedule(CONFIG.MONITORING_INTERVAL, monitorFeeds);

// API Routes

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "BlackSwan RSS Monitoring Service",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    monitoring_status: monitoringState.isRunning ? "running" : "idle",
    last_run: monitoringState.lastRun,
    total_articles_processed: monitoringState.totalArticlesProcessed,
    new_articles_available: monitoringState.newArticlesFound,
    stats: monitoringState.stats,
  });
});

/**
 * Get recent HIGH/CRITICAL articles from last 24 hours
 */
app.get("/api/articles/recent", async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const articles = await databaseManager.getRecentHighCriticalArticles(hours);

    res.json({
      success: true,
      articles: articles,
      count: articles.length,
      timeframe_hours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ [API] Error fetching recent articles:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch recent articles",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Check if new CRITICAL articles are available (triggers immediate monitoring)
 * HIGH articles are saved but don't trigger this flag
 */
app.get("/api/articles/new", (req, res) => {
  const hasNewArticles = monitoringState.newArticlesFound;

  // If there are new articles, start a 30-second timer to reset the flag AFTER this response
  if (hasNewArticles) {
    console.log(
      `🕐 [API] New articles detected via API call, setting 30-second reset timer...`
    );

    // Clear any existing timer to prevent conflicts
    if (monitoringState.newArticleTimer) {
      clearTimeout(monitoringState.newArticleTimer);
      console.log(
        `🔄 [API] Cleared existing timer before setting new 30-second timer`
      );
    }

    // Set new 30-second timer to reset the flag
    monitoringState.newArticleTimer = setTimeout(() => {
      console.log(
        `⏰ [API] Resetting new articles flag after 30 seconds from API call`
      );
      monitoringState.newArticlesFound = false;
      monitoringState.newArticleTimer = null;
    }, CONFIG.API_RESET_TIMEOUT);
  }

  res.json({
    success: true,
    new_articles_available: hasNewArticles,
    last_check: monitoringState.stats.lastFeedCheck,
    monitoring_status: monitoringState.isRunning ? "running" : "idle",
    reset_timer_active: hasNewArticles ? "30_seconds" : "none",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Manually trigger monitoring (for testing)
 */
app.post("/api/monitor/trigger", async (req, res) => {
  try {
    if (monitoringState.isRunning) {
      return res.status(429).json({
        success: false,
        error: "Monitoring already in progress",
        message: "Please wait for current monitoring cycle to complete",
        timestamp: new Date().toISOString(),
      });
    }

    console.log("🔧 [API] Manual monitoring trigger requested");

    // Run monitoring in background
    monitorFeeds().catch((error) => {
      console.error("❌ [API] Error in manual monitoring:", error.message);
    });

    res.json({
      success: true,
      message: "Monitoring cycle triggered manually",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "❌ [API] Error triggering manual monitoring:",
      error.message
    );
    res.status(500).json({
      success: false,
      error: "Failed to trigger monitoring",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Get service statistics
 */
app.get("/api/stats", (req, res) => {
  try {
    const stats = {
      service_name: "BlackSwan RSS Monitoring Service",
      version: "2.0.0",
      uptime_seconds: process.uptime(),
      monitoring_status: monitoringState.isRunning ? "running" : "idle",
      last_run: monitoringState.lastRun,
      new_articles_available: monitoringState.newArticlesFound,
      total_articles_processed: monitoringState.totalArticlesProcessed,
      known_articles_count: monitoringState.knownArticles.size,
      rss_feeds: CONFIG.RSS_FEEDS,
      monitoring_interval: CONFIG.MONITORING_INTERVAL,
      detailed_stats: monitoringState.stats,
      logStreamer: logStreamer.getStats(),
      timestamp: new Date().toISOString(),
    };

    res.json(stats);
  } catch (error) {
    console.error("❌ [API] Error serving stats:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to retrieve service statistics",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Log streaming endpoint (Server-Sent Events)
 */
app.get("/logs/stream", (req, res) => {
  try {
    logStreamer.addClient(res);
  } catch (error) {
    console.error("❌ [LOG_STREAM] Error setting up stream:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to setup log stream",
      message: error.message,
    });
  }
});

// CORS preflight handlers
app.options("/logs/stream", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Cache-Control, Content-Type, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: "The requested endpoint does not exist",
    available_endpoints: [
      "GET /health",
      "GET /api/articles/recent",
      "GET /api/articles/new",
      "POST /api/monitor/trigger",
      "GET /api/stats",
      "GET /logs/stream",
    ],
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error("❌ [SERVER] Unhandled error:", error.message);
  res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred",
    timestamp: new Date().toISOString(),
  });
});

// Start the server
const server = app.listen(CONFIG.PORT, () => {
  console.log(
    `🚀 [SERVER] BlackSwan RSS Monitoring Service v2.0.0 running on port ${CONFIG.PORT}`
  );
  console.log(`🚀 [SERVER] Available endpoints:`);
  console.log(`   • GET  http://localhost:${CONFIG.PORT}/health`);
  console.log(
    `   • GET  http://localhost:${CONFIG.PORT}/api/articles/recent  - Get last 24h HIGH/CRITICAL articles`
  );
  console.log(
    `   • GET  http://localhost:${CONFIG.PORT}/api/articles/new     - Check for new articles`
  );
  console.log(
    `   • POST http://localhost:${CONFIG.PORT}/api/monitor/trigger  - Manual monitoring trigger`
  );
  console.log(
    `   • GET  http://localhost:${CONFIG.PORT}/api/stats           - Service statistics`
  );
  console.log(
    `   • GET  http://localhost:${CONFIG.PORT}/logs/stream         - Real-time log streaming (SSE)`
  );
  console.log(`📡 [RSS] Monitoring ${CONFIG.RSS_FEEDS.length} RSS feeds:`);
  CONFIG.RSS_FEEDS.forEach((feed) => {
    console.log(`   • ${feed.name}: ${feed.url}`);
  });
  console.log(`⏰ [CRON] Monitoring interval: ${CONFIG.MONITORING_INTERVAL}`);
  console.log(`💾 [DB] Using Firestore collection: rss_feeds`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 [SERVER] Received SIGTERM, shutting down gracefully...");
  logStreamer.restoreOriginalConsole();
  if (monitoringState.newArticleTimer) {
    clearTimeout(monitoringState.newArticleTimer);
  }
  server.close(() => {
    console.log("🛑 [SERVER] Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🛑 [SERVER] Received SIGINT, shutting down gracefully...");
  logStreamer.restoreOriginalConsole();
  if (monitoringState.newArticleTimer) {
    clearTimeout(monitoringState.newArticleTimer);
  }
  server.close(() => {
    console.log("🛑 [SERVER] Server closed");
    process.exit(0);
  });
});

module.exports = app;
