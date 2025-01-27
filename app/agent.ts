"use server";

import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";

import { ChatGroq } from "@langchain/groq";
import { createClient } from "@/supabase/server";

import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

export async function createSpotifyPlaylistAgent(userInput: string) {
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

  // Helper function to handle Spotify API requests
  async function makeSpotifyRequest(url: string, options?: RequestInit) {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Spotify API request failed: ${response.statusText}`);
    }
    return response.json();
  }

  // Define tools for the agent
  const agentTools = [
    new DynamicTool({
      name: "search_tracks",
      description: "Search for tracks on Spotify by name, artist, or album",
      func: async (input: string) => {
        try {
          const { query, limit = 5 } = JSON.parse(input);
          const { accessToken } = await getSpotifySession();

          if (!accessToken) {
            throw new Error("No Spotify access token available");
          }

          const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
            query
          )}&type=track&limit=${limit}`;
          const response = await makeSpotifyRequest(searchUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });
          return JSON.stringify(response.tracks.items);
        } catch (error) {
          console.error("Search tracks error:", error);
          return "Failed to search tracks";
        }
      },
    }),
    new DynamicTool({
      name: "create_playlist",
      description: "Create a new playlist on Spotify",
      func: async (input: string) => {
        try {
          const {
            name,
            description = "",
            public: isPublic = true,
            collaborative = false,
          } = JSON.parse(input);
          const { accessToken, userId } = await getSpotifySession();

          if (!accessToken || !userId) {
            throw new Error("No Spotify access token or user ID available");
          }

          const createUrl = `https://api.spotify.com/v1/users/${userId}/playlists`;
          const response = await makeSpotifyRequest(createUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name,
              description,
              public: isPublic,
              collaborative,
            }),
          });
          return JSON.stringify(response);
        } catch (error) {
          console.error("Create playlist error:", error);
          return "Failed to create playlist";
        }
      },
    }),
    new DynamicTool({
      name: "add_tracks_to_playlist",
      description: "Add tracks to an existing playlist",
      func: async (input: string) => {
        try {
          const { playlistId, trackUris } = JSON.parse(input);
          const { accessToken } = await getSpotifySession();

          if (!accessToken) {
            throw new Error("No Spotify access token available");
          }

          const addUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
          const response = await makeSpotifyRequest(addUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uris: Array.isArray(trackUris) ? trackUris : [trackUris],
            }),
          });
          return JSON.stringify(response);
        } catch (error) {
          console.error("Add tracks error:", error);
          return "Failed to add tracks to playlist";
        }
      },
    }),
  ];

  // Create a model and give it access to the tools
  const model = new ChatGroq({
    model: "llama-3.3-70b-versatile", // or any other Groq model
    temperature: 0,
    apiKey: process.env.NEXT_PUBLIC_GROQ_KEY,
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

  // Create and compile workflow
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addEdge("__start__", "agent")
    .addNode("tools", new ToolNode(agentTools))
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue);

  const memory = new MemorySaver();
  const app = workflow.compile({
    checkpointer: memory,
  });

  // Execute the workflow with user input
  const finalState = await app.invoke(
    {
      messages: [new HumanMessage(userInput)],
    },
    {
      configurable: {
        thread_id: "spotify_playlist_thread",
      },
    }
  );

  return finalState.messages[finalState.messages.length - 1].content;
}

// Example usage
// const playlistResponse = await createSpotifyPlaylistAgent("Create a playlist for my morning workout");
// console.log(playlistResponse);
