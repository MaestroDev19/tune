import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";

import { ChatGroq } from "@langchain/groq";
import { createClient } from "@/supabase/server";
import { PromptTemplate } from "@langchain/core/prompts";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z as Zod } from "zod";
import { RunnableSequence } from "@langchain/core/runnables";

export async function getSpotifySession() {
  try {
    let storedSession: string | null = null;

    // Only access localStorage if running in browser
    if (typeof window !== "undefined") {
      storedSession = window.localStorage.getItem("spotifySession");
    }

    const supabase = await createClient();
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    // Check if we have a valid Spotify provider token
    if (session?.provider_token) {
      const spotifySession = {
        accessToken: session.provider_token,
        userId: session.user?.id,
        expiresAt: session.expires_at,
      };

      // Store the session in localStorage
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "spotifySession",
          JSON.stringify(spotifySession)
        );
      }

      return spotifySession;
    }

    // Fallback to stored session if available
    if (storedSession) {
      const parsedSession = JSON.parse(storedSession);
      if (parsedSession.userId === session?.user?.id) {
        return parsedSession;
      }
    }

    return { accessToken: null, userId: null };
  } catch (error) {
    console.error("Error getting Spotify session:", error);
    return { accessToken: null, userId: null };
  }
}
export const getTrackTitles = async (input: string): Promise<string[]> => {
  const llm = new ChatGroq({
    apiKey: process.env.NEXT_PUBLIC_GROQ_KEY,
    temperature: 0.2,
    model: "llama-3.3-70b-specdec",
  });

  // Prompt to get genre and mood as a single string
  const genreMoodTemplate = `
    Analyze the user's request and determine:
    1. The most appropriate music genre based on the context
    2. The mood or atmosphere that best matches the request
    
    Respond in this format: "Genre: <genre>, Mood: <mood>"
    
    Examples:
    Input: "Music for a cozy night in"
    Output: "Genre: lo-fi, Mood: relaxing"
    
    Input: "Songs to get me pumped for the gym"
    Output: "Genre: hip-hop, Mood: energetic"
    
    Input: "Background music for a romantic dinner"
    Output: "Genre: jazz, Mood: romantic"
    
    Guidelines:
    - Infer the genre and mood from the context, even if not explicitly stated
    - Use your knowledge of music genres and moods
    - Return only the text in the exact format specified
    - Do not include any additional text or explanations
    
    Question: {input}
  `;

  const genreMoodPrompt = new PromptTemplate({
    inputVariables: ["input"],
    template: genreMoodTemplate,
  });

  const genreMoodChain = RunnableSequence.from([
    (input: { input: string }) => ({ input: input.input }),
    genreMoodPrompt,
    llm,
    (response) => {
      try {
        const content = response.content as string;
        const match = content.match(/Genre:\s*(.*?),\s*Mood:\s*(.*)/);
        if (match) {
          return { genre: match[1].trim(), mood: match[2].trim() };
        }
      } catch (error) {
        console.error("Error parsing genre and mood:", error);
      }
      return { genre: "pop", mood: "neutral" }; // Default fallback
    },
  ]);

  const genreMoodResponse = await genreMoodChain.invoke({ input });

  // Fetch recent tracks in the specified genre from Spotify
  const spotifySession = await getSpotifySession();
  const accessToken = spotifySession?.accessToken || null;
  const userId = spotifySession?.userId || null;

  let genreTracks: string[] = [];
  if (accessToken) {
    try {
      const response = await fetch(
        `https://api.spotify.com/v1/search?q=genre:${encodeURIComponent(
          genreMoodResponse.genre
        )}&type=track&limit=50&sort=popularity`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const data = await response.json();
      genreTracks = data.tracks.items.map(
        (track: any) => `${track.name} - ${track.artists[0].name}`
      );
    } catch (error) {
      console.error("Error fetching genre tracks:", error);
    }
  }

  const template = `
    You are a music-savvy AI assistant that creates personalized Spotify playlists. Your task is to:
    
    1. Analyze the user's request: {input}
    2. Consider the mood: {mood}
    3. Select tracks ONLY from this list of recent {genre} tracks: {genreTracks}
    4. Return only a comma-separated string of song titles and artists.
    
    Guidelines:
    - Only select tracks from the provided Spotify tracks list
    - Ensure the playlist flows well and matches both the genre and mood
    - If no tracks are available, return an empty string ""
    
    Example:
    Input: "I need a playlist for a relaxing evening with jazz music"
    Output: "Take Five - Dave Brubeck, Everything's Gonna Be Alright - Kandace Springs"
    
    Genre: {genre}
    Mood: {mood}
    Available Tracks: {genreTracks}
    Question: {input}
  `;

  const trackPromptTemplate = new PromptTemplate({
    inputVariables: ["input", "genre", "mood", "genreTracks"],
    template: template,
  });

  const trackChain = RunnableSequence.from([
    (input: { input: string }) => ({
      input: input.input,
      genre: genreMoodResponse.genre,
      mood: genreMoodResponse.mood,
      genreTracks:
        genreTracks.length > 0 ? genreTracks.join(", ") : "No tracks available",
    }),
    trackPromptTemplate,
    llm,
    (response) => {
      try {
        // Use regex to extract song titles and artists
        const trackPattern = /([^,-]+)\s*-\s*([^,]+)/g;
        const matches = [
          ...(response.content as string).matchAll(trackPattern),
        ];
        return matches.map(
          (match) => `${match[1].trim()} - ${match[2].trim()}`
        );
      } catch (error) {
        console.error("Error parsing track titles:", error);
        return [];
      }
    },
  ]);

  const response = await trackChain.invoke({
    input,
  });

  // Directly return the array from the chain
  return response;
};
