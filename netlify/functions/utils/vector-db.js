// functions/utils/vector-db.js

const axios = require('axios');
const { Pinecone } = require('@pinecone-database/pinecone');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Constants
const PINECONE_CACHE_TTL = 300000; // 5 minutes cache TTL
const TEMP_STORAGE_DIR = '/tmp'; // Netlify allows /tmp with restrictions
const CONVERSATIONS_FILE = path.join(TEMP_STORAGE_DIR, 'conversations.json');

// Cache variables
let pineconeIndex = null;
let pineconeLastInitTime = 0;

// Safe file operations
function safeFileOperation(operation, fallback) {
  try {
    return operation();
  } catch (error) {
    console.error('File operation failed:', error);
    return fallback;
  }
}

// Initialize Pinecone with caching for Netlify
async function initPinecone(apiKey, indexName) {
  const timeoutMs = 10000; // 10-second timeout

  try {
    const now = Date.now();
    console.log("[1] Starting Pinecone initialization...");

    // Return cached instance if valid
    // if (pineconeIndex && now - pineconeLastInitTime < PINECONE_CACHE_TTL) {
    //   console.log("Using cached Pinecone client");
    //   return pineconeIndex;
    // }

    console.log("[2] Initializing new Pinecone client...");

    // Validate API key
    if (!apiKey) {
      console.error("Missing Pinecone API key");
      throw new Error("Pinecone API key is required");
    }

    // Initialize with timeout
    const pinecone = new Pinecone({
      apiKey: apiKey
    });

    console.log(`[3] Validating Pinecone index: ${indexName}`);

    // // Create a timeout promise
    // const timeoutPromise = new Promise((_, reject) => {
    //   setTimeout(() => reject(new Error(`Pinecone index validation timed out after ${timeoutMs}ms`)), timeoutMs);
    // });
    //
    // // Race between validation and timeout
    // try {
    //   console.log("test");
    //   await Promise.race([
    //     pinecone.describeIndex(indexName),
    //     timeoutPromise
    //   ]);
    //   console.log("Pinecone index validation successful");
    // } catch (indexError) {
    //   // Check if it's a timeout or another error
    //   if (indexError.message.includes("timed out")) {
    //     console.error(`Pinecone index validation timed out: ${indexError.message}`);
    //   } else {
    //     console.error(`Could not validate index ${indexName}: ${indexError.message}`);
    //   }

    //   // Still attempt to get the index even if validation fails
    //   console.warn("Proceeding without validation - this may cause issues if index doesn't exist");
    // }

    // Get index instance
    console.log(`[4] Getting Pinecone index instance for: ${indexName}`);
    const pineconeIndex = pinecone.index(indexName=indexName,
        host=`https://${indexName}-w9ktixk.svc.aped-4627-b74a.pinecone.io`);

    // Update cache timestamp
    // pineconeLastInitTime = now;
    console.log("[5] Pinecone client initialization complete");

    return pineconeIndex;
  } catch (error) {
    console.error(`Failed to initialize Pinecone: ${error.message}`);
    console.error(error.stack);

    // If we have a cached index, use it as fallback
    if (pineconeIndex) {
      console.log("Using cached Pinecone index as fallback after error");
      return pineconeIndex;
    }

    throw error;
  }
}

