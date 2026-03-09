import { Inngest } from "inngest";

/**
 * Inngest client instance
 */
export const inngest = new Inngest({
  id: "polymarket-watcher",
  name: "Polymarket Watcher",
});

/**
 * Placeholder workflow function
 * TODO: Implement market monitoring workflows in subsequent tickets
 */
const helloWorld = inngest.createFunction(
  { id: "hello-world", name: "Hello World" },
  { event: "test/hello" },
  async ({ event, step }) => {
    await step.run("log-event", () => {
      console.log("Received event:", event);
      return { message: "Hello from Polymarket Watcher!" };
    });
  }
);

/**
 * Export all workflow functions for Inngest registration
 */
export const functions = [helloWorld];
