import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";

import { ChatGroq } from "@langchain/groq";
import { createClient } from "@/supabase/server";

import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// Helper function to get Spotify session data
async function getSpotifySession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    accessToken: session?.provider_token,
    userId: session?.user?.id,
  };
}

const template = `You are a music-savvy AI assistant that creates personalized Spotify playlists. Your task is to ask the user for the following information to tailor your recommendations:

1. **User Preferences**:
   - Favorite genres


2. **Current Context**:
   - Mood (e.g., happy, relaxed, energetic, melancholic)
   - Activity (e.g., workout, studying, partying, relaxing)

Once you have this information, follow these steps:

1. Analyze the user's request: {input}
2. Based on their mood, choose an appropriate subgenre of their preferred genre
3. Search for tracks that match their taste, mood, and activity
4. Create playlists with a mix of familiar and new tracks
5. Suggest collaborative or thematic playlists when appropriate
6. Seek feedback to improve future recommendations

Available Tools:
{tools}

Use the following format:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question

Begin!

Question: {input}
Thought: {agent_scratchpad}`;

// Helper function to handle Spotify API requests
async function makeSpotifyRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Spotify API request failed: ${response.statusText}`);
  }
  return response.json();
}

// Initialize Supabase client
const supabase = createClient();

// Define tools for the agent
const agentTools = [
  new DynamicTool({
    name: "search_tracks",
    description: "Search for tracks on Spotify by name, artist, or album",
    func: async (input: string) => {
      const { query, limit } = JSON.parse(input);
      const { accessToken } = await getSpotifySession();

      if (!accessToken) {
        throw new Error("No Spotify access token available");
      }

      const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=track&limit=${limit}`;
      return makeSpotifyRequest(searchUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    },
  }),
  new DynamicTool({
    name: "create_playlist",
    description: "Create a new playlist on Spotify",
    func: async (input: string) => {
      const {
        name,
        description,
        public: isPublic = true,
        collaborative = false,
      } = JSON.parse(input);
      const { accessToken, userId } = await getSpotifySession();

      if (!accessToken || !userId) {
        throw new Error("No Spotify access token or user ID available");
      }

      const createUrl = `https://api.spotify.com/v1/users/${userId}/playlists`;
      return makeSpotifyRequest(createUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description: description || "",
          public: isPublic,
          collaborative,
        }),
      });
    },
  }),
  new DynamicTool({
    name: "add_tracks_to_playlist",
    description: "Add tracks to an existing playlist",
    func: async (input: string) => {
      const { playlistId, trackUris } = JSON.parse(input);
      const { accessToken } = await getSpotifySession();

      if (!accessToken) {
        throw new Error("No Spotify access token available");
      }

      const addUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
      return makeSpotifyRequest(addUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uris: trackUris,
        }),
      });
    },
  }),
];

// Create a model and give it access to the tools
const model = new ChatGroq({
  model: "llama-3.3-70b-versatile", // or any other Groq model
  temperature: 0,
}).bindTools(agentTools);

// Define the function that determines whether to continue or not
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages[messages.length - 1];

  // If the LLM makes a tool call, route to the "tools" node
  if (lastMessage.additional_kwargs.tool_calls) {
    return "tools";
  }
  // Otherwise, stop and reply to the user
  return "__end__";
}

// Define the function that calls the model
async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

// Define a new graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addEdge("__start__", "agent") // Entrypoint
  .addNode("tools", new ToolNode(agentTools))
  .addEdge("tools", "agent")
  .addConditionalEdges("agent", shouldContinue);
const memory = new MemorySaver();
// Compile the workflow into a LangChain Runnable
const app = workflow.compile({ checkpointer: memory });

// Example usage
const finalState = await app.invoke({
  messages: [new HumanMessage("Create a playlist for my morning workout")],
});
console.log(finalState.messages[finalState.messages.length - 1].content);
