from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
import json
import asyncio
from typing import List, Dict, Any, Optional
import os
from google.cloud import pubsub_v1
from dotenv import load_dotenv
import threading
import queue
import time

# Load environment variables
load_dotenv()

router = APIRouter(tags=["api"])

# Message queue for WebSocket connections
message_queues = {}
active_connections = set()
# Use a dictionary para rastrear qué client_id corresponde a cada WebSocket
websocket_to_client = {}

# Models
class PubSubConfig(BaseModel):
    project_id: str
    subscription_id: str

class PubSubMessage(BaseModel):
    data: Dict[str, Any]
    attributes: Optional[Dict[str, str]] = None
    message_id: str
    publish_time: str

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        return len(self.active_connections) - 1  # Return the index

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Remove connection if it's closed
                self.disconnect(connection)

manager = ConnectionManager()

def convert_to_json_serializable(obj):
    """Convert a object to a JSON serializable format."""
    if isinstance(obj, dict):
        return {k: convert_to_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_json_serializable(i) for i in obj]
    elif hasattr(obj, 'items') and callable(getattr(obj, 'items')):
        # Handle ScalarMapContainer and similar dict-like objects
        return {k: convert_to_json_serializable(v) for k, v in obj.items()}
    else:
        # Convert all other types to their native Python equivalent
        return str(obj) if not isinstance(obj, (str, int, float, bool, type(None))) else obj

def create_subscription_listener(project_id, subscription_id, msg_queue, status_queue):
    """Create a Pub/Sub subscriber and listen for messages in a separate thread."""
    print(f"Starting Pub/Sub listener for project={project_id}, subscription={subscription_id}")
    
    def callback(message):
        """Process received Pub/Sub message."""
        try:
            # Decode message from bytes to string
            message_data = message.data.decode("utf-8")
            print(f"Received message: ID={message.message_id}, size={len(message_data)} bytes")
            
            # Try to parse the message data as JSON
            try:
                json_data = json.loads(message_data)
            except json.JSONDecodeError:
                # If not valid JSON, use as raw string
                print(f"Message is not valid JSON, using as raw string")
                json_data = message_data
            
            # Convert attributes to a regular Python dict
            attrs = {}
            if message.attributes:
                for key, value in message.attributes.items():
                    attrs[key] = value
            
            # Create a message object with all JSON serializable data
            msg_obj = {
                "data": json_data,
                "attributes": attrs,
                "message_id": message.message_id,
                "publish_time": str(message.publish_time)
            }
            
            # Add to queue
            msg_queue.put(convert_to_json_serializable(msg_obj))
            print(f"Added message {message.message_id} to queue")
        except Exception as e:
            print(f"Error processing message: {str(e)}")
            import traceback
            traceback.print_exc()
            status_queue.put({"error": f"Error processing message: {str(e)}"})
        
        message.ack()  # Acknowledge the message
        print(f"Acknowledged message {message.message_id}")

    try:
        print(f"Creating Pub/Sub subscriber client")
        subscriber = pubsub_v1.SubscriberClient()
        subscription_path = subscriber.subscription_path(project_id, subscription_id)
        print(f"Subscription path: {subscription_path}")
        
        status_queue.put({"status": "connecting", "subscription": subscription_path})
        print(f"Put 'connecting' status in queue")
        
        # Subscribe to the subscription
        print(f"Subscribing to Pub/Sub")
        streaming_pull_future = subscriber.subscribe(
            subscription_path, callback=callback
        )
        
        status_queue.put({"status": "connected", "subscription": subscription_path})
        print(f"Put 'connected' status in queue")
        
        # Keep the thread alive until it's stopped
        print(f"Waiting for messages on subscription {subscription_id}")
        try:
            streaming_pull_future.result()
        except Exception as e:
            print(f"Subscription error: {str(e)}")
            import traceback
            traceback.print_exc()
            status_queue.put({"error": f"Subscription error: {str(e)}"})
    except Exception as e:
        print(f"Failed to connect to Pub/Sub: {str(e)}")
        import traceback
        traceback.print_exc()
        status_queue.put({"error": f"Failed to connect: {str(e)}"})

@router.post("/connect")
async def connect_to_pubsub(config: PubSubConfig, background_tasks: BackgroundTasks):
    """Connect to a Pub/Sub subscription and start listening for messages."""
    
    print(f"Connection request received for project={config.project_id}, subscription={config.subscription_id}")
    
    # Check environment variables
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    print(f"GOOGLE_APPLICATION_CREDENTIALS: {creds_path}")
    if creds_path:
        if os.path.exists(creds_path):
            print(f"Credentials file exists at: {creds_path}")
        else:
            print(f"WARNING: Credentials file does not exist at: {creds_path}")
    else:
        print("WARNING: GOOGLE_APPLICATION_CREDENTIALS environment variable not set")
    
    client_id = f"{config.project_id}:{config.subscription_id}"
    print(f"Generated client_id: {client_id}")
    
    # Check if already connected
    if client_id in message_queues:
        print(f"Client {client_id} is already connected")
        return {"status": "already_connected", "client_id": client_id}
    
    print(f"Creating message queues for client {client_id}")
    # Create message queues
    message_queues[client_id] = {
        "messages": queue.Queue(),
        "status": queue.Queue()
    }
    
    print(f"Starting Pub/Sub listener thread for {client_id}")
    # Start listener in a background thread
    threading.Thread(
        target=create_subscription_listener,
        args=(
            config.project_id,
            config.subscription_id,
            message_queues[client_id]["messages"],
            message_queues[client_id]["status"]
        ),
        daemon=True
    ).start()
    
    # Wait for initial connection status
    try:
        print(f"Waiting for initial connection status for {client_id}")
        status = message_queues[client_id]["status"].get(timeout=5)
        print(f"Received initial status for {client_id}: {status}")
        
        if "error" in status:
            print(f"Error in status for {client_id}: {status['error']}")
            del message_queues[client_id]
            raise HTTPException(status_code=400, detail=status["error"])
        
        print(f"Connection successful for {client_id}")
        return {"status": "connected", "client_id": client_id}
    except queue.Empty:
        print(f"Connection timeout for {client_id} - no status received within timeout")
        del message_queues[client_id]
        raise HTTPException(status_code=408, detail="Connection timeout")

