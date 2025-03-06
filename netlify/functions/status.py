import json
import os
import time
from rag import sessions  # Import the sessions dictionary from rag.py

def handler(event, context):
    """Handle the status check request."""
    try:
        body = json.loads(event["body"])
        request_id = body.get("requestId")
        
        if not request_id:
            return {
                "statusCode": 400,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"error": "Missing requestId"})
            }
        
        # Search for the request in all sessions
        for session_id, session_data in sessions.items():
            current_request = session_data.get("current_request", {})
            if current_request.get("id") == request_id:
                status = current_request.get("status", "unknown")
                
                response_data = {
                    "requestId": request_id,
                    "status": status,
                    "sessionId": session_id
                }
                
                # Add additional data based on status
                if status == "completed":
                    response_data["answer"] = current_request.get("answer", "")
                    
                    # Calculate processing time
                    started_at = current_request.get("started_at", 0)
                    completed_at = current_request.get("completed_at", time.time())
                    processing_time = completed_at - started_at
                    response_data["processingTime"] = round(processing_time, 2)
                    
                elif status == "failed":
                    response_data["error"] = current_request.get("error", "Unknown error")
                
                return {
                    "statusCode": 200,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps(response_data)
                }
        
        # If request not found
        return {
            "statusCode": 404,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "status": "unknown",
                "error": "Request not found"
            })
        }
        
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "error": str(e)
            })
        }