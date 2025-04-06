import os
import json
import time
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from shared.session_store import sessions


def handler(event, context):
    """Handle the status-background check request."""
    response_data = {"status-background": "initializing"}

    try:
        body = json.loads(event["body"])
        request_id = body.get("requestId")

        if not request_id:
            response_data = {"error": "Missing requestId"}
            print(json.dumps(response_data))
            return {"statusCode": 400, "body": json.dumps(response_data)}

        # 输出会话信息
        print(f"DEBUG: Available sessions: {list(sessions.keys())}")

        # Search for the request in all sessions
        found = False
        for session_id, session_data in sessions.items():
            current_request = session_data.get("current_request", {})
            if current_request.get("id") == request_id:
                found = True
                status = current_request.get("status-background", "unknown")

                response_data = {
                    "requestId": request_id,
                    "status-background": status,
                    "sessionId": session_id
                }

                if status == "completed":
                    response_data["answer"] = current_request.get("answer", "")
                    started_at = current_request.get("started_at", 0)
                    completed_at = current_request.get("completed_at", time.time())
                    response_data["processingTime"] = round(completed_at - started_at, 2)
                elif status == "failed":
                    response_data["error"] = current_request.get("error", "Unknown error")

                break

        if not found:
            response_data = {
                "status-background": "unknown",
                "error": "Request not found",
                "requestId": request_id
            }

        # 重要: 直接输出响应数据
        print(json.dumps(response_data))
        return {"statusCode": 200, "body": json.dumps(response_data)}

    except Exception as e:
        response_data = {"error": str(e)}
        print(json.dumps(response_data))
        return {"statusCode": 500, "body": json.dumps(response_data)}


# Add this main function to execute the handler when the script runs directly
if __name__ == "__main__":
    # This code runs when the script is executed directly
    print("DEBUG: Status script running in main mode")
    try:
        # Read the input sent from Node.js
        input_data = sys.stdin.read()
        if input_data:
            # Parse the JSON input
            event = json.loads(input_data)
            print(f"DEBUG: Received input data, about to call handler")
            # Call the handler function
            result = handler(event, {})
            # Print the result to be captured by Node.js
            if result:
                print(f"DEBUG: Handler completed, returning result")
                print(json.dumps(result))
    except Exception as e:
        print(f"ERROR in main execution: {str(e)}")
        import traceback
        print(traceback.format_exc())