@router.get("/status")
def get_connection_status():
    """Get status of all active connections."""
    connections = {}
    for client_id in message_queues:
        project_id, subscription_id = client_id.split(":", 1)
        
        # Check message and status queue sizes
        message_count = message_queues[client_id]["messages"].qsize()
        status_count = message_queues[client_id]["status"].qsize()
        
        # Count active websockets for this client_id
        active_ws_count = sum(1 for ws, cid in websocket_to_client.items() if cid == client_id)
        
        connections[client_id] = {
            "project_id": project_id,
            "subscription_id": subscription_id,
            "connected": True,
            "message_count": message_count,
            "status_count": status_count,
            "active_websockets": active_ws_count
        }
    
    # Add debug info
    debug_info = {
        "active_websocket_connections": len(active_connections),
        "tracked_websocket_connections": len(websocket_to_client),
        "message_queue_count": len(message_queues),
        "application_credentials": os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "Not set")
    }
    
    return {"connections": connections, "debug_info": debug_info}

@router.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    """WebSocket endpoint for receiving Pub/Sub messages in real-time."""
    print(f"WebSocket connection attempt for client_id: {client_id}")
    
    if client_id not in message_queues:
        print(f"Invalid client_id: {client_id}, available IDs: {list(message_queues.keys())}")
        await websocket.close(code=1008, reason="Invalid client ID")
        return
    
    # Asociar este websocket con el client_id
    websocket_to_client[websocket] = client_id
    
    print(f"WebSocket connecting for client_id: {client_id}")
    connection_id = await manager.connect(websocket)
    active_connections.add(websocket)
    print(f"WebSocket connected for client_id: {client_id}, connection_id: {connection_id}")
    
    try:
        # Process any status updates
        status_count = 0
        while not message_queues[client_id]["status"].empty():
            status = message_queues[client_id]["status"].get_nowait()
            print(f"Initial status update for {client_id}: {status}")
            await manager.send_message({"type": "status", "data": status}, websocket)
            status_count += 1
        
        print(f"Processed {status_count} initial status updates for {client_id}")
        
        # Main message loop
        message_count = 0
        while True:
            try:
                # Non-blocking check for new messages
                if not message_queues[client_id]["messages"].empty():
                    message = message_queues[client_id]["messages"].get_nowait()
                    print(f"Sending message {message_count} to client {client_id}")
                    await manager.send_message({"type": "message", "data": message}, websocket)
                    message_count += 1
                
                # Check for status updates
                if not message_queues[client_id]["status"].empty():
                    status = message_queues[client_id]["status"].get_nowait()
                    print(f"Sending status update to client {client_id}: {status}")
                    await manager.send_message({"type": "status", "data": status}, websocket)
                
                # Small delay to prevent CPU overuse
                await asyncio.sleep(0.1)
            except queue.Empty:
                # No messages yet, continue waiting
                await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for client_id: {client_id}")
        manager.disconnect(websocket)
        active_connections.remove(websocket)
        # También eliminar la asociación
        if websocket in websocket_to_client:
            del websocket_to_client[websocket]
    except Exception as e:
        print(f"WebSocket error for client_id {client_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        manager.disconnect(websocket)
        if websocket in active_connections:
            active_connections.remove(websocket)
        # También eliminar la asociación
        if websocket in websocket_to_client:
            del websocket_to_client[websocket]

@router.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "OK", "active_connections": len(active_connections)}

@router.get("/config")
def get_default_config():
    """Get default configuration from environment variables."""
    return {
        "project_id": os.environ.get("PUBSUB_PROJECT_ID", ""),
        "subscription_id": os.environ.get("PUBSUB_SUBSCRIPTION_ID", "")
    }

@router.get("/messages/{client_id}")
def get_messages(client_id: str, limit: int = 10):
    """Get recent messages for a client without using WebSocket."""
    if client_id not in message_queues:
        raise HTTPException(status_code=404, detail="Client ID not found")
    
    # Get messages from the queue without removing them
    try:
        messages = []
        queue_size = message_queues[client_id]["messages"].qsize()
        
        # Get copies of messages in the queue without removing them
        temp_queue = queue.Queue()
        for _ in range(min(queue_size, limit)):
            if message_queues[client_id]["messages"].empty():
                break
            msg = message_queues[client_id]["messages"].get()
            messages.append(msg)
            temp_queue.put(msg)
        
        # Return messages to the original queue
        while not temp_queue.empty():
            message_queues[client_id]["messages"].put(temp_queue.get())
        
        return {"messages": messages, "total_available": queue_size}
    except Exception as e:
        print(f"Error fetching messages: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error fetching messages: {str(e)}") 