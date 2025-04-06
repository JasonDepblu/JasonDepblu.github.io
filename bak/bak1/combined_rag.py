
import json
import os
import uuid
import time
import sys
import requests
import subprocess
import threading
from pathlib import Path
from pinecone import Pinecone

print("RAG function loaded")

# Environment variables and configuration
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_ENVIRONMENT = os.environ.get("PINECONE_ENVIRONMENT", "gcp-starter")
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME", "blog-content")
SILICONE_API_KEY = os.environ.get("SILICONE_API_KEY")
EMBEDDING_MODEL = "Pro/BAAI/bge-m3"
LLM_MODEL = "Pro/deepseek-ai/DeepSeek-R1"

# Initialize Pinecone client
pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(PINECONE_INDEX_NAME)

# Session storage (in production, use a database)
sessions = {}


def get_embedding(text):
    """Generate embedding using Silicone Flow API."""
    headers = {
        "Authorization": f"Bearer {SILICONE_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": EMBEDDING_MODEL,
        "input": text
    }

    response = requests.post(
        url="https://api.siliconflow.cn/v1/embeddings",
        headers=headers,
        json=payload
    )

    if response.status_code != 200:
        raise Exception(f"Error getting embedding: {response.text}")

    return response.json()["data"][0]["embedding"]


def retrieve_context(query_embedding, top_k=9):
    """Retrieve the top k most relevant documents from Pinecone."""
    print("DEBUG: Querying Pinecone with embedding")
    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        include_metadata=True
    )

    # Convert Pinecone results to a JSON-serializable format
    serializable_results = {
        "matches": [
            {
                "id": match.id,
                "score": float(match.score),
                "metadata": match.metadata
            }
            for match in results.matches
        ]
    }

    print(f"DEBUG: Pinecone results: {json.dumps(serializable_results)}")

    contexts = []
    for match in results.matches:
        contexts.append({
            "content": match.metadata.get("content", ""),
            "url": match.metadata.get("url", ""),
            "title": match.metadata.get("title", ""),
            "score": float(match.score)
        })

    return contexts


def generate_answer(question, contexts, conversation_history=None):
    """Generate an answer using the DeepSeek-R1 model."""
    print(question)
    if conversation_history is None:
        conversation_history = []

    # Format the context and conversation history
    context_text = "\n\n".join([f"Title: {ctx['title']}\nURL: {ctx['url']}\nContent: {ctx['content']}"
                                for ctx in contexts])

    history_text = ""
    if conversation_history:
        history_text = "\n".join([f"User: {item['user']}\nAssistant: {item['assistant']}"
                                  for item in conversation_history])

    # Construct the prompt
    system_prompt = """You are a helpful assistant for a personal blog. Answer the user's questions based on the blog posts contents. 
If you cannot find the answer in the provided context, acknowledge that and provide your best general knowledge response.
Always include relevant links to blog posts when available in the context. Use markdown formatting in your responses.
Keep your answers concise and focused on the user's question."""

    prompt = f"""### Context from blog posts:
{context_text}

### Conversation History:
{history_text}

### Current Question:
{question}

Please provide a helpful response based on the context information.
"""

    # Call the Silicone Flow API
    headers = {
        "Authorization": f"Bearer {SILICONE_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.6,
        "max_tokens": 5000
    }

    response = requests.post(
        url="https://api.siliconflow.cn/v1/chat/completions",
        headers=headers,
        json=payload
    )

    print(f"DEBUG: Answer generated for question: {question[:50]}...")

    if response.status_code != 200:
        raise Exception(f"Error generating answer: {response.text}")

    response_content = response.json()["choices"][0]["message"]["content"]
    # Print this in a format JavaScript can reliably parse
    print(f"ANSWER_JSON_START{json.dumps({'answer': response_content})}ANSWER_JSON_END")

    return response_content


def process_rag_request(request_id, session_id, question, event=None):
    """Process the RAG request in a background thread."""
    try:
        print(f"DEBUG: Processing request {request_id} for session {session_id}")

        # Get embedding for the question
        query_embedding = get_embedding(question)
        print("DEBUG: Got embedding")

        # Retrieve relevant contexts
        contexts = retrieve_context(query_embedding)
        print("DEBUG: Retrieved context")

        # Generate an answer
        answer = generate_answer(
            question,
            contexts,
            sessions[session_id].get("history", [])
        )
        print("DEBUG: Generated answer")

        # Update session with the new conversation
        sessions[session_id]["history"].append({
            "user": question,
            "assistant": answer
        })

        # Update request status-background
        sessions[session_id]["current_request"].update({
            "status-background": "completed",
            "answer": answer,
            "completed_at": time.time()
        })
        print(f"DEBUG: Processing completed for request {request_id}")

    except Exception as e:
        print(f"ERROR processing request {request_id}: {str(e)}")
        import traceback
        print(traceback.format_exc())

        # Update request status-background on error
        if session_id in sessions and "current_request" in sessions[session_id]:
            sessions[session_id]["current_request"].update({
                "status-background": "failed",
                "error": str(e),
                "completed_at": time.time()
            })


