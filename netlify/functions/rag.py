import json
import os
import uuid
import time
import pinecone
from pinecone import Pinecone
import requests
from pathlib import Path

# Initialize Pinecone client
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_ENVIRONMENT = os.environ.get("PINECONE_ENVIRONMENT", "gcp-starter")
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME", "blog-content")

pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(PINECONE_INDEX_NAME)

# Initialize Silicone Flow API credentials
SILICONE_API_KEY = os.environ.get("SILICONE_API_KEY")
EMBEDDING_MODEL = "Pro/BAAI/bge-m3"
LLM_MODEL = "Pro/deepseek-ai/DeepSeek-R1"

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
        "https://siliconeflow.com/api/v1/embeddings",
        headers=headers,
        json=payload
    )
    
    if response.status_code != 200:
        raise Exception(f"Error getting embedding: {response.text}")
    
    return response.json()["data"][0]["embedding"]

def retrieve_context(query_embedding, top_k=5):
    """Retrieve the top k most relevant documents from Pinecone."""
    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        include_metadata=True
    )
    
    contexts = []
    for match in results["matches"]:
        contexts.append({
            "content": match["metadata"]["content"],
            "url": match["metadata"].get("url", ""),
            "title": match["metadata"].get("title", ""),
            "score": match["score"]
        })
    
    return contexts

def generate_answer(question, contexts, conversation_history=None):
    """Generate an answer using the DeepSeek-R1 model."""
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
    system_prompt = """You are a helpful assistant for a personal blog. Answer the user's questions based on the provided context from blog posts. 
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
        "temperature": 0.7,
        "max_tokens": 1000
    }
    
    response = requests.post(
        "https://siliconeflow.com/api/v1/chat/completions",
        headers=headers,
        json=payload
    )
    
    if response.status_code != 200:
        raise Exception(f"Error generating answer: {response.text}")
    
    return response.json()["choices"][0]["message"]["content"]

def handler(event, context):
    """Handle the Lambda request."""
    # Parse request body
    try:
        body = json.loads(event["body"])
        question = body.get("question", "")
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
        
        # Store the request details for status checking
        sessions[session_id]["current_request"] = {
            "id": request_id,
            "question": question,
            "status": "processing",
            "started_at": time.time()
        }
        
        # This would typically be processed asynchronously
        # For simplicity, we're doing it synchronously here
        try:
            # Get embedding for the question
            query_embedding = get_embedding(question)
            
            # Retrieve relevant contexts
            contexts = retrieve_context(query_embedding)
            
            # Generate an answer
            answer = generate_answer(
                question, 
                contexts, 
                sessions[session_id].get("history", [])
            )
            
            # Update session with the new conversation
            sessions[session_id]["history"].append({
                "user": question,
                "assistant": answer
            })
            
            # Update request status
            sessions[session_id]["current_request"].update({
                "status": "completed",
                "answer": answer,
                "completed_at": time.time()
            })
            
        except Exception as e:
            # Update request status on error
            sessions[session_id]["current_request"].update({
                "status": "failed",
                "error": str(e),
                "completed_at": time.time()
            })
            print(f"Error processing request: {str(e)}")
        
        # Return the request ID and session ID for client polling
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": json.dumps({
                "requestId": request_id,
                "sessionId": session_id,
                "message": "Request is being processed"
            })
        }
        
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json"
            },
            "body": json.dumps({
                "error": str(e)
            })
        }