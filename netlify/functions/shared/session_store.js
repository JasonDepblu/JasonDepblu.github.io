// netlify/functions/shared/session_store.js
const fs = require('fs');
const path = require('path');
// Check if we're in a production environment
const isProduction = process.env.NODE_ENV === 'production';

// Use a more durable storage method in production if needed
if (isProduction) {
  // Initialize production storage here
  console.log("Using production session storage");
}

// File to store sessions (in /tmp for Netlify Functions)
const SESSIONS_FILE = path.join('/tmp', 'sessions.json');

// Load sessions from file
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
  return {};
}

// Save sessions to file
function saveSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (error) {
    console.error('Error saving sessions:', error);
  }
}

// Initialize sessions from file or empty object
const sessions = loadSessions();

module.exports = {
  sessions,

  getSession(sessionId) {
    // Reload from file to get latest data
    const currentSessions = loadSessions();
    return currentSessions[sessionId];
  },

  setSession(sessionId, data) {
    // Reload first to ensure we have latest data
    const currentSessions = loadSessions();
    currentSessions[sessionId] = data;
    saveSessions(currentSessions);
    // Update in-memory reference
    this.sessions[sessionId] = data;
    return data;
  },

  updateSession(sessionId, key, value) {
    // Reload first to ensure we have latest data
    const currentSessions = loadSessions();
    if (!currentSessions[sessionId]) {
      currentSessions[sessionId] = {};
    }
    currentSessions[sessionId][key] = value;
    saveSessions(currentSessions);
    // Update in-memory reference
    this.sessions[sessionId] = currentSessions[sessionId];
    return currentSessions[sessionId];
  },

  getAllSessions() {
    return loadSessions();
  }
};