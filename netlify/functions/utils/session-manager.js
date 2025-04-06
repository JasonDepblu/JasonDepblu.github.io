// functions/utils/session-manager.js

const path = require('path');
const fs = require('fs');

// Constants
const SESSION_DIR = '/tmp';
const SESSION_FILE = path.join(SESSION_DIR, 'sessions.json');
const DEBUG = process.env.NODE_ENV === 'development';

// Helper for logging
function log(...args) {
  if (DEBUG) console.log(...args);
}

// Robust file operations
function safeReadFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      log(`File read successfully, size: ${data.length} bytes`);
      return data;
    }
    log(`File doesn't exist: ${filePath}`);
    return null;
  } catch (error) {
    log(`Error reading file ${filePath}:`, error);
    return null;
  }
}

function safeParseJSON(jsonString) {
  if (!jsonString) return null;

  try {
    return JSON.parse(jsonString);
  } catch (error) {
    log("JSON parse error:", error);
    return null;
  }
}

function safeWriteFile(filePath, data) {
  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data));
    log(`File written successfully: ${filePath}`);
    return true;
  } catch (error) {
    log(`Error writing file ${filePath}:`, error);
    return false;
  }
}

// Read all sessions
function readSessions() {
  try {
    log(`Attempting to read sessions from: ${SESSION_FILE}`);

    // Try to read file
    const data = safeReadFile(SESSION_FILE);

    // If file doesn't exist or is empty, return empty object
    if (!data) {
      log('Session file not found or empty, returning empty object');
      return {};
    }

    // Try to parse JSON
    const parsed = safeParseJSON(data);

    // If parsing fails, return empty object
    if (!parsed) {
      log('Could not parse session file as JSON, returning empty object');
      return {};
    }

    log(`Successfully read ${Object.keys(parsed).length} sessions`);
    return parsed;
  } catch (error) {
    log("Error reading sessions:", error);
    return {};
  }
}

// Write all sessions
function writeSessions(sessions) {
  try {
    // Ensure sessions is an object
    if (typeof sessions !== 'object' || sessions === null) {
      log("Invalid sessions object, not saving");
      return false;
    }

    return safeWriteFile(SESSION_FILE, sessions);
  } catch (error) {
    log('Failed to save sessions:', error);
    return false;
  }
}

// Get session by ID
function getSession(sessionId) {
  const sessions = readSessions();
  return sessions[sessionId];
}

// Update session
function updateSession(sessionId, field, value) {
  const sessions = readSessions();

  if (!sessions[sessionId]) {
    sessions[sessionId] = {};
  }

  if (typeof field === 'object') {
    // Update multiple fields if field is an object
    sessions[sessionId] = { ...sessions[sessionId], ...field };
  } else {
    // Update single field
    sessions[sessionId][field] = value;
  }

  return writeSessions(sessions);
}

// Update request status-background
function updateRequestStatus(sessionId, requestId, status, data = {}) {
  const sessions = readSessions();

  if (!sessions[sessionId]) {
    sessions[sessionId] = { pendingRequests: {} };
  }

  if (!sessions[sessionId].pendingRequests) {
    sessions[sessionId].pendingRequests = {};
  }

  sessions[sessionId].pendingRequests[requestId] = {
    status: status,
    ...data,
    updated_at: Date.now()
  };

  // Update current_request as well
  sessions[sessionId].current_request = {
    id: requestId,
    status: status,
    ...data,
    updated_at: Date.now()
  };

  return writeSessions(sessions);
}

// Session manager - exposes functionality with auto-save feature
const createSessionManager = () => {
  let sessions = readSessions();
  let saveInterval = null;

  // Start auto-save
  const startAutoSave = (intervalMs = 100000) => {
    if (saveInterval) clearInterval(saveInterval);
    saveInterval = setInterval(() => {
      writeSessions(sessions);
    }, intervalMs);
  };

  // Start auto-save by default
  startAutoSave();

  return {
    getSession(sessionId) {
      return sessions[sessionId];
    },

    setSession(sessionId, data) {
      sessions[sessionId] = data;
      return true;
    },

    updateSession(sessionId, field, value) {
      if (!sessions[sessionId]) {
        sessions[sessionId] = {};
      }

      if (typeof field === 'object') {
        sessions[sessionId] = { ...sessions[sessionId], ...field };
      } else {
        sessions[sessionId][field] = value;
      }

      return true;
    },

    updateRequestStatus(sessionId, requestId, status, data = {}) {
      if (!sessions[sessionId]) {
        sessions[sessionId] = { pendingRequests: {} };
      }

      if (!sessions[sessionId].pendingRequests) {
        sessions[sessionId].pendingRequests = {};
      }

      sessions[sessionId].pendingRequests[requestId] = {
        status: status,
        ...data,
        updated_at: Date.now()
      };

      sessions[sessionId].current_request = {
        id: requestId,
        status: status,
        ...data,
        updated_at: Date.now()
      };

      return true;
    },

    deleteSession(sessionId) {
      if (sessions[sessionId]) {
        delete sessions[sessionId];
        return true;
      }
      return false;
    },

    getAllSessions() {
      return {...sessions};
    },

    saveNow() {
      return writeSessions(sessions);
    },

    reloadSessions() {
      sessions = readSessions();
      return true;
    },

    resetSessions() {
      sessions = {};
      return safeWriteFile(SESSION_FILE, {});
    }
  };
};

// Export both functional and object-oriented interfaces
module.exports = {
  // Constants
  SESSION_DIR,
  SESSION_FILE,

  // Direct functions
  safeReadFile,
  safeWriteFile,
  safeParseJSON,
  readSessions,
  writeSessions,
  getSession,
  updateSession,
  updateRequestStatus,

  // Factory function for session manager object
  createSessionManager,

  // Create and export a default session manager instance
  sessionManager: createSessionManager()
};