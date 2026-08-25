"""
WebSocket and streaming endpoints for real-time IDE integration.
Provides Cursor-like inline completions and multi-file context.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from typing import Dict, List, Optional
import json
import asyncio
from app.services.auth import require_authentication
from app.services.completion_engine import completion_engine
from app.services.usage_tracker import usage_tracker
from app.config import LLM_MODE

router = APIRouter()

# Active WebSocket connections
active_connections: Dict[str, WebSocket] = {}


@router.websocket("/ws/completions")
async def websocket_completions(websocket: WebSocket, token: Optional[str] = None):
    """
    WebSocket endpoint for real-time code completions.
    
    Protocol:
    Client sends:
    {
        "type": "completion",
        "prefix": "resource \"aws_s3_bucket\"",
        "suffix": "\n}",
        "file_path": "main.tf",
        "cursor_position": {"line": 10, "character": 5},
        "context": {
            "open_files": [...],
            "workspace_files": [...]
        }
    }
    
    Server streams:
    {
        "type": "completion_chunk",
        "text": " \"example\" {\n  bucket = \"my-bucket\"\n",
        "done": false
    }
    """
    await websocket.accept()
    
    # Authenticate user (optional for MVP, but track usage)
    user_id = "anonymous"
    if token:
        try:
            from app.services.auth import authentication_service
            payload = authentication_service.parse_and_verify_token(token)
            user_id = payload.get("sub", "anonymous")
        except:
            pass
    
    connection_id = f"{user_id}_{id(websocket)}"
    active_connections[connection_id] = websocket
    
    try:
        while True:
            # Receive request from client
            data = await websocket.receive_text()
            request = json.loads(data)
            
            request_type = request.get("type")
            
            if request_type == "completion":
                # Handle inline completion request
                await handle_completion_request(websocket, request, user_id)
            
            elif request_type == "chat":
                # Handle chat message
                await handle_chat_message(websocket, request, user_id)
            
            elif request_type == "analyze_workspace":
                # Analyze entire workspace for context
                await handle_workspace_analysis(websocket, request, user_id)
            
            elif request_type == "ping":
                # Keep-alive
                await websocket.send_json({"type": "pong"})
            
            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown request type: {request_type}"
                })
    
    except WebSocketDisconnect:
        active_connections.pop(connection_id, None)
        print(f"Client {connection_id} disconnected")
    
    except Exception as e:
        print(f"WebSocket error for {connection_id}: {e}")
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })
        active_connections.pop(connection_id, None)


async def handle_completion_request(websocket: WebSocket, request: dict, user_id: str):
    """Stream inline code completion"""
    try:
        prefix = request.get("prefix", "")
        suffix = request.get("suffix", "")
        file_path = request.get("file_path", "")
        context = request.get("context", {})
        
        # Track usage
        usage_tracker.track_event(
            user_id=user_id,
            event_type="completion_request",
            metadata={"file_path": file_path}
        )
        
        # Generate completion (streaming)
        async for chunk in completion_engine.stream_completion(
            prefix=prefix,
            suffix=suffix,
            file_path=file_path,
            context=context
        ):
            await websocket.send_json({
                "type": "completion_chunk",
                "text": chunk,
                "done": False
            })
        
        # Send completion done signal
        await websocket.send_json({
            "type": "completion_chunk",
            "text": "",
            "done": True
        })
    
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": f"Completion failed: {str(e)}"
        })


async def handle_chat_message(websocket: WebSocket, request: dict, user_id: str):
    """Handle chat message with streaming response"""
    try:
        message = request.get("message", "")
        context = request.get("context", {})
        
        # Track usage
        usage_tracker.track_event(
            user_id=user_id,
            event_type="chat_message",
            metadata={"message_length": len(message)}
        )
        
        # Stream chat response
        async for chunk in completion_engine.stream_chat_response(
            message=message,
            context=context
        ):
            await websocket.send_json({
                "type": "chat_chunk",
                "text": chunk,
                "done": False
            })
        
        await websocket.send_json({
            "type": "chat_chunk",
            "text": "",
            "done": True
        })
    
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": f"Chat failed: {str(e)}"
        })


async def handle_workspace_analysis(websocket: WebSocket, request: dict, user_id: str):
    """Analyze entire workspace for multi-file context"""
    try:
        files = request.get("files", [])
        
        # Track usage
        usage_tracker.track_event(
            user_id=user_id,
            event_type="workspace_analysis",
            metadata={"file_count": len(files)}
        )
        
        # Send progress updates
        await websocket.send_json({
            "type": "analysis_progress",
            "progress": 0,
            "message": "Analyzing workspace..."
        })
        
        # Analyze files
        analysis = await completion_engine.analyze_workspace(files)
        
        await websocket.send_json({
            "type": "analysis_complete",
            "data": analysis
        })
    
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": f"Analysis failed: {str(e)}"
        })


@router.post("/stream/completion")
async def stream_completion_http(
    request: dict,
    user = Depends(require_authentication)
):
    """
    HTTP endpoint for streaming completions (SSE alternative to WebSocket).
    For clients that prefer Server-Sent Events.
    """
    from fastapi.responses import StreamingResponse
    
    async def generate():
        async for chunk in completion_engine.stream_completion(
            prefix=request.get("prefix", ""),
            suffix=request.get("suffix", ""),
            file_path=request.get("file_path", ""),
            context=request.get("context", {})
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        
        yield f"data: {json.dumps({'done': True})}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/ws/status")
def websocket_status():
    """Get active WebSocket connection count"""
    return {
        "active_connections": len(active_connections),
        "connection_ids": list(active_connections.keys())
    }

