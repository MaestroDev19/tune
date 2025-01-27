import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { DynamicTool } from "@langchain/core/tools";
import { createClient } from "@/supabase/server";

const agentTools = [
  new DynamicTool({
    name: "search_spotify",
    description: "Search for tracks, albums, artists or playlists on Spotify",
    func: async (query: string) => {
      const supabase = await createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.provider_token;
      
      if (!accessToken) {
        throw new Error("No Spotify access token available");
      }

      const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,album,artist,playlist`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error("Failed to search Spotify");
      }

      return await response.json();
    }
  }),
  new DynamicTool({
    name: "create_playlist",
    description: "Create a new playlist on Spotify",
    func: async (input: string) => {
      const { name, description } = JSON.parse(input);
      const supabase = await createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.provider_token;
      const userId = session?.user?.id;

      if (!accessToken || !userId) {
        throw new Error("No Spotify access token or user ID available");
      }

      const response = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          description,
          public: true
        })
      });

      if (!response.ok) {
        throw new Error("Failed to create playlist");
      }

      return await response.json();
    }
  })
];