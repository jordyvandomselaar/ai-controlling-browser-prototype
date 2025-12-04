# LLM Browser Agent

A vision-enabled AI agent that can browse the web autonomously using a local LLM running in LM Studio. The agent sees screenshots of web pages with labeled clickable elements and can interact with them.

## Features

- **Vision-based browsing**: Uses a Vision-Language Model (VLM) to see and understand web pages
- **Smart element detection**: Automatically detects clickable elements (links, buttons, inputs) and labels them with numbers
- **Color-coded labels**: Elements are color-coded by type for easy identification:
  - 🔵 **Blue**: Links (navigation)
  - 🟢 **Green**: Input fields (text entry)
  - 🟠 **Orange**: Buttons (actions)
  - 🟣 **Purple**: Other interactive elements
- **Click by label**: Simply tell the agent to click element [5] instead of guessing coordinates
- **Multi-tab support**: Handles links that open in new tabs automatically
- **Research mode**: Encourages visiting multiple sources for comprehensive answers

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [LM Studio](https://lmstudio.ai/) with a Vision-Language Model loaded (e.g., Gemma 3 12B)
- LM Studio server running on default port

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd llm_browser_agent

# Install dependencies
bun install
```

## Usage

Make sure LM Studio is running with a VLM loaded, then:

```bash
cd packages/ai
bun main.ts "Your prompt here"
```

### Examples

```bash
# Research a topic
bun main.ts "Who is Albert Einstein?"

# Find specific information
bun main.ts "Find the official documentation for React hooks"

# Describe an image
bun main.ts "What is this image? https://example.com/photo.jpg"

# Navigate and interact
bun main.ts "Go to GitHub and search for typescript projects"
```

## How It Works

1. **Navigation**: The agent navigates to URLs and receives a screenshot with labeled elements
2. **Element Detection**: Playwright detects all clickable elements (links, buttons, inputs, etc.)
3. **Visual Labeling**: Elements are outlined with colored boxes and numbered labels
4. **Model Interaction**: The VLM sees the labeled screenshot and decides what to click
5. **Click by Label**: The agent clicks elements by their label number for accuracy
6. **Iteration**: The process repeats until the agent has enough information to answer

## Architecture

```
llm_browser_agent/
├── packages/
│   ├── ai/           # Main agent logic
│   │   └── main.ts   # Entry point and agent loop
│   └── tools/        # Browser automation tools
│       └── browser.ts # Playwright-based browser controls
├── package.json
└── turbo.json
```

## Available Tools

The agent has access to these tools:

| Tool | Description |
|------|-------------|
| `navigate` | Go to a URL |
| `clickByLabel` | Click an element by its label number (preferred) |
| `click` | Click at specific x,y coordinates (fallback) |
| `keyboard` | Type text at cursor position |
| `press` | Press a key (Enter, Tab, etc.) |
| `scroll` | Scroll the page |
| `getContents` | Get text content of the page |
| `labeledScreenshot` | Take a fresh screenshot with labels |
| `reload` | Reload the current page |

## Configuration

The viewport is set to 896x896 pixels to match the VLM's expected image size (optimized for Gemma 3's vision encoder).

## Development

```bash
# Run with hot reload
bun --watch packages/ai/main.ts "Your prompt"

# Check types
bun run typecheck
```

## License

MIT

