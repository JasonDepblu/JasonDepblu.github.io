const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sessionStore = require('../shared/session_store.js');

exports.handler = async (event, context) => {
  try {
    // Parse the request body
    const scriptPath = path.join(__dirname, 'combined_status.py');

    console.log("Function directory:", __dirname);
    console.log("Looking for Python script at:", scriptPath);
    // const scriptPath = path.join(projectRoot, 'netlify', 'functions', 'rag', 'combined_status.py');

    if (!fs.existsSync(scriptPath)) {
      console.error(`Python script not found at: ${scriptPath}`);
      console.log("Directory contents:", fs.readdirSync(__dirname));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Python script not found" })
      };
    }

    console.log("Python script found, proceeding with execution");
    const body = JSON.parse(event.body || '{}');
    const question = body.question || '';
    let sessionId = body.sessionId;

    // Create or retrieve session
    if (!sessionId || !sessionStore.getSession(sessionId)) {
      sessionId = crypto.randomUUID();
      sessionStore.setSession(sessionId, {
        history: [],
        created_at: Date.now()
      });
    }

    // Generate request ID
    const requestId = crypto.randomUUID();

    // Initialize the request in the session store
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      question: question,
      status: 'processing',
      started_at: Date.now()
    });

    console.log(`Created request ${requestId} in session ${sessionId}`);

    // Start processing in the background
    // Important: This continues to run after the handler returns
    processRagInBackground(requestId, sessionId, question, event);

    // Return immediately with the request ID
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        requestId: requestId,
        sessionId: sessionId,
        message: "Request is being processed"
      })
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Function to process the RAG request in the background
function processRagInBackground(requestId, sessionId, question, event) {
  const projectRoot = process.cwd();
  const scriptPath = path.join(projectRoot, 'netlify', 'functions', 'rag', 'combined_status.py');

  // Make sure the Python script exists
  if (!fs.existsSync(scriptPath)) {
    console.error(`Python script not found: ${scriptPath}`);
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      status: 'failed',
      error: "Python script not found",
      completed_at: Date.now()
    });
    return;
  }

  // Start the Python process
  console.log(`Starting Python process for request ${requestId}`);
  const pythonProcess = spawn('python3', [scriptPath]);

  let pythonOutput = '';
  let errorOutput = '';

  // Collect stdout data
  pythonProcess.stdout.on('data', (data) => {
    pythonOutput += data.toString();
  });

  // Collect stderr data
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.error(`Python error: ${data}`);
  });

  // Handle process errors
  pythonProcess.on('error', (error) => {
    console.error(`Failed to start Python process: ${error.message}`);
    sessionStore.updateSession(sessionId, 'current_request', {
      id: requestId,
      status: 'failed',
      error: `Failed to start Python process: ${error.message}`,
      completed_at: Date.now()
    });
  });

  // Pass event data to the Python process
  pythonProcess.stdin.write(JSON.stringify({
    ...event,
    debug: true
  }));
  pythonProcess.stdin.end();

  // Handle process completion
  pythonProcess.on('close', (code) => {
    console.log(`Python process for request ${requestId} exited with code ${code}`);

    if (code !== 0) {
      // Process failed
      console.error(`Python process failed with code ${code}`);
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        status: 'failed',
        error: errorOutput || `Python process exited with code ${code}`,
        completed_at: Date.now()
      });
      return;
    }

    // Process succeeded
    console.log(`Python process for request ${requestId} completed successfully`);
    console.log("Python output:", pythonOutput);

    // Extract the answer from the output
    try {
      let answer = "Processing complete but no answer generated";

      // Look for the answer in the JSON format we expect
      const jsonMatch = pythonOutput.match(/ANSWER_JSON_START(.*?)ANSWER_JSON_END/s);
      if (jsonMatch && jsonMatch[1]) {
        const answerObj = JSON.parse(jsonMatch[1]);
        if (answerObj.answer) {
          answer = answerObj.answer;
        }
      }

      // Update the session with the answer
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        status: 'completed',
        answer: answer,
        completed_at: Date.now()
      });

      console.log(`Updated session ${sessionId} with answer for request ${requestId}`);
    } catch (error) {
      console.error(`Error extracting answer: ${error.message}`);
      sessionStore.updateSession(sessionId, 'current_request', {
        id: requestId,
        status: 'failed',
        error: `Error extracting answer: ${error.message}`,
        completed_at: Date.now()
      });
    }
  });
}