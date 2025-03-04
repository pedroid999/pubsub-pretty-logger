# 🌈 Pub/Sub Pretty Logger

<div align="center">
  <img src="https://img.shields.io/badge/python-3.7+-blue.svg" alt="Python 3.7+">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/Google%20Cloud-Pub%2FSub-4285F4" alt="Google Cloud Pub/Sub">
</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/pedroid999/pubsub-pretty-logger/main/docs/screenshot.png" alt="Screenshot" width="800">
</p>

A beautiful, colorful, and dynamic tool for monitoring Google Cloud Pub/Sub messages in real-time. Transform your console output from plain text to a structured, color-coded display that makes debugging and monitoring a breeze.

## ✨ Features

- 🎨 **Beautiful Colorized Output**: Different colors for different data types (strings, numbers, booleans, etc.)
- 🔄 **Dynamic Message Handling**: Works with any Pub/Sub message structure automatically
- 🧩 **Nested JSON Support**: Properly formats and displays nested JSON structures with indentation
- 🔌 **Flexible Configuration**: Configure via command line, environment variables, or .env files
- 🔍 **Attribute Display**: Shows both message data and message attributes
- 🌐 **Cross-Platform**: Works on Windows, macOS, and Linux

## 📋 Prerequisites

- Python 3.7+
- Google Cloud project with Pub/Sub subscription
- Google Cloud credentials configured

## 🚀 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/pedroid999/pubsub-pretty-logger.git
   cd pubsub-pretty-logger
   ```

2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Set up your Google Cloud credentials:
   ```bash
   # Option 1: Set environment variable
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"
   
   # Option 2: Add to .env file (see Configuration section)
   ```

## ⚙️ Configuration

You can configure the tool in several ways:

### 1. Using a .env file (recommended)

Create a `.env` file based on the provided `.env.example`:

```bash
cp .env.example .env
```

Then edit the `.env` file with your specific configuration:

```
PUBSUB_PROJECT_ID=your-project-id
PUBSUB_SUBSCRIPTION_ID=your-subscription-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
```

### 2. Using environment variables

Set the environment variables directly:

```bash
export PUBSUB_PROJECT_ID=your-project-id
export PUBSUB_SUBSCRIPTION_ID=your-subscription-id
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/credentials.json
```

### 3. Using command line arguments

```bash
python pubsub_logger.py --project-id=your-project-id --subscription-id=your-subscription-id
```

## 🖥️ Usage

### Basic usage

```bash
python pubsub_logger.py
```

### With command line options

```bash
python pubsub_logger.py --project-id=your-project-id --subscription-id=your-subscription-id
```

### Using a specific .env file

```bash
python pubsub_logger.py --env-file=.env.production
```

### Disable colored output

```bash
python pubsub_logger.py --no-color
```

## 🛠️ Command Line Options

| Option | Description |
|--------|-------------|
| `--project-id` | Google Cloud project ID |
| `--subscription-id` | Pub/Sub subscription ID |
| `--env-file` | Path to a specific .env file |
| `--no-color` | Disable colored output |

## 🎨 Color Scheme

The tool uses different colors to make it easier to identify different types of data:

- 🟢 **Green**: Strings
- 🔵 **Blue**: Numbers
- 🟣 **Magenta**: Booleans
- 🔴 **Red**: Null values
- 🟡 **Yellow**: Field names
- 🔵 **Cyan**: Array items and separators

## 📚 Examples

### Example 1: Basic Email Notification

```json
{
  "type": "EMAIL",
  "notificationType": "WELCOME",
  "destinations": ["user@example.com"],
  "content": {
    "emailTemplate": "WELCOME",
    "data": {
      "name": "John",
      "activationLink": "https://example.com/activate"
    }
  }
}
```

### Example 2: Nested JSON Structure

```json
{
  "type": "NOTIFICATION",
  "data": {
    "user": {
      "id": 12345,
      "profile": {
        "name": "Alice",
        "preferences": {
          "theme": "dark",
          "notifications": true
        }
      }
    },
    "items": [
      {"id": 1, "name": "Item 1"},
      {"id": 2, "name": "Item 2"}
    ]
  }
}
```

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgements

- [Google Cloud Pub/Sub](https://cloud.google.com/pubsub/docs/overview)
- [Colorama](https://pypi.org/project/colorama/) for the terminal colors
- [python-dotenv](https://pypi.org/project/python-dotenv/) for environment variable management 