def lambda_handler(event, context):
    """Handle incoming requests, both direct and from AWS Lambda."""
    try:
        print("DEBUG: Starting handler function")

        # Parse request body
        if isinstance(event, str):
            event = json.loads(event)

        if "body" in event:
            if isinstance(event["body"], str):
                body = json.loads(event["body"])
            else:
                body = event["body"]
        else:
            body = event

        question = body.get("question", "")
        print(f"DEBUG: Question received: {question}")
        session_id = body.get("sessionId")

        # Generate a new session if none exists
        if not session_id or session_id not in sessions:
            session_id = str(uuid.uuid4())
            sessions[session_id] = {
                "history": [],
                "created_at": time.time()
            }

        # Clean up old sessions (older than 24 hours)
        current_time = time.time()
        for sid in list(sessions.keys()):
            if current_time - sessions[sid]["created_at"] > 86400:  # 24 hours
                del sessions[sid]

        # Generate a request ID for async processing
        request_id = str(uuid.uuid4())

        # Store the request details for status-background checking
        sessions[session_id]["current_request"] = {
            "id": request_id,
            "question": question,
            "status-background": "processing",
            "started_at": time.time()
        }

        # Start processing in a background thread
        thread = threading.Thread(
            target=process_rag_request,
            args=(request_id, session_id, question, event)
        )
        thread.daemon = True
        thread.start()

        # Return the request ID and session ID for client polling
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({
                "requestId": request_id,
                "sessionId": session_id,
                "message": "Request is being processed"
            })
        }

    except Exception as e:
        print(f"ERROR in handler: {str(e)}")
        import traceback
        print(traceback.format_exc())
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({
                "error": str(e)
            })
        }


def get_status(session_id, request_id):
    """Get the status-background of a request."""
    if session_id not in sessions:
        return {
            "statusCode": 404,
            "body": json.dumps({"error": "Session not found"})
        }

    current_request = sessions[session_id].get("current_request", {})
    if not current_request or current_request.get("id") != request_id:
        return {
            "statusCode": 404,
            "body": json.dumps({"error": "Request not found"})
        }

    return {
        "statusCode": 200,
        "body": json.dumps({
            "status-background": current_request.get("status-background"),
            "answer": current_request.get("answer"),
            "error": current_request.get("error")
        })
    }


# Main execution
if __name__ == "__main__":
    print("DEBUG: Script running in main mode")

    # Check for command line arguments
    if len(sys.argv) > 1:
        # Command line interface mode
        command = sys.argv[1]

        if command == "status-background" and len(sys.argv) >= 4:
            session_id = sys.argv[2]
            request_id = sys.argv[3]
            result = get_status(session_id, request_id)
            print(json.dumps(result))
            sys.exit(0)

    # Try to read input from stdin (for Node.js integration)
    try:
        input_data = sys.stdin.read()
        if input_data:
            # Parse the JSON input
            event = json.loads(input_data)
            print(f"DEBUG: Received input data, about to call handler")
            # Call the handler function
            result = lambda_handler(event, {})
            # Print the result to be captured by caller
            if result:
                print(f"DEBUG: Handler completed, returning result")
                print(json.dumps(result))

    except Exception as e:
        print(f"ERROR in main execution: {str(e)}")
        import traceback

        print(traceback.format_exc())
        sys.exit(1)

    # Start a simple HTTP server if run directly without input
    if not input_data and len(sys.argv) == 1:
        from http.server import HTTPServer, BaseHTTPRequestHandler


        class RAGRequestHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length).decode('utf-8')

                if self.path == "/api/rag-background":
                    result = lambda_handler(post_data, {})
                    self.send_response(result.get("statusCode", 200))
                    self.send_header('Content-type', 'application/json')
                    for key, value in result.get("headers", {}).items():
                        self.send_header(key, value)
                    self.end_headers()
                    self.wfile.write(result.get("body", "{}").encode())
                elif self.path == "/api/status-background":
                    data = json.loads(post_data)
                    result = get_status(data.get("sessionId"), data.get("requestId"))
                    self.send_response(result.get("statusCode", 200))
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(result.get("body", "{}").encode())
                else:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Not found"}).encode())


        # Start HTTP server
        print("Starting HTTP server on port 8000...")
        server = HTTPServer(('localhost', 8000), RAGRequestHandler)
        server.serve_forever()