import { chromium } from "playwright";
import { LMStudioClient, Chat } from "@lmstudio/sdk";
import {
  navigate,
  getContents,
  screenshot,
  click,
  scroll,
  type as typeText,
} from "@llm-browser-agent/tools";

const prompt = process.argv[2];

if (!prompt) {
  console.error("Usage: bun main.ts <prompt>");
  console.error(
    'Example: bun main.ts "What is this image? https://example.com/image.jpg"'
  );
  process.exit(1);
}

const client = new LMStudioClient();
const model = await client.llm.model();

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

// Check if prompt contains a URL
const urlMatch = prompt.match(/https?:\/\/[^\s]+/);

try {
  console.log("[Starting agent...]");

  if (urlMatch) {
    const url = urlMatch[0];
    console.log(`[Navigating to ${url}...]`);

    // Navigate to the URL
    const navResult = await navigate(page, { url });
    console.log(`[${navResult.message}]`);

    // Prepare the screenshot as an image for the model
    const image = await client.files.prepareImageBase64(
      navResult.screenshot.filename,
      navResult.screenshot.base64
    );

    // Create chat with the image
    const chat = Chat.from([
      {
        role: "system",
        content:
          "Describe what you see in the image. Be specific and accurate.",
      },
    ]);

    // Add user message with the image
    chat.append("user", prompt, { images: [image] });

    console.log("[Asking model to describe the image...]");

    // Get the model's response
    const result = await model.respond(chat, {
      onPredictionFragment: (fragment) => {
        if (fragment.content) {
          process.stdout.write(fragment.content);
        }
      },
    });

    console.log(`\n\n[Response]: ${result.content}`);
  } else {
    // No URL - just respond to the prompt
    const chat = Chat.from([{ role: "user", content: prompt }]);

    const result = await model.respond(chat);
    console.log(`[Response]: ${result.content}`);
  }

  console.log("\n[Done]");
} catch (error) {
  console.error("[ERROR]", error);
} finally {
  await browser.close();
}