// Store conversation in Pinecone
async function storeConversationInPinecone(question, answer, sessionId, apiKey, indexName, embeddingFn) {
  try {
    console.log("Attempting to store conversation in Pinecone...");

    // Skip Pinecone in development mode
    if (process.env.NODE_ENV === 'development' || !apiKey) {
      console.log("Development mode or missing API key - skipping Pinecone, using local storage");
      return await storeConversationLocally(question, answer, sessionId);
    }

    // Get embedding for the Q&A pair
    const combinedText = `Question: ${question}\nAnswer: ${answer}`;
    let embedding;

    try {
      embedding = await embeddingFn(combinedText);
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid embedding result");
      }
    } catch (embeddingError) {
      console.error("Failed to generate embedding:", embeddingError);
      return await storeConversationLocally(question, answer, sessionId);
    }

    // Initialize Pinecone
    const index = await initPinecone(apiKey, indexName);

    // Create record
    const record = {
      id: crypto.randomUUID(),
      values: embedding,
      metadata: {
        content: combinedText,
        question: question,
        answer: answer,
        sessionId: sessionId,
        timestamp: new Date().toISOString(),
        source: 'conversation_history'
      }
    };

    // Upsert to Pinecone
    await index.upsert([record]);

    console.log("Conversation stored in Pinecone successfully");
    return true;
  } catch (error) {
    console.error("Error storing in Pinecone:", error);
    // Fall back to local storage
    return await storeConversationLocally(question, answer, sessionId);
  }
}

// Local storage fallback
async function storeConversationLocally(question, answer, sessionId) {
  try {
    const conversationEntry = {
      id: crypto.randomUUID(),
      sessionId: sessionId,
      question: question,
      answer: answer,
      timestamp: new Date().toISOString()
    };

    // Ensure directory exists
    safeFileOperation(() => {
      if (!fs.existsSync(TEMP_STORAGE_DIR)) {
        fs.mkdirSync(TEMP_STORAGE_DIR, { recursive: true });
      }
    }, null);

    let conversations = [];
    if (safeFileOperation(() => fs.existsSync(CONVERSATIONS_FILE), false)) {
      try {
        const data = safeFileOperation(() => fs.readFileSync(CONVERSATIONS_FILE, 'utf8'), '[]');
        conversations = JSON.parse(data);
      } catch (e) {
        // If parsing fails, use empty array
        conversations = [];
      }
    }

    conversations.push(conversationEntry);
    // Keep only the most recent 100 conversations
    if (conversations.length > 100) {
      conversations = conversations.slice(-100);
    }

    safeFileOperation(() => {
      fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations));
    }, null);

    console.log("Conversation stored locally as fallback");
    return true;
  } catch (error) {
    console.error("Failed to store conversation locally:", error);
    return false;
  }
}

// Query conversations by similarity
async function queryConversationsByVector(query, apiKey, indexName, embeddingFn, topK = 5) {
  try {
    // Get embedding for query
    const embedding = await embeddingFn(query);

    // Initialize Pinecone
    const index = await initPinecone(apiKey, indexName);

    // Query Pinecone
    const results = await index.query({
      vector: embedding,
      topK: topK,
      includeMetadata: true,
      filter: { source: "conversation_history" }
    });

    return results.matches.map(match => ({
      question: match.metadata.question,
      answer: match.metadata.answer,
      timestamp: match.metadata.timestamp,
      score: match.score
    }));
  } catch (error) {
    console.error("Failed to query conversations by vector:", error);

    // Fall back to local search if Pinecone fails
    return searchLocalConversations(query);
  }
}

// Simple local search as fallback
function searchLocalConversations(query) {
  try {
    if (!fs.existsSync(CONVERSATIONS_FILE)) {
      return [];
    }

    const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
    const conversations = JSON.parse(data);

    // Simple keyword matching (not vector similarity)
    const queryLower = query.toLowerCase();
    return conversations
      .filter(conv =>
        conv.question.toLowerCase().includes(queryLower) ||
        conv.answer.toLowerCase().includes(queryLower)
      )
      .slice(0, 5)
      .map(conv => ({
        question: conv.question,
        answer: conv.answer,
        timestamp: conv.timestamp,
        score: 0.5 // Placeholder score
      }));
  } catch (error) {
    console.error("Failed to search local conversations:", error);
    return [];
  }
}

module.exports = {
  initPinecone,
  storeConversationInPinecone,
  storeConversationLocally,
  queryConversationsByVector,
  searchLocalConversations
};