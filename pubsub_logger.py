from google.cloud import pubsub_v1
import json
import colorama
from colorama import Fore, Style
import argparse
import os
from dotenv import load_dotenv
import sys
import time

# Load environment variables from .env file if it exists
load_dotenv()

# Initialize colorama
colorama.init(autoreset=True)


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Listen to Google Cloud Pub/Sub messages with pretty formatting."
    )

    parser.add_argument(
        "--project-id",
        default=os.environ.get("PUBSUB_PROJECT_ID", "your-project-id"),
        help='Google Cloud project ID (default: from PUBSUB_PROJECT_ID env var or "your-project-id")',
    )

    parser.add_argument(
        "--subscription-id",
        default=os.environ.get("PUBSUB_SUBSCRIPTION_ID", "your-subscription-id"),
        help='Pub/Sub subscription ID (default: from PUBSUB_SUBSCRIPTION_ID env var or "your-subscription-id")',
    )
    
    parser.add_argument(
        "--subscriptions",
        nargs="+",
        help="Multiple subscription IDs to listen to (format: 'project-id:subscription-id')",
    )

    parser.add_argument(
        "--no-color", action="store_true", help="Disable colored output"
    )

    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to .env file (default: .env in current directory)",
    )
    
    parser.add_argument(
        "--web",
        action="store_true",
        help="Start the web interface instead of CLI",
    )

    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8000")),
        help="Port for web interface (default: from PORT env var or 8000)",
    )

    return parser.parse_args()


def print_json_field(field_name, value, indent=0, is_array_item=False):
    """Print a JSON field with proper formatting and indentation."""
    indent_str = "  " * indent
    prefix = "- " if is_array_item else ""

    # Handle different types of values
    if isinstance(value, dict):
        if field_name:
            print(f"{indent_str}{prefix}{Fore.YELLOW}{field_name}:{Style.RESET_ALL}")
        for k, v in value.items():
            print_json_field(k, v, indent + 1)
    elif isinstance(value, list):
        if field_name:
            print(f"{indent_str}{prefix}{Fore.YELLOW}{field_name}:{Style.RESET_ALL}")
        for item in value:
            if isinstance(item, (dict, list)):
                print_json_field("", item, indent + 1, True)
            else:
                print(f"{indent_str}  - {Fore.CYAN}{item}{Style.RESET_ALL}")
    else:
        # Format the value based on its type
        if value is None:
            formatted_value = f"{Fore.RED}null{Style.RESET_ALL}"
        elif isinstance(value, bool):
            formatted_value = f"{Fore.MAGENTA}{str(value).lower()}{Style.RESET_ALL}"
        elif isinstance(value, (int, float)):
            formatted_value = f"{Fore.BLUE}{value}{Style.RESET_ALL}"
        elif isinstance(value, str):
            # Try to parse string as JSON
            try:
                json_obj = json.loads(value)
                print(
                    f"{indent_str}{prefix}{Fore.YELLOW}{field_name}:{Style.RESET_ALL} (nested JSON)"
                )
                print_json_field("", json_obj, indent + 1)
                return
            except (json.JSONDecodeError, TypeError):
                # Not JSON, treat as regular string
                formatted_value = f'{Fore.GREEN}"{value}"{Style.RESET_ALL}'
        else:
            formatted_value = f"{value}"

        if field_name:
            print(
                f"{indent_str}{prefix}{Fore.YELLOW}{field_name}:{Style.RESET_ALL} {formatted_value}"
            )
        else:
            print(f"{indent_str}{prefix}{formatted_value}")


def create_callback(project_id, subscription_id):
    """Create a callback function for a specific subscription."""
    
    def callback(message):
        try:
            # Decode message from bytes to string
            message_data = message.data.decode("utf-8")

            # Print message header with subscription info
            print(f"\n{Fore.CYAN}{'='*80}{Style.RESET_ALL}")
            print(f"{Fore.GREEN}MESSAGE RECEIVED FROM SUBSCRIPTION:{Style.RESET_ALL}")
            print(f"{Fore.MAGENTA}Project: {project_id}, Subscription: {subscription_id}{Style.RESET_ALL}")
            print(f"{Fore.CYAN}{'='*80}{Style.RESET_ALL}")

            # Print message attributes if any
            if message.attributes:
                print(f"{Fore.YELLOW}Message Attributes:{Style.RESET_ALL}")
                for key, value in message.attributes.items():
                    print(f"  {Fore.YELLOW}{key}:{Style.RESET_ALL} {value}")
                print()

            # Try to parse the message data as JSON
            try:
                json_data = json.loads(message_data)
                print_json_field("Message Data", json_data)
            except json.JSONDecodeError:
                # If not valid JSON, print as raw data
                print(f"{Fore.YELLOW}Raw Message Data:{Style.RESET_ALL}")
                print(message_data)

            print(f"{Fore.CYAN}{'='*80}{Style.RESET_ALL}\n")

        except Exception as e:
            print(f"{Fore.RED}Error processing message: {e}{Style.RESET_ALL}")
            print(f"Original message: {message.data}")

        message.ack()  # Acknowledge the message
        
    return callback


