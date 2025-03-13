import json
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# In a real application, you'd import from a persistent storage mechanism
# This is a simple in-memory implementation similar to the original code
sessions = {}


def get_all_sessions():
    """Return all sessions from storage."""
    return sessions


def get_session(session_id):
    """Get a specific session by ID."""
    return sessions.get(session_id)


def update_session(session_id, key, value):
    """Update a specific key in a session."""
    if session_id in sessions:
        sessions[session_id][key] = value


def set_session(session_id, data):
    """Set or create a session with the given data."""
    sessions[session_id] = data


def handler(event, context=None):
    """Handle the status check request."""
    try:
        print("DEBUG: Starting status handler function")

        # Parse the request body
        if isinstance(event, str):
            event = json.loads(event)

        if "body" in event:
            if isinstance(event["body"], str):
                body = json.loads(event["body"])
            else:
                body = event["body"]
        else:
            body = event

        request_id = body.get("requestId")

        if not request_id:
            print("DEBUG: Missing requestId in request")
            return {
                "statusCode": 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps({"error": "Missing requestId"})
            }

        # Load all sessions from storage
        all_sessions = get_all_sessions()
        print(f"DEBUG: Available sessions: {list(all_sessions.keys())}")

        # Search for the request in all sessions
        found = False
        response = {
            "requestId": request_id,
            "status": "unknown"
        }

        for session_id, session_data in all_sessions.items():
            current_request = session_data.get("current_request", {})

            if current_request and current_request.get("id") == request_id:
                found = True
                print(f"DEBUG: Found request {request_id} in session {session_id}")

                status = current_request.get("status", "unknown")
                response = {
                    "requestId": request_id,
                    "sessionId": session_id,
                    "status": status
                }

                if status == "completed":
                    response["answer"] = current_request.get("answer", "")
                    started_at = current_request.get("started_at", 0)
                    completed_at = current_request.get("completed_at", time.time())
                    processing_time = (completed_at - started_at)
                    response["processingTime"] = round(processing_time, 2)
                elif status == "failed":
                    response["error"] = current_request.get("error", "Unknown error")

                break

        if not found:
            print(f"DEBUG: Request {request_id} not found in any session")
            return {
                "statusCode": 404,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                },
                "body": json.dumps({
                    "requestId": request_id,
                    "status": "unknown",
                    "error": "Request not found in any session"
                })
            }

        print(f"DEBUG: Returning status response for request {request_id}")
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps(response)
        }

    except Exception as e:
        error_message = str(e)
        print(f"ERROR in status handler: {error_message}")
        import traceback
        print(traceback.format_exc())

        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": error_message})
        }


def lambda_handler(event, context):
    """AWS Lambda compatible handler."""
    return handler(event, context)


class StatusRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler for status checks when running as a server."""

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')

        if self.path == "/api/status":
            result = handler(post_data)
            self.send_response(result.get("statusCode", 200))
            self.send_header('Content-type', 'application/json')
            for key, value in result.get("headers", {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(result.get("body", "{}").encode())
        else:
            self.send_response(404)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


# Command line interface and main execution
if __name__ == "__main__":
    print("DEBUG: Status script running in main mode")

    # Check for command line arguments
    if len(sys.argv) > 1:
        # Command line interface mode
        command = sys.argv[1]

        if command == "check" and len(sys.argv) >= 3:
            request_id = sys.argv[2]
            result = handler({"requestId": request_id})
            print(json.dumps(result))
            sys.exit(0)

    # Try to read input from stdin (for Node.js integration)
    try:
        # Check if there's data available on stdin
        if not sys.stdin.isatty():
            input_data = sys.stdin.read()
            if input_data:
                # Parse the JSON input
                event = json.loads(input_data)
                print(f"DEBUG: Received input data, about to call handler")
                # Call the handler function
                result = handler(event)
                # Print the result to be captured by caller
                if result:
                    print(f"DEBUG: Handler completed, returning result")
                    print(json.dumps(result))
                sys.exit(0)
    except Exception as e:
        # stdin might not be available or other error
        print(f"DEBUG: No stdin data or error: {str(e)}")

    # Start a simple HTTP server if run directly without input
    try:
        print("Starting HTTP server for status checks on port 8001...")
        server = HTTPServer(('localhost', 8001), StatusRequestHandler)
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server stopped by user")
    except Exception as e:
        print(f"Server error: {str(e)}")
        import traceback

        print(traceback.format_exc())