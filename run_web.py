#!/usr/bin/env python3
"""
Pub/Sub Pretty Logger - Web Interface Launcher
This is a convenience script to start the web interface directly.
"""

import os
import uvicorn
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Starting Pub/Sub Pretty Logger web interface on http://127.0.0.1:{port}")
    print("Press Ctrl+C to exit")
    
    # Start web server
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True) 