def start_web_server(port):
    """Start the web interface with FastAPI."""
    import uvicorn
    import importlib.util
    
    # Check if app module exists
    spec = importlib.util.find_spec('app.main')
    if spec is None:
        print(f"{Fore.RED}Error: Web interface files not found. Make sure the 'app' directory exists.{Style.RESET_ALL}")
        return

    print(f"{Fore.GREEN}Starting web interface on http://127.0.0.1:{port}{Style.RESET_ALL}")
    print(f"{Fore.YELLOW}Press Ctrl+C to exit{Style.RESET_ALL}")
    
    # Start uvicorn server
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)


def main():
    # Parse command line arguments
    args = parse_arguments()

    # Load environment variables from specified .env file if different from default
    if args.env_file != ".env":
        load_dotenv(dotenv_path=args.env_file)
        # Re-parse arguments to pick up any newly loaded env vars
        args = parse_arguments()

    # Check if web interface mode is requested
    if args.web:
        start_web_server(args.port)
        return

    # Disable colors if requested
    if args.no_color:
        colorama.deinit()
        # Override Fore colors with empty strings
        for color in dir(Fore):
            if color.isupper():
                setattr(Fore, color, "")

    # Create subscriber client
    subscriber = pubsub_v1.SubscriberClient()
    
    # Define subscriptions to listen to
    subscriptions = []
    
    # Process multiple subscriptions if provided
    if args.subscriptions:
        for sub_string in args.subscriptions:
            # Parse project:subscription format
            try:
                if ":" in sub_string:
                    project_id, subscription_id = sub_string.split(":", 1)
                    subscriptions.append((project_id, subscription_id))
                else:
                    print(f"{Fore.YELLOW}Warning: Skipping invalid subscription format: {sub_string}. Use 'project-id:subscription-id' format.{Style.RESET_ALL}")
            except Exception as e:
                print(f"{Fore.RED}Error parsing subscription {sub_string}: {e}{Style.RESET_ALL}")
    
    # Also add the default subscription from args if provided
    if args.project_id and args.subscription_id:
        if not any(s[0] == args.project_id and s[1] == args.subscription_id for s in subscriptions):
            subscriptions.append((args.project_id, args.subscription_id))

    # Check if we have any subscriptions to listen to
    if not subscriptions:
        print(f"{Fore.RED}Error: No valid subscriptions provided. Use --subscription-id or --subscriptions.{Style.RESET_ALL}")
        sys.exit(1)

    print(f"{Fore.GREEN}Starting Pub/Sub listener with {len(subscriptions)} subscription(s){Style.RESET_ALL}")
    print(f"{Fore.YELLOW}Environment file:{Style.RESET_ALL} {args.env_file}")
    print(f"{Fore.YELLOW}Press Ctrl+C to exit{Style.RESET_ALL}")
    
    # Store futures for later cleanup
    futures = []

    try:
        # Subscribe to each subscription
        for project_id, subscription_id in subscriptions:
            # Get the subscription path
            subscription_path = subscriber.subscription_path(
                project_id, subscription_id
            )
            
            print(f"\n{Fore.GREEN}Starting listener for:{Style.RESET_ALL}")
            print(f"{Fore.YELLOW}Project ID:{Style.RESET_ALL} {project_id}")
            print(f"{Fore.YELLOW}Subscription ID:{Style.RESET_ALL} {subscription_id}")
            print(f"{Fore.BLUE}Path: {subscription_path}{Style.RESET_ALL}")
            
            # Create a callback specific to this subscription
            subscription_callback = create_callback(project_id, subscription_id)
            
            # Subscribe to the subscription
            streaming_pull_future = subscriber.subscribe(
                subscription_path, callback=subscription_callback
            )
            
            # Add future to the list for cleanup
            futures.append(streaming_pull_future)
        
        # Handle multiple futures
        if len(futures) == 1:
            # With a single subscription, just wait on the result
            futures[0].result()
        else:
            # With multiple subscriptions, wait for keyboard interrupt
            print(f"\n{Fore.GREEN}Listening on {len(futures)} subscriptions...{Style.RESET_ALL}")
            
            # Keep the main thread alive until Ctrl+C
            while True:
                time.sleep(1)
                
    except KeyboardInterrupt:
        print(f"\n{Fore.YELLOW}Stopping subscriptions...{Style.RESET_ALL}")
        for i, future in enumerate(futures):
            print(f"Cancelling subscription {i+1}/{len(futures)}...")
            future.cancel()
        print(f"{Fore.GREEN}Goodbye!{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}Error in Pub/Sub listener: {e}{Style.RESET_ALL}")
        for future in futures:
            try:
                future.cancel()
            except:
                pass


if __name__ == "__main__":
    